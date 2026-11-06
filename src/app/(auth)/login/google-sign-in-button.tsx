"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    // Redirects the browser to Google. Google sends the user back to
    // /api/auth/callback/google, Better Auth creates the user + session,
    // then forwards to callbackURL (or newUserCallbackURL on first sign-in).
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL,
      newUserCallbackURL: "/onboarding",
    });
    if (error) {
      setError(error.message ?? "Could not start Google sign-in");
      setPending(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="rounded-md border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        {pending ? "Redirecting to Google…" : "Continue with Google"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
