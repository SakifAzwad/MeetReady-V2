import { book, guestEmail, timeButtons } from "./support/booking";
import { connectCalendar, emailsTo, expect, fakeGoogle, test, waitForEmails } from "./fixtures";

/*
 * Day 16: bookings written to the host's Google Calendar, against the fake
 * Google (e2e/support/fake-google.mjs), which, like Google, counts the events
 * MeetReady writes as busy time.
 */

const MANAGE_LINK = /href="(http:\/\/localhost:\d+\/booking\/[A-Za-z0-9_-]{43})"/;

test("a booking becomes an event with a Meet link; moving it moves the event; cancelling removes it", async ({
  host,
  db,
  newGuest,
}) => {
  const token = await connectCalendar(db, host);
  await db.query(
    "update event_types set location_type = 'google_meet', location_value = null where user_id = $1",
    [host.id],
  );
  const email = guestEmail("Ada");
  const guest = await newGuest();
  const bookedTime = await book(guest, host, "Ada Lovelace", email);

  // The event appears (written after the guest already saw "You're booked").
  await expect.poll(async () => (await fakeGoogle.events(token)).length).toBe(1);
  const [event] = await fakeGoogle.events(token);
  expect(event!.summary).toBe("Intro call with Ada Lovelace");
  expect(event!.description).toContain(email);
  expect(event!.attendees).toBeUndefined(); // the guest gets OUR invite, not a second one from Google
  const meetUrl = event!.conferenceData!.entryPoints[0]!.uri;

  // The emails carry the Meet link; the host's has no .ics (it's already in their calendar).
  const [confirmation] = await waitForEmails(email, 1);
  expect(confirmation!.html).toContain(meetUrl);
  const [hostEmail] = await waitForEmails(host.email, 1);
  expect(hostEmail!.html).toContain(meetUrl);
  expect(hostEmail!.ics).toBeNull();

  // The guest's page links to the meeting.
  const manageUrl = confirmation!.html.match(MANAGE_LINK)![1]!;
  await guest.goto(manageUrl);
  await expect(guest.getByRole("link", { name: "Join with Google Meet" })).toHaveAttribute("href", meetUrl);

  // Reschedule. The booking's own event is busy in Google, yet its time is still offered:
  // it doesn't block itself.
  await guest.getByRole("button", { name: /Reschedule/ }).click();
  await expect(timeButtons(guest).first()).toContainText(bookedTime);
  await timeButtons(guest).nth(2).click();
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByRole("button", { name: "Confirm new time" }).click();
  await expect(guest.getByRole("heading", { name: "Your meeting has moved" })).toBeVisible();

  const { rows } = await db.query("select starts_at from bookings where host_id = $1", [host.id]);
  await expect
    .poll(async () => (await fakeGoogle.events(token))[0]?.start.dateTime)
    .toBe(new Date(rows[0].starts_at).toISOString());
  expect((await fakeGoogle.events(token))[0]!.conferenceData!.entryPoints[0]!.uri).toBe(meetUrl); // same link

  // Cancel: the event is removed.
  await guest.goto(manageUrl);
  await guest.getByRole("button", { name: /^Cancel/ }).click();
  await guest.getByRole("button", { name: "Cancel meeting" }).click();
  await expect(guest.getByRole("heading", { name: "This meeting is cancelled" })).toBeVisible();
  await expect.poll(async () => (await fakeGoogle.events(token)).length).toBe(0);
});

test("Google fails while writing: the booking stands, the host sees it, and Retry fixes it", async ({
  host,
  db,
  newGuest,
  hostPage,
}) => {
  const token = await connectCalendar(db, host);
  await fakeGoogle.setCalendar(token, { eventsDown: true }); // free/busy works, writing doesn't
  const email = guestEmail("Grace");
  await book(await newGuest(), host, "Grace Hopper", email);

  // The guest is booked and emailed as usual; the host still gets an .ics, since Google has nothing.
  await waitForEmails(email, 1);
  const [hostEmail] = await waitForEmails(host.email, 1);
  expect(hostEmail!.ics).not.toBeNull();
  expect(await fakeGoogle.events(token)).toEqual([]);

  await hostPage.goto("/dashboard/bookings");
  await expect(hostPage.getByText("Not in Google Calendar")).toBeVisible();

  await fakeGoogle.setCalendar(token, { eventsDown: false });
  await hostPage.getByRole("button", { name: "Retry" }).click();
  await expect(hostPage.getByText("Not in Google Calendar")).toBeHidden();
  expect(await fakeGoogle.events(token)).toHaveLength(1);
  expect(emailsTo(email)).toHaveLength(1); // retrying doesn't email the guest again
});
