import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "@convax/canvas"
import type {
  CanvasCertifiedProjectionPatch,
  CanvasRendererCommand,
  CanvasRendererProjectionPatchChange,
} from "@convax/canvas/collaboration"
import {
  encodeBase64url,
  encodeRestrictedJcs,
  parseActorId,
  parseDigest,
  parseId128,
  parseUint64,
} from "@convax/collaboration"
import type {
  CanvasRendererSessionTransport,
  CanvasSessionInvalidationDto,
  CanvasSessionProjectionDto,
} from "../canvas-session-contracts"
import type { CanvasResourceAddResult } from "../desktop-protocol"
import { openDesktopCanvasRendererSession } from "./canvas-collaboration-client"

const ref = { canvasId: `cv_${"1".repeat(64)}`, scopeId: "project-one" }
const id = (fill: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(fill)))
const actor = (fill: number) => parseActorId(encodeBase64url(new Uint8Array(32).fill(fill)))
const sessionId = id(1)
const frameDigest = (fill: string) => parseDigest(fill.repeat(64))
const entitySuffix = encodeBase64url(new Uint8Array(32).fill(2))
const entity = { kind: "node" as const, id: `n_${entitySuffix}`, incarnation: `ni_${entitySuffix}` }
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
const createdSuffix = encodeBase64url(new Uint8Array(32).fill(5))
const createdEntity = Object.freeze({
  kind: "node" as const,
  id: `n_${createdSuffix}`,
  incarnation: `ni_${createdSuffix}`,
})
const resourceReceipt = Object.freeze({
  ...receipt,
  operationId: id(5),
  intentKind: "canvas.resources.add" as const,
  resultEntities: Object.freeze([createdEntity]),
})

function resourcePatch(
  baseStateCommitmentDigest = parseDigest("2".repeat(64)),
  resultStateCommitmentDigest = parseDigest("3".repeat(64)),
): CanvasCertifiedProjectionPatch {
  return {
    format: "convax.canvas-certified-projection-patch",
    kind: "resource-append",
    canvasId: ref.canvasId as never,
    ownerSchemaDigest: parseDigest("1".repeat(64)),
    baseStateCommitmentDigest,
    resultStateCommitmentDigest,
    receipt: resourceReceipt,
    nodes: [
      {
        ref: createdEntity,
        role: "file",
        position: { x: 320, y: 0 },
        size: { width: 320, height: 180 },
        data: {
          format: "convax.canvas-node-data",
          kind: "resource",
          title: "Created by Main",
          resource: {
            format: "convax.canvas-resource-ref",
            uri:
              `convax-project://project_0123456789abcdef0123456789abcdef/epochs/` +
              `AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${"1".repeat(64)}` +
              `?blob=sha256%3A${"2".repeat(64)}&path=Notes%2FCreated.md`,
            mediaClass: "text",
            mime: "text/markdown",
            byteLength: parseUint64("5"),
            contentDigest: parseDigest("2".repeat(64)),
            ownerProofDigest: parseDigest("4".repeat(64)),
          },
        },
        plugin: null,
        parent: null,
        generationLifecycle: "none",
      },
    ],
    edges: [],
  }
}

function resourceResult(
  patch = resourcePatch(),
  runtimePatches: readonly Readonly<{ nodeId: string; state: { status: "ready"; text?: string } }>[] = [],
): CanvasResourceAddResult {
  return {
    createdNodeIds: [createdEntity.id],
    delivery: {
      format: "convax.canvas-resource-certified-projection-delivery",
      status: "certified",
      ref,
      sessionId,
      acceptedFrameDigest: frameDigest("e"),
      canUndo: true,
      canRedo: false,
      patch,
      resourceHierarchy: {
        format: "convax.canvas-resource-hierarchy-delta",
        projectionIdentity: {
          format: "convax.canvas-certified-projection-identity",
          canvasId: patch.canvasId,
          ownerSchemaDigest: patch.ownerSchemaDigest,
          stateCommitmentDigest: patch.resultStateCommitmentDigest,
        },
        entries: [{
          entity: createdEntity,
          nodeId: createdEntity.id,
          classification: {
            kind: "path",
            key: { segments: ["notes", "created.md"], coverage: "leaf" },
          },
        }],
      },
      runtimePatches,
    },
    operationReceipt: resourceReceipt,
    warnings: [],
  }
}

function projection(x: number, overrides: Partial<CanvasSessionProjectionDto> = {}): CanvasSessionProjectionDto {
  const projectionIdentity = overrides.projectionIdentity ?? {
    format: "convax.canvas-certified-projection-identity",
    canvasId: ref.canvasId as never,
    ownerSchemaDigest: parseDigest("1".repeat(64)),
    stateCommitmentDigest: parseDigest("2".repeat(64)),
  }
  return {
    format: "convax.canvas-session-projection",
    ref,
    sessionId,
    document: createCanvasDocument({
      id: ref.canvasId,
      nodes: [
        createTextNode({ id: entity.id, metadata: {}, position: { x, y: 0 }, resourceState: { status: "stale" } }),
      ],
    }),
    edgeEntities: [],
    nodeEntities: [{ nodeId: entity.id, entity }],
    projectionIdentity,
    resourceHierarchy: overrides.resourceHierarchy ?? {
      format: "convax.canvas-resource-hierarchy-snapshot",
      projectionIdentity,
      completeness: "complete",
      entries: [],
    },
    canUndo: x > 0,
    canRedo: false,
    ...overrides,
  }
}

function projectionWithCreated(): CanvasSessionProjectionDto {
  return projection(0, {
    canUndo: true,
    document: createCanvasDocument({
      id: ref.canvasId,
      nodes: [
        createTextNode({
          id: entity.id,
          metadata: {},
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        }),
        createTextNode({
          id: createdEntity.id,
          label: "Created by Main",
          metadata: {},
          position: { x: 320, y: 0 },
          resourceState: { status: "stale" },
        }),
      ],
    }),
    nodeEntities: [
      { nodeId: entity.id, entity },
      { nodeId: createdEntity.id, entity: createdEntity },
    ],
    projectionIdentity: {
      format: "convax.canvas-certified-projection-identity",
      canvasId: ref.canvasId as never,
      ownerSchemaDigest: parseDigest("1".repeat(64)),
      stateCommitmentDigest: parseDigest("3".repeat(64)),
    },
  })
}

function projectionWithNodeCount(nodeCount: number): CanvasSessionProjectionDto {
  const entities = Array.from({ length: nodeCount }, (_, index) => {
    const bytes = new Uint8Array(32)
    bytes[0] = 200
    new DataView(bytes.buffer).setUint32(28, index)
    const suffix = encodeBase64url(bytes)
    return Object.freeze({ kind: "node" as const, id: `n_${suffix}`, incarnation: `ni_${suffix}` })
  }).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return projection(0, {
    document: createCanvasDocument({
      id: ref.canvasId,
      nodes: entities.map((entry, index) =>
        createTextNode({
          id: entry.id,
          metadata: {},
          position: { x: (index % 32) * 360, y: Math.floor(index / 32) * 220 },
          resourceState: { status: "stale" },
        }),
      ),
    }),
    nodeEntities: entities.map((entry) => Object.freeze({ nodeId: entry.id, entity: entry })),
  })
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
    emit = () =>
      bridge.emit({
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
    let patchChange: CanvasRendererProjectionPatchChange | undefined
    client.subscribeProjectionChanges?.((change) => {
      if (change.kind === "patch") patchChange = change
    })
    const delivered = await client.runResourceMutation(async () => {
      bridge.emit({
        format: "convax.canvas-session-invalidation",
        ref,
        sessionId,
        frameDigest: frameDigest("e"),
      })
      return resourceResult(resourcePatch(), [
        { nodeId: createdEntity.id, state: { status: "ready", text: "immediate" } },
      ])
    })
    await client.drain()

    expect(delivered.projectionDelivered).toBeTrue()
    expect(client.resolveNodeEntity(createdEntity.id)).toEqual(createdEntity)
    expect(delivered.preparedResources).toMatchObject([
      { nodeId: createdEntity.id, resourceIdentity: expect.any(String), state: { status: "ready", text: "immediate" } },
    ])
    expect(patchChange?.preparedResources).toEqual(delivered.preparedResources)
    expect(client.ownsProjectionChange(patchChange!)).toBeTrue()
    expect(client.queryViewport({ rect: { x: -1, y: -1, width: 1_000, height: 500 } }).nodes.map((node) => node.id))
      .toContain(createdEntity.id)
    expect(client.queryResourceHierarchy({ segments: ["notes"] })).toEqual({
      status: "available",
      targets: [{ entity: createdEntity, nodeId: createdEntity.id }],
    })
    expect(client.queryResourceHierarchy({ segments: ["notes", "created.md"] })).toEqual({
      status: "available",
      targets: [{ entity: createdEntity, nodeId: createdEntity.id }],
    })
    expect(bridge.query).not.toHaveBeenCalled()
    client.dispose()
  })

  test("keeps a durable certified append while making a missing hierarchy delta fail closed", async () => {
    const bridge = transport()
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    const result = resourceResult()
    const delivery = result.delivery
    if (delivery.status !== "certified") throw new Error("fixture must be certified")
    const missingHierarchy = Object.freeze({
      ...result,
      delivery: Object.freeze({
        ...delivery,
        resourceHierarchy: Object.freeze({
          ...delivery.resourceHierarchy,
          entries: Object.freeze([]),
        }),
      }),
    })

    const accepted = await client.runResourceMutation(async () => missingHierarchy)

    expect(accepted.projectionDelivered).toBeTrue()
    expect(client.resolveNodeEntity(createdEntity.id)).toEqual(createdEntity)
    expect(client.queryResourceHierarchy({ segments: ["notes"] })).toEqual({ status: "unavailable" })
    expect(bridge.query).not.toHaveBeenCalled()
    client.dispose()
  })

  test("keeps certified resource delivery bytes and hot projection visits constant at 1/1k/10k", async () => {
    const deliveryByteLengths: number[] = []
    for (const nodeCount of [1, 1_000, 10_000]) {
      const bridge = transport(projectionWithNodeCount(nodeCount))
      const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
      let hotVisitedEntries = 0
      let fullNotifications = 0
      client.subscribe(() => {
        fullNotifications += 1
        hotVisitedEntries += client.getProjection().nodes.length
      })
      client.subscribeProjectionChanges?.((change) => {
        if (change.kind !== "patch") return
        hotVisitedEntries += change.changes.nodes.length + change.changes.edges.length
      })
      const result = resourceResult()
      deliveryByteLengths.push(encodeRestrictedJcs(result.delivery).byteLength)

      const delivered = await client.runResourceMutation(async () => result)

      expect(delivered.projectionDelivered).toBeTrue()
      expect(bridge.query).not.toHaveBeenCalled()
      expect(fullNotifications).toBe(0)
      expect(hotVisitedEntries).toBe(1)
      expect(client.resolveNodeEntity(createdEntity.id)).toEqual(createdEntity)
      client.dispose()
    }
    expect(new Set(deliveryByteLengths).size).toBe(1)
  }, 30_000)

  test("falls back to one full query for a mismatched or rejected certified patch", async () => {
    for (const patch of [
      resourcePatch(parseDigest("9".repeat(64))),
      resourcePatch(parseDigest("2".repeat(64)), parseDigest("2".repeat(64))),
    ]) {
      const bridge = transport()
      const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
      bridge.setProjection(projectionWithCreated())

      const delivered = await client.runResourceMutation(async () => resourceResult(patch))

      expect(delivered.projectionDelivered).toBeTrue()
      expect(delivered.preparedResources).toEqual([])
      expect(bridge.query).toHaveBeenCalledTimes(1)
      expect(client.resolveNodeEntity(createdEntity.id)).toEqual(createdEntity)
      client.dispose()
    }
  })

  test("publishes an undo presentation immediately and reconciles it with Main's actual root", async () => {
    const bridge = transport()
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    await client.submit(command(6))
    let release!: () => void
    bridge.undo = mock(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
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

  test("keeps visual undo and redo aligned when a real edit is followed by no-op geometry", async () => {
    const bridge = transport()
    const noOpReceipt = {
      ...receipt,
      historyMaterialDigest: null,
      operationId: id(5),
      resultEntities: [],
      semanticRoot: false,
    }
    let submitCount = 0
    bridge.submit = mock(async ({ command: submitted }) => {
      submitCount += 1
      const next = projection(submitted.body.updates[0]!.position.x)
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest(submitCount === 1 ? "d" : "e"),
        operationReceipt: submitCount === 1 ? receipt : noOpReceipt,
        projection: next,
      }
    })
    let releaseUndo!: () => void
    bridge.undo = mock(async () => {
      await new Promise<void>((resolve) => {
        releaseUndo = resolve
      })
      const next = projection(0, { canRedo: true, canUndo: false })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("f"),
        historyTransition: { direction: "undo" as const, rootOperationId: receipt.operationId },
        operationReceipt: receipt,
        projection: next,
      }
    })
    let releaseRedo!: () => void
    bridge.redo = mock(async () => {
      await new Promise<void>((resolve) => {
        releaseRedo = resolve
      })
      const next = projection(6, { canRedo: false, canUndo: true })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("9"),
        historyTransition: { direction: "redo" as const, rootOperationId: receipt.operationId },
        operationReceipt: receipt,
        projection: next,
      }
    })
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })

    await client.submit(command(6))
    await client.submit(command(6))

    const pendingUndo = client.undo()
    expect(client.visualOverlay?.getSnapshot().operations.at(-1)?.items).toMatchObject([
      { kind: "replace-presentation", position: { x: 0, y: 0 } },
    ])
    await Promise.resolve()
    releaseUndo()
    await expect(pendingUndo).resolves.toEqual({ direction: "undo", rootOperationId: receipt.operationId })

    const pendingRedo = client.redo()
    expect(client.visualOverlay?.getSnapshot().operations.at(-1)?.items).toMatchObject([
      { kind: "replace-presentation", position: { x: 6, y: 0 } },
    ])
    await Promise.resolve()
    releaseRedo()
    await expect(pendingRedo).resolves.toEqual({ direction: "redo", rootOperationId: receipt.operationId })
    expect(client.getProjection().nodes[0]?.position.x).toBe(6)
    client.dispose()
  })

  test("accepts undo immediately while the geometry root is still crossing Main's durable barrier", async () => {
    const bridge = transport()
    let releaseSubmit!: () => void
    bridge.submit = mock(async ({ command: submitted }) => {
      await new Promise<void>((resolve) => {
        releaseSubmit = resolve
      })
      const next = projection(submitted.body.updates[0]!.position.x)
      bridge.setProjection(next)
      return { acceptedFrameDigest: frameDigest("d"), operationReceipt: receipt, projection: next }
    })
    bridge.undo = mock(async () => {
      const next = projection(0, { canRedo: true, canUndo: false })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("f"),
        historyTransition: { direction: "undo" as const, rootOperationId: receipt.operationId },
        operationReceipt: receipt,
        projection: next,
      }
    })
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })

    const pendingSubmit = client.submit(command(6))
    expect(client.canUndo()).toBeTrue()
    const pendingUndo = client.undo()
    expect(client.visualOverlay?.getSnapshot().operations[0]?.items).toMatchObject([
      {
        entity: { entityId: entity.id, incarnation: entity.incarnation, kind: "node" },
        kind: "replace-presentation",
        position: { x: 0, y: 0 },
        size: { height: 180, width: 320 },
      },
    ])
    expect(bridge.undo).not.toHaveBeenCalled()

    await Promise.resolve()
    releaseSubmit()
    await pendingSubmit
    await expect(pendingUndo).resolves.toEqual({ direction: "undo", rootOperationId: receipt.operationId })
    expect(bridge.undo).toHaveBeenCalledTimes(1)
    expect(client.getProjection().nodes[0]?.position.x).toBe(0)
    client.dispose()
  })

  test("rolls back a provisional root and suppresses its queued undo when Main rejects the write", async () => {
    const bridge = transport()
    let rejectSubmit!: (error: Error) => void
    bridge.submit = mock(
      async () =>
        new Promise<never>((_resolve, reject) => {
          rejectSubmit = reject
        }),
    )
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })

    const pendingSubmit = client.submit(command(6))
    const pendingUndo = client.undo()
    expect(client.canUndo()).toBeFalse()
    await Promise.resolve()
    rejectSubmit(new Error("durable barrier failed"))

    await expect(pendingSubmit).rejects.toThrow("durable barrier failed")
    await expect(pendingUndo).resolves.toBeNull()
    expect(bridge.undo).not.toHaveBeenCalled()
    expect(client.visualOverlay?.getSnapshot().pendingOperationCount).toBe(0)
    client.dispose()
  })

  test("accepts undo immediately for an opaque application root", async () => {
    const bridge = transport()
    let releaseApplication!: () => void
    bridge.executeApplication = mock(async () => {
      await new Promise<void>((resolve) => {
        releaseApplication = resolve
      })
      const next = projection(0, {
        canUndo: true,
        document: createCanvasDocument({
          id: ref.canvasId,
          nodes: [
            createTextNode({
              id: entity.id,
              label: "Renamed",
              metadata: {},
              position: { x: 0, y: 0 },
              resourceState: { status: "stale" },
            }),
          ],
        }),
      })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("d"),
        affectedNodeIds: [entity.id],
        changed: true as const,
        createdNodeIds: [],
        operationReceipt: receipt,
        projection: next,
        warnings: [],
      }
    })
    let releaseUndo!: () => void
    bridge.undo = mock(async () => {
      await new Promise<void>((resolve) => {
        releaseUndo = resolve
      })
      const next = projection(0, { canRedo: true, canUndo: false })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("f"),
        historyTransition: { direction: "undo" as const, rootOperationId: receipt.operationId },
        operationReceipt: receipt,
        projection: next,
      }
    })
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })

    const pendingApplication = client.executeApplication({
      type: "nodes.setTitle",
      nodeId: entity.id,
      title: "Renamed",
    })
    expect(client.canUndo()).toBeTrue()
    const pendingUndo = client.undo()
    expect(client.visualOverlay?.getSnapshot().operations[0]?.items).toEqual([])
    expect(bridge.undo).not.toHaveBeenCalled()

    await Promise.resolve()
    releaseApplication()
    await pendingApplication
    expect(client.visualOverlay?.getSnapshot().operations[0]?.items).toMatchObject([
      { kind: "replace-presentation", snapshot: { data: { label: "Text" } } },
    ])
    await Promise.resolve()
    releaseUndo()
    await pendingUndo
    expect(bridge.undo).toHaveBeenCalledTimes(1)
    expect(client.getProjection().nodes[0]?.data.label).toBe("Text")
    client.dispose()
  })

  test("undoes an owner-derived resource creation without predicting its entity id", async () => {
    const bridge = transport()
    let releaseResource!: () => void
    const operation = () =>
      new Promise<CanvasResourceAddResult>((resolve) => {
        releaseResource = () => {
          resolve(resourceResult())
        }
      })
    let releaseUndo!: () => void
    bridge.undo = mock(async () => {
      await new Promise<void>((resolve) => {
        releaseUndo = resolve
      })
      const next = projection(0, { canRedo: true, canUndo: false })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("f"),
        historyTransition: { direction: "undo" as const, rootOperationId: receipt.operationId },
        operationReceipt: receipt,
        projection: next,
      }
    })
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })

    const pendingResource = client.runResourceMutation(operation)
    const pendingUndo = client.undo()
    expect(client.visualOverlay?.getSnapshot().operations[0]?.items).toEqual([])

    await Promise.resolve()
    releaseResource()
    await pendingResource
    expect(client.visualOverlay?.getSnapshot().operations[0]?.items).toEqual([
      {
        kind: "hide-entity",
        entity: { entityId: createdEntity.id, incarnation: createdEntity.incarnation, kind: "node" },
      },
    ])
    await Promise.resolve()
    releaseUndo()
    await pendingUndo
    expect(client.getProjection().nodes).toHaveLength(1)
    client.dispose()
  })

  test("publishes redo immediately while the durable undo is still pending", async () => {
    const bridge = transport()
    const client = await openDesktopCanvasRendererSession({ ref, transport: bridge })
    await client.submit(command(6))
    let releaseUndo!: () => void
    bridge.undo = mock(async () => {
      await new Promise<void>((resolve) => {
        releaseUndo = resolve
      })
      const next = projection(0, { canRedo: true, canUndo: false })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("f"),
        historyTransition: { direction: "undo" as const, rootOperationId: receipt.operationId },
        operationReceipt: receipt,
        projection: next,
      }
    })
    bridge.redo = mock(async () => {
      const next = projection(6, { canRedo: false, canUndo: true })
      bridge.setProjection(next)
      return {
        acceptedFrameDigest: frameDigest("e"),
        historyTransition: { direction: "redo" as const, rootOperationId: receipt.operationId },
        operationReceipt: receipt,
        projection: next,
      }
    })

    const pendingUndo = client.undo()
    expect(client.canRedo()).toBeTrue()
    const pendingRedo = client.redo()
    expect(client.visualOverlay?.getSnapshot().operations.at(-1)?.items).toMatchObject([
      {
        entity: { entityId: entity.id, incarnation: entity.incarnation, kind: "node" },
        kind: "replace-presentation",
        position: { x: 6, y: 0 },
        size: { height: 180, width: 320 },
      },
    ])
    await Promise.resolve()
    releaseUndo()
    await pendingUndo
    await pendingRedo
    expect(bridge.redo).toHaveBeenCalledTimes(1)
    expect(client.getProjection().nodes[0]?.position.x).toBe(6)
    client.dispose()
  })

  test("preserves a trailing refresh when another remote frame arrives during query", async () => {
    const bridge = transport()
    let releaseFirst!: () => void
    let first = true
    bridge.query = mock(async () => {
      if (first) {
        first = false
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
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
