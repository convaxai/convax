import type { ReactNode } from "react"
import type { CanvasSelectionActionContext } from "./selection-actions"

/** A prepared native drag whose authority remains owned by the host. */
export interface CanvasPreparedSelectionDrag {
  dispose(): void
  /** Absolute epoch in milliseconds. Expired host authority is never started. */
  expiresAt?: number
  start(): void
}

/** Host-owned drag source rendered by Canvas without exposing host paths or APIs. */
export interface CanvasSelectionDragSource {
  readonly icon?: ReactNode
  readonly id: string
  readonly label: string
  /** Optional labels that let Canvas expose this source as a persistent editor mode. */
  readonly mode?: {
    readonly description: string
    readonly exitLabel: string
    readonly label: string
    readonly preparingLabel: string
  }
  readonly prepare: (context: CanvasSelectionActionContext) => Promise<CanvasPreparedSelectionDrag>
  readonly preparingLabel?: string
  /** Explicit host opt-in for a transient modifier chord scoped to focused Canvas descendants. */
  readonly shortcutModifier?: "control" | "meta"
  readonly visible: (context: CanvasSelectionActionContext) => boolean
}

export type CanvasSelectionDragPreparationStatus = "preparing" | "ready" | "unavailable"

export function getVisibleCanvasSelectionDragSource(
  source: CanvasSelectionDragSource | null | undefined,
  context: CanvasSelectionActionContext,
): CanvasSelectionDragSource | null {
  if (!source || context.signal.aborted) return null
  try {
    return source.visible(context) ? source : null
  } catch {
    return null
  }
}

interface ActivePreparation {
  abortListener: () => void
  context: CanvasSelectionActionContext
  gestureController: AbortController
  sourceContext: CanvasSelectionActionContext
  expirationTimer?: ReturnType<typeof setTimeout>
  generation: number
  prepared?: CanvasPreparedSelectionDrag
  source: CanvasSelectionDragSource
}

/**
 * Owns the async prepare/synchronous start boundary independently of React.
 * A resolved stale preparation is always disposed before it can be used.
 */
export class CanvasSelectionDragPreparationController {
  readonly #onChange?: () => void
  readonly #onError?: (source: CanvasSelectionDragSource, error: unknown) => void
  readonly #onExit?: (reason: "expired" | "failed" | "started") => void
  #active?: ActivePreparation
  #generation = 0
  #status: CanvasSelectionDragPreparationStatus = "unavailable"

  constructor(
    options: {
      onChange?: () => void
      onError?: (source: CanvasSelectionDragSource, error: unknown) => void
      onExit?: (reason: "expired" | "failed" | "started") => void
    } = {},
  ) {
    this.#onChange = options.onChange
    this.#onError = options.onError
    this.#onExit = options.onExit
  }

  get status(): CanvasSelectionDragPreparationStatus {
    return this.#status
  }

  reset(): void {
    this.#generation += 1
    const active = this.#active
    this.#active = undefined
    if (active) {
      active.context.signal.removeEventListener("abort", active.abortListener)
      if (active.expirationTimer) clearTimeout(active.expirationTimer)
      active.gestureController.abort()
      safelyDispose(active.prepared)
    }
    this.#setStatus("unavailable")
  }

  set(source: CanvasSelectionDragSource | null, context: CanvasSelectionActionContext): void {
    this.reset()
    if (!source || context.signal.aborted) return

    const generation = this.#generation
    const gestureController = new AbortController()
    const active: ActivePreparation = {
      abortListener: () => {
        if (this.#active === active) this.reset()
      },
      context,
      gestureController,
      generation,
      sourceContext: { ...context, signal: gestureController.signal },
      source,
    }
    this.#active = active
    context.signal.addEventListener("abort", active.abortListener, { once: true })
    this.#prepare(active)
  }

  start(): boolean {
    const active = this.#active
    const prepared = active?.prepared
    if (!active || !prepared || active.context.signal.aborted) return false
    if (
      prepared.expiresAt !== undefined &&
      (!Number.isFinite(prepared.expiresAt) || prepared.expiresAt <= Date.now())
    ) {
      this.#deactivate(active, true, "expired")
      return false
    }

    active.prepared = undefined
    if (active.expirationTimer) clearTimeout(active.expirationTimer)
    try {
      prepared.start()
      this.#deactivate(active, false, "started")
    } catch (error) {
      safelyDispose(prepared)
      this.#reportError(active.source, error)
      this.#deactivate(active, false, "failed")
    }
    return true
  }

  #prepare(active: ActivePreparation): void {
    this.#setStatus("preparing")
    let preparation: Promise<CanvasPreparedSelectionDrag>
    try {
      preparation = Promise.resolve(active.source.prepare(active.sourceContext))
    } catch (error) {
      this.#reportError(active.source, error)
      this.#deactivate(active, false, "failed")
      return
    }
    void preparation.then(
      (prepared) => {
        if (this.#active !== active || active.generation !== this.#generation || active.sourceContext.signal.aborted) {
          safelyDispose(prepared)
          return
        }
        active.prepared = prepared
        if (prepared.expiresAt !== undefined) {
          const remaining = prepared.expiresAt - Date.now()
          if (!Number.isFinite(remaining) || remaining <= 0) {
            this.#deactivate(active, true, "expired")
            return
          }
          active.expirationTimer = setTimeout(
            () => this.#deactivate(active, true, "expired"),
            Math.min(remaining, 2_147_483_647),
          )
        }
        this.#setStatus("ready")
      },
      (error) => {
        if (this.#active !== active || active.generation !== this.#generation || active.context.signal.aborted) return
        this.#reportError(active.source, error)
        this.#deactivate(active, false, "failed")
      },
    )
  }

  #deactivate(active: ActivePreparation, dispose: boolean, reason: "expired" | "failed" | "started"): void {
    if (this.#active !== active) return
    this.#generation += 1
    this.#active = undefined
    active.context.signal.removeEventListener("abort", active.abortListener)
    if (active.expirationTimer) clearTimeout(active.expirationTimer)
    if (reason !== "started") active.gestureController.abort()
    if (dispose) safelyDispose(active.prepared)
    active.prepared = undefined
    this.#setStatus("unavailable")
    try {
      this.#onExit?.(reason)
    } catch {
      // Host exit notifications cannot retain an expired or consumed drag.
    }
  }

  #reportError(source: CanvasSelectionDragSource, error: unknown): void {
    try {
      this.#onError?.(source, error)
    } catch {
      // Optional host notifications cannot change drag preparation ownership.
    }
  }

  #setStatus(status: CanvasSelectionDragPreparationStatus): void {
    if (this.#status === status) return
    this.#status = status
    try {
      this.#onChange?.()
    } catch {
      // React/view refresh adapters cannot change preparation ownership.
    }
  }
}

export interface CanvasSelectionDragGestureControllerOptions {
  onChange?: () => void
  onError?: (source: CanvasSelectionDragSource, error: unknown) => void
  onExit?: (reason: "expired" | "failed" | "started") => void
}

/**
 * Owns the lifetime of the continuously held external-drag shortcut.
 *
 * Holding the shortcut and preparing the current selection are deliberately
 * separate states: a user may hold before selecting anything, and selection
 * changes replace only the preparation. A consumed native drag cannot prepare
 * another selection until the physical shortcut is released and held again.
 */
export class CanvasSelectionDragGestureController {
  readonly #onChange?: () => void
  readonly #preparation: CanvasSelectionDragPreparationController
  #consumed = false
  #held = false
  #hasReconciled = false
  #reconciledContext?: CanvasSelectionActionContext
  #reconciledSource: CanvasSelectionDragSource | null | undefined

  constructor(options: CanvasSelectionDragGestureControllerOptions = {}) {
    this.#onChange = options.onChange
    this.#preparation = new CanvasSelectionDragPreparationController({
      onChange: () => this.#notifyChange(),
      onError: options.onError,
      onExit: options.onExit,
    })
  }

  /** True until release, including while no selection is currently eligible. */
  get held(): boolean {
    return this.#held
  }

  /** True after native drag authority was consumed during the current hold. */
  get consumed(): boolean {
    return this.#consumed
  }

  get status(): CanvasSelectionDragPreparationStatus {
    return this.#preparation.status
  }

  /**
   * Enters the held gesture once. Repeated keydown delivery is intentionally a
   * no-op so it cannot restart a pending or ready preparation.
   */
  hold(source: CanvasSelectionDragSource | null | undefined, context: CanvasSelectionActionContext): boolean {
    if (this.#held) return false
    this.#held = true
    this.#consumed = false
    this.#hasReconciled = false
    this.#reconciledContext = undefined
    this.#reconciledSource = undefined
    this.#notifyChange()
    this.reconcile(source, context)
    return true
  }

  /**
   * Replaces the preparation for a changed immutable selection snapshot while
   * preserving the held shortcut. The same source/context pair is prepared at
   * most once, including after a preparation failure or expiry.
   */
  reconcile(source: CanvasSelectionDragSource | null | undefined, context: CanvasSelectionActionContext): boolean {
    if (!this.#held || this.#consumed) return false
    if (this.#hasReconciled && this.#reconciledSource === source && this.#reconciledContext === context) {
      return false
    }

    this.#hasReconciled = true
    this.#reconciledSource = source
    this.#reconciledContext = context
    this.#preparation.set(getVisibleCanvasSelectionDragSource(source, context), context)
    return true
  }

  /** Consumes at most one prepared native drag during the current hold. */
  start(): boolean {
    if (!this.#held || this.#consumed) return false
    const started = this.#preparation.start()
    if (!started) return false
    this.#consumed = true
    this.#notifyChange()
    return true
  }

  /**
   * Starts a fresh preparation without leaving the held state. Persistent drag
   * modes use this after one native drag completes or when the user retries an
   * expired preparation.
   */
  restart(source: CanvasSelectionDragSource | null | undefined, context: CanvasSelectionActionContext): boolean {
    if (!this.#held) return this.hold(source, context)
    this.#consumed = false
    this.#hasReconciled = false
    this.#reconciledContext = undefined
    this.#reconciledSource = undefined
    this.#preparation.reset()
    this.#notifyChange()
    this.reconcile(source, context)
    return true
  }

  /** Ends the hold and cancels or disposes every unconsumed preparation. */
  release(): boolean {
    const changed = this.#held || this.#consumed || this.#hasReconciled || this.#preparation.status !== "unavailable"
    this.#held = false
    this.#consumed = false
    this.#hasReconciled = false
    this.#reconciledContext = undefined
    this.#reconciledSource = undefined
    this.#preparation.reset()
    if (changed) this.#notifyChange()
    return changed
  }

  #notifyChange(): void {
    try {
      this.#onChange?.()
    } catch {
      // React/view refresh adapters cannot change gesture ownership.
    }
  }
}

function safelyDispose(prepared: CanvasPreparedSelectionDrag | undefined): void {
  if (!prepared) return
  try {
    prepared.dispose()
  } catch {
    // Disposal is best effort and must never make a stale drag usable again.
  }
}
