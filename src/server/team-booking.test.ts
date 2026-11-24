import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { bookingHosts, bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema, type EventTypeInput } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveWeeklySchedule } from "./availability";
import { createBooking, getBookableSlots, getPublicEventType, getTeamEventType } from "./booking";
import { createEventType } from "./event-types";
import { createMemorySender, resendError, type EmailMessage } from "./email/sender";
import { sendCoHostEmails, type JobDeps } from "./jobs/handlers";
import { getBookingDetails, rescheduleBookingByToken } from "./manage-booking";
import {
  createTeamEventType,
  getTeamEventTypeForOwner,
  listTeamEventTypes,
  setTeamEventTypeActive,
  updateTeamEventType,
} from "./team-event-types";
import { acceptInvite, createInvite, createTeam, leaveTeam } from "./teams";

/*
 * Day 29: collective team event types, on a real (in-memory) Postgres.
 *
 * Ada works 9–5 in Dhaka (03:00–11:00 UTC), Grace 9–5 in London (09:00–17:00
 * UTC in December). Both work only between 09:00 and 11:00 UTC: four
 * 30-minute times on a weekday. Linus is in the team but not a host.
 */

const NOW = new Date("2026-12-01T00:00:00Z");
const MONDAY = "2026-12-07";
const utc = (hhmm: string) => new Date(`${MONDAY}T${hhmm}:00Z`);
const DAY = { start: utc("00:00"), end: new Date(`2026-12-08T00:00:00Z`) };
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

let db: Database;
let teamId: string;
let syncId: string;

const input = (over: Partial<EventTypeInput> = {}): EventTypeInput =>
  eventTypeSchema.parse({
    ...EVENT_TYPE_DEFAULTS,
    title: "Team sync",
    slug: "sync",
    durationMinutes: 30,
    minimumNoticeMinutes: 0,
    bookingWindowDays: null,
    ...over,
  });

async function person(id: string, timeZone: string) {
  await db.insert(user).values({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    email: `${id}@example.com`,
    username: id,
    timeZone,
  });
  await saveWeeklySchedule(db, id, {
    timeZone,
    rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" })),
  });
}

const teamSlots = async () => {
  const et = await getTeamEventType(db, "acme", "sync");
  return et ? (await getBookableSlots(db, et, DAY, NOW)).map((s) => hhmm(s.start)) : null;
};
const ownSlots = async (username: string) => {
  const et = (await getPublicEventType(db, username, "own"))!;
  return (await getBookableSlots(db, et, DAY, NOW)).map((s) => hhmm(s.start));
};
const request = (time: string, where: { team?: string; username?: string; slug?: string } = {}) => ({
  team: where.username ? undefined : (where.team ?? "acme"),
  username: where.username,
  slug: where.slug ?? "sync",
  startsAt: utc(time),
  guestName: "Guest",
  guestEmail: "guest@example.com",
  guestTimeZone: "UTC",
  guestNotes: "",
});

beforeEach(async () => {
  db = await createTestDb();
  await person("ada", "Asia/Dhaka");
  await person("grace", "Europe/London");
  await person("linus", "Europe/Helsinki");
  for (const id of ["ada", "grace", "linus"]) {
    const r = await createEventType(db, id, input({ title: "Own", slug: "own" }));
    if (!r.ok) throw new Error("setup");
  }
  const team = await createTeam(db, "ada", { name: "Acme", slug: "acme" });
  if (!team.ok) throw new Error("setup");
  teamId = team.id;
  for (const id of ["grace", "linus"]) {
    const inv = await createInvite(db, "ada", teamId, NOW);
    if (!inv.ok || !(await acceptInvite(db, id, inv.token, NOW)).ok) throw new Error("setup");
  }
  const created = await createTeamEventType(db, "ada", teamId, input(), ["ada", "grace"]);
  if (!created.ok) throw new Error(created.error);
  syncId = created.id;
}, 30_000);

describe("collective free times", () => {
  it("are the times when every host works", async () => {
    expect(await teamSlots()).toEqual(["09:00", "09:30", "10:00", "10:30"]);
  });

  it("lose any time one host is busy, with that meeting's buffers, from any event type", async () => {
    expect((await createBooking(db, request("09:30", { username: "grace", slug: "own" }), NOW)).ok).toBe(
      true,
    );
    expect(await teamSlots()).toEqual(["09:00", "10:00", "10:30"]);
  });

  it("change when the host list changes (Linus works 07:00–15:00 UTC)", async () => {
    expect(
      (await updateTeamEventType(db, "ada", teamId, syncId, input(), ["ada", "grace", "linus"])).ok,
    ).toBe(true);
    expect(await teamSlots()).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect((await updateTeamEventType(db, "ada", teamId, syncId, input(), ["grace", "linus"])).ok).toBe(true);
    // Without Ada: 09:00–15:00 UTC, and Grace (first) is now the organizer.
    expect(await teamSlots()).toHaveLength(12);
    expect((await getTeamEventType(db, "acme", "sync"))!.hostId).toBe("grace");
  });
});

describe("booking a collective time", () => {
  it("makes one booking with a row per host, and blocks every host's own page", async () => {
    const r = await createBooking(db, request("10:00"), NOW);
    if (!r.ok) throw new Error(r.error);
    const [b] = await db.select().from(bookings).where(eq(bookings.id, r.booking.id));
    expect(b!.hostId).toBe("ada"); // the organizer: first on the host list
    const hosts = await db.select().from(bookingHosts).where(eq(bookingHosts.bookingId, r.booking.id));
    expect(hosts.map((h) => h.hostId).sort()).toEqual(["ada", "grace"]);
    expect(hosts.every((h) => h.active && h.startsAt.getTime() === utc("10:00").getTime())).toBe(true);

    expect(await teamSlots()).toEqual(["09:00", "09:30", "10:30"]);
    expect(await ownSlots("grace")).not.toContain("10:00"); // Grace isn't the organizer, and still blocked
    expect(await ownSlots("ada")).not.toContain("10:00");
    expect(await ownSlots("linus")).toContain("10:00"); // not a host
  });

  it("refuses a time a host has since filled (the re-check), and a co-host's own booking over it", async () => {
    expect((await createBooking(db, request("09:00", { username: "grace", slug: "own" }), NOW)).ok).toBe(
      true,
    );
    expect(await createBooking(db, request("09:00"), NOW)).toEqual({ ok: false, error: "slot_unavailable" });
    expect((await createBooking(db, request("10:00"), NOW)).ok).toBe(true);
    expect(await createBooking(db, request("10:00", { username: "grace", slug: "own" }), NOW)).toEqual({
      ok: false,
      error: "slot_unavailable",
    });
  });

  it("counts a shared meeting once towards the daily limit", async () => {
    expect(
      (
        await updateTeamEventType(db, "ada", teamId, syncId, input({ maxBookingsPerDay: 2 }), [
          "ada",
          "grace",
        ])
      ).ok,
    ).toBe(true);
    expect((await createBooking(db, request("09:00"), NOW)).ok).toBe(true);
    // One meeting, two host rows: counted twice, the day would already be full.
    expect(await teamSlots()).toEqual(["09:30", "10:00", "10:30"]);
  });

  it("names every host for the guest, and lists the co-hosts for their emails", async () => {
    const r = await createBooking(db, request("09:00"), NOW);
    if (!r.ok) throw new Error(r.error);
    const details = (await getBookingDetails(db, r.booking.id))!;
    expect(details.hostName).toBe("Ada and Grace");
    expect(details.coHosts).toEqual([
      { id: "grace", name: "Grace", email: "grace@example.com", timeZone: "Europe/London" },
    ]);
  });

  it("emails each co-host; one refused address doesn't stop the others or fail the step", async () => {
    expect(
      (await updateTeamEventType(db, "ada", teamId, syncId, input(), ["ada", "grace", "linus"])).ok,
    ).toBe(true);
    const r = await createBooking(db, request("09:00"), NOW);
    if (!r.ok) throw new Error(r.error);
    const mail = createMemorySender();
    const reports: unknown[] = [];
    const deps = {
      db,
      appUrl: "https://meetready.test",
      report: (e: unknown) => reports.push(e),
      sender: {
        async send(m: EmailMessage, o?: { idempotencyKey?: string }) {
          // Resend's test sender: only the account's own address gets through.
          if (m.to === "grace@example.com") throw resendError("validation_error", "testing emails only");
          return mail.send(m, o);
        },
      },
    } as unknown as JobDeps;
    const data = { bookingId: r.booking.id, change: "created" as const, sequence: 0, at: NOW.toISOString() };
    expect(await sendCoHostEmails(deps, data)).toEqual({ sent: 1, rejected: 1 });
    expect(mail.sent.map((m) => m.to)).toEqual(["linus@example.com"]);
    expect(reports).toHaveLength(1);
  });

  it("can't be moved yet (Day 30), even though the organizer has an event type with the same slug", async () => {
    // Ada's own "sync" (same slug as the team's): a move used to find it by username + slug.
    expect((await createEventType(db, "ada", input({ title: "Ada's sync", slug: "sync" }))).ok).toBe(true);
    const r = await createBooking(db, request("09:00"), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(await rescheduleBookingByToken(db, r.manageToken, utc("10:00"), NOW)).toEqual({
      ok: false,
      error: "not_changeable",
    });
  });

  it("cancelling frees every host", async () => {
    const r = await createBooking(db, request("09:00"), NOW);
    if (!r.ok) throw new Error(r.error);
    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: NOW })
      .where(eq(bookings.id, r.booking.id));
    expect(await teamSlots()).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(await ownSlots("grace")).toContain("09:00");
  });

  it("an assistant (MCP) can't book a team's event type", async () => {
    expect(await createBooking(db, request("09:00"), NOW, { byAssistant: { clientId: "c" } })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("team event types: who may do what", () => {
  it("only the owner creates and edits them; members see them", async () => {
    expect(await createTeamEventType(db, "grace", teamId, input({ slug: "x" }), ["grace"])).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await updateTeamEventType(db, "grace", teamId, syncId, input(), ["grace"])).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await setTeamEventTypeActive(db, "grace", teamId, syncId, false)).toBe(false);
    expect(await getTeamEventTypeForOwner(db, "grace", teamId, syncId)).toBeNull();
    const seen = await listTeamEventTypes(db, "linus", teamId);
    expect(seen.map((t) => [t.slug, t.hosts.map((h) => h.userId)])).toEqual([["sync", ["ada", "grace"]]]);
  });

  it("someone outside the team sees nothing and changes nothing", async () => {
    await db.insert(user).values({ id: "mallory", name: "M", email: "m@example.com", username: "mallory" });
    expect(await listTeamEventTypes(db, "mallory", teamId)).toEqual([]);
    expect(await setTeamEventTypeActive(db, "mallory", teamId, syncId, false)).toBe(false);
    expect(await createTeamEventType(db, "mallory", teamId, input({ slug: "x" }), ["mallory"])).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("hosts must be in the team; slugs are unique per team, not across a team and its owner", async () => {
    await db.insert(user).values({ id: "mallory", name: "M", email: "m@example.com", username: "mallory" });
    expect(await createTeamEventType(db, "ada", teamId, input({ slug: "x" }), ["ada", "mallory"])).toEqual({
      ok: false,
      error: "hosts_not_in_team",
    });
    expect(await createTeamEventType(db, "ada", teamId, input(), ["ada"])).toEqual({
      ok: false,
      error: "slug_taken",
    });
    // Ada's own "sync" can exist beside the team's: different owners.
    expect((await createEventType(db, "ada", input({ slug: "sync" }))).ok).toBe(true);
  });

  it("someone who leaves stops hosting; with no hosts left, the page is gone", async () => {
    expect(await leaveTeam(db, "grace", teamId)).toEqual({ ok: true });
    expect((await getTeamEventType(db, "acme", "sync"))!.hosts.map((h) => h.id)).toEqual(["ada"]);
    expect((await getTeamEventTypeForOwner(db, "ada", teamId, syncId))!.hostIds).toEqual(["ada"]);

    expect((await updateTeamEventType(db, "ada", teamId, syncId, input(), ["linus"])).ok).toBe(true);
    expect(await leaveTeam(db, "linus", teamId)).toEqual({ ok: true });
    expect(await getTeamEventType(db, "acme", "sync")).toBeNull();
  });

  it("switched off: no page", async () => {
    expect(await setTeamEventTypeActive(db, "ada", teamId, syncId, false)).toBe(true);
    expect(await getTeamEventType(db, "acme", "sync")).toBeNull();
    expect(await createBooking(db, request("09:00"), NOW)).toEqual({ ok: false, error: "not_found" });
  });

  it("a team's event type never shows on its owner's own pages", async () => {
    expect(await getPublicEventType(db, "ada", "sync")).toBeNull();
  });
});
