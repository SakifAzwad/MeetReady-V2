import { describe, expect, it } from "vitest";
import {
  dateOverrideSchema,
  findOverlap,
  rulesToSchedule,
  scheduleToRules,
  weeklyScheduleSchema,
} from "./availability";

const week = (
  overrides: Record<number, { enabled: boolean; ranges: { startTime: string; endTime: string }[] }> = {},
) => ({
  timeZone: "Asia/Dhaka",
  days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    enabled: false,
    ranges: [{ startTime: "09:00", endTime: "17:00" }],
    ...overrides[dayOfWeek],
  })),
});

describe("findOverlap", () => {
  it("allows touching ranges and finds overlapping ones, in any order", () => {
    expect(
      findOverlap([
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "12:00", endTime: "13:00" },
      ]),
    ).toBe(-1);
    expect(
      findOverlap([
        { startTime: "13:00", endTime: "15:00" },
        { startTime: "09:00", endTime: "13:30" },
      ]),
    ).toBe(0);
  });
});

describe("weeklyScheduleSchema", () => {
  it("accepts a normal week, including a range ending at 24:00", () => {
    const parsed = weeklyScheduleSchema.safeParse(
      week({
        1: {
          enabled: true,
          ranges: [
            { startTime: "09:00", endTime: "12:00" },
            { startTime: "20:00", endTime: "24:00" },
          ],
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it.each([
    [
      "end before start",
      { 1: { enabled: true, ranges: [{ startTime: "17:00", endTime: "09:00" }] } },
      /after start/,
    ],
    [
      "overlapping ranges",
      {
        1: {
          enabled: true,
          ranges: [
            { startTime: "09:00", endTime: "12:00" },
            { startTime: "11:00", endTime: "13:00" },
          ],
        },
      },
      /Overlaps/,
    ],
    ["enabled day with no hours", { 1: { enabled: true, ranges: [] } }, /turn the day off/],
    ["bad time", { 1: { enabled: true, ranges: [{ startTime: "9am", endTime: "17:00" }] } }, /HH:mm/],
  ])("rejects %s", (_name, days, message) => {
    const result = weeklyScheduleSchema.safeParse(week(days));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join(" ")).toMatch(message);
  });

  it("still validates the ranges of a day that's switched off", () => {
    // Deliberate: a turned-off day keeps its ranges so switching it back on restores them,
    // so those ranges must be valid too. Simpler than two rule sets.
    expect(
      weeklyScheduleSchema.safeParse(
        week({ 2: { enabled: false, ranges: [{ startTime: "17:00", endTime: "09:00" }] } }),
      ).success,
    ).toBe(false);
  });

  it("rejects an invalid timezone", () => {
    expect(weeklyScheduleSchema.safeParse({ ...week(), timeZone: "Mars/Base" }).success).toBe(false);
  });
});

describe("schedule <-> rules", () => {
  it("round-trips, dropping disabled days and sorting ranges", () => {
    const rules = [
      { dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
      { dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { dayOfWeek: 3, startTime: "10:00", endTime: "11:00" },
    ];
    const schedule = rulesToSchedule("UTC", rules);
    expect(schedule.days[1]).toEqual({
      dayOfWeek: 1,
      enabled: true,
      ranges: [
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "13:00", endTime: "17:00" },
      ],
    });
    expect(schedule.days[0]?.enabled).toBe(false);
    expect(scheduleToRules(schedule)).toEqual([
      { dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
      { dayOfWeek: 3, startTime: "10:00", endTime: "11:00" },
    ]);
  });
});

describe("dateOverrideSchema", () => {
  it("accepts a day off and custom hours", () => {
    expect(dateOverrideSchema.safeParse({ date: "2026-12-16", available: false, ranges: [] }).success).toBe(
      true,
    );
    expect(
      dateOverrideSchema.safeParse({
        date: "2026-12-16",
        available: true,
        ranges: [{ startTime: "10:00", endTime: "12:00" }],
      }).success,
    ).toBe(true);
  });

  it.each(["2026-02-30", "2026-13-01", "16/12/2026", ""])("rejects date %j", (date) => {
    expect(dateOverrideSchema.safeParse({ date, available: false, ranges: [] }).success).toBe(false);
  });

  it("requires hours when available", () => {
    expect(dateOverrideSchema.safeParse({ date: "2026-12-16", available: true, ranges: [] }).success).toBe(
      false,
    );
  });
});
