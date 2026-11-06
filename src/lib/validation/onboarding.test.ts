import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { onboardingSchema, usernameSchema } from "./onboarding";

describe("usernameSchema", () => {
  it("normalises case and whitespace", () => {
    expect(usernameSchema.parse("  Sakif-Azwad ")).toBe("sakif-azwad");
  });

  it.each(["sakif", "sakif-azwad", "s4k1f", "abc"])("accepts %j", (name) => {
    expect(usernameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    ["ab", /At least 3/],
    ["a".repeat(31), /At most 30/],
    ["-sakif", /hyphens/],
    ["sakif-", /hyphens/],
    ["sa--kif", /hyphens/],
    ["sakif_azwad", /hyphens/],
    ["sakif azwad", /hyphens/],
    ["dashboard", /reserved/],
    ["Login", /reserved/], // reserved check runs after lowercasing
  ])("rejects %j", (name, message) => {
    const result = usernameSchema.safeParse(name);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(message);
  });
});

describe("onboardingSchema timezone", () => {
  it.each(["Asia/Dhaka", "UTC", "Asia/Kolkata", "Asia/Calcutta"])("accepts %j", (timeZone) => {
    expect(onboardingSchema.safeParse({ username: "sakif", timeZone }).success).toBe(true);
  });

  it.each(["", "Asia/Chattogram", "GMT+6 lol"])("rejects %j", (timeZone) => {
    expect(onboardingSchema.safeParse({ username: "sakif", timeZone }).success).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard/events?tab=past", "/dashboard/events?tab=past"],
    ["/onboarding", "/onboarding"],
    [undefined, "/dashboard"],
    ["", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ])("%j -> %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});
