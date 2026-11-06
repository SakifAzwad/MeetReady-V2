import { describe, expect, it } from "vitest";
import { addMonths, formatDateKey, formatTime, monthGrid, monthRangeInZone } from "./calendar";

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
