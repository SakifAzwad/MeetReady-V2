import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { bookings, eventTypes, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveDateOverride, saveWeeklySchedule } from "./availability";
import { createBooking, getBookableSlots, getPublicEventType, getPublicProfile } from "./booking";
import { createEventType, setEventTypeActive } from "./event-types";

// Host in Dhaka (UTC+6). Monday 9 Nov 2026, 09:00–12:00 Dhaka = 03:00–06:00 UTC.
const NOW = new Date("2026-11-01T00:00:00Z");
const MONDAY = { start: new Date("2026-11-08T18:00:00Z"), end: new Date("2026-11-09T18:00:00Z") }; // Monday, Dhaka
const at = (utcTime: string) => new Date(`2026-11-09T${utcTime}:00Z`);

const guest = {
  username: "alice",
  slug: "intro",
  guestName: "Guest",
  guestEmail: "guest@example.com",
  guestTimeZone: "Europe/London",
  guestNotes: "",
};
const request = (utcTime: string, extra: Partial<typeof guest> = {}) => ({
  ...guest,
  ...extra,
  startsAt: at(utcTime),
});

async function addEventType(db: Database, userId: string, overrides: Partial<typeof EVENT_TYPE_DEFAULTS>) {
  const result = await createEventType(
    db,
    userId,
    eventTypeSchema.parse({
      ...EVENT_TYPE_DEFAULTS,
      minimumNoticeMinutes: 0,
      bookingWindowDays: null,
      ...overrides,
    }),
  );
  if (!result.ok) throw new Error("setup failed");
  return result.id;
}

describe("public booking", () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(user).values([
      { id: "alice", name: "Alice", email: "alice@example.com", username: "alice", timeZone: "Asia/Dhaka" },
      { id: "newbie", name: "Newbie", email: "new@example.com" }, // not onboarded
    ]);
    await saveWeeklySchedule(db, "alice", {
      timeZone: "Asia/Dhaka",
      rules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "12:00" }],
    });
    await addEventType(db, "alice", { title: "Intro", slug: "intro", durationMinutes: 30 });
  }, 30_000);

  describe("finding the event type from the URL", () => {
    it("finds an active event type, case-insensitively, without exposing the host's email", async () => {
      const et = await getPublicEventType(db, "ALICE", "Intro");
      expect(et).toMatchObject({ title: "Intro", username: "alice", hostTimeZone: "Asia/Dhaka" });
      expect(JSON.stringify(et)).not.toContain("alice@example.com");
    });

    it("hides switched-off event types and unknown or un-onboarded hosts", async () => {
      const [row] = await db.select().from(eventTypes).where(eq(eventTypes.slug, "intro"));
      await setEventTypeActive(db, "alice", row!.id, false);
      expect(await getPublicEventType(db, "alice", "intro")).toBeNull();
      expect(await getPublicEventType(db, "nobody", "intro")).toBeNull();
      expect(await getPublicProfile(db, "newbie")).toBeNull();
    });

    it("profile lists only active event types", async () => {
      const id = await addEventType(db, "alice", { title: "Hidden", slug: "hidden" });
      await setEventTypeActive(db, "alice", id, false);
      const profile = await getPublicProfile(db, "alice");
      expect(profile?.eventTypes.map((e) => e.slug)).toEqual(["intro"]);
    });
  });

  it("turns DB availability into slots (host's Monday 9–12 Dhaka = 03:00–06:00 UTC)", async () => {
    const et = (await getPublicEventType(db, "alice", "intro"))!;
    const slots = await getBookableSlots(db, et, MONDAY, NOW);
    expect(slots.map((s) => s.start.toISOString().slice(11, 16))).toEqual([
      "03:00",
      "03:30",
      "04:00",
      "04:30",
      "05:00",
      "05:30",
    ]);
  });

  describe("createBooking", () => {
    it("books an offered slot, stores the right end time, and removes it from the slots", async () => {
      const result = await createBooking(db, request("04:00"), NOW);
      expect(result).toMatchObject({ ok: true, booking: { startsAt: at("04:00"), endsAt: at("04:30") } });

      const et = (await getPublicEventType(db, "alice", "intro"))!;
      const slots = await getBookableSlots(db, et, MONDAY, NOW);
      expect(slots.map((s) => s.start.toISOString())).not.toContain(at("04:00").toISOString());
    });

    it.each([
      ["already booked", "04:00", true],
      ["not on the slot grid", "04:10", false],
      ["outside working hours", "07:00", false],
    ])("rejects a start that isn't offered: %s", async (_name, time, bookFirst) => {
      if (bookFirst) await createBooking(db, request(time), NOW);
      expect(await createBooking(db, request(time), NOW)).toEqual({ ok: false, error: "slot_unavailable" });
    });

    it("rejects a slot in the past", async () => {
      expect(await createBooking(db, request("04:00"), new Date("2026-11-09T05:00:00Z"))).toEqual({
        ok: false,
        error: "slot_unavailable",
      });
    });

    it("respects another event type's booking and its buffer", async () => {
      await addEventType(db, "alice", {
        title: "Deep",
        slug: "deep",
        durationMinutes: 60,
        bufferAfterMinutes: 30,
      });
      expect((await createBooking(db, request("03:00", { slug: "deep" }), NOW)).ok).toBe(true); // 03:00–04:00 + 30 buffer
      expect(await createBooking(db, request("04:00"), NOW)).toEqual({
        ok: false,
        error: "slot_unavailable",
      });
      expect((await createBooking(db, request("04:30"), NOW)).ok).toBe(true);
    });

    it("enforces max bookings per day", async () => {
      await addEventType(db, "alice", { title: "Limited", slug: "limited", maxBookingsPerDay: 1 });
      expect((await createBooking(db, request("03:00", { slug: "limited" }), NOW)).ok).toBe(true);
      expect(await createBooking(db, request("05:00", { slug: "limited" }), NOW)).toEqual({
        ok: false,
        error: "slot_unavailable",
      });
    });

    it("respects a date override (day off)", async () => {
      await saveDateOverride(db, "alice", { date: "2026-11-09", available: false, ranges: [] });
      expect(await createBooking(db, request("04:00"), NOW)).toEqual({
        ok: false,
        error: "slot_unavailable",
      });
    });

    it("a cancelled booking frees the slot", async () => {
      const first = await createBooking(db, request("04:00"), NOW);
      if (!first.ok) throw new Error("setup failed");
      await db
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(bookings.id, first.booking.id));
      expect((await createBooking(db, request("04:00"), NOW)).ok).toBe(true);
    });

    it("returns not_found for a switched-off event type", async () => {
      const [row] = await db.select().from(eventTypes).where(eq(eventTypes.slug, "intro"));
      await setEventTypeActive(db, "alice", row!.id, false);
      expect(await createBooking(db, request("04:00"), NOW)).toEqual({ ok: false, error: "not_found" });
    });
  });
});
