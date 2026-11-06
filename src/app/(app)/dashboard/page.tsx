import type { Metadata } from "next";
import { Suspense } from "react";
import { requireOnboardedUser } from "@/server/auth/session";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = { title: "Dashboard · MeetReady" };

/*
 * Cache Components (on in next.config.ts): everything outside <Suspense> is
 * prerendered into a static shell that loads instantly. Anything that reads
 * the request (cookies -> session) must sit inside a <Suspense> boundary and
 * streams in after.
 */
export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <SignOutButton />
      </header>

      <Suspense
        fallback={<div className="mt-8 h-32 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />}
      >
        <BookingLinkCard />
      </Suspense>

      <p className="mt-8 text-sm text-neutral-500">Event types and availability arrive on Day 3.</p>
    </main>
  );
}

async function BookingLinkCard() {
  // The real auth check. proxy.ts only checked that a cookie exists.
  const user = await requireOnboardedUser();

  return (
    <section className="mt-8 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
      <p className="text-neutral-600 dark:text-neutral-400">Signed in as {user.name}</p>
      <h2 className="mt-4 font-medium">Your booking link</h2>
      <p className="mt-1 font-mono text-blue-700 dark:text-blue-400">meetready.app/{user.username}</p>
      <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
        Timezone: {user.timeZone.replaceAll("_", " ")}
      </p>
    </section>
  );
}
