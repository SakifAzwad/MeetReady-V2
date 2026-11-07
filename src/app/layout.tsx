import type { Metadata, Viewport } from "next";
// Self-hosted variable fonts from npm: no request to Google at build or run time.
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/figtree";
import "./globals.css";
import { env } from "@/lib/env";

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
    { media: "(prefers-color-scheme: light)", color: "#f5f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1424" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
