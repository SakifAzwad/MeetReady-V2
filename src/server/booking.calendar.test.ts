import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import type { Interval } from "@/lib/scheduling/intervals";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveWeeklySchedule } from "./availability";
import { busyLoadRange, createBooking, getBookableSlots, getPublicEventType } from "./booking";
import type { ExternalBusy } from "./calendar/busy";
import { CalendarUnavailableError } from "./calendar/google-api";
import { createEventType } from "./event-types";
import { getBookingByToken, rescheduleBookingByToken } from "./manage-booking";
import { suggestTimes } from "./share";

/*
 * Day 15: the host's Google Calendar inside booking, with a fake calendar.
 * Host in Dhaka, Monday 9 Nov 2026 09:00–12:00 = 03:00–06:00 UTC, 30-minute slots.
 */

const NOW = new Date("2026-11-01T00:00:00Z");
const MONDAY = { start: new Date("2026-11-08T18:00:00Z"), end: new Date("2026-11-09T18:00:00Z") };
const at = (utc: string) => new Date(`2026-11-09T${utc}:00Z`);
const times = (slots: Interval[]) => slots.map((s) => s.start.toISOString().slice(11, 16));

const request = (utc: string) => ({
  username: "alice",
  slug: "intro",
  guestName: "Guest",
  guestEmail: "guest@example.com",
  guestTimeZone: "Europe/London",
  guestNotes: "",
  startsAt: at(utc),
});

/** A fake host calendar with one meeting, 04:00–05:00 UTC. */
const meeting = { start: at("04:00"), end: at("05:00") };
const calendarWith = (busy: Interval[]) => {
  const busyTimes = vi.fn<ExternalBusy["busyTimes"]>(async () => busy);
  return { busyTimes };
};
const brokenCalendar = () => ({
  busyTimes: vi.fn<ExternalBusy["busyTimes"]>(async () => {
    throw new CalendarUnavailableError("unavailable", "Google timed out");
  }),
});

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(user).values({
    id: "alice",
    name: "Alice",
    email: "alice@example.com",
    username: "alice",
    timeZone: "Asia/Dhaka",
  });
  await saveWeeklySchedule(db, "alice", {
    timeZone: "Asia/Dhaka",
    rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "12:00" })),
  });
  const r = await createEventType(
    db,
    "alice",
    eventTypeSchema.parse({
      ...EVENT_TYPE_DEFAULTS,
      title: "Intro",
      slug: "intro",
      durationMinutes: 30,
      minimumNoticeMinutes: 0,
      bookingWindowDays: null,
      bufferAfterMinutes: 15,
      maxBookingsPerDay: 1,
    }),
  );
  if (!r.ok) throw new Error("setup failed");
}, 30_000);

describe("busy times from the host's calendar", () => {
  it("block the slots they overlap, and the new meeting's own buffer keeps a gap before them", async () => {
    const et = (await getPublicEventType(db, "alice", "intro"))!;
    const slots = await getBookableSlots(db, et, MONDAY, NOW, { externalBusy: [meeting] });
    // 03:30 + 30 min + 15 min buffer would run into 04:00, so it goes too. Free again from 05:00.
    expect(times(slots)).toEqual(["03:00", "05:00", "05:30"]);
  });

  it("never count towards the daily booking limit (they aren't MeetReady bookings)", async () => {
    const et = (await getPublicEventType(db, "alice", "intro"))!;
    const slots = await getBookableSlots(db, et, MONDAY, NOW, { externalBusy: [meeting] });
    expect(slots.length).toBeGreaterThan(0); // limit is 1 per day, and one meeting is busy
  });

  it("busyLoadRange covers the same margin the database load uses (2 days each side)", () => {
    expect(busyLoadRange(MONDAY)).toEqual({
      start: new Date("2026-11-06T18:00:00Z"),
      end: new Date("2026-11-11T18:00:00Z"),
    });
  });
});

describe("createBooking with a calendar", () => {
  it("asks the calendar LIVE, for the host, around the requested time", async () => {
    const calendar = calendarWith([]);
    const result = await createBooking(db, request("03:00"), NOW, { calendar });
    expect(result.ok).toBe(true);
    expect(calendar.busyTimes).toHaveBeenCalledWith(
      "alice",
      busyLoadRange({ start: at("03:00"), end: at("03:01") }),
      "live",
    );
  });

  it("refuses a time that's busy in the host's calendar", async () => {
    expect(await createBooking(db, request("04:30"), NOW, { calendar: calendarWith([meeting]) })).toEqual({
      ok: false,
      error: "slot_unavailable",
    });
  });

  it("fails CLOSED: calendar unreachable means no booking, and a clear reason", async () => {
    expect(await createBooking(db, request("03:00"), NOW, { calendar: brokenCalendar() })).toEqual({
      ok: false,
      error: "calendar_unavailable",
    });
    expect(await db.select().from(bookings)).toEqual([]);
  });

  it("an unknown page is not_found without asking the calendar", async () => {
    const calendar = calendarWith([]);
    expect(await createBooking(db, { ...request("03:00"), slug: "nope" }, NOW, { calendar })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(calendar.busyTimes).not.toHaveBeenCalled();
  });
});

describe("rescheduling with a calendar", () => {
  async function booked() {
    const result = await createBooking(db, request("03:00"), NOW);
    if (!result.ok) throw new Error("setup failed");
    return result.manageToken;
  }

  it("refuses a new time that's busy in the host's calendar", async () => {
    const token = await booked();
    // Next day 03:00 UTC is free in MeetReady but busy in Google.
    const tuesday = new Date("2026-11-10T03:00:00Z");
    const calendar = calendarWith([{ start: tuesday, end: new Date("2026-11-10T04:00:00Z") }]);
    expect(await rescheduleBookingByToken(db, token, tuesday, NOW, { calendar })).toEqual({
      ok: false,
      error: "slot_unavailable",
    });
  });

  it("fails closed, and leaves the booking where it was", async () => {
    const token = await booked();
    const tuesday = new Date("2026-11-10T03:00:00Z");
    expect(await rescheduleBookingByToken(db, token, tuesday, NOW, { calendar: brokenCalendar() })).toEqual({
      ok: false,
      error: "calendar_unavailable",
    });
    expect((await getBookingByToken(db, token))?.startsAt).toEqual(at("03:00"));
  });

  it("asks for the right host, and moves the booking when the calendar is free", async () => {
    const token = await booked();
    const calendar = calendarWith([]);
    const tuesday = new Date("2026-11-10T03:00:00Z");
    expect(await rescheduleBookingByToken(db, token, tuesday, NOW, { calendar })).toMatchObject({ ok: true });
    expect(calendar.busyTimes.mock.calls[0]?.[0]).toBe("alice");
    expect(calendar.busyTimes.mock.calls[0]?.[2]).toBe("live");
  });
});

describe("share times with a calendar", () => {
  const ALICE = { id: "alice", username: "alice" };
  const eventTypeId = async () =>
    (await db.select({ id: bookings.eventTypeId }).from(bookings).limit(1))[0]?.id ??
    (await getPublicEventType(db, "alice", "intro"))!.id;

  it("uses the cached copy, and skips times busy in the calendar", async () => {
    const calendar = calendarWith([meeting]);
    const r = await suggestTimes(db, ALICE, await eventTypeId(), "Asia/Dhaka", NOW, calendar);
    expect(r.ok).toBe(true);
    expect(calendar.busyTimes.mock.calls[0]?.[2]).toBe("cached");
    if (r.ok) {
      for (const s of r.slots) expect(s.start < meeting.end && s.end > meeting.start).toBe(false);
    }
  });

  it("says so when the calendar can't be read, instead of suggesting times that may clash", async () => {
    const r = await suggestTimes(db, ALICE, await eventTypeId(), "Asia/Dhaka", NOW, brokenCalendar());
    expect(r).toEqual({ ok: false, error: "calendar_unavailable" });
  });
});

it("without a calendar, booking works exactly as before (the option is additive)", async () => {
  const result = await createBooking(db, request("04:00"), NOW);
  expect(result.ok).toBe(true);
  const [row] = await db.select().from(bookings).where(eq(bookings.guestEmail, "guest@example.com"));
  expect(row?.startsAt).toEqual(at("04:00"));
});
