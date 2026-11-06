import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { db } from "@/db";
import type { EventType } from "@/db/schema";
import type { EventTypeFormValues } from "@/lib/validation/event-type";
import { requireOnboardedUser } from "@/server/auth/session";
import { getEventType } from "@/server/event-types";
import { EventTypeForm } from "../../event-type-form";

export const metadata: Metadata = { title: "Edit event type · MeetReady" };

export default function EditEventTypePage({ params }: PageProps<"/dashboard/event-types/[id]/edit">) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Edit event type</h1>
      <Suspense fallback={<div className="bg-muted h-96 animate-pulse rounded-xl" />}>
        <EditForm params={params} />
      </Suspense>
    </main>
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
      defaultValues={toFormValues(eventType)}
    />
  );
}

/** DB row -> form values (nullable text columns become "" for the inputs). */
function toFormValues(et: EventType): EventTypeFormValues {
  return {
    title: et.title,
    slug: et.slug,
    description: et.description ?? "",
    durationMinutes: et.durationMinutes,
    slotIntervalMinutes: et.slotIntervalMinutes,
    locationType: et.locationType,
    locationValue: et.locationValue ?? "",
    color: et.color,
    bufferBeforeMinutes: et.bufferBeforeMinutes,
    bufferAfterMinutes: et.bufferAfterMinutes,
    minimumNoticeMinutes: et.minimumNoticeMinutes,
    bookingWindowDays: et.bookingWindowDays,
    maxBookingsPerDay: et.maxBookingsPerDay,
  };
}
