import type { Interval } from "./intervals";
import { addDaysToKey, dateKeyInZone, wallTimeToInstant, type DateKey } from "./time";

/*
 * The booking page's daylight band: the GUEST's day from midnight to
 * midnight, with the host's working hours drawn on it. Pure functions, so
 * the tricky cases (windows crossing midnight, 23/25-hour DST days) are
 * unit-tested like generateSlots.
 */

/** Guest-local midnight to the next midnight, as instants. 23h or 25h on DST days. */
export function dayBounds(day: DateKey, timeZone: string): Interval {
  return {
    start: wallTimeToInstant(day, "00:00", timeZone),
    end: wallTimeToInstant(addDaysToKey(day, 1), "00:00", timeZone),
  };
}

export type BandSegment = {
  start: Date;
  end: Date;
  /** Position on the band, 0–100, measured in real elapsed time across the day. */
  left: number;
  width: number;
};

/**
 * The parts of `windows` that fall on the guest's `day`, as band positions.
 * A host day that crosses the guest's midnight becomes two segments, one at
 * each end (e.g. a Dhaka 9–5 seen from New York: 22:00–24:00 and 00:00–06:00).
 */
export function bandSegments(windows: readonly Interval[], day: DateKey, timeZone: string): BandSegment[] {
  const { start: dayStart, end: dayEnd } = dayBounds(day, timeZone);
  const length = dayEnd.getTime() - dayStart.getTime();
  return windows
    .filter((w) => w.end > dayStart && w.start < dayEnd)
    .map((w) => {
      const start = new Date(Math.max(w.start.getTime(), dayStart.getTime()));
      const end = new Date(Math.min(w.end.getTime(), dayEnd.getTime()));
      return {
        start,
        end,
        left: ((start.getTime() - dayStart.getTime()) / length) * 100,
        width: ((end.getTime() - start.getTime()) / length) * 100,
      };
    })
    .sort((a, b) => a.left - b.left);
}

/** Where "now" sits on the band (0–100), or null if `day` isn't today for the guest. */
export function nowPosition(now: Date, day: DateKey, timeZone: string): number | null {
  const { start, end } = dayBounds(day, timeZone);
  if (now < start || now >= end) return null;
  return ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100;
}

export type PartOfDay = "early" | "morning" | "afternoon" | "evening" | "night";

/** Symbolic, not astronomical: the same five parts everywhere, by local hour. */
export function partOfDay(instant: Date, timeZone: string): PartOfDay {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(instant),
  );
  if (hour < 6) return "early";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

export const PART_OF_DAY_LABEL: Record<PartOfDay, string> = {
  early: "Early hours",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

/** Minutes the zone is ahead of UTC at that instant (DST-aware). */
export function utcOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/** "6 hours ahead", "5 hours 30 minutes behind", or null for the same offset. */
export function offsetDifference(hostZone: string, guestZone: string, at: Date): string | null {
  const diff = utcOffsetMinutes(at, hostZone) - utcOffsetMinutes(at, guestZone);
  if (diff === 0) return null;
  const abs = Math.abs(diff);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const text = [
    hours ? `${hours} hour${hours === 1 ? "" : "s"}` : null,
    minutes ? `${minutes} minutes` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${text} ${diff > 0 ? "ahead" : "behind"}`;
}

/**
 * Browsers still report some zones by old names (Chrome: "Asia/Calcutta").
 * Show the city's current name; the IANA id itself is unchanged.
 */
const RENAMED: Record<string, string> = {
  Calcutta: "Kolkata",
  Saigon: "Ho Chi Minh City",
  Katmandu: "Kathmandu",
  Rangoon: "Yangon",
  Kiev: "Kyiv",
  Dacca: "Dhaka",
};

/** "Asia/Dhaka" -> "Dhaka", "America/Argentina/Buenos_Aires" -> "Buenos Aires", "Asia/Calcutta" -> "Kolkata" */
export function cityName(timeZone: string): string {
  const city = (timeZone.split("/").at(-1) ?? timeZone).replaceAll("_", " ");
  return RENAMED[city] ?? city;
}

/**
 * "Daytime" for the guest: 8 AM–8 PM on their day. We don't know a guest's
 * working hours, so the booking page says "your daytime", never "your
 * working hours" or "best mutual hours", which would claim knowledge we don't have.
 */
export const DAYTIME = { from: "08:00", to: "20:00" } as const;

export function daytimeBounds(day: DateKey, timeZone: string): Interval {
  return {
    start: wallTimeToInstant(day, DAYTIME.from, timeZone),
    end: wallTimeToInstant(day, DAYTIME.to, timeZone),
  };
}

/** The parts of the host's windows that fall inside the guest's daytime on `day`. */
export function daytimeOverlap(windows: readonly Interval[], day: DateKey, timeZone: string): Interval[] {
  const { start, end } = daytimeBounds(day, timeZone);
  return windows
    .map((w) => ({
      start: new Date(Math.max(w.start.getTime(), start.getTime())),
      end: new Date(Math.min(w.end.getTime(), end.getTime())),
    }))
    .filter((i) => i.start < i.end);
}

/**
 * When nothing overlaps, the closest the host gets to the guest's daytime:
 * the latest end before it ("finishes at 7 AM your time") and/or the
 * earliest start after it ("starts at 9 PM").
 */
export function nearestToDaytime(
  segments: readonly Interval[],
  day: DateKey,
  timeZone: string,
): { endsBefore: Date | null; startsAfter: Date | null } {
  const { start, end } = daytimeBounds(day, timeZone);
  let endsBefore: Date | null = null;
  let startsAfter: Date | null = null;
  for (const s of segments) {
    if (s.end <= start && (!endsBefore || s.end > endsBefore)) endsBefore = s.end;
    if (s.start >= end && (!startsAfter || s.start < startsAfter)) startsAfter = s.start;
  }
  return { endsBefore, startsAfter };
}

/** Does the whole slot fall inside the guest's daytime (8 AM–8 PM their time)? */
export function isInDaytime(slot: Interval, timeZone: string): boolean {
  const { start, end } = daytimeBounds(dateKeyInZone(slot.start, timeZone), timeZone);
  return slot.start >= start && slot.end <= end;
}

/**
 * Splits a day's slots into the ones before the guest's daytime, inside it,
 * and after it. The booking page shows `daytime` first and folds the others
 * away, so the first time a guest reads is 8:00 AM, not 3:00 AM. If nothing
 * is in daytime, everything stays visible (folding it all would hide the day).
 */
export function splitByDaytime<T extends Interval>(
  slots: readonly T[],
  timeZone: string,
): { before: T[]; daytime: T[]; after: T[] } {
  const daytime = slots.filter((s) => isInDaytime(s, timeZone));
  if (daytime.length === 0) return { before: [], daytime: [...slots], after: [] };
  const first = daytime[0]!.start;
  return {
    before: slots.filter((s) => !isInDaytime(s, timeZone) && s.start < first),
    daytime,
    after: slots.filter((s) => !isInDaytime(s, timeZone) && s.start > first),
  };
}
