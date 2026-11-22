import type { Metadata, Viewport } from "next";
// Self-hosted variable fonts from npm: no request to Google at build or run time.
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/figtree";
import "./globals.css";
import { env } from "@/lib/env";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme";

/*
 * Icons and the link preview come from files next to this layout, by Next.js
 * convention: icon.svg, favicon.ico, apple-icon.png, opengraph-image.png and
 * twitter-image.png. metadataBase turns their paths into the absolute URLs
 * that link previews (Slack, LinkedIn, X) require.
 */
export const metadata: Metadata = {
  metadataBase: new URL(env.BETTER_AUTH_URL),
  title: { default: "MeetReady: meetings across timezones", template: "%s – MeetReady" },
  description:
    "Share one link. Guests see your working hours laid over their own day, pick a time, and you each get it on your own clock.",
  applicationName: "MeetReady",
  openGraph: { type: "website", siteName: "MeetReady" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    // The device's choice; a saved theme overrides both tags (src/lib/theme.ts).
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the head script may add data-theme before React hydrates.
    // It applies to this element's own attributes only, not to anything inside it.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Before the body is parsed, so a saved theme is there for the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
