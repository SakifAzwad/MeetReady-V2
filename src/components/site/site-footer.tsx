import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { REPO_URL, V1_URL } from "@/lib/site";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#faq", label: "FAQ" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    heading: "Project",
    links: [
      { href: REPO_URL, label: "Source code" },
      { href: `${REPO_URL}/tree/main/docs`, label: "Build notes, day by day" },
      { href: "/#under-the-hood", label: "Under the hood" },
      { href: V1_URL, label: "The original v1" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]">
        <div className="flex flex-col gap-3">
          <Logo className="text-lg" markClassName="size-6" />
          <p className="text-muted-foreground max-w-[36ch] text-sm leading-relaxed">
            A scheduling app that shows guests your working hours on their own day. Rebuilt solo by Sakif
            Azwad from a university team project.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <h2 className="text-sm font-semibold">{col.heading}</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  {l.href.startsWith("/") && !l.href.startsWith("/#") ? (
                    <Link
                      href={l.href}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {l.label}
                    </Link>
                  ) : (
                    <a
                      href={l.href}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="text-muted-foreground mx-auto max-w-6xl border-t px-5 py-5 text-xs sm:px-8">
        Made by Sakif Azwad in Chattogram. Times on this site are shown in your browser&apos;s timezone.
      </div>
    </footer>
  );
}
