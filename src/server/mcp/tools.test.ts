import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { saveWeeklySchedule } from "@/server/availability";
import { createBooking } from "@/server/booking";
import { createEventType, setEventTypeActive } from "@/server/event-types";
import { APP, book, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { CalendarUnavailableError } from "@/server/calendar/google-api";
import { callerFromClaims, canShowForm, confirmationAnswer, runTool } from "./server";
import {
  bookMeetingTool,
  findFreeTimesTool,
  getBookingTool,
  listBookingsTool,
  listEventTypesTool,
  MAX_LISTED_TIMES,
  type Caller,
  type McpDeps,
} from "./tools";

/*
 * Day 21: the MCP tools on a real (in-memory) Postgres, without an MCP client
 * or a token: the caller is what a verified token would give. The fixture host
 * "sakif" is in Dhaka (UTC+6) and free all day; "now" is Wednesday 18 Nov,
 * 10:00 UTC (16:00 in Dhaka).
 */

const NOW = new Date("2026-11-18T10:00:00Z");
const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const host: Caller = { userId: "host", scopes: new Set(["bookings:read"]) };
const other: Caller = { userId: "other", scopes: new Set(["bookings:read"]) };

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

function deps(over: Partial<McpDeps> = {}): McpDeps {
  return {
    db,
    appUrl: APP,
    busyTimes: vi.fn(async () => []),
    limit: vi.fn(async () => ({ ok: true }) as const),
    now: () => NOW,
    ...over,
  };
}

/** A second host with one booking, to prove nothing of theirs leaks to "sakif" and back. */
async function setupOtherHost() {
  await db.insert(user).values({
    id: "other",
    name: "Grace Hopper",
    email: "grace@example.com",
    username: "grace",
    timeZone: "America/New_York",
  });
  await saveWeeklySchedule(db, "other", {
    timeZone: "America/New_York",
    rules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "00:00", endTime: "23:30" })),
  });
  const r = await createEventType(
    db,
    "other",
    eventTypeSchema.parse({
      ...EVENT_TYPE_DEFAULTS,
      title: "Office hours",
      slug: "office",
      minimumNoticeMinutes: 0,
    }),
  );
  if (!r.ok) throw new Error("setup failed");
  const b = await createBooking(
    db,
    {
      username: "grace",
      slug: "office",
      startsAt: new Date("2026-11-25T15:00:00Z"),
      guestName: "Secret Guest",
      guestEmail: "secret@example.com",
      guestTimeZone: "America/New_York",
      guestNotes: "Grace's guest's private notes",
    },
    LONG_AGO,
  );
  if (!b.ok) throw new Error("setup failed");
  return b.booking.id;
}

describe("list_event_types", () => {
  it("lists the host's meeting types with their booking links, switched-off ones marked", async () => {
    const [deep] = await db.query.eventTypes.findMany({ where: (t, { eq }) => eq(t.slug, "deep") });
    await setEventTypeActive(db, "host", deep!.id, false);

    const r = await listEventTypesTool(deps(), host);

    expect(r).toEqual({
      ok: true,
      data: {
        timeZone: "Asia/Dhaka",
        eventTypes: [
          {
            slug: "intro",
            title: "Intro call",
            durationMinutes: 30,
            location: "Google Meet",
            active: true,
            bookingLink: `${APP}/sakif/intro`,
          },
          {
            slug: "deep",
            title: "Deep dive",
            durationMinutes: 60,
            location: "Zoom",
            active: false,
            bookingLink: `${APP}/sakif/deep`,
          },
        ],
      },
    });
  });

  it("asks a host who hasn't picked a booking link to finish setting up", async () => {
    await db.update(user).set({ username: null }).where(eq(user.id, "host"));
    expect(await listEventTypesTool(deps(), host)).toEqual({
      ok: false,
      error: `Finish setting up MeetReady first (pick your booking link): ${APP}/onboarding`,
    });
  });
});

describe("find_free_times", () => {
  const tuesday = { eventType: "intro", from: "2026-11-24", to: "2026-11-24" };

  it("gives the booking page's free times, on the host's clock by default, minus bookings and Google", async () => {
    await book(db, new Date("2026-11-24T08:00:00Z"), LONG_AGO); // 14:00 in Dhaka
    const busyTimes = vi.fn(async () => [
      { start: new Date("2026-11-24T09:00:00Z"), end: new Date("2026-11-24T09:30:00Z") }, // 15:00 in Dhaka
    ]);

    const r = await findFreeTimesTool(deps({ busyTimes }), host, {
      ...tuesday,
      earliest: "13:00",
      latest: "16:00",
      timeZone: null,
    });

    expect(r).toEqual({
      ok: true,
      data: {
        eventType: "intro",
        durationMinutes: 30,
        timeZone: "Asia/Dhaka",
        from: "2026-11-24",
        to: "2026-11-24",
        totalFreeTimes: 5,
        days: [{ date: "2026-11-24", times: ["13:00", "13:30", "14:30", "15:30", "16:00"] }],
        truncated: false,
      },
    });
    // Google is asked about the host, for the searched day plus the usual two-day margin.
    expect(busyTimes).toHaveBeenCalledWith("host", {
      start: new Date("2026-11-21T18:00:00Z"),
      end: new Date("2026-11-26T18:00:00Z"),
    });
  });

  it("searches on another clock when given a timezone (Tuesday 09:00–10:00 in London)", async () => {
    const r = await findFreeTimesTool(deps(), host, {
      ...tuesday,
      earliest: "09:00",
      latest: "10:00",
      timeZone: "Europe/London",
    });
    expect(r.ok && r.data).toMatchObject({
      timeZone: "Europe/London",
      days: [{ date: "2026-11-24", times: ["09:00", "09:30", "10:00"] }],
    });
  });

  it("goes through the booking assistant's checks: dates in the past are refused, not searched", async () => {
    const busyTimes = vi.fn(async () => []);
    const r = await findFreeTimesTool(deps({ busyTimes }), host, {
      eventType: "intro",
      from: "2026-11-01",
      to: "2026-11-02",
      earliest: null,
      latest: null,
      timeZone: null,
    });
    expect(r).toEqual({ ok: false, error: "Those days are in the past. Today is 2026-11-18." });
    expect(busyTimes).not.toHaveBeenCalled();
  });

  it("caps a long list, and says it did", async () => {
    // Two free weeks, every half hour: far more than the cap.
    const r = await findFreeTimesTool(deps(), host, {
      eventType: "intro",
      from: "2026-11-19",
      to: "2026-12-02",
      earliest: null,
      latest: null,
      timeZone: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.truncated).toBe(true);
    expect(r.data.totalFreeTimes).toBeGreaterThan(MAX_LISTED_TIMES);
    expect(r.data.days.flatMap((d) => d.times)).toHaveLength(MAX_LISTED_TIMES);
  });

  it("only knows the caller's own active meeting types", async () => {
    await setupOtherHost();
    const args = { ...tuesday, earliest: null, latest: null, timeZone: null };
    // Grace's slug, asked by Sakif: not found (the host comes from the token, never the input).
    expect(await findFreeTimesTool(deps(), host, { ...args, eventType: "office" })).toEqual({
      ok: false,
      error: 'No active meeting type "office". list_event_types shows the slugs.',
    });
  });

  it("says so when Google Calendar can't be read, instead of showing times that may be busy", async () => {
    const busyTimes = vi.fn(async () => {
      throw new Error("Google down");
    });
    const r = await findFreeTimesTool(deps({ busyTimes }), host, {
      ...tuesday,
      earliest: null,
      latest: null,
      timeZone: null,
    });
    expect(r).toEqual({
      ok: false,
      error: "Your Google Calendar can't be read right now, so free times can't be checked. Try again soon.",
    });
  });
});

describe("list_bookings and get_booking", () => {
  it("lists bookings compactly: no notes, only whether there are any", async () => {
    const { booking } = await book(db, new Date("2026-11-24T08:00:00Z"), LONG_AGO);
    await setupOtherHost();

    const r = await listBookingsTool(deps(), host, { view: "upcoming", limit: null });

    expect(r).toEqual({
      ok: true,
      data: {
        timeZone: "Asia/Dhaka",
        bookings: [
          {
            id: booking.id,
            start: "2026-11-24 14:00",
            end: "2026-11-24 14:30",
            meetingType: "Intro call",
            guestName: "Ada",
            guestEmail: "ada@example.com",
            status: "confirmed",
            hasNotes: true,
            hasBrief: false,
            noShow: false,
            bookedBy: "the guest",
          },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toContain("Private notes"); // and nothing of Grace's
    expect(JSON.stringify(r)).not.toContain("Secret Guest");
  });

  it("lists cancelled bookings with who cancelled", async () => {
    const { booking } = await book(db, new Date("2026-11-24T08:00:00Z"), LONG_AGO);
    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledBy: "guest", cancelledAt: LONG_AGO })
      .where(eq(bookings.id, booking.id));

    const r = await listBookingsTool(deps(), host, { view: "cancelled", limit: 5 });
    expect(r.ok && r.data.bookings).toEqual([
      expect.objectContaining({ id: booking.id, status: "cancelled", cancelledBy: "guest" }),
    ]);
  });

  it("gives one booking in full, with the guest's own words labelled as theirs", async () => {
    const { booking } = await book(db, new Date("2026-11-24T08:00:00Z"), LONG_AGO);

    const r = await getBookingTool(deps(), host, { bookingId: booking.id });

    expect(r).toEqual({
      ok: true,
      data: {
        id: booking.id,
        timeZone: "Asia/Dhaka",
        start: "2026-11-24 14:00",
        end: "2026-11-24 14:30",
        guestTimeZone: "Europe/London",
        meetingType: "Intro call",
        status: "confirmed",
        rescheduled: false,
        noShow: false,
        bookedBy: "the guest",
        guestName: "Ada",
        guestEmail: "ada@example.com",
        meetUrl: null,
        guestWrote: { notes: "Private notes for the host", answers: [] },
        brief: null,
      },
    });
  });

  it("treats another host's booking, and a made-up id, as not found (IDOR)", async () => {
    const gracesBooking = await setupOtherHost();
    const notFound = { ok: false, error: "No booking with that id. list_bookings shows the ids." };

    expect(await getBookingTool(deps(), host, { bookingId: gracesBooking })).toEqual(notFound);
    expect(await getBookingTool(deps(), host, { bookingId: "not-a-uuid" })).toEqual(notFound);
    // Grace herself can read it.
    expect((await getBookingTool(deps(), other, { bookingId: gracesBooking })).ok).toBe(true);
  });
});

describe("every tool call (runTool)", () => {
  const limit = vi.fn(async () => ({ ok: true }) as const);
  const ok = async () => ({ ok: true as const, data: { hello: "world" } });

  it("returns the data as structured content and as JSON text", async () => {
    expect(await runTool({ limit, report: vi.fn() }, host, "bookings:read", ok)).toEqual({
      content: [{ type: "text", text: '{"hello":"world"}' }],
      structuredContent: { hello: "world" },
    });
  });

  it("refuses a token without the tool's scope, before counting or running anything", async () => {
    const tool = vi.fn(ok);
    const limitSpy = vi.fn(limit);
    const writeOnly: Caller = { userId: "host", scopes: new Set(["bookings:write"]) };

    const r = await runTool({ limit: limitSpy, report: vi.fn() }, writeOnly, "bookings:read", tool);

    expect(r).toEqual({
      content: [
        {
          type: "text",
          text: 'This connection wasn\'t given the "bookings:read" permission. Reconnect MeetReady to allow it.',
        },
      ],
      isError: true,
    });
    expect(tool).not.toHaveBeenCalled();
    expect(limitSpy).not.toHaveBeenCalled();
  });

  it("stops at the host's rate limit, with when to try again", async () => {
    const tool = vi.fn(ok);
    const r = await runTool(
      { limit: async () => ({ ok: false, retryAfterSeconds: 300 }), report: vi.fn() },
      host,
      "bookings:read",
      tool,
    );
    expect(r).toMatchObject({
      isError: true,
      content: [{ text: "Too many MeetReady requests. Try again in 5 minutes." }],
    });
    expect(tool).not.toHaveBeenCalled();
  });

  it("reports an unexpected error and answers with a generic message (no internals to the assistant)", async () => {
    const report = vi.fn();
    const r = await runTool({ limit, report }, host, "bookings:read", async () => {
      throw new Error("relation does not exist: secret detail");
    });
    expect(r).toMatchObject({
      isError: true,
      content: [{ text: "Something went wrong in MeetReady. Try again in a minute." }],
    });
    expect(report).toHaveBeenCalledOnce();
  });

  it("refuses when there's no caller at all", async () => {
    expect(await runTool({ limit, report: vi.fn() }, null, "bookings:read", ok)).toMatchObject({
      isError: true,
    });
  });
});

describe("callerFromClaims", () => {
  it("takes the host from `sub`, the scopes from `scope` and the client from `azp`", () => {
    const c = callerFromClaims({
      sub: "host",
      scope: "bookings:read offline_access",
      azp: "https://claude.ai/x",
    });
    expect(c).toEqual({
      userId: "host",
      clientId: "https://claude.ai/x",
      scopes: new Set(["bookings:read", "offline_access"]),
    });
  });

  it("refuses a token without a subject", () => {
    expect(callerFromClaims({ scope: "bookings:read" })).toBeNull();
    expect(callerFromClaims({ sub: "" })).toBeNull();
  });
});

describe("book_meeting (Day 22)", () => {
  const writer: Caller = {
    userId: "host",
    clientId: "https://claude.ai/client",
    scopes: new Set(["bookings:write"]),
  };
  // Thursday 26 Nov, 14:00 in Dhaka = 08:00 UTC. The fixture host is free all day.
  const args = {
    eventType: "intro",
    date: "2026-11-26",
    time: "14:00",
    timeZone: null as string | null,
    guestName: "Ada Lovelace",
    guestEmail: "Ada@Example.com",
    guestTimeZone: "Europe/London" as string | null,
  };
  const noForm = { canAsk: false, answer: null } as const;
  const START = new Date("2026-11-26T08:00:00Z");

  function bookDeps(over: Partial<McpDeps> = {}) {
    const onBooked = vi.fn();
    const bookLimit = vi.fn(async () => ({ ok: true }) as const);
    const calendar = { busyTimes: vi.fn(async () => []) };
    return { d: deps({ onBooked, bookLimit, calendar, ...over }), onBooked, bookLimit, calendar };
  }
  const rows = () => db.select().from(bookings);

  it("books a free time like a guest would, records who made it, and starts the emails job", async () => {
    const { d, onBooked, bookLimit, calendar } = bookDeps();

    const r = await bookMeetingTool(d, writer, args, noForm);

    const [row] = await rows();
    expect(r).toEqual({
      ok: true,
      data: {
        booked: true,
        bookingId: row!.id,
        meetingType: "Intro call",
        start: "2026-11-26 14:00",
        end: "2026-11-26 14:30",
        timeZone: "Asia/Dhaka",
        guestName: "Ada Lovelace",
        guestEmail: "ada@example.com", // normalised like the booking form does
        guestTimeZone: "Europe/London",
        emailed: "Ada Lovelace gets an invitation from MeetReady with a link to reschedule or cancel.",
      },
    });
    expect(row).toMatchObject({
      startsAt: START,
      source: "assistant",
      createdByClient: "https://claude.ai/client",
      answers: [],
      guestNotes: null,
    });
    expect(onBooked).toHaveBeenCalledWith(row!.id);
    expect(bookLimit).toHaveBeenCalledWith("host", "ada@example.com");
    // The booking itself asked Google LIVE, like a guest's booking.
    expect(calendar.busyTimes).toHaveBeenCalledWith("host", expect.anything(), "live");
  });

  it("takes the time on another clock: 08:00 in London is 14:00 in Dhaka", async () => {
    const { d } = bookDeps();
    const r = await bookMeetingTool(d, writer, { ...args, time: "08:00", timeZone: "Europe/London" }, noForm);
    expect(r.ok).toBe(true);
    expect((await rows())[0]?.startsAt).toEqual(START);
  });

  describe("the confirm form, when the client can show one", () => {
    it("asks first, with everything that will happen, and books nothing yet", async () => {
      const { d, onBooked } = bookDeps();
      const r = await bookMeetingTool(d, writer, args, { canAsk: true, answer: null });
      expect(r).toEqual({
        ok: "confirm",
        action: "book",
        message:
          'Book "Intro call" with Ada Lovelace (ada@example.com) on 2026-11-26 14:00 (Asia/Dhaka)? MeetReady will email Ada Lovelace the invitation, with a link to reschedule or cancel.',
      });
      expect(await rows()).toHaveLength(0);
      expect(onBooked).not.toHaveBeenCalled();
    });

    it("books when the person accepted, and not when they declined", async () => {
      const { d } = bookDeps();
      expect(await bookMeetingTool(d, writer, args, { canAsk: true, answer: "declined" })).toEqual({
        ok: true,
        data: { booked: false, reason: "The user declined in the confirmation form." },
      });
      expect(await rows()).toHaveLength(0);
      const r = await bookMeetingTool(d, writer, args, { canAsk: true, answer: "accepted" });
      expect(r.ok === true && r.data.booked).toBe(true);
      expect(await rows()).toHaveLength(1);
    });

    it("doesn't ask about a time that can't be booked anyway", async () => {
      const { d } = bookDeps();
      const r = await bookMeetingTool(
        d,
        writer,
        { ...args, date: "2026-11-01" },
        { canAsk: true, answer: null },
      );
      expect(r.ok).toBe(false);
    });
  });

  it("a retried call returns the booking it already made, instead of failing on its own booking", async () => {
    const { d, onBooked } = bookDeps();
    const first = await bookMeetingTool(d, writer, args, noForm);
    const again = await bookMeetingTool(d, writer, args, noForm);
    const id = first.ok === true && first.data.bookingId;
    expect(again).toEqual({
      ok: true,
      data: {
        booked: true,
        alreadyBooked: true,
        bookingId: id,
        start: "2026-11-26 14:00",
        timeZone: "Asia/Dhaka",
      },
    });
    expect(await rows()).toHaveLength(1);
    expect(onBooked).toHaveBeenCalledTimes(1); // one booking, one set of emails
  });

  it("but the same time for a different guest is simply taken", async () => {
    const { d } = bookDeps();
    await bookMeetingTool(d, writer, args, noForm);
    const r = await bookMeetingTool(d, writer, { ...args, guestEmail: "grace@example.com" }, noForm);
    expect(r).toEqual({
      ok: false,
      error:
        "2026-11-26 14:00 (Asia/Dhaka) isn't free for Intro call: it's outside your hours, too soon, or taken. Use find_free_times.",
    });
  });

  it("follows the same rules as the page: a time busy in Google Calendar isn't booked", async () => {
    const busy = [{ start: new Date("2026-11-26T07:30:00Z"), end: new Date("2026-11-26T09:00:00Z") }];
    const { d } = bookDeps({ busyTimes: vi.fn(async () => busy) });
    const r = await bookMeetingTool(d, writer, args, noForm);
    expect(r.ok).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  it("fails closed when Google can't be read at booking time", async () => {
    const { d } = bookDeps({
      calendar: {
        busyTimes: vi.fn(async () => {
          throw new CalendarUnavailableError("unavailable", "Google down");
        }),
      },
    });
    expect(await bookMeetingTool(d, writer, args, noForm)).toEqual({
      ok: false,
      error: "Your Google Calendar can't be read right now, so nothing was booked. Try again soon.",
    });
    expect(await rows()).toHaveLength(0);
  });

  it("stops at the booking limits, before booking", async () => {
    const { d } = bookDeps({
      bookLimit: vi.fn(async () => ({ ok: false, retryAfterSeconds: 3600 }) as const),
    });
    expect(await bookMeetingTool(d, writer, args, noForm)).toEqual({
      ok: false,
      error: "Too many bookings for now. Try again in 60 minutes.",
    });
    expect(await rows()).toHaveLength(0);
  });

  it("checks what the model sent: date, time, timezones, guest", async () => {
    const { d } = bookDeps();
    const bad = async (over: Partial<typeof args>) => {
      const r = await bookMeetingTool(d, writer, { ...args, ...over }, noForm);
      return r.ok === false ? r.error : "booked?!";
    };
    expect(await bad({ date: "2026-02-30" })).toBe("The date must be a real date in YYYY-MM-DD form.");
    expect(await bad({ time: "2pm" })).toBe("The time must be HH:mm in 24-hour time.");
    expect(await bad({ timeZone: "Mars/Olympus" })).toBe(
      'Unknown timezone "Mars/Olympus". Use an IANA name.',
    );
    expect(await bad({ guestTimeZone: "Nowhere" })).toBe(
      'Unknown guest timezone "Nowhere". Use an IANA name, or null.',
    );
    expect(await bad({ guestEmail: "not-an-email" })).toBe("Check the guest's details: Enter a valid email.");
    expect(await bad({ guestName: "  " })).toBe("Check the guest's details: Enter your name.");
    expect(await rows()).toHaveLength(0);
  });

  it("only books the caller's own meeting types", async () => {
    await setupOtherHost();
    const { d } = bookDeps();
    const r = await bookMeetingTool(d, writer, { ...args, eventType: "office" }, noForm);
    expect(r).toEqual({
      ok: false,
      error: 'No active meeting type "office". list_event_types shows the slugs.',
    });
  });

  it("needs the write permission: a read-only connection can't book", async () => {
    const readOnly: Caller = { userId: "host", scopes: new Set(["bookings:read"]) };
    const { d } = bookDeps();
    const r = await runTool({ ...d, report: vi.fn() }, readOnly, "bookings:write", () =>
      bookMeetingTool(d, readOnly, args, noForm),
    );
    expect(r).toMatchObject({ isError: true });
    expect(await rows()).toHaveLength(0);
  });

  it("turns 'ask first' into an MCP confirm form", async () => {
    const r = await runTool(
      { limit: async () => ({ ok: true }), report: vi.fn() },
      writer,
      "bookings:write",
      async () => ({
        ok: "confirm" as const,
        action: "book" as const,
        message: "Book it?",
      }),
    );
    expect(r).toMatchObject({
      resultType: "input_required",
      inputRequests: { confirm: { method: "elicitation/create", params: { message: "Book it?" } } },
    });
  });
});

describe("confirm forms: who can show one, and what the answer was", () => {
  const caps = (c: unknown) => ({ "io.modelcontextprotocol/clientCapabilities": c });

  it("only on the 2026-07-28 protocol, and only for clients that declared a form", () => {
    expect(canShowForm("modern", caps({ elicitation: { form: {} } }))).toBe(true);
    expect(canShowForm("modern", caps({ elicitation: {} }))).toBe(true); // the older way of saying "form"
    expect(canShowForm("modern", caps({ elicitation: { url: {} } }))).toBe(false); // URL-only can't show a form
    expect(canShowForm("modern", caps({}))).toBe(false);
    expect(canShowForm("modern", undefined)).toBe(false);
    // 2025-era: each request is a fresh server, so there's nothing to come back to.
    expect(canShowForm("legacy", caps({ elicitation: { form: {} } }))).toBe(false);
  });

  it("reads accept only when the box was ticked; anything else is a no", () => {
    const answer = (r: unknown) => confirmationAnswer({ confirm: r });
    expect(answer({ action: "accept", content: { book: true } })).toBe("accepted");
    expect(answer({ action: "accept", content: { book: false } })).toBe("declined");
    expect(answer({ action: "accept", content: { book: "yes" } })).toBe("declined"); // not a real boolean
    expect(answer({ action: "decline" })).toBe("declined");
    expect(answer({ action: "cancel" })).toBe("declined");
    expect(confirmationAnswer(undefined)).toBeNull(); // not asked yet
  });
});
