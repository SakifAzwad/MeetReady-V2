/*
 * Rate limiting: the rules and the in-memory store. Pure (no Redis, no Next),
 * so every rule here is unit-tested with a fake clock (limits.test.ts).
 *
 * The algorithm is a SLIDING WINDOW COUNTER, the same one Upstash runs in
 * Redis (upstash.ts), so local behaviour matches production:
 *
 *   count = current window's hits + previous window's hits × (share of the
 *           previous window still inside the last `window` ms)
 *
 * Why not the alternatives:
 *  - Fixed window ("5 per clock 10 minutes"): a burst at 9:59 plus one at
 *    10:00 lets through twice the limit in a few seconds.
 *  - Sliding LOG (store every timestamp): exact, but memory grows with every
 *    request. The counter keeps two numbers per key, and assumes the previous
 *    window's hits were spread evenly, which is close enough for abuse limits.
 */

export type Policy = { tokens: number; windowMs: number };

const MINUTE = 60_000;

/**
 * Who gets limited, and how much. A human never meets these; a script does.
 * Each is keyed by the thing being abused, not only by IP:
 */
export const LIMITS = {
  /** Booking attempts per IP: a script filling a host's calendar. */
  book_ip: { tokens: 5, windowMs: 10 * MINUTE },
  /**
   * Bookings per guest email: email-bombing ONE person with confirmations
   * from many IPs. The IP limit alone can't see that.
   */
  book_email: { tokens: 3, windowMs: 60 * MINUTE },
  /** Cancel and reschedule per manage token: each one emails the host. */
  manage: { tokens: 10, windowMs: 60 * MINUTE },
  /** The slots API per IP: each call computes a month of availability. */
  slots: { tokens: 60, windowMs: MINUTE },
  /** Public page lookups in proxy.ts per IP: walking usernames to see who exists. */
  pages: { tokens: 120, windowMs: MINUTE },
  /**
   * AI meeting briefs (Day 18). Every call costs tokens. Bookings are already
   * limited per IP and per inbox, but many IPs could still book one host all
   * day, so: per host, and for the whole app (kept under Groq's free-plan daily
   * cap, so going over is OUR "no", not a provider error). Over the limit, the
   * booking simply has no brief.
   */
  ai_brief_host: { tokens: 40, windowMs: 24 * 60 * MINUTE },
  ai_brief_all: { tokens: 400, windowMs: 24 * 60 * MINUTE },
  /**
   * The booking assistant (Days 19–20): public, anonymous, and each request
   * can be up to four model calls. Per IP (someone poking at it), per host (a
   * host's page being hammered from many IPs), and for the whole app: 100
   * requests a day is at most 400 calls, which with the briefs' 400 stays
   * under Groq's free-plan daily cap.
   */
  ai_assistant_ip: { tokens: 10, windowMs: 10 * MINUTE },
  ai_assistant_host: { tokens: 200, windowMs: 24 * 60 * MINUTE },
  ai_assistant_all: { tokens: 100, windowMs: 24 * 60 * MINUTE },
  /**
   * The MCP server (Day 21): tool calls per host, from all their connected
   * assistants together. An assistant may call several tools for one question,
   * and find_free_times computes up to two weeks of slots, so this is generous
   * for a person and stops a loop.
   */
  mcp_host: { tokens: 120, windowMs: 10 * MINUTE },
  /** Self-registered MCP clients per IP, only when MCP_ALLOW_DCR is on (each one is a database row). */
  mcp_register_ip: { tokens: 10, windowMs: 60 * MINUTE },
} as const satisfies Record<string, Policy>;

export type LimitName = keyof typeof LIMITS;

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** Checks one hit for `identifier` under the `name` policy, and counts it if allowed. */
export type RateLimiter = (name: LimitName, identifier: string) => Promise<LimitResult>;

/** Whole seconds until `resetAt`, at least 1 (what the Retry-After header carries). */
export function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

type Counter = { window: number; current: number; previous: number };

/** Above this many keys, stale ones are dropped (an attacker rotating IPs can't grow memory forever). */
const PRUNE_AT = 10_000;

/**
 * In-memory limiter for development and tests. NOT for production on
 * serverless: each instance has its own memory, so ten instances would allow
 * ten times the limit, and a cold start forgets everything.
 */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const counters = new Map<string, Counter>();

  return async (name, identifier) => {
    const { tokens, windowMs } = LIMITS[name];
    const t = now();
    const window = Math.floor(t / windowMs);
    const key = `${name}:${identifier}`;

    if (counters.size > PRUNE_AT) {
      for (const [k, c] of counters) if (c.window < window - 1) counters.delete(k);
    }

    const c = counters.get(key);
    const counter: Counter =
      c?.window === window
        ? c
        : // Moved into the next window: what was current becomes previous. Further than that: start fresh.
          { window, current: 0, previous: c?.window === window - 1 ? c.current : 0 };
    counters.set(key, counter);

    const elapsedShare = (t % windowMs) / windowMs;
    const weightedPrevious = Math.floor(counter.previous * (1 - elapsedShare));
    if (weightedPrevious + counter.current >= tokens) {
      // The end of the current window: an honest upper bound. (Earlier is
      // sometimes possible as the previous window's weight fades, but never later.)
      return { ok: false, retryAfterSeconds: retryAfterSeconds((window + 1) * windowMs, t) };
    }
    counter.current += 1;
    return { ok: true };
  };
}

/** Checks in order and stops at the first refusal. */
export async function checkAll(
  limiter: RateLimiter,
  checks: readonly (readonly [LimitName, string])[],
): Promise<LimitResult> {
  for (const [name, identifier] of checks) {
    const result = await limiter(name, identifier);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** How often a broken store is reported, per server instance: an outage is one problem, not thousands. */
export const REPORT_EVERY_MS = 5 * MINUTE;

/**
 * FAIL OPEN: if the store is down (or slow), let the request through and
 * report it, rate-limited itself.
 *
 * Why open, not closed: the limits stop abuse, which is rare; a Redis outage
 * would otherwise stop every real guest from booking, which is the whole app.
 * The database's own guarantees (the lock and the EXCLUDE constraint) still
 * stop double bookings either way. For a login or payment endpoint the answer
 * could be the opposite.
 */
export function failOpen(
  limiter: RateLimiter,
  report: (error: unknown) => void,
  now: () => number = Date.now,
): RateLimiter {
  let lastReport = -Infinity;
  return async (name, identifier) => {
    try {
      return await limiter(name, identifier);
    } catch (error) {
      if (now() - lastReport >= REPORT_EVERY_MS) {
        lastReport = now();
        report(error);
      }
      return { ok: true };
    }
  };
}
