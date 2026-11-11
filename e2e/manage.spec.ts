import { book, guestEmail, timeButtons } from "./support/booking";
import { expect, test, waitForEmails } from "./fixtures";

const MANAGE_LINK = /href="(http:\/\/localhost:\d+\/booking\/[A-Za-z0-9_-]{43})"/;

test("a guest reschedules, then cancels, from the link in their email", async ({ host, newGuest, db }) => {
  const email = guestEmail("Ada");
  const guest = await newGuest();
  await book(guest, host, "Ada Lovelace", email);

  const [confirmation] = await waitForEmails(email, 1);
  const manageUrl = confirmation!.html.match(MANAGE_LINK)?.[1];
  expect(manageUrl, "manage link in the guest's email").toBeTruthy();
  const uid = confirmation!.ics!.match(/UID:(.+)/)?.[1]?.trim();

  // The manage page is private: never indexed, never leaks its URL as a referrer.
  const response = await guest.goto(manageUrl!);
  expect(response?.status()).toBe(200);
  await expect(guest.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(guest.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");

  // ─── Reschedule ───
  await guest.getByRole("button", { name: /Reschedule/ }).click();
  await expect(guest.getByText(/^Moving your meeting from/)).toBeVisible();
  const [before] = (await db.query("select starts_at from bookings where host_id = $1", [host.id])).rows;
  // Not the first time: that's the meeting's own time (it doesn't block itself when moving).
  await timeButtons(guest).nth(2).click();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("button", { name: "Confirm new time" }).click();
  await expect(guest.getByRole("heading", { name: "Your meeting has moved" })).toBeVisible();

  const [moved] = (await db.query("select starts_at, sequence from bookings where host_id = $1", [host.id]))
    .rows;
  expect(moved.starts_at).not.toEqual(before.starts_at);
  expect(moved.sequence).toBe(1);

  // The new invite updates the old event: same UID, higher SEQUENCE.
  const update = (await waitForEmails(email, 2)).at(-1)!;
  expect(update.ics).toContain(`UID:${uid}`);
  expect(update.ics).toContain("SEQUENCE:1");
  await waitForEmails(host.email, 2);

  // ─── Cancel ───
  await guest.goto(manageUrl!);
  await guest.getByRole("button", { name: /^Cancel/ }).click();
  await guest.getByLabel("Reason").fill("Found a time with the team instead");
  await guest.getByRole("button", { name: "Cancel meeting" }).click();
  await expect(guest.getByRole("heading", { name: "This meeting is cancelled" })).toBeVisible();
  await expect(guest.getByText("Reason: Found a time with the team instead")).toBeVisible();

  const cancelled = (await waitForEmails(email, 3)).at(-1)!;
  expect(cancelled.ics).toContain("METHOD:CANCEL");
  // The host is told, with the reason.
  const hostNotice = (await waitForEmails(host.email, 3)).at(-1)!;
  expect(hostNotice.html).toContain("Found a time with the team instead");
});

test("the host cancels from the dashboard, and only the guest is emailed", async ({
  host,
  hostPage,
  newGuest,
}) => {
  const email = guestEmail("Grace");
  await book(await newGuest(), host, "Grace Hopper", email);
  await waitForEmails(email, 1);
  await waitForEmails(host.email, 1);

  await hostPage.goto("/dashboard/bookings");
  const card = hostPage.getByRole("listitem").filter({ hasText: "Grace Hopper" });
  await card.getByRole("button", { name: "Cancel" }).click();
  await card.getByLabel("Cancel with Grace Hopper?").fill("Sorry, I'm travelling that day");
  await card.getByRole("button", { name: "Cancel meeting" }).click();
  await expect(card).toHaveCount(0); // gone from "Upcoming"

  await hostPage.goto("/dashboard/bookings?view=cancelled");
  await expect(hostPage.getByText("Cancelled by you: Sorry, I'm travelling that day")).toBeVisible();

  const notice = (await waitForEmails(email, 2)).at(-1)!;
  expect(notice.ics).toContain("METHOD:CANCEL");
  expect(notice.html).toContain("Sorry, I&#x27;m travelling that day");
  // The host did it, so the host gets no email about it.
  await hostPage.waitForTimeout(500);
  expect((await waitForEmails(host.email, 1)).length).toBe(1);
});

test("a made-up manage link is not found", async ({ newGuest }) => {
  const guest = await newGuest();
  await guest.goto(`/booking/${"x".repeat(43)}`);
  await expect(guest.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
});
