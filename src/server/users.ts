import { eq } from "drizzle-orm";
import { pgConstraintName, pgErrorCode, PG_UNIQUE_VIOLATION } from "@/db/errors";
import { user } from "@/db/schema";
import type { Database } from "@/db/types";
import type { OnboardingInput } from "@/lib/validation/onboarding";
import { RESERVED_USERNAMES } from "@/lib/validation/onboarding";

export type OnboardingResult = { ok: true } | { ok: false; error: "username_taken" };

/**
 * Sets the user's username and timezone.
 *
 * `userId` must come from the session (requireUser), never from the form.
 *
 * Why not "SELECT to check the name is free, then UPDATE"? Two people picking
 * the same name at the same moment would both pass the check. The UNIQUE
 * constraint on user.username decides atomically; we just translate its error.
 */
export async function completeOnboarding(
  db: Database,
  userId: string,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  try {
    await db
      .update(user)
      .set({ username: input.username, timeZone: input.timeZone })
      .where(eq(user.id, userId));
    return { ok: true };
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION && pgConstraintName(error) === "user_username_unique") {
      return { ok: false, error: "username_taken" };
    }
    throw error;
  }
}

/** "Sakif.Azwad+test@gmail.com" -> "sakif-azwad-test". Empty string if nothing usable. */
export function suggestUsername(email: string): string {
  const local = email.split("@")[0] ?? "";
  const candidate = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  if (candidate.length < 3 || RESERVED_USERNAMES.has(candidate)) return "";
  return candidate;
}
