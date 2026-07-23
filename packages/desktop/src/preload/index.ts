import type { AgentClient } from "@convax/agent-runtime"
import type { ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvasChangeEvent, ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectChangeEvent, ProjectFilesClient } from "@convax/project-files"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import {
  canvasDocumentIpcChannels,
  type CanvasRendererDocumentClient,
} from "../canvas-document-contracts"
import {
  canvasExternalMediaDragIpcChannels,
  type CanvasExternalMediaDragRendererClient,
} from "../canvas-external-drag-contracts"
import { desktopProtocolChannel, desktopProtocolVersion, type DesktopProtocolClient } from "../desktop-protocol"
import { generationIpcChannels, type GenerationClient } from "../generation-contracts"
import type { JianyingRendererClient } from "../jianying-contracts"
import { pluginCapabilityIpcChannels, type PluginCapabilityRendererClient } from "../plugin-capability-ipc"
import { pluginServiceIpcChannels, type PluginServiceClient } from "../plugin-service-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import type { WebPluginClient } from "../plugin-contracts"
import type { PetNavigationRequest, PetNavigationTarget } from "../pet-contracts"
import {
  pluginCanvasImageIpcChannels,
  type PluginCanvasImageClient,
} from "../plugin-canvas-image-contracts"
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
  listModels: "agent:models",
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

const petSettingsIpcChannels = {
  connect: "pet:settings-connect",
  disconnect: "pet:settings-disconnect",
  markDisplayed: "pet:mark-displayed",
  navigate: "pet:navigate",
  navigationReady: "pet:navigation-ready",
  port: "pet:settings-port",
  provider: "pet:provider",
  providerChanged: "pet:provider-changed",
} as const

interface PetSettingsIdentity {
  connectionId: string
  generation: number
  pluginId: string
}

interface PetSettingsConnectEnvelope extends PetSettingsIdentity {
  protocol: "convax.pet-host/1"
  surface: "settings"
  type: "connect"
}

interface PetSettingsPreloadClient {
  connectSettings(input: PetSettingsIdentity): Promise<void>
  disconnectSettings(input: PetSettingsIdentity): Promise<void>
  getProvider(): Promise<{ generation: number; pluginId: string; settingsUrl: string } | undefined>
  markDisplayed(input: PetNavigationRequest): Promise<void>
  onNavigate(listener: (target: PetNavigationTarget) => void): () => void
  onProviderChanged(listener: () => void): () => void
}

function isPetSettingsIdentity(value: unknown): value is PetSettingsIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  return (
    keys.length === 3 &&
    keys.every((key) => ["connectionId", "generation", "pluginId"].includes(key)) &&
    typeof input.connectionId === "string" &&
    input.connectionId.length > 0 &&
    input.connectionId.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.connectionId) &&
    Number.isSafeInteger(input.generation) &&
    (input.generation as number) >= 1 &&
    typeof input.pluginId === "string" &&
    input.pluginId.length > 0 &&
    input.pluginId.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.pluginId)
  )
}

function isPetSettingsConnectEnvelope(value: unknown): value is PetSettingsConnectEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  return (
    keys.length === 6 &&
    keys.every((key) => ["connectionId", "generation", "pluginId", "protocol", "surface", "type"].includes(key)) &&
    isPetSettingsIdentity({
      connectionId: input.connectionId,
      generation: input.generation,
      pluginId: input.pluginId,
    }) &&
    input.protocol === "convax.pet-host/1" &&
    input.surface === "settings" &&
    input.type === "connect"
  )
}

function petSettingsIdentityKey(identity: PetSettingsIdentity) {
  return `${identity.pluginId}:${identity.generation}:${identity.connectionId}`
}

function closePetSettingsPorts(ports: readonly MessagePort[]) {
  for (const port of ports) {
    try {
      port.close()
    } catch {}
  }
}

interface PendingPetSettingsConnection {
  mainAccepted: boolean
  portRelayed: boolean
  reject(error: unknown): void
  resolve(): void
}

const pendingPetSettingsConnections = new Map<string, PendingPetSettingsConnection>()
const activePetSettingsConnections = new Set<string>()

function settlePetSettingsConnection(key: string, pending: PendingPetSettingsConnection) {
  if (pendingPetSettingsConnections.get(key) !== pending || !pending.mainAccepted || !pending.portRelayed) return
  pendingPetSettingsConnections.delete(key)
  activePetSettingsConnections.add(key)
  pending.resolve()
}

function rejectPetSettingsConnection(key: string, pending: PendingPetSettingsConnection, error: unknown) {
  if (pendingPetSettingsConnections.get(key) !== pending) return
  pendingPetSettingsConnections.delete(key)
  pending.reject(error)
}

function disconnectPetSettingsBestEffort(identity: PetSettingsIdentity) {
  try {
    void ipcRenderer.invoke(petSettingsIpcChannels.disconnect, identity).catch(() => undefined)
  } catch {}
}

ipcRenderer.on(petSettingsIpcChannels.port, (event, envelope: unknown) => {
  const ports = event.ports ?? []
  const settingsEnvelope = isPetSettingsConnectEnvelope(envelope) ? envelope : undefined
  if (settingsEnvelope === undefined) {
    closePetSettingsPorts(ports)
    return
  }
  const key = petSettingsIdentityKey(settingsEnvelope)
  const pending = pendingPetSettingsConnections.get(key)
  if (window.top !== window || pending === undefined || pending.portRelayed || ports.length !== 1) {
    closePetSettingsPorts(ports)
    return
  }
  const port = ports[0]!
  try {
    window.postMessage(settingsEnvelope, "*", [port])
    pending.portRelayed = true
    settlePetSettingsConnection(key, pending)
  } catch (error) {
    closePetSettingsPorts([port])
    rejectPetSettingsConnection(key, pending, error)
    disconnectPetSettingsBestEffort({
      connectionId: settingsEnvelope.connectionId,
      generation: settingsEnvelope.generation,
      pluginId: settingsEnvelope.pluginId,
    })
  }
})

const pluginChannels = {
  changed: "plugin:changed",
  importPlugin: "plugin:import",
  installCatalogPlugin: "plugin:catalog-install",
  listPlugins: "plugin:list",
  openCatalogPluginRelease: "plugin:catalog-open-release",
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
  listModels: (input) => ipcRenderer.invoke(agentChannels.listModels, input),
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
  execute: (input) => ipcRenderer.invoke(canvasDocumentIpcChannels.execute, input),
  load: (input) => ipcRenderer.invoke(canvasDocumentIpcChannels.load, input),
} satisfies CanvasRendererDocumentClient

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

const canvasExternalMediaDragClient = {
  cancel: (input) => ipcRenderer.send(canvasExternalMediaDragIpcChannels.cancel, input),
  cancelPrepare: (input) => ipcRenderer.send(canvasExternalMediaDragIpcChannels.cancelPrepare, input),
  prepare: (input) => ipcRenderer.invoke(canvasExternalMediaDragIpcChannels.prepare, input),
  start: (input) => ipcRenderer.send(canvasExternalMediaDragIpcChannels.start, input),
} satisfies CanvasExternalMediaDragRendererClient

const pluginClient = {
  importPlugin: () => ipcRenderer.invoke(pluginChannels.importPlugin),
  installCatalogPlugin: (input) => ipcRenderer.invoke(pluginChannels.installCatalogPlugin, input),
  listPlugins: () => ipcRenderer.invoke(pluginChannels.listPlugins),
  onDidChange(listener) {
    const handleChange = () => listener()
    ipcRenderer.on(pluginChannels.changed, handleChange)
    return () => ipcRenderer.removeListener(pluginChannels.changed, handleChange)
  },
  openCatalogPluginRelease: (input) => ipcRenderer.invoke(pluginChannels.openCatalogPluginRelease, input),
  uninstallPlugin: (input) => ipcRenderer.invoke(pluginChannels.uninstallPlugin, input),
} satisfies WebPluginClient

const pluginCanvasImageClient = {
  cancel: (input) => ipcRenderer.send(pluginCanvasImageIpcChannels.cancel, input),
  create: (input) => ipcRenderer.invoke(pluginCanvasImageIpcChannels.create, input),
} satisfies PluginCanvasImageClient

const pluginCapabilityClient = {
  call: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.call, input),
  connect: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.connect, input),
  disconnect: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.disconnect, input),
  onEvent(listener) {
    const handleEvent = (_event: Electron.IpcRendererEvent, input: Parameters<typeof listener>[0]) => listener(input)
    ipcRenderer.on(pluginCapabilityIpcChannels.changed, handleEvent)
    return () => ipcRenderer.removeListener(pluginCapabilityIpcChannels.changed, handleEvent)
  },
} satisfies PluginCapabilityRendererClient

const pluginServiceClient = {
  authorize: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.authorize, input),
  cancelAuthorization: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.cancelAuthorization, input),
  getStatus: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.getStatus, input),
  listServices: () => ipcRenderer.invoke(pluginServiceIpcChannels.listServices),
  onDidChange(listener) {
    const handleChange = () => listener()
    ipcRenderer.on(pluginChannels.changed, handleChange)
    return () => ipcRenderer.removeListener(pluginChannels.changed, handleChange)
  },
  reauthorize: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.reauthorize, input),
  signOut: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.signOut, input),
} satisfies PluginServiceClient

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

const petSettingsClient = {
  async connectSettings(input: PetSettingsIdentity) {
    if (!isPetSettingsIdentity(input)) throw new Error("Pet settings connection identity is invalid")
    const identity = { ...input }
    const key = petSettingsIdentityKey(identity)
    if (pendingPetSettingsConnections.has(key) || activePetSettingsConnections.has(key)) {
      throw new Error("Pet settings connection is already pending or connected")
    }
    let resolveConnection!: () => void
    let rejectConnection!: (error: unknown) => void
    const connection = new Promise<void>((resolve, reject) => {
      resolveConnection = resolve
      rejectConnection = reject
    })
    const pending: PendingPetSettingsConnection = {
      mainAccepted: false,
      portRelayed: false,
      reject: rejectConnection,
      resolve: resolveConnection,
    }
    pendingPetSettingsConnections.set(key, pending)
    try {
      void ipcRenderer.invoke(petSettingsIpcChannels.connect, identity).then(
        () => {
          if (pendingPetSettingsConnections.get(key) !== pending) return
          pending.mainAccepted = true
          settlePetSettingsConnection(key, pending)
        },
        (error) => {
          rejectPetSettingsConnection(key, pending, error)
          if (pending.portRelayed) disconnectPetSettingsBestEffort(identity)
        },
      )
    } catch (error) {
      rejectPetSettingsConnection(key, pending, error)
    }
    return connection
  },
  async disconnectSettings(input: PetSettingsIdentity) {
    if (!isPetSettingsIdentity(input)) throw new Error("Pet settings connection identity is invalid")
    const key = petSettingsIdentityKey(input)
    const pending = pendingPetSettingsConnections.get(key)
    if (pending) {
      pendingPetSettingsConnections.delete(key)
      pending.reject(new Error("Pet settings connection was disconnected"))
    }
    activePetSettingsConnections.delete(key)
    await ipcRenderer.invoke(petSettingsIpcChannels.disconnect, input)
  },
  getProvider: () => ipcRenderer.invoke(petSettingsIpcChannels.provider),
  markDisplayed: (input: PetNavigationRequest) => ipcRenderer.invoke(petSettingsIpcChannels.markDisplayed, input),
  onNavigate(listener: (target: PetNavigationTarget) => void) {
    const handleNavigate = (_event: Electron.IpcRendererEvent, target: PetNavigationTarget) => listener(target)
    ipcRenderer.on(petSettingsIpcChannels.navigate, handleNavigate)
    void ipcRenderer.invoke(petSettingsIpcChannels.navigationReady).catch(() => undefined)
    return () => ipcRenderer.removeListener(petSettingsIpcChannels.navigate, handleNavigate)
  },
  onProviderChanged(listener: () => void) {
    const handleChange = () => listener()
    ipcRenderer.on(petSettingsIpcChannels.providerChanged, handleChange)
    return () => ipcRenderer.removeListener(petSettingsIpcChannels.providerChanged, handleChange)
  },
} satisfies PetSettingsPreloadClient

contextBridge.exposeInMainWorld("convax", {
  agent: { ...agentClient, skills: agentSkillClient },
  canvas: {
    documents: canvasDocumentClient,
    externalMediaDrag: canvasExternalMediaDragClient,
    pluginImages: pluginCanvasImageClient,
    renderer: canvasRendererClient,
  },
  generation: generationClient,
  jianying: jianyingClient,
  pets: petSettingsClient,
  platform: process.platform,
  pluginCapabilities: pluginCapabilityClient,
  plugins: pluginClient,
  pluginServices: pluginServiceClient,
  projectFiles: projectFilesClient,
  projects: projectsClient,
  protocol: desktopProtocolClient,
})
