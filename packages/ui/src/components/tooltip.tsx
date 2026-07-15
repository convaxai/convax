import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/utils"

export function TooltipProvider({ children }: { children: ReactNode }) {
  return children
}

export function Tooltip({
  children,
  content,
  side = "bottom",
}: {
  children: ReactNode
  content: ReactNode
  side?: "bottom" | "left" | "right" | "top"
}) {
  const position = side === "top"
    ? "bottom-full left-1/2 mb-1.5 -translate-x-1/2"
    : side === "left"
      ? "right-full top-1/2 mr-1.5 -translate-y-1/2"
      : side === "right"
        ? "left-full top-1/2 ml-1.5 -translate-y-1/2"
        : "left-1/2 top-full mt-1.5 -translate-x-1/2"
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 hidden w-max max-w-64 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md group-hover:block group-focus-within:block",
          position,
        )}
      >
        {content}
      </span>
    </span>
  )
}

export function Shortcut({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="shortcut"
      className={cn("ml-auto text-[11px] text-muted-foreground", className)}
      {...props}
    />
  )
}
