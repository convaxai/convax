import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
  AgentClient,
  AgentRuntime,
  AgentRuntimeDirectoryInput,
  AgentRuntimeListSessionsInput,
} from "@convax/agent-runtime"
import {
  CanvasApplicationService,
  CanvasResourceBusinessService,
  executeCanvasApplicationCommand,
  type CanvasApplicationCommandRequest,
} from "@convax/canvas/application"
import { createCanvasDocument } from "@convax/canvas/core"
import type { BoundedOperationReceiptV2 } from "@convax/canvas/collaboration"
import {
  parseActorId,
  parseDigest,
  parseId128,
} from "@convax/collaboration"
import type { CanvasRendererDocumentClient } from "../canvas-document-contracts"
import type { ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvas, ProjectCanvasCatalog, ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectFilesClient } from "@convax/project-files"
import type { CanvasExternalMediaDragRendererClient } from "../canvas-external-drag-contracts"
import type { CanvasResourceClient } from "../desktop-protocol"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"

type InvokeHandler = (event: unknown, input?: unknown) => unknown
type DesktopBridge = {
  agent: AgentClient
  canvas: {
    documents: CanvasRendererDocumentClient
    externalMediaDrag: CanvasExternalMediaDragRendererClient
    resources: CanvasResourceClient
  }
  projectFiles: ProjectFilesClient
  projects: ProjectLifecycleClient & { canvases: ProjectCanvasClient }
}

const handlers = new Map<string, InvokeHandler>()
const rendererListeners = new Map<string, Set<(...args: unknown[]) => void>>()
const rendererSends: Array<{ channel: string; input: unknown }> = []
const trustedEvent = { sender: { id: 1 }, senderFrame: { url: "file:///convax/index.html" } }
const operationReceipt: BoundedOperationReceiptV2 = {
  format: "convax.canvas-operation-receipt/2",
  actorId: parseActorId("A".repeat(43)),
  operationId: parseId128("A".repeat(22)),
  intentDigest: parseDigest("d".repeat(64)),
  baseFrontierDigest: parseDigest("e".repeat(64)),
  intentKind: "canvas.nodes.set-geometry/2",
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigest("f".repeat(64)),
}
let exposedBridge: DesktopBridge | undefined
let selectedProjectPath = ""
let selectedLocalFilePath = ""

beforeEach(() => {
  configureElectronMock({
    BrowserWindow: {
      fromWebContents: () => undefined,
      getAllWindows: () => [],
    },
    contextBridge: {
      exposeInMainWorld: (name: string, value: DesktopBridge) => {
        if (name === "convax") exposedBridge = value
      },
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [selectedProjectPath] }),
    },
    ipcMain: {
      handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    ipcRenderer: {
      invoke: (channel: string, input?: unknown) => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error(`No main-process handler registered for ${channel}`)
        return handler(trustedEvent, input)
      },
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        const listeners = rendererListeners.get(channel) ?? new Set()
        listeners.add(listener)
        rendererListeners.set(channel, listeners)
      },
      removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
        rendererListeners.get(channel)?.delete(listener)
      },
      send: (channel: string, input: unknown) => rendererSends.push({ channel, input }),
    },
    shell: {
      openPath: async () => "",
      showItemInFolder: () => undefined,
    },
    webUtils: {
      getPathForFile: () => selectedLocalFilePath,
    },
  })
})

let temporaryRoot = ""
let disposeIpc: Array<() => void> = []

afterEach(async () => {
  disposeIpc
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
  handlers.clear()
  rendererListeners.clear()
  rendererSends.length = 0
  exposedBridge = undefined
  selectedProjectPath = ""
  selectedLocalFilePath = ""
  resetElectronMock()
  if (temporaryRoot) await fs.rm(temporaryRoot, { force: true, recursive: true })
  temporaryRoot = ""
})

describe("desktop Project lifecycle IPC smoke", () => {
  test("opens an existing folder and creates a default-workspace project through the preload bridge", async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-desktop-open-project-"))
    selectedProjectPath = path.join(temporaryRoot, "empty-project")
    await fs.mkdir(selectedProjectPath)

    const {
      NodeProjectManager,
      ProjectCanvasResourceHydrator,
      ProjectCanvasResourcePreparation,
      ProjectFilePublisher,
      ProjectManagedAssetStore,
    } = await import("@convax/project/node")
    const [
      { registerAgentIpc },
      { registerCanvasDocumentIpc, registerCanvasResourceIpc },
      { registerProjectIpc },
      { registerProjectCanvasIpc },
    ] = await Promise.all([
      import("./agent-ipc"),
      import("./canvas-document-ipc"),
      import("./project-ipc"),
      import("./project-canvas-ipc"),
    ])

    const projects = new NodeProjectManager({
      registryFile: path.join(temporaryRoot, "user-data", "projects.json"),
    })
    const assets = new ProjectManagedAssetStore(projects)
    const canvasCatalogs = new Map<string, ProjectCanvasCatalog>()
    const getCanvasCatalog = (projectId: string): ProjectCanvasCatalog => {
      const existing = canvasCatalogs.get(projectId)
      if (existing) return structuredClone(existing)
      const canvas: ProjectCanvas = { createdAt: 1, id: "canvas-main", name: "Canvas 1", updatedAt: 1 }
      const created: ProjectCanvasCatalog = { canvases: [canvas], creationAvailability: "available", projectId }
      canvasCatalogs.set(projectId, created)
      return structuredClone(created)
    }
    const canvases = {
      async createCanvas(input: { name?: string; projectId: string }) {
        const catalog = getCanvasCatalog(input.projectId)
        const canvas: ProjectCanvas = {
          createdAt: 2,
          id: `canvas-${catalog.canvases.length + 1}`,
          name: input.name ?? "Canvas",
          updatedAt: 2,
        }
        catalog.canvases.push(canvas)
        canvasCatalogs.set(input.projectId, catalog)
        return { canvas: structuredClone(canvas), catalog: structuredClone(catalog) }
      },
      async deleteCanvas(input: { canvasId: string; projectId: string }) {
        const catalog = getCanvasCatalog(input.projectId)
        const next = catalog.canvases.filter((canvas) => canvas.id !== input.canvasId)
        const deleted = next.length !== catalog.canvases.length
        const updated = { ...catalog, canvases: next }
        canvasCatalogs.set(input.projectId, updated)
        return { deleted, catalog: structuredClone(updated) }
      },
      async getCanvasCatalog(input: { projectId: string }) {
        return getCanvasCatalog(input.projectId)
      },
      async renameCanvas(input: { canvasId: string; name: string; projectId: string }) {
        const catalog = getCanvasCatalog(input.projectId)
        const canvas = catalog.canvases.find((candidate) => candidate.id === input.canvasId)
        if (!canvas) throw new Error("Canvas was not found")
        const renamed = { ...canvas, name: input.name, updatedAt: 3 }
        const updated = {
          ...catalog,
          canvases: catalog.canvases.map((candidate) => (candidate.id === input.canvasId ? renamed : candidate)),
        }
        canvasCatalogs.set(input.projectId, updated)
        return { canvas: structuredClone(renamed), catalog: structuredClone(updated) }
      },
    }
    const canvasDocuments = new Map<string, ReturnType<typeof createCanvasDocument>>()
    const collaboration = {
      async query(ref: { canvasId: string; scopeId: string }) {
        const key = `${ref.scopeId}:${ref.canvasId}`
        const projection = canvasDocuments.get(key) ?? createCanvasDocument({ id: ref.canvasId })
        canvasDocuments.set(key, projection)
        return { nodes: [], projection: structuredClone(projection) }
      },
      async submit(request: CanvasApplicationCommandRequest) {
        const key = `${request.scopeId}:${request.canvasId}`
        const current = canvasDocuments.get(key) ?? createCanvasDocument({ id: request.canvasId })
        const result = executeCanvasApplicationCommand(current, request.envelope)
        canvasDocuments.set(key, structuredClone(result.document))
        return { ...result, operationReceipt }
      },
    }
    const resourcePreparation = new ProjectCanvasResourcePreparation(
      projects,
      new ProjectFilePublisher(projects, assets),
      assets,
    )
    const canvasApplication = new CanvasApplicationService(collaboration)
    const canvasResources = new CanvasResourceBusinessService(resourcePreparation, canvasApplication)
    const canvasHydrator = new ProjectCanvasResourceHydrator(
      projects,
      assets,
      ({ reference }) => `convax-resource://${reference.kind}`,
    )
    let listSessionsInput: AgentRuntimeListSessionsInput | undefined
    let listModelsInput: AgentRuntimeDirectoryInput | undefined
    const activity = {
      aborted: mock(async () => undefined),
      permissionReplied: mock(async () => undefined),
      promptSettled: mock(async () => undefined),
      promptStarted: mock(async () => undefined),
      questionReplied: mock(async () => undefined),
    }
    const runtime = {
      abort: async () => undefined,
      listModels: async (input: AgentRuntimeDirectoryInput) => {
        listModelsInput = input
        return {
          providers: [
            {
              connected: true,
              defaultModelId: "free-model",
              models: [{ default: true, modelId: "free-model", modelName: "Free model" }],
              providerId: "opencode",
              providerName: "OpenCode",
            },
          ],
        }
      },
      listSessions: async (input: AgentRuntimeListSessionsInput) => {
        listSessionsInput = input
        return []
      },
      prompt: async (input: { sessionId: string }) => ({
        completedAt: 20,
        createdAt: 10,
        id: "assistant-message",
        parts: [],
        role: "assistant" as const,
        sessionId: input.sessionId,
      }),
    } as unknown as AgentRuntime
    const trusted = { isTrustedSender: () => true }
    let activeProjectId = ""

    disposeIpc = [
      await registerProjectIpc(projects, {
        ...trusted,
        projectCreationDirectory: path.join(temporaryRoot, "Documents", "Convax"),
      }),
      registerProjectCanvasIpc(canvases, trusted),
      registerCanvasDocumentIpc(canvasApplication, canvasHydrator, trusted),
      registerCanvasResourceIpc(canvasResources, resourcePreparation, {
        application: canvasApplication,
        ...trusted,
        resolveActiveCanvas: async () =>
          activeProjectId ? { canvasId: "canvas-main", projectId: activeProjectId } : null,
      }),
      registerAgentIpc(runtime, projects, { ...trusted, activity }),
    ]
    handlers.set("canvas:external-media-drag-prepare", (_event, input) => ({
      expiresAt: Date.now() + 60_000,
      itemCount: (input as { nodeIds: string[] }).nodeIds.length,
      ticket: "drag-ticket",
    }))
    await import("../preload/index")
    if (!exposedBridge) throw new Error("The preload bridge was not exposed")
    expect(exposedBridge.projects).not.toHaveProperty("listDirectory")
    expect(exposedBridge.projectFiles).toHaveProperty("listDirectory")
    const externalDragRequest = {
      nodeIds: ["image-1", "audio-1"],
      prepareId: "prepare_open_project_test",
      ref: { canvasId: "canvas-main", scopeId: "project-1" },
    }
    expect(await exposedBridge.canvas.externalMediaDrag.prepare(externalDragRequest)).toMatchObject({
      itemCount: 2,
      ticket: "drag-ticket",
    })
    exposedBridge.canvas.externalMediaDrag.start({ ticket: "drag-ticket" })
    exposedBridge.canvas.externalMediaDrag.cancel({ ticket: "unused-ticket" })
    exposedBridge.canvas.externalMediaDrag.cancelPrepare({ prepareId: "prepare_unused_test" })
    expect(rendererSends).toContainEqual({
      channel: "canvas:external-media-drag-start",
      input: { ticket: "drag-ticket" },
    })
    expect(rendererSends).toContainEqual({
      channel: "canvas:external-media-drag-cancel",
      input: { ticket: "unused-ticket" },
    })
    expect(rendererSends).toContainEqual({
      channel: "canvas:external-media-drag-prepare-cancel",
      input: { prepareId: "prepare_unused_test" },
    })

    const selection = await exposedBridge.projects.openProject()
    expect(selection).toMatchObject({ canceled: false, project: { name: "empty-project" } })
    const projectId = selection.project?.id
    if (!projectId) throw new Error("Open Project did not return a project id")
    const touched = await exposedBridge.projects.touchProject({ projectId })
    expect(touched.project.lastOpenedAt).toBeGreaterThan(selection.project?.lastOpenedAt ?? 0)
    expect(touched.projects[0]?.id).toBe(projectId)
    activeProjectId = projectId
    expect(await exposedBridge.projectFiles.listDirectory({ path: "", projectId })).toMatchObject({
      entries: [],
      path: "",
    })
    const catalog = await exposedBridge.projects.canvases.getCanvasCatalog({ projectId })
    expect(catalog).toMatchObject({
      canvases: [{ id: "canvas-main", name: "Canvas 1" }],
      projectId,
    })
    const loaded = await exposedBridge.canvas.documents.load({ canvasId: "canvas-main", scopeId: projectId })
    expect(loaded.projection).toMatchObject({ edges: [], id: "canvas-main", nodes: [] })
    await exposedBridge.projectFiles.writeTextFile({
      content: "Command edit",
      createParents: true,
      path: "Notes/renderer-note.md",
      projectId,
    })
    const rendererResource = await exposedBridge.canvas.resources.add({
      anchor: { x: 10, y: 20 },
      canvasId: "canvas-main",
      commandId: "renderer-resource-smoke",
      projectId,
      sources: [{ kind: "host-file", path: "Notes/renderer-note.md", sourceId: "renderer-note" }],
    })
    const rendererNodeId = rendererResource.createdNodeIds[0]
    if (!rendererNodeId) throw new Error("Renderer resource command did not create a node")
    const commandResult = await exposedBridge.canvas.documents.execute({
      command: {
        delta: { x: 5, y: 5 },
        nodeIds: [rendererNodeId],
        type: "nodes.move",
      },
      commandId: "renderer-command-smoke",
      ref: { canvasId: "canvas-main", scopeId: projectId },
    })
    expect(commandResult).toMatchObject({
      affectedNodeIds: [rendererNodeId],
      document: { nodes: [{ id: rendererNodeId }] },
      operationReceipt,
    })
    expect(handlers.has("canvas:document-save")).toBeFalse()

    selectedLocalFilePath = path.join(temporaryRoot, "outside.png")
    await fs.writeFile(selectedLocalFilePath, "outside-image")
    const outsideFile = new File(["renderer-placeholder"], "outside.png", { type: "image/png" })
    const sourceToken = exposedBridge.canvas.resources.createLocalFileToken(outsideFile)
    expect(sourceToken).not.toBe("")
    const resourceResult = await exposedBridge.canvas.resources.add({
      anchor: { x: 20, y: 40 },
      canvasId: "canvas-main",
      commandId: "smoke-add-external",
      localFiles: [{ mediaType: "image/png", name: "outside.png", sourceId: "outside", sourceToken }],
      projectId,
      sources: [],
    })
    expect(resourceResult).toMatchObject({
      createdNodeIds: [expect.any(String)],
      operationReceipt,
      projection: { nodes: expect.any(Array) },
      warnings: [],
    })
    expect(JSON.stringify(resourceResult)).not.toContain(selectedLocalFilePath)
    const withResource = await exposedBridge.canvas.documents.load({ canvasId: "canvas-main", scopeId: projectId })
    expect(withResource.projection.nodes).toHaveLength(2)
    expect(JSON.stringify(withResource.projection)).not.toContain(selectedLocalFilePath)

    await exposedBridge.agent.listSessions({ limit: 60, scopeId: projectId })
    expect(listSessionsInput).toEqual({ directory: await fs.realpath(selectedProjectPath), limit: 60 })
    await exposedBridge.agent.prompt({ scopeId: projectId, sessionId: "session-main", text: "Hello" })
    expect(activity.promptStarted).toHaveBeenCalledWith(projectId, "session-main")
    expect(activity.promptSettled).toHaveBeenCalledWith(projectId, "session-main")
    await exposedBridge.agent.abort({ scopeId: projectId, sessionId: "session-main" })
    expect(activity.aborted).toHaveBeenCalledWith(projectId, "session-main")
    expect(await exposedBridge.agent.listModels({ scopeId: projectId })).toMatchObject({
      providers: [{ providerId: "opencode" }],
    })
    expect(listModelsInput).toEqual({ directory: await fs.realpath(selectedProjectPath), scopeId: projectId })
    await expect(fs.stat(path.join(selectedProjectPath, ".convax", "canvases", "catalog.json"))).rejects.toThrow()

    const createdSelection = await exposedBridge.projects.createProject({ name: "Created project" })
    const createdProjectId = createdSelection.project?.id
    if (!createdProjectId) throw new Error("Create Project did not return a project id")
    const createdProjectPath = path.join(temporaryRoot, "Documents", "Convax", "Created project")
    expect(createdSelection).toMatchObject({
      canceled: false,
      project: { name: "Created project", rootPath: await fs.realpath(createdProjectPath) },
    })
    expect(
      JSON.parse(await fs.readFile(path.join(createdProjectPath, ".convax", "project.json"), "utf8")),
    ).toMatchObject({ projectId: createdProjectId, schemaVersion: "convax.project/1" })
    expect(await exposedBridge.projects.canvases.getCanvasCatalog({ projectId: createdProjectId })).toMatchObject({
      canvases: [{ id: "canvas-main", name: "Canvas 1" }],
      projectId: createdProjectId,
    })
    await exposedBridge.agent.listSessions({ limit: 60, scopeId: createdProjectId })
    expect(listSessionsInput).toEqual({ directory: await fs.realpath(createdProjectPath), limit: 60 })
  })
})
