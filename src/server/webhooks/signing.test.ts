import { describe, expect, it } from "vitest";
import { newMessageId, newWebhookSecret, sign, verify, webhookHeaders } from "./signing";

describe("webhook signatures (Day 26, Standard Webhooks)", () => {
  it("matches the example published with the Standard Webhooks spec", () => {
    // From the spec's own examples: if this passes, any spec-following library can verify us.
    expect(
      sign(
        "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
        "msg_p5jXN8AQM9LWM0D4loKWxJek",
        1614265330,
        '{"test": 2432232314}',
      ),
    ).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("a receiver accepts it, and rejects a changed body, an old timestamp, or the wrong secret", () => {
    const secret = newWebhookSecret();
    const now = 1_800_000_000;
    const body = JSON.stringify({ type: "booking.created" });
    const headers = webhookHeaders([secret], newMessageId(), now, body);
    expect(verify(secret, headers, body, now)).toBe(true);
    expect(verify(secret, headers, body.replace("created", "cancelled"), now)).toBe(false);
    expect(verify(secret, headers, body, now + 6 * 60)).toBe(false); // a replay, 6 minutes later
    expect(verify(newWebhookSecret(), headers, body, now)).toBe(false);
  });

  it("during a rotation, both secrets verify: receivers can switch without downtime", () => {
    const [current, previous] = [newWebhookSecret(), newWebhookSecret()];
    const headers = webhookHeaders([current, previous], "msg_x", 1_800_000_000, "{}");
    expect(headers["webhook-signature"].split(" ")).toHaveLength(2);
    expect(verify(current, headers, "{}", 1_800_000_000)).toBe(true);
    expect(verify(previous, headers, "{}", 1_800_000_000)).toBe(true);
  });

  it("secrets and message ids look like the spec's", () => {
    expect(newWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(newMessageId()).toMatch(/^msg_[A-Za-z0-9_-]{22}$/);
  });
});
