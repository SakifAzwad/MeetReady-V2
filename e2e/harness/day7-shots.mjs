import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3000", out = "/home/claude/e2e/shots";
const errors = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function page({ tz = "Europe/London", viewport = { width: 1280, height: 900 }, dark = false, host = false } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: tz, locale: "en-US", colorScheme: dark ? "dark" : "light" });
  if (host) await ctx.addCookies([{ name: "better-auth.session_token", value: readFileSync("/tmp/session-cookie.txt", "utf8"), url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${e}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  return p;
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const only = process.argv[2];
const run = async (name, fn) => { if (only && !name.startsWith(only)) return; await fn(); };

await run("s1-landing", async () => {
  const p = await page(); await p.goto(BASE); await p.getByText(/ now$/).first().waitFor(); await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/s1-landing.png`, fullPage: true }); console.log("s1 overflow", await overflow(p));
});
await run("s2-landing-mobile", async () => {
  const p = await page({ tz: "Asia/Kolkata", viewport: { width: 390, height: 844 } }); await p.goto(BASE); await p.getByText(/ now$/).first().waitFor(); await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/s2-landing-mobile.png`, fullPage: true }); console.log("s2 overflow", await overflow(p));
  await p.getByRole("button", { name: "Open menu" }).click(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/s3-mobile-menu.png` });
  await p.keyboard.press("Escape"); console.log("menu closes on Escape:", await p.getByRole("button", { name: "Open menu" }).isVisible());
});
await run("s4-preview", async () => {
  const p = await page({ tz: "America/New_York" }); await p.goto(BASE + "/#guests"); 
  const group = p.getByRole("group", { name: /^Sample times/ }); await group.waitFor();
  await group.locator("button[aria-pressed]:visible").nth(1).click(); await p.waitForTimeout(250);
  await p.locator("#guests").screenshot({ path: `${out}/s4-preview-selected.png` });
  await p.getByRole("button", { name: "Continue" }).click(); await p.getByText(/it is\.$/).waitFor(); await p.waitForTimeout(600);
  await p.locator("#guests").screenshot({ path: `${out}/s4b-preview-picked.png` });
});
await run("s5-login", async () => {
  const p = await page(); await p.goto(BASE); await p.getByRole("link", { name: "Log in" }).first().click();
  await p.getByRole("button", { name: "Continue with Google" }).waitFor(); await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/s5-login.png` }); console.log("s5 overflow", await overflow(p));
});
await run("s6-404", async () => {
  const p = await page(); await p.goto(BASE + "/x/y/z"); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/s6-404.png` });
});
await run("s7-dashboard", async () => {
  const p = await page({ tz: "Asia/Dhaka", host: true }); await p.goto(BASE + "/dashboard"); await p.getByText("Your booking page").waitFor();
  await p.getByRole("button", { name: /Account menu/ }).click(); await p.getByRole("menuitem", { name: "Sign out" }).waitFor(); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/s7-dashboard-menu.png` });
  await p.keyboard.press("Escape");
  await p.getByRole("link", { name: "Bookings", exact: true }).click(); await p.getByRole("heading", { name: "Bookings" }).waitFor();
  await p.getByRole("link", { name: "Cancelled" }).click(); await p.waitForURL(/view=cancelled/); await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/s8-bookings.png` });
  const m = await page({ tz: "Asia/Dhaka", host: true, viewport: { width: 360, height: 780 } }); await m.goto(BASE + "/dashboard"); await m.getByText("Your booking page").waitFor(); await m.waitForTimeout(400);
  await m.screenshot({ path: `${out}/s9-dashboard-mobile.png` }); console.log("s9 overflow", await overflow(m));
});
await run("s10-booking", async () => {
  const p = await page(); await p.goto(BASE + "/sakif/intro"); await p.getByRole("group", { name: /^Times on/ }).waitFor(); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/s10-booking.png`, fullPage: true });
  await p.goto(BASE + "/sakif"); await p.waitForTimeout(800); await p.screenshot({ path: `${out}/s11-profile.png`, fullPage: true });
});
await run("s12-dark", async () => {
  const p = await page({ dark: true }); await p.goto(BASE); await p.getByText(/ now$/).first().waitFor(); await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/s12-landing-dark.png`, fullPage: true });
});
console.log("errors:", errors.length ? errors : "none");
await browser.close();
