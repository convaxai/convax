import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
  AgentClient,
  AgentRuntime,
  AgentRuntimeDirectoryInput,
  AgentRuntimeListSessionsInput,
} from "@convax/agent-runtime"
import type { CanvasRendererDocumentClient } from "../canvas-document-contracts"
import { createTextNode } from "@convax/canvas/core"
import type { ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectFilesClient } from "@convax/project-files"
import type { CanvasExternalMediaDragRendererClient } from "../canvas-external-drag-contracts"
import type { JianyingCanvasExportIpcEnvelope, JianyingRendererClient } from "../jianying-contracts"

type InvokeHandler = (event: unknown, input?: unknown) => unknown
type DesktopBridge = {
  agent: AgentClient
  canvas: { documents: CanvasRendererDocumentClient; externalMediaDrag: CanvasExternalMediaDragRendererClient }
  jianying: JianyingRendererClient
  projectFiles: ProjectFilesClient
  projects: ProjectLifecycleClient & { canvases: ProjectCanvasClient }
}

const handlers = new Map<string, InvokeHandler>()
const rendererListeners = new Map<string, Set<(...args: unknown[]) => void>>()
const rendererSends: Array<{ channel: string; input: unknown }> = []
const trustedEvent = { sender: { id: 1 }, senderFrame: { url: "file:///convax/index.html" } }
let exposedBridge: DesktopBridge | undefined
let selectedProjectPath = ""

mock.module("electron", () => ({
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
    getPathForFile: () => "",
  },
}))

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
      NodeProjectCanvasManager,
      ProjectCanvasDocumentRepository,
      ProjectCanvasDocumentService,
      ProjectManagedAssetStore,
    } = await import("@convax/project/node")
    const [{ registerAgentIpc }, { registerCanvasDocumentIpc }, { registerProjectIpc }, { registerProjectCanvasIpc }] =
      await Promise.all([
        import("./agent-ipc"),
        import("./canvas-document-ipc"),
        import("./project-ipc"),
        import("./project-canvas-ipc"),
      ])

    const { CanvasApplicationService } = await import("@convax/canvas/application")
    const projects = new NodeProjectManager({
      registryFile: path.join(temporaryRoot, "user-data", "projects.json"),
    })
    const canvases = new NodeProjectCanvasManager(projects, projects)
    const assets = new ProjectManagedAssetStore(projects)
    const canvasDocuments = new ProjectCanvasDocumentService(
      new ProjectCanvasDocumentRepository(projects, canvases, assets),
      canvases,
    )
    const canvasApplication = new CanvasApplicationService(canvasDocuments)
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

    disposeIpc = [
      await registerProjectIpc(projects, {
        ...trusted,
        projectCreationDirectory: path.join(temporaryRoot, "Documents", "Convax"),
      }),
      registerProjectCanvasIpc(canvases, trusted),
      registerCanvasDocumentIpc(canvasDocuments, canvasApplication, trusted),
      registerAgentIpc(runtime, projects, { ...trusted, activity }),
    ]
    handlers.set("jianying:draft-status", () => ({
      draftName: "Current draft",
      draftToken: "draft-token",
      status: "active",
    }))
    handlers.set("jianying:canvas-media-export", (_event, input) => ({
      createdDraft: (input as JianyingCanvasExportIpcEnvelope).request.target.kind === "new",
      draftName: "Current draft",
      importedMediaCount: (input as JianyingCanvasExportIpcEnvelope).request.nodeIds.length,
      importStatus: "dispatched",
    }))
    handlers.set("canvas:external-media-drag-prepare", (_event, input) => ({
      expiresAt: Date.now() + 60_000,
      itemCount: (input as { nodeIds: string[] }).nodeIds.length,
      ticket: "drag-ticket",
    }))
    await import("../preload/index")
    if (!exposedBridge) throw new Error("The preload bridge was not exposed")
    expect(exposedBridge.projects).not.toHaveProperty("listDirectory")
    expect(exposedBridge.projectFiles).toHaveProperty("listDirectory")
    expect(exposedBridge.projectFiles).toHaveProperty("readManagedImageFile")
    expect(await exposedBridge.jianying.getDraftStatus()).toEqual({
      draftName: "Current draft",
      draftToken: "draft-token",
      status: "active",
    })
    const jianyingEnvelope: JianyingCanvasExportIpcEnvelope = {
      operationId: "toolbar-export",
      request: {
        expectedRevision: 0,
        nodeIds: ["image-1"],
        ref: { canvasId: "canvas-main", scopeId: "project-1" },
        target: { draftToken: "draft-token", kind: "current" },
      },
    }
    expect(await exposedBridge.jianying.exportCanvasMedia(jianyingEnvelope)).toEqual({
      createdDraft: false,
      draftName: "Current draft",
      importedMediaCount: 1,
      importStatus: "dispatched",
    })
    exposedBridge.jianying.cancelCanvasMediaExport({ operationId: "toolbar-export" })
    expect(rendererSends).toContainEqual({
      channel: "jianying:canvas-media-export-cancel",
      input: { operationId: "toolbar-export" },
    })

    const externalDragRequest = {
      expectedRevision: 0,
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
    expect(await exposedBridge.projectFiles.listDirectory({ path: "", projectId })).toMatchObject({
      entries: [],
      path: "",
    })
    const managedImagePath = path.join(selectedProjectPath, ".convax", "assets", "tiny.png")
    await fs.writeFile(managedImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(
      await exposedBridge.projectFiles.readManagedImageFile({
        path: ".convax/assets/tiny.png",
        projectId,
      }),
    ).toMatchObject({ mimeType: "image/png", name: "tiny.png", size: 8 })
    await fs.writeFile(
      path.join(selectedProjectPath, "private.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
    await expect(
      exposedBridge.projectFiles.readManagedImageFile({
        path: "private.png",
        projectId,
      }),
    ).rejects.toThrow("managed Canvas asset")

    const catalog = await exposedBridge.projects.canvases.getCanvasCatalog({ projectId })
    expect(catalog).toMatchObject({
      canvases: [{ id: "canvas-main", name: "Canvas 1" }],
      projectId,
    })
    const loaded = await exposedBridge.canvas.documents.load({ canvasId: "canvas-main", scopeId: projectId })
    expect(loaded.document).toMatchObject({ edges: [], id: "canvas-main", nodes: [] })
    const rendererNode = createTextNode({ id: "renderer-note", position: { x: 10, y: 20 }, text: "Command edit" })
    const commandResult = await exposedBridge.canvas.documents.execute({
      command: {
        addedEdges: [],
        addedNodes: [rendererNode],
        removedEdgeIds: [],
        removedNodeIds: [],
        type: "document.patch",
        updatedEdges: [],
        updatedNodes: [],
      },
      commandId: "renderer-command-smoke",
      expectedRevision: loaded.document?.revision ?? 0,
      ref: { canvasId: "canvas-main", scopeId: projectId },
    })
    expect(commandResult).toMatchObject({
      createdNodeIds: [rendererNode.id],
      document: { nodes: [{ id: rendererNode.id }], revision: 1 },
    })
    expect(handlers.has("canvas:document-save")).toBeFalse()

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
    const storedCatalog = JSON.parse(
      await fs.readFile(path.join(selectedProjectPath, ".convax", "canvases", "catalog.json"), "utf8"),
    )
    expect(storedCatalog).toMatchObject({ schemaVersion: "convax.project-canvases/2" })
    expect(storedCatalog).not.toHaveProperty("activeCanvasId")
    const storedCanvasEnvelope = JSON.parse(
      await fs.readFile(
        path.join(selectedProjectPath, ".convax", "canvases", "canvas-main", "document.json"),
        "utf8",
      ),
    )
    expect(storedCanvasEnvelope.schemaVersion).toBe("convax.canvas/2")
    expect(storedCanvasEnvelope.document).toMatchObject({
      edges: [],
      id: "canvas-main",
      nodes: [{ id: rendererNode.id }],
      revision: 1,
    })

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
