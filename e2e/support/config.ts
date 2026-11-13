import os from "node:os";
import path from "node:path";

/*
 * Shared by playwright.config.ts (to start the server) and the fixtures (to
 * seed data and sign session cookies). One place, so they can't disagree.
 */

/** Not 3000: a `npm run dev` already running there must never be reused, it talks to your dev database. */
export const E2E_PORT = 3100;
export const BASE_URL = `http://localhost:${E2E_PORT}`;

/** The fake Google Calendar the E2E server talks to (e2e/support/fake-google.mjs). */
export const FAKE_GOOGLE_PORT = 3101;
export const FAKE_GOOGLE_URL = `http://localhost:${FAKE_GOOGLE_PORT}`;

/** Wiped and re-migrated on every run (e2e/support/prepare-db.mts refuses names without "e2e"). */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/meetready_e2e";

/** Signs session cookies for the seeded hosts. Test-only: never a real secret. */
export const E2E_AUTH_SECRET = "e2e-only-secret-never-used-outside-tests-0123456789";

/** Where the app writes emails when RESEND_API_KEY is empty (src/server/email/index.ts). */
export const OUTBOX = path.join(os.tmpdir(), "meetready-emails");
