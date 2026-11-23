import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageTransition } from "@/components/motion";
import { Badge, Card } from "@/components/ui/card";
import { db } from "@/db";
import { appHost } from "@/lib/env";
import { requireOnboardedUser } from "@/server/auth/session";
import { listMyTeams, MAX_OWNED_TEAMS } from "@/server/teams";
import { CreateTeamForm } from "./controls";

export const metadata: Metadata = { title: "Teams" };

/** Day 28: the teams you're in, and a form to start one. */
export default function TeamsPage() {
  return (
    <PageTransition>
      <main className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold">Teams</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            A team is a group of people who take meetings together: a sales team, a support rota, founders
            meeting investors. Create one, then invite people with a link.
          </p>
        </div>
        <Suspense fallback={<div className="bg-muted h-64 animate-pulse rounded-xl" />}>
          <TeamsBody />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function TeamsBody() {
  const user = await requireOnboardedUser();
  const teams = await listMyTeams(db, user.id); // only teams this user is in
  const owned = teams.filter((t) => t.role === "owner").length;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="your-teams" className="flex flex-col gap-3">
        <h2 id="your-teams" className="text-xl font-semibold">
          Your teams
        </h2>
        {teams.length === 0 ? (
          <p className="text-muted-foreground text-sm">You aren&apos;t in a team yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {teams.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/dashboard/teams/${t.id}`}
                  className="bg-card hover:bg-accent/50 focus-visible:ring-ring/50 flex flex-col gap-2 rounded-xl border p-5 transition-colors outline-none focus-visible:ring-[3px]"
                >
                  <span className="truncate font-semibold">{t.name}</span>
                  <span className="text-muted-foreground truncate font-mono text-xs">/team/{t.slug}</span>
                  <span className="flex flex-wrap gap-2">
                    <Badge>{t.role === "owner" ? "Owner" : "Member"}</Badge>
                    <Badge>
                      <Users aria-hidden className="mr-1 size-3" />
                      {t.members === 1 ? "1 person" : `${t.members} people`}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="gap-4 p-5" role="region" aria-label="Create a team">
        <h2 className="font-semibold">Create a team</h2>
        <CreateTeamForm appHost={appHost} full={owned >= MAX_OWNED_TEAMS} />
        {owned >= MAX_OWNED_TEAMS && (
          <p className="text-muted-foreground text-sm">You own the most teams allowed ({MAX_OWNED_TEAMS}).</p>
        )}
      </Card>
    </div>
  );
}
