import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Europe/London" });
await ctx.addInitScript(() => {
  window.__vt = [];
  const orig = document.startViewTransition?.bind(document);
  if (orig) document.startViewTransition = (arg) => {
    const t = orig(arg);
    const types = arg && typeof arg === "object" && arg.types ? [...arg.types] : [];
    t.ready.then(() => {
      const names = document.getAnimations().map((a) => a.effect?.pseudoElement).filter(Boolean);
      window.__vt.push({ types, pseudo: [...new Set(names)].slice(0, 12) });
    }).catch((e) => window.__vt.push({ types, error: String(e) }));
    return t;
  };
});
const p = await ctx.newPage();
const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
const dump = async (label) => { await p.waitForTimeout(700); console.log(label, JSON.stringify(await p.evaluate(() => window.__vt.splice(0)))); };
await p.goto(BASE); await p.getByText(/ now$/).first().waitFor();
await p.getByRole("link", { name: "Log in" }).first().click(); await p.getByRole("button", { name: "Continue with Google" }).waitFor(); await dump("landing -> login:");
await ctx.addCookies([{ name: "better-auth.session_token", value: readFileSync("/tmp/session-cookie.txt", "utf8"), url: BASE }]);
await p.goto(BASE + "/dashboard"); await p.getByText("Your booking page").waitFor(); await p.waitForTimeout(500); await p.evaluate(() => window.__vt.splice(0));
await p.getByRole("link", { name: "Bookings", exact: true }).click(); await p.getByRole("heading", { name: "Bookings" }).waitFor(); await dump("dashboard -> bookings:");
await p.getByRole("link", { name: "Cancelled" }).click(); await p.waitForURL(/cancelled/); await dump("bookings tab:");
await p.goto(BASE + "/sakif/intro"); const g = p.getByRole("group", { name: /^Times on/ }); await g.waitFor(); await p.waitForTimeout(500); await p.evaluate(() => window.__vt.splice(0));
await g.locator("button[aria-pressed]:visible").first().click(); await p.getByRole("button", { name: "Continue" }).click(); await p.getByLabel("Name").waitFor(); await dump("pick -> details:");
await p.getByRole("button", { name: /Other times/ }).first().click(); await g.waitFor(); await dump("details -> back:");
console.log("errors:", errors.length ? errors : "none");
await browser.close();
