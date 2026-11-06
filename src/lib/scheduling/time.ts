import { TZDate } from "@date-fns/tz";

/**
 * A calendar date with no time and no timezone, e.g. "2026-11-09".
 * Availability is defined in the host's wall-clock time ("Mondays 09:00–17:00
 * in Asia/Dhaka"), so we need a type for "a day on the host's calendar" that
 * is NOT an instant. Using Date for this is the classic bug: a Date is an
 * instant, and which calendar day it falls on depends on the timezone.
 */
export type DateKey = `${number}-${number}-${number}`;

/** "HH:mm" in 24h, 00:00–24:00. "24:00" means end of that day. */
export type WallTime = string;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseWallTime(time: WallTime): { hours: number; minutes: number } {
  if (!TIME_RE.test(time)) {
    throw new Error(`Invalid wall time "${time}", expected HH:mm`);
  }
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return { hours, minutes };
}

export function parseDateKey(key: DateKey): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(key);
  if (!match) throw new Error(`Invalid date key "${key}", expected YYYY-MM-DD`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateKey(year: number, month: number, day: number): DateKey {
  return `${year}-${pad(month)}-${pad(day)}` as DateKey;
}

/** The calendar date an instant falls on in a given timezone. */
export function dateKeyInZone(instant: Date, timeZone: string): DateKey {
  const zoned = new TZDate(instant, timeZone);
  return toDateKey(zoned.getFullYear(), zoned.getMonth() + 1, zoned.getDate());
}

/**
 * Pure calendar arithmetic. Done in UTC on purpose: adding a day to a date
 * key must never be affected by DST, and in UTC every day is 24h long.
 */
export function addDaysToKey(key: DateKey, days: number): DateKey {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return toDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday (same as Date#getDay and Postgres EXTRACT(DOW)). */
export function dayOfWeek(key: DateKey): number {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Converts "this wall-clock time on this date in this timezone" to an instant.
 *
 * We construct the local time directly instead of doing "local midnight + N
 * minutes", because on a DST day midnight + 9h is NOT 09:00 local.
 *
 * DST edge cases (handled by TZDate, same rules as Temporal's "compatible"
 * disambiguation):
 *  - Wall time that doesn't exist (spring-forward gap, e.g. 02:30 in New York
 *    on 8 Mar 2026) moves forward by the gap length -> 03:30.
 *  - Wall time that happens twice (fall-back, 01:30 on 1 Nov 2026) resolves to
 *    the earlier occurrence.
 */
export function wallTimeToInstant(key: DateKey, time: WallTime, timeZone: string): Date {
  const { year, month, day } = parseDateKey(key);
  const { hours, minutes } = parseWallTime(time);
  // "24:00" = 00:00 on the next day. The Date constructor normalises day + 1.
  const zoned =
    hours === 24
      ? new TZDate(year, month - 1, day + 1, 0, 0, timeZone)
      : new TZDate(year, month - 1, day, hours, minutes, timeZone);
  return new Date(zoned.getTime());
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
