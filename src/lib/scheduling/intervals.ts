/**
 * Half-open time interval [start, end).
 *
 * Half-open is the convention everywhere in MeetReady (and in the Postgres
 * `tstzrange(start, end, '[)')` used by the bookings exclusion constraint):
 * a meeting 10:00–10:30 and one 10:30–11:00 touch but do NOT overlap.
 */
export type Interval = {
  start: Date;
  end: Date;
};

const MINUTE_MS = 60_000;

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

/** True if two half-open intervals share at least one instant. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Sorts intervals and merges any that overlap or touch.
 * [09:00,12:00) + [11:00,13:00) -> [09:00,13:00)
 * [22:00,24:00) + [00:00,02:00 next day) -> one continuous interval
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end.getTime() > i.start.getTime())
    .toSorted((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged.at(-1);
    if (last && current.start.getTime() <= last.end.getTime()) {
      if (current.end.getTime() > last.end.getTime()) {
        last.end = current.end;
      }
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }
  return merged;
}

/**
 * Removes `cut` from every interval: what's left can be nothing, one piece, or
 * two (when `cut` is in the middle).
 * [09:00,12:00) minus [10:00,10:30) -> [09:00,10:00) + [10:30,12:00)
 *
 * Used when rescheduling (Day 16): the booking's own event is in the host's
 * Google Calendar, and Google's free/busy answer merges it with any meeting
 * right before or after it, so it can't be picked out and dropped whole.
 * Cutting its time out of every busy block works either way.
 */
export function subtractInterval(intervals: readonly Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const i of intervals) {
    if (!overlaps(i, cut)) {
      out.push(i);
      continue;
    }
    if (i.start.getTime() < cut.start.getTime()) out.push({ start: i.start, end: cut.start });
    if (i.end.getTime() > cut.end.getTime()) out.push({ start: cut.end, end: i.end });
  }
  return out;
}
