import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNotNull, lt, ne, sql } from "drizzle-orm";
import { pgErrorCode, PG_EXCLUSION_VIOLATION } from "@/db/errors";
import { bookings, eventTypes, user } from "@/db/schema";
import type { Database } from "@/db/types";
import {
  availabilityWindows,
  generateSlots,
  type BusyInterval,
  type Slot,
} from "@/lib/scheduling/generate-slots";
import { addMinutes, type Interval } from "@/lib/scheduling/intervals";
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
  return {
    id: et.id,
    hostId: host.id,
    hostName: host.name,
    hostImage: host.image,
    username: hostUsername,
    hostTimeZone: host.timeZone,
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
): Promise<{ slots: Slot[]; windows: Interval[] }> {
  const tz = eventType.hostTimeZone;
  const { start: loadFrom, end: loadTo } = busyLoadRange(range);

  const availability = await getAvailability(db, eventType.hostId, {
    overridesFrom: addDaysToKey(dateKeyInZone(loadFrom, tz), -1),
    overridesTo: addDaysToKey(dateKeyInZone(loadTo, tz), 1),
  });

  // Every confirmed booking of this HOST (any event type) blocks time; each
  // carries its own event type's buffers. Only this event type's bookings
  // count towards its maxBookingsPerDay.
  const existing = await db
    .select({
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      eventTypeId: bookings.eventTypeId,
      bufferBeforeMinutes: eventTypes.bufferBeforeMinutes,
      bufferAfterMinutes: eventTypes.bufferAfterMinutes,
    })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .where(
      and(
        eq(bookings.hostId, eventType.hostId),
        eq(bookings.status, "confirmed"),
        lt(bookings.startsAt, loadTo),
        gt(bookings.endsAt, loadFrom),
        options.excludeBookingId ? ne(bookings.id, options.excludeBookingId) : undefined,
      ),
    );

  const busy: BusyInterval[] = existing.map((b) => ({
    start: b.startsAt,
    end: b.endsAt,
    bufferBeforeMinutes: b.bufferBeforeMinutes,
    bufferAfterMinutes: b.bufferAfterMinutes,
    countsTowardDailyLimit: b.eventTypeId === eventType.id,
  }));
  // Meetings in the host's own calendar: no buffers of their own (the new slot's
  // buffers still keep a gap), and they never count towards a daily limit.
  for (const b of options.externalBusy ?? []) {
    busy.push({ start: b.start, end: b.end, countsTowardDailyLimit: false });
  }

  const host = {
    timeZone: tz,
    weeklyRules: availability.rules,
    // Postgres `date` arrives as a "YYYY-MM-DD" string: exactly the DateKey format.
    dateOverrides: availability.overrides.map((o) => ({ ...o, date: o.date as DateKey })),
  };
  return {
    slots: generateSlots({
      range,
      now,
      host,
      eventType: { durationMinutes: eventType.durationMinutes, ...eventType.rules },
      busy,
    }),
    windows: availabilityWindows(range, host),
  };
}

export type BookingResult =
  | { ok: true; booking: { id: string; startsAt: Date; endsAt: Date }; manageToken: string }
  | { ok: false; error: "not_found" | "slot_unavailable" | "slot_taken" }
  /** The host's calendar couldn't be checked, so the time can't be confirmed (fail closed, Day 15). */
  | { ok: false; error: "calendar_unavailable" }
  /** The guest's answers break the rules: first message per question id ("" = not about one question). */
  | { ok: false; error: "invalid_answers"; answerErrors: Record<string, string> }
  /** The form was built from older questions: here are the current ones. */
  | { ok: false; error: "questions_changed"; questions: Question[]; questionsVersion: string };

/**
 * Books a slot. Three layers, each covering what the one before can't:
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
  } = {},
): Promise<BookingResult> {
  const window = { start: request.startsAt, end: addMinutes(request.startsAt, 1) };
  let externalBusy: Interval[] = [];
  if (options.calendar) {
    const host = await getPublicEventType(db, request.username, request.slug);
    if (!host) return { ok: false, error: "not_found" };
    try {
      externalBusy = await options.calendar.busyTimes(host.hostId, busyLoadRange(window), "live");
    } catch (error) {
      if (error instanceof CalendarUnavailableError) return { ok: false, error: "calendar_unavailable" };
      throw error;
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const eventType = await getPublicEventType(tx, request.username, request.slug);
      if (!eventType) return { ok: false, error: "not_found" } as const;

      // Answers are checked against the questions as they are NOW, before the
      // lock: a bad request shouldn't make other guests of this host wait.
      if (request.questionsVersion !== undefined && request.questionsVersion !== eventType.questionsVersion) {
        return {
          ok: false,
          error: "questions_changed",
          questions: eventType.questions,
          questionsVersion: eventType.questionsVersion,
        } as const;
      }
      const answers = answersSchema(eventType.questions).safeParse(request.answers ?? {});
      if (!answers.success) {
        const answerErrors: Record<string, string> = {};
        for (const issue of answers.error.issues) answerErrors[String(issue.path[0] ?? "")] ??= issue.message;
        return { ok: false, error: "invalid_answers", answerErrors } as const;
      }

      // (2) Take this host's lock before reading their bookings.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${eventType.hostId}, 0))`);

      // (1) Is this exact start still offered? Ask for slots in a 1-minute window around it.
      const start = request.startsAt;
      const slots = await getBookableSlots(tx, eventType, window, now, { externalBusy });
      if (!slots.some((s) => s.start.getTime() === start.getTime())) {
        return { ok: false, error: "slot_unavailable" } as const;
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
          hostId: eventType.hostId,
          guestName: request.guestName,
          guestEmail: request.guestEmail,
          guestTimeZone: request.guestTimeZone,
          guestNotes: request.guestNotes || null,
          // A snapshot: label and type are copied, so later edits to the questions don't change it.
          answers: toAnswerSnapshot(eventType.questions, answers.data),
          startsAt: start,
          endsAt: addMinutes(start, eventType.durationMinutes),
        })
        .returning({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt });
      return { ok: true, booking: row!, manageToken: token } as const;
    });
  } catch (error) {
    // (3) An error aborts the transaction, so it's caught out here, after rollback.
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) return { ok: false, error: "slot_taken" };
    throw error;
  }
}
