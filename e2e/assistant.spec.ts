import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { fillDetails, guestEmail, timeButtons, timeList } from "./support/booking";
import { expect, fakeGroq, test } from "./fixtures";

/*
 * Day 20: the booking assistant's box on the public booking page. The model is
 * the fake Groq, scripted per test; everything after it is real: the
 * findTimes tool over the real slot function and database, the suggestions,
 * the widget, the booking.
 *
 * Dates: the assistant only searches the next 14 days from the server's real
 * clock (Day 19), and the E2E server's clock can't be pinned. So unlike the
 * other specs, these pick a weekday 8 to 10 days ahead instead of a fixed day:
 * always inside the window, never today (no minimum-notice edge), and a
 * Mon–Fri day the seeded host works (9–5 in Dhaka).
 */

const HOST_ZONE = "Asia/Dhaka";

/** A weekday 8 to 10 days ahead, in Dhaka: "2026-11-27". */
function weekdayAhead(): string {
  for (let days = 8; ; days++) {
    const at = new Date(Date.now() + days * 86_400_000); // Dhaka has no DST: a day is 24 hours
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: HOST_ZONE, weekday: "short" }).format(at);
    if (weekday !== "Sat" && weekday !== "Sun") {
      return new Intl.DateTimeFormat("en-CA", { timeZone: HOST_ZONE }).format(at); // YYYY-MM-DD
    }
  }
}

/** "27 November": how the times grid names that day (its group is "Times on Friday 27 November 2026"). */
const dayName = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

const box = (page: Page) => page.getByRole("region", { name: "Find a time by describing it" });
const suggestions = (page: Page) => page.getByRole("list", { name: "Suggested times" }).getByRole("button");
const selectedTime = (page: Page) => timeList(page).locator('button[aria-pressed="true"]');

async function ask(page: Page, message: string) {
  await box(page).getByLabel("Tell us when suits you").fill(message);
  await box(page).getByRole("button", { name: "Find times" }).click();
}

test("a guest describes a time, picks a suggestion, and books it through the normal form", async ({
  host,
  newGuest,
  db,
}) => {
  const day = weekdayAhead();
  const marker = fakeGroq.marker();
  await fakeGroq.script(marker, {
    search: { from: day, to: day, earliest: "12:00", latest: "17:00", timeZone: null },
    // Markup in the model's words must show as text, never as HTML.
    reply: "Here are three times that afternoon. <b>Pick one</b> below.",
  });

  const guest = await newGuest();
  await guest.goto(`/${host.username}/intro`);
  await ask(guest, `That afternoon works for me (${marker})`);

  await expect(
    box(guest).getByText("Here are three times that afternoon. <b>Pick one</b> below."),
  ).toBeVisible();
  await expect(
    box(guest).getByText(/Reply written by AI\. The times are Sakif's real free times\./),
  ).toBeVisible();
  // pickSuggestions spreads them out: an hour apart, not 12:00, 12:30, 1:00.
  await expect(suggestions(guest)).toHaveText([/12:00 PM/, /1:00 PM/, /2:00 PM/]);
  await expect(box(guest).getByText(/^In .+ time$/)).toHaveCount(0); // same timezone: no "In … time" line
  expect(await fakeGroq.calls(marker)).toBe(2); // the search, then the reply

  // Picking one selects it in the grid, on its day (the page opened on the first free day), and focuses it.
  await suggestions(guest).nth(1).click();
  await expect(timeList(guest)).toHaveAccessibleName(new RegExp(dayName(day)));
  await expect(selectedTime(guest)).toHaveText(/1:00 PM/);
  await expect(selectedTime(guest)).toBeFocused();
  await expect(suggestions(guest).nth(1)).toHaveAttribute("aria-pressed", "true");

  // It doesn't book or skip ahead: the guest continues as usual.
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByRole("heading", { name: "Your details" })).toBeVisible();
  const email = guestEmail("Ada");
  await fillDetails(guest, "Ada Lovelace", email);

  // Changing their mind from the form: back to the times, the other one selected, details kept.
  await suggestions(guest).nth(2).click();
  await expect(selectedTime(guest)).toHaveText(/2:00 PM/);
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByLabel("Name", { exact: true })).toHaveValue("Ada Lovelace");
  await expect(guest.getByLabel("Email", { exact: true })).toHaveValue(email);
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByRole("heading", { name: "You're booked with Sakif" })).toBeVisible();

  const { rows } = await db.query(
    "select starts_at, guest_time_zone from bookings where host_id = $1 and status = 'confirmed'",
    [host.id],
  );
  expect(rows).toEqual([{ starts_at: new Date(`${day}T14:00:00+06:00`), guest_time_zone: HOST_ZONE }]);

  // One logged request, tokens summed over both model calls, no text.
  const calls = await db.query(
    "select feature, outcome, input_tokens from ai_calls where host_id = $1 and feature = 'booking_assistant'",
    [host.id],
  );
  expect(calls.rows).toEqual([{ feature: "booking_assistant", outcome: "ok", input_tokens: 240 }]);
});

test("a guest who names another city gets that city's times, and picking one switches the page to it", async ({
  host,
  newGuest,
}) => {
  const day = weekdayAhead();
  const marker = fakeGroq.marker();
  await fakeGroq.script(marker, {
    search: { from: day, to: day, earliest: "09:00", latest: "12:00", timeZone: "Europe/London" },
    reply: "These are free that morning, London time.",
  });

  const guest = await newGuest(); // a laptop set to Dhaka
  await guest.goto(`/${host.username}/intro`);
  const clear = box(guest).getByRole("button", { name: "Clear" });
  await expect(clear).toHaveCount(0); // nothing to clear yet
  await ask(guest, `Morning please, I'm in London (${marker})`);

  // The host works until 5 PM Dhaka = 11 AM London, so the last start is 10:30.
  await expect(suggestions(guest)).toHaveText([/9:00 AM/, /9:30 AM/, /10:00 AM/]);
  await expect(box(guest).getByText("In London time")).toBeVisible();

  await suggestions(guest).first().click();
  await expect(guest.getByRole("combobox", { name: "Times shown in" })).toHaveValue(/London/);
  // The grid is now on London's clock, with the host's own time underneath.
  await expect(selectedTime(guest)).toHaveText(/9:00 AM/);
  await expect(selectedTime(guest)).toContainText("3:00 PM");
  await expect(box(guest).getByText("In London time")).toHaveCount(0); // now the page's own clock

  // Clear empties the box, answer included, and puts the cursor back; the grid keeps its selection.
  const input = box(guest).getByLabel("Tell us when suits you");
  await clear.click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(box(guest).getByText("These are free that morning, London time.")).toHaveCount(0);
  await expect(suggestions(guest)).toHaveCount(0);
  await expect(clear).toHaveCount(0);
  await expect(selectedTime(guest)).toHaveText(/9:00 AM/);
  // Escape does the same from the keyboard.
  await input.fill("Friday morning instead");
  await input.press("Escape");
  await expect(input).toHaveValue("");

  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByText("(London)")).toBeVisible();
});

test("an answer that arrives after the guest pressed Clear is dropped, not shown", async ({
  host,
  newGuest,
}) => {
  const marker = fakeGroq.marker();
  await fakeGroq.script(marker, { reply: "A late reply.", delayMs: 1500 });

  const guest = await newGuest();
  await guest.goto(`/${host.username}/intro`);
  await ask(guest, `Any time this week (${marker})`);
  await expect(box(guest).getByText("Looking for times…")).toBeVisible();
  await box(guest).getByRole("button", { name: "Clear" }).click();
  await expect(box(guest).getByText("Looking for times…")).toHaveCount(0);

  // The request reached the fake; wait past its 1.5 s delay, then check the answer never appeared.
  await expect.poll(() => fakeGroq.calls(marker)).toBe(1);
  await guest.waitForTimeout(2000);
  await expect(box(guest).getByText("A late reply.")).toHaveCount(0);
  await expect(box(guest).getByRole("button", { name: "Find times" })).toBeDisabled(); // empty input
});

test("when the model fails, the guest is told plainly and the times grid still works", async ({
  host,
  newGuest,
  db,
}) => {
  const marker = fakeGroq.marker();
  await fakeGroq.script(marker, { fail: true });

  const guest = await newGuest();
  await guest.goto(`/${host.username}/intro`);
  await ask(guest, `Tomorrow morning? (${marker})`);

  await expect(
    box(guest).getByText("The assistant can't answer right now. You can still pick a time below."),
  ).toBeVisible();
  await expect(suggestions(guest)).toHaveCount(0);
  expect(await fakeGroq.calls(marker)).toBeGreaterThan(0);
  const { rows } = await db.query("select outcome from ai_calls where host_id = $1", [host.id]);
  expect(rows).toEqual([{ outcome: "error" }]);

  await timeButtons(guest).first().click();
  await guest.getByRole("button", { name: "Continue" }).click();
  await expect(guest.getByRole("heading", { name: "Your details" })).toBeVisible();
});

test("a suggested time someone books in the meantime: picking it says so instead of selecting it", async ({
  host,
  newGuest,
  db,
}) => {
  const day = weekdayAhead();
  const marker = fakeGroq.marker();
  await fakeGroq.script(marker, {
    search: { from: day, to: day, earliest: "12:00", latest: "17:00", timeZone: null },
    reply: "Here are three times that afternoon.",
  });

  const guest = await newGuest();
  await guest.goto(`/${host.username}/intro`);
  await ask(guest, `Afternoon (${marker})`);
  await expect(suggestions(guest)).toHaveText([/12:00 PM/, /1:00 PM/, /2:00 PM/]);

  // Another guest takes 12:00 after the suggestions were shown.
  const starts = new Date(`${day}T12:00:00+06:00`);
  await db.query(
    `insert into bookings (event_type_id, host_id, guest_name, guest_email, guest_time_zone,
                           starts_at, ends_at, manage_token_hash)
     values ($1, $2, 'Someone else', 'someone@example.com', $3, $4, $5, $6)`,
    [
      host.eventTypeId,
      host.id,
      HOST_ZONE,
      starts,
      new Date(starts.getTime() + 30 * 60_000),
      randomBytes(16).toString("hex"),
    ],
  );

  await suggestions(guest).first().click();
  await expect(guest.getByText("Someone just booked that time. Pick another one.")).toBeVisible();
  await expect(selectedTime(guest)).toHaveCount(0);
  await expect(suggestions(guest).first()).toHaveAttribute("aria-pressed", "false");
  // The fresh read shows the day without it; the next suggestion still works.
  await expect(timeButtons(guest).filter({ hasText: "12:00 PM" })).toHaveCount(0);
  await suggestions(guest).nth(1).click();
  await expect(selectedTime(guest)).toHaveText(/1:00 PM/);
  await expect(guest.getByText("Someone just booked that time. Pick another one.")).toHaveCount(0);
});
