import { z } from "zod";

/*
 * The rules for environment variables, kept apart from env.ts so tests can
 * check them without a real environment (env.ts parses process.env the
 * moment it's imported).
 */

/** `KEY=` in a .env file arrives as "", not as a missing variable. For optional values, treat both the same. */
const emptyAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

/**
 * On Vercel the app can work out its own public URL: the production domain
 * (e.g. meetreadyv2.vercel.app) in production, the deployment's own URL on a
 * preview. One less secret to type, and a preview's email links point at the
 * preview (and its database branch), not at production.
 */
function vercelUrl(source: Record<string, string | undefined>): string | undefined {
  const host = source.VERCEL_ENV === "production" ? source.VERCEL_PROJECT_PRODUCTION_URL : source.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

/**
 * Upstash Redis for rate limiting (Day 14). Vercel's Marketplace integration
 * sets KV_REST_API_URL/TOKEN (the old Vercel KV names); a database created on
 * upstash.com gives UPSTASH_REDIS_REST_URL/TOKEN. Either pair works, like
 * Redis.fromEnv(). Unset = rate limits are kept in memory (dev, tests).
 */
function redisConfig(source: Record<string, string | undefined>) {
  const pick = (a: string, b: string) => source[a] || source[b] || undefined;
  return {
    url: pick("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"),
    token: pick("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"),
  };
}

export function parseEnv(source: Record<string, string | undefined>) {
  return z
    .object({
      NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
      DATABASE_URL: z.url(),
      /** Signs session cookies. Generate with: openssl rand -base64 32 */
      BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
      /** Public origin of the app, e.g. http://localhost:3000. Optional on Vercel (see vercelUrl). */
      BETTER_AUTH_URL: z.preprocess((v) => (v === "" || v === undefined ? vercelUrl(source) : v), z.url()),
      GOOGLE_CLIENT_ID: z.string().min(1),
      GOOGLE_CLIENT_SECRET: z.string().min(1),
      /**
       * Optional. Without it, emails are saved as files in the OS temp folder (see server/email/sender.ts).
       * Empty counts as unset: .env.example ships `RESEND_API_KEY=`, and the E2E server sets it to "".
       */
      RESEND_API_KEY: emptyAsUnset(z.string().min(1).optional()),
      /** Resend's shared test sender only delivers to your own Resend account email; use a verified domain for real guests. */
      EMAIL_FROM: emptyAsUnset(z.string().min(3).default("MeetReady <onboarding@resend.dev>")),
      /** Optional: a real booking page to link from the landing page, e.g. "/sakifazwad18/intro". */
      DEMO_BOOKING_PATH: emptyAsUnset(z.string().startsWith("/").optional()),
      /** Rate-limit store (see redisConfig): both or neither, so a half-pasted pair fails at startup, not per request. */
      REDIS: z.preprocess(
        () => redisConfig(source),
        z.union(
          [
            z.object({ url: z.url(), token: z.string().min(1) }),
            z.object({ url: z.undefined(), token: z.undefined() }).transform(() => undefined),
          ],
          { error: "Set both the Redis REST URL and token, or neither" },
        ),
      ),
    })
    .parse(source);
}

export type Env = ReturnType<typeof parseEnv>;
