import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createPostgresTestDb, TEST_DATABASE_URL } from "@/test/postgres";
import { saveWeeklySchedule } from "./availability";
import { createBooking } from "./booking";
import { createEventType } from "./event-types";
import { rescheduleBookingByToken } from "./manage-booking";

/*
 * Races, on a real multi-connection PostgreSQL. Each test fires several
 * bookings at the same instant (Promise.all over a pool of 20 connections)
 * and checks how many succeed. Skipped unless TEST_DATABASE_URL is set.
 */

const NOW = new Date("2026-11-01T00:00:00Z");
const at = (utcTime: string) => new Date(`2026-11-09T${utcTime}:00Z`); // Monday; host in UTC

const request = (slug: string, utcTime: string, n: number) => ({
  username: "alice",
  slug,
  startsAt: at(utcTime),
  guestName: `Guest ${n}`,
  guestEmail: `guest${n}@example.com`,
  guestTimeZone: "UTC",
  guestNotes: "",
});

describe.skipIf(!TEST_DATABASE_URL)("concurrent bookings (real Postgres)", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createPostgresTestDb());
    await db.insert(user).values({ id: "alice", name: "Alice", email: "a@example.com", username: "alice" });
    await saveWeeklySchedule(db, "alice", {
      timeZone: "UTC",
      rules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    });
    for (const overrides of [
      { title: "Intro", slug: "intro" },
      { title: "Buffered", slug: "buffered", bufferAfterMinutes: 30 },
      { title: "Limited", slug: "limited", maxBookingsPerDay: 1 },
    ]) {
      const r = await createEventType(
        db,
        "alice",
        eventTypeSchema.parse({
          ...EVENT_TYPE_DEFAULTS,
          minimumNoticeMinutes: 0,
          bookingWindowDays: null,
          ...overrides,
        }),
      );
      if (!r.ok) throw new Error("setup failed");
    }
  }, 30_000);

  afterEach(async () => close());

  const outcomes = (results: { ok: boolean; error?: string }[]) =>
    results.reduce<Record<string, number>>((acc, r) => {
      const key = r.ok ? "ok" : r.error!;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

  it("10 guests, same slot, same moment: exactly one gets it", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, n) => createBooking(db, request("intro", "10:00", n), NOW)),
    );
    expect(outcomes(results)).toEqual({ ok: 1, slot_unavailable: 9 });
    expect(await db.$count(bookings)).toBe(1);
  });

  /**
   * Holds every booking that reaches "re-check passed" until all `parties` have
   * arrived or `timeoutMs` passes. Without the per-host lock, both bookings
   * pass the check, meet here, then both insert. With the lock, the second
   * can't even start its check until the first commits, so the first times
   * out waiting and goes ahead alone.
   */
  function barrier(parties: number, timeoutMs = 500) {
    let arrived = 0;
    let release!: () => void;
    const allHere = new Promise<void>((resolve) => (release = resolve));
    return async () => {
      arrived += 1;
      if (arrived >= parties) release();
      await Promise.race([allHere, new Promise((r) => setTimeout(r, timeoutMs))]);
    };
  }

  it("buffers hold under a race: 10:00 (30 min buffer after) vs 10:30, both past the check together", async () => {
    // These two don't overlap as meetings, so the exclusion constraint alone
    // would allow both. Only the lock + re-check sees the buffer conflict.
    const afterCheck = barrier(2);
    const results = await Promise.all([
      createBooking(db, request("buffered", "10:00", 1), NOW, { afterCheck }),
      createBooking(db, request("buffered", "10:30", 2), NOW, { afterCheck }),
    ]);
    expect(outcomes(results)).toEqual({ ok: 1, slot_unavailable: 1 });
  });

  it("max bookings per day holds under a race: two times, limit 1, both past the check together", async () => {
    const afterCheck = barrier(2);
    const results = await Promise.all([
      createBooking(db, request("limited", "09:00", 1), NOW, { afterCheck }),
      createBooking(db, request("limited", "15:00", 2), NOW, { afterCheck }),
    ]);
    expect(outcomes(results)).toEqual({ ok: 1, slot_unavailable: 1 });
  });

  it("8 guests, 8 different times, limit 1 per day: exactly one booking", async () => {
    const times = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"];
    const results = await Promise.all(times.map((t, n) => createBooking(db, request("limited", t, n), NOW)));
    expect(outcomes(results)).toEqual({ ok: 1, slot_unavailable: 7 });
  });
  it("a new booking and a reschedule racing for the same time: exactly one wins", async () => {
    const existing = await createBooking(db, request("intro", "09:00", 99), NOW);
    if (!existing.ok) throw new Error("setup failed");
    const afterCheck = barrier(2);
    const [moved, fresh] = await Promise.all([
      rescheduleBookingByToken(db, existing.manageToken, at("12:00"), NOW, { afterCheck }),
      createBooking(db, request("intro", "12:00", 1), NOW, { afterCheck }),
    ]);
    expect([moved.ok, fresh.ok].filter(Boolean)).toHaveLength(1);
  });
});
