import { describe, expect, it } from "vitest";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema, slugify } from "./event-type";

const valid = { ...EVENT_TYPE_DEFAULTS, title: "Intro call", slug: "intro-call" };
const errorsFor = (values: object) => {
  const result = eventTypeSchema.safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
};

describe("slugify", () => {
  it.each([
    ["Intro Call", "intro-call"],
    ["  30 min — Café chat!  ", "30-min-cafe-chat"],
    ["***", ""],
    ["a".repeat(100), "a".repeat(80)],
  ])("%j -> %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe("eventTypeSchema", () => {
  it("accepts the defaults with a title and slug, and normalises them", () => {
    const parsed = eventTypeSchema.parse({
      ...valid,
      title: "  Intro call ",
      slug: "Intro-Call",
      description: "  ",
    });
    expect(parsed).toMatchObject({
      title: "Intro call",
      slug: "intro-call",
      description: null,
      locationValue: null,
    });
  });

  it("requires a title and a URL-safe slug", () => {
    expect(errorsFor({ ...valid, title: " " })).toHaveProperty("title");
    expect(errorsFor({ ...valid, slug: "intro call" })).toHaveProperty("slug");
    expect(errorsFor({ ...valid, slug: "-intro" })).toHaveProperty("slug");
  });

  it.each([
    ["durationMinutes", 0],
    ["durationMinutes", 721],
    ["durationMinutes", 12.5],
    ["durationMinutes", Number.NaN], // what an empty number input produces
    ["bufferBeforeMinutes", -5],
    ["bookingWindowDays", 0],
    ["maxBookingsPerDay", 0],
  ])("rejects %s = %s", (field, value) => {
    expect(errorsFor({ ...valid, [field]: value })).toHaveProperty(field);
  });

  it("allows 'no limit' (null) for the optional limits", () => {
    expect(
      eventTypeSchema.safeParse({
        ...valid,
        bookingWindowDays: null,
        maxBookingsPerDay: null,
        slotIntervalMinutes: null,
      }).success,
    ).toBe(true);
  });

  describe("location details depend on the location type", () => {
    it.each([
      ["zoom", "https://us05web.zoom.us/j/123456789", true],
      ["zoom", "http://zoom.us/j/1", false], // not https
      ["zoom", "zoom.us/j/1", false],
      ["phone", "+880 1712 345678", true],
      ["phone", "call me", false],
      ["in_person", "IIUC, Kumira, Chattogram", true],
      ["in_person", "", false],
      ["google_meet", "", true],
    ])("%s with %j -> valid: %s", (locationType, locationValue, ok) => {
      expect(eventTypeSchema.safeParse({ ...valid, locationType, locationValue }).success).toBe(ok);
    });

    it("drops leftover details when switching to Google Meet", () => {
      const parsed = eventTypeSchema.parse({
        ...valid,
        locationType: "google_meet",
        locationValue: "+880 1712",
      });
      expect(parsed.locationValue).toBeNull();
    });
  });
});
