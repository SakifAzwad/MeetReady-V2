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

/** For refinements that read several fields: run only if every field parsed. */
const noIssuesYet = (payload: { issues: readonly unknown[] }) => payload.issues.length === 0;

/**
 * Whose booking page: a host's (/{username}/{slug}) or, Day 29, a team's
 * (/team/{team}/{slug}). Exactly one of username and team.
 */
const owner = {
  username: z.string().trim().toLowerCase().min(1).max(30).optional(),
  team: z.string().trim().toLowerCase().min(1).max(30).optional(),
  slug: z.string().trim().toLowerCase().min(1).max(80),
};
/** Refinement for schemas with `owner`: exactly one of username and team. */
const oneOwner = (q: { username?: string; team?: string }) =>
  (q.username === undefined) !== (q.team === undefined);
const oneOwnerMessage = () => ({
  message: "Give a username or a team, not both",
  path: ["username"],
  when: noIssuesYet,
});

/** The full request the booking action receives. */
export const bookingRequestSchema = guestDetailsSchema
  .extend({
    ...owner,
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
  })
  .refine(oneOwner, oneOwnerMessage());

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
    ...owner,
    from: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    to: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    /** Guest's manage token when rescheduling: their own booking shouldn't block the new time. */
    reschedule: z.string().max(64).optional(),
    /**
     * Day 25: the HOST moving one of their bookings (by id). Honoured only when the signed-in user is that
     * booking's host; for anyone else it's ignored, like a wrong reschedule token.
     */
    move: z.uuid().optional(),
  })
  // `when`: only compare the dates once both parsed. Zod 4 runs an object's
  // refinements even after a field failed its format check, and hands them
  // the raw string: "bad".getTime() threw, and the API answered 500 instead
  // of 400 (Day 12 story; never-throws.property.test.ts guards every schema).
  .refine(oneOwner, oneOwnerMessage())
  .refine((q) => q.to > q.from, { message: "`to` must be after `from`", path: ["to"], when: noIssuesYet })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, {
    message: `Range can be at most ${MAX_RANGE_DAYS} days`,
    path: ["to"],
    when: noIssuesYet,
  });

/** The booking assistant (Days 19–20): one message from the guest, and where they are. */
export const assistantRequestSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(30),
  slug: z.string().trim().toLowerCase().min(1).max(80),
  message: z.string().trim().min(2, "Tell us when suits you").max(300, "At most 300 characters"),
  timeZone: timeZoneSchema,
});
