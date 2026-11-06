/**
 * Only allow redirects to paths on our own site.
 *
 * /login?next=/dashboard/events is convenient, but if `next` is used as-is,
 * /login?next=https://evil.example sends a freshly logged-in user to a
 * phishing page that looks like it came from us (an "open redirect").
 * "//evil.example" and "/\evil.example" are also treated as other sites by
 * browsers, so those are rejected too.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  try {
    // Resolve against a dummy origin: if the origin changes, it wasn't a local path.
    const url = new URL(next, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
