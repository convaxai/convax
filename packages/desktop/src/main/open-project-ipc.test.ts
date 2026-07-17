import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { AgentClient, AgentRuntime, AgentRuntimeListSessionsInput } from "@convax/agent-runtime"
import type { CanvasDocumentClient } from "@convax/canvas/application"
import type { ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectFilesClient } from "@convax/project-files"
import type { JianyingCanvasExportIpcEnvelope, JianyingRendererClient } from "../jianying-contracts"

type InvokeHandler = (event: unknown, input?: unknown) => unknown
type DesktopBridge = {
  agent: AgentClient
  canvas: { documents: CanvasDocumentClient }
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
  disposeIpc.splice(0).reverse().forEach((dispose) => dispose())
  handlers.clear()
  rendererListeners.clear()
  rendererSends.length = 0
  exposedBridge = undefined
  selectedProjectPath = ""
  if (temporaryRoot) await fs.rm(temporaryRoot, { force: true, recursive: true })
  temporaryRoot = ""
})

describe("desktop Open Project IPC smoke", () => {
  test("opens an empty folder through the preload bridge and initializes its Canvas and Agent scope", async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-desktop-open-project-"))
    selectedProjectPath = path.join(temporaryRoot, "empty-project")
    await fs.mkdir(selectedProjectPath)

    const { NodeProjectManager, NodeProjectCanvasManager, ProjectCanvasDocumentRepository, ProjectCanvasDocumentService } = await import("@convax/project/node")
    const [{ registerAgentIpc }, { registerCanvasDocumentIpc }, { registerProjectIpc }, { registerProjectCanvasIpc }] = await Promise.all([
      import("./agent-ipc"),
      import("./canvas-document-ipc"),
      import("./project-ipc"),
      import("./project-canvas-ipc"),
    ])

    const projects = new NodeProjectManager({
      registryFile: path.join(temporaryRoot, "user-data", "projects.json"),
    })
    const canvases = new NodeProjectCanvasManager(projects, projects)
    const canvasDocuments = new ProjectCanvasDocumentService(
      new ProjectCanvasDocumentRepository(projects, canvases),
      canvases,
    )
    let listSessionsInput: AgentRuntimeListSessionsInput | undefined
    const runtime = {
      listSessions: async (input: AgentRuntimeListSessionsInput) => {
        listSessionsInput = input
        return []
      },
    } as unknown as AgentRuntime
    const trusted = { isTrustedSender: () => true }

    disposeIpc = [
      await registerProjectIpc(projects, trusted),
      registerProjectCanvasIpc(canvases, trusted),
      registerCanvasDocumentIpc(canvasDocuments, trusted),
      registerAgentIpc(runtime, projects, trusted),
    ]
    handlers.set("jianying:draft-status", () => ({ draftName: "Current draft", draftToken: "draft-token", status: "active" }))
    handlers.set("jianying:canvas-media-export", (_event, input) => ({
      createdDraft: (input as JianyingCanvasExportIpcEnvelope).request.target.kind === "new",
      draftName: "Current draft",
      importedMediaCount: (input as JianyingCanvasExportIpcEnvelope).request.nodeIds.length,
      importStatus: "dispatched",
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

    const selection = await exposedBridge.projects.openProject()
    expect(selection).toMatchObject({ canceled: false, project: { name: "empty-project" } })
    const projectId = selection.project?.id
    if (!projectId) throw new Error("Open Project did not return a project id")
    expect(await exposedBridge.projectFiles.listDirectory({ path: "", projectId })).toMatchObject({ entries: [], path: "" })
    const managedImagePath = path.join(selectedProjectPath, ".convax", "assets", "tiny.png")
    await fs.writeFile(managedImagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(await exposedBridge.projectFiles.readManagedImageFile({
      path: ".convax/assets/tiny.png",
      projectId,
    })).toMatchObject({ mimeType: "image/png", name: "tiny.png", size: 8 })
    await fs.writeFile(path.join(selectedProjectPath, "private.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    await expect(exposedBridge.projectFiles.readManagedImageFile({
      path: "private.png",
      projectId,
    })).rejects.toThrow("managed Canvas asset")

    const catalog = await exposedBridge.projects.canvases.getCanvasCatalog({ projectId })
    expect(catalog).toMatchObject({
      canvases: [{ id: "canvas-main", name: "Canvas 1" }],
      projectId,
    })
    const loaded = await exposedBridge.canvas.documents.load({ canvasId: "canvas-main", scopeId: projectId })
    expect(loaded.document).toMatchObject({ edges: [], id: "canvas-main", nodes: [] })

    await exposedBridge.agent.listSessions({ limit: 60, scopeId: projectId })
    expect(listSessionsInput).toEqual({ directory: await fs.realpath(selectedProjectPath), limit: 60 })
    const storedCatalog = JSON.parse(await fs.readFile(
      path.join(selectedProjectPath, ".convax", "canvases", "catalog.json"),
      "utf8",
    ))
    expect(storedCatalog).toMatchObject({ schemaVersion: "convax.project-canvases/2" })
    expect(storedCatalog).not.toHaveProperty("activeCanvasId")
    expect(JSON.parse(await fs.readFile(
      path.join(selectedProjectPath, ".convax", "canvases", "canvas-main", "document.json"),
      "utf8",
    ))).toMatchObject({ edges: [], id: "canvas-main", nodes: [] })
  })
})
