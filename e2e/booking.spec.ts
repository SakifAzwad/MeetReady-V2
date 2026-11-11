import { book, chooseTime, fillDetails, guestEmail, timeButtons } from "./support/booking";
import { expect, test, waitForEmails } from "./fixtures";

test("a guest books a time from the host's profile, and it's gone for the next guest", async ({
  host,
  newGuest,
  db,
}) => {
  const guest = await newGuest();
  await guest.goto(`/${host.username}`);
  await guest.getByRole("link", { name: /Intro call/ }).click();
  await expect(guest).toHaveURL(`/${host.username}/intro`);

  const time = await chooseTime(guest, host);

  // The browser's checks first: nothing typed yet.
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByText("Enter your name")).toBeVisible();

  await fillDetails(guest, "Ada Lovelace", guestEmail("Ada"));
  await guest.getByLabel(/Anything to share/).fill("Looking forward to it.");
  await guest.getByRole("button", { name: "Confirm booking" }).click();

  const confirmation = guest.getByRole("status");
  await expect(guest.getByRole("heading", { name: "You're booked with Sakif" })).toBeVisible();
  await expect(confirmation).toContainText(time);
  await expect(confirmation).toContainText("A confirmation with a calendar invite is on its way");

  const { rows } = await db.query("select guest_name, guest_notes from bookings where host_id = $1", [
    host.id,
  ]);
  expect(rows).toEqual([{ guest_name: "Ada Lovelace", guest_notes: "Looking forward to it." }]);

  // A second guest no longer sees that time.
  const next = await newGuest();
  await next.goto(`/${host.username}/intro`);
  await expect(timeButtons(next).first()).toBeVisible();
  expect(await timeButtons(next).allInnerTexts()).not.toContain(time);
});

test("two guests confirm the same time at once: exactly one gets it", async ({ host, newGuest, db }) => {
  const [a, b] = [await newGuest(), await newGuest()];
  const timeA = await chooseTime(a, host);
  const timeB = await chooseTime(b, host);
  expect(timeA).toBe(timeB);
  await fillDetails(a, "Guest A", guestEmail("A"));
  await fillDetails(b, "Guest B", guestEmail("B"));

  // Both clicks go out together; the per-host lock and the exclusion constraint decide.
  await Promise.all([a, b].map((p) => p.getByRole("button", { name: "Confirm booking" }).click()));

  const outcome = (page: typeof a) =>
    Promise.race([
      page
        .getByRole("heading", { name: /^You're booked/ })
        .waitFor()
        .then(() => "booked"),
      page
        .getByText(/Someone just booked that time/)
        .waitFor()
        .then(() => "told it was taken"),
    ]);
  expect((await Promise.all([outcome(a), outcome(b)])).sort()).toEqual(["booked", "told it was taken"]);

  // The loser's details are kept for their next try (Day 9).
  const loser = (await a.getByText(/Someone just booked/).isVisible()) ? a : b;
  await expect(loser.getByText("your details are kept")).toBeVisible();

  const { rows } = await db.query("select count(*)::int as n from bookings where host_id = $1", [host.id]);
  expect(rows[0].n).toBe(1);
});

test("switched-off event types and unknown hosts are not found", async ({ host, newGuest, db }) => {
  const guest = await newGuest();
  await guest.goto("/nobody-here-at-all");
  await expect(guest.getByRole("heading", { name: "This page could not be found." })).toBeVisible();

  await db.query("update event_types set is_active = false where id = $1", [host.eventTypeId]);
  await guest.goto(`/${host.username}/intro`);
  await expect(guest.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
  await guest.goto(`/${host.username}`);
  await expect(guest.getByText("No meetings available to book right now.")).toBeVisible();
});

test("the slots API rejects bad input", async ({ request, host }) => {
  const base = `/api/slots?username=${host.username}&slug=intro`;
  // A two-year range is refused (at most 62 days per request).
  expect((await request.get(`${base}&from=2026-11-01T00:00:00Z&to=2028-11-01T00:00:00Z`)).status()).toBe(400);
  expect(
    (
      await request.get(
        `/api/slots?username=${host.username}&slug=nope&from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z`,
      )
    ).status(),
  ).toBe(404);
});

test("booking emails: guest and host each get one with a calendar invite", async ({ host, newGuest }) => {
  const email = guestEmail("Grace");
  await book(await newGuest(), host, "Grace Hopper", email);
  const [guestMail] = await waitForEmails(email, 1);
  const [hostMail] = await waitForEmails(host.email, 1);
  expect(guestMail!.ics).toContain("METHOD:REQUEST");
  expect(guestMail!.html).toMatch(/\/booking\/[A-Za-z0-9_-]{43}/); // the guest's manage link
  expect(hostMail!.html).not.toMatch(/\/booking\/[A-Za-z0-9_-]{43}/); // the host never gets it
  expect(hostMail!.html).toContain(email);
});
