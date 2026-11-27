import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createPostgresTestDb, TEST_DATABASE_URL } from "@/test/postgres";
import { saveWeeklySchedule } from "./availability";
import { createBooking } from "./booking";
import { createEventType } from "./event-types";
import { createTeamEventType } from "./team-event-types";
import { acceptInvite, createInvite, createTeam } from "./teams";

/*
 * Day 31: round-robin bookings at the same instant, on a real multi-connection
 * PostgreSQL. Skipped unless TEST_DATABASE_URL is set; CI sets it.
 *
 * A round-robin booking locks EVERY host in the pool (sorted), then counts,
 * picks and inserts. The constraint alone would stop two meetings for one host,
 * but not two transactions that both count "Ada 0, Grace 0", both pick Ada, and
 * leave the second guest with "just taken" while Grace was free (test 1), or
 * pile a burst of bookings onto one host (test 3).
 */

const NOW = new Date("2026-12-01T00:00:00Z");
const at = (hhmm: string) => new Date(`2026-12-07T${hhmm}:00Z`); // a Monday; everyone in UTC
const parse = (over: object) =>
  eventTypeSchema.parse({
    ...EVENT_TYPE_DEFAULTS,
    durationMinutes: 30,
    minimumNoticeMinutes: 0,
    bookingWindowDays: null,
    ...over,
  });
const request = (start: Date, n: number, where: { team?: string; username?: string } = { team: "acme" }) => ({
  ...where,
  slug: where.username ? "own" : "demo",
  startsAt: start,
  guestName: `Guest ${n}`,
  guestEmail: `guest${n}@example.com`,
  guestTimeZone: "UTC",
  guestNotes: "",
});
const pause = (ms: number) => () => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!TEST_DATABASE_URL)("round-robin bookings at the same moment (real Postgres)", () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createPostgresTestDb());
    for (const id of ["ada", "grace"]) {
      await db
        .insert(user)
        .values({ id, name: id, email: `${id}@example.com`, username: id, timeZone: "UTC" });
      await saveWeeklySchedule(db, id, {
        timeZone: "UTC",
        rules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
      });
    }
    if (!(await createEventType(db, "grace", parse({ title: "Own", slug: "own" }))).ok)
      throw new Error("setup");
    const team = await createTeam(db, "ada", { name: "Acme", slug: "acme" });
    if (!team.ok) throw new Error("setup");
    const invite = await createInvite(db, "ada", team.id, NOW);
    if (!invite.ok || !(await acceptInvite(db, "grace", invite.token, NOW)).ok) throw new Error("setup");
    const r = await createTeamEventType(
      db,
      "ada",
      team.id,
      parse({ title: "Demo", slug: "demo" }),
      ["ada", "grace"],
      "round_robin",
    );
    if (!r.ok) throw new Error(r.error);
  }, 30_000);

  afterEach(async () => close());

  const hostsOf = async (ids: string[]) =>
    (await db.select({ hostId: bookings.hostId }).from(bookings).where(inArray(bookings.id, ids))).map(
      (b) => b.hostId,
    );

  it("two guests, one time, two free hosts: both booked, one with each", async () => {
    for (let round = 0; round < 5; round++) {
      const time = at(`${String(10 + round).padStart(2, "0")}:00`);
      const results = await Promise.all(
        [1, 2].map((n) => createBooking(db, request(time, 10 * round + n), NOW, { afterCheck: pause(50) })),
      );
      const ids = results.flatMap((r) => (r.ok ? [r.booking.id] : []));
      expect(ids, `round ${round}`).toHaveLength(2);
      expect((await hostsOf(ids)).sort(), `round ${round}`).toEqual(["ada", "grace"]);
    }
  });

  it("only one host free: exactly one guest wins, and the other hears it's gone", async () => {
    expect((await createBooking(db, request(at("10:00"), 0, { username: "grace" }), NOW)).ok).toBe(true);
    const results = await Promise.all(
      [1, 2].map((n) => createBooking(db, request(at("10:00"), n), NOW, { afterCheck: pause(50) })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "slot_unavailable" });
  });

  it("ten guests at ten different times at once: five each", async () => {
    const times = Array.from({ length: 10 }, (_, i) =>
      at(`${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`),
    );
    const results = await Promise.all(
      times.map((t, n) => createBooking(db, request(t, n), NOW, { afterCheck: pause(20) })),
    );
    const ids = results.flatMap((r) => (r.ok ? [r.booking.id] : []));
    expect(ids).toHaveLength(10);
    const hosts = await hostsOf(ids);
    expect(hosts.filter((h) => h === "ada")).toHaveLength(5);
    expect(hosts.filter((h) => h === "grace")).toHaveLength(5);
  });
});
