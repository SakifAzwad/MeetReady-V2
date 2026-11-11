// Day 10: custom booking questions, end to end against the production build and real Postgres.
import { chromium } from "playwright-core";
import pg from "pg";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = "http://localhost:3000";
const out = "/home/claude/e2e/shots";
const OUTBOX = path.join(os.tmpdir(), "meetready-emails");
if (existsSync(OUTBOX)) rmSync(OUTBOX, { recursive: true });
const step = (s) => console.log("•", s);
const errors = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function newPage({ tz = "Europe/London", host = false, viewport = { width: 1100, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: tz, locale: "en-US" });
  if (host)
    await ctx.addCookies([
      { name: "better-auth.session_token", value: readFileSync("/tmp/session-cookie.txt", "utf8"), url: BASE },
    ]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  return p;
}
const db = new pg.Client("postgresql://postgres@127.0.0.1:5432/meetready_e2e");
await db.connect();
const { id: eventTypeId } = (await db.query("select id from event_types where slug = 'intro'")).rows[0];

// ─── 1. Host adds questions ───────────────────────────────────────────────────
const host = await newPage({ tz: "Asia/Dhaka", host: true, viewport: { width: 1280, height: 900 } });
await host.goto(`${BASE}/dashboard/event-types/${eventTypeId}/edit`);
const card = host.locator("[data-slot=card]").filter({ hasText: "Booking questions" });
await card.waitFor();
const rows = card.locator("ol > li");
const addQuestion = card.getByRole("button", { name: "Add question" });

await addQuestion.click();
const focusedAfterAdd = await host.evaluate(() => document.activeElement?.getAttribute("placeholder"));
await rows.nth(0).getByRole("textbox", { name: "Question", exact: true }).fill("Company");
await rows.nth(0).getByRole("switch", { name: "Required" }).click();
step(`added a text question; focus went to its label input: ${focusedAfterAdd === "What's your company called?"}`);

await addQuestion.click();
await rows.nth(1).getByRole("textbox", { name: "Question", exact: true }).fill("Your role");
await rows.nth(1).getByLabel("Answer type").selectOption("choice");
const typeKeepsFocus = await host.evaluate(() => document.activeElement?.tagName === "SELECT");
// Save with the two empty options: the errors appear next to them.
await host.getByRole("button", { name: "Save changes" }).click();
await rows.nth(1).getByText("Fill in this option or remove it").first().waitFor();
step(`switched to "Pick one" (focus kept on the select: ${typeKeepsFocus}); empty options rejected next to the inputs`);
await rows.nth(1).getByRole("textbox", { name: "Option 1", exact: true }).fill("Engineer");
await rows.nth(1).getByRole("textbox", { name: "Option 2", exact: true }).fill("Founder");
await rows.nth(1).getByRole("textbox", { name: "Option 2", exact: true }).press("Enter"); // Enter in the last option adds one
await rows.nth(1).getByRole("textbox", { name: "Option 3", exact: true }).waitFor();
const enterFocus = await host.evaluate(() => document.activeElement?.getAttribute("aria-label"));
await host.keyboard.type("Other");
step(`Enter in the last option added "Option 3" and focused it (${enterFocus}), form not submitted`);

await addQuestion.click();
await rows.nth(2).getByRole("textbox", { name: "Question", exact: true }).fill("Topics");
await rows.nth(2).getByLabel("Answer type").selectOption("multi_choice");
for (const [j, v] of ["Pricing", "Hiring"].entries()) await rows.nth(2).getByRole("textbox", { name: `Option ${j + 1}`, exact: true }).fill(v);
await rows.nth(2).getByRole("button", { name: "Add option" }).click();
await rows.nth(2).getByRole("textbox", { name: "Option 3", exact: true }).fill("Roadmap");

await addQuestion.click();
await rows.nth(3).getByRole("textbox", { name: "Question", exact: true }).fill("I agree to the call being recorded");
await rows.nth(3).getByLabel("Answer type").selectOption("checkbox");
await rows.nth(3).getByRole("switch", { name: "Required" }).click();

// Reorder: move "Topics" up, keyboard focus stays on the button.
await rows.nth(2).getByRole("button", { name: "Move Topics up" }).click();
await host.waitForTimeout(100);
const order = await rows.locator("input[id$='-label']").evaluateAll((els) => els.map((e) => e.value));
const moveFocus = await host.evaluate(() => document.activeElement?.getAttribute("aria-label"));
const announced = await card.locator("[aria-live]").innerText();
step(`moved Topics up: order ${order.join(" / ")}; focus on "${moveFocus}"; announced "${announced}"`);
await card.screenshot({ path: `${out}/d10-1-editor.png` });

await host.getByRole("button", { name: "Save changes" }).click();
await host.waitForURL(`${BASE}/dashboard/event-types`);
const saved = (await db.query("select questions from event_types where id = $1", [eventTypeId])).rows[0].questions;
step(`saved: ${saved.map((q) => `${q.label} (${q.type}${q.required ? ", required" : ""})`).join("; ")}`);

// ─── 2. Guest answers ─────────────────────────────────────────────────────────
const guest = await newPage();
await guest.goto(`${BASE}/sakif/intro`);
await guest.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").first().click();
await guest.getByRole("button", { name: "Continue" }).click();
await guest.getByLabel("Name", { exact: true }).fill("Ada Lovelace");
await guest.getByLabel("Email").fill("ada@example.com");
await guest.getByRole("button", { name: "Confirm booking" }).click();
await guest.getByText("Tick this to continue").waitFor();
const shown = await guest.locator("form .text-destructive").allInnerTexts();
step(`empty answers rejected in the browser: ${shown.join(" / ")}`);
await guest.screenshot({ path: `${out}/d10-2-guest-errors.png`, fullPage: true });

await guest.getByLabel("Company", { exact: true }).fill("Acme Corp");
await guest.getByRole("checkbox", { name: "Roadmap" }).check();
await guest.getByRole("checkbox", { name: "Pricing" }).check();
await guest.getByRole("radio", { name: "Founder" }).check();
await guest.getByRole("checkbox", { name: /I agree/ }).check();

// ─── 3. The host renames a question while the guest is typing ────────────────
await db.query(
  `update event_types set questions = jsonb_set(questions, '{0,label}', '"Company name"') where id = $1`,
  [eventTypeId],
);
await guest.getByRole("button", { name: "Confirm booking" }).click();
await guest.getByText(/just changed these questions/).waitFor();
const kept = {
  company: await guest.getByLabel("Company name", { exact: true }).inputValue(),
  founder: await guest.getByRole("radio", { name: "Founder" }).isChecked(),
  roadmap: await guest.getByRole("checkbox", { name: "Roadmap" }).isChecked(),
  name: await guest.getByLabel("Name", { exact: true }).inputValue(),
};
step(`host renamed "Company" mid-booking -> notice shown, nothing booked; answers kept: ${JSON.stringify(kept)}`);
await guest.screenshot({ path: `${out}/d10-3-questions-changed.png`, fullPage: true });
await guest.getByRole("button", { name: "Confirm booking" }).click();
await guest.getByRole("heading", { name: /^You're booked/ }).waitFor();

const [booking] = (await db.query("select answers from bookings")).rows;
step(`stored snapshot: ${booking.answers.map((a) => `${a.label}=${JSON.stringify(a.value)}`).join("; ")}`);

// ─── 4. Where the answers show up ─────────────────────────────────────────────
let files = [];
for (let i = 0; i < 40 && files.length < 2; i++) {
  files = existsSync(OUTBOX) ? readdirSync(OUTBOX).filter((f) => f.endsWith(".html")) : [];
  await new Promise((r) => setTimeout(r, 250));
}
const html = (who) => readFileSync(path.join(OUTBOX, files.find((f) => f.includes(who))), "utf8");
const hostMail = html("sakif");
const guestMail = html("ada");
step(
  `host email has answers: ${hostMail.includes("Acme Corp") && hostMail.includes("Pricing, Roadmap")}; guest email has none: ${!guestMail.includes("Acme Corp")}`,
);

await host.goto(`${BASE}/dashboard/bookings`);
await host.getByText("Acme Corp").waitFor();
await host.locator("li").filter({ hasText: "Acme Corp" }).screenshot({ path: `${out}/d10-4-dashboard.png` });
step("dashboard booking card shows the answers");

const manageUrl = guestMail.match(/href="(http:\/\/localhost:3000\/booking\/[A-Za-z0-9_-]{43})"/)?.[1];
const manage = await newPage();
await manage.goto(manageUrl);
await manage.getByRole("heading", { name: "What you shared" }).waitFor();
step(`guest's manage page: ${(await manage.locator("aside dl").innerText()).replace(/\n+/g, " | ")}`);
await manage.screenshot({ path: `${out}/d10-5-manage.png` });

// The host deletes a question: the past booking still shows what was asked.
await db.query("update event_types set questions = questions - 0 where id = $1", [eventTypeId]);
await manage.reload();
await manage.getByText("Acme Corp").waitFor();
step('after the host deleted "Company name", the booking still shows it (snapshot)');

// ─── 5. Phone ─────────────────────────────────────────────────────────────────
const phone = await newPage({ tz: "Asia/Dhaka", viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/sakif/intro`);
await phone.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").first().click();
await phone.getByRole("button", { name: "Continue" }).click();
await phone.getByRole("radio", { name: "Founder" }).waitFor();
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await phone.screenshot({ path: `${out}/d10-6-phone.png`, fullPage: true });
const hostPhone = await newPage({ tz: "Asia/Dhaka", host: true, viewport: { width: 390, height: 844 } });
await hostPhone.goto(`${BASE}/dashboard/event-types/${eventTypeId}/edit`);
await hostPhone.getByText("Booking questions").waitFor();
const editorOverflow = await hostPhone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
step(`phone: guest form overflow ${overflow}px, editor overflow ${editorOverflow}px`);

await db.end();
console.log("console/page errors:", errors.length ? errors : "none");
await browser.close();
