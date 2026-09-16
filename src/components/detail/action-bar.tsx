"use client";

import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * Bottom padding a page owes its own content when it mounts a
 * `DetailActionBar` — the bar floats, so nothing reserves its height. Sized to
 * the 48px keys plus the 1.4rem they ride above the nav island.
 */
export const ACTION_BAR_PAGE_PAD = "pb-[5.5rem] md:pb-6";

/**
 * The phone's one-line answer to "so what do I do here": the page's primary
 * yellow key plus a single outline key, floating above the nav island (which is
 * `z-40`, so this sits just under it) and inset to the same `--chrome-gutter`
 * as the rest of the floating chrome. Desktop has no bar — the primary key
 * lives inside the wash panel there.
 */
export function DetailActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-(--chrome-gutter) z-30 flex items-stretch gap-2 [&>*]:pointer-events-auto md:hidden",
        className,
      )}
      style={{ bottom: "calc(var(--safe-bottom) + var(--bottom-nav-height) + 1.4rem)" }}
    >
      {children}
    </div>
  );
}
