import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { seal, unseal } from "./seal";

/*
 * Guest manage links: /booking/{token}. The guest has no account, so this
 * token IS their authorisation to view, cancel or move one booking.
 *
 * - 32 random bytes (256 bits) from the OS's secure generator: unguessable.
 * - Only SHA-256(token) is stored. Someone who reads the database (a leaked
 *   backup, a curious admin) can't turn a hash back into a working link.
 * - SHA-256, not bcrypt: bcrypt is slow on purpose to protect weak human
 *   passwords from guessing. A 256-bit random token can't be guessed anyway,
 *   and a plain hash can be looked up by index (a salted bcrypt hash can't).
 * - Not a signed JWT carrying the booking id: a random token in the DB can be
 *   revoked or rotated; a signed one stays valid until it expires.
 */

const TOKEN_BYTES = 32;

/** base64url of 32 bytes = 43 characters, URL-safe without escaping. */
export const manageTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function hashManageToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newManageToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashManageToken(token) };
}

/*
 * An encrypted copy of the token (Day 17), stored next to the hash.
 *
 * The hash is enough to CHECK a token, but emails sent later by a background
 * job (a retried confirmation, a reminder the day before) need the token
 * itself to build the guest's link. Rule: hash what you only verify, encrypt
 * what you must send again. The scheme (AES-256-GCM, a key per use derived
 * from BETTER_AUTH_SECRET, the booking id as associated data) lives in
 * seal.ts since Day 26, shared with webhook secrets. A database backup alone
 * still gives no working links; the backup AND the secret would.
 */

const LABEL = "meetready/manage-token/v1";

export function sealManageToken(token: string, bookingId: string, secret: string): string {
  return seal(token, bookingId, secret, LABEL);
}

/**
 * The token back, or null if it can't be opened: wrong secret (rotated), another
 * booking's value, tampered or malformed. Callers fall back to an email without
 * the link; a broken value must never stop the email itself.
 */
export function openManageToken(sealed: string, bookingId: string, secret: string): string | null {
  const text = unseal(sealed, bookingId, secret, LABEL);
  return text !== null && manageTokenSchema.safeParse(text).success ? text : null;
}
