import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { bookings, eventTypes, teams } from "@/db/schema";
import type { Database } from "@/db/types";
import { hostedBy } from "./hosted-by";
import {
  addDaysToKey,
  dateKeyInZone,
  dayOfWeek,
  parseDateKey,
  toDateKey,
  wallTimeToInstant,
  type DateKey,
} from "@/lib/scheduling/time";

/*
 * Insights (Day 25): how a host's meetings went, from their bookings.
 *
 * Counted by MEETING date (starts_at), not by when the booking was made: the
 * question is "how did my meetings go", and a no-show only exists on the day
 * of the meeting. Only meetings that have already started count (up to now),
 * so a cancellation shows up in the week its meeting would have been.
 *
 * Grouped in the HOST's timezone, by Postgres: `starts_at at time zone 'Asia/Dhaka'`
 * gives the wall-clock time there, and the day, week, weekday and hour come from
 * that. Grouped in UTC, an 11 PM meeting in Dhaka would count on the wrong day.
 *
 * Every query filters `host_id = ? AND starts_at in [from, now)`: the existing
 * (host_id, starts_at) index covers it, so no new index is needed.
 */

export const INSIGHT_RANGES = {
  "4w": { label: "Last 4 weeks", unit: "week", buckets: 4 },
  "3m": { label: "Last 3 months", unit: "week", buckets: 13 },
  "12m": { label: "Last 12 months", unit: "month", buckets: 12 },
} as const;
export type InsightRange = keyof typeof INSIGHT_RANGES;

export const isInsightRange = (value: unknown): value is InsightRange =>
  typeof value === "string" && Object.hasOwn(INSIGHT_RANGES, value);

/** Monday of the week a date is in (ISO weeks, like Postgres' date_trunc('week')). */
const mondayOf = (key: DateKey) => addDaysToKey(key, -((dayOfWeek(key) + 6) % 7));

const firstOfMonth = (key: DateKey) => {
  const { year, month } = parseDateKey(key);
  return toDateKey(year, month, 1);
};

function addMonths(key: DateKey, months: number): DateKey {
  const { year, month } = parseDateKey(key);
  const index = year * 12 + (month - 1) + months;
  return toDateKey(Math.floor(index / 12), (index % 12) + 1, 1);
}

/**
 * The period a range covers, in the host's timezone: whole weeks (Monday
 * start) or whole months, ending with the current, partial one. Pure, so the
 * calendar arithmetic is tested on its own.
 */
export function insightsPeriod(range: InsightRange, now: Date, timeZone: string) {
  const { unit, buckets: count } = INSIGHT_RANGES[range];
  const today = dateKeyInZone(now, timeZone);
  const last = unit === "week" ? mondayOf(today) : firstOfMonth(today);
  const buckets = Array.from({ length: count }, (_, i) =>
    unit === "week" ? addDaysToKey(last, -7 * (count - 1 - i)) : addMonths(last, -(count - 1 - i)),
  );
  const fromKey = buckets[0]!;
  return { unit, buckets, fromKey, from: wallTimeToInstant(fromKey, "00:00", timeZone) };
}

export type Insights = {
  range: InsightRange;
  unit: "week" | "month";
  timeZone: string;
  from: DateKey;
  totals: {
    /** Every meeting in the period, whatever happened to it. */
    meetings: number;
    held: number;
    noShows: number;
    cancelledByGuest: number;
    cancelledByHost: number;
  };
  /** Shares, 0 to 1; null when there's nothing to divide by. */
  rates: {
    /** Cancelled, of all meetings. */
    cancellation: number | null;
    /** Didn't show up, of the meetings that weren't cancelled. */
    noShow: number | null;
  };
  /** One entry per week or month, empty ones included, oldest first. */
  series: { bucket: DateKey; held: number; noShows: number; cancelled: number }[];
  sources: { bookingPage: number; assistant: number };
  eventTypes: { title: string; meetings: number; cancelled: number; noShows: number }[];
  /** Meetings by weekday (1 = Monday … 7 = Sunday) and hour, on the host's clock. Only non-empty cells. */
  times: { weekday: number; hour: number; meetings: number }[];
};

const int = (expression: SQL) => sql<number>`(${expression})::int`.mapWith(Number);
const count = (filter?: SQL) => int(filter ? sql`count(*) filter (where ${filter})` : sql`count(*)`);

const cancelled = sql`${bookings.status} = 'cancelled'`;
const noShow = sql`${bookings.status} = 'confirmed' and ${bookings.noShowAt} is not null`;
const held = sql`${bookings.status} = 'confirmed' and ${bookings.noShowAt} is null`;

export async function getInsights(
  db: Database,
  hostId: string,
  range: InsightRange,
  timeZone: string,
  now: Date,
): Promise<Insights> {
  const period = insightsPeriod(range, now, timeZone);
  // Wall-clock time in the host's timezone. The zone is a bound parameter, never spliced into the SQL.
  const local = sql`(${bookings.startsAt} at time zone ${timeZone})`;
  // Day 30: every meeting this host was in, team meetings they didn't organize included. EXISTS, not a
  // join: a team meeting is one meeting, however many hosts it has.
  const mine = and(hostedBy(hostId), gte(bookings.startsAt, period.from), lt(bookings.startsAt, now));
  const bucket = sql<string>`to_char(date_trunc(${period.unit}, ${local}), 'YYYY-MM-DD')`;
  const weekday = int(sql`extract(isodow from ${local})`);
  const hour = int(sql`extract(hour from ${local})`);

  const [totalsRows, seriesRows, typeRows, timeRows] = await Promise.all([
    db
      .select({
        meetings: count(),
        held: count(held),
        noShows: count(noShow),
        cancelledByGuest: count(sql`${cancelled} and ${bookings.cancelledBy} = 'guest'`),
        cancelledByHost: count(sql`${cancelled} and ${bookings.cancelledBy} = 'host'`),
        bookingPage: count(sql`${bookings.source} = 'booking_page'`),
        assistant: count(sql`${bookings.source} = 'assistant'`),
      })
      .from(bookings)
      .where(mine),
    db
      .select({ bucket, held: count(held), noShows: count(noShow), cancelled: count(cancelled) })
      .from(bookings)
      .where(mine)
      // By position: the bucket expression holds a bound parameter (the zone), and Postgres can't tell
      // that `$5` in GROUP BY is the same value as `$1` in SELECT, so it would refuse the query.
      .groupBy(sql`1`),
    db
      .select({
        title: eventTypes.title,
        team: teams.name,
        meetings: count(),
        cancelled: count(cancelled),
        noShows: count(noShow),
      })
      .from(bookings)
      .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .leftJoin(teams, eq(teams.id, eventTypes.teamId))
      .where(mine)
      .groupBy(eventTypes.id, eventTypes.title, teams.name)
      .orderBy(desc(count()), eventTypes.title),
    db
      .select({ weekday, hour, meetings: count() })
      .from(bookings)
      .where(mine)
      .groupBy(sql`1`, sql`2`),
  ]);

  const t = totalsRows[0]!;
  const cancelledTotal = t.cancelledByGuest + t.cancelledByHost;
  const attended = t.meetings - cancelledTotal;
  const byBucket = new Map(seriesRows.map((r) => [r.bucket, r]));
  return {
    range,
    unit: period.unit,
    timeZone,
    from: period.fromKey,
    totals: {
      meetings: t.meetings,
      held: t.held,
      noShows: t.noShows,
      cancelledByGuest: t.cancelledByGuest,
      cancelledByHost: t.cancelledByHost,
    },
    rates: {
      cancellation: t.meetings ? cancelledTotal / t.meetings : null,
      noShow: attended ? t.noShows / attended : null,
    },
    // Weeks or months with no meetings are still there, as zeros: a gap is information too.
    series: period.buckets.map((key) => {
      const row = byBucket.get(key);
      return {
        bucket: key,
        held: row?.held ?? 0,
        noShows: row?.noShows ?? 0,
        cancelled: row?.cancelled ?? 0,
      };
    }),
    sources: { bookingPage: t.bookingPage, assistant: t.assistant },
    // A team's meeting type says whose it is: a team's "Intro" and your own "Intro" are different rows.
    eventTypes: typeRows.map(({ team, ...r }) => (team ? { ...r, title: `${r.title} (${team})` } : r)),
    times: timeRows.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour),
  };
}
