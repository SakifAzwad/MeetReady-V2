import { book, chooseTime, fillDetails, guestEmail } from "./support/booking";
import { expect, test } from "./fixtures";

/*
 * Rate limits (Day 14). The E2E server has no Redis, so this runs on the
 * in-memory limiter: same rules and algorithm as Upstash in production.
 * Each visitor has their own IP (see fixtures.ts), so nothing here affects
 * other tests.
 */

const TOO_MANY = /^Too many attempts\. Please try again in (a minute|\d+ minutes)\.$/;

test("the 6th booking from one connection in 10 minutes is refused, with the details kept", async ({
  host,
  newGuest,
  db,
}) => {
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
  // Bad parameters on purpose: the limit is checked before anything else, so no database work.
  const call = () => request.get("/api/slots?username=x&slug=y&from=bad&to=bad");
  for (let i = 0; i < 60; i++) expect((await call()).status()).toBe(400);

  const refused = await call();
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()["retry-after"])).toBeGreaterThan(0);
  expect(refused.headers()["cache-control"]).toBe("no-store");
});
