import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { oauthClient, oauthConsent, oauthRefreshToken, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { createTestDb } from "@/test/db";
import {
  clientIdentity,
  disconnectAssistant,
  getConsentClient,
  hasConsent,
  listConnectedAssistants,
} from "./clients";

/*
 * Day 21: connected assistants. The rows are what Better Auth writes after a
 * consent (oauth_client, oauth_consent, oauth_refresh_token); here they're
 * inserted directly, so these tests are about OUR reads and the disconnect.
 */

const CLAUDE = "https://claude.ai/oauth/mcp-client-metadata";
const NOW = new Date("2026-11-19T10:00:00Z");
let db: Database;

beforeEach(async () => {
  db = await createTestDb();
  for (const id of ["host", "other"]) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.com`, username: id, timeZone: "UTC" });
  }
  await db.insert(oauthClient).values([
    { id: "c1", clientId: CLAUDE, name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] },
    { id: "c2", clientId: "dcr-abc123", name: "Totally Claude", redirectUris: ["http://localhost/cb"] },
  ]);
  const consent = (id: string, userId: string, clientId: string) => ({
    id,
    clientId,
    userId,
    scopes: ["bookings:read", "bookings:write", "offline_access"],
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(oauthConsent).values([consent("k1", "host", CLAUDE), consent("k2", "other", CLAUDE)]);
  const refresh = (id: string, userId: string) => ({
    id,
    token: `hash-${id}`,
    clientId: CLAUDE,
    userId,
    scopes: ["bookings:read"],
    expiresAt: new Date("2026-12-19T10:00:00Z"),
    createdAt: NOW,
  });
  await db.insert(oauthRefreshToken).values([refresh("r1", "host"), refresh("r2", "other")]);
}, 30_000);

describe("clientIdentity", () => {
  it("vouches for a CIMD client's domain, not its name", () => {
    expect(clientIdentity({ clientId: CLAUDE, name: "Claude" })).toEqual({
      name: "Claude",
      verifiedHost: "claude.ai",
    });
  });

  it("vouches for nothing about a self-registered client", () => {
    expect(clientIdentity({ clientId: "dcr-abc123", name: "Totally Claude" })).toEqual({
      name: "Totally Claude",
      verifiedHost: null,
    });
    expect(clientIdentity({ clientId: "dcr-abc123", name: null }).name).toBe("An unnamed app");
  });

  it("doesn't count a plain-http client id as verified", () => {
    expect(clientIdentity({ clientId: "http://evil.example/meta", name: "X" }).verifiedHost).toBeNull();
  });
});

describe("connected assistants", () => {
  it("shows the consent page who's asking, and nothing for an unknown or disabled client", async () => {
    expect(await getConsentClient(db, CLAUDE)).toEqual({ name: "Claude", verifiedHost: "claude.ai" });
    expect(await getConsentClient(db, "nope")).toBeNull();
    await db.update(oauthClient).set({ disabled: true }).where(eq(oauthClient.clientId, CLAUDE));
    expect(await getConsentClient(db, CLAUDE)).toBeNull();
  });

  it("lists only the host's own connections", async () => {
    expect(await listConnectedAssistants(db, "host")).toEqual([
      {
        clientId: CLAUDE,
        name: "Claude",
        verifiedHost: "claude.ai",
        scopes: ["bookings:read", "bookings:write", "offline_access"],
        connectedAt: NOW,
      },
    ]);
  });

  it("disconnect removes the consent and revokes refresh tokens, for this host only", async () => {
    expect(await disconnectAssistant(db, "host", CLAUDE, NOW)).toEqual({ ok: true });

    expect(await hasConsent(db, "host", CLAUDE)).toBe(false);
    expect(await listConnectedAssistants(db, "host")).toEqual([]);
    const tokens = await db.select().from(oauthRefreshToken);
    expect(tokens.find((t) => t.id === "r1")?.revoked).toEqual(NOW);
    // The other host's connection to the same assistant is untouched.
    expect(await hasConsent(db, "other", CLAUDE)).toBe(true);
    expect(tokens.find((t) => t.id === "r2")?.revoked).toBeNull();
  });

  it("can't disconnect another host's assistant, or one that isn't connected", async () => {
    await disconnectAssistant(db, "host", CLAUDE, NOW);
    expect(await disconnectAssistant(db, "host", CLAUDE, NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await disconnectAssistant(db, "host", "dcr-abc123", NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await hasConsent(db, "other", CLAUDE)).toBe(true);
  });
});
