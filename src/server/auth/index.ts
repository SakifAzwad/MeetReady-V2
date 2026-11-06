import "server-only";
import { db } from "@/db";
import { env } from "@/lib/env";
import { createAuth } from "./config";

export const auth = createAuth(db, {
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Always show the account picker, so someone with several Google
      // accounts can choose which one to use.
      prompt: "select_account",
    },
  },
});
