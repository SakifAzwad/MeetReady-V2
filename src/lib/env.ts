import { z } from "zod";

/*
 * Validates environment variables once, at startup. A missing secret fails
 * loudly with a clear message instead of as `undefined` deep inside a request.
 * v1 hardcoded a Zoom token in the repo; in v2 every secret comes from here.
 * Add BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID, RESEND_API_KEY … as features land.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
});

export const env = envSchema.parse(process.env);
