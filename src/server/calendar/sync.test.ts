import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { account, bookings, calendarConnections, eventTypes, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveWeeklySchedule } from "../availability";
import { createBooking } from "../booking";
import { notifyBookingConfirmed } from "../email/notifications";
import { createMemorySender } from "../email/sender";
import { createEventType } from "../event-types";
import { cancelBookingAsHost, rescheduleBookingByToken } from "../manage-booking";
import type { ExternalBusy } from "./busy";
import { CalendarUnavailableError, googleEventId } from "./google-api";
import { createCalendarSync, type CalendarSyncDeps, type CalendarWriter } from "./sync";

/*
 * Day 16: writing bookings to the host's Google Calendar, with a fake writer
 * on a real (in-memory) Postgres. Host in Dhaka, Monday 9 Nov 2026,
 * 09:00–17:00 = 03:00–11:00 UTC.
 */

const NOW = new Date("2026-11-01T00:00:00Z");
const APP = "https://meetready.test";
const MEET = "https://meet.google.com/abc-defg-hij";
const at = (utc: string) => new Date(`2026-11-09T${utc}:00Z`);

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values({
    id: "host",
    name: "Sakif Azwad",
    email: "sakif@example.com",
    username: "sakif",
    timeZone: "Asia/Dhaka",
  });
  await saveWeeklySchedule(db, "host", {
    timeZone: "Asia/Dhaka",
    rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" })),
  });
  for (const [slug, durationMinutes, locationType] of [
    ["intro", 30, "google_meet"],
    ["long", 60, "zoom"],
  ] as const) {
    const r = await createEventType(
      db,
      "host",
      eventTypeSchema.parse({
        ...EVENT_TYPE_DEFAULTS,
        title: slug === "intro" ? "Intro call" : "Deep dive",
        slug,
        durationMinutes,
        slotIntervalMinutes: 30,
        locationType,
        locationValue: locationType === "zoom" ? "https://us05web.zoom.us/j/123" : "",
        minimumNoticeMinutes: 0,
        bookingWindowDays: null,
      }),
    );
    if (!r.ok) throw new Error("setup failed");
  }
  await db.insert(account).values({ id: "acc", accountId: "sub", providerId: "google", userId: "host" });
}, 30_000);

const connect = () => db.insert(calendarConnections).values({ userId: "host", accountId: "acc" });

async function book(slug = "intro", startsAt = at("04:00")) {
  const r = await createBooking(
    db,
    {
      username: "sakif",
      slug,
      startsAt,
      guestName: "Ada",
      guestEmail: "ada@example.com",
      guestTimeZone: "Europe/London",
      guestNotes: "Private notes for the host",
    },
    NOW,
  );
  if (!r.ok) throw new Error(`setup failed: ${r.error}`);
  return r;
}

function setup(writer: Partial<CalendarWriter> = {}, extra: Partial<CalendarSyncDeps> = {}) {
  const upsertEvent = vi.fn<CalendarWriter["upsertEvent"]>(async () => ({ meetUrl: MEET }));
  const deleteEvent = vi.fn<CalendarWriter["deleteEvent"]>(async () => {});
  const report = vi.fn();
  const sync = createCalendarSync({
    db,
    appUrl: APP,
    getAccessToken: async () => "token",
    writer: { upsertEvent, deleteEvent, ...writer },
    report,
    ...extra,
  });
  return { sync, upsertEvent, deleteEvent, report };
}

const row = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0]!;

describe("syncBooking", () => {
  it("no calendar connected: nothing is written, nothing is marked", async () => {
    const { booking } = await book();
    const { sync, upsertEvent } = setup();
    expect(await sync.syncBooking(booking.id)).toBe("skipped");
    expect(upsertEvent).not.toHaveBeenCalled();
    expect((await row(booking.id)).calendarSync).toBeNull();
  });

  it("a new booking becomes an event with a Meet link, and the booking remembers both", async () => {
    await connect();
    const { booking } = await book();
    const { sync, upsertEvent } = setup();
    expect(await sync.syncBooking(booking.id)).toBe("synced");

    const call = upsertEvent.mock.calls[0]![0];
    expect(call).toMatchObject({ accessToken: "token", calendarId: "primary", exists: false });
    expect(call.event).toMatchObject({
      bookingId: booking.id,
      summary: "Intro call with Ada",
      start: at("04:00"),
      end: at("04:30"),
      withMeet: true,
    });
    expect(await row(booking.id)).toMatchObject({
      calendarEventId: googleEventId(booking.id),
      meetUrl: MEET,
      calendarSync: "synced",
    });
  });

  it("the event says who the guest is, and nothing they told only the host", async () => {
    await connect();
    const { booking } = await book();
    const { sync, upsertEvent } = setup();
    await sync.syncBooking(booking.id);
    const { description } = upsertEvent.mock.calls[0]![0].event;
    expect(description).toContain("Ada (ada@example.com)");
    expect(description).toContain(`${APP}/dashboard/bookings`);
    expect(description).not.toContain("Private notes"); // notes and answers stay in MeetReady
  });

  it("Zoom event types get no Meet, and their link goes in the event's location", async () => {
    await connect();
    const { booking } = await book("long", at("05:00"));
    const { sync, upsertEvent } = setup();
    await sync.syncBooking(booking.id);
    expect(upsertEvent.mock.calls[0]![0].event).toMatchObject({
      withMeet: false,
      location: "https://us05web.zoom.us/j/123",
    });
  });

  it("running it again updates the same event (exists: true), and keeps the Meet link", async () => {
    await connect();
    const { booking } = await book();
    const first = setup();
    await first.sync.syncBooking(booking.id);
    const upsertEvent = vi.fn<CalendarWriter["upsertEvent"]>(async () => ({ meetUrl: null }));
    await setup({ upsertEvent }).sync.syncBooking(booking.id);
    expect(upsertEvent.mock.calls[0]![0].exists).toBe(true);
    expect((await row(booking.id)).meetUrl).toBe(MEET);
  });

  it("a cancelled booking's event is deleted", async () => {
    await connect();
    const { booking } = await book();
    const { sync, deleteEvent } = setup();
    await sync.syncBooking(booking.id);
    await cancelBookingAsHost(db, "host", booking.id, null, NOW);
    expect(await sync.syncBooking(booking.id)).toBe("synced");
    expect(deleteEvent).toHaveBeenCalledWith({
      accessToken: "token",
      calendarId: "primary",
      bookingId: booking.id,
    });
  });

  it("Google failing: the booking stands, is marked failed, and Sentry hears about it", async () => {
    await connect();
    const { booking } = await book();
    const error = new CalendarUnavailableError("unavailable", "503");
    const { sync, report } = setup({ upsertEvent: vi.fn(async () => Promise.reject(error)) });
    expect(await sync.syncBooking(booking.id)).toBe("failed");
    expect(await row(booking.id)).toMatchObject({
      status: "confirmed",
      calendarSync: "failed",
      meetUrl: null,
    });
    expect(report).toHaveBeenCalledWith(error, booking.id);
  });

  it("a token that can't be had is a failure too", async () => {
    await connect();
    const { booking } = await book();
    const { sync } = setup({}, { getAccessToken: async () => Promise.reject(new Error("revoked")) });
    expect(await sync.syncBooking(booking.id)).toBe("failed");
  });

  it("Retry after a failure: synced, and the flag clears", async () => {
    await connect();
    const { booking } = await book();
    await setup({ upsertEvent: vi.fn(async () => Promise.reject(new Error("down"))) }).sync.syncBooking(
      booking.id,
    );
    expect(await setup().sync.syncBooking(booking.id)).toBe("synced");
    expect((await row(booking.id)).calendarSync).toBe("synced");
  });

  it("never throws, whatever breaks (the emails come after it)", async () => {
    const { sync, report } = setup();
    const brokenDb = {
      ...db,
      select: () => {
        throw new Error("db down");
      },
    } as unknown as Database;
    const s2 = createCalendarSync({
      db: brokenDb,
      appUrl: APP,
      getAccessToken: async () => "t",
      writer: { upsertEvent: vi.fn(), deleteEvent: vi.fn() },
      report,
    });
    await expect(s2.syncBooking("6f9619ff-8b86-4d01-b42d-00cf4fc964ff")).resolves.toBe("failed");
    expect(await sync.syncBooking("not-a-booking")).toBe("skipped");
  });
});

describe("rescheduling past the booking's own event", () => {
  /** A fake host calendar that, like Google, includes our own events in free/busy. */
  const calendarWith = (busy: { start: Date; end: Date }[]): ExternalBusy => ({
    busyTimes: async () => busy,
  });

  it("the booking's own event doesn't block a move that overlaps its old time", async () => {
    await connect();
    const { manageToken } = await book("long", at("05:00")); // 05:00–06:00
    // Google reports the booking's own event as busy.
    const calendar = calendarWith([{ start: at("05:00"), end: at("06:00") }]);
    expect(await rescheduleBookingByToken(db, manageToken, at("05:30"), NOW, { calendar })).toMatchObject({
      ok: true,
    });
  });

  it("…but a real meeting merged into the same busy block still blocks", async () => {
    await connect();
    const { manageToken } = await book("long", at("05:00")); // 05:00–06:00
    // Own event 05:00–06:00 + another meeting 06:00–07:00, merged by free/busy into one block.
    const calendar = calendarWith([{ start: at("05:00"), end: at("07:00") }]);
    expect(await rescheduleBookingByToken(db, manageToken, at("05:30"), NOW, { calendar })).toEqual({
      ok: false,
      error: "slot_unavailable",
    });
  });
});

describe("emails once the booking is in Google Calendar", () => {
  const sentBy = () => {
    const sender = createMemorySender();
    return { sent: sender.sent, ctx: { db, sender, appUrl: APP, now: NOW } };
  };

  it("carry the Meet link, and the host's has no .ics (the event is already in their calendar)", async () => {
    await connect();
    const { booking, manageToken } = await book();
    await setup().sync.syncBooking(booking.id);
    const { sent, ctx } = sentBy();
    await notifyBookingConfirmed(ctx, booking.id, manageToken);

    const guest = sent.find((m) => m.to === "ada@example.com")!;
    const host = sent.find((m) => m.to === "sakif@example.com")!;
    expect(guest.text).toContain(MEET);
    expect(guest.ics?.content).toContain(MEET);
    expect(host.text).toContain(MEET);
    expect(host.ics).toBeUndefined();
  });

  it("without a synced calendar, both still get the .ics, and Meet says the link is to follow", async () => {
    const { booking, manageToken } = await book();
    const { sent, ctx } = sentBy();
    await notifyBookingConfirmed(ctx, booking.id, manageToken);
    expect(sent).toHaveLength(2);
    for (const m of sent) {
      expect(m.ics).toBeDefined();
      expect(m.text).toContain("Google Meet (link to follow)");
    }
  });
});

it("the event types used here are the ones from setup (guards the fixtures)", async () => {
  expect((await db.select({ slug: eventTypes.slug }).from(eventTypes)).map((e) => e.slug).sort()).toEqual([
    "intro",
    "long",
  ]);
});
