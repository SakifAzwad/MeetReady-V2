import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { ThemeMenuButton } from "@/components/theme/theme-controls";

/**
 * Small credit under public pages (booking page, host profile, a guest's booking): where guests can
 * find out what this is. The theme button sits beside it (Day 26): quiet, but there on every page a
 * guest sees, with no account needed.
 */
export function PoweredBy() {
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 rounded-md text-sm transition-colors"
      >
        <LogoMark className="size-5" />
        Scheduling by MeetReady
      </Link>
      <span aria-hidden className="bg-border h-4 w-px" />
      <ThemeMenuButton />
    </div>
  );
}
