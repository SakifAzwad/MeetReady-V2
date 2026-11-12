"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

/*
 * Error boundary for every page under the root layout. Says what happened
 * and what to do, without internals: `error.message` is replaced by Next.js
 * in production for server errors, and `digest` is the id to look up in the
 * server logs and in Sentry.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // A server error arrives here with only a `digest` (Next hides the message):
    // the server already reported the real one (instrumentation.ts), so sending
    // it again would only add a duplicate with less detail.
    if (!error.digest) Sentry.captureException(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col px-6 py-8 sm:px-12">
      <Link href="/" aria-label="MeetReady home" className="self-start rounded-md">
        <Logo />
      </Link>
      <div role="alert" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 py-16">
        <div>
          <h1 className="text-4xl font-bold">Something went wrong on our side.</h1>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            The page hit an error while loading. Try again, and if it keeps happening, come back in a few
            minutes.
          </p>
          {error.digest && <p className="text-muted-foreground mt-3 text-sm">Reference: {error.digest}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/">Go to the home page</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
