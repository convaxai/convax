import type { Id128V2 } from "./codecs"
import { parseId128V2 } from "./codecs"
import { CollaborationKernelErrorV2 } from "./errors"

export type SessionUndoClearReasonV2 = "restart" | "rebuild" | "scope-change" | "unmount" | "post-commit-cursor-failure"

export interface SessionUndoCursorV2 {
  readonly rootOperationId: Id128V2
  readonly cursorToken: Id128V2
}

export interface SessionUndoCoordinatorV2 {
  recordDurableRoot(rootOperationId: Id128V2): void
  peekUndo(): SessionUndoCursorV2 | null
  peekRedo(): SessionUndoCursorV2 | null
  commitUndo(cursorToken: Id128V2, durableInverseOperationId: Id128V2): void
  commitRedo(cursorToken: Id128V2, durableForwardOperationId: Id128V2): void
  clear(reason: SessionUndoClearReasonV2): void
}

export interface SessionUndoCoordinatorOptionsV2 {
  createCursorToken(): Id128V2
}

interface PendingCursor {
  readonly direction: "undo" | "redo"
  readonly rootOperationId: Id128V2
  readonly cursorToken: Id128V2
}

export class TransientSessionUndoCoordinatorV2 implements SessionUndoCoordinatorV2 {
  private pending: PendingCursor | null = null
  private readonly redo: Id128V2[] = []
  private readonly undo: Id128V2[] = []

  constructor(private readonly options: SessionUndoCoordinatorOptionsV2) {}

  recordDurableRoot(rootOperationId: Id128V2): void {
    this.requireNoPending()
    this.undo.push(parseId128V2(rootOperationId))
    this.redo.length = 0
  }

  peekUndo(): SessionUndoCursorV2 | null {
    return this.peek("undo", this.undo)
  }

  peekRedo(): SessionUndoCursorV2 | null {
    return this.peek("redo", this.redo)
  }

  commitUndo(cursorToken: Id128V2, durableInverseOperationId: Id128V2): void {
    parseId128V2(durableInverseOperationId)
    this.commit("undo", cursorToken, this.undo, this.redo)
  }

  commitRedo(cursorToken: Id128V2, durableForwardOperationId: Id128V2): void {
    parseId128V2(durableForwardOperationId)
    this.commit("redo", cursorToken, this.redo, this.undo)
  }

  clear(_reason: SessionUndoClearReasonV2): void {
    this.pending = null
    this.undo.length = 0
    this.redo.length = 0
  }

  getSnapshot(): Readonly<{ undo: readonly Id128V2[]; redo: readonly Id128V2[]; pending: SessionUndoCursorV2 | null }> {
    return Object.freeze({
      undo: Object.freeze([...this.undo]),
      redo: Object.freeze([...this.redo]),
      pending: this.pending === null ? null : Object.freeze({ rootOperationId: this.pending.rootOperationId, cursorToken: this.pending.cursorToken }),
    })
  }

  private peek(direction: PendingCursor["direction"], stack: readonly Id128V2[]): SessionUndoCursorV2 | null {
    if (this.pending !== null) {
      if (this.pending.direction !== direction) throw new CollaborationKernelErrorV2("invalid-owner-result", "Another session undo cursor is active")
      return Object.freeze({ rootOperationId: this.pending.rootOperationId, cursorToken: this.pending.cursorToken })
    }
    const rootOperationId = stack.at(-1)
    if (rootOperationId === undefined) return null
    const cursorToken = parseId128V2(this.options.createCursorToken())
    this.pending = Object.freeze({ direction, rootOperationId, cursorToken })
    return Object.freeze({ rootOperationId, cursorToken })
  }

  private commit(direction: PendingCursor["direction"], cursorToken: Id128V2, source: Id128V2[], destination: Id128V2[]): void {
    const parsedToken = parseId128V2(cursorToken)
    const pending = this.pending
    if (pending === null || pending.direction !== direction || pending.cursorToken !== parsedToken || source.at(-1) !== pending.rootOperationId) {
      throw new CollaborationKernelErrorV2("invalid-owner-result", "Session undo cursor is stale or mismatched")
    }
    source.pop()
    destination.push(pending.rootOperationId)
    this.pending = null
  }

  private requireNoPending(): void {
    if (this.pending !== null) throw new CollaborationKernelErrorV2("invalid-owner-result", "A session undo cursor is active")
  }
}
