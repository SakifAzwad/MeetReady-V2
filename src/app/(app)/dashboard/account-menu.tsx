"use client";

import { ExternalLink, LogOut, Settings2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { authClient } from "@/lib/auth-client";

/*
 * Avatar button + menu. Radix DropdownMenu gives the accessibility for free:
 * the button announces it opens a menu, arrow keys move between items,
 * Escape closes and returns focus to the button, typing a letter jumps.
 */
export function AccountMenu({
  name,
  email,
  image,
  bookingPath,
}: {
  name: string;
  email: string;
  image: string | null;
  bookingPath: string;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut(); // deletes the session row and clears the cookie
    router.replace("/login");
    router.refresh(); // drop any server-rendered data cached for the logged-in user
  }

  const item =
    "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[highlighted]:bg-accent data-[disabled]:opacity-50";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Account menu for ${name}`}
        className="focus-visible:ring-ring/50 rounded-full transition-transform outline-none focus-visible:ring-[3px] active:scale-95"
      >
        <UserAvatar name={name} image={image} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="bg-card text-card-foreground animate-in-down z-50 w-64 rounded-xl border p-1.5 shadow-[0_12px_40px_rgb(24_33_58/0.14)]"
        >
          <div className="flex items-center gap-3 px-2.5 py-2">
            <UserAvatar name={name} image={image} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-muted-foreground truncate text-xs">{email}</p>
            </div>
          </div>
          <DropdownMenu.Separator className="bg-border my-1 h-px" />
          <DropdownMenu.Item asChild className={item}>
            <Link href={bookingPath} target="_blank">
              <ExternalLink className="size-4" />
              View your booking page
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}>
            <Link href="/dashboard/availability">
              <Settings2 className="size-4" />
              Hours and timezone
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="bg-border my-1 h-px" />
          <DropdownMenu.Item
            className={item}
            disabled={signingOut}
            onSelect={(e) => {
              e.preventDefault(); // keep the menu open to show "Signing out…"
              void signOut();
            }}
          >
            <LogOut className="size-4" />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
