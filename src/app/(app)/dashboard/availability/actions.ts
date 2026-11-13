"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { dateOverrideSchema, scheduleToRules, weeklyScheduleSchema } from "@/lib/validation/availability";
import { requireOnboardedUser } from "@/server/auth/session";
import { deleteDateOverride, saveDateOverride, saveWeeklySchedule } from "@/server/availability";
import { disconnectCalendarForUser } from "@/server/calendar";

/* Same pattern as every action: session user -> re-validate -> scoped write. */

export type AvailabilityActionResult = { ok: true } | { ok: false; error: string };

export async function saveWeeklyScheduleAction(values: unknown): Promise<AvailabilityActionResult> {
  const user = await requireOnboardedUser();
  const parsed = weeklyScheduleSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid schedule" };

  await saveWeeklySchedule(db, user.id, {
    timeZone: parsed.data.timeZone,
    rules: scheduleToRules(parsed.data),
  });
  refresh();
  return { ok: true };
}

export async function saveDateOverrideAction(values: unknown): Promise<AvailabilityActionResult> {
  const user = await requireOnboardedUser();
  const parsed = dateOverrideSchema.safeParse(values);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid date override" };

  await saveDateOverride(db, user.id, parsed.data);
  refresh();
  return { ok: true };
}

export async function deleteDateOverrideAction(date: unknown): Promise<AvailabilityActionResult> {
  const user = await requireOnboardedUser();
  const parsed = z.iso.date().safeParse(date);
  if (!parsed.success) return { ok: false, error: "Invalid date" };

  await deleteDateOverride(db, user.id, parsed.data);
  refresh();
  return { ok: true };
}

/** Revokes MeetReady's access at Google and forgets the calendar tokens. Bookings stay as they are. */
export async function disconnectCalendarAction(): Promise<AvailabilityActionResult> {
  const user = await requireOnboardedUser();
  await disconnectCalendarForUser(user.id);
  refresh();
  return { ok: true };
}
