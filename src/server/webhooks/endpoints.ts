import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { webhookDeliveries, webhookEndpoints } from "@/db/schema";
import type { Database } from "@/db/types";
import { checkWebhookUrl, resolvesPublicly } from "./address";
import { queuePing, sealSecret, type BookingEvent } from "./deliveries";
import { newWebhookSecret } from "./signing";

/*
 * A host's webhook endpoints (Day 26), for the dashboard. The same habit as
 * every host query since Day 2: the host comes from the session and is in
 * every WHERE clause, so another host's endpoint or delivery id looks missing.
 */

export const MAX_ENDPOINTS = 5;
/** During a rotation the old secret keeps signing for this long (receivers switch over in their own time). */
export const ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;
export const BOOKING_EVENTS: BookingEvent[] = ["booking.created", "booking.rescheduled", "booking.cancelled"];

export type EndpointsDeps = {
  db: Database;
  /** BETTER_AUTH_SECRET, to seal signing secrets. */
  appSecret: string;
  allowPrivate: boolean;
  resolve?: Parameters<typeof resolvesPublicly>[1];
};

export async function listEndpoints(db: Database, hostId: string) {
  return db
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
      events: webhookEndpoints.events,
      createdAt: webhookEndpoints.createdAt,
      rotatingUntil: webhookEndpoints.previousSecretExpiresAt,
    })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.userId, hostId))
    .orderBy(webhookEndpoints.createdAt);
}

export async function recentDeliveries(db: Database, hostId: string, limit = 20) {
  return db
    .select({
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      url: webhookEndpoints.url,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      lastStatusCode: webhookDeliveries.lastStatusCode,
      lastError: webhookDeliveries.lastError,
      createdAt: webhookDeliveries.createdAt,
      lastAttemptAt: webhookDeliveries.lastAttemptAt,
      payload: webhookDeliveries.payload,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(eq(webhookEndpoints.userId, hostId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
}

export type CreateResult = { ok: true; id: string; secret: string } | { ok: false; error: string };

/**
 * Checks the URL (shape, then DNS: every address public), then stores the
 * endpoint with a new secret. The secret is returned once, for the host to
 * copy; after that MeetReady only ever uses it to sign.
 */
export async function createEndpoint(
  deps: EndpointsDeps,
  hostId: string,
  input: { url: string; events: BookingEvent[] },
): Promise<CreateResult> {
  const shape = checkWebhookUrl(input.url, { allowPrivate: deps.allowPrivate });
  if (!shape.ok) return shape;
  if (!deps.allowPrivate) {
    const dns = await resolvesPublicly(shape.url, deps.resolve);
    if (!dns.ok) return dns;
  }
  const events = BOOKING_EVENTS.filter((e) => input.events.includes(e));
  if (events.length === 0) return { ok: false, error: "Pick at least one event." };
  const [{ n }] = (await deps.db
    .select({ n: count() })
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.userId, hostId))) as [{ n: number }];
  if (n >= MAX_ENDPOINTS) return { ok: false, error: `You can have up to ${MAX_ENDPOINTS} endpoints.` };

  // The id is made here: the secret is sealed with it as associated data.
  const id = randomUUID();
  const secret = newWebhookSecret();
  await deps.db.insert(webhookEndpoints).values({
    id,
    userId: hostId,
    url: shape.url.toString(),
    events,
    secretEncrypted: sealSecret(secret, id, deps.appSecret),
  });
  return { ok: true, id, secret };
}

export async function deleteEndpoint(db: Database, hostId: string, id: string): Promise<boolean> {
  const gone = await db
    .delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, hostId)))
    .returning({ id: webhookEndpoints.id });
  return gone.length > 0;
}

/**
 * A new secret, with the current one kept signing for 24 hours. The current
 * sealed value moves over as it is: it was sealed for this endpoint's id, so
 * it still opens. Rotating again during an overlap replaces the old "previous".
 */
export async function rotateSecret(
  deps: Pick<EndpointsDeps, "db" | "appSecret">,
  hostId: string,
  id: string,
  now: Date,
): Promise<{ ok: true; secret: string } | { ok: false }> {
  const [row] = await deps.db
    .select({ current: webhookEndpoints.secretEncrypted })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, hostId)));
  if (!row) return { ok: false };
  const secret = newWebhookSecret();
  await deps.db
    .update(webhookEndpoints)
    .set({
      secretEncrypted: sealSecret(secret, id, deps.appSecret),
      previousSecretEncrypted: row.current,
      previousSecretExpiresAt: new Date(now.getTime() + ROTATION_OVERLAP_MS),
    })
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, hostId)));
  return { ok: true, secret };
}

/** "Send test": a signed ping to one of the host's endpoints. Returns the delivery id to send, or null. */
export async function pingEndpoint(
  db: Database,
  hostId: string,
  id: string,
  now: Date,
): Promise<string | null> {
  const [own] = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, hostId)));
  return own ? queuePing(db, own.id, now) : null;
}

/** "Retry" on a failed delivery: back to pending, the same id and payload. Returns the id to send, or null. */
export async function retryDelivery(
  db: Database,
  hostId: string,
  deliveryId: string,
): Promise<string | null> {
  const [own] = await db
    .select({ id: webhookDeliveries.id, status: webhookDeliveries.status })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookEndpoints.userId, hostId)));
  if (!own || own.status !== "failed") return null;
  await db.update(webhookDeliveries).set({ status: "pending" }).where(eq(webhookDeliveries.id, own.id));
  return own.id;
}
