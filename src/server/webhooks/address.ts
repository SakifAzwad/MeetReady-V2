import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

/*
 * SSRF protection for webhook URLs (Day 26). A host types any URL, and our
 * server POSTs to it: without checks, "https://169.254.169.254/…" (a cloud's
 * metadata service) or "http://10.0.0.5/admin" would make MeetReady attack
 * its own network. Two checks:
 *
 *  1. When an endpoint is saved (checkWebhookUrl + resolvesPublicly): https,
 *     port 443, no credentials, no local names, and every address the name
 *     resolves to is public. This gives the host a clear error up front.
 *  2. When each delivery CONNECTS (publicOnlyLookup, used by transport.ts):
 *     the same address check inside the HTTP client's own DNS lookup. Check 1
 *     alone is beaten by DNS rebinding: the name resolves to a public address
 *     when saved and to 127.0.0.1 a minute later. Checking the address the
 *     socket actually connects to closes that gap.
 *
 * Private-network URLs are allowed only with WEBHOOK_ALLOW_PRIVATE (E2E's
 * local fake receiver); production never sets it.
 */

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata at 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64: an IPv4 address in disguise
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local (private)
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const)
  blocked.addSubnet(net, bits, "ipv6");
// IPv4-mapped IPv6 (::ffff:127.0.0.1) is checked against the IPv4 rules by BlockList itself.

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

/** Check 1, the part that needs no network: the URL's shape. */
export function checkWebhookUrl(raw: string, options: { allowPrivate?: boolean } = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That isn't a valid URL." };
  }
  if (raw.length > 2000) return { ok: false, error: "That URL is too long." };
  if (options.allowPrivate) {
    return url.protocol === "https:" || url.protocol === "http:"
      ? { ok: true, url }
      : { ok: false, error: "Use an https:// URL." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Use an https:// URL." };
  if (url.username || url.password)
    return { ok: false, error: "Don't put a username or password in the URL." };
  if (url.port && url.port !== "443") return { ok: false, error: "Use the standard https port (443)." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    return isPublicAddress(host)
      ? { ok: true, url }
      : { ok: false, error: "That address is on a private network." };
  }
  if (!host.includes(".") || LOCAL_NAMES.test(host)) {
    return { ok: false, error: "Use a public address, not a local name." };
  }
  return { ok: true, url };
}

type Resolve = (host: string) => Promise<LookupAddress[]>;

const resolveAll: Resolve = (host) =>
  new Promise((resolve, reject) =>
    dnsLookup(host, { all: true }, (error, addresses) => (error ? reject(error) : resolve(addresses))),
  );

/** Check 1, the network part, when saving: every address the name resolves to must be public. */
export async function resolvesPublicly(url: URL, resolve: Resolve = resolveAll): Promise<UrlCheck> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return { ok: true, url }; // already checked by checkWebhookUrl
  let addresses: LookupAddress[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, error: `"${host}" couldn't be found.` };
  }
  if (addresses.length === 0) return { ok: false, error: `"${host}" couldn't be found.` };
  return addresses.every((a) => isPublicAddress(a.address))
    ? { ok: true, url }
    : { ok: false, error: `"${host}" points at a private network.` };
}

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`"${host}" points at a private network`);
    this.name = "BlockedAddressError";
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * Check 2: a `lookup` for the HTTP client's sockets. It resolves the name,
 * refuses if ANY address is private, and only then hands the addresses to
 * the socket, so the address checked is the address connected to.
 */
export function publicOnlyLookup(resolve: Resolve = resolveAll) {
  return (hostname: string, options: { all?: boolean } | number, callback: LookupCallback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
          return callback(new BlockedAddressError(hostname), []);
        }
        if (typeof options === "object" && options.all) return callback(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, []),
    );
  };
}
