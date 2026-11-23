import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { teamInvites, teamMembers, teams, user } from "@/db/schema";
import type { Database } from "@/db/types";
import { createTestDb } from "@/test/db";
import {
  acceptInvite,
  createInvite,
  createTeam,
  deleteTeam,
  getTeam,
  hashInviteToken,
  INVITE_TTL_MS,
  leaveTeam,
  listMembers,
  listMyTeams,
  listPendingInvites,
  MAX_MEMBERS,
  MAX_OWNED_TEAMS,
  MAX_PENDING_INVITES,
  previewInvite,
  removeMember,
  renameTeam,
  revokeInvite,
} from "./teams";

/* Day 28: teams, roles and invite links, on a real (in-memory) Postgres. */

const NOW = new Date("2026-11-23T10:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
let db: Database;

async function addUser(id: string) {
  await db.insert(user).values({ id, name: id[0]!.toUpperCase() + id.slice(1), email: `${id}@example.com` });
}

/** A team owned by `owner`, with `members` joined through real invites. */
async function team(owner: string, slug: string, members: string[] = []) {
  const r = await createTeam(db, owner, { name: `Team ${slug}`, slug });
  if (!r.ok) throw new Error(r.error);
  for (const m of members) {
    const invite = await createInvite(db, owner, r.id, NOW);
    if (!invite.ok) throw new Error(invite.error);
    const joined = await acceptInvite(db, m, invite.token, NOW);
    if (!joined.ok) throw new Error(joined.error);
  }
  return r.id;
}

async function invite(owner: string, teamId: string, now = NOW) {
  const r = await createInvite(db, owner, teamId, now);
  if (!r.ok) throw new Error(r.error);
  return r.token;
}

beforeEach(async () => {
  db = await createTestDb();
  for (const id of ["ada", "grace", "linus", "mallory"]) await addUser(id);
}, 30_000);

describe("creating a team", () => {
  it("makes the creator its only owner", async () => {
    const id = await team("ada", "acme");
    expect(await db.select().from(teamMembers)).toEqual([
      expect.objectContaining({ teamId: id, userId: "ada", role: "owner" }),
    ]);
    expect(await listMyTeams(db, "ada")).toEqual([
      { id, slug: "acme", name: "Team acme", role: "owner", members: 1 },
    ]);
  });

  it("refuses a taken slug (the UNIQUE constraint decides) and a sixth team", async () => {
    await team("ada", "acme");
    expect(await createTeam(db, "grace", { name: "Other", slug: "acme" })).toEqual({
      ok: false,
      error: "slug_taken",
    });
    for (let i = 1; i < MAX_OWNED_TEAMS; i++) await team("ada", `team-${i}`);
    expect(await createTeam(db, "ada", { name: "One more", slug: "one-more" })).toEqual({
      ok: false,
      error: "too_many_teams",
    });
    // Being a member of others' teams doesn't count against the limit.
    expect((await createTeam(db, "grace", { name: "Grace's", slug: "graces" })).ok).toBe(true);
  });

  it("Postgres itself allows only one owner per team", async () => {
    await team("ada", "acme", ["grace"]);
    await expect(
      db.update(teamMembers).set({ role: "owner" }).where(eq(teamMembers.userId, "grace")),
    ).rejects.toThrow();
  });

  it("Postgres refuses a slug or name the form would have refused", async () => {
    await expect(db.insert(teams).values({ slug: "Bad Slug", name: "x" })).rejects.toThrow();
    await expect(db.insert(teams).values({ slug: "ok-slug", name: "" })).rejects.toThrow();
  });
});

describe("who can see and do what", () => {
  let id: string;
  beforeEach(async () => {
    id = await team("ada", "acme", ["grace"]);
  });

  it("someone outside the team sees nothing, as if it didn't exist", async () => {
    expect(await getTeam(db, "mallory", id)).toBeNull();
    expect(await listMembers(db, "mallory", id)).toEqual([]);
    expect(await listPendingInvites(db, "mallory", id, NOW)).toEqual([]);
    expect(await listMyTeams(db, "mallory")).toEqual([]);
  });

  it("someone outside the team can change nothing", async () => {
    const pendingToken = await invite("ada", id);
    const [open] = await listPendingInvites(db, "ada", id, NOW);
    expect(await renameTeam(db, "mallory", id, "Mine now")).toBe(false);
    expect(await createInvite(db, "mallory", id, NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await revokeInvite(db, "mallory", open!.id, NOW)).toBe(false);
    expect(await removeMember(db, "mallory", id, "grace")).toBe(false);
    expect(await leaveTeam(db, "mallory", id)).toEqual({ ok: false, error: "not_member" });
    expect(await deleteTeam(db, "mallory", id)).toBe(false);
    // Nothing changed.
    expect((await getTeam(db, "ada", id))!.name).toBe("Team acme");
    expect(await listMembers(db, "ada", id)).toHaveLength(2);
    expect((await previewInvite(db, pendingToken, NOW))!.state).toBe("open");
  });

  it("a member sees the team and its people, but can't manage it", async () => {
    expect(await getTeam(db, "grace", id)).toMatchObject({ name: "Team acme", role: "member" });
    expect((await listMembers(db, "grace", id)).map((m) => [m.userId, m.role])).toEqual([
      ["ada", "owner"],
      ["grace", "member"],
    ]);
    await invite("ada", id);
    const [open] = await listPendingInvites(db, "ada", id, NOW);
    expect(await listPendingInvites(db, "grace", id, NOW)).toEqual([]); // invites are the owner's business
    expect(await renameTeam(db, "grace", id, "Grace's now")).toBe(false);
    expect(await createInvite(db, "grace", id, NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await revokeInvite(db, "grace", open!.id, NOW)).toBe(false);
    expect(await removeMember(db, "grace", id, "ada")).toBe(false);
    expect(await deleteTeam(db, "grace", id)).toBe(false);
  });

  it("an owner of ANOTHER team can't touch this one", async () => {
    const other = await team("mallory", "evil");
    await invite("ada", id);
    const [open] = await listPendingInvites(db, "ada", id, NOW);
    expect(other).not.toBe(id);
    expect(await renameTeam(db, "mallory", id, "Mine now")).toBe(false);
    expect(await revokeInvite(db, "mallory", open!.id, NOW)).toBe(false);
    expect(await removeMember(db, "mallory", id, "grace")).toBe(false);
    expect(await deleteTeam(db, "mallory", id)).toBe(false);
  });

  it("the owner renames, removes a member, and deletes the team with everything in it", async () => {
    expect(await renameTeam(db, "ada", id, "Acme Inc.")).toBe(true);
    expect((await getTeam(db, "grace", id))!.name).toBe("Acme Inc.");
    expect(await removeMember(db, "ada", id, "ada")).toBe(false); // never the owner
    expect(await removeMember(db, "ada", id, "grace")).toBe(true);
    expect(await getTeam(db, "grace", id)).toBeNull();
    await invite("ada", id);
    expect(await deleteTeam(db, "ada", id)).toBe(true);
    expect(await db.select().from(teamMembers)).toEqual([]);
    expect(await db.select().from(teamInvites)).toEqual([]);
  });

  it("a member can leave; the owner can't (they'd leave a team with no owner)", async () => {
    expect(await leaveTeam(db, "ada", id)).toEqual({ ok: false, error: "owner_cannot_leave" });
    expect(await leaveTeam(db, "grace", id)).toEqual({ ok: true });
    expect(await listMyTeams(db, "grace")).toEqual([]);
  });
});

describe("invite links", () => {
  let id: string;
  beforeEach(async () => {
    id = await team("ada", "acme");
  });

  it("stores only the token's hash, expires in 7 days, and shows in the owner's list", async () => {
    const r = await createInvite(db, "ada", id, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.expiresAt).toEqual(later(INVITE_TTL_MS));
    const [row] = await db.select().from(teamInvites);
    expect(row!.tokenHash).toBe(hashInviteToken(r.token));
    expect(JSON.stringify(row)).not.toContain(r.token);
    expect(await listPendingInvites(db, "ada", id, NOW)).toHaveLength(1);
  });

  it("previewing a link (what a chat app's link preview does) never uses it up", async () => {
    const token = await invite("ada", id);
    for (let i = 0; i < 3; i++) {
      expect(await previewInvite(db, token, NOW)).toEqual({
        teamId: id,
        teamName: "Team acme",
        teamSlug: "acme",
        invitedBy: "Ada",
        state: "open",
      });
    }
    expect((await acceptInvite(db, "grace", token, NOW)).ok).toBe(true);
  });

  it("is single use: the second person gets 'used', and the first is in the team", async () => {
    const token = await invite("ada", id);
    expect(await acceptInvite(db, "grace", token, NOW)).toEqual({
      ok: true,
      teamId: id,
      alreadyMember: false,
    });
    expect(await acceptInvite(db, "linus", token, NOW)).toEqual({ ok: false, error: "used" });
    expect((await previewInvite(db, token, NOW))!.state).toBe("used");
    expect((await listMembers(db, "ada", id)).map((m) => m.userId)).toEqual(["ada", "grace"]);
    expect(await listPendingInvites(db, "ada", id, NOW)).toEqual([]);
  });

  it("stops working when revoked or expired, and a made-up token finds nothing", async () => {
    const revoked = await invite("ada", id);
    const [open] = await listPendingInvites(db, "ada", id, NOW);
    expect(await revokeInvite(db, "ada", open!.id, NOW)).toBe(true);
    expect(await revokeInvite(db, "ada", open!.id, NOW)).toBe(false); // already ended
    expect(await acceptInvite(db, "grace", revoked, NOW)).toEqual({ ok: false, error: "revoked" });

    const old = await invite("ada", id);
    const afterExpiry = later(INVITE_TTL_MS);
    expect((await previewInvite(db, old, afterExpiry))!.state).toBe("expired");
    expect(await acceptInvite(db, "grace", old, afterExpiry)).toEqual({ ok: false, error: "expired" });
    expect(await listPendingInvites(db, "ada", id, afterExpiry)).toEqual([]);

    const madeUp = "A".repeat(43);
    expect(await previewInvite(db, madeUp, NOW)).toBeNull();
    expect(await acceptInvite(db, "grace", madeUp, NOW)).toEqual({ ok: false, error: "not_found" });
  });

  it("someone already in the team doesn't use the link up", async () => {
    const token = await invite("ada", id);
    expect(await acceptInvite(db, "ada", token, NOW)).toEqual({ ok: true, teamId: id, alreadyMember: true });
    expect((await previewInvite(db, token, NOW))!.state).toBe("open");
    expect((await acceptInvite(db, "grace", token, NOW)).ok).toBe(true);
  });

  it(`caps open invites at ${MAX_PENDING_INVITES} and the team at ${MAX_MEMBERS} people`, async () => {
    for (let i = 0; i < MAX_PENDING_INVITES; i++) await invite("ada", id);
    expect(await createInvite(db, "ada", id, NOW)).toEqual({ ok: false, error: "too_many_invites" });

    // Fill the team to one place short, then hand out the last place twice.
    await db.delete(teamInvites);
    for (let i = 1; i < MAX_MEMBERS - 1; i++) {
      await addUser(`m${i}`);
      await acceptInvite(db, `m${i}`, await invite("ada", id), NOW);
    }
    const [a, b] = [await invite("ada", id), await invite("ada", id)];
    expect((await acceptInvite(db, "grace", a, NOW)).ok).toBe(true); // the 20th
    expect(await listMembers(db, "ada", id)).toHaveLength(MAX_MEMBERS);
    expect(await acceptInvite(db, "linus", b, NOW)).toEqual({ ok: false, error: "team_full" });
    // The refused join gave the link back (its claim was rolled back), and no new invites can be made.
    expect((await previewInvite(db, b, NOW))!.state).toBe("open");
    expect(await createInvite(db, "ada", id, NOW)).toEqual({ ok: false, error: "team_full" });
  });
});
