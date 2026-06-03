import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "#/lib/utils.ts"

const buttonVariants = cva(
  "group/button relative top-0 inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent text-sm font-medium whitespace-nowrap outline-none select-none transition-[box-shadow,top,background-color,border-color,color] duration-150 ease-out [--btn-3d:transparent] [--btn-glare:transparent] shadow-[0_3px_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:top-[3px] active:not-aria-[haspopup]:shadow-[0_0_0_0_var(--btn-3d),inset_0_1px_0_0_var(--btn-glare)] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/80 [--btn-3d:color-mix(in_oklch,var(--primary),black_32%)] [--btn-glare:oklch(1_0_0/0.25)]",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground [--btn-3d:color-mix(in_oklch,var(--border),black_12%)] [--btn-glare:oklch(1_0_0/0.55)] dark:bg-transparent dark:hover:bg-input/30 dark:[--btn-3d:transparent] dark:[--btn-glare:oklch(1_0_0/0.08)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground [--btn-3d:color-mix(in_oklch,var(--secondary),black_14%)] [--btn-glare:oklch(1_0_0/0.7)] dark:[--btn-glare:oklch(1_0_0/0.08)]",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 [--btn-3d:color-mix(in_oklch,var(--destructive),black_10%)] [--btn-glare:oklch(1_0_0/0.18)] dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
