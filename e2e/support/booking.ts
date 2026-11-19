import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type { Host } from "../fixtures";

/*
 * Steps a guest takes, written once. Locators go by role and accessible name,
 * the way a screen reader user would find things, so a test that passes also
 * says the page is usable without seeing it.
 */

/** The list of start times for the selected day. */
export const timeList = (page: Page) => page.getByRole("group", { name: /^Times on/ });

/** Start-time buttons (each has aria-pressed); excludes the "Show earlier times" disclosure. */
export const timeButtons = (page: Page) => timeList(page).locator("button[aria-pressed]:visible");

/** A unique guest email, so this test's emails can't be confused with another test's. */
export const guestEmail = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${randomBytes(3).toString("hex")}@example.com`;

/** The calendar's days that have free times: "Friday, 20 November 2026, 16 times available". */
const daysWithTimes = (page: Page) => page.getByRole("button", { name: /, \d+ times? available$/ });

/**
 * Selects the first day with at least `min` free times, moving to the next month if needed. Returns the day's
 * label ("Friday, 20 November 2026").
 *
 * The page opens on the first day with any free time, which is usually today. Late in the host's working day,
 * today has only a time or two left (the rest are past or inside the minimum notice), and a test that picks the
 * third time, or moves a booking to another time that day, then waits for a button that isn't there. CI failed
 * this way on a run at 3 PM in Dhaka (Day 23 story). Tests choose a day with room, never "today".
 */
export async function openRoomyDay(page: Page, min = 4): Promise<string> {
  await expect(timeList(page)).toBeVisible(); // the page has loaded its month and picked a day
  for (let months = 0; months < 3; months++) {
    for (const day of await daysWithTimes(page).all()) {
      const label = (await day.getAttribute("aria-label"))!;
      if (Number(label.match(/(\d+) times? available$/)![1]) >= min) {
        await day.click();
        await expect(day).toHaveAttribute("aria-pressed", "true");
        return label.split(", ").slice(0, 2).join(", ");
      }
    }
    await page.getByRole("button", { name: "Next month" }).click();
    await expect(daysWithTimes(page).first()).toBeVisible();
  }
  throw new Error(`No day with ${min} free times in the next 3 months`);
}

/** Opens the host's booking page, picks the `nth` free time on a day with room, continues. Returns its label. */
export async function chooseTime(page: Page, host: Host, nth = 0): Promise<string> {
  await page.goto(`/${host.username}/intro`);
  await openRoomyDay(page);
  const button = timeButtons(page).nth(nth);
  const label = (await button.innerText()).split("\n")[0]!;
  await button.click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  return label;
}

export async function fillDetails(page: Page, name: string, email: string) {
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
}

/** The whole happy path: pick the first time, fill in, confirm. Returns the time's label. */
export async function book(page: Page, host: Host, name: string, email: string): Promise<string> {
  const time = await chooseTime(page, host);
  await fillDetails(page, name, email);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: /^You're booked/ })).toBeVisible();
  return time;
}

/** Horizontal overflow in CSS pixels (0 = nothing sticks out sideways). */
export const sidewaysOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
