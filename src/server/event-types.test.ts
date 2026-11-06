import { beforeEach, describe, expect, it } from "vitest";
import { user } from "@/db/schema";
import type { Database } from "@/db/types";
import { EVENT_TYPE_DEFAULTS, eventTypeSchema, type EventTypeInput } from "@/lib/validation/event-type";
import { createTestDb } from "@/test/db";
import {
  createEventType,
  getEventType,
  listEventTypes,
  setEventTypeActive,
  updateEventType,
} from "./event-types";

const ALICE = "alice";
const BOB = "bob";

function input(overrides: Partial<typeof EVENT_TYPE_DEFAULTS> = {}): EventTypeInput {
  return eventTypeSchema.parse({
    ...EVENT_TYPE_DEFAULTS,
    title: "Intro call",
    slug: "intro-call",
    ...overrides,
  });
}

describe("event types data access", () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(user).values([
      { id: ALICE, name: "Alice", email: "alice@example.com", username: "alice" },
      { id: BOB, name: "Bob", email: "bob@example.com", username: "bob" },
    ]);
  }, 30_000);

  it("creates, reads and lists a user's own event types", async () => {
    const created = await createEventType(db, ALICE, input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const row = await getEventType(db, ALICE, created.id);
    expect(row).toMatchObject({
      title: "Intro call",
      slug: "intro-call",
      durationMinutes: 30,
      isActive: true,
    });
    expect(await listEventTypes(db, ALICE)).toHaveLength(1);
    expect(await listEventTypes(db, BOB)).toHaveLength(0);
  });

  it("rejects a duplicate slug for the same user, allows it for another user", async () => {
    await createEventType(db, ALICE, input());
    expect(await createEventType(db, ALICE, input({ title: "Other" }))).toEqual({
      ok: false,
      error: "slug_taken",
    });
    expect((await createEventType(db, BOB, input())).ok).toBe(true);
  });

  it("updates an event type, and reports a slug clash on update", async () => {
    const a = await createEventType(db, ALICE, input());
    const b = await createEventType(db, ALICE, input({ title: "Deep dive", slug: "deep-dive" }));
    if (!a.ok || !b.ok) throw new Error("setup failed");

    expect(
      await updateEventType(db, ALICE, a.id, input({ title: "Intro call (new)", durationMinutes: 45 })),
    ).toEqual({
      ok: true,
    });
    expect(await getEventType(db, ALICE, a.id)).toMatchObject({
      title: "Intro call (new)",
      durationMinutes: 45,
    });

    expect(await updateEventType(db, ALICE, b.id, input({ slug: "intro-call" }))).toEqual({
      ok: false,
      error: "slug_taken",
    });
  });

  // The v1 security hole, tested: knowing an id must not be enough.
  describe("another user's event type (IDOR)", () => {
    let aliceEventId: string;

    beforeEach(async () => {
      const created = await createEventType(db, ALICE, input());
      if (!created.ok) throw new Error("setup failed");
      aliceEventId = created.id;
    });

    it("can't be read", async () => {
      expect(await getEventType(db, BOB, aliceEventId)).toBeNull();
    });

    it("can't be updated, and stays unchanged", async () => {
      expect(await updateEventType(db, BOB, aliceEventId, input({ title: "Hacked" }))).toEqual({
        ok: false,
        error: "not_found",
      });
      expect((await getEventType(db, ALICE, aliceEventId))?.title).toBe("Intro call");
    });

    it("can't be turned off", async () => {
      expect(await setEventTypeActive(db, BOB, aliceEventId, false)).toEqual({
        ok: false,
        error: "not_found",
      });
      expect((await getEventType(db, ALICE, aliceEventId))?.isActive).toBe(true);
    });
  });

  it("turns an event type off and on", async () => {
    const created = await createEventType(db, ALICE, input());
    if (!created.ok) throw new Error("setup failed");
    await setEventTypeActive(db, ALICE, created.id, false);
    expect((await getEventType(db, ALICE, created.id))?.isActive).toBe(false);
    await setEventTypeActive(db, ALICE, created.id, true);
    expect((await getEventType(db, ALICE, created.id))?.isActive).toBe(true);
  });

  it("treats a malformed id as not found instead of crashing", async () => {
    expect(await getEventType(db, ALICE, "not-a-uuid")).toBeNull();
    expect(await updateEventType(db, ALICE, "1 OR 1=1", input())).toEqual({ ok: false, error: "not_found" });
    expect(await setEventTypeActive(db, ALICE, "", false)).toEqual({ ok: false, error: "not_found" });
  });
});
