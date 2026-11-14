import { describe, expect, it } from "vitest";
import { monitoringEnvironment, scrubDeep, scrubError, scrubEvent, scrubString } from "./monitoring";

const TOKEN = "Zq3vK9xT1mW8pL2rB7nC4yH6dF0gJ5sA_e-Uo1iRkPw"; // 43 chars, like a real manage token

describe("scrubString", () => {
  it("hides a manage token in any URL form", () => {
    expect(scrubString(`https://meetreadyv2.vercel.app/booking/${TOKEN}`)).toBe(
      "https://meetreadyv2.vercel.app/booking/[token]",
    );
    expect(scrubString(`/booking/${TOKEN}?view=x`)).toBe("/booking/[token]?view=x");
    expect(scrubString(`GET /booking/${TOKEN} failed`)).toBe("GET /booking/[token] failed");
  });

  it("hides the reschedule token in the slots API query, with or without a leading ? or &", () => {
    expect(scrubString(`reschedule=${TOKEN}&x=1`)).toBe("reschedule=[token]&x=1");
    expect(scrubString(`/api/slots?username=a&slug=b&reschedule=${TOKEN}&x=1`)).toBe(
      "/api/slots?username=a&slug=b&reschedule=[token]&x=1",
    );
  });

  it("hides email addresses", () => {
    expect(scrubString("Booking for ada.lovelace+test@example.co.uk failed")).toBe(
      "Booking for [email] failed",
    );
  });

  it("redacts the values in a database error, keeping the SQL", () => {
    const error = `Failed query: insert into "bookings" ("guest_name", "guest_notes") values ($1, $2)
params: Ada Lovelace,Line one of my notes
Line two,{"Company":"Acme Corp"}`;
    expect(scrubString(error)).toBe(
      `Failed query: insert into "bookings" ("guest_name", "guest_notes") values ($1, $2)\nparams: [redacted]`,
    );
  });

  it("leaves ordinary text and routes alone", () => {
    for (const s of [
      "/sakifazwad18/intro",
      "/booking/[token]",
      "TypeError: x is undefined",
      "/booking/short",
    ]) {
      expect(scrubString(s)).toBe(s);
    }
  });
});

describe("scrubEvent", () => {
  const event = {
    message: `Couldn't load /booking/${TOKEN}`,
    user: { email: "ada@example.com", ip_address: "203.0.113.7" },
    request: {
      url: `https://meetreadyv2.vercel.app/booking/${TOKEN}`,
      cookies: { "better-auth.session_token": "secret" },
      data: { guestName: "Ada Lovelace", guestEmail: "ada@example.com", answers: { x: "Acme Corp" } },
      query_string: [["reschedule", TOKEN]],
      headers: {
        Cookie: "better-auth.session_token=secret",
        "User-Agent": "Firefox",
        Authorization: "Bearer x",
      },
    },
    breadcrumbs: [
      { category: "navigation", data: { from: "/", to: `/booking/${TOKEN}` } },
      { category: "fetch", data: { url: `/api/slots?username=a&slug=b&reschedule=${TOKEN}` } },
    ],
    exception: { values: [{ value: `Not found: /booking/${TOKEN}`, type: "Error" }] },
  };

  it("leaves no token, cookie, user or email anywhere in the event", () => {
    const scrubbed = scrubEvent(event);
    const json = JSON.stringify(scrubbed);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("ada@example.com");
    expect(json).not.toContain("203.0.113.7");
    expect(json).not.toContain("Ada Lovelace"); // the booking form body
    expect(json).not.toContain("Acme Corp");
    expect(scrubbed.user).toBeUndefined();
  });

  it("keeps what's useful for debugging", () => {
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request?.url).toBe("https://meetreadyv2.vercel.app/booking/[token]");
    expect(scrubbed.request?.headers).toEqual({ "User-Agent": "Firefox" });
    expect(JSON.stringify(scrubbed.breadcrumbs)).toContain("/api/slots?username=a&slug=b&reschedule=[token]");
  });

  it("doesn't change the original event object", () => {
    scrubEvent(event);
    expect(event.request.url).toContain(TOKEN);
  });
});

describe("scrubDeep", () => {
  it("handles nested arrays and non-string values", () => {
    expect(scrubDeep({ a: [1, null, { b: `x/booking/${TOKEN}` }], c: true })).toEqual({
      a: [1, null, { b: "x/booking/[token]" }],
      c: true,
    });
  });
});

it("names the environment after Vercel's, or development", () => {
  expect(monitoringEnvironment("production")).toBe("production");
  expect(monitoringEnvironment("preview")).toBe("preview");
  expect(monitoringEnvironment(undefined)).toBe("development");
});

describe("scrubError (Day 17: errors stored by the job queue)", () => {
  it("drops query values and addresses from the error and its causes, keeping the kind", () => {
    const db = new Error(
      'Failed query: insert into "bookings" ...\nparams: Ada,ada@example.com,secret notes',
    );
    const wrapped = new Error("Sending failed", { cause: new Error("Resend: bad address ada@example.com") });
    const retry = Object.assign(new Error("Google Calendar write failed", { cause: db }), {
      name: "RetryLaterError",
    });

    expect(scrubError(db).message).toBe('Failed query: insert into "bookings" ...\nparams: [redacted]');
    expect(scrubError(wrapped).message).toBe("Sending failed <- caused by: Resend: bad address [email]");
    const safe = scrubError(retry);
    expect(safe.name).toBe("RetryLaterError");
    expect(safe.message).not.toMatch(/Ada|secret|@/);
    expect(safe.cause).toBeUndefined();
  });

  it("copes with things that aren't errors", () => {
    expect(scrubError("plain ada@example.com").message).toBe("plain [email]");
  });
});
