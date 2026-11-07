"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cancelBookingAsHostAction } from "./actions";

/** Two steps (click, then confirm with an optional reason) so a slip of the mouse can't cancel a meeting. */
export function CancelBookingButton({ bookingId, guestName }: { bookingId: string; guestName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancel
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-64">
      <label htmlFor={`reason-${bookingId}`} className="text-sm font-medium">
        Cancel with {guestName}?
      </label>
      <Textarea
        id={`reason-${bookingId}`}
        rows={2}
        maxLength={500}
        placeholder="Reason (sent to the guest, optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelBookingAsHostAction({ bookingId, reason });
              if (!result.ok) setError(result.error ?? "Couldn't cancel");
            })
          }
        >
          {pending ? "Cancelling…" : "Cancel meeting"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Keep
        </Button>
      </div>
    </div>
  );
}
