/*
 * Error monitoring settings shared by the server (instrumentation.ts) and the
 * browser (instrumentation-client.ts). Pure functions, no Sentry import, so
 * the privacy rules are unit-tested on their own (monitoring.test.ts).
 *
 * Privacy rules, in order of how much they matter:
 *  1. The guest's manage token is a password: /booking/{token} lets anyone
 *     cancel or move that meeting. Error reports carry the page URL, request
 *     URLs in breadcrumbs, and sometimes URLs inside messages. Every string in
 *     an event is rewritten before it leaves the app, wherever the token sits.
 *  2. No cookies (sessions), no IP addresses, no user record, no request
 *     bodies: switched off in DATA_COLLECTION, and dropped again by scrubEvent.
 *  3. Database errors carry the query's values (guest names, notes, answers):
 *     redacted. Email addresses in any string become "[email]".
 */

/** Patterns for secrets and guest data inside any string of an event, and what replaces them. */
const SECRETS: [RegExp, string][] = [
  // The guest's manage page.
  [/\/booking\/[A-Za-z0-9_-]{16,}/g, "/booking/[token]"],
  // /api/slots?…&reschedule=<token> while a guest reschedules.
  [/((?:^|[?&])reschedule=)[^&#\s"']+/g, "$1[token]"],
  // Drizzle's error message ends with the query's values: "Failed query: insert …\nparams: Ada,ada@…,notes".
  // The SQL is useful; the values are guest data (names, notes, answers). Everything after "params:" goes.
  [/\nparams: [\s\S]*$/g, "\nparams: [redacted]"],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function scrubString(value: string): string {
  return SECRETS.reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), value);
}

/**
 * Rewrites every string in an event (or breadcrumb), however deeply nested.
 * A denylist of patterns applied everywhere is safer than scrubbing known
 * fields: the SDK adds fields over time, and a token copied into a new one
 * would otherwise slip through.
 */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 12) return value; // events are shallow; this only guards against cycles
  if (typeof value === "string") return scrubString(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v, depth + 1);
    return out as T;
  }
  return value;
}

/** The parts of a Sentry event this module touches (kept structural: no Sentry types needed). */
type EventLike = {
  request?: { cookies?: unknown; headers?: Record<string, string>; [key: string]: unknown };
  user?: unknown;
  [key: string]: unknown;
};

/** beforeSend: drop identity, then scrub every string. */
export function scrubEvent<T extends object>(event: T): T {
  const copy = { ...event } as EventLike;
  delete copy.user;
  if (copy.request) {
    // Dropped whole, not scrubbed:
    //  - cookies: the session;
    //  - data: a request body, e.g. a booking form (name, email, answers);
    //  - query_string: Sentry may store it as "a=1&reschedule=…" or as key/value
    //    pairs, where a token pattern can't be recognised. The URL keeps the
    //    query, and URLs are scrubbed below.
    const request = { ...copy.request };
    delete request.cookies;
    delete request.data;
    delete request.query_string;
    const headers = request.headers;
    copy.request = {
      ...request,
      // Keep only harmless headers; cookies and auth never leave.
      headers: headers ? pick(headers, ["user-agent", "referer", "content-type"]) : undefined,
    };
  }
  return scrubDeep(copy) as unknown as T;
}

function pick(headers: Record<string, string>, keep: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => keep.includes(k.toLowerCase())));
}

/**
 * What the SDK may collect on its own. In Sentry v11 every one of these
 * defaults to ON (cookies, user and IP, request bodies, query params, local
 * variables in stack frames, database query values), so each is turned off
 * here explicitly. scrubEvent is the second line of defence, not the first.
 */
export const DATA_COLLECTION = {
  userInfo: false, // no user record, and no IP address
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent", "referer", "content-type"] }, response: false },
  httpBodies: [], // never request or response bodies (booking forms hold names, emails, answers)
  urlQueryParams: { deny: ["reschedule"] }, // the reschedule token
  stackFrameVariables: false, // a local variable could be a guest's email
  databaseQueryData: false, // bound query values are guest data
};

/**
 * Browser noise that isn't our bug. Expected outcomes ("slot taken", "not
 * found", invalid input) never reach Sentry at all: the app RETURNS them as
 * results instead of throwing, so only real crashes are reported.
 */
export const IGNORE_ERRORS = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
];

/** Errors thrown inside browser extensions, which run in our page but aren't our code. */
export const DENY_URLS = [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-web-extension:\/\//];

/** "production" or "preview" on Vercel, "development" elsewhere. */
export function monitoringEnvironment(vercelEnv: string | undefined): string {
  return vercelEnv || "development";
}

/**
 * A copy of an error that's safe to hand to a third party (Day 17: Inngest
 * stores the error of every failed step, and shows it in its dashboard). The
 * message and its causes' messages are joined and scrubbed: a database error
 * carries the query's values (guest names, notes), a Resend error may quote
 * an address. The name is kept (it says what kind of failure it was); the
 * original stack and cause objects are not passed on.
 */
export function scrubError(error: unknown): Error {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    messages.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  const safe = new Error(scrubString(messages.join(" <- caused by: ")));
  safe.name = error instanceof Error ? error.name : "Error";
  return safe;
}
