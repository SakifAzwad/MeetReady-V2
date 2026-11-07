"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ViewTransition } from "react";
import { cn } from "@/lib/utils";

const LINKS = [
  // On phones the logo already goes home, so "Home" gives its room to the others.
  { href: "/dashboard", label: "Home", exact: true, wide: true },
  { href: "/dashboard/bookings", label: "Bookings" },
  { href: "/dashboard/event-types", label: "Event types" },
  { href: "/dashboard/availability", label: "Availability" },
] as const;

/**
 * Reads the URL to highlight the current page. On routes with a dynamic
 * segment (/dashboard/event-types/[id]/edit) the path isn't known when the
 * static shell is prerendered, so the layout renders this inside <Suspense>
 * with <NavLinks pathname={null} /> (same links, no highlight) as the fallback.
 */
export function DashboardNav() {
  return <NavLinks pathname={usePathname()} />;
}

export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Dashboard" className="flex items-center gap-1 text-sm">
      {LINKS.map((link) => {
        const active =
          pathname !== null &&
          (pathname === link.href || (!("exact" in link) && pathname.startsWith(`${link.href}/`)));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative isolate rounded-md px-2 py-1.5 whitespace-nowrap transition-colors sm:px-3",
              "wide" in link && "max-sm:hidden",
              active ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/*
             * The highlight is one shared element: it unmounts from the old
             * link and mounts in the new one with the same name, so the
             * browser animates it sliding across instead of blinking.
             */}
            {active && (
              <ViewTransition name="dashboard-nav-pill" share="morph" default="none">
                <span aria-hidden className="bg-accent absolute inset-0 -z-10 rounded-md" />
              </ViewTransition>
            )}
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
