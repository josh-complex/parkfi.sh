"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "#/lib/utils.ts";

/**
 * Marketing-page motion primitives.
 *
 * The rule this file encodes: **foreground product UI is never animated into
 * illegibility.** `Reveal` only slides/fades content in *once* on scroll and then
 * leaves it fully opaque and crisp. All the "atmosphere" — drifting, blurred,
 * dimmed decoration — is confined to `AmbientLayer`/`Drift`, which are
 * `aria-hidden`, `pointer-events-none`, and sit *behind* the real components.
 * Everything degrades to a static render under `prefers-reduced-motion`.
 */

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * One-shot entrance for below-the-fold content. Ends fully opaque — this is a
 * reveal, not a permanent fade. Static under reduced motion.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 18,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: "div" | "section" | "li";
}) {
  const reduce = useReducedMotion();
  if (reduce) return <Tag className={className}>{children}</Tag>;

  const MotionTag = motion[Tag];
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.55, ease: EASE_OUT, delay }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * A decorative backdrop well. Its contents are always dimmed and blurred (the
 * "enhancing background graphics"), never the real product cards layered on top
 * of it. Absolutely fills its positioned parent and clips overflow so drifting
 * children never spill into neighbouring sections.
 */
export function AmbientLayer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}
    >
      {children}
    </div>
  );
}

/**
 * A gentle, permanent up-and-down sway for a *foreground* element (unlike
 * `Drift`, this is meant for crisp, fully-visible content — e.g. the achievement
 * toasts bobbing in place). Static under reduced motion.
 */
export function Sway({
  children,
  className,
  amplitude = 6,
  duration = 4,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  amplitude?: number;
  duration?: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      animate={{ y: [0, -amplitude, 0] }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A single slowly-drifting decorative element for use inside `AmbientLayer`.
 * Loops a gentle translate/scale forever; renders static under reduced motion.
 * Pair with dim/blur utility classes on `className` — the drift is the motion,
 * the fade is the styling.
 */
export function Drift({
  children,
  className,
  x = 0,
  y = 0,
  scale,
  duration = 20,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  x?: number;
  y?: number;
  scale?: number;
  duration?: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      animate={{
        x: [0, x, 0],
        y: [0, y, 0],
        ...(scale != null ? { scale: [1, scale, 1] } : {}),
      }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}
