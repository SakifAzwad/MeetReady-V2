import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { bookings, eventTypes, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveWeeklySchedule } from "./availability";
import { createBooking, getBookableSlots, getPublicEventType } from "./booking";
import { createEventType, setEventTypeActive } from "./event-types";
import {
  cancelBookingAsHost,
  cancelBookingByToken,
  getBookingByToken,
  listHostBookings,
  listHostBookingsBetween,
  rescheduleBookingByToken,
} from "./manage-booking";
import { hashManageToken } from "./manage-token";

const NOW = new Date("2026-11-01T00:00:00Z");
const at = (t: string) => new Date(`2026-11-09T${t}:00Z`); // Monday; host in UTC, 09:00–17:00
const MONDAY = { start: at("00:00"), end: new Date("2026-11-10T00:00:00Z") };

const request = (slug: string, time: string, guest = "guest") => ({
  username: "alice",
  slug,
  startsAt: at(time),
  guestName: guest,
  guestEmail: `${guest}@example.com`,
  guestTimeZone: "Europe/London",
  guestNotes: "",
});

describe("managing bookings", () => {
  let db: Database;

  async function book(slug: string, time: string, guest = "guest") {
    const r = await createBooking(db, request(slug, time, guest), NOW);
    if (!r.ok) throw new Error(`setup booking failed: ${r.error}`);
    return r;
  }
  const freeTimes = async (slug = "intro") => {
    const et = (await getPublicEventType(db, "alice", slug))!;
    return (await getBookableSlots(db, et, MONDAY, NOW)).map((s) => s.start.toISOString().slice(11, 16));
  };

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(user).values([
      { id: "alice", name: "Alice", email: "alice@example.com", username: "alice" },
      { id: "bob", name: "Bob", email: "bob@example.com", username: "bob" },
    ]);
    await saveWeeklySchedule(db, "alice", {
      timeZone: "UTC",
      rules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    });
    for (const o of [
      { title: "Intro", slug: "intro", durationMinutes: 30 },
      { title: "Long", slug: "long", durationMinutes: 60, slotIntervalMinutes: 30 },
    ]) {
      const r = await createEventType(
        db,
        "alice",
        eventTypeSchema.parse({
          ...EVENT_TYPE_DEFAULTS,
          minimumNoticeMinutes: 0,
          bookingWindowDays: null,
          ...o,
        }),
      );
      if (!r.ok) throw new Error("setup failed");
    }
  }, 30_000);

  describe("manage tokens", () => {
    it("returns a 43-char token once and stores only its SHA-256", async () => {
      const { manageToken, booking } = await book("intro", "10:00");
      expect(manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
      expect(row?.manageTokenHash).toBe(hashManageToken(manageToken));
      expect(JSON.stringify(row)).not.toContain(manageToken);
    });

    it("finds the booking by token; wrong or malformed tokens find nothing", async () => {
      const { manageToken, booking } = await book("intro", "10:00");
      expect((await getBookingByToken(db, manageToken))?.id).toBe(booking.id);
      expect(await getBookingByToken(db, "A".repeat(43))).toBeNull();
      expect(await getBookingByToken(db, "short")).toBeNull();
      expect(await getBookingByToken(db, `${manageToken}' OR '1'='1`)).toBeNull();
    });

    it("each booking gets a different token", async () => {
      const a = await book("intro", "10:00", "a");
      const b = await book("intro", "11:00", "b");
      expect(a.manageToken).not.toBe(b.manageToken);
    });
  });

  describe("guest cancels", () => {
    it("cancels, frees the slot, records who and why, bumps the invite sequence", async () => {
      const { manageToken } = await book("intro", "10:00");
      expect(await freeTimes()).not.toContain("10:00");

      const r = await cancelBookingByToken(db, manageToken, "Something came up", NOW);
      expect(r.ok).toBe(true);
      const b = await getBookingByToken(db, manageToken);
      expect(b).toMatchObject({
        status: "cancelled",
        cancelledBy: "guest",
        cancellationReason: "Something came up",
        sequence: 1,
      });
      expect(await freeTimes()).toContain("10:00");
    });

    it("can't cancel twice, or after the meeting has started", async () => {
      const first = await book("intro", "10:00", "a");
      await cancelBookingByToken(db, first.manageToken, null, NOW);
      expect(await cancelBookingByToken(db, first.manageToken, null, NOW)).toEqual({
        ok: false,
        error: "not_changeable",
      });

      const second = await book("intro", "11:00", "b");
      expect(await cancelBookingByToken(db, second.manageToken, null, at("11:10"))).toEqual({
        ok: false,
        error: "not_changeable",
      });
    });

    it("reports an unknown token as not found", async () => {
      expect(await cancelBookingByToken(db, "B".repeat(43), null, NOW)).toEqual({
        ok: false,
        error: "not_found",
      });
    });
  });

  describe("guest reschedules", () => {
    it("moves the booking, keeps its id and link, frees the old time", async () => {
      const { manageToken, booking } = await book("intro", "10:00");
      const r = await rescheduleBookingByToken(db, manageToken, at("14:00"), NOW);
      expect(r).toEqual({ ok: true, bookingId: booking.id, previousStartsAt: at("10:00"), sequence: 1 });

      const moved = await getBookingByToken(db, manageToken);
      expect(moved).toMatchObject({
        id: booking.id,
        startsAt: at("14:00"),
        endsAt: at("14:30"),
        sequence: 1,
      });
      const free = await freeTimes();
      expect(free).toContain("10:00");
      expect(free).not.toContain("14:00");
    });

    it("can move a meeting into a time that overlaps its own old time", async () => {
      // 10:00–11:00 -> 10:30–11:30: overlaps itself, which is fine.
      const { manageToken } = await book("long", "10:00");
      expect((await rescheduleBookingByToken(db, manageToken, at("10:30"), NOW)).ok).toBe(true);
    });

    it("can't move into someone else's booking or outside working hours", async () => {
      await book("intro", "14:00", "other");
      const { manageToken } = await book("intro", "10:00");
      expect(await rescheduleBookingByToken(db, manageToken, at("14:00"), NOW)).toEqual({
        ok: false,
        error: "slot_unavailable",
      });
      expect(await rescheduleBookingByToken(db, manageToken, at("18:00"), NOW)).toEqual({
        ok: false,
        error: "slot_unavailable",
      });
    });

    it("can't move a cancelled or started booking, or one whose event type was switched off", async () => {
      const a = await book("intro", "10:00", "a");
      await cancelBookingByToken(db, a.manageToken, null, NOW);
      expect(await rescheduleBookingByToken(db, a.manageToken, at("15:00"), NOW)).toEqual({
        ok: false,
        error: "not_changeable",
      });

      const b = await book("intro", "11:00", "b");
      expect(await rescheduleBookingByToken(db, b.manageToken, at("15:00"), at("11:05"))).toEqual({
        ok: false,
        error: "not_changeable",
      });

      const [et] = await db.select().from(eventTypes).where(eq(eventTypes.slug, "intro"));
      await setEventTypeActive(db, "alice", et!.id, false);
      expect(await rescheduleBookingByToken(db, b.manageToken, at("15:00"), NOW)).toEqual({
        ok: false,
        error: "not_changeable",
      });
    });
  });

  describe("host", () => {
    it("lists upcoming, past and cancelled bookings separately", async () => {
      await book("intro", "10:00", "past");
      await book("intro", "15:00", "upcoming");
      const c = await book("intro", "16:00", "cancelled");
      await cancelBookingByToken(db, c.manageToken, null, NOW);
      const later = at("12:00");

      const names = async (view: "upcoming" | "past" | "cancelled") =>
        (await listHostBookings(db, "alice", view, later)).map((b) => b.guestName);
      expect(await names("upcoming")).toEqual(["upcoming"]);
      expect(await names("past")).toEqual(["past"]);
      expect(await names("cancelled")).toEqual(["cancelled"]);
    });

    it("cancels their own booking", async () => {
      const { booking, manageToken } = await book("intro", "10:00");
      expect(await cancelBookingAsHost(db, "alice", booking.id, "Ill", NOW)).toEqual({
        ok: true,
        sequence: 1,
      });
      expect(await getBookingByToken(db, manageToken)).toMatchObject({
        status: "cancelled",
        cancelledBy: "host",
      });
    });

    it("lists confirmed bookings overlapping a range, for the week view", async () => {
      await book("intro", "10:00", "inside");
      await book("intro", "11:00", "edge"); // 11:00–11:30
      await book("intro", "16:30", "overlaps-end");
      const c = await book("intro", "14:00", "cancelled");
      await cancelBookingByToken(db, c.manageToken, null, NOW);

      const range = { start: at("09:30"), end: at("16:45") };
      const found = (await listHostBookingsBetween(db, "alice", range)).map((b) =>
        b.startsAt.toISOString().slice(11, 16),
      );
      // 10:00 inside; 16:30–17:00 overlaps the end; cancelled and other hosts never appear.
      expect(found).toEqual(["10:00", "11:00", "16:30"]);
      // Half-open ranges: a meeting ending at 11:30 doesn't touch a range starting at 11:30.
      expect(await listHostBookingsBetween(db, "alice", { start: at("11:30"), end: at("12:00") })).toEqual(
        [],
      );
      expect(await listHostBookingsBetween(db, "bob", range)).toEqual([]);
    });

    // IDOR, again: knowing a booking id must not be enough.
    it("can't see or cancel another host's bookings", async () => {
      const { booking, manageToken } = await book("intro", "10:00");
      expect(await listHostBookings(db, "bob", "upcoming", NOW)).toEqual([]);
      expect(await cancelBookingAsHost(db, "bob", booking.id, null, NOW)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect((await getBookingByToken(db, manageToken))?.status).toBe("confirmed");
    });
  });
});
