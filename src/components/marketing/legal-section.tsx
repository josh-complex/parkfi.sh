import type { ReactNode } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * One section of a long prose page — privacy, disclaimers, contact, account
 * deletion. Four copies of this lived in those four routes, each with an
 * 18px `font-semibold` heading that matched nothing else in the app.
 *
 * It is set in the detail pages' band voice instead (extrabold, tight
 * tracking), with a hairline rule between sections so a 400-line legal page
 * reads as a document with parts rather than one grey slab. The first section
 * drops its rule — it sits straight under the masthead's tear.
 */
export function LegalSection({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-2.5 border-t border-card-edge pt-7 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <h2 className="text-[19px] font-extrabold tracking-[-0.01em] text-balance md:text-xl">
        {title}
      </h2>
      <div className="flex flex-col gap-2.5 text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

/**
 * The lead paragraph a prose page opens on, above its first section: the page's
 * own summary, set a step up from the body so it reads as the answer and the
 * sections as the detail.
 */
export function LegalLede({ children }: { children: ReactNode }) {
  return <p className="text-base leading-relaxed text-muted-foreground">{children}</p>;
}
