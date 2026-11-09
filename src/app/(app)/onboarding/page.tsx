import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/server/auth/session";
import { suggestUsername } from "@/server/users";
import { OnboardingForm } from "./onboarding-form";
import { PageTransition } from "@/components/motion";

export const metadata: Metadata = { title: "Set up your link" };

export default function OnboardingPage() {
  return (
    <PageTransition>
      <main className="mx-auto w-full max-w-md px-6 py-16">
        <h1 className="text-3xl font-bold">Set up your booking link</h1>
        <p className="text-muted-foreground mt-2">
          Pick the link guests will use to book you, and confirm your timezone. Your availability is set in
          this timezone.
        </p>
        <Suspense fallback={<div className="bg-muted mt-8 h-56 animate-pulse rounded-lg" />}>
          <OnboardingFormForUser />
        </Suspense>
      </main>
    </PageTransition>
  );
}

async function OnboardingFormForUser() {
  const user = await requireUser();
  if (user.username) redirect("/dashboard");

  // The timezone picker searches the browser's own zone list when opened, so
  // nothing needs to be sent from here (Day 3 sent ~420 names to keep a <select> in sync).
  return <OnboardingForm suggestedUsername={suggestUsername(user.email)} />;
}
