import { z } from "zod";
import { timeZoneSchema } from "./onboarding";

/*
 * Guests have no account, so everything they send is untrusted input. These
 * schemas run in the browser (instant feedback) and again on the server.
 */

/** What the guest types into the booking form. */
export const guestDetailsSchema = z.object({
  guestName: z.string().trim().min(1, "Enter your name").max(120, "At most 120 characters"),
  guestEmail: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email").max(254)),
  guestNotes: z.string().trim().max(2000, "At most 2000 characters"),
});

export type GuestDetailsForm = z.input<typeof guestDetailsSchema>;

/** The full request the booking action receives. */
export const bookingRequestSchema = guestDetailsSchema.extend({
  username: z.string().trim().toLowerCase().min(1).max(30),
  slug: z.string().trim().toLowerCase().min(1).max(80),
  // An exact instant with an explicit offset ("…Z" or "+06:00"). A bare
  // "2026-11-09T10:00" would be ambiguous: 10:00 where?
  startsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  guestTimeZone: timeZoneSchema,
});

export type BookingRequest = z.output<typeof bookingRequestSchema>;

const MAX_RANGE_DAYS = 62;

/** GET /api/slots query. The range is capped so one request can't ask for years of slots. */
export const slotsQuerySchema = z
  .object({
    username: z.string().trim().toLowerCase().min(1).max(30),
    slug: z.string().trim().toLowerCase().min(1).max(80),
    from: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    to: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  })
  .refine((q) => q.to > q.from, { message: "`to` must be after `from`", path: ["to"] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, {
    message: `Range can be at most ${MAX_RANGE_DAYS} days`,
    path: ["to"],
  });
