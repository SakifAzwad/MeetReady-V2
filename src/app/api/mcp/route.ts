import { requireMcpAuth } from "@better-auth/mcp";
import { db } from "@/db";
import { env } from "@/lib/env";
import { MCP_PATH, MCP_SCOPES, mcpUrl } from "@/lib/mcp";
import { auth } from "@/server/auth";
import { mcpEndpoint } from "@/server/mcp";
import { hasConsent } from "@/server/mcp/clients";
import { callerFromClaims, toAuthInfo } from "@/server/mcp/server";

/*
 * The MCP endpoint (Day 21): https://meetreadyv2.vercel.app/api/mcp, what a host
 * pastes into Claude as a custom connector.
 *
 * Three checks before any tool runs:
 *  1. requireMcpAuth: the bearer token's signature (our JWT keys), issuer,
 *     audience (tokens are bound to this exact URL, so one made for something
 *     else is refused), expiry, and the read scope. No token: 401 with a
 *     WWW-Authenticate header pointing at the protected-resource metadata,
 *     which is how an assistant finds out where to sign in.
 *  2. The host still allows this assistant (Disconnect on the dashboard
 *     deletes the consent; a JWT alone would stay valid for up to an hour).
 *  3. Per tool, in the MCP layer: the scope again, and the host's rate limit.
 *
 * POST only. 2025-era clients that try GET (a standing event stream) get 405,
 * which the spec allows: this server never pushes anything.
 */
const resource = mcpUrl(env.BETTER_AUTH_URL);
const resourceMetadata = new URL(`/.well-known/oauth-protected-resource${MCP_PATH}`, resource).toString();

export const POST = requireMcpAuth(
  auth,
  async (request, claims) => {
    const caller = callerFromClaims(claims);
    if (!caller || !caller.clientId || !(await hasConsent(db, caller.userId, caller.clientId))) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer error="invalid_token", error_description="This app was disconnected from MeetReady", resource_metadata="${resourceMetadata}"`,
        },
      });
    }
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    return mcpEndpoint.fetch(request, { authInfo: toAuthInfo(token, caller) });
  },
  {
    resource,
    requiredScopes: [MCP_SCOPES.read],
    // Asked for in the 401's challenge, so an assistant requests all three at once: offline_access is what
    // gets it a refresh token. Without it, the host would have to reconnect every hour.
    challengeScopes: [MCP_SCOPES.read, MCP_SCOPES.write, "offline_access"],
  },
);
