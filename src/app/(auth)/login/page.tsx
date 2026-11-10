import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { Band } from "@/components/daylight/band";
import { PageTransition } from "@/components/motion";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { skyGradient } from "@/lib/scheduling/sky";
import { getSession } from "@/server/auth/session";
import { GoogleSignInButton } from "./google-sign-in-button";

export const metadata: Metadata = { title: "Log in" };

/*
 * Split layout: the form on the left, and on wide screens a panel showing
 * what you're signing up for (the same band guests will see). The logo's
 * mark has the same view-transition name as the landing page header's, so
 * it glides across when you click "Log in".
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <PageTransition>
      <main className="grid flex-1 lg:grid-cols-2">
        <div className="flex flex-col px-6 py-8 sm:px-12">
          <Link href="/" aria-label="MeetReady home" className="self-start rounded-md">
            <Logo morph />
          </Link>
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-16">
            <h1 className="text-4xl font-bold">Log in</h1>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              Hosts sign in with Google. New here? The same button creates your account, and you&apos;ll pick
              your booking link next.
            </p>
            <Suspense fallback={<div className="bg-muted mt-8 h-10 rounded-md" />}>
              <SignIn searchParams={searchParams} />
            </Suspense>
            <p className="text-muted-foreground mt-8 border-t pt-6 text-sm">
              Booking a meeting with someone? You don&apos;t need an account: use the link they sent you.
            </p>
          </div>
        </div>

        <aside aria-hidden className="hidden p-3 lg:block">
          <div className="bg-primary text-primary-foreground flex h-full flex-col justify-end gap-6 rounded-3xl p-12">
            <p className="font-display max-w-[18ch] text-4xl leading-tight font-bold">
              Your hours, laid over your guest&apos;s day.
            </p>
            {/* On a light card: the bands' night ends would vanish into the navy panel. */}
            <div className="bg-card text-card-foreground flex flex-col gap-3 rounded-2xl p-5">
              <SampleRow label="You, in Dhaka" zone="Asia/Dhaka" />
              <SampleRow label="A guest in London" zone="Europe/London" />
            </div>
            <p className="text-primary-foreground/70 max-w-[46ch] text-sm leading-relaxed">
              9 AM–5 PM in Dhaka is 3–11 AM in London. Your booking page shows that before anyone picks a
              time.
            </p>
          </div>
        </aside>
      </main>
    </PageTransition>
  );
}

/**
 * Illustrative: a 9–5 Dhaka day on a London timeline (3–11 AM), with the real
 * skies for a fixed November date (fixed, so this static page reads no clock).
 */
// London is on GMT in November, so its day is exactly the UTC day. Written out rather than
// dayBounds(): that goes through TZDate, which reads the clock, and this page is static.
const SAMPLE_DAY = { start: new Date("2026-11-09T00:00:00Z"), end: new Date("2026-11-10T00:00:00Z") };
function SampleRow({ label, zone }: { label: string; zone: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <Band segments={[{ left: 12.5, width: 33.33 }]} gradient={skyGradient(zone, SAMPLE_DAY)} />
    </div>
  );
}
async function SignIn({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(typeof next === "string" ? next : undefined);

  // Already logged in: skip the login page.
  if (await getSession()) redirect(destination);

  return <GoogleSignInButton callbackURL={destination} />;
}
