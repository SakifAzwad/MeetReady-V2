import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names, letting later Tailwind classes win over earlier ones.
 * `cn("px-4", props.className)` with className="px-2" gives "px-2", not both.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
