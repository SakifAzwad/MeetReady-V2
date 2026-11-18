/*
 * The MCP server's scopes and paths (Day 21). A plain module, not
 * "use client" or server-only: the auth config, the tools, the consent page
 * and the dashboard card all read the same names.
 */

/** What a connected assistant may do. Each tool checks one of these on the token. */
export const MCP_SCOPES = {
  read: "bookings:read",
  /** Day 22: book_meeting. Granted now so a connection doesn't need re-approving later. */
  write: "bookings:write",
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

/** OAuth's own scope for a refresh token: without it the assistant has to reconnect every hour. */
export const REFRESH_SCOPE = "offline_access";

/** Every scope the authorization server accepts. No `openid`: assistants don't sign people in to anything. */
export const OAUTH_SCOPES = [MCP_SCOPES.read, MCP_SCOPES.write, REFRESH_SCOPE] as const;

/** What the consent page says for each scope, in the host's words. */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [MCP_SCOPES.read]:
    "See your meeting types, your free times and your bookings, including guests' names, emails and notes",
  [MCP_SCOPES.write]: "Book meetings with guests for you, from your free times",
  [REFRESH_SCOPE]: "Stay connected until you disconnect it, without asking you to sign in again",
};

/** The MCP endpoint. Also the OAuth "resource" every token is bound to (its audience). */
export const MCP_PATH = "/api/mcp";

/** The consent page Better Auth sends the host to. A top-level route (see app-routes.ts). */
export const CONSENT_PATH = "/oauth/consent";

/** The canonical MCP URL for a deployment: what the host pastes into Claude, and the tokens' audience. */
export const mcpUrl = (appUrl: string) => new URL(MCP_PATH, appUrl).toString();
