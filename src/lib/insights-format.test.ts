import { describe, expect, it } from "vitest";
import type { DateKey } from "./scheduling/time";
import { bucketLabel, bucketName, heatLevel, meetings, niceTicks, percent } from "./insights-format";

describe("Insights formatting (Day 25)", () => {
  it("axis ticks are clean steps that reach the maximum", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(23)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(140)).toEqual([0, 50, 100, 150]);
  });

  it("percentages round, tiny ones say <1%, and nothing to divide by is a dash", () => {
    expect(percent(1 / 3)).toBe("33%");
    expect(percent(0)).toBe("0%");
    expect(percent(0.004)).toBe("<1%");
    expect(percent(null)).toBe("–");
  });

  it("names weeks by their Monday and months by name", () => {
    const key = "2026-11-16" as DateKey;
    expect(bucketLabel(key, "week")).toBe("16 Nov");
    expect(bucketName(key, "week")).toBe("Week of 16 Nov 2026");
    expect(bucketLabel("2026-11-01" as DateKey, "month")).toBe("Nov");
    expect(bucketName("2026-11-01" as DateKey, "month")).toBe("November 2026");
  });

  it("heat steps are thirds of the busiest cell", () => {
    expect([0, 1, 2, 3, 4, 6].map((n) => heatLevel(n, 6))).toEqual([0, 1, 1, 2, 2, 3]); // exactly a third or two thirds stays in the lower step
    expect(heatLevel(1, 0)).toBe(0);
    expect(meetings(1)).toBe("1 meeting");
    expect(meetings(2)).toBe("2 meetings");
  });
});
