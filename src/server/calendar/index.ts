import "server-only";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { env } from "@/lib/env";
import { auth } from "@/server/auth";
import { getRedis, redisPrefix } from "@/server/redis";
import { createCalendarBusy } from "./busy";
import { createMemoryBusyCache, createRedisBusyCache } from "./cache";
import { completeCalendarConnection, disconnectCalendar, getCalendarStatus } from "./connection";
import { deleteGoogleEvent, queryFreeBusy, revokeGoogleToken, upsertGoogleEvent } from "./google-api";
import { createCalendarSync } from "./sync";

/*
 * The real wiring: Better Auth for tokens, Google over fetch, Redis (or
 * memory) for the cache, Sentry for reports. Everything testable lives in the
 * files this imports; this file only connects them.
 */

/**
 * Better Auth decrypts the stored token and refreshes it when it's within a
 * few seconds of expiring (saving the new one, encrypted). Called with the
 * host's user id and no request: a guest's request must never act as the host.
 */
async function getAccessToken(userId: string, accountId: string): Promise<string> {
  const { accessToken } = await auth.api.getAccessToken({ body: { accountId, userId } });
  return accessToken;
}

const redis = getRedis();
const cache = redis ? createRedisBusyCache(redis, redisPrefix) : createMemoryBusyCache();

export const calendarBusy = createCalendarBusy({
  db,
  cache,
  getAccessToken,
  queryFreeBusy: (accessToken, calendarId, range) =>
    queryFreeBusy({ baseUrl: env.GOOGLE_CALENDAR_API_URL, accessToken, calendarId, range, fetch }),
  // Reported when a connection starts failing (not per request). Nothing about the host or
  // their events is attached: the kind and the message say what broke.
  report: (error) => Sentry.captureException(error, { tags: { area: "calendar", kind: error.kind } }),
});

/** Day 16: keeps the host's Google Calendar in step with a booking. See sync.ts. */
export const calendarSync = createCalendarSync({
  db,
  appUrl: env.BETTER_AUTH_URL,
  getAccessToken,
  writer: {
    upsertEvent: (args) => upsertGoogleEvent({ ...args, baseUrl: env.GOOGLE_CALENDAR_API_URL, fetch }),
    deleteEvent: (args) => deleteGoogleEvent({ ...args, baseUrl: env.GOOGLE_CALENDAR_API_URL, fetch }),
  },
  // One report per failed write. The booking id lets it be found; nothing about the guest is attached.
  report: (error, bookingId) =>
    Sentry.captureException(error, { tags: { area: "calendar-sync" }, extra: { bookingId } }),
});

export async function connectCalendar(userId: string) {
  const outcome = await completeCalendarConnection(db, userId);
  if (outcome === "connected") await cache.clearHost(userId).catch(() => {});
  return outcome;
}

export async function disconnectCalendarForUser(userId: string) {
  await disconnectCalendar(db, userId, {
    getAccessToken,
    revoke: (token) => revokeGoogleToken(token, fetch, env.GOOGLE_REVOKE_URL),
  });
  await cache.clearHost(userId).catch(() => {});
}

export const calendarStatus = (userId: string) => getCalendarStatus(db, userId);

export { CalendarUnavailableError, type ExternalBusy } from "./busy";
