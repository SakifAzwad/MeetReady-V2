import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { pgErrorCode, PG_CHECK_VIOLATION } from "@/db/errors";
import { user } from "@/db/schema";
import type { Database } from "@/db/types";
import { createTestDb } from "@/test/db";
import { completeOnboarding, suggestUsername } from "./users";

describe("completeOnboarding", () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(user).values([
      { id: "u1", name: "One", email: "one@example.com" },
      { id: "u2", name: "Two", email: "two@example.com" },
    ]);
  }, 30_000);

  it("saves username and timezone for that user only", async () => {
    expect(await completeOnboarding(db, "u1", { username: "sakif", timeZone: "Asia/Dhaka" })).toEqual({
      ok: true,
    });

    const rows = await db
      .select({ id: user.id, username: user.username, timeZone: user.timeZone })
      .from(user);
    expect(rows).toContainEqual({ id: "u1", username: "sakif", timeZone: "Asia/Dhaka" });
    expect(rows).toContainEqual({ id: "u2", username: null, timeZone: "UTC" });
  });

  it("reports a taken username instead of throwing", async () => {
    await completeOnboarding(db, "u1", { username: "sakif", timeZone: "UTC" });
    expect(await completeOnboarding(db, "u2", { username: "sakif", timeZone: "UTC" })).toEqual({
      ok: false,
      error: "username_taken",
    });
  });

  it("lets a user re-save their own username", async () => {
    await completeOnboarding(db, "u1", { username: "sakif", timeZone: "UTC" });
    expect(await completeOnboarding(db, "u1", { username: "sakif", timeZone: "Asia/Dhaka" })).toEqual({
      ok: true,
    });
  });

  it("the database rejects badly formatted usernames even if validation is skipped", async () => {
    for (const bad of ["Sakif", "ab", "-sakif", "sa--kif", "sakif!"]) {
      const code = await db
        .update(user)
        .set({ username: bad })
        .where(eq(user.id, "u1"))
        .then(() => undefined, pgErrorCode);
      expect(code, bad).toBe(PG_CHECK_VIOLATION);
    }
  });
});

describe("suggestUsername", () => {
  it.each([
    ["sakifazwad18@gmail.com", "sakifazwad18"],
    ["Sakif.Azwad+test@gmail.com", "sakif-azwad-test"],
    ["__x__@example.com", ""], // too short after cleaning
    ["admin@example.com", ""], // reserved
    ["a".repeat(29) + ".b@example.com", "a".repeat(29)], // trimmed to 30, no trailing hyphen
  ])("%s -> %j", (email, expected) => {
    expect(suggestUsername(email)).toBe(expected);
  });
});

describe("completeOnboarding: default availability", () => {
  it("gives a new host Mon–Fri 09:00–17:00, once, and not if onboarding fails", async () => {
    const db = await createTestDb();
    await db.insert(user).values([
      { id: "u1", name: "One", email: "one@example.com" },
      { id: "u2", name: "Two", email: "two@example.com" },
    ]);
    const { getAvailability } = await import("./availability");

    await completeOnboarding(db, "u1", { username: "sakif", timeZone: "Asia/Dhaka" });
    const first = await getAvailability(db, "u1");
    expect(first.rules.map((r) => r.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
    expect(first.rules[0]).toMatchObject({ startTime: "09:00", endTime: "17:00" });

    // Re-saving doesn't duplicate or overwrite rules.
    await completeOnboarding(db, "u1", { username: "sakif", timeZone: "Asia/Dhaka" });
    expect((await getAvailability(db, "u1")).rules).toHaveLength(5);

    // Username taken -> the whole transaction rolls back: no rules for u2.
    expect(await completeOnboarding(db, "u2", { username: "sakif", timeZone: "UTC" })).toMatchObject({
      ok: false,
    });
    expect((await getAvailability(db, "u2")).rules).toHaveLength(0);
  }, 30_000);
});
