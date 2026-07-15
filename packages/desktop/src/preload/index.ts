import type { AgentClient } from "@convax/agent-runtime"
import type { CanvasDocumentClient } from "@convax/canvas/application"
import type { ProjectClient, ProjectChangeEvent } from "@convax/project"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import {
  canvasRendererChannels,
  type CanvasRendererClient,
  type CanvasRendererRequestEnvelope,
  type CanvasRendererResponseEnvelope,
} from "../canvas-renderer-contracts"

const channels = {
  activateCanvas: "project:canvas-activate",
  changed: "project:changed",
  copyEntries: "project:copy-entries",
  createEntry: "project:create-entry",
  createCanvas: "project:canvas-create",
  createProject: "project:create",
  deleteEntries: "project:delete-entries",
  deleteCanvas: "project:canvas-delete",
  forgetProject: "project:forget",
  importEntries: "project:import-entries",
  getWorkspace: "project:workspace",
  listDirectory: "project:list-directory",
  listProjects: "project:list",
  moveEntries: "project:move-entries",
  openEntry: "project:open-entry",
  openProject: "project:open",
  readFile: "project:read-file",
  readFileInfo: "project:read-file-info",
  readTextPreview: "project:read-text-preview",
  readTextFile: "project:read-text-file",
  renameEntry: "project:rename-entry",
  renameCanvas: "project:canvas-rename",
  renameProject: "project:rename",
  revealEntry: "project:reveal-entry",
  writeTextFile: "project:write-text-file",
} as const

const agentChannels = {
  abort: "agent:abort",
  createSession: "agent:session-create",
  getSessionState: "agent:session-state",
  getStatus: "agent:status",
  listCapabilities: "agent:capabilities",
  listSessions: "agent:session-list",
  prompt: "agent:prompt",
  rejectQuestion: "agent:question-reject",
  replyPermission: "agent:permission-reply",
  replyQuestion: "agent:question-reply",
} as const

const canvasDocumentChannels = {
  load: "canvas:document-load",
  save: "canvas:document-save",
} as const

const importTokens = new Map<string, { expiresAt: number; path: string }>()
const maxImportTokens = 1_000

function pruneImportTokens(now = Date.now()) {
  for (const [token, value] of importTokens) {
    if (value.expiresAt < now) importTokens.delete(token)
  }
  while (importTokens.size >= maxImportTokens) {
    const oldest = importTokens.keys().next().value
    if (!oldest) break
    importTokens.delete(oldest)
  }
}

function createImportToken(file: File) {
  const filePath = webUtils.getPathForFile(file)
  if (!filePath) return ""
  pruneImportTokens()
  const token = `import_${globalThis.crypto.randomUUID()}`
  importTokens.set(token, { expiresAt: Date.now() + 60_000, path: filePath })
  return token
}

function consumeImportTokens(tokens: string[]) {
  const now = Date.now()
  pruneImportTokens(now)
  const paths = tokens.map((token) => {
    const value = importTokens.get(token)
    if (!value || value.expiresAt < now) throw new Error("Dropped file authorization has expired")
    return value.path
  })
  tokens.forEach((token) => importTokens.delete(token))
  return paths
}

const projectClient = {
  activateCanvas: (input) => ipcRenderer.invoke(channels.activateCanvas, input),
  copyEntries: (input) => ipcRenderer.invoke(channels.copyEntries, input),
  createEntry: (input) => ipcRenderer.invoke(channels.createEntry, input),
  createCanvas: (input) => ipcRenderer.invoke(channels.createCanvas, input),
  createProject: (input) => ipcRenderer.invoke(channels.createProject, input),
  createImportToken,
  deleteEntries: (input) => ipcRenderer.invoke(channels.deleteEntries, input),
  deleteCanvas: (input) => ipcRenderer.invoke(channels.deleteCanvas, input),
  forgetProject: (input) => ipcRenderer.invoke(channels.forgetProject, input),
  importEntries: (input) => ipcRenderer.invoke(channels.importEntries, {
    destinationPath: input.destinationPath,
    projectId: input.projectId,
    sourcePaths: consumeImportTokens(input.sourceTokens),
  }),
  listDirectory: (input) => ipcRenderer.invoke(channels.listDirectory, input),
  getWorkspace: (input) => ipcRenderer.invoke(channels.getWorkspace, input),
  listProjects: () => ipcRenderer.invoke(channels.listProjects),
  moveEntries: (input) => ipcRenderer.invoke(channels.moveEntries, input),
  onDidChange: (listener) => {
    const handleChange = (_event: Electron.IpcRendererEvent, change: ProjectChangeEvent) => listener(change)
    ipcRenderer.on(channels.changed, handleChange)
    return () => ipcRenderer.removeListener(channels.changed, handleChange)
  },
  openEntry: (input) => ipcRenderer.invoke(channels.openEntry, input),
  openProject: () => ipcRenderer.invoke(channels.openProject),
  readFile: (input) => ipcRenderer.invoke(channels.readFile, input),
  readFileInfo: (input) => ipcRenderer.invoke(channels.readFileInfo, input),
  readTextPreview: (input) => ipcRenderer.invoke(channels.readTextPreview, input),
  readTextFile: (input) => ipcRenderer.invoke(channels.readTextFile, input),
  renameEntry: (input) => ipcRenderer.invoke(channels.renameEntry, input),
  renameCanvas: (input) => ipcRenderer.invoke(channels.renameCanvas, input),
  renameProject: (input) => ipcRenderer.invoke(channels.renameProject, input),
  revealEntry: (input) => ipcRenderer.invoke(channels.revealEntry, input),
  writeTextFile: (input) => ipcRenderer.invoke(channels.writeTextFile, input),
} satisfies ProjectClient

const agentClient = {
  abort: (input) => ipcRenderer.invoke(agentChannels.abort, input),
  createSession: (input) => ipcRenderer.invoke(agentChannels.createSession, input),
  getSessionState: (input) => ipcRenderer.invoke(agentChannels.getSessionState, input),
  getStatus: () => ipcRenderer.invoke(agentChannels.getStatus),
  listCapabilities: (input) => ipcRenderer.invoke(agentChannels.listCapabilities, input),
  listSessions: (input) => ipcRenderer.invoke(agentChannels.listSessions, input),
  prompt: (input) => ipcRenderer.invoke(agentChannels.prompt, input),
  rejectQuestion: (input) => ipcRenderer.invoke(agentChannels.rejectQuestion, input),
  replyPermission: (input) => ipcRenderer.invoke(agentChannels.replyPermission, input),
  replyQuestion: (input) => ipcRenderer.invoke(agentChannels.replyQuestion, input),
} satisfies AgentClient

const canvasDocumentClient = {
  load: (input) => ipcRenderer.invoke(canvasDocumentChannels.load, input),
  save: (input) => ipcRenderer.invoke(canvasDocumentChannels.save, input),
} satisfies CanvasDocumentClient

const canvasRendererClient = {
  onRequest(handler) {
    const listener = (_event: Electron.IpcRendererEvent, envelope: CanvasRendererRequestEnvelope) => {
      if (!envelope || typeof envelope.id !== "string") return
      void handler(envelope.request).then(
        (result) => {
          const response: CanvasRendererResponseEnvelope = { id: envelope.id, ok: true, result }
          ipcRenderer.send(canvasRendererChannels.response, response)
        },
        (error) => {
          const response: CanvasRendererResponseEnvelope = {
            error: error instanceof Error ? error.message : String(error),
            id: envelope.id,
            ok: false,
          }
          ipcRenderer.send(canvasRendererChannels.response, response)
        },
      )
    }
    ipcRenderer.on(canvasRendererChannels.request, listener)
    return () => ipcRenderer.removeListener(canvasRendererChannels.request, listener)
  },
} satisfies CanvasRendererClient

contextBridge.exposeInMainWorld("convax", {
  agent: agentClient,
  canvas: { documents: canvasDocumentClient, renderer: canvasRendererClient },
  platform: process.platform,
  projects: projectClient,
})
