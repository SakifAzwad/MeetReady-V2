import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTransition } from "@/components/motion";
import { db } from "@/db";
import { appHost } from "@/lib/env";
import { requireOnboardedUser } from "@/server/auth/session";
import { getTeamEventTypeForOwner } from "@/server/team-event-types";
import { getTeam, listMembers } from "@/server/teams";
import { EventTypeForm } from "../../../../../event-types/event-type-form";
import { toFormValues } from "../../../../../event-types/form-values";

export const metadata: Metadata = { title: "Edit team event type" };

type Props = PageProps<"/dashboard/teams/[id]/event-types/[eventTypeId]/edit">;

/** Day 29: edit a team's event type and its hosts. Owner only: anyone else gets the 404. */
export default function EditTeamEventTypePage({ params }: Props) {
  return (
    <PageTransition>
      <main className="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 className="text-3xl font-bold">Edit team event type</h1>
        <Suspense fallback={<div className="bg-muted h-96 animate-pulse rounded-xl" />}>
          <Form params={params} />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function Form({ params }: Pick<Props, "params">) {
  const [{ id, eventTypeId }, user] = await Promise.all([params, requireOnboardedUser()]);
  const found = await getTeamEventTypeForOwner(db, user.id, id, eventTypeId); // null unless the owner
  if (!found) notFound();
  const [team, members] = await Promise.all([getTeam(db, user.id, id), listMembers(db, user.id, id)]);
  if (!team) notFound();
  return (
    <EventTypeForm
      mode="edit"
      id={found.eventType.id}
      username={user.username}
      appHost={appHost}
      defaultValues={toFormValues(found.eventType)}
      team={{
        id: team.id,
        slug: team.slug,
        members: members.map((m) => ({ userId: m.userId, name: m.name })),
        hostIds: found.hostIds,
      }}
    />
  );
}
