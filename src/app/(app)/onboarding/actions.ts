"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { onboardingSchema } from "@/lib/validation/onboarding";
import { requireUser } from "@/server/auth/session";
import { completeOnboarding } from "@/server/users";

export type OnboardingFormState = {
  errors?: { username?: string[]; timeZone?: string[] };
  values?: { username: string; timeZone: string };
};

/*
 * A server action is a public HTTP endpoint: anyone can POST to it with any
 * body, without using our form. So it re-does everything:
 *  1. who is calling   -> requireUser() (from the session cookie, checked in the DB)
 *  2. is the input ok  -> the same Zod schema the form uses
 *  3. write            -> scoped to the session user's id; DB constraints as the last guard
 */
export async function submitOnboarding(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const sessionUser = await requireUser();

  const raw = {
    username: String(formData.get("username") ?? ""),
    timeZone: String(formData.get("timeZone") ?? ""),
  };
  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors, values: raw };
  }

  const result = await completeOnboarding(db, sessionUser.id, parsed.data);
  if (!result.ok) {
    return { errors: { username: ["That username is already taken"] }, values: raw };
  }

  // A form field, so anyone can put anything in it: only a path on this site is followed (open redirect).
  const next = formData.get("next");
  redirect(safeRedirectPath(typeof next === "string" ? next : undefined)); // throws: outside any try/catch
}
