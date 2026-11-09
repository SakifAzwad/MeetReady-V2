import { describe, expect, it } from "vitest";
import { formatHours, formatMinutes, formatWallTime, QUARTER_HOURS } from "./format";

describe("formatMinutes", () => {
  it.each([
    [0, "none"],
    [15, "15 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [1440, "1 day"],
    [2880, "2 days"],
  ])("%d -> %s", (n, expected) => expect(formatMinutes(n)).toBe(expected));
});

describe("formatWallTime", () => {
  it.each([
    ["00:00", "12:00 AM"],
    ["09:05", "9:05 AM"],
    ["12:00", "12:00 PM"],
    ["13:30", "1:30 PM"],
    ["24:00", "12:00 AM (end of day)"],
  ])("%s -> %s", (t, expected) => expect(formatWallTime(t)).toBe(expected));
});

it("QUARTER_HOURS covers the whole day", () => {
  expect(QUARTER_HOURS[0]).toBe("00:00");
  expect(QUARTER_HOURS[37]).toBe("09:15");
  expect(QUARTER_HOURS.at(-1)).toBe("24:00");
  expect(QUARTER_HOURS).toHaveLength(97);
});

describe("formatHours", () => {
  it.each([
    [0, "0 min"],
    [45, "45 min"],
    [60, "1 h"],
    [90, "1.5 h"],
    [140, "2.3 h"],
    [480, "8 h"],
  ])("%i minutes -> %s", (minutes, text) => {
    expect(formatHours(minutes)).toBe(text);
  });
});
