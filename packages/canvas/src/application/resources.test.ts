import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode, createTextNode } from "../document"
import { CanvasCommandValidationError, CanvasRevisionConflictError, createCanvasNodeContentGuard } from "./commands"
import {
  CanvasStorageConflictError,
  type CanvasDocumentRepository,
  type CanvasDocumentSaveRequest,
  type CanvasDocumentSnapshot,
} from "./persistence"
import {
  CanvasResourceBusinessService,
  type CanvasResourcePreparationRequest,
  type CanvasResourceSource,
} from "./resources"
import { CanvasApplicationService, CanvasCommandIdConflictError } from "./service"

function source(): CanvasResourceSource {
  return { kind: "host-file", path: "assets/poster.png", sourceId: "poster_source" }
}

describe("canvas resource business service", () => {
  test("prepares serializable sources then applies the shared sizing, placement, relation, and persistence rules", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({
        id: "canvas-main",
        nodes: [createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Anchor" })],
      }),
      storageVersion: "v1",
    }
    const saves: CanvasDocumentSaveRequest[] = []
    const repository: CanvasDocumentRepository = {
      async load() {
        return snapshot
      },
      async save(request) {
        saves.push(request)
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    }
    const preparations: CanvasResourcePreparationRequest[] = []
    const business = new CanvasResourceBusinessService(
      {
        async prepare(request) {
          preparations.push(request)
          return {
            items: [
              {
                height: 500,
                id: "poster_resource",
                kind: "image",
                name: "Poster.png",
                url: "asset://poster",
                width: 1_000,
              },
            ],
            warnings: ["metadata was normalized"],
          }
        },
      },
      new CanvasApplicationService(repository),
    )
    const request = {
      actor: { id: "agent_one", kind: "agent" as const },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "add_poster",
      expectedRevision: 0,
      scopeId: "project-one",
      relation: { anchorNodeIds: ["anchor"], mode: "connect" as const },
      sources: [source()],
    }

    expect(() => JSON.stringify(request.sources)).not.toThrow()
    const result = await business.addResources(request)

    expect(preparations).toEqual([
      {
        canvasId: "canvas-main",
        scopeId: "project-one",
        sources: [{ kind: "host-file", path: "assets/poster.png", sourceId: "poster_source" }],
      },
    ])
    const createdNodeId = result.createdNodeIds[0]!
    expect(result.document).toMatchObject({
      edges: [{ source: "anchor", target: createdNodeId }],
      revision: 1,
    })
    expect(result.document.nodes.find((node) => node.id === createdNodeId)).toMatchObject({
      data: { kind: "image", url: "asset://poster" },
      position: { x: 304, y: 0 },
      style: { height: 160, width: 320 },
    })
    expect(result.storageVersion).toBe("v2")
    expect(result.warnings).toEqual(["metadata was normalized"])
    expect(saves).toHaveLength(1)

    expect(await business.addResources({ ...request, conflictPolicy: "retry" })).toBe(result)
    expect(preparations).toHaveLength(1)
    await expect(business.addResources({ ...request, conflictPolicy: "reject" })).rejects.toBeInstanceOf(
      CanvasCommandIdConflictError,
    )
    await expect(
      business.addResources({
        ...request,
        sources: [{ kind: "remote-url", sourceId: "different", url: "https://example.com/image.png" }],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
  })

  test("does not execute when resource preparation finishes after cancellation", async () => {
    const preparationStarted = Promise.withResolvers<void>()
    const preparationResult = Promise.withResolvers<{
      items: [{ id: string; kind: "text"; text: string }]
    }>()
    let executeCalls = 0
    let queryCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare(request) {
          expect(request.signal).toBe(controller.signal)
          preparationStarted.resolve()
          return preparationResult.promise
        },
      },
      {
        async execute() {
          executeCalls += 1
          throw new Error("A canceled preparation must not execute")
        },
        async query() {
          queryCalls += 1
          throw new Error("A canceled preparation must not query")
        },
      },
    )
    const controller = new AbortController()
    const cancellation = new DOMException("Preparation canceled", "AbortError")
    const operation = business.addResources({
      actor: { id: "agent", kind: "agent" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "canceled-preparation",
      expectedRevision: 0,
      scopeId: "project",
      signal: controller.signal,
      sources: [{ kind: "inline-text", sourceId: "prepared", text: "New resource" }],
    })

    await preparationStarted.promise
    controller.abort(cancellation)
    preparationResult.resolve({ items: [{ id: "prepared", kind: "text", text: "New resource" }] })

    await expect(operation).rejects.toBe(cancellation)
    expect(executeCalls).toBe(0)
    expect(queryCalls).toBe(0)
  })

  test("does not replay a resource command canceled while its conflict query is pending", async () => {
    const conflictQuery = Promise.withResolvers<{ nodes: []; revision: number; storageVersion: string }>()
    const queryStarted = Promise.withResolvers<void>()
    let executeCalls = 0
    let committed = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [{ id: "prepared", kind: "text" as const, text: "New resource" }] }
        },
      },
      {
        async execute() {
          executeCalls += 1
          if (executeCalls === 1) throw new CanvasRevisionConflictError(0, 1)
          committed += 1
          throw new Error("A canceled conflict replay must not execute")
        },
        async query() {
          queryStarted.resolve()
          return conflictQuery.promise
        },
      },
    )
    const controller = new AbortController()
    const cancellation = new DOMException("Conflict replay canceled", "AbortError")
    const operation = business.addResources({
      actor: { id: "agent", kind: "agent" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "canceled-conflict-replay",
      expectedRevision: 0,
      scopeId: "project",
      signal: controller.signal,
      sources: [{ kind: "inline-text", sourceId: "prepared", text: "New resource" }],
    })

    await queryStarted.promise
    controller.abort(cancellation)
    conflictQuery.resolve({ nodes: [], revision: 1, storageVersion: "v1" })

    await expect(operation).rejects.toBe(cancellation)
    expect(executeCalls).toBe(1)
    expect(committed).toBe(0)
  })

  test("rebases a stale resource addition on the latest document without losing an unrelated concurrent edit", async () => {
    const concurrent = createTextNode({ id: "concurrent", position: { x: 0, y: 0 }, text: "Keep me" })
    let snapshot: CanvasDocumentSnapshot = {
      document: { ...createCanvasDocument({ id: "canvas-main", nodes: [concurrent] }), revision: 1 },
      storageVersion: "v1",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return snapshot
      },
      async save(request) {
        saveCalls += 1
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [{ id: "prepared", kind: "text" as const, text: "New resource" }] }
        },
      },
      application,
    )

    const result = await business.addResources({
      actor: { id: "agent", kind: "agent" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "stale-add",
      expectedRevision: 0,
      scopeId: "project",
      sources: [{ kind: "inline-text", sourceId: "prepared", text: "New resource" }],
    })

    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(1)
    expect(result.document.revision).toBe(2)
    expect(result.document.nodes.map((node) => node.id)).toContain("concurrent")
    expect(result.createdNodeIds).toHaveLength(1)
    expect(result.document.nodes.find((node) => node.id === result.createdNodeIds[0])?.position).toEqual({
      x: 304,
      y: 0,
    })
    expect(result.warnings).toContain(
      "Canvas changed while resources were being added; replayed from revision 0 on revision 1 after 1 conflict retry.",
    )
  })

  test("prepares once and reuses generated node ids when a storage conflict requires replay", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main" }),
      storageVersion: "v0",
    }
    let preparationCalls = 0
    const attemptedNodeIds: string[] = []
    let saveCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return snapshot
      },
      async save(request) {
        saveCalls += 1
        const resourceNode = request.document.nodes.find((node) => node.id !== "concurrent")
        attemptedNodeIds.push(resourceNode!.id)
        if (saveCalls === 1) {
          snapshot = {
            document: {
              ...createCanvasDocument({
                id: "canvas-main",
                nodes: [createTextNode({ id: "concurrent", position: { x: 0, y: 0 }, text: "Concurrent" })],
              }),
              revision: 1,
            },
            storageVersion: "v1",
          }
          throw new CanvasStorageConflictError(request.expectedStorageVersion, "v1")
        }
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [{ id: "prepared", kind: "text" as const, text: "New resource" }] }
        },
      },
      application,
    )
    const request = {
      actor: { id: "agent", kind: "agent" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "storage-retry",
      expectedRevision: 0,
      scopeId: "project",
      sources: [{ kind: "inline-text" as const, sourceId: "prepared", text: "New resource" }],
    }

    const result = await business.addResources(request)

    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(2)
    expect(attemptedNodeIds).toEqual([result.createdNodeIds[0], result.createdNodeIds[0]])
    expect(result.document.nodes.map((node) => node.id)).toContain("concurrent")
    expect(result.document.revision).toBe(2)
    expect(result.warnings[0]).toContain("replayed from revision 0 on revision 1")
    expect(await business.addResources(request)).toBe(result)
    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(2)
  })

  test("creates a pending resource without preparation and marks the exact target failed after unrelated edits", async () => {
    const anchor = createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Source" })
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main", nodes: [anchor] }),
      storageVersion: "v0",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          throw new Error("Pending lifecycle must not prepare a fake resource")
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(request) {
          saveCalls += 1
          snapshot = { document: request.document, storageVersion: `v${saveCalls}` }
          return { storageVersion: `v${saveCalls}` }
        },
      }),
    )
    const createRequest = {
      actor: { id: "plugin-host", kind: "host" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "create-pending",
      expectedRevision: 0,
      kind: "image" as const,
      label: "Relit image",
      relation: { anchorNodeIds: [anchor.id], mode: "connect" as const },
      scopeId: "project",
    }

    const created = await business.createPendingResource(createRequest)
    const [pendingNodeId] = created.createdNodeIds
    if (!pendingNodeId) throw new Error("Pending resource node id was not returned")
    const pending = created.document.nodes.find((node) => node.id === pendingNodeId)
    if (!pending) throw new Error("Pending resource node was not created")
    expect(preparationCalls).toBe(0)
    expect(created.document.revision).toBe(1)
    expect(pending).toMatchObject({
      data: { kind: "image", label: "Relit image", status: "pending", url: "" },
      type: "file",
    })
    expect(created.document.edges).toEqual([expect.objectContaining({ source: anchor.id, target: pendingNodeId })])
    expect(await business.createPendingResource(createRequest)).toBe(created)

    snapshot = {
      document: {
        ...created.document,
        nodes: [
          ...created.document.nodes,
          createTextNode({ id: "concurrent", position: { x: 0, y: 400 }, text: "Keep me" }),
        ],
        revision: 2,
      },
      storageVersion: "concurrent-v2",
    }
    const failed = await business.failPendingResource({
      actor: createRequest.actor,
      canvasId: createRequest.canvasId,
      commandId: "fail-pending",
      expectedRevision: created.document.revision,
      expectedTarget: createCanvasNodeContentGuard(pending),
      message: "Generation could not be completed",
      scopeId: createRequest.scopeId,
      targetNodeId: pendingNodeId,
    })

    expect(failed.document.revision).toBe(3)
    expect(failed.document.nodes.map((node) => node.id)).toContain("concurrent")
    expect(failed.document.nodes.find((node) => node.id === pendingNodeId)?.data).toMatchObject({
      error: "Generation could not be completed",
      status: "error",
    })
    expect(failed.warnings[0]).toContain("replayed from revision 1 on revision 2")
    expect(preparationCalls).toBe(0)
  })

  test("does not recreate a pending node removed before a guarded failure replay", async () => {
    const pending = {
      ...createMediaNode({
        id: "pending",
        position: { x: 0, y: 0 },
        resource: { id: "pending", kind: "image" as const, url: "" },
      }),
      data: { kind: "image" as const, label: "Image", status: "pending" as const, url: "" },
    }
    let saveCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [] }
        },
      },
      new CanvasApplicationService({
        async load() {
          return {
            document: { ...createCanvasDocument({ id: "canvas-main" }), revision: 2 },
            storageVersion: "v2",
          }
        },
        async save() {
          saveCalls += 1
          throw new Error("A deleted pending node must not be recreated")
        },
      }),
    )

    await expect(
      business.failPendingResource({
        actor: { id: "plugin-host", kind: "host" },
        canvasId: "canvas-main",
        commandId: "fail-deleted",
        expectedRevision: 1,
        expectedTarget: createCanvasNodeContentGuard(pending),
        message: "Generation could not be completed",
        scopeId: "project",
        targetNodeId: pending.id,
      }),
    ).rejects.toThrow("Canvas node was not found: pending")
    expect(saveCalls).toBe(0)
  })

  test("replaces one guarded resource after an unrelated storage conflict without moving the target", async () => {
    const owner = {
      ...createMediaNode({
        id: "owner",
        position: { x: 80, y: 120 },
        resource: { id: "old", kind: "image" as const, url: "asset://old" },
      }),
      style: { height: 280, width: 440 },
    }
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main", nodes: [owner] }),
      storageVersion: "v0",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return {
            items: [
              {
                durationMs: 5_000,
                id: "prepared-video",
                kind: "video" as const,
                metadata: { source: "generated" },
                url: "asset://video",
              },
            ],
          }
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(request) {
          saveCalls += 1
          if (saveCalls === 1) {
            snapshot = {
              document: {
                ...snapshot.document!,
                nodes: [
                  { ...owner, position: { x: 300, y: 220 }, style: { height: 320, width: 520 } },
                  createTextNode({ id: "concurrent", position: { x: 0, y: 0 }, text: "Keep me" }),
                ],
                revision: 1,
              },
              storageVersion: "v1",
            }
            throw new CanvasStorageConflictError(request.expectedStorageVersion, "v1")
          }
          snapshot = { document: request.document, storageVersion: "v2" }
          return { storageVersion: "v2" }
        },
      }),
    )
    const request = {
      actor: { id: "ui", kind: "ui" },
      canvasId: "canvas-main",
      commandId: "replace-owner",
      expectedRevision: 0,
      expectedTarget: createCanvasNodeContentGuard(owner),
      scopeId: "project",
      source: { kind: "host-file" as const, path: ".convax/assets/generated.mp4", sourceId: "generated" },
      targetNodeId: owner.id,
    }

    const result = await business.replaceResource(request)

    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(2)
    expect(result.createdNodeIds).toEqual([])
    expect(result.affectedNodeIds).toEqual([owner.id])
    expect(result.document.nodes.map((node) => node.id)).toEqual([owner.id, "concurrent"])
    expect(result.document.nodes[0]).toMatchObject({
      data: { kind: "video", metadata: { source: "generated" }, url: "asset://video" },
      id: owner.id,
      position: { x: 300, y: 220 },
      style: { height: 320, width: 520 },
    })
    expect(result.warnings[0]).toContain("replayed from revision 0 on revision 1")
    expect(await business.replaceResource(request)).toBe(result)
    await expect(
      business.addResources({
        actor: request.actor,
        anchor: { x: 0, y: 0 },
        canvasId: request.canvasId,
        commandId: request.commandId,
        expectedRevision: 0,
        scopeId: request.scopeId,
        sources: [request.source],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
  })

  test("rejects replacement preparation cardinality and a target edited during conflict replay", async () => {
    const owner = createTextNode({ id: "owner", position: { x: 0, y: 0 }, text: "Original" })
    const request = {
      actor: { id: "ui", kind: "ui" },
      canvasId: "canvas-main",
      commandId: "replace-owner",
      expectedRevision: 0,
      expectedTarget: createCanvasNodeContentGuard(owner),
      scopeId: "project",
      source: { kind: "inline-text" as const, sourceId: "generated", text: "Generated" },
      targetNodeId: owner.id,
    }
    const neverExecute = {
      async execute() {
        throw new Error("must not execute")
      },
      async query() {
        throw new Error("must not query")
      },
    }
    for (const items of [
      [],
      [
        { id: "one", kind: "text" as const, text: "One" },
        { id: "two", kind: "text" as const, text: "Two" },
      ],
    ]) {
      const business = new CanvasResourceBusinessService(
        {
          async prepare() {
            return { items }
          },
        },
        neverExecute,
      )
      await expect(business.replaceResource(request)).rejects.toThrow("exactly one item")
    }

    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main", nodes: [owner] }),
      storageVersion: "v0",
    }
    let saveCalls = 0
    const changedTarget = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [{ id: "generated", kind: "text", text: "Generated" }] }
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(saveRequest) {
          saveCalls += 1
          snapshot = {
            document: {
              ...snapshot.document!,
              nodes: [{ ...owner, data: { ...owner.data, text: "User edit" } }],
              revision: 1,
            },
            storageVersion: "v1",
          }
          throw new CanvasStorageConflictError(saveRequest.expectedStorageVersion, "v1")
        },
      }),
    )

    await expect(changedTarget.replaceResource(request)).rejects.toThrow("content changed")
    expect(saveCalls).toBe(1)
  })

  test.each([
    ["revision", () => new CanvasRevisionConflictError(0, 1)],
    ["storage", () => new CanvasStorageConflictError("v0", "v1")],
  ] as const)("reject policy does not replay a %s conflict", async (_kind, createConflict) => {
    let executeCalls = 0
    let queryCalls = 0
    let preparationCalls = 0
    const conflict = createConflict()
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [{ id: "prepared", kind: "text" as const, text: "New resource" }] }
        },
      },
      {
        async execute() {
          executeCalls += 1
          throw conflict
        },
        async query() {
          queryCalls += 1
          throw new Error("Reject policy must not query for a replay revision")
        },
      },
    )

    await expect(
      business.addResources({
        actor: { id: "plugin-card", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: `reject-${_kind}`,
        conflictPolicy: "reject",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "inline-text", sourceId: "prepared", text: "New resource" }],
      }),
    ).rejects.toBe(conflict)
    expect(preparationCalls).toBe(1)
    expect(executeCalls).toBe(1)
    expect(queryCalls).toBe(0)
  })

  test("rejects a replay when a concurrent edit removed a required relation anchor", async () => {
    let saveCalls = 0
    let preparationCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return {
          document: { ...createCanvasDocument({ id: "canvas-main" }), revision: 1 },
          storageVersion: "v1",
        }
      },
      async save() {
        saveCalls += 1
        throw new Error("The invalid replay must not be saved")
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [{ id: "prepared", kind: "text" as const, text: "New resource" }] }
        },
      },
      application,
    )

    await expect(
      business.addResources({
        actor: { id: "agent", kind: "agent" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "deleted-anchor",
        expectedRevision: 0,
        relation: { anchorNodeIds: ["anchor"], mode: "connect" },
        scopeId: "project",
        sources: [{ kind: "inline-text", sourceId: "prepared", text: "New resource" }],
      }),
    ).rejects.toThrow("Canvas node was not found: anchor")
    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(0)
  })

  test("stops after two conflict retries", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main" }),
      storageVersion: "v0",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return snapshot
      },
      async save(request) {
        saveCalls += 1
        const current = snapshot.document!
        snapshot = {
          document: {
            ...current,
            nodes: [
              ...current.nodes,
              createTextNode({
                id: `concurrent-${saveCalls}`,
                position: { x: saveCalls * 20, y: 0 },
                text: "Concurrent",
              }),
            ],
            revision: current.revision + 1,
          },
          storageVersion: `v${saveCalls}`,
        }
        throw new CanvasStorageConflictError(request.expectedStorageVersion, snapshot.storageVersion)
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [{ id: "prepared", kind: "text" as const, text: "New resource" }] }
        },
      },
      application,
    )

    await expect(
      business.addResources({
        actor: { id: "agent", kind: "agent" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "retry-limit",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "inline-text", sourceId: "prepared", text: "New resource" }],
      }),
    ).rejects.toBeInstanceOf(CanvasStorageConflictError)
    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(3)
    expect(snapshot.document?.nodes.map((node) => node.id)).toEqual(["concurrent-1", "concurrent-2", "concurrent-3"])
  })

  test("validates sources before preparation and rejects invalid prepared resources", async () => {
    let preparationCalls = 0
    const application = {
      execute() {
        throw new Error("application should not run")
      },
      query() {
        throw new Error("application should not run")
      },
    }
    const invalidSources = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [] }
        },
      },
      application,
    )
    await expect(
      invalidSources.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas",
        commandId: "invalid_sources",
        expectedRevision: 0,
        scopeId: "project",
        sources: [
          { kind: "host-file", path: "one.png", sourceId: "duplicate" },
          { kind: "host-file", path: "two.png", sourceId: "duplicate" },
        ],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandValidationError)
    expect(preparationCalls).toBe(0)

    const invalidPreparation = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [{ id: "broken", kind: "image", url: "asset://broken", width: -1 }] }
        },
      },
      application,
    )
    await expect(
      invalidPreparation.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas",
        commandId: "invalid_preparation",
        expectedRevision: 0,
        scopeId: "project",
        sources: [source()],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandValidationError)
  })
})
