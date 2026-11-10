import { describe, expect, it } from "vitest";
import { solarPosition, sunDay, sunPhase } from "./sun";

// Coordinates from the tz database's zone.tab (each zone's principal city).
const LONDON = [51.51, -0.13] as const;
const SYDNEY = [-33.87, 151.22] as const;
const REYKJAVIK = [64.15, -21.85] as const;
const LONGYEARBYEN = [78.0, 16.0] as const;
const QUITO = [-0.22, -78.5] as const;

/** Within ±3 minutes of a published time (UTC). */
function near(actual: Date | null, expectedIso: string) {
  expect(actual).not.toBeNull();
  const diffMinutes = Math.abs(actual!.getTime() - Date.parse(expectedIso)) / 60_000;
  expect(diffMinutes).toBeLessThanOrEqual(3);
}

describe("sunDay", () => {
  it("London, midsummer: sunrise 04:43 BST, sunset 21:21 BST", () => {
    const d = sunDay("2026-06-21", ...LONDON);
    near(d.sunrise, "2026-06-21T03:43:00Z");
    near(d.sunset, "2026-06-21T20:21:00Z");
    expect(d.polar).toBeNull();
  });

  it("London, midwinter: sunrise 08:04 GMT, sunset 15:53 GMT", () => {
    const d = sunDay("2026-12-21", ...LONDON);
    near(d.sunrise, "2026-12-21T08:04:00Z");
    near(d.sunset, "2026-12-21T15:53:00Z");
  });

  it("Sydney, midsummer (December): sunrise 05:41 AEDT, sunset 20:05 AEDT", () => {
    // AEDT is UTC+11, so 05:41 on the 21st is 18:41 UTC on the 20th: the sun
    // event belongs to the solar noon on UTC date 2026-12-21 (01:52 UTC).
    const d = sunDay("2026-12-21", ...SYDNEY);
    near(d.sunrise, "2026-12-20T18:41:00Z");
    near(d.sunset, "2026-12-21T09:05:00Z");
  });

  it("near the equator, days are about 12 hours all year", () => {
    for (const date of ["2026-03-20", "2026-06-21", "2026-12-21"]) {
      const d = sunDay(date, ...QUITO);
      const hours = (d.sunset!.getTime() - d.sunrise!.getTime()) / 3_600_000;
      expect(hours).toBeGreaterThan(11.9);
      expect(hours).toBeLessThan(12.3);
    }
  });

  it("Reykjavík in June: the sun sets just after midnight, but it never gets darker than twilight", () => {
    const d = sunDay("2026-06-21", ...REYKJAVIK);
    near(d.sunrise, "2026-06-21T02:55:00Z");
    near(d.sunset, "2026-06-22T00:03:00Z");
    expect(d.dawn).toBeNull();
    expect(d.dusk).toBeNull();
    expect(d.polar).toBeNull();
  });

  it("Svalbard: polar night in December, midnight sun in June", () => {
    expect(sunDay("2026-12-21", ...LONGYEARBYEN)).toMatchObject({
      sunrise: null,
      sunset: null,
      polar: "night",
    });
    expect(sunDay("2026-06-21", ...LONGYEARBYEN)).toMatchObject({
      sunrise: null,
      sunset: null,
      polar: "day",
    });
  });
});

describe("solarPosition", () => {
  it("at solar noon the elevation is 90° minus the angle between latitude and declination", () => {
    // London at the June solstice: declination ≈ +23.44°, so 90 - (51.51 - 23.44) ≈ 61.9°.
    const noon = sunDay("2026-06-21", ...LONDON).solarNoon;
    const { elevation, hourAngle } = solarPosition(noon, ...LONDON);
    expect(elevation).toBeCloseTo(61.9, 0);
    expect(Math.abs(hourAngle)).toBeLessThan(0.1);
  });

  it("the hour angle is negative in the morning and positive in the afternoon", () => {
    expect(solarPosition(new Date("2026-06-21T08:00:00Z"), ...LONDON).hourAngle).toBeLessThan(0);
    expect(solarPosition(new Date("2026-06-21T16:00:00Z"), ...LONDON).hourAngle).toBeGreaterThan(0);
  });
});

describe("sunPhase", () => {
  it("classifies day, twilight and night in London on 10 Nov 2026", () => {
    // Sunrise ≈ 07:10 GMT, civil dawn ≈ 06:33.
    expect(sunPhase(new Date("2026-11-10T12:00:00Z"), ...LONDON)).toBe("day");
    expect(sunPhase(new Date("2026-11-10T06:50:00Z"), ...LONDON)).toBe("twilight");
    expect(sunPhase(new Date("2026-11-10T03:00:00Z"), ...LONDON)).toBe("night");
  });
});
