import { describe, expect, it } from "vitest";
import { formatAvailabilityText, pickSuggestedSlots } from "./suggest";

// Dhaka host, 09:00–17:00 (03:00–11:00 UTC), 30-minute slots, Mon 9 – Fri 13 Nov 2026.
const slots = ["09", "10", "11", "12", "13"].flatMap((d) =>
  Array.from({ length: 16 }, (_, i) => {
    const start = new Date(`2026-11-${d}T03:00:00Z`);
    start.setUTCMinutes(i * 30);
    return { start, end: new Date(start.getTime() + 30 * 60_000) };
  }),
);
const iso = (xs: { start: Date }[]) => xs.map((x) => x.start.toISOString());

describe("pickSuggestedSlots", () => {
  it("London: the first daytime slot (8 AM) on three different days", () => {
    expect(iso(pickSuggestedSlots(slots, "Europe/London"))).toEqual([
      "2026-11-09T08:00:00.000Z",
      "2026-11-10T08:00:00.000Z",
      "2026-11-11T08:00:00.000Z",
    ]);
  });

  it("New York: no daytime slots, so each day's slot nearest to daytime (not midnight)", () => {
    // Sun 8 Nov: only 10 PM–midnight, so 10 PM. Mon 9 and Tue 10: midnight–6 AM and 10 PM–midnight;
    // 5:30 AM and 10 PM are both 2 h from daytime, and the earlier one wins the tie.
    expect(iso(pickSuggestedSlots(slots, "America/New_York"))).toEqual([
      "2026-11-09T03:00:00.000Z", // Sun 10:00 PM
      "2026-11-09T10:30:00.000Z", // Mon 5:30 AM
      "2026-11-10T10:30:00.000Z", // Tue 5:30 AM
    ]);
  });

  it("prefers daytime days over earlier night-only days", () => {
    // One night slot on Monday for London (01:00 UTC), daytime only from Tuesday.
    const mixed = [
      { start: new Date("2026-11-09T01:00:00Z"), end: new Date("2026-11-09T01:30:00Z") },
      ...slots.filter((s) => s.start >= new Date("2026-11-10T00:00:00Z")),
    ];
    const picked = iso(pickSuggestedSlots(mixed, "Europe/London"));
    expect(picked).not.toContain("2026-11-09T01:00:00.000Z");
    expect(picked).toHaveLength(3);
  });

  it("returns fewer when there are fewer days, and nothing for no slots", () => {
    expect(pickSuggestedSlots(slots.slice(0, 16), "Europe/London")).toHaveLength(1);
    expect(pickSuggestedSlots([], "Europe/London")).toEqual([]);
  });
});

describe("formatAvailabilityText", () => {
  const base = {
    durationMinutes: 30,
    hostZone: "Asia/Dhaka",
    hostCity: "Dhaka",
    link: "https://meetready.app/sakif/intro",
  };

  it("writes the message in the recipient's time, with the host's beside it", () => {
    const text = formatAvailabilityText({
      ...base,
      slots: pickSuggestedSlots(slots, "Europe/London"),
      recipientZone: "Europe/London",
      recipientCity: "London",
    });
    expect(text).toBe(
      [
        "Here are 3 times for a 30-minute call, shown in your time (London):",
        "",
        "Mon 9 Nov, 8:00 AM (2:00 PM for me in Dhaka)",
        "Tue 10 Nov, 8:00 AM (2:00 PM for me in Dhaka)",
        "Wed 11 Nov, 8:00 AM (2:00 PM for me in Dhaka)",
        "",
        "Or pick any time that suits you: https://meetready.app/sakif/intro",
      ].join("\n"),
    );
  });

  it("names the host's date when it differs, and supports 24-hour times", () => {
    const text = formatAvailabilityText({
      ...base,
      slots: pickSuggestedSlots(slots, "America/New_York").slice(0, 1),
      recipientZone: "America/New_York",
      recipientCity: "New York",
      hour12: false,
    });
    expect(text.split("\n")[0]).toBe("Here's a time for a 30-minute call, shown in your time (New York):");
    expect(text.split("\n")[2]).toBe("Sun 8 Nov, 22:00 (Mon 9 Nov, 09:00 for me in Dhaka)");
  });

  it("leaves out the second clock when both are in the same timezone", () => {
    const text = formatAvailabilityText({
      ...base,
      durationMinutes: 60,
      slots: pickSuggestedSlots(slots, "Asia/Dhaka").slice(0, 1),
      recipientZone: "Asia/Dhaka",
      recipientCity: "Dhaka",
    });
    expect(text.split("\n").slice(0, 3)).toEqual([
      "Here's a time for a 1-hour call:",
      "",
      "Mon 9 Nov, 9:00 AM",
    ]);
  });
});
