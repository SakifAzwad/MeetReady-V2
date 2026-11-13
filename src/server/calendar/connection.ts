import { and, eq } from "drizzle-orm";
import { account, calendarConnections } from "@/db/schema";
import type { Database } from "@/db/types";
import { hasCalendarScopes, withoutCalendarScopes } from "@/lib/calendar";

/*
 * Connecting and disconnecting a host's Google Calendar. Every function takes
 * the user id from the caller, which always gets it from the session.
 *
 * How connecting works:
 *  1. The dashboard asks Better Auth to LINK the Google account again, with
 *     the calendar scopes, `access_type=offline` (a refresh token, so we can
 *     read busy times while the host is away) and `prompt=consent` (Google
 *     only sends a refresh token on a consent screen).
 *  2. Google sends the host back; Better Auth stores the new tokens
 *     (encrypted) and the granted scopes on the existing account row.
 *  3. Our callback route runs completeCalendarConnection(): it checks what was
 *     REALLY granted, then creates the connection.
 */

const GOOGLE = "google";

export type ConnectOutcome = "connected" | "missing_permission" | "no_google_account";

async function googleAccount(db: Database, userId: string) {
  const [row] = await db
    .select({ id: account.id, scope: account.scope, refreshToken: account.refreshToken })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, GOOGLE)));
  return row ?? null;
}

export async function completeCalendarConnection(db: Database, userId: string): Promise<ConnectOutcome> {
  const google = await googleAccount(db, userId);
  if (!google) return "no_google_account";
  // Google's consent screen lets people untick permissions; and without a refresh
  // token, busy times would stop working an hour later, when the access token expires.
  if (!hasCalendarScopes(google.scope) || !google.refreshToken) return "missing_permission";

  await db
    .insert(calendarConnections)
    .values({ userId, accountId: google.id })
    .onConflictDoUpdate({
      target: calendarConnections.userId,
      // Reconnecting is also how a host fixes a broken connection: start healthy.
      set: { accountId: google.id, lastError: null, lastErrorAt: null, updatedAt: new Date() },
    });
  return "connected";
}

export type CalendarStatus =
  | { connected: false }
  | {
      connected: true;
      calendarId: string;
      lastError: "access_lost" | "unavailable" | null;
      lastErrorAt: Date | null;
    };

export async function getCalendarStatus(db: Database, userId: string): Promise<CalendarStatus> {
  const [row] = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
  if (!row) return { connected: false };
  return {
    connected: true,
    calendarId: row.calendarId,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
  };
}

/**
 * Disconnect: revoke at Google (best effort), then forget the calendar tokens
 * and scopes and delete the connection. Signing in keeps working: it never
 * needed stored tokens. The host's MeetReady bookings are untouched.
 */
export async function disconnectCalendar(
  db: Database,
  userId: string,
  deps: {
    getAccessToken: (userId: string, accountId: string) => Promise<string>;
    revoke: (token: string) => Promise<boolean>;
  },
): Promise<void> {
  const [connection] = await db
    .select({ accountId: calendarConnections.accountId })
    .from(calendarConnections)
    .where(eq(calendarConnections.userId, userId));
  if (!connection) return;

  // Revoking needs a token that still works; if there isn't one, the grant is already dead.
  try {
    await deps.revoke(await deps.getAccessToken(userId, connection.accountId));
  } catch {
    // Best effort: our own copies are deleted below either way.
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ scope: account.scope })
      .from(account)
      .where(and(eq(account.id, connection.accountId), eq(account.userId, userId)));
    await tx
      .update(account)
      .set({
        accessToken: null,
        refreshToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: withoutCalendarScopes(row?.scope),
      })
      .where(and(eq(account.id, connection.accountId), eq(account.userId, userId)));
    await tx.delete(calendarConnections).where(eq(calendarConnections.userId, userId));
  });
}
