import type { ReactNode } from "react";
import { PageTransition } from "@/components/motion";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { POLICIES_UPDATED } from "@/lib/site";

/*
 * Layout for the privacy policy and the terms: plain reading pages, the
 * same header and footer as the landing page, a measure that's easy to read.
 */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <PageTransition>
        <main className="mx-auto w-full max-w-3xl flex-1 px-5 pt-12 pb-20 sm:px-8 sm:pt-16">
          <h1 className="text-4xl font-bold">{title}</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated {POLICIES_UPDATED}</p>
          <div className="mt-6 text-lg leading-relaxed">{intro}</div>
          <div className="mt-10 flex flex-col gap-10">{children}</div>
        </main>
      </PageTransition>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="text-muted-foreground [&_a]:text-primary [&_strong]:text-foreground flex flex-col gap-3 leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-medium [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </section>
  );
}
