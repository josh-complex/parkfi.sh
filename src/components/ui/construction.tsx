"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

import { cn } from "#/lib/utils.ts";

export interface ConstructionIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ConstructionIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const ConstructionIcon = forwardRef<ConstructionIconHandle, ConstructionIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;
      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          void controls.start("animate");
        }
      },
      [controls, onMouseEnter],
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          void controls.start("normal");
        }
      },
      [controls, onMouseLeave],
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <motion.pattern
              animate={controls}
              height="14"
              id="stripes"
              initial="normal"
              patternUnits="userSpaceOnUse"
              variants={{
                normal: {
                  x: 0,
                },
                animate: {
                  x: [0, 6],
                  transition: {
                    duration: 1,
                    ease: "linear",
                    repeat: Number.POSITIVE_INFINITY,
                    repeatType: "loop",
                  },
                },
              }}
              width="6"
            >
              <path d="M-4 -2 L14 30" stroke="currentColor" strokeWidth="2" />
            </motion.pattern>
          </defs>
          <rect fill="url(#stripes)" height="8" rx="1" width="20" x="2" y="6" />
          <path d="M17 14v7" />
          <path d="M7 14v7" />
          <path d="M17 3v3" />
          <path d="M7 3v3" />
        </svg>
      </div>
    );
  },
);

ConstructionIcon.displayName = "ConstructionIcon";

/**
 * Friendly "work in progress" placeholder. Used in place of stark "no data"
 * states so empty panels read as "we're still building this" rather than as an
 * error. The barrier stripes animate on mount.
 */
function ConstructionState({
  title = "Under construction",
  description,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  className?: string;
}) {
  const iconRef = useRef<ConstructionIconHandle>(null);
  useEffect(() => {
    iconRef.current?.startAnimation();
  }, []);

  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 px-6 text-center", className)}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
        <ConstructionIcon ref={iconRef} size={26} />
      </span>
      <div className="flex max-w-xs flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

export { ConstructionIcon, ConstructionState };
