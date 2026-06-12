import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#/lib/utils.ts";

const toggleVariants = cva(
  "group/toggle relative top-0 inline-flex items-center justify-center gap-1 rounded-3xl border border-(--btn-3d) text-sm font-medium whitespace-nowrap outline-none select-none transition-[box-shadow,top,background-color,border-color,color] duration-150 ease-out [--btn-3d:transparent] [--btn-glare:transparent] [--btn-glare-hover:var(--btn-glare)] shadow-[0_3px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] hover:-top-px hover:shadow-[0_4px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare-hover)] focus-visible:z-10 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:top-[3px] aria-pressed:z-10 aria-pressed:[--btn-glare:var(--btn-3d)] aria-pressed:shadow-[0_0_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "dark:border-border bg-background hover:bg-muted hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:[--btn-3d:color-mix(in_oklch,var(--primary),black_32%)] [--btn-3d:color-mix(in_oklch,var(--border),black_12%)] [--btn-glare:oklch(1_0_0/0.55)] [--btn-glare-hover:oklch(1_0_0/0.8)] dark:bg-input/30 dark:[--btn-3d:transparent] dark:[--btn-glare:oklch(1_0_0/0.08)] dark:[--btn-glare-hover:oklch(1_0_0/0.16)] dark:hover:bg-input/50",
        outline:
          "dark:border-border bg-background hover:bg-muted hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:[--btn-3d:color-mix(in_oklch,var(--primary),black_32%)] [--btn-3d:color-mix(in_oklch,var(--border),black_12%)] [--btn-glare:oklch(1_0_0/0.55)] [--btn-glare-hover:oklch(1_0_0/0.8)] dark:bg-input/30 dark:[--btn-3d:transparent] dark:[--btn-glare:oklch(1_0_0/0.08)] dark:[--btn-glare-hover:oklch(1_0_0/0.16)] dark:hover:bg-input/50",
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
