import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTransition } from "@/components/motion";
import { UserAvatar } from "@/components/user-avatar";
import { Badge, Card } from "@/components/ui/card";
import { db } from "@/db";
import { formatDateKey, formatTime } from "@/lib/scheduling/calendar";
import { dateKeyInZone } from "@/lib/scheduling/time";
import { requireOnboardedUser } from "@/server/auth/session";
import { formatMinutes } from "@/lib/format";
import { listTeamEventTypes } from "@/server/team-event-types";
import { getTeam, listMembers, listPendingInvites, MAX_MEMBERS } from "@/server/teams";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "../../event-types/event-type-controls";
import {
  DeleteTeamButton,
  InviteButton,
  LeaveTeamButton,
  RemoveMemberButton,
  RenameTeamForm,
  RevokeInviteButton,
  TeamEventTypeToggle,
} from "../controls";

export const metadata: Metadata = { title: "Team" };

/**
 * Day 28: one team. Everyone in it sees its people; the owner also sees the
 * invite links and the settings. A team you're not in is a 404, the same as
 * one that doesn't exist.
 */
export default function TeamPage({ params }: PageProps<"/dashboard/teams/[id]">) {
  return (
    <PageTransition>
      <main className="flex flex-col gap-6">
        <Link
          href="/dashboard/teams"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm"
        >
          <ArrowLeft aria-hidden className="size-4" /> Teams
        </Link>
        <Suspense fallback={<div className="bg-muted h-64 animate-pulse rounded-xl" />}>
          <TeamBody params={params} />
        </Suspense>
      </main>
    </PageTransition>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function TeamBody({ params }: Pick<PageProps<"/dashboard/teams/[id]">, "params">) {
  const { id } = await params;
  const user = await requireOnboardedUser();
  if (!UUID.test(id)) notFound(); // not a uuid: Postgres would refuse the query
  const team = await getTeam(db, user.id, id); // null unless this user is in it
  if (!team) notFound();

  const now = new Date();
  const isOwner = team.role === "owner";
  const [members, invites, eventTypes] = await Promise.all([
    listMembers(db, user.id, id),
    isOwner ? listPendingInvites(db, user.id, id, now) : Promise.resolve([]),
    listTeamEventTypes(db, user.id, id),
  ]);
  const tz = user.timeZone;
  const when = (d: Date) => `${formatDateKey(dateKeyInZone(d, tz), "short")}, ${formatTime(d, tz)}`;
  const full = members.length >= MAX_MEMBERS;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold">{team.name}</h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-xs">/team/{team.slug}</span>
          <Badge>{isOwner ? "You own this team" : "You're a member"}</Badge>
        </p>
      </div>

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-xl font-semibold">
          People{" "}
          <span className="text-muted-foreground text-base font-normal">
            {members.length} of {MAX_MEMBERS}
          </span>
        </h2>
        <ul className="bg-card divide-y rounded-xl border">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 p-4">
              <UserAvatar name={m.name} image={m.image} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {m.name}
                  {m.userId === user.id && <span className="text-muted-foreground font-normal"> (you)</span>}
                </p>
                <p className="text-muted-foreground truncate text-sm">{m.email}</p>
              </div>
              {m.role === "owner" ? (
                <Badge>Owner</Badge>
              ) : isOwner ? (
                <RemoveMemberButton teamId={team.id} userId={m.userId} name={m.name} />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="team-types-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="team-types-heading" className="text-xl font-semibold">
            Event types
          </h2>
          {isOwner && (
            <Button asChild size="sm">
              <Link href={`/dashboard/teams/${team.id}/event-types/new`}>New team event type</Link>
            </Button>
          )}
        </div>
        {eventTypes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {isOwner
              ? "None yet. A team event type shows guests only the times when all its hosts are free."
              : "None yet. The team's owner can add them."}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {eventTypes.map((et) => (
              <li key={et.id}>
                <Card className={et.isActive ? "relative gap-3 p-5" : "relative gap-3 p-5 opacity-60"}>
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1 rounded-l-xl"
                    style={{ backgroundColor: et.color }}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{et.title}</h3>
                      <p className="text-muted-foreground truncate font-mono text-xs">
                        /team/{team.slug}/{et.slug}
                      </p>
                    </div>
                    {isOwner && (
                      <TeamEventTypeToggle
                        teamId={team.id}
                        eventTypeId={et.id}
                        title={et.title}
                        isActive={et.isActive}
                      />
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {formatMinutes(et.durationMinutes)} with{" "}
                    {et.hosts.map((h) => h.name).join(", ") || "nobody yet"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {isOwner && (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/dashboard/teams/${team.id}/event-types/${et.id}/edit`}>Edit</Link>
                      </Button>
                    )}
                    <CopyLinkButton path={`/team/${team.slug}/${et.slug}`} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner && (
        <Card className="gap-4 p-5" role="region" aria-label="Invite people">
          <div>
            <h2 className="font-semibold">Invite people</h2>
            <p className="text-muted-foreground text-sm">
              Each link lets one person join, once, within 7 days. They sign in with Google, then press Join.
            </p>
          </div>
          <InviteButton teamId={team.id} teamName={team.name} full={full} />
          {full && <p className="text-muted-foreground text-sm">The team is full ({MAX_MEMBERS} people).</p>}
          {invites.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Links not used yet</h3>
              <ul className="divide-y rounded-lg border">
                {invites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span>
                      Made {when(invite.createdAt)}
                      <span className="text-muted-foreground">. Works until {when(invite.expiresAt)}</span>
                    </span>
                    <RevokeInviteButton inviteId={invite.id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {isOwner ? (
        <Card className="gap-5 p-5" role="region" aria-label="Team settings">
          <h2 className="font-semibold">Settings</h2>
          <RenameTeamForm teamId={team.id} name={team.name} />
          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="text-muted-foreground text-sm">
              Deleting the team removes everyone from it and cancels its unused invite links.
            </p>
            <DeleteTeamButton teamId={team.id} teamName={team.name} />
          </div>
        </Card>
      ) : (
        <LeaveTeamButton teamId={team.id} teamName={team.name} />
      )}
    </div>
  );
}
