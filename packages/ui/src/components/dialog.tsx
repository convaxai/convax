import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "../lib/utils"
import { useTemporarySurfaceFocus } from "../lib/temporary-surface"

type DialogContextValue = {
  descriptionId: string
  dismissible: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  onOpenChange(open: boolean): void
  open: boolean
  titleId: string
}

const DialogContext = createContext<DialogContextValue | null>(null)

function useDialogContext(component: string) {
  const context = useContext(DialogContext)
  if (!context) throw new Error(`${component} must be used inside Dialog`)
  return context
}

export interface DialogProps {
  children: ReactNode
  defaultOpen?: boolean
  dismissible?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  onOpenChange?: (open: boolean) => void
  open?: boolean
}

export function Dialog({
  children,
  defaultOpen = false,
  dismissible = true,
  initialFocusRef,
  onOpenChange,
  open: controlledOpen,
}: DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const titleId = useId()
  const descriptionId = useId()
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!dismissible && !nextOpen) return
      if (controlledOpen === undefined) setUncontrolledOpen(nextOpen)
      if (nextOpen !== open) onOpenChange?.(nextOpen)
    },
    [controlledOpen, dismissible, onOpenChange, open],
  )
  const context = useMemo(
    () => ({
      descriptionId,
      dismissible,
      initialFocusRef,
      onOpenChange: setOpen,
      open,
      titleId,
    }),
    [descriptionId, dismissible, initialFocusRef, open, setOpen, titleId],
  )

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>
}

export const DialogTrigger = forwardRef<HTMLButtonElement, ComponentProps<"button">>(function DialogTrigger(
  { onClick, type = "button", ...props },
  ref,
) {
  const context = useDialogContext("DialogTrigger")
  return (
    <button
      aria-expanded={context.open}
      data-slot="dialog-trigger"
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) context.onOpenChange(true)
      }}
      ref={ref}
      type={type}
      {...props}
    />
  )
})

export type DialogPlacement = "bottom" | "center" | "left" | "right"

export interface DialogContentProps extends Omit<ComponentProps<"div">, "title"> {
  placement?: DialogPlacement
  restoreFocus?: boolean
}

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent(
  {
    "aria-describedby": ariaDescribedBy,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    children,
    className,
    onMouseDown,
    placement = "center",
    restoreFocus = true,
    role = "dialog",
    tabIndex = -1,
    ...props
  },
  forwardedRef,
) {
  const context = useDialogContext("DialogContent")
  const contentRef = useRef<HTMLDivElement | null>(null)
  const setContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node
      setRef(forwardedRef, node)
    },
    [forwardedRef],
  )
  useTemporarySurfaceFocus({
    containerRef: contentRef,
    dismissOnEscape: context.dismissible,
    initialFocusRef: context.initialFocusRef,
    onDismiss: () => context.onOpenChange(false),
    open: context.open,
    restoreFocus,
  })

  if (!context.open) return null

  const content = (
    <div
      className={cn(
        "fixed inset-0 z-[120] flex p-4",
        placement === "center" && "items-center justify-center",
        placement === "right" && "items-stretch justify-end pl-14",
        placement === "left" && "items-stretch justify-start pr-14",
        placement === "bottom" && "items-end justify-center pt-14",
      )}
      data-slot="dialog-overlay"
      data-ui-portal-backdrop=""
      onMouseDown={(event) => {
        onMouseDown?.(event)
        if (!event.defaultPrevented && context.dismissible && event.target === event.currentTarget) {
          context.onOpenChange(false)
        }
      }}
    >
      <div
        aria-describedby={ariaDescribedBy ?? context.descriptionId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : context.titleId)}
        aria-modal="true"
        className={cn(
          "max-h-full w-full overflow-auto border border-border-subtle bg-surface-raised text-text-primary shadow-[var(--ui-shadow-high)] outline-none",
          placement === "center" && "max-w-lg rounded-xl",
          placement === "right" && "max-w-md rounded-l-xl",
          placement === "left" && "max-w-md rounded-r-xl",
          placement === "bottom" && "max-h-[85vh] max-w-3xl rounded-t-xl",
          className,
        )}
        data-slot="dialog-content"
        data-ui-portal-surface=""
        ref={setContentRef}
        role={role}
        tabIndex={tabIndex}
        {...props}
      >
        {children}
      </div>
    </div>
  )

  return typeof document === "undefined" ? content : createPortal(content, document.body)
})

export function DialogTitle({ className, ...props }: ComponentProps<"h2">) {
  const context = useDialogContext("DialogTitle")
  return (
    <h2
      className={cn("text-base font-semibold text-text-primary", className)}
      data-slot="dialog-title"
      id={context.titleId}
      {...props}
    />
  )
}

export function DialogDescription({ className, ...props }: ComponentProps<"p">) {
  const context = useDialogContext("DialogDescription")
  return (
    <p
      className={cn("text-sm leading-5 text-text-secondary", className)}
      data-slot="dialog-description"
      id={context.descriptionId}
      {...props}
    />
  )
}

export const DialogClose = forwardRef<HTMLButtonElement, ComponentProps<"button">>(function DialogClose(
  { onClick, type = "button", ...props },
  ref,
) {
  const context = useDialogContext("DialogClose")
  return (
    <button
      data-slot="dialog-close"
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) context.onOpenChange(false)
      }}
      ref={ref}
      type={type}
      {...props}
      disabled={!context.dismissible || props.disabled}
    />
  )
})

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}
