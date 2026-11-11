import { describe, expect, it } from "vitest";
import { bookingRequestSchema, guestDetailsSchema, slotsQuerySchema } from "./booking";

const valid = {
  username: "Sakif",
  slug: "Intro",
  startsAt: "2026-11-09T04:00:00.000Z",
  guestName: "  Ada  ",
  guestEmail: " Ada@Example.COM ",
  guestTimeZone: "Europe/London",
  guestNotes: "",
};

describe("bookingRequestSchema", () => {
  it("normalises input and parses the start as an exact instant", () => {
    const parsed = bookingRequestSchema.parse(valid);
    expect(parsed).toMatchObject({
      username: "sakif",
      slug: "intro",
      guestName: "Ada",
      guestEmail: "ada@example.com",
    });
    expect(parsed.startsAt.toISOString()).toBe("2026-11-09T04:00:00.000Z");
  });

  it("accepts an explicit offset", () => {
    expect(
      bookingRequestSchema.parse({ ...valid, startsAt: "2026-11-09T10:00:00+06:00" }).startsAt.toISOString(),
    ).toBe("2026-11-09T04:00:00.000Z");
  });

  it.each([
    ["a start with no offset (ambiguous)", { startsAt: "2026-11-09T10:00:00" }],
    ["a non-date start", { startsAt: "tomorrow" }],
    ["a bad email", { guestEmail: "not-an-email" }],
    ["an empty name", { guestName: "   " }],
    ["an unknown timezone", { guestTimeZone: "Mars/Base" }],
    ["very long notes", { guestNotes: "x".repeat(2001) }],
  ])("rejects %s", (_name, override) => {
    expect(bookingRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe("guestDetailsSchema", () => {
  it("gives readable messages", () => {
    const result = guestDetailsSchema.safeParse({ guestName: "", guestEmail: "x", guestNotes: "" });
    expect(result.error?.issues.map((i) => i.message)).toEqual(["Enter your name", "Enter a valid email"]);
  });
});

describe("slotsQuerySchema", () => {
  const q = { username: "sakif", slug: "intro", from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" };

  it("accepts a month", () => {
    expect(slotsQuerySchema.safeParse(q).success).toBe(true);
  });

  it("rejects a backwards range and one longer than 62 days", () => {
    expect(slotsQuerySchema.safeParse({ ...q, to: "2026-10-01T00:00:00Z" }).success).toBe(false);
    expect(slotsQuerySchema.safeParse({ ...q, to: "2027-11-01T00:00:00Z" }).success).toBe(false);
  });

  it("answers bad dates with an error instead of throwing (the API's 500 on Day 12)", () => {
    const result = slotsQuerySchema.safeParse({ ...q, from: "bad", to: "bad" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toEqual(["from", "to"]);
  });
});
