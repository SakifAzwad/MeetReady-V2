"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { fieldErrorsByPath } from "@/lib/validation/errors";
import { eventTypeSchema } from "@/lib/validation/event-type";
import { requireOnboardedUser } from "@/server/auth/session";
import { createEventType, setEventTypeActive, updateEventType } from "@/server/event-types";

/*
 * Server actions are public HTTP endpoints. The form calls them with typed
 * values, but anyone can call them with anything, so each one:
 *   1. gets the user from the session (never from the arguments),
 *   2. re-validates every argument with Zod (`unknown` in, parsed out),
 *   3. writes through the data layer, which scopes the query to that user.
 */

export type EventTypeActionResult = {
  ok: false;
  /** Keyed by form field path, e.g. "slug" or "questions.2.label". */
  fieldErrors?: Record<string, string[]>;
  formError?: string;
};

const SLUG_TAKEN: EventTypeActionResult = {
  ok: false,
  fieldErrors: { slug: ["You already have an event type with this link"] },
};

export async function createEventTypeAction(values: unknown): Promise<EventTypeActionResult> {
  const user = await requireOnboardedUser();
  const parsed = eventTypeSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsByPath(parsed.error) };

  const result = await createEventType(db, user.id, parsed.data);
  if (!result.ok) return SLUG_TAKEN;

  redirect("/dashboard/event-types"); // throws: keep outside try/catch
}

export async function updateEventTypeAction(id: unknown, values: unknown): Promise<EventTypeActionResult> {
  const user = await requireOnboardedUser();
  const parsed = eventTypeSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsByPath(parsed.error) };

  const result = await updateEventType(db, user.id, String(id), parsed.data);
  if (!result.ok) {
    return result.error === "slug_taken"
      ? SLUG_TAKEN
      : { ok: false, formError: "This event type no longer exists" };
  }

  redirect("/dashboard/event-types");
}

export async function setEventTypeActiveAction(id: unknown, isActive: unknown): Promise<{ ok: boolean }> {
  const user = await requireOnboardedUser();
  const active = z.boolean().safeParse(isActive);
  if (!active.success) return { ok: false };

  const result = await setEventTypeActive(db, user.id, String(id), active.data);
  // Re-render the current page on the server and send it back with this
  // response, so the list reflects the change in the same round trip.
  refresh();
  return { ok: result.ok };
}
