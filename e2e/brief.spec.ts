import { book, chooseTime, fillDetails, guestEmail } from "./support/booking";
import { expect, test } from "./fixtures";

/*
 * Day 18: the AI meeting brief on the host's Bookings page. The first test
 * stores a brief directly, to check what the host sees (labelled as
 * AI-written, shown as text). Since Day 20 the E2E server's AI talks to a fake
 * Groq (e2e/support/fake-groq.mjs), which answers every brief request with
 * the same valid brief: the second test runs the real path, from booking to
 * job to model to the page.
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

test("a booking with notes gets its brief through the real job (the fake Groq plays the model)", async ({
  host,
  db,
  newGuest,
  hostPage,
}) => {
  const guest = await newGuest();
  await chooseTime(guest, host);
  await fillDetails(guest, "Grace Hopper", guestEmail("Grace"));
  await guest.getByLabel(/Anything to share/).fill("I'd like to talk about a compiler project.");
  await guest.getByRole("button", { name: "Confirm booking" }).click();
  await expect(guest.getByRole("heading", { name: /^You're booked/ })).toBeVisible();

  // Jobs run inline in E2E, after the response: wait for the brief, then for the log line.
  await expect
    .poll(
      async () =>
        (
          await db.query(
            "select count(*)::int as n from booking_briefs b join bookings k on k.id = b.booking_id where k.host_id = $1",
            [host.id],
          )
        ).rows[0].n,
    )
    .toBe(1);
  const calls = await db.query("select feature, outcome from ai_calls where host_id = $1", [host.id]);
  expect(calls.rows).toEqual([{ feature: "meeting_brief", outcome: "ok" }]);

  await hostPage.goto("/dashboard/bookings");
  const brief = hostPage.getByRole("region", { name: "Meeting brief" });
  await expect(brief.getByText("Written by AI from Grace's answers")).toBeVisible();
  // FAKE_BRIEF in e2e/support/fake-groq.mjs.
  await expect(brief.getByText(/talk about working together/)).toBeVisible();
  await expect(brief.getByRole("listitem")).toHaveText([
    "Introductions",
    "What the guest needs",
    "Next steps",
  ]);
});
