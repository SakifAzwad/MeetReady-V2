import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

// Better Auth's endpoints: /api/auth/sign-in/social, /api/auth/callback/google,
// /api/auth/get-session, /api/auth/sign-out, ...
export const { GET, POST } = toNextJsHandler(auth);
