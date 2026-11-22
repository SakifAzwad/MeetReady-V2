/*
 * Security headers on every response (Day 12; framing rules split on Day 27).
 * Cheap, and they close whole classes of attack without touching app code:
 *  - frame-ancestors / X-Frame-Options: no other site can load MeetReady in a
 *    frame (clickjacking: a hidden "Confirm" under someone's click). The one
 *    exception is /embed/…, the booking widget other sites put on their pages.
 *  - nosniff: the browser trusts our Content-Type instead of guessing.
 *  - Referrer-Policy: other sites see only our origin, never a full path.
 *    (The manage page goes further: no referrer at all, set in its metadata.)
 *  - Permissions-Policy: the app never uses the camera, mic or location.
 * HTTPS (HSTS) is enforced by Vercel on its domains.
 *
 * Why framing /embed/… by ANY site is safe (Day 27): the embed page does
 * exactly what the public booking page does, for anyone, with no login. A
 * tricked click there gains an attacker nothing they couldn't do by opening
 * the page themselves, and a booking still needs a name and an email typed in.
 * Everything with power (dashboard, a guest's manage page, the AI consent
 * page) stays unframeable. And the host's session can't leak into a frame
 * either: Better Auth's cookie is SameSite=Lax, which browsers don't send to a
 * frame inside another site.
 *
 * Not yet: a script Content-Security-Policy. It needs per-request nonces,
 * which conflict with serving prerendered static shells; it's in the backlog.
 *
 * Kept out of next.config.ts so a test can run these exact `source` patterns
 * through Next's own matcher (security-headers.test.ts).
 */

type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };

/** The first path segment of the embeddable booking page: /embed/{username}/{slug}. */
export const EMBED_SEGMENT = "embed";

const COMMON: Header[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

/** Nobody may frame these pages. X-Frame-Options for old browsers that ignore CSP's frame-ancestors. */
const NO_FRAMING: Header[] = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
];

/**
 * Any site may frame the embed. No X-Frame-Options at all: it has no "allow
 * everyone" value, and browsers that know frame-ancestors ignore it anyway.
 */
const ANY_FRAMING: Header[] = [{ key: "Content-Security-Policy", value: "frame-ancestors *" }];

/**
 * Two rules that never overlap, rather than "deny everywhere, then allow on
 * /embed": when two of Next's header rules set the same key, the later one
 * wins, but nothing can REMOVE a header an earlier rule added, so a DENY
 * X-Frame-Options would stay on the embed and block it.
 */
export const SECURITY_HEADER_RULES: HeaderRule[] = [
  // Everything except /embed/… (the lookahead is case-insensitive: Next matches sources that way).
  { source: `/:path((?!${EMBED_SEGMENT}/).*)`, headers: [...NO_FRAMING, ...COMMON] },
  { source: `/${EMBED_SEGMENT}/:path*`, headers: [...ANY_FRAMING, ...COMMON] },
];
