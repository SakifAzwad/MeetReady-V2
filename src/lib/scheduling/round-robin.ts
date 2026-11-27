/*
 * Day 31: who gets a round-robin booking. Pure, so the rule is tested on its
 * own (unit and property tests) and the database code only gathers the facts.
 *
 * Among the hosts free at the requested time:
 *  1. the fewest bookings of this event type in the last ROUND_ROBIN_DAYS days
 *     (counted by when they were BOOKED, confirmed only: a cancelled meeting
 *     didn't take their time; by meeting date, a booking months ahead wouldn't
 *     count yet);
 *  2. then whoever was assigned one longest ago (never = first);
 *  3. then the event type's host order, then the id: never random, so the same
 *     facts always give the same host, and tests can say which.
 */

export const ROUND_ROBIN_DAYS = 30;

export type HostLoad = {
  id: string;
  /** Place on the event type's host list (0 = first). */
  position: number;
  /** Confirmed bookings of this event type made in the last ROUND_ROBIN_DAYS days. */
  recent: number;
  /** When they were last assigned one (confirmed, any age); null = never. */
  lastAssignedAt: Date | null;
};

const time = (d: Date | null) => (d === null ? -Infinity : d.getTime());

/** The host to assign, or null when nobody is free. */
export function pickHost(candidates: readonly HostLoad[]): string | null {
  const [first] = [...candidates].sort(
    (a, b) =>
      a.recent - b.recent ||
      time(a.lastAssignedAt) - time(b.lastAssignedAt) ||
      a.position - b.position ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return first?.id ?? null;
}
