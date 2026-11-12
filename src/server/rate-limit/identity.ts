import { createHmac } from "node:crypto";

/*
 * Turning a request into the identifiers the limits count. Pure functions,
 * tested in identity.test.ts.
 */

/**
 * The visitor's IP. On Vercel, `x-forwarded-for` is written by Vercel's edge:
 * it overwrites whatever the client sent, so it can't be spoofed. Off Vercel
 * (local dev, CI) it's whatever arrives; Next only fills it in when it's
 * missing. That's what lets each E2E test act as its own visitor. Behind a
 * different host or proxy, this function is the one to revisit.
 */
export function clientIp(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim();
  if (!first) return "unknown";
  // "::ffff:1.2.3.4" is an IPv4 visitor seen through an IPv6 socket: same person as "1.2.3.4".
  return first.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
}

/**
 * The unit an IP limit counts. IPv4: the address. IPv6: its /64 network,
 * because one home or phone usually gets a whole /64 (2^64 addresses), so
 * per-address limits on IPv6 are free to dodge.
 */
export function ipBucket(ip: string): string {
  const address = ip.split("%")[0]!; // drop a zone id ("fe80::1%eth0")
  if (!address.includes(":")) return address;
  const prefix = ipv6Prefix64(address);
  return prefix ?? address;
}

function ipv6Prefix64(address: string): string | null {
  const parts = address.toLowerCase().split("::");
  if (parts.length > 2) return null;
  // An embedded IPv4 tail ("…:1.2.3.4") fills the last two groups.
  const groups = (s: string | undefined) =>
    s ? s.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g])) : [];
  const head = groups(parts[0]);
  const tail = groups(parts[1]);
  let all: string[];
  if (parts.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    all = [...head, ...Array<string>(missing).fill("0"), ...tail];
  } else {
    all = head;
  }
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${all
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/**
 * The inbox an email address reaches, for counting. Plus addressing
 * ("ada+1@…", "ada+2@…") lands in the same inbox at almost every provider, and
 * Gmail also ignores dots. Without this, the per-email limit is beaten by
 * adding "+1". Only the COUNTING key changes; the booking keeps what was typed.
 */
export function emailBucket(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email.trim().toLowerCase();
  let local = email.slice(0, at).trim().toLowerCase();
  let domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  local = local.split("+")[0] || local;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/**
 * What's stored in Redis instead of the raw value: HMAC-SHA256 with a server
 * secret. No IP, email or manage token sits in a third-party store, and a
 * plain SHA-256 wouldn't be enough: all 4 billion IPv4 addresses can be hashed
 * in seconds, and emails can be guessed. Without the secret, these can't.
 */
export function hashIdentifier(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}
