import { describe, expect, it } from "vitest";
import { THEME_COLORS, THEME_SCRIPT, THEME_STORAGE_KEY, isTheme } from "./theme";

/*
 * The head script is a string, so the type checker never sees it. These tests
 * run it against a fake page: it must parse, apply only a valid saved choice,
 * and never throw (a throw in <head> would be the user's problem, not ours).
 */
function runScript(stored: string | null | Error) {
  const attributes: Record<string, string> = {};
  const metas = [{ content: "unchanged", setAttribute: (_: string, v: string) => (metas[0]!.content = v) }];
  let onLoaded: (() => void) | undefined;
  const localStorage = {
    getItem: (key: string) => {
      if (stored instanceof Error) throw stored;
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) },
    addEventListener: (_: string, fn: () => void) => (onLoaded = fn),
    querySelectorAll: () => metas,
  };
  new Function("localStorage", "document", THEME_SCRIPT)(localStorage, document);
  onLoaded?.();
  return { theme: attributes["data-theme"], themeColor: metas[0]!.content };
}

describe("THEME_SCRIPT", () => {
  it("applies a saved dark or light choice, and the toolbar colour with it", () => {
    expect(runScript("dark")).toEqual({ theme: "dark", themeColor: THEME_COLORS.dark });
    expect(runScript("light")).toEqual({ theme: "light", themeColor: THEME_COLORS.light });
  });

  it("leaves the page to the device when nothing (or nonsense) is saved", () => {
    expect(runScript(null)).toEqual({ theme: undefined, themeColor: "unchanged" });
    expect(runScript("system")).toEqual({ theme: undefined, themeColor: "unchanged" });
    expect(runScript('"><script>')).toEqual({ theme: undefined, themeColor: "unchanged" });
  });

  it("never throws, even when storage is blocked", () => {
    expect(runScript(new Error("SecurityError"))).toEqual({ theme: undefined, themeColor: "unchanged" });
  });
});

describe("isTheme", () => {
  it("accepts only the three choices", () => {
    expect(["system", "light", "dark"].every(isTheme)).toBe(true);
    expect([null, "", "Dark", "blue", 1].some(isTheme)).toBe(false);
  });
});
