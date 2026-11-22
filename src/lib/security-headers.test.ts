// Next's own matcher for `source` patterns (what next.config.ts headers() goes through). Internal path,
// but it's the real thing: a hand-written regex here could agree with our patterns and still differ from Next.
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADER_RULES } from "./security-headers";

/** The headers a path gets, as Next merges them: every matching rule, later keys winning. */
function headersFor(pathname: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of SECURITY_HEADER_RULES) {
    if (getPathMatch(rule.source)(pathname) === false) continue;
    for (const { key, value } of rule.headers) result.set(key.toLowerCase(), value);
  }
  return result;
}

describe("framing (Day 27)", () => {
  it.each([
    "/",
    "/dashboard",
    "/dashboard/event-types",
    "/booking/some-token", // the guest's manage page: cancel/move with one click
    "/oauth/consent", // granting an AI assistant access
    "/login",
    "/sakifazwad18/intro", // the normal booking page: the embed is the framed copy
    "/embedded", // only the exact /embed/ segment is framable
    "/sakif/embed/intro",
    "/api/slots",
  ])("%s refuses every frame", (path) => {
    const h = headersFor(path);
    expect(h.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(h.get("x-frame-options")).toBe("DENY");
  });

  it.each(["/embed/sakifazwad18/intro", "/embed/a/b"])("%s may be framed by any site", (path) => {
    const h = headersFor(path);
    expect(h.get("content-security-policy")).toBe("frame-ancestors *");
    // Any X-Frame-Options value would block some site: DENY blocks all, SAMEORIGIN all but us.
    expect(h.has("x-frame-options")).toBe(false);
  });

  it.each(["/", "/dashboard", "/embed/a/b", "/embed.js"])("%s keeps the other headers", (path) => {
    const h = headersFor(path);
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("permissions-policy")).toContain("camera=()");
  });

  it("every path matches exactly one framing rule (rules can't remove a header, only add)", () => {
    for (const path of ["/", "/dashboard", "/embed/a/b", "/EMBED/a/b", "/embed.js"]) {
      const matching = SECURITY_HEADER_RULES.filter((r) => getPathMatch(r.source)(path) !== false);
      expect(matching, path).toHaveLength(1);
    }
  });
});
