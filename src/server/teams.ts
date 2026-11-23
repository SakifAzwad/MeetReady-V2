import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { pgConstraintName, pgErrorCode, PG_UNIQUE_VIOLATION } from "@/db/errors";
import { teamInvites, teamMembers, teams, user, type TeamRole } from "@/db/schema";
import type { Database } from "@/db/types";
import type { CreateTeamInput } from "@/lib/validation/team";

/*
 * Teams (Day 28): who is in which team, and who may do what.
 *
 * Authorization, the same rule as every host query since Day 2, one level up:
 * the user id comes from the session, and every query checks that user's
 * membership (and role) in the SAME statement or transaction as the read or
 * write. A team id from the URL is never trusted on its own: a team you're not
 * in looks exactly like one that doesn't exist (no "403 Forbidden" that would
 * confirm it's there).
 *
 *   owner:  rename, invite, revoke invites, remove members, delete the team
 *   member: see the team and its members, leave
 *
 * Exactly one owner: at most one by a partial unique index on team_members,
 * at least one because nothing here removes or demotes the owner (they delete
 * the team instead; transferring ownership is in the backlog).
 */

export const MAX_OWNED_TEAMS = 5;
export const MAX_MEMBERS = 20; // owner included
export const MAX_PENDING_INVITES = 10;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Invite tokens ──────────────────────────────────────────────────────────────
// Same scheme as the guest's manage token (manage-token.ts): 32 random bytes,
// only SHA-256 stored. Unguessable, so no rate limit is needed on lookups, and a
// leaked database can't be turned back into working links.

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

// ─── Reading ────────────────────────────────────────────────────────────────────

/** The caller's role in a team, or null if they aren't in it (or it doesn't exist: the same answer). */
export async function roleIn(db: Database, userId: string, teamId: string): Promise<TeamRole | null> {
  const [row] = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return row?.role ?? null;
}

/** The teams the caller is in, with their role and how many people each has. */
export async function listMyTeams(db: Database, userId: string) {
  const sizes = db
    .select({ teamId: teamMembers.teamId, members: count().as("members") })
    .from(teamMembers)
    .groupBy(teamMembers.teamId)
    .as("sizes");
  return db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      role: teamMembers.role,
      members: sizes.members,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(sizes, eq(sizes.teamId, teams.id))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name));
}

/** A team the caller is in, with their role; null otherwise. */
export async function getTeam(db: Database, userId: string, teamId: string) {
  const [row] = await db
    .select({ id: teams.id, slug: teams.slug, name: teams.name, role: teamMembers.role })
    .from(teams)
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, userId)))
    .where(eq(teams.id, teamId));
  return row ?? null;
}

/** Everyone in the team, owner first. Empty for someone who isn't in it. */
export async function listMembers(db: Database, userId: string, teamId: string) {
  if (!(await roleIn(db, userId, teamId))) return [];
  return db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: teamMembers.role,
      joinedAt: teamMembers.joinedAt,
    })
    .from(teamMembers)
    .innerJoin(user, eq(user.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(sql`${teamMembers.role} = 'owner' desc`, asc(teamMembers.joinedAt));
}

const pending = (now: Date) =>
  and(isNull(teamInvites.usedAt), isNull(teamInvites.revokedAt), gt(teamInvites.expiresAt, now));

/** Invites not yet used, revoked or expired. Owner only: members get an empty list. */
export async function listPendingInvites(db: Database, userId: string, teamId: string, now: Date) {
  if ((await roleIn(db, userId, teamId)) !== "owner") return [];
  return db
    .select({ id: teamInvites.id, createdAt: teamInvites.createdAt, expiresAt: teamInvites.expiresAt })
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, teamId), pending(now)))
    .orderBy(desc(teamInvites.createdAt));
}

// ─── Creating and changing a team ───────────────────────────────────────────────

export type CreateTeamResult =
  { ok: true; id: string } | { ok: false; error: "slug_taken" | "too_many_teams" };

/** A new team with the caller as its owner, both rows in one transaction. */
export async function createTeam(
  db: Database,
  userId: string,
  input: CreateTeamInput,
): Promise<CreateTeamResult> {
  try {
    return await db.transaction(async (tx) => {
      const [owned] = await tx
        .select({ n: count() })
        .from(teamMembers)
        .where(and(eq(teamMembers.userId, userId), eq(teamMembers.role, "owner")));
      if ((owned?.n ?? 0) >= MAX_OWNED_TEAMS) return { ok: false, error: "too_many_teams" } as const;
      const [team] = await tx.insert(teams).values(input).returning({ id: teams.id });
      await tx.insert(teamMembers).values({ teamId: team!.id, userId, role: "owner" });
      return { ok: true, id: team!.id } as const;
    });
  } catch (error) {
    // The UNIQUE constraint decides, not a "is it free?" check first (two people could pass it at once).
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION && pgConstraintName(error) === "teams_slug_unique") {
      return { ok: false, error: "slug_taken" };
    }
    throw error;
  }
}

/** Owner only: the role check is inside the UPDATE's own WHERE (ownedTeams, below). */
export async function renameTeam(
  db: Database,
  userId: string,
  teamId: string,
  name: string,
): Promise<boolean> {
  const rows = await db
    .update(teams)
    .set({ name })
    .where(and(eq(teams.id, teamId), inArray(teams.id, ownedTeams(db, userId))))
    .returning({ id: teams.id });
  return rows.length === 1;
}

/** Owner only. Members and invites go with it (ON DELETE CASCADE). */
export async function deleteTeam(db: Database, userId: string, teamId: string): Promise<boolean> {
  const rows = await db
    .delete(teams)
    .where(and(eq(teams.id, teamId), inArray(teams.id, ownedTeams(db, userId))))
    .returning({ id: teams.id });
  return rows.length === 1;
}

/**
 * The ids of the teams this user owns, as a subquery: `inArray(x.teamId, ownedTeams(db, me))` puts
 * the role check inside a write's own WHERE, so there's no gap between checking and writing.
 */
function ownedTeams(db: Database, userId: string) {
  return db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.role, "owner")));
}

// ─── Members ────────────────────────────────────────────────────────────────────

/** Owner only, and never the owner themself (they'd leave a team with no owner). */
export async function removeMember(
  db: Database,
  ownerId: string,
  teamId: string,
  memberId: string,
): Promise<boolean> {
  const rows = await db
    .delete(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, memberId),
        eq(teamMembers.role, "member"),
        inArray(teamMembers.teamId, ownedTeams(db, ownerId)),
      ),
    )
    .returning({ userId: teamMembers.userId });
  return rows.length === 1;
}

export type LeaveResult = { ok: true } | { ok: false; error: "not_member" | "owner_cannot_leave" };

export async function leaveTeam(db: Database, userId: string, teamId: string): Promise<LeaveResult> {
  const role = await roleIn(db, userId, teamId);
  if (!role) return { ok: false, error: "not_member" };
  if (role === "owner") return { ok: false, error: "owner_cannot_leave" };
  await db
    .delete(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId), eq(teamMembers.role, "member")),
    );
  return { ok: true };
}

// ─── Invites ────────────────────────────────────────────────────────────────────

export type InviteResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: "not_found" | "too_many_invites" | "team_full" };

/** Owner only. The token is returned once (only its hash is kept), for the owner to copy and send. */
export async function createInvite(
  db: Database,
  userId: string,
  teamId: string,
  now: Date,
): Promise<InviteResult> {
  return db.transaction(async (tx) => {
    if ((await roleIn(tx, userId, teamId)) !== "owner") return { ok: false, error: "not_found" } as const;
    const [open] = await tx
      .select({ n: count() })
      .from(teamInvites)
      .where(and(eq(teamInvites.teamId, teamId), pending(now)));
    if ((open?.n ?? 0) >= MAX_PENDING_INVITES) return { ok: false, error: "too_many_invites" } as const;
    const [size] = await tx.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
    if ((size?.n ?? 0) >= MAX_MEMBERS) return { ok: false, error: "team_full" } as const;

    const { token, hash } = newInviteToken();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    await tx
      .insert(teamInvites)
      .values({ teamId, tokenHash: hash, createdBy: userId, createdAt: now, expiresAt });
    return { ok: true, token, expiresAt } as const;
  });
}

/** Owner only, and only while it's still open. */
export async function revokeInvite(
  db: Database,
  userId: string,
  inviteId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(teamInvites)
    .set({ revokedAt: now })
    .where(
      and(eq(teamInvites.id, inviteId), pending(now), inArray(teamInvites.teamId, ownedTeams(db, userId))),
    )
    .returning({ id: teamInvites.id });
  return rows.length === 1;
}

export type InviteState = "open" | "used" | "revoked" | "expired";

/**
 * What the invite page shows before anyone clicks Join: the team, who invited,
 * and whether the link still works. Reading it changes nothing: a GET must
 * never use up a single-use link, because chat apps and mail scanners fetch
 * links to build previews before the person ever opens them.
 */
export async function previewInvite(db: Database, token: string, now: Date) {
  const [row] = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      teamSlug: teams.slug,
      invitedBy: user.name,
      usedAt: teamInvites.usedAt,
      revokedAt: teamInvites.revokedAt,
      expiresAt: teamInvites.expiresAt,
    })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .leftJoin(user, eq(user.id, teamInvites.createdBy))
    .where(eq(teamInvites.tokenHash, hashInviteToken(token)));
  if (!row) return null;
  const state: InviteState = row.usedAt
    ? "used"
    : row.revokedAt
      ? "revoked"
      : row.expiresAt <= now
        ? "expired"
        : "open";
  return {
    teamId: row.teamId,
    teamName: row.teamName,
    teamSlug: row.teamSlug,
    invitedBy: row.invitedBy,
    state,
  };
}

export type AcceptResult =
  | { ok: true; teamId: string; alreadyMember: boolean }
  | { ok: false; error: "not_found" | "used" | "revoked" | "expired" | "team_full" };

/**
 * Joins the team with an invite. Two races, two answers:
 *
 * 1. Two people open the same link and press Join together. The link is
 *    claimed with ONE conditional UPDATE ("set used_at where it's still
 *    open"): Postgres runs them one after the other, and the second finds
 *    nothing left to update. No "check, then write" gap.
 * 2. Two people join with two different links when the team has one place
 *    left. Each counts the members and adds itself; both could count 19. So
 *    the team's row is locked first (SELECT … FOR UPDATE), and joins to one
 *    team take turns.
 *
 * Someone already in the team doesn't use the link up: it can still go to
 * whoever it was meant for.
 */
export async function acceptInvite(
  db: Database,
  userId: string,
  token: string,
  now: Date,
): Promise<AcceptResult> {
  const hash = hashInviteToken(token);
  return db
    .transaction(async (tx) => {
      const [invite] = await tx
        .select({ teamId: teamInvites.teamId })
        .from(teamInvites)
        .where(eq(teamInvites.tokenHash, hash));
      if (!invite) return { ok: false, error: "not_found" } as const;

      // Race 2: joins to this team take turns from here to the end of the transaction.
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, invite.teamId)).for("update");

      if (await roleIn(tx, userId, invite.teamId)) {
        return { ok: true, teamId: invite.teamId, alreadyMember: true } as const;
      }

      // Race 1: claim the link. Only one transaction can match "still open".
      const claimed = await tx
        .update(teamInvites)
        .set({ usedAt: now, usedBy: userId })
        .where(and(eq(teamInvites.tokenHash, hash), pending(now)))
        .returning({ id: teamInvites.id });
      if (claimed.length === 0) {
        const state = await previewInvite(tx, token, now);
        const error = state && state.state !== "open" ? state.state : "not_found";
        return { ok: false, error } as const;
      }

      const [size] = await tx
        .select({ n: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, invite.teamId));
      if ((size?.n ?? 0) >= MAX_MEMBERS) {
        tx.rollback(); // gives the link back: the claim above is undone
      }
      await tx.insert(teamMembers).values({ teamId: invite.teamId, userId, role: "member", joinedAt: now });
      return { ok: true, teamId: invite.teamId, alreadyMember: false } as const;
    })
    .catch((error: unknown) => {
      // tx.rollback() unwinds by throwing this; it's how "team full" undoes the claim.
      if (error instanceof TransactionRollbackError) return { ok: false, error: "team_full" } as const;
      throw error;
    });
}
