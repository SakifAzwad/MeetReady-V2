import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageTransition } from "@/components/motion";
import { db } from "@/db";
import { appHost } from "@/lib/env";
import { EVENT_TYPE_DEFAULTS } from "@/lib/validation/event-type";
import { requireOnboardedUser } from "@/server/auth/session";
import { getTeam, listMembers } from "@/server/teams";
import { EventTypeForm } from "../../../../event-types/event-type-form";

export const metadata: Metadata = { title: "New team event type" };

/** Day 29: a new collective event type for a team. Owner only: anyone else gets the 404. */
export default function NewTeamEventTypePage({ params }: PageProps<"/dashboard/teams/[id]/event-types/new">) {
  return (
    <PageTransition>
      <main className="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 className="text-3xl font-bold">New team event type</h1>
        <Suspense fallback={<div className="bg-muted h-96 animate-pulse rounded-xl" />}>
          <Form params={params} />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function Form({ params }: Pick<PageProps<"/dashboard/teams/[id]/event-types/new">, "params">) {
  const [{ id }, user] = await Promise.all([params, requireOnboardedUser()]);
  const team = /^[0-9a-f-]{36}$/i.test(id) ? await getTeam(db, user.id, id) : null;
  if (team?.role !== "owner") notFound();
  const members = await listMembers(db, user.id, id);
  return (
    <EventTypeForm
      mode="create"
      username={user.username}
      appHost={appHost}
      defaultValues={{ ...EVENT_TYPE_DEFAULTS, title: "", slug: "" }}
      team={{
        id: team.id,
        slug: team.slug,
        members: members.map((m) => ({ userId: m.userId, name: m.name })),
        hostIds: members.map((m) => m.userId), // everyone, by default (Sakif's pick)
      }}
    />
  );
}
