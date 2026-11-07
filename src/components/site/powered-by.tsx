import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

/** Small credit under public pages (booking page, host profile): where guests can find out what this is. */
export function PoweredBy() {
  return (
    <Link
      href="/"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 rounded-md text-sm transition-colors"
    >
      <LogoMark className="size-5" />
      Scheduling by MeetReady
    </Link>
  );
}
