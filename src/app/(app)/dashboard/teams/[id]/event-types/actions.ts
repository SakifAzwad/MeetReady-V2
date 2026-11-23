"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { fieldErrorsByPath } from "@/lib/validation/errors";
import { eventTypeSchema } from "@/lib/validation/event-type";
import { requireOnboardedUser } from "@/server/auth/session";
import {
  createTeamEventType,
  setTeamEventTypeActive,
  teamHostIdsSchema,
  updateTeamEventType,
  type TeamEventTypeResult,
} from "@/server/team-event-types";
import type { EventTypeActionResult } from "../../../event-types/actions";

/*
 * Day 29: a team's event types. Same habits as a host's own (session user,
 * Zod on every argument, the data layer checks the role): the owner creates
 * and edits; anyone else's call finds nothing.
 */

const ids = z.object({ teamId: z.uuid(), eventTypeId: z.uuid().optional() });

function failure(result: Exclude<TeamEventTypeResult, { ok: true }>): EventTypeActionResult {
  if (result.error === "slug_taken") {
    return { ok: false, fieldErrors: { slug: ["The team already has an event type with this link"] } };
  }
  if (result.error === "hosts_not_in_team") {
    return { ok: false, formError: "Someone you picked isn't in the team any more. Reload the page." };
  }
  return { ok: false, formError: "This team or event type no longer exists, or you don't own the team." };
}

export async function saveTeamEventTypeAction(
  where: unknown,
  values: unknown,
  hostIds: unknown,
): Promise<EventTypeActionResult> {
  const user = await requireOnboardedUser();
  const place = ids.safeParse(where);
  if (!place.success) return { ok: false, formError: "This team no longer exists." };
  const parsed = eventTypeSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsByPath(parsed.error) };
  const hosts = teamHostIdsSchema.safeParse(hostIds);
  if (!hosts.success) return { ok: false, formError: hosts.error.issues[0]?.message ?? "Pick the hosts." };

  const { teamId, eventTypeId } = place.data;
  const result = eventTypeId
    ? await updateTeamEventType(db, user.id, teamId, eventTypeId, parsed.data, hosts.data)
    : await createTeamEventType(db, user.id, teamId, parsed.data, hosts.data);
  if (!result.ok) return failure(result);
  redirect(`/dashboard/teams/${teamId}`); // throws: keep outside try/catch
}

export async function setTeamEventTypeActiveAction(
  where: unknown,
  isActive: unknown,
): Promise<{ ok: boolean }> {
  const user = await requireOnboardedUser();
  const place = ids.required().safeParse(where);
  const active = z.boolean().safeParse(isActive);
  if (!place.success || !active.success) return { ok: false };
  const ok = await setTeamEventTypeActive(
    db,
    user.id,
    place.data.teamId,
    place.data.eventTypeId,
    active.data,
  );
  refresh();
  return { ok };
}
