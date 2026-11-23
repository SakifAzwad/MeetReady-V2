import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db";
import { requireOnboardedUser } from "@/server/auth/session";
import { getEventType } from "@/server/event-types";
import { appHost } from "@/lib/env";
import { EventTypeForm } from "../../event-type-form";
import { toFormValues } from "../../form-values";
import { PageTransition } from "@/components/motion";

export const metadata: Metadata = { title: "Edit event type" };

export default function EditEventTypePage({ params }: PageProps<"/dashboard/event-types/[id]/edit">) {
  return (
    <PageTransition>
      <main className="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 className="text-3xl font-bold">Edit event type</h1>
        <Suspense fallback={<div className="bg-muted h-96 animate-pulse rounded-xl" />}>
          <EditForm params={params} />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function EditForm({ params }: Pick<PageProps<"/dashboard/event-types/[id]/edit">, "params">) {
  const [{ id }, user] = await Promise.all([params, requireOnboardedUser()]);
  const eventType = await getEventType(db, user.id, id);
  // Someone else's id and a made-up id look the same: 404. No hint that it exists.
  if (!eventType) notFound();

  return (
    <EventTypeForm
      mode="edit"
      id={eventType.id}
      username={user.username}
      appHost={appHost}
      defaultValues={toFormValues(eventType)}
    />
  );
}
