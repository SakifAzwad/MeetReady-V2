import { APICallError, RetryError } from "ai";
import { describe, expect, it, vi } from "vitest";
import { rateLimitWait, withRateLimitRetries } from "./eval-rate-limit";

const apiError = (statusCode: number, headers: Record<string, string> = {}) =>
  new APICallError({
    message: "x",
    url: "https://api.groq.com",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  });
const retried = (last: unknown) =>
  new RetryError({ message: "Failed after 2 attempts", reason: "maxRetriesExceeded", errors: [last, last] });

describe("eval rate-limit retries", () => {
  it("recognises a 429, also inside the SDK's RetryError, and waits at least 10 s", () => {
    expect(rateLimitWait(retried(apiError(429, { "retry-after": "0.5" })))).toBe(10_000);
    expect(rateLimitWait(apiError(429, { "retry-after": "30" }))).toBe(31_000);
    expect(rateLimitWait(apiError(429))).toBe(10_000);
  });

  it("ignores everything else", () => {
    expect(rateLimitWait(apiError(500))).toBeNull();
    expect(rateLimitWait(new Error("429"))).toBeNull();
    expect(rateLimitWait(undefined)).toBeNull();
  });

  it("runs the call again after a rate limit, and stops after 4 attempts", async () => {
    const sleep = vi.fn(async () => {});
    const limited = { error: retried(apiError(429)) };
    const call = vi
      .fn<() => Promise<{ error: unknown }>>()
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce({ error: undefined });
    expect(await withRateLimitRetries(call, (r) => r.error, sleep)).toEqual({ error: undefined });
    expect(call).toHaveBeenCalledTimes(2);

    const always = vi.fn(async () => limited);
    expect(await withRateLimitRetries(always, (r) => r.error, sleep)).toBe(limited);
    expect(always).toHaveBeenCalledTimes(4);
  });
});
