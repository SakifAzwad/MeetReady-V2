import { z } from "zod";

/*
 * Validates environment variables once, at startup. A missing secret fails
 * loudly with a clear message instead of as `undefined` deep inside a request.
 * v1 hardcoded a Zoom token in the repo; in v2 every secret comes from here.
 */
/** `KEY=` in a .env file arrives as "", not as a missing variable. For optional values, treat both the same. */
const emptyAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  /** Signs session cookies. Generate with: openssl rand -base64 32 */
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /** Public origin of the app, e.g. http://localhost:3000 or https://meetready.vercel.app */
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  /**
   * Optional. Without it, emails are saved as files in the OS temp folder (see server/email/sender.ts).
   * Empty counts as unset: .env.example ships `RESEND_API_KEY=`, and the E2E server sets it to "".
   */
  RESEND_API_KEY: emptyAsUnset(z.string().min(1).optional()),
  /** Resend's shared test sender only delivers to your own Resend account email; use a verified domain in production. */
  EMAIL_FROM: z.string().min(3).default("MeetReady <onboarding@resend.dev>"),
  /** Optional: a real booking page to link from the landing page, e.g. "/sakif/intro". */
  DEMO_BOOKING_PATH: emptyAsUnset(z.string().startsWith("/").optional()),
});

export const env = envSchema.parse(process.env);
