import { eq } from "drizzle-orm";
import { calendarConnections } from "@/db/schema";
import type { Database } from "@/db/types";
import type { Interval } from "@/lib/scheduling/intervals";
import { cacheKey, FRESH_MS, STALE_MS, type BusyCache } from "./cache";
import { CalendarUnavailableError, type CalendarErrorKind } from "./google-api";

/*
 * Busy times from a host's connected calendar, for slot generation.
 *
 * The booking code depends on this small interface, not on Google: unit tests
 * pass a fake, and slot generation stays a pure function that just gets more
 * busy intervals (Day 1's design paying off).
 */
export interface ExternalBusy {
  /**
   * Busy intervals in `range`, or [] if the host has no calendar connected.
   * Throws CalendarUnavailableError when the calendar can't be read.
   *
   *  - "cached": for SHOWING times (booking page, share-times). Fresh cache
   *    first; if Google fails, a stale copy up to an hour old.
   *  - "live": for BOOKING. Always asks Google; never falls back to the cache.
   *    Showing a slightly old list is fine (booking re-checks); confirming a
   *    meeting against old data is not.
   */
  busyTimes(hostId: string, range: Interval, freshness: "cached" | "live"): Promise<Interval[]>;
}

export { CalendarUnavailableError };

export type CalendarBusyDeps = {
  db: Database;
  cache: BusyCache;
  /** A valid access token for the account (refreshed when needed). Throws if it can't get one. */
  getAccessToken: (userId: string, accountId: string) => Promise<string>;
  queryFreeBusy: (accessToken: string, calendarId: string, range: Interval) => Promise<Interval[]>;
  /** Called once when a connection goes from healthy to failing, not on every failed request. */
  report: (error: CalendarUnavailableError, hostId: string) => void;
  now?: () => number;
};

export function createCalendarBusy(deps: CalendarBusyDeps): ExternalBusy {
  const now = deps.now ?? Date.now;

  /** Remembers the failure on the connection (the dashboard shows it), only when it changes: no write per request. */
  async function recordError(
    hostId: string,
    previous: CalendarErrorKind | null,
    kind: CalendarErrorKind | null,
  ) {
    if (previous === kind) return;
    await deps.db
      .update(calendarConnections)
      .set({ lastError: kind, lastErrorAt: kind ? new Date(now()) : null })
      .where(eq(calendarConnections.userId, hostId));
  }

  const safeCache = {
    get: (key: string) => deps.cache.get(key).catch(() => null),
    set: (key: string, busy: Interval[]) => deps.cache.set(key, { fetchedAt: now(), busy }).catch(() => {}),
  };

  return {
    async busyTimes(hostId, range, freshness) {
      const [connection] = await deps.db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.userId, hostId));
      if (!connection) return [];

      const key = cacheKey(hostId, range);
      const cached = freshness === "cached" ? await safeCache.get(key) : null;
      if (cached && now() - cached.fetchedAt < FRESH_MS) return cached.busy;

      try {
        let token: string;
        try {
          token = await deps.getAccessToken(hostId, connection.accountId);
        } catch (cause) {
          // Better Auth reports every refresh failure the same way. The usual cause is a
          // revoked grant (the host removed access at Google), so it's treated as lost access.
          throw new CalendarUnavailableError("access_lost", "No valid Google access token", { cause });
        }
        const busy = await deps.queryFreeBusy(token, connection.calendarId, range);
        await recordError(hostId, connection.lastError, null);
        if (freshness === "cached") await safeCache.set(key, busy);
        return busy;
      } catch (error) {
        if (!(error instanceof CalendarUnavailableError)) throw error;
        if (connection.lastError !== error.kind) deps.report(error, hostId);
        await recordError(hostId, connection.lastError, error.kind);
        // Showing times: an hour-old copy beats an empty page. Booking: never.
        if (cached && now() - cached.fetchedAt < STALE_MS) return cached.busy;
        throw error;
      }
    },
  };
}
