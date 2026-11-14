import "server-only";
import { env } from "@/lib/env";
import { sealManageToken } from "./manage-token";

/**
 * Encrypts a guest's manage token with the app's secret (Day 17). Passed to
 * createBooking and rescheduleBookingByToken, which stay free of env access
 * so tests can run them without one. See sealManageToken for the scheme.
 */
export const sealToken = (token: string, bookingId: string) =>
  sealManageToken(token, bookingId, env.BETTER_AUTH_SECRET);
