import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { bookingHosts, bookings, eventTypes, teams, user } from "./schema";
import type { Database } from "./types";

/*
 * Day 29: booking_hosts and its triggers, on the real migrations (PGlite).
 * The app only ever writes (booking_id, host_id); Postgres fills in and keeps
 * the rest, and refuses any host being in two active meetings at once.
 */

const OVERLAP = "23P01";
const CHECK = "23514";

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
}

let db: Database;
let personal: string; // Ada's own event type
let teamType: string; // a collective event type of the Acme team

const at = (hhmm: string) => new Date(`2026-12-01T${hhmm}:00Z`);
const booking = (host: string, eventTypeId: string, from: string, to: string) => ({
  id: randomUUID(),
  eventTypeId,
  hostId: host,
  guestName: "Guest",
  guestEmail: "guest@example.com",
  guestTimeZone: "UTC",
  manageTokenHash: randomUUID(),
  startsAt: at(from),
  endsAt: at(to),
});
const hostsOf = (bookingId: string) =>
  db.select().from(bookingHosts).where(eq(bookingHosts.bookingId, bookingId)).orderBy(bookingHosts.hostId);

beforeEach(async () => {
  db = await createTestDb();
  await db
    .insert(user)
    .values(["ada", "grace", "linus"].map((id) => ({ id, name: id, email: `${id}@example.com` })));
  const [team] = await db.insert(teams).values({ slug: "acme", name: "Acme" }).returning();
  const base = { title: "Call", durationMinutes: 30 };
  const rows = await db
    .insert(eventTypes)
    .values([
      { ...base, slug: "call", userId: "ada" },
      { ...base, slug: "call", teamId: team!.id, teamKind: "collective" as const },
    ])
    .returning({ id: eventTypes.id });
  personal = rows[0]!.id;
  teamType = rows[1]!.id;
}, 30_000);

describe("booking_hosts (Day 29)", () => {
  it("every new booking gets its organizer's row, with the booking's times, from a trigger", async () => {
    const b = booking("ada", personal, "10:00", "10:30");
    await db.insert(bookings).values(b);
    expect(await hostsOf(b.id)).toEqual([
      { bookingId: b.id, hostId: "ada", startsAt: at("10:00"), endsAt: at("10:30"), active: true },
    ]);
  });

  it("an added host's row copies the booking, whatever times the app sends", async () => {
    const b = booking("ada", teamType, "10:00", "10:30");
    await db.insert(bookings).values(b);
    await db.insert(bookingHosts).values({
      bookingId: b.id,
      hostId: "grace",
      startsAt: at("00:00"),
      endsAt: at("23:00"),
      active: false,
    });
    const [grace] = await db
      .select()
      .from(bookingHosts)
      .where(and(eq(bookingHosts.bookingId, b.id), eq(bookingHosts.hostId, "grace")));
    expect(grace).toMatchObject({ startsAt: at("10:00"), endsAt: at("10:30"), active: true });
  });

  it("a co-host's own booking can't overlap a team meeting they're in, and the reverse", async () => {
    const team = booking("ada", teamType, "10:00", "11:00");
    await db.insert(bookings).values(team);
    await db.insert(bookingHosts).values({ bookingId: team.id, hostId: "grace", ...placeholder });
    // Grace's own meeting at 10:30: refused, though bookings.host_id differs (the old constraint can't see it).
    expect(await code(db.insert(bookings).values(booking("grace", personal, "10:30", "11:30")))).toBe(
      OVERLAP,
    );
    // Linus isn't in it: free.
    expect(
      await code(db.insert(bookings).values(booking("linus", personal, "10:30", "11:30"))),
    ).toBeUndefined();
    // Adding Linus to the team meeting now overlaps his own: refused.
    expect(
      await code(db.insert(bookingHosts).values({ bookingId: team.id, hostId: "linus", ...placeholder })),
    ).toBe(OVERLAP);
    // Back to back is fine (half-open ranges).
    expect(
      await code(db.insert(bookings).values(booking("grace", personal, "11:00", "11:30"))),
    ).toBeUndefined();
  });

  it("cancelling frees every host; moving moves every host, and fails if any one of them is busy", async () => {
    const team = booking("ada", teamType, "10:00", "11:00");
    await db.insert(bookings).values(team);
    await db.insert(bookingHosts).values({ bookingId: team.id, hostId: "grace", ...placeholder });
    await db.insert(bookings).values(booking("grace", personal, "14:00", "14:30"));

    // Grace is busy at 14:00: moving the team meeting there fails as a whole.
    const move = (from: string, to: string) =>
      db
        .update(bookings)
        .set({ startsAt: at(from), endsAt: at(to) })
        .where(eq(bookings.id, team.id));
    expect(await code(move("14:00", "15:00"))).toBe(OVERLAP);
    expect((await hostsOf(team.id)).map((h) => h.startsAt)).toEqual([at("10:00"), at("10:00")]);

    expect(await code(move("15:00", "16:00"))).toBeUndefined();
    expect((await hostsOf(team.id)).map((h) => [h.hostId, h.startsAt, h.endsAt])).toEqual([
      ["ada", at("15:00"), at("16:00")],
      ["grace", at("15:00"), at("16:00")],
    ]);

    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: at("09:00") })
      .where(eq(bookings.id, team.id));
    expect((await hostsOf(team.id)).every((h) => !h.active)).toBe(true);
    // The time is free again for both.
    expect(
      await code(db.insert(bookings).values(booking("grace", personal, "15:00", "15:30"))),
    ).toBeUndefined();
  });

  it("an event type belongs to exactly one of a user or a team, and only a team's has a kind", async () => {
    const [team] = await db.select().from(teams);
    const base = { title: "x", durationMinutes: 30, slug: "x" };
    expect(await code(db.insert(eventTypes).values(base))).toBe(CHECK);
    expect(
      await code(
        db.insert(eventTypes).values({ ...base, userId: "ada", teamId: team!.id, teamKind: "collective" }),
      ),
    ).toBe(CHECK);
    expect(await code(db.insert(eventTypes).values({ ...base, teamId: team!.id }))).toBe(CHECK);
    expect(await code(db.insert(eventTypes).values({ ...base, userId: "ada", teamKind: "collective" }))).toBe(
      CHECK,
    );
  });
});

/** Any values: the fill trigger replaces them with the booking's. */
const placeholder = { startsAt: new Date(0), endsAt: new Date(1), active: false };
