import type { AgentClient } from "@convax/agent-runtime"
import type { ProjectCollaborationRecoveryClient, ProjectLifecycleClient } from "@convax/project"
import type { ProjectCanvasChangeEvent, ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectChangeEvent, ProjectFilesClient } from "@convax/project-files"
import { contextBridge, ipcRenderer, webUtils } from "electron"
import { canvasDocumentIpcChannels, type CanvasRendererDocumentClient } from "../canvas-document-contracts"
import {
  canvasExternalMediaDragIpcChannels,
  type CanvasExternalMediaDragRendererClient,
} from "../canvas-external-drag-contracts"
import { desktopProtocolChannel, desktopProtocolVersion, type DesktopProtocolClient } from "../desktop-protocol"
import { mainWindowControlsIpcChannel, type MainWindowControlsClient } from "../main-window-controls-contracts"
import { generationIpcChannels, type GenerationClient } from "../generation-contracts"
import { pluginCapabilityIpcChannels, type PluginCapabilityRendererClient } from "../plugin-capability-ipc"
import {
  pluginMaterializationIpcChannels,
  type PluginMaterializationRendererClient,
} from "../plugin-materialization-contracts"
import { pluginSurfaceIpcChannels, type PluginSurfaceRendererClient } from "../plugin-surface-contracts"
import { pluginServiceIpcChannels, type PluginServiceClient } from "../plugin-service-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import type { WebPluginClient } from "../plugin-contracts"
import type { PetDisplayedSession, PetNavigationRequest, PetNavigationTarget } from "../pet-contracts"
import { createCanvasResourcePreloadClient, createCanvasTextResourcePreloadClient } from "./canvas-resource-client"
import { createCanvasSessionPreloadClient } from "./canvas-session-client"
import { createProjectTeamCollaborationPreloadClient } from "./project-team-collaboration-client"
import {
  canvasRendererChannels,
  type CanvasRendererClient,
  type CanvasRendererRequestEnvelope,
  type CanvasRendererResponseEnvelope,
} from "../canvas-renderer-contracts"
import { workspaceSystemStatusIpcChannel, type WorkspaceSystemStatusClient } from "../workspace-system-status-contracts"
import { marketplaceIpcChannels, type MarketplaceClient } from "../marketplace-contracts"

const channels = {
  createProject: "project:create",
  forgetProject: "project:forget",
  listProjects: "project:list",
  openProject: "project:open",
  renameProject: "project:rename",
  touchProject: "project:touch",
} as const

const projectRecoveryChannels = {
  confirmReset: "project:recovery-confirm-reset",
  inspectProject: "project:recovery-inspect",
  previewReset: "project:recovery-preview-reset",
} as const

const projectFilesChannels = {
  changed: "project-files:changed",
  closeFilePreview: "project-files:close-file-preview",
  copyEntries: "project-files:copy-entries",
  createEntry: "project-files:create-entry",
  deleteEntries: "project-files:delete-entries",
  importEntries: "project-files:import-entries",
  listDirectory: "project-files:list-directory",
  moveEntries: "project-files:move-entries",
  openEntry: "project-files:open-entry",
  openFilePreview: "project-files:open-file-preview",
  readFile: "project-files:read-file",
  readFileInfo: "project-files:read-file-info",
  readFileThumbnail: "project-files:read-file-thumbnail",
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
  sessionDisplayed: "pet:session-displayed",
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
  markSessionDisplayed(input: PetDisplayedSession): Promise<void>
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
  agentMcpStatuses: "plugin:agent-mcp-statuses",
  changed: "plugin:changed",
  connectAgentMcp: "plugin:agent-mcp-connect",
  importPlugin: "plugin:import",
  installCatalogPlugin: "plugin:catalog-install",
  listPlugins: "plugin:list",
  openCatalogPluginRelease: "plugin:catalog-open-release",
  uninstallPlugin: "plugin:uninstall",
} as const

const desktopProtocolClient = {
  getVersion: () => ipcRenderer.invoke(desktopProtocolChannel),
  version: desktopProtocolVersion,
} satisfies DesktopProtocolClient

const mainWindowControlsClient = {
  close: () => ipcRenderer.invoke(mainWindowControlsIpcChannel, { action: "close" }),
  minimize: () => ipcRenderer.invoke(mainWindowControlsIpcChannel, { action: "minimize" }),
  setCustomControlsVisible: (visible) =>
    ipcRenderer.invoke(mainWindowControlsIpcChannel, { action: "set-custom-controls-visible", visible }),
  toggleFullScreen: () => ipcRenderer.invoke(mainWindowControlsIpcChannel, { action: "toggle-full-screen" }),
} satisfies MainWindowControlsClient

const workspaceSystemStatusClient = {
  getSnapshot: () => ipcRenderer.invoke(workspaceSystemStatusIpcChannel),
} satisfies WorkspaceSystemStatusClient

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
  touchProject: (input) => ipcRenderer.invoke(channels.touchProject, input),
} satisfies ProjectLifecycleClient

const projectRecoveryClient = {
  confirmReset: (input) =>
    ipcRenderer.invoke(projectRecoveryChannels.confirmReset, { projectId: input.projectId, token: input.token }),
  inspectProject: (projectId) => ipcRenderer.invoke(projectRecoveryChannels.inspectProject, { projectId }),
  previewReset: (projectId) => ipcRenderer.invoke(projectRecoveryChannels.previewReset, { projectId }),
} satisfies ProjectCollaborationRecoveryClient

const projectFilesClient = {
  closeFilePreview: (input) => ipcRenderer.invoke(projectFilesChannels.closeFilePreview, input),
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
  openFilePreview: (input) => ipcRenderer.invoke(projectFilesChannels.openFilePreview, input),
  readFile: (input) => ipcRenderer.invoke(projectFilesChannels.readFile, input),
  readFileInfo: (input) => ipcRenderer.invoke(projectFilesChannels.readFileInfo, input),
  readFileThumbnail: (input) => ipcRenderer.invoke(projectFilesChannels.readFileThumbnail, input),
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
  collaboration: createProjectTeamCollaborationPreloadClient(ipcRenderer),
  recovery: projectRecoveryClient,
} satisfies ProjectLifecycleClient & {
  canvases: ProjectCanvasClient
  collaboration: import("../project-team-collaboration-contracts").ProjectTeamCollaborationClient
  recovery: ProjectCollaborationRecoveryClient
}

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

const canvasSessionClient = createCanvasSessionPreloadClient({
  invoke: (channel, input) => ipcRenderer.invoke(channel, input),
  on: (channel, listener) => ipcRenderer.on(channel, listener),
  removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
})

const canvasResourceClient = createCanvasResourcePreloadClient({
  getPathForFile: (file) => webUtils.getPathForFile(file),
  invoke: (channel, input) => ipcRenderer.invoke(channel, input),
})

const canvasTextResourceClient = createCanvasTextResourcePreloadClient({
  invoke: (channel, input) => ipcRenderer.invoke(channel, input),
})

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
  connectAgentMcp: (input) => ipcRenderer.invoke(pluginChannels.connectAgentMcp, input),
  importPlugin: () => ipcRenderer.invoke(pluginChannels.importPlugin),
  installCatalogPlugin: (input) => ipcRenderer.invoke(pluginChannels.installCatalogPlugin, input),
  listAgentMcpStatuses: () => ipcRenderer.invoke(pluginChannels.agentMcpStatuses),
  listPlugins: () => ipcRenderer.invoke(pluginChannels.listPlugins),
  onDidChange(listener) {
    const handleChange = () => listener()
    ipcRenderer.on(pluginChannels.changed, handleChange)
    return () => ipcRenderer.removeListener(pluginChannels.changed, handleChange)
  },
  openCatalogPluginRelease: (input) => ipcRenderer.invoke(pluginChannels.openCatalogPluginRelease, input),
  uninstallPlugin: (input) => ipcRenderer.invoke(pluginChannels.uninstallPlugin, input),
} satisfies WebPluginClient

const marketplaceClient = {
  addMarketplace: (input) => ipcRenderer.invoke(marketplaceIpcChannels.addMarketplace, input),
  beginInstall: (input) => ipcRenderer.invoke(marketplaceIpcChannels.beginInstall, input),
  beginUpdate: (input) => ipcRenderer.invoke(marketplaceIpcChannels.beginUpdate, input),
  confirmInstall: (input) => ipcRenderer.invoke(marketplaceIpcChannels.confirmInstall, input),
  confirmUpdate: (input) => ipcRenderer.invoke(marketplaceIpcChannels.confirmUpdate, input),
  disable: (input) => ipcRenderer.invoke(marketplaceIpcChannels.disable, input),
  enable: (input) => ipcRenderer.invoke(marketplaceIpcChannels.enable, input),
  getCapabilityDetails: (input) => ipcRenderer.invoke(marketplaceIpcChannels.getCapabilityDetails, input),
  importCapability: () => ipcRenderer.invoke(marketplaceIpcChannels.importCapability),
  install: (input) => ipcRenderer.invoke(marketplaceIpcChannels.install, input),
  listCatalog: () => ipcRenderer.invoke(marketplaceIpcChannels.listCatalog),
  listInstalled: () => ipcRenderer.invoke(marketplaceIpcChannels.listInstalled),
  listMarketplaces: () => ipcRenderer.invoke(marketplaceIpcChannels.listMarketplaces),
  onDidChange(listener) {
    const handleChange = () => listener()
    ipcRenderer.on(marketplaceIpcChannels.changed, handleChange)
    return () => ipcRenderer.removeListener(marketplaceIpcChannels.changed, handleChange)
  },
  openCapabilitySource: (input) => ipcRenderer.invoke(marketplaceIpcChannels.openCapabilitySource, input),
  previewMarketplace: (input) => ipcRenderer.invoke(marketplaceIpcChannels.previewMarketplace, input),
  refreshMarketplace: (input) => ipcRenderer.invoke(marketplaceIpcChannels.refreshMarketplace, input),
  removeMarketplace: (input) => ipcRenderer.invoke(marketplaceIpcChannels.removeMarketplace, input),
  setup: (input) => ipcRenderer.invoke(marketplaceIpcChannels.setup, input),
  uninstall: (input) => ipcRenderer.invoke(marketplaceIpcChannels.uninstall, input),
  update: (input) => ipcRenderer.invoke(marketplaceIpcChannels.update, input),
} satisfies MarketplaceClient

const pluginCapabilityClient = {
  cancel: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.cancel, input),
  call: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.call, input),
  connect: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.connect, input),
  disconnect: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.disconnect, input),
  getPluginAvailability: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.getPluginAvailability, input),
  invokePlugin: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.invokePlugin, input),
  updateLocale: (input) => ipcRenderer.invoke(pluginCapabilityIpcChannels.updateLocale, input),
  onEvent(listener) {
    const handleEvent = (_event: Electron.IpcRendererEvent, input: Parameters<typeof listener>[0]) => listener(input)
    ipcRenderer.on(pluginCapabilityIpcChannels.changed, handleEvent)
    return () => ipcRenderer.removeListener(pluginCapabilityIpcChannels.changed, handleEvent)
  },
} satisfies PluginCapabilityRendererClient

const pluginMaterializationClient = {
  materialize: (input) => ipcRenderer.invoke(pluginMaterializationIpcChannels.materialize, input),
} satisfies PluginMaterializationRendererClient

const pluginSurfaceClient = {
  create: (input) => ipcRenderer.invoke(pluginSurfaceIpcChannels.create, input),
} satisfies PluginSurfaceRendererClient

const pluginServiceClient = {
  authorize: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.authorize, input),
  cancelAuthorization: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.cancelAuthorization, input),
  checkout: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.checkout, input),
  getStatus: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.getStatus, input),
  getUsageHistory: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.getUsageHistory, input),
  listServices: () => ipcRenderer.invoke(pluginServiceIpcChannels.listServices),
  onDidChange(listener) {
    const handleChange = () => listener()
    ipcRenderer.on(pluginChannels.changed, handleChange)
    ipcRenderer.on(pluginServiceIpcChannels.changed, handleChange)
    return () => {
      ipcRenderer.removeListener(pluginChannels.changed, handleChange)
      ipcRenderer.removeListener(pluginServiceIpcChannels.changed, handleChange)
    }
  },
  reauthorize: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.reauthorize, input),
  signOut: (input) => ipcRenderer.invoke(pluginServiceIpcChannels.signOut, input),
} satisfies PluginServiceClient

const generationClient = {
  admitCanvas: (input) => ipcRenderer.invoke(generationIpcChannels.admitCanvas, input),
  cancel: (input) => ipcRenderer.invoke(generationIpcChannels.cancel, input),
  describeTool: (input) => ipcRenderer.invoke(generationIpcChannels.describeTool, input),
  generate: (input) => ipcRenderer.invoke(generationIpcChannels.generate, input),
  listTools: (input) => ipcRenderer.invoke(generationIpcChannels.listTools, input),
  reconcileCanvas: (input) => ipcRenderer.invoke(generationIpcChannels.reconcileCanvas, input),
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
  markSessionDisplayed: (input: PetDisplayedSession) =>
    ipcRenderer.invoke(petSettingsIpcChannels.sessionDisplayed, input),
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
    pluginMaterialization: pluginMaterializationClient,
    pluginSurfaces: pluginSurfaceClient,
    renderer: canvasRendererClient,
    sessions: canvasSessionClient,
    resources: canvasResourceClient,
    textResources: canvasTextResourceClient,
  },
  generation: generationClient,
  mainWindowControls: mainWindowControlsClient,
  marketplaces: marketplaceClient,
  pets: petSettingsClient,
  platform: process.platform,
  pluginCapabilities: pluginCapabilityClient,
  plugins: pluginClient,
  pluginServices: pluginServiceClient,
  projectFiles: projectFilesClient,
  projects: projectsClient,
  protocol: desktopProtocolClient,
  systemStatus: workspaceSystemStatusClient,
})
