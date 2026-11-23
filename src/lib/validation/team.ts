import { z } from "zod";

/*
 * Teams (Day 28). The slug is the team's public address, /team/{slug}/{event},
 * so it follows the username rules (lowercase, letters, numbers, single
 * hyphens). The same rules are CHECK constraints on the table.
 */

export const teamNameSchema = z
  .string()
  .trim()
  .min(1, "Give the team a name")
  .max(60, "At most 60 characters");

export const teamSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(30, "At most 30 characters")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use letters, numbers and single hyphens (not at the start or end)");

export const createTeamSchema = z.object({ name: teamNameSchema, slug: teamSlugSchema });
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

/** "Acme Design Co." -> "acme-design-co": a starting point the owner can edit. */
export function suggestTeamSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // é -> e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
}

/** /invite/{token}: 32 random bytes in base64url, the same shape as a manage token. */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
