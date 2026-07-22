import { describe, expect, mock, test } from "bun:test"
import { CanvasApplicationService, CanvasStorageConflictError } from "@convax/canvas/application"
import { createCanvasDocument, createMediaNode, createTextNode } from "@convax/canvas/core"

import { projectResourceReferenceKey } from "@convax/project/canvas"
import type {
  PluginCanvasChangeEvent,
  PluginCanvasEventSubscription,
  PluginCanvasRef,
  PluginPrincipal,
  ResolvedPluginPrincipal,
} from "../plugin-capability-contracts"
import {
  PluginCanvasCapabilityService,
  PluginCapabilityDeniedError,
  PluginConnectionInvalidError,
  PluginProjectScopeError,
  type PluginCanvasChangeBus,
} from "./plugin-canvas-capability-service"

const principal: PluginPrincipal = {
  manifestDigest: "a".repeat(64),
  pluginId: "layout-tools",
  pluginVersion: "1.0.0",
  runtime: "tool",
}

const installed: ResolvedPluginPrincipal = {
  capabilities: [
    "projects.read",
    "canvas.catalog.read",
    "canvas.document.read",
    "canvas.document.write",
    "canvas.events.subscribe",
  ],
  manifestDigest: principal.manifestDigest,
  pluginId: principal.pluginId,
  pluginVersion: principal.pluginVersion,
}

function fixture(
  capabilities: ResolvedPluginPrincipal["capabilities"] = installed.capabilities,
  limits: { maximumDocumentBytes?: number } = {},
) {
  let beforeMutation: (() => void | Promise<void>) | undefined
  let beforeRead: (() => void) | undefined
  let canvasCatalogued = true
  let currentPrincipal: ResolvedPluginPrincipal | null = { ...installed, capabilities }
  let projectBound = true
  let publishFailure = false
  let storageVersion = "storage-1"
  let document = createCanvasDocument({
    id: "canvas-main",
    title: "Main",
    nodes: [
      createMediaNode({
        id: "image",
        position: { x: 10, y: 20 },
        resource: {
          id: "image-resource",
          kind: "image",
          metadata: {
            [projectResourceReferenceKey]: { kind: "project-file", path: "Assets/reference.png" },
          },
          mimeType: "image/png",
          name: "reference.png",
          state: { status: "ready", url: "data:image/png;base64,SECRET_BYTES" },
        },
      }),
      createTextNode({
        id: "note",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/note.md" } },
        position: { x: 400, y: 20 },
        resourceState: { status: "ready", text: "Arrange these cards" },
      }),
    ],
  })
  const repository = {
    async load(ref: { canvasId: string; scopeId: string }) {
      if (ref.scopeId !== "project-one" || ref.canvasId !== document.id) return { document: null, storageVersion: null }
      return { document: structuredClone(document), storageVersion }
    },
    async save(request: {
      document: typeof document
      expectedStorageVersion: string | null
      ref: { canvasId: string; scopeId: string }
    }) {
      if (request.expectedStorageVersion !== storageVersion) {
        throw new CanvasStorageConflictError(request.expectedStorageVersion, storageVersion)
      }
      document = structuredClone(request.document)
      storageVersion = `storage-${Number(storageVersion.split("-")[1]) + 1}`
      return { storageVersion }
    },
  }
  const application = new CanvasApplicationService(repository)
  const mutationRun = mock((_ref: unknown) => undefined)
  const mutationSignal = mock((_signal: AbortSignal | undefined) => undefined)
  const documentRead = mock((_ref: unknown) => undefined)
  const applicationTransactions = mock(
    async (request: Parameters<CanvasApplicationService["executeTransaction"]>[0]) => {
      mutationRun({ canvasId: request.canvasId, projectId: request.scopeId })
      mutationSignal(request.signal)
      await beforeMutation?.()
      return application.executeTransaction(request)
    },
  )
  const listeners = new Set<(event: PluginCanvasChangeEvent) => void>()
  const published: PluginCanvasChangeEvent[] = []
  const changes: PluginCanvasChangeBus = {
    publish(event) {
      if (publishFailure) throw new Error("subscriber failed")
      published.push(structuredClone(event))
      for (const listener of listeners) listener(event)
    },
    subscribe(filter, listener): PluginCanvasEventSubscription {
      const filtered = (event: PluginCanvasChangeEvent) => {
        if (event.ref.projectId !== filter.projectId) return
        if ("canvasId" in filter && event.ref.canvasId !== filter.canvasId) return
        listener(event)
      }
      listeners.add(filtered)
      return { close: () => listeners.delete(filtered) }
    },
  }
  const service = new PluginCanvasCapabilityService({
    application: {
      executeTransaction: applicationTransactions,
      query: (ref, query) => application.query(ref, query),
    },
    canvases: {
      async getCanvasCatalog({ projectId }) {
        if (projectId !== "project-one") throw new Error("Project not found")
        return {
          canvases: canvasCatalogued ? [{ createdAt: 1, id: document.id, name: "Main", updatedAt: 2 }] : [],
          projectId,
        }
      },
    },
    changes,
    documents: {
      async load(ref) {
        documentRead(ref)
        beforeRead?.()
        return repository.load(ref)
      },
      save: (request) => repository.save(request),
    },
    ...(limits.maximumDocumentBytes === undefined ? {} : { maximumDocumentBytes: limits.maximumDocumentBytes }),
    plugins: {
      async resolve(input) {
        if (input.pluginId !== principal.pluginId) return null
        return currentPrincipal
      },
    },
    projects: {
      async list() {
        return projectBound
          ? [
              {
                createdAt: 1,
                id: "project-one",
                lastOpenedAt: 2,
                name: "Project One",
                rootPath: "/private/native/path",
              },
              {
                createdAt: 1,
                id: "project-missing",
                lastOpenedAt: 2,
                missing: true,
                name: "Missing",
                rootPath: "/private/missing/path",
              },
            ]
          : []
      },
    },
  })
  return {
    abortMutationWhileQueued: (controller: AbortController) => {
      beforeMutation = () => controller.abort("stopped")
    },
    applicationTransactions,
    document: () => document,
    documentRead,
    evictCanvasWhileQueued: () => {
      beforeMutation = () => {
        canvasCatalogued = false
      }
    },
    emitChange: (event: PluginCanvasChangeEvent) => {
      for (const listener of listeners) listener(event)
    },
    evictProjectWhileReadQueued: () => {
      beforeRead = () => {
        projectBound = false
      }
    },
    unbindProject: () => {
      projectBound = false
    },
    invalidate: () => {
      currentPrincipal = null
    },
    mutationRun,
    mutationSignal,
    published,
    rejectPublication: () => {
      publishFailure = true
    },
    removeCanvas: () => {
      canvasCatalogued = false
    },
    service,
  }
}

describe("PluginCanvasCapabilityService", () => {
  test("exposes pathless Project summaries and all Canvases through a principal-bound client", async () => {
    const { service } = fixture()
    const client = await service.connect({ principal, scope: { kind: "all-bound-projects" } })

    const projects = await client.listProjects()
    expect(projects).toEqual([
      { available: true, id: "project-one", name: "Project One" },
      { available: false, id: "project-missing", name: "Missing" },
    ])
    expect(JSON.stringify(projects)).not.toContain("rootPath")
    expect(await client.listCanvases("project-one")).toEqual({
      canvases: [{ createdAt: 1, id: "canvas-main", name: "Main", updatedAt: 2 }],
      projectId: "project-one",
    })
  })

  test("keeps geometry byte-free and exposes only portable resource refs in the structure projection", async () => {
    const { service } = fixture()
    const client = await service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })
    const ref = { canvasId: "canvas-main", projectId: "project-one" }

    const geometry = await client.getDocument(ref, "geometry")
    expect(JSON.stringify(geometry)).not.toContain("Assets/reference.png")
    expect(JSON.stringify(geometry)).not.toContain("SECRET_BYTES")
    expect(geometry.document.nodes[0]).toMatchObject({
      id: "image",
      kind: "image",
      position: { x: 10, y: 20 },
    })

    const structure = await client.getDocument(ref, "structure")
    expect(structure.document.nodes[0]).toMatchObject({
      id: "image",
      resource: { kind: "project-file", path: "Assets/reference.png" },
    })
    expect(JSON.stringify(structure)).not.toContain("SECRET_BYTES")
  })

  test("bounds compact node-query responses at the transport-neutral broker", async () => {
    const { service } = fixture(installed.capabilities, { maximumDocumentBytes: 128 })
    const client = await service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })

    await expect(client.queryNodes({ canvasId: "canvas-main", projectId: "project-one" })).rejects.toThrow(
      "node query response exceeds 128 bytes",
    )
  })

  test("injects the Plugin actor and commits an atomic document transaction through Main", async () => {
    const { document, mutationRun, published, service } = fixture()
    const client = await service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })
    const result = await client.transact({
      commands: [
        {
          type: "nodes.setGeometry",
          updates: [{ nodeId: "image", position: { x: 100, y: 200 } }],
        },
        { type: "nodes.connect", connection: { source: "image", target: "note" } },
      ],
      expectedRevision: 0,
      ref: { canvasId: "canvas-main", projectId: "project-one" },
      transactionId: "arrange-1",
    })

    expect(mutationRun).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ changed: true, revision: 1, storageVersion: "storage-2" })
    expect(document().revision).toBe(1)
    expect(document().nodes.find((node) => node.id === "image")?.position).toEqual({ x: 100, y: 200 })
    expect(document().edges).toHaveLength(1)
    expect(published).toEqual([
      {
        ref: { canvasId: "canvas-main", projectId: "project-one" },
        revision: 1,
        source: "plugin",
      },
    ])
  })

  test("keeps a committed transaction successful when revision publication fails", async () => {
    const current = fixture()
    const client = await current.service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })
    current.rejectPublication()

    await expect(
      client.transact({
        commands: [{ type: "nodes.move", delta: { x: 2, y: 3 }, nodeIds: ["note"] }],
        expectedRevision: 0,
        ref: { canvasId: "canvas-main", projectId: "project-one" },
        transactionId: "publish-failure-after-commit",
      }),
    ).resolves.toMatchObject({ changed: true, revision: 1 })
    expect(current.document().revision).toBe(1)
  })

  test("rejects resource commands even if an untyped transport tries to smuggle one into a document transaction", async () => {
    const { service } = fixture()
    const client = await service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })
    await expect(
      client.transact({
        commands: [{ type: "resources.add" }] as never,
        expectedRevision: 0,
        ref: { canvasId: "canvas-main", projectId: "project-one" },
        transactionId: "forged-resource",
      }),
    ).rejects.toThrow("cannot mutate resource references")
    await expect(
      client.transact({
        commands: [],
        expectedRevision: 0,
        ref: { canvasId: "canvas-main", projectId: "project-one" },
        transactionId: "empty",
      }),
    ).rejects.toThrow("at least one command")
  })

  test("fails closed on missing grants, scope widening, update, or uninstall", async () => {
    const denied = fixture(["canvas.document.read"])
    const deniedClient = await denied.service.connect({
      principal,
      scope: { kind: "project", projectId: "project-one" },
    })
    await expect(deniedClient.listCanvases("project-one")).rejects.toBeInstanceOf(PluginCapabilityDeniedError)
    await expect(deniedClient.getDocument({ canvasId: "canvas-main", projectId: "other" })).rejects.toBeInstanceOf(
      PluginProjectScopeError,
    )

    const current = fixture()
    const client = await current.service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })
    current.invalidate()
    await expect(client.queryNodes({ canvasId: "canvas-main", projectId: "project-one" })).rejects.toBeInstanceOf(
      PluginConnectionInvalidError,
    )
  })

  test("checks Project and Canvas authority directly in Main", async () => {
    const mutation = fixture()
    const mutationClient = await mutation.service.connect({
      principal,
      scope: { kind: "project", projectId: "project-one" },
    })
    mutation.removeCanvas()
    await expect(
      mutationClient.transact({
        commands: [{ type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["note"] }],
        expectedRevision: 0,
        ref: { canvasId: "canvas-main", projectId: "project-one" },
        transactionId: "stale-catalog",
      }),
    ).rejects.toThrow("Canvas was not found")
    expect(mutation.document().revision).toBe(0)

    const read = fixture()
    const readClient = await read.service.connect({
      principal,
      scope: { kind: "project", projectId: "project-one" },
    })
    read.unbindProject()
    await expect(
      readClient.getDocument({
        canvasId: "canvas-main",
        projectId: "project-one",
      }),
    ).rejects.toBeInstanceOf(PluginProjectScopeError)
  })

  test("rejects canceled Tool work before the Canvas application executes", async () => {
    const current = fixture()
    const client = await current.service.connect({
      principal,
      scope: { kind: "project", projectId: "project-one" },
    })
    const controller = new AbortController()
    controller.abort("stopped")

    await expect(
      client.transact(
        {
          commands: [{ type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["note"] }],
          expectedRevision: 0,
          ref: { canvasId: "canvas-main", projectId: "project-one" },
          transactionId: "canceled-while-queued",
        },
        controller.signal,
      ),
    ).rejects.toThrow("Plugin Canvas capability request was canceled")

    expect(current.applicationTransactions).not.toHaveBeenCalled()
    expect(current.document().revision).toBe(0)
    expect(current.published).toEqual([])
  })

  test("passes a live Tool signal into the atomic Canvas application transaction", async () => {
    const current = fixture()
    const client = await current.service.connect({
      principal,
      scope: { kind: "project", projectId: "project-one" },
    })
    const controller = new AbortController()

    await client.transact(
      {
        commands: [{ type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["note"] }],
        expectedRevision: 0,
        ref: { canvasId: "canvas-main", projectId: "project-one" },
        transactionId: "tool-signal-to-application",
      },
      controller.signal,
    )

    expect(current.applicationTransactions).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
    expect(current.document().revision).toBe(1)
  })

  test("serializes revision events and closes when their Canvas leaves the live catalog", async () => {
    const current = fixture()
    const client = await current.service.connect({ principal, scope: { kind: "all-bound-projects" } })
    const events: PluginCanvasChangeEvent[] = []
    await client.subscribe({ projectId: "project-one" }, (event) => events.push(event))
    const event = (revision: number): PluginCanvasChangeEvent => ({
      ref: { canvasId: "canvas-main", projectId: "project-one" },
      revision,
      source: "host",
    })

    current.emitChange(event(2))
    current.emitChange(event(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events.map(({ revision }) => revision)).toEqual([2])

    current.removeCanvas()
    current.emitChange(event(3))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events.map(({ revision }) => revision)).toEqual([2])
  })
})
