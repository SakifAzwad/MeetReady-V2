import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTransition } from "@/components/motion";
import { Card } from "@/components/ui/card";
import { db } from "@/db";
import { percent } from "@/lib/insights-format";
import { cityName } from "@/lib/scheduling/daylight";
import { cn } from "@/lib/utils";
import { requireOnboardedUser } from "@/server/auth/session";
import { getInsights, INSIGHT_RANGES, isInsightRange, type Insights } from "@/server/insights";
import { MeetingsChart, MeetingTypes, PopularTimes } from "./charts";

export const metadata: Metadata = { title: "Insights" };

type SearchParams = PageProps<"/dashboard/insights">["searchParams"];

/*
 * Day 25: how a host's meetings went. Server-rendered from three grouped
 * queries (src/server/insights.ts); the only browser code is the tooltips.
 */
export default function InsightsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageTransition>
      <main className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Insights</h1>
          <p className="text-muted-foreground text-sm">
            How your meetings went, counted on the day each one was for.
          </p>
        </div>
        <Suspense fallback={<div className="bg-muted h-96 animate-pulse rounded-xl" />}>
          <InsightsBody searchParams={searchParams} />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function InsightsBody({ searchParams }: { searchParams: SearchParams }) {
  const [{ range: raw }, user] = await Promise.all([searchParams, requireOnboardedUser()]);
  // ?range= is user-controlled: anything unexpected falls back to 3 months.
  const range = isInsightRange(raw) ? raw : "3m";
  const now = new Date();
  const data = await getInsights(db, user.id, range, user.timeZone, now); // scoped to this host

  return (
    <div className="flex flex-col gap-6">
      {/* One filter row, above everything it scopes. */}
      <nav aria-label="Period" className="flex flex-wrap items-center gap-1">
        {Object.entries(INSIGHT_RANGES).map(([key, r]) => (
          <Link
            key={key}
            href={`/dashboard/insights?range=${key}`}
            aria-current={key === range ? "page" : undefined}
            scroll={false}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              key === range ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground",
            )}
          >
            {r.label}
          </Link>
        ))}
        <span className="text-muted-foreground ml-auto text-sm">In {cityName(data.timeZone)} time</span>
      </nav>

      {data.totals.meetings === 0 ? (
        <Card className="items-center p-10 text-center">
          <p className="font-medium">No meetings in this period yet</p>
          <p className="text-muted-foreground max-w-md text-sm">
            A meeting counts here once its time has come, whether it was held, missed or cancelled.
          </p>
        </Card>
      ) : (
        <>
          <StatTiles data={data} />
          <MeetingsChart data={data} />
          {/* Full width: 24 hour columns need the room (on phones the grid scrolls inside its card). */}
          <PopularTimes data={data} now={now} />
          <MeetingTypes data={data} />
        </>
      )}
    </div>
  );
}

function StatTiles({ data }: { data: Insights }) {
  const { totals, rates, sources } = data;
  const attended = totals.held + totals.noShows;
  const tiles = [
    { label: "Meetings", value: String(totals.meetings), note: `${totals.held} held` },
    {
      label: "Cancelled",
      value: percent(rates.cancellation),
      note: `${totals.cancelledByGuest} by guests, ${totals.cancelledByHost} by you`,
    },
    {
      label: "No-shows",
      value: percent(rates.noShow),
      note: `${totals.noShows} of ${attended} not cancelled`,
    },
    {
      label: "Booked through an assistant",
      value: String(sources.assistant),
      note: `${sources.bookingPage} booked by guests on your page`,
    },
  ];
  return (
    <ul aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <li key={t.label}>
          <Card className="h-full gap-1 p-4">
            <p className="text-muted-foreground text-sm">{t.label}</p>
            <p className="text-3xl font-semibold">{t.value}</p>
            <p className="text-muted-foreground text-xs">{t.note}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
