import { Clock, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db";
import { formatMinutes } from "@/lib/format";
import { LOCATION_LABELS } from "@/lib/validation/event-type";
import { getPublicEventType } from "@/server/booking";
import { BookingWidget } from "./booking-widget";

type Params = PageProps<"/[username]/[slug]">["params"];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { username, slug } = await params;
  const eventType = await getPublicEventType(db, username, slug);
  return { title: eventType ? `${eventType.title} · ${eventType.hostName}` : "Not found · MeetReady" };
}

/** The public booking page: meetready.app/{username}/{slug}. No login. */
export default function BookingPage({ params }: { params: Params }) {
  return (
    <main className="bg-muted/40 flex flex-1 items-start justify-center px-4 py-8 sm:py-16">
      <Suspense fallback={<div className="bg-muted h-[32rem] w-full max-w-4xl animate-pulse rounded-xl" />}>
        <BookingCard params={params} />
      </Suspense>
    </main>
  );
}

async function BookingCard({ params }: { params: Params }) {
  const { username, slug } = await params;
  const eventType = await getPublicEventType(db, username, slug);
  if (!eventType) notFound();

  const location = LOCATION_LABELS[eventType.locationType];
  return (
    <div className="bg-card grid w-full max-w-4xl overflow-hidden rounded-xl border shadow-sm md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 border-b p-6 md:border-r md:border-b-0">
        <Link href={`/${eventType.username}`} className="text-muted-foreground text-sm hover:underline">
          {eventType.hostName}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{eventType.title}</h1>
        <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
          <li className="flex items-center gap-2">
            <Clock className="size-4" /> {formatMinutes(eventType.durationMinutes)}
          </li>
          <li className="flex items-center gap-2">
            <MapPin className="size-4" /> {location}
          </li>
        </ul>
        {eventType.description && <p className="text-sm whitespace-pre-line">{eventType.description}</p>}
      </aside>
      {/* Only display data crosses to the client: no host email, no booking rules. */}
      <BookingWidget
        username={eventType.username}
        slug={eventType.slug}
        hostName={eventType.hostName}
        hostTimeZone={eventType.hostTimeZone}
        locationLabel={location}
      />
    </div>
  );
}
