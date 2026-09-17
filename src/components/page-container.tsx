import * as React from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The app's one content column: centered, capped at `100rem`, with the page
 * gutter (`px-4`, widening to `px-6` from `lg`).
 *
 * One number on purpose (2026-09-15, Josh): the boards were laid out at
 * `100rem` while detail pages ran at `4xl`/`5xl`/`6xl`, so a hop from a list to
 * the thing it listed moved every edge on the page. Boards, detail pages and
 * the site footer all measure themselves against this now. The masthead keeps
 * its own narrower `max-w-6xl` row — a centered wordmark flanked by links reads
 * as a masthead at that width and as a spread-out toolbar at this one.
 */
export const PAGE_WIDTH = "mx-auto w-full max-w-480 px-4 lg:px-6";

/**
 * `PAGE_WIDTH` as a component, for route-level content that isn't a full-bleed
 * board (boards own their own sticky bars and edge-to-edge padding).
 *
 * Pass vertical rhythm (`py-*`, `space-y-*`, `gap-*`) via `className`; the base
 * only owns centering, max-width, and side padding.
 */
export function PageContainer({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn(PAGE_WIDTH, className)} {...props} />;
}
