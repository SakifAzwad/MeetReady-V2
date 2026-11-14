import { cron, eventType, type GetStepTools, type Inngest } from "inngest";
import { scrubError } from "@/lib/monitoring";
import {
  BOOKING_CHANGED,
  bookingChangedData,
  CALENDAR_CONNECTED,
  CALENDAR_SYNC,
  calendarConnectedData,
  calendarSyncData,
  REMINDER_DUE,
  reminderDueData,
} from "./events";
import {
  onBookingChanged,
  onCalendarConnected,
  onCalendarSync,
  onReminderDue,
  onReminderSweep,
  type JobDeps,
  type Steps,
} from "./handlers";

/*
 * The Inngest functions (Day 17): configuration around the handlers.
 * What they do is in handlers.ts; this file says WHEN they run, how often
 * they retry, and what may run at the same time.
 */

// Typed triggers: Inngest checks each event against the same Zod schema (Standard Schema).
const bookingChanged = eventType(BOOKING_CHANGED, { schema: bookingChangedData });
const calendarSync = eventType(CALENDAR_SYNC, { schema: calendarSyncData });
const calendarConnected = eventType(CALENDAR_CONNECTED, { schema: calendarConnectedData });
const reminderDue = eventType(REMINDER_DUE, { schema: reminderDueData });

/**
 * One booking's jobs take turns, across both functions that touch Google
 * (backlog item from Day 16): two quick reschedules can't have their Google
 * writes overtake each other and leave the older time in the calendar. Each
 * write also reads the booking as it is now, so whichever runs last writes
 * the latest time. "env" scope + the same key = one queue per booking shared
 * by both functions; other bookings aren't held up.
 */
const ONE_AT_A_TIME_PER_BOOKING = {
  key: '"booking-" + event.data.bookingId',
  limit: 1,
  scope: "env",
} as const;

export function createJobFunctions(inngest: Inngest, deps: JobDeps) {
  const steps = (step: GetStepTools<Inngest>): Steps => ({
    // A failed step's error is stored by Inngest: scrubbed first (database errors carry guest data).
    run: (id, fn) =>
      step.run(id, async () => {
        try {
          return await fn();
        } catch (error) {
          throw scrubError(error);
        }
      }) as never,
    sleepUntil: (id, until) => step.sleepUntil(id, until),
    sendEvent: async (id, events) => {
      await step.sendEvent(id, events);
    },
  });

  /** Called once, after the last retry has failed. */
  const reportFinal =
    (area: string) =>
    ({ error, event }: { error: Error; event: { data: { event: { data?: unknown } } } }) => {
      const data = event.data.event.data as { bookingId?: string } | undefined;
      deps.report(error, { area, bookingId: data?.bookingId });
    };

  return [
    inngest.createFunction(
      {
        id: "booking-changed",
        triggers: [bookingChanged],
        concurrency: ONE_AT_A_TIME_PER_BOOKING,
        // Emails: a few tries over a few minutes covers a mail provider hiccup.
        retries: 4,
        onFailure: reportFinal("booking-emails"),
      },
      ({ event, step }) => onBookingChanged(event.data, steps(step), deps),
    ),
    inngest.createFunction(
      {
        id: "calendar-sync",
        triggers: [calendarSync],
        concurrency: ONE_AT_A_TIME_PER_BOOKING,
        // Google outages can last a while; the gaps between tries grow, so 8
        // tries reach well past an hour. After that the host's Retry button is left.
        retries: 8,
        onFailure: reportFinal("calendar-sync"),
      },
      ({ event, step }) => onCalendarSync(event.data, steps(step), deps),
    ),
    inngest.createFunction(
      {
        id: "calendar-backfill",
        triggers: [calendarConnected],
        retries: 2,
        onFailure: reportFinal("calendar-backfill"),
      },
      ({ event, step }) => onCalendarConnected(event.data, steps(step), deps),
    ),
    inngest.createFunction(
      {
        id: "reminder-sweep",
        triggers: [cron("*/15 * * * *")],
        // A failed sweep is simply redone by the next one 15 minutes later.
        retries: 1,
        onFailure: reportFinal("reminders"),
      },
      ({ step }) => onReminderSweep(steps(step), deps),
    ),
    inngest.createFunction(
      {
        id: "reminder-send",
        triggers: [reminderDue],
        retries: 3,
        onFailure: reportFinal("reminders"),
      },
      ({ event, step }) => onReminderDue(event.data, steps(step), deps),
    ),
  ];
}
