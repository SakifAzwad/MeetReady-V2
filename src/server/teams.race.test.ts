import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { user } from "@/db/schema";
import type { Database } from "@/db/types";
import { createPostgresTestDb, TEST_DATABASE_URL } from "@/test/postgres";
import { acceptInvite, createInvite, createTeam, listMembers, MAX_MEMBERS } from "./teams";

/*
 * Day 28: joining a team at the same instant, on a real multi-connection
 * PostgreSQL (PGlite runs one transaction at a time, so it can't show a race).
 * Skipped unless TEST_DATABASE_URL is set; CI sets it.
 */

const NOW = new Date("2026-11-23T10:00:00Z");

describe.skipIf(!TEST_DATABASE_URL)("joining a team at the same moment (real Postgres)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let teamId: string;

  const people = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const addUsers = (ids: string[]) =>
    db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@example.com` })));
  const newInvite = async () => {
    const r = await createInvite(db, "owner", teamId, NOW);
    if (!r.ok) throw new Error(r.error);
    return r.token;
  };

  beforeEach(async () => {
    ({ db, close } = await createPostgresTestDb());
    await addUsers(["owner"]);
    const r = await createTeam(db, "owner", { name: "Acme", slug: "acme" });
    if (!r.ok) throw new Error(r.error);
    teamId = r.id;
  }, 30_000);

  afterEach(async () => close());

  it("ten people press Join on ONE link together: exactly one gets in", async () => {
    const guests = people(10, "g");
    await addUsers(guests);
    const token = await newInvite();
    const results = await Promise.all(guests.map((g) => acceptInvite(db, g, token, NOW)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === "used")).toBe(true);
    expect(await listMembers(db, "owner", teamId)).toHaveLength(2);
  });

  it("one place left, five links used at once: exactly one gets in, four links still work", async () => {
    const filler = people(MAX_MEMBERS - 2, "m");
    await addUsers(filler);
    for (const m of filler) await acceptInvite(db, m, await newInvite(), NOW);
    expect(await listMembers(db, "owner", teamId)).toHaveLength(MAX_MEMBERS - 1);

    const late = people(5, "late");
    await addUsers(late);
    const tokens = await Promise.all(late.map(() => newInvite()));
    const results = await Promise.all(late.map((p, i) => acceptInvite(db, p, tokens[i]!, NOW)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "team_full")).toHaveLength(4);
    expect(await listMembers(db, "owner", teamId)).toHaveLength(MAX_MEMBERS);
  });
});
