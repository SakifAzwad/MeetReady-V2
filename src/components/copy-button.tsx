"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Copy with feedback you can't miss: the button fills navy, says "Copied to
 * clipboard" with a tick and a small pop for 2 seconds. Navy, not green:
 * colour in this design means time of day. Screen readers hear it through a
 * separate status line (aria-live on the button itself isn't reliably read).
 */
export function CopyButton({
  text,
  label,
  variant = "outline",
  className,
}: {
  text: string;
  label: string;
  variant?: "outline" | "default";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions, insecure context): the text is on screen to copy by hand.
      setFailed(true);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={copied ? "default" : variant}
        onClick={copy}
        className={cn(copied && "animate-pop", className)}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied to clipboard" : label}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Copied to clipboard" : failed ? "Couldn't copy. Select the text and copy it by hand." : ""}
      </span>
    </>
  );
}
