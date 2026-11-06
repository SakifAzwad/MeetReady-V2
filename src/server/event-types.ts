import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { pgConstraintName, pgErrorCode, PG_UNIQUE_VIOLATION } from "@/db/errors";
import { eventTypes, type EventType } from "@/db/schema";
import type { Database } from "@/db/types";
import type { EventTypeInput } from "@/lib/validation/event-type";

/*
 * Event type data access. Every function takes `userId` from the session and
 * puts it in the WHERE clause. That one habit is the fix for v1's biggest
 * security hole (IDOR: "insecure direct object reference"), where any id or
 * email in a request returned or changed that record, whoever owned it.
 *
 * Someone else's event type is reported as "not_found", not "forbidden":
 * telling an attacker "this id exists but isn't yours" leaks information.
 */

export type NotFound = { ok: false; error: "not_found" };
export type SlugTaken = { ok: false; error: "slug_taken" };

const isUuid = (id: string) => z.uuid().safeParse(id).success;

const isSlugTaken = (error: unknown) =>
  pgErrorCode(error) === PG_UNIQUE_VIOLATION && pgConstraintName(error) === "event_types_user_slug_unique";

export async function listEventTypes(db: Database, userId: string): Promise<EventType[]> {
  return db.select().from(eventTypes).where(eq(eventTypes.userId, userId)).orderBy(asc(eventTypes.createdAt));
}

export async function getEventType(db: Database, userId: string, id: string): Promise<EventType | null> {
  // A malformed id would make Postgres throw "invalid input syntax for type uuid".
  // It can't match anything, so treat it as not found instead of a 500.
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.id, id), eq(eventTypes.userId, userId)));
  return row ?? null;
}

export async function createEventType(
  db: Database,
  userId: string,
  input: EventTypeInput,
): Promise<{ ok: true; id: string } | SlugTaken> {
  try {
    const [row] = await db
      .insert(eventTypes)
      .values({ ...input, userId })
      .returning({ id: eventTypes.id });
    return { ok: true, id: row!.id };
  } catch (error) {
    if (isSlugTaken(error)) return { ok: false, error: "slug_taken" };
    throw error;
  }
}

export async function updateEventType(
  db: Database,
  userId: string,
  id: string,
  input: EventTypeInput,
): Promise<{ ok: true } | NotFound | SlugTaken> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  try {
    // userId in the WHERE: updating someone else's id matches 0 rows.
    const updated = await db
      .update(eventTypes)
      .set(input)
      .where(and(eq(eventTypes.id, id), eq(eventTypes.userId, userId)))
      .returning({ id: eventTypes.id });
    return updated.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
  } catch (error) {
    if (isSlugTaken(error)) return { ok: false, error: "slug_taken" };
    throw error;
  }
}

/**
 * No hard delete: bookings reference event types (ON DELETE RESTRICT), and past
 * bookings must keep their title, duration and location. Turning one off hides
 * it from the public page and stops new bookings.
 */
export async function setEventTypeActive(
  db: Database,
  userId: string,
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | NotFound> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  const updated = await db
    .update(eventTypes)
    .set({ isActive })
    .where(and(eq(eventTypes.id, id), eq(eventTypes.userId, userId)))
    .returning({ id: eventTypes.id });
  return updated.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}
