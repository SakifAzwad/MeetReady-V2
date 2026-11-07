"use client";

import { formatMinutes } from "@/lib/format";
import { formatTime } from "@/lib/scheduling/calendar";
import { useMinuteClock } from "@/components/daylight/preferences";
import { cityName } from "@/lib/scheduling/daylight";

export type EventInfo = {
  username: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  hostName: string;
  hostTimeZone: string;
  locationLabel: string;
};

/**
 * "What am I booking?" (from direction A): the facts as a ruled list, plus
 * both clocks ticking. Before looking at any times, a guest can see it's
 * late evening for the host.
 */
export function FactsPanel({
  event,
  timeZone,
  hour12,
  titleAs = "h1",
}: {
  event: EventInfo;
  timeZone: string;
  hour12: boolean;
  /** "h2" when the panel is embedded in another page that has its own h1 (the landing page preview). */
  titleAs?: "h1" | "h2" | "h3";
}) {
  const now = useMinuteClock();
  const Title = titleAs;
  const firstName = event.hostName.split(" ")[0];
  const sameZone = timeZone === event.hostTimeZone;

  return (
    <aside className="flex flex-col gap-5 border-b p-6 md:border-r md:border-b-0 md:p-8">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="font-display bg-night grid size-9 place-items-center rounded-full text-sm font-bold text-white"
        >
          {event.hostName.charAt(0)}
        </span>
        <span className="font-medium">{event.hostName}</span>
      </div>
      <Title className="text-4xl leading-none font-bold md:text-[2.75rem]">{event.title}</Title>

      <dl className="border-foreground border-t-[1.5px] text-sm">
        <Fact term="Length" value={formatMinutes(event.durationMinutes)} />
        <Fact term="Where" value={event.locationLabel} note="Details in your confirmation email" />
        <Fact
          term={`${firstName}'s time`}
          value={cityName(event.hostTimeZone)}
          note={now ? `${formatTime(now, event.hostTimeZone, hour12)} right now` : undefined}
        />
        {!sameZone && (
          <Fact
            term="Your time"
            value={cityName(timeZone)}
            note={now ? `${formatTime(now, timeZone, hour12)} right now` : undefined}
          />
        )}
      </dl>

      {event.description && (
        <p className="text-[15px] leading-relaxed whitespace-pre-line">{event.description}</p>
      )}
    </aside>
  );
}

function Fact({ term, value, note }: { term: string; value: string; note?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-right font-semibold">
        <span className="break-words">{value}</span>
        {/* Reserve the line before the clock hydrates, so nothing jumps. */}
        {note !== undefined || term.endsWith("time") ? (
          <small className="tabular text-muted-foreground mt-0.5 block min-h-4 text-xs font-normal">
            {note}
          </small>
        ) : null}
      </dd>
    </div>
  );
}
