import {
  Content,
  Item,
  Label,
  Portal,
  Root,
  Separator,
  Trigger,
} from "@radix-ui/react-context-menu"
import type { ComponentProps } from "react"
import { cn } from "../lib/utils"

export function ContextMenu(props: ComponentProps<typeof Root>) {
  return <Root {...props} />
}

export function ContextMenuTrigger(props: ComponentProps<typeof Trigger>) {
  return <Trigger data-slot="context-menu-trigger" {...props} />
}

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof Content>) {
  return (
    <Portal>
      <Content
        data-slot="context-menu-content"
        data-ui-menu-surface=""
        className={cn(
          "z-50 min-w-56 overflow-hidden rounded-lg border border-border/90 bg-popover/95 p-2 text-popover-foreground shadow-xl backdrop-blur-xl",
          className,
        )}
        {...props}
      />
    </Portal>
  )
}

export function ContextMenuItem({ className, ...props }: ComponentProps<typeof Item>) {
  return (
    <Item
      data-slot="context-menu-item"
      className={cn(
        "relative flex min-h-10 cursor-default select-none items-center gap-3 rounded-md px-3 text-[13px] font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

export function ContextMenuLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="context-menu-label"
      className={cn("px-3 py-2 text-[11px] font-semibold text-muted-foreground", className)}
      {...props}
    />
  )
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="context-menu-separator"
      className={cn("my-1 h-px bg-border/70", className)}
      {...props}
    />
  )
}
