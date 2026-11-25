import { and, arrayContains, eq, inArray, lt, sql } from "drizzle-orm";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import type { Database } from "@/db/types";
import { locationText } from "@/lib/booking-format";
import { getBookingDetails, type BookingDetails } from "../manage-booking";
import { unseal, seal } from "../seal";
import { checkWebhookUrl } from "./address";
import { newMessageId, webhookHeaders } from "./signing";
import { postWebhook, type HttpResult } from "./transport";

/*
 * Webhook deliveries (Day 26): what's sent, and what happens on each try.
 *
 *   booking-changed job ──► queueBookingDeliveries: one row per subscribed endpoint, payload stored
 *                      └──► webhook/deliver { deliveryId } per row (ids only, Day 17 rule)
 *   webhook-deliver job ──► attemptDelivery: sign NOW, POST, record the outcome
 *
 * The payload is fixed when the row is written; every retry resends the same
 * bytes with the same webhook-id (receivers drop duplicates by it) and a
 * fresh timestamp and signature (receivers reject old timestamps).
 */

export const SECRET_LABEL = "meetready/webhook-secret/v1";
export const sealSecret = (value: string, endpointId: string, appSecret: string) =>
  seal(value, endpointId, appSecret, SECRET_LABEL);
export const openSecret = (sealed: string, endpointId: string, appSecret: string) =>
  unseal(sealed, endpointId, appSecret, SECRET_LABEL);

/** How long delivery rows (which hold guests' names and emails) are kept. */
export const KEEP_DAYS = 30;

export type BookingEvent = "booking.created" | "booking.rescheduled" | "booking.cancelled";
export type Change = {
  bookingId: string;
  change: "created" | "rescheduled" | "cancelled";
  sequence: number;
  previousStartsAt?: string;
};

/**
 * What a receiver gets. Times are UTC instants, plus the host's timezone to
 * show them in. The guest's name, email and timezone are included (a CRM or a
 * Slack message needs them); their notes, answers, the cancel reason and the
 * AI brief are not: words people typed for the host go only where the host
 * opens them (Day 26 decision).
 */
export function bookingPayload(type: BookingEvent, b: BookingDetails, change: Change, now: Date) {
  const changedBy =
    change.change === "created"
      ? b.source === "assistant"
        ? "host"
        : "guest"
      : change.change === "cancelled"
        ? b.cancelledBy
        : b.rescheduledBy;
  const throughAssistant =
    change.change === "created" ? b.source === "assistant" : b.changedByClient !== null;
  return {
    type,
    timestamp: now.toISOString(),
    data: {
      bookingId: b.id,
      status: b.status,
      startsAt: b.startsAt.toISOString(),
      endsAt: b.endsAt.toISOString(),
      ...(change.change === "rescheduled" && change.previousStartsAt
        ? { previousStartsAt: change.previousStartsAt }
        : {}),
      timeZone: b.hostTimeZone,
      meetingType: { slug: b.eventSlug, title: b.eventTitle, durationMinutes: b.durationMinutes },
      location: locationText(b),
      meetUrl: b.meetUrl,
      guest: { name: b.guestName, email: b.guestEmail, timeZone: b.guestTimeZone },
      changedBy: changedBy ?? "guest",
      throughAssistant,
    },
  };
}

/**
 * One row per endpoint of this host that listens to this event. Safe to run
 * twice (a retried job step): the dedupe key makes the second insert a no-op,
 * and the ids returned are the existing rows'. Day 30: a team meeting goes to
 * EVERY host's endpoints (it's on each of their Bookings pages too), each with
 * its own delivery row and key.
 */
export async function queueBookingDeliveries(db: Database, change: Change, now: Date): Promise<string[]> {
  const b = await getBookingDetails(db, change.bookingId);
  if (!b) return [];
  const type = `booking.${change.change}` as BookingEvent;
  const endpoints = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(
      and(
        inArray(webhookEndpoints.userId, [b.hostId, ...(b.coHosts ?? []).map((h) => h.id)]),
        arrayContains(webhookEndpoints.events, [type]),
      ),
    );
  if (endpoints.length === 0) return [];

  const payload = bookingPayload(type, b, change, now);
  const keyOf = (endpointId: string) => `${endpointId}:${change.bookingId}:${change.sequence}`;
  await db
    .insert(webhookDeliveries)
    .values(
      endpoints.map((e) => ({
        id: newMessageId(),
        endpointId: e.id,
        event: type,
        dedupeKey: keyOf(e.id),
        payload,
      })),
    )
    .onConflictDoNothing({ target: webhookDeliveries.dedupeKey });
  const rows = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      inArray(
        webhookDeliveries.dedupeKey,
        endpoints.map((e) => keyOf(e.id)),
      ),
    );
  return rows.map((r) => r.id);
}

/** A test event for one endpoint ("Send test"). */
export async function queuePing(db: Database, endpointId: string, now: Date): Promise<string> {
  const id = newMessageId();
  await db.insert(webhookDeliveries).values({
    id,
    endpointId,
    event: "ping",
    payload: {
      type: "ping",
      timestamp: now.toISOString(),
      data: { message: "A test event from MeetReady. If you can read this, your endpoint works." },
    },
  });
  return id;
}

export type AttemptDeps = {
  db: Database;
  /** BETTER_AUTH_SECRET: opens the endpoints' signing secrets. */
  secret: string;
  now: () => Date;
  /** E2E only (WEBHOOK_ALLOW_PRIVATE): lets the local fake receiver through. */
  allowPrivate: boolean;
  post?: typeof postWebhook;
};

/** delivered | failed (for good) | retry (try again later) | gone (the endpoint or row was deleted). */
export type AttemptOutcome = "delivered" | "failed" | "retry" | "gone";

/** 408 and 429 say "later"; 5xx is the receiver's problem, which can pass. Other 4xx won't change by retrying. */
export const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * One try. On the last allowed try a retryable failure becomes "failed", so a
 * delivery never stays "pending" forever (inline mode has only one try).
 */
export async function attemptDelivery(
  deps: AttemptDeps,
  deliveryId: string,
  { finalAttempt }: { finalAttempt: boolean },
): Promise<AttemptOutcome> {
  const [row] = await deps.db
    .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!row) return "gone";
  const { delivery, endpoint } = row;
  if (delivery.status === "delivered") return "delivered"; // a duplicate event: already done

  const now = deps.now();
  const record = async (
    status: "pending" | "delivered" | "failed",
    result: { code?: number; error?: string },
  ) => {
    await deps.db
      .update(webhookDeliveries)
      .set({
        status,
        attempts: sql`${webhookDeliveries.attempts} + 1`,
        lastStatusCode: result.code ?? null,
        lastError: result.error ?? null,
        lastAttemptAt: now,
        ...(status === "delivered" ? { deliveredAt: now } : {}),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
  };
  const retryOrFail = async (result: { code?: number; error: string }): Promise<AttemptOutcome> => {
    await record(finalAttempt ? "failed" : "pending", result);
    return finalAttempt ? "failed" : "retry";
  };

  // Checked again at send time: the URL was saved under the rules of its day.
  const url = checkWebhookUrl(endpoint.url, { allowPrivate: deps.allowPrivate });
  if (!url.ok) {
    await record("failed", { error: url.error });
    return "failed";
  }

  const current = openSecret(endpoint.secretEncrypted, endpoint.id, deps.secret);
  if (!current) {
    // BETTER_AUTH_SECRET was rotated: this endpoint can't be signed for until its secret is rotated too.
    await record("failed", { error: "The signing secret can't be read. Rotate it on the Webhooks page." });
    return "failed";
  }
  const previous =
    endpoint.previousSecretEncrypted &&
    endpoint.previousSecretExpiresAt &&
    endpoint.previousSecretExpiresAt > now
      ? openSecret(endpoint.previousSecretEncrypted, endpoint.id, deps.secret)
      : null;

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(now.getTime() / 1000);
  const headers = webhookHeaders(previous ? [current, previous] : [current], delivery.id, timestamp, body);

  let result: HttpResult;
  try {
    result = await (deps.post ?? postWebhook)(endpoint.url, headers, body, {
      allowPrivate: deps.allowPrivate,
    });
  } catch (error) {
    const cause = (error as { cause?: { name?: string } }).cause;
    if (cause?.name === "BlockedAddressError" || (error as Error).name === "BlockedAddressError") {
      await record("failed", { error: "The address points at a private network." });
      return "failed";
    }
    const timedOut = (error as Error).name === "TimeoutError" || (error as Error).name === "AbortError";
    return retryOrFail({ error: timedOut ? "No answer within 10 seconds." : "Couldn't connect." });
  }

  if (result.status >= 200 && result.status < 300) {
    await record("delivered", { code: result.status });
    return "delivered";
  }
  if (result.status >= 300 && result.status < 400) {
    await record("failed", { code: result.status, error: "Redirects aren't followed. Use the final URL." });
    return "failed";
  }
  if (isRetryableStatus(result.status))
    return retryOrFail({ code: result.status, error: `HTTP ${result.status}` });
  await record("failed", { code: result.status, error: `HTTP ${result.status}` });
  return "failed";
}

/** The daily clean-up: delivery rows hold guests' names and emails, so they don't stay forever. */
export async function deleteOldDeliveries(db: Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
  const gone = await db
    .delete(webhookDeliveries)
    .where(lt(webhookDeliveries.createdAt, cutoff))
    .returning({ id: webhookDeliveries.id });
  return gone.length;
}
