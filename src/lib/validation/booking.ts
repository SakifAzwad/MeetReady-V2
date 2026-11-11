import { z } from "zod";
import { timeZoneSchema } from "./onboarding";
import { QUESTION_LIMITS } from "./questions";

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
  /**
   * Answers to the host's questions, keyed by question id. Only the outline is
   * checked here (an object, not too many keys): the real rules depend on the
   * event type's questions, so createBooking() checks them against the
   * current ones with answersSchema().
   */
  answers: z
    .record(z.string().max(64), z.unknown())
    .refine((a) => Object.keys(a).length <= QUESTION_LIMITS.questions, "Too many answers")
    .optional(),
  /**
   * Which version of the questions the form was built from (like an HTTP
   * ETag). If the host changed them while the guest was typing, the server
   * says so instead of storing answers to questions the guest never saw.
   * Optional so other callers (tests, a future API) can skip it: the answers
   * are fully validated either way.
   */
  questionsVersion: z.string().max(64).optional(),
});

export type BookingRequest = z.output<typeof bookingRequestSchema>;

/** Guest's reschedule request: the token proves which booking, startsAt is the new time. */
export const rescheduleRequestSchema = z.object({
  token: z.string().max(64),
  startsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
});

export const cancelRequestSchema = z.object({
  token: z.string().max(64),
  reason: z
    .string()
    .trim()
    .max(500)
    .transform((r) => r || null),
});

const MAX_RANGE_DAYS = 62;

/** GET /api/slots query. The range is capped so one request can't ask for years of slots. */
export const slotsQuerySchema = z
  .object({
    username: z.string().trim().toLowerCase().min(1).max(30),
    slug: z.string().trim().toLowerCase().min(1).max(80),
    from: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    to: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    /** Guest's manage token when rescheduling: their own booking shouldn't block the new time. */
    reschedule: z.string().max(64).optional(),
  })
  .refine((q) => q.to > q.from, { message: "`to` must be after `from`", path: ["to"] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, {
    message: `Range can be at most ${MAX_RANGE_DAYS} days`,
    path: ["to"],
  });
