import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getSession } from "@/server/auth/session";
import { GoogleSignInButton } from "./google-sign-in-button";

export const metadata: Metadata = { title: "Log in · MeetReady" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <Link href="/" className="font-display mb-10 text-xl font-bold tracking-tight">
        MeetReady
      </Link>
      <h1 className="text-3xl font-bold">Log in</h1>
      <p className="text-muted-foreground mt-2">
        Hosts sign in with Google. Guests booking a meeting don&apos;t need an account.
      </p>
      <Suspense fallback={<div className="bg-muted mt-8 h-10 animate-pulse rounded-md" />}>
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
