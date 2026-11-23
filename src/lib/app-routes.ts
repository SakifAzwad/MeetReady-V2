/*
 * The app's own top-level routes (Day 15 follow-up). Shared by proxy.ts, which
 * must not treat them as usernames, and by a test that checks every folder in
 * src/app is listed here and reserved as a username.
 *
 * Why a test: `privacy` and `terms` had been reserved usernames since Day 2,
 * but proxy.ts didn't list them. Adding the pages would have sent /privacy
 * through the username lookup, found no such user, and answered 404.
 */
export const APP_ROUTES = new Set([
  "dashboard",
  "onboarding",
  "login",
  "api",
  "booking",
  "_next",
  // Error reports from browsers (Sentry tunnel): never a username, and never worth a database query.
  "monitoring",
  "sentry-tunnel",
  // Policy pages (linked from Google's consent screen).
  "privacy",
  "terms",
  // Day 21: AI assistants ask the host's permission at /oauth/consent.
  "oauth",
  // Day 27: the booking page other sites put in a frame, /embed/{username}/{slug}.
  "embed",
  // Day 28: invite links (/invite/{token}); /team/{slug}/{event} arrives on Day 29, reserved now.
  "invite",
  "team",
]);

/**
 * Pages that need a login (proxy.ts sends a signed-out visitor to /login and
 * back). Day 28: /invite joined, so someone who opens an invite link while
 * signed out comes back to it after logging in.
 */
export const PROTECTED_SEGMENTS = new Set(["dashboard", "onboarding", "invite"]);

/**
 * Whole first segments only. Before Day 28 this was `pathname.startsWith("/dashboard")`,
 * which also matched a username like "dashboards": that host's booking page sent
 * every guest to the login page.
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_SEGMENTS.has(pathname.split("/")[1] ?? "");
}
