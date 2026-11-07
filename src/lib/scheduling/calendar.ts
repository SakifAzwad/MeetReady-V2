import { TZDate } from "@date-fns/tz";
import { addDaysToKey, dayOfWeek, toDateKey, type DateKey } from "./time";

/*
 * Helpers for the guest's month view. Everything here is in the GUEST's
 * timezone: the calendar shows their dates, their times.
 */

export type YearMonth = { year: number; month: number }; // month: 1–12

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/**
 * The UTC instants where this month starts and ends for someone in `timeZone`.
 * November in Dhaka starts at 2026-10-31T18:00Z, not 2026-11-01T00:00Z, and a
 * month containing a DST change isn't a whole number of 24h days.
 */
export function monthRangeInZone({ year, month }: YearMonth, timeZone: string): { from: Date; to: Date } {
  const next = addMonths({ year, month }, 1);
  return {
    from: new Date(new TZDate(year, month - 1, 1, 0, 0, timeZone).getTime()),
    to: new Date(new TZDate(next.year, next.month - 1, 1, 0, 0, timeZone).getTime()),
  };
}

/**
 * Weeks of the month, Monday first, padded with null so every row has 7 cells.
 * Pure calendar arithmetic on DateKeys: no timezone involved.
 */
export function monthGrid({ year, month }: YearMonth): (DateKey | null)[][] {
  const first = toDateKey(year, month, 1);
  const leading = (dayOfWeek(first) + 6) % 7; // Monday = 0 … Sunday = 6
  const cells: (DateKey | null)[] = Array.from({ length: leading }, () => null);
  for (let d = first; Number(d.slice(5, 7)) === month; d = addDaysToKey(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** "3:00 PM" (12-hour) or "15:00" (24-hour) in the viewer's timezone. */
export function formatTime(instant: Date, timeZone: string, hour12 = true): string {
  return new Intl.DateTimeFormat(hour12 ? "en-US" : "en-GB", {
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hourCycle: hour12 ? "h12" : "h23",
    timeZone,
  }).format(instant);
}

/**
 * A compact range: "3–11 AM", "9:30 AM–5 PM", "10 PM–12 AM", or "03:00–11:00".
 * Whole hours drop ":00", and a shared AM/PM is written once.
 */
export function formatTimeRange(start: Date, end: Date, timeZone: string, hour12 = true): string {
  if (!hour12) return `${formatTime(start, timeZone, false)}–${formatTime(end, timeZone, false)}`;
  const parts = (d: Date) => {
    // \s, not " ": newer ICU versions (some browsers) put a narrow no-break
    // space (U+202F) between the time and AM/PM.
    const [time, period] = formatTime(d, timeZone).split(/\s+/) as [string, string];
    return { time: time.endsWith(":00") ? time.slice(0, -3) : time, period };
  };
  const a = parts(start);
  const b = parts(end);
  return a.period === b.period
    ? `${a.time}–${b.time} ${b.period}`
    : `${a.time} ${a.period}–${b.time} ${b.period}`;
}

/** "Monday, 9 November 2026" for a calendar date (formatted as a date, never shifted by a timezone). */
export function formatDateKey(key: DateKey, style: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: style,
    day: "numeric",
    month: style,
    ...(style === "long" ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${key}T00:00:00Z`));
}

export function formatMonth({ year, month }: YearMonth): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}
