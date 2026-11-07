import { Clock, MapPin, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { db } from "@/db";
import { formatMinutes } from "@/lib/format";
import { LOCATION_LABELS } from "@/lib/validation/event-type";
import { requireOnboardedUser } from "@/server/auth/session";
import { listEventTypes } from "@/server/event-types";
import { ActiveToggle, CopyLinkButton } from "./event-type-controls";

export const metadata: Metadata = { title: "Event types · MeetReady" };

export default function EventTypesPage() {
  return (
    <main className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Event types</h1>
          <p className="text-muted-foreground text-sm">The kinds of meetings guests can book with you.</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/event-types/new">
            <Plus /> New event type
          </Link>
        </Button>
      </div>
      <Suspense fallback={<div className="bg-muted h-40 animate-pulse rounded-xl" />}>
        <EventTypeList />
      </Suspense>
    </main>
  );
}

async function EventTypeList() {
  const user = await requireOnboardedUser();
  const items = await listEventTypes(db, user.id); // scoped to this user in the WHERE

  if (items.length === 0) {
    return (
      <Card className="items-center py-12 text-center">
        <p className="font-medium">No event types yet</p>
        <p className="text-muted-foreground max-w-sm text-sm">
          Create one, e.g. a 30-minute intro call, and share its link. Guests only see times you&apos;re free.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard/event-types/new">Create your first event type</Link>
        </Button>
      </Card>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {items.map((et) => (
        <li key={et.id}>
          <Card className={et.isActive ? "relative overflow-hidden" : "relative overflow-hidden opacity-60"}>
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1"
              style={{ backgroundColor: et.color }}
            />
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{et.title}</h2>
                <p className="text-muted-foreground truncate font-mono text-xs">
                  /{user.username}/{et.slug}
                </p>
              </div>
              <ActiveToggle id={et.id} title={et.title} isActive={et.isActive} />
            </div>
            <div className="text-muted-foreground flex flex-wrap gap-2 text-sm">
              <Badge>
                <Clock className="mr-1 size-3" /> {formatMinutes(et.durationMinutes)}
              </Badge>
              <Badge>
                <MapPin className="mr-1 size-3" /> {LOCATION_LABELS[et.locationType]}
              </Badge>
              {!et.isActive && <Badge>Off: hidden from guests</Badge>}
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/event-types/${et.id}/edit`}>Edit</Link>
              </Button>
              <CopyLinkButton path={`/${user.username}/${et.slug}`} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
