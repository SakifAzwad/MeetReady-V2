"use client";

import { CopyButton } from "@/components/copy-button";

export function CopyLinkButton({ url }: { url: string }) {
  return <CopyButton text={url} label="Copy link" variant="default" />;
}
