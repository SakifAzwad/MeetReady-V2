import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

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
