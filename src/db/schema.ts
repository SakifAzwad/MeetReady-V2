import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { BookingAnswer, Question } from "@/lib/validation/questions";

/*
 * Conventions
 * - Column names: camelCase in TS, snake_case in Postgres (`casing: "snake_case"` in drizzle.config.ts + client).
 * - Every instant is `timestamptz`. Postgres stores it as UTC; nothing is ever stored as "10:00 AM" strings (v1 bug).
 * - Wall-clock things (availability "09:00–17:00") are `time` + the host's IANA timezone, because
 *   "09:00 in Dhaka" must stay 09:00 when DST or offsets change. Converting them to UTC at save time would be wrong.
 * - Rules live in the DB as CHECK constraints too, not only in Zod. Zod gives nice form errors;
 *   constraints guarantee bad data can't get in through a bug, a script, or a future AI tool.
 */

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ─── Auth (Better Auth core schema + our two extra user fields) ────────────────
// Better Auth uses text ids it generates itself. Day 2: compare against
// `npx @better-auth/cli generate` output when wiring Google login.

export const user = pgTable(
  "user",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    /** Public booking URL: meetreadyv2.vercel.app/{username}. Null until onboarding. */
    username: varchar({ length: 30 }).unique(),
    /** IANA name, e.g. "Asia/Dhaka". Availability rules are interpreted in this zone. */
    timeZone: text().notNull().default("UTC"),
    ...timestamps,
  },
  (t) => [
    // Same rule as usernameSchema. Lowercase-only also makes the UNIQUE
    // constraint case-insensitive in practice: "Sakif" can't sit next to "sakif".
    check(
      "user_username_format_check",
      sql`${t.username} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.username}) >= 3`,
    ),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [index().on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  ...timestamps,
});

// ─── OAuth server for AI assistants (Day 21: MCP) ───────────────────────────────
// Better Auth's JWT, OAuth Provider and MCP plugins. Columns and nullability as
// `npx auth@1.7.26 generate` printed them; only the style is ours (timestamptz,
// snake_case from `casing`). Read and written by Better Auth alone: our code
// reads oauth_consent and oauth_client to list "connected assistants".

const tz = { withTimezone: true } as const;

/** Signing keys for access tokens. The public half is served at /api/auth/jwks. */
export const jwks = pgTable("jwks", {
  id: text().primaryKey(),
  publicKey: text().notNull(),
  /** Encrypted with BETTER_AUTH_SECRET by the JWT plugin. */
  privateKey: text().notNull(),
  createdAt: timestamp(tz).notNull(),
  expiresAt: timestamp(tz),
  alg: text(),
  crv: text(),
});

/** An assistant (Claude, ChatGPT). With CIMD, client_id is the URL of its metadata document. */
export const oauthClient = pgTable(
  "oauth_client",
  {
    id: text().primaryKey(),
    clientId: text().notNull().unique(),
    clientSecret: text(),
    clientDiscoveryId: text(),
    disabled: boolean().default(false),
    skipConsent: boolean(),
    enableEndSession: boolean(),
    subjectType: text(),
    scopes: text().array(),
    clientCredentialsScopes: text().array().default([]),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp(tz),
    updatedAt: timestamp(tz),
    name: text(),
    uri: text(),
    icon: text(),
    contacts: text().array(),
    tos: text(),
    policy: text(),
    softwareId: text(),
    softwareVersion: text(),
    softwareStatement: text(),
    redirectUris: text().array().notNull(),
    postLogoutRedirectUris: text().array(),
    backchannelLogoutUri: text(),
    backchannelLogoutSessionRequired: boolean(),
    tokenEndpointAuthMethod: text(),
    applicationType: text(),
    jwks: text(),
    jwksUri: text(),
    grantTypes: text().array(),
    responseTypes: text().array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean().default(false),
    referenceId: text(),
    metadata: jsonb(),
  },
  (t) => [index().on(t.userId)],
);

/** The protected resources tokens can be bound to: here, one, the MCP endpoint. */
export const oauthResource = pgTable("oauth_resource", {
  id: text().primaryKey(),
  identifier: text().notNull().unique(),
  name: text().notNull(),
  accessTokenTtl: integer(),
  refreshTokenTtl: integer(),
  signingAlgorithm: text(),
  signingKeyId: text(),
  allowedScopes: text().array(),
  customClaims: jsonb(),
  dpopBoundAccessTokensRequired: boolean().default(false),
  disabled: boolean().default(false),
  createdAt: timestamp(tz),
  updatedAt: timestamp(tz),
  policyVersion: integer().default(1),
  metadata: jsonb(),
});

export const oauthClientResource = pgTable(
  "oauth_client_resource",
  {
    id: text().primaryKey(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text()
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb(),
    createdAt: timestamp(tz),
  },
  (t) => [uniqueIndex().on(t.clientId, t.resourceId), index().on(t.clientId), index().on(t.resourceId)],
);

/** Stored hashed (the plugin's default). Revoked when the host disconnects the assistant. */
export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text().references(() => session.id, { onDelete: "set null" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    authorizationCodeId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    expiresAt: timestamp(tz).notNull(),
    createdAt: timestamp(tz).notNull(),
    revoked: timestamp(tz),
    rotatedAt: timestamp(tz),
    rotationReplayResponse: text(),
    rotationReplayExpiresAt: timestamp(tz),
    authTime: timestamp(tz),
    confirmation: jsonb(),
    scopes: text().array().notNull(),
  },
  (t) => [
    index().on(t.clientId),
    index().on(t.sessionId),
    index().on(t.userId),
    index().on(t.authorizationCodeId),
  ],
);

/** Opaque access tokens only. MCP tokens are JWTs (checked by signature), so normally unused. */
export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text().references(() => session.id, { onDelete: "set null" }),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    authorizationCodeId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    refreshId: text().references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: timestamp(tz).notNull(),
    createdAt: timestamp(tz).notNull(),
    revoked: timestamp(tz),
    confirmation: jsonb(),
    scopes: text().array().notNull(),
  },
  (t) => [
    index().on(t.clientId),
    index().on(t.sessionId),
    index().on(t.userId),
    index().on(t.authorizationCodeId),
    index().on(t.refreshId),
  ],
);

/** "This host allowed this assistant these scopes": what the dashboard lists and Disconnect deletes. */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text().primaryKey(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    resources: text().array(),
    requestedUserInfoClaims: text().array(),
    scopes: text().array().notNull(),
    createdAt: timestamp(tz).notNull(),
    updatedAt: timestamp(tz).notNull(),
  },
  (t) => [index().on(t.clientId), index().on(t.userId)],
);

export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text().primaryKey(),
  expiresAt: timestamp(tz).notNull(),
});

// ─── Event types ────────────────────────────────────────────────────────────────

export const locationType = pgEnum("location_type", ["google_meet", "zoom", "phone", "in_person"]);

export const eventTypes = pgTable(
  "event_types",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: varchar({ length: 120 }).notNull(),
    /** URL part: meetreadyv2.vercel.app/{username}/{slug}. Unique per host, not globally. */
    slug: varchar({ length: 80 }).notNull(),
    description: text(),
    durationMinutes: integer().notNull(),
    /** null = same as duration. */
    slotIntervalMinutes: integer(),
    locationType: locationType().notNull().default("google_meet"),
    /** Zoom URL, phone number or address. Null for Google Meet (generated per booking). */
    locationValue: text(),
    color: varchar({ length: 7 }).notNull().default("#2563eb"),
    bufferBeforeMinutes: integer().notNull().default(0),
    bufferAfterMinutes: integer().notNull().default(0),
    minimumNoticeMinutes: integer().notNull().default(60),
    /** null = no limit. */
    bookingWindowDays: integer().default(60),
    maxBookingsPerDay: integer(),
    /** Soft "delete": past bookings keep pointing at the event type. */
    isActive: boolean().notNull().default(true),
    /**
     * Custom booking questions (Day 10), in display order. jsonb, not a table:
     * they're only ever read and saved together with the event type. Zod
     * (questionsSchema) checks the shape; the CHECK below is the last guard.
     */
    questions: jsonb().$type<Question[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [
    unique("event_types_user_slug_unique").on(t.userId, t.slug),
    check("event_types_duration_check", sql`${t.durationMinutes} between 5 and 720`),
    check(
      "event_types_interval_check",
      sql`${t.slotIntervalMinutes} is null or ${t.slotIntervalMinutes} > 0`,
    ),
    check("event_types_buffers_check", sql`${t.bufferBeforeMinutes} >= 0 and ${t.bufferAfterMinutes} >= 0`),
    check("event_types_notice_check", sql`${t.minimumNoticeMinutes} >= 0`),
    check("event_types_window_check", sql`${t.bookingWindowDays} is null or ${t.bookingWindowDays} >= 1`),
    check(
      "event_types_max_per_day_check",
      sql`${t.maxBookingsPerDay} is null or ${t.maxBookingsPerDay} >= 1`,
    ),
    check("event_types_slug_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("event_types_color_check", sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
    check(
      "event_types_questions_check",
      sql`jsonb_typeof(${t.questions}) = 'array' and jsonb_array_length(${t.questions}) <= 10`,
    ),
  ],
);

// ─── Availability ───────────────────────────────────────────────────────────────
// One weekly schedule per host for now. If hosts later need several schedules
// ("Work hours", "Office hours"), add a `schedules` table and point rules and
// event types at it; nothing in generateSlots() changes.

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dayOfWeek: smallint().notNull(), // 0 = Sunday … 6 = Saturday
    startTime: time().notNull(),
    endTime: time().notNull(), // '24:00' allowed = end of day
  },
  (t) => [
    index().on(t.userId),
    check("availability_rules_dow_check", sql`${t.dayOfWeek} between 0 and 6`),
    check("availability_rules_order_check", sql`${t.endTime} > ${t.startTime}`),
  ],
);

/** Replaces the weekly rules for one date. Both times null = day off. */
export const dateOverrides = pgTable(
  "date_overrides",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: date({ mode: "string" }).notNull(),
    startTime: time(),
    endTime: time(),
  },
  (t) => [
    index().on(t.userId, t.date),
    check(
      "date_overrides_times_check",
      sql`(${t.startTime} is null and ${t.endTime} is null)
       or (${t.startTime} is not null and ${t.endTime} is not null and ${t.endTime} > ${t.startTime})`,
    ),
  ],
);

// ─── Bookings ───────────────────────────────────────────────────────────────────

export const bookingStatus = pgEnum("booking_status", ["confirmed", "cancelled"]);
/**
 * Does the host's Google Calendar match this booking (Day 16)? null = the host
 * had no calendar connected, so there's nothing to match.
 *  - synced: the event exists with the right time (or, for a cancelled
 *    booking, is gone).
 *  - failed: the last write to Google failed; the dashboard offers Retry.
 */
export const calendarSync = pgEnum("calendar_sync", ["synced", "failed"]);
export const cancelledBy = pgEnum("cancelled_by", ["host", "guest"]);
/**
 * Day 22: who made the booking. `booking_page` = a guest on the public page;
 * `assistant` = the host, through an AI assistant connected over MCP.
 */
export const bookingSource = pgEnum("booking_source", ["booking_page", "assistant"]);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid().primaryKey().defaultRandom(),
    eventTypeId: uuid()
      .notNull()
      .references(() => eventTypes.id, { onDelete: "restrict" }),
    /**
     * Copied from event_types.user_id on insert. Looks redundant, but the
     * no-overlap exclusion constraint has to say "per host", and a constraint
     * can only see columns of its own table, not joined ones.
     */
    hostId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    guestName: varchar({ length: 120 }).notNull(),
    guestEmail: varchar({ length: 254 }).notNull(),
    /** For showing the guest their own times in emails. */
    guestTimeZone: text().notNull(),
    guestNotes: text(),
    /**
     * Answers to the event type's questions, as a snapshot: each one copies the
     * question's label and type, so editing or deleting a question later never
     * changes what a past booking says.
     */
    answers: jsonb().$type<BookingAnswer[]>().notNull().default([]),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    status: bookingStatus().notNull().default("confirmed"),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledBy: cancelledBy(),
    cancellationReason: text(),
    /**
     * SHA-256 of the guest's manage-link token (/booking/{token}). Only the
     * hash is stored, like a password: someone with a database backup can't
     * use it to cancel or move meetings. The token itself exists only in the
     * guest's email.
     */
    manageTokenHash: text().notNull().unique("bookings_manage_token_hash_unique"),
    /**
     * The same token, encrypted (AES-256-GCM, key derived from BETTER_AUTH_SECRET;
     * see sealManageToken). Day 17: emails sent later by background jobs (retries,
     * reminders) need the link itself, and a hash can't give it back. Null for
     * bookings made before Day 17 until the guest next uses their link.
     */
    manageTokenEncrypted: text(),
    /** Set when the guest moves the meeting. The booking keeps its id and manage link. */
    rescheduledAt: timestamp({ withTimezone: true }),
    /** Calendar invite version (.ics SEQUENCE): +1 on every change, so calendar apps apply updates in order. */
    sequence: integer().notNull().default(0),
    /** The event in the host's Google Calendar (Day 16). Set once Google has confirmed it. */
    calendarEventId: text(),
    /** The Google Meet link Google created with the event (Google Meet event types only). */
    meetUrl: text(),
    calendarSync: calendarSync(),
    /** Day 22. Existing rows (all from the page) get the default. */
    source: bookingSource().notNull().default("booking_page"),
    /**
     * The OAuth client id of the assistant that booked it (source = assistant). No foreign key: the history
     * stays when the host disconnects that assistant and its client row goes.
     */
    createdByClient: text(),
    /**
     * Day 24: who moved the meeting last (null = never moved, or moved before Day 24, when only guests
     * could). Reuses the `cancelled_by` enum: the same two people.
     */
    rescheduledBy: cancelledBy("rescheduled_by"),
    /**
     * Day 24: the assistant (OAuth client id) behind the LATEST cancel or move, null when the host or guest
     * did it themselves. Emails for a change are built from the row at that change's sequence, so the
     * latest is all they need. No foreign key, like createdByClient.
     */
    changedByClient: text(),
    ...timestamps,
  },
  (t) => [
    index().on(t.hostId, t.startsAt),
    index().on(t.eventTypeId),
    // The reminder sweep (Day 17) reads "confirmed bookings starting soon" every
    // 15 minutes. A partial index holds only confirmed rows, ordered by start.
    index("bookings_confirmed_starts_at_idx")
      .on(t.startsAt)
      .where(sql`status = 'confirmed'`),
    check("bookings_time_order_check", sql`${t.endsAt} > ${t.startsAt}`),
    // A cancelled booking always says when; a confirmed one never does.
    check("bookings_cancellation_check", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
    check("bookings_answers_check", sql`jsonb_typeof(${t.answers}) = 'array'`),
    // The no-double-booking EXCLUDE constraint is in a custom migration
    // (drizzle/0001_bookings_no_overlap.sql): Drizzle can't express EXCLUDE yet.
  ],
);

// ─── Reminders (Day 17) ─────────────────────────────────────────────────────────

/** Which reminder: a day before or an hour before the meeting. */
export const reminderKind = pgEnum("reminder_kind", ["day", "hour"]);

/**
 * Reminders already sent. The key includes the start time the reminder was
 * for: moving a meeting gives it a new start, so its reminders are due again
 * without resetting anything. The primary key also makes "send once" a
 * database rule, like the no-overlap constraint for bookings.
 */
export const bookingReminders = pgTable(
  "booking_reminders",
  {
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    kind: reminderKind().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bookingId, t.kind, t.startsAt] })],
);

// ─── AI (Day 18) ───────────────────────────────────────────────────────────────

/**
 * The host's meeting brief: a short summary and agenda an AI wrote from the
 * guest's notes and answers (src/server/ai/brief.ts). One per booking. Kept
 * apart from `bookings` so the booking row stays what the guest submitted,
 * and this is clearly a derived, AI-written thing that can be dropped or
 * regenerated.
 */
export const bookingBriefs = pgTable("booking_briefs", {
  bookingId: uuid()
    .primaryKey()
    .references(() => bookings.id, { onDelete: "cascade" }),
  summary: text().notNull(),
  agenda: jsonb().$type<string[]>().notNull(),
  prepare: jsonb().$type<string[]>().notNull(),
  /** Which model wrote it, e.g. "openai/gpt-oss-120b", so a brief can be traced to its model. */
  model: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** What happened to one AI call: written, the provider failed, or its answer didn't pass our checks. */
export const aiCallOutcome = pgEnum("ai_call_outcome", ["ok", "error", "invalid_output"]);

/**
 * One row per call to an AI model, for cost and reliability per feature
 * ("how many tokens did briefs use this month, and how often did they fail?").
 * No prompts or answers are stored here: only counts.
 */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** "meeting_brief" today; the booking assistant and MCP server will add theirs. */
    feature: text().notNull(),
    model: text().notNull(),
    hostId: text().references(() => user.id, { onDelete: "set null" }),
    bookingId: uuid().references(() => bookings.id, { onDelete: "set null" }),
    outcome: aiCallOutcome().notNull(),
    inputTokens: integer(),
    outputTokens: integer(),
    durationMs: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.feature, t.createdAt)],
);

// ─── Google Calendar (Day 15) ──────────────────────────────────────────────────

/**
 * Why the last call to Google failed (null = the last call worked):
 *  - access_lost: the token was refused or couldn't be refreshed (the host
 *    revoked access, or unticked the calendar permission). Needs a reconnect.
 *  - unavailable: Google timed out or answered 429/5xx. Clears by itself.
 */
export const calendarError = pgEnum("calendar_error", ["access_lost", "unavailable"]);

/**
 * A host's connected calendar. Kept apart from Better Auth's `account` row on
 * purpose: `account` is how they SIGN IN (Better Auth owns it), this is a
 * feature they switched on (we own it). Disconnecting deletes this row and
 * the calendar tokens; signing in keeps working.
 */
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    /** One calendar per host for now. */
    userId: text()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The Better Auth account (Google) whose tokens are used. Its tokens are encrypted at rest. */
    accountId: text()
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    /** "primary" for now; picking other calendars comes later. */
    calendarId: text().notNull().default("primary"),
    lastError: calendarError(),
    lastErrorAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // An error always says when; no error, no time.
    check("calendar_connections_error_check", sql`(${t.lastError} is null) = (${t.lastErrorAt} is null)`),
  ],
);

export type User = typeof user.$inferSelect;
export type EventType = typeof eventTypes.$inferSelect;
export type NewEventType = typeof eventTypes.$inferInsert;
export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type DateOverride = typeof dateOverrides.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type CalendarConnection = typeof calendarConnections.$inferSelect;
