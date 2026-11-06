import { createAuthClient } from "better-auth/react";

/*
 * Browser-side helper for the few things that must start in the browser:
 * redirecting to Google, and signing out. No baseURL: the API is on the same
 * origin (/api/auth/*). Reading the session is done on the server instead.
 */
export const authClient = createAuthClient();
