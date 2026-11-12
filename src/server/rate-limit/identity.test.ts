import { describe, expect, it } from "vitest";
import { clientIp, emailBucket, hashIdentifier, ipBucket } from "./identity";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry (the client, as Vercel writes it)", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to one shared 'unknown' bucket", () => {
    expect(clientIp(h({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(clientIp(h({}))).toBe("unknown");
  });

  it("treats an IPv4-mapped IPv6 address as the IPv4 address", () => {
    expect(clientIp(h({ "x-forwarded-for": "::ffff:127.0.0.1" }))).toBe("127.0.0.1");
  });
});

describe("ipBucket", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
  });

  it("groups IPv6 by /64: one home or phone gets a whole /64", () => {
    const a = ipBucket("2001:db8:abcd:12:1::1");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(ipBucket("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff")).toBe(a);
    expect(ipBucket("2001:db8:abcd:13::1")).not.toBe(a);
  });

  it("handles the short forms", () => {
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("64:ff9b::192.0.2.33")).toBe("64:ff9b:0:0::/64");
  });

  it("leaves anything it can't parse as its own bucket", () => {
    expect(ipBucket("unknown")).toBe("unknown");
    expect(ipBucket("1::2::3")).toBe("1::2::3");
    expect(ipBucket("zz::1")).toBe("zz::1");
  });
});

describe("emailBucket", () => {
  it("counts plus-addressed variants as the same inbox", () => {
    expect(emailBucket("Ada+1@Example.com")).toBe("ada@example.com");
    expect(emailBucket("ada+anything@example.com")).toBe("ada@example.com");
  });

  it("ignores dots for Gmail only, where they really are ignored", () => {
    expect(emailBucket("a.d.a@gmail.com")).toBe("ada@gmail.com");
    expect(emailBucket("a.d.a+x@googlemail.com")).toBe("ada@gmail.com");
    expect(emailBucket("a.d.a@example.com")).toBe("a.d.a@example.com");
  });

  it("doesn't empty an address that starts with +", () => {
    expect(emailBucket("+tag@example.com")).toBe("+tag@example.com");
  });
});

describe("hashIdentifier", () => {
  it("is stable, secret-dependent, and doesn't contain the value", () => {
    const one = hashIdentifier("secret-a", "203.0.113.7");
    expect(hashIdentifier("secret-a", "203.0.113.7")).toBe(one);
    expect(hashIdentifier("secret-b", "203.0.113.7")).not.toBe(one);
    expect(one).toMatch(/^[0-9a-f]{32}$/);
  });
});
