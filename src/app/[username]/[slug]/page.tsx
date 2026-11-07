import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Reveal } from "@/components/motion";
import { PoweredBy } from "@/components/site/powered-by";
import { db } from "@/db";
import { LOCATION_LABELS } from "@/lib/validation/event-type";
import { getPublicEventType } from "@/server/booking";
import { BookingWidget } from "./booking-widget";

type Params = PageProps<"/[username]/[slug]">["params"];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { username, slug } = await params;
  const eventType = await getPublicEventType(db, username, slug);
  return { title: eventType ? `${eventType.title} with ${eventType.hostName}` : "Not found" };
}

/** The public booking page: meetready.app/{username}/{slug}. No login. */
export default function BookingPage({ params }: { params: Params }) {
  return (
    <main className="flex flex-1 flex-col items-center gap-8 px-3 py-6 sm:px-6 sm:py-12">
      <Reveal fallback={<div className="bg-muted h-[36rem] w-full max-w-6xl animate-pulse rounded-2xl" />}>
        <BookingCard params={params} />
      </Reveal>
      <PoweredBy />
    </main>
  );
}

async function BookingCard({ params }: { params: Params }) {
  const { username, slug } = await params;
  const eventType = await getPublicEventType(db, username, slug);
  if (!eventType) notFound();

  // Only display data crosses to the client: no host email, no booking rules.
  return (
    <BookingWidget
      event={{
        username: eventType.username,
        slug: eventType.slug,
        title: eventType.title,
        description: eventType.description,
        durationMinutes: eventType.durationMinutes,
        hostName: eventType.hostName,
        hostTimeZone: eventType.hostTimeZone,
        locationLabel: LOCATION_LABELS[eventType.locationType],
      }}
    />
  );
}
