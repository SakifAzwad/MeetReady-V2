import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { bookings, calendarConnections } from "@/db/schema";
import type { Database } from "@/db/types";
import { locationText } from "@/lib/booking-format";
import { getBookingDetails, type BookingDetails } from "../manage-booking";
import { CalendarUnavailableError, googleEventId, type CalendarEvent } from "./google-api";

/*
 * Keeping the host's Google Calendar in step with a booking (Day 16).
 *
 * One operation, syncBooking(), for every case: it reads the booking as it is
 * NOW and makes Google match it.
 *  - confirmed -> the event exists, at the booking's time (create or update);
 *  - cancelled -> the event is gone.
 * So booking, rescheduling, cancelling and the dashboard's Retry button all
 * call the same thing, and running it twice is harmless (idempotent): the
 * event id is derived from the booking id (googleEventId), so a repeated
 * create can't make a second event.
 *
 * It runs AFTER the booking is committed (in a background job since Day 17),
 * never inside the transaction: Google can't be rolled back with Postgres, and
 * a slow Google mustn't hold the host's lock. If Google fails, the booking
 * stands, marked "failed" so the host sees it; the job queue tries again
 * (src/server/jobs), the host can press Retry, and Sentry hears about the
 * failure that's final.
 */

export type CalendarWriter = {
  upsertEvent: (args: {
    accessToken: string;
    calendarId: string;
    event: CalendarEvent;
    exists: boolean;
  }) => Promise<{ meetUrl: string | null }>;
  deleteEvent: (args: { accessToken: string; calendarId: string; bookingId: string }) => Promise<void>;
};

export type CalendarSyncDeps = {
  db: Database;
  appUrl: string;
  getAccessToken: (userId: string, accountId: string) => Promise<string>;
  writer: CalendarWriter;
  report: (error: unknown, bookingId: string) => void;
};

export type SyncOutcome = "synced" | "failed" | "skipped";

/**
 * One try, with what a job queue needs to decide whether to try again (Day 17).
 * `retryable` is false only when trying again can't help: Google refused the
 * host's access (they must reconnect). Timeouts, 5xx, 429 and anything
 * unexpected are worth another try.
 */
export type SyncAttempt =
  { outcome: "synced" | "skipped" } | { outcome: "failed"; error: unknown; retryable: boolean };

export function isRetryableSyncError(error: unknown): boolean {
  return !(error instanceof CalendarUnavailableError && error.kind === "access_lost");
}

/**
 * The event in the HOST's calendar. Only what the host needs to recognise it:
 * the guest's name and email, and a link to the dashboard. The answers to the
 * host's questions and the guest's notes stay in MeetReady (Day 10 rule).
 * No attendees: the guest gets MeetReady's own email and invite, and adding
 * them here would send a second, different invite.
 */
export function toCalendarEvent(b: BookingDetails, appUrl: string): CalendarEvent {
  return {
    bookingId: b.id,
    summary: `${b.eventTitle} with ${b.guestName}`,
    description: [
      "Booked through MeetReady.",
      "",
      `Guest: ${b.guestName} (${b.guestEmail})`,
      `Details and answers: ${appUrl}/dashboard/bookings`,
    ].join("\n"),
    start: b.startsAt,
    end: b.endsAt,
    withMeet: b.locationType === "google_meet",
    location: b.locationType === "google_meet" ? undefined : locationText(b),
  };
}

export function createCalendarSync(deps: CalendarSyncDeps) {
  const mark = (bookingId: string, values: Partial<typeof bookings.$inferInsert>) =>
    deps.db.update(bookings).set(values).where(eq(bookings.id, bookingId));

  return {
    /**
     * Never throws: it runs before the booking emails, and nothing about Google
     * may stop those from going out. Anything unexpected counts as "failed".
     * Reports every failure: used where nobody retries automatically (the
     * dashboard's Retry button, and the inline fallback when there's no queue).
     */
    async syncBooking(bookingId: string): Promise<SyncOutcome> {
      const result = await attemptSync(bookingId);
      if (result.outcome === "failed") deps.report(result.error, bookingId);
      return result.outcome;
    },
    /**
     * Same work, but doesn't report: the job queue (Day 17) tries again and
     * reports only the failure that's final, so one Google outage isn't six
     * Sentry issues. Never throws either.
     */
    attemptSync,
  };

  async function attemptSync(bookingId: string): Promise<SyncAttempt> {
    try {
      return await sync(bookingId);
    } catch (error) {
      return { outcome: "failed", error, retryable: isRetryableSyncError(error) };
    }
  }

  async function sync(bookingId: string): Promise<SyncAttempt> {
    const b = await getBookingDetails(deps.db, bookingId);
    if (!b) return { outcome: "skipped" };
    const [connection] = await deps.db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, b.hostId));
    // No calendar connected: nothing to keep in step. (After a disconnect, an event
    // already in their calendar stays: MeetReady no longer has access to remove it.)
    if (!connection) return { outcome: "skipped" };

    try {
      let accessToken: string;
      try {
        accessToken = await deps.getAccessToken(b.hostId, connection.accountId);
      } catch (cause) {
        throw new CalendarUnavailableError("access_lost", "No valid Google access token", { cause });
      }
      const call = { accessToken, calendarId: connection.calendarId };

      if (b.status === "confirmed") {
        const { meetUrl } = await deps.writer.upsertEvent({
          ...call,
          event: toCalendarEvent(b, deps.appUrl),
          exists: b.calendarEventId !== null,
        });
        await mark(b.id, {
          calendarEventId: googleEventId(b.id),
          // A reschedule's update may come back without the conference: keep the link we have.
          meetUrl: meetUrl ?? b.meetUrl,
          calendarSync: "synced",
        });
      } else {
        await deps.writer.deleteEvent({ ...call, bookingId: b.id });
        await mark(b.id, { calendarSync: "synced" });
      }
      return { outcome: "synced" };
    } catch (error) {
      await mark(b.id, { calendarSync: "failed" });
      return { outcome: "failed", error, retryable: isRetryableSyncError(error) };
    }
  }
}

export type CalendarSync = ReturnType<typeof createCalendarSync>;

/**
 * Bookings a newly connected calendar should get (Day 17 backfill): upcoming,
 * confirmed, and not in Google yet (never written, or the last write failed).
 * Bookings already written stay as they are: if the host deleted one of those
 * events in Google, that was their choice (same rule as upsertGoogleEvent).
 * Capped: a host with hundreds of upcoming meetings gets the next 500 now and
 * the rest as they're rescheduled; one fan-out shouldn't be unbounded.
 */
export async function upcomingBookingsToSync(db: Database, hostId: string, now: Date): Promise<string[]> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.hostId, hostId),
        eq(bookings.status, "confirmed"),
        gt(bookings.startsAt, now),
        or(isNull(bookings.calendarEventId), eq(bookings.calendarSync, "failed")),
      ),
    )
    .orderBy(asc(bookings.startsAt))
    .limit(500);
  return rows.map((r) => r.id);
}
