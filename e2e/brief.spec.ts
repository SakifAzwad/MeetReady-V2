import { book, guestEmail } from "./support/booking";
import { expect, test } from "./fixtures";

/*
 * Day 18: the AI meeting brief on the host's Bookings page. The E2E server has
 * no AI key (tests never call a real model), so the brief is stored directly,
 * as the background job would after a successful call. What's tested here is
 * what the host sees, and that it's clearly labelled as AI-written.
 */

test("the host sees the AI brief with the booking, labelled as AI-written, above the guest's own words", async ({
  host,
  db,
  newGuest,
  hostPage,
}, testInfo) => {
  const guest = await newGuest();
  await book(guest, host, "Ada Lovelace", guestEmail("Ada"));
  const { rows } = await db.query("select id from bookings where host_id = $1", [host.id]);
  expect(rows).toHaveLength(1);
  await db.query(
    `insert into booking_briefs (booking_id, summary, agenda, prepare, model)
     values ($1, $2, $3, $4, 'test-model')`,
    [
      rows[0].id,
      "Ada from Analytical Engines wants to discuss hiring two React developers <b>soon</b>.",
      JSON.stringify(["Their hiring needs", "Your availability", "Rates"]),
      JSON.stringify(["Your rates for a 3-month contract"]),
    ],
  );

  await hostPage.goto("/dashboard/bookings");
  const brief = hostPage.getByRole("region", { name: "Meeting brief" });
  await expect(brief).toBeVisible();
  await expect(brief.getByText("Written by AI from Ada's answers")).toBeVisible();
  // Shown as text, never as HTML.
  await expect(brief.getByText("hiring two React developers <b>soon</b>.", { exact: false })).toBeVisible();
  await expect(brief.getByRole("listitem")).toHaveText([
    "Their hiring needs",
    "Your availability",
    "Rates",
    "Your rates for a 3-month contract",
  ]);
  await hostPage
    .getByRole("listitem")
    .filter({ has: brief })
    .screenshot({ path: testInfo.outputPath("booking-with-brief.png") });
});
