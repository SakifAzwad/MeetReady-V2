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

/** Opens the host's booking page, picks the `nth` free time, continues. Returns the time's label. */
export async function chooseTime(page: Page, host: Host, nth = 0): Promise<string> {
  await page.goto(`/${host.username}/intro`);
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
