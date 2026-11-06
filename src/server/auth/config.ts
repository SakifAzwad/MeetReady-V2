import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import type { Database } from "@/db/types";
import { account, session, user, verification } from "@/db/schema";

/*
 * Built by a factory instead of a module-level singleton so tests can create
 * an auth instance on an in-memory Postgres (PGlite) without real env vars.
 * Production calls this once in ./index.ts with the Neon db and real secrets.
 */
export function createAuth(
  db: Database,
  options: Pick<BetterAuthOptions, "baseURL" | "secret" | "socialProviders" | "emailAndPassword">,
) {
  return betterAuth({
    appName: "MeetReady",
    ...options,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
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
    plugins: [nextCookies()], // lets Server Actions set auth cookies; must be last
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth["$Infer"]["Session"]["user"];
