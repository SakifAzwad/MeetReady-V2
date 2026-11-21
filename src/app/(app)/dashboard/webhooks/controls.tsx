"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createEndpointAction,
  deleteEndpointAction,
  retryDeliveryAction,
  rotateSecretAction,
  sendTestAction,
} from "./actions";

/*
 * The Webhooks page's interactive parts (Day 26). The page itself is
 * server-rendered; these call the actions and show the one moment a secret is
 * visible.
 */

const EVENTS = [
  { value: "booking.created", label: "Booked" },
  { value: "booking.rescheduled", label: "Moved" },
  { value: "booking.cancelled", label: "Cancelled" },
] as const;

/** A secret, shown once, with a copy button. */
function SecretOnce({ secret, note }: { secret: string; note: string }) {
  return (
    <div role="status" className="bg-muted flex flex-col gap-2 rounded-lg p-4">
      <p className="text-sm font-medium">Signing secret: copy it now, it won&apos;t be shown again.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="bg-background min-w-0 flex-1 truncate rounded border px-2 py-1.5 text-xs">
          {secret}
        </code>
        <CopyButton text={secret} label="Copy secret" />
      </div>
      <p className="text-muted-foreground text-xs">{note}</p>
    </div>
  );
}

export function AddEndpointForm({ full }: { full: boolean }) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS.map((e) => e.value));
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (secret) {
    return (
      <div className="flex flex-col gap-3">
        <SecretOnce
          secret={secret}
          note="Your server uses it to check each request came from MeetReady (the webhook-signature header)."
        />
        <Button variant="outline" size="sm" className="self-start" onClick={() => setSecret(null)}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createEndpointAction({ url, events });
          if (!result.ok) return setError(result.error);
          setUrl("");
          setSecret(result.secret ?? null);
        });
      }}
    >
      <label htmlFor="webhook-url" className="text-sm font-medium">
        Endpoint URL
      </label>
      <Input
        id="webhook-url"
        type="url"
        inputMode="url"
        placeholder="https://example.com/webhooks/meetready"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={full}
        aria-describedby={error ? "webhook-error" : undefined}
      />
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="mb-1 text-sm font-medium">Send when a booking is</legend>
        {EVENTS.map((e) => (
          <label key={e.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={events.includes(e.value)}
              onChange={(ev) =>
                setEvents((now) => (ev.target.checked ? [...now, e.value] : now.filter((x) => x !== e.value)))
              }
              disabled={full}
            />
            {e.label}
          </label>
        ))}
      </fieldset>
      {error && (
        <p id="webhook-error" role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={pending || full}>
        {pending ? "Checking…" : "Add endpoint"}
      </Button>
      {full && <p className="text-muted-foreground text-sm">You have the most endpoints allowed (5).</p>}
    </form>
  );
}

export function EndpointActions({ id, url }: { id: string; url: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (
    fn: () => Promise<{ ok: boolean; error?: string; secret?: string }>,
    then?: (s?: string) => void,
  ) =>
    startTransition(async () => {
      setMessage(null);
      const result = await fn();
      if (!result.ok) return setMessage(result.error ?? "That didn't work.");
      then?.(result.secret);
    });

  if (secret) {
    return (
      <div className="flex flex-col gap-2">
        <SecretOnce
          secret={secret}
          note="The old secret keeps signing too for 24 hours, so you can update your server without missing an event."
        />
        <Button variant="outline" size="sm" className="self-start" onClick={() => setSecret(null)}>
          Done
        </Button>
      </div>
    );
  }

  if (confirm) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{confirm === "delete" ? `Delete ${url}?` : "Make a new secret?"}</span>
        <Button
          size="sm"
          variant={confirm === "delete" ? "destructive" : "default"}
          disabled={pending}
          onClick={() =>
            run(
              () => (confirm === "delete" ? deleteEndpointAction({ id }) : rotateSecretAction({ id })),
              (s) => {
                setConfirm(null);
                if (s) setSecret(s);
              },
            )
          }
        >
          {confirm === "delete" ? "Delete endpoint" : "Rotate secret"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirm(null)} disabled={pending}>
          Keep
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () => sendTestAction({ id }),
              () => {
                setMessage("Test event sent. Its result appears below in a moment.");
                // Sent after the response: look again shortly.
                setTimeout(() => router.refresh(), 2000);
              },
            )
          }
        >
          Send test
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirm("rotate")}>
          Rotate secret
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>
          Delete
        </Button>
      </div>
      {message && (
        <p role="status" className="text-muted-foreground text-xs">
          {message}
        </p>
      )}
    </div>
  );
}

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await retryDeliveryAction({ id });
            if (!result.ok) return setError(result.error);
            setTimeout(() => router.refresh(), 2000);
          })
        }
      >
        Retry
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
