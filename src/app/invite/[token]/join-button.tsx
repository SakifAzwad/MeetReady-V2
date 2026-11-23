"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { joinTeamAction } from "./actions";

export function JoinButton({ token, teamName }: { token: string; teamName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Button
        size="lg"
        className="self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // On success the action redirects to the team's page.
            const result = await joinTeamAction(token);
            if (result) setError(result.error);
          })
        }
      >
        {pending ? "Joining…" : `Join ${teamName}`}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
