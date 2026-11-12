import type { Redis } from "@upstash/redis";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The adapter's own logic, with Upstash's Ratelimit replaced by a stub: the
 * policy it's built with, how answers map to ours, and that a timeout becomes
 * an error (so failOpen reports it). Upstash's Lua script itself is theirs to test.
 */

const limit = vi.fn();
const built: unknown[] = [];

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow = (tokens: number, window: string) => ({ tokens, window });
    constructor(config: unknown) {
      built.push(config);
    }
    limit = limit;
  }
  return { Ratelimit };
});

const { createUpstashRateLimiter, RateLimitStoreTimeout } = await import("./upstash");
const redis = {} as Redis;

beforeEach(() => {
  limit.mockReset();
  built.length = 0;
});

describe("createUpstashRateLimiter", () => {
  it("builds one sliding-window limiter per policy, prefixed by environment and name", async () => {
    limit.mockResolvedValue({ success: true, reset: 0 });
    const limiter = createUpstashRateLimiter(redis, "meetready:production");
    await limiter("book_ip", "k");
    await limiter("book_ip", "k2");
    await limiter("slots", "k");
    expect(built).toHaveLength(2);
    expect(built[0]).toMatchObject({
      limiter: { tokens: 5, window: "600000 ms" },
      prefix: "meetready:production:book_ip",
      analytics: false,
      timeout: 1000,
    });
    expect(limit).toHaveBeenCalledWith("k");
  });

  it("maps a refusal to seconds until the reset", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    limit.mockResolvedValue({ success: false, reset: 1_000_000 + 42_500 });
    const limiter = createUpstashRateLimiter(redis, "p");
    expect(await limiter("manage", "k")).toEqual({ ok: false, retryAfterSeconds: 43 });
    vi.useRealTimers();
  });

  it("turns Upstash's 'allowed because of a timeout' into an error, for failOpen to report", async () => {
    limit.mockResolvedValue({ success: true, reset: 0, reason: "timeout" });
    const limiter = createUpstashRateLimiter(redis, "p");
    await expect(limiter("pages", "k")).rejects.toBeInstanceOf(RateLimitStoreTimeout);
  });
});
