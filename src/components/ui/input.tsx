import type * as React from "react";
import { cn } from "@/lib/utils";

const fieldBase =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldBase, "h-9 py-1", className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldBase, "min-h-20 py-2", className)} {...props} />;
}

/**
 * A styled native <select>. Native selects are keyboard- and screen-reader-
 * accessible for free and use the phone's own picker on mobile, which matters
 * for long lists like timezones. A custom Radix Select can come later if needed.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn(fieldBase, "h-9 py-1 pr-8", className)} {...props} />;
}

export { Input, NativeSelect, Textarea };
