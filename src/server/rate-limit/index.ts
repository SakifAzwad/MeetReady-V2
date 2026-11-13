import "server-only";
import { createHmac } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { getRedis, redisPrefix } from "@/server/redis";
import { clientIp, emailBucket, hashIdentifier, ipBucket } from "./identity";
import {
  checkAll,
  createMemoryRateLimiter,
  failOpen,
  type LimitName,
  type LimitResult,
  type RateLimiter,
} from "./limits";
import { createUpstashRateLimiter } from "./upstash";

/*
 * The one entry point the app uses: rateLimit([["book_ip", ip], …]).
 *
 *  - With Redis configured (production, previews): Upstash, wrapped in
 *    failOpen, so a Redis outage lets requests through and reports once.
 *  - Without it (local dev, unit and E2E tests): the in-memory limiter. On
 *    Vercel that only happens if the variables are missing: it still limits
 *    per instance, and logs a warning instead of breaking booking.
 */

function build(): RateLimiter {
  const redis = getRedis();
  if (redis) {
    // Prefixed by environment: production and previews may share one Redis.
    return failOpen(createUpstashRateLimiter(redis, redisPrefix), (error) => {
      console.error("Rate limiting is failing open:", error);
      Sentry.captureException(error, { tags: { area: "rate-limit" } });
    });
  }
  if (process.env.VERCEL) {
    console.warn(
      "No Upstash Redis variables: rate limits are per instance only. See docs/deploy.md step 11.",
    );
  }
  return createMemoryRateLimiter();
}

let limiter: RateLimiter | undefined;

/**
 * A key of its own for these hashes, derived from the auth secret ("domain
 * separation"): the same secret signs session cookies, and a hash made for
 * one purpose should never be usable for another.
 */
const hashKey = createHmac("sha256", env.BETTER_AUTH_SECRET).update("meetready:rate-limit").digest("hex");

/** Counts one hit against each limit in order; the first refusal wins. Raw values never leave the app. */
export function rateLimit(checks: readonly (readonly [LimitName, string])[]): Promise<LimitResult> {
  limiter ??= build();
  return checkAll(
    limiter,
    checks.map(([name, value]) => [name, hashIdentifier(hashKey, value)] as const),
  );
}

/** The IP bucket of a request (route handlers and proxy have the request's headers). */
export const ipOf = (requestHeaders: Headers) => ipBucket(clientIp(requestHeaders));

/** The IP bucket inside a server action, where the request is only reachable through headers(). */
export const actionIp = async () => ipOf(await headers());

export { emailBucket };

/** 429 for API callers: Retry-After says when, in seconds (RFC 9110), so well-behaved clients wait. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    { error: "Too many requests", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}
