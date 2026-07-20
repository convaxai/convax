import type { AgentClient } from "@convax/agent-runtime"
import type { CanvasDocumentClient } from "@convax/canvas/application"
import type { ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvasChangeEvent, ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectChangeEvent, ProjectFilesClient } from "@convax/project-files"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import { desktopProtocolChannel, desktopProtocolVersion, type DesktopProtocolClient } from "../desktop-protocol"
import { generationIpcChannels, type GenerationClient } from "../generation-contracts"
import type { JianyingRendererClient } from "../jianying-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import type { WebPluginClient } from "../plugin-contracts"
import {
  canvasRendererChannels,
  type CanvasRendererClient,
  type CanvasRendererRequestEnvelope,
  type CanvasRendererResponseEnvelope,
} from "../canvas-renderer-contracts"

const channels = {
  createProject: "project:create",
  forgetProject: "project:forget",
  listProjects: "project:list",
  openProject: "project:open",
  renameProject: "project:rename",
} as const

const projectFilesChannels = {
  changed: "project-files:changed",
  copyEntries: "project-files:copy-entries",
  createEntry: "project-files:create-entry",
  deleteEntries: "project-files:delete-entries",
  importEntries: "project-files:import-entries",
  listDirectory: "project-files:list-directory",
  moveEntries: "project-files:move-entries",
  openEntry: "project-files:open-entry",
  readFile: "project-files:read-file",
  readFileInfo: "project-files:read-file-info",
  readManagedImageFile: "project-files:read-managed-image-file",
  readTextPreview: "project-files:read-text-preview",
  readTextFile: "project-files:read-text-file",
  renameEntry: "project-files:rename-entry",
  revealEntry: "project-files:reveal-entry",
  writeTextFile: "project-files:write-text-file",
} as const

const projectCanvasChannels = {
  changed: "project:canvases-changed",
  createCanvas: "project:canvas-create",
  deleteCanvas: "project:canvas-delete",
  getCanvasCatalog: "project:canvas-catalog",
  renameCanvas: "project:canvas-rename",
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

const agentSkillChannels = {
  changed: "agent:skills-changed",
  getSkillDetails: "agent:skill-details",
  getSkillShowcase: "agent:skill-showcase",
  importSkill: "agent:skill-import",
  installCatalogSkill: "agent:skill-catalog-install",
  installPluginSkill: "agent:skill-plugin-install",
  listSkills: "agent:skills-list",
  openSkill: "agent:skill-open",
  uninstallSkill: "agent:skill-uninstall",
} as const

const canvasDocumentChannels = {
  load: "canvas:document-load",
  save: "canvas:document-save",
} as const

const pluginChannels = {
  changed: "plugin:changed",
  importPlugin: "plugin:import",
  installCatalogPlugin: "plugin:catalog-install",
  listPlugins: "plugin:list",
  uninstallPlugin: "plugin:uninstall",
} as const

const jianyingChannels = {
  cancelCanvasMediaExport: "jianying:canvas-media-export-cancel",
  exportCanvasMedia: "jianying:canvas-media-export",
  getDraftStatus: "jianying:draft-status",
} as const

const desktopProtocolClient = {
  getVersion: () => ipcRenderer.invoke(desktopProtocolChannel),
  version: desktopProtocolVersion,
} satisfies DesktopProtocolClient

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
  createProject: (input) => ipcRenderer.invoke(channels.createProject, input),
  forgetProject: (input) => ipcRenderer.invoke(channels.forgetProject, input),
  listProjects: () => ipcRenderer.invoke(channels.listProjects),
  openProject: () => ipcRenderer.invoke(channels.openProject),
  renameProject: (input) => ipcRenderer.invoke(channels.renameProject, input),
} satisfies ProjectLifecycleClient

const projectFilesClient = {
  copyEntries: (input) => ipcRenderer.invoke(projectFilesChannels.copyEntries, input),
  createEntry: (input) => ipcRenderer.invoke(projectFilesChannels.createEntry, input),
  createImportToken,
  deleteEntries: (input) => ipcRenderer.invoke(projectFilesChannels.deleteEntries, input),
  importEntries: (input) =>
    ipcRenderer.invoke(projectFilesChannels.importEntries, {
      destinationPath: input.destinationPath,
      projectId: input.projectId,
      sourcePaths: consumeImportTokens(input.sourceTokens),
    }),
  listDirectory: (input) => ipcRenderer.invoke(projectFilesChannels.listDirectory, input),
  moveEntries: (input) => ipcRenderer.invoke(projectFilesChannels.moveEntries, input),
  onDidChange: (listener) => {
    const handleChange = (_event: Electron.IpcRendererEvent, change: ProjectChangeEvent) => listener(change)
    ipcRenderer.on(projectFilesChannels.changed, handleChange)
    return () => ipcRenderer.removeListener(projectFilesChannels.changed, handleChange)
  },
  openEntry: (input) => ipcRenderer.invoke(projectFilesChannels.openEntry, input),
  readFile: (input) => ipcRenderer.invoke(projectFilesChannels.readFile, input),
  readFileInfo: (input) => ipcRenderer.invoke(projectFilesChannels.readFileInfo, input),
  readManagedImageFile: (input) => ipcRenderer.invoke(projectFilesChannels.readManagedImageFile, input),
  readTextPreview: (input) => ipcRenderer.invoke(projectFilesChannels.readTextPreview, input),
  readTextFile: (input) => ipcRenderer.invoke(projectFilesChannels.readTextFile, input),
  renameEntry: (input) => ipcRenderer.invoke(projectFilesChannels.renameEntry, input),
  revealEntry: (input) => ipcRenderer.invoke(projectFilesChannels.revealEntry, input),
  writeTextFile: (input) => ipcRenderer.invoke(projectFilesChannels.writeTextFile, input),
} satisfies ProjectFilesClient

const projectCanvasClient = {
  createCanvas: (input) => ipcRenderer.invoke(projectCanvasChannels.createCanvas, input),
  deleteCanvas: (input) => ipcRenderer.invoke(projectCanvasChannels.deleteCanvas, input),
  getCanvasCatalog: (input) => ipcRenderer.invoke(projectCanvasChannels.getCanvasCatalog, input),
  onDidChange: (listener) => {
    const handleChange = (_event: Electron.IpcRendererEvent, change: ProjectCanvasChangeEvent) => listener(change)
    ipcRenderer.on(projectCanvasChannels.changed, handleChange)
    return () => ipcRenderer.removeListener(projectCanvasChannels.changed, handleChange)
  },
  renameCanvas: (input) => ipcRenderer.invoke(projectCanvasChannels.renameCanvas, input),
} satisfies ProjectCanvasClient

const projectsClient = {
  ...projectClient,
  canvases: projectCanvasClient,
} satisfies ProjectLifecycleClient & { canvases: ProjectCanvasClient }

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

const agentSkillClient = {
  getSkillDetails: (input) => ipcRenderer.invoke(agentSkillChannels.getSkillDetails, input),
  getSkillShowcase: (input) => ipcRenderer.invoke(agentSkillChannels.getSkillShowcase, input),
  importSkill: () => ipcRenderer.invoke(agentSkillChannels.importSkill),
  installCatalogSkill: (input) => ipcRenderer.invoke(agentSkillChannels.installCatalogSkill, input),
  installPluginSkill: (input) => ipcRenderer.invoke(agentSkillChannels.installPluginSkill, input),
  listSkills: (input) => ipcRenderer.invoke(agentSkillChannels.listSkills, input),
  onDidChange(listener) {
    const handleChange = () => listener()
    ipcRenderer.on(agentSkillChannels.changed, handleChange)
    return () => ipcRenderer.removeListener(agentSkillChannels.changed, handleChange)
  },
  openSkill: (input) => ipcRenderer.invoke(agentSkillChannels.openSkill, input),
  uninstallSkill: (input) => ipcRenderer.invoke(agentSkillChannels.uninstallSkill, input),
} satisfies DesktopSkillClient

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

const pluginClient = {
  importPlugin: () => ipcRenderer.invoke(pluginChannels.importPlugin),
  installCatalogPlugin: (input) => ipcRenderer.invoke(pluginChannels.installCatalogPlugin, input),
  listPlugins: () => ipcRenderer.invoke(pluginChannels.listPlugins),
  onDidChange(listener) {
    const handleChange = () => listener()
    ipcRenderer.on(pluginChannels.changed, handleChange)
    return () => ipcRenderer.removeListener(pluginChannels.changed, handleChange)
  },
  uninstallPlugin: (input) => ipcRenderer.invoke(pluginChannels.uninstallPlugin, input),
} satisfies WebPluginClient

const jianyingClient = {
  cancelCanvasMediaExport: (input) => ipcRenderer.send(jianyingChannels.cancelCanvasMediaExport, input),
  exportCanvasMedia: (input) => ipcRenderer.invoke(jianyingChannels.exportCanvasMedia, input),
  getDraftStatus: () => ipcRenderer.invoke(jianyingChannels.getDraftStatus),
} satisfies JianyingRendererClient

const generationClient = {
  cancel: (input) => ipcRenderer.send(generationIpcChannels.cancel, input),
  describeTool: (input) => ipcRenderer.invoke(generationIpcChannels.describeTool, input),
  generate: (input) => ipcRenderer.invoke(generationIpcChannels.generate, input),
  listTools: (input) => ipcRenderer.invoke(generationIpcChannels.listTools, input),
} satisfies GenerationClient

contextBridge.exposeInMainWorld("convax", {
  agent: { ...agentClient, skills: agentSkillClient },
  canvas: { documents: canvasDocumentClient, renderer: canvasRendererClient },
  generation: generationClient,
  jianying: jianyingClient,
  platform: process.platform,
  plugins: pluginClient,
  projectFiles: projectFilesClient,
  projects: projectsClient,
  protocol: desktopProtocolClient,
})
