"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setNoShowAction } from "./actions";

/**
 * Day 25: on a past meeting, "Didn't show up" (or Undo). One click, no confirm
 * step: unlike a cancel it emails nobody and is undone with one more click.
 */
export function NoShowButton({
  bookingId,
  guestName,
  noShow,
}: {
  bookingId: string;
  guestName: string;
  noShow: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      setError(null);
      const result = await setNoShowAction({ bookingId, noShow: !noShow });
      if (!result.ok) setError(result.error ?? "Couldn't save that");
    });

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={toggle}
        // The visible text is short; the accessible name says whose meeting.
        aria-label={noShow ? `Undo: ${guestName} didn't show up` : `${guestName} didn't show up`}
      >
        {noShow ? "Undo no-show" : "Didn't show up"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
