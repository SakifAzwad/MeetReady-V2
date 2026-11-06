import { beforeEach, describe, expect, it } from "vitest";
import { availabilityRules, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { createTestDb } from "@/test/db";
import { deleteDateOverride, getAvailability, saveDateOverride, saveWeeklySchedule } from "./availability";

describe("availability data access", () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(user).values([
      { id: "alice", name: "Alice", email: "a@example.com", timeZone: "UTC" },
      { id: "bob", name: "Bob", email: "b@example.com" },
    ]);
  }, 30_000);

  it("replaces the weekly schedule and timezone, touching only that user", async () => {
    await saveWeeklySchedule(db, "bob", {
      timeZone: "UTC",
      rules: [{ dayOfWeek: 1, startTime: "08:00", endTime: "12:00" }],
    });
    await saveWeeklySchedule(db, "alice", {
      timeZone: "UTC",
      rules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    });
    await saveWeeklySchedule(db, "alice", {
      timeZone: "Asia/Dhaka",
      rules: [
        { dayOfWeek: 2, startTime: "13:00", endTime: "17:00" },
        { dayOfWeek: 2, startTime: "09:00", endTime: "12:00" },
        { dayOfWeek: 5, startTime: "22:00", endTime: "24:00" },
      ],
    });

    const alice = await getAvailability(db, "alice");
    expect(alice.timeZone).toBe("Asia/Dhaka");
    expect(alice.rules).toEqual([
      { dayOfWeek: 2, startTime: "09:00", endTime: "12:00" }, // sorted, "HH:mm" not "HH:mm:ss"
      { dayOfWeek: 2, startTime: "13:00", endTime: "17:00" },
      { dayOfWeek: 5, startTime: "22:00", endTime: "24:00" }, // 24:00 survives the round trip
    ]);
    expect((await getAvailability(db, "bob")).rules).toEqual([
      { dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
    ]);
  });

  it("is atomic: a bad row rolls back the whole save, keeping the old schedule", async () => {
    await saveWeeklySchedule(db, "alice", {
      timeZone: "UTC",
      rules: [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }],
    });

    await expect(
      saveWeeklySchedule(db, "alice", {
        timeZone: "Asia/Dhaka",
        rules: [
          { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
          { dayOfWeek: 9, startTime: "09:00", endTime: "17:00" }, // violates the day_of_week CHECK
        ],
      }),
    ).rejects.toThrow();

    const after = await getAvailability(db, "alice");
    expect(after.timeZone).toBe("UTC");
    expect(after.rules).toEqual([{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }]);
  });

  it("saves, replaces and deletes date overrides", async () => {
    await saveDateOverride(db, "alice", { date: "2026-12-16", available: false, ranges: [] });
    expect((await getAvailability(db, "alice")).overrides).toEqual([
      { date: "2026-12-16", startTime: null, endTime: null },
    ]);

    await saveDateOverride(db, "alice", {
      date: "2026-12-16",
      available: true,
      ranges: [
        { startTime: "14:00", endTime: "16:00" },
        { startTime: "10:00", endTime: "12:00" },
      ],
    });
    expect((await getAvailability(db, "alice")).overrides).toEqual([
      { date: "2026-12-16", startTime: "10:00", endTime: "12:00" },
      { date: "2026-12-16", startTime: "14:00", endTime: "16:00" },
    ]);

    await deleteDateOverride(db, "bob", "2026-12-16"); // someone else's: no effect
    expect((await getAvailability(db, "alice")).overrides).toHaveLength(2);
    await deleteDateOverride(db, "alice", "2026-12-16");
    expect((await getAvailability(db, "alice")).overrides).toEqual([]);
  });

  it("can list only upcoming overrides", async () => {
    await saveDateOverride(db, "alice", { date: "2026-01-01", available: false, ranges: [] });
    await saveDateOverride(db, "alice", { date: "2026-12-25", available: false, ranges: [] });
    const upcoming = await getAvailability(db, "alice", { overridesFrom: "2026-11-06" });
    expect(upcoming.overrides.map((o) => o.date)).toEqual(["2026-12-25"]);
  });

  it("rules saved here are what the availability_rules table holds (no hidden copies)", async () => {
    await saveWeeklySchedule(db, "alice", { timeZone: "UTC", rules: [] });
    expect(await db.$count(availabilityRules)).toBe(0);
  });
});
