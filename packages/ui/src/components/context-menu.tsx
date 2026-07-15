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
        className={cn(
          "z-50 min-w-52 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg",
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
        "relative flex h-8 cursor-default select-none items-center gap-2 rounded-sm px-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
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
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

