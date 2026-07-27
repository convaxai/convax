import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/utils"

export interface SettingsRowProps extends Omit<ComponentProps<"div">, "children"> {
  action?: ReactNode
  children?: ReactNode
  description?: ReactNode
  htmlFor?: string
  label: ReactNode
}

export function SettingsRow({
  action,
  children,
  className,
  description,
  htmlFor,
  label,
  ...props
}: SettingsRowProps) {
  const labelContent = (
    <>
      <span className="block text-sm font-medium text-text-primary">{label}</span>
      {description ? <span className="mt-0.5 block text-xs leading-5 text-text-tertiary">{description}</span> : null}
    </>
  )

  return (
    <div
      className={cn(
        "flex min-h-14 items-center justify-between gap-6 border-b border-border-subtle py-3 last:border-b-0",
        className,
      )}
      data-slot="settings-row"
      {...props}
    >
      {htmlFor ? (
        <label className="min-w-0 flex-1" htmlFor={htmlFor}>
          {labelContent}
        </label>
      ) : (
        <div className="min-w-0 flex-1">{labelContent}</div>
      )}
      {action !== undefined || children !== undefined ? (
        <div className="shrink-0" data-slot="settings-row-action">
          {action ?? children}
        </div>
      ) : null}
    </div>
  )
}
