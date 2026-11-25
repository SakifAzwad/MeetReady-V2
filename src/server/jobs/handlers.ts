import type { Database } from "@/db/types";
import { getBrief, type BriefOutcome } from "../ai/briefs";
import { upcomingBookingsToSync, type CalendarSync } from "../calendar/sync";
import {
  audiencesFor,
  composeChangeEmail,
  hostIsTold,
  type Audience,
  type BookingChange,
} from "../email/notifications";
import { PermanentEmailError, type EmailSender } from "../email/sender";
import { getBookingDetails, readManageToken } from "../manage-booking";
import { findDueReminders, reminderEventId, sendReminder } from "../reminders";
import type { AttemptOutcome, Change } from "../webhooks/deliveries";
import {
  CALENDAR_SYNC,
  REMINDER_DUE,
  WEBHOOK_DELIVER,
  type BookingChangedData,
  type CalendarConnectedData,
  type CalendarSyncData,
  type JobEvent,
  type ReminderDueData,
  type WebhookDeliverData,
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
  /** Day 18: writes the AI meeting brief for a new booking (never throws; see ai/briefs.ts). */
  briefs: { prepare: (bookingId: string) => Promise<BriefOutcome> };
  /** Day 26: signed webhooks (src/server/webhooks/deliveries.ts). */
  webhooks: {
    /** Writes one delivery per subscribed endpoint (safe to repeat); returns their ids. */
    queue: (change: Change) => Promise<string[]>;
    attempt: (deliveryId: string, options: { finalAttempt: boolean }) => Promise<AttemptOutcome>;
    cleanup: () => Promise<number>;
  };
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
  //
  // Day 18: on the host's side only, the AI brief comes first, so their email can
  // carry it. The guest's email doesn't wait for the model. The brief step never
  // throws (a failed brief just isn't there), so it can't hold the host's email back.
  const hostSide = async () => {
    const brief: BriefOutcome =
      data.change === "created"
        ? await steps.run("brief", () => deps.briefs.prepare(data.bookingId))
        : "not_needed";
    const host = await steps.run("email-host", () => sendChangeEmail(deps, data, "host"));
    // Day 29: the other hosts of a team meeting get the host's email too, each on their own clock.
    // One step for all of them; a retry resends none twice (one idempotency key per host).
    const coHosts = await steps.run("email-cohosts", () => sendCoHostEmails(deps, data));
    return { brief, host, coHosts };
  };
  // Day 26: webhooks, side by side with the emails (a slow receiver never holds up an email, and a
  // failing email never holds up a webhook). This step only WRITES the deliveries and queues one
  // job each; sending, with its own retries, happens in webhook-deliver.
  const webhooks = async () => {
    const ids = await steps.run("webhooks", () => deps.webhooks.queue(data));
    if (ids && ids.length > 0) {
      await steps.sendEvent(
        "webhooks-deliver",
        ids.map((deliveryId) => ({
          name: WEBHOOK_DELIVER,
          data: { deliveryId },
          id: `webhook-${deliveryId}`,
        })),
      );
    }
    return ids?.length ?? 0;
  };
  const [guest, hostResult, hooks] = await Promise.allSettled([
    steps.run("email-guest", () => sendChangeEmail(deps, data, "guest")),
    hostSide(),
    webhooks(),
  ]);
  if (guest.status === "rejected") throw guest.reason;
  if (hostResult.status === "rejected") throw hostResult.reason;
  if (hooks.status === "rejected") throw hooks.reason;
  return {
    calendar,
    brief: hostResult.value.brief,
    guest: guest.value,
    host: hostResult.value.host,
    webhooks: hooks.value,
  };
}

/** "rejected": the mail provider refused it for good (PermanentEmailError): reported, not retried. */
export type ChangeEmailOutcome = "sent" | "superseded" | "not_needed" | "missing" | "rejected";

/**
 * Sends one email from a job step. A permanent refusal (a recipient the
 * provider won't accept) is reported once and answered "rejected": throwing
 * would make Inngest retry for minutes and then fail the whole run, which
 * also holds back the run's other steps (Day 29 story). Anything else throws,
 * and is retried as before.
 */
async function sendOrReject(
  deps: JobDeps,
  message: Parameters<EmailSender["send"]>[0],
  idempotencyKey: string,
  context: { area: string; bookingId: string },
): Promise<"sent" | "rejected"> {
  try {
    await deps.sender.send(message, { idempotencyKey });
    return "sent";
  } catch (error) {
    if (!(error instanceof PermanentEmailError)) throw error;
    deps.report(error, context);
    return "rejected";
  }
}

/**
 * Day 29: a team meeting's co-hosts. The same email as the organizer's, sent
 * to each of them, in their own timezone. Day 30: each is told unless they
 * made the change themselves (any host may cancel or move a team meeting),
 * and the .ics is left out when the event is in the organizer's Google
 * Calendar, which invites the co-hosts (Google's invite puts it in their
 * calendar; a second copy from us would show the meeting twice).
 * Returns how many were sent (0 for anything but a team meeting).
 */
export async function sendCoHostEmails(
  deps: JobDeps,
  data: BookingChangedData,
): Promise<{ sent: number; rejected: number }> {
  const none = { sent: 0, rejected: 0 };
  const b = await getBookingDetails(deps.db, data.bookingId);
  if (!b?.coHosts?.length || b.sequence !== data.sequence) return none;
  const change = toChange(data);
  const brief = change.kind === "created" ? await getBrief(deps.db, b.id) : null;
  const result = { ...none };
  // Every co-host gets their try before anything is retried: one refused or failing address
  // must not keep the others from their email. Sent ones aren't sent twice on a retry (keys).
  let retryLater: unknown = null;
  for (const h of b.coHosts) {
    if (!hostIsTold(b, change, h.id)) continue;
    const message = await composeChangeEmail(
      { appUrl: deps.appUrl, now: new Date(data.at) },
      { ...b, hostEmail: h.email, hostTimeZone: h.timeZone },
      change,
      "host",
      null,
      { brief, hostId: h.id },
    );
    try {
      const outcome = await sendOrReject(deps, message, `booking/${b.id}/${b.sequence}/host/${h.id}`, {
        area: "booking-emails",
        bookingId: b.id,
      });
      result[outcome]++;
    } catch (error) {
      retryLater ??= error;
    }
  }
  if (retryLater) throw retryLater;
  return result;
}

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
  // Day 18: the host's confirmation carries the AI brief, if one was written.
  const brief = audience === "host" && change.kind === "created" ? await getBrief(deps.db, b.id) : null;
  const message = await composeChangeEmail(
    { appUrl: deps.appUrl, now: new Date(data.at) },
    b,
    change,
    audience,
    token,
    { brief },
  );
  return sendOrReject(deps, message, `booking/${b.id}/${b.sequence}/${audience}`, {
    area: "booking-emails",
    bookingId: b.id,
  });
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
  return steps.run("send", async () => {
    const outcome = await sendReminder(
      deps,
      { bookingId: data.bookingId, kind: data.kind, startsAt: new Date(data.startsAt) },
      deps.now(),
    );
    if (typeof outcome !== "string") {
      deps.report(outcome.rejected, { area: "reminders", bookingId: data.bookingId });
      return "rejected" as const;
    }
    return outcome;
  });
}

// ─── Webhooks (Day 26) ──────────────────────────────────────────────────────────

/**
 * One try at one stored delivery. A failure that can pass (a 5xx, a timeout)
 * throws inside the step, so Inngest tries again later with growing gaps; on
 * the last allowed try it's recorded as failed instead, and the host's Retry
 * button is left. Inline (no Inngest) every try is the last one.
 */
export async function onWebhookDeliver(
  data: WebhookDeliverData,
  steps: Steps,
  deps: JobDeps,
  { finalAttempt }: { finalAttempt: boolean },
) {
  return steps.run("deliver", async () => {
    const outcome = await deps.webhooks.attempt(data.deliveryId, { finalAttempt });
    if (outcome === "retry") throw new RetryLaterError("Webhook receiver failed; will retry");
    return outcome;
  });
}

/** Daily: delivery rows hold guests' names and emails, so they're deleted after 30 days. */
export async function onWebhookCleanup(steps: Steps, deps: JobDeps) {
  return steps.run("delete-old", () => deps.webhooks.cleanup());
}
