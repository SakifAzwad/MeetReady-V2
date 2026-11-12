"use client";

import { CalendarClock, CalendarX2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookingWidget } from "@/app/[username]/[slug]/booking-widget";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { tooManyAttempts } from "@/lib/rate-limit-text";
import { cancelByTokenAction } from "./actions";

type Props = {
  token: string;
  changeable: boolean;
  username: string;
  slug: string;
  hostName: string;
  hostTimeZone: string;
  locationLabel: string;
  title: string;
  durationMinutes: number;
  currentStartsAt: string;
  currentEndsAt: string;
};

export function ManageBooking(props: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"menu" | "reschedule" | "cancel">("menu");

  if (!props.changeable) {
    return (
      <div className="text-muted-foreground p-10 text-center text-sm">
        This meeting type isn&apos;t available for changes right now. Reply to your confirmation email to
        contact {props.hostName}.
      </div>
    );
  }

  if (mode === "reschedule") {
    return (
      <BookingWidget
        layout="embedded"
        event={{
          username: props.username,
          slug: props.slug,
          title: props.title,
          description: null,
          durationMinutes: props.durationMinutes,
          hostName: props.hostName,
          hostTimeZone: props.hostTimeZone,
          locationLabel: props.locationLabel,
        }}
        reschedule={{
          token: props.token,
          currentStartsAt: props.currentStartsAt,
          currentEndsAt: props.currentEndsAt,
          onExit: () => setMode("menu"),
          // Re-render the server part (details on the left) with the new time;
          // the widget keeps its "moved" confirmation (client state survives refresh).
          onMoved: () => router.refresh(),
        }}
      />
    );
  }

  if (mode === "cancel") return <CancelForm token={props.token} onBack={() => setMode("menu")} />;

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold">Need to change something?</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          variant="outline"
          className="h-auto justify-start gap-3 p-4"
          onClick={() => setMode("reschedule")}
        >
          <CalendarClock className="size-5" />
          <span className="text-left">
            <span className="block font-medium">Reschedule</span>
            <span className="text-muted-foreground block text-xs font-normal">Pick another time</span>
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-auto justify-start gap-3 p-4"
          onClick={() => setMode("cancel")}
        >
          <CalendarX2 className="size-5" />
          <span className="text-left">
            <span className="block font-medium">Cancel</span>
            <span className="text-muted-foreground block text-xs font-normal">Free up the slot</span>
          </span>
        </Button>
      </div>
    </div>
  );
}

function CancelForm({ token, onBack }: { token: string; onBack: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await cancelByTokenAction({ token, reason });
    if (result.ok) {
      router.refresh(); // the server page now renders the "cancelled" state
    } else {
      setPending(false);
      setError(
        result.error === "not_changeable"
          ? "This booking can't be cancelled any more (already cancelled or started)."
          : result.error === "rate_limited"
            ? tooManyAttempts(result.retryAfterSeconds)
            : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <form onSubmit={cancel} className="flex flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold">Cancel this meeting?</h2>
      <Field id="reason" label="Reason" hint="Optional. Shared with the host.">
        {(aria) => (
          <Textarea
            {...aria}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Cancelling…" : "Cancel meeting"}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Keep it
        </Button>
      </div>
    </form>
  );
}
