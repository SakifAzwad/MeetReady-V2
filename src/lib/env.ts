import { z } from "zod";

/*
 * Validates environment variables once, at startup. A missing secret fails
 * loudly with a clear message instead of as `undefined` deep inside a request.
 * v1 hardcoded a Zoom token in the repo; in v2 every secret comes from here.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  /** Signs session cookies. Generate with: openssl rand -base64 32 */
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /** Public origin of the app, e.g. http://localhost:3000 or https://meetready.vercel.app */
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
});

export const env = envSchema.parse(process.env);
