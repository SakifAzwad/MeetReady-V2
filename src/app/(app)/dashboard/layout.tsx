import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { requireOnboardedUser } from "@/server/auth/session";
import { AccountMenu } from "./account-menu";
import { DashboardNav, NavLinks } from "./dashboard-nav";

/*
 * Static shell: the header and nav render instantly; only the account menu
 * reads the session (inside <Suspense>). Next.js docs: layouts don't re-run on
 * client navigation, so an auth check here wouldn't protect child pages
 * anyway. Each page does its own requireOnboardedUser().
 *
 * The header has a view-transition name so it stays still while page
 * content transitions underneath it.
 */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header
        className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md"
        style={{ viewTransitionName: "app-header" }}
      >
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link href="/dashboard" aria-label="Dashboard home" className="shrink-0 rounded-md">
            <Logo morph wordmarkClassName="max-sm:sr-only" />
          </Link>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Suspense fallback={<NavLinks pathname={null} />}>
              <DashboardNav />
            </Suspense>
          </div>
          <Suspense fallback={<div className="bg-muted size-9 shrink-0 rounded-full" />}>
            <Account />
          </Suspense>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</div>
    </div>
  );
}

async function Account() {
  const user = await requireOnboardedUser();
  return (
    <AccountMenu
      name={user.name}
      email={user.email}
      image={user.image ?? null}
      bookingPath={`/${user.username}`}
    />
  );
}
