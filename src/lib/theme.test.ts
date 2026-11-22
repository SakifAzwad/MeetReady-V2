import { describe, expect, it } from "vitest";
import { THEME_COLORS, THEME_SCRIPT, THEME_STORAGE_KEY, isTheme } from "./theme";

/*
 * The head script is a string, so the type checker never sees it. These tests
 * run it against a fake page: it must parse, apply only a valid saved choice,
 * and never throw (a throw in <head> would be the user's problem, not ours).
 */
function runScript(stored: string | null | Error, url = "/") {
  const { pathname, search } = new URL(url, "https://meetready.test");
  const location = { pathname, search };
  let storageRead = false;
  const attributes: Record<string, string> = {};
  const metas = [{ content: "unchanged", setAttribute: (_: string, v: string) => (metas[0]!.content = v) }];
  let onLoaded: (() => void) | undefined;
  const localStorage = {
    getItem: (key: string) => {
      storageRead = true;
      if (stored instanceof Error) throw stored;
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => (attributes[k] = v) },
    addEventListener: (_: string, fn: () => void) => (onLoaded = fn),
    querySelectorAll: () => metas,
  };
  new Function("localStorage", "document", "location", THEME_SCRIPT)(localStorage, document, location);
  onLoaded?.();
  return { theme: attributes["data-theme"], themeColor: metas[0]!.content, storageRead };
}

describe("THEME_SCRIPT", () => {
  it("applies a saved dark or light choice, and the toolbar colour with it", () => {
    expect(runScript("dark")).toMatchObject({ theme: "dark", themeColor: THEME_COLORS.dark });
    expect(runScript("light")).toMatchObject({ theme: "light", themeColor: THEME_COLORS.light });
  });

  it("leaves the page to the device when nothing (or nonsense) is saved", () => {
    expect(runScript(null)).toMatchObject({ theme: undefined, themeColor: "unchanged" });
    expect(runScript("system")).toMatchObject({ theme: undefined, themeColor: "unchanged" });
    expect(runScript('"><script>')).toMatchObject({ theme: undefined, themeColor: "unchanged" });
  });

  it("never throws, even when storage is blocked", () => {
    expect(runScript(new Error("SecurityError"))).toMatchObject({
      theme: undefined,
      themeColor: "unchanged",
    });
  });

  describe("on the embed (Day 27)", () => {
    const embed = "/embed/sakif/intro";

    it("is light unless the URL says otherwise, whatever the guest saved", () => {
      expect(runScript("dark", embed)).toMatchObject({ theme: "light" });
      expect(runScript(null, `${embed}?theme=nonsense`)).toMatchObject({ theme: "light" });
    });

    it("takes dark or system from the URL", () => {
      expect(runScript(null, `${embed}?theme=dark`)).toMatchObject({ theme: "dark" });
      expect(runScript("light", `${embed}?x=1&theme=dark`)).toMatchObject({ theme: "dark" });
      // system = no attribute: the CSS follows the device
      expect(runScript("dark", `${embed}?theme=system`)).toMatchObject({ theme: undefined });
      // a value that only starts with "dark" isn't dark
      expect(runScript(null, `${embed}?theme=darker`)).toMatchObject({ theme: "light" });
    });

    it("never reads storage (the site owner chooses, not a stored guest choice)", () => {
      expect(runScript("dark", `${embed}?theme=dark`).storageRead).toBe(false);
      expect(runScript(new Error("SecurityError"), embed)).toMatchObject({ theme: "light" });
    });

    it("only on /embed/: the normal booking page still uses the saved choice", () => {
      expect(runScript("dark", "/sakif/intro?theme=light")).toMatchObject({
        theme: "dark",
        storageRead: true,
      });
      expect(runScript("dark", "/embedded?theme=light")).toMatchObject({ theme: "dark" });
    });
  });
});

describe("isTheme", () => {
  it("accepts only the three choices", () => {
    expect(["system", "light", "dark"].every(isTheme)).toBe(true);
    expect([null, "", "Dark", "blue", 1].some(isTheme)).toBe(false);
  });
});
