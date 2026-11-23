import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { pgConstraintName, pgErrorCode, PG_UNIQUE_VIOLATION } from "@/db/errors";
import { eventTypeHosts, eventTypes, teamMembers, user, type EventType } from "@/db/schema";
import type { Database } from "@/db/types";
import type { EventTypeInput } from "@/lib/validation/event-type";
import { roleIn } from "./teams";

/*
 * A team's event types (Day 29). The same table and form as a host's own, with
 * team_id set instead of user_id, and a host list (event_type_hosts). Owner
 * only to create and change them (Sakif's pick, matching the team roles);
 * every member can see them.
 *
 * The owner check is done first in each transaction; the event type is then
 * changed with its team in the WHERE, so an id from another team matches
 * nothing. Hosts must be in the team: a user id from elsewhere is refused,
 * not silently dropped, so the form can say so.
 */

export const teamHostIdsSchema = z
  .array(z.string().min(1).max(100))
  .min(1, "Pick at least one host")
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, "Each host once");

export type TeamEventTypeResult =
  { ok: true; id: string } | { ok: false; error: "not_found" | "slug_taken" | "hosts_not_in_team" };

const isUuid = (id: string) => z.uuid().safeParse(id).success;
const isSlugTaken = (error: unknown) =>
  pgErrorCode(error) === PG_UNIQUE_VIOLATION && pgConstraintName(error) === "event_types_team_slug_unique";

/** A team's event types with their hosts (names, in order). Empty for someone outside the team. */
export async function listTeamEventTypes(db: Database, userId: string, teamId: string) {
  if (!isUuid(teamId) || !(await roleIn(db, userId, teamId))) return [];
  const types = await db
    .select()
    .from(eventTypes)
    .where(eq(eventTypes.teamId, teamId))
    .orderBy(asc(eventTypes.createdAt));
  if (types.length === 0) return [];
  const hosts = await db
    .select({ eventTypeId: eventTypeHosts.eventTypeId, userId: user.id, name: user.name })
    .from(eventTypeHosts)
    .innerJoin(user, eq(user.id, eventTypeHosts.userId))
    .where(
      inArray(
        eventTypeHosts.eventTypeId,
        types.map((t) => t.id),
      ),
    )
    .orderBy(asc(eventTypeHosts.position));
  return types.map((t) => ({ ...t, hosts: hosts.filter((h) => h.eventTypeId === t.id) }));
}

/** One of the team's event types and its host ids, for the edit form. Owner only. */
export async function getTeamEventTypeForOwner(
  db: Database,
  ownerId: string,
  teamId: string,
  id: string,
): Promise<{ eventType: EventType; hostIds: string[] } | null> {
  if (!isUuid(teamId) || !isUuid(id) || (await roleIn(db, ownerId, teamId)) !== "owner") return null;
  const [eventType] = await db
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.id, id), eq(eventTypes.teamId, teamId)));
  if (!eventType) return null;
  const hosts = await db
    .select({ userId: eventTypeHosts.userId })
    .from(eventTypeHosts)
    .where(eq(eventTypeHosts.eventTypeId, id))
    .orderBy(asc(eventTypeHosts.position));
  return { eventType, hostIds: hosts.map((h) => h.userId) };
}

/** Are all these users in the team? */
async function allInTeam(db: Database, teamId: string, hostIds: readonly string[]): Promise<boolean> {
  const rows = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.userId, [...hostIds])));
  return rows.length === hostIds.length;
}

/** The host list, in the order given: the first host is the organizer. Replaces any old list. */
async function setHosts(db: Database, eventTypeId: string, hostIds: readonly string[]) {
  await db.delete(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, eventTypeId));
  await db
    .insert(eventTypeHosts)
    .values(hostIds.map((userId, position) => ({ eventTypeId, userId, position })));
}

export async function createTeamEventType(
  db: Database,
  ownerId: string,
  teamId: string,
  input: EventTypeInput,
  hostIds: string[],
): Promise<TeamEventTypeResult> {
  if (!isUuid(teamId)) return { ok: false, error: "not_found" };
  try {
    return await db.transaction(async (tx) => {
      if ((await roleIn(tx, ownerId, teamId)) !== "owner") return { ok: false, error: "not_found" } as const;
      if (!(await allInTeam(tx, teamId, hostIds))) return { ok: false, error: "hosts_not_in_team" } as const;
      const [row] = await tx
        .insert(eventTypes)
        .values({ ...input, teamId, teamKind: "collective" })
        .returning({ id: eventTypes.id });
      await setHosts(tx, row!.id, hostIds);
      return { ok: true, id: row!.id } as const;
    });
  } catch (error) {
    if (isSlugTaken(error)) return { ok: false, error: "slug_taken" };
    throw error;
  }
}

export async function updateTeamEventType(
  db: Database,
  ownerId: string,
  teamId: string,
  id: string,
  input: EventTypeInput,
  hostIds: string[],
): Promise<TeamEventTypeResult> {
  if (!isUuid(teamId) || !isUuid(id)) return { ok: false, error: "not_found" };
  try {
    return await db.transaction(async (tx) => {
      if ((await roleIn(tx, ownerId, teamId)) !== "owner") return { ok: false, error: "not_found" } as const;
      if (!(await allInTeam(tx, teamId, hostIds))) return { ok: false, error: "hosts_not_in_team" } as const;
      const updated = await tx
        .update(eventTypes)
        .set(input)
        .where(and(eq(eventTypes.id, id), eq(eventTypes.teamId, teamId)))
        .returning({ id: eventTypes.id });
      if (updated.length === 0) return { ok: false, error: "not_found" } as const;
      await setHosts(tx, id, hostIds);
      return { ok: true, id } as const;
    });
  } catch (error) {
    if (isSlugTaken(error)) return { ok: false, error: "slug_taken" };
    throw error;
  }
}

/** On/off, like a host's own (no hard delete: past bookings point at it). Owner only. */
export async function setTeamEventTypeActive(
  db: Database,
  ownerId: string,
  teamId: string,
  id: string,
  isActive: boolean,
): Promise<boolean> {
  if (!isUuid(teamId) || !isUuid(id) || (await roleIn(db, ownerId, teamId)) !== "owner") return false;
  const updated = await db
    .update(eventTypes)
    .set({ isActive })
    .where(and(eq(eventTypes.id, id), eq(eventTypes.teamId, teamId)))
    .returning({ id: eventTypes.id });
  return updated.length === 1;
}
