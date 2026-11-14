import { z } from "zod";

/*
 * The events that start background jobs (Day 17).
 *
 * Rule: events carry ids and times, never names, email addresses or tokens.
 * Inngest stores every event and every step's return value (that's how it
 * replays and retries), so whatever goes in here is copied to a third party.
 * A job reads everything else from our database when it runs, which also
 * means it acts on the booking as it is THEN, not as it was when queued.
 */

const instant = z.iso.datetime();

export const BOOKING_CHANGED = "booking/changed";
export const CALENDAR_SYNC = "booking/calendar.sync";
export const CALENDAR_CONNECTED = "calendar/connected";
export const REMINDER_DUE = "booking/reminder.due";

/** A booking was made, moved or cancelled. */
export const bookingChangedData = z.object({
  bookingId: z.uuid(),
  change: z.enum(["created", "rescheduled", "cancelled"]),
  /** The booking's `sequence` after this change. A newer change makes this one's emails moot. */
  sequence: z.number().int().min(0),
  /** Rescheduled only: where the meeting was before. */
  previousStartsAt: instant.optional(),
  /** When it happened. Used as the .ics timestamp, so a retried email is built the same way. */
  at: instant,
});

/** Make the host's Google Calendar match this booking, with retries. */
export const calendarSyncData = z.object({ bookingId: z.uuid() });

/** A host connected Google Calendar: copy their upcoming bookings into it. */
export const calendarConnectedData = z.object({ userId: z.string().min(1) });

/** One reminder, found by the sweep, to send at `remindAt`. */
export const reminderDueData = z.object({
  bookingId: z.uuid(),
  kind: z.enum(["day", "hour"]),
  startsAt: instant,
  remindAt: instant,
});

export type BookingChangedData = z.infer<typeof bookingChangedData>;
export type CalendarSyncData = z.infer<typeof calendarSyncData>;
export type CalendarConnectedData = z.infer<typeof calendarConnectedData>;
export type ReminderDueData = z.infer<typeof reminderDueData>;

export type JobEvent =
  | { name: typeof BOOKING_CHANGED; data: BookingChangedData; id?: string }
  | { name: typeof CALENDAR_SYNC; data: CalendarSyncData; id?: string }
  | { name: typeof CALENDAR_CONNECTED; data: CalendarConnectedData; id?: string }
  | { name: typeof REMINDER_DUE; data: ReminderDueData; id?: string };
