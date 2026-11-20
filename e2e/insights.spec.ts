import { randomBytes } from "node:crypto";
import type pg from "pg";
import { expect, test, type Host } from "./fixtures";

/*
 * Day 25: marking a no-show on the Bookings page, and Insights counting it.
 * Past meetings can't be booked through the page (they're in the past), so the
 * test writes them straight into the database, a few days back at 10:00 in Dhaka.
 */

async function pastMeeting(db: pg.Pool, host: Host, daysAgo: number, guest: string, cancelledBy?: "guest") {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
    new Date(Date.now() - daysAgo * 86_400_000),
  );
  const start = new Date(`${day}T10:00:00+06:00`);
  await db.query(
    `insert into bookings (event_type_id, host_id, guest_name, guest_email, guest_time_zone, starts_at, ends_at,
                           manage_token_hash, status, cancelled_at, cancelled_by)
     values ($1, $2, $3, $4, 'Asia/Dhaka', $5, $6, $7, $8, $9, $10)`,
    [
      host.eventTypeId,
      host.id,
      guest,
      `${guest.toLowerCase()}@example.com`,
      start,
      new Date(start.getTime() + 30 * 60_000),
      randomBytes(16).toString("hex"),
      cancelledBy ? "cancelled" : "confirmed",
      cancelledBy ? new Date() : null,
      cancelledBy ?? null,
    ],
  );
}

test("mark a no-show, see it in Insights, then undo it", async ({ host, hostPage, db }) => {
  await pastMeeting(db, host, 3, "Ada");
  await pastMeeting(db, host, 4, "Grace");
  await pastMeeting(db, host, 5, "Alan", "guest");

  // ── Bookings → Past: mark Ada ──────────────────────────────────────────────
  await hostPage.goto("/dashboard/bookings?view=past");
  await hostPage.getByRole("button", { name: "Ada didn't show up", exact: true }).click();
  const ada = hostPage.getByRole("listitem").filter({ hasText: "Intro call with Ada" });
  await expect(ada.getByText("Didn't show up", { exact: true })).toBeVisible();
  await expect(ada.getByRole("button", { name: "Undo: Ada didn't show up" })).toBeVisible();

  // ── Insights: 3 meetings, 1 of 3 cancelled, 1 no-show of the 2 not cancelled ──
  await hostPage.getByRole("link", { name: "Insights", exact: true }).click();
  await expect(hostPage.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();
  await hostPage.getByRole("link", { name: "Last 4 weeks" }).click();
  await expect(hostPage.getByRole("link", { name: "Last 4 weeks" })).toHaveAttribute("aria-current", "page");
  const tile = (label: string) =>
    hostPage
      .getByRole("list", { name: "Summary" })
      .getByRole("listitem")
      .filter({ has: hostPage.getByText(label, { exact: true }) });
  await expect(tile("Meetings")).toContainText("3");
  await expect(tile("Cancelled")).toContainText("33%");
  await expect(tile("Cancelled")).toContainText("1 by guests, 0 by you");
  await expect(tile("No-shows")).toContainText("50%");

  // The table view carries every number; the chart's tooltip shows the same on hover.
  const chart = hostPage.getByRole("region", { name: "Meetings per week" });
  await chart.getByText("Show as a table").click();
  const totals = await chart
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.map((r) => [...r.querySelectorAll("td")].slice(1).map((c) => Number(c.textContent))),
    );
  expect(totals.reduce((sum, [h, n, c]) => [sum[0]! + h!, sum[1]! + n!, sum[2]! + c!], [0, 0, 0])).toEqual([
    1, 1, 1,
  ]);
  await chart.locator("[data-tip]").first().hover();
  await expect(hostPage.getByRole("tooltip")).toContainText(/held/);

  // ── Undo ─────────────────────────────────────────────────────────────────────
  await hostPage.goto("/dashboard/bookings?view=past");
  await hostPage.getByRole("button", { name: "Undo: Ada didn't show up" }).click();
  await expect(ada.getByRole("button", { name: "Ada didn't show up", exact: true })).toBeVisible();
  // Only the button says it now: the badge is gone.
  await expect(ada.getByText("Didn't show up", { exact: true })).toHaveCount(1);
  await hostPage.goto("/dashboard/insights?range=4w");
  await expect(tile("No-shows")).toContainText("0%");
});

test("Insights with no meetings yet says so, and a made-up range falls back", async ({ hostPage }) => {
  await hostPage.goto("/dashboard/insights?range=forever");
  await expect(hostPage.getByText("No meetings in this period yet")).toBeVisible();
  await expect(hostPage.getByRole("link", { name: "Last 3 months" })).toHaveAttribute("aria-current", "page");
});
