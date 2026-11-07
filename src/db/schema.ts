import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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
    /** Public booking URL: meetready.app/{username}. Null until onboarding. */
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
    /** URL part: meetready.app/{username}/{slug}. Unique per host, not globally. */
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
export const cancelledBy = pgEnum("cancelled_by", ["host", "guest"]);

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
    /** Set when the guest moves the meeting. The booking keeps its id and manage link. */
    rescheduledAt: timestamp({ withTimezone: true }),
    /** Calendar invite version (.ics SEQUENCE): +1 on every change, so calendar apps apply updates in order. */
    sequence: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index().on(t.hostId, t.startsAt),
    index().on(t.eventTypeId),
    check("bookings_time_order_check", sql`${t.endsAt} > ${t.startsAt}`),
    // A cancelled booking always says when; a confirmed one never does.
    check("bookings_cancellation_check", sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`),
    // The no-double-booking EXCLUDE constraint is in a custom migration
    // (drizzle/0001_bookings_no_overlap.sql): Drizzle can't express EXCLUDE yet.
  ],
);

export type User = typeof user.$inferSelect;
export type EventType = typeof eventTypes.$inferSelect;
export type NewEventType = typeof eventTypes.$inferInsert;
export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type DateOverride = typeof dateOverrides.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
