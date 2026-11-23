import type { EventType } from "@/db/schema";
import type { EventTypeFormValues } from "@/lib/validation/event-type";

/** DB row -> form values (nullable text columns become "" for the inputs). */
export function toFormValues(et: EventType): EventTypeFormValues {
  return {
    title: et.title,
    slug: et.slug,
    description: et.description ?? "",
    durationMinutes: et.durationMinutes,
    slotIntervalMinutes: et.slotIntervalMinutes,
    locationType: et.locationType,
    locationValue: et.locationValue ?? "",
    color: et.color,
    bufferBeforeMinutes: et.bufferBeforeMinutes,
    bufferAfterMinutes: et.bufferAfterMinutes,
    minimumNoticeMinutes: et.minimumNoticeMinutes,
    bookingWindowDays: et.bookingWindowDays,
    maxBookingsPerDay: et.maxBookingsPerDay,
    questions: et.questions,
  };
}
