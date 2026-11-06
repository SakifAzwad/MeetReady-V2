"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
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
      {LINKS.map(({ href, label }) => {
        const active = pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-3 py-1.5 whitespace-nowrap transition-colors",
              active && "bg-accent text-foreground font-medium",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
