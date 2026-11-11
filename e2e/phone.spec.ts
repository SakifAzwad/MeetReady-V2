import { chooseTime, sidewaysOverflow } from "./support/booking";
import { expect, signInAs, test } from "./fixtures";

/*
 * A phone-sized screen. Overflow is checked on every step, because one wide
 * element (a long time label, a grid column without minmax(0, …)) makes the
 * whole page scroll sideways (Day 6 story).
 */
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

test("booking on a phone: nothing sticks out sideways, and the details step takes the screen", async ({
  host,
  newGuest,
  db,
}) => {
  await db.query(`update event_types set questions = $1::jsonb where id = $2`, [
    JSON.stringify([
      {
        id: "4a1f8c2e-7b3d-4e5a-9c6b-0d1e2f3a4b5c",
        type: "choice",
        label: "Which of these best describes the team you're on right now?",
        required: false,
        options: ["Engineering and infrastructure", "Product, design and research"],
      },
    ]),
    host.eventTypeId,
  ]);
  const guest = await newGuest(PHONE);
  await guest.goto(`/${host.username}/intro`);
  await expect(guest.getByRole("group", { name: /^Times on/ })).toBeVisible();
  expect(await sidewaysOverflow(guest)).toBe(0);

  await chooseTime(guest, host);
  // On phones the time list is hidden while the guest fills in details.
  await expect(guest.getByRole("group", { name: /^Times on/ })).toBeHidden();
  await expect(guest.getByRole("radio", { name: "Product, design and research" })).toBeVisible();
  expect(await sidewaysOverflow(guest)).toBe(0);
});

test("the host's pages fit a phone", async ({ host, newGuest }) => {
  const page = await newGuest(PHONE);
  await signInAs(page.context(), host);

  for (const path of [
    "/dashboard",
    "/dashboard/bookings",
    "/dashboard/availability",
    `/dashboard/event-types/${host.eventTypeId}/edit`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await sidewaysOverflow(page), path).toBe(0);
  }
  await page.getByRole("button", { name: "Add question" }).click();
  expect(await sidewaysOverflow(page), "editor with a question").toBe(0);
});
