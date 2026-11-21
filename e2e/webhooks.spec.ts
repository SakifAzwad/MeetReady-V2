import { createHmac, randomBytes } from "node:crypto";
import { expect, test } from "./fixtures";
import { book, guestEmail } from "./support/booking";
import { FAKE_WEBHOOKS_URL } from "./support/config";

/*
 * Day 26: signed webhooks, end to end. A host adds an endpoint on the
 * Webhooks page, a guest books, and the fake receiver gets a signed
 * booking.created. The signature is checked here with plain node:crypto,
 * the way any receiver would, not with the app's own code. Then: a test
 * ping, a failing receiver and Retry, a rotation (two signatures), Delete.
 */

type Received = { headers: Record<string, string>; body: string };
const received = async (name: string): Promise<Received[]> =>
  (await fetch(`${FAKE_WEBHOOKS_URL}/__fake/requests/${name}`)).json();
const answerWith = (name: string, status: number) =>
  fetch(`${FAKE_WEBHOOKS_URL}/__fake/status/${name}`, { method: "POST", body: JSON.stringify({ status }) });

/** Standard Webhooks, by hand: HMAC-SHA256 over "id.timestamp.body" with the secret's bytes. */
function signatureValid(secret: string, r: Received): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signed = `${r.headers["webhook-id"]}.${r.headers["webhook-timestamp"]}.${r.body}`;
  const expected = `v1,${createHmac("sha256", key).update(signed).digest("base64")}`;
  return r.headers["webhook-signature"]!.split(" ").includes(expected);
}

test("a host adds an endpoint and gets a signed booking.created; test, retry, rotate, delete", async ({
  host,
  hostPage,
  newGuest,
}) => {
  const name = randomBytes(6).toString("hex");
  const url = `${FAKE_WEBHOOKS_URL}/hook/${name}`;

  // ── Add the endpoint (from the account menu) ──
  await hostPage.goto("/dashboard");
  await hostPage.getByRole("button", { name: /^Account menu for/ }).click();
  await hostPage.getByRole("menuitem", { name: "Webhooks" }).click();
  await expect(hostPage.getByRole("heading", { name: "Webhooks", level: 1 })).toBeVisible();
  await hostPage.getByLabel("Endpoint URL").fill(url);
  await hostPage.getByRole("button", { name: "Add endpoint" }).click();
  const secret = (await hostPage.locator("code", { hasText: /^whsec_/ }).innerText()).trim();
  expect(secret).toMatch(/^whsec_/);
  await hostPage.getByRole("button", { name: "Done" }).click();
  await expect(hostPage.locator("code", { hasText: /^whsec_/ })).toHaveCount(0); // shown once

  // ── A guest books: the receiver gets a signed booking.created ──
  const email = guestEmail("Ada");
  await book(await newGuest(), host, "Ada Lovelace", email);
  await expect.poll(async () => (await received(name)).length).toBe(1);
  const [created] = await received(name);
  expect(signatureValid(secret, created!)).toBe(true);
  expect(created!.headers["content-type"]).toBe("application/json");
  const payload = JSON.parse(created!.body);
  expect(payload).toMatchObject({
    type: "booking.created",
    data: { status: "confirmed", guest: { name: "Ada Lovelace", email }, changedBy: "guest" },
  });

  // ── Send test ──
  await hostPage.reload();
  await hostPage.getByRole("button", { name: "Send test" }).click();
  await expect.poll(async () => (await received(name)).length).toBe(2);
  const ping = (await received(name))[1]!;
  expect(JSON.parse(ping.body).type).toBe("ping");
  expect(signatureValid(secret, ping)).toBe(true);

  // ── A failing receiver: one try inline, then Retry delivers the same message ──
  await answerWith(name, 500);
  await hostPage.getByRole("button", { name: "Send test" }).click();
  await expect.poll(async () => (await received(name)).length).toBe(3);
  // Reload until the failure shows. Wait for the element itself: counting right after reload() can run
  // before the page's streamed section has rendered, and see nothing.
  await expect(async () => {
    await hostPage.reload();
    await expect(hostPage.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await answerWith(name, 200);
  await hostPage.getByRole("button", { name: "Retry" }).click();
  await expect.poll(async () => (await received(name)).length).toBe(4);
  const [, , failed, retried] = await received(name);
  expect(retried!.headers["webhook-id"]).toBe(failed!.headers["webhook-id"]); // the same message
  expect(retried!.body).toBe(failed!.body);
  // All three delivered now (the booking, the first test, the retried one): a positive check, so an
  // empty, still-loading page can't pass it.
  await expect(async () => {
    await hostPage.reload();
    await expect(hostPage.getByText("Delivered (200)", { exact: true })).toHaveCount(3, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(hostPage.getByRole("button", { name: "Retry" })).toHaveCount(0);

  // ── Rotate: a new secret, and both sign for 24 hours ──
  await hostPage.getByRole("button", { name: "Rotate secret" }).click();
  await hostPage.getByRole("button", { name: "Rotate secret" }).click(); // confirm
  const fresh = (await hostPage.locator("code", { hasText: /^whsec_/ }).innerText()).trim();
  expect(fresh).not.toBe(secret);
  await hostPage.getByRole("button", { name: "Done" }).click();
  await hostPage.getByRole("button", { name: "Send test" }).click();
  await expect.poll(async () => (await received(name)).length).toBe(5);
  const afterRotation = (await received(name))[4]!;
  expect(afterRotation.headers["webhook-signature"]!.split(" ")).toHaveLength(2);
  expect(signatureValid(fresh, afterRotation)).toBe(true);
  expect(signatureValid(secret, afterRotation)).toBe(true);

  // ── Delete ──
  await hostPage.getByRole("button", { name: "Delete", exact: true }).click();
  await hostPage.getByRole("button", { name: "Delete endpoint" }).click();
  await expect(hostPage.getByText("No endpoints yet.")).toBeVisible();
});

test("a URL that isn't http(s) is refused when saving", async ({ hostPage }) => {
  // The E2E server allows private addresses (for the fake receiver), so the private-network and DNS
  // rules are covered by unit tests (address.test.ts, endpoints.test.ts); this checks the form shows
  // the server's refusal.
  await hostPage.goto("/dashboard/webhooks");
  await hostPage.getByLabel("Endpoint URL").fill("ftp://127.0.0.1/hook");
  await hostPage.getByRole("button", { name: "Add endpoint" }).click();
  await expect(hostPage.getByRole("alert").filter({ hasText: "Use an https:// URL." })).toBeVisible();
});
