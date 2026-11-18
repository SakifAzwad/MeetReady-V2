import { describe, expect, it } from "vitest";
import {
  addMonths,
  formatDateKey,
  formatTime,
  formatTimeRange,
  monthGrid,
  monthRangeInZone,
  placeInCalendar,
} from "./calendar";

describe("monthRangeInZone", () => {
  it("starts the month at local midnight, as a UTC instant", () => {
    const { from, to } = monthRangeInZone({ year: 2026, month: 11 }, "Asia/Dhaka");
    expect(from.toISOString()).toBe("2026-10-31T18:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-30T18:00:00.000Z");
  });

  it("handles a month with a DST change (March in London is 31 days minus 1 hour)", () => {
    const { from, to } = monthRangeInZone({ year: 2026, month: 3 }, "Europe/London");
    expect(from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-31T23:00:00.000Z"); // 1 April 00:00 BST
  });

  it("rolls over the year", () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe("monthGrid", () => {
  it("lays out November 2026 Monday-first (1 Nov is a Sunday)", () => {
    const grid = monthGrid({ year: 2026, month: 11 });
    expect(grid[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(grid[1]?.[0]).toBe("2026-11-02");
    expect(grid.flat().filter(Boolean)).toHaveLength(30);
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it("handles February in a leap year", () => {
    expect(monthGrid({ year: 2028, month: 2 }).flat().filter(Boolean)).toHaveLength(29);
  });
});

describe("formatting", () => {
  it("shows the same instant in each viewer's own time", () => {
    const instant = new Date("2026-11-09T04:00:00Z");
    expect(formatTime(instant, "Asia/Dhaka")).toBe("10:00 AM");
    expect(formatTime(instant, "Europe/London")).toBe("4:00 AM");
  });

  it("formats a calendar date without shifting it", () => {
    expect(formatDateKey("2026-11-09")).toBe("Monday, 9 November 2026");
    expect(formatDateKey("2026-11-09", "short")).toBe("Mon 9 Nov");
  });
});

describe("12/24-hour formatting", () => {
  const at = (iso: string) => new Date(iso);
  it("formats single times both ways", () => {
    expect(formatTime(at("2026-11-09T15:05:00Z"), "UTC")).toBe("3:05 PM");
    expect(formatTime(at("2026-11-09T15:05:00Z"), "UTC", false)).toBe("15:05");
    expect(formatTime(at("2026-11-09T04:00:00Z"), "UTC", false)).toBe("04:00");
    expect(formatTime(at("2026-11-09T00:00:00Z"), "UTC", false)).toBe("00:00");
  });

  it.each([
    ["2026-11-09T03:00:00Z", "2026-11-09T11:00:00Z", true, "3–11 AM"],
    ["2026-11-09T09:30:00Z", "2026-11-09T17:00:00Z", true, "9:30 AM–5 PM"],
    ["2026-11-09T22:00:00Z", "2026-11-10T00:00:00Z", true, "10 PM–12 AM"],
    ["2026-11-09T03:00:00Z", "2026-11-09T11:00:00Z", false, "03:00–11:00"],
  ])("range %s–%s (12h: %s) -> %s", (a, b, hour12, expected) => {
    expect(formatTimeRange(at(a), at(b), "UTC", hour12)).toBe(expected);
  });
});

describe("placeInCalendar", () => {
  it("gives the day and month on the viewer's clock", () => {
    const at = new Date("2026-11-24T08:00:00Z");
    expect(placeInCalendar(at, "Asia/Dhaka")).toEqual({
      date: "2026-11-24",
      month: { year: 2026, month: 11 },
    });
    expect(placeInCalendar(at, "America/Los_Angeles")).toEqual({
      date: "2026-11-24",
      month: { year: 2026, month: 11 },
    });
  });

  it("turns the month when the time is already the 1st on that clock", () => {
    const at = new Date("2026-11-30T20:00:00Z");
    expect(placeInCalendar(at, "Asia/Dhaka")).toEqual({
      date: "2026-12-01",
      month: { year: 2026, month: 12 },
    });
    expect(placeInCalendar(at, "Europe/London")).toEqual({
      date: "2026-11-30",
      month: { year: 2026, month: 11 },
    });
  });

  it("goes back a day (and a year) west of UTC", () => {
    const at = new Date("2027-01-01T03:00:00Z");
    expect(placeInCalendar(at, "America/New_York")).toEqual({
      date: "2026-12-31",
      month: { year: 2026, month: 12 },
    });
  });
});
