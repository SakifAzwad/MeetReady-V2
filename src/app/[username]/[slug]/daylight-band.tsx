"use client";

import { BandTicks } from "@/components/daylight/band";
import { ScrubBand, useScrub } from "@/components/daylight/scrub";
import { formatTime, formatTimeRange } from "@/lib/scheduling/calendar";
import {
  bandSegments,
  dayBounds,
  daytimeBounds,
  daytimeOverlap,
  nearestToDaytime,
  cityName,
  nowPosition,
  offsetDifference,
} from "@/lib/scheduling/daylight";
import type { Interval } from "@/lib/scheduling/intervals";
import { momentReadout } from "@/lib/scheduling/readout";
import { skyGradient, sunSummary } from "@/lib/scheduling/sky";
import { dateKeyInZone, type DateKey } from "@/lib/scheduling/time";
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
  headingAs: Heading = "h2",
}: {
  windows: Interval[];
  day: DateKey;
  timeZone: string;
  hostTimeZone: string;
  hostName: string;
  hour12: boolean;
  /** "h4" inside the landing page preview, where it sits under other headings. */
  headingAs?: "h2" | "h4";
}) {
  const now = useMinuteClock();
  const segments = bandSegments(windows, day, timeZone);
  const nowAt = now ? nowPosition(now, day, timeZone) : null;
  const range = dayBounds(day, timeZone);
  const sky = skyGradient(timeZone, range);
  const sun = sunSummary(timeZone, day, hour12);
  // Start the keyboard marker at the host's first hour that day (or now, or noon).
  const scrub = useScrub(range, () => segments[0]?.left ?? nowAt);
  const readout = scrub.instant
    ? momentReadout({
        instant: scrub.instant,
        guestZone: timeZone,
        hostZone: hostTimeZone,
        hostName,
        windows,
        hour12,
      })
    : null;
  const firstName = hostName.split(" ")[0];
  const difference = offsetDifference(
    hostTimeZone,
    timeZone,
    windows[0]?.start ?? new Date(`${day}T12:00:00Z`),
  );
  const hostCity = cityName(hostTimeZone);

  const yourRanges = segments.map((s) => formatTimeRange(s.start, s.end, timeZone, hour12));
  // When the guest's day spans two of the host's dates, say which day each range is
  // ("11 AM–5 PM Monday and 9–11 AM Tuesday"): otherwise the ranges look out of order.
  const hostDates = new Set(segments.map((s) => dateKeyInZone(s.start, hostTimeZone)));
  const hostWeekday = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: hostTimeZone }).format(d);
  const hostRanges = segments.map(
    (s) =>
      formatTimeRange(s.start, s.end, hostTimeZone, hour12) +
      (hostDates.size > 1 ? ` ${hostWeekday(s.start)}` : ""),
  );
  const sentence =
    segments.length === 0
      ? `${firstName} isn't working on this day.`
      : !difference
        ? `${firstName} works ${hostRanges.join(" and ")}.`
        : `${firstName} works ${hostRanges.join(" and ")} in ${hostCity}, which is ${yourRanges.join(" and ")} your time.`;

  // "Times in your daytime" (8 AM–8 PM): only worth saying when it isn't all of them.
  const overlap = difference ? daytimeOverlap(segments, day, timeZone) : [];
  const overlapMs = overlap.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
  const segmentMs = segments.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
  const daytime = daytimeBounds(day, timeZone);
  const daytimeLabel = formatTimeRange(daytime.start, daytime.end, timeZone, hour12);
  let daytimeNote: React.ReactNode = null;
  if (difference && segments.length > 0 && overlapMs < segmentMs) {
    if (overlap.length > 0) {
      daytimeNote = (
        <>
          In your daytime ({daytimeLabel}):{" "}
          <strong className="font-semibold">
            {overlap.map((i) => formatTimeRange(i.start, i.end, timeZone, hour12)).join(" and ")}
          </strong>
          .
        </>
      );
    } else {
      const { endsBefore, startsAfter } = nearestToDaytime(segments, day, timeZone);
      const parts = [
        endsBefore && `they end at ${formatTime(endsBefore, timeZone, hour12)}`,
        startsAfter &&
          `${endsBefore ? "start again" : "they start"} at ${formatTime(startsAfter, timeZone, hour12)}`,
      ].filter(Boolean);
      daytimeNote = `None of ${firstName}'s hours fall in your daytime (${daytimeLabel}): ${parts.join(" and ")} your time.`;
    }
  }

  return (
    <section aria-labelledby="band-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <Heading id="band-heading" className="text-xl font-semibold">
          Your day in {cityName(timeZone)}
        </Heading>
        <p className="text-muted-foreground text-sm">
          {difference ? `${hostCity} is ${difference}` : `Same timezone as ${firstName}`}
        </p>
      </div>

      {/* Decorative for screen readers: the sentence below says the same thing in words. */}
      <ScrubBand
        scrub={scrub}
        segments={segments}
        nowAt={nowAt}
        gradient={sky}
        highlights={bandSegments(overlap, day, timeZone)}
        slider={{ label: `Compare times with ${firstName}`, valueText: readout?.text ?? null }}
        badge={readout?.lines.map((line, i) => (
          <span key={line} className={i === readout.lines.length - 1 ? "block font-semibold" : "block"}>
            {line}
          </span>
        ))}
      />
      <div className="flex flex-col gap-0.5">
        <BandTicks hour12={hour12} />
        {sun && (
          <p className="text-muted-foreground text-xs">
            {sun} in {cityName(timeZone)}. Hover or drag along the band to compare any moment.
          </p>
        )}
      </div>

      <p className="mt-1 text-[15px]">{sentence}</p>
      {daytimeNote && <p className="text-muted-foreground text-[15px]">{daytimeNote}</p>}
    </section>
  );
}
