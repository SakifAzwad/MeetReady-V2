import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { user, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import type { Database } from "@/db/types";
import { book, SECRET, setupHost } from "@/test/booking-fixture";
import { createTestDb } from "@/test/db";
import { cancelBookingAsHost } from "../manage-booking";
import {
  attemptDelivery,
  deleteOldDeliveries,
  KEEP_DAYS,
  queueBookingDeliveries,
  queuePing,
  sealSecret,
} from "./deliveries";
import { newWebhookSecret, verify } from "./signing";
import type { HttpResult } from "./transport";

/*
 * Day 26: queuing and sending webhook deliveries, on a real (in-memory)
 * Postgres, with the receiver faked at the `post` seam. Host "sakif" from the
 * shared fixture; Ada's booking is Thursday 26 Nov.
 */

const NOW = new Date("2026-11-21T10:00:00Z");
const LONG_AGO = new Date("2026-11-01T00:00:00Z");
const ADA = new Date("2026-11-26T08:00:00Z");
let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  await setupHost(db);
}, 30_000);

async function endpoint(
  events: ("booking.created" | "booking.rescheduled" | "booking.cancelled")[],
  userId = "host",
) {
  const secret = newWebhookSecret();
  const [row] = await db
    .insert(webhookEndpoints)
    .values({ userId, url: "https://hooks.example.com/meetready", events, secretEncrypted: "pending" })
    .returning({ id: webhookEndpoints.id });
  await db
    .update(webhookEndpoints)
    .set({ secretEncrypted: sealSecret(secret, row!.id, SECRET) })
    .where(eq(webhookEndpoints.id, row!.id));
  return { id: row!.id, secret };
}

type Sent = { url: string; headers: Record<string, string>; body: string };
function receiver(answer: () => Promise<HttpResult> = async () => ({ status: 200, body: "ok", ms: 3 })) {
  const sent: Sent[] = [];
  const post = vi.fn(async (url: string, headers: Record<string, string>, body: string) => {
    sent.push({ url, headers, body });
    return answer();
  });
  return { sent, post };
}
const deps = (post: ReturnType<typeof receiver>["post"], now = NOW) => ({
  db,
  secret: SECRET,
  now: () => now,
  allowPrivate: false,
  post,
});
const row = async (id: string) =>
  (await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)))[0]!;

describe("queueing (Day 26)", () => {
  it("one delivery per endpoint that listens to this event; the payload has the guest but not their notes", async () => {
    const all = await endpoint(["booking.created", "booking.cancelled"]);
    await endpoint(["booking.cancelled"]); // not listening to created
    const r = await book(db, ADA, LONG_AGO);
    const ids = await queueBookingDeliveries(
      db,
      { bookingId: r.booking.id, change: "created", sequence: 0 },
      NOW,
    );
    expect(ids).toHaveLength(1);
    const d = await row(ids[0]!);
    expect(d).toMatchObject({ endpointId: all.id, event: "booking.created", status: "pending", attempts: 0 });
    expect(d.payload).toMatchObject({
      type: "booking.created",
      data: {
        bookingId: r.booking.id,
        status: "confirmed",
        startsAt: ADA.toISOString(),
        timeZone: "Asia/Dhaka",
        meetingType: { slug: "intro", title: "Intro call", durationMinutes: 30 },
        guest: { name: "Ada", email: "ada@example.com", timeZone: "Europe/London" },
        changedBy: "guest",
        throughAssistant: false,
      },
    });
    expect(JSON.stringify(d.payload)).not.toContain("Private notes"); // the guest's notes stay out
  });

  it("a retried job step queues nothing twice and returns the same ids", async () => {
    await endpoint(["booking.created"]);
    const r = await book(db, ADA, LONG_AGO);
    const change = { bookingId: r.booking.id, change: "created" as const, sequence: 0 };
    const first = await queueBookingDeliveries(db, change, NOW);
    const again = await queueBookingDeliveries(db, change, NOW);
    expect(again).toEqual(first);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(1);
  });

  it("only the booking's host's endpoints", async () => {
    await db.insert(user).values({ id: "other", name: "O", email: "o@example.com", username: "other" });
    await endpoint(["booking.created"], "other");
    const r = await book(db, ADA, LONG_AGO);
    expect(
      await queueBookingDeliveries(db, { bookingId: r.booking.id, change: "created", sequence: 0 }, NOW),
    ).toEqual([]);
  });

  it("a cancel says who did it", async () => {
    await endpoint(["booking.cancelled"]);
    const r = await book(db, ADA, LONG_AGO);
    await cancelBookingAsHost(db, "host", r.booking.id, "Ill", NOW);
    const [id] = await queueBookingDeliveries(
      db,
      { bookingId: r.booking.id, change: "cancelled", sequence: 1 },
      NOW,
    );
    expect((await row(id!)).payload).toMatchObject({
      type: "booking.cancelled",
      data: { status: "cancelled", changedBy: "host" },
    });
    expect(JSON.stringify((await row(id!)).payload)).not.toContain("Ill"); // reasons are free text: left out
  });
});

describe("sending (Day 26)", () => {
  async function queued() {
    const e = await endpoint(["booking.created"]);
    const r = await book(db, ADA, LONG_AGO);
    const [id] = await queueBookingDeliveries(
      db,
      { bookingId: r.booking.id, change: "created", sequence: 0 },
      NOW,
    );
    return { id: id!, secret: e.secret };
  }

  it("signs so the receiver can verify it, with the stored payload byte for byte", async () => {
    const { id, secret } = await queued();
    const { sent, post } = receiver();
    expect(await attemptDelivery(deps(post), id, { finalAttempt: false })).toBe("delivered");
    const [req] = sent;
    expect(req!.headers["webhook-id"]).toBe(id);
    expect(verify(secret, req!.headers, req!.body, Math.floor(NOW.getTime() / 1000))).toBe(true);
    expect(await row(id)).toMatchObject({
      status: "delivered",
      attempts: 1,
      lastStatusCode: 200,
      deliveredAt: NOW,
    });
  });

  it("a 5xx or a timeout is retried (same id, same body, new timestamp); the last try marks it failed", async () => {
    const { id } = await queued();
    const { sent, post } = receiver(async () => ({ status: 503, body: "", ms: 2 }));
    expect(await attemptDelivery(deps(post), id, { finalAttempt: false })).toBe("retry");
    expect(await row(id)).toMatchObject({ status: "pending", attempts: 1, lastStatusCode: 503 });
    const later = new Date(NOW.getTime() + 60_000);
    expect(await attemptDelivery(deps(post, later), id, { finalAttempt: true })).toBe("failed");
    expect(await row(id)).toMatchObject({ status: "failed", attempts: 2 });
    expect(sent[1]!.body).toBe(sent[0]!.body);
    expect(sent[1]!.headers["webhook-id"]).toBe(sent[0]!.headers["webhook-id"]);
    expect(sent[1]!.headers["webhook-timestamp"]).not.toBe(sent[0]!.headers["webhook-timestamp"]);

    // A timeout is retried the same way.
    await db.update(webhookDeliveries).set({ status: "pending" }).where(eq(webhookDeliveries.id, id));
    const timeouts = receiver(async () =>
      Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })),
    );
    expect(await attemptDelivery(deps(timeouts.post), id, { finalAttempt: false })).toBe("retry");
    expect((await row(id)).lastError).toBe("No answer within 10 seconds.");
  });

  it("a 4xx (other than 408/429) or a redirect fails for good, without retries", async () => {
    const { id } = await queued();
    expect(
      await attemptDelivery(deps(receiver(async () => ({ status: 401, body: "", ms: 1 })).post), id, {
        finalAttempt: false,
      }),
    ).toBe("failed");
    await db.update(webhookDeliveries).set({ status: "pending" }).where(eq(webhookDeliveries.id, id));
    expect(
      await attemptDelivery(deps(receiver(async () => ({ status: 429, body: "", ms: 1 })).post), id, {
        finalAttempt: false,
      }),
    ).toBe("retry");
    expect(
      await attemptDelivery(deps(receiver(async () => ({ status: 302, body: "", ms: 1 })).post), id, {
        finalAttempt: false,
      }),
    ).toBe("failed");
    expect((await row(id)).lastError).toBe("Redirects aren't followed. Use the final URL.");
  });

  it("a private address found at connect time fails for good", async () => {
    const { id } = await queued();
    const blocked = receiver(async () =>
      Promise.reject(
        Object.assign(new TypeError("fetch failed"), { cause: { name: "BlockedAddressError" } }),
      ),
    );
    expect(await attemptDelivery(deps(blocked.post), id, { finalAttempt: false })).toBe("failed");
    expect((await row(id)).lastError).toBe("The address points at a private network.");
  });

  it("during a rotation, both secrets sign; after the overlap only the new one", async () => {
    const { id, secret: old } = await queued();
    const fresh = newWebhookSecret();
    const { endpointId } = (
      await db.select({ endpointId: webhookDeliveries.endpointId }).from(webhookDeliveries)
    )[0]!;
    await db
      .update(webhookEndpoints)
      .set({
        secretEncrypted: sealSecret(fresh, endpointId, SECRET),
        previousSecretEncrypted: sealSecret(old, endpointId, SECRET),
        previousSecretExpiresAt: new Date(NOW.getTime() + 86_400_000),
      })
      .where(eq(webhookEndpoints.id, endpointId));
    const during = receiver(async () => ({ status: 500, body: "", ms: 1 }));
    await attemptDelivery(deps(during.post), id, { finalAttempt: false });
    expect(during.sent[0]!.headers["webhook-signature"]!.split(" ")).toHaveLength(2);

    const after = receiver();
    await attemptDelivery(deps(after.post, new Date(NOW.getTime() + 2 * 86_400_000)), id, {
      finalAttempt: false,
    });
    expect(after.sent[0]!.headers["webhook-signature"]!.split(" ")).toHaveLength(1);
  });

  it("a deleted endpoint's delivery is gone; a delivered one isn't sent twice", async () => {
    const { id } = await queued();
    const { sent, post } = receiver();
    await attemptDelivery(deps(post), id, { finalAttempt: false });
    expect(await attemptDelivery(deps(post), id, { finalAttempt: false })).toBe("delivered");
    expect(sent).toHaveLength(1);
    await db.delete(webhookEndpoints);
    expect(await attemptDelivery(deps(post), id, { finalAttempt: false })).toBe("gone");
  });

  it("a test ping is signed and sent the same way", async () => {
    const { secret } = await endpoint(["booking.created"]);
    const endpointId = (await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints))[0]!.id;
    const id = await queuePing(db, endpointId, NOW);
    const { sent, post } = receiver();
    expect(await attemptDelivery(deps(post), id, { finalAttempt: true })).toBe("delivered");
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ type: "ping" });
    expect(verify(secret, sent[0]!.headers, sent[0]!.body, Math.floor(NOW.getTime() / 1000))).toBe(true);
  });
});

describe("clean-up (Day 26)", () => {
  it(`deletes deliveries older than ${KEEP_DAYS} days, and only those`, async () => {
    await endpoint(["booking.created"]);
    const endpointId = (await db.select({ id: webhookEndpoints.id }).from(webhookEndpoints))[0]!.id;
    const old = await queuePing(db, endpointId, NOW);
    const recent = await queuePing(db, endpointId, NOW);
    await db
      .update(webhookDeliveries)
      .set({ createdAt: new Date(NOW.getTime() - (KEEP_DAYS + 1) * 86_400_000) })
      .where(eq(webhookDeliveries.id, old));
    expect(await deleteOldDeliveries(db, NOW)).toBe(1);
    expect((await db.select({ id: webhookDeliveries.id }).from(webhookDeliveries)).map((r) => r.id)).toEqual([
      recent,
    ]);
  });
});
