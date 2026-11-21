"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { env } from "@/lib/env";
import { tryAgainIn } from "@/lib/rate-limit-text";
import { requireOnboardedUser } from "@/server/auth/session";
import { jobs } from "@/server/jobs";
import { rateLimit } from "@/server/rate-limit";
import {
  BOOKING_EVENTS,
  createEndpoint,
  deleteEndpoint,
  pingEndpoint,
  retryDelivery,
  rotateSecret,
} from "@/server/webhooks/endpoints";

/*
 * The Webhooks page's actions (Day 26). Each one: the host from the session,
 * the input checked with Zod, then a host-scoped function. Sending (a test or
 * a retry) is rate-limited: it makes our server POST to a URL the host typed.
 */

type Result = { ok: true; secret?: string } | { ok: false; error: string };

const deps = () => ({
  db,
  appSecret: env.BETTER_AUTH_SECRET,
  allowPrivate: Boolean(env.WEBHOOK_ALLOW_PRIVATE),
});

const createSchema = z.object({
  url: z.string().trim().min(1, "Enter a URL.").max(2000),
  events: z.array(z.enum(BOOKING_EVENTS as [string, ...string[]])).min(1, "Pick at least one event."),
});

export async function createEndpointAction(input: unknown): Promise<Result> {
  const user = await requireOnboardedUser();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const result = await createEndpoint(deps(), user.id, parsed.data as Parameters<typeof createEndpoint>[2]);
  if (!result.ok) return result;
  refresh();
  return { ok: true, secret: result.secret };
}

const idSchema = z.object({ id: z.uuid() });

export async function deleteEndpointAction(input: unknown): Promise<Result> {
  const user = await requireOnboardedUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success || !(await deleteEndpoint(db, user.id, parsed.data.id))) {
    return { ok: false, error: "Endpoint not found." };
  }
  refresh();
  return { ok: true };
}

export async function rotateSecretAction(input: unknown): Promise<Result> {
  const user = await requireOnboardedUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Endpoint not found." };
  const result = await rotateSecret(deps(), user.id, parsed.data.id, new Date());
  if (!result.ok) return { ok: false, error: "Endpoint not found." };
  refresh();
  return { ok: true, secret: result.secret };
}

async function sendLimited(hostId: string): Promise<string | null> {
  const limited = await rateLimit([["webhook_send_host", hostId]]);
  return limited.ok ? null : `Too many sends for now. Try again ${tryAgainIn(limited.retryAfterSeconds)}.`;
}

export async function sendTestAction(input: unknown): Promise<Result> {
  const user = await requireOnboardedUser();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Endpoint not found." };
  const limited = await sendLimited(user.id);
  if (limited) return { ok: false, error: limited };
  const deliveryId = await pingEndpoint(db, user.id, parsed.data.id, new Date());
  if (!deliveryId) return { ok: false, error: "Endpoint not found." };
  // Sent like any delivery (with retries under Inngest); the list shows the outcome.
  after(() => jobs.webhookDeliver([deliveryId]));
  refresh();
  return { ok: true };
}

const deliverySchema = z.object({ id: z.string().regex(/^msg_[A-Za-z0-9_-]+$/) });

export async function retryDeliveryAction(input: unknown): Promise<Result> {
  const user = await requireOnboardedUser();
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Delivery not found." };
  const limited = await sendLimited(user.id);
  if (limited) return { ok: false, error: limited };
  const deliveryId = await retryDelivery(db, user.id, parsed.data.id);
  if (!deliveryId) return { ok: false, error: "Only a failed delivery can be retried." };
  after(() => jobs.webhookDeliver([deliveryId]));
  refresh();
  return { ok: true };
}
