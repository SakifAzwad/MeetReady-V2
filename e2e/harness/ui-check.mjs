import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const out = "/home/claude/e2e/shots";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Dhaka" });
await ctx.addCookies([{ name: "better-auth.session_token", value: readFileSync("/tmp/session-cookie.txt", "utf8"), url: BASE }]);
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const step = (s) => console.log("•", s);

// 1. Empty state
await page.goto(`${BASE}/dashboard/event-types`);
await page.getByText("No event types yet").waitFor();
await page.screenshot({ path: `${out}/1-empty.png` });
step("empty state shown");

// 2. New event type: invalid submit first
await page.getByRole("link", { name: "New event type" }).click();
await page.getByLabel("Title").waitFor();
await page.getByRole("button", { name: "Create event type" }).click();
await page.getByText("Give it a title").waitFor();
step("empty title rejected client-side");

await page.getByLabel("Title").fill("Intro Call (30 min)");
const slug = await page.locator("#slug").inputValue();
step(`slug auto-filled: ${slug}`);
await page.getByLabel("Where").selectOption("zoom");
await page.getByLabel("Zoom link").fill("zoom.us/j/123");
await page.getByRole("button", { name: "Create event type" }).click();
await page.getByText("Paste your Zoom link").waitFor();
await page.screenshot({ path: `${out}/2-form-errors.png`, fullPage: true });
step("bad zoom link rejected");

await page.getByLabel("Zoom link").fill("https://us05web.zoom.us/j/123456789");
await page.locator("#slug").fill("intro");
await page.getByLabel("Buffer after").selectOption("15");
await page.getByLabel("Max per day").selectOption("4");
await page.getByRole("button", { name: "Create event type" }).click();
await page.waitForURL(`${BASE}/dashboard/event-types`);
await page.getByRole("heading", { name: "Intro Call (30 min)" }).waitFor();
step("created and redirected to list");

// 3. Duplicate slug -> server-side error on the slug field
await page.goto(`${BASE}/dashboard/event-types/new`);
await page.getByLabel("Title").fill("Another");
await page.locator("#slug").fill("intro");
await page.getByRole("button", { name: "Create event type" }).click();
await page.getByText("You already have an event type with this link").waitFor();
step("duplicate slug: server error shown on the field");
await page.locator("#slug").fill("deep-dive");
await page.getByLabel("Title").fill("Deep dive");
await page.getByRole("button", { name: "1 h", exact: true }).click();
await page.getByRole("button", { name: "Create event type" }).click();
await page.waitForURL(`${BASE}/dashboard/event-types`);

// 4. Toggle off
await page.getByRole("switch", { name: /Deep dive/ }).click();
await page.getByText("Off: hidden from guests").waitFor();
await page.reload();
await page.getByText("Off: hidden from guests").waitFor();
step("toggle persisted after reload");
await page.screenshot({ path: `${out}/3-list.png` });

// 5. Edit
await page.getByRole("link", { name: "Edit" }).first().click();
await page.getByLabel("Title").waitFor();
const loaded = await page.getByLabel("Title").inputValue();
await page.getByLabel("Title").fill("Intro call");
await page.getByRole("button", { name: "Save changes" }).click();
await page.waitForURL(`${BASE}/dashboard/event-types`);
await page.getByRole("heading", { name: "Intro call", exact: true }).waitFor();
step(`edit loaded "${loaded}", saved as "Intro call"`);

// 6. Availability
await page.getByRole("link", { name: "Availability" }).click();
await page.getByRole("heading", { name: "Weekly hours" }).waitFor();
const tz = await page.getByRole("combobox", { name: "Timezone" }).inputValue();
step(`availability loaded, timezone ${tz}`);
await page.getByRole("switch", { name: "Saturday available" }).click();
await page.getByRole("button", { name: "Save hours" }).isEnabled();
// make Monday overlap to see the validation
await page.getByRole("listitem").filter({ hasText: "Monday" }).getByRole("button", { name: "Add hours" }).click();
await page.getByLabel("Monday range 2 start").selectOption("16:00");
await page.getByLabel("Monday range 2 end").selectOption("18:00");
await page.getByRole("button", { name: "Save hours" }).click();
await page.getByText("Overlaps another range").waitFor();
step("overlapping Monday ranges rejected");
await page.getByLabel("Monday range 2 start").selectOption("18:00");
await page.getByLabel("Monday range 2 end").selectOption("20:00");
await page.getByRole("button", { name: "Save hours" }).click();
await page.getByText("Saved", { exact: true }).waitFor();
await page.reload();
await page.getByLabel("Monday range 2 start").waitFor();
const mon2 = await page.getByLabel("Monday range 2 start").inputValue();
const satOn = await page.getByRole("switch", { name: "Saturday available" }).getAttribute("aria-checked");
step(`after reload: Monday range 2 starts ${mon2}, Saturday on=${satOn}`);

// 7. Date override
await page.getByLabel("Date").fill("2026-12-16");
await page.getByRole("button", { name: "Add override" }).click();
await page.getByText("Wed, 16 Dec 2026").waitFor();
await page.getByText("Unavailable", { exact: true }).first().waitFor();
await page.getByLabel("Date").fill("2026-12-25");
await page.getByLabel("Different hours").check();
await page.getByLabel("Override range 1 start").selectOption("10:00");
await page.getByLabel("Override range 1 end").selectOption("12:00");
await page.getByRole("button", { name: "Add override" }).click();
await page.getByText("10:00 AM–12:00 PM").waitFor();
step("overrides added (day off + custom hours)");
await page.screenshot({ path: `${out}/4-availability.png`, fullPage: true });

// 8. Mobile width
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/dashboard/event-types`);
await page.getByRole("heading", { name: "Intro call", exact: true }).waitFor();
await page.screenshot({ path: `${out}/5-mobile.png`, fullPage: true });

console.log("console/page errors:", errors.length ? errors : "none");
await browser.close();
