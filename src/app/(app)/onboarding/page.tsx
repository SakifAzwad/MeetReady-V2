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
      <h1 className="text-3xl font-bold">Set up your booking link</h1>
      <p className="text-muted-foreground mt-2">
        Pick the link guests will use to book you, and confirm your timezone. Your availability is set in this
        timezone.
      </p>
      <Suspense fallback={<div className="bg-muted mt-8 h-56 animate-pulse rounded-lg" />}>
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
