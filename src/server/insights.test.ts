import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { book, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { getInsights, insightsPeriod, isInsightRange } from "./insights";

/*
 * Day 25. Host "sakif" in Dhaka (UTC+6, no DST), free all day. "Now" is
 * Friday 20 Nov 2026, 14:00 in Dhaka. The week starts on Monday.
 */
const NOW = new Date("2026-11-20T08:00:00Z");
const LONG_AGO = new Date("2026-01-01T00:00:00Z");
const TZ = "Asia/Dhaka";

let db: Database;
beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

async function meeting(startsAt: string, opts: { slug?: string; guest?: string } = {}) {
  const r = await book(db, new Date(startsAt), LONG_AGO, {
    slug: opts.slug,
    guestEmail: `${opts.guest ?? Math.random().toString(36).slice(2)}@example.com`,
  });
  return r.booking.id;
}
const set = (id: string, values: Partial<typeof bookings.$inferInsert>) =>
  db.update(bookings).set(values).where(eq(bookings.id, id));

describe("insightsPeriod", () => {
  it("whole weeks from Monday, on the host's clock, ending with this week", () => {
    const p = insightsPeriod("4w", NOW, TZ);
    expect(p.buckets).toEqual(["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(p.from).toEqual(new Date("2026-10-25T18:00:00Z")); // Monday 00:00 in Dhaka
    expect(insightsPeriod("3m", NOW, TZ).buckets).toHaveLength(13);
  });

  it("on a Sunday night in Dhaka it's still that week, though UTC says Sunday afternoon", () => {
    const sundayNight = new Date("2026-11-22T17:30:00Z"); // Sun 23:30 Dhaka
    expect(insightsPeriod("4w", sundayNight, TZ).buckets.at(-1)).toBe("2026-11-16");
    const mondayEarly = new Date("2026-11-22T18:30:00Z"); // Mon 00:30 Dhaka, still Sunday in UTC
    expect(insightsPeriod("4w", mondayEarly, TZ).buckets.at(-1)).toBe("2026-11-23");
  });

  it("whole months for a year, across the new year", () => {
    const p = insightsPeriod("12m", NOW, TZ);
    expect(p.buckets[0]).toBe("2025-12-01");
    expect(p.buckets.at(-1)).toBe("2026-11-01");
    expect(p.buckets).toHaveLength(12);
  });

  it("only known ranges are accepted from the URL", () => {
    expect(isInsightRange("3m")).toBe(true);
    expect(isInsightRange("toString")).toBe(false);
    expect(isInsightRange(undefined)).toBe(false);
  });
});

describe("getInsights", () => {
  it("counts held, no-show and cancelled meetings, with rates", async () => {
    await meeting("2026-11-17T04:00:00Z"); // held
    await meeting("2026-11-17T05:00:00Z"); // held
    await set(await meeting("2026-11-18T04:00:00Z"), { noShowAt: NOW });
    await set(await meeting("2026-11-18T05:00:00Z"), {
      status: "cancelled",
      cancelledAt: NOW,
      cancelledBy: "guest",
    });
    await set(await meeting("2026-11-19T05:00:00Z"), {
      status: "cancelled",
      cancelledAt: NOW,
      cancelledBy: "host",
    });

    const r = await getInsights(db, "host", "4w", TZ, NOW);
    expect(r.totals).toEqual({ meetings: 5, held: 2, noShows: 1, cancelledByGuest: 1, cancelledByHost: 1 });
    expect(r.rates.cancellation).toBeCloseTo(2 / 5);
    expect(r.rates.noShow).toBeCloseTo(1 / 3); // of the 3 that weren't cancelled
    expect(r.series.at(-1)).toEqual({ bucket: "2026-11-16", held: 2, noShows: 1, cancelled: 2 });
  });

  it("groups by the host's clock: just after midnight in Dhaka is the next day, and the next week", async () => {
    // Sunday 15 Nov, 19:00 UTC = Monday 16 Nov, 01:00 in Dhaka. In UTC it would be last week's Sunday, 7 PM.
    await meeting("2026-11-15T19:00:00Z");
    const r = await getInsights(db, "host", "4w", TZ, NOW);
    expect(r.series.map((s) => s.held)).toEqual([0, 0, 0, 1]);
    expect(r.times).toEqual([{ weekday: 1, hour: 1, meetings: 1 }]);
  });

  it("leaves out meetings still to come, before the period, and other hosts' meetings", async () => {
    await meeting("2026-11-25T04:00:00Z"); // next week
    await meeting("2026-10-20T04:00:00Z"); // before the 4 weeks
    await db.insert(user).values({ id: "other", name: "O", email: "o@example.com", username: "other" });
    const id = await meeting("2026-11-17T04:00:00Z");
    await set(id, { hostId: "other" });
    const r = await getInsights(db, "host", "4w", TZ, NOW);
    expect(r.totals.meetings).toBe(0);
    // The 12-month view does include October.
    expect((await getInsights(db, "host", "12m", TZ, NOW)).totals.meetings).toBe(1);
  });

  it("splits by source and by meeting type, busiest type first", async () => {
    await meeting("2026-11-16T04:00:00Z", { slug: "deep" });
    await meeting("2026-11-17T04:00:00Z");
    await set(await meeting("2026-11-17T06:00:00Z"), { source: "assistant" });
    const r = await getInsights(db, "host", "4w", TZ, NOW);
    expect(r.sources).toEqual({ bookingPage: 2, assistant: 1 });
    expect(r.eventTypes).toEqual([
      { title: "Intro call", meetings: 2, cancelled: 0, noShows: 0 },
      { title: "Deep dive", meetings: 1, cancelled: 0, noShows: 0 },
    ]);
  });

  it("an empty period: zeros, no rates (nothing to divide by), and every week still listed", async () => {
    const r = await getInsights(db, "host", "3m", TZ, NOW);
    expect(r.rates).toEqual({ cancellation: null, noShow: null });
    expect(r.series).toHaveLength(13);
    expect(r.series.every((s) => s.held + s.noShows + s.cancelled === 0)).toBe(true);
    expect(r.times).toEqual([]);
  });
});
