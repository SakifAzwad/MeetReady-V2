import { ChevronRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Reveal } from "@/components/motion";
import { PoweredBy } from "@/components/site/powered-by";
import { db } from "@/db";
import { formatMinutes } from "@/lib/format";
import { LOCATION_LABELS } from "@/lib/validation/event-type";
import { getPublicTeam } from "@/server/booking";

type Params = PageProps<"/team/[slug]">["params"];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const team = await getPublicTeam(db, slug);
  return { title: team ? `Book a meeting with ${team.name}` : "Not found" };
}

/** Day 29: a team's public page, /team/{slug}: the meetings guests can book with it. */
export default function TeamProfilePage({ params }: { params: Params }) {
  return (
    <main className="flex flex-1 flex-col items-center gap-10 px-4 py-12 sm:py-20">
      <Reveal fallback={<div className="bg-muted h-64 w-full max-w-xl animate-pulse rounded-xl" />}>
        <TeamProfile params={params} />
      </Reveal>
      <PoweredBy />
    </main>
  );
}

async function TeamProfile({ params }: { params: Params }) {
  const { slug } = await params;
  const team = await getPublicTeam(db, slug);
  if (!team) notFound();

  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-muted-foreground text-sm">Team</p>
        <h1 className="text-3xl font-bold">{team.name}</h1>
      </div>
      {team.eventTypes.length === 0 ? (
        <p className="text-muted-foreground text-center text-sm">No meetings available to book right now.</p>
      ) : (
        <section aria-labelledby="types-heading" className="flex flex-col gap-3">
          <h2 id="types-heading" className="text-muted-foreground text-sm">
            Pick a meeting
          </h2>
          <ul className="flex flex-col gap-3">
            {team.eventTypes.map((et) => (
              <li key={et.slug}>
                <Link
                  href={`/team/${team.slug}/${et.slug}`}
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
                    <span className="text-muted-foreground mt-1 block text-sm">
                      {/* Day 31: round-robin meets one of them ("or"), collective all of them ("and"). */}
                      {et.kind === "round_robin" ? "With one of " : "With "}
                      {new Intl.ListFormat("en", {
                        type: et.kind === "round_robin" ? "disjunction" : "conjunction",
                      }).format(et.hosts.map((h) => h.name))}
                    </span>
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
