import { chromium } from "playwright-core";
const BASE = "http://localhost:3000";
const out = "/home/claude/e2e/shots";
const errors = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function shot(name, { tz = "Europe/London", viewport = { width: 1280, height: 900 }, dark = false, full = false, act } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: tz, locale: "en-US", colorScheme: dark ? "dark" : "light" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(`${name}: ${m.text()}`));
  await p.goto(`${BASE}/sakif/intro`);
  await p.getByRole("group", { name: /^Times on/ }).waitFor();
  if (act) await act(p);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const sentence = await p.locator("#band-heading").locator("xpath=../..").locator("p").last().innerText().catch(() => "");
  console.log(`${name}: overflow ${overflow}px | ${sentence}`);
  await ctx.close();
}
await shot("d1-london", { act: (p) => p.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").nth(1).click() });
await shot("d2-newyork", { tz: "America/New_York" });
await shot("d3-dhaka-same-zone", { tz: "Asia/Dhaka" });
await shot("d4-24h", { act: async (p) => { await p.getByRole("radio", { name: "24h" }).click(); } });
await shot("d5-dark", { dark: true, act: (p) => p.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").nth(1).click() });
await shot("d6-mobile", { tz: "Asia/Kolkata", viewport: { width: 390, height: 844 }, full: true });
await shot("d7-details", { act: async (p) => { await p.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").first().click(); await p.getByRole("button", { name: "Continue" }).click(); await p.getByRole("heading", { name: "Your details" }).waitFor(); } });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
