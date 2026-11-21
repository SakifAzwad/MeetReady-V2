import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { user, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import type { Database } from "@/db/types";
import { SECRET, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { openSecret } from "./deliveries";
import {
  createEndpoint,
  deleteEndpoint,
  MAX_ENDPOINTS,
  pingEndpoint,
  recentDeliveries,
  retryDelivery,
  rotateSecret,
  ROTATION_OVERLAP_MS,
} from "./endpoints";

/* Day 26: managing endpoints, host-scoped, on a real (in-memory) Postgres. DNS is faked. */

const NOW = new Date("2026-11-21T10:00:00Z");
let db: Database;
const publicDns = async () => [{ address: "93.184.215.14", family: 4 }];
const deps = (over: Partial<Parameters<typeof createEndpoint>[0]> = {}) => ({
  db,
  appSecret: SECRET,
  allowPrivate: false,
  resolve: publicDns,
  ...over,
});
const URL_OK = "https://hooks.example.com/meetready";
const ALL = ["booking.created", "booking.rescheduled", "booking.cancelled"] as const;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
  await db.insert(user).values({ id: "other", name: "O", email: "o@example.com", username: "other" });
}, 30_000);

describe("endpoints (Day 26)", () => {
  it("creates one with a whsec_ secret, shown once and stored only encrypted", async () => {
    const r = await createEndpoint(deps(), "host", { url: URL_OK, events: [...ALL] });
    if (!r.ok) throw new Error(r.error);
    expect(r.secret).toMatch(/^whsec_/);
    const [row] = await db.select().from(webhookEndpoints);
    expect(row).toMatchObject({ userId: "host", url: URL_OK, events: [...ALL] });
    expect(row!.secretEncrypted).not.toContain(r.secret);
    expect(openSecret(row!.secretEncrypted, row!.id, SECRET)).toBe(r.secret);
  });

  it("refuses a bad URL, a name on a private network, no events, and a sixth endpoint", async () => {
    const error = async (url: string, events = [...ALL], over = {}) => {
      const r = await createEndpoint(deps(over), "host", { url, events });
      return r.ok ? "ok" : r.error;
    };
    expect(await error("http://hooks.example.com/")).toBe("Use an https:// URL.");
    expect(await error(URL_OK, [...ALL], { resolve: async () => [{ address: "10.0.0.7", family: 4 }] })).toBe(
      '"hooks.example.com" points at a private network.',
    );
    expect(await error(URL_OK, [])).toBe("Pick at least one event.");
    for (let i = 0; i < MAX_ENDPOINTS; i++) expect(await error(`${URL_OK}/${i}`)).toBe("ok");
    expect(await error(`${URL_OK}/6`)).toBe(`You can have up to ${MAX_ENDPOINTS} endpoints.`);
    // Another host's count is their own.
    expect((await createEndpoint(deps(), "other", { url: URL_OK, events: [...ALL] })).ok).toBe(true);
  });

  it("rotating keeps the old secret signing for 24 hours", async () => {
    const r = await createEndpoint(deps(), "host", { url: URL_OK, events: [...ALL] });
    if (!r.ok) throw new Error(r.error);
    const rotated = await rotateSecret(deps(), "host", r.id, NOW);
    if (!rotated.ok) throw new Error("rotate failed");
    const [row] = await db.select().from(webhookEndpoints);
    expect(openSecret(row!.secretEncrypted, r.id, SECRET)).toBe(rotated.secret);
    expect(openSecret(row!.previousSecretEncrypted!, r.id, SECRET)).toBe(r.secret);
    expect(row!.previousSecretExpiresAt).toEqual(new Date(NOW.getTime() + ROTATION_OVERLAP_MS));
  });

  it("another host can't delete, rotate, ping, retry or list it", async () => {
    const r = await createEndpoint(deps(), "host", { url: URL_OK, events: [...ALL] });
    if (!r.ok) throw new Error(r.error);
    const ping = (await pingEndpoint(db, "host", r.id, NOW))!;
    await db.update(webhookDeliveries).set({ status: "failed" }).where(eq(webhookDeliveries.id, ping));

    expect(await deleteEndpoint(db, "other", r.id)).toBe(false);
    expect(await rotateSecret(deps(), "other", r.id, NOW)).toEqual({ ok: false });
    expect(await pingEndpoint(db, "other", r.id, NOW)).toBeNull();
    expect(await retryDelivery(db, "other", ping)).toBeNull();
    expect(await recentDeliveries(db, "other")).toEqual([]);

    // Its own host can.
    expect(await retryDelivery(db, "host", ping)).toBe(ping);
    expect((await db.select().from(webhookDeliveries))[0]!.status).toBe("pending");
    expect(await retryDelivery(db, "host", ping)).toBeNull(); // only a failed one
    expect(await deleteEndpoint(db, "host", r.id)).toBe(true);
    expect(await db.select().from(webhookDeliveries)).toEqual([]); // its deliveries go with it
  });
});
