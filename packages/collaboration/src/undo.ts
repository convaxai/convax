import type { Id128 } from "./codecs"
import { parseId128 } from "./codecs"
import { CollaborationKernelError } from "./errors"

export type SessionUndoClearReason = "restart" | "rebuild" | "scope-change" | "unmount" | "post-commit-cursor-failure"

export interface SessionUndoCursor {
  readonly rootOperationId: Id128
  readonly cursorToken: Id128
}

export interface SessionUndoCoordinator {
  recordDurableRoot(rootOperationId: Id128): void
  canUndo(): boolean
  canRedo(): boolean
  peekUndo(): SessionUndoCursor | null
  peekRedo(): SessionUndoCursor | null
  commitUndo(cursorToken: Id128, durableInverseOperationId: Id128): void
  commitRedo(cursorToken: Id128, durableForwardOperationId: Id128): void
  clear(reason: SessionUndoClearReason): void
}

export interface SessionUndoCoordinatorOptions {
  createCursorToken(): Id128
}

interface PendingCursor {
  readonly direction: "undo" | "redo"
  readonly rootOperationId: Id128
  readonly cursorToken: Id128
}

export class TransientSessionUndoCoordinator implements SessionUndoCoordinator {
  private pending: PendingCursor | null = null
  private readonly redo: Id128[] = []
  private readonly undo: Id128[] = []

  constructor(private readonly options: SessionUndoCoordinatorOptions) {}

  recordDurableRoot(rootOperationId: Id128): void {
    this.requireNoPending()
    this.undo.push(parseId128(rootOperationId))
    this.redo.length = 0
  }

  canUndo(): boolean {
    return this.undo.length > 0
  }

  canRedo(): boolean {
    return this.redo.length > 0
  }

  peekUndo(): SessionUndoCursor | null {
    return this.peek("undo", this.undo)
  }

  peekRedo(): SessionUndoCursor | null {
    return this.peek("redo", this.redo)
  }

  commitUndo(cursorToken: Id128, durableInverseOperationId: Id128): void {
    parseId128(durableInverseOperationId)
    this.commit("undo", cursorToken, this.undo, this.redo)
  }

  commitRedo(cursorToken: Id128, durableForwardOperationId: Id128): void {
    parseId128(durableForwardOperationId)
    this.commit("redo", cursorToken, this.redo, this.undo)
  }

  clear(_reason: SessionUndoClearReason): void {
    this.pending = null
    this.undo.length = 0
    this.redo.length = 0
  }

  getSnapshot(): Readonly<{ undo: readonly Id128[]; redo: readonly Id128[]; pending: SessionUndoCursor | null }> {
    return Object.freeze({
      undo: Object.freeze([...this.undo]),
      redo: Object.freeze([...this.redo]),
      pending: this.pending === null ? null : Object.freeze({ rootOperationId: this.pending.rootOperationId, cursorToken: this.pending.cursorToken }),
    })
  }

  private peek(direction: PendingCursor["direction"], stack: readonly Id128[]): SessionUndoCursor | null {
    if (this.pending !== null) {
      if (this.pending.direction !== direction) throw new CollaborationKernelError("invalid-owner-result", "Another session undo cursor is active")
      return Object.freeze({ rootOperationId: this.pending.rootOperationId, cursorToken: this.pending.cursorToken })
    }
    const rootOperationId = stack.at(-1)
    if (rootOperationId === undefined) return null
    const cursorToken = parseId128(this.options.createCursorToken())
    this.pending = Object.freeze({ direction, rootOperationId, cursorToken })
    return Object.freeze({ rootOperationId, cursorToken })
  }

  private commit(direction: PendingCursor["direction"], cursorToken: Id128, source: Id128[], destination: Id128[]): void {
    const parsedToken = parseId128(cursorToken)
    const pending = this.pending
    if (pending === null || pending.direction !== direction || pending.cursorToken !== parsedToken || source.at(-1) !== pending.rootOperationId) {
      throw new CollaborationKernelError("invalid-owner-result", "Session undo cursor is stale or mismatched")
    }
    source.pop()
    destination.push(pending.rootOperationId)
    this.pending = null
  }

  private requireNoPending(): void {
    if (this.pending !== null) throw new CollaborationKernelError("invalid-owner-result", "A session undo cursor is active")
  }
}
