import { addDaysToKey, dateKeyInZone, type DateKey } from "./scheduling/time";

/** The dashboard's ?week=N: how many 7-day pages away from "the next 7 days". */
export const MAX_WEEK_OFFSET = 52;

/** User-controlled input: anything that isn't a whole number within a year either way is 0. */
export function parseWeekOffset(raw: unknown): number {
  const n = typeof raw === "string" && /^-?\d{1,2}$/.test(raw) ? Number(raw) : 0;
  return Math.abs(n) <= MAX_WEEK_OFFSET ? n : 0;
}

/** The seven days of page `offset`, starting today in the host's timezone (not the server's). */
export function weekDays(now: Date, timeZone: string, offset: number): DateKey[] {
  const first = addDaysToKey(dateKeyInZone(now, timeZone), offset * 7);
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(first, i));
}
