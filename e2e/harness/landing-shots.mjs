import { chromium } from "playwright-core";
const BASE = "http://localhost:3000";
const out = "/home/claude/e2e/shots";
const errors = [];
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
async function shot(name, { tz = "Europe/London", viewport = { width: 1280, height: 900 }, dark = false, full = true, act } = {}) {
  const ctx = await browser.newContext({ viewport, timezoneId: tz, locale: "en-US", colorScheme: dark ? "dark" : "light" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(`${name}: ${m.text()}`));
  await p.goto(`${BASE}/`);
  await p.getByText(/ now$/).first().waitFor();
  if (act) await act(p);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const sentence = await p.locator("p.leading-relaxed").filter({ hasText: "works" }).or(p.getByText(/too, so/)).first().innerText().catch(() => "");
  console.log(`${name}: overflow ${overflow}px | ${sentence}`);
  await ctx.close();
}
const only = process.argv[2];
const shots = {
  "l1-london": {},
  "l2-newyork": { tz: "America/New_York" },
  "l3-dhaka": { tz: "Asia/Dhaka" },
  "l4-tokyo-click": { act: (p) => p.getByRole("button", { name: "Tokyo" }).click(), full: false },
  "l5-dark": { dark: true },
  "l6-mobile": { tz: "Asia/Kolkata", viewport: { width: 390, height: 844 } },
};
for (const [n, o] of Object.entries(shots)) if (!only || n.startsWith(only)) await shot(n, o);
console.log("errors:", errors.length ? errors : "none");
await browser.close();
