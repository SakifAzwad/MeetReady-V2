import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, icsDate, type IcsInvite } from "./ics";

const invite: IcsInvite = {
  method: "REQUEST",
  uid: "4f9c2a1e-0000-4000-8000-000000000001@meetready",
  sequence: 0,
  start: new Date("2026-11-09T04:00:00Z"),
  end: new Date("2026-11-09T04:30:00Z"),
  createdAt: new Date("2026-11-07T10:15:30.123Z"),
  summary: "Intro call: Ada, Sakif",
  description: "Line one\nLine two; with semicolon",
  location: "https://us05web.zoom.us/j/123",
  organizer: { name: 'Sakif "S" Azwad', email: "sakif@example.com" },
  attendee: { name: "Ada Lovelace", email: "ada@example.com" },
};

describe("buildIcs", () => {
  const ics = buildIcs(invite);
  const lines = ics.split("\r\n");

  it("uses CRLF line endings throughout, ending with one", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes times in UTC basic format", () => {
    expect(icsDate(new Date("2026-11-07T10:15:30.123Z"))).toBe("20261107T101530Z");
    expect(lines).toContain("DTSTART:20261109T040000Z");
    expect(lines).toContain("DTEND:20261109T043000Z");
  });

  it("escapes text and strips quotes from names", () => {
    expect(lines).toContain("SUMMARY:Intro call: Ada\\, Sakif");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two\\; with semicolon");
    expect(ics).toContain('ORGANIZER;CN="Sakif S Azwad":mailto:sakif@example.com');
  });

  it("is an update or a cancellation of the same event via UID + SEQUENCE + METHOD", () => {
    const updated = buildIcs({ ...invite, sequence: 1, start: new Date("2026-11-09T05:00:00Z") });
    const cancelled = buildIcs({ ...invite, sequence: 2, method: "CANCEL" });
    for (const v of [updated, cancelled]) expect(v).toContain(`UID:${invite.uid}`);
    expect(updated).toContain("SEQUENCE:1");
    expect(cancelled).toContain("METHOD:CANCEL");
    expect(cancelled).toContain("STATUS:CANCELLED");
  });

  it("has every line within 75 octets", () => {
    const long = buildIcs({
      ...invite,
      description: "x".repeat(400),
      attendee: { name: "আদা লাভলেস", email: "a@b.c" },
    });
    for (const line of long.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("escapeText", () => {
  it("escapes the backslash first, so escapes aren't escaped twice", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
});

describe("foldLine", () => {
  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:short")).toBe("SUMMARY:short");
  });

  it("folds at 75 octets and unfolds back to the original", () => {
    const line = `DESCRIPTION:${"a".repeat(200)}`;
    const folded = foldLine(line);
    expect(folded.split("\r\n ")[0]).toHaveLength(75);
    expect(folded.replace(/\r\n /g, "")).toBe(line); // unfolding = removing CRLF+space
  });

  it("never splits a multi-byte character", () => {
    const line = `SUMMARY:${"বাংলা".repeat(20)}`; // 3 bytes per character
    const folded = foldLine(line);
    expect(folded.replace(/\r\n /g, "")).toBe(line); // every character survives intact
    // Counting characters instead of bytes would put ~3x too much on each line.
    for (const part of folded.split("\r\n ")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
  });
});
