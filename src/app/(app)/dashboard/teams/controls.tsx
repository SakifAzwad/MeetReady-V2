"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { suggestTeamSlug } from "@/lib/validation/team";
import {
  createInviteAction,
  createTeamAction,
  deleteTeamAction,
  leaveTeamAction,
  removeMemberAction,
  renameTeamAction,
  revokeInviteAction,
  type ActionResult,
  type FieldErrors,
} from "./actions";
import { setTeamEventTypeActiveAction } from "./[id]/event-types/actions";

/*
 * The Teams pages' interactive parts (Day 28). The pages are server-rendered;
 * these call the actions. Anything that removes something asks once, inline
 * (no browser confirm(), which would block the page and the E2E tests).
 */

export function CreateTeamForm({ appHost, full }: { appHost: string; full: boolean }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // The address follows the name until it's edited by hand.
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shownSlug = slugEdited ? slug : suggestTeamSlug(name);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await createTeamAction({ name, slug: shownSlug });
          // On success the action redirects to the new team's page.
          if (result && !result.ok) {
            setErrors(result.errors);
            setError(result.error ?? null);
          }
        });
      }}
    >
      <Field id="team-name" label="Team name" error={errors.name}>
        {(aria) => (
          <Input
            {...aria}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. Acme Sales"
            disabled={full}
          />
        )}
      </Field>
      <Field
        id="team-slug"
        label="Team address"
        hint={`Guests will book the team at ${appHost}/team/${shownSlug || "…"}/…`}
        error={errors.slug}
      >
        {(aria) => (
          <Input
            {...aria}
            value={shownSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
            maxLength={30}
            autoComplete="off"
            spellCheck={false}
            disabled={full}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={pending || full}>
        {pending ? "Creating…" : "Create team"}
      </Button>
    </form>
  );
}

/** Runs an action and keeps its error message, for the small buttons below. */
function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult | undefined>, then?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result && !result.ok) return setError(result.error);
      then?.();
    });
  return { error, pending, run };
}

function ActionError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  ) : null;
}

export function InviteButton({
  teamId,
  teamName,
  full,
}: {
  teamId: string;
  teamName: string;
  full: boolean;
}) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (link) {
    return (
      <div role="status" className="bg-muted flex flex-col gap-3 rounded-lg p-4">
        <p className="text-sm font-medium">Invite link: copy it now, it won&apos;t be shown again.</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-background min-w-0 flex-1 truncate rounded border px-2 py-1.5 text-xs">
            {link.url}
          </code>
          <CopyButton text={link.url} label="Copy link" />
        </div>
        <p className="text-muted-foreground text-xs">
          Send it yourself, by chat or email. It lets one person join {teamName}, once, within 7 days.
        </p>
        <Button variant="outline" size="sm" className="self-start" onClick={() => setLink(null)}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        className="self-start"
        disabled={pending || full}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await createInviteAction({ teamId });
            if (!result.ok) return setError(result.error);
            setLink({ url: result.url, expiresAt: result.expiresAt });
          })
        }
      >
        {pending ? "Making a link…" : "Create an invite link"}
      </Button>
      <ActionError error={error} />
    </div>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run(() => revokeInviteAction({ inviteId }))}
      >
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      <ActionError error={error} />
    </div>
  );
}

/** A button that asks once, inline, before doing something that can't be undone. */
function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  pending,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending: boolean;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm">{question}</span>
      <Button variant="destructive" size="sm" disabled={pending} onClick={onConfirm}>
        {pending ? "Working…" : confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setAsking(false)}>
        Keep
      </Button>
    </div>
  );
}

export function RemoveMemberButton({
  teamId,
  userId,
  name,
}: {
  teamId: string;
  userId: string;
  name: string;
}) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmButton
        label="Remove"
        question={`Remove ${name}?`}
        confirmLabel="Remove"
        pending={pending}
        onConfirm={() => run(() => removeMemberAction({ teamId, userId }))}
      />
      <ActionError error={error} />
    </div>
  );
}

export function LeaveTeamButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col items-start gap-2">
      <ConfirmButton
        label="Leave team"
        question={`Leave ${teamName}? You'd need a new invite to come back.`}
        confirmLabel="Leave"
        pending={pending}
        onConfirm={() => run(() => leaveTeamAction({ teamId }))}
      />
      <ActionError error={error} />
    </div>
  );
}

export function DeleteTeamButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="flex flex-col items-start gap-2">
      <ConfirmButton
        label="Delete team"
        question={`Delete ${teamName} for everyone in it?`}
        confirmLabel="Delete"
        pending={pending}
        onConfirm={() => run(() => deleteTeamAction({ teamId }))}
      />
      <ActionError error={error} />
    </div>
  );
}

export function RenameTeamForm({ teamId, name }: { teamId: string; name: string }) {
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(false);
  const { error, pending, run } = useAction();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(
          () => renameTeamAction({ teamId, name: value }),
          () => setSaved(true),
        );
      }}
    >
      <label htmlFor="rename-team" className="text-sm font-medium">
        Team name
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="rename-team"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          maxLength={60}
          className="max-w-sm"
        />
        <Button type="submit" variant="outline" disabled={pending || value.trim() === name}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <span role="status" className="text-muted-foreground text-sm">
        {saved ? "Saved" : ""}
      </span>
      <ActionError error={error} />
    </form>
  );
}

/** Day 29: on/off for a team's event type (owner only; the action checks again). */
export function TeamEventTypeToggle({
  teamId,
  eventTypeId,
  title,
  isActive,
}: {
  teamId: string;
  eventTypeId: string;
  title: string;
  isActive: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(isActive);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={optimistic}
        disabled={pending}
        aria-label={`${title}: ${optimistic ? "on" : "off"}`}
        onCheckedChange={(next) =>
          startTransition(async () => {
            setFailed(false);
            setOptimistic(next);
            const result = await setTeamEventTypeActiveAction({ teamId, eventTypeId }, next);
            if (!result.ok) setFailed(true);
          })
        }
      />
      {failed && <span className="text-destructive text-xs">Couldn&apos;t save</span>}
    </div>
  );
}
