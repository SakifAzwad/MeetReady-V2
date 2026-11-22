"use client";

import { CodeXml, ExternalLink, X } from "lucide-react";
import { Dialog, Tabs } from "radix-ui";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { EMBED_THEMES, embedPath, embedSnippets, type EmbedTheme } from "@/lib/embed";
import { REPO_URL } from "@/lib/site";

/*
 * "Embed" on each event type card (Day 27): the two snippets for putting the
 * booking page on another website. Radix Dialog for the modal (focus trap,
 * Escape, focus back on the button, the page behind made inert) and Radix Tabs
 * for Inline / Popup (arrow keys between tabs, the panel labelled by its tab).
 * The snippets are built by src/lib/embed.ts, which a unit test pins down.
 */

const THEME_LABELS: Record<EmbedTheme, string> = {
  light: "Light",
  dark: "Dark",
  system: "Follow the device",
};

const tab =
  "text-muted-foreground hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground focus-visible:ring-ring/50 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] data-[state=active]:shadow-xs";

export function EmbedDialog({
  origin,
  username,
  slug,
  title,
  isActive,
}: {
  /** The app's own address (from the server's env), so snippets point at this deployment. */
  origin: string;
  username: string;
  slug: string;
  title: string;
  isActive: boolean;
}) {
  const [theme, setTheme] = useState<EmbedTheme>("light");
  const snippets = embedSnippets(origin, username, slug, theme);

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <CodeXml /> Embed<span className="sr-only"> {title} on your website</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[rgb(15_20_36/0.55)]" />
        <Dialog.Content className="bg-card text-card-foreground animate-in-down fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-2xl border p-6 shadow-[0_12px_40px_rgb(24_33_58/0.2)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Dialog.Title className="text-xl font-bold">Put {title} on your website</Dialog.Title>
              <Dialog.Description className="text-muted-foreground text-sm">
                Paste this into your site&apos;s HTML. Guests pick a time and book without leaving your page.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="sm" aria-label="Close">
                <X />
              </Button>
            </Dialog.Close>
          </div>

          {!isActive && (
            <p className="bg-muted rounded-md px-3 py-2 text-sm">
              This event type is off, so the widget shows &quot;not found&quot; until you turn it on.
            </p>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Theme</legend>
            <div className="flex w-fit flex-wrap items-center gap-0.5 rounded-lg border p-0.5">
              {EMBED_THEMES.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                  className="text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground focus-visible:ring-ring/50 rounded-md px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px]"
                >
                  {THEME_LABELS[value]}
                </button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Pick what matches your site. &quot;Follow the device&quot; suits sites that switch to dark with
              the device.
            </p>
          </fieldset>

          <Tabs.Root defaultValue="inline" className="flex flex-col gap-3">
            <Tabs.List aria-label="How it appears" className="bg-muted flex w-fit gap-1 rounded-lg p-1">
              <Tabs.Trigger value="inline" className={tab}>
                Inline
              </Tabs.Trigger>
              <Tabs.Trigger value="popup" className={tab}>
                Popup
              </Tabs.Trigger>
            </Tabs.List>
            <Snippet
              value="inline"
              code={snippets.inline}
              note="The calendar sits in your page where you put the first line, and grows to fit."
            />
            <Snippet
              value="popup"
              code={snippets.popup}
              note="A link that opens the calendar over your page. Change its text, or put the two data- attributes on your own button or link. If the script can't load, the link still opens your booking page."
            />
          </Tabs.Root>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <a
              href={embedPath(username, slug, theme)}
              target="_blank"
              rel="noopener"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 underline underline-offset-4"
            >
              See it on its own <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <a
              href={`${REPO_URL}/blob/main/docs/embed.md`}
              target="_blank"
              rel="noopener"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 underline underline-offset-4"
            >
              Booking events and other options <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Snippet({ value, code, note }: { value: string; code: string; note: string }) {
  return (
    <Tabs.Content value={value} className="flex flex-col gap-3 outline-none">
      <p className="text-muted-foreground text-sm">{note}</p>
      {/* A labelled, focusable region: keyboard users can scroll a long line sideways. */}
      <pre
        tabIndex={0}
        aria-label="Embed code"
        className="bg-muted focus-visible:ring-ring/50 overflow-x-auto rounded-lg border p-4 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-[3px]"
      >
        <code>{code}</code>
      </pre>
      <CopyButton text={code} label="Copy code" className="self-start" />
    </Tabs.Content>
  );
}
