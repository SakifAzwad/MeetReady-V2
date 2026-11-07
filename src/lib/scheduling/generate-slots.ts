import { addMinutes, mergeIntervals, overlaps, type Interval } from "./intervals";
import {
  addDaysToKey,
  dateKeyInZone,
  dayOfWeek,
  isValidTimeZone,
  wallTimeToInstant,
  type DateKey,
  type WallTime,
} from "./time";

/** "Every Monday 09:00–17:00", in the host's timezone. */
export type WeeklyRule = {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  startTime: WallTime;
  endTime: WallTime;
};

/**
 * Replaces the weekly rules for one specific date.
 * startTime/endTime both null = unavailable all day (holiday).
 * Several overrides for the same date = several windows that day.
 */
export type DateOverride = {
  date: DateKey;
  startTime: WallTime | null;
  endTime: WallTime | null;
};

/** Something already on the host's calendar (a booking, later a Google Calendar event). */
export type BusyInterval = Interval & {
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  /** True for bookings of THIS event type, so maxBookingsPerDay can count them. */
  countsTowardDailyLimit?: boolean;
};

export type SlotGenerationInput = {
  /** Only return slots whose start is in [range.start, range.end). Usually the month the guest is viewing. */
  range: Interval;
  /** Injected instead of calling `new Date()` inside, so the function stays pure and testable. */
  now: Date;
  host: {
    timeZone: string;
    weeklyRules: readonly WeeklyRule[];
    dateOverrides: readonly DateOverride[];
  };
  eventType: {
    durationMinutes: number;
    /** Gap between slot start times. Defaults to the duration (30-min event -> 09:00, 09:30, …). */
    slotIntervalMinutes?: number | null;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minimumNoticeMinutes: number;
    /** Bookable dates = today … today + (N - 1) in the host's timezone. null = no limit. */
    bookingWindowDays: number | null;
    maxBookingsPerDay: number | null;
  };
  busy: readonly BusyInterval[];
};

export type Slot = Interval;

export function generateSlots(input: SlotGenerationInput): Slot[] {
  const { range, now, host, eventType, busy } = input;
  validate(input);

  const tz = host.timeZone;
  const duration = eventType.durationMinutes;
  const step = eventType.slotIntervalMinutes ?? duration;

  // 1–2. The host's availability windows around the range, as UTC instants.
  const windows = availabilityWindows(range, host);

  // 3. Limits that don't depend on the individual slot.
  const earliestStart = addMinutes(now, eventType.minimumNoticeMinutes);
  const lastBookableDay =
    eventType.bookingWindowDays === null
      ? null
      : addDaysToKey(dateKeyInZone(now, tz), eventType.bookingWindowDays - 1);
  const fullDays = daysAtDailyLimit(busy, tz, eventType.maxBookingsPerDay);

  // 4. Walk each window in `step` increments and keep the candidates that pass every rule.
  const slots: Slot[] = [];
  for (const window of windows) {
    for (
      let start = window.start;
      addMinutes(start, duration).getTime() <= window.end.getTime();
      start = addMinutes(start, step)
    ) {
      const slot: Slot = { start, end: addMinutes(start, duration) };

      if (start < range.start || start >= range.end) continue;
      if (start < earliestStart) continue;

      const day = dateKeyInZone(start, tz);
      if (lastBookableDay !== null && day > lastBookableDay) continue; // "YYYY-MM-DD" compares correctly as a string
      if (fullDays.has(day)) continue;

      if (conflictsWithBusy(slot, eventType, busy)) continue;

      slots.push(slot);
    }
  }
  return slots;
}

/**
 * The host's working windows (weekly rules, with date overrides applied) that
 * touch `range`, as merged UTC intervals. Bookings are NOT subtracted: this is
 * "when does the host work", used by generateSlots and by the booking page's
 * daylight band, so the two can never disagree.
 */
export function availabilityWindows(range: Interval, host: SlotGenerationInput["host"]): Interval[] {
  const tz = host.timeZone;
  // Host-calendar days to look at. One extra day before the range so a
  // window that runs past midnight into the range is still seen whole.
  const firstDay = addDaysToKey(dateKeyInZone(range.start, tz), -1);
  const lastDay = dateKeyInZone(range.end, tz);
  const overridesByDate = groupBy(host.dateOverrides, (o) => o.date);
  // Merging handles overlapping rules and windows that continue over midnight.
  return mergeIntervals(
    eachDay(firstDay, lastDay).flatMap((day) =>
      windowsForDay(day, tz, host.weeklyRules, overridesByDate.get(day)),
    ),
  ).filter((w) => w.end > range.start && w.start < range.end);
}

function windowsForDay(
  day: DateKey,
  tz: string,
  weeklyRules: readonly WeeklyRule[],
  overrides: readonly DateOverride[] | undefined,
): Interval[] {
  // An override for a date replaces that date's weekly rules completely.
  const source = overrides ?? weeklyRules.filter((r) => r.dayOfWeek === dayOfWeek(day));

  return source.flatMap((rule) => {
    if (rule.startTime === null || rule.endTime === null) return []; // day off
    return [
      {
        start: wallTimeToInstant(day, rule.startTime, tz),
        end: wallTimeToInstant(day, rule.endTime, tz),
      },
    ];
  });
}

/**
 * Buffers are "free time I want around a meeting", so two buffers may share the
 * same free time. A slot conflicts if:
 *  - the slot plus ITS buffers overlaps an existing meeting, or
 *  - the slot overlaps an existing meeting plus THAT meeting's buffers.
 * Net effect: the gap between two meetings must be at least
 * max(previous.bufferAfter, next.bufferBefore), not the sum.
 */
function conflictsWithBusy(
  slot: Slot,
  eventType: SlotGenerationInput["eventType"],
  busy: readonly BusyInterval[],
): boolean {
  const slotWithBuffers: Interval = {
    start: addMinutes(slot.start, -eventType.bufferBeforeMinutes),
    end: addMinutes(slot.end, eventType.bufferAfterMinutes),
  };
  return busy.some((b) => {
    const busyWithBuffers: Interval = {
      start: addMinutes(b.start, -(b.bufferBeforeMinutes ?? 0)),
      end: addMinutes(b.end, b.bufferAfterMinutes ?? 0),
    };
    return overlaps(slotWithBuffers, b) || overlaps(slot, busyWithBuffers);
  });
}

function daysAtDailyLimit(busy: readonly BusyInterval[], tz: string, max: number | null): Set<DateKey> {
  if (max === null) return new Set();
  const counts = new Map<DateKey, number>();
  for (const b of busy) {
    if (!b.countsTowardDailyLimit) continue;
    const day = dateKeyInZone(b.start, tz);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= max).map(([day]) => day));
}

function eachDay(first: DateKey, last: DateKey): DateKey[] {
  const days: DateKey[] = [];
  for (let d = first; d <= last; d = addDaysToKey(d, 1)) days.push(d);
  return days;
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function validate({ range, host, eventType }: SlotGenerationInput): void {
  if (!isValidTimeZone(host.timeZone)) {
    throw new Error(`Unknown timezone "${host.timeZone}"`);
  }
  if (!(range.end > range.start)) throw new Error("range.end must be after range.start");
  if (!Number.isInteger(eventType.durationMinutes) || eventType.durationMinutes <= 0) {
    throw new Error("durationMinutes must be a positive integer");
  }
  const step = eventType.slotIntervalMinutes;
  if (step != null && (!Number.isInteger(step) || step <= 0)) {
    throw new Error("slotIntervalMinutes must be a positive integer");
  }
  if (eventType.bookingWindowDays !== null && eventType.bookingWindowDays < 1) {
    throw new Error("bookingWindowDays must be at least 1");
  }
}
