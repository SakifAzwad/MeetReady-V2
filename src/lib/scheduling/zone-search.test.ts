import { describe, expect, it } from "vitest";
import {
  allZoneOptions,
  normalise,
  offsetLabel,
  parseOffsetQuery,
  searchZones,
  zoneOption,
} from "./zone-search";

// A fixed instant in northern-hemisphere winter: London GMT, New York GMT−5, Sydney GMT+11.
const AT = new Date("2026-01-15T12:00:00Z");
const ALL = allZoneOptions(AT);
const ids = (q: string) => searchZones(q, ALL).map((o) => o.id);

describe("searchZones", () => {
  it("finds a city by the start of its name", () => {
    expect(ids("dhak")[0]).toBe("Asia/Dhaka");
    expect(ids("new y")[0]).toBe("America/New_York");
  });

  it("finds a city by a later word, and ignores accents", () => {
    expect(ids("york")).toContain("America/New_York");
    expect(ids("sao paulo")[0]).toBe("America/Sao_Paulo");
  });

  it("finds a country, including common nicknames", () => {
    expect(ids("bangladesh")).toEqual(["Asia/Dhaka"]);
    expect(ids("uk")).toContain("Europe/London");
    expect(ids("uae")).toContain("Asia/Dubai");
  });

  it("finds Kolkata whichever id the runtime uses (Asia/Calcutta in some browsers)", () => {
    // Exact country beats "Indianapolis" and the America/Indiana/* zones.
    const india = searchZones("india", ALL);
    expect(india[0]!.city).toBe("Kolkata");
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(india[0]!.id);
  });

  it("ranks a city match above a country match", () => {
    // "london" is a city; "Londonderry"-style partial matches never outrank it.
    expect(ids("london")[0]).toBe("Europe/London");
  });

  it("finds zones by offset at the given instant", () => {
    expect(ids("gmt+5:30").map((id) => id.replace("Calcutta", "Kolkata"))).toContain("Asia/Kolkata");
    expect(ids("utc-5")).toContain("America/New_York");
    expect(ids("+11")).toContain("Australia/Sydney"); // daylight saving in January
  });

  it("returns nothing for an empty query and respects the limit", () => {
    expect(searchZones("  ", ALL)).toEqual([]);
    expect(searchZones("a", ALL, 3)).toHaveLength(3);
  });
});

describe("allZoneOptions", () => {
  it("lists each place once even when the runtime knows two names for it", () => {
    const options = allZoneOptions(AT, ["Asia/Calcutta", "Asia/Kolkata", "Europe/London"]);
    expect(options.map((o) => o.id)).toEqual(["UTC", "Asia/Calcutta", "Europe/London"]);
    expect(options[1]!.city).toBe("Kolkata");
  });
});

describe("zoneOption", () => {
  it("has city, country and the offset at that instant", () => {
    expect(zoneOption("Asia/Dhaka", AT)).toMatchObject({
      city: "Dhaka",
      country: "Bangladesh",
      offset: "GMT+6",
    });
    expect(zoneOption("UTC", AT)).toMatchObject({ city: "UTC", country: null, offset: "GMT" });
  });

  it("follows daylight saving", () => {
    expect(zoneOption("Europe/London", new Date("2026-07-01T12:00:00Z")).offset).toBe("GMT+1");
  });
});

describe("helpers", () => {
  it("formats offsets with a real minus sign and minutes when needed", () => {
    expect(offsetLabel(330)).toBe("GMT+5:30");
    expect(offsetLabel(-300)).toBe("GMT−5");
    expect(offsetLabel(0)).toBe("GMT");
  });

  it("parses offset queries", () => {
    expect(parseOffsetQuery("GMT+6")).toBe(360);
    expect(parseOffsetQuery("utc −3:30")).toBe(-210);
    expect(parseOffsetQuery("dhaka")).toBeNull();
  });

  it("normalises names", () => {
    expect(normalise("São_Paulo")).toBe("sao paulo");
    expect(normalise("America/Argentina/Buenos_Aires")).toBe("america argentina buenos aires");
  });
});
