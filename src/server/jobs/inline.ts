import { BOOKING_CHANGED, CALENDAR_CONNECTED, CALENDAR_SYNC, REMINDER_DUE, type JobEvent } from "./events";
import {
  onBookingChanged,
  onCalendarConnected,
  onCalendarSync,
  onReminderDue,
  type JobDeps,
  type Steps,
} from "./handlers";

/*
 * The fallback when there's no job queue (Day 17): the same handlers, run
 * right away in the request's `after()`, like Days 5–16 did.
 *
 * Used when Inngest isn't configured (local dev without its dev server, the
 * E2E tests, unit tests) and when sending to Inngest fails in production: the
 * booking is already saved, so its emails must not be lost to an Inngest outage.
 *
 * What's different from Inngest:
 *  - No retries. A failing step is reported and the run moves on to the next
 *    one (the guest's email still goes if the host's fails), as before Day 17.
 *  - A follow-up event (calendar retry, backfill fan-out) runs immediately,
 *    once. So a failed Google write gets one immediate second try.
 *  - Sleeps don't wait. Only reminders sleep, and reminders come from the cron
 *    sweep, which only Inngest runs: without Inngest there are no reminders.
 */

export function areaFor(name: JobEvent["name"]): string {
  switch (name) {
    case BOOKING_CHANGED:
      return "booking-emails";
    case CALENDAR_SYNC:
      return "calendar-sync";
    case CALENDAR_CONNECTED:
      return "calendar-backfill";
    case REMINDER_DUE:
      return "reminders";
  }
}

function bookingIdOf(event: JobEvent): string | undefined {
  return "bookingId" in event.data ? event.data.bookingId : undefined;
}

export async function runInline(event: JobEvent, deps: JobDeps): Promise<void> {
  const steps: Steps = {
    async run<T>(_id: string, fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } catch (error) {
        deps.report(error, { area: areaFor(event.name), bookingId: bookingIdOf(event) });
        // The handler goes on with "no result": every handler treats that as "didn't work".
        return undefined as T;
      }
    },
    async sleepUntil() {},
    async sendEvent(_id, events) {
      for (const next of events) await runInline(next, deps);
    },
  };

  try {
    switch (event.name) {
      case BOOKING_CHANGED:
        await onBookingChanged(event.data, steps, deps);
        break;
      case CALENDAR_SYNC:
        await onCalendarSync(event.data, steps, deps);
        break;
      case CALENDAR_CONNECTED:
        await onCalendarConnected(event.data, steps, deps);
        break;
      case REMINDER_DUE:
        await onReminderDue(event.data, steps, deps);
        break;
    }
  } catch (error) {
    // Outside any step (e.g. a malformed event): reported, never thrown into the request.
    deps.report(error, { area: areaFor(event.name), bookingId: bookingIdOf(event) });
  }
}
