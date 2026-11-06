import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/*
 * Optimistic redirects only (Next.js 16 renamed middleware.ts to proxy.ts).
 *
 * This checks that a session cookie EXISTS. It does not check that the cookie
 * is valid or unexpired: that needs a database query, and proxy runs on every
 * request including prefetches. The real check is requireUser() in each page
 * and action. Proxy just saves a logged-out visitor a pointless render and
 * sends them straight to /login.
 *
 * So a forged cookie gets past this file, then gets stopped by requireUser().
 * Never rely on proxy alone for security.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie = getSessionCookie(request) !== null;

  if (!hasSessionCookie && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*"],
};
