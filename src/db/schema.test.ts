import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { bookings, dateOverrides, eventTypes, user } from "./schema";

/*
 * Runs the REAL migrations against a real Postgres (PGlite = Postgres compiled
 * to WASM, in-process, no Docker). This proves the constraints work, not just
 * that the TypeScript compiles. Concurrent-insert tests need a multi-connection
 * Postgres; those come with the booking action, using a Postgres service in CI.
 */

async function freshDb() {
  const client = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

type TestDb = Awaited<ReturnType<typeof freshDb>>;

/** Postgres error code from a Drizzle-wrapped error. */
async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
}

const EXCLUSION_VIOLATION = "23P01";
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

describe("database schema", () => {
  let db: TestDb;
  let eventTypeId: string;

  const booking = (start: string, end: string, extra: Partial<typeof bookings.$inferInsert> = {}) => ({
    eventTypeId,
    hostId: "host-1",
    guestName: "Guest",
    guestEmail: "guest@example.com",
    guestTimeZone: "Europe/London",
    manageTokenHash: randomUUID(), // any unique value; real ones are SHA-256 hex
    startsAt: new Date(start),
    endsAt: new Date(end),
    ...extra,
  });

  beforeEach(async () => {
    db = await freshDb();
    await db.insert(user).values([
      { id: "host-1", name: "Host One", email: "one@example.com", timeZone: "Asia/Dhaka" },
      { id: "host-2", name: "Host Two", email: "two@example.com" },
    ]);
    const [et] = await db
      .insert(eventTypes)
      .values({ userId: "host-1", title: "Intro call", slug: "intro-call", durationMinutes: 30 })
      .returning({ id: eventTypes.id });
    eventTypeId = et!.id;
  }, 30_000);

  describe("bookings_no_overlap exclusion constraint", () => {
    it("allows back-to-back bookings (half-open ranges)", async () => {
      await db.insert(bookings).values(booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z"));
      await db.insert(bookings).values(booking("2026-11-09T10:30:00Z", "2026-11-09T11:00:00Z"));
      expect(await db.$count(bookings)).toBe(2);
    });

    it("rejects an overlapping booking for the same host", async () => {
      await db.insert(bookings).values(booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z"));
      const code = await pgErrorCode(
        db.insert(bookings).values(booking("2026-11-09T10:15:00Z", "2026-11-09T10:45:00Z")),
      );
      expect(code).toBe(EXCLUSION_VIOLATION);
    });

    it("rejects the exact same slot twice", async () => {
      await db.insert(bookings).values(booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z"));
      const code = await pgErrorCode(
        db.insert(bookings).values(booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z")),
      );
      expect(code).toBe(EXCLUSION_VIOLATION);
    });

    it("allows the same time for a different host", async () => {
      const [et2] = await db
        .insert(eventTypes)
        .values({ userId: "host-2", title: "Chat", slug: "chat", durationMinutes: 30 })
        .returning({ id: eventTypes.id });
      await db.insert(bookings).values(booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z"));
      await db
        .insert(bookings)
        .values(
          booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z", { hostId: "host-2", eventTypeId: et2!.id }),
        );
      expect(await db.$count(bookings)).toBe(2);
    });

    it("frees the slot when a booking is cancelled", async () => {
      const [first] = await db
        .insert(bookings)
        .values(booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z"))
        .returning({ id: bookings.id });
      await db
        .update(bookings)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(bookings.id, first!.id));
      await db.insert(bookings).values(booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z"));
      expect(await db.$count(bookings, eq(bookings.status, "confirmed"))).toBe(1);
    });

    it("blocks re-confirming a cancelled booking whose slot was taken", async () => {
      const [first] = await db
        .insert(bookings)
        .values(
          booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z", {
            status: "cancelled",
            cancelledAt: new Date(),
          }),
        )
        .returning({ id: bookings.id });
      await db.insert(bookings).values(booking("2026-11-09T10:00:00Z", "2026-11-09T10:30:00Z"));
      const code = await pgErrorCode(
        db.update(bookings).set({ status: "confirmed", cancelledAt: null }).where(eq(bookings.id, first!.id)),
      );
      expect(code).toBe(EXCLUSION_VIOLATION);
    });
  });

  describe("check constraints", () => {
    it("rejects a booking that ends before it starts", async () => {
      const code = await pgErrorCode(
        db.insert(bookings).values(booking("2026-11-09T10:30:00Z", "2026-11-09T10:00:00Z")),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("rejects a date override with only one of start/end", async () => {
      const code = await pgErrorCode(
        db
          .insert(dateOverrides)
          .values({ userId: "host-1", date: "2026-12-25", startTime: "09:00", endTime: null }),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("rejects a slug that isn't URL-safe", async () => {
      const code = await pgErrorCode(
        db
          .insert(eventTypes)
          .values({ userId: "host-1", title: "X", slug: "Intro Call!", durationMinutes: 30 }),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("keeps status and cancelled_at consistent", async () => {
      expect(
        await pgErrorCode(
          db
            .insert(bookings)
            .values(booking("2026-11-09T12:00:00Z", "2026-11-09T12:30:00Z", { status: "cancelled" })),
        ),
      ).toBe(CHECK_VIOLATION);
      expect(
        await pgErrorCode(
          db
            .insert(bookings)
            .values(booking("2026-11-09T12:00:00Z", "2026-11-09T12:30:00Z", { cancelledAt: new Date() })),
        ),
      ).toBe(CHECK_VIOLATION);
    });

    it("rejects two bookings with the same manage token hash", async () => {
      await db
        .insert(bookings)
        .values(booking("2026-11-09T12:00:00Z", "2026-11-09T12:30:00Z", { manageTokenHash: "h" }));
      expect(
        await pgErrorCode(
          db
            .insert(bookings)
            .values(booking("2026-11-09T13:00:00Z", "2026-11-09T13:30:00Z", { manageTokenHash: "h" })),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it("rejects a duplicate slug for the same host", async () => {
      const code = await pgErrorCode(
        db
          .insert(eventTypes)
          .values({ userId: "host-1", title: "Again", slug: "intro-call", durationMinutes: 30 }),
      );
      expect(code).toBe(UNIQUE_VIOLATION);
    });
  });
});
