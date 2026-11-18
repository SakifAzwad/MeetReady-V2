import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";
import { ipOf, rateLimit, tooManyRequests } from "@/server/rate-limit";

// Better Auth's endpoints: /api/auth/sign-in/social, /api/auth/callback/google,
// /api/auth/get-session, /api/auth/sign-out, ... and since Day 21 the OAuth
// server for AI assistants: /api/auth/oauth2/authorize, /token, /consent, /jwks.
const handler = toNextJsHandler(auth);

export const GET = handler.GET;

/**
 * Day 21: self-registration of MCP clients (only exists when MCP_ALLOW_DCR=1)
 * writes a row for anyone who asks, so it's limited per IP. Every other POST
 * goes straight through.
 */
export async function POST(request: Request) {
  if (new URL(request.url).pathname.endsWith("/oauth2/register")) {
    const limited = await rateLimit([["mcp_register_ip", ipOf(request.headers)]]);
    if (!limited.ok) return tooManyRequests(limited.retryAfterSeconds);
  }
  return handler.POST(request);
}
