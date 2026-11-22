"use client";

import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useSyncExternalStore } from "react";
import { THEME_COLORS, THEME_STORAGE_KEY, type Theme, isTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/*
 * The theme switcher's controls (Day 26, Part B), in three shapes: radio items
 * for the dashboard's account menu, three buttons for the landing page footer,
 * and an icon button with a small menu for public pages (booking, profile,
 * manage). All read and write one store, so two switchers on a page, or two
 * tabs, never disagree.
 */

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

const CHANGED = "meetready:theme";

function read(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system"; // storage blocked: follow the device
  }
}

/** Puts a choice on the page: the attribute the CSS reads, and the toolbar colour. */
function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // "system" goes back to what each tag's media query says.
    const dark = theme === "dark" || (theme === "system" && (meta.media ?? "").includes("dark"));
    meta.content = dark ? THEME_COLORS.dark : THEME_COLORS.light;
  }
}

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not saved, but still applied to this page.
  }
  apply(theme);
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  // Another tab changed it: follow, so tabs don't drift apart.
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY && e.key !== null) return;
    apply(read());
    onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", fromOtherTab);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", fromOtherTab);
  };
}

/**
 * The current choice. The server can't know it (it lives in the browser), so
 * the server render and hydration use "system", and React re-renders with the
 * stored value right after, without a hydration mismatch. Only which option is
 * marked can change; the colours were already right (the head script).
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "system");
}

/** Dashboard account menu: a labelled group of radio items. */
export function ThemeMenuItems({ itemClassName }: { itemClassName: string }) {
  const theme = useTheme();
  return (
    <>
      <DropdownMenu.Label className="text-muted-foreground px-2.5 pt-1.5 pb-1 text-xs font-medium">
        Theme
      </DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={theme} onValueChange={(v) => isTheme(v) && setTheme(v)}>
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenu.RadioItem
            key={value}
            value={value}
            className={itemClassName}
            // Stay open: the change is instant, so the host can try each one.
            onSelect={(e) => e.preventDefault()}
          >
            <Icon className="size-4" />
            {label}
            <DropdownMenu.ItemIndicator className="ml-auto size-1.5 rounded-full bg-current" />
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    </>
  );
}

/** Landing page footer: three small toggle buttons in a labelled group. */
export function ThemeButtons({ className }: { className?: string }) {
  const theme = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn("flex items-center gap-0.5 rounded-lg border p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className="text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors outline-none focus-visible:ring-[3px]"
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Public pages: one quiet icon button next to "Scheduling by MeetReady", with the three options. */
export function ThemeMenuButton() {
  const theme = useTheme();
  const current = OPTIONS.find((o) => o.value === theme)!;
  const item =
    "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[highlighted]:bg-accent";
  return (
    // Not modal: a three-option menu at the foot of the page shouldn't lock scrolling or hide the page.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        aria-label={`Theme: ${current.label}`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-8 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-[3px]"
      >
        <SunMoon className="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="center"
          sideOffset={6}
          className="bg-card text-card-foreground animate-in-down z-50 w-40 rounded-xl border p-1.5 shadow-[0_12px_40px_rgb(24_33_58/0.14)]"
        >
          <DropdownMenu.RadioGroup value={theme} onValueChange={(v) => isTheme(v) && setTheme(v)}>
            {OPTIONS.map(({ value, label, Icon }) => (
              <DropdownMenu.RadioItem key={value} value={value} className={item}>
                <Icon className="size-4" />
                {label}
                <DropdownMenu.ItemIndicator className="ml-auto size-1.5 rounded-full bg-current" />
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
