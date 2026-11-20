import { randomUUID } from "node:crypto";
import type { APIResponse } from "@playwright/test";
import { emailsTo, expect, test, waitForEmails } from "./fixtures";
import { book, guestEmail, openRoomyDay, timeButtons } from "./support/booking";

/*
 * Day 25, Part B: the host's Move button. The booking widget in a host mode,
 * the slots API freeing the booking's own time only for its host, and the
 * guest-only email ("Sakif moved your meeting").
 */

test("the host moves a guest's booking from the Bookings page", async ({ host, hostPage, newGuest, db }) => {
  const email = guestEmail("Ada");
  await book(await newGuest(), host, "Ada Lovelace", email);
  await waitForEmails(email, 1);
  await waitForEmails(host.email, 1);
  const [before] = (await db.query("select starts_at from bookings where host_id = $1", [host.id])).rows;

  await hostPage.goto("/dashboard/bookings");
  await hostPage.getByRole("link", { name: "Move the meeting with Ada Lovelace" }).click();
  await expect(hostPage.getByRole("heading", { name: "Move a meeting", level: 1 })).toBeVisible();
  await expect(hostPage.getByText(/^Moving your meeting with Ada Lovelace from/)).toBeVisible();
  await openRoomyDay(hostPage);
  // Not the first time: that's the meeting's own time (it doesn't block itself when moving).
  await timeButtons(hostPage).nth(2).click();
  await hostPage.getByRole("button", { name: "Continue" }).click();
  await expect(hostPage.getByRole("heading", { name: "Move your meeting with Ada Lovelace?" })).toBeVisible();
  await hostPage.getByRole("button", { name: "Confirm new time" }).click();
  await expect(hostPage.getByRole("heading", { name: "Meeting moved" })).toBeVisible();
  await expect(
    hostPage.getByText("Ada Lovelace gets an email from MeetReady with the new time."),
  ).toBeVisible();

  const [after] = (
    await db.query("select starts_at, rescheduled_by, changed_by_client from bookings where host_id = $1", [
      host.id,
    ])
  ).rows;
  expect(after.starts_at).not.toEqual(before.starts_at);
  expect(after).toMatchObject({ rescheduled_by: "host", changed_by_client: null });

  // The guest is told the host moved it, with the link to change it again.
  const moved = (await waitForEmails(email, 2)).at(-1)!;
  expect(moved.html).toContain("Sakif moved your meeting");
  expect(moved.html).toContain("/booking/");
  // No receipt for the host: they did it themselves (one email so far, the booking's).
  expect(emailsTo(host.email)).toHaveLength(1);

  await hostPage.goto("/dashboard/bookings");
  await expect(hostPage.getByText("Moved by you", { exact: true })).toBeVisible();
});

test("only the booking's own host can free its time or open its Move page", async ({
  host,
  hostPage,
  request,
  newGuest,
  db,
}) => {
  await book(await newGuest(), host, "Ada Lovelace", guestEmail("Ada"));
  const [b] = (await db.query("select id, starts_at from bookings where host_id = $1", [host.id])).rows;
  const own = (b.starts_at as Date).toISOString();
  const query = (move?: string) =>
    `/api/slots?${new URLSearchParams({
      username: host.username,
      slug: "intro",
      from: new Date(b.starts_at.getTime() - 3_600_000).toISOString(),
      to: new Date(b.starts_at.getTime() + 3_600_000).toISOString(),
      ...(move ? { move } : {}),
    })}`;
  const starts = async (res: APIResponse) =>
    ((await res.json()) as { slots: { start: string }[] }).slots.map((s) => s.start);

  // Normally the booking's own time is taken.
  expect(await starts(await request.get(query()))).not.toContain(own);
  // Its host, signed in, moving it: free.
  expect(await starts(await hostPage.request.get(query(b.id)))).toContain(own);
  // Anyone else sending the same id: ignored (no session here), like a wrong guest token.
  expect(await starts(await request.get(query(b.id)))).not.toContain(own);

  // A booking id that isn't this host's is a not-found page, not a way in.
  await hostPage.goto(`/dashboard/bookings/${randomUUID()}/move`);
  await expect(hostPage.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
});
