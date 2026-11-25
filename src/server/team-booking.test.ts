import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { bookingHosts, bookings, user, webhookEndpoints } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema, type EventTypeInput } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveWeeklySchedule } from "./availability";
import {
  createBooking,
  eventTypeForBooking,
  getBookableSlots,
  getPublicEventType,
  getTeamEventType,
} from "./booking";
import { toCalendarEvent } from "./calendar/sync";
import { createEventType } from "./event-types";
import { createMemorySender, resendError, type EmailMessage } from "./email/sender";
import { sendChangeEmail, sendCoHostEmails, type JobDeps } from "./jobs/handlers";
import { getInsights } from "./insights";
import {
  cancelBookingAsHost,
  getBookingDetails,
  getHostBooking,
  listHostBookings,
  listHostBookingsBetween,
  rescheduleBookingAsHost,
  rescheduleBookingByToken,
  setNoShow,
} from "./manage-booking";
import {
  createTeamEventType,
  getTeamEventTypeForOwner,
  listTeamEventTypes,
  setTeamEventTypeActive,
  updateTeamEventType,
} from "./team-event-types";
import { acceptInvite, createInvite, createTeam, leaveTeam } from "./teams";
import { queueBookingDeliveries } from "./webhooks/deliveries";
import { findFreeTimesTool, listBookingsTool, rescheduleBookingTool, type McpDeps } from "./mcp/tools";

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

describe("Day 30: team meetings for every host", () => {
  const book = async (time = "09:00") => {
    const r = await createBooking(db, request(time), NOW);
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const hostRows = async (bookingId: string) =>
    (await db.select().from(bookingHosts).where(eq(bookingHosts.bookingId, bookingId))).map((h) => [
      h.hostId,
      hhmm(h.startsAt),
    ]);
  const ownBooking = async (who: string, time: string) =>
    expect((await createBooking(db, request(time, { username: who, slug: "own" }), NOW)).ok).toBe(true);

  it("a guest moves it on the TEAM's rules (by id), every host's row moving with it", async () => {
    // Ada's own "sync" is 60 minutes. Found by username + slug, the move would have used it (Day 29 story 2).
    expect(
      (await createEventType(db, "ada", input({ title: "Ada's sync", slug: "sync", durationMinutes: 60 })))
        .ok,
    ).toBe(true);
    const r = await book("09:00");
    const moved = await rescheduleBookingByToken(db, r.manageToken, utc("10:00"), NOW);
    expect(moved).toMatchObject({ ok: true, previousStartsAt: utc("09:00") });
    const b = (await getBookingDetails(db, r.booking.id))!;
    expect([hhmm(b.startsAt), hhmm(b.endsAt)]).toEqual(["10:00", "10:30"]); // the team's 30 minutes
    expect((await hostRows(r.booking.id)).sort()).toEqual([
      ["ada", "10:00"],
      ["grace", "10:00"],
    ]);
    expect(b.changedByHostId).toBeNull(); // the guest did it
  });

  it("the new time must suit every host: a co-host's own meeting blocks it", async () => {
    const r = await book("09:00");
    await ownBooking("grace", "10:00");
    expect(await rescheduleBookingByToken(db, r.manageToken, utc("10:00"), NOW)).toEqual({
      ok: false,
      error: "slot_unavailable",
    });
  });

  it("the MEETING's hosts decide, not the event type's current host list", async () => {
    const r = await book("09:00");
    // Since booking: Grace taken off the event type, Linus added. Grace is still in this meeting; Linus isn't.
    expect((await updateTeamEventType(db, "ada", teamId, syncId, input(), ["ada", "linus"])).ok).toBe(true);
    await ownBooking("grace", "10:30");
    await ownBooking("linus", "10:00");
    const et = (await eventTypeForBooking(db, { ...r.booking, eventTypeId: syncId, hostId: "ada" }))!;
    expect(et.hosts.map((h) => h.id)).toEqual(["ada", "grace"]);
    expect(await rescheduleBookingByToken(db, r.manageToken, utc("10:30"), NOW)).toEqual({
      ok: false,
      error: "slot_unavailable", // Grace is busy: offering it would have hit the constraint
    });
    expect((await rescheduleBookingByToken(db, r.manageToken, utc("10:00"), NOW)).ok).toBe(true); // Linus isn't in it
  });

  it("a switched-off team event type: its meetings can't be moved (like a host's own)", async () => {
    const r = await book("09:00");
    expect(await setTeamEventTypeActive(db, "ada", teamId, syncId, false)).toBe(true);
    expect(await rescheduleBookingByToken(db, r.manageToken, utc("10:00"), NOW)).toEqual({
      ok: false,
      error: "not_changeable",
    });
  });

  it("any host may move or cancel it, and who did is recorded; a team member who isn't in it can't", async () => {
    const r = await book("09:00");
    const id = r.booking.id;
    expect(await rescheduleBookingAsHost(db, "linus", id, utc("10:00"), NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await cancelBookingAsHost(db, "linus", id, null, NOW)).toEqual({ ok: false, error: "not_found" });
    expect((await rescheduleBookingAsHost(db, "grace", id, utc("10:00"), NOW)).ok).toBe(true);
    expect(await getBookingDetails(db, id)).toMatchObject({
      rescheduledBy: "host",
      changedByHostId: "grace",
    });
    expect((await cancelBookingAsHost(db, "grace", id, "Clash", NOW)).ok).toBe(true);
    expect(await getBookingDetails(db, id)).toMatchObject({
      cancelledBy: "host",
      changedByHostId: "grace",
      changedByHostName: "Grace",
    });
  });

  it("is on every host's Bookings page and week view, with the team and the hosts; nobody else's", async () => {
    const r = await book("09:00");
    for (const who of ["ada", "grace"]) {
      const [row, ...rest] = await listHostBookings(db, who, "upcoming", NOW);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        id: r.booking.id,
        hostId: "ada",
        team: { name: "Acme", slug: "acme" },
        hosts: [
          { id: "ada", name: "Ada" },
          { id: "grace", name: "Grace" },
        ],
      });
      expect(await listHostBookingsBetween(db, who, DAY)).toHaveLength(1);
    }
    expect(await listHostBookings(db, "linus", "upcoming", NOW)).toEqual([]);
    expect(await listHostBookingsBetween(db, "linus", DAY)).toEqual([]);
    expect(await getHostBooking(db, "linus", r.booking.id)).toBeNull();
    // A personal booking has no team and no host list.
    await ownBooking("grace", "12:00");
    const graces = await listHostBookings(db, "grace", "upcoming", NOW);
    expect(graces.map((b) => [b.team, b.hosts])).toEqual([
      [{ name: "Acme", slug: "acme" }, expect.any(Array)],
      [null, []],
    ]);
  });

  it("a co-host can mark a no-show once it's over; Insights count it once, for each host", async () => {
    const r = await book("09:00");
    const after = new Date("2026-12-08T00:00:00Z");
    expect(await setNoShow(db, "linus", r.booking.id, true, after)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await setNoShow(db, "grace", r.booking.id, true, after)).toEqual({ ok: true });
    for (const [who, zone] of [
      ["ada", "Asia/Dhaka"],
      ["grace", "Europe/London"],
    ] as const) {
      const insights = await getInsights(db, who, "4w", zone, after);
      expect(insights.totals).toMatchObject({ meetings: 1, noShows: 1 });
      expect(insights.eventTypes).toEqual([
        { title: "Team sync (Acme)", meetings: 1, cancelled: 0, noShows: 1 },
      ]);
    }
    expect((await getInsights(db, "linus", "4w", "Europe/Helsinki", after)).totals.meetings).toBe(0);
  });

  describe("who is told (emails)", () => {
    const setup = async () => {
      expect(
        (await updateTeamEventType(db, "ada", teamId, syncId, input(), ["ada", "grace", "linus"])).ok,
      ).toBe(true);
      const r = await book("09:00");
      const mail = createMemorySender();
      const deps = {
        db,
        appUrl: "https://meetready.test",
        secret: "s".repeat(32),
        sender: mail,
        report: () => {},
      };
      return { r, mail, deps: deps as unknown as JobDeps };
    };
    const moved = (bookingId: string, sequence: number) => ({
      bookingId,
      change: "rescheduled" as const,
      sequence,
      previousStartsAt: utc("09:00").toISOString(),
      at: NOW.toISOString(),
    });

    it("a co-host moves it: the guest hears who did, the organizer and other co-hosts are told, the mover isn't", async () => {
      const { r, mail, deps } = await setup();
      const m = await rescheduleBookingAsHost(db, "grace", r.booking.id, utc("10:00"), NOW);
      if (!m.ok) throw new Error(m.error);
      const data = moved(r.booking.id, m.sequence);
      expect(await sendChangeEmail(deps, data, "guest")).toBe("sent");
      expect(await sendChangeEmail(deps, data, "host")).toBe("sent");
      expect(await sendCoHostEmails(deps, data)).toEqual({ sent: 1, rejected: 0 });
      expect(mail.sent.map((e) => e.to)).toEqual([
        "guest@example.com",
        "ada@example.com",
        "linus@example.com",
      ]);
      expect(mail.sent[0]!.html).toContain("Grace moved your meeting");
      expect(mail.sent[1]!.html).toContain("Grace moved your meeting with Guest");
      expect(mail.sent[2]!.html).toContain("Grace moved your meeting with Guest");
    });

    it("the organizer cancels by hand: not told (they know), every co-host is, by name", async () => {
      const { r, mail, deps } = await setup();
      const c = await cancelBookingAsHost(db, "ada", r.booking.id, null, NOW);
      if (!c.ok) throw new Error(c.error);
      const data = {
        bookingId: r.booking.id,
        change: "cancelled" as const,
        sequence: c.sequence,
        at: NOW.toISOString(),
      };
      expect(await sendChangeEmail(deps, data, "host")).toBe("not_needed");
      expect(await sendCoHostEmails(deps, data)).toEqual({ sent: 2, rejected: 0 });
      expect(mail.sent.map((e) => e.to)).toEqual(["grace@example.com", "linus@example.com"]);
      expect(mail.sent.every((e) => e.html.includes("Ada cancelled your meeting with Guest"))).toBe(true);
    });

    it("co-hosts' emails carry no .ics once Google has the event (they're invited there)", async () => {
      const { r, mail, deps } = await setup();
      await db.update(bookings).set({ calendarSync: "synced" }).where(eq(bookings.id, r.booking.id));
      const data = {
        bookingId: r.booking.id,
        change: "created" as const,
        sequence: 0,
        at: NOW.toISOString(),
      };
      expect(await sendCoHostEmails(deps, data)).toEqual({ sent: 2, rejected: 0 });
      expect(mail.sent.every((e) => e.ics === undefined)).toBe(true);
    });
  });

  it("Google: one event in the organizer's calendar, the co-hosts invited, never the guest", async () => {
    const r = await book("09:00");
    const event = toCalendarEvent((await getBookingDetails(db, r.booking.id))!, "https://meetready.test");
    expect(event.attendees).toEqual([{ email: "grace@example.com", displayName: "Grace" }]);
    await ownBooking("grace", "12:00");
    const [own] = await listHostBookings(db, "grace", "upcoming", NOW).then((rows) =>
      rows.filter((b) => !b.team),
    );
    expect(
      toCalendarEvent((await getBookingDetails(db, own!.id))!, "https://meetready.test").attendees,
    ).toEqual([]);
  });

  it("webhooks: every host's endpoints get it, once each", async () => {
    const r = await book("09:00");
    for (const who of ["ada", "grace", "linus"]) {
      await db.insert(webhookEndpoints).values({
        userId: who,
        url: `https://${who}.example.com/hook`,
        events: ["booking.created"],
        secretEncrypted: "sealed",
      });
    }
    const change = { bookingId: r.booking.id, change: "created" as const, sequence: 0 };
    const ids = await queueBookingDeliveries(db, change, NOW);
    expect(ids).toHaveLength(2); // Ada's and Grace's; Linus isn't in the meeting
    expect(await queueBookingDeliveries(db, change, NOW)).toEqual(expect.arrayContaining(ids)); // safe to repeat
  });

  describe("over MCP (the user's AI assistant)", () => {
    const mcp = (userId: string) => {
      const deps: McpDeps = {
        db,
        appUrl: "https://meetready.test",
        busyTimes: async () => [],
        limit: async () => ({ ok: true }),
        now: () => NOW,
        calendar: { busyTimes: async () => [] },
        changeLimit: async () => ({ ok: true }),
      };
      return {
        deps,
        caller: { userId, clientId: "c", scopes: new Set(["bookings:read", "bookings:write"]) },
      };
    };
    const search = (bookingId: string) => ({
      eventType: "sync",
      from: MONDAY,
      to: MONDAY,
      earliest: null,
      latest: null,
      timeZone: "UTC",
      bookingId,
    });

    it("find_free_times for a team meeting uses ITS meeting type, not the organizer's own 'sync'", async () => {
      // Ada's own "sync": 60 minutes, her hours only. By slug, the search found this one (Day 30 story).
      expect(
        (await createEventType(db, "ada", input({ title: "Ada's sync", slug: "sync", durationMinutes: 60 })))
          .ok,
      ).toBe(true);
      const r = await book("09:00");
      const { deps, caller } = mcp("ada");
      const found = await findFreeTimesTool(deps, caller, search(r.booking.id));
      if (!found.ok) throw new Error(found.error);
      expect(found.data.durationMinutes).toBe(30);
      // Both hosts' shared hours (09:00–11:00 UTC), its own time free for the move.
      expect(found.data.days).toEqual([{ date: MONDAY, times: ["09:00", "09:30", "10:00", "10:30"] }]);
    });

    it("a co-host's assistant lists it (with the team and hosts) and can move it", async () => {
      const r = await book("09:00");
      const { deps, caller } = mcp("grace");
      const listed = await listBookingsTool(deps, caller, { view: "upcoming", limit: null });
      if (!listed.ok) throw new Error(listed.error);
      expect(listed.data.bookings[0]).toMatchObject({
        id: r.booking.id,
        team: "Acme",
        hosts: ["Ada", "Grace (the user)"],
        organizer: "Ada",
      });
      const moved = await rescheduleBookingTool(
        deps,
        caller,
        { bookingId: r.booking.id, date: MONDAY, time: "10:00", timeZone: "UTC" },
        { canAsk: false, answer: null },
      );
      expect(moved).toMatchObject({
        ok: true,
        data: { moved: true, start: expect.stringContaining("10:00") },
      });
      expect(await getBookingDetails(db, r.booking.id)).toMatchObject({ changedByHostId: "grace" });
      const { deps: linusDeps, caller: linus } = mcp("linus");
      const theirs = await listBookingsTool(linusDeps, linus, { view: "upcoming", limit: null });
      expect(theirs.ok && theirs.data.bookings).toEqual([]); // in the team, not in the meeting
    });
  });
});
