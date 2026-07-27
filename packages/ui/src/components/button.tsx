import { cva, type VariantProps } from "class-variance-authority"
import type { ComponentProps } from "react"
import { cn } from "../lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium outline-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:border-interactive-selected-border aria-pressed:bg-interactive-selected aria-pressed:text-foreground [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:brightness-95 active:brightness-90",
        destructive: "bg-destructive text-white shadow-sm hover:bg-destructive/90",
        outline: "border border-border bg-background shadow-sm hover:bg-interactive-hover hover:text-foreground active:bg-interactive-pressed",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "border border-transparent hover:bg-interactive-hover hover:text-foreground active:bg-interactive-pressed",
        toolbar:
          "border border-transparent bg-transparent text-text-secondary hover:bg-interactive-hover hover:text-text-primary active:bg-interactive-pressed",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        compact: "h-7 gap-1.5 px-2 text-xs",
        icon: "size-9 p-0",
        "icon-sm": "size-8 p-0",
        "icon-xs": "size-7 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export function Button({
  className,
  size,
  type = "button",
  variant,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      data-ui-interactive=""
      type={type}
      className={cn(buttonVariants({ size, variant }), className)}
      {...props}
    />
  )
}

export { buttonVariants }
