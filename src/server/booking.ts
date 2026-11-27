import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { pgErrorCode, PG_EXCLUSION_VIOLATION } from "@/db/errors";
import { bookingHosts, bookings, eventTypeHosts, eventTypes, teamMembers, teams, user } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  availabilityWindows,
  generateSlots,
  type BusyInterval,
  type Slot,
} from "@/lib/scheduling/generate-slots";
import { addMinutes, intersectAll, mergeIntervals, type Interval } from "@/lib/scheduling/intervals";
import { pickHost, ROUND_ROBIN_DAYS, type HostLoad } from "@/lib/scheduling/round-robin";
import { addDaysToKey, dateKeyInZone, type DateKey } from "@/lib/scheduling/time";
import type { BookingRequest } from "@/lib/validation/booking";
import { answersSchema, toAnswerSnapshot, type Question } from "@/lib/validation/questions";
import { getAvailability } from "./availability";
import { CalendarUnavailableError, type ExternalBusy } from "./calendar/busy";
import { newManageToken } from "./manage-token";

/*
 * The public booking side. No session here: the guest is anonymous, so the
 * host and event type are looked up from the URL (username + slug), only
 * active event types of onboarded hosts are visible, and every rule is
 * enforced on the server.
 */

/** Someone who takes the meeting (Day 29: a team event type has several). */
export type EventHost = {
  id: string;
  name: string;
  image: string | null;
  timeZone: string;
  username: string;
};

/** What a guest may see about a host's event type. No email, no internal settings. */
export type PublicEventType = {
  id: string;
  hostId: string;
  hostName: string;
  hostImage: string | null;
  username: string;
  hostTimeZone: string;
  title: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  locationType: (typeof eventTypes.$inferSelect)["locationType"];
  color: string;
  /** Custom booking questions. Public: the guest has to see them to answer them. */
  questions: Question[];
  /** Fingerprint of `questions`, sent back with the booking (see questionsVersion()). */
  questionsVersion: string;
  /**
   * Day 29: everyone who takes the meeting, organizer first. A personal event
   * type has one (its host); a collective team event type has all its hosts.
   * hostId / hostName / hostTimeZone / username above are the organizer's: the
   * booking's host_id, and the clock that decides "which day" for its rules.
   */
  hosts: EventHost[];
  /** Day 29: the team that owns it; null for a host's own event type. */
  team: { id: string; slug: string; name: string } | null;
  /**
   * Day 31: how a team's event type uses its hosts. "collective" = every host is in the meeting (the times
   * when ALL are free); "round_robin" = one host per meeting, assigned fairly (the times when ANY is free).
   * Null for a host's own event type.
   */
  kind: "collective" | "round_robin" | null;
  // Booking rules: used by generateSlots on the server, not sent to the browser.
  rules: {
    slotIntervalMinutes: number | null;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minimumNoticeMinutes: number;
    bookingWindowDays: number | null;
    maxBookingsPerDay: number | null;
  };
};

export async function getPublicEventType(
  db: Database,
  username: string,
  slug: string,
): Promise<PublicEventType | null> {
  const [row] = await db
    .select({ et: eventTypes, host: user })
    .from(eventTypes)
    .innerJoin(user, eq(user.id, eventTypes.userId))
    .where(
      and(
        eq(user.username, username.toLowerCase()),
        eq(eventTypes.slug, slug.toLowerCase()),
        eq(eventTypes.isActive, true), // switched-off event types are invisible to guests
      ),
    );
  const hostUsername = row?.host.username;
  if (!row || !hostUsername) return null; // not onboarded yet: no public pages
  const { et, host } = row;
  const only: EventHost = {
    id: host.id,
    name: host.name,
    image: host.image,
    timeZone: host.timeZone,
    username: hostUsername,
  };
  return toPublic(et, [only], null);
}

/**
 * Day 29: a team's event type, /team/{teamSlug}/{slug}. Only active ones
 * (collective, or round-robin since Day 31), and only with at least one host
 * who is still in the team: someone who left never hosts.
 */
export async function getTeamEventType(
  db: Database,
  teamSlug: string,
  slug: string,
): Promise<PublicEventType | null> {
  const [row] = await db
    .select({ et: eventTypes, team: { id: teams.id, slug: teams.slug, name: teams.name } })
    .from(eventTypes)
    .innerJoin(teams, eq(teams.id, eventTypes.teamId))
    .where(
      and(
        eq(teams.slug, teamSlug.toLowerCase()),
        eq(eventTypes.slug, slug.toLowerCase()),
        eq(eventTypes.isActive, true),
      ),
    );
  if (!row) return null;
  const hosts = await teamEventHosts(db, row.et.id, row.team.id);
  if (hosts.length === 0) return null;
  return toPublic(row.et, hosts, row.team);
}

/** A team event type's hosts, organizer first: on its host list AND still in the team, with a username. */
export async function teamEventHosts(
  db: Database,
  eventTypeId: string,
  teamId: string,
): Promise<EventHost[]> {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      timeZone: user.timeZone,
      username: user.username,
    })
    .from(eventTypeHosts)
    .innerJoin(user, eq(user.id, eventTypeHosts.userId))
    .innerJoin(teamMembers, and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, teamId)))
    .where(and(eq(eventTypeHosts.eventTypeId, eventTypeId), isNotNull(user.username)))
    .orderBy(asc(eventTypeHosts.position));
  return rows.map((r) => ({ ...r, username: r.username! }));
}

/**
 * Day 30: the event type of an EXISTING booking, for moving it. Two things
 * differ from the booking page's lookups:
 *
 *  - Found by the booking's event type ID, never by username + slug: since
 *    Day 29 a team's `sync` and its organizer's own `sync` share a slug, and a
 *    lookup by name picked whichever matched (Day 29 story 2).
 *  - The hosts are the MEETING's (its booking_hosts rows), not the event
 *    type's current host list. A move changes when, not who: someone added to
 *    the event type since isn't in this meeting, and someone taken off it
 *    still is. The triggers move exactly these rows, so these are the people
 *    who must be free, or the constraint would refuse a time we offered.
 *
 * Organizer first (the booking's host_id: their timezone decides "which day"),
 * then the event type's order, then by name. Null if the event type is
 * switched off, or the organizer has no username (not onboarded).
 */
export async function eventTypeForBooking(
  db: Database,
  booking: { id: string; eventTypeId: string; hostId: string },
): Promise<PublicEventType | null> {
  const [row] = await db
    .select({ et: eventTypes, team: { id: teams.id, slug: teams.slug, name: teams.name } })
    .from(eventTypes)
    .leftJoin(teams, eq(teams.id, eventTypes.teamId))
    .where(and(eq(eventTypes.id, booking.eventTypeId), eq(eventTypes.isActive, true)));
  if (!row) return null;
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      timeZone: user.timeZone,
      username: user.username,
      position: eventTypeHosts.position,
    })
    .from(bookingHosts)
    .innerJoin(user, eq(user.id, bookingHosts.hostId))
    .leftJoin(
      eventTypeHosts,
      and(
        eq(eventTypeHosts.eventTypeId, booking.eventTypeId),
        eq(eventTypeHosts.userId, bookingHosts.hostId),
      ),
    )
    .where(eq(bookingHosts.bookingId, booking.id));
  const organizer = rows.find((r) => r.id === booking.hostId);
  if (!organizer?.username) return null;
  const others = rows
    .filter((r) => r.id !== booking.hostId)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name));
  // Only the organizer's username is ever used (the booking page's links); co-hosts may have none.
  const hosts = [organizer, ...others].map((h) => ({
    id: h.id,
    name: h.name,
    image: h.image,
    timeZone: h.timeZone,
    username: h.username ?? "",
  }));
  return toPublic(row.et, hosts, row.team ?? null);
}

/** The guest-facing shape, for a host's or a team's event type. */
function toPublic(
  et: typeof eventTypes.$inferSelect,
  hosts: EventHost[],
  team: PublicEventType["team"],
): PublicEventType {
  const organizer = hosts[0]!;
  return {
    id: et.id,
    hostId: organizer.id,
    hostName: organizer.name,
    hostImage: organizer.image,
    username: organizer.username,
    hostTimeZone: organizer.timeZone,
    hosts,
    team,
    kind: et.teamKind ?? null,
    title: et.title,
    slug: et.slug,
    description: et.description,
    durationMinutes: et.durationMinutes,
    locationType: et.locationType,
    color: et.color,
    questions: et.questions,
    questionsVersion: questionsVersion(et.questions),
    rules: {
      slotIntervalMinutes: et.slotIntervalMinutes,
      bufferBeforeMinutes: et.bufferBeforeMinutes,
      bufferAfterMinutes: et.bufferAfterMinutes,
      minimumNoticeMinutes: et.minimumNoticeMinutes,
      bookingWindowDays: et.bookingWindowDays,
      maxBookingsPerDay: et.maxBookingsPerDay,
    },
  };
}

/** A booking request's event type: a host's (username) or a team's (Day 29). */
export function resolveEventType(db: Database, where: { username?: string; team?: string; slug: string }) {
  if (where.team !== undefined) return getTeamEventType(db, where.team, where.slug);
  if (where.username !== undefined) return getPublicEventType(db, where.username, where.slug);
  return Promise.resolve(null);
}

/**
 * A short fingerprint of an event type's questions, like an HTTP ETag. The
 * booking page gets it with the questions and sends it back with the answers;
 * if it no longer matches, the host changed the questions while the guest was
 * typing. Any change counts (a renamed label, a new option), because the
 * guest answered what they saw. Postgres returns jsonb with its keys in a
 * fixed order, so the same questions always give the same fingerprint.
 */
export function questionsVersion(questions: Question[]): string {
  return createHash("sha256").update(JSON.stringify(questions)).digest("hex").slice(0, 16);
}

/**
 * Does this public page exist? `/{username}` needs an onboarded host;
 * `/{username}/{slug}` also needs an active event type with that slug.
 *
 * Called from proxy.ts BEFORE the page renders, because a streamed page has
 * already sent "200 OK" by the time its own lookup (inside <Suspense>) says
 * "not found". One indexed query; the page still does its own lookup.
 */
export async function publicPageExists(db: Database, username: string, slug?: string): Promise<boolean> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .leftJoin(
      eventTypes,
      slug === undefined
        ? sql`false`
        : and(
            eq(eventTypes.userId, user.id),
            eq(eventTypes.slug, slug.toLowerCase()),
            eq(eventTypes.isActive, true),
          ),
    )
    .where(
      and(
        eq(user.username, username.toLowerCase()),
        slug === undefined ? undefined : isNotNull(eventTypes.id),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** A host's public profile: name and active event types. */
export async function getPublicProfile(db: Database, username: string) {
  const [host] = await db
    .select({
      id: user.id,
      name: user.name,
      image: user.image,
      username: user.username,
      timeZone: user.timeZone,
    })
    .from(user)
    .where(and(eq(user.username, username.toLowerCase()), isNotNull(user.username)));
  if (!host?.username) return null;
  const types = await db
    .select({
      title: eventTypes.title,
      slug: eventTypes.slug,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      locationType: eventTypes.locationType,
      color: eventTypes.color,
    })
    .from(eventTypes)
    .where(and(eq(eventTypes.userId, host.id), eq(eventTypes.isActive, true)))
    .orderBy(asc(eventTypes.createdAt));
  return {
    name: host.name,
    image: host.image,
    username: host.username,
    timeZone: host.timeZone,
    eventTypes: types,
  };
}

/**
 * The window of data that slot generation needs for `range`. Host-calendar
 * days can stick out past a UTC range by up to a day on each side, and
 * buffers/daily limits look at whole host days, so it adds a margin. Also the
 * window to ask Google about (Day 15), so both sources cover the same time.
 */
export function busyLoadRange(range: Interval): Interval {
  return { start: addMinutes(range.start, -2 * 24 * 60), end: addMinutes(range.end, 2 * 24 * 60) };
}

export type CalendarOptions = {
  /** When rescheduling: the booking being moved doesn't block its own new time. */
  excludeBookingId?: string;
  /**
   * Busy times from the host's connected calendar (Day 15), already fetched
   * for busyLoadRange(range). Passed in rather than fetched here, so nothing in
   * this file waits on Google, and booking can fetch them BEFORE taking the lock.
   */
  externalBusy?: readonly Interval[];
  /**
   * Day 31, round-robin: each host's own Google busy times. A busy time only blocks ITS host (the others can
   * still take that slot), so the flat list above can't be used with more than one host.
   */
  externalBusyByHost?: ReadonlyMap<string, readonly Interval[]>;
};

/**
 * Free slots for one event type in [range.start, range.end).
 *
 * This is the glue between the database and Day 1's pure generateSlots():
 * load the host's rules, overrides and confirmed bookings, shape them, call it.
 */
export async function getBookableSlots(
  db: Database,
  eventType: PublicEventType,
  range: Interval,
  now: Date,
  options: CalendarOptions = {},
): Promise<Slot[]> {
  return (await getBookingCalendar(db, eventType, range, now, options)).slots;
}

/**
 * Free slots plus the host's working windows for the range. The booking page
 * draws the windows on its daylight band; both come from the same rules, so
 * the band and the slot list can't disagree.
 */
export async function getBookingCalendar(
  db: Database,
  eventType: PublicEventType,
  range: Interval,
  now: Date,
  options: CalendarOptions = {},
): Promise<BookingCalendar> {
  const { start: loadFrom, end: loadTo } = busyLoadRange(range);
  if (
    eventType.kind === "round_robin" &&
    eventType.hosts.length > 1 &&
    options.externalBusy &&
    !options.externalBusyByHost
  ) {
    // A flat list can't say whose busy time is whose: one host's meeting would block everyone's slots.
    throw new Error("Round-robin with several hosts needs externalBusyByHost, not externalBusy");
  }

  // Each host's working hours, in their own timezone. One at a time: inside a
  // transaction every query goes over the same connection anyway.
  const schedules = [];
  for (const h of eventType.hosts) {
    const availability = await getAvailability(db, h.id, {
      overridesFrom: addDaysToKey(dateKeyInZone(loadFrom, h.timeZone), -1),
      overridesTo: addDaysToKey(dateKeyInZone(loadTo, h.timeZone), 1),
    });
    schedules.push({
      timeZone: h.timeZone,
      weeklyRules: availability.rules,
      // Postgres `date` arrives as a "YYYY-MM-DD" string: exactly the DateKey format.
      dateOverrides: availability.overrides.map((o) => ({ ...o, date: o.date as DateKey })),
    });
  }

  // Every active booking of ANY of these hosts (any event type, their own or a
  // team's) blocks time; each carries its own event type's buffers. Read from
  // booking_hosts (Day 29), which lists every host of every meeting. A meeting
  // two hosts share appears once per host: kept once. Only this event type's
  // bookings count towards its maxBookingsPerDay.
  const existing = await db
    .select({
      bookingId: bookings.id,
      hostId: bookingHosts.hostId,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      eventTypeId: bookings.eventTypeId,
      bufferBeforeMinutes: eventTypes.bufferBeforeMinutes,
      bufferAfterMinutes: eventTypes.bufferAfterMinutes,
    })
    .from(bookingHosts)
    .innerJoin(bookings, eq(bookings.id, bookingHosts.bookingId))
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .where(
      and(
        inArray(
          bookingHosts.hostId,
          eventType.hosts.map((h) => h.id),
        ),
        eq(bookingHosts.active, true),
        lt(bookingHosts.startsAt, loadTo),
        gt(bookingHosts.endsAt, loadFrom),
        options.excludeBookingId ? ne(bookings.id, options.excludeBookingId) : undefined,
      ),
    );

  const rules = { durationMinutes: eventType.durationMinutes, ...eventType.rules };
  if (eventType.kind === "round_robin") {
    return roundRobinCalendar(eventType, schedules, existing, range, now, rules, options);
  }

  const seen = new Set<string>();
  const busy: BusyInterval[] = [];
  for (const b of existing) {
    if (seen.has(b.bookingId)) continue;
    seen.add(b.bookingId);
    busy.push({
      start: b.startsAt,
      end: b.endsAt,
      bufferBeforeMinutes: b.bufferBeforeMinutes,
      bufferAfterMinutes: b.bufferAfterMinutes,
      countsTowardDailyLimit: b.eventTypeId === eventType.id,
    });
  }
  // Meetings in the hosts' own calendars: no buffers of their own (the new slot's
  // buffers still keep a gap), and they never count towards a daily limit.
  for (const b of options.externalBusy ?? []) {
    busy.push({ start: b.start, end: b.end, countsTowardDailyLimit: false });
  }

  // The organizer's schedule leads (its timezone decides "which day" for the rules).
  // Day 29: with several hosts, the working windows are the times ALL of them work.
  const host = schedules[0]!;
  const windows =
    schedules.length === 1
      ? availabilityWindows(range, host)
      : intersectAll(schedules.map((schedule) => availabilityWindows(range, schedule)));
  return {
    slots: generateSlots({
      range,
      now,
      host,
      eventType: rules,
      busy,
      windows: schedules.length === 1 ? undefined : windows,
    }),
    windows,
  };
}

export type BookingCalendar = {
  slots: Slot[];
  /** When the hosts work, for the daylight band: everyone at once (collective), anyone (round-robin). */
  windows: Interval[];
  /** Day 31, round-robin only: which hosts are free at each slot (by start time in ms), in host-list order. */
  freeHosts?: Map<number, string[]>;
};

/**
 * Day 31: round-robin free times. Each host is a calendar of their own: their
 * hours in their own timezone, their own meetings with buffers, their own
 * Google busy times, and their own daily limit for this event type. The same
 * pure generateSlots runs once per host, and a time is offered if ANY host
 * has it. Which host gets it is decided at booking (pickHost), not here.
 */
function roundRobinCalendar(
  eventType: PublicEventType,
  schedules: Parameters<typeof availabilityWindows>[1][],
  existing: {
    hostId: string;
    startsAt: Date;
    endsAt: Date;
    eventTypeId: string;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
  }[],
  range: Interval,
  now: Date,
  rules: Parameters<typeof generateSlots>[0]["eventType"],
  options: CalendarOptions,
): BookingCalendar {
  const freeHosts = new Map<number, string[]>();
  const windows: Interval[] = [];
  eventType.hosts.forEach((h, i) => {
    const schedule = schedules[i]!;
    const busy: BusyInterval[] = existing
      .filter((b) => b.hostId === h.id)
      .map((b) => ({
        start: b.startsAt,
        end: b.endsAt,
        bufferBeforeMinutes: b.bufferBeforeMinutes,
        bufferAfterMinutes: b.bufferAfterMinutes,
        // The daily limit is per host: "at most 2 a day" means 2 for each of them.
        countsTowardDailyLimit: b.eventTypeId === eventType.id,
      }));
    const external =
      options.externalBusyByHost?.get(h.id) ??
      (eventType.hosts.length === 1 ? options.externalBusy : []) ??
      [];
    for (const b of external) busy.push({ start: b.start, end: b.end, countsTowardDailyLimit: false });
    for (const slot of generateSlots({ range, now, host: schedule, eventType: rules, busy })) {
      const key = slot.start.getTime();
      freeHosts.set(key, [...(freeHosts.get(key) ?? []), h.id]);
    }
    windows.push(...availabilityWindows(range, schedule));
  });
  const duration = eventType.durationMinutes;
  const slots = [...freeHosts.keys()]
    .sort((a, b) => a - b)
    .map((ms) => ({ start: new Date(ms), end: addMinutes(new Date(ms), duration) }));
  return { slots, windows: mergeIntervals(windows), freeHosts };
}

/**
 * Day 29: the hosts' Google busy times for `range`, all of them together.
 * Any one that can't be read makes the whole answer unreadable
 * (CalendarUnavailableError): a team meeting needs every host to be free.
 */
export async function hostsBusyTimes(
  calendar: ExternalBusy,
  hosts: readonly EventHost[],
  range: Interval,
  mode: Parameters<ExternalBusy["busyTimes"]>[2],
): Promise<Interval[]> {
  const all: Interval[] = [];
  for (const h of hosts) all.push(...(await calendar.busyTimes(h.id, range, mode)));
  return all;
}

/**
 * Day 31: each host's Google busy times, kept apart (round-robin). A host whose
 * calendar can't be read is left out of `readable` instead of failing the
 * whole request: round-robin needs ONE free host, so that host just sits this
 * one out. (Collective needs every host, so it still fails closed: hostsBusyTimes.)
 */
export async function busyByHost(
  calendar: ExternalBusy,
  hosts: readonly EventHost[],
  range: Interval,
  mode: Parameters<ExternalBusy["busyTimes"]>[2],
): Promise<{ byHost: Map<string, Interval[]>; readable: EventHost[] }> {
  const byHost = new Map<string, Interval[]>();
  const readable: EventHost[] = [];
  for (const h of hosts) {
    try {
      byHost.set(h.id, await calendar.busyTimes(h.id, range, mode));
      readable.push(h);
    } catch (error) {
      if (!(error instanceof CalendarUnavailableError)) throw error;
    }
  }
  return { byHost, readable };
}

/**
 * Day 31: the facts pickHost needs, for the hosts free at the requested time.
 * One grouped query over this event type's confirmed bookings, by host.
 */
async function hostLoads(
  db: Database,
  eventType: PublicEventType,
  candidateIds: readonly string[],
  now: Date,
): Promise<HostLoad[]> {
  const since = addMinutes(now, -ROUND_ROBIN_DAYS * 24 * 60);
  const rows = await db
    .select({
      hostId: bookings.hostId,
      recent:
        sql<number>`(count(*) filter (where ${bookings.createdAt} >= ${since.toISOString()}::timestamptz))::int`.mapWith(
          Number,
        ),
      lastAssignedAt: sql<Date>`max(${bookings.createdAt})`.mapWith((v: string | Date) => new Date(v)),
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.eventTypeId, eventType.id),
        eq(bookings.status, "confirmed"),
        inArray(bookings.hostId, [...candidateIds]),
      ),
    )
    .groupBy(bookings.hostId);
  const byId = new Map(rows.map((r) => [r.hostId, r]));
  return candidateIds.map((id) => ({
    id,
    position: eventType.hosts.findIndex((h) => h.id === id),
    recent: byId.get(id)?.recent ?? 0,
    lastAssignedAt: byId.get(id)?.lastAssignedAt ?? null,
  }));
}

export type BookingResult =
  | {
      ok: true;
      booking: { id: string; startsAt: Date; endsAt: Date };
      manageToken: string;
      /** Day 31: who a round-robin booking went to (the guest's confirmation names them). */
      assignedTo?: { name: string; timeZone: string };
    }
  | { ok: false; error: "not_found" | "slot_unavailable" | "slot_taken" }
  /** The host's calendar couldn't be checked, so the time can't be confirmed (fail closed, Day 15). */
  | { ok: false; error: "calendar_unavailable" }
  /** The guest's answers break the rules: first message per question id ("" = not about one question). */
  | { ok: false; error: "invalid_answers"; answerErrors: Record<string, string> }
  /** The form was built from older questions: here are the current ones. */
  | { ok: false; error: "questions_changed"; questions: Question[]; questionsVersion: string };

/**
 * Books a slot. Three layers, each covering what the one before can't.
 * (Day 31, round-robin: the same layers over every host in the pool, then
 * pickHost chooses among those free at that time, under the locks.)
 *
 *  1. Re-check: the requested start must be a slot generateSlots() would offer
 *     right now (hours, overrides, notice, window, buffers, daily limit). The
 *     browser's slot list is only a suggestion; a guest can send any time.
 *
 *  2. Per-host lock: two guests booking the same host at the same moment would
 *     both pass the re-check (neither sees the other's uncommitted booking).
 *     pg_advisory_xact_lock makes bookings for ONE host take turns; the second
 *     re-checks after the first commits and sees it. Other hosts aren't blocked.
 *     The lock is released automatically when the transaction ends.
 *
 *  3. Exclusion constraint (Day 1): if anything ever skips 1–2, Postgres still
 *     refuses two overlapping confirmed bookings (SQLSTATE 23P01).
 *
 * With a connected Google Calendar (Day 15), its busy times are fetched LIVE
 * first, outside the transaction: a network call must not hold a database
 * connection and this host's lock for up to 2.5 seconds. If Google can't be
 * read, the booking is refused (fail closed): a meeting booked on top of a
 * real one is worse than "try again in a minute".
 */
export async function createBooking(
  db: Database,
  request: BookingRequest,
  now: Date,
  options: {
    /** The host's calendar. Omitted in tests that don't need one. */
    calendar?: ExternalBusy;
    /**
     * Test seam: runs after the re-check, before the insert. Lets the race tests
     * hold two bookings at exactly the dangerous moment to prove the lock is
     * needed. Never passed in production code.
     */
    afterCheck?: () => Promise<void>;
    /**
     * Encrypts the manage token for this booking (Day 17, see sealManageToken).
     * Passed by the booking action; tests that don't send emails leave it out.
     */
    sealToken?: (token: string, bookingId: string) => string;
    /**
     * Day 22: the HOST is booking, through an AI assistant (MCP). Same rules
     * and the same three layers; only the guest's questions are skipped (they
     * are for guests to answer), and the booking records who made it.
     */
    byAssistant?: { clientId: string };
  } = {},
): Promise<BookingResult> {
  const window = { start: request.startsAt, end: addMinutes(request.startsAt, 1) };
  let externalBusy: Interval[] = [];
  // Day 31, round-robin: each host's own busy times, and who could be read (the others sit this one out).
  let byHost: Map<string, Interval[]> | undefined;
  if (options.calendar) {
    const found = await resolveEventType(db, request);
    if (!found) return { ok: false, error: "not_found" };
    try {
      if (found.kind === "round_robin") {
        const read = await busyByHost(options.calendar, found.hosts, busyLoadRange(window), "live");
        if (read.readable.length === 0) return { ok: false, error: "calendar_unavailable" };
        byHost = read.byHost;
      } else {
        externalBusy = await hostsBusyTimes(options.calendar, found.hosts, busyLoadRange(window), "live");
      }
    } catch (error) {
      if (error instanceof CalendarUnavailableError) return { ok: false, error: "calendar_unavailable" };
      throw error;
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const found = await resolveEventType(tx, request);
      if (!found) return { ok: false, error: "not_found" } as const;
      const roundRobin = found.kind === "round_robin";
      // Round-robin: only the hosts whose calendar was read take part (all of them when there's no calendar).
      const eventType =
        roundRobin && byHost ? { ...found, hosts: found.hosts.filter((h) => byHost.has(h.id)) } : found;
      if (eventType.hosts.length === 0) return { ok: false, error: "calendar_unavailable" } as const;
      // Day 29: an assistant books for its host's own event types only.
      if (options.byAssistant && eventType.team) return { ok: false, error: "not_found" } as const;

      // Answers are checked against the questions as they are NOW, before the
      // lock: a bad request shouldn't make other guests of this host wait.
      // A host booking through an assistant answers none (the questions are for guests).
      const questions = options.byAssistant ? [] : eventType.questions;
      if (
        !options.byAssistant &&
        request.questionsVersion !== undefined &&
        request.questionsVersion !== eventType.questionsVersion
      ) {
        return {
          ok: false,
          error: "questions_changed",
          questions: eventType.questions,
          questionsVersion: eventType.questionsVersion,
        } as const;
      }
      const answers = answersSchema(questions).safeParse(options.byAssistant ? {} : (request.answers ?? {}));
      if (!answers.success) {
        const answerErrors: Record<string, string> = {};
        for (const issue of answers.error.issues) answerErrors[String(issue.path[0] ?? "")] ??= issue.message;
        return { ok: false, error: "invalid_answers", answerErrors } as const;
      }

      // (2) Take each host's lock before reading their bookings. Day 29: a team
      // meeting needs every host's, ALWAYS in the same order (sorted ids). Two
      // bookings sharing hosts, each holding one lock and waiting for the
      // other's, would deadlock; in one fixed order the second simply waits.
      await lockHosts(
        tx,
        eventType.hosts.map((h) => h.id),
      );

      // (1) Is this exact start still offered? Ask for slots in a 1-minute window around it.
      const start = request.startsAt;
      const calendar = await getBookingCalendar(
        tx,
        eventType,
        window,
        now,
        roundRobin ? { externalBusyByHost: byHost } : { externalBusy },
      );
      if (!calendar.slots.some((s) => s.start.getTime() === start.getTime())) {
        return { ok: false, error: "slot_unavailable" } as const;
      }
      // Day 31, round-robin: of the hosts free at this time, the one pickHost chooses. Counted under the
      // locks above, so two bookings at once can't both see the same "fewest" and both pick that host.
      let hostId = eventType.hostId;
      let assignedTo: { name: string; timeZone: string } | undefined;
      if (roundRobin) {
        const free = calendar.freeHosts?.get(start.getTime()) ?? [];
        hostId = pickHost(await hostLoads(tx, eventType, free, now)) ?? hostId;
        const host = eventType.hosts.find((h) => h.id === hostId)!;
        assignedTo = { name: host.name, timeZone: host.timeZone };
      }
      await options.afterCheck?.();

      // The raw token goes back to the caller and is never stored in the clear:
      // only its hash (to check it) and an encrypted copy (to email it again later).
      // The id is made here, not by the database, because the encryption is bound to it.
      const { token, hash } = newManageToken();
      const id = randomUUID();
      const [row] = await tx
        .insert(bookings)
        .values({
          id,
          manageTokenHash: hash,
          manageTokenEncrypted: options.sealToken?.(token, id) ?? null,
          eventTypeId: eventType.id,
          // The organizer (collective, personal), or the assigned host (round-robin).
          hostId,
          guestName: request.guestName,
          guestEmail: request.guestEmail,
          guestTimeZone: request.guestTimeZone,
          guestNotes: request.guestNotes || null,
          // A snapshot: label and type are copied, so later edits to the questions don't change it.
          answers: toAnswerSnapshot(questions, answers.data),
          startsAt: start,
          endsAt: addMinutes(start, eventType.durationMinutes),
          ...(options.byAssistant
            ? { source: "assistant" as const, createdByClient: options.byAssistant.clientId }
            : {}),
        })
        .returning({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt });
      // The organizer's booking_hosts row came from a trigger; the other hosts are added here.
      // Their times come from the booking too (another trigger), and the no-overlap constraint
      // on booking_hosts refuses the whole booking if any of them is already busy then.
      // Round-robin meetings have one host: the trigger's row is the only one.
      const others = roundRobin ? [] : eventType.hosts.slice(1);
      if (others.length > 0) {
        await tx
          .insert(bookingHosts)
          .values(others.map((h) => ({ bookingId: id, hostId: h.id, ...FILLED_BY_TRIGGER })));
      }
      return { ok: true, booking: row!, manageToken: token, ...(assignedTo && { assignedTo }) } as const;
    });
  } catch (error) {
    // (3) An error aborts the transaction, so it's caught out here, after rollback.
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) return { ok: false, error: "slot_taken" };
    throw error;
  }
}

/**
 * Day 29: one transaction-scoped advisory lock per host, in sorted order (the
 * deadlock rule above). Exported for the reschedule path, which needs the same.
 */
export async function lockHosts(db: Database, hostIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(hostIds)].sort()) {
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
  }
}

/** booking_hosts' times and "active" are copied from the booking by a trigger; these are never kept. */
const FILLED_BY_TRIGGER = { startsAt: new Date(0), endsAt: new Date(0), active: false };

/**
 * Day 29: a team's public page, /team/{slug}: its name and the event types a
 * guest can book now (active, with at least one host still in the team;
 * collective or, since Day 31, round-robin). Null if there's no such team.
 */
export async function getPublicTeam(db: Database, slug: string) {
  const [team] = await db
    .select({ id: teams.id, slug: teams.slug, name: teams.name })
    .from(teams)
    .where(eq(teams.slug, slug.toLowerCase()));
  if (!team) return null;
  const types = await db
    .select({
      id: eventTypes.id,
      title: eventTypes.title,
      slug: eventTypes.slug,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      locationType: eventTypes.locationType,
      color: eventTypes.color,
      kind: eventTypes.teamKind,
    })
    .from(eventTypes)
    .where(and(eq(eventTypes.teamId, team.id), eq(eventTypes.isActive, true)))
    .orderBy(asc(eventTypes.createdAt));
  const withHosts = [];
  for (const t of types) {
    const hosts = await teamEventHosts(db, t.id, team.id);
    if (hosts.length > 0)
      withHosts.push({ ...t, hosts: hosts.map((h) => ({ name: h.name, image: h.image })) });
  }
  return { ...team, eventTypes: withHosts };
}

/** proxy.ts's check for /team/{slug} and /team/{slug}/{event} (a real 404 before streaming starts). */
export async function teamPageExists(db: Database, teamSlug: string, eventSlug?: string): Promise<boolean> {
  if (eventSlug === undefined) {
    const [row] = await db.select({ id: teams.id }).from(teams).where(eq(teams.slug, teamSlug.toLowerCase()));
    return row !== undefined;
  }
  return (await getTeamEventType(db, teamSlug, eventSlug)) !== null;
}
