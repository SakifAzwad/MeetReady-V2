"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

/*
 * The last resort: an error in the root layout itself, which error.tsx can't
 * catch (it renders inside that layout). This replaces the whole document, so
 * it brings its own <html> and <body> and stays as plain as possible.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!error.digest) Sentry.captureException(error); // server errors are reported by the server
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-6">
        <div role="alert" className="flex max-w-md flex-col gap-4">
          <h1 className="text-3xl font-bold">MeetReady couldn&apos;t load.</h1>
          <p className="text-muted-foreground">Try again in a moment.</p>
          {error.digest && <p className="text-muted-foreground text-sm">Reference: {error.digest}</p>}
          <button
            type="button"
            onClick={reset}
            className="bg-primary text-primary-foreground self-start rounded-md px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
