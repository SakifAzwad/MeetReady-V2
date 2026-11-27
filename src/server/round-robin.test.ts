import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { bookingHosts, bookings, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema, type EventTypeInput } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveWeeklySchedule } from "./availability";
import {
  createBooking,
  getBookingCalendar,
  getPublicEventType,
  getPublicTeam,
  getTeamEventType,
} from "./booking";
import { CalendarUnavailableError, type ExternalBusy } from "./calendar/busy";
import { createEventType } from "./event-types";
import { getBookingDetails, rescheduleBookingByToken } from "./manage-booking";
import { createTeamEventType, updateTeamEventType } from "./team-event-types";
import { acceptInvite, createInvite, createTeam } from "./teams";

/*
 * Day 31: round-robin team event types, on a real (in-memory) Postgres.
 *
 * Ada works 9–5 in Dhaka (03:00–11:00 UTC), Grace 9–5 in London (09:00–17:00
 * UTC in December). Round-robin offers a time when EITHER is free (03:00–17:00
 * UTC), and gives each booking to one of them. Linus is in the team, not a host.
 */

const NOW = new Date("2026-12-01T00:00:00Z");
const MONDAY = "2026-12-07";
const utc = (hhmm: string) => new Date(`${MONDAY}T${hhmm}:00Z`);
const DAY = { start: utc("00:00"), end: new Date(`2026-12-08T00:00:00Z`) };
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

let db: Database;
let teamId: string;
let rrId: string;

const input = (over: Partial<EventTypeInput> = {}): EventTypeInput =>
  eventTypeSchema.parse({
    ...EVENT_TYPE_DEFAULTS,
    title: "Demo",
    slug: "demo",
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

const request = (time: string, n = 0, where: { username?: string; slug?: string } = {}) => ({
  team: where.username ? undefined : "acme",
  username: where.username,
  slug: where.slug ?? "demo",
  startsAt: utc(time),
  guestName: `Guest ${n}`,
  guestEmail: `guest${n}@example.com`,
  guestTimeZone: "UTC",
  guestNotes: "",
});

/** Books and returns who got it. */
async function book(time: string, n = 0, options: Parameters<typeof createBooking>[3] = {}) {
  const r = await createBooking(db, request(time, n), NOW, options);
  if (!r.ok) return r.error;
  const [b] = await db.select().from(bookings).where(eq(bookings.id, r.booking.id));
  return b!.hostId;
}

const rr = async () => (await getTeamEventType(db, "acme", "demo"))!;

beforeEach(async () => {
  db = await createTestDb();
  await person("ada", "Asia/Dhaka");
  await person("grace", "Europe/London");
  await person("linus", "Europe/Helsinki");
  for (const id of ["ada", "grace"]) {
    if (!(await createEventType(db, id, input({ title: "Own", slug: "own" }))).ok) throw new Error("setup");
  }
  const team = await createTeam(db, "ada", { name: "Acme", slug: "acme" });
  if (!team.ok) throw new Error("setup");
  teamId = team.id;
  for (const id of ["grace", "linus"]) {
    const inv = await createInvite(db, "ada", teamId, NOW);
    if (!inv.ok || !(await acceptInvite(db, id, inv.token, NOW)).ok) throw new Error("setup");
  }
  const created = await createTeamEventType(db, "ada", teamId, input(), ["ada", "grace"], "round_robin");
  if (!created.ok) throw new Error(created.error);
  rrId = created.id;
}, 30_000);

describe("round-robin free times", () => {
  it("are the times when ANY host is free, each on their own hours", async () => {
    const et = await rr();
    expect(et.kind).toBe("round_robin");
    const cal = await getBookingCalendar(db, et, DAY, NOW);
    expect(cal.slots.map((s) => hhmm(s.start))).toHaveLength(28); // 03:00–16:30 UTC
    expect(cal.freeHosts!.get(utc("04:00").getTime())).toEqual(["ada"]);
    expect(cal.freeHosts!.get(utc("10:00").getTime())).toEqual(["ada", "grace"]);
    expect(cal.freeHosts!.get(utc("12:00").getTime())).toEqual(["grace"]);
    // The band: when anyone works, merged.
    expect(cal.windows.map((w) => [hhmm(w.start), hhmm(w.end)])).toContainEqual(["03:00", "17:00"]);
  });

  it("one host's meeting blocks only that host", async () => {
    expect((await createBooking(db, request("10:00", 9, { username: "grace", slug: "own" }), NOW)).ok).toBe(
      true,
    );
    const cal = await getBookingCalendar(db, await rr(), DAY, NOW);
    expect(cal.freeHosts!.get(utc("10:00").getTime())).toEqual(["ada"]);
  });

  it("the daily limit is each host's own", async () => {
    expect(
      (await updateTeamEventType(db, "ada", teamId, rrId, input({ maxBookingsPerDay: 1 }), ["ada", "grace"]))
        .ok,
    ).toBe(true);
    expect(await book("10:00", 1)).toBe("ada");
    expect(await book("10:30", 2)).toBe("grace");
    expect((await getBookingCalendar(db, await rr(), DAY, NOW)).slots).toEqual([]);
  });

  it("a flat Google busy list with several hosts is refused (it can't say whose it is)", async () => {
    await expect(getBookingCalendar(db, await rr(), DAY, NOW, { externalBusy: [] })).rejects.toThrow(
      /externalBusyByHost/,
    );
  });
});

describe("who gets the booking", () => {
  it("several at the same time spread over the free hosts, then the time is gone", async () => {
    expect(await book("10:00", 1)).toBe("ada"); // a tie: first on the host list
    expect(await book("10:00", 2)).toBe("grace"); // Ada is busy now
    expect(await book("10:00", 3)).toBe("slot_unavailable");
  });

  it("takes turns: fewest bookings first, then whoever waited longest", async () => {
    expect(await book("09:00", 1)).toBe("ada");
    expect(await book("09:30", 2)).toBe("grace");
    expect(await book("10:00", 3)).toBe("ada");
    expect(await book("10:30", 4)).toBe("grace");
  });

  it("only hosts free at that time are candidates, however few bookings the others have", async () => {
    expect(await book("09:00", 1)).toBe("ada"); // Ada 1, Grace 0
    expect(await book("04:00", 2)).toBe("ada"); // only Ada works at 04:00 UTC
    expect(await book("12:00", 3)).toBe("grace"); // only Grace works at 12:00 UTC
  });

  it("cancelled bookings don't count, and neither do ones booked over 30 days ago", async () => {
    expect(await book("09:00", 1)).toBe("ada");
    await db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: NOW })
      .where(eq(bookings.hostId, "ada"));
    expect(await book("09:30", 2)).toBe("ada"); // 0 and 0: the cancelled one isn't an assignment
    expect(await book("10:00", 3)).toBe("grace");
    // Ada's confirmed booking was made 40 days ago: it no longer counts as recent.
    const old = new Date(NOW.getTime() - 40 * 86_400_000);
    await db.update(bookings).set({ createdAt: old }).where(eq(bookings.hostId, "ada"));
    expect(await book("10:30", 4)).toBe("ada");
  });

  it("one host per meeting: their row only, and only their own page loses the time", async () => {
    const r = await createBooking(db, request("10:00", 1), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.assignedTo).toEqual({ name: "Ada", timeZone: "Asia/Dhaka" });
    const rows = await db.select().from(bookingHosts).where(eq(bookingHosts.bookingId, r.booking.id));
    expect(rows.map((h) => h.hostId)).toEqual(["ada"]);
    const own = async (who: string) => {
      const et = (await getPublicEventType(db, who, "own"))!;
      return (await getBookingCalendar(db, et, DAY, NOW)).slots.map((s) => hhmm(s.start));
    };
    expect(await own("ada")).not.toContain("10:00");
    expect(await own("grace")).toContain("10:00");
    // The guest's emails and page name the host they got, not the whole team.
    expect(await getBookingDetails(db, r.booking.id)).toMatchObject({ hostName: "Ada", coHosts: [] });
  });
});

describe("Google Calendar with round-robin", () => {
  const calendar = (busy: Record<string, string[]>, down: string[] = []): ExternalBusy => ({
    async busyTimes(hostId) {
      if (down.includes(hostId)) throw new CalendarUnavailableError("unavailable", "down");
      return (busy[hostId] ?? []).map((t) => ({ start: utc(t), end: utc(t.replace(":00", ":30")) }));
    },
  });

  it("a host's Google meeting blocks only them", async () => {
    expect(await book("10:00", 1, { calendar: calendar({ ada: ["10:00"] }) })).toBe("grace");
  });

  it("a calendar that can't be read: that host sits this one out; nobody readable = unavailable", async () => {
    expect(await book("10:00", 1, { calendar: calendar({}, ["ada"]) })).toBe("grace");
    expect(await book("10:30", 2, { calendar: calendar({}, ["ada", "grace"]) })).toBe("calendar_unavailable");
  });
});

describe("moving a round-robin meeting", () => {
  it("keeps its host: only their free times", async () => {
    const r = await createBooking(db, request("10:00", 1), NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.assignedTo?.name).toBe("Ada");
    // 12:00 UTC is Grace's hours only: not Ada's, so not offered for this meeting.
    expect(await rescheduleBookingByToken(db, r.manageToken, utc("12:00"), NOW)).toEqual({
      ok: false,
      error: "slot_unavailable",
    });
    expect((await rescheduleBookingByToken(db, r.manageToken, utc("04:00"), NOW)).ok).toBe(true);
    expect(await getBookingDetails(db, r.booking.id)).toMatchObject({ hostId: "ada" });
  });
});

describe("the team's page and the kind", () => {
  it("lists round-robin types beside collective ones, with their kind", async () => {
    expect(
      (await createTeamEventType(db, "ada", teamId, input({ slug: "all", title: "All" }), ["ada", "grace"]))
        .ok,
    ).toBe(true);
    const team = (await getPublicTeam(db, "acme"))!;
    expect(team.eventTypes.map((t) => [t.slug, t.kind])).toEqual([
      ["demo", "round_robin"],
      ["all", "collective"],
    ]);
  });
});
