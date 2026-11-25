import { cityName, offsetDifference } from "./daylight";

/*
 * Day 30: the daylight band's words on a team's booking page. Its windows are
 * the hours when EVERY host works, in several cities at once, so the
 * one-host sentences ("Sakif works 9 AM–5 PM in Dhaka") would claim one
 * person's hours and one city's clock. These say what the band shows: when
 * everyone works, on the guest's own clock. Pure, so the wording is tested.
 */

const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** "Hosts in Dhaka and London", "Hosts in Dhaka, London, Lagos and 2 more". Cities once each, in host order. */
export function hostCities(zones: readonly string[]): string {
  const cities = [...new Set(zones.map(cityName))];
  if (cities.length <= 3) return `Hosts in ${list.format(cities)}`;
  return `Hosts in ${cities.slice(0, 3).join(", ")} and ${cities.length - 3} more`;
}

/** Whether any host's clock differs from the guest's at `at` (else every clock reads the same). */
export function anyHostDiffers(zones: readonly string[], guestZone: string, at: Date): boolean {
  return zones.some((z) => offsetDifference(z, guestZone, at) !== null);
}

/** The sentence under the band: the shared hours in the guest's time, or that there are none. */
export function teamSentence(yourRanges: readonly string[], anyDiffers: boolean): string {
  if (yourRanges.length === 0) return "The hosts' hours don't overlap on this day.";
  return `Everyone is working ${yourRanges.join(" and ")}${anyDiffers ? " your time" : ""}.`;
}
