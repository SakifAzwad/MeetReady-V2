"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Allow or Cancel. The auth client's OAuth plugin attaches the page's signed
 * query (the assistant's request); Better Auth answers with the assistant's
 * redirect URL, with a one-time code on Allow or an "access_denied" error on
 * Cancel, and the client follows it.
 */
export function ConsentButtons({ clientName }: { clientName: string }) {
  const [pending, setPending] = useState<"allow" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setPending(accept ? "allow" : "cancel");
    setError(null);
    const { error } = await authClient.oauth2.consent({ accept });
    if (error) {
      setError("This request has expired or isn't valid. Start again from your assistant.");
      setPending(null);
    }
    // On success the browser is already on its way to the assistant.
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={pending !== null} onClick={() => answer(false)}>
          {pending === "cancel" ? "Cancelling…" : "Cancel"}
        </Button>
        <Button type="button" disabled={pending !== null} onClick={() => answer(true)}>
          {pending === "allow" ? "Connecting…" : `Allow ${clientName}`}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
