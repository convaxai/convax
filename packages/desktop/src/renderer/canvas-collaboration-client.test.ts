import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "@convax/canvas"
import type { CanvasRendererCommand } from "@convax/canvas/collaboration"
import { encodeBase64url, parseActorId, parseDigest, parseId128 } from "@convax/collaboration"
import type {
  CanvasRendererSessionTransport,
  CanvasSessionInvalidationDto,
  CanvasSessionProjectionDto,
} from "../canvas-session-contracts"
import { openDesktopCanvasRendererSession } from "./canvas-collaboration-client"

const ref = { canvasId: "canvas-one", scopeId: "project-one" }
const id = (fill: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(fill)))
const actor = (fill: number) => parseActorId(encodeBase64url(new Uint8Array(32).fill(fill)))
const sessionId = id(1)
const frameDigest = (fill: string) => parseDigest(fill.repeat(64))
const entity = { kind: "node" as const, id: "node-one", incarnation: id(2) }
const receipt = {
  format: "convax.canvas-operation-receipt" as const,
  actorId: actor(3),
  operationId: id(4),
  intentKind: "canvas.nodes.set-geometry" as const,
  intentDigest: parseDigest("a".repeat(64)),
  baseFrontierDigest: parseDigest("b".repeat(64)),
  resultEntities: [entity],
  semanticRoot: true,
  historyMaterialDigest: parseDigest("c".repeat(64)),
}

function projection(x: number, overrides: Partial<CanvasSessionProjectionDto> = {}): CanvasSessionProjectionDto {
  return {
    format: "convax.canvas-session-projection",
    ref,
    sessionId,
    document: createCanvasDocument({
      id: ref.canvasId,
      nodes: [createTextNode({ id: entity.id, metadata: {}, position: { x, y: 0 }, resourceState: { status: "stale" } })],
    }),
    nodeEntities: [{ nodeId: entity.id, entity }],
    canUndo: x > 0,
    canRedo: false,
    ...overrides,
  }
}

function command(x: number): CanvasRendererCommand {
  return {
    format: "convax.canvas-renderer-command",
    kind: "canvas.nodes.set-geometry",
    body: { updates: [{ node: entity, position: { x, y: 0 } }] },
  }
}

function transport(initial = projection(0)) {
  let current = initial
  const listeners = new Set<(event: CanvasSessionInvalidationDto) => void>()
  const value: CanvasRendererSessionTransport & {
    emit(event: CanvasSessionInvalidationDto): void
    setProjection(next: CanvasSessionProjectionDto): void
  } = {
    open: mock(async () => current),
    query: mock(async () => current),
    executeApplication: mock(async () => ({
      acceptedFrameDigest: frameDigest("d"),
      affectedNodeIds: [],
      changed: true as const,
      createdNodeIds: [],
      operationReceipt: receipt,
      projection: current,
      warnings: [],
    })),
    submit: mock(async ({ command: submitted }) => {
      current = projection(submitted.body.updates[0]!.position.x)
      return { acceptedFrameDigest: frameDigest("d"), operationReceipt: receipt, projection: current }
    }),
    undo: mock(async () => null),
    redo: mock(async () => null),
    flush: mock(async () => undefined),
    close: mock(async () => undefined),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event) {
      for (const listener of listeners) listener(event)
    },
    setProjection(next) {
      current = next
    },
  }
  return value
}

describe("Desktop Canvas renderer collaboration client", () => {
  test("serializes mutation responses so an older projection cannot overwrite a newer command", async () => {
    const bridge = transport()
    let releaseFirst!: () => void
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    const submit = mock(async ({ command: submitted }: Parameters<CanvasRendererSessionTransport["submit"]>[0]) => {
      calls += 1
      if (calls === 1) await firstBarrier
      const next = projection(submitted.body.updates[0]!.position.x)
      bridge.setProjection(next)
      return { acceptedFrameDigest: frameDigest(calls === 1 ? "d" : "e"), operationReceipt: receipt, projection: next }
    })
    bridge.submit = submit
    let nextCommand = 0
    const client = await openDesktopCanvasRendererSession({
      createCommandId: () => `gesture-${++nextCommand}`,
      ref,
      transport: bridge,
    })

    const first = client.submit(command(1))
    const second = client.submit(command(2))
    await Promise.resolve()
    expect(bridge.submit).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([first, second])

    expect(client.getProjection().nodes[0]?.position.x).toBe(2)
    expect(submit.mock.calls.map(([input]) => input.commandId)).toEqual(["gesture-1", "gesture-2"])
    expect(client.resolveNodeEntity(entity.id)).toEqual(entity)
    expect(client.canUndo()).toBeTrue()
    client.dispose()
  })

  test("queries once for a remote invalidation and ignores another session", async () => {
    const bridge = transport()
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    const listener = mock(() => undefined)
    client.subscribe(listener)
    bridge.setProjection(projection(4))
    bridge.emit({ format: "convax.canvas-session-invalidation", ref, sessionId, frameDigest: frameDigest("f") })
    bridge.emit({
      format: "convax.canvas-session-invalidation",
      ref,
      sessionId: id(9),
      frameDigest: frameDigest("9"),
    })
    await client.drain()

    expect(client.getProjection().nodes[0]?.position.x).toBe(4)
    expect(listener).toHaveBeenCalled()
    expect(bridge.query).toHaveBeenCalledTimes(1)
    client.dispose()
    await Promise.resolve()
    expect(bridge.close).toHaveBeenCalledWith({ ref, sessionId })
  })

  test("covers the local response frame and skips its queued invalidation query", async () => {
    const bridge = transport()
    let emit!: () => void
    bridge.submit = mock(async ({ command: submitted }) => {
      const next = projection(submitted.body.updates[0]!.position.x)
      bridge.setProjection(next)
      emit()
      return { acceptedFrameDigest: frameDigest("d"), operationReceipt: receipt, projection: next }
    })
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    emit = () => bridge.emit({
      format: "convax.canvas-session-invalidation",
      ref,
      sessionId,
      frameDigest: frameDigest("d"),
    })
    await client.submit(command(3))
    await client.drain()
    expect(bridge.query).not.toHaveBeenCalled()
    expect(client.getProjection().nodes[0]?.position.x).toBe(3)
    client.dispose()
  })

  test("accepts an already durable mutation when cancellation arrives with its response", async () => {
    const bridge = transport()
    const controller = new AbortController()
    bridge.submit = mock(async ({ command: submitted }) => {
      const next = projection(submitted.body.updates[0]!.position.x)
      bridge.setProjection(next)
      controller.abort(new DOMException("scope changed after commit", "AbortError"))
      return { acceptedFrameDigest: frameDigest("d"), operationReceipt: receipt, projection: next }
    })
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })

    await expect(client.submit(command(7), controller.signal)).resolves.toBeUndefined()
    expect(client.getProjection().nodes[0]?.position.x).toBe(7)
    client.dispose()
  })

  test("keeps resource delivery in the session lane and skips the same-frame invalidation query", async () => {
    const bridge = transport()
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    const next = projection(5)
    const delivered = await client.runResourceMutation(async () => {
      bridge.setProjection(next)
      bridge.emit({
        format: "convax.canvas-session-invalidation",
        ref,
        sessionId,
        frameDigest: frameDigest("e"),
      })
      return {
        createdNodeIds: [],
        delivery: {
          status: "accepted",
          acceptedFrameDigest: frameDigest("e"),
          projection: next,
        },
        operationReceipt: receipt,
        warnings: [],
      }
    })
    await client.drain()

    expect(delivered.projectionDelivered).toBeTrue()
    expect(client.getProjection().nodes[0]?.position.x).toBe(5)
    expect(bridge.query).not.toHaveBeenCalled()
    client.dispose()
  })

  test("publishes an undo presentation immediately and reconciles it with Main's actual root", async () => {
    const bridge = transport()
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    await client.submit(command(6))
    let release!: () => void
    bridge.undo = mock(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      const next = projection(0, { canRedo: true, canUndo: false })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("f"),
        historyTransition: { direction: "undo" as const, rootOperationId: receipt.operationId },
        operationReceipt: receipt,
        projection: next,
      }
    })

    const pending = client.undo()
    await Promise.resolve()
    expect(client.visualOverlay?.getSnapshot().pendingOperationCount).toBe(1)
    expect(client.visualOverlay?.getSnapshot().operations[0]?.items[0]?.kind).toBe("replace-presentation")
    release()
    await expect(pending).resolves.toEqual({ direction: "undo", rootOperationId: receipt.operationId })
    expect(client.visualOverlay?.getSnapshot().pendingOperationCount).toBe(0)
    client.dispose()
  })

  test("preserves a trailing refresh when another remote frame arrives during query", async () => {
    const bridge = transport()
    let releaseFirst!: () => void
    let first = true
    bridge.query = mock(async () => {
      if (first) {
        first = false
        await new Promise<void>((resolve) => { releaseFirst = resolve })
      }
      return bridge.open(ref)
    })
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    bridge.emit({ format: "convax.canvas-session-invalidation", ref, sessionId, frameDigest: frameDigest("a") })
    await Promise.resolve()
    bridge.emit({ format: "convax.canvas-session-invalidation", ref, sessionId, frameDigest: frameDigest("b") })
    releaseFirst()
    await client.drain()
    expect(bridge.query).toHaveBeenCalledTimes(2)
    client.dispose()
  })

  test("rejects an incomplete node/entity projection before it reaches React Flow", async () => {
    const bridge = transport(projection(0, { nodeEntities: [] }))
    await expect(openDesktopCanvasRendererSession({ ref, transport: bridge })).rejects.toThrow("incomplete")
    expect(bridge.close).toHaveBeenCalledWith({ ref, sessionId })
  })

  test("revokes the Main lease when cancellation wins after open", async () => {
    const bridge = transport()
    const controller = new AbortController()
    bridge.open = mock(async () => {
      controller.abort(new DOMException("scope changed", "AbortError"))
      return projection(0)
    })

    await expect(
      openDesktopCanvasRendererSession({ ref, signal: controller.signal, transport: bridge }),
    ).rejects.toThrow("scope changed")
    expect(bridge.close).toHaveBeenCalledWith({ ref, sessionId })
  })
})
