"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#under-the-hood", label: "Under the hood" },
  { href: "/#faq", label: "FAQ" },
];

/*
 * Public header (landing page and other signed-out pages). Sticky, so the
 * way to sign up is always one click away on a long page.
 *
 * Mobile menu: a plain disclosure (button with aria-expanded + aria-controls
 * toggling a panel), not a dialog: it pushes content down rather than
 * covering it, so there's no focus to trap. Escape closes it.
 */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md"
      style={{ viewTransitionName: "site-header" }}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Link href="/" aria-label="MeetReady home" className="rounded-md">
          <Logo morph />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:bg-accent rounded-md px-3 py-2 transition-colors">
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <a href={REPO_URL} className="hover:bg-accent rounded-md px-3 py-2 text-sm transition-colors">
            GitHub
          </a>
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/login">Get started</Link>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="ml-auto md:hidden"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </div>

      <div
        id={panelId}
        hidden={!open}
        className={cn("bg-background border-t md:hidden", open && "animate-in-down")}
      >
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-col px-5 py-3">
          {[...LINKS, { href: REPO_URL, label: "GitHub" }].map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="hover:bg-accent -mx-2 rounded-md px-2 py-3 text-base"
            >
              {l.label}
            </a>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-4">
            <Button asChild variant="outline">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild>
              <Link href="/login">Get started</Link>
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
