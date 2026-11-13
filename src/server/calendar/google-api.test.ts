import { describe, expect, it, vi } from "vitest";
import { CALENDAR_SCOPES, hasCalendarScopes, withoutCalendarScopes } from "@/lib/calendar";
import { CalendarUnavailableError, queryFreeBusy, revokeGoogleToken } from "./google-api";

const range = { start: new Date("2026-11-09T00:00:00Z"), end: new Date("2026-11-10T00:00:00Z") };

function fakeFetch(respond: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async () => respond());
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const call = (f: typeof fetch) =>
  queryFreeBusy({ baseUrl: "https://g.test/v3", accessToken: "tok", calendarId: "primary", range, fetch: f });

async function failure(f: typeof fetch) {
  const error = await call(f).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CalendarUnavailableError);
  return (error as CalendarUnavailableError).kind;
}

describe("queryFreeBusy", () => {
  it("asks for one calendar's busy times, with the token, and returns them as Dates", async () => {
    const f = fakeFetch(() =>
      json({
        calendars: {
          primary: { busy: [{ start: "2026-11-09T04:00:00Z", end: "2026-11-09T05:00:00+00:00" }] },
        },
      }),
    );
    expect(await call(f)).toEqual([
      { start: new Date("2026-11-09T04:00:00Z"), end: new Date("2026-11-09T05:00:00Z") },
    ]);

    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://g.test/v3/freeBusy");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init?.body as string)).toEqual({
      timeMin: "2026-11-09T00:00:00.000Z",
      timeMax: "2026-11-10T00:00:00.000Z",
      items: [{ id: "primary" }],
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal); // never waits forever
  });

  it("an empty calendar is no busy times, not an error", async () => {
    expect(await call(fakeFetch(() => json({ calendars: { primary: { busy: [] } } })))).toEqual([]);
  });

  it("401 and 403 mean lost access: the host has to reconnect", async () => {
    expect(await failure(fakeFetch(() => json({}, 401)))).toBe("access_lost");
    expect(await failure(fakeFetch(() => json({}, 403)))).toBe("access_lost");
  });

  it("5xx, 429, network errors and timeouts mean unavailable: it clears by itself", async () => {
    expect(await failure(fakeFetch(() => json({}, 503)))).toBe("unavailable");
    expect(await failure(fakeFetch(() => json({}, 429)))).toBe("unavailable");
    expect(await failure(fakeFetch(() => Promise.reject(new TypeError("fetch failed"))))).toBe("unavailable");
    expect(
      await failure(fakeFetch(() => Promise.reject(new DOMException("timed out", "TimeoutError")))),
    ).toBe("unavailable");
  });

  it("reads per-calendar errors inside a 200: notFound is lost access, others are unavailable", async () => {
    const withError = (reason: string) =>
      fakeFetch(() => json({ calendars: { primary: { busy: [], errors: [{ domain: "global", reason }] } } }));
    expect(await failure(withError("notFound"))).toBe("access_lost");
    expect(await failure(withError("internalError"))).toBe("unavailable");
  });

  it("a response it can't read is an error, never 'no busy times'", async () => {
    // Treating garbage as an empty calendar would open every slot: the dangerous direction.
    expect(await failure(fakeFetch(() => json({ calendars: {} })))).toBe("unavailable");
    expect(await failure(fakeFetch(() => new Response("<html>", { status: 200 })))).toBe("unavailable");
    expect(
      await failure(
        fakeFetch(() => json({ calendars: { primary: { busy: [{ start: "tomorrow", end: "x" }] } } })),
      ),
    ).toBe("unavailable");
  });
});

describe("revokeGoogleToken", () => {
  it("posts the token to Google's revoke endpoint as a form", async () => {
    const f = fakeFetch(() => new Response(null, { status: 200 }));
    expect(await revokeGoogleToken("tok", f)).toBe(true);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init?.body)).toBe("token=tok");
  });

  it("never throws: disconnecting must work even if Google doesn't answer", async () => {
    expect(
      await revokeGoogleToken(
        "tok",
        fakeFetch(() => Promise.reject(new Error("down"))),
      ),
    ).toBe(false);
    expect(
      await revokeGoogleToken(
        "tok",
        fakeFetch(() => json({ error: "invalid_token" }, 400)),
      ),
    ).toBe(false);
  });
});

describe("calendar scopes", () => {
  const signIn = "openid,email,profile";
  const all = [signIn, ...CALENDAR_SCOPES].join(",");

  it("needs BOTH permissions (Google lets people untick one)", () => {
    expect(hasCalendarScopes(all)).toBe(true);
    expect(hasCalendarScopes(`${signIn},${CALENDAR_SCOPES[0]}`)).toBe(false);
    expect(hasCalendarScopes(signIn)).toBe(false);
    expect(hasCalendarScopes(null)).toBe(false);
  });

  it("reads Google's space-separated form too", () => {
    expect(hasCalendarScopes(["openid", ...CALENDAR_SCOPES].join(" "))).toBe(true);
  });

  it("disconnecting keeps the sign-in scopes and drops only the calendar ones", () => {
    expect(withoutCalendarScopes(all)).toBe(signIn);
    expect(withoutCalendarScopes(null)).toBe("");
  });
});
