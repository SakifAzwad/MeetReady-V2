import { describe, expect, it } from "vitest";
import { newManageToken, openManageToken, sealManageToken } from "./manage-token";

const SECRET = "test-secret-test-secret-test-secret-00";
const BOOKING = "3f1c2a7e-8b4d-4c9a-9e2f-1a2b3c4d5e6f";
const OTHER = "7a9b8c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("sealed manage tokens (Day 17)", () => {
  it("opens to the same token", () => {
    const { token } = newManageToken();
    expect(openManageToken(sealManageToken(token, BOOKING, SECRET), BOOKING, SECRET)).toBe(token);
  });

  it("never contains the token, and differs every time (fresh IV)", () => {
    const { token } = newManageToken();
    const a = sealManageToken(token, BOOKING, SECRET);
    const b = sealManageToken(token, BOOKING, SECRET);
    expect(a).not.toContain(token);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("only opens for its own booking (the id is authenticated data)", () => {
    const { token } = newManageToken();
    expect(openManageToken(sealManageToken(token, BOOKING, SECRET), OTHER, SECRET)).toBeNull();
  });

  it("doesn't open with another secret (e.g. after rotating BETTER_AUTH_SECRET)", () => {
    const { token } = newManageToken();
    expect(openManageToken(sealManageToken(token, BOOKING, SECRET), BOOKING, `${SECRET}-new`)).toBeNull();
  });

  it("rejects tampered or malformed values instead of throwing", () => {
    const { token } = newManageToken();
    const sealed = sealManageToken(token, BOOKING, SECRET);
    const [v, iv, body] = sealed.split(".");
    const flipped = body!.startsWith("A") ? `B${body!.slice(1)}` : `A${body!.slice(1)}`;
    for (const bad of [`${v}.${iv}.${flipped}`, `v2.${iv}.${body}`, "v1..", "garbage", "", `${v}.${iv}`]) {
      expect(openManageToken(bad, BOOKING, SECRET)).toBeNull();
    }
  });
});
