import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { pgErrorCode, PG_EXCLUSION_VIOLATION } from "@/db/errors";
import { bookings, eventTypes, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { addMinutes } from "@/lib/scheduling/intervals";
import { getBookableSlots, getPublicEventType } from "./booking";
import { hashManageToken, manageTokenSchema } from "./manage-token";

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
): Promise<{ ok: true; bookingId: string } | { ok: false; error: ManageError }> {
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
    .returning({ id: bookings.id });
  if (row) return { ok: true, bookingId: row.id };
  // Nothing updated: tell "no such booking" apart from "too late / already cancelled".
  const exists = await getBookingByToken(db, token);
  return { ok: false, error: exists ? "not_changeable" : "not_found" };
}

export type RescheduleResult =
  | { ok: true; bookingId: string; previousStartsAt: Date }
  | { ok: false; error: ManageError | "slot_unavailable" | "slot_taken" };

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
  testHooks: { afterCheck?: () => Promise<void> } = {},
): Promise<RescheduleResult> {
  if (!manageTokenSchema.safeParse(token).success) return { ok: false, error: "not_found" };
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

      const slots = await getBookableSlots(
        tx,
        eventType,
        { start: newStart, end: addMinutes(newStart, 1) },
        now,
        {
          excludeBookingId: current.id,
        },
      );
      if (!slots.some((s) => s.start.getTime() === newStart.getTime())) {
        return { ok: false, error: "slot_unavailable" } as const;
      }
      await testHooks.afterCheck?.();

      await tx
        .update(bookings)
        .set({
          startsAt: newStart,
          endsAt: addMinutes(newStart, eventType.durationMinutes),
          rescheduledAt: now,
          sequence: sql`${bookings.sequence} + 1`,
        })
        .where(eq(bookings.id, current.id));
      return { ok: true, bookingId: current.id, previousStartsAt: fresh.startsAt } as const;
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
  status: "confirmed" | "cancelled";
  cancelledBy: "host" | "guest" | null;
  cancellationReason: string | null;
  rescheduledAt: Date | null;
  eventTitle: string;
  eventColor: string;
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
      status: bookings.status,
      cancelledBy: bookings.cancelledBy,
      cancellationReason: bookings.cancellationReason,
      rescheduledAt: bookings.rescheduledAt,
      eventTitle: eventTypes.title,
      eventColor: eventTypes.color,
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
): Promise<{ ok: true } | { ok: false; error: ManageError }> {
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
    .returning({ id: bookings.id });
  if (row) return { ok: true };
  const [exists] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.hostId, hostId)));
  // Another host's booking looks exactly like a missing one.
  return { ok: false, error: exists ? "not_changeable" : "not_found" };
}
