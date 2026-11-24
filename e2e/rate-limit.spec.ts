import { book, chooseTime, fillDetails, guestEmail } from "./support/booking";
import { expect, test } from "./fixtures";

/*
 * Rate limits (Day 14). The E2E server has no Redis, so this runs on the
 * in-memory limiter: same rules and algorithm as Upstash in production.
 * Each visitor has their own IP (see fixtures.ts), so nothing here affects
 * other tests.
 */

const TOO_MANY = /^Too many attempts\. Please try again in (a minute|\d+ minutes)\.$/;

/**
 * Starts a burst early in a limiter window, so it can't straddle two of them.
 *
 * Why (Day 29 story 6, a CI failure): the sliding window counts the previous
 * window's hits times the share of it still inside the last `windowMs`,
 * rounded DOWN (limits.ts). Sixty calls split across 13:59 and 14:00 therefore
 * count as 59 or fewer, and the 61st gets through. Windows are aligned to the
 * clock (minutes, 10-minute blocks), and the E2E server runs on this machine,
 * so the test can see where the server's window is. If less than `need` ms is
 * left in it, wait for the next one. Never a retry: the burst is made to fit.
 */
async function startEarlyInWindow(windowMs: number, need: number) {
  const left = windowMs - (Date.now() % windowMs);
  if (left < need) await new Promise((resolve) => setTimeout(resolve, left + 250));
}

test("the 6th booking from one connection in 10 minutes is refused, with the details kept", async ({
  host,
  newGuest,
  db,
}) => {
  // Six bookings take well under 2 minutes; the window is 10 minutes (worst case: a 2-minute wait).
  test.setTimeout(5 * 60_000);
  await startEarlyInWindow(10 * 60_000, 2 * 60_000);
  const guest = await newGuest(); // one IP for all six attempts
  for (const name of ["Ada", "Grace", "Alan", "Edsger", "Barbara"]) {
    await book(guest, host, `${name} Guest`, guestEmail(name));
  }

  await chooseTime(guest, host);
  const email = guestEmail("Six");
  await fillDetails(guest, "Guest Six", email);
  await guest.getByRole("button", { name: "Confirm booking" }).click();

  // By text: Next's route announcer is also role="alert".
  await expect(guest.getByText(TOO_MANY)).toBeVisible();
  // Still on the form, nothing lost: they can retry later without retyping.
  await expect(guest.getByLabel("Name", { exact: true })).toHaveValue("Guest Six");
  await expect(guest.getByLabel("Email", { exact: true })).toHaveValue(email);

  const { rows } = await db.query("select count(*)::int as n from bookings where host_id = $1", [host.id]);
  expect(rows[0].n).toBe(5);

  // A different visitor isn't affected.
  await book(await newGuest(), host, "Someone Else", guestEmail("else"));
});

test("the slots API answers 429 with Retry-After after 60 calls a minute", async ({ request }) => {
  // 61 calls take a second or two (more on a busy CI runner); the window is a clock minute.
  test.setTimeout(2 * 60_000);
  await startEarlyInWindow(60_000, 20_000);
  // Bad parameters on purpose: the limit is checked before anything else, so no database work.
  const call = () => request.get("/api/slots?username=x&slug=y&from=bad&to=bad");
  for (let i = 0; i < 60; i++) expect((await call()).status()).toBe(400);

  const refused = await call();
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  expect(refused.headers()["cache-control"]).toBe("no-store");
});
