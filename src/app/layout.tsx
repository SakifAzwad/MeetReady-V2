import type { Metadata } from "next";
// Self-hosted variable fonts from npm: no request to Google at build or run time.
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/figtree";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeetReady",
  description: "Book meetings across timezones without the maths.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
