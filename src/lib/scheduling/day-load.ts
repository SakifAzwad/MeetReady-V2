import { dayBounds } from "./daylight";
import { mergeIntervals, type Interval } from "./intervals";
import type { DateKey } from "./time";

/*
 * How full a host's day is: minutes of working hours, minutes booked, and
 * minutes still free (from now on: this morning's empty hour is gone, not
 * free), for the dashboard's week view. Pure and tested like
 * the slot generator: real elapsed time, so DST days are counted correctly.
 */

export type DayLoad = { workingMinutes: number; bookedMinutes: number; freeMinutes: number };

const minutes = (intervals: readonly Interval[]) =>
  intervals.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()) / 60_000, 0);

function clip(intervals: readonly Interval[], to: Interval): Interval[] {
  return intervals
    .map((i) => ({
      start: new Date(Math.max(i.start.getTime(), to.start.getTime())),
      end: new Date(Math.min(i.end.getTime(), to.end.getTime())),
    }))
    .filter((i) => i.start < i.end);
}

export function dayLoad(
  windows: readonly Interval[],
  meetings: readonly Interval[],
  day: DateKey,
  timeZone: string,
  /** Time already gone isn't "free": free time is counted from here on. */
  now: Date,
): DayLoad {
  const bounds = dayBounds(day, timeZone);
  const working = mergeIntervals(clip(windows, bounds));
  // Merged first: two overlapping meetings (possible across cancelled/rescheduled history) count once.
  const booked = mergeIntervals(clip(meetings, bounds));
  // Free = working time not covered by a meeting. A meeting outside working hours
  // (booked before the hours changed) counts as booked but doesn't make free time negative.
  const ahead = clip(working, { start: now, end: bounds.end });
  const bookedAhead = ahead.flatMap((w) => clip(booked, w));
  return {
    workingMinutes: minutes(working),
    bookedMinutes: minutes(booked),
    freeMinutes: minutes(ahead) - minutes(bookedAhead),
  };
}
