import { describe, expect, it } from "vitest";
import { dayBounds } from "./daylight";
import { darkness, skyGradient, sunSummary, zoneCoordinates } from "./sky";

/** Parses "color pos%" stops back out of the gradient string. */
function stops(gradient: string): { color: string; pos: number }[] {
  const inner = gradient.slice("linear-gradient(90deg, ".length, -1);
  return [
    ...inner.matchAll(/(var\(--[a-z-]+\)|color-mix\(in oklab, var\(--[a-z-]+\), white \d+%\)) (-?[\d.]+)%/g),
  ].map((m) => ({
    color: m[1]!,
    pos: Number(m[2]),
  }));
}
const posOf = (g: string, color: string) =>
  stops(g).filter((s) => s.color === color && s.pos > 0 && s.pos < 100);

describe("skyGradient", () => {
  it("puts London's November sunrise (07:10) about 30% across the day", () => {
    const g = skyGradient("Europe/London", dayBounds("2026-11-10", "Europe/London"));
    const sunrise = posOf(g, "var(--dawn)")[0]!.pos; // the dawn colour sits at sunrise
    expect(sunrise).toBeCloseTo(((7 + 10 / 60) / 24) * 100, 0);
  });

  it("gives London a longer day in June than in December", () => {
    const daylight = (date: `${number}-${number}-${number}`) => {
      const g = stops(skyGradient("Europe/London", dayBounds(date, "Europe/London")));
      const rise = g.find((s) => s.color === "var(--dawn)" && s.pos > 0)!.pos;
      const set = g.find((s) => s.color.startsWith("color-mix") && s.pos > rise)!.pos;
      return set - rise;
    };
    expect(daylight("2026-06-21")).toBeGreaterThan(daylight("2026-12-21") * 2);
  });

  it("stops are in order, so the browser draws them as given", () => {
    const gradient = skyGradient("Asia/Dhaka", dayBounds("2026-11-10", "Europe/London"));
    const g = stops(gradient);
    // The helper must see every stop (it once skipped the color-mix ones): one per "%,".
    expect(g).toHaveLength(gradient.split("%,").length);
    const positions = g.map((s) => s.pos);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions[0]).toBeLessThan(0);
    expect(positions.at(-1)).toBeGreaterThan(100);
  });

  it("the host's sky on the guest's timeline: Dhaka's noon sits at 6:12 AM London time", () => {
    // Dhaka's solar noon on 10 Nov ≈ 11:42 local = 05:42 UTC = 05:42 London (GMT).
    const g = skyGradient("Asia/Dhaka", dayBounds("2026-11-10", "Europe/London"));
    const noon = posOf(g, "var(--band-noon)")[0]!.pos;
    expect(noon).toBeCloseTo(((5 + 42 / 60) / 24) * 100, 0);
  });

  it("Svalbard in December: no daylight colours at all", () => {
    const g = stops(skyGradient("Arctic/Longyearbyen", dayBounds("2026-12-21", "Arctic/Longyearbyen")));
    expect(g.some((s) => s.color === "var(--band-day)" || s.color === "var(--dawn)")).toBe(false);
  });

  it("Svalbard in June: no night", () => {
    const g = stops(skyGradient("Arctic/Longyearbyen", dayBounds("2026-06-21", "Arctic/Longyearbyen")));
    expect(g.some((s) => s.color === "var(--night)")).toBe(false);
  });

  it("UTC has no place, so it falls back to a fixed symbolic day", () => {
    expect(zoneCoordinates("UTC")).toBeNull();
    const g = skyGradient("UTC", dayBounds("2026-11-10", "UTC"));
    expect(posOf(g, "var(--dawn)")[0]!.pos).toBeCloseTo(25, 0); // 6 AM
  });
});

describe("sunSummary", () => {
  it("says when the sun rises and sets, in that zone's time", () => {
    expect(sunSummary("Europe/London", "2026-11-10")).toBe("Sunrise 7:10 AM, sunset 4:18 PM");
    expect(sunSummary("Europe/London", "2026-11-10", false)).toBe("Sunrise 07:10, sunset 16:18");
  });

  it("handles polar days and places without coordinates", () => {
    expect(sunSummary("Arctic/Longyearbyen", "2026-12-21")).toBe("The sun doesn't rise");
    expect(sunSummary("Arctic/Longyearbyen", "2026-06-21")).toBe("The sun doesn't set");
    expect(sunSummary("UTC", "2026-11-10")).toBeNull();
  });
});

describe("darkness", () => {
  it("describes the sky in Dhaka at a moment", () => {
    // Dhaka 10 Nov: sunrise ≈ 06:09, sunset ≈ 17:14 local (UTC+6).
    expect(darkness(new Date("2026-11-10T14:00:00Z"), "Asia/Dhaka")).toBe("after sunset"); // 8 PM
    expect(darkness(new Date("2026-11-09T22:00:00Z"), "Asia/Dhaka")).toBe("before sunrise"); // 4 AM
    expect(darkness(new Date("2026-11-10T06:00:00Z"), "Asia/Dhaka")).toBeNull(); // noon
    expect(darkness(new Date("2026-11-10T11:25:00Z"), "Asia/Dhaka")).toBe("at dusk"); // 5:25 PM
  });
});
