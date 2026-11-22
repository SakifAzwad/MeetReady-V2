import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LogoMark } from "@/components/brand/logo";
import { db } from "@/db";
import { LOCATION_LABELS } from "@/lib/validation/event-type";
import { assistantEnabled } from "@/server/ai";
import { getPublicEventType } from "@/server/booking";
import { EmbedRoot, EmbedWidget } from "./embed-client";

/*
 * The embeddable booking page (Day 27): /embed/{username}/{slug}, loaded in an
 * iframe by public/embed.js on other people's sites. The same widget and the
 * same server actions as /{username}/{slug}, so everything that protects a
 * booking (re-check, per-host lock, the EXCLUDE constraint, rate limits)
 * applies unchanged. What differs:
 *  - it may be framed by any site (src/lib/security-headers.ts);
 *  - no page background (globals.css), so it sits on the site's own page;
 *  - the theme comes from ?theme= (src/lib/theme.ts), never from storage;
 *  - it reports its height and new bookings to the site (embed-client.tsx);
 *  - links open in a new tab: our other pages refuse to load in a frame.
 * proxy.ts gives it the same real 404 as the booking page.
 */

type Params = PageProps<"/embed/[username]/[slug]">["params"];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { username, slug } = await params;
  const eventType = await getPublicEventType(db, username, slug);
  return {
    title: eventType ? `${eventType.title} with ${eventType.hostName}` : "Not found",
    // A copy of the booking page: search engines should list the real one.
    robots: { index: false },
  };
}

export default function EmbedPage({ params }: { params: Params }) {
  return (
    <EmbedRoot>
      <Suspense fallback={<div className="bg-muted h-[36rem] w-full max-w-6xl animate-pulse rounded-2xl" />}>
        <EmbedCard params={params} />
      </Suspense>
      <a
        href="/"
        target="_blank"
        rel="noopener"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 rounded-md text-sm transition-colors"
      >
        <LogoMark className="size-5" />
        Scheduling by MeetReady<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </EmbedRoot>
  );
}

async function EmbedCard({ params }: { params: Params }) {
  const { username, slug } = await params;
  const eventType = await getPublicEventType(db, username, slug);
  if (!eventType) notFound();

  // Same display-only data as the booking page: no host email, no booking rules.
  return (
    <EmbedWidget
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
      questions={{ questions: eventType.questions, questionsVersion: eventType.questionsVersion }}
      assistant={assistantEnabled}
    />
  );
}
