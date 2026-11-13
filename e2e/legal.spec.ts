import { expect, test } from "./fixtures";

// Linked from Google's consent screen: they must answer 200, not go through proxy's username lookup (404).
test("the privacy policy and terms load, and the footer and login page link to them", async ({ page }) => {
  for (const [path, heading] of [
    ["/privacy", "Privacy policy"],
    ["/terms", "Terms of use"],
  ] as const) {
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }

  await page.goto("/");
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy policy" }).click();
  await expect(page).toHaveURL("/privacy");
  await expect(page.getByText(/Limited Use requirements/)).toBeVisible();

  await page.goto("/login");
  await page.getByRole("link", { name: "terms of use" }).click();
  await expect(page).toHaveURL("/terms");
});
