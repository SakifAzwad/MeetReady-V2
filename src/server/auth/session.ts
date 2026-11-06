import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from ".";
import type { SessionUser } from "./config";

/*
 * The data access layer's front door. EVERY server component, server action and
 * route handler that touches a user's data starts with one of these.
 *
 * The rule that fixes v1's security hole: the user id always comes from the
 * session, never from the request (no `?email=`, no `userId` form field).
 * Queries are then scoped with `where userId = <session user id>`, so a user
 * can't read or change someone else's data by editing a URL or a request body.
 *
 * `cache` dedupes within one render: a layout and a page can both call
 * getSession() and it hits the database once. (In server actions it's a no-op;
 * each call runs.)
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Logged in, or redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export type OnboardedUser = SessionUser & { username: string };

/** Logged in AND has picked a username, or redirect to the right step. */
export async function requireOnboardedUser(): Promise<OnboardedUser> {
  const user = await requireUser();
  if (!user.username) redirect("/onboarding");
  return user as OnboardedUser;
}
