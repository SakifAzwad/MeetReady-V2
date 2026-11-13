/*
 * A fake Google for the E2E tests (Day 15), so CI never calls the real one.
 * The app talks to it through GOOGLE_CALENDAR_API_URL and GOOGLE_REVOKE_URL
 * (set in playwright.config.ts). Plain Node, no dependencies.
 *
 * State is per access token, and every test's host has its own token, so
 * parallel tests can't see each other's calendars:
 *   POST /__fake/calendar  { token, busy: [{start,end}], down }   set a calendar
 *   GET  /__fake/revoked?token=…                                   was it revoked?
 * What the app calls:
 *   POST /calendar/v3/freeBusy   (Authorization: Bearer <token>)
 *   POST /revoke                 (form: token=…)
 */
import http from "node:http";

const port = Number(process.env.FAKE_GOOGLE_PORT ?? 3101);
const calendars = new Map(); // token -> { busy, down }
const revoked = new Set();

const body = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

const send = (res, status, json) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(json));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/__fake/health") return send(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/__fake/calendar") {
      const { token, busy = [], down = false } = JSON.parse(await body(req));
      calendars.set(token, { busy, down });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__fake/revoked") {
      return send(res, 200, { revoked: revoked.has(url.searchParams.get("token")) });
    }

    if (req.method === "POST" && url.pathname === "/calendar/v3/freeBusy") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const calendar = calendars.get(token);
      if (!calendar || revoked.has(token)) return send(res, 401, { error: { code: 401 } });
      if (calendar.down) return send(res, 503, { error: { code: 503 } });
      const { timeMin, timeMax, items } = JSON.parse(await body(req));
      // Like Google: only the busy times that overlap the requested range.
      const busy = calendar.busy.filter((b) => b.start < timeMax && b.end > timeMin);
      return send(res, 200, { calendars: { [items[0].id]: { busy } } });
    }
    if (req.method === "POST" && url.pathname === "/revoke") {
      revoked.add(new URLSearchParams(await body(req)).get("token"));
      return send(res, 200, {});
    }
    send(res, 404, { error: "not found" });
  })
  .listen(port);
