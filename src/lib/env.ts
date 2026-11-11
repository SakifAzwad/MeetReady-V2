import { parseEnv } from "./env-schema";

/*
 * Validates environment variables once, at startup. A missing secret fails
 * loudly with a clear message instead of as `undefined` deep inside a request.
 * v1 hardcoded a Zoom token in the repo; in v2 every secret comes from here.
 * The rules live in env-schema.ts.
 */
export const env = parseEnv(process.env);
