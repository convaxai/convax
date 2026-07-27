import { forwardRef, useState, type ComponentProps } from "react"
import { cn } from "../lib/utils"

export interface SwitchProps extends Omit<ComponentProps<"button">, "onChange" | "role"> {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked: controlledChecked,
    className,
    defaultChecked = false,
    disabled,
    onCheckedChange,
    onClick,
    type = "button",
    ...props
  },
  ref,
) {
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked)
  const checked = controlledChecked ?? uncontrolledChecked

  return (
    <button
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border-strong bg-surface-inset p-0.5 outline-none",
        "hover:border-interactive-selected-border active:bg-interactive-pressed focus-visible:ring-2 focus-visible:ring-focus-ring/40",
        "aria-checked:border-interactive-selected-border aria-checked:bg-brand",
        "disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      data-ui-interactive=""
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || disabled) return
        const nextChecked = !checked
        if (controlledChecked === undefined) setUncontrolledChecked(nextChecked)
        onCheckedChange?.(nextChecked)
      }}
      ref={ref}
      role="switch"
      type={type}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block size-3.5 rounded-full bg-text-tertiary shadow-sm transition-transform duration-[var(--ui-motion-normal)]",
          checked && "translate-x-4 bg-on-brand",
        )}
        data-slot="switch-thumb"
      />
    </button>
  )
})
