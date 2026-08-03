import {
  Anchor as MenuAnchor,
  Content as MenuContent,
  Item as MenuItem,
  Portal as MenuPortal,
  Root as MenuRoot,
  Separator as MenuSeparator,
} from "@radix-ui/react-menu"
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react"
import { Button } from "./button"
import { cn } from "../lib/utils"

interface DropdownMenuContextValue {
  contentId: string
  disabled: boolean
  open: boolean
  setOpen(open: boolean): void
  triggerId: string
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null)

function useDropdownMenuContext(component: string) {
  const context = useContext(DropdownMenuContext)
  if (!context) throw new Error(`${component} must be used inside DropdownMenu`)
  return context
}

export interface DropdownMenuProps {
  children: ReactNode
  defaultOpen?: boolean
  dir?: "ltr" | "rtl"
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
}

export function DropdownMenu({
  children,
  defaultOpen = false,
  dir,
  disabled = false,
  onOpenChange,
  open: controlledOpen,
}: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const id = useId()
  const contentId = `${id}-content`
  const triggerId = `${id}-trigger`
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (disabled && nextOpen) return
      if (controlledOpen === undefined) setUncontrolledOpen(nextOpen)
      if (nextOpen !== open) onOpenChange?.(nextOpen)
    },
    [controlledOpen, disabled, onOpenChange, open],
  )

  return (
    <DropdownMenuContext.Provider value={{ contentId, disabled, open, setOpen, triggerId, triggerRef }}>
      <MenuRoot dir={dir} modal={false} onOpenChange={setOpen} open={open}>
        {children}
      </MenuRoot>
    </DropdownMenuContext.Provider>
  )
}

export const DropdownMenuTrigger = forwardRef<HTMLButtonElement, ComponentProps<typeof Button>>(
  function DropdownMenuTrigger(
    { children, disabled, id, onClick, onKeyDown, type = "button", ...props },
    forwardedRef,
  ) {
    const context = useDropdownMenuContext("DropdownMenuTrigger")
    const triggerDisabled = context.disabled || disabled
    const setTriggerRef = useCallback(
      (node: HTMLButtonElement | null) => {
        context.triggerRef.current = node
        setRef(forwardedRef, node)
      },
      [context.triggerRef, forwardedRef],
    )

    return (
      <>
        <MenuAnchor virtualRef={context.triggerRef} />
        <Button
          aria-controls={context.open ? context.contentId : undefined}
          aria-expanded={context.open}
          aria-haspopup="menu"
          data-slot="dropdown-menu-trigger"
          data-state={context.open ? "open" : "closed"}
          disabled={triggerDisabled}
          id={id ?? context.triggerId}
          onClick={(event) => {
            onClick?.(event)
            if (!event.defaultPrevented) context.setOpen(!context.open)
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            if (event.defaultPrevented || triggerDisabled) return
            if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return
            event.preventDefault()
            context.setOpen(true)
          }}
          ref={setTriggerRef}
          type={type}
          {...props}
        >
          {children}
        </Button>
      </>
    )
  },
)

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  Omit<ComponentProps<typeof MenuContent>, "onEscapeKeyDown">
>(function DropdownMenuContent(
  { align = "start", children, className, forceMount, onCloseAutoFocus, sideOffset = 4, ...props },
  forwardedRef,
) {
  const context = useDropdownMenuContext("DropdownMenuContent")
  return (
    <MenuPortal forceMount={forceMount}>
      <MenuContent
        align={align}
        aria-labelledby={context.triggerRef.current?.id ?? context.triggerId}
        className={cn(
          "z-[110] min-w-40 overflow-hidden rounded-lg border border-border/90 bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur-xl",
          className,
        )}
        data-slot="dropdown-menu-content"
        data-ui-menu-surface=""
        forceMount={forceMount}
        id={context.contentId}
        loop
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          context.triggerRef.current?.focus()
        }}
        ref={forwardedRef}
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </MenuContent>
    </MenuPortal>
  )
})

export const DropdownMenuItem = forwardRef<HTMLDivElement, ComponentProps<typeof MenuItem>>(function DropdownMenuItem(
  { className, ...props },
  forwardedRef,
) {
  return (
    <MenuItem
      className={cn(
        "relative flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
        className,
      )}
      data-slot="dropdown-menu-item"
      ref={forwardedRef}
      {...props}
    />
  )
})

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuSeparator>) {
  return (
    <MenuSeparator
      className={cn("-mx-1 my-1 h-px bg-border/70", className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  )
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}
