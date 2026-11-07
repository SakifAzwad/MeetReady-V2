"use client";

import { Avatar } from "radix-ui";
import { cn } from "@/lib/utils";

/** Google profile photo, or the first letter if there's none or it fails to load. */
export function UserAvatar({
  name,
  image,
  className,
}: {
  name: string;
  image: string | null;
  className?: string;
}) {
  return (
    <Avatar.Root
      className={cn(
        "bg-night grid size-9 shrink-0 place-items-center overflow-hidden rounded-full",
        className,
      )}
    >
      {image && (
        // no-referrer: Google's avatar host can refuse requests that carry another site as referrer.
        <Avatar.Image src={image} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      )}
      <Avatar.Fallback className="font-display text-sm font-bold text-white">
        {name.charAt(0)}
      </Avatar.Fallback>
    </Avatar.Root>
  );
}
