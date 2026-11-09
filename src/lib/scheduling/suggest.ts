import { formatTime } from "./calendar";
import { daytimeBounds } from "./daylight";
import type { Interval } from "./intervals";
import { dateKeyInZone, type DateKey } from "./time";

/*
 * "Share times by text": pick a few free slots to paste into an email, and
 * write the message. Both pure, so the choices and the wording are tested.
 */

/**
 * Up to `count` slots, each on a different day for the recipient, preferring
 * their daytime (8 AM–8 PM). First pass: the earliest daytime slot of each
 * day, in date order. If that gives fewer than `count`, fill up from the
 * remaining days with the slot nearest to their daytime (5:30 AM rather than
 * midnight): an odd hour that's honestly labelled beats offering nothing.
 * Returned in time order.
 */
export function pickSuggestedSlots(slots: readonly Interval[], recipientZone: string, count = 3): Interval[] {
  const byDay = new Map<DateKey, Interval[]>();
  for (const slot of [...slots].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const day = dateKeyInZone(slot.start, recipientZone);
    byDay.set(day, [...(byDay.get(day) ?? []), slot]);
  }

  const picked: Interval[] = [];
  const usedDays = new Set<DateKey>();
  for (const [day, daySlots] of byDay) {
    if (picked.length === count) break;
    const { start, end } = daytimeBounds(day, recipientZone);
    const daytime = daySlots.find((s) => s.start >= start && s.end <= end);
    if (daytime) {
      picked.push(daytime);
      usedDays.add(day);
    }
  }
  for (const [day, daySlots] of byDay) {
    if (picked.length === count) break;
    if (usedDays.has(day)) continue;
    const { start, end } = daytimeBounds(day, recipientZone);
    const distance = (s: Interval) =>
      s.end <= start ? start.getTime() - s.end.getTime() : Math.max(0, s.start.getTime() - end.getTime());
    // reduce keeps the earlier slot on a tie.
    picked.push(daySlots.reduce((best, s) => (distance(s) < distance(best) ? s : best)));
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** "Mon 9 Nov" */
const formatDay = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(
    instant,
  );

/**
 * The message, written as the host (it's pasted into the host's own email):
 *
 *   Here are 3 times for a 30-minute call, shown in your time (London):
 *
 *   Mon 9 Nov, 8:00 AM (2:00 PM for me in Dhaka)
 *   …
 *
 *   Or pick any time that suits you: https://…/sakif/intro
 *
 * Plain lines, no bullets or emoji: it has to survive any email client.
 */
export function formatAvailabilityText({
  slots,
  durationMinutes,
  recipientZone,
  recipientCity,
  hostZone,
  hostCity,
  link,
  hour12 = true,
}: {
  slots: readonly Interval[];
  durationMinutes: number;
  recipientZone: string;
  recipientCity: string;
  hostZone: string;
  hostCity: string;
  link: string;
  hour12?: boolean;
}): string {
  const sameZone = slots.every((s) => formatTime(s.start, recipientZone) === formatTime(s.start, hostZone));
  const length = durationMinutes % 60 === 0 ? `${durationMinutes / 60}-hour` : `${durationMinutes}-minute`;
  const what =
    slots.length === 1
      ? `Here's a time for a ${length} call`
      : `Here are ${slots.length} times for a ${length} call`;
  const intro = sameZone ? `${what}:` : `${what}, shown in your time (${recipientCity}):`;

  const lines = slots.map((s) => {
    const theirs = `${formatDay(s.start, recipientZone)}, ${formatTime(s.start, recipientZone, hour12)}`;
    if (sameZone) return theirs;
    // If it's a different date for the host, say which: "Tue 10 Nov, 3:00 AM for me".
    const otherDate = dateKeyInZone(s.start, hostZone) !== dateKeyInZone(s.start, recipientZone);
    const mine = otherDate
      ? `${formatDay(s.start, hostZone)}, ${formatTime(s.start, hostZone, hour12)}`
      : formatTime(s.start, hostZone, hour12);
    return `${theirs} (${mine} for me in ${hostCity})`;
  });

  return [intro, "", ...lines, "", `Or pick any time that suits you: ${link}`].join("\n");
}
