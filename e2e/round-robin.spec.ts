import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createHost, expect, signInAs, test, waitForEmails, type Host } from "./fixtures";
import { fillDetails, guestEmail, openRoomyDay, timeButtons } from "./support/booking";

/*
 * Day 31: a round-robin team event type, end to end. Sakif works 9–5 in Dhaka,
 * Grace 9–5 in London (3–11 PM in Dhaka). What matters:
 *  1. The owner picks "One of them, shared fairly" when creating it.
 *  2. The guest (in Dhaka) sees when ANYONE is free (9 AM to 11 PM), and who
 *     they might meet, not every host's clock.
 *  3. Two guests book the same time when both are free: one gets Sakif, the
 *     other Grace, and each confirmation names who they got.
 *  4. The team page shows the turns: one each.
 */

async function seedTeam(db: import("pg").Pool, owner: Host, member: Host) {
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

/** Books 3:00 PM (Dhaka) on `day`, when both hosts work. Returns the confirmation's heading. */
async function bookThreePm(guest: Page, path: string, day: string | null, name: string) {
  await guest.goto(path);
  const picked = day ?? (await openRoomyDay(guest, 24)); // a near-whole day, so 3:00 PM isn't past
  if (day) await guest.getByRole("button", { name: new RegExp(`^${day}, `) }).click();
  await timeButtons(guest)
    .filter({ hasText: /^3:00 PM/ })
    .click();
  await guest.getByRole("button", { name: "Continue" }).click();
  const email = guestEmail(name);
  await fillDetails(guest, name, email);
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  const heading = guest.getByRole("heading", { name: /^You're booked with/ });
  await expect(heading).toBeVisible();
  return { day: picked, email, heading: await heading.innerText() };
}

test("round-robin: anyone's free times, one host per booking, shared in turn", async ({
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

  // 1. Created as round-robin.
  await hostPage.goto(`/dashboard/teams/${team.id}`);
  await hostPage.getByRole("link", { name: "New team event type" }).click();
  await hostPage.getByLabel("Title").fill("Demo");
  await hostPage.getByRole("radio", { name: /One of them, shared fairly/ }).check();
  await expect(hostPage.getByText("(organizer)")).toHaveCount(0); // no organizer: each booking has one host
  await hostPage.getByRole("button", { name: "Create event type" }).click();
  await expect(hostPage).toHaveURL(new RegExp(`/dashboard/teams/${team.id}$`));
  await expect(hostPage.getByText("Last 30 days: Sakif 0, Grace 0")).toBeVisible();

  // 2. The guest sees anyone's hours, and who they might meet.
  const path = `/team/${team.slug}/demo`;
  const first = await newGuest();
  await first.goto(path);
  await expect(first.getByText("One of Sakif Azwad or Grace Hopper")).toBeVisible();
  await expect(first.getByText("Grace's time")).toHaveCount(0);
  await openRoomyDay(first, 24);
  await expect(first.getByText("Someone on the team is working 9 AM–11 PM your time.")).toBeVisible();
  const times = await timeButtons(first).allInnerTexts();
  expect(times).toContainEqual(expect.stringMatching(/^9:00 AM/)); // Sakif only
  expect(times).toContainEqual(expect.stringMatching(/^7:30 PM/)); // Grace only (later ones fold away: night)

  // 3. Same time, twice: one each, and each confirmation says who.
  const a = await bookThreePm(first, path, null, "Ada Lovelace");
  const b = await bookThreePm(await newGuest(), path, a.day, "Alan Turing");
  expect([a.heading, b.heading].sort()).toEqual([
    "You're booked with Grace Hopper",
    "You're booked with Sakif Azwad",
  ]);
  const { rows } = await db.query<{ host_id: string; hosts: number }>(
    `select b.host_id, (select count(*)::int from booking_hosts bh where bh.booking_id = b.id) as hosts
     from bookings b where b.guest_email = any($1)`,
    [[a.email, b.email]],
  );
  expect(rows.map((r) => r.host_id).sort()).toEqual([host.id, grace.id].sort());
  expect(rows.every((r) => r.hosts === 1)).toBe(true);
  // The guest's email names their host, not the team.
  const sakifsGuest = a.heading.endsWith("Sakif Azwad") ? a.email : b.email;
  expect((await waitForEmails(sakifsGuest, 1))[0]!.html).toContain("booked with Sakif");

  // 4. One each, on the team page; Grace's meeting is on her own Bookings page.
  await hostPage.reload();
  await expect(hostPage.getByText("Last 30 days: Sakif 1, Grace 1")).toBeVisible();
  const gracePage = await newGuest();
  await signInAs(gracePage.context(), grace);
  await gracePage.goto("/dashboard/bookings");
  await expect(gracePage.getByText(/^Demo with (Ada Lovelace|Alan Turing)$/)).toHaveCount(1);
});
