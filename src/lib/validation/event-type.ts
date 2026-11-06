import { z } from "zod";

/*
 * One schema for: the event type form (instant feedback), the server action
 * (the check that counts) and, later, the AI assistant's tools. The database
 * has matching CHECK constraints as the last line of defence.
 */

export const LOCATION_TYPES = ["google_meet", "zoom", "phone", "in_person"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const LOCATION_LABELS: Record<LocationType, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  phone: "Phone call",
  in_person: "In person",
};

export const EVENT_COLORS = [
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#dc2626", // red
  "#ea580c", // orange
  "#16a34a", // green
  "#0891b2", // cyan
  "#475569", // slate
] as const;

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "Intro Call (30 min)!" -> "intro-call-30-min". Used to pre-fill the slug from the title. */
export function slugify(text: string, maxLength = 80): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents: "Café" -> "Cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

const int = (label: string, min: number, max: number) =>
  z
    .number({ error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);

export const eventTypeSchema = z
  .object({
    title: z.string().trim().min(1, "Give it a title").max(120, "At most 120 characters"),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Pick a link")
      .max(80, "At most 80 characters")
      .regex(SLUG_PATTERN, "Use letters, numbers and single hyphens"),
    description: z.string().trim().max(2000, "At most 2000 characters"),
    durationMinutes: int("Duration", 5, 720),
    slotIntervalMinutes: int("Slot interval", 5, 720).nullable(),
    locationType: z.enum(LOCATION_TYPES),
    locationValue: z.string().trim().max(500),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
    bufferBeforeMinutes: int("Buffer before", 0, 240),
    bufferAfterMinutes: int("Buffer after", 0, 240),
    minimumNoticeMinutes: int("Minimum notice", 0, 60 * 24 * 30),
    bookingWindowDays: int("Booking window", 1, 365).nullable(),
    maxBookingsPerDay: int("Max per day", 1, 100).nullable(),
  })
  .superRefine((value, ctx) => {
    // What "location details" means depends on the location type.
    const detail = value.locationValue;
    const issue = (message: string) => ctx.addIssue({ code: "custom", path: ["locationValue"], message });

    switch (value.locationType) {
      case "google_meet":
        // Generated per booking (Phase 2 calendar sync), nothing to enter.
        break;
      case "zoom":
        if (!z.url({ protocol: /^https$/ }).safeParse(detail).success)
          issue("Paste your Zoom link (https://…)");
        break;
      case "phone":
        if (!/^\+?[0-9 ()-]{6,20}$/.test(detail)) issue("Enter a phone number, e.g. +880 1712 345678");
        break;
      case "in_person":
        if (detail.length < 3) issue("Enter the address");
        break;
    }
  })
  .transform((value) => ({
    ...value,
    description: value.description || null,
    locationValue: value.locationType === "google_meet" ? null : value.locationValue,
  }));

/** What the form holds (strings for text, numbers/null for numbers). */
export type EventTypeFormValues = z.input<typeof eventTypeSchema>;
/** What the server stores, after trimming and transforms. */
export type EventTypeInput = z.output<typeof eventTypeSchema>;

export const EVENT_TYPE_DEFAULTS: EventTypeFormValues = {
  title: "",
  slug: "",
  description: "",
  durationMinutes: 30,
  slotIntervalMinutes: null,
  locationType: "google_meet",
  locationValue: "",
  color: EVENT_COLORS[0],
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 60,
  bookingWindowDays: 60,
  maxBookingsPerDay: null,
};
