import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { LIMITS, retryAfterSeconds, type LimitName, type RateLimiter } from "./limits";

/*
 * Production store: Upstash Redis, shared by every serverless instance.
 *
 * Why Redis and not the alternatives:
 *  - In memory: each Vercel instance has its own memory and a cold start wipes
 *    it, so the real limit would be "N per instance", which is no limit.
 *  - Postgres: it would add a write to every slots request and page lookup,
 *    the hottest paths, on the database that also has to take bookings.
 *  - Upstash speaks HTTP (no connection pool to exhaust from serverless), and
 *    runs the sliding window as one Lua script, so the read-check-increment is
 *    atomic: two requests at once can't both see "4 of 5" and both pass.
 */

/** A slow Redis mustn't make booking slow: past this, the request goes through (and is reported). */
const TIMEOUT_MS = 1000;

export class RateLimitStoreTimeout extends Error {
  constructor(name: LimitName) {
    super(`Rate limit store timed out (${name})`);
    this.name = "RateLimitStoreTimeout";
  }
}

export function createUpstashRateLimiter(redis: Redis, prefix: string): RateLimiter {
  const limiters = new Map<LimitName, Ratelimit>();
  const limiterFor = (name: LimitName) => {
    let limiter = limiters.get(name);
    if (!limiter) {
      const { tokens, windowMs } = LIMITS[name];
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(tokens, `${windowMs} ms`),
        prefix: `${prefix}:${name}`,
        timeout: TIMEOUT_MS,
        analytics: false, // nothing extra stored in Redis, and no background `pending` work
        // Created once per instance (module scope), so the ephemeral cache works: a key already
        // refused is refused again from memory, without a Redis call, until its window resets.
        // A flood from one IP then costs no Redis requests (and no free-tier quota).
        ephemeralCache: new Map(),
      });
      limiters.set(name, limiter);
    }
    return limiter;
  };

  return async (name, identifier) => {
    const result = await limiterFor(name).limit(identifier);
    // On timeout Upstash answers "allowed". Throwing instead sends it through
    // failOpen, so a slow store is reported like a broken one (and still allowed).
    if (result.reason === "timeout") throw new RateLimitStoreTimeout(name);
    return result.success
      ? { ok: true }
      : { ok: false, retryAfterSeconds: retryAfterSeconds(result.reset, Date.now()) };
  };
}
