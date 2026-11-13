import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ROUTES } from "./app-routes";
import { RESERVED_USERNAMES } from "./validation/onboarding";

/*
 * Usernames are top-level URLs (/sakif), so every top-level route the app has
 * must be known to proxy.ts (or it's looked up as a username and answers 404)
 * and reserved as a username (or someone can take it). This reads the real
 * src/app folder, so a new route can't be forgotten in either list.
 */

const APP_DIR = path.join(process.cwd(), "src/app");

/** Top-level URL segments: folders, with route groups like (app) opened up. Skips [username], _private and files. */
function topLevelRoutes(dir = APP_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      if (e.name.startsWith("(") && e.name.endsWith(")")) return topLevelRoutes(path.join(dir, e.name));
      if (e.name.startsWith("[") || e.name.startsWith("_")) return [];
      return [e.name];
    });
}

describe("top-level routes vs usernames", () => {
  const routes = topLevelRoutes();

  it("finds the routes (the test isn't silently reading an empty folder)", () => {
    expect(routes).toEqual(expect.arrayContaining(["dashboard", "login", "api", "privacy", "terms"]));
  });

  it.each(routes)("/%s skips proxy's username lookup", (route) => {
    expect(APP_ROUTES.has(route)).toBe(true);
  });

  it.each(routes)("/%s can't be taken as a username", (route) => {
    expect(RESERVED_USERNAMES.has(route)).toBe(true);
  });
});
