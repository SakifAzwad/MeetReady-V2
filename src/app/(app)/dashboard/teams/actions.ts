"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { env } from "@/lib/env";
import { createTeamSchema, teamNameSchema } from "@/lib/validation/team";
import { requireOnboardedUser } from "@/server/auth/session";
import {
  createInvite,
  createTeam,
  deleteTeam,
  leaveTeam,
  MAX_MEMBERS,
  MAX_OWNED_TEAMS,
  MAX_PENDING_INVITES,
  removeMember,
  renameTeam,
  revokeInvite,
} from "@/server/teams";

/*
 * The Teams pages' actions (Day 28). Each one: the user from the session, the
 * input checked with Zod, then a function in src/server/teams.ts that checks
 * the user's role in the same query as the change. A team, invite or member id
 * that isn't yours gets the same "not found" as one that doesn't exist.
 *
 * No rate limits: every action needs a session, and the one that makes
 * something (invites) is capped per team.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };
export type FieldErrors = Partial<Record<"name" | "slug", string>>;

const NOT_FOUND = { ok: false, error: "That team isn't there any more. Reload the page." } as const;
const teamId = z.object({ teamId: z.uuid() });

export async function createTeamAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; errors: FieldErrors; error?: string }> {
  const user = await requireOnboardedUser();
  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) {
    const errors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "name" || field === "slug") && !errors[field]) errors[field] = issue.message;
    }
    return { ok: false, errors };
  }
  const result = await createTeam(db, user.id, parsed.data);
  if (!result.ok) {
    return result.error === "slug_taken"
      ? { ok: false, errors: { slug: "Another team has that address" } }
      : { ok: false, errors: {}, error: `You can own up to ${MAX_OWNED_TEAMS} teams.` };
  }
  redirect(`/dashboard/teams/${result.id}`);
}

export async function renameTeamAction(input: unknown): Promise<ActionResult> {
  const user = await requireOnboardedUser();
  const parsed = teamId.extend({ name: teamNameSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the name." };
  if (!(await renameTeam(db, user.id, parsed.data.teamId, parsed.data.name))) return NOT_FOUND;
  refresh();
  return { ok: true };
}

export async function deleteTeamAction(input: unknown): Promise<ActionResult> {
  const user = await requireOnboardedUser();
  const parsed = teamId.safeParse(input);
  if (!parsed.success || !(await deleteTeam(db, user.id, parsed.data.teamId))) return NOT_FOUND;
  redirect("/dashboard/teams");
}

/** The invite's full address, returned once: only its hash is stored. */
export async function createInviteAction(
  input: unknown,
): Promise<{ ok: true; url: string; expiresAt: string } | { ok: false; error: string }> {
  const user = await requireOnboardedUser();
  const parsed = teamId.safeParse(input);
  if (!parsed.success) return NOT_FOUND;
  const result = await createInvite(db, user.id, parsed.data.teamId, new Date());
  if (!result.ok) {
    if (result.error === "too_many_invites") {
      return { ok: false, error: `${MAX_PENDING_INVITES} links are waiting to be used. Revoke one first.` };
    }
    if (result.error === "team_full")
      return { ok: false, error: `A team can have up to ${MAX_MEMBERS} people.` };
    return NOT_FOUND;
  }
  refresh();
  return {
    ok: true,
    url: new URL(`/invite/${result.token}`, env.BETTER_AUTH_URL).toString(),
    expiresAt: result.expiresAt.toISOString(),
  };
}

export async function revokeInviteAction(input: unknown): Promise<ActionResult> {
  const user = await requireOnboardedUser();
  const parsed = z.object({ inviteId: z.uuid() }).safeParse(input);
  if (!parsed.success || !(await revokeInvite(db, user.id, parsed.data.inviteId, new Date()))) {
    return { ok: false, error: "That link has already been used, revoked or expired. Reload the page." };
  }
  refresh();
  return { ok: true };
}

export async function removeMemberAction(input: unknown): Promise<ActionResult> {
  const user = await requireOnboardedUser();
  const parsed = teamId.extend({ userId: z.string().min(1).max(100) }).safeParse(input);
  if (!parsed.success || !(await removeMember(db, user.id, parsed.data.teamId, parsed.data.userId))) {
    return { ok: false, error: "They aren't in the team any more. Reload the page." };
  }
  refresh();
  return { ok: true };
}

export async function leaveTeamAction(input: unknown): Promise<ActionResult> {
  const user = await requireOnboardedUser();
  const parsed = teamId.safeParse(input);
  if (!parsed.success) return NOT_FOUND;
  const result = await leaveTeam(db, user.id, parsed.data.teamId);
  if (!result.ok) {
    return result.error === "owner_cannot_leave"
      ? { ok: false, error: "You own this team. Delete it instead." }
      : NOT_FOUND;
  }
  redirect("/dashboard/teams");
}
