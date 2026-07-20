/**
 * A glossy metal medallion — the tier coins on the /activity recap. Metal band
 * comes from {@link tierMetal}; `muted` renders the neutral "+N" overflow coin
 * that reads against the current phase body. Visuals live in `.coin*` (styles.css).
 */
import type { TierMetal } from "#/lib/achievements.ts";
import { cn } from "#/lib/utils.ts";

export function MetalCoin({
  metal,
  size = 44,
  className,
  children,
}: {
  metal: TierMetal | "muted" | null;
  /** Diameter in px; font scales with it. */
  size?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const variant = metal == null || metal === "muted" ? "coin--muted" : `coin--${metal}`;
  return (
    <span
      className={cn("coin", variant, className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {children}
    </span>
  );
}
