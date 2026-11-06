"use client";

import { Check, Link as LinkIcon } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { setEventTypeActiveAction } from "./actions";

/**
 * On/off switch with an optimistic update: the switch flips immediately, the
 * server action runs, and the refreshed page arrives with the response. If
 * the action fails, the optimistic value is dropped and the real one shows.
 */
export function ActiveToggle({ id, title, isActive }: { id: string; title: string; isActive: boolean }) {
  const [optimisticActive, setOptimisticActive] = useOptimistic(isActive);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={optimisticActive}
        disabled={pending}
        aria-label={`${title}: ${optimisticActive ? "on" : "off"}`}
        onCheckedChange={(next) =>
          startTransition(async () => {
            setFailed(false);
            setOptimisticActive(next);
            const result = await setEventTypeActiveAction(id, next);
            if (!result.ok) setFailed(true);
          })
        }
      />
      {failed && <span className="text-destructive text-xs">Couldn&apos;t save</span>}
    </div>
  );
}

export function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(`${window.location.origin}${path}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check /> : <LinkIcon />}
      <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
    </Button>
  );
}
