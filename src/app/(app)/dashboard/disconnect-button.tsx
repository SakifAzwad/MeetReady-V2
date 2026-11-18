"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectAssistantAction } from "./actions";

/** Two steps, like cancelling a meeting: reconnecting means signing in and approving again. */
export function DisconnectButton({ clientId, name }: { clientId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="self-start sm:self-auto"
        onClick={() => setConfirming(true)}
      >
        Disconnect
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <p className="text-sm">Disconnect {name}? It stops working at once.</p>
      {failed && (
        <p role="alert" className="text-destructive text-xs">
          Couldn&apos;t disconnect it. Reload the page and try again.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await disconnectAssistantAction({ clientId });
              if (!r.ok) setFailed(true);
            })
          }
        >
          {pending ? "Disconnecting…" : "Disconnect"}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </div>
    </div>
  );
}
