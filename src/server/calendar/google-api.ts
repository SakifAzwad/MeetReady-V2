import { z } from "zod";
import type { Interval } from "@/lib/scheduling/intervals";

/*
 * The two Google endpoints Day 15 needs, as plain functions over `fetch`
 * (passed in, so tests use a fake). No Google SDK: two JSON calls don't need
 * a 50 MB dependency, and every byte of the request is visible here.
 */

export type CalendarErrorKind = "access_lost" | "unavailable";

/** Google couldn't give us busy times. `kind` decides what the host is told (see calendarError in the schema). */
export class CalendarUnavailableError extends Error {
  constructor(
    readonly kind: CalendarErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CalendarUnavailableError";
  }
}

/**
 * A slow Google mustn't hang a booking. Past this, the call counts as
 * "unavailable": the booking is refused (fail closed) and the guest retries.
 */
export const GOOGLE_TIMEOUT_MS = 2500;

const freeBusyResponse = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z
        .array(z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }))
        .default([]),
      // Per-calendar problems (e.g. notFound) come here, with an HTTP 200 for the request as a whole.
      errors: z.array(z.object({ reason: z.string() })).optional(),
    }),
  ),
});

/**
 * POST /freeBusy for one calendar: busy intervals in [range.start, range.end).
 * Only times come back: free/busy never includes titles or attendees.
 */
export async function queryFreeBusy(opts: {
  baseUrl: string;
  accessToken: string;
  calendarId: string;
  range: Interval;
  fetch: typeof fetch;
}): Promise<Interval[]> {
  let res: Response;
  try {
    res = await opts.fetch(`${opts.baseUrl}/freeBusy`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: opts.range.start.toISOString(),
        timeMax: opts.range.end.toISOString(),
        items: [{ id: opts.calendarId }],
      }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch (cause) {
    // Network error or our timeout.
    throw new CalendarUnavailableError("unavailable", "Google Calendar didn't answer", { cause });
  }

  // 401: the token is no good. 403: usually a permission the host didn't grant (or a quota
  // error, which is also 403 at Google; both need the host's attention, not a retry loop).
  if (res.status === 401 || res.status === 403) {
    throw new CalendarUnavailableError("access_lost", `Google Calendar refused the token (${res.status})`);
  }
  if (!res.ok) {
    throw new CalendarUnavailableError("unavailable", `Google Calendar answered ${res.status}`);
  }

  const parsed = freeBusyResponse.safeParse(await res.json().catch(() => null));
  const calendar = parsed.success ? parsed.data.calendars[opts.calendarId] : undefined;
  if (!calendar) throw new CalendarUnavailableError("unavailable", "Unexpected free/busy response");
  if (calendar.errors?.length) {
    const reasons = calendar.errors.map((e) => e.reason).join(", ");
    // notFound: the calendar is gone or no longer shared with this account.
    const kind = calendar.errors.some((e) => e.reason === "notFound") ? "access_lost" : "unavailable";
    throw new CalendarUnavailableError(kind, `Google Calendar error: ${reasons}`);
  }
  return calendar.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

/**
 * Revokes the host's grant at Google (on disconnect). Revoking an access token
 * also revokes the refresh token of the same grant, so the stored tokens stop
 * working even if a copy survived somewhere. Best effort: the caller deletes
 * its own copies whatever happens here.
 */
export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch,
  url = "https://oauth2.googleapis.com/revoke",
): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
