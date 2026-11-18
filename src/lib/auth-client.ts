import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

/*
 * Browser-side helper for the few things that must start in the browser:
 * redirecting to Google, signing out, and (Day 21) answering an AI assistant's
 * consent request. No baseURL: the API is on the same origin (/api/auth/*).
 * Reading the session is done on the server instead.
 *
 * oauthProviderClient: when an assistant sends the host to /login or the
 * consent page, the URL carries a signed copy of the assistant's request. The
 * plugin adds it to sign-in and consent calls, so after Google sign-in Better
 * Auth carries on with that request instead of dropping it. Ordinary sign-ins
 * have no signed query and are unaffected.
 */
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
