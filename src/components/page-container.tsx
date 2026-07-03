import * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The standard centered page column: `mx-auto w-full max-w-6xl px-4`. Extracted
 * so route-level content that isn't a full-bleed board (which own their own
 * sticky bars and edge-to-edge padding) has one place to declare its width and
 * horizontal padding instead of hand-rolling the same wrapper per route.
 *
 * Pass vertical rhythm (`py-*`, `space-y-*`, `gap-*`) via `className`; the base
 * only owns centering, max-width, and side padding.
 */
export function PageContainer({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4", className)} {...props} />;
}
