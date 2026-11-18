"use client";

import { CopyButton } from "@/components/copy-button";

export function CopyLinkButton({ url, label = "Copy link" }: { url: string; label?: string }) {
  return <CopyButton text={url} label={label} variant="default" />;
}
