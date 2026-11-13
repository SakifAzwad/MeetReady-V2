/*
 * Google Calendar permissions, shared by the dashboard's "Connect" button
 * (browser) and the server's checks. A plain module, so both can import it.
 *
 * Asked for together, on one Google consent screen (Day 15 decision), so the
 * host isn't asked twice when Day 16 starts writing events:
 *  - calendar.freebusy: busy/free times only. Google never sends us event
 *    titles, guests or descriptions, because this scope can't see them.
 *  - calendar.events: create, change and delete events (Day 16: each booking
 *    goes into the host's calendar with a Meet link). Note: free/busy queries
 *    don't accept this scope, so it doesn't replace the first one.
 */
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

/**
 * Did the host grant every calendar permission? Google's consent screen lets
 * people untick individual permissions, so "they came back from Google" isn't
 * proof. Better Auth stores granted scopes comma-separated; Google itself uses
 * spaces. Both are accepted.
 */
export function hasCalendarScopes(storedScope: string | null | undefined): boolean {
  const granted = new Set((storedScope ?? "").split(/[\s,]+/).filter(Boolean));
  return CALENDAR_SCOPES.every((s) => granted.has(s));
}

/** The scope string to keep after disconnecting: whatever was granted, minus the calendar ones. */
export function withoutCalendarScopes(storedScope: string | null | undefined): string {
  const calendar = new Set<string>(CALENDAR_SCOPES);
  return (storedScope ?? "")
    .split(/[\s,]+/)
    .filter((s) => s && !calendar.has(s))
    .join(",");
}
