import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import type { Database } from "@/db/types";
import {
  account,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
  session,
  user,
  verification,
} from "@/db/schema";
import { CONSENT_PATH, MCP_SCOPES, mcpUrl, OAUTH_SCOPES, REFRESH_SCOPE } from "@/lib/mcp";

/** The MCP authorization server's settings that differ between deployments (Day 21). */
export type McpAuthSettings = {
  /**
   * Dynamic Client Registration: off. Assistants identify themselves with a
   * Client ID Metadata Document instead (CIMD, the MCP spec's preferred way).
   * The switch exists for a client that can't do CIMD: then anyone may
   * register a client, so those get the read scope only.
   */
  allowDynamicClientRegistration?: boolean;
};

/*
 * Built by a factory instead of a module-level singleton so tests can create
 * an auth instance on an in-memory Postgres (PGlite) without real env vars.
 * Production calls this once in ./index.ts with the Neon db and real secrets.
 */
export function createAuth(
  db: Database,
  options: Pick<BetterAuthOptions, "baseURL" | "secret" | "socialProviders" | "emailAndPassword"> & {
    baseURL: string;
    mcp?: McpAuthSettings;
  },
) {
  const { mcp: mcpSettings = {}, ...authOptions } = options;
  const readOnlyRegistration = [MCP_SCOPES.read, REFRESH_SCOPE];
  return betterAuth({
    appName: "MeetReady",
    ...authOptions,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user,
        session,
        account,
        verification,
        // Day 21: the OAuth server for AI assistants (MCP).
        jwks,
        oauthClient,
        oauthAccessToken,
        oauthRefreshToken,
        oauthConsent,
        oauthClientAssertion,
        oauthResource,
        oauthClientResource,
      },
    }),
    // The JWT plugin's own /token hands out a JWT for the browser session, signed with the same key as
    // assistants' access tokens. Nothing here needs it, and it shouldn't exist next to real access tokens.
    disabledPaths: ["/token"],
    account: {
      // Google access/refresh tokens are stored in the account table. Plain text
      // by default: anyone with a DB backup could act as the user on Google.
      // Encrypted with BETTER_AUTH_SECRET instead (XChaCha20-Poly1305).
      encryptOAuthTokens: true,
    },
    user: {
      additionalFields: {
        // `input: false`: these can't be set through Better Auth's own sign-up /
        // update-user endpoints. Only our onboarding action writes them, after
        // our own validation (format, reserved names, real timezone).
        username: { type: "string", required: false, input: false },
        // required + default: always present (matches the NOT NULL column), filled with "UTC" at sign-up.
        timeZone: { type: "string", required: true, defaultValue: "UTC", input: false },
      },
    },
    // No cookie cache: every getSession() reads the session row from Postgres.
    // Costs one indexed query per request, but a revoked session or a changed
    // username takes effect immediately instead of after the cache expires.
    plugins: [
      // Signs access tokens (JWTs) and publishes the public keys at /api/auth/jwks, so the MCP route checks
      // a token without a database lookup. No JWT header on normal sign-in responses.
      jwt({ disableSettingJwtHeader: true }),
      // Day 21: MeetReady as an OAuth 2.1 server for AI assistants, and /api/mcp as the resource its tokens
      // are bound to (audience). The host signs in with Google as usual, then approves on our consent page.
      mcp({
        loginPage: "/login",
        consentPage: CONSENT_PATH,
        resource: mcpUrl(authOptions.baseURL),
        scopes: [...OAUTH_SCOPES],
        // Only the browser flow and refreshing: no client_credentials (no machine acting as nobody).
        grantTypes: ["authorization_code", "refresh_token"],
        // A rotated refresh token is dead at once. The plugin's default (30 s of reuse) lets a stolen one be
        // replayed in that window; the cost of 0 is that a client that lost a refresh response must reconnect.
        refreshTokenReuseInterval: 0,
        ...(mcpSettings.allowDynamicClientRegistration
          ? {
              allowDynamicClientRegistration: true,
              allowUnauthenticatedClientRegistration: true,
              clientRegistrationDefaultScopes: readOnlyRegistration,
              clientRegistrationAllowedScopes: readOnlyRegistration,
            }
          : {}),
      }),
      // Client ID Metadata Documents: the assistant's client_id is a URL on its own domain, and Better Auth
      // fetches the client's name and redirect URLs from there (public addresses only, no redirects).
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      nextCookies(), // lets Server Actions set auth cookies; must be last
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth["$Infer"]["Session"]["user"];
