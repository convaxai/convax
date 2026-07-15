import { Content, Portal, Provider, Root, Trigger } from "@radix-ui/react-tooltip"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { cn } from "../lib/utils"

export function TooltipProvider(props: ComponentProps<typeof Provider>) {
  return <Provider delayDuration={300} skipDelayDuration={100} {...props} />
}

export function Tooltip({
  children,
  content,
  side = "bottom",
}: {
  children: ReactElement
  content: ReactNode
  side?: "bottom" | "left" | "right" | "top"
}) {
  return (
    <Root>
      <Trigger asChild>{children}</Trigger>
      <Portal>
        <Content
          className="z-[100] w-max max-w-64 select-none rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-lg [&_[data-slot=shortcut]]:text-background/70"
          collisionPadding={8}
          side={side}
          sideOffset={8}
        >
          {content}
        </Content>
      </Portal>
    </Root>
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
