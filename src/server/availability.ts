import { and, asc, count, eq, gte, lte } from "drizzle-orm";
import { availabilityRules, dateOverrides, user } from "@/db/schema";
import type { Database } from "@/db/types";
import type { DateOverrideInput } from "@/lib/validation/availability";

/*
 * Availability data access. As everywhere: userId comes from the session and
 * goes in every WHERE.
 */

/** Postgres `time` comes back as "09:00:00"; the app uses "09:00". */
const hhmm = (time: string) => time.slice(0, 5);

export type HostAvailability = {
  timeZone: string;
  rules: { dayOfWeek: number; startTime: string; endTime: string }[];
  overrides: { date: string; startTime: string | null; endTime: string | null }[];
};

export async function getAvailability(
  db: Database,
  userId: string,
  options: { overridesFrom?: string; overridesTo?: string } = {},
): Promise<HostAvailability> {
  const [host] = await db.select({ timeZone: user.timeZone }).from(user).where(eq(user.id, userId));
  const rules = await db
    .select({
      dayOfWeek: availabilityRules.dayOfWeek,
      startTime: availabilityRules.startTime,
      endTime: availabilityRules.endTime,
    })
    .from(availabilityRules)
    .where(eq(availabilityRules.userId, userId))
    .orderBy(asc(availabilityRules.dayOfWeek), asc(availabilityRules.startTime));
  const overrides = await db
    .select({ date: dateOverrides.date, startTime: dateOverrides.startTime, endTime: dateOverrides.endTime })
    .from(dateOverrides)
    .where(
      and(
        eq(dateOverrides.userId, userId),
        options.overridesFrom ? gte(dateOverrides.date, options.overridesFrom) : undefined,
        options.overridesTo ? lte(dateOverrides.date, options.overridesTo) : undefined,
      ),
    )
    .orderBy(asc(dateOverrides.date), asc(dateOverrides.startTime));

  return {
    timeZone: host?.timeZone ?? "UTC",
    rules: rules.map((r) => ({ ...r, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) })),
    overrides: overrides.map((o) => ({
      date: o.date,
      startTime: o.startTime && hhmm(o.startTime),
      endTime: o.endTime && hhmm(o.endTime),
    })),
  };
}

/**
 * Replaces the whole weekly schedule.
 *
 * Why "delete all + insert all" instead of diffing which rows changed: the
 * host edits the week as one form, so saving it as one unit is simpler and
 * can't leave half-old, half-new rules. The transaction makes it atomic: if
 * any insert fails, the delete is rolled back and the old schedule stays.
 * A booking page loading in the middle sees either the old or the new week,
 * never an empty one.
 */
export async function saveWeeklySchedule(
  db: Database,
  userId: string,
  schedule: { timeZone: string; rules: { dayOfWeek: number; startTime: string; endTime: string }[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(user).set({ timeZone: schedule.timeZone }).where(eq(user.id, userId));
    await tx.delete(availabilityRules).where(eq(availabilityRules.userId, userId));
    if (schedule.rules.length > 0) {
      await tx.insert(availabilityRules).values(schedule.rules.map((r) => ({ ...r, userId })));
    }
  });
}

/** Sets one date's override, replacing any existing one for that date. */
export async function saveDateOverride(
  db: Database,
  userId: string,
  override: DateOverrideInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(dateOverrides)
      .where(and(eq(dateOverrides.userId, userId), eq(dateOverrides.date, override.date)));
    const rows = override.available
      ? override.ranges.map((r) => ({
          userId,
          date: override.date,
          startTime: r.startTime,
          endTime: r.endTime,
        }))
      : [{ userId, date: override.date, startTime: null, endTime: null }]; // one row with nulls = day off
    await tx.insert(dateOverrides).values(rows);
  });
}

export async function deleteDateOverride(db: Database, userId: string, date: string): Promise<void> {
  await db.delete(dateOverrides).where(and(eq(dateOverrides.userId, userId), eq(dateOverrides.date, date)));
}

/** Mon–Fri 09:00–17:00: a new host can share their link straight after onboarding. */
export const DEFAULT_WEEKLY_RULES = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: "09:00",
  endTime: "17:00",
}));

/** Adds the default week, but only if the host has no rules yet (never overwrites). */
export async function ensureDefaultAvailability(db: Database, userId: string): Promise<void> {
  const [existing] = await db
    .select({ n: count() })
    .from(availabilityRules)
    .where(eq(availabilityRules.userId, userId));
  if ((existing?.n ?? 0) === 0) {
    await db.insert(availabilityRules).values(DEFAULT_WEEKLY_RULES.map((r) => ({ ...r, userId })));
  }
}
