import { chromium } from "playwright-core";
import { readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const BASE = "http://localhost:3000";
const OUTBOX = path.join(os.tmpdir(), "meetready-emails");
const out = "/home/claude/e2e/shots";
const step = (s) => console.log("•", s);
const errors = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function newPage({ tz = "Europe/London", host = false, viewport = { width: 1100, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: tz, locale: "en-US" });
  if (host) await ctx.addCookies([{ name: "better-auth.session_token", value: readFileSync("/tmp/session-cookie.txt", "utf8"), url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
  return p;
}
const emails = () => (existsSync(OUTBOX) ? readdirSync(OUTBOX).filter((f) => f.endsWith(".html")).sort() : []);
async function waitForEmails(n) {
  for (let i = 0; i < 40; i++) { if (emails().length >= n) return emails(); await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`expected ${n} emails, found ${emails().length}`);
}
const read = (f) => readFileSync(path.join(OUTBOX, f), "utf8");
const ics = (f) => readFileSync(path.join(OUTBOX, f.replace(/\.html$/, ".ics")), "utf8");
async function bookFirst(page, name, email) {
  await page.goto(`${BASE}/sakif/intro`);
  await page.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await page.getByText("You're booked").waitFor();
}

// 1. Guest books -> two emails with invites
const guest = await newPage();
await bookFirst(guest, "Ada Lovelace", "ada@example.com");
let files = await waitForEmails(2);
const guestMail = files.map(read).find((h) => h.includes("You&#x27;re booked") || h.includes("You're booked"));
const hostFileName = files.find((f) => f.includes("sakif"));
const manageUrl = guestMail.match(/href="(http:\/\/localhost:3000\/booking\/[A-Za-z0-9_-]{43})"/)?.[1];
step(`emails after booking: ${files.length} (guest + host); host invite has ${ics(hostFileName).match(/METHOD:\w+/)[0]}, ${ics(hostFileName).match(/SEQUENCE:\d+/)[0]}`);
step(`manage link from the guest's email: ${manageUrl ? manageUrl.replace(/[A-Za-z0-9_-]{43}$/, "<43-char token>") : "MISSING"}`);

// 2. Manage page from the email link
const manage = await newPage();
const res = await manage.goto(manageUrl);
await manage.getByRole("heading", { name: "Need to change something?" }).waitFor();
const head = await manage.content();
step(`manage page ${res.status()}: noindex=${/name="robots" content="noindex/.test(head)}, no-referrer=${/name="referrer" content="no-referrer"/.test(head)}`);
await manage.screenshot({ path: `${out}/m1-manage.png` });

// 3. Reschedule through the UI
await manage.getByRole("button", { name: /Reschedule/ }).click();
await manage.getByText(/^Moving your meeting from/).waitFor();
const currently = await manage.getByText(/^Moving your meeting from/).innerText();
const newTime = (await manage.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").nth(2).innerText()).split("\n")[0];
await manage.getByRole("group", { name: /^Times on/ }).locator("button[aria-pressed]:visible").nth(2).click();
await manage.getByRole("button", { name: "Continue" }).click();
await manage.getByRole("heading", { name: "Move your meeting?" }).waitFor();
await manage.screenshot({ path: `${out}/m2-reschedule-confirm.png` });
await manage.getByRole("button", { name: "Confirm new time" }).click();
await manage.getByText("Your meeting has moved").waitFor();
await manage.locator("aside").getByText(new RegExp(`${newTime} –`)).waitFor();
step(`left panel after move: ${(await manage.locator("aside").innerText()).replace(/\n+/g, " | ")}`);
await manage.screenshot({ path: `${out}/m2b-moved.png` });
files = await waitForEmails(4);
const resched = files.slice(2).map((f) => ics(f));
step(`rescheduled (${currently}); 2 new emails, invites ${resched.map((i) => i.match(/SEQUENCE:\d+/)[0]).join(" + ")}, same UID: ${resched.every((i) => i.includes(ics(hostFileName).match(/UID:.*/)[0]))}`);

// 4. Host sees it, in Dhaka time
const host = await newPage({ tz: "Asia/Dhaka", host: true });
await host.goto(`${BASE}/dashboard/bookings`);
await host.getByText("Intro call with Ada Lovelace").waitFor();
step(`host upcoming: ${(await host.locator("li").filter({ hasText: "Ada Lovelace" }).innerText()).replace(/\n+/g, " | ")}`);

// 5. Second guest books; host cancels with a reason -> only the guest is emailed
const guest2 = await newPage();
await bookFirst(guest2, "Grace Hopper", "grace@example.com");
await waitForEmails(6);
await host.reload();
const graceRow = host.locator("li").filter({ hasText: "Grace Hopper" });
await graceRow.getByRole("button", { name: "Cancel" }).click();
await graceRow.getByPlaceholder(/Reason/).fill("Sorry, I'm travelling that day");
await host.screenshot({ path: `${out}/m3-host-cancel.png` });
await graceRow.getByRole("button", { name: "Cancel meeting" }).click();
await host.locator("li").filter({ hasText: "Grace Hopper" }).waitFor({ state: "detached" });
files = await waitForEmails(7);
await new Promise((r) => setTimeout(r, 1000));
const afterHostCancel = emails().slice(6);
step(`host cancelled Grace: ${afterHostCancel.length} email (to ${afterHostCancel.map((f) => f.split("-").slice(1).join("-")).join(", ")}), invite ${ics(afterHostCancel[0]).match(/METHOD:\w+/)[0]}`);

// 6. Ada cancels from her manage page -> guest + host emailed
const manage2 = await newPage();
await manage2.goto(manageUrl);
await manage2.getByRole("button", { name: /^Cancel/ }).click();
await manage2.getByLabel("Reason").fill("Found a time with the team instead");
await manage2.getByRole("button", { name: "Cancel meeting" }).click();
await manage2.getByText("This meeting is cancelled").waitFor();
files = await waitForEmails(9);
step(`Ada cancelled: page says "${(await manage2.getByRole("status").innerText()).replace(/\n+/g, " ")}"; total emails ${files.length}`);
await manage2.screenshot({ path: `${out}/m4-cancelled.png` });

await host.goto(`${BASE}/dashboard/bookings?view=cancelled`);
await host.getByText("Grace Hopper").first().waitFor();
const cancelledRows = await host.locator("main li").allInnerTexts();
step(`host cancelled tab: ${cancelledRows.map((r) => r.match(/Cancelled by [^\n]*/)?.[0]).join(" / ")}`);
await host.screenshot({ path: `${out}/m5-host-cancelled-tab.png` });

// 7. Bad tokens and odd input
const bad = await newPage();
await bad.goto(`${BASE}/booking/${"x".repeat(43)}`);
await bad.getByText(/could not be found/i).waitFor();
await host.goto(`${BASE}/dashboard/bookings?view=<script>`);
await host.getByText(/No upcoming bookings|Intro call/).first().waitFor();
step("unknown token -> 404; ?view=<script> falls back to upcoming");

// 8. Render the guest's confirmation email like a mail client would
const mail = await newPage({ viewport: { width: 700, height: 900 } });
await mail.goto(`file://${path.join(OUTBOX, emails()[0])}`);
await mail.screenshot({ path: `${out}/m6-email.png`, fullPage: true });

const db = new pg.Client("postgresql://postgres@127.0.0.1:5432/meetready_e2e"); await db.connect();
const rows = (await db.query("select guest_name, status, cancelled_by, sequence, rescheduled_at is not null as moved, length(manage_token_hash) as hash_len from bookings order by created_at")).rows;
step(`DB: ${JSON.stringify(rows)}`);
await db.end();
console.log("console/page errors:", errors.length ? errors : "none");
await browser.close();
