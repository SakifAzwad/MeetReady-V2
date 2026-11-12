import { describe, expect, it, vi } from "vitest";
import { tooManyAttempts, tryAgainIn } from "@/lib/rate-limit-text";
import {
  checkAll,
  createMemoryRateLimiter,
  failOpen,
  LIMITS,
  REPORT_EVERY_MS,
  retryAfterSeconds,
  type RateLimiter,
} from "./limits";

const MIN = 60_000;

/** A clock the test moves by hand. Starts on a window boundary for every policy (a multiple of an hour). */
function clock(start = 1_000 * 60 * MIN) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

async function hits(limiter: RateLimiter, n: number, name = "book_ip" as const, id = "1.2.3.4") {
  const results = [];
  for (let i = 0; i < n; i++) results.push(await limiter(name, id));
  return results;
}

describe("the agreed limits", () => {
  it("are the numbers from the plan", () => {
    expect(LIMITS).toEqual({
      book_ip: { tokens: 5, windowMs: 10 * MIN },
      book_email: { tokens: 3, windowMs: 60 * MIN },
      manage: { tokens: 10, windowMs: 60 * MIN },
      slots: { tokens: 60, windowMs: MIN },
      pages: { tokens: 120, windowMs: MIN },
    });
  });
});

describe("in-memory sliding window", () => {
  it("allows 5 booking attempts per IP, refuses the 6th, and says when to retry", async () => {
    const c = clock();
    const limiter = createMemoryRateLimiter(c.now);
    const results = await hits(limiter, 6);
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results[5]).toEqual({ ok: false, retryAfterSeconds: 600 });
  });

  it("counts each identifier and each policy separately", async () => {
    const limiter = createMemoryRateLimiter(clock().now);
    await hits(limiter, 5, "book_ip", "1.1.1.1");
    expect(await limiter("book_ip", "2.2.2.2")).toEqual({ ok: true });
    expect(await limiter("slots", "1.1.1.1")).toEqual({ ok: true });
    expect(await limiter("book_ip", "1.1.1.1")).toMatchObject({ ok: false });
  });

  it("a refused attempt isn't counted: waiting long enough always works", async () => {
    const c = clock();
    const limiter = createMemoryRateLimiter(c.now);
    await hits(limiter, 5);
    await hits(limiter, 50); // hammering while blocked
    c.advance(20 * MIN); // two full windows later
    expect(await limiter("book_ip", "1.2.3.4")).toEqual({ ok: true });
  });

  it("is sliding, not fixed: a burst at the end of a window still counts just after the boundary", async () => {
    // A fixed window would reset at the boundary and allow 5 more at once: 10 in two seconds.
    const c = clock();
    const limiter = createMemoryRateLimiter(c.now);
    c.advance(10 * MIN - 1000); // 1 s before the boundary
    await hits(limiter, 5);
    c.advance(2000); // 1 s after it: the previous 5 weigh 5 × 599/600 = 4.99, rounded DOWN to 4
    // So one more gets through (Upstash rounds the same way), then nothing: 6 at most, not 10.
    const results = await hits(limiter, 5);
    expect(results.map((r) => r.ok)).toEqual([true, false, false, false, false]);
  });

  it("the previous window's weight fades as the new one goes on", async () => {
    const c = clock();
    const limiter = createMemoryRateLimiter(c.now);
    await hits(limiter, 5); // all at the start of window 1
    c.advance(10 * MIN + 6 * MIN); // 60% into window 2: 5 × 40% = 2 still count
    const results = await hits(limiter, 4);
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
  });

  it("retry time never points before the window ends", async () => {
    const c = clock();
    const limiter = createMemoryRateLimiter(c.now);
    c.advance(7 * MIN + 30_000);
    await hits(limiter, 5);
    expect(await limiter("book_ip", "1.2.3.4")).toEqual({ ok: false, retryAfterSeconds: 150 });
  });
});

describe("checkAll", () => {
  it("stops at the first refusal, so later limits aren't spent", async () => {
    const calls: string[] = [];
    const limiter: RateLimiter = async (name) => {
      calls.push(name);
      return name === "book_ip" ? { ok: false, retryAfterSeconds: 9 } : { ok: true };
    };
    expect(
      await checkAll(limiter, [
        ["book_ip", "ip"],
        ["book_email", "e"],
      ]),
    ).toEqual({ ok: false, retryAfterSeconds: 9 });
    expect(calls).toEqual(["book_ip"]);
  });

  it("an email over its limit is refused even from a fresh IP", async () => {
    const limiter = createMemoryRateLimiter(clock().now);
    const book = (ip: string) =>
      checkAll(limiter, [
        ["book_ip", ip],
        ["book_email", "ada@example.com"],
      ]);
    expect((await Promise.all(["1", "2", "3"].map(book))).every((r) => r.ok)).toBe(true);
    expect(await book("4")).toMatchObject({ ok: false });
  });
});

describe("failOpen", () => {
  it("lets requests through when the store throws, and reports once per interval", async () => {
    const c = clock();
    const report = vi.fn();
    const broken: RateLimiter = () => Promise.reject(new Error("ECONNREFUSED"));
    const limiter = failOpen(broken, report, c.now);

    expect(await hits(limiter, 3)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toBeInstanceOf(Error);

    c.advance(REPORT_EVERY_MS);
    await limiter("slots", "x");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("passes a working store's answers through untouched", async () => {
    const limiter = failOpen(createMemoryRateLimiter(clock().now), vi.fn());
    const results = await hits(limiter, 6);
    expect(results[5]).toMatchObject({ ok: false });
  });
});

describe("retry wording", () => {
  it("rounds up to whole minutes and never says zero", () => {
    expect(retryAfterSeconds(1000, 1000)).toBe(1);
    expect(retryAfterSeconds(2500, 1000)).toBe(2);
    expect(tryAgainIn(1)).toBe("in a minute");
    expect(tryAgainIn(60)).toBe("in a minute");
    expect(tryAgainIn(61)).toBe("in 2 minutes");
    expect(tryAgainIn(600)).toBe("in 10 minutes");
    expect(tooManyAttempts(150)).toBe("Too many attempts. Please try again in 3 minutes.");
  });
});
