import "server-only";
import * as Sentry from "@sentry/nextjs";
import { Inngest } from "inngest";
import { db } from "@/db";
import { env } from "@/lib/env";
import { calendarSync } from "@/server/calendar";
import { emailSender } from "@/server/email";
import { BOOKING_CHANGED, CALENDAR_CONNECTED, type BookingChangedData, type JobEvent } from "./events";
import { createJobFunctions } from "./functions";
import type { JobDeps } from "./handlers";
import { runInline } from "./inline";

/*
 * The real wiring for background jobs (Day 17). The actions call `jobs.*`
 * in `after()`; this decides where the work runs:
 *  - Inngest, when configured (INNGEST_EVENT_KEY on Vercel, INNGEST_DEV=1 locally):
 *    durable steps, retries, reminders.
 *  - inline (inline.ts), when it isn't, or when sending to Inngest fails.
 */

const deps: JobDeps = {
  db,
  sender: emailSender,
  appUrl: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  calendar: calendarSync,
  // Ids only: Sentry gets the booking id to find it, never the guest's details.
  report: (error, { area, bookingId }) =>
    Sentry.captureException(error, { tags: { area }, extra: bookingId ? { bookingId } : undefined }),
  now: () => new Date(),
};

export const inngest = new Inngest({
  id: "meetready",
  isDev: Boolean(env.INNGEST_DEV),
  eventKey: env.INNGEST_EVENT_KEY,
});

export const functions = createJobFunctions(inngest, deps);

export const jobsMode: "inngest" | "inline" = env.INNGEST_EVENT_KEY || env.INNGEST_DEV ? "inngest" : "inline";

if (jobsMode === "inline" && process.env.VERCEL_ENV === "production") {
  // Not fatal (everything but retries and reminders still works), but not meant to happen.
  Sentry.captureMessage(
    "Inngest isn't configured: background jobs run inline (no retries, no reminders)",
    "warning",
  );
}

async function dispatch(event: JobEvent): Promise<void> {
  if (jobsMode === "inngest") {
    try {
      await inngest.send(event);
      return;
    } catch (error) {
      // Inngest unreachable: do the work here instead (no retries), and say so.
      deps.report(error, {
        area: "jobs-dispatch",
        bookingId: "bookingId" in event.data ? event.data.bookingId : undefined,
      });
    }
  }
  await runInline(event, deps);
}

export const jobs = {
  /** After a booking is made, moved or cancelled: Google Calendar, then the emails. */
  bookingChanged(data: Omit<BookingChangedData, "at" | "previousStartsAt"> & { previousStartsAt?: Date }) {
    return dispatch({
      name: BOOKING_CHANGED,
      // Same booking + same sequence = the same change: Inngest drops a duplicate send.
      id: `booking-changed-${data.bookingId}-${data.sequence}`,
      data: {
        bookingId: data.bookingId,
        change: data.change,
        sequence: data.sequence,
        previousStartsAt: data.previousStartsAt?.toISOString(),
        at: new Date().toISOString(),
      },
    });
  },
  /** After a host connects Google Calendar: copy their upcoming bookings into it. */
  calendarConnected(userId: string) {
    return dispatch({ name: CALENDAR_CONNECTED, data: { userId } });
  },
};
