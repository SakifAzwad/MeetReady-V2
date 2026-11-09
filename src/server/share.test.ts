import { beforeEach, describe, expect, it } from "vitest";
import { user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import { saveWeeklySchedule } from "./availability";
import { createBooking } from "./booking";
import { createEventType, setEventTypeActive } from "./event-types";
import { suggestTimes } from "./share";

const NOW = new Date("2026-11-08T00:00:00Z"); // Sunday
const ALICE = { id: "alice", username: "alice" };

describe("suggestTimes", () => {
  let db: Database;
  let eventTypeId: string;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(user).values([
      { id: "alice", name: "Alice", email: "alice@example.com", username: "alice" },
      { id: "bob", name: "Bob", email: "bob@example.com", username: "bob" },
    ]);
    // Alice in Dhaka, Mon–Fri 09:00–17:00 (03:00–11:00 UTC).
    await saveWeeklySchedule(db, "alice", {
      timeZone: "Asia/Dhaka",
      rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" })),
    });
    const r = await createEventType(
      db,
      "alice",
      eventTypeSchema.parse({
        ...EVENT_TYPE_DEFAULTS,
        title: "Intro",
        slug: "intro",
        durationMinutes: 30,
        minimumNoticeMinutes: 0,
        bookingWindowDays: null,
      }),
    );
    if (!r.ok) throw new Error("setup failed");
    eventTypeId = r.id;
  });

  it("suggests three bookable times on different days, in the recipient's daytime", async () => {
    const r = await suggestTimes(db, ALICE, eventTypeId, "Europe/London", NOW);
    expect(r.ok && r.slots.map((s) => s.start.toISOString())).toEqual([
      "2026-11-09T08:00:00.000Z",
      "2026-11-10T08:00:00.000Z",
      "2026-11-11T08:00:00.000Z",
    ]);
  });

  it("never suggests a time that's already booked", async () => {
    const booked = await createBooking(
      db,
      {
        username: "alice",
        slug: "intro",
        startsAt: new Date("2026-11-09T08:00:00Z"),
        guestName: "Ada",
        guestEmail: "ada@example.com",
        guestTimeZone: "Europe/London",
        guestNotes: "",
      },
      NOW,
    );
    expect(booked.ok).toBe(true);
    const r = await suggestTimes(db, ALICE, eventTypeId, "Europe/London", NOW);
    expect(r.ok && r.slots[0]!.start.toISOString()).toBe("2026-11-09T08:30:00.000Z");
  });

  // IDOR: knowing Alice's event type id is not enough for Bob.
  it("refuses another host's event type", async () => {
    expect(await suggestTimes(db, { id: "bob", username: "bob" }, eventTypeId, "UTC", NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await suggestTimes(db, ALICE, "not-a-uuid", "UTC", NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses a switched-off event type", async () => {
    await setEventTypeActive(db, "alice", eventTypeId, false);
    expect(await suggestTimes(db, ALICE, eventTypeId, "UTC", NOW)).toEqual({ ok: false, error: "inactive" });
  });
});
