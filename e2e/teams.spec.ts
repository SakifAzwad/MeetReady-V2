import { createHmac, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import type pg from "pg";
import { createHost, expect, signInAs, test } from "./fixtures";
import { BASE_URL, E2E_AUTH_SECRET } from "./support/config";

/*
 * Day 28: teams, roles and invite links, in a browser. What matters, in order:
 *  1. An owner makes a team and an invite link; someone signed out opens it,
 *     logs in, and joins. The link then works for nobody else.
 *  2. A brand-new account (no username yet) goes through onboarding and comes
 *     back to the invite. Opening the link changes nothing until Join.
 *  3. Roles: a member sees the people but not the invites or settings, and
 *     can leave; someone outside the team gets the not-found page.
 */

/** Creates a team through the form and returns its page URL. Unique per test: slugs are global. */
async function createTeam(page: Page): Promise<{ name: string; url: string }> {
  const name = `Acme ${randomBytes(3).toString("hex")}`;
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Teams" }).click();
  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
  const form = page.getByRole("region", { name: "Create a team" });
  await form.getByLabel("Team name").fill(name);
  // The address follows the name.
  await expect(form.getByLabel("Team address")).toHaveValue(name.toLowerCase().replace(" ", "-"));
  await form.getByRole("button", { name: "Create team" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/teams\/[0-9a-f-]{36}$/);
  return { name, url: page.url() };
}

/** Makes an invite link on the team's page and reads it off the screen (it's shown once). */
async function makeInvite(page: Page): Promise<string> {
  const region = page.getByRole("region", { name: "Invite people" });
  await region.getByRole("button", { name: "Create an invite link" }).click();
  const link = await region.locator("code").innerText();
  expect(link).toMatch(new RegExp(`^${BASE_URL}/invite/[A-Za-z0-9_-]{43}$`));
  await region.getByRole("button", { name: "Done" }).click();
  return link;
}

/** A Google account that signed in but hasn't picked a username yet (Better Auth's cookie format). */
async function newAccount(db: pg.Pool) {
  const suffix = randomBytes(4).toString("hex");
  const token = randomBytes(24).toString("hex");
  await db.query(
    `insert into "user" (id, name, email, email_verified) values ($1, 'Grace Hopper', $2, true)`,
    [`u_${suffix}`, `grace-${suffix}@example.com`],
  );
  await db.query(
    `insert into session (id, token, user_id, expires_at) values ($1, $2, $3, now() + interval '1 day')`,
    [`s_${suffix}`, token, `u_${suffix}`],
  );
  const signature = createHmac("sha256", E2E_AUTH_SECRET).update(token).digest("base64");
  return { suffix, cookie: encodeURIComponent(`${token}.${signature}`) };
}

test("an owner invites with a link; someone signed out logs in and joins; the link then works for nobody else", async ({
  hostPage,
  newGuest,
  db,
}) => {
  const team = await createTeam(hostPage);
  const link = await makeInvite(hostPage);
  await expect(hostPage.getByText("Links not used yet")).toBeVisible();

  // Signed out: the link goes to the login page and will come back.
  const member = await createHost(db);
  const page = await newGuest();
  await page.goto(link);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(new URL(link).pathname)}$`));
  await expect(page.getByText("You've been invited to join a team")).toBeVisible();

  // "Logging in" (the session Google's callback would make), then back to the link.
  await signInAs(page.context(), member);
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: `Sakif Azwad invited you to join ${team.name}` }),
  ).toBeVisible();
  await expect(page.getByText(`You'll join as Sakif Azwad (${member.email})`)).toBeVisible();
  await page.getByRole("button", { name: `Join ${team.name}` }).click();
  await expect(page).toHaveURL(team.url);
  await expect(page.getByText("You're a member")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^People/ })).toContainText("2 of 20");

  // The owner sees them, and the link is no longer waiting.
  await hostPage.reload();
  await expect(hostPage.getByText(member.email)).toBeVisible();
  await expect(hostPage.getByText("Links not used yet")).toBeHidden();

  // Single use: the next person who opens it is told so.
  const third = await newGuest();
  await signInAs(third.context(), await createHost(db));
  await third.goto(link);
  await expect(third.getByRole("heading", { name: "This invite link has ended" })).toBeVisible();
  await expect(third.getByText("Someone has already joined with this link")).toBeVisible();

  // The owner removes the member: their page for the team is now a 404.
  await hostPage.getByRole("button", { name: "Remove" }).click();
  await hostPage.getByRole("button", { name: "Remove", exact: true }).last().click();
  await expect(hostPage.getByText(member.email)).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
});

test("a new account picks a username, comes back to the invite, and opening it twice uses nothing up", async ({
  hostPage,
  newGuest,
  db,
}) => {
  const team = await createTeam(hostPage);
  const link = await makeInvite(hostPage);

  const account = await newAccount(db);
  const page = await newGuest();
  await page
    .context()
    .addCookies([{ name: "better-auth.session_token", value: account.cookie, url: BASE_URL }]);
  await page.goto(link);
  await expect(page).toHaveURL(/\/onboarding\?next=\/invite\//);
  await page.getByLabel("Username").fill(`grace-${account.suffix}`);
  await page.getByRole("button", { name: "Continue" }).click();

  // Back on the invite, which a page load (like a chat app's link preview) didn't use up.
  await expect(page).toHaveURL(link);
  await page.reload();
  await page.getByRole("button", { name: `Join ${team.name}` }).click();
  await expect(page).toHaveURL(team.url);
  await expect(page.getByText("You're a member")).toBeVisible();
});

test("roles: a member can't see invites or settings and can leave; an outsider gets a 404; a revoked link ends", async ({
  hostPage,
  newGuest,
  db,
}) => {
  const team = await createTeam(hostPage);
  const member = await createHost(db);
  const page = await newGuest();
  await signInAs(page.context(), member);
  await page.goto(await makeInvite(hostPage));
  await page.getByRole("button", { name: `Join ${team.name}` }).click();
  await expect(page).toHaveURL(team.url);

  // Members see the people, not the owner's tools.
  await expect(page.getByRole("heading", { name: /^People/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Invite people" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Team settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);

  // Someone outside the team: the same page as a team that doesn't exist.
  const outsider = await newGuest();
  await signInAs(outsider.context(), await createHost(db));
  await outsider.goto(team.url);
  await expect(outsider.getByRole("heading", { name: "This page could not be found." })).toBeVisible();

  // A revoked link stops working.
  const revoked = await makeInvite(hostPage);
  await hostPage.getByRole("button", { name: "Revoke" }).click();
  await expect(hostPage.getByText("Links not used yet")).toBeHidden();
  await outsider.goto(revoked);
  await expect(outsider.getByText("This invite link was cancelled")).toBeVisible();

  // The member leaves.
  await page.getByRole("button", { name: "Leave team" }).click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/teams$/);
  await expect(page.getByText("You aren't in a team yet.")).toBeVisible();
});
