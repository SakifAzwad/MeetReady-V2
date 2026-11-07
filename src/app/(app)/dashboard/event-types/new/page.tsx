import type { Metadata } from "next";
import { Suspense } from "react";
import { EVENT_TYPE_DEFAULTS } from "@/lib/validation/event-type";
import { requireOnboardedUser } from "@/server/auth/session";
import { EventTypeForm } from "../event-type-form";

export const metadata: Metadata = { title: "New event type · MeetReady" };

export default function NewEventTypePage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-bold">New event type</h1>
      <Suspense fallback={<div className="bg-muted h-96 animate-pulse rounded-xl" />}>
        <NewEventTypeForm />
      </Suspense>
    </main>
  );
}

async function NewEventTypeForm() {
  const user = await requireOnboardedUser();
  return <EventTypeForm mode="create" username={user.username} defaultValues={EVENT_TYPE_DEFAULTS} />;
}
