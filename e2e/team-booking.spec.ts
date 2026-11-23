import { randomBytes } from "node:crypto";
import { createHost, expect, signInAs, test, waitForEmails, type Host } from "./fixtures";
import { fillDetails, guestEmail, openRoomyDay, timeButtons, timeList } from "./support/booking";

/*
 * Day 29: a collective team event type, end to end. Sakif works 9–5 in Dhaka
 * (03:00–11:00 UTC), Grace 9–5 in London (09:00–17:00 UTC): both only between
 * 09:00 and 11:00 UTC, which is 3–5 PM for a guest in Dhaka. What matters:
 *  1. The owner creates it with both as hosts; a member can't create one.
 *  2. A guest sees only the shared times, each host's clock, and books one.
 *  3. The booking blocks BOTH hosts (Grace's own page loses that time too),
 *     and the guest and both hosts are emailed.
 */

/** A team owned by `owner` with `member` in it, made directly in the database (Day 28 tests the UI). */
async function seedTeam(
  db: import("pg").Pool,
  owner: Host,
  member: Host,
): Promise<{ id: string; slug: string }> {
  const slug = `acme-${randomBytes(3).toString("hex")}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into teams (slug, name) values ($1, 'Acme Sales') returning id`,
    [slug],
  );
  const id = rows[0]!.id;
  await db.query(
    `insert into team_members (team_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')`,
    [id, owner.id, member.id],
  );
  return { id, slug };
}

test("a guest books a collective team meeting: only shared times, and every host is blocked and emailed", async ({
  host,
  hostPage,
  newGuest,
  db,
}) => {
  const grace = await createHost(db);
  await db.query(`update "user" set name = 'Grace Hopper', time_zone = 'Europe/London' where id = $1`, [
    grace.id,
  ]);
  const team = await seedTeam(db, host, grace);

  // 1. The owner creates it from the team's page; both hosts are ticked by default.
  await hostPage.goto(`/dashboard/teams/${team.id}`);
  await hostPage.getByRole("link", { name: "New team event type" }).click();
  await hostPage.getByLabel("Title").fill("Team intro");
  await expect(hostPage.getByText(`/team/${team.slug}/team-intro`)).toBeVisible();
  await expect(hostPage.getByRole("checkbox", { name: /Sakif Azwad/ })).toBeChecked();
  await expect(hostPage.getByRole("checkbox", { name: /Grace Hopper/ })).toBeChecked();
  await expect(hostPage.getByText("(organizer)")).toBeVisible();
  await hostPage.getByRole("button", { name: "Create event type" }).click();
  await expect(hostPage).toHaveURL(new RegExp(`/dashboard/teams/${team.id}$`));
  await expect(hostPage.getByText(`/team/${team.slug}/team-intro`, { exact: true })).toBeVisible();
  await expect(hostPage.getByText("30 min with Sakif Azwad, Grace Hopper")).toBeVisible();

  // A member can't: the same 404 as a page that doesn't exist.
  const gracePage = await newGuest();
  await signInAs(gracePage.context(), grace);
  await gracePage.goto(`/dashboard/teams/${team.id}/event-types/new`);
  await expect(gracePage.getByRole("heading", { name: "This page could not be found." })).toBeVisible();

  // 2. The guest (in Dhaka) sees each host's clock and only 3:00–4:30 PM starts.
  const guest = await newGuest();
  await guest.goto(`/team/${team.slug}`);
  await guest.getByRole("link", { name: /Team intro/ }).click();
  await expect(guest).toHaveURL(`/team/${team.slug}/team-intro`);
  await expect(guest.getByText("Sakif's time")).toBeVisible();
  await expect(guest.getByText("Grace's time")).toBeVisible();
  const day = await openRoomyDay(guest);
  expect(await timeButtons(guest).allInnerTexts()).toEqual(
    expect.arrayContaining([expect.stringMatching(/^3:00 PM/), expect.stringMatching(/^4:30 PM/)]),
  );
  expect(await timeButtons(guest).count()).toBe(4);

  await timeButtons(guest).first().click();
  await guest.getByRole("button", { name: "Continue" }).click();
  const email = guestEmail("Ada");
  await fillDetails(guest, "Ada Lovelace", email);
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByRole("heading", { name: "You're booked with Acme Sales" })).toBeVisible();

  // 3. One booking, a row for each host.
  const { rows } = await db.query<{ host_id: string }>(
    `select bh.host_id from booking_hosts bh join bookings b on b.id = bh.booking_id
     where b.guest_email = $1 and bh.active order by bh.host_id`,
    [email],
  );
  expect(rows.map((r) => r.host_id).sort()).toEqual([host.id, grace.id].sort());

  // Grace's OWN booking page no longer offers 3:00 PM (Dhaka) that day, though she isn't the organizer.
  const other = await newGuest();
  await other.goto(`/${grace.username}/intro`);
  await expect(timeList(other)).toBeVisible();
  await other.getByRole("button", { name: new RegExp(`^${day}, `) }).click();
  await expect(timeButtons(other).first()).toBeVisible();
  expect(await timeButtons(other).allInnerTexts()).not.toContainEqual(expect.stringMatching(/^3:00 PM/));

  // The guest's email names both hosts; each host gets their own.
  const [guestMail] = await waitForEmails(email, 1);
  expect(guestMail!.html).toContain("Sakif Azwad and Grace Hopper");
  await waitForEmails(host.email, 1);
  await waitForEmails(grace.email, 1);
});

test("team pages that don't exist are real 404s", async ({ host, db, request }) => {
  const grace = await createHost(db);
  const team = await seedTeam(db, host, grace);
  expect((await request.get(`/team/${team.slug}`)).status()).toBe(200);
  expect((await request.get(`/team/${team.slug}/nothing-here`)).status()).toBe(404);
  expect((await request.get("/team/no-such-team")).status()).toBe(404);
});
