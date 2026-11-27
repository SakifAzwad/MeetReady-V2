import { formatTime } from "./calendar";
import { cityName } from "./daylight";
import type { Interval } from "./intervals";
import { darkness } from "./sky";

/*
 * What the scrub marker says about one moment: the time for the guest, the
 * time for the host, whether it's dark at either end, and whether the host
 * works then. Pure, so the wording is tested, and the same text goes on
 * screen (lines) and to screen readers (one sentence).
 *
 *   2:00 PM for you
 *   8:00 PM in Dhaka, after sunset
 *   Outside Sakif's working hours
 *
 * Day 30, a team's page: the windows are the hours when EVERY host works (an
 * intersection), so naming one host's hours would be wrong, and the hosts may
 * be in several cities. It says "Everyone is working" / "Not everyone is
 * working" and shows only the guest's clock (the facts panel lists each
 * host's).
 *
 *   2:00 PM for you
 *   Not everyone is working
 *
 * Day 31, round-robin ("any"): the windows are when ANY host works, so it
 * says "Someone is working" / "Nobody is working".
 */
export function momentReadout({
  instant,
  guestZone,
  hostZone,
  hostName,
  windows,
  hour12 = true,
  team,
}: {
  instant: Date;
  guestZone: string;
  hostZone: string;
  hostName: string;
  windows: readonly Interval[];
  hour12?: boolean;
  /**
   * A team's event type: "all" (Day 30, collective: `windows` are when every host works) or "any"
   * (Day 31, round-robin: when at least one does).
   */
  team?: "all" | "any";
}): { lines: string[]; text: string } {
  const first = hostName.split(" ")[0];
  const working = windows.some((w) => w.start <= instant && instant < w.end);
  const withSky = (time: string, zone: string) => {
    const dark = darkness(instant, zone);
    return dark ? `${time}, ${dark}` : time;
  };
  const guestTime = formatTime(instant, guestZone, hour12);
  if (team) {
    const lines = [
      withSky(`${guestTime} for you`, guestZone),
      team === "any"
        ? working
          ? "Someone is working"
          : "Nobody is working"
        : working
          ? "Everyone is working"
          : "Not everyone is working",
    ];
    return { lines, text: `${lines.join(". ")}.` };
  }
  const hours = working ? `In ${first}'s working hours` : `Outside ${first}'s working hours`;
  const hostTime = formatTime(instant, hostZone, hour12);

  const lines =
    guestTime === hostTime && cityName(guestZone) === cityName(hostZone)
      ? [withSky(guestTime, guestZone), hours]
      : guestTime === hostTime
        ? [withSky(`${guestTime} for you and in ${cityName(hostZone)}`, hostZone), hours]
        : [
            withSky(`${guestTime} for you`, guestZone),
            withSky(`${hostTime} in ${cityName(hostZone)}`, hostZone),
            hours,
          ];
  return { lines, text: `${lines.join(". ")}.` };
}
