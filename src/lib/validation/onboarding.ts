import { z } from "zod";
import { isValidTimeZone } from "@/lib/scheduling/time";

/*
 * One schema, used in two places: the onboarding form (instant feedback in the
 * browser) and the server action (the check that actually counts, because
 * anyone can send a request without using our form).
 */

/**
 * Usernames become top-level URLs: meetreadyv2.vercel.app/{username}. Any name that
 * collides with an app route would make that route unreachable, or let
 * someone squat a page that looks official (/login, /admin).
 */
export const RESERVED_USERNAMES = new Set([
  // Error-report endpoints (Sentry tunnel, Day 13): a profile here would collide with them.
  "monitoring",
  "sentry-tunnel",
  "about",
  "account",
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "blog",
  "book",
  "booking",
  "bookings",
  "contact",
  "dashboard",
  "docs",
  "help",
  "home",
  "login",
  "logout",
  "meetready",
  "new",
  "onboarding",
  "pricing",
  "privacy",
  "register",
  "settings",
  "signin",
  "signout",
  "signup",
  "support",
  "terms",
  "www",
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase() // "Sakif" and "sakif" must be the same URL, so store one form
  .min(3, "At least 3 characters")
  .max(30, "At most 30 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letters, numbers and single hyphens (not at the start or end)")
  .refine((name) => !RESERVED_USERNAMES.has(name), "That username is reserved");

export const timeZoneSchema = z.string().refine(isValidTimeZone, "Pick a valid timezone");

export const onboardingSchema = z.object({
  username: usernameSchema,
  timeZone: timeZoneSchema,
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
