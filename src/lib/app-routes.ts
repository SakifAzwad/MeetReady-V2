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
]);
