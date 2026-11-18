import { auth } from "@/server/auth";

/*
 * OAuth discovery at the site root (Day 21). Better Auth answers these, but its
 * routes live under /api/auth, and discovery URLs are fixed by the standards:
 *
 *  - /.well-known/oauth-protected-resource/api/mcp (RFC 9728): "the MCP server
 *    at /api/mcp is protected; here's its authorization server".
 *  - /.well-known/oauth-authorization-server/api/auth (RFC 8414): that server's
 *    endpoints (authorize, token), scopes, and that it takes Client ID
 *    Metadata Documents.
 *
 * Everything else under /.well-known gets Better Auth's 404.
 */
export const GET = (request: Request) => auth.handler(request);
