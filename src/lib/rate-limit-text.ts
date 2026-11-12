/*
 * Wording for "you've been rate limited", shared by the booking page, the
 * manage page and proxy. A plain module (not "use client"), so server and
 * browser code can both import it.
 */

/** "in a minute", "in 7 minutes": rounded UP, so the guest never retries too early. */
export function tryAgainIn(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1 ? "in a minute" : `in ${minutes} minutes`;
}

export const tooManyAttempts = (retryAfterSeconds: number) =>
  `Too many attempts. Please try again ${tryAgainIn(retryAfterSeconds)}.`;
