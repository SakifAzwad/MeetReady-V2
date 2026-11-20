import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, eventTypes, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { saveWeeklySchedule } from "@/server/availability";
import { createBooking } from "@/server/booking";
import { CalendarUnavailableError } from "@/server/calendar/google-api";
import { createEventType, setEventTypeActive } from "@/server/event-types";
import { APP, book, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { confirmationAnswer, runTool } from "./server";
import {
  cancelBookingTool,
  cleanReason,
  findFreeTimesInput,
  findFreeTimesTool,
  rescheduleBookingTool,
  type Caller,
  type McpDeps,
} from "./tools";

/*
 * Day 24: cancel_booking, reschedule_booking, and find_free_times for a move.
 * Same setup as tools.test.ts: host "sakif" in Dhaka (UTC+6), free all day;
 * "now" is Wednesday 18 Nov, 10:00 UTC. Ada's booking (made by a guest on the
 * page) is Thursday 26 Nov, 14:00 Dhaka = 08:00 UTC.
 */

const NOW = new Date("2026-11-18T10:00:00Z");
const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const ADA = new Date("2026-11-26T08:00:00Z");
const CLIENT = "https://claude.ai/client";
const writer: Caller = {
  userId: "host",
  clientId: CLIENT,
  scopes: new Set(["bookings:read", "bookings:write"]),
};
const noForm = { canAsk: false, answer: null } as const;

let db: Database;
let adaId: string;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
  adaId = (await book(db, ADA, LONG_AGO)).booking.id;
}, 30_000);

function deps(over: Partial<McpDeps> = {}) {
  const onChanged = vi.fn();
  const changeLimit = vi.fn(async () => ({ ok: true }) as const);
  const calendar = { busyTimes: vi.fn(async () => []) };
  const d: McpDeps = {
    db,
    appUrl: APP,
    busyTimes: vi.fn(async () => []),
    limit: vi.fn(async () => ({ ok: true }) as const),
    now: () => NOW,
    calendar,
    changeLimit,
    onChanged,
    ...over,
  };
  return { d, onChanged, changeLimit, calendar };
}

const row = async (id = adaId) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0]!;

/** A second host with one booking: nothing of theirs can be changed through "sakif"'s connection. */
async function otherHostsBooking() {
  await db.insert(user).values({ id: "other", name: "Grace", email: "g@example.com", username: "grace" });
  await saveWeeklySchedule(db, "other", {
    timeZone: "UTC",
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "00:00", endTime: "23:30" })),
  });
  const et = await createEventType(
    db,
    "other",
    eventTypeSchema.parse({
      ...EVENT_TYPE_DEFAULTS,
      title: "Office",
      slug: "office",
      minimumNoticeMinutes: 0,
    }),
  );
  if (!et.ok) throw new Error("setup failed");
  const b = await createBooking(
    db,
    {
      username: "grace",
      slug: "office",
      startsAt: new Date("2026-11-25T15:00:00Z"),
      guestName: "Secret Guest",
      guestEmail: "secret@example.com",
      guestTimeZone: "UTC",
      guestNotes: "",
    },
    LONG_AGO,
  );
  if (!b.ok) throw new Error("setup failed");
  return b.booking.id;
}

// ─── cancel_booking ─────────────────────────────────────────────────────────────

describe("cancel_booking", () => {
  const args = (over: { bookingId?: string; reason?: string | null } = {}) => ({
    bookingId: adaId,
    reason: null as string | null,
    ...over,
  });

  it("cancels a booking a guest made, records the assistant, and starts the emails job", async () => {
    const { d, onChanged, changeLimit } = deps();
    const r = await cancelBookingTool(d, writer, args({ reason: "I'm ill" }), noForm);
    expect(r).toEqual({
      ok: true,
      data: {
        cancelled: true,
        bookingId: adaId,
        meetingType: "Intro call",
        start: "2026-11-26 14:00",
        timeZone: "Asia/Dhaka",
        guestName: "Ada",
        guestEmail: "ada@example.com",
        reason: "I'm ill",
        emailed: "Ada gets an email from MeetReady saying you cancelled, with the reason.",
      },
    });
    expect(await row()).toMatchObject({
      status: "cancelled",
      cancelledBy: "host",
      cancellationReason: "I'm ill",
      changedByClient: CLIENT,
      sequence: 1,
    });
    expect(onChanged).toHaveBeenCalledWith({ bookingId: adaId, change: "cancelled", sequence: 1 });
    expect(changeLimit).toHaveBeenCalledWith("host", "ada@example.com");
  });

  it("cleans the reason before it reaches the guest's inbox: no links, emails or phone numbers", async () => {
    const { d } = deps();
    await cancelBookingTool(
      d,
      writer,
      args({ reason: "Rebook at https://evil.example/login or call +44 20 7946 0958, mail x@evil.example" }),
      noForm,
    );
    const reason = (await row()).cancellationReason!;
    expect(reason).not.toMatch(/evil|7946|@/);
    expect(cleanReason("   ")).toBeNull();
    expect(cleanReason("x".repeat(900))).toHaveLength(500);
  });

  describe("the confirm form", () => {
    it("asks first, with the reason, and changes nothing yet", async () => {
      const { d, onChanged } = deps();
      const r = await cancelBookingTool(d, writer, args({ reason: "Clash" }), { canAsk: true, answer: null });
      expect(r).toEqual({
        ok: "confirm",
        action: "cancel",
        message:
          'Cancel "Intro call" with Ada (ada@example.com) on 2026-11-26 14:00 (Asia/Dhaka)? MeetReady will email Ada that you cancelled, with your reason: "Clash".',
      });
      expect((await row()).status).toBe("confirmed");
      expect(onChanged).not.toHaveBeenCalled();
    });

    it("cancels when accepted, not when declined", async () => {
      const { d } = deps();
      expect(await cancelBookingTool(d, writer, args(), { canAsk: true, answer: "declined" })).toEqual({
        ok: true,
        data: { cancelled: false, reason: "The user declined in the confirmation form." },
      });
      expect((await row()).status).toBe("confirmed");
      await cancelBookingTool(d, writer, args(), { canAsk: true, answer: "accepted" });
      expect((await row()).status).toBe("cancelled");
    });

    it("isn't shown for a booking that can't be cancelled", async () => {
      const { d } = deps({ now: () => new Date("2026-11-26T08:10:00Z") }); // the meeting has started
      const r = await cancelBookingTool(d, writer, args(), { canAsk: true, answer: null });
      expect(r).toEqual({
        ok: false,
        error: "That meeting has already started or is over, so it can't be changed.",
      });
    });
  });

  it("a retried call finds it already cancelled: one cancel, one set of emails", async () => {
    const { d, onChanged } = deps();
    await cancelBookingTool(d, writer, args(), noForm);
    const again = await cancelBookingTool(d, writer, args(), noForm);
    expect(again).toMatchObject({
      ok: true,
      data: { cancelled: true, alreadyCancelled: true, cancelledBy: "host" },
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect((await row()).sequence).toBe(1);
  });

  it("says so when the guest had already cancelled it", async () => {
    const { d, onChanged } = deps();
    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: NOW, cancelledBy: "guest" })
      .where(eq(bookings.id, adaId));
    expect(await cancelBookingTool(d, writer, args(), noForm)).toMatchObject({
      ok: true,
      data: { alreadyCancelled: true, cancelledBy: "guest" },
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("only the caller's own bookings: another host's id looks missing, and stays confirmed", async () => {
    const theirs = await otherHostsBooking();
    const { d } = deps();
    expect(await cancelBookingTool(d, writer, args({ bookingId: theirs }), noForm)).toEqual({
      ok: false,
      error: "No booking with that id. list_bookings shows the ids.",
    });
    expect((await row(theirs)).status).toBe("confirmed");
  });

  it("stops at the limits, before cancelling", async () => {
    const { d } = deps({ changeLimit: vi.fn(async () => ({ ok: false, retryAfterSeconds: 3600 }) as const) });
    expect(await cancelBookingTool(d, writer, args(), noForm)).toEqual({
      ok: false,
      error: "Too many changes for now. Try again in 60 minutes.",
    });
    expect((await row()).status).toBe("confirmed");
  });

  it("needs the write permission", async () => {
    const readOnly: Caller = { userId: "host", scopes: new Set(["bookings:read"]) };
    const { d } = deps();
    const r = await runTool({ ...d, report: vi.fn() }, readOnly, "bookings:write", () =>
      cancelBookingTool(d, readOnly, args(), noForm),
    );
    expect(r).toMatchObject({ isError: true });
    expect((await row()).status).toBe("confirmed");
  });
});

// ─── reschedule_booking ─────────────────────────────────────────────────────────

describe("reschedule_booking", () => {
  // Friday 27 Nov, 16:00 in Dhaka = 10:00 UTC.
  const NEW = new Date("2026-11-27T10:00:00Z");
  const args = (
    over: Partial<{ bookingId: string; date: string; time: string; timeZone: string | null }> = {},
  ) => ({
    bookingId: adaId,
    date: "2026-11-27",
    time: "16:00",
    timeZone: null as string | null,
    ...over,
  });

  it("moves the booking, records the host and the assistant, and starts the emails job", async () => {
    const { d, onChanged, changeLimit, calendar } = deps();
    const r = await rescheduleBookingTool(d, writer, args(), noForm);
    expect(r).toEqual({
      ok: true,
      data: {
        moved: true,
        bookingId: adaId,
        meetingType: "Intro call",
        timeZone: "Asia/Dhaka",
        guestName: "Ada",
        guestEmail: "ada@example.com",
        from: "2026-11-26 14:00",
        start: "2026-11-27 16:00",
        end: "2026-11-27 16:30",
        emailed: "Ada gets an email from MeetReady with the new time and a link to reschedule or cancel.",
      },
    });
    expect(await row()).toMatchObject({
      startsAt: NEW,
      rescheduledBy: "host",
      changedByClient: CLIENT,
      sequence: 1,
    });
    expect(onChanged).toHaveBeenCalledWith({
      bookingId: adaId,
      change: "rescheduled",
      sequence: 1,
      previousStartsAt: ADA,
    });
    expect(changeLimit).toHaveBeenCalledWith("host", "ada@example.com");
    // The move itself asked Google LIVE, like a guest's reschedule.
    expect(calendar.busyTimes).toHaveBeenCalledWith("host", expect.anything(), "live");
  });

  it("takes the time on another clock: 10:00 in London is 16:00 in Dhaka", async () => {
    const { d } = deps();
    const r = await rescheduleBookingTool(
      d,
      writer,
      args({ time: "10:00", timeZone: "Europe/London" }),
      noForm,
    );
    expect(r.ok).toBe(true);
    expect((await row()).startsAt).toEqual(NEW);
  });

  it("a retried call finds it already there: one move, one set of emails", async () => {
    const { d, onChanged } = deps();
    await rescheduleBookingTool(d, writer, args(), noForm);
    expect(await rescheduleBookingTool(d, writer, args(), noForm)).toMatchObject({
      ok: true,
      data: { moved: true, alreadyThere: true, start: "2026-11-27 16:00" },
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect((await row()).sequence).toBe(1);
  });

  it("can move half an hour later, into its own old time (a 60-minute meeting)", async () => {
    const deep = (await book(db, new Date("2026-11-27T04:00:00Z"), LONG_AGO, { slug: "deep" })).booking.id;
    const { d } = deps({
      // Google has the meeting itself: it mustn't block its own move.
      busyTimes: vi.fn(async () => [
        { start: new Date("2026-11-27T04:00:00Z"), end: new Date("2026-11-27T05:00:00Z") },
      ]),
    });
    const r = await rescheduleBookingTool(d, writer, args({ bookingId: deep, time: "10:30" }), noForm);
    expect(r.ok).toBe(true);
    expect((await row(deep)).startsAt).toEqual(new Date("2026-11-27T04:30:00Z"));
  });

  it("follows the guest's rules: not onto another booking", async () => {
    await book(db, NEW, LONG_AGO, { guestEmail: "grace@example.com" });
    const { d, onChanged } = deps();
    expect(await rescheduleBookingTool(d, writer, args(), noForm)).toEqual({
      ok: false,
      error:
        "2026-11-27 16:00 (Asia/Dhaka) isn't free for Intro call: it's outside your hours, too soon, or taken. Use find_free_times with this bookingId.",
    });
    expect((await row()).startsAt).toEqual(ADA);
    expect(onChanged).not.toHaveBeenCalled();
  });

  describe("the confirm form", () => {
    it("asks first, with the old and new times, and moves nothing yet", async () => {
      const { d } = deps();
      expect(await rescheduleBookingTool(d, writer, args(), { canAsk: true, answer: null })).toEqual({
        ok: "confirm",
        action: "move",
        message:
          'Move "Intro call" with Ada (ada@example.com) from 2026-11-26 14:00 to 2026-11-27 16:00 (Asia/Dhaka)? MeetReady will email Ada the new time, with a link to reschedule or cancel.',
      });
      expect((await row()).startsAt).toEqual(ADA);
    });

    it("moves nothing when declined", async () => {
      const { d } = deps();
      expect(await rescheduleBookingTool(d, writer, args(), { canAsk: true, answer: "declined" })).toEqual({
        ok: true,
        data: { moved: false, reason: "The user declined in the confirmation form." },
      });
      expect((await row()).startsAt).toEqual(ADA);
    });
  });

  it("can't move a cancelled booking, one that started, or one whose meeting type is switched off", async () => {
    const { d } = deps();
    const [intro] = await db.select().from(eventTypes).where(eq(eventTypes.slug, "intro"));
    await setEventTypeActive(db, "host", intro!.id, false);
    expect(await rescheduleBookingTool(d, writer, args(), noForm)).toEqual({
      ok: false,
      error: '"Intro call" is switched off, so its bookings can\'t be moved. Switch it on first.',
    });
    await setEventTypeActive(db, "host", intro!.id, true);

    const started = deps({ now: () => new Date("2026-11-26T08:05:00Z") }).d;
    expect(await rescheduleBookingTool(started, writer, args(), noForm)).toMatchObject({ ok: false });

    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: NOW, cancelledBy: "guest" })
      .where(eq(bookings.id, adaId));
    expect(await rescheduleBookingTool(d, writer, args(), noForm)).toEqual({
      ok: false,
      error: "That booking is cancelled, so it can't be changed.",
    });
  });

  it("only the caller's own bookings", async () => {
    const theirs = await otherHostsBooking();
    const { d } = deps();
    expect(await rescheduleBookingTool(d, writer, args({ bookingId: theirs }), noForm)).toEqual({
      ok: false,
      error: "No booking with that id. list_bookings shows the ids.",
    });
  });

  it("fails closed when Google can't be read at move time, and leaves the booking where it was", async () => {
    const { d } = deps({
      calendar: {
        busyTimes: vi.fn(async () => {
          throw new CalendarUnavailableError("unavailable", "Google down");
        }),
      },
    });
    expect(await rescheduleBookingTool(d, writer, args(), noForm)).toEqual({
      ok: false,
      error: "Your Google Calendar can't be read right now, so nothing was moved. Try again soon.",
    });
    expect((await row()).startsAt).toEqual(ADA);
  });

  it("stops at the limits, before moving", async () => {
    const { d } = deps({ changeLimit: vi.fn(async () => ({ ok: false, retryAfterSeconds: 60 }) as const) });
    expect(await rescheduleBookingTool(d, writer, args(), noForm)).toMatchObject({ ok: false });
    expect((await row()).startsAt).toEqual(ADA);
  });

  it("checks what the model sent", async () => {
    const { d } = deps();
    const bad = async (over: Parameters<typeof args>[0]) => {
      const r = await rescheduleBookingTool(d, writer, args(over), noForm);
      return r.ok === false ? r.error : "moved?!";
    };
    expect(await bad({ date: "2026-02-30" })).toBe("The date must be a real date in YYYY-MM-DD form.");
    expect(await bad({ time: "4pm" })).toBe("The time must be HH:mm in 24-hour time.");
    expect(await bad({ timeZone: "Mars/Olympus" })).toBe(
      'Unknown timezone "Mars/Olympus". Use an IANA name.',
    );
    expect((await row()).startsAt).toEqual(ADA);
  });
});

// ─── find_free_times for a move ─────────────────────────────────────────────────

describe("find_free_times with a bookingId (Day 24)", () => {
  const search = (bookingId?: string | null) =>
    findFreeTimesInput.parse({
      eventType: "intro",
      from: "2026-11-26",
      to: "2026-11-26",
      earliest: "13:00",
      latest: "15:00",
      timeZone: null,
      ...(bookingId === undefined ? {} : { bookingId }),
    });
  const times = (r: Awaited<ReturnType<typeof findFreeTimesTool>>) =>
    r.ok ? r.data.days.flatMap((day) => day.times) : r.error;

  it("counts the booking's own time, and its own Google event, as free", async () => {
    // Google has Ada's meeting in it (Day 16): without the id, 14:00 is hidden twice over.
    const own = [{ start: ADA, end: new Date("2026-11-26T08:30:00Z") }];
    const { d } = deps({ busyTimes: vi.fn(async () => own) });
    expect(times(await findFreeTimesTool(d, writer, search()))).not.toContain("14:00");
    expect(times(await findFreeTimesTool(d, writer, search(adaId)))).toContain("14:00");
  });

  it("still works without the field: an assistant with the old tool list sends none", async () => {
    const { d } = deps();
    expect(findFreeTimesInput.safeParse({ ...search(), bookingId: undefined }).success).toBe(true);
    expect(times(await findFreeTimesTool(d, writer, search(null)))).not.toContain("14:00");
  });

  it("refuses another host's booking, a cancelled one, or a different meeting type", async () => {
    const theirs = await otherHostsBooking();
    const { d } = deps();
    expect(times(await findFreeTimesTool(d, writer, search(theirs)))).toBe(
      "No booking with that id. list_bookings shows the ids.",
    );
    expect(times(await findFreeTimesTool(d, writer, { ...search(adaId), eventType: "deep" }))).toBe(
      'That booking is a "Intro call" (slug "intro"); search with that meeting type.',
    );
    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: NOW, cancelledBy: "guest" })
      .where(eq(bookings.id, adaId));
    expect(times(await findFreeTimesTool(d, writer, search(adaId)))).toBe(
      "That booking is cancelled, so it can't be changed.",
    );
  });
});

describe("confirm answers are per action", () => {
  it("a ticked 'book' box doesn't cancel anything, and the other way round", () => {
    const accepted = (content: Record<string, unknown>) => ({ confirm: { action: "accept", content } });
    expect(confirmationAnswer(accepted({ cancel: true }), "cancel")).toBe("accepted");
    expect(confirmationAnswer(accepted({ book: true }), "cancel")).toBe("declined");
    expect(confirmationAnswer(accepted({ move: true }), "move")).toBe("accepted");
    expect(confirmationAnswer(accepted({ cancel: true }), "move")).toBe("declined");
  });
});
