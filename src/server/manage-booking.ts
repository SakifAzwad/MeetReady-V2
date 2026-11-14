import { and, asc, desc, eq, gt, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { pgErrorCode, PG_EXCLUSION_VIOLATION } from "@/db/errors";
import { bookings, eventTypes, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { addMinutes, subtractInterval } from "@/lib/scheduling/intervals";
import type { BookingAnswer } from "@/lib/validation/questions";
import { busyLoadRange, getBookableSlots, getPublicEventType } from "./booking";
import { CalendarUnavailableError, type ExternalBusy } from "./calendar/busy";
import { hashManageToken, manageTokenSchema, openManageToken } from "./manage-token";

/*
 * After a booking exists: the guest manages it with their token, the host
 * manages it from the dashboard. Two kinds of authorisation, same habit as
 * everywhere: who you are decides the WHERE clause.
 *   guest -> WHERE manage_token_hash = sha256(token)
 *   host  -> WHERE host_id = session user id
 */

/** Everything the manage page and the emails need about one booking. */
export type BookingDetails = {
  id: string;
  status: "confirmed" | "cancelled";
  startsAt: Date;
  endsAt: Date;
  sequence: number;
  guestName: string;
  guestEmail: string;
  guestTimeZone: string;
  guestNotes: string | null;
  answers: BookingAnswer[];
  cancelledBy: "host" | "guest" | null;
  cancellationReason: string | null;
  eventTypeId: string;
  eventTitle: string;
  eventSlug: string;
  eventActive: boolean;
  durationMinutes: number;
  locationType: (typeof eventTypes.$inferSelect)["locationType"];
  locationValue: string | null;
  hostId: string;
  hostName: string;
  hostEmail: string;
  hostTimeZone: string;
  hostUsername: string | null;
  /** Day 16: the host's Google Calendar event, its Meet link, and whether Google matches. */
  calendarEventId: string | null;
  meetUrl: string | null;
  calendarSync: "synced" | "failed" | null;
};

const detailsColumns = {
  id: bookings.id,
  status: bookings.status,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  sequence: bookings.sequence,
  guestName: bookings.guestName,
  guestEmail: bookings.guestEmail,
  guestTimeZone: bookings.guestTimeZone,
  guestNotes: bookings.guestNotes,
  answers: bookings.answers,
  cancelledBy: bookings.cancelledBy,
  cancellationReason: bookings.cancellationReason,
  eventTypeId: eventTypes.id,
  eventTitle: eventTypes.title,
  eventSlug: eventTypes.slug,
  eventActive: eventTypes.isActive,
  durationMinutes: eventTypes.durationMinutes,
  locationType: eventTypes.locationType,
  locationValue: eventTypes.locationValue,
  hostId: user.id,
  hostName: user.name,
  hostEmail: user.email,
  hostTimeZone: user.timeZone,
  hostUsername: user.username,
  calendarEventId: bookings.calendarEventId,
  meetUrl: bookings.meetUrl,
  calendarSync: bookings.calendarSync,
};

function selectDetails(db: Database) {
  return db
    .select(detailsColumns)
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(user, eq(user.id, bookings.hostId));
}

export async function getBookingDetails(db: Database, bookingId: string): Promise<BookingDetails | null> {
  if (!z.uuid().safeParse(bookingId).success) return null;
  const [row] = await selectDetails(db).where(eq(bookings.id, bookingId));
  return row ?? null;
}

/**
 * The guest's manage token for a booking, for an email sent by a background
 * job (Day 17). Null when there's no encrypted copy (made before Day 17) or it
 * can't be opened (e.g. the secret was rotated): the email then goes without
 * the link. Kept out of BookingDetails on purpose: the secret only leaves the
 * database where an email is being written.
 */
export async function readManageToken(
  db: Database,
  bookingId: string,
  secret: string,
): Promise<string | null> {
  const [row] = await db
    .select({ sealed: bookings.manageTokenEncrypted })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.sealed ? openManageToken(row.sealed, bookingId, secret) : null;
}

// ─── Guest: by manage token ─────────────────────────────────────────────────────

export async function getBookingByToken(db: Database, token: string): Promise<BookingDetails | null> {
  // Malformed tokens never reach the database.
  if (!manageTokenSchema.safeParse(token).success) return null;
  const [row] = await selectDetails(db).where(eq(bookings.manageTokenHash, hashManageToken(token)));
  return row ?? null;
}

export type ManageError = "not_found" | "not_changeable";

/** Only confirmed meetings that haven't started can be cancelled or moved. */
const changeable = (now: Date) => and(eq(bookings.status, "confirmed"), gt(bookings.startsAt, now));

export async function cancelBookingByToken(
  db: Database,
  token: string,
  reason: string | null,
  now: Date,
): Promise<{ ok: true; bookingId: string; sequence: number } | { ok: false; error: ManageError }> {
  if (!manageTokenSchema.safeParse(token).success) return { ok: false, error: "not_found" };
  const hash = hashManageToken(token);
  // One UPDATE with the conditions in the WHERE: no "read, check, then write"
  // gap in which another request could change the row.
  const [row] = await db
    .update(bookings)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: "guest",
      cancellationReason: reason,
      sequence: sql`${bookings.sequence} + 1`,
    })
    .where(and(eq(bookings.manageTokenHash, hash), changeable(now)))
    .returning({ id: bookings.id, sequence: bookings.sequence });
  if (row) return { ok: true, bookingId: row.id, sequence: row.sequence };
  // Nothing updated: tell "no such booking" apart from "too late / already cancelled".
  const exists = await getBookingByToken(db, token);
  return { ok: false, error: exists ? "not_changeable" : "not_found" };
}

export type RescheduleResult =
  | { ok: true; bookingId: string; previousStartsAt: Date; sequence: number }
  | { ok: false; error: ManageError | "slot_unavailable" | "slot_taken" | "calendar_unavailable" };

/**
 * Moves a booking to a new start. Same three layers as createBooking:
 * per-host lock, re-check with generateSlots (ignoring this booking, so a
 * meeting can move by 15 minutes even though its old time overlaps the new),
 * and the exclusion constraint as the last guard.
 *
 * The booking keeps its id and manage link; `sequence` goes up so calendar
 * apps treat the new invite as an update of the old one.
 */
export async function rescheduleBookingByToken(
  db: Database,
  token: string,
  newStart: Date,
  now: Date,
  /** Same as createBooking: the host's calendar (checked live, fail closed), and the race-test seam. */
  options: {
    calendar?: ExternalBusy;
    afterCheck?: () => Promise<void>;
    /**
     * Day 17: bookings made before Day 17 have no encrypted copy of the token.
     * The guest just proved they hold it, so it's saved now (only if missing),
     * and later emails about this booking can carry the link again.
     */
    sealToken?: (token: string, bookingId: string) => string;
  } = {},
): Promise<RescheduleResult> {
  if (!manageTokenSchema.safeParse(token).success) return { ok: false, error: "not_found" };
  const window = { start: newStart, end: addMinutes(newStart, 1) };
  let externalBusy: { start: Date; end: Date }[] = [];
  if (options.calendar) {
    const current = await getBookingByToken(db, token);
    if (!current) return { ok: false, error: "not_found" };
    try {
      // The booking's own event is in the host's calendar (Day 16): it mustn't block its own move.
      externalBusy = subtractInterval(
        await options.calendar.busyTimes(current.hostId, busyLoadRange(window), "live"),
        { start: current.startsAt, end: current.endsAt },
      );
    } catch (error) {
      if (error instanceof CalendarUnavailableError) return { ok: false, error: "calendar_unavailable" };
      throw error;
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const current = await getBookingByToken(tx, token);
      if (!current) return { ok: false, error: "not_found" } as const;

      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${current.hostId}, 0))`);

      // Re-read under the lock: the guest may have cancelled in another tab.
      const [fresh] = await tx
        .select({ status: bookings.status, startsAt: bookings.startsAt })
        .from(bookings)
        .where(eq(bookings.id, current.id));
      if (!fresh || fresh.status !== "confirmed" || fresh.startsAt <= now) {
        return { ok: false, error: "not_changeable" } as const;
      }

      // The event type must still be bookable (active, host onboarded).
      const eventType = current.hostUsername
        ? await getPublicEventType(tx, current.hostUsername, current.eventSlug)
        : null;
      if (!eventType) return { ok: false, error: "not_changeable" } as const;

      const slots = await getBookableSlots(tx, eventType, window, now, {
        excludeBookingId: current.id,
        externalBusy,
      });
      if (!slots.some((s) => s.start.getTime() === newStart.getTime())) {
        return { ok: false, error: "slot_unavailable" } as const;
      }
      await options.afterCheck?.();

      const sealed = options.sealToken?.(token, current.id);
      const [moved] = await tx
        .update(bookings)
        .set({
          startsAt: newStart,
          endsAt: addMinutes(newStart, eventType.durationMinutes),
          rescheduledAt: now,
          sequence: sql`${bookings.sequence} + 1`,
          ...(sealed && { manageTokenEncrypted: sql`coalesce(${bookings.manageTokenEncrypted}, ${sealed})` }),
        })
        .where(eq(bookings.id, current.id))
        .returning({ sequence: bookings.sequence });
      return {
        ok: true,
        bookingId: current.id,
        previousStartsAt: fresh.startsAt,
        sequence: moved!.sequence,
      } as const;
    });
  } catch (error) {
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) return { ok: false, error: "slot_taken" };
    throw error;
  }
}

// ─── Host: by session ───────────────────────────────────────────────────────────

export type BookingsView = "upcoming" | "past" | "cancelled";

export type HostBookingRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  guestName: string;
  guestEmail: string;
  guestTimeZone: string;
  guestNotes: string | null;
  answers: BookingAnswer[];
  status: "confirmed" | "cancelled";
  cancelledBy: "host" | "guest" | null;
  cancellationReason: string | null;
  rescheduledAt: Date | null;
  eventTitle: string;
  eventColor: string;
  meetUrl: string | null;
  calendarSync: "synced" | "failed" | null;
};

export async function listHostBookings(
  db: Database,
  hostId: string,
  view: BookingsView,
  now: Date,
  limit = 100,
): Promise<HostBookingRow[]> {
  const base = db
    .select({
      id: bookings.id,
      startsAt: bookings.startsAt,
      endsAt: bookings.endsAt,
      guestName: bookings.guestName,
      guestEmail: bookings.guestEmail,
      guestTimeZone: bookings.guestTimeZone,
      guestNotes: bookings.guestNotes,
      answers: bookings.answers,
      status: bookings.status,
      cancelledBy: bookings.cancelledBy,
      cancellationReason: bookings.cancellationReason,
      rescheduledAt: bookings.rescheduledAt,
      eventTitle: eventTypes.title,
      eventColor: eventTypes.color,
      meetUrl: bookings.meetUrl,
      calendarSync: bookings.calendarSync,
    })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId));

  const mine = eq(bookings.hostId, hostId);
  switch (view) {
    case "upcoming": // still running counts as upcoming
      return base
        .where(and(mine, eq(bookings.status, "confirmed"), gt(bookings.endsAt, now)))
        .orderBy(asc(bookings.startsAt))
        .limit(limit);
    case "past":
      return base
        .where(and(mine, eq(bookings.status, "confirmed"), lte(bookings.endsAt, now)))
        .orderBy(desc(bookings.startsAt))
        .limit(limit);
    case "cancelled":
      return base
        .where(and(mine, eq(bookings.status, "cancelled")))
        .orderBy(desc(bookings.startsAt))
        .limit(limit);
  }
}

export async function cancelBookingAsHost(
  db: Database,
  hostId: string,
  bookingId: string,
  reason: string | null,
  now: Date,
): Promise<{ ok: true; sequence: number } | { ok: false; error: ManageError }> {
  if (!z.uuid().safeParse(bookingId).success) return { ok: false, error: "not_found" };
  const [row] = await db
    .update(bookings)
    .set({
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: "host",
      cancellationReason: reason,
      sequence: sql`${bookings.sequence} + 1`,
    })
    .where(and(eq(bookings.id, bookingId), eq(bookings.hostId, hostId), changeable(now)))
    .returning({ sequence: bookings.sequence });
  if (row) return { ok: true, sequence: row.sequence };
  const [exists] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.hostId, hostId)));
  // Another host's booking looks exactly like a missing one.
  return { ok: false, error: exists ? "not_changeable" : "not_found" };
}

/**
 * Confirmed bookings that overlap [from, to), for the dashboard's week view.
 * Overlap, not "starts inside": a meeting from 23:30 to 00:30 belongs to both days.
 * Scoped to the host like every other host query.
 */
export async function listHostBookingsBetween(
  db: Database,
  hostId: string,
  range: { start: Date; end: Date },
): Promise<{ startsAt: Date; endsAt: Date }[]> {
  return db
    .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.hostId, hostId),
        eq(bookings.status, "confirmed"),
        lt(bookings.startsAt, range.end),
        gt(bookings.endsAt, range.start),
      ),
    )
    .orderBy(asc(bookings.startsAt));
}
