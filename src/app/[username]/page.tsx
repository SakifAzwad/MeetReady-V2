import { ChevronRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db";
import { formatMinutes } from "@/lib/format";
import { getPublicProfile } from "@/server/booking";

type Params = PageProps<"/[username]">["params"];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { username } = await params;
  const profile = await getPublicProfile(db, username);
  return { title: profile ? `Book a meeting with ${profile.name}` : "Not found · MeetReady" };
}

/** A host's public page: meetready.app/{username}, listing their active event types. */
export default function ProfilePage({ params }: { params: Params }) {
  return (
    <main className="bg-muted/40 flex flex-1 justify-center px-4 py-12 sm:py-20">
      <Suspense fallback={<div className="bg-muted h-64 w-full max-w-xl animate-pulse rounded-xl" />}>
        <Profile params={params} />
      </Suspense>
    </main>
  );
}

async function Profile({ params }: { params: Params }) {
  const { username } = await params;
  const profile = await getPublicProfile(db, username);
  if (!profile) notFound();

  return (
    <div className="flex w-full max-w-xl flex-col gap-6">
      <div className="text-center">
        <div
          aria-hidden
          className="bg-primary text-primary-foreground mx-auto mb-3 flex size-14 items-center justify-center rounded-full text-xl font-semibold"
        >
          {profile.name.charAt(0)}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
        <p className="text-muted-foreground">Pick a meeting type</p>
      </div>
      {profile.eventTypes.length === 0 ? (
        <p className="text-muted-foreground text-center text-sm">No meetings available to book right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {profile.eventTypes.map((et) => (
            <li key={et.slug}>
              <Link
                href={`/${profile.username}/${et.slug}`}
                className="bg-card hover:border-primary/50 focus-visible:ring-ring/50 flex items-center gap-4 rounded-xl border p-5 shadow-xs transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
              >
                <span aria-hidden className="h-10 w-1 rounded-full" style={{ backgroundColor: et.color }} />
                <span className="flex-1">
                  <span className="block font-medium">{et.title}</span>
                  <span className="text-muted-foreground flex items-center gap-1 text-sm">
                    <Clock className="size-3.5" /> {formatMinutes(et.durationMinutes)}
                  </span>
                </span>
                <ChevronRight className="text-muted-foreground size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
