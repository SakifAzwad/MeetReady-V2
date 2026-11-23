import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Reveal } from "@/components/motion";
import { PoweredBy } from "@/components/site/powered-by";
import { db } from "@/db";
import { LOCATION_LABELS } from "@/lib/validation/event-type";
import { getTeamEventType } from "@/server/booking";
import { BookingWidget } from "@/app/[username]/[slug]/booking-widget";

/*
 * Day 29: a team's booking page, /team/{slug}/{event}. The same widget as a
 * host's page; the free times are when EVERY host is free (getBookingCalendar
 * with several hosts), and the facts panel shows each host's clock.
 * No booking assistant here yet: it searches one host's calendar.
 */

type Params = PageProps<"/team/[slug]/[event]">["params"];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, event } = await params;
  const eventType = await getTeamEventType(db, slug, event);
  return { title: eventType?.team ? `${eventType.title} with ${eventType.team.name}` : "Not found" };
}

export default function TeamBookingPage({ params }: { params: Params }) {
  return (
    <main className="flex flex-1 flex-col items-center gap-8 px-3 py-6 sm:px-6 sm:py-12">
      <Reveal fallback={<div className="bg-muted h-[36rem] w-full max-w-6xl animate-pulse rounded-2xl" />}>
        <TeamBookingCard params={params} />
      </Reveal>
      <PoweredBy />
    </main>
  );
}

async function TeamBookingCard({ params }: { params: Params }) {
  const { slug, event } = await params;
  const eventType = await getTeamEventType(db, slug, event);
  if (!eventType?.team) notFound();

  // Display data only: names and timezones of the hosts, never their emails.
  return (
    <BookingWidget
      event={{
        username: "",
        slug: eventType.slug,
        title: eventType.title,
        description: eventType.description,
        durationMinutes: eventType.durationMinutes,
        hostName: eventType.team.name,
        hostTimeZone: eventType.hostTimeZone,
        locationLabel: LOCATION_LABELS[eventType.locationType],
        team: {
          slug: eventType.team.slug,
          name: eventType.team.name,
          hosts: eventType.hosts.map((h) => ({ name: h.name, timeZone: h.timeZone })),
        },
      }}
      questions={{ questions: eventType.questions, questionsVersion: eventType.questionsVersion }}
      assistant={false}
    />
  );
}
