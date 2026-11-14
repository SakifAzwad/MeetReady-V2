import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
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

/*
 * An encrypted copy of the token (Day 17), stored next to the hash.
 *
 * The hash is enough to CHECK a token, but emails sent later by a background
 * job (a retried confirmation, a reminder the day before) need the token
 * itself to build the guest's link. Rule: hash what you only verify, encrypt
 * what you must send again.
 *
 * - AES-256-GCM: encryption plus a tag, so a changed ciphertext fails to open
 *   instead of decrypting to garbage.
 * - A fresh random 12-byte IV per token (GCM must never reuse an IV with a key).
 * - The key is derived from BETTER_AUTH_SECRET with HKDF and its own label, so
 *   it's a different key from anything Better Auth derives from the same secret.
 * - The booking id is the "additional authenticated data": the ciphertext only
 *   opens for its own row, so copying it onto another booking gets nothing.
 * - A database backup alone still gives no working links; the backup AND the
 *   secret would, the same as the Google refresh tokens (encrypted since Day 15).
 *
 * Format: "v1.<iv>.<ciphertext+tag>", base64url. The version lets the scheme
 * change later without guessing how an old value was made.
 */

const SEAL_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function sealingKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "meetready", "meetready/manage-token/v1", 32));
}

export function sealManageToken(token: string, bookingId: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(secret), iv);
  cipher.setAAD(Buffer.from(bookingId, "utf8"));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [SEAL_VERSION, iv.toString("base64url"), body.toString("base64url")].join(".");
}

/**
 * The token back, or null if it can't be opened: wrong secret (rotated), another
 * booking's value, tampered or malformed. Callers fall back to an email without
 * the link; a broken value must never stop the email itself.
 */
export function openManageToken(sealed: string, bookingId: string, secret: string): string | null {
  const [version, ivText, bodyText] = sealed.split(".");
  if (version !== SEAL_VERSION || !ivText || !bodyText) return null;
  try {
    const iv = Buffer.from(ivText, "base64url");
    const body = Buffer.from(bodyText, "base64url");
    if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", sealingKey(secret), iv);
    decipher.setAAD(Buffer.from(bookingId, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    const token = Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]);
    const text = token.toString("utf8");
    return manageTokenSchema.safeParse(text).success ? text : null;
  } catch {
    return null; // the tag didn't match
  }
}
