import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3000", out = "/home/claude/e2e/shots";
const errors = [];
const step = (s) => console.log("•", s);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function page({ tz = "Europe/London", locale = "en-US", viewport = { width: 1280, height: 900 }, host = false } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: tz, locale });
  if (host) await ctx.addCookies([{ name: "better-auth.session_token", value: readFileSync("/tmp/session-cookie.txt", "utf8"), url: BASE }]);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  return p;
}
const times = (p) => p.getByRole("group", { name: /^Times on/ });
// Not "today": by mid-morning in London today's early times have passed and there's nothing to fold.
const nextDay = async (p) => {
  await times(p).waitFor();
  await p.getByRole("table").locator("button:not([disabled])").nth(1).click();
  await times(p).waitFor();
};
const firstTime = async (p) => (await times(p).locator('button[aria-pressed]').first().innerText()).split("\n")[0];

// 1. Night times folded, daytime first
let p = await page();
await p.goto(`${BASE}/sakif/intro`); await nextDay(p);
const fold = times(p).getByRole("button", { name: /earlier time/ });
step(`London: fold says "${await fold.innerText()}", expanded=${await fold.getAttribute("aria-expanded")}; first visible time ${await times(p).locator('button[aria-pressed]:visible').first().innerText().then((t) => t.split("\n")[0])}`);
await p.locator("#band-heading").locator("xpath=../..").screenshot({ path: `${out}/n1-booking-band.png` });
await fold.click();
step(`after opening: expanded=${await fold.getAttribute("aria-expanded")}, first time ${await times(p).locator('button[aria-pressed]:visible').first().innerText().then((t) => t.split("\n")[0])}`);

// 2. Focus: Continue -> Name (desktop); Back -> the chosen time
await times(p).locator('button[aria-pressed]:visible').nth(2).click();
await p.getByRole("button", { name: "Continue" }).click(); await p.getByLabel("Name").waitFor(); await p.waitForTimeout(500);
step(`focus after Continue: ${await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`);
await p.keyboard.type("Ada Lovelace");
await p.getByRole("button", { name: /Other times/ }).click(); await times(p).waitFor(); await p.waitForTimeout(500);
step(`focus after Back: pressed=${await p.evaluate(() => document.activeElement?.getAttribute("aria-pressed"))}`);
await p.getByRole("button", { name: "Continue" }).click(); await p.getByLabel("Name").waitFor();
step(`typed name kept after Back: "${await p.getByLabel("Name").inputValue()}"`);

// 3. Slot taken while typing: details kept
await p.getByLabel("Email").fill("ada@example.com");
const chosen = await p.getByRole("heading", { name: "Your details" }).locator("xpath=..").locator("p").innerText();
const rival = await page();
await rival.goto(`${BASE}/sakif/intro`); await nextDay(rival);
await times(rival).getByRole("button", { name: /earlier time/ }).click();
await times(rival).locator('button[aria-pressed]:visible').nth(2).click();
await rival.getByRole("button", { name: "Continue" }).click();
await rival.getByLabel("Name").fill("Rival"); await rival.getByLabel("Email").fill("rival@example.com");
await rival.getByRole("button", { name: "Confirm booking" }).click(); await rival.getByRole("heading", { name: /^You're booked/ }).waitFor();
await p.getByRole("button", { name: "Confirm booking" }).click();
await p.getByText(/your details are kept/).waitFor();
await times(p).locator('button[aria-pressed]:visible').first().click();
await p.getByRole("button", { name: "Continue" }).click(); await p.getByLabel("Name").waitFor();
step(`slot taken (${chosen.split(",").slice(-1)[0].trim()}): name "${await p.getByLabel("Name").inputValue()}", email "${await p.getByLabel("Email").inputValue()}"`);

// 4. Phone: focus goes to the heading, not the input
p = await page({ viewport: { width: 390, height: 844 } });
await p.goto(`${BASE}/sakif/intro`); await times(p).waitFor();
await times(p).locator('button[aria-pressed]:visible').first().click(); await p.getByRole("button", { name: "Continue" }).click();
await p.getByLabel("Name").waitFor(); await p.waitForTimeout(400);
step(`phone focus after Continue: ${await p.evaluate(() => document.activeElement?.textContent)}`);

// 5. 24-hour default from the browser locale; the toggle beside the date
for (const locale of ["en-GB", "de-DE", "en-US"]) {
  p = await page({ locale });
  await p.goto(`${BASE}/sakif/intro`); await times(p).waitFor(); await p.waitForTimeout(300);
  step(`${locale}: first time "${await firstTime(p)}", toggle checked ${await p.getByRole("radio", { checked: true }).innerText()}`);
}
await p.getByRole("radio", { name: "24h" }).click(); await p.reload(); await times(p).waitFor(); await p.waitForTimeout(300);
step(`en-US after choosing 24h and reloading: "${await firstTime(p)}" (the choice is remembered)`);

// 6. Scrub: keyboard on the booking band, hover on the hero
p = await page();
await p.goto(`${BASE}/sakif/intro`); await times(p).waitFor();
const slider = p.getByRole("slider", { name: /Compare times/ });
await slider.focus(); await p.keyboard.press("ArrowRight");
step(`booking slider (keyboard): ${await slider.getAttribute("aria-valuetext")}`);
await p.keyboard.press("End"); await p.keyboard.press("PageDown");
step(`End then PageDown: ${await slider.getAttribute("aria-valuetext")}`);
const sun = await p.getByText(/^Sunrise/).innerText();
step(`sun line: ${sun}`);
await p.keyboard.press("Home"); for (let i = 0; i < 4 * 14; i++) await p.keyboard.press("ArrowRight");
await p.locator("#band-heading").locator("xpath=../..").screenshot({ path: `${out}/n2-booking-scrub.png` });

p = await page({ tz: "America/New_York" });
await p.goto(BASE); await p.getByText(/ now$/).first().waitFor(); await p.waitForTimeout(600);
const hero = p.getByRole("slider", { name: "Compare times, Sakif and you" });
const box = await hero.boundingBox();
await p.mouse.move(box.x + box.width * (14 / 24), box.y + box.height / 2); await p.waitForTimeout(200);
step(`hero hover at 2 PM New York: ${await hero.getAttribute("aria-valuetext")}`);
await p.locator("section").first().screenshot({ path: `${out}/n3-hero-scrub.png` });
await p.mouse.move(10, 10); await p.waitForTimeout(150);
step(`marker hides when the mouse leaves: ${(await hero.getAttribute("aria-valuetext")) === null}`);

// 7. Hero in Tokyo vs London: real skies differ
p = await page({ tz: "Asia/Tokyo" });
await p.goto(BASE); await p.getByText(/ now$/).first().waitFor(); await p.waitForTimeout(800);
await p.locator("section").first().screenshot({ path: `${out}/n4-hero-tokyo.png` });

// 8. Dashboard: real skies on the week; copy feedback
p = await page({ tz: "Asia/Dhaka", host: true });
await p.goto(`${BASE}/dashboard`); await p.getByText("Your booking page").waitFor();
await p.getByRole("button", { name: "Copy link" }).click();
step(`copy link -> "${await p.getByRole("button", { name: /Copied/ }).innerText()}"; status: "${await p.getByRole("status").filter({ hasText: "Copied" }).first().innerText()}"`);
await p.locator("#week-heading").locator("xpath=../..").screenshot({ path: `${out}/n5-week-sky.png` });

console.log("errors:", errors.length ? errors : "none");
await browser.close();
