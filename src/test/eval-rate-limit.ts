import { APICallError, RetryError } from "ai";

/*
 * For the evals only (`npm run eval`). Groq's free plan allows 8,000 tokens a
 * minute per model, and the evals send about 30 requests back to back, so some
 * get "429: rate limit". A 429 says nothing about the prompt: wait and run the
 * same eval call again instead of failing it.
 *
 * The app itself doesn't do this: a guest isn't kept waiting for a minute.
 * It reports the failure ("try again later") and the times grid still works.
 */

const MAX_ATTEMPTS = 4;
const MIN_WAIT_MS = 10_000;

/** How long to wait if `error` is the provider's rate limit (also inside the SDK's RetryError); null otherwise. */
export function rateLimitWait(error: unknown): number | null {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(last) || last.statusCode !== 429) return null;
  const retryAfter = Number(last.responseHeaders?.["retry-after"]);
  // The limit is a rolling minute, and a multi-step run makes several calls: wait at least 10 s.
  return Math.max(MIN_WAIT_MS, Number.isFinite(retryAfter) ? retryAfter * 1000 + 1000 : 0);
}

/** Runs `call` again (up to 4 times) while its result failed with a rate limit. */
export async function withRateLimitRetries<T>(
  call: () => Promise<T>,
  errorOf: (result: T) => unknown,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const result = await call();
    const wait = rateLimitWait(errorOf(result));
    if (wait === null || attempt === MAX_ATTEMPTS) return result;
    // eslint-disable-next-line no-console -- an eval is read by a person: say why it paused.
    console.log(`(rate limited by the provider: waiting ${Math.round(wait / 1000)} s, then trying again)`);
    await sleep(wait);
  }
}
