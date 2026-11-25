import { randomBytes } from "node:crypto";
import {
  connectCalendar,
  createHost,
  emailsTo,
  expect,
  fakeGoogle,
  signInAs,
  test,
  waitForEmails,
  type Host,
} from "./fixtures";
import { fillDetails, guestEmail, openRoomyDay, timeButtons } from "./support/booking";

/*
 * Day 30: a team meeting for every host, end to end. Sakif (Dhaka, the
 * organizer, Google connected) and Grace (London) share 09:00–11:00 UTC,
 * 3–5 PM for the guest in Dhaka. What matters:
 *  1. The team's page speaks for everyone ("Everyone is working …").
 *  2. One Google event, in Sakif's calendar, with Grace invited (Google emails her).
 *  3. The guest moves it from their link: every host's row moves, and the event.
 *  4. Grace sees it on her own Bookings page, moves it herself, and the
 *     guest and Sakif are told it was Grace; Grace isn't emailed about her own move.
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

const MANAGE_LINK = /href="(http:\/\/localhost:\d+\/booking\/[A-Za-z0-9_-]{43})"/;

test("a team meeting for every host: Google invites the co-host, the guest moves it, then the co-host does", async ({
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
  const token = await connectCalendar(db, host);

  await hostPage.goto(`/dashboard/teams/${team.id}`);
  await hostPage.getByRole("link", { name: "New team event type" }).click();
  await hostPage.getByLabel("Title").fill("Team intro");
  await hostPage.getByRole("button", { name: "Create event type" }).click();
  await expect(hostPage.getByText(`/team/${team.slug}/team-intro`, { exact: true })).toBeVisible();

  // 1. The band speaks for everyone, on the guest's clock: never "Sakif works … in Dhaka".
  const guest = await newGuest();
  await guest.goto(`/team/${team.slug}/team-intro`);
  await openRoomyDay(guest);
  await expect(guest.getByText("Everyone is working 3–5 PM your time.", { exact: true })).toBeVisible();
  await expect(guest.getByText("Hosts in Dhaka and London")).toBeVisible();
  await timeButtons(guest).first().click();
  await guest.getByRole("button", { name: "Continue" }).click();
  const email = guestEmail("Ada");
  await fillDetails(guest, "Ada Lovelace", email);
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByRole("heading", { name: "You're booked with Acme Sales" })).toBeVisible();

  // 2. One event in the organizer's calendar, Grace invited, and Google asked to email her.
  await expect
    .poll(async () => (await fakeGoogle.events(token)).map((e) => e.attendees))
    .toEqual([[{ email: grace.email, displayName: "Grace Hopper" }]]);
  const [created] = await fakeGoogle.events(token);
  expect(created).toMatchObject({ sendUpdates: "all" });
  // Her email from MeetReady skips the .ics once Google has it (she's invited there).
  const [graceFirst] = await waitForEmails(grace.email, 1);
  expect(graceFirst!.ics).toBeNull();

  // 3. The guest moves it from the link in their email.
  const [confirmation] = await waitForEmails(email, 1);
  await guest.goto(confirmation!.html.match(MANAGE_LINK)![1]!);
  await guest.getByRole("button", { name: /Reschedule/ }).click();
  await expect(guest.getByText(/^Moving your meeting from/)).toBeVisible();
  await openRoomyDay(guest);
  await timeButtons(guest).nth(2).click(); // not the first: that's its own time
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("button", { name: "Confirm new time" }).click();
  await expect(guest.getByRole("heading", { name: "Your meeting has moved" })).toBeVisible();

  const hostRows = async () =>
    (
      await db.query<{ host_id: string; starts_at: Date; b_start: Date }>(
        `select bh.host_id, bh.starts_at, b.starts_at as b_start
         from booking_hosts bh join bookings b on b.id = bh.booking_id where b.guest_email = $1`,
        [email],
      )
    ).rows;
  const afterGuest = await hostRows();
  expect(afterGuest).toHaveLength(2);
  expect(afterGuest.every((r) => r.starts_at.getTime() === r.b_start.getTime())).toBe(true);
  await expect
    .poll(async () => (await fakeGoogle.events(token))[0]?.start.dateTime)
    .toBe(afterGuest[0]!.b_start.toISOString());
  await waitForEmails(grace.email, 2); // told about the guest's move

  // 4. Grace's own Bookings page: the team, who else is in it, and a Move button.
  const gracePage = await newGuest();
  await signInAs(gracePage.context(), grace);
  await gracePage.goto("/dashboard/bookings");
  await expect(gracePage.getByText("Team intro with Ada Lovelace")).toBeVisible();
  await expect(gracePage.getByText("Acme Sales, with Sakif Azwad")).toBeVisible();
  await expect(gracePage.getByText("Moved by guest", { exact: true })).toBeVisible();
  await gracePage.getByRole("link", { name: "Move the meeting with Ada Lovelace" }).click();
  await expect(gracePage.getByRole("heading", { name: "Move a meeting", level: 1 })).toBeVisible();
  await openRoomyDay(gracePage);
  await timeButtons(gracePage).first().click(); // back to 3:00 PM
  await gracePage.getByRole("button", { name: "Continue" }).click();
  await gracePage.getByRole("button", { name: "Confirm new time" }).click();
  await expect(gracePage.getByRole("heading", { name: "Meeting moved" })).toBeVisible();

  const [{ changed_by_host_id }] = (
    await db.query(`select changed_by_host_id from bookings where guest_email = $1`, [email])
  ).rows;
  expect(changed_by_host_id).toBe(grace.id);
  // The guest and the organizer hear it was Grace; Grace isn't emailed about her own move.
  expect((await waitForEmails(email, 3)).at(-1)!.html).toContain("Grace moved your meeting");
  expect((await waitForEmails(host.email, 3)).at(-1)!.html).toContain(
    "Grace moved your meeting with Ada Lovelace",
  );
  expect(emailsTo(grace.email)).toHaveLength(2);

  // The organizer's Bookings page names her too.
  await hostPage.goto("/dashboard/bookings");
  await expect(hostPage.getByText("Moved by Grace", { exact: true })).toBeVisible();
  await expect(hostPage.getByText("Acme Sales, with Grace Hopper")).toBeVisible();
});
