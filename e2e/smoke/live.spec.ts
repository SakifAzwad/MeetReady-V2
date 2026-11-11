import { expect, test, type Page } from "@playwright/test";

/*
 * Read-only checks on a live deployment (see playwright.smoke.config.ts).
 * Every page here also fails on console errors.
 */

function failOnConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on(
    "console",
    (m) => m.type() === "error" && !m.text().includes("status of 404") && errors.push(m.text()),
  );
  return () => expect(errors, "console errors").toEqual([]);
}

test("the landing page and login page load", async ({ page }) => {
  const check = failOnConsoleErrors(page);
  expect((await page.goto("/"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect((await page.goto("/login"))?.status()).toBe(200);
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible();
  check();
});

test("signed-out visitors are sent from the dashboard to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});

test("an unknown username is a real 404", async ({ page }) => {
  expect((await page.goto("/smoke-test-nobody-here"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
});

test("security headers are set", async ({ request }) => {
  const headers = (await request.get("/")).headers();
  expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  if (process.env.SMOKE_URL?.startsWith("https://")) {
    expect(headers["strict-transport-security"] ?? "", "HTTPS enforced (Vercel)").toContain("max-age");
  }
});

test("the database answers: the slots API checks its input and finds nothing for nobody", async ({
  request,
}) => {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const missing = await request.get(
    `/api/slots?username=smoke-test-nobody-here&slug=x&from=${from}&to=${to}`,
  );
  expect(missing.status()).toBe(404); // needs a working database connection to say so
  expect((await request.get("/api/slots?username=x&slug=y&from=bad&to=bad")).status()).toBe(400);
});

test("the demo booking page shows times", async ({ page }) => {
  const demo = process.env.SMOKE_DEMO_PATH;
  test.skip(!demo, "SMOKE_DEMO_PATH not set");
  const check = failOnConsoleErrors(page);
  expect((await page.goto(demo!))?.status()).toBe(200);
  // The widget rendered and got an answer from the slots API: times, or "no free times this month".
  await expect(
    page
      .getByRole("group", { name: /^Times on/ })
      .or(page.getByText(/^No free times in/))
      .first(),
  ).toBeVisible();
  check();
});
