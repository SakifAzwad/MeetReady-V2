import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BlockedAddressError,
  checkWebhookUrl,
  isPublicAddress,
  publicOnlyLookup,
  resolvesPublicly,
} from "./address";
import { postWebhook } from "./transport";

describe("which addresses a webhook may reach (Day 26, SSRF)", () => {
  it("blocks private, loopback, link-local, metadata, CGNAT and their IPv6 forms", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "::ffff:a9fe:a9fe", // IPv4-mapped metadata, hex form
      "64:ff9b::a9fe:a9fe", // NAT64 metadata
      "not-an-ip",
    ])
      expect(isPublicAddress(a), a).toBe(false);
    for (const a of ["93.184.215.14", "8.8.8.8", "2606:4700:4700::1111"])
      expect(isPublicAddress(a), a).toBe(true);
  });

  it("checks the URL's shape when saving", () => {
    const error = (u: string) => {
      const r = checkWebhookUrl(u);
      return r.ok ? "ok" : r.error;
    };
    expect(error("https://hooks.example.com/meetready")).toBe("ok");
    expect(error("http://hooks.example.com/")).toBe("Use an https:// URL.");
    expect(error("ftp://hooks.example.com/")).toBe("Use an https:// URL.");
    expect(error("https://user:pw@hooks.example.com/")).toBe("Don't put a username or password in the URL.");
    expect(error("https://hooks.example.com:8443/")).toBe("Use the standard https port (443).");
    expect(error("https://169.254.169.254/latest")).toBe("That address is on a private network.");
    expect(error("https://[::1]/")).toBe("That address is on a private network.");
    expect(error("https://localhost/")).toBe("Use a public address, not a local name.");
    expect(error("https://db.internal/")).toBe("Use a public address, not a local name.");
    expect(error("https://intranet/")).toBe("Use a public address, not a local name.");
    expect(error("nonsense")).toBe("That isn't a valid URL.");
    // E2E's local receiver only.
    expect(checkWebhookUrl("http://127.0.0.1:3103/hook", { allowPrivate: true }).ok).toBe(true);
  });

  it("refuses a name that resolves to a private address, even one of several", async () => {
    const url = new URL("https://hooks.example.com/");
    const resolve = (addresses: string[]) => async () => addresses.map((address) => ({ address, family: 4 }));
    expect((await resolvesPublicly(url, resolve(["93.184.215.14"]))).ok).toBe(true);
    expect(await resolvesPublicly(url, resolve(["93.184.215.14", "10.0.0.1"]))).toEqual({
      ok: false,
      error: '"hooks.example.com" points at a private network.',
    });
    expect((await resolvesPublicly(url, async () => Promise.reject(new Error("ENOTFOUND")))).ok).toBe(false);
  });
});

describe("sending (Day 26)", () => {
  let server: http.Server;
  let base: string;
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        if (req.url === "/redirect") {
          res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
          return res.end();
        }
        if (req.url === "/slow") return setTimeout(() => res.end("late"), 500);
        res.writeHead(200);
        res.end("x".repeat(5000));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("posts JSON with the signature headers, and keeps only 1 KB of the answer", async () => {
    const r = await postWebhook(`${base}/ok`, { "webhook-id": "msg_1" }, '{"a":1}', { allowPrivate: true });
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1024);
    expect(received.at(-1)).toMatchObject({
      body: '{"a":1}',
      headers: { "content-type": "application/json", "webhook-id": "msg_1" },
    });
  });

  it("doesn't follow redirects: a 302 towards the metadata service is just a 302", async () => {
    const r = await postWebhook(`${base}/redirect`, {}, "{}", { allowPrivate: true });
    expect(r.status).toBe(302);
  });

  it("gives up after the timeout", async () => {
    await expect(
      postWebhook(`${base}/slow`, {}, "{}", { allowPrivate: true, timeoutMs: 100 }),
    ).rejects.toThrow();
  });

  it("DNS rebinding: a name that now resolves to 127.0.0.1 is refused at connect time, nothing is sent", async () => {
    const before = received.length;
    // Passed the save-time check earlier; now the attacker's DNS answers with the loopback address.
    const rebinding = publicOnlyLookup(async () => [{ address: "127.0.0.1", family: 4 }]);
    const port = (server.address() as AddressInfo).port;
    const error = await postWebhook(`http://hooks.example.com:${port}/ok`, {}, "{}", {
      lookup: rebinding,
    }).catch((e: unknown) => e);
    expect(String((error as Error & { cause?: unknown }).cause ?? error)).toMatch(BlockedAddressError.name);
    expect(received.length).toBe(before);
  });
});
