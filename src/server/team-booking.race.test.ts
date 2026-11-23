import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createPostgresTestDb, TEST_DATABASE_URL } from "@/test/postgres";
import { saveWeeklySchedule } from "./availability";
import { createBooking } from "./booking";
import { createEventType } from "./event-types";
import { createTeamEventType } from "./team-event-types";
import { acceptInvite, createInvite, createTeam } from "./teams";

/*
 * Day 29: team bookings at the same instant, on a real multi-connection
 * PostgreSQL. Skipped unless TEST_DATABASE_URL is set; CI sets it.
 *
 * Two collective event types share Ada and Grace, listed in OPPOSITE orders.
 * If each booking took its hosts' locks in list order, one would hold Ada's
 * waiting for Grace's while the other held Grace's waiting for Ada's: a
 * deadlock (Postgres kills one with 40P01). Sorted, the second just waits.
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
const request = (where: { team?: string; username?: string }, slug: string, n: number) => ({
  ...where,
  slug,
  startsAt: at("10:00"),
  guestName: `Guest ${n}`,
  guestEmail: `guest${n}@example.com`,
  guestTimeZone: "UTC",
  guestNotes: "",
});
const pause = (ms: number) => () => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!TEST_DATABASE_URL)("team bookings at the same moment (real Postgres)", () => {
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
    for (const [slug, hosts] of [
      ["one", ["ada", "grace"]],
      ["two", ["grace", "ada"]],
    ] as const) {
      const r = await createTeamEventType(db, "ada", team.id, parse({ title: slug, slug }), [...hosts]);
      if (!r.ok) throw new Error(r.error);
    }
  }, 30_000);

  afterEach(async () => close());

  it("two team meetings with the same hosts in opposite orders: one booked, no deadlock", async () => {
    for (let round = 0; round < 5; round++) {
      const time = at(`${10 + round}:00`);
      const results = await Promise.all(
        (["one", "two"] as const).map((slug, n) =>
          createBooking(db, { ...request({ team: "acme" }, slug, n), startsAt: time }, NOW, {
            afterCheck: pause(50),
          }),
        ),
      );
      expect(
        results.filter((r) => r.ok),
        `round ${round}`,
      ).toHaveLength(1);
    }
  });

  it("a team meeting and a co-host's own booking for the same time: exactly one wins", async () => {
    const results = await Promise.all([
      createBooking(db, request({ team: "acme" }, "one", 1), NOW, { afterCheck: pause(50) }),
      createBooking(db, request({ username: "grace" }, "own", 2), NOW, { afterCheck: pause(50) }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
