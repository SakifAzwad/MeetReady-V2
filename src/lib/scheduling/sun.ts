/*
 * Where the sun is, from NOAA's solar calculator equations (the ones in
 * NOAA's published spreadsheet, after Jean Meeus, "Astronomical Algorithms").
 * Pure maths, no API: given a place and a moment, the sun's elevation; given
 * a place and a UTC date, sunrise, sunset and civil twilight. Accurate to
 * about a minute between the polar circles; that's far more than a colour
 * gradient needs, and the tests hold it to ±3 minutes against published
 * times.
 *
 * Conventions: latitude north positive, longitude east positive, degrees.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 86_400_000;

/** Sun's centre this far below the horizon = sunrise/sunset (refraction + the sun's radius). */
export const SUNRISE_ALTITUDE = -0.833;
/** Civil twilight: the sky is light enough to see by until the sun is 6° below the horizon. */
export const CIVIL_ALTITUDE = -6;

/** Declination and the equation of time (minutes) at a Julian century T. */
function solarTerms(t: number): { declination: number; eqTime: number } {
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360; // geometric mean longitude
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t); // mean anomaly
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // orbit eccentricity
  const c =
    Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * RAD) * 0.000289; // equation of centre
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliq * RAD) * Math.sin(apparentLong * RAD)) * DEG;
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * l0 * RAD) -
      2 * e * Math.sin(m * RAD) +
      4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) -
      0.5 * y * y * Math.sin(4 * l0 * RAD) -
      1.25 * e * e * Math.sin(2 * m * RAD));
  return { declination, eqTime };
}

/** Julian centuries since J2000.0 for an instant. */
const julianCentury = (ms: number) => (ms / DAY_MS + 2440587.5 - 2451545) / 36525;

/**
 * The sun's elevation above the horizon (degrees) and its hour angle
 * (degrees; negative = morning, before solar noon) at an instant and place.
 */
export function solarPosition(
  instant: Date,
  lat: number,
  lon: number,
): { elevation: number; hourAngle: number } {
  const { declination, eqTime } = solarTerms(julianCentury(instant.getTime()));
  const utcMinutes = (((instant.getTime() % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
  const trueSolarMinutes = (((utcMinutes + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarMinutes / 4 - 180;
  const cosZenith =
    Math.sin(lat * RAD) * Math.sin(declination * RAD) +
    Math.cos(lat * RAD) * Math.cos(declination * RAD) * Math.cos(hourAngle * RAD);
  const elevation = 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG;
  return { elevation, hourAngle };
}

export type SunDay = {
  solarNoon: Date;
  /** null when the sun doesn't cross that altitude that day (see `polar`). */
  sunrise: Date | null;
  sunset: Date | null;
  /** Civil twilight begins / ends. null on "white nights": it never gets darker than twilight. */
  dawn: Date | null;
  dusk: Date | null;
  /** "day": the sun never sets. "night": it never rises. null: an ordinary day. */
  polar: "day" | "night" | null;
};

/**
 * Sun events around the solar noon that falls on UTC date `utcDate`
 * ("YYYY-MM-DD") at this longitude. Callers that work in local days take a
 * few consecutive UTC dates and keep the events they need; this function
 * deliberately knows nothing about timezones.
 */
export function sunDay(utcDate: string, lat: number, lon: number): SunDay {
  const midnight = Date.parse(`${utcDate}T00:00:00Z`);
  // Two passes: the equation of time depends (slightly) on the moment, so
  // compute noon roughly, then again with the terms at that noon.
  let noonMinutes = 720 - 4 * lon;
  let terms = solarTerms(julianCentury(midnight + noonMinutes * 60_000));
  noonMinutes = 720 - 4 * lon - terms.eqTime;
  terms = solarTerms(julianCentury(midnight + noonMinutes * 60_000));
  noonMinutes = 720 - 4 * lon - terms.eqTime;
  const solarNoon = new Date(midnight + noonMinutes * 60_000);

  /** cos of the hour angle at which the sun is at `altitude`; outside [-1, 1] = never reached. */
  const cosHourAngle = (altitude: number) =>
    (Math.sin(altitude * RAD) - Math.sin(lat * RAD) * Math.sin(terms.declination * RAD)) /
    (Math.cos(lat * RAD) * Math.cos(terms.declination * RAD));
  const crossing = (altitude: number): [Date, Date] | "always-above" | "always-below" => {
    const cos = cosHourAngle(altitude);
    if (cos < -1) return "always-above";
    if (cos > 1) return "always-below";
    const minutes = 4 * Math.acos(cos) * DEG;
    return [
      new Date(solarNoon.getTime() - minutes * 60_000),
      new Date(solarNoon.getTime() + minutes * 60_000),
    ];
  };

  const rise = crossing(SUNRISE_ALTITUDE);
  const civil = crossing(CIVIL_ALTITUDE);
  return {
    solarNoon,
    sunrise: Array.isArray(rise) ? rise[0] : null,
    sunset: Array.isArray(rise) ? rise[1] : null,
    dawn: Array.isArray(civil) ? civil[0] : null,
    dusk: Array.isArray(civil) ? civil[1] : null,
    polar: rise === "always-above" ? "day" : rise === "always-below" ? "night" : null,
  };
}

/** Day, twilight (civil) or night at an instant and place. */
export function sunPhase(instant: Date, lat: number, lon: number): "day" | "twilight" | "night" {
  const { elevation } = solarPosition(instant, lat, lon);
  if (elevation > SUNRISE_ALTITUDE) return "day";
  if (elevation > CIVIL_ALTITUDE) return "twilight";
  return "night";
}
