import { chooseTime, fillDetails, guestEmail } from "./support/booking";
import { connectCalendar, expect, fakeGoogle, test } from "./fixtures";

/*
 * Google Calendar (Day 15), against a fake Google (e2e/support/fake-google.mjs).
 * The host's calendar is "connected" by seeding what the consent screen would
 * leave behind (fixtures.ts): the real OAuth screen can't run in CI.
 */

const DAY = 24 * 60 * 60_000;

test("times that are busy in the host's Google Calendar aren't offered", async ({ host, db, request }) => {
  const token = await connectCalendar(db, host);
  const now = Date.now();
  const busyUntil = new Date(now + 3 * DAY);
  await fakeGoogle.setCalendar(token, {
    busy: [{ start: new Date(now - DAY).toISOString(), end: busyUntil.toISOString() }],
  });

  const from = new Date(now).toISOString();
  const to = new Date(now + 30 * DAY).toISOString();
  const res = await request.get(`/api/slots?username=${host.username}&slug=intro&from=${from}&to=${to}`);
  expect(res.status()).toBe(200);
  const { slots } = (await res.json()) as { slots: { start: string }[] };

  expect(slots.length).toBeGreaterThan(0); // the host still has free time after that
  for (const s of slots) expect(new Date(s.start).getTime()).toBeGreaterThanOrEqual(busyUntil.getTime());
});

test("Google down at the moment of booking: refused, details kept, host told; then it books", async ({
  host,
  db,
  newGuest,
  hostPage,
}) => {
  const token = await connectCalendar(db, host);
  const guest = await newGuest();
  await chooseTime(guest, host); // times load while Google is up
  await fillDetails(guest, "Ada Lovelace", guestEmail("Ada"));

  await fakeGoogle.setCalendar(token, { down: true });
  await guest.getByRole("button", { name: "Confirm booking" }).click();

  await expect(guest.getByText(/couldn't check the host's calendar/)).toBeVisible();
  await expect(guest.getByLabel("Name", { exact: true })).toHaveValue("Ada Lovelace");
  const count = async () =>
    (await db.query("select count(*)::int as n from bookings where host_id = $1", [host.id])).rows[0].n;
  expect(await count()).toBe(0);

  // The host sees why, on the Availability page.
  await hostPage.goto("/dashboard/availability");
  await expect(hostPage.getByText("New bookings are paused.")).toBeVisible();

  // Google is back: the same click books, and the warning clears.
  await fakeGoogle.setCalendar(token, { down: false, busy: [] });
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByRole("heading", { name: /^You're booked/ })).toBeVisible();
  expect(await count()).toBe(1);
  await hostPage.reload();
  await expect(hostPage.getByText(/Connected to the primary calendar of/)).toBeVisible();
  await expect(hostPage.getByText("New bookings are paused.")).toBeHidden();
});

test("the host disconnects: access is revoked at Google and the tokens are forgotten", async ({
  host,
  db,
  hostPage,
}) => {
  const token = await connectCalendar(db, host);
  await hostPage.goto("/dashboard/availability");
  await expect(hostPage.getByText(/Connected to the primary calendar of/)).toContainText(host.email);

  await hostPage.getByRole("button", { name: "Disconnect" }).click();
  await expect(hostPage.getByRole("button", { name: "Connect Google Calendar" })).toBeVisible();

  expect(await fakeGoogle.wasRevoked(token)).toBe(true);
  const { rows } = await db.query(
    `select a.access_token, a.refresh_token, a.scope,
            (select count(*)::int from calendar_connections where user_id = $1) as connections
     from account a where a.user_id = $1`,
    [host.id],
  );
  expect(rows).toEqual([
    { access_token: null, refresh_token: null, scope: "openid,email,profile", connections: 0 },
  ]);
});
