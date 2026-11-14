import { eq } from "drizzle-orm";
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
 * It runs AFTER the booking is committed (in `after()`), never inside the
 * transaction: Google can't be rolled back with Postgres, and a slow Google
 * mustn't hold the host's lock. If Google fails, the booking stands, marked
 * "failed" so the host sees it and can retry, and Sentry is told.
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
     * may stop those from going out. Anything unexpected is reported and counts
     * as "failed".
     */
    async syncBooking(bookingId: string): Promise<SyncOutcome> {
      try {
        return await sync(bookingId);
      } catch (error) {
        deps.report(error, bookingId);
        return "failed";
      }
    },
  };

  async function sync(bookingId: string): Promise<SyncOutcome> {
    const b = await getBookingDetails(deps.db, bookingId);
    if (!b) return "skipped";
    const [connection] = await deps.db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.userId, b.hostId));
    // No calendar connected: nothing to keep in step. (After a disconnect, an event
    // already in their calendar stays: MeetReady no longer has access to remove it.)
    if (!connection) return "skipped";

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
      return "synced";
    } catch (error) {
      await mark(b.id, { calendarSync: "failed" });
      deps.report(error, b.id);
      return "failed";
    }
  }
}

export type CalendarSync = ReturnType<typeof createCalendarSync>;
