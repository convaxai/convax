import type { ComponentProps, ReactNode } from "react"
import { cn } from "../lib/utils"

export type LoadingSize = "sm" | "md" | "lg"
export type LoadingTone = "default" | "brand" | "muted"
export type LoadingLayout = "inline" | "surface"

function loadingMotionAttribute(reducedMotion: boolean | undefined) {
  if (reducedMotion === true) return "reduce"
  if (reducedMotion === false) return "animate"
  return undefined
}

const sizeClassName: Record<LoadingSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
}

const toneClassName: Record<LoadingTone, string> = {
  default: "text-text-secondary",
  brand: "text-brand",
  muted: "text-text-tertiary",
}

export interface LoadingSpinnerProps extends Omit<ComponentProps<"span">, "aria-hidden" | "children"> {
  /**
   * Explicit motion override. `true` forces the static busy glyph; `false` keeps
   * the spin even when the OS prefers reduced motion. Omit to follow CSS media.
   */
  reducedMotion?: boolean
  size?: LoadingSize
  tone?: LoadingTone
}

/**
 * Decorative busy glyph. Always `aria-hidden`; pair with a labelled status
 * region or control text so motion is never the only cue.
 */
export function LoadingSpinner({
  className,
  reducedMotion,
  size = "md",
  tone = "default",
  ...props
}: LoadingSpinnerProps) {
  return (
    <span
      className={cn(toneClassName[tone], className)}
      data-slot="loading-spinner"
      data-ui-loading-size={size}
      data-ui-loading-spinner=""
      data-ui-loading-motion={loadingMotionAttribute(reducedMotion)}
      {...props}
      aria-hidden="true"
    />
  )
}

export interface LoadingProps extends Omit<ComponentProps<"div">, "aria-live" | "children" | "role"> {
  /** Optional secondary line under the primary label (surface layout). */
  description?: ReactNode
  /** Accessible status label. Required so announcement does not depend on motion. */
  label: ReactNode
  layout?: LoadingLayout
  reducedMotion?: boolean
  size?: LoadingSize
  /** Hide the decorative spinner when the caller supplies its own indicator. */
  spinner?: boolean
  tone?: LoadingTone
}

/**
 * Product-agnostic busy region. Owners pass truthy busy state by mounting this
 * component; it never reads Project, Canvas, or Agent controllers.
 */
export function Loading({
  className,
  description,
  label,
  layout = "inline",
  reducedMotion,
  size = "md",
  spinner = true,
  tone = "default",
  ...props
}: LoadingProps) {
  const motion = loadingMotionAttribute(reducedMotion)
  const isSurface = layout === "surface"

  return (
    <div
      className={cn(
        sizeClassName[size],
        toneClassName[tone],
        isSurface
          ? "flex flex-col items-center justify-center gap-3 text-center"
          : "inline-flex items-center gap-2",
        className,
      )}
      data-slot="loading"
      data-ui-loading-layout={layout}
      data-ui-loading-motion={motion}
      {...props}
      aria-live="polite"
      role="status"
    >
      {spinner ? (
        isSurface ? (
          <span className="text-current" data-slot="loading-glyph-well" data-ui-loading-well="">
            <LoadingSpinner reducedMotion={reducedMotion} size={size === "sm" ? "md" : "lg"} tone={tone} />
          </span>
        ) : (
          <LoadingSpinner reducedMotion={reducedMotion} size={size} tone={tone} />
        )
      ) : null}
      <span className={cn(isSurface ? "font-medium text-text-primary" : null)} data-slot="loading-label">
        {label}
      </span>
      {description != null ? (
        <span className="text-xs text-text-tertiary" data-slot="loading-description">
          {description}
        </span>
      ) : null}
    </div>
  )
}

export interface LoadingSkeletonProps extends Omit<ComponentProps<"div">, "aria-hidden" | "children"> {
  reducedMotion?: boolean
}

/**
 * Decorative placeholder shape. Keep status announcement on one parent Loading
 * (or host region); do not put `role="status"` on each skeleton row.
 */
export function LoadingSkeleton({ className, reducedMotion, ...props }: LoadingSkeletonProps) {
  return (
    <div
      className={cn("rounded-md bg-surface-inset", className)}
      data-slot="loading-skeleton"
      data-ui-loading-motion={loadingMotionAttribute(reducedMotion)}
      data-ui-loading-skeleton=""
      {...props}
      aria-hidden="true"
    />
  )
}
