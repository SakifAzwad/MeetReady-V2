/*
 * Postgres reports constraint failures with SQLSTATE codes. We let the database
 * enforce rules (unique usernames, no overlapping bookings) and translate the
 * code into a friendly message, instead of "check first, then write", which
 * races when two requests arrive at once.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_CHECK_VIOLATION = "23514";
export const PG_EXCLUSION_VIOLATION = "23P01";

/** Drizzle wraps driver errors; the Postgres error is on `.cause`. */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return String((cause as { code: unknown }).code);
  }
  return "code" in error ? String((error as { code: unknown }).code) : undefined;
}

export function pgConstraintName(error: unknown): string | undefined {
  const cause = (error as { cause?: { constraint?: string } } | null)?.cause;
  return cause?.constraint ?? (error as { constraint?: string } | null)?.constraint;
}
