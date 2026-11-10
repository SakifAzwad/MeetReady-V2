import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3000", out = "/home/claude/e2e/shots";
const errors = [];
const step = (s) => console.log("•", s);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function page({ tz = "Europe/London", viewport = { width: 1280, height: 900 }, host = false } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: tz, locale: "en-US" });
  if (host) await ctx.addCookies([{ name: "better-auth.session_token", value: readFileSync("/tmp/session-cookie.txt", "utf8"), url: BASE }]);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  return p;
}
const times = (p) => p.getByRole("group", { name: /^Times on/ });

// 1. Form in place (desktop)
let p = await page();
await p.goto(`${BASE}/sakif/intro`); await times(p).waitFor();
const daytime = await p.locator("#band-heading").locator("xpath=../..").locator("p").last().innerText();
step(`London daytime note: ${daytime}`);
await times(p).locator("button[aria-pressed]:visible").first().click(); await p.getByRole("button", { name: "Continue" }).click();
await p.getByLabel("Name").waitFor(); await p.waitForTimeout(600);
step(`desktop details: calendar visible ${await p.getByRole("table").isVisible()}, band visible ${await p.locator("#band-heading").isVisible()}`);
await p.screenshot({ path: `${out}/e1-form-in-place.png` });
await p.getByRole("table").locator("button:not([disabled])").nth(1).click();
await times(p).waitFor();
step(`clicking another day goes back to its times: ${await times(p).isVisible()}`);

// 2. Phone keeps the separate step
p = await page({ tz: "Asia/Kolkata", viewport: { width: 390, height: 844 } });
await p.goto(`${BASE}/sakif/intro`); await times(p).waitFor();
await times(p).locator("button[aria-pressed]:visible").first().click(); await p.getByRole("button", { name: "Continue" }).click();
await p.getByLabel("Name").waitFor(); await p.waitForTimeout(500);
step(`phone details: calendar hidden ${!(await p.getByRole("table").isVisible())}, overflow ${await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)}px`);
await p.screenshot({ path: `${out}/e2-form-phone.png` });

// 3. New York: nothing in daytime
p = await page({ tz: "America/New_York" });
await p.goto(`${BASE}/sakif/intro`); await times(p).waitFor();
step(`New York daytime note: ${await p.locator("#band-heading").locator("xpath=../..").locator("p").last().innerText()}`);
await p.screenshot({ path: `${out}/e3-newyork-band.png`, clip: { x: 0, y: 0, width: 1280, height: 420 } });

// 4. Combobox keyboard
const box = p.getByRole("combobox", { name: "Times shown in" });
await box.click(); await box.fill("india");
const first = await p.getByRole("option").first().innerText();
step(`"india" -> first option: ${first.replace(/\n+/g, " | ")}; expanded=${await box.getAttribute("aria-expanded")}`);
await p.getByRole("listbox").screenshot({ path: `${out}/e4-combobox.png` });
await box.press("Escape");
step(`Escape keeps the old value: "${await box.inputValue()}"`);
await box.click(); await box.fill("gmt+9"); await box.press("ArrowDown"); await box.press("Enter");
step(`"gmt+9", ArrowDown, Enter -> "${await box.inputValue()}"`);

// 5. Hero search
p = await page();
await p.goto(BASE); await p.getByText(/ now$/).first().waitFor();
const hero = p.getByRole("combobox", { name: "Or search any city" });
await hero.click(); await hero.fill("tokyo"); await hero.press("Enter"); await p.waitForTimeout(900);
step(`hero after "tokyo": ${await p.getByText(/^Sakif works/).first().innerText()}`);
await p.screenshot({ path: `${out}/e5-hero-search.png`, clip: { x: 0, y: 380, width: 1280, height: 420 } });

// 6. Dashboard week navigation + load
p = await page({ tz: "Asia/Dhaka", host: true });
await p.goto(`${BASE}/dashboard`); await p.getByText("Your booking page").waitFor();
step(`week summary: ${await p.locator("#week-heading").locator("xpath=..").locator("p").innerText()}`);
await p.locator("#week-heading").locator("xpath=../..").screenshot({ path: `${out}/e6-week.png` });
await p.getByRole("link", { name: "Next 7 days" }).click(); await p.waitForURL(/week=1/); await p.waitForTimeout(500);
step(`next week heading: ${await p.locator("#week-heading").innerText()}`);
await p.getByRole("link", { name: "Back to today" }).click(); await p.getByRole("heading", { name: "Your next 7 days" }).waitFor();
await p.goto(`${BASE}/dashboard?week=999`); await p.getByRole("heading", { name: "Your next 7 days" }).waitFor();
step("?week=999 falls back to this week");

// 7. Share times by text
const their = p.getByRole("combobox", { name: "Their timezone" });
await their.click(); await their.fill("london"); await their.press("Enter");
await p.getByRole("button", { name: "Suggest 3 times" }).click();
const text = await p.getByLabel("Message to paste").inputValue();
console.log(text.split("\n").map((l) => "    " + l).join("\n"));
await p.getByRole("button", { name: "Copy message" }).click();
step(`clipboard matches: ${(await p.evaluate(() => navigator.clipboard.readText())) === text}`);
await p.locator("#share-heading").locator("xpath=../..").screenshot({ path: `${out}/e7-share.png` });

console.log("errors:", errors.length ? errors : "none");
await browser.close();
