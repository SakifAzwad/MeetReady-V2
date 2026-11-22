/*
 * The embeddable booking widget (Day 27): the messages the framed page sends
 * to the site around it. The other half is public/embed.js, plain JavaScript
 * that runs on other people's sites, so it can't import this file: keep the
 * two in step. e2e/embed.spec.ts runs them together in a real browser.
 *
 *   { source: "meetready", version: 1, type: "resize", height }
 *   { source: "meetready", version: 1, type: "booked", username, slug, startsAt, endsAt }
 *   { source: "meetready", version: 1, type: "escape" }
 *
 * Why "escape": a popup is a <dialog> on the site's page, and the browser
 * closes it on Escape, but key presses inside an iframe go to the iframe's own
 * document and never reach the page around it. So the frame passes on an
 * Escape that nothing inside used (the timezone list and the assistant's box
 * handle their own, with preventDefault), and embed.js closes the popup.
 *
 * Nothing in a message is private: any site may embed any host's page, so the
 * page around the frame is not necessarily the host's. A message never carries
 * the guest's name, email or answers (the host gets those by email, webhook or
 * dashboard). That's also why sending to targetOrigin "*" is acceptable: the
 * frame can't know which site it's in (Firefox has no ancestorOrigins), and
 * there's nothing in the message worth restricting.
 */

export const EMBED_MESSAGE_SOURCE = "meetready";
export const EMBED_MESSAGE_VERSION = 1;

export type EmbedMessage =
  | { source: typeof EMBED_MESSAGE_SOURCE; version: 1; type: "resize"; height: number }
  | {
      source: typeof EMBED_MESSAGE_SOURCE;
      version: 1;
      type: "booked";
      username: string;
      slug: string;
      startsAt: string;
      endsAt: string;
    }
  | { source: typeof EMBED_MESSAGE_SOURCE; version: 1; type: "escape" };

type Body<T> = T extends unknown ? Omit<T, "source" | "version"> : never;

export function embedMessage(body: Body<EmbedMessage>): EmbedMessage {
  return { source: EMBED_MESSAGE_SOURCE, version: EMBED_MESSAGE_VERSION, ...body } as EmbedMessage;
}

/** The embed page's address for a username/slug, with the theme only when it isn't the default. */
export function embedPath(username: string, slug: string, theme: EmbedTheme = "light"): string {
  const path = `/embed/${username}/${slug}`;
  return theme === "light" ? path : `${path}?theme=${theme}`;
}

export const EMBED_THEMES = ["light", "dark", "system"] as const;
export type EmbedTheme = (typeof EMBED_THEMES)[number];

/** The snippets the dashboard's Embed dialog offers to copy. `origin` = the app's own address. */
export function embedSnippets(origin: string, username: string, slug: string, theme: EmbedTheme = "light") {
  const target = `${username}/${slug}`;
  // Only a non-default theme gets an attribute: the snippet stays as short as it can be.
  const themeAttr = theme === "light" ? "" : ` data-meetready-theme="${theme}"`;
  const script = `<script src="${origin}/embed.js" async></script>`;
  return {
    inline: `<div data-meetready-inline="${target}"${themeAttr}></div>\n${script}`,
    // A real link: before the script loads, or if it's blocked, the click opens the booking page.
    popup: `<a href="${origin}/${target}" data-meetready-popup="${target}"${themeAttr}>Book a meeting</a>\n${script}`,
  };
}
