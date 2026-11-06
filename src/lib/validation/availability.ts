import { z } from "zod";
import { timeZoneSchema } from "./onboarding";

/*
 * Availability as the host edits it: per weekday, on/off plus time ranges.
 * Stored as availability_rules rows (one per range); generateSlots() reads
 * the same shape. Times are wall-clock "HH:mm" in the host's timezone.
 */

const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export const wallTimeSchema = z.string().regex(WALL_TIME, "Use HH:mm");

export const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export const timeRangeSchema = z
  .object({ startTime: wallTimeSchema, endTime: wallTimeSchema })
  .refine((r) => toMinutes(r.endTime) > toMinutes(r.startTime), {
    message: "End must be after start",
    path: ["endTime"],
  });

export type TimeRange = z.infer<typeof timeRangeSchema>;

/** Index of the first range that overlaps an earlier one (touching is fine), or -1. */
export function findOverlap(ranges: readonly TimeRange[]): number {
  const sorted = ranges
    .map((r, index) => ({ ...r, index }))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i]!.startTime) < toMinutes(sorted[i - 1]!.endTime)) return sorted[i]!.index;
  }
  return -1;
}

const rangesSchema = z
  .array(timeRangeSchema)
  .max(12, "At most 12 ranges")
  .superRefine((ranges, ctx) => {
    const overlapping = findOverlap(ranges);
    if (overlapping !== -1) {
      ctx.addIssue({ code: "custom", path: [overlapping, "startTime"], message: "Overlaps another range" });
    }
  });

export const weeklyScheduleSchema = z.object({
  timeZone: timeZoneSchema,
  days: z
    .array(
      z
        .object({
          dayOfWeek: z.number().int().min(0).max(6),
          enabled: z.boolean(),
          ranges: rangesSchema,
        })
        .refine((d) => !d.enabled || d.ranges.length > 0, {
          message: "Add hours or turn the day off",
          path: ["ranges"],
        }),
    )
    .length(7)
    .refine((days) => days.every((d, i) => d.dayOfWeek === i), "Days must be Sunday…Saturday in order"),
});

export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;

/** Form shape -> DB rows: enabled days only, one row per range. */
export function scheduleToRules(schedule: WeeklySchedule) {
  return schedule.days
    .filter((d) => d.enabled)
    .flatMap((d) =>
      d.ranges.map((r) => ({ dayOfWeek: d.dayOfWeek, startTime: r.startTime, endTime: r.endTime })),
    );
}

/** DB rows -> form shape. A day with no rows is "off" with a sensible default range ready if switched on. */
export function rulesToSchedule(
  timeZone: string,
  rules: readonly { dayOfWeek: number; startTime: string; endTime: string }[],
): WeeklySchedule {
  return {
    timeZone,
    days: Array.from({ length: 7 }, (_, dayOfWeek) => {
      const ranges = rules
        .filter((r) => r.dayOfWeek === dayOfWeek)
        .map((r) => ({ startTime: r.startTime, endTime: r.endTime }))
        .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
      return {
        dayOfWeek,
        enabled: ranges.length > 0,
        ranges: ranges.length > 0 ? ranges : [{ startTime: "09:00", endTime: "17:00" }],
      };
    }),
  };
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const dateOverrideSchema = z
  .object({
    date: z
      .string()
      .regex(DATE_KEY, "Pick a date")
      .refine((d) => {
        // "2026-02-30" matches the regex but isn't a real date.
        const parsed = new Date(`${d}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d);
      }, "Not a real date"),
    available: z.boolean(),
    ranges: rangesSchema,
  })
  .refine((o) => !o.available || o.ranges.length > 0, {
    message: "Add hours or mark the day unavailable",
    path: ["ranges"],
  });

export type DateOverrideInput = z.infer<typeof dateOverrideSchema>;
