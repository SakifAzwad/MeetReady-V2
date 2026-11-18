import "server-only";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/db";
import { env } from "@/lib/env";
import { scrubError } from "@/lib/monitoring";
import { calendarBusy } from "@/server/calendar";
import { rateLimit } from "@/server/rate-limit";
import { createMcpEndpoint } from "./server";

/*
 * The real wiring for the MCP server (Day 21): the database, the cached
 * Google busy times the booking page uses, the per-host limit and Sentry.
 * Tests build the same server with createMcpEndpoint and their own deps.
 */
export const mcpEndpoint = createMcpEndpoint({
  db,
  appUrl: new URL(env.BETTER_AUTH_URL).origin,
  busyTimes: (hostId, range) => calendarBusy.busyTimes(hostId, range, "cached"),
  limit: (hostId) => rateLimit([["mcp_host", hostId]]),
  now: () => new Date(),
  // MCP SDK errors can carry the request, which may hold a booking's details: scrubbed, like the AI's.
  report: (error) => Sentry.captureException(scrubError(error), { tags: { area: "mcp" } }),
});
