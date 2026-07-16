import {
  Anchor as MenuAnchor,
  Content as MenuContent,
  Item as MenuItem,
  Portal as MenuPortal,
  Root as MenuRoot,
  Separator as MenuSeparator,
} from "@radix-ui/react-menu"
import { Check, ChevronDown } from "lucide-react"
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react"
import { cn } from "../lib/utils"

interface SelectContextValue {
  contentId: string
  disabled: boolean
  open: boolean
  setOpen(open: boolean): void
  setValue(value: string): void
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>
  value: string
}

const SelectContext = createContext<SelectContextValue | null>(null)

function useSelectContext(component: string) {
  const context = useContext(SelectContext)
  if (!context) throw new Error(`${component} must be used inside Select`)
  return context
}

export interface SelectProps {
  children: ReactNode
  defaultOpen?: boolean
  defaultValue?: string
  dir?: "ltr" | "rtl"
  disabled?: boolean
  onOpenChange?(open: boolean): void
  onValueChange?(value: string): void
  open?: boolean
  value?: string
}

export function Select({
  children,
  defaultOpen = false,
  defaultValue = "",
  dir,
  disabled = false,
  onOpenChange,
  onValueChange,
  open: controlledOpen,
  value: controlledValue,
}: SelectProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const contentId = useId()
  const open = controlledOpen ?? uncontrolledOpen
  const value = controlledValue ?? uncontrolledValue
  const setOpen = useCallback((nextOpen: boolean) => {
    if (disabled && nextOpen) return
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen)
    if (nextOpen !== open) onOpenChange?.(nextOpen)
  }, [controlledOpen, disabled, onOpenChange, open])
  const setValue = useCallback((nextValue: string) => {
    if (disabled || nextValue === value) return
    if (controlledValue === undefined) setUncontrolledValue(nextValue)
    onValueChange?.(nextValue)
  }, [controlledValue, disabled, onValueChange, value])

  useEffect(() => {
    if (!open) return
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener("keydown", closeForEscape, true)
    return () => window.removeEventListener("keydown", closeForEscape, true)
  }, [open, setOpen])

  return (
    <SelectContext.Provider value={{ contentId, disabled, open, setOpen, setValue, triggerRef, value }}>
      <MenuRoot dir={dir} modal={false} onOpenChange={setOpen} open={open}>
        {children}
      </MenuRoot>
    </SelectContext.Provider>
  )
}

export const SelectTrigger = forwardRef<HTMLButtonElement, ComponentProps<"button">>(function SelectTrigger({
  children,
  className,
  disabled,
  onClick,
  onKeyDown,
  type = "button",
  ...props
}, forwardedRef) {
  const context = useSelectContext("SelectTrigger")
  const triggerDisabled = context.disabled || disabled
  const setTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    context.triggerRef.current = node
    setRef(forwardedRef, node)
  }, [context.triggerRef, forwardedRef])

  return (
    <MenuAnchor asChild>
      <button
        aria-autocomplete="none"
        aria-controls={context.open ? context.contentId : undefined}
        aria-expanded={context.open}
        aria-haspopup="listbox"
        className={cn(
          "flex h-9 w-fit min-w-32 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 [&>span]:truncate",
          className,
        )}
        data-slot="select-trigger"
        data-state={context.open ? "open" : "closed"}
        disabled={triggerDisabled}
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
        role="combobox"
        type={type}
        {...props}
      >
        {children}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0 text-muted-foreground opacity-70 transition-transform", context.open && "rotate-180")}
        />
      </button>
    </MenuAnchor>
  )
})

export function SelectValue({ children, className, placeholder, ...props }: ComponentProps<"span"> & { placeholder?: ReactNode }) {
  const context = useSelectContext("SelectValue")
  return (
    <span
      className={cn("min-w-0 flex-1 text-left", !context.value && "text-muted-foreground", className)}
      data-placeholder={context.value ? undefined : ""}
      data-slot="select-value"
      {...props}
    >
      {children ?? (context.value || placeholder)}
    </span>
  )
}

export const SelectContent = forwardRef<HTMLDivElement, Omit<ComponentProps<typeof MenuContent>, "onEscapeKeyDown">>(function SelectContent({
  align = "start",
  children,
  className,
  onCloseAutoFocus,
  sideOffset = 4,
  ...props
}, forwardedRef) {
  const context = useSelectContext("SelectContent")
  return (
    <MenuPortal>
      <MenuContent
        align={align}
        aria-labelledby={context.triggerRef.current?.id}
        className={cn(
          "z-[110] max-h-[var(--radix-popper-available-height)] min-w-[var(--radix-popper-anchor-width)] overflow-y-auto overflow-x-hidden rounded-lg border border-border/90 bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur-xl",
          className,
        )}
        data-slot="select-content"
        id={context.contentId}
        loop
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          context.triggerRef.current?.focus()
        }}
        ref={forwardedRef}
        role="listbox"
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </MenuContent>
    </MenuPortal>
  )
})

export const SelectItem = forwardRef<HTMLDivElement, Omit<ComponentProps<typeof MenuItem>, "value"> & { value: string }>(function SelectItem({
  children,
  className,
  onSelect,
  value,
  ...props
}, forwardedRef) {
  const context = useSelectContext("SelectItem")
  const selected = context.value === value
  return (
    <MenuItem
      aria-selected={selected}
      className={cn(
        "relative flex min-h-9 w-full cursor-default select-none items-center rounded-md py-2 pl-8 pr-3 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        className,
      )}
      data-slot="select-item"
      data-state={selected ? "checked" : "unchecked"}
      onSelect={(event) => {
        onSelect?.(event)
        if (!event.defaultPrevented) context.setValue(value)
      }}
      ref={forwardedRef}
      role="option"
      {...props}
    >
      <span aria-hidden="true" className="absolute left-2 grid size-4 place-items-center">
        {selected ? <Check className="size-4" /> : null}
      </span>
      {children}
    </MenuItem>
  )
})

export function SelectSeparator({ className, ...props }: ComponentProps<typeof MenuSeparator>) {
  return (
    <MenuSeparator
      className={cn("-mx-1 my-1 h-px bg-border/70", className)}
      data-slot="select-separator"
      {...props}
    />
  )
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}
