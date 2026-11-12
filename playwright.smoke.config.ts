import { defineConfig, devices } from "@playwright/test";

/*
 * Smoke tests: a few READ-ONLY checks against a live deployment, run by
 * .github/workflows/smoke.yml after Vercel reports a successful production
 * deploy. They catch what the full suite can't: a missing env var, a failed
 * migration, wrong headers on the real domain. They never write data, so
 * they're safe against production.
 *
 *   SMOKE_URL=https://meetreadyv2.vercel.app npx playwright test --config playwright.smoke.config.ts
 */
const baseURL = process.env.SMOKE_URL;
if (!baseURL)
  throw new Error("Set SMOKE_URL to the deployment to check, e.g. https://meetreadyv2.vercel.app");

export default defineConfig({
  testDir: "./e2e/smoke",
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  // A cold serverless function and a sleeping Neon compute can take a few seconds to wake.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL, locale: "en-US", timezoneId: "Asia/Dhaka", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL || undefined },
    },
  ],
});
