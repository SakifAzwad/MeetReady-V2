import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { APP_ROUTES } from "@/lib/app-routes";
import { tooManyAttempts } from "@/lib/rate-limit-text";
import { publicPageExists } from "@/server/booking";
import { ipOf, rateLimit } from "@/server/rate-limit";

/*
 * Two jobs, both done before the page renders (Next.js 16 renamed
 * middleware.ts to proxy.ts; it runs on Node.js).
 *
 * 1. Optimistic login redirects for /dashboard and /onboarding.
 *    This checks that a session cookie EXISTS, not that it's valid: that's
 *    requireUser() in each page and action. A forged cookie gets past this
 *    file, then gets stopped there. Never rely on proxy alone for security.
 *
 * 2. Real 404s for public pages that don't exist (/nobody, /sakif/nope).
 *    Those pages stream: the "200 OK" goes out with the static shell, before
 *    the lookup inside <Suspense> can say "not found". The page then shows
 *    the not-found UI with `noindex`, but the status is wrong for crawlers,
 *    link checkers and monitoring (Day 7 finding). So proxy asks the database
 *    first, and if the page doesn't exist it serves the not-found page with a
 *    404 status instead. The pages are unchanged and still do their own lookup.
 *
 *    That lookup is also an oracle: 404 or not tells whether a username
 *    exists. So it's rate-limited per IP (Day 14), and ONLY this branch:
 *    app routes, files and the dashboard never wait on the limiter.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];

/** First path segments that are the app's own routes, never a username: src/lib/app-routes.ts. */

/** Same rule as usernameSchema; anything else can't be a profile, so no query is needed. */
const USERNAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (getSessionCookie(request) !== null) return NextResponse.next();
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  // /{username} or /{username}/{slug}
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return NextResponse.next();
  if (APP_ROUTES.has(segments[0]!) || segments[0]!.includes(".")) return NextResponse.next(); // routes, files

  const limited = await rateLimit([["pages", ipOf(request.headers)]]);
  if (!limited.ok) {
    // Plain text: a person browsing never gets here (120 pages a minute); a script reads the status.
    return new NextResponse(tooManyAttempts(limited.retryAfterSeconds), {
      status: 429,
      headers: {
        "Retry-After": String(limited.retryAfterSeconds),
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  if (!(await isPublicPage(segments))) {
    // Serve Next's own not-found page (app/not-found.tsx), which answers 404.
    // The address bar keeps the URL the visitor typed. (A rewrite to the SAME
    // URL with `{ status: 404 }` doesn't work: the page's streamed response
    // sets its own 200. Day 12 story.)
    return NextResponse.rewrite(new URL("/_not-found", request.url));
  }
  return NextResponse.next();
}

async function isPublicPage([rawUsername, rawSlug]: string[]): Promise<boolean> {
  let username: string;
  let slug: string | undefined;
  try {
    username = decodeURIComponent(rawUsername!).toLowerCase();
    slug = rawSlug === undefined ? undefined : decodeURIComponent(rawSlug).toLowerCase();
  } catch {
    return false; // malformed %-encoding
  }
  if (username.length < 3 || username.length > 30 || !USERNAME.test(username)) return false;
  return publicPageExists(db, username, slug);
}

export const config = {
  // Everything except Next's assets and files with an extension (icons, images).
  matcher: ["/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
