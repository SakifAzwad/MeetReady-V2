import Link from "next/link";
import { Suspense } from "react";
import { DashboardNav, NavLinks } from "./dashboard-nav";
import { SignOutButton } from "./sign-out-button";

/*
 * Static shell: no session read here. Next.js docs: layouts don't re-run on
 * client navigation, so an auth check here wouldn't protect child pages
 * anyway. Each page does its own requireOnboardedUser() inside <Suspense>.
 */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
          <Link href="/dashboard" className="hidden font-semibold tracking-tight sm:block">
            MeetReady
          </Link>
          <Suspense fallback={<NavLinks pathname={null} />}>
            <DashboardNav />
          </Suspense>
          <div className="ml-auto">
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</div>
    </div>
  );
}
