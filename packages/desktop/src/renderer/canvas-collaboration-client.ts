import type {
  CanvasEntityRef,
  CanvasRendererCollaborationClient,
  CanvasRendererCommand,
} from "@convax/canvas/collaboration"
import type { CanvasDocument } from "@convax/canvas/core"
import type { CanvasDocumentRef } from "@convax/canvas/application"
import type {
  CanvasRendererSessionTransport,
  CanvasSessionInvalidationDto,
  CanvasSessionProjectionDto,
} from "../canvas-session-contracts"

export interface DesktopCanvasRendererSession extends CanvasRendererCollaborationClient {
  readonly ref: CanvasDocumentRef
  refresh(signal?: AbortSignal): Promise<void>
  dispose(): void
}

export async function openDesktopCanvasRendererSession(input: {
  readonly createCommandId?: () => string
  readonly ref: CanvasDocumentRef
  readonly transport: CanvasRendererSessionTransport
  readonly signal?: AbortSignal
}): Promise<DesktopCanvasRendererSession> {
  throwIfAborted(input.signal)
  const initial = await input.transport.open(input.ref)
  try {
    throwIfAborted(input.signal)
    return new MountedDesktopCanvasRendererSession(
      input.ref,
      input.transport,
      initial,
      input.createCommandId ?? (() => `renderer:${globalThis.crypto.randomUUID()}`),
    )
  } catch (error) {
    try {
      await input.transport.close({ ref: input.ref, sessionId: initial.sessionId })
    } catch {
      // Preserve the mount/validation failure; Main also revokes on renderer destruction.
    }
    throw error
  }
}

class MountedDesktopCanvasRendererSession implements DesktopCanvasRendererSession {
  readonly authority = "project-collaboration-application" as const
  readonly undoModel = "project-yjs-semantic-history" as const
  readonly ref: CanvasDocumentRef
  readonly #transport: CanvasRendererSessionTransport
  readonly #createCommandId: () => string
  readonly #listeners = new Set<() => void>()
  readonly #entities = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
  readonly #unsubscribe: () => void
  #snapshot: CanvasSessionProjectionDto
  #lane: Promise<void> = Promise.resolve()
  #disposed = false
  #refreshQueued = false

  constructor(
    ref: CanvasDocumentRef,
    transport: CanvasRendererSessionTransport,
    initial: CanvasSessionProjectionDto,
    createCommandId: () => string,
  ) {
    this.ref = Object.freeze({ ...ref })
    this.#transport = transport
    this.#createCommandId = createCommandId
    this.#snapshot = requireProjection(this.ref, initial)
    this.#replaceEntities(initial)
    this.#unsubscribe = transport.subscribe((event) => this.#onInvalidation(event))
  }

  getProjection(): CanvasDocument {
    return this.#snapshot.document
  }

  resolveNodeEntity(nodeId: string) {
    return this.#entities.get(nodeId)
  }

  subscribe(listener: () => void): () => void {
    this.#assertLive()
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  canUndo(): boolean {
    return this.#snapshot.canUndo
  }

  canRedo(): boolean {
    return this.#snapshot.canRedo
  }

  submit(command: CanvasRendererCommand, signal?: AbortSignal): Promise<void> {
    const commandId = this.#createCommandId()
    return this.#enqueue(async () => {
      throwIfAborted(signal)
      const result = await this.#transport.submit({ ...this.#scope(), command, commandId })
      throwIfAborted(signal)
      this.#accept(result.projection)
    })
  }

  undo(signal?: AbortSignal): Promise<void> {
    return this.#history("undo", signal)
  }

  redo(signal?: AbortSignal): Promise<void> {
    return this.#history("redo", signal)
  }

  flush(signal?: AbortSignal): Promise<void> {
    return this.#enqueue(async () => {
      throwIfAborted(signal)
      await this.#transport.flush(this.#scope())
      throwIfAborted(signal)
      this.#accept(await this.#transport.query(this.#scope()))
      throwIfAborted(signal)
    })
  }

  refresh(signal?: AbortSignal): Promise<void> {
    return this.#enqueue(async () => {
      throwIfAborted(signal)
      this.#accept(await this.#transport.query(this.#scope()))
      throwIfAborted(signal)
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribe()
    this.#listeners.clear()
    void this.#lane.finally(() => this.#transport.close(this.#scope())).catch(() => undefined)
  }

  #history(direction: "undo" | "redo", signal?: AbortSignal): Promise<void> {
    const commandId = this.#createCommandId()
    return this.#enqueue(async () => {
      throwIfAborted(signal)
      const result = await this.#transport[direction]({ ...this.#scope(), commandId })
      throwIfAborted(signal)
      if (result) this.#accept(result.projection)
      else this.#accept(await this.#transport.query(this.#scope()))
    })
  }

  #onInvalidation(event: CanvasSessionInvalidationDto): void {
    if (
      this.#disposed ||
      event.sessionId !== this.#snapshot.sessionId ||
      !sameRef(event.ref, this.ref) ||
      this.#refreshQueued
    ) {
      return
    }
    this.#refreshQueued = true
    void this.#enqueue(async () => {
      try {
        this.#accept(await this.#transport.query(this.#scope()))
      } finally {
        this.#refreshQueued = false
      }
    }).catch(() => undefined)
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    this.#assertLive()
    const current = this.#lane.then(operation)
    this.#lane = current.catch(() => undefined)
    return current
  }

  #accept(next: CanvasSessionProjectionDto): void {
    if (this.#disposed) return
    this.#snapshot = requireProjection(this.ref, next, this.#snapshot.sessionId)
    this.#replaceEntities(next)
    for (const listener of [...this.#listeners]) listener()
  }

  #replaceEntities(next: CanvasSessionProjectionDto): void {
    this.#entities.clear()
    for (const entry of next.nodeEntities) this.#entities.set(entry.nodeId, entry.entity)
  }

  #scope() {
    return { ref: this.ref, sessionId: this.#snapshot.sessionId }
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Canvas renderer session is closed")
  }
}

function requireProjection(
  expectedRef: CanvasDocumentRef,
  value: CanvasSessionProjectionDto,
  expectedSessionId?: CanvasSessionProjectionDto["sessionId"],
): CanvasSessionProjectionDto {
  if (
    value.format !== "convax.canvas-session-projection" ||
    !sameRef(value.ref, expectedRef) ||
    value.document.id !== expectedRef.canvasId ||
    (expectedSessionId !== undefined && value.sessionId !== expectedSessionId)
  ) {
    throw new Error("Canvas renderer session projection is outside the mounted scope")
  }
  const ids = new Set<string>()
  for (const entry of value.nodeEntities) {
    if (ids.has(entry.nodeId) || entry.nodeId !== entry.entity.id || entry.entity.kind !== "node") {
      throw new Error("Canvas renderer session entity projection is invalid")
    }
    ids.add(entry.nodeId)
  }
  if (value.document.nodes.some((node) => !ids.has(node.id)) || ids.size !== value.document.nodes.length) {
    throw new Error("Canvas renderer session entity projection is incomplete")
  }
  return value
}

function sameRef(left: CanvasDocumentRef, right: CanvasDocumentRef): boolean {
  return left.canvasId === right.canvasId && left.scopeId === right.scopeId
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas renderer session was canceled", "AbortError")
}
