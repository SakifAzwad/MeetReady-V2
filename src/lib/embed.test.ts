import { describe, expect, it } from "vitest";
import { embedMessage, embedPath, embedSnippets } from "./embed";

describe("embedSnippets (Day 27)", () => {
  const origin = "https://meetreadyv2.vercel.app";

  it("inline: the element, then the script from this deployment", () => {
    expect(embedSnippets(origin, "sakif", "intro").inline).toBe(
      '<div data-meetready-inline="sakif/intro"></div>\n' +
        '<script src="https://meetreadyv2.vercel.app/embed.js" async></script>',
    );
  });

  it("popup: a real link to the booking page, so it still works when the script doesn't load", () => {
    expect(embedSnippets(origin, "sakif", "intro").popup).toBe(
      '<a href="https://meetreadyv2.vercel.app/sakif/intro" data-meetready-popup="sakif/intro">Book a meeting</a>\n' +
        '<script src="https://meetreadyv2.vercel.app/embed.js" async></script>',
    );
  });

  it("adds a theme attribute only when it isn't the default", () => {
    const dark = embedSnippets(origin, "sakif", "intro", "dark");
    expect(dark.inline).toContain('data-meetready-inline="sakif/intro" data-meetready-theme="dark"');
    expect(dark.popup).toContain('data-meetready-theme="dark"');
    expect(embedSnippets(origin, "sakif", "intro", "light").inline).not.toContain("theme");
  });
});

describe("embedPath", () => {
  it("is /embed/{username}/{slug}, with ?theme= only when not light", () => {
    expect(embedPath("sakif", "intro")).toBe("/embed/sakif/intro");
    expect(embedPath("sakif", "intro", "system")).toBe("/embed/sakif/intro?theme=system");
  });
});

describe("embedMessage", () => {
  it("stamps every message with the source and version embed.js checks", () => {
    expect(embedMessage({ type: "resize", height: 500 })).toEqual({
      source: "meetready",
      version: 1,
      type: "resize",
      height: 500,
    });
  });
});
