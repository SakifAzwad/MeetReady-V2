import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Dhaka", deviceScaleFactor: 1 });
await ctx.addCookies([{ name: "better-auth.session_token", value: readFileSync("/tmp/session-cookie.txt", "utf8"), url: BASE }]);
const page = await ctx.newPage();
for (const [path, name] of [["/dashboard/availability", "6-availability-mobile"], ["/dashboard/event-types/new", "7-form-mobile"]]) {
  await page.goto(BASE + path);
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(path, "horizontal overflow px:", overflow);
  await page.screenshot({ path: `/home/claude/e2e/shots/${name}.png`, fullPage: false });
}
await browser.close();
