"use client";

import { Button } from "@/components/ui/button";
import { TimezoneCombobox } from "@/components/timezone-combobox";
import { useActionState, useState, useSyncExternalStore } from "react";
import { usernameSchema } from "@/lib/validation/onboarding";
import { submitOnboarding, type OnboardingFormState } from "./actions";

const noSubscription = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type Props = {
  suggestedUsername: string;
};

export function OnboardingForm({ suggestedUsername }: Props) {
  const [state, formAction, pending] = useActionState<OnboardingFormState, FormData>(submitOnboarding, {});

  const [username, setUsername] = useState(state.values?.username ?? suggestedUsername);

  // The browser knows the user's timezone; the server doesn't. On the server
  // (and during hydration) this is null, so the first client render matches
  // the server HTML; React then re-renders with the detected value.
  const detectedZone = useSyncExternalStore(noSubscription, browserTimeZone, () => null);

  // null until the user picks one -> fall back to the detected zone.
  const [chosenZone, setChosenZone] = useState<string | null>(state.values?.timeZone ?? null);
  const timeZone = chosenZone ?? detectedZone ?? "UTC";

  // Instant feedback while typing. The server re-validates with the same schema.
  const preview = usernameSchema.safeParse(username);
  const clientError = username && !preview.success ? preview.error.issues[0]?.message : undefined;
  const usernameError = state.errors?.username?.[0] ?? clientError;

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <label htmlFor="username" className="text-sm font-medium">
          Username
        </label>
        <div className="bg-card focus-within:ring-ring/50 focus-within:border-ring flex items-center rounded-md border focus-within:ring-[3px]">
          <span className="text-muted-foreground pl-3 select-none">meetready.app/</span>
          <input
            id="username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={usernameError ? true : undefined}
            aria-describedby={usernameError ? "username-error" : undefined}
            className="w-full bg-transparent py-2 pr-3 outline-none"
          />
        </div>
        {usernameError && (
          <p id="username-error" className="text-destructive text-sm">
            {usernameError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <TimezoneCombobox
          id="timeZone"
          name="timeZone"
          label="Timezone"
          value={timeZone}
          onChange={setChosenZone}
          detected={detectedZone}
        />
        {state.errors?.timeZone?.[0] && (
          <p className="text-destructive text-sm">{state.errors.timeZone[0]}</p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={pending || Boolean(clientError)}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
