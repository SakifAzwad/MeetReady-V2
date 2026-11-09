import { describe, expect, it } from "vitest";
import { parseWeekOffset, weekDays } from "./week";

describe("parseWeekOffset", () => {
  it.each([
    ["1", 1],
    ["-3", -3],
    ["52", 52],
    ["53", 0],
    ["1.5", 0],
    ["abc", 0],
    [undefined, 0],
    [["1", "2"], 0], // ?week=1&week=2 arrives as an array
  ])("%j -> %i", (raw, expected) => {
    expect(parseWeekOffset(raw)).toBe(expected);
  });
});

describe("weekDays", () => {
  // 20:00 UTC on Sunday 8 Nov is already Monday 9 Nov in Dhaka.
  const now = new Date("2026-11-08T20:00:00Z");

  it("starts at today in the host's timezone", () => {
    expect(weekDays(now, "Asia/Dhaka", 0)[0]).toBe("2026-11-09");
    expect(weekDays(now, "Europe/London", 0)[0]).toBe("2026-11-08");
  });

  it("pages by 7 days in either direction", () => {
    expect(weekDays(now, "Asia/Dhaka", 1)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(weekDays(now, "Asia/Dhaka", -1)[0]).toBe("2026-11-02");
  });
});
