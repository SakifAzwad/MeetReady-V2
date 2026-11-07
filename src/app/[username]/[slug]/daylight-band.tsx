"use client";

import { Band, BandTicks } from "@/components/daylight/band";
import { formatTimeRange } from "@/lib/scheduling/calendar";
import { bandSegments, cityName, nowPosition, offsetDifference } from "@/lib/scheduling/daylight";
import type { Interval } from "@/lib/scheduling/intervals";
import type { DateKey } from "@/lib/scheduling/time";
import { useMinuteClock } from "@/components/daylight/preferences";

/*
 * "When is this for me?" (from direction B): the guest's day with the host's
 * working hours bracketed on it, plus the same thing as a sentence.
 */
export function DaylightBand({
  windows,
  day,
  timeZone,
  hostTimeZone,
  hostName,
  hour12,
}: {
  windows: Interval[];
  day: DateKey;
  timeZone: string;
  hostTimeZone: string;
  hostName: string;
  hour12: boolean;
}) {
  const now = useMinuteClock();
  const segments = bandSegments(windows, day, timeZone);
  const nowAt = now ? nowPosition(now, day, timeZone) : null;
  const firstName = hostName.split(" ")[0];
  const difference = offsetDifference(
    hostTimeZone,
    timeZone,
    windows[0]?.start ?? new Date(`${day}T12:00:00Z`),
  );
  const hostCity = cityName(hostTimeZone);

  const yourRanges = segments.map((s) => formatTimeRange(s.start, s.end, timeZone, hour12));
  const hostRanges = segments.map((s) => formatTimeRange(s.start, s.end, hostTimeZone, hour12));
  const sentence =
    segments.length === 0
      ? `${firstName} isn't working on this day.`
      : !difference
        ? `${firstName} works ${hostRanges.join(" and ")}.`
        : `${firstName} works ${hostRanges.join(" and ")} in ${hostCity}, which is ${yourRanges.join(" and ")} your time.`;

  return (
    <section aria-labelledby="band-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="band-heading" className="text-xl font-semibold">
          Your day in {cityName(timeZone)}
        </h2>
        <p className="text-muted-foreground text-sm">
          {difference ? `${hostCity} is ${difference}` : `Same timezone as ${firstName}`}
        </p>
      </div>

      {/* Decorative for screen readers: the sentence below says the same thing in words. */}
      <Band segments={segments} nowAt={nowAt} />
      <BandTicks hour12={hour12} />

      <p className="mt-1 text-[15px]">{sentence}</p>
    </section>
  );
}
