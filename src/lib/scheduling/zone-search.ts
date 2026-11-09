import { cityName, utcOffsetMinutes } from "./daylight";
import { ZONE_ALIASES, ZONES } from "./zone-data.generated";

/*
 * Finding a timezone by what people actually type: a city ("dhaka",
 * "sao paulo"), a country ("bangladesh", "uk"), or an offset ("gmt+5:30").
 * Pure (no DOM), so the ranking is unit-tested; the combobox only renders it.
 */

export type ZoneOption = {
  /** The id this runtime uses (may be an old name like "Asia/Calcutta"); valid for Intl and the server. */
  id: string;
  city: string;
  /** "Bangladesh", or null for zones like UTC that aren't in a country. */
  country: string | null;
  /** "GMT+6", "GMT+5:30", "GMT−5" at the given instant (DST-aware). */
  offset: string;
  offsetMinutes: number;
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** Short names people type that aren't the official country name. */
const COUNTRY_NICKNAMES: Record<string, string[]> = {
  GB: ["uk", "england", "britain", "scotland", "wales"],
  US: ["usa", "us", "america"],
  AE: ["uae", "dubai"],
  KR: ["korea"],
  NL: ["holland"],
};

export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "GMT";
  const sign = minutes > 0 ? "+" : "−"; // a real minus sign, like printed timetables
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** City and country only: no clock involved, so it's safe to render on the server. */
export function zoneName(id: string): { city: string; country: string | null } {
  const code = ZONES[ZONE_ALIASES[id] ?? id]?.[0];
  return {
    city: id === "UTC" || id === "Etc/UTC" ? "UTC" : cityName(id),
    country: code ? (regionNames.of(code) ?? null) : null,
  };
}

/** Display data for one zone id, with its offset at `at` (offsets change with DST). */
export function zoneOption(id: string, at: Date): ZoneOption {
  const minutes = utcOffsetMinutes(at, id);
  return { id, ...zoneName(id), offset: offsetLabel(minutes), offsetMinutes: minutes };
}

/**
 * Every zone this runtime knows, one entry per place: an old alias and its
 * new name ("Asia/Calcutta", "Asia/Kolkata") would show as two identical
 * "Kolkata" rows, so only the first one this runtime lists is kept.
 */
export function allZoneOptions(
  at: Date,
  ids: readonly string[] = Intl.supportedValuesOf("timeZone"),
): ZoneOption[] {
  const seen = new Set<string>();
  const options: ZoneOption[] = [];
  for (const id of ["UTC", ...ids]) {
    const key = ZONE_ALIASES[id] ?? id;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(zoneOption(id, at));
  }
  return options;
}

/** Lowercase, accents removed, underscores and punctuation to spaces: "São_Paulo" -> "sao paulo". */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[_/,.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "gmt+5:30", "utc-5", "+6" -> minutes, or null if the query isn't an offset. */
export function parseOffsetQuery(query: string): number | null {
  const m = query
    .trim()
    .toLowerCase()
    .replace("−", "-")
    .match(/^(?:gmt|utc)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === "-" ? -minutes : minutes;
}

/**
 * Ranked matches. Lower score = better:
 *   0 exact city, country or nickname ("india" must beat "Indianapolis"),
 *   1 city starts with the query, 2 a later word in the city does,
 *   3 country starts with it, 4 it appears anywhere (city, country, id).
 * An offset query ("gmt+6") matches zones at that offset right now.
 * Ties keep the input order (alphabetical by id from Intl), so results are stable.
 */
export function searchZones(query: string, options: readonly ZoneOption[], limit = 8): ZoneOption[] {
  const q = normalise(query);
  if (!q) return [];

  const offset = parseOffsetQuery(query);
  // No population data to rank by, so offset matches are all returned (the list scrolls).
  if (offset !== null) return options.filter((o) => o.offsetMinutes === offset);

  const scored: { option: ZoneOption; score: number; index: number }[] = [];
  options.forEach((option, index) => {
    const city = normalise(option.city);
    const country = option.country ? normalise(option.country) : "";
    const code = ZONES[ZONE_ALIASES[option.id] ?? option.id]?.[0];
    const nicknames = code ? (COUNTRY_NICKNAMES[code] ?? []) : [];

    let score: number | null = null;
    if (city === q || country === q || nicknames.includes(q)) score = 0;
    else if (city.startsWith(q)) score = 1;
    else if (city.split(" ").some((w) => w.startsWith(q))) score = 2;
    else if (country.startsWith(q)) score = 3;
    else if (city.includes(q) || country.includes(q) || normalise(option.id).includes(q)) score = 4;
    if (score !== null) scored.push({ option, score, index });
  });

  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.option);
}
