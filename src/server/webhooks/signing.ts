import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * Webhook signatures (Day 26), in the Standard Webhooks format
 * (https://www.standardwebhooks.com), the one Svix, Resend and others use, so
 * receivers can verify with an existing library instead of our own code:
 *
 *   webhook-id:        msg_…   (the same on every retry: receivers drop duplicates by it)
 *   webhook-timestamp: seconds since 1970 (receivers reject old ones: no replays)
 *   webhook-signature: "v1,<base64 HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)>"
 *
 * The secret is "whsec_" + base64 of 32 random bytes; the HMAC key is the
 * decoded bytes. During a rotation the header carries one signature per
 * secret, separated by spaces, and a receiver accepts any of them.
 */

export const SECRET_PREFIX = "whsec_";

export function newWebhookSecret(): string {
  return SECRET_PREFIX + randomBytes(32).toString("base64");
}

export function newMessageId(): string {
  return `msg_${randomBytes(16).toString("base64url")}`;
}

const keyOf = (secret: string) => Buffer.from(secret.slice(SECRET_PREFIX.length), "base64");

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const mac = createHmac("sha256", keyOf(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${mac}`;
}

/** The three headers for one attempt. `secrets`: the current one first, then a previous one still in its overlap. */
export function webhookHeaders(secrets: string[], id: string, timestamp: number, body: string) {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": secrets.map((s) => sign(s, id, timestamp, body)).join(" "),
  };
}

/** Allowed clock difference for a receiver, as the spec recommends. */
export const TOLERANCE_SECONDS = 5 * 60;

/**
 * What a receiver does (used by our tests and the fake receiver, and shown in
 * docs/webhooks.md): recompute, compare in constant time, check the age.
 */
export function verify(
  secret: string,
  headers: Record<string, string | undefined>,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const id = headers["webhook-id"];
  const timestamp = Number(headers["webhook-timestamp"]);
  const signatures = headers["webhook-signature"]?.split(" ") ?? [];
  if (!id || !Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS)
    return false;
  const expected = Buffer.from(sign(secret, id, timestamp, body));
  return signatures.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
