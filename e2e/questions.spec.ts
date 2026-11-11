import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { chooseTime, fillDetails, guestEmail } from "./support/booking";
import { expect, test, waitForEmails } from "./fixtures";

/** Exact role queries: accessible names like "Move question 1 up" contain "Question" (Day 10 story). */
const textbox = (scope: ReturnType<Page["locator"]>, name: string) =>
  scope.getByRole("textbox", { name, exact: true });

test("the host adds, checks and reorders booking questions", async ({ host, hostPage: page, db }) => {
  await page.goto(`/dashboard/event-types/${host.eventTypeId}/edit`);
  const card = page.locator("[data-slot=card]").filter({ hasText: "Booking questions" });
  const rows = card.locator("ol > li");
  const add = card.getByRole("button", { name: "Add question" });

  await add.click();
  await expect(textbox(rows.nth(0), "Question")).toBeFocused();
  await textbox(rows.nth(0), "Question").fill("Company");
  await rows.nth(0).getByRole("switch", { name: "Required" }).click();

  await add.click();
  await textbox(rows.nth(1), "Question").fill("Your role");
  await rows.nth(1).getByLabel("Answer type").selectOption("choice");
  // Changing the type remounts the row; focus is put back on the select.
  await expect(rows.nth(1).getByLabel("Answer type")).toBeFocused();

  // Saving with the two empty options shows the errors next to them, and saves nothing.
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(rows.nth(1).getByText("Fill in this option or remove it")).toHaveCount(2);
  await expect(page).toHaveURL(/\/edit$/);

  await textbox(rows.nth(1), "Option 1").fill("Engineer");
  await textbox(rows.nth(1), "Option 2").fill("Founder");
  // Enter in the last option adds another, instead of submitting the form.
  await textbox(rows.nth(1), "Option 2").press("Enter");
  await expect(textbox(rows.nth(1), "Option 3")).toBeFocused();
  await page.keyboard.type("Other");

  await add.click();
  await textbox(rows.nth(2), "Question").fill("Topics");
  await rows.nth(2).getByLabel("Answer type").selectOption("multi_choice");
  await textbox(rows.nth(2), "Option 1").fill("Pricing");
  await textbox(rows.nth(2), "Option 2").fill("Roadmap");

  // Reorder with the keyboard-friendly buttons: focus stays on the button, and it's announced.
  await rows.nth(2).getByRole("button", { name: "Move Topics up" }).click();
  await expect(page.getByRole("button", { name: "Move Topics up" })).toBeFocused();
  await expect(card.locator("[aria-live]")).toHaveText("Moved Topics to position 2 of 3.");
  const labels = rows.locator("input[id$='-label']");
  await expect
    .poll(() => labels.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .toEqual(["Company", "Topics", "Your role"]);

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/dashboard/event-types");

  const { rows: saved } = await db.query("select questions from event_types where id = $1", [
    host.eventTypeId,
  ]);
  expect(saved[0].questions.map((q: { label: string; type: string }) => `${q.label} (${q.type})`)).toEqual([
    "Company (text)",
    "Topics (multi_choice)",
    "Your role (choice)",
  ]);
});

test("a guest answers the questions; answers reach the host, survive edits, stay off the guest's email", async ({
  host,
  hostPage,
  newGuest,
  db,
}) => {
  const ids = { company: randomUUID(), topics: randomUUID(), role: randomUUID(), agree: randomUUID() };
  const questions = [
    { id: ids.company, type: "text", label: "Company", required: true, multiline: false },
    {
      id: ids.topics,
      type: "multi_choice",
      label: "Topics",
      required: false,
      options: ["Pricing", "Hiring", "Roadmap"],
    },
    { id: ids.role, type: "choice", label: "Your role", required: false, options: ["Engineer", "Founder"] },
    { id: ids.agree, type: "checkbox", label: "I agree to the call being recorded", required: true },
  ];
  const setQuestions = (q: unknown) =>
    db.query("update event_types set questions = $1::jsonb where id = $2", [
      JSON.stringify(q),
      host.eventTypeId,
    ]);
  await setQuestions(questions);

  const email = guestEmail("Ada");
  const guest = await newGuest();
  await chooseTime(guest, host);
  await fillDetails(guest, "Ada Lovelace", email);

  // Required questions are checked in the browser.
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByText("Please answer this")).toBeVisible();
  await expect(guest.getByText("Tick this to continue")).toBeVisible();

  await guest.getByLabel("Company", { exact: true }).fill("Acme Corp");
  await guest.getByRole("checkbox", { name: "Roadmap" }).check();
  await guest.getByRole("checkbox", { name: "Pricing" }).check();
  await guest.getByRole("radio", { name: "Founder" }).check();
  await guest.getByRole("checkbox", { name: /I agree/ }).check();

  // The host renames a question while the guest is typing: nothing is booked,
  // the form rebuilds, and what the guest typed is kept.
  await setQuestions([{ ...questions[0], label: "Company name" }, ...questions.slice(1)]);
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByText(/just changed these questions/)).toBeVisible();
  await expect(guest.getByLabel("Company name", { exact: true })).toHaveValue("Acme Corp");
  await expect(guest.getByRole("radio", { name: "Founder" })).toBeChecked();
  await expect(guest.getByLabel("Name", { exact: true })).toHaveValue("Ada Lovelace");
  expect((await db.query("select 1 from bookings where host_id = $1", [host.id])).rowCount).toBe(0);

  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByRole("heading", { name: /^You're booked/ })).toBeVisible();

  // Stored as a snapshot, in the host's order (not the click order).
  const [booking] = (await db.query("select answers from bookings where host_id = $1", [host.id])).rows;
  expect(booking.answers.map((a: { label: string; value: unknown }) => [a.label, a.value])).toEqual([
    ["Company name", "Acme Corp"],
    ["Topics", ["Pricing", "Roadmap"]],
    ["Your role", "Founder"],
    ["I agree to the call being recorded", true],
  ]);

  // Host's email has the answers; the guest's doesn't.
  const [hostMail] = await waitForEmails(host.email, 1);
  const [guestMail] = await waitForEmails(email, 1);
  expect(hostMail!.html).toContain("Acme Corp");
  expect(hostMail!.html).toContain("Pricing, Roadmap");
  expect(guestMail!.html).not.toContain("Acme Corp");
  expect(guestMail!.ics).not.toContain("Acme Corp");

  // Dashboard card.
  await hostPage.goto("/dashboard/bookings");
  const card = hostPage.getByRole("listitem").filter({ hasText: "Ada Lovelace" });
  await expect(card.getByText("Acme Corp")).toBeVisible();

  // The guest's manage page, even after the host deletes that question.
  await setQuestions(questions.slice(1));
  const manageUrl = guestMail!.html.match(/href="(http:\/\/localhost:\d+\/booking\/[A-Za-z0-9_-]{43})"/)![1]!;
  await guest.goto(manageUrl);
  await expect(guest.getByRole("heading", { name: "What you shared" })).toBeVisible();
  await expect(guest.getByText("Company name")).toBeVisible();
  await expect(guest.getByText("Acme Corp")).toBeVisible();
});
