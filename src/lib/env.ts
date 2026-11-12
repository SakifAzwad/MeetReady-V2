import { parseEnv } from "./env-schema";

/*
 * Validates environment variables once, at startup. A missing secret fails
 * loudly with a clear message instead of as `undefined` deep inside a request.
 * v1 hardcoded a Zoom token in the repo; in v2 every secret comes from here.
 * The rules live in env-schema.ts.
 */
export const env = parseEnv(process.env);

/**
 * The app's address as people see it, e.g. "meetreadyv2.vercel.app" (or
 * "localhost:3000"). Shown in front of usernames and links in the UI, from the
 * same URL the emails use, so the screen can't advertise a domain we don't own.
 */
export const appHost = new URL(env.BETTER_AUTH_URL).host;
