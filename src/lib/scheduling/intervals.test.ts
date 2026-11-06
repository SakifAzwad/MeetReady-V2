import { describe, expect, it } from "vitest";
import { mergeIntervals, overlaps } from "./intervals";
import { addDaysToKey, dateKeyInZone, dayOfWeek, wallTimeToInstant } from "./time";

const i = (a: string, b: string) => ({
  start: new Date(`2026-11-09T${a}:00Z`),
  end: new Date(`2026-11-09T${b}:00Z`),
});

describe("overlaps (half-open)", () => {
  it.each([
    ["10:00", "11:00", "10:30", "11:30", true],
    ["10:00", "11:00", "10:15", "10:45", true], // containment
    ["10:00", "11:00", "11:00", "12:00", false], // touching is not overlapping
    ["10:00", "11:00", "12:00", "13:00", false],
  ])("[%s,%s) vs [%s,%s) -> %s", (a, b, c, e, expected) => {
    expect(overlaps(i(a, b), i(c, e))).toBe(expected);
    expect(overlaps(i(c, e), i(a, b))).toBe(expected); // symmetric
  });
});

describe("mergeIntervals", () => {
  it("merges overlapping and touching intervals, regardless of input order", () => {
    const merged = mergeIntervals([
      i("13:00", "14:00"),
      i("09:00", "10:00"),
      i("09:30", "11:00"),
      i("11:00", "12:00"),
    ]);
    expect(merged).toEqual([i("09:00", "12:00"), i("13:00", "14:00")]);
  });

  it("drops empty intervals", () => {
    expect(mergeIntervals([i("10:00", "10:00")])).toEqual([]);
  });
});

describe("time helpers", () => {
  it("adds days across month and year ends", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2028-03-01", -1)).toBe("2028-02-29"); // leap year
  });

  it("returns the weekday of a date key", () => {
    expect(dayOfWeek("2026-11-09")).toBe(1);
  });

  it("finds the local date of an instant", () => {
    expect(dateKeyInZone(new Date("2026-11-09T20:00:00Z"), "UTC")).toBe("2026-11-09");
    expect(dateKeyInZone(new Date("2026-11-09T20:00:00Z"), "Asia/Dhaka")).toBe("2026-11-10");
  });

  it("treats 24:00 as midnight at the end of the day", () => {
    expect(wallTimeToInstant("2026-11-09", "24:00", "Asia/Dhaka").toISOString()).toBe(
      "2026-11-09T18:00:00.000Z",
    );
  });
});
