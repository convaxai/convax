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
    submit: mock(async ({ command: submitted }) => {
      current = projection(submitted.body.updates[0]!.position.x)
      return { operationReceipt: receipt, projection: current }
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
      return { operationReceipt: receipt, projection: next }
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

  test("coalesces matching invalidation into a query and ignores another session", async () => {
    const bridge = transport()
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    const listener = mock(() => undefined)
    client.subscribe(listener)
    bridge.setProjection(projection(4))
    bridge.emit({ format: "convax.canvas-session-invalidation", ref, sessionId })
    bridge.emit({
      format: "convax.canvas-session-invalidation",
      ref,
      sessionId: id(9),
    })
    await client.flush()

    expect(client.getProjection().nodes[0]?.position.x).toBe(4)
    expect(listener).toHaveBeenCalled()
    expect(bridge.query).toHaveBeenCalledTimes(2)
    client.dispose()
    await Promise.resolve()
    expect(bridge.close).toHaveBeenCalledWith({ ref, sessionId })
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
