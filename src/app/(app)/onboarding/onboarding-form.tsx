"use client";

import { useActionState, useMemo, useState, useSyncExternalStore } from "react";
import { usernameSchema } from "@/lib/validation/onboarding";
import { submitOnboarding, type OnboardingFormState } from "./actions";

const noSubscription = () => () => {};
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type Props = {
  suggestedUsername: string;
  timeZones: string[];
};

export function OnboardingForm({ suggestedUsername, timeZones }: Props) {
  const [state, formAction, pending] = useActionState<OnboardingFormState, FormData>(submitOnboarding, {});

  const [username, setUsername] = useState(state.values?.username ?? suggestedUsername);

  // The browser knows the user's timezone; the server doesn't. On the server
  // (and during hydration) this is null, so the first client render matches
  // the server HTML; React then re-renders with the detected value.
  const detectedZone = useSyncExternalStore(noSubscription, browserTimeZone, () => null);

  // null until the user picks one -> fall back to the detected zone.
  const [chosenZone, setChosenZone] = useState<string | null>(state.values?.timeZone ?? null);
  const timeZone = chosenZone ?? detectedZone ?? "UTC";

  const options = useMemo(() => {
    const set = new Set(["UTC", ...timeZones]);
    if (detectedZone) set.add(detectedZone);
    return [...set].sort();
  }, [timeZones, detectedZone]);

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
        <div className="flex items-center rounded-md border border-neutral-300 focus-within:ring-2 focus-within:ring-blue-600 dark:border-neutral-700">
          <span className="pl-3 text-neutral-500 select-none">meetready.app/</span>
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
          <p id="username-error" className="text-sm text-red-600">
            {usernameError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="timeZone" className="text-sm font-medium">
          Timezone
        </label>
        <select
          id="timeZone"
          name="timeZone"
          value={timeZone}
          onChange={(e) => setChosenZone(e.target.value)}
          className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700"
        >
          {options.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        {detectedZone && timeZone !== detectedZone && (
          <button
            type="button"
            onClick={() => setChosenZone(detectedZone)}
            className="self-start text-sm text-blue-700 underline dark:text-blue-400"
          >
            Use detected: {detectedZone.replaceAll("_", " ")}
          </button>
        )}
        {state.errors?.timeZone?.[0] && <p className="text-sm text-red-600">{state.errors.timeZone[0]}</p>}
      </div>

      <button
        type="submit"
        disabled={pending || Boolean(clientError)}
        className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
