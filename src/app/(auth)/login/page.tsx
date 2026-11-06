import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSession } from "@/server/auth/session";
import { GoogleSignInButton } from "./google-sign-in-button";

export const metadata: Metadata = { title: "Log in · MeetReady" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Log in to MeetReady</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Hosts sign in with Google. Guests booking a meeting don&apos;t need an account.
      </p>
      <Suspense
        fallback={<div className="mt-8 h-10 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-900" />}
      >
        <SignIn searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SignIn({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(typeof next === "string" ? next : undefined);

  // Already logged in: skip the login page.
  if (await getSession()) redirect(destination);

  return <GoogleSignInButton callbackURL={destination} />;
}
