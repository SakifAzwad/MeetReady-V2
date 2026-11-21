import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/*
 * Encrypt a value we must use again later, bound to the row it belongs to
 * (Day 17, shared since Day 26). Used for guests' manage tokens and for
 * webhook signing secrets: both must be read back, so they can't be hashed.
 *
 * - AES-256-GCM: a changed ciphertext fails to open instead of decrypting to garbage.
 * - A fresh random 12-byte IV per value (GCM must never reuse an IV with a key).
 * - The key is derived from BETTER_AUTH_SECRET with HKDF and a label per use
 *   ("meetready/manage-token/v1", "meetready/webhook-secret/v1"), so each use
 *   gets its own key and no key equals anything Better Auth derives.
 * - The row's id is the additional authenticated data: a value copied onto
 *   another row doesn't open.
 *
 * Format: "v1.<iv>.<ciphertext+tag>", base64url.
 */

const SEAL_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const keyFor = (secret: string, label: string) =>
  Buffer.from(hkdfSync("sha256", secret, "meetready", label, 32));

export function seal(value: string, rowId: string, secret: string, label: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, label), iv);
  cipher.setAAD(Buffer.from(rowId, "utf8"));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [SEAL_VERSION, iv.toString("base64url"), body.toString("base64url")].join(".");
}

/** The value back, or null if it can't be opened (wrong secret or label, another row's value, tampered). */
export function unseal(sealed: string, rowId: string, secret: string, label: string): string | null {
  const [version, ivText, bodyText] = sealed.split(".");
  if (version !== SEAL_VERSION || !ivText || !bodyText) return null;
  try {
    const iv = Buffer.from(ivText, "base64url");
    const body = Buffer.from(bodyText, "base64url");
    if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret, label), iv);
    decipher.setAAD(Buffer.from(rowId, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(body.subarray(0, body.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null; // the tag didn't match
  }
}
