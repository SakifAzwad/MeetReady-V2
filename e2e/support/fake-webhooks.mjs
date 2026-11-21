/*
 * A fake webhook receiver for the E2E tests (Day 26). Plain Node, no
 * dependencies. Each test uses its own random name, so tests running in
 * parallel never see each other's requests:
 *
 *   POST /hook/<name>                 records { headers, body }, answers with the set status (default 200)
 *   POST /__fake/status/<name>        { status }: what /hook/<name> answers from now on
 *   GET  /__fake/requests/<name>      everything recorded for <name>
 *   GET  /__fake/health
 *
 * It doesn't verify signatures itself: the test does, with plain node:crypto,
 * independently of the app's own signing code.
 */
import http from "node:http";

const port = Number(process.env.FAKE_WEBHOOKS_PORT ?? 3103);
const requests = new Map(); // name -> [{ headers, body }]
const statuses = new Map(); // name -> status

const read = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const [, a, b, name] = url.pathname.split("/");
    const json = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === "/__fake/health") return json(200, { ok: true });
    if (req.method === "POST" && a === "hook" && b) {
      const body = await read(req);
      requests.set(b, [...(requests.get(b) ?? []), { headers: req.headers, body }]);
      return json(statuses.get(b) ?? 200, { received: true });
    }
    if (a === "__fake" && b === "status" && name && req.method === "POST") {
      statuses.set(name, JSON.parse(await read(req)).status);
      return json(200, { ok: true });
    }
    if (a === "__fake" && b === "requests" && name) return json(200, requests.get(name) ?? []);
    json(404, { error: "not found" });
  })
  .listen(port, "127.0.0.1");
