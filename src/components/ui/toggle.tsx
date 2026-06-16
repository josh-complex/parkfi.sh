import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils.ts";

const toggleVariants = cva(
  "group/toggle relative top-0 inline-flex items-center justify-center gap-1 rounded-3xl border-3d shadow-3d text-sm font-medium whitespace-nowrap outline-none select-none after:absolute after:inset-x-0 after:top-0 after:-bottom-1 after:rounded-[inherit] after:content-[''] transition-[box-shadow,top,background-color,border-color,color] duration-150 ease-out not-aria-pressed:hover:-top-px not-aria-pressed:hover:shadow-3d-hover focus-visible:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:top-[3px] aria-pressed:z-10 aria-pressed:[--btn-glare:var(--btn-3d)] aria-pressed:shadow-3d-active dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-background hover:bg-muted hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:[--btn-3d:color-mix(in_oklch,var(--primary),black_32%)] btn-3d-outline dark:border-border dark:bg-input/30 dark:hover:bg-input/50",
        outline:
          "bg-background hover:bg-muted hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:[--btn-3d:color-mix(in_oklch,var(--primary),black_32%)] btn-3d-outline dark:border-border dark:bg-input/30 dark:hover:bg-input/50",
      },
      size: {
        default:
          "h-9 min-w-9 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        sm: "h-8 min-w-8 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 min-w-10 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
