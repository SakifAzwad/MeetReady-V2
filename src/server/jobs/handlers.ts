import type { Database } from "@/db/types";
import { upcomingBookingsToSync, type CalendarSync } from "../calendar/sync";
import { audiencesFor, composeChangeEmail, type Audience, type BookingChange } from "../email/notifications";
import type { EmailSender } from "../email/sender";
import { getBookingDetails, readManageToken } from "../manage-booking";
import { findDueReminders, reminderEventId, sendReminder } from "../reminders";
import {
  CALENDAR_SYNC,
  REMINDER_DUE,
  type BookingChangedData,
  type CalendarConnectedData,
  type CalendarSyncData,
  type JobEvent,
  type ReminderDueData,
} from "./events";

/*
 * What each background job does (Day 17), as plain functions.
 *
 * They take `steps` instead of Inngest's `step`, so the same code runs in two
 * places: inside Inngest (functions.ts: steps are durable and retried) and
 * inline after a request when Inngest isn't there (inline.ts: dev, E2E, or an
 * Inngest outage). Tests call them directly with either.
 *
 * Steps, in one paragraph: Inngest runs the function from the top on every
 * attempt, but a step that already succeeded isn't run again: its saved
 * result is returned instead. So each piece of work that must happen once
 * (one Google write, one email) is its own step, and a retry repeats only the
 * step that failed. Two consequences shape this file:
 *  - Step results are stored by Inngest: they're short status words and ids,
 *    never booking details.
 *  - A step can still run twice (it finished, then the request died before
 *    Inngest heard back), so every step is safe to repeat: Google writes are
 *    idempotent (Day 16), emails carry an idempotency key.
 */

export type Steps = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  sleepUntil(id: string, until: Date): Promise<void>;
  sendEvent(id: string, events: JobEvent[]): Promise<void>;
};

export type JobDeps = {
  db: Database;
  sender: EmailSender;
  appUrl: string;
  /** BETTER_AUTH_SECRET: opens the encrypted manage token for guest emails. */
  secret: string;
  calendar: Pick<CalendarSync, "attemptSync">;
  report: (error: unknown, context: { area: string; bookingId?: string }) => void;
  /** The clock (tests pass a fixed one). Read inside steps, so a retry sees the time of the retry. */
  now: () => Date;
};

/** Thrown inside a step to make Inngest try again later. */
export class RetryLaterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetryLaterError";
  }
}

// ─── A booking changed ──────────────────────────────────────────────────────────

/**
 * After a booking is made, moved or cancelled: Google Calendar first (one
 * try, so the emails carry the Meet link it creates), then one step per email.
 * If Google failed for a reason that can pass, a separate job retries it: the
 * guest's email shouldn't wait minutes for Google to come back.
 */
export async function onBookingChanged(data: BookingChangedData, steps: Steps, deps: JobDeps) {
  const calendar = await steps.run("calendar", async () => {
    const result = await deps.calendar.attemptSync(data.bookingId);
    if (result.outcome !== "failed") return result.outcome;
    if (result.retryable) return "retry" as const;
    deps.report(result.error, { area: "calendar-sync", bookingId: data.bookingId });
    return "failed" as const;
  });
  if (calendar === "retry") {
    await steps.sendEvent("retry-calendar", [{ name: CALENDAR_SYNC, data: { bookingId: data.bookingId } }]);
  }
  // Two steps, not one: retrying the host's email must not send the guest's again.
  // In parallel, not one after the other: in Inngest a failing step holds back the
  // steps after it, so a guest address that keeps bouncing would have cost the host
  // their email. Side by side, each one succeeds or retries on its own.
  // allSettled, then fail: both finish (and are saved) before the run fails and retries.
  const [guest, host] = await Promise.allSettled([
    steps.run("email-guest", () => sendChangeEmail(deps, data, "guest")),
    steps.run("email-host", () => sendChangeEmail(deps, data, "host")),
  ]);
  if (guest.status === "rejected") throw guest.reason;
  if (host.status === "rejected") throw host.reason;
  return { calendar, guest: guest.value, host: host.value };
}

export type ChangeEmailOutcome = "sent" | "superseded" | "not_needed" | "missing";

function toChange(data: BookingChangedData): BookingChange {
  if (data.change === "rescheduled") {
    if (!data.previousStartsAt) throw new Error("A reschedule needs previousStartsAt");
    return { kind: "rescheduled", previousStartsAt: new Date(data.previousStartsAt) };
  }
  return { kind: data.change };
}

/**
 * One recipient's email for one change. Skipped when the booking has changed
 * again since (its sequence moved on): the newer change sends its own emails,
 * and an old "moved to 3 PM" arriving after "moved to 4 PM" would only confuse.
 * This is also what makes the order of two quick changes not matter.
 */
export async function sendChangeEmail(
  deps: JobDeps,
  data: BookingChangedData,
  audience: Audience,
): Promise<ChangeEmailOutcome> {
  const b = await getBookingDetails(deps.db, data.bookingId);
  if (!b) return "missing";
  if (b.sequence !== data.sequence) return "superseded";
  const change = toChange(data);
  if (!audiencesFor(b, change).includes(audience)) return "not_needed";
  const token =
    audience === "guest" && change.kind !== "cancelled"
      ? await readManageToken(deps.db, b.id, deps.secret)
      : null;
  const message = await composeChangeEmail(
    { appUrl: deps.appUrl, now: new Date(data.at) },
    b,
    change,
    audience,
    token,
  );
  await deps.sender.send(message, { idempotencyKey: `booking/${b.id}/${b.sequence}/${audience}` });
  return "sent";
}

// ─── Google Calendar, with retries ──────────────────────────────────────────────

/**
 * Makes Google match the booking. A temporary failure throws, and Inngest
 * tries again with growing gaps; the final failure is reported by the
 * function's onFailure. Lost access isn't retried (only the host reconnecting
 * fixes it): reported once, and the dashboard shows "Not in Google Calendar".
 */
export async function onCalendarSync(data: CalendarSyncData, steps: Steps, deps: JobDeps) {
  return steps.run("sync", async () => {
    const result = await deps.calendar.attemptSync(data.bookingId);
    if (result.outcome !== "failed") return result.outcome;
    if (!result.retryable) {
      deps.report(result.error, { area: "calendar-sync", bookingId: data.bookingId });
      return "failed" as const;
    }
    throw new RetryLaterError("Google Calendar write failed", { cause: result.error });
  });
}

/**
 * A host connected Google Calendar: their upcoming bookings go in too, one
 * calendar-sync job each (fan-out). Separate jobs, not a loop of steps, so
 * each booking retries on its own and one bad booking can't hold up the rest.
 */
export async function onCalendarConnected(data: CalendarConnectedData, steps: Steps, deps: JobDeps) {
  const ids = await steps.run("find-bookings", () =>
    upcomingBookingsToSync(deps.db, data.userId, deps.now()),
  );
  if (ids.length > 0) {
    await steps.sendEvent(
      "sync-each",
      ids.map((bookingId) => ({ name: CALENDAR_SYNC, data: { bookingId } })),
    );
  }
  return { bookings: ids.length };
}

// ─── Reminders ──────────────────────────────────────────────────────────────────

/** Every 15 minutes: queue the reminders due soon. See reminders.ts for why it's a sweep. */
export async function onReminderSweep(steps: Steps, deps: JobDeps) {
  const due = await steps.run("find-due", async () =>
    (await findDueReminders(deps.db, deps.now())).map((r) => ({
      bookingId: r.bookingId,
      kind: r.kind,
      startsAt: r.startsAt.toISOString(),
      remindAt: r.remindAt.toISOString(),
    })),
  );
  if (due.length > 0) {
    await steps.sendEvent(
      "schedule",
      due.map((data) => ({ name: REMINDER_DUE, id: reminderEventId(data), data })),
    );
  }
  return { scheduled: due.length };
}

/** One reminder: wait for its minute (at most half an hour), then check and send. */
export async function onReminderDue(data: ReminderDueData, steps: Steps, deps: JobDeps) {
  await steps.sleepUntil("wait", new Date(data.remindAt));
  return steps.run("send", () =>
    sendReminder(
      deps,
      { bookingId: data.bookingId, kind: data.kind, startsAt: new Date(data.startsAt) },
      deps.now(),
    ),
  );
}
