import { ChevronRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Reveal } from "@/components/motion";
import { PoweredBy } from "@/components/site/powered-by";
import { db } from "@/db";
import { UserAvatar } from "@/components/user-avatar";
import { formatMinutes } from "@/lib/format";
import { LOCATION_LABELS } from "@/lib/validation/event-type";
import { HostClock } from "./host-clock";
import { getPublicProfile } from "@/server/booking";

type Params = PageProps<"/[username]">["params"];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { username } = await params;
  const profile = await getPublicProfile(db, username);
  return { title: profile ? `Book a meeting with ${profile.name}` : "Not found" };
}

/** A host's public page: meetreadyv2.vercel.app/{username}, listing their active event types. */
export default function ProfilePage({ params }: { params: Params }) {
  return (
    <main className="flex flex-1 flex-col items-center gap-10 px-4 py-12 sm:py-20">
      <Reveal fallback={<div className="bg-muted h-64 w-full max-w-xl animate-pulse rounded-xl" />}>
        <Profile params={params} />
      </Reveal>
      <PoweredBy />
    </main>
  );
}

async function Profile({ params }: { params: Params }) {
  const { username } = await params;
  const profile = await getPublicProfile(db, username);
  if (!profile) notFound();

  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <UserAvatar name={profile.name} image={profile.image} className="size-16 [&_span]:text-2xl" />
        <div>
          <h1 className="text-3xl font-bold">{profile.name}</h1>
          <HostClock timeZone={profile.timeZone} />
        </div>
      </div>
      {profile.eventTypes.length === 0 ? (
        <p className="text-muted-foreground text-center text-sm">No meetings available to book right now.</p>
      ) : (
        <section aria-labelledby="types-heading" className="flex flex-col gap-3">
          <h2 id="types-heading" className="text-muted-foreground text-sm">
            Pick a meeting
          </h2>
          <ul className="flex flex-col gap-3">
            {profile.eventTypes.map((et) => (
              <li key={et.slug}>
                <Link
                  href={`/${profile.username}/${et.slug}`}
                  className="group bg-card hover:border-foreground/25 focus-visible:ring-ring/50 flex items-center gap-4 rounded-xl border p-5 transition-[border-color,transform] focus-visible:ring-[3px] focus-visible:outline-none active:scale-[0.99]"
                >
                  <span
                    aria-hidden
                    className="w-1 self-stretch rounded-full"
                    style={{ backgroundColor: et.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold">{et.title}</span>
                    <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
                      <Clock className="size-3.5" /> {formatMinutes(et.durationMinutes)},{" "}
                      {LOCATION_LABELS[et.locationType]}
                    </span>
                    {et.description && (
                      <span className="text-muted-foreground mt-1 line-clamp-2 block text-sm">
                        {et.description}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="text-muted-foreground size-5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
