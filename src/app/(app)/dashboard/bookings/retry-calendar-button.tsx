"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { retryCalendarSyncAction } from "./actions";

/**
 * Shown on bookings whose last write to Google Calendar failed (Day 16). The
 * badge says what's wrong; the button runs the same sync again (safe to repeat).
 */
export function RetryCalendarButton({ bookingId }: { bookingId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await retryCalendarSyncAction(bookingId);
            if (!r.ok) setError(r.error ?? "Didn't work. Try again.");
          })
        }
      >
        {pending ? "Retrying…" : "Retry"}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
