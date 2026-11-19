import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type pg from "pg";
import { BASE_URL } from "../support/config";
import { expect, fakeGroq, randomIp, signInAs, test, type Host } from "../fixtures";

/*
 * README screenshots (Day 23). One demo host, seeded the way the app would
 * have written it: three meeting types, a few bookings this week (one with an
 * AI brief, one booked through Claude), Claude connected. Then the pages a
 * reviewer should see, saved to docs/images/. The GIF needs ffmpeg.
 */

const OUT = path.join(process.cwd(), "docs/images");
const LIVE = "meetreadyv2.vercel.app";
const CLAUDE = "https://claude.ai/oauth/mcp-client-metadata";

/** The next weekdays in Dhaka after today: ["2026-11-20", ...]. */
function weekdays(count: number, skip = 1): string[] {
  const out: string[] = [];
  for (let d = skip; out.length < count; d++) {
    const at = new Date(Date.now() + d * 86_400_000);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", weekday: "short" }).format(at);
    if (wd !== "Sat" && wd !== "Sun")
      out.push(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(at));
  }
  return out;
}
const dhaka = (date: string, time: string) => new Date(`${date}T${time}:00+06:00`);

async function seed(db: pg.Pool, host: Host) {
  await db.query(`update "user" set username = 'sakifazwad18', email = 'sakif@example.com' where id = $1`, [
    host.id,
  ]);
  await db.query(
    `update event_types set location_type = 'google_meet', location_value = null where id = $1`,
    [host.eventTypeId],
  );
  const { rows } = await db.query<{ id: string; slug: string }>(
    `insert into event_types (user_id, title, slug, description, duration_minutes, location_type, minimum_notice_minutes)
     values ($1, 'Project review', 'review', 'A deeper look at a project or a pull request.', 60, 'google_meet', 120),
            ($1, 'Office hours', 'office-hours', 'Quick questions, 15 minutes.', 15, 'zoom', 60)
     returning id, slug`,
    [host.id],
  );
  const review = rows.find((r) => r.slug === "review")!.id;

  await db.query(
    `insert into oauth_client (id, client_id, name, redirect_uris, token_endpoint_auth_method, scopes, created_at, updated_at)
     values ('c-claude', $1, 'Claude', $2, 'none', $3, now(), now())`,
    [
      CLAUDE,
      ["https://claude.ai/api/mcp/auth_callback"],
      ["bookings:read", "bookings:write", "offline_access"],
    ],
  );
  await db.query(
    `insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at)
     values ('k-claude', $1, $2, $3, now(), now())`,
    [CLAUDE, host.id, ["bookings:read", "bookings:write", "offline_access"]],
  );

  const [d1, d2, d3] = weekdays(3);
  const book = async (b: {
    eventType: string;
    start: Date;
    minutes: number;
    name: string;
    email: string;
    tz: string;
    notes?: string;
    meet?: boolean;
    assistant?: boolean;
  }) => {
    const { rows: r } = await db.query<{ id: string }>(
      `insert into bookings (event_type_id, host_id, guest_name, guest_email, guest_time_zone, guest_notes,
                             starts_at, ends_at, manage_token_hash, meet_url, calendar_sync, source, created_by_client)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [
        b.eventType,
        host.id,
        b.name,
        b.email,
        b.tz,
        b.notes ?? null,
        b.start,
        new Date(b.start.getTime() + b.minutes * 60_000),
        randomBytes(16).toString("hex"),
        b.meet ? `https://meet.google.com/abc-${randomBytes(2).toString("hex")}-xyz` : null,
        "synced",
        b.assistant ? "assistant" : "booking_page",
        b.assistant ? CLAUDE : null,
      ],
    );
    return r[0]!.id;
  };
  const ada = await book({
    eventType: host.eventTypeId,
    start: dhaka(d1!, "15:00"),
    minutes: 30,
    name: "Ada Lovelace",
    email: "ada@analytical.example",
    tz: "Europe/London",
    notes:
      "We're a small team hiring two React developers. I'd like to talk about your availability and rates.",
    meet: true,
  });
  await db.query(
    `insert into booking_briefs (booking_id, summary, agenda, prepare, model) values ($1, $2, $3, $4, 'openai/gpt-oss-120b')`,
    [
      ada,
      "Ada runs a small team that is hiring two React developers and wants to know your availability and rates.",
      JSON.stringify(["Their team and the two roles", "Your availability", "Rates and contract length"]),
      JSON.stringify(["Your rates for a 3-month contract"]),
    ],
  );
  await book({
    eventType: review,
    start: dhaka(d2!, "15:00"),
    minutes: 60,
    name: "Grace Hopper",
    email: "grace@compiler.example",
    tz: "Europe/Berlin",
    meet: true,
    assistant: true,
  });
  await book({
    eventType: host.eventTypeId,
    start: dhaka(d3!, "11:30"),
    minutes: 30,
    name: "Alan Turing",
    email: "alan@bletchley.example",
    tz: "Asia/Singapore",
    meet: true,
  });
}

/** The address bar isn't in the shots, but the dashboard prints the site's address: show the live one. */
const showLiveAddress = (page: Page) =>
  page.evaluate(
    (pairs: [string, string][]) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (const [a, b] of pairs) if (n.nodeValue?.includes(a)) n.nodeValue = n.nodeValue.replaceAll(a, b);
      }
    },
    [
      [BASE_URL, `https://${LIVE}`],
      [BASE_URL.replace(/^https?:\/\//, ""), LIVE],
    ] as [string, string][],
  );

type Frame = { png: Buffer; at: number };

/**
 * Screenshots the page as fast as it can until stopped. Playwright's own video needs its bundled ffmpeg,
 * and a GIF only needs frames: each keeps the time it was taken, so the GIF plays at the real speed.
 */
function record(page: Page) {
  const frames: Frame[] = [];
  let on = true;
  const loop = (async () => {
    while (on)
      frames.push({
        png: await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 900 } }),
        at: Date.now(),
      });
  })();
  return {
    stop: async () => {
      on = false;
      await loop;
      return frames;
    },
  };
}

/** Frames → GIF with ffmpeg: each frame shown for as long as it really lasted, one shared 128-colour palette. */
function writeGif(frames: Frame[], out: string) {
  const dir = path.join(OUT, ".frames");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  const list = frames.map((f, i) => {
    const file = path.join(dir, `${String(i).padStart(4, "0")}.png`);
    writeFileSync(file, f.png);
    const next = frames[i + 1]?.at ?? f.at + 1500; // hold the last frame
    return `file '${file}'\nduration ${((next - f.at) / 1000).toFixed(3)}`;
  });
  // The concat demuxer ignores the last duration unless the last file is listed again.
  list.push(`file '${path.join(dir, `${String(frames.length - 1).padStart(4, "0")}.png`)}'`);
  writeFileSync(path.join(dir, "list.txt"), list.join("\n"));
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    path.join(dir, "list.txt"),
    "-vf",
    "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    out,
  ]);
  rmSync(dir, { recursive: true, force: true });
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

test("README screenshots", async ({ host, db, browser }) => {
  test.setTimeout(180_000);
  await seed(db, host);

  // ── The booking page, with the assistant's suggestions, as a guest in London ──
  // The fake model finds its script by a marker anywhere in the request. Here the marker is the guest's
  // whole sentence (shots run alone), so the screenshot shows what a guest would really type.
  const day = weekdays(1, 8)[0]!;
  const ask = "Next week, a morning. I'm in London";
  await fakeGroq.script(ask, {
    search: { from: day, to: day, earliest: "09:00", latest: "12:00", timeZone: "Europe/London" },
    reply: "Here are three free times that morning, London time. Pick one and confirm it below.",
  });
  const guest = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "Europe/London",
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  const page = await guest.newPage();
  await page.goto("/sakifazwad18/intro");
  await expect(page.getByRole("group", { name: /^Times on/ })).toBeVisible();
  await page.waitForTimeout(300);
  const recording = record(page);
  await page.waitForTimeout(700);
  const box = page.getByRole("region", { name: "Find a time by describing it" });
  await box.getByLabel("Tell us when suits you").pressSequentially(ask, { delay: 45 });
  await page.waitForTimeout(400);
  await box.getByRole("button", { name: "Find times" }).click();
  const suggestions = page.getByRole("list", { name: "Suggested times" }).getByRole("button");
  await expect(suggestions).toHaveCount(3);
  await page.waitForTimeout(1200);
  await suggestions.nth(1).click();
  await page.waitForTimeout(2500);
  const frames = await recording.stop();
  await guest.close();

  // The still: same flow, sharper (2x), no recording.
  const still = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "Europe/London",
    deviceScaleFactor: 2,
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  const sp = await still.newPage();
  await sp.goto("/sakifazwad18/intro");
  const sbox = sp.getByRole("region", { name: "Find a time by describing it" });
  await sbox.getByLabel("Tell us when suits you").fill(ask);
  await sbox.getByRole("button", { name: "Find times" }).click();
  await sp.getByRole("list", { name: "Suggested times" }).getByRole("button").nth(1).click();
  await expect(sp.locator('button[data-start][aria-pressed="true"]')).toBeVisible();
  await sp.waitForTimeout(800);
  await sp.screenshot({ path: path.join(OUT, "booking-page.png") });
  await still.close();

  // ── The same page on a phone ──
  const phone = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "Asia/Dhaka",
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  const p = await phone.newPage();
  await p.goto("/sakifazwad18/intro");
  await expect(p.getByRole("group", { name: /^Times on/ })).toBeVisible();
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(OUT, "booking-phone.png") });
  await phone.close();

  // ── The host's side ──
  const hostContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "Asia/Dhaka",
    extraHTTPHeaders: { "x-forwarded-for": randomIp() },
  });
  await signInAs(hostContext, host);
  const hostPage = await hostContext.newPage();
  await hostPage.goto("/dashboard");
  await expect(hostPage.getByRole("heading", { name: "Hi Sakif" })).toBeVisible();
  await showLiveAddress(hostPage);
  await hostPage.waitForTimeout(600);
  await hostPage.screenshot({ path: path.join(OUT, "dashboard.png") });
  // The "AI assistants" section, with a margin of page around it.
  const section = await hostPage.locator('section[aria-labelledby="assistants-heading"]').boundingBox();
  await hostPage.screenshot({
    path: path.join(OUT, "dashboard-assistants.png"),
    fullPage: true,
    clip: {
      x: section!.x - 32,
      y: section!.y + (await hostPage.evaluate(() => scrollY)) - 32,
      width: section!.width + 64,
      height: section!.height + 64,
    },
  });

  await hostPage.goto("/dashboard/bookings");
  await expect(hostPage.getByRole("region", { name: "Meeting brief" })).toBeVisible();
  await hostPage.waitForTimeout(400);
  await hostPage.screenshot({ path: path.join(OUT, "bookings.png") });

  // ── An assistant asking to connect ──
  const verifier = randomBytes(32).toString("base64url");
  await db.query(
    `insert into oauth_client_resource (id, client_id, resource_id, created_at) values ('cr-claude', $1, $2, now())`,
    [CLAUDE, `${BASE_URL}/api/mcp`],
  );
  await db.query(`delete from oauth_consent where client_id = $1`, [CLAUDE]);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLAUDE,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    scope: "bookings:read bookings:write offline_access",
    state: "s",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource: `${BASE_URL}/api/mcp`,
  });
  await hostPage.goto(`/api/auth/oauth2/authorize?${params}`);
  await expect(hostPage.getByRole("heading", { name: /wants to use your MeetReady account/ })).toBeVisible();
  await hostPage.setViewportSize({ width: 1280, height: 760 });
  await hostPage.screenshot({ path: path.join(OUT, "consent.png") });
  await hostContext.close();

  // ── The GIF: the assistant's flow, from the frames recorded above ──
  writeGif(frames, path.join(OUT, "booking-assistant.gif"));
});
