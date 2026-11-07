"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
      <Button type="button" size="lg" onClick={signIn} disabled={pending}>
        {pending ? "Redirecting to Google…" : "Continue with Google"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
