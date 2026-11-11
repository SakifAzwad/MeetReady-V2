import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, E2E_AUTH_SECRET, E2E_DATABASE_URL, E2E_PORT } from "./e2e/support/config";

/*
 * End-to-end tests: a real browser against the PRODUCTION build and a real
 * Postgres, the way a guest and a host actually use the app.
 *
 *   npm run test:e2e                     builds, starts on :3100, runs everything
 *   E2E_SKIP_BUILD=1 npm run test:e2e    reuses the last build (when only tests changed)
 *   E2E_BROWSER_CHANNEL=chrome ...       uses your installed Chrome instead of
 *                                        Playwright's Chromium (no download)
 *
 * Needs Postgres on localhost:5432 (user/password postgres), or set E2E_DATABASE_URL.
 */

const channel = process.env.E2E_BROWSER_CHANNEL || undefined;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // Every test seeds its own host (see e2e/fixtures.ts), so tests can run in
  // parallel without seeing each other's bookings.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a test that passes on the second try is a bug (in the app or
  // the test) that's been hidden. The trace of the failure is kept instead.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // AM/PM text in assertions; and since Day 9 the 12/24h default follows the locale.
    locale: "en-US",
    // The seeded host works 9–5 in Dhaka. A guest in the same zone sees every
    // time in "daytime", so no times are folded away (Day 9) whatever the hour.
    timezoneId: "Asia/Dhaka",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel } }],
  webServer: {
    command: [
      "node e2e/support/prepare-db.mts",
      process.env.E2E_SKIP_BUILD ? null : "npm run build",
      `npx next start -p ${E2E_PORT}`,
    ]
      .filter(Boolean)
      .join(" && "),
    url: BASE_URL,
    // Never reuse a running server: it might be connected to another database.
    reuseExistingServer: false,
    timeout: 5 * 60_000, // includes `next build`
    stderr: "pipe",
    // Set here, so they win over .env.local: Next never lets a .env file
    // override a variable that's already in the environment.
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
      BETTER_AUTH_URL: BASE_URL,
      GOOGLE_CLIENT_ID: "e2e",
      GOOGLE_CLIENT_SECRET: "e2e",
      // Empty = emails go to the outbox folder, never to a real inbox, even if
      // .env.local has a Resend key.
      RESEND_API_KEY: "",
      DEMO_BOOKING_PATH: "",
    },
  },
});
