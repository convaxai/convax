import { describe, expect, mock, test } from "bun:test"
import {
  executeCanvasApplicationCommand,
  type CanvasApplicationCommandRequest,
} from "@convax/canvas/application"
import { createCanvasDocument, createMediaNode, createTextNode } from "@convax/canvas/core"

import { projectResourceReferenceKey } from "@convax/project/canvas"
import type {
  PluginCanvasChangeEvent,
  PluginCanvasEventSubscription,
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
import { canvasOperationReceipt } from "./canvas-application-test-fixtures"

const principal: PluginPrincipal = {
  activeRevision: 7,
  activeSetDigest: "b".repeat(64),
  manifestDigest: "a".repeat(64),
  pluginId: "layout-tools",
  pluginVersion: "1.0.0",
  runtime: "tool",
  snapshotDigest: "c".repeat(64),
}

const installed: ResolvedPluginPrincipal = {
  activeRevision: principal.activeRevision,
  activeSetDigest: principal.activeSetDigest,
  capabilities: [
    "projects.read",
    "canvas.catalog.read",
    "canvas.document.read",
    "canvas.document.write",
    "canvas.events.subscribe",
  ],
  hostApi: {
    major: 3,
    optional: [],
    required: [
      "projects.list",
      "canvas.catalog.list",
      "canvas.document.get",
      "canvas.nodes.query",
      "canvas.transaction.execute",
      "canvas.events.subscribe",
      "canvas.events.unsubscribe",
    ],
  },
  manifestDigest: principal.manifestDigest,
  pluginId: principal.pluginId,
  pluginVersion: principal.pluginVersion,
  snapshotDigest: principal.snapshotDigest,
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
  const mutationRun = mock((_ref: unknown) => undefined)
  const mutationSignal = mock((_signal: AbortSignal | undefined) => undefined)
  const documentRead = mock((_ref: unknown) => undefined)
  const applicationTransactions = mock(
    async (request: CanvasApplicationCommandRequest) => {
      mutationRun({ canvasId: request.canvasId, projectId: request.scopeId })
      mutationSignal(request.signal)
      await beforeMutation?.()
      if (request.signal?.aborted) {
        throw request.signal.reason ?? new DOMException("Canvas operation was canceled", "AbortError")
      }
      const result = executeCanvasApplicationCommand(document, request.envelope)
      document = structuredClone(result.document)
      return {
        ...result,
        operationReceipt: canvasOperationReceipt(request.envelope.commandId, request.envelope.actor.id),
      }
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
      execute: applicationTransactions,
      async query(ref) {
        documentRead(ref)
        beforeRead?.()
        return { nodes: [], projection: structuredClone(document) }
      },
    },
    canvases: {
      async getCanvasCatalog({ projectId }) {
        if (projectId !== "project-one") throw new Error("Project not found")
        const route = {
          activationDigest: "a".repeat(64),
          canvasId: document.id,
          routeProjectionDigest: "b".repeat(64),
          shardEpoch: "AAAAAAAAAAAAAAAAAAAAAA",
          state: "live",
          title: "Main",
        }
        const visibleCanvases = canvasCatalogued ? [route] : []
        return {
          format: "convax.project-canvas-catalog-projection",
          projectEpoch: "BBBBBBBBBBBBBBBBBBBBBB",
          projectId,
          routes: visibleCanvases,
          visibleCanvases,
        } as never
      },
    },
    changes,
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
      canvases: [{ id: "canvas-main", name: "Main" }],
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

  test("injects the Plugin actor and commits one typed document command through Main", async () => {
    const { document, mutationRun, published, service } = fixture()
    const client = await service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })
    const result = await client.transact({
      command: {
        type: "nodes.setGeometry",
        updates: [{ nodeId: "image", position: { x: 100, y: 200 } }],
      },
      commandId: "arrange-1",
      ref: { canvasId: "canvas-main", projectId: "project-one" },
    })

    expect(mutationRun).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      changed: true,
      operationReceipt: expect.objectContaining({ operationId: "arrange-1" }),
    })
    expect(document().nodes.find((node) => node.id === "image")?.position).toEqual({ x: 100, y: 200 })
    expect(published).toEqual([
      {
        operationReceipt: canvasOperationReceipt("arrange-1", principal.pluginId),
        ref: { canvasId: "canvas-main", projectId: "project-one" },
        source: "plugin",
      },
    ])
  })

  test("keeps a committed command successful when invalidation publication fails", async () => {
    const current = fixture()
    const client = await current.service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })
    current.rejectPublication()

    await expect(
      client.transact({
        command: { type: "nodes.move", delta: { x: 2, y: 3 }, nodeIds: ["note"] },
        commandId: "publish-failure-after-commit",
        ref: { canvasId: "canvas-main", projectId: "project-one" },
      }),
    ).resolves.toMatchObject({ changed: true })
    expect(current.document().nodes.find(({ id }) => id === "note")?.position).toEqual({ x: 402, y: 23 })
  })

  test("rejects resource commands even if an untyped transport tries to smuggle one into a document transaction", async () => {
    const { service } = fixture()
    const client = await service.connect({ principal, scope: { kind: "project", projectId: "project-one" } })
    await expect(
      client.transact({
        command: { type: "resources.add" } as never,
        commandId: "forged-resource",
        ref: { canvasId: "canvas-main", projectId: "project-one" },
      }),
    ).rejects.toThrow("cannot mutate resource references")
    await expect(
      client.transact({
        command: { type: "nodes.move", delta: { x: 0, y: 0 }, nodeIds: ["note"] },
        commandId: "",
        ref: { canvasId: "canvas-main", projectId: "project-one" },
      }),
    ).rejects.toThrow("command id")
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
        command: { type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["note"] },
        commandId: "stale-catalog",
        ref: { canvasId: "canvas-main", projectId: "project-one" },
      }),
    ).rejects.toThrow("Canvas was not found")
    expect(mutation.document().nodes.find(({ id }) => id === "note")?.position).toEqual({ x: 400, y: 20 })

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
          command: { type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["note"] },
          commandId: "canceled-while-queued",
          ref: { canvasId: "canvas-main", projectId: "project-one" },
        },
        controller.signal,
      ),
    ).rejects.toThrow("Plugin Canvas capability request was canceled")

    expect(current.applicationTransactions).not.toHaveBeenCalled()
    expect(current.document().nodes.find(({ id }) => id === "note")?.position).toEqual({ x: 400, y: 20 })
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
        command: { type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["note"] },
        commandId: "tool-signal-to-application",
        ref: { canvasId: "canvas-main", projectId: "project-one" },
      },
      controller.signal,
    )

    expect(current.applicationTransactions).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }))
    expect(current.document().nodes.find(({ id }) => id === "note")?.position).toEqual({ x: 401, y: 21 })
  })

  test("deduplicates operation events and closes when their Canvas leaves the live catalog", async () => {
    const current = fixture()
    const client = await current.service.connect({ principal, scope: { kind: "all-bound-projects" } })
    const events: PluginCanvasChangeEvent[] = []
    await client.subscribe({ projectId: "project-one" }, (event) => events.push(event))
    const event = (operationId: string): PluginCanvasChangeEvent => ({
      operationReceipt: canvasOperationReceipt(operationId),
      ref: { canvasId: "canvas-main", projectId: "project-one" },
      source: "host",
    })

    current.emitChange(event("operation-2"))
    current.emitChange(event("operation-2"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events.map(({ operationReceipt }) => String(operationReceipt.operationId))).toEqual(["operation-2"])

    current.removeCanvas()
    current.emitChange(event("operation-3"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events.map(({ operationReceipt }) => String(operationReceipt.operationId))).toEqual(["operation-2"])
  })
})
