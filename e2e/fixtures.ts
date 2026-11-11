import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  test as base,
  expect,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import pg from "pg";
import { BASE_URL, E2E_AUTH_SECRET, E2E_DATABASE_URL, OUTBOX } from "./support/config";

/*
 * Fixtures: what every test gets, set up fresh and torn down after.
 *
 *  - `host`: a NEW host for this test only (own username, Mon–Fri 9–5 in Dhaka,
 *    an "Intro call" event type, a signed-in session). No test can see another
 *    test's bookings, so they run in parallel and in any order.
 *  - `hostPage`: a browser page signed in as that host. Sign-in is a session
 *    row + a signed cookie, the same thing Better Auth makes after Google
 *    login. Tests never touch Google; production code has no test backdoor.
 *  - `newGuest()`: a fresh browser context per guest (own cookies, own
 *    timezone), like two people on two laptops.
 *  - Console errors: every page is watched, and any console or page error
 *    fails the test, even if the assertions passed.
 */

export type Host = {
  id: string;
  username: string;
  email: string;
  eventTypeId: string;
  cookie: string;
};

type Fixtures = {
  host: Host;
  hostPage: Page;
  newGuest: (options?: BrowserContextOptions) => Promise<Page>;
  consoleErrors: string[];
};

export const test = base.extend<Fixtures, { db: pg.Pool }>({
  db: [
    async ({}, use) => {
      const pool = new pg.Pool({ connectionString: E2E_DATABASE_URL, max: 4 });
      await use(pool);
      await pool.end();
    },
    { scope: "worker" },
  ],

  host: async ({ db }, use) => {
    await use(await createHost(db));
  },

  consoleErrors: [
    async ({}, use) => {
      const errors: string[] = [];
      await use(errors);
      expect(errors, "console or page errors").toEqual([]);
    },
    { auto: true },
  ],

  page: async ({ page, consoleErrors }, use) => {
    watch(page, consoleErrors);
    await use(page);
  },

  hostPage: async ({ browser, host, consoleErrors }, use) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    await signInAs(context, host);
    const page = await context.newPage();
    watch(page, consoleErrors);
    await use(page);
    await context.close();
  },

  newGuest: async ({ browser, consoleErrors }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({ baseURL: BASE_URL, ...options });
      contexts.push(context);
      const page = await context.newPage();
      watch(page, consoleErrors);
      return page;
    });
    for (const context of contexts) await context.close();
  },
});

export { expect };

/** Puts the host's session cookie in a browser context: from then on, it's signed in. */
export const signInAs = (context: BrowserContext, host: Host) =>
  context.addCookies([{ name: "better-auth.session_token", value: host.cookie, url: BASE_URL }]);

function watch(page: Page, errors: string[]) {
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // A not-found page loads with status 404, and Chrome logs that as a
    // console error. That one is expected; every other error is a failure.
    if (m.type() === "error" && !m.text().includes("status of 404")) errors.push(m.text());
  });
}

/** A host with a username, a weekly schedule, one event type and a signed-in session. */
async function createHost(db: pg.Pool): Promise<Host> {
  const suffix = randomBytes(4).toString("hex");
  const id = `u_${suffix}`;
  const username = `host-${suffix}`;
  const email = `${username}@example.com`;
  const token = randomBytes(24).toString("hex");

  await db.query(
    `insert into "user" (id, name, email, email_verified, username, time_zone)
     values ($1, 'Sakif Azwad', $2, true, $3, 'Asia/Dhaka')`,
    [id, email, username],
  );
  await db.query(
    `insert into availability_rules (user_id, day_of_week, start_time, end_time)
     select $1, d, '09:00', '17:00' from generate_series(1, 5) d`,
    [id],
  );
  await db.query(
    `insert into session (id, token, user_id, expires_at) values ($1, $2, $3, now() + interval '1 day')`,
    [`s_${suffix}`, token, id],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into event_types (user_id, title, slug, description, duration_minutes, location_type,
                              location_value, minimum_notice_minutes, booking_window_days)
     values ($1, 'Intro call', 'intro', 'A quick chat about the role.', 30, 'zoom',
             'https://us05web.zoom.us/j/123', 60, 60)
     returning id`,
    [id],
  );

  // Better Auth's cookie is "<token>.<HMAC-SHA256(secret, token) in base64>".
  const signature = createHmac("sha256", E2E_AUTH_SECRET).update(token).digest("base64");
  return {
    id,
    username,
    email,
    eventTypeId: rows[0]!.id,
    cookie: encodeURIComponent(`${token}.${signature}`),
  };
}

// ─── Emails ─────────────────────────────────────────────────────────────────────

export type Email = { html: string; ics: string | null };

/**
 * Emails sent to `to`, oldest first. The outbox folder is shared by every
 * test, so emails are found by recipient: each test's guests and host have
 * their own addresses.
 */
export function emailsTo(to: string): Email[] {
  if (!existsSync(OUTBOX)) return [];
  const prefix = `-${to.replace(/[^a-z0-9]+/gi, "_")}.html`;
  return readdirSync(OUTBOX)
    .filter((f) => f.endsWith(prefix))
    .sort()
    .map((f) => {
      const ics = path.join(OUTBOX, f.replace(/\.html$/, ".ics"));
      return {
        html: readFileSync(path.join(OUTBOX, f), "utf8"),
        ics: existsSync(ics) ? readFileSync(ics, "utf8") : null,
      };
    });
}

/** Waits until `to` has received `count` emails (they're sent after the response), then returns them. */
export async function waitForEmails(to: string, count: number): Promise<Email[]> {
  await expect.poll(() => emailsTo(to).length, { message: `emails to ${to}` }).toBeGreaterThanOrEqual(count);
  return emailsTo(to);
}
