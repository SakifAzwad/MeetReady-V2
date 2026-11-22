import { expect, test } from "./fixtures";

/*
 * Day 26, Part B: the theme switcher. What matters, in order:
 *  1. A saved choice is on the very first paint. Proved with React's code
 *     blocked: only the inline head script can have applied it.
 *  2. "System" follows the device, and an explicit choice beats the device.
 *  3. The choice is the browser's, shared by every page: set it in the
 *     dashboard's menu, see it on the public booking page, change it there.
 */

const LIGHT_BG = "rgb(245, 247, 251)"; // --background, light (#f5f7fb)
const DARK_BG = "rgb(15, 20, 36)"; // --background, dark (#0f1424)

const background = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("the footer's choice is saved and beats the device; System hands it back", async ({ newGuest }) => {
  const page = await newGuest({ colorScheme: "light" });
  await page.goto("/");
  const theme = page.getByRole("group", { name: "Theme" });
  await expect(theme.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
  expect(await background(page)).toBe(LIGHT_BG);

  await theme.getByRole("button", { name: "Dark" }).click();
  await expect(theme.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(DARK_BG);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#0f1424");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(DARK_BG);

  // Light beats a dark device; System hands it back.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await theme.getByRole("button", { name: "Light" }).click();
  expect(await background(page)).toBe(LIGHT_BG);
  await theme.getByRole("button", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await background(page)).toBe(DARK_BG);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBeNull(); // System = nothing saved
});

test("a saved choice is applied by the head script alone, before any React code", async ({ browser }) => {
  // Its own context: blocked scripts log console errors on purpose here.
  const context = await browser.newContext({ colorScheme: "light" });
  await context.addInitScript(() => localStorage.setItem("theme", "dark")); // as if chosen on an earlier visit
  const page = await context.newPage();
  // Every Next.js script file blocked: no React, no hydration, no switcher code.
  await page.route(/\/_next\/static\/.*\.js$/, (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).toBe(DARK_BG);
  await context.close();
});

test("a host picks Dark in the account menu; the booking page follows and can change it", async ({
  host,
  hostPage,
}) => {
  await hostPage.emulateMedia({ colorScheme: "light" });
  await hostPage.goto("/dashboard");
  await hostPage.getByRole("button", { name: /^Account menu for/ }).click();
  await hostPage.getByRole("menuitemradio", { name: "Dark" }).click();
  // The menu stays open, with Dark marked.
  await expect(hostPage.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  expect(await background(hostPage)).toBe(DARK_BG);
  await hostPage.keyboard.press("Escape");

  // Same browser, public page: already dark, and its own button says so.
  await hostPage.goto(`/${host.username}/intro`);
  expect(await background(hostPage)).toBe(DARK_BG);
  // The card streams in above the button: wait for it, or the button moves after the click.
  await expect(hostPage.getByRole("heading", { name: "Intro call" })).toBeVisible();
  await hostPage.getByRole("button", { name: "Theme: Dark" }).click();
  await hostPage.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(hostPage.getByRole("button", { name: "Theme: Light" })).toBeVisible();
  expect(await background(hostPage)).toBe(LIGHT_BG);
});
