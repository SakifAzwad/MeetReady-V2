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

// ─── Events (Day 16): writing bookings to the host's calendar ──────────────────

/** What a booking looks like as an event in the host's calendar. */
export type CalendarEvent = {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  /** Shown in the event's location field (Zoom link, phone, address). Not used for Meet. */
  location?: string;
  /** Ask Google to create a Meet link with the event. */
  withMeet: boolean;
  /** Our booking id, kept on the event (private extended property) and used as the Meet request id. */
  bookingId: string;
};

/**
 * The event's id in Google, derived from the booking id. Google lets the
 * client choose event ids (base32hex: 0-9 and a-v, 5 to 1024 characters); a
 * UUID without dashes is hex, which fits. Choosing it ourselves makes
 * creating IDEMPOTENT: if a create times out after Google saved it, the
 * retry gets "409 already exists" instead of making a second event.
 */
export function googleEventId(bookingId: string): string {
  return `mr${bookingId.replaceAll("-", "").toLowerCase()}`;
}

const eventResponse = z.object({
  id: z.string(),
  conferenceData: z
    .object({
      entryPoints: z.array(z.object({ entryPointType: z.string(), uri: z.string() })).optional(),
    })
    .optional(),
});

type EventsCall = {
  baseUrl: string;
  accessToken: string;
  calendarId: string;
  fetch: typeof fetch;
};

async function eventsRequest(
  call: EventsCall,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  // sendUpdates=none: Google never emails anyone about these events. Guests get MeetReady's own email.
  const url = `${call.baseUrl}/calendars/${encodeURIComponent(call.calendarId)}/events${path}${
    path.includes("?") ? "&" : "?"
  }sendUpdates=none`;
  let res: Response;
  try {
    res = await call.fetch(url, {
      method,
      headers: { Authorization: `Bearer ${call.accessToken}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new CalendarUnavailableError("unavailable", "Google Calendar didn't answer", { cause });
  }
  if (res.status === 401 || res.status === 403) {
    throw new CalendarUnavailableError("access_lost", `Google Calendar refused the token (${res.status})`);
  }
  return res;
}

function eventBody(e: CalendarEvent) {
  return {
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.start.toISOString() },
    end: { dateTime: e.end.toISOString() },
    location: e.withMeet ? undefined : e.location,
    extendedProperties: { private: { meetreadyBookingId: e.bookingId } },
  };
}

async function readEvent(res: Response): Promise<{ meetUrl: string | null }> {
  const parsed = eventResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new CalendarUnavailableError("unavailable", "Unexpected event response");
  const video = parsed.data.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video");
  return { meetUrl: video?.uri ?? null };
}

/**
 * Creates the booking's event, or brings it up to date if it already exists
 * (a retry, or a reschedule). Returns the Meet link if there is one.
 */
export async function upsertGoogleEvent(
  call: EventsCall & { event: CalendarEvent; exists: boolean },
): Promise<{ meetUrl: string | null }> {
  const id = googleEventId(call.event.bookingId);
  const patch = async () => {
    const res = await eventsRequest(call, "PATCH", `/${id}?conferenceDataVersion=1`, eventBody(call.event));
    // The host deleted the event in Google: their choice, so it isn't recreated.
    if (res.status === 404 || res.status === 410) return { meetUrl: null };
    if (!res.ok)
      throw new CalendarUnavailableError("unavailable", `Updating the event failed (${res.status})`);
    return readEvent(res);
  };
  if (call.exists) return patch();

  const res = await eventsRequest(call, "POST", "?conferenceDataVersion=1", {
    id,
    ...eventBody(call.event),
    // conferenceDataVersion=1 + createRequest: Google creates a Meet link for this event.
    // requestId makes the request idempotent on Google's side too.
    ...(call.event.withMeet && {
      conferenceData: {
        createRequest: { requestId: call.event.bookingId, conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    }),
  });
  // 409: an earlier attempt already created it (it timed out on our side). Update it instead.
  if (res.status === 409) return patch();
  if (!res.ok) throw new CalendarUnavailableError("unavailable", `Creating the event failed (${res.status})`);
  return readEvent(res);
}

/** Removes the booking's event. Already gone (404/410: the host deleted it) counts as done. */
export async function deleteGoogleEvent(call: EventsCall & { bookingId: string }): Promise<void> {
  const res = await eventsRequest(call, "DELETE", `/${googleEventId(call.bookingId)}`);
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new CalendarUnavailableError("unavailable", `Deleting the event failed (${res.status})`);
}
