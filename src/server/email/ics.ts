/*
 * iCalendar (.ics, RFC 5545) invites, attached to booking emails so the
 * meeting lands in Google Calendar / Outlook / Apple Calendar.
 *
 * Hand-written instead of a library because the parts that matter are few
 * and worth controlling exactly:
 *  - UID stays the same for one booking forever, SEQUENCE goes up on every
 *    change: calendar apps then UPDATE the existing event (reschedule) or
 *    REMOVE it (METHOD:CANCEL) instead of adding duplicates.
 *  - Times in UTC ("Z"), so no timezone definitions (VTIMEZONE) are needed;
 *    each calendar app shows them in its user's own zone.
 *  - Text escaping and 75-octet line folding, which many generators get wrong
 *    for non-ASCII names (a Bangla name is 3 bytes per character).
 */

export type IcsInvite = {
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  createdAt: Date; // DTSTAMP: when this version of the invite was generated
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
};

/** 2026-11-09T04:00:00.000Z -> 20261109T040000Z */
export function icsDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** TEXT values: backslash, semicolon, comma and newlines must be escaped. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Parameter values (CN=...): quote them; double quotes aren't allowed inside, so drop them. */
function paramValue(value: string): string {
  return `"${value.replace(/"/g, "").replace(/[\r\n]+/g, " ")}"`;
}

/**
 * Lines longer than 75 octets are folded: CRLF + one space, continuing the
 * line. Counted in UTF-8 bytes, and never splitting a multi-byte character.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;
  const limit = () => (parts.length === 0 ? 75 : 74); // continuation lines start with a space
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (currentBytes + bytes > limit()) {
      parts.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(invite: IcsInvite): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MeetReady//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${invite.method}`,
    "BEGIN:VEVENT",
    `UID:${invite.uid}`,
    `SEQUENCE:${invite.sequence}`,
    `DTSTAMP:${icsDate(invite.createdAt)}`,
    `DTSTART:${icsDate(invite.start)}`,
    `DTEND:${icsDate(invite.end)}`,
    `SUMMARY:${escapeText(invite.summary)}`,
    invite.description ? `DESCRIPTION:${escapeText(invite.description)}` : null,
    invite.location ? `LOCATION:${escapeText(invite.location)}` : null,
    invite.url ? `URL:${invite.url}` : null,
    `ORGANIZER;CN=${paramValue(invite.organizer.name)}:mailto:${invite.organizer.email}`,
    `ATTENDEE;CN=${paramValue(invite.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${invite.attendee.email}`,
    `STATUS:${invite.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  // RFC 5545 requires CRLF line endings, including after the last line.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
