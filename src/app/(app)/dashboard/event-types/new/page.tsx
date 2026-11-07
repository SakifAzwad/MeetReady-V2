import type { Metadata } from "next";
import { Suspense } from "react";
import { EVENT_TYPE_DEFAULTS } from "@/lib/validation/event-type";
import { requireOnboardedUser } from "@/server/auth/session";
import { EventTypeForm } from "../event-type-form";
import { PageTransition } from "@/components/motion";

export const metadata: Metadata = { title: "New event type" };

export default function NewEventTypePage() {
  return (
    <PageTransition>
      <main className="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 className="text-3xl font-bold">New event type</h1>
        <Suspense fallback={<div className="bg-muted h-96 animate-pulse rounded-xl" />}>
          <NewEventTypeForm />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function NewEventTypeForm() {
  const user = await requireOnboardedUser();
  return <EventTypeForm mode="create" username={user.username} defaultValues={EVENT_TYPE_DEFAULTS} />;
}
