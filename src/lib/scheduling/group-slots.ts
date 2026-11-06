import type { Slot } from "./generate-slots";
import { dateKeyInZone, type DateKey } from "./time";

/**
 * Groups slots by the calendar date they fall on for the VIEWER.
 * Slot generation works in the host's timezone and returns UTC instants;
 * only at display time do we switch to the guest's timezone. A host's
 * Monday 18:00 in London is a guest's Tuesday 03:00 in Tokyo, and the
 * guest's calendar has to show it under Tuesday.
 */
export function groupSlotsByDate(slots: readonly Slot[], viewerTimeZone: string): Map<DateKey, Slot[]> {
  const groups = new Map<DateKey, Slot[]>();
  for (const slot of slots) {
    const key = dateKeyInZone(slot.start, viewerTimeZone);
    const list = groups.get(key);
    if (list) list.push(slot);
    else groups.set(key, [slot]);
  }
  return groups;
}
