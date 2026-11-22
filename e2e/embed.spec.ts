import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BASE_URL, FAKE_SITE_URL } from "./support/config";
import { fillDetails, guestEmail, openRoomyDay, timeButtons, timeList } from "./support/booking";

/*
 * Day 27: the booking widget on another website. A fake customer site
 * (e2e/support/fake-site.mjs, on 127.0.0.1, a different site from the app)
 * loads the real public/embed.js, which frames the real /embed page. What
 * matters, in order:
 *  1. A guest can book without leaving the site, and the site hears about it,
 *     with times only, never the guest's details; a message the site forges
 *     itself is ignored.
 *  2. The frame fits its content as it changes, shrinking too (no scrollbar
 *     inside, no gap under it).
 *  3. The popup behaves like a dialog: Escape (even from inside the frame),
 *     focus back on the link, and the link still works without the script.
 *  4. Only /embed may be framed; everything else still refuses.
 */

const site = (target: string, mode: "inline" | "popup" | "late", theme?: string) =>
  `${FAKE_SITE_URL}/site?${new URLSearchParams({ mode, target, ...(theme ? { theme } : {}) })}`;

const frameOf = (page: Page) => page.frameLocator('iframe[title="Book a meeting with MeetReady"]');
const iframe = (page: Page) => page.locator('iframe[title="Book a meeting with MeetReady"]');
const events = (page: Page) => page.locator("#events li");

/** The iframe's height on the site, and the embed's content height inside it. */
async function heights(page: Page) {
  const outer = await iframe(page).evaluate((el) => el.getBoundingClientRect().height);
  const inner = await frameOf(page)
    .locator("[data-embed-root]")
    .evaluate((el) => el.getBoundingClientRect().height);
  return { outer, inner };
}

/** The frame is as tall as what's in it (within a pixel of rounding). */
async function expectFitted(page: Page) {
  await expect(async () => {
    const { outer, inner } = await heights(page);
    expect(Math.abs(outer - inner)).toBeLessThanOrEqual(1);
  }).toPass();
}

test("inline: a guest books inside another site's page, and the site hears about it without the guest's details", async ({
  host,
  newGuest,
  db,
}) => {
  const page = await newGuest();
  await page.goto(site(`${host.username}/intro`, "inline"));
  const frame = frameOf(page);
  await openRoomyDay(frame);
  await expectFitted(page);

  // A site's own script forging MeetReady's messages: wrong origin, so embed.js ignores both.
  await page.evaluate(() => {
    const forged = { source: "meetready", version: 1 };
    window.postMessage({ ...forged, type: "resize", height: 5 }, "*");
    window.postMessage(
      { ...forged, type: "booked", username: "x", slug: "y", startsAt: "", endsAt: "" },
      "*",
    );
  });

  const time = (await timeButtons(frame).first().innerText()).split("\n")[0]!;
  await timeButtons(frame).first().click();
  await frame.getByRole("button", { name: "Continue" }).click();
  await expect(frame.getByRole("heading", { name: "Your details" })).toBeVisible();
  const email = guestEmail("Grace");
  await fillDetails(frame, "Grace Hopper", email);
  await frame.getByLabel(/Anything to share/).fill("A note only the host should read.");
  await expectFitted(page);
  const onDetails = (await heights(page)).outer;

  await frame.getByRole("button", { name: "Confirm booking" }).click();
  await expect(frame.getByRole("heading", { name: "You're booked with Sakif" })).toBeVisible();
  await expect(frame.getByRole("status")).toContainText(time);

  // 2. The confirmation is shorter than the form: the frame shrank to it (the min-height trap).
  await expectFitted(page);
  expect((await heights(page)).outer).toBeLessThan(onDetails);

  // 1. Exactly one event (the forged one never arrived), with the booking's times and nothing private.
  await expect(events(page)).toHaveCount(1);
  const detail = JSON.parse(await events(page).first().innerText());
  const { rows } = await db.query("select starts_at, ends_at from bookings where host_id = $1", [host.id]);
  expect(rows).toHaveLength(1);
  expect(detail).toEqual({
    username: host.username,
    slug: "intro",
    startsAt: rows[0].starts_at.toISOString(),
    endsAt: rows[0].ends_at.toISOString(),
  });
  const html = await page.content();
  expect(html).not.toContain(email);
  expect(html).not.toContain("only the host should read");
});

test("popup: Escape from inside the frame closes it, focus goes back, and what was typed is kept", async ({
  host,
  newGuest,
}) => {
  const page = await newGuest();
  await page.goto(site(`${host.username}/intro`, "popup"));
  const link = page.getByRole("link", { name: "Book a meeting" });
  const dialog = page.getByRole("dialog", { name: "Book a meeting" });

  await link.click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/127\.0\.0\.1/); // the click opened the popup, not the link
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();

  const frame = frameOf(page);
  await openRoomyDay(frame);
  await timeButtons(frame).first().click();
  await frame.getByRole("button", { name: "Continue" }).click();
  await frame.getByLabel("Name", { exact: true }).fill("Grace Hopper");

  // Focus is inside the frame: this keypress goes to MeetReady's document, never to the site's dialog.
  await frame.getByLabel("Name", { exact: true }).press("Escape");
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();

  // An accidental close loses nothing: the same frame comes back.
  await link.click();
  await expect(frame.getByLabel("Name", { exact: true })).toHaveValue("Grace Hopper");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  await expect(link).toBeFocused();
});

test("popup: without the script, the link is still a link to the booking page", async ({
  host,
  newGuest,
}) => {
  const page = await newGuest();
  // The script never runs (blocked, failed, still loading): an empty file stands in for all three.
  await page.route("**/embed.js", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
  await page.goto(site(`${host.username}/intro`, "popup"));
  await page.getByRole("link", { name: "Book a meeting" }).click();
  await expect(page).toHaveURL(new RegExp(`localhost:\\d+/${host.username}/intro$`));
  await expect(timeList(page)).toBeVisible();
});

test("an element added after load (React, Vue) is mounted, in the theme it asks for, on the site's background", async ({
  host,
  newGuest,
}) => {
  const page = await newGuest({ colorScheme: "light" });
  await page.goto(site(`${host.username}/intro`, "late", "dark"));
  const frame = frameOf(page);
  await expect(timeList(frame)).toBeVisible();
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  // See-through: no page background of its own, and a color-scheme on the iframe that matches the page
  // inside, without which the browser paints an opaque canvas behind the frame.
  expect(await frame.locator("body").evaluate((b) => getComputedStyle(b).backgroundColor)).toBe(
    "rgba(0, 0, 0, 0)",
  );
  expect(await iframe(page).evaluate((el) => getComputedStyle(el).colorScheme)).toBe("dark");
});

test("only /embed may be framed, and only for a real event type", async ({ host, request }) => {
  const embed = await request.get(`/embed/${host.username}/intro`);
  expect(embed.status()).toBe(200);
  expect(embed.headers()["content-security-policy"]).toBe("frame-ancestors *");
  expect(embed.headers()["x-frame-options"]).toBeUndefined();

  for (const path of [`/${host.username}/intro`, "/login", "/booking/not-a-real-token", "/privacy"]) {
    const res = await request.get(path);
    expect(res.headers()["content-security-policy"], path).toBe("frame-ancestors 'none'");
    expect(res.headers()["x-frame-options"], path).toBe("DENY");
  }

  // Same real 404 as the booking page (proxy.ts), not a 200 with a not-found message.
  expect((await request.get(`/embed/${host.username}/no-such-type`)).status()).toBe(404);
  expect((await request.get("/embed/nobody-here/intro")).status()).toBe(404);
});

test("the dashboard's Embed dialog gives both snippets, pointing at this deployment", async ({
  host,
  hostPage,
}) => {
  await hostPage.goto("/dashboard/event-types");
  const opener = hostPage.getByRole("button", { name: "Embed Intro call on your website" });
  await opener.click();
  const dialog = hostPage.getByRole("dialog", { name: "Put Intro call on your website" });
  const code = dialog.getByRole("region", { name: "Embed code" }).or(dialog.getByLabel("Embed code"));

  await expect(code).toContainText(`<div data-meetready-inline="${host.username}/intro"></div>`);
  await expect(code).toContainText(`src="${BASE_URL}/embed.js"`);

  await dialog.getByRole("tab", { name: "Popup" }).click();
  await dialog.getByRole("button", { name: "Dark" }).click();
  await expect(code).toContainText(`href="${BASE_URL}/${host.username}/intro"`);
  await expect(code).toContainText('data-meetready-theme="dark"');

  await hostPage.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
