import type { Metadata } from "next";
import Link from "next/link";
import { cityName, dayBounds } from "@/lib/scheduling/daylight";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/db";
import { env } from "@/lib/env";
import { parseWeekOffset, weekDays } from "@/lib/week";
import { formatDateKey, formatTime } from "@/lib/scheduling/calendar";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { requireOnboardedUser } from "@/server/auth/session";
import { getAvailability } from "@/server/availability";
import { listEventTypes } from "@/server/event-types";
import { listHostBookings, listHostBookingsBetween } from "@/server/manage-booking";
import { CopyLinkButton } from "./copy-link-button";
import { ShareTimes } from "./share-times";
import { WeekGlance } from "./week-glance";
import { PageTransition, Reveal } from "@/components/motion";

export const metadata: Metadata = { title: "Dashboard" };

/*
 * Answers the three things a host opens this page for: what's my link,
 * what does my week look like, what's next. Settings live in the nav.
 * Cache Components: the shell is static; the session-dependent part streams.
 */
export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <PageTransition>
      <main>
        <Reveal fallback={<DashboardSkeleton />}>
          <Dashboard searchParams={searchParams} />
        </Reveal>
      </main>
    </PageTransition>
  );
}

async function Dashboard({ searchParams }: Pick<PageProps<"/dashboard">, "searchParams">) {
  // The real auth check. proxy.ts only checked that a cookie exists.
  const [user, { week }] = await Promise.all([requireOnboardedUser(), searchParams]);
  const now = new Date();
  const offset = parseWeekOffset(week);
  const days = weekDays(now, user.timeZone, offset);
  const [availability, upcoming, weekMeetings, eventTypes] = await Promise.all([
    getAvailability(db, user.id),
    listHostBookings(db, user.id, "upcoming", now, 3),
    listHostBookingsBetween(db, user.id, {
      start: dayBounds(days[0]!, user.timeZone).start,
      end: dayBounds(days[6]!, user.timeZone).end,
    }),
    listEventTypes(db, user.id),
  ]);
  const tz = user.timeZone;
  const path = `/${user.username}`;
  const url = new URL(path, env.BETTER_AUTH_URL).toString();

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Hi {user.name.split(" ")[0]}</h1>
        <Card className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">Your booking page</p>
            <p className="font-display truncate text-xl font-semibold">{url.replace(/^https?:\/\//, "")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <CopyLinkButton url={url} />
            <Button asChild variant="outline">
              <Link href={path}>Open</Link>
            </Button>
          </div>
        </Card>
      </section>

      <WeekGlance
        availability={availability}
        meetings={weekMeetings.map((b) => ({ start: b.startsAt, end: b.endsAt }))}
        now={now}
        offset={offset}
      />

      <section aria-labelledby="share-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="share-heading" className="text-xl font-semibold">
            Share times by text
          </h2>
          <p className="text-muted-foreground text-sm">
            For email threads: three free times written in their timezone, with yours beside them and your
            link.
          </p>
        </div>
        <ShareTimes
          eventTypes={eventTypes.filter((et) => et.isActive).map((et) => ({ id: et.id, title: et.title }))}
          hostTimeZone={tz}
          origin={env.BETTER_AUTH_URL}
        />
      </section>

      <section aria-labelledby="next-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 id="next-heading" className="text-xl font-semibold">
            Coming up
          </h2>
          {upcoming.length > 0 && (
            <Link href="/dashboard/bookings" className="text-sm underline underline-offset-4">
              All bookings
            </Link>
          )}
        </div>
        {upcoming.length === 0 ? (
          <Card className="py-8 text-center">
            <p className="text-muted-foreground">
              No meetings booked yet. Share your link and they&apos;ll appear here.
            </p>
          </Card>
        ) : (
          <ul className="bg-card divide-y rounded-xl border">
            {upcoming.slice(0, 3).map((b) => (
              <li
                key={b.id}
                className="flex flex-col gap-0.5 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <span className="tabular shrink-0 font-medium sm:w-48">
                  {formatDateKey(dateKeyInZone(b.startsAt, tz), "short")}, {formatTime(b.startsAt, tz)}
                </span>
                <span className="min-w-0">
                  {b.eventTitle} with {b.guestName}
                  {b.guestTimeZone !== tz && (
                    <span className="text-muted-foreground block text-sm">
                      {formatTime(b.startsAt, b.guestTimeZone)} for them in {cityName(b.guestTimeZone)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="bg-muted h-9 w-40 rounded" />
        <div className="bg-muted h-24 rounded-xl" />
      </div>
      <div className="bg-muted h-80 rounded-xl" />
    </div>
  );
}
