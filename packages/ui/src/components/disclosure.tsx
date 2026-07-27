import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ComponentProps,
} from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "../lib/utils"

type DisclosureContextValue = {
  contentId: string
  disabled: boolean
  onOpenChange(open: boolean): void
  open: boolean
}

const DisclosureContext = createContext<DisclosureContextValue | null>(null)

function useDisclosureContext(component: string) {
  const context = useContext(DisclosureContext)
  if (!context) throw new Error(`${component} must be used inside Disclosure`)
  return context
}

export interface DisclosureProps extends Omit<ComponentProps<"div">, "onChange"> {
  defaultOpen?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  open?: boolean
}

export function Disclosure({
  children,
  defaultOpen = false,
  disabled = false,
  onOpenChange,
  open: controlledOpen,
  ...props
}: DisclosureProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const contentId = useId()
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (disabled) return
      if (controlledOpen === undefined) setUncontrolledOpen(nextOpen)
      if (nextOpen !== open) onOpenChange?.(nextOpen)
    },
    [controlledOpen, disabled, onOpenChange, open],
  )
  const context = useMemo(
    () => ({ contentId, disabled, onOpenChange: setOpen, open }),
    [contentId, disabled, open, setOpen],
  )
  return (
    <DisclosureContext.Provider value={context}>
      <div data-slot="disclosure" data-state={open ? "open" : "closed"} {...props}>
        {children}
      </div>
    </DisclosureContext.Provider>
  )
}

export const DisclosureTrigger = forwardRef<HTMLButtonElement, ComponentProps<"button">>(
  function DisclosureTrigger({ children, className, disabled, onClick, type = "button", ...props }, ref) {
    const context = useDisclosureContext("DisclosureTrigger")
    const triggerDisabled = context.disabled || disabled
    return (
      <button
        aria-controls={context.contentId}
        aria-expanded={context.open}
        className={cn(
          "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-text-primary outline-none hover:bg-interactive-hover active:bg-interactive-pressed focus-visible:ring-2 focus-visible:ring-focus-ring/40 disabled:pointer-events-none disabled:opacity-45",
          className,
        )}
        data-slot="disclosure-trigger"
        data-state={context.open ? "open" : "closed"}
        data-ui-interactive=""
        disabled={triggerDisabled}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented) context.onOpenChange(!context.open)
        }}
        ref={ref}
        type={type}
        {...props}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-text-tertiary transition-transform duration-[var(--ui-motion-normal)]",
            context.open && "rotate-90",
          )}
        />
        {children}
      </button>
    )
  },
)

export const DisclosureContent = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  function DisclosureContent({ children, className, ...props }, ref) {
    const context = useDisclosureContext("DisclosureContent")
    return (
      <div
        className={cn("text-sm text-text-secondary", className)}
        data-slot="disclosure-content"
        data-state={context.open ? "open" : "closed"}
        hidden={!context.open}
        id={context.contentId}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    )
  },
)
