"use client";

import { formatMinutes } from "@/lib/format";
import { formatTime } from "@/lib/scheduling/calendar";
import { useMinuteClock } from "@/components/daylight/preferences";
import { cityName } from "@/lib/scheduling/daylight";

export type EventInfo = {
  username: string;
  slug: string;
  /**
   * Day 29: a team's collective event type (booked at /team/{slug}/…). Then
   * username is unused, hostName is the team's name and hostTimeZone the
   * organizer's; `hosts` are everyone who takes the meeting.
   */
  team?: {
    slug: string;
    name: string;
    hosts: { name: string; timeZone: string }[];
    /** Day 31: "round_robin" = the guest meets ONE of the hosts, assigned when they book. */
    kind?: "collective" | "round_robin";
  };
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
const names = new Intl.ListFormat("en", { style: "long", type: "disjunction" });

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
  // Day 29: a team meeting lists every host's clock (Sakif's pick); "your time" only if it differs from all.
  // Day 31: round-robin lists who they might meet instead: whose clock matters isn't known until booking.
  const roundRobin = event.team?.kind === "round_robin";
  const clocks = roundRobin
    ? []
    : event.team
      ? event.team.hosts.map((h) => ({ term: h.name.split(" ")[0] ?? h.name, timeZone: h.timeZone }))
      : [{ term: firstName, timeZone: event.hostTimeZone }];
  const sameZone = clocks.some((c) => c.timeZone === timeZone);

  return (
    <aside className="flex flex-col gap-5 border-b p-6 md:border-r md:border-b-0 md:p-8">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex -space-x-2">
          {(event.team?.hosts ?? [{ name: event.hostName }]).slice(0, 4).map((h, i) => (
            <span
              key={i}
              className="font-display bg-night ring-card grid size-9 place-items-center rounded-full text-sm font-bold text-white ring-2"
            >
              {h.name.charAt(0)}
            </span>
          ))}
        </span>
        <span className="font-medium">{event.hostName}</span>
      </div>
      <Title className="text-4xl leading-none font-bold md:text-[2.75rem]">{event.title}</Title>

      <dl className="border-foreground border-t-[1.5px] text-sm">
        <Fact term="Length" value={formatMinutes(event.durationMinutes)} />
        <Fact term="Where" value={event.locationLabel} note="Details in your confirmation email" />
        {roundRobin && (
          <Fact
            term="With"
            value={`One of ${names.format(event.team!.hosts.map((h) => h.name))}`}
            note="Shared fairly between them: your confirmation says who"
          />
        )}
        {clocks.map((c, i) => (
          <Fact
            key={i}
            term={`${c.term}'s time`}
            value={cityName(c.timeZone)}
            note={now ? `${formatTime(now, c.timeZone, hour12)} right now` : undefined}
          />
        ))}
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
