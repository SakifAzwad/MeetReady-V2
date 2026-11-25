import { describe, expect, it } from "vitest";
import { momentReadout } from "./readout";
import { anyHostDiffers, hostCities, teamSentence } from "./team-band";

// Day 30. Everyone works 09:00–11:00 UTC on Mon 7 Dec 2026 (Ada in Dhaka, Grace in London).
const windows = [{ start: new Date("2026-12-07T09:00:00Z"), end: new Date("2026-12-07T11:00:00Z") }];
const AT = new Date("2026-12-07T10:00:00Z");

describe("the band on a team's page", () => {
  it("names the cities once each, in host order, and shortens a long list", () => {
    expect(hostCities(["Asia/Dhaka"])).toBe("Hosts in Dhaka");
    expect(hostCities(["Asia/Dhaka", "Europe/London", "Asia/Dhaka"])).toBe("Hosts in Dhaka and London");
    expect(hostCities(["Asia/Dhaka", "Europe/London", "Africa/Lagos", "Asia/Tokyo", "America/Lima"])).toBe(
      "Hosts in Dhaka, London, Lagos and 2 more",
    );
  });

  it("says when everyone works, on the guest's clock, never one host's hours or city", () => {
    expect(teamSentence(["3–5 PM"], true)).toBe("Everyone is working 3–5 PM your time.");
    expect(teamSentence(["9–11 AM"], false)).toBe("Everyone is working 9–11 AM.");
    expect(teamSentence([], true)).toBe("The hosts' hours don't overlap on this day.");
  });

  it("knows when a host's clock differs from the guest's", () => {
    expect(anyHostDiffers(["Europe/London"], "Europe/London", AT)).toBe(false);
    expect(anyHostDiffers(["Europe/London", "Asia/Dhaka"], "Europe/London", AT)).toBe(true);
  });

  it("the scrub readout: the guest's time, and whether everyone is working", () => {
    const readout = (instant: Date) =>
      momentReadout({
        instant,
        guestZone: "Europe/London",
        hostZone: "Asia/Dhaka",
        hostName: "Ada Lovelace",
        windows,
        team: true,
      }).lines;
    expect(readout(AT)).toEqual(["10:00 AM for you", "Everyone is working"]);
    // 08:30 UTC: Ada works (2:30 PM in Dhaka), Grace starts at 9. Day 29 said "Outside Acme's working hours".
    expect(readout(new Date("2026-12-07T08:30:00Z"))).toEqual(["8:30 AM for you", "Not everyone is working"]);
  });
});
