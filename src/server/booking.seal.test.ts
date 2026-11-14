import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { bookings } from "@/db/schema";
import type { Database } from "@/db/types";
import { book, SECRET, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { readManageToken, rescheduleBookingByToken } from "./manage-booking";
import { hashManageToken, sealManageToken } from "./manage-token";

/*
 * Day 17: the manage token is stored as a hash (to check it) and encrypted
 * (to email it again from a background job). Never in the clear.
 */

const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const START = new Date("2026-11-20T04:00:00Z");
const seal = (token: string, id: string) => sealManageToken(token, id, SECRET);

let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

const row = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0]!;

describe("the stored manage token", () => {
  it("is a hash plus an encrypted copy that opens to the guest's token", async () => {
    const r = await book(db, START, LONG_AGO);
    const stored = await row(r.booking.id);
    expect(stored.manageTokenHash).toBe(hashManageToken(r.manageToken));
    expect(stored.manageTokenEncrypted).not.toContain(r.manageToken);
    expect(await readManageToken(db, r.booking.id, SECRET)).toBe(r.manageToken);
    expect(await readManageToken(db, r.booking.id, "another-secret-another-secret-0000")).toBeNull();
  });

  it("is saved when a guest from before Day 17 reschedules (they just proved they hold it)", async () => {
    const r = await book(db, START, LONG_AGO, { seal: false });
    expect(await readManageToken(db, r.booking.id, SECRET)).toBeNull();
    await rescheduleBookingByToken(db, r.manageToken, new Date("2026-11-20T05:00:00Z"), LONG_AGO, {
      sealToken: seal,
    });
    expect(await readManageToken(db, r.booking.id, SECRET)).toBe(r.manageToken);
  });

  it("isn't replaced when it already exists", async () => {
    const r = await book(db, START, LONG_AGO);
    const before = (await row(r.booking.id)).manageTokenEncrypted;
    await rescheduleBookingByToken(db, r.manageToken, new Date("2026-11-20T05:00:00Z"), LONG_AGO, {
      sealToken: seal,
    });
    expect((await row(r.booking.id)).manageTokenEncrypted).toBe(before);
  });
});
