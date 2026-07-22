import type { ReactNode } from "react"
import type { CanvasDocument, CanvasNode } from "./types"

export interface CanvasSelectionActionContext {
  readonly document: CanvasDocument
  readonly selectedEdgeIds: readonly string[]
  readonly selectedNodeIds: readonly string[]
  readonly selectedNodes: readonly CanvasNode[]
  readonly signal: AbortSignal
}

/** Host-owned action rendered by Canvas without granting the action access to editor internals. */
export interface CanvasSelectionAction {
  readonly id: string
  readonly label: string
  readonly icon?: ReactNode
  readonly visible?: (context: CanvasSelectionActionContext) => boolean
  readonly execute: (context: CanvasSelectionActionContext) => void | Promise<void>
}

export function createCanvasSelectionActionContext(
  document: CanvasDocument,
  selectedNodeIds: readonly string[],
  selectedEdgeIds: readonly string[],
  signal: AbortSignal,
): CanvasSelectionActionContext {
  const ids = [...selectedNodeIds]
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  return {
    document,
    selectedEdgeIds: [...selectedEdgeIds],
    selectedNodeIds: ids,
    selectedNodes: ids.flatMap((id) => {
      const node = nodeById.get(id)
      return node ? [node] : []
    }),
    signal,
  }
}

/** A faulty host predicate cannot take down the Canvas selection surface. */
export function getVisibleCanvasSelectionActions(
  actions: readonly CanvasSelectionAction[],
  context: CanvasSelectionActionContext,
) {
  return actions.filter((action) => {
    try {
      return action.visible?.(context) ?? true
    } catch {
      return false
    }
  })
}

export type CanvasSelectionActionExecutionStatus = "aborted" | "completed" | "failed" | "ignored"

export interface CanvasSelectionActionExecutorOptions {
  onError?: (action: CanvasSelectionAction, error: unknown) => void
  onPendingChange?: () => void
}

/**
 * Coordinates action execution independently of React so repeated clicks and stale
 * completions have one deterministic lifecycle.
 */
export class CanvasSelectionActionExecutor {
  readonly #options: CanvasSelectionActionExecutorOptions
  readonly #pending = new Map<string, { signal: AbortSignal; token: object }>()

  constructor(options: CanvasSelectionActionExecutorOptions = {}) {
    this.#options = options
  }

  isPending(actionId: string, signal?: AbortSignal) {
    const pending = this.#pending.get(actionId)
    return Boolean(pending && (!signal || pending.signal === signal))
  }

  reset(options: { notify?: boolean } = {}) {
    if (this.#pending.size === 0) return
    this.#pending.clear()
    if (options.notify ?? true) this.#options.onPendingChange?.()
  }

  async execute(
    action: CanvasSelectionAction,
    context: CanvasSelectionActionContext,
  ): Promise<CanvasSelectionActionExecutionStatus> {
    if (context.signal.aborted || this.#pending.has(action.id)) return "ignored"

    const token = {}
    this.#pending.set(action.id, { signal: context.signal, token })
    this.#options.onPendingChange?.()

    let status: CanvasSelectionActionExecutionStatus = "completed"
    try {
      await action.execute(context)
      if (context.signal.aborted) status = "aborted"
    } catch (error) {
      if (context.signal.aborted || isAbortError(error)) {
        status = "aborted"
      } else {
        status = "failed"
        try {
          this.#options.onError?.(action, error)
        } catch {
          // Notification adapters are optional view effects and cannot change the action result.
        }
      }
    } finally {
      if (this.#pending.get(action.id)?.token === token) {
        this.#pending.delete(action.id)
        this.#options.onPendingChange?.()
      }
    }
    return status
  }
}

function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}
