/*
 * A fake Google for the E2E tests (Day 15), so CI never calls the real one.
 * The app talks to it through GOOGLE_CALENDAR_API_URL and GOOGLE_REVOKE_URL
 * (set in playwright.config.ts). Plain Node, no dependencies.
 *
 * State is per access token, and every test's host has its own token, so
 * parallel tests can't see each other's calendars:
 *   POST /__fake/calendar  { token, busy: [{start,end}], down, eventsDown }   set a calendar
 *     (down: every call fails; eventsDown: only writing events fails, free/busy works)
 *   GET  /__fake/revoked?token=…                                   was it revoked?
 *   GET  /__fake/events?token=…                                    the events MeetReady wrote (Day 16)
 * What the app calls:
 *   POST /calendar/v3/freeBusy   (Authorization: Bearer <token>)
 *   POST|PATCH|DELETE /calendar/v3/calendars/primary/events[/id]   (Day 16)
 *   POST /revoke                 (form: token=…)
 *
 * Like Google, events the app writes count as busy in free/busy, so the
 * reschedule test proves a booking's own event doesn't block its move.
 */
import http from "node:http";

const port = Number(process.env.FAKE_GOOGLE_PORT ?? 3101);
const calendars = new Map(); // token -> { busy, down }
const events = new Map(); // token -> Map(eventId -> event)
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
      const { token, busy = [], down = false, eventsDown = false } = JSON.parse(await body(req));
      calendars.set(token, { busy, down, eventsDown });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/__fake/events") {
      return send(res, 200, [...(events.get(url.searchParams.get("token")) ?? new Map()).values()]);
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
      // Like Google: the busy times that overlap the requested range, our own events included.
      const own = [...(events.get(token) ?? new Map()).values()].map((e) => ({
        start: e.start.dateTime,
        end: e.end.dateTime,
      }));
      const busy = [...calendar.busy, ...own].filter(
        (b) => new Date(b.start) < new Date(timeMax) && new Date(b.end) > new Date(timeMin),
      );
      return send(res, 200, { calendars: { [items[0].id]: { busy } } });
    }
    const eventPath = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (eventPath) {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const calendar = calendars.get(token);
      if (!calendar || revoked.has(token)) return send(res, 401, { error: { code: 401 } });
      if (calendar.down || calendar.eventsDown) return send(res, 503, { error: { code: 503 } });
      const mine = events.get(token) ?? new Map();
      events.set(token, mine);
      const id = eventPath[2];
      if (req.method === "POST") {
        const event = JSON.parse(await body(req));
        if (mine.has(event.id)) return send(res, 409, { error: { code: 409 } });
        if (event.conferenceData?.createRequest) {
          event.conferenceData = {
            entryPoints: [
              { entryPointType: "video", uri: `https://meet.google.com/fake-${event.id.slice(2, 10)}` },
            ],
          };
        }
        mine.set(event.id, event);
        return send(res, 200, event);
      }
      if (req.method === "PATCH") {
        if (!mine.has(id)) return send(res, 404, { error: { code: 404 } });
        const event = { ...mine.get(id), ...JSON.parse(await body(req)) };
        mine.set(id, event);
        return send(res, 200, event);
      }
      if (req.method === "DELETE") {
        if (!mine.has(id)) return send(res, 410, { error: { code: 410 } });
        mine.delete(id);
        res.writeHead(204);
        return res.end();
      }
    }
    if (req.method === "POST" && url.pathname === "/revoke") {
      revoked.add(new URLSearchParams(await body(req)).get("token"));
      return send(res, 200, {});
    }
    send(res, 404, { error: "not found" });
  })
  .listen(port);
