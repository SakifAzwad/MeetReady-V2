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
 */
export function momentReadout({
  instant,
  guestZone,
  hostZone,
  hostName,
  windows,
  hour12 = true,
}: {
  instant: Date;
  guestZone: string;
  hostZone: string;
  hostName: string;
  windows: readonly Interval[];
  hour12?: boolean;
}): { lines: string[]; text: string } {
  const first = hostName.split(" ")[0];
  const working = windows.some((w) => w.start <= instant && instant < w.end);
  const hours = working ? `In ${first}'s working hours` : `Outside ${first}'s working hours`;
  const withSky = (time: string, zone: string) => {
    const dark = darkness(instant, zone);
    return dark ? `${time}, ${dark}` : time;
  };
  const guestTime = formatTime(instant, guestZone, hour12);
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
