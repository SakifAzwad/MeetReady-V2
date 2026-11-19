import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/*
 * README screenshots (Day 23): the E2E setup (production build, real Postgres,
 * fake Google and Groq) with realistic demo data, saved to docs/images/.
 * Not part of `npm run test:e2e` or CI: run it when the UI changes.
 *
 *   E2E_BROWSER_CHANNEL=chrome npx playwright test --config playwright.shots.config.ts
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/shots",
  testMatch: "**/*.shots.ts",
  testIgnore: undefined,
  workers: 1,
  reporter: [["list"]],
});
