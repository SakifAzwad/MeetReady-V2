"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { inviteTokenSchema } from "@/lib/validation/team";
import { requireOnboardedUser } from "@/server/auth/session";
import { acceptInvite, MAX_MEMBERS } from "@/server/teams";

const ERRORS = {
  not_found: "This invite link doesn't work.",
  used: "Someone has already joined with this link. Invite links work once: ask for a new one.",
  revoked: "This invite link was cancelled. Ask for a new one.",
  expired: "This invite link has expired (links last 7 days). Ask for a new one.",
  team_full: `This team is full (${MAX_MEMBERS} people).`,
} as const;

/**
 * Day 28: the Join button. A POST (a server action), never the page load: the
 * GET that opens the link must change nothing, because chat apps and mail
 * scanners open links to build previews, and a single-use link would be used
 * up before the person ever saw it.
 */
export async function joinTeamAction(token: string): Promise<{ error: string }> {
  const user = await requireOnboardedUser();
  if (!inviteTokenSchema.safeParse(token).success) return { error: ERRORS.not_found };
  const result = await acceptInvite(db, user.id, token, new Date());
  if (!result.ok) return { error: ERRORS[result.error] };
  redirect(`/dashboard/teams/${result.teamId}`);
}
