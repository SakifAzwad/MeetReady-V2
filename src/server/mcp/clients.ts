import { and, desc, eq, isNull } from "drizzle-orm";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "@/db/schema";
import type { Database } from "@/db/types";

/*
 * Connected assistants (Day 21): which AI clients a host has allowed, and
 * disconnecting one. Better Auth writes these tables; we read them for the
 * dashboard and the MCP route, always scoped to the signed-in host.
 */

/** Who the client says it is, and what we can actually vouch for. */
export type ClientIdentity = {
  name: string;
  /**
   * CIMD: the client_id is a URL on the client's own domain, so its host is
   * verified ("claude.ai"). A self-registered client (DCR) only declared its
   * name: null here, and the consent page says it's unverified.
   */
  verifiedHost: string | null;
};

export function clientIdentity(client: { clientId: string; name: string | null }): ClientIdentity {
  let verifiedHost: string | null = null;
  try {
    const url = new URL(client.clientId);
    if (url.protocol === "https:") verifiedHost = url.host;
  } catch {
    // Not a URL: a registered client id.
  }
  return { name: client.name?.trim() || verifiedHost || "An unnamed app", verifiedHost };
}

/** The client asking for consent: public facts only (no secrets, no redirect URLs). */
export async function getConsentClient(db: Database, clientId: string): Promise<ClientIdentity | null> {
  const [row] = await db
    .select({ clientId: oauthClient.clientId, name: oauthClient.name, disabled: oauthClient.disabled })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId));
  if (!row || row.disabled) return null;
  return clientIdentity(row);
}

export type ConnectedAssistant = ClientIdentity & {
  clientId: string;
  scopes: string[];
  connectedAt: Date;
};

export async function listConnectedAssistants(db: Database, userId: string): Promise<ConnectedAssistant[]> {
  const rows = await db
    .select({
      clientId: oauthConsent.clientId,
      name: oauthClient.name,
      scopes: oauthConsent.scopes,
      connectedAt: oauthConsent.createdAt,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt));
  return rows.map((r) => ({
    ...clientIdentity(r),
    clientId: r.clientId,
    scopes: r.scopes,
    connectedAt: r.connectedAt,
  }));
}

/**
 * Is this host's consent for this client still there? The MCP route asks on
 * every call. Access tokens are JWTs, checked by signature alone, so without
 * this a disconnected assistant would keep working until its token expired
 * (up to an hour). One indexed query makes Disconnect immediate.
 */
export async function hasConsent(db: Database, userId: string, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
    .limit(1);
  return !!row;
}

/**
 * Disconnect: the consent goes (so the route refuses the current access
 * token at once), and the refresh tokens are revoked (so no new one can be
 * made). Reconnecting means signing in and approving again. Scoped to the
 * host: another host's connection to the same assistant is untouched.
 */
export async function disconnectAssistant(
  db: Database,
  userId: string,
  clientId: string,
  now: Date,
): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
      .returning({ id: oauthConsent.id });
    if (removed.length === 0) return { ok: false, error: "not_found" as const };
    await tx
      .update(oauthRefreshToken)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthRefreshToken.userId, userId),
          eq(oauthRefreshToken.clientId, clientId),
          isNull(oauthRefreshToken.revoked),
        ),
      );
    // Opaque access tokens (none for MCP, which uses JWTs; here for completeness).
    await tx
      .update(oauthAccessToken)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthAccessToken.userId, userId),
          eq(oauthAccessToken.clientId, clientId),
          isNull(oauthAccessToken.revoked),
        ),
      );
    return { ok: true as const };
  });
}
