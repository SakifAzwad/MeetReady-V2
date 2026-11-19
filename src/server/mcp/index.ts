import "server-only";
import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { db } from "@/db";
import { env } from "@/lib/env";
import { scrubError } from "@/lib/monitoring";
import { calendarBusy } from "@/server/calendar";
import { jobs } from "@/server/jobs";
import { sealToken } from "@/server/manage-link";
import { emailBucket, rateLimit } from "@/server/rate-limit";
import { createMcpEndpoint } from "./server";

/*
 * The real wiring for the MCP server (Day 21): the database, the cached
 * Google busy times the booking page uses, the per-host limit and Sentry.
 * Day 22 adds what booking needs: the LIVE Google check, the booking limits,
 * the sealed manage link, and the background job that writes to Google
 * Calendar and sends the emails. Tests build the same server with their own deps.
 */
export const mcpEndpoint = createMcpEndpoint({
  db,
  appUrl: new URL(env.BETTER_AUTH_URL).origin,
  busyTimes: (hostId, range) => calendarBusy.busyTimes(hostId, range, "cached"),
  limit: (hostId) => rateLimit([["mcp_host", hostId]]),
  now: () => new Date(),
  calendar: calendarBusy,
  bookLimit: (hostId, guestEmail) =>
    rateLimit([
      ["mcp_book_host", hostId],
      ["book_email", emailBucket(guestEmail)],
    ]),
  sealToken,
  // Same as the booking page: Google and the emails run after the response, as a background job.
  onBooked: (bookingId) => after(() => jobs.bookingChanged({ bookingId, change: "created", sequence: 0 })),
  // MCP SDK errors can carry the request, which may hold a booking's details: scrubbed, like the AI's.
  report: (error) => Sentry.captureException(scrubError(error), { tags: { area: "mcp" } }),
});
