"use client";

import type * as React from "react";
import { NativeSelect } from "@/components/ui/input";
import { formatWallTime, QUARTER_HOURS } from "@/lib/format";

const START_TIMES = QUARTER_HOURS.slice(0, -1); // a range can't start at 24:00
const END_TIMES = QUARTER_HOURS.slice(1); // or end at 00:00

/** 15-minute steps. A native <time> input can't express "24:00" (end of day), a <select> can. */
export function TimeSelect({ kind, ...props }: { kind: "start" | "end" } & React.ComponentProps<"select">) {
  return (
    <NativeSelect className="w-32 sm:w-36" {...props}>
      {(kind === "start" ? START_TIMES : END_TIMES).map((t) => (
        <option key={t} value={t}>
          {t === "24:00" ? "12:00am (midnight)" : formatWallTime(t)}
        </option>
      ))}
    </NativeSelect>
  );
}
