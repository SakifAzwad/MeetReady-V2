import { chromium } from "playwright-core";
import pg from "pg";

const BASE = "http://localhost:3000";
// The timezone picker is a combobox (Day 8): type, then Enter picks the top match.
async function pickZone(page, label, query) {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill(query);
  await page.getByRole("option").first().waitFor();
  await box.press("Enter");
}
const out = "/home/claude/e2e/shots";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const errors = [];
const step = (s) => console.log("•", s);
async function guestPage(timezoneId = "Europe/London", viewport = { width: 1100, height: 900 }) {
  const ctx = await browser.newContext({ viewport, timezoneId, locale: "en-US" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  return page;
}
const times = async (page) => (await page.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").allTextContents());

// 1. Profile -> event type
const page = await guestPage();
await page.goto(`${BASE}/sakif`);
await page.getByRole("link", { name: /Intro call/ }).click();
await page.waitForURL(`${BASE}/sakif/intro`);
await page.getByRole("group", { name: /^Times on/ }).waitFor();
const firstDay = await page.getByRole("button", { pressed: true }).getAttribute("aria-label");
const londonTimes = await times(page);
step(`guest in London: first day "${firstDay}", first times ${londonTimes.slice(0, 3).join(", ")} … (${londonTimes.length} slots)`);
await page.screenshot({ path: `${out}/b1-booking-london.png` });

// 2. Same slots, viewed in Dhaka time
await pickZone(page, "Times shown in", "dhaka");
await page.getByRole("group", { name: /^Times on/ }).waitFor();
const dhakaTimes = await times(page);
step(`switched to Asia/Dhaka: first times ${dhakaTimes.slice(0, 3).join(", ")}`);
await pickZone(page, "Times shown in", "london");
await page.getByRole("group", { name: /^Times on/ }).waitFor();

// 3. Book the first slot
await page.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").first().click();
await page.getByRole("button", { name: "Continue" }).click();
await page.getByRole("button", { name: "Confirm booking" }).click();
await page.getByText("Enter your name").waitFor();
step("empty form rejected");
await page.getByLabel("Name").fill("Ada Lovelace");
await page.getByLabel("Email").fill("ada@example.com");
await page.getByLabel(/Anything to share/).fill("Looking forward to it.");
await page.getByRole("button", { name: "Confirm booking" }).click();
await page.getByRole("heading", { name: /^You're booked/ }).waitFor();
const confirmation = (await page.getByRole("status").innerText()).replace(/\n+/g, " | ");
step(`confirmation: ${confirmation}`);
await page.screenshot({ path: `${out}/b2-confirmed.png` });

// 4. The booked slot is gone for the next guest
const next = await guestPage();
await next.goto(`${BASE}/sakif/intro`);
await next.getByRole("group", { name: /^Times on/ }).waitFor();
const after = await times(next);
step(`next guest's first times: ${after.slice(0, 3).join(", ")} (booked ${londonTimes[0]} gone: ${!after.includes(londonTimes[0])})`);

// 5. Race: two guests, same slot, submit together
const [a, b] = [await guestPage(), await guestPage()];
for (const p of [a, b]) {
  await p.goto(`${BASE}/sakif/intro`);
  await p.getByRole("group", { name: /^Times on/ }).waitFor();
  await p.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").first().click();
  await p.getByRole("button", { name: "Continue" }).click();
  await p.getByLabel("Name").fill(p === a ? "Guest A" : "Guest B");
  await p.getByLabel("Email").fill(p === a ? "a@example.com" : "b@example.com");
}
const raceSlot = await a.locator("form").getByText(/\d (AM|PM)/).first().innerText();
await Promise.all([a, b].map((p) => p.getByRole("button", { name: "Confirm booking" }).click()));
const outcome = async (p) =>
  (await Promise.race([
    p.getByText("You're booked").waitFor().then(() => "booked"),
    p.getByText("someone just booked that time").waitFor().then(() => "told it was taken"),
  ]));
step(`race for "${raceSlot}": A ${await outcome(a)}, B ${await outcome(b)}`);
await (await outcome(a) === "booked" ? b : a).screenshot({ path: `${out}/b3-race-loser.png` });

const db = new pg.Client("postgresql://postgres@127.0.0.1:5432/meetready_e2e"); await db.connect();
const rows = (await db.query("select guest_name, guest_time_zone, starts_at from bookings order by starts_at")).rows;
step(`bookings in DB: ${rows.map((r) => `${r.guest_name} @ ${r.starts_at.toISOString()}`).join("; ")}`);

// 6. Switched-off event type and unknown host -> not found
await db.query("update event_types set is_active = false");
const hidden = await guestPage();
await hidden.goto(`${BASE}/sakif/intro`);
await hidden.getByText(/could not be found/i).waitFor();
await hidden.goto(`${BASE}/sakif`);
const profileNow = await hidden.getByText("No meetings available to book right now.").waitFor().then(() => true);
await hidden.goto(`${BASE}/nobody-here`);
await hidden.getByText(/could not be found/i).waitFor();
step(`switched off -> 404; profile shows none: ${profileNow}; unknown user -> 404`);
await db.query("update event_types set is_active = true");

// 7. API input checks
const bad = await fetch(`${BASE}/api/slots?username=sakif&slug=intro&from=2026-11-01T00:00:00Z&to=2028-01-01T00:00:00Z`);
const missing = await fetch(`${BASE}/api/slots?username=sakif&slug=nope&from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z`);
step(`API: 2-year range -> ${bad.status}; unknown event -> ${missing.status}`);

// 8. Mobile
const mobile = await guestPage("Asia/Dhaka", { width: 390, height: 844 });
await mobile.goto(`${BASE}/sakif/intro`);
await mobile.getByRole("group", { name: /^Times on/ }).waitFor();
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await mobile.screenshot({ path: `${out}/b4-mobile.png`, fullPage: true });
step(`mobile overflow: ${overflow}px`);

await db.end();
console.log("console/page errors:", errors.length ? errors : "none");
await browser.close();
