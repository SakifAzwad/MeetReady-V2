import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/server/auth/session";
import { suggestUsername } from "@/server/users";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your link · MeetReady" };

export default function OnboardingPage() {
  return (
    <main className="mx-auto w-full max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Set up your booking link</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Pick the link guests will use to book you, and confirm your timezone. Your availability is set in this
        timezone.
      </p>
      <Suspense
        fallback={<div className="mt-8 h-56 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-900" />}
      >
        <OnboardingFormForUser />
      </Suspense>
    </main>
  );
}

async function OnboardingFormForUser() {
  const user = await requireUser();
  if (user.username) redirect("/dashboard");

  // Built on the server and passed down, so server and browser render the same
  // list (no hydration mismatch). The form adds the browser's detected zone if
  // this list spells it differently (e.g. Asia/Kolkata vs Asia/Calcutta).
  const timeZones = Intl.supportedValuesOf("timeZone");

  return <OnboardingForm suggestedUsername={suggestUsername(user.email)} timeZones={timeZones} />;
}
