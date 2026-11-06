import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { requireOnboardedUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Dashboard · MeetReady" };

/*
 * Cache Components: everything outside <Suspense> is a static shell that loads
 * instantly; the part that reads the session streams in.
 */
export default function DashboardPage() {
  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <Suspense fallback={<div className="bg-muted h-36 animate-pulse rounded-xl" />}>
        <BookingLinkCard />
      </Suspense>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle>Event types</CardTitle>
          <CardDescription>The kinds of meetings guests can book: length, location, rules.</CardDescription>
          <Button asChild variant="outline" className="self-start">
            <Link href="/dashboard/event-types">Manage event types</Link>
          </Button>
        </Card>
        <Card>
          <CardTitle>Availability</CardTitle>
          <CardDescription>Your weekly hours, timezone and days off.</CardDescription>
          <Button asChild variant="outline" className="self-start">
            <Link href="/dashboard/availability">Set availability</Link>
          </Button>
        </Card>
      </div>
    </main>
  );
}

async function BookingLinkCard() {
  // The real auth check. proxy.ts only checked that a cookie exists.
  const user = await requireOnboardedUser();
  return (
    <Card>
      <CardDescription>Signed in as {user.name}</CardDescription>
      <CardTitle>Your booking link</CardTitle>
      <p className="text-primary font-mono">meetready.app/{user.username}</p>
      <p className="text-muted-foreground text-sm">Timezone: {user.timeZone.replaceAll("_", " ")}</p>
    </Card>
  );
}
