import { randomBytes, randomUUID } from "node:crypto"
import { appendFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { ManagedAgentSkillStore, OpenCodeAgentRuntime } from "@convax/agent-runtime/node"
import {
  builtinSourceKey,
  canonicalJson,
  computeSourceKey,
  sha256Hex,
  type SourceKey,
  type SourceQualifiedItem,
} from "@convax/marketplace"
import {
  CanvasNodeGenerationRunBusinessService,
  CanvasApplicationService,
  CanvasResourceBusinessService,
} from "@convax/canvas/application"
import {
  createProjectIndexReconstructionYDoc,
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  requiredProjectIndexBlobDigests,
} from "@convax/project"
import {
  createWebCryptoEd25519Verifier,
  parseDigest,
  parseId128,
  parseValidationArtifactSet,
} from "@convax/collaboration"
import {
  createPinnedControlServiceVerifier,
  createWebCryptoEd25519Verifier as createProjectControlEd25519Verifier,
} from "@convax/project/collaboration-protocol"
import type { ProjectCanvasCatalogProjection } from "@convax/project/canvas"
import {
  NodeProjectManager,
  NodeProjectCollaborationRecoveryService,
  NodeProjectCollaborationRuntimeCoordinator,
  type NodeLocalCommitDurabilityDiagnostics,
  type NodeLocalCommitDurabilityMeasurement,
  ProjectAssetGc,
  ProjectCanvasDocumentService,
  ProjectFilePublisher,
  NodeProjectCanvasManager,
  ProjectCanvasResourceHydrator,
  ProjectCanvasResourcePreparation,
  ProjectManagedAssetStore,
  ProjectResourceReader,
  readProjectNativeStoreManifest,
} from "@convax/project/node"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  nativeImage,
  Notification,
  net,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
  safeStorage,
  webFrameMain,
  type BrowserWindowConstructorOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron"
import { resolveMainWindowChrome, setNativeMainWindowControlsVisible } from "./main-window-chrome"
import { registerMainWindowControlsIpc } from "./main-window-controls-ipc"
import appIcon from "../../resources/icon.png?asset"
import { registerAgentIpc } from "./agent-ipc"
import {
  createDemandDrivenAsyncLifecycle,
  createDetachedAsyncCallback,
  createIdempotentAsyncCleanup,
  registerMainWindowActivation,
  registerWillQuitCleanup,
} from "./application-lifecycle"
import {
  desktopApplicationName,
  desktopProjectWorkspaceDirectory,
  desktopRendererUrl,
  desktopUserDataDirectory,
} from "./app-branding"
import { createCanvasAgentToolProvider } from "./canvas-agent-tools"
import { createCanvasTextResourceWriter } from "./canvas-text-resource-service"
import { createCompositeAgentToolProvider } from "./composite-agent-tools"
import { ManagedMcpAgentToolRegistry, type ManagedMcpPrincipalState } from "./managed-mcp-agent-tools"
import { ManagedMcpRuntimeManager } from "./managed-mcp-runtime-manager"
import { MarketplaceMcpMetadataStore, marketplaceMcpServerKey } from "./marketplace-mcp-metadata"
import { PackagedMarketplaceProduct } from "./packaged-marketplace-product"
import { NetworkMarketplaceManager } from "./network-marketplace-manager"
import { FileLocalMarketplaceImportTransition, LocalMarketplaceStore } from "./local-marketplace-store"
import { CapabilityMutationCoordinator, FileMarketplaceStateStore } from "./marketplace-state"
import { DesktopMarketplaceCapabilityInstaller } from "./marketplace-capability-installer"
import { MarketplaceApplicationService } from "./marketplace-application-service"
import {
  MarketplaceLegacyMigration,
  proveCurrentPluginExecutionAuthorizations,
  type MarketplaceInstallationProof,
} from "./marketplace-legacy-migration"
import { registerMarketplaceIpc } from "./marketplace-ipc"
import { provisionMarketplaceForStartup } from "./marketplace-startup-provisioning"
import { builtinMarketplaceReservation } from "./builtin-marketplace-bundle"
import { isMarketplacePluginRuntimeAdmitted } from "./marketplace-plugin-runtime-gate"
import { unpackSafeZip } from "./safe-zip"
import { exactSkillTreeDigest } from "./skill-manager"
import { PinnedHttpsFetcher } from "./pinned-https-fetch"
import { DevelopmentOfficialMarketplaceArtifacts } from "./development-official-marketplace-artifacts"
import { createGenerationAgentToolProvider } from "./generation-agent-tools"
import { GenerationCanvasService } from "./generation-canvas-service"
import { GenerationInputSnapshotStore } from "./generation-input-snapshot-store"
import { GenerationOperationStore } from "./generation-operation-store"
import { registerGenerationIpc } from "./generation-ipc"
import { generationPluginEnvironment, GenerationPluginRuntime } from "./generation-plugin-runtime"
import { openDesktopPluginRuntimeSession } from "./plugin-runtime-startup"
import { pluginExecutionAuthorizationIdentity } from "./plugin-installation-runtime"
import { pluginSnapshotCanonicalDigest } from "./plugin-installation-snapshots"
import { PluginSnapshotInstaller } from "./plugin-snapshot-installer"
import {
  registerCanvasDocumentIpc,
  registerCanvasResourceIpc,
  registerCanvasTextResourceIpc,
} from "./canvas-document-ipc"
import { createPluginOperationAgentToolProvider } from "./plugin-operation-agent-tools"
import {
  registerCanvasExternalMediaDragIpc,
  showCanvasExternalMediaDragStartFailure,
} from "./canvas-external-media-drag-ipc"
import { createCanvasExternalMediaDragIconFactory } from "./canvas-external-media-drag-icon"
import { CanvasExternalMediaDragService } from "./canvas-external-media-drag-service"
import { ProjectFilePreviewService } from "./project-file-preview-service"
import { projectFilePreviewPrivileges, projectFilePreviewScheme } from "../project-file-preview-contracts"
import { createCanvasRendererBridge } from "./canvas-renderer-bridge"
import { CanvasDocumentChangeBus } from "./canvas-document-change-bus"
import { createProjectCanvasMediaInspector } from "./project-canvas-media-inspector"
import { registerDesktopProtocolIpc } from "./desktop-protocol-ipc"
import { registerWorkspaceSystemStatusIpc } from "./workspace-system-status-ipc"
import {
  desktopDevelopmentCachePolicy,
  quarantineLegacyDevelopmentCaches,
  removeQuarantinedDevelopmentCaches,
} from "./development-cache-policy"
import {
  createWebPluginAssetHandler,
  isAllowedWebPluginFrameNavigation,
  webPluginAssetPrivileges,
  webPluginAssetScheme,
  webPluginFrameBindingForNavigation,
} from "./plugin-asset-protocol"
import { registerPluginManagementIpc } from "./plugin-management-ipc"
import { registerPluginCapabilityIpc } from "./plugin-capability-ipc"
import { PluginHostApiMainAdapter } from "./plugin-host-api-main-adapter"
import { PluginHostApiService } from "./plugin-host-api-service"
import { PluginCapabilityBrokerMainService } from "./plugin-capability-broker-service"
import { registerPluginMaterializationIpc } from "./plugin-materialization-ipc"
import { PluginMaterializationService } from "./plugin-materialization-service"
import { registerPluginSurfaceIpc } from "./plugin-surface-ipc"
import { PluginSurfaceService } from "./plugin-surface-service"
import { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
import { PluginCanvasImageService } from "./plugin-canvas-image-service"
import { PluginCanvasStateServiceV1 } from "./plugin-canvas-state-service"
import { PluginStateSchemaAuthorityV1 } from "./plugin-state-schema-authority"
import { PluginAgentConfigurationResolver } from "./plugin-agent-configuration"
import { PluginAgentMcpConnectionService } from "./plugin-agent-mcp-connection"
import { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"
import { pluginConnectedMediaPrivileges, pluginConnectedMediaScheme } from "../plugin-connected-media-contracts"
import { PluginServiceHost } from "./plugin-service-host"
import { publishPluginServiceChange, registerPluginServiceIpc } from "./plugin-service-ipc"
import { ServiceAwareGenerationTools } from "./service-aware-generation-tools"
import { createElectronPluginServiceBrowserAuthorizationBroker } from "./electron-plugin-service-browser-authorization"
import { createElectronPluginServiceCheckoutNavigation } from "./electron-plugin-service-checkout"
import { createElectronPluginServiceExternalAuthorizationBroker } from "./electron-plugin-service-external-authorization"
import { PluginServiceAuthorizationCheckpointStore } from "./plugin-service-authorization-checkpoints"
import { registerProjectCanvasIpc } from "./project-canvas-ipc"
import { registerProjectIpc, registerProjectRecoveryIpc } from "./project-ipc"
import { registerSkillManagementIpc } from "./skill-management-ipc"
import { AgentActivityController } from "./agent-activity-controller"
import { PetActivityNotifier } from "./pet-activity-notifier"
import { createElectronPetAssetInspector } from "./pet-asset-inspector"
import { createPetAssetHandler, petAssetPrivileges, petAssetScheme } from "./pet-asset-protocol"
import { CustomPetStore } from "./custom-pet-store"
import { PetProviderController } from "./pet-provider-controller"
import { registerPetIpc } from "./pet-ipc"
import { PetStateStore } from "./pet-state-store"
import { registerPetPluginSessionProtocol } from "./pet-session"
import { PetWindow } from "./pet-window"
import { DesktopSkillManager } from "./skill-manager"
import { MarketplaceArtifactInstaller } from "./marketplace-artifact-installer"
import { ManagedCanvasMediaResolver } from "./managed-canvas-media-resolver"
import { createElectronPluginConnectedImageInspector } from "./plugin-connected-image-inspector"
import { PluginConnectedMediaService } from "./plugin-connected-media-service"
import { PluginFrameBindingRegistry } from "./plugin-frame-binding-registry"
import { desktopBunRuntime, desktopOpenCodeBinaryDirectory } from "./packaged-runtime"
import { DesktopSkillMutationCoordinator } from "./skill-mutation-coordinator"
import {
  createProjectResourceProtocolResponse,
  createProjectResourceUrl,
  parseProjectResourceUrl,
  projectResourceAccessControlAllowOrigin,
} from "./project-resource-protocol"
import { ProjectAssetGcScheduler } from "./project-asset-gc-scheduler"
import { loadCurrentCollaborationProtocol } from "./current-protocol-loader"
import {
  createLocalFirstCurrentLocalReplicaAuthoritySource,
  createLocalProjectOwnerCurrentLocalReplicaAuthoritySource,
  createOfflineCurrentLocalReplicaAuthoritySource,
  createProjectCollaborationMaterializerRegistry,
} from "./collaboration-production-runtime"
import {
  createCurrentIncomingReplicaAuthoritySource,
  createLocalProjectOwnerIncomingReplicaAuthoritySource,
} from "./local-project-owner-incoming-authority"
import {
  createLocalReplicaEnrollmentVerifierFactory,
  NodeDurableLocalReplicaAuthorityCache,
} from "./durable-local-authority-cache"
import { ElectronReplicaSigningVault } from "./electron-replica-signing-vault"
import { ElectronTeamIdentityVault } from "./electron-team-identity-vault"
import { NodeDurableLocalProjectOwnerAuthority } from "./local-project-owner-authority"
import { LocalProjectResetAuthority } from "./local-project-reset-authority"
import type { CanvasCollaborationSessionOwner } from "./canvas-collaboration-session-owner"
import {
  createLocalProjectOwnerIndexRegistrationPort,
  MainProjectIndexRuntimeRegistry,
} from "./main-project-index-runtime-registry"
import type { MainProjectCanvasRouteRuntimeRegistry } from "./project-canvas-route-runtime-registry"
import {
  createMainCanvasCollaborationComposition,
  createMainCanvasOwnerRuntime,
  type MainCanvasCollaborationComposition,
} from "./main-canvas-collaboration-composition"
import {
  createLocalBlobProjectIndexFactPorts,
  createProjectIndexCanvasGenesisFactPorts,
} from "./project-index-external-facts"
import {
  createCanvasDocumentGenesisAuthority,
  createCanvasGenesisNodeReplicaHeadMaterializer,
} from "./canvas-document-genesis"
import { createLocalProjectOwnerCanvasGenesisAuthority } from "./local-project-owner-canvas-genesis"
import { createProductionCanvasApplicationCommandAdapter } from "./canvas-application-command-adapter"
import { createProjectIndexBackedCanvasExternalFactAuthority } from "./canvas-route-external-facts"
import { registerCanvasSessionIpc } from "./canvas-session-ipc"
import {
  registerProjectTeamCollaborationIpc,
  type ProjectTeamCollaborationMainService,
} from "./project-team-collaboration-ipc"
import { ProjectTeamCollaborationManager } from "./project-team-collaboration-manager"
import { activateProjectSharingFromDurableBinding } from "./project-sharing-activation"
import { createDesktopCollaborationControlHttpClient } from "./collaboration-control-http-client"
import { parseDesktopCollaborationControlRuntimeConfig } from "./collaboration-control-runtime-config"
import { createDesktopTeamAuthorityAdmission, NodeDurableTeamAuthorityStore } from "./durable-team-authority-store"
import {
  DesktopProjectTeamReplicaProvisioner,
  ProductionProjectTeamPeerSessionFactory,
} from "./project-team-peer-session-factory"
import { NodeProjectTeamMemberIdentityStore } from "./project-team-member-identity-store"
import { createLocalTeamIncomingReplicaAuthoritySource } from "./team-incoming-replica-authority"
import {
  createMainProjectCollaborationComposition,
  type MainProjectCollaborationComposition,
} from "./project-collaboration-composition"
import type { ProjectTeamCollaborationStatus } from "../project-team-collaboration-contracts"

interface ProjectTeamCollaborationRuntime {
  readonly service: ProjectTeamCollaborationMainService &
    Readonly<{
      activateLocalProject(projectId: string): Promise<ProjectTeamCollaborationStatus>
      activateProject(projectId: string): Promise<ProjectTeamCollaborationStatus>
      quiesceProject(projectId: string): Promise<void>
    }>
  dispose(): Promise<void>
}

/**
 * Keeps the Team/control/data-plane closure absent until a durable Team binding
 * requires it. Local-first editing is the ordinary path: leaving the last shared
 * Project destroys the whole network runtime, and an unshared Project never
 * instantiates it as an accidental fallback. The gate observes no protocol.
 */
export function createProjectTeamRuntimeGate(
  input: Readonly<{
    createRuntime(): ProjectTeamCollaborationRuntime
    activateProjectSharing(
      input: Readonly<{
        projectId: string
        service: Pick<ProjectTeamCollaborationRuntime["service"], "activateLocalProject" | "activateProject">
      }>,
    ): Promise<ProjectTeamCollaborationStatus>
  }>,
) {
  let activeProjectId: string | null = null
  let runtime: ProjectTeamCollaborationRuntime | undefined
  let runtimeProjectId: string | null = null
  let unsubscribeRuntime: (() => void) | undefined
  let projectedStatus: ProjectTeamCollaborationStatus | null = null
  let runtimeTeardown: Promise<void> | null = null
  let disposed = false
  const listeners = new Set<(status: ProjectTeamCollaborationStatus) => void>()

  const publish = (status: ProjectTeamCollaborationStatus) => {
    if (activeProjectId === status.projectId) projectedStatus = status
    for (const listener of listeners) {
      try {
        listener(status)
      } catch {
        /* Display observers never affect collaboration authority. */
      }
    }
    return status
  }
  const status = (
    projectId: string,
    state: ProjectTeamCollaborationStatus["state"],
    reason: ProjectTeamCollaborationStatus["reason"],
  ): ProjectTeamCollaborationStatus =>
    Object.freeze({
      format: "convax.project-team-collaboration-status",
      projectId,
      state,
      canEdit: false,
      connectedPeerCount: 0,
      reason,
    })
  const localOnlyStatus = (projectId: string) => status(projectId, "local-only", null)
  const unavailableStatus = (projectId: string) => status(projectId, "attention", "service-unavailable")
  const requireLive = () => {
    if (disposed) throw new Error("Project Team collaboration runtime gate is disposed")
  }
  const requireActiveProject = (projectId: string) => {
    requireLive()
    if (activeProjectId !== projectId) throw new Error("Project Team collaboration request is stale")
  }
  const ensureRuntime = () => {
    requireLive()
    if (runtimeTeardown) throw new Error("Project Team collaboration runtime teardown is in progress")
    if (runtime) return runtime
    const created = input.createRuntime()
    runtime = created
    unsubscribeRuntime = created.service.subscribe((status) => {
      if (runtime !== created || activeProjectId !== status.projectId) return
      publish(status)
    })
    return created
  }
  const destroyRuntime = async () => {
    const current = runtime
    runtime = undefined
    runtimeProjectId = null
    const unsubscribe = unsubscribeRuntime
    unsubscribeRuntime = undefined
    unsubscribe?.()
    if (!current) {
      if (runtimeTeardown) await runtimeTeardown
      return
    }
    const teardown = (async () => {
      try {
        // Runtime disposal synchronously aborts any queued Team activation
        // before awaiting its serialized cleanup. Calling quiesceProject first
        // would enqueue the abort behind the very bootstrap/network operation
        // that teardown must cancel.
        await current.dispose()
      } finally {
        runtimeProjectId = null
      }
    })()
    runtimeTeardown = teardown
    try {
      await teardown
    } finally {
      if (runtimeTeardown === teardown) runtimeTeardown = null
    }
  }
  const requireCurrentRuntimeProject = (created: ProjectTeamCollaborationRuntime, projectId: string) => {
    if (runtime !== created || activeProjectId !== projectId) {
      throw new Error("Project Team collaboration runtime activation became stale")
    }
  }
  const ensureRuntimeProject = async (projectId: string) => {
    const created = ensureRuntime()
    if (runtimeProjectId !== projectId) {
      await created.service.activateLocalProject(projectId)
      requireCurrentRuntimeProject(created, projectId)
      runtimeProjectId = projectId
    }
    return created
  }
  const activationService = Object.freeze({
    async activateLocalProject(projectId: string) {
      if (runtime) {
        const created = runtime
        const next = await created.service.activateLocalProject(projectId)
        requireCurrentRuntimeProject(created, projectId)
        runtimeProjectId = projectId
        return next
      }
      runtimeProjectId = null
      return publish(localOnlyStatus(projectId))
    },
    async activateProject(projectId: string) {
      const created = ensureRuntime()
      const next = await created.service.activateProject(projectId)
      requireCurrentRuntimeProject(created, projectId)
      runtimeProjectId = projectId
      return next
    },
  })
  const service: ProjectTeamCollaborationMainService = Object.freeze({
    getStatus(projectId: string) {
      if (activeProjectId === projectId && projectedStatus?.projectId === projectId) return projectedStatus
      return runtime?.service.getStatus(projectId) ?? localOnlyStatus(projectId)
    },
    async bootstrapTeam(projectId: string) {
      requireActiveProject(projectId)
      const created = await ensureRuntimeProject(projectId)
      requireCurrentRuntimeProject(created, projectId)
      return created.service.bootstrapTeam(projectId)
    },
    async joinTeam(request: Parameters<ProjectTeamCollaborationMainService["joinTeam"]>[0]) {
      requireActiveProject(request.projectId)
      const created = await ensureRuntimeProject(request.projectId)
      requireCurrentRuntimeProject(created, request.projectId)
      return created.service.joinTeam(request)
    },
    subscribe(listener: Parameters<ProjectTeamCollaborationMainService["subscribe"]>[0]) {
      requireLive()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })

  return Object.freeze({
    service,
    async activateProject(projectId: string) {
      requireLive()
      const previousProjectId = activeProjectId
      activeProjectId = projectId
      projectedStatus = null
      try {
        if (runtime && previousProjectId !== null && previousProjectId !== projectId) {
          await destroyRuntime()
        }
        await input.activateProjectSharing({ projectId, service: activationService })
      } catch (activationError) {
        let teardownError: unknown
        try {
          await destroyRuntime()
        } catch (error) {
          teardownError = error
        }
        if (activeProjectId === projectId) {
          publish(unavailableStatus(projectId))
        }
        if (teardownError !== undefined) {
          console.warn("Project Team collaboration teardown also failed after activation", teardownError)
          throw new Error("Project Team collaboration activation and teardown failed", { cause: activationError })
        }
        throw activationError
      }
    },
    async quiesceProject(projectId: string) {
      requireLive()
      if (activeProjectId === projectId) {
        activeProjectId = null
        projectedStatus = null
        await destroyRuntime()
      }
    },
    async dispose() {
      if (disposed) return
      disposed = true
      activeProjectId = null
      projectedStatus = null
      listeners.clear()
      await destroyRuntime()
    },
  })
}

const trustedWebContents = new Set<number>()
const agentHostToolInactivityTimeout = 60 * 60_000
const officialMarketplaceSourceKey = computeSourceKey({
  deliveryPolicy: "github-pages-releases",
  descriptorUrl: "https://convaxai.github.io/convax-plugins/marketplace.json",
  kind: "network",
  marketplaceId: "convax-official",
  repository: { name: "convax-plugins", owner: "convaxai" },
})
type CloseGate = "approved" | "flushing" | "idle"

let quitGate: CloseGate = "idle"
let mainWindow: BrowserWindow | null = null
let pendingMainWindowActivation = false
const rendererUrl = desktopRendererUrl({
  isPackaged: app.isPackaged,
  requestedUrl: process.env.ELECTRON_RENDERER_URL,
})
const trustedRendererUrl = rendererUrl ?? pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href
const developmentCachePolicy = desktopDevelopmentCachePolicy({
  isPackaged: app.isPackaged,
  rendererUrl,
})

for (const commandLineSwitch of developmentCachePolicy.switches) {
  app.commandLine.appendSwitch(commandLineSwitch.name, commandLineSwitch.value)
}

const applicationName = desktopApplicationName({ isPackaged: app.isPackaged, packagedName: app.getName() })
app.setName(applicationName)

const packagedSmoke = app.isPackaged && process.env.CONVAX_PACKAGED_SMOKE === "1"
const userDataDirectoryOverride = desktopUserDataDirectory({
  appDataDirectory: app.getPath("appData"),
  isPackaged: app.isPackaged,
  packagedSmoke,
  packagedSmokeDirectory: process.env.CONVAX_PACKAGED_SMOKE_USER_DATA_DIR,
  requestedDirectory: process.env.CONVAX_USER_DATA_DIR,
  temporaryDirectory: tmpdir(),
})
if (userDataDirectoryOverride) app.setPath("userData", resolve(userDataDirectoryOverride))

function isTrustedRendererUrl(value: string) {
  try {
    const actual = new URL(value)
    const expected = new URL(trustedRendererUrl)
    return (
      actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname
    )
  } catch {
    return false
  }
}

function activateMainWindow() {
  const window = mainWindow
  if (!window || window.isDestroyed()) {
    pendingMainWindowActivation = true
    return
  }
  pendingMainWindowActivation = false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function createWindow(
  projectManager: NodeProjectManager,
  projectAssetGcScheduler: Pick<ProjectAssetGcScheduler, "closeAll">,
  projectFilePreviews: Pick<ProjectFilePreviewService, "revokeOwner">,
) {
  const window = new BrowserWindow({
    title: applicationName,
    icon: appIcon,
    ...resolveMainWindowChrome(process.platform),
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#f7f8f7",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      v8CacheOptions: developmentCachePolicy.v8CacheOptions,
    },
  })
  mainWindow = window
  if (pendingMainWindowActivation) activateMainWindow()
  const webContentsId = window.webContents.id
  const pluginFrameBindings = new PluginFrameBindingRegistry(window.webContents)
  const pluginFrameBindingSweep = setInterval(() => {
    pluginFrameBindings.retireUnavailable(window.webContents)
  }, 30_000)
  pluginFrameBindingSweep.unref()
  let pluginFrameBindingsDisposed = false
  const disposePluginFrameBindings = () => {
    if (pluginFrameBindingsDisposed) return
    pluginFrameBindingsDisposed = true
    clearInterval(pluginFrameBindingSweep)
    pluginFrameBindings.dispose(window.webContents)
  }
  trustedWebContents.add(webContentsId)
  window.once("closed", () => {
    disposePluginFrameBindings()
    trustedWebContents.delete(webContentsId)
    projectFilePreviews.revokeOwner(webContentsId)
    if (mainWindow === window) mainWindow = null
    projectAssetGcScheduler.closeAll()
  })
  window.webContents.once("destroyed", disposePluginFrameBindings)
  window.webContents.on("frame-created", () => {
    pluginFrameBindings.retireUnavailable(window.webContents)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  const restoreNativeMainWindowControls = () => setNativeMainWindowControlsVisible(process.platform, window, true)
  window.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame) {
      restoreNativeMainWindowControls()
      if (!isInPlace) {
        pluginFrameBindings.clear(window.webContents)
        projectFilePreviews.revokeOwner(webContentsId)
      }
      return
    }
    pluginFrameBindings.retireUnavailable(window.webContents)
  })
  window.webContents.on("render-process-gone", () => {
    restoreNativeMainWindowControls()
    projectFilePreviews.revokeOwner(webContentsId)
    pluginFrameBindings.clear(window.webContents)
  })
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) {
      if (!isTrustedRendererUrl(event.url)) event.preventDefault()
      return
    }
    const frame = event.frame
    if (!frame) {
      event.preventDefault()
      return
    }
    const existingBinding = pluginFrameBindings.bindingFor(window.webContents, frame)
    const boundIdentity = webPluginFrameBindingForNavigation(frame.url, event.url, existingBinding)
    if (boundIdentity && !existingBinding) pluginFrameBindings.bind(window.webContents, frame, boundIdentity)
    if (!isAllowedWebPluginFrameNavigation(frame.url, event.url, boundIdentity)) {
      event.preventDefault()
    }
  })
  window.webContents.on(
    "did-frame-navigate",
    (_event, url, _httpResponseCode, _httpStatusText, isMainFrame, frameProcessId, frameRoutingId) => {
      if (isMainFrame) return
      const binding = webPluginFrameBindingForNavigation("", url)
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
      if (!binding || !frame) return
      const bound = pluginFrameBindings.bindingFor(window.webContents, frame)
      if (!bound) pluginFrameBindings.bind(window.webContents, frame, binding)
    },
  )
  let closeGate: CloseGate = "idle"
  window.webContents.on("will-prevent-unload", () => {
    closeGate = "idle"
    quitGate = "idle"
  })
  window.on("close", (event) => {
    if (quitGate === "approved" || closeGate === "approved") return
    event.preventDefault()
    if (closeGate === "flushing" || quitGate === "flushing") return
    closeGate = "flushing"
    void projectManager.flushPendingWrites().then(
      () => {
        closeGate = "approved"
        window.close()
      },
      (error) => {
        closeGate = "idle"
        console.error("Convax window stayed open because project files could not be saved", error)
      },
    )
  })

  if (rendererUrl) {
    void window.loadURL(rendererUrl)
    return window
  }

  void window.loadURL(trustedRendererUrl)
  return window
}

function startApplication() {
  const userDataDirectory = app.getPath("userData")
  const recordPackagedSmokeStartup = async (stage: string, error?: unknown) => {
    if (!packagedSmoke) return
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error ?? "")
    await appendFile(
      join(userDataDirectory, "packaged-smoke-startup.log"),
      `${new Date().toISOString()} ${stage}${detail ? ` ${detail}` : ""}\n`,
      "utf8",
    ).catch((diagnosticError) => {
      console.warn("Could not record packaged smoke startup diagnostics", diagnosticError)
    })
  }
  const quarantinedDevelopmentCaches = quarantineLegacyDevelopmentCaches(
    userDataDirectory,
    developmentCachePolicy.legacyDirectoryNames,
  )
  for (const failure of quarantinedDevelopmentCaches.failures) {
    console.warn(`Could not quarantine obsolete Convax development cache ${failure.directoryName}`, failure.error)
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: "convax-asset",
      privileges: { corsEnabled: true, secure: true, standard: true, stream: true, supportFetchAPI: true },
    },
    { scheme: webPluginAssetScheme, privileges: webPluginAssetPrivileges },
    { scheme: pluginConnectedMediaScheme, privileges: pluginConnectedMediaPrivileges },
    { scheme: projectFilePreviewScheme, privileges: projectFilePreviewPrivileges },
    { scheme: petAssetScheme, privileges: petAssetPrivileges },
  ])
  app.on("second-instance", activateMainWindow)

  void app.whenReady().then(async () => {
    await recordPackagedSmokeStartup("electron-ready")
    if (process.platform === "darwin" && app.dock) app.dock.setIcon(appIcon)

    const ipcSecurity = {
      isTrustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) =>
        trustedWebContents.has(event.sender.id) &&
        Boolean(event.senderFrame && isTrustedRendererUrl(event.senderFrame.url)),
    }
    const createCollaborationId = () => parseId128(randomBytes(16).toString("base64url"))
    const openCodeConfigDirectory = join(userDataDirectory, "opencode")
    const projectCreationDirectory = desktopProjectWorkspaceDirectory(app.getPath("documents"))
    const projectManager = new NodeProjectManager({
      registryFile: join(userDataDirectory, "projects.json"),
      trash: (targetPath: string) => shell.trashItem(targetPath),
    })
    const projectFilePreviews = new ProjectFilePreviewService({
      images: {
        createFromPath: (file) => nativeImage.createFromPath(file),
      },
      projects: projectManager,
      trustedRendererUrl,
    })
    const collaborationProtocolRoot = app.isPackaged
      ? join(process.resourcesPath, "collaboration-protocol")
      : join(app.getAppPath(), ".packaging", "collaboration-protocol")
    const collaborationAuthority = await loadCurrentCollaborationProtocol({
      explicitProtocolRoot: collaborationProtocolRoot,
    })
    const collaborationAuthorityCache = new NodeDurableLocalReplicaAuthorityCache(
      join(userDataDirectory, "collaboration", "local-authority"),
      collaborationAuthority.protocolDigest,
    )
    const collaborationReplicaVault = new ElectronReplicaSigningVault(
      join(userDataDirectory, "collaboration", "replica-vault"),
      safeStorage,
    )
    const collaborationSignatureVerifier = createWebCryptoEd25519Verifier()
    // This local durable store performs no control-plane or PeerJS startup; the
    // Team runtime stays behind the protocol gate below.
    const collaborationTeamStore = new NodeDurableTeamAuthorityStore(
      join(userDataDirectory, "collaboration", "team-authority"),
    )
    const localProjectOwnerAuthority = new NodeDurableLocalProjectOwnerAuthority({
      rootDirectory: join(userDataDirectory, "collaboration", "local-project-owner"),
      authority: collaborationAuthority,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      projects: projectManager,
      vault: collaborationReplicaVault,
      verifier: collaborationSignatureVerifier,
    })
    const collaborationMaterializers = createProjectCollaborationMaterializerRegistry()
    let collaborationCanvasSessions: CanvasCollaborationSessionOwner | undefined
    let collaborationCanvasRoutes: MainProjectCanvasRouteRuntimeRegistry | undefined
    let collaborationProjectIndexes: MainProjectIndexRuntimeRegistry | undefined
    let collaborationCanvasComposition: MainCanvasCollaborationComposition | undefined
    let collaborationFacade: MainProjectCollaborationComposition | undefined
    let projectTeamRuntimeGate: ReturnType<typeof createProjectTeamRuntimeGate> | undefined
    let disposeCanvasSessionIpc: () => void = () => undefined
    let disposeProjectTeamCollaborationIpc: () => void = () => undefined
    let activeCollaborationProjectId: string | null = null
    let collaborationActivationLane: Promise<void> = Promise.resolve()
    const serializeCollaborationActivation = <Result>(operation: () => Promise<Result>): Promise<Result> => {
      const current = collaborationActivationLane.catch(() => undefined).then(operation)
      collaborationActivationLane = current.then(
        () => undefined,
        () => undefined,
      )
      return current
    }
    const quiesceCollaborationProject = (projectId: string) =>
      serializeCollaborationActivation(async () => {
        await projectTeamRuntimeGate?.quiesceProject(projectId)
        await collaborationFacade?.quiesceProject(projectId)
        if (activeCollaborationProjectId === projectId) {
          activeCollaborationProjectId = null
        }
      })
    const activateCollaborationProject = (projectId: string) =>
      serializeCollaborationActivation(async () => {
        const previous = activeCollaborationProjectId
        if (previous && previous !== projectId) {
          await projectTeamRuntimeGate?.quiesceProject(previous)
          await collaborationFacade?.quiesceProject(previous)
        }
        if (!collaborationFacade) throw new Error("Project collaboration facade is unavailable")
        await collaborationFacade.prepareProject(projectId)
        activeCollaborationProjectId = projectId
        try {
          if (!projectTeamRuntimeGate) throw new Error("Project Team collaboration runtime gate is unavailable")
          await projectTeamRuntimeGate.activateProject(projectId)
        } catch (error) {
          // A rendezvous outage never rolls back or closes the already durable local Project.
          console.warn("Could not start Project sharing; the local Project remains open", error)
        }
      })
    const durabilityDiagnostics = createPackagedDurabilityDiagnostics()
    const collaborationProjects = new NodeProjectCollaborationRuntimeCoordinator({
      ...(durabilityDiagnostics === undefined ? {} : { durabilityDiagnostics }),
      materializer: collaborationMaterializers,
      projects: projectManager,
      identity: {
        async resolveLocalActorId({ projectId, projectRoot }) {
          const manifest = await readProjectNativeStoreManifest(join(projectRoot, ".convax", "collaboration"), {
            protocolDigest: collaborationAuthority.protocolDigest,
            schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
            uriProtocolDigest: collaborationAuthority.protocolSchemaBundle.core.uriProtocolDigest,
          })
          if (manifest.projectIndexScope.projectId !== projectId) {
            throw new Error("Project collaboration manifest crossed the bound Project")
          }
          const binding = await collaborationAuthorityCache.resolveLocalProjectActor({
            projectId: manifest.projectIndexScope.projectId,
            projectEpoch: manifest.projectIndexScope.projectEpoch,
          })
          if (binding === "pending") {
            const localOwner = await localProjectOwnerAuthority.resolveExact({
              projectId: manifest.projectIndexScope.projectId,
              projectEpoch: manifest.projectIndexScope.projectEpoch,
              initializationAuthorityDigest: manifest.initializationAuthorityDigest,
            })
            if (localOwner === "missing") throw new Error("Local Project replica enrollment is pending")
            if (localOwner === "rejected") throw new Error("Local Project owner authority is rejected")
            return localOwner.binding.actorId
          }
          if (binding === "rejected") throw new Error("Local Project replica enrollment is rejected")
          return binding.actorId
        },
      },
      quiescence: {
        async quiesceProject({ projectId }) {
          await quiesceCollaborationProject(projectId)
        },
      },
    })
    const projectRecovery = new NodeProjectCollaborationRecoveryService({
      authority: new LocalProjectResetAuthority({
        authority: collaborationAuthority,
        owners: localProjectOwnerAuthority,
        teams: collaborationTeamStore,
      }),
      gate: collaborationProjects,
      projects: collaborationProjects,
    })
    const teamLocalCollaborationAuthority = createOfflineCurrentLocalReplicaAuthoritySource({
      cache: collaborationAuthorityCache,
      vault: collaborationReplicaVault,
    })
    const resolveLocalProjectOwner = async (identity: {
      readonly projectId: import("@convax/collaboration").ProjectId
      readonly projectEpoch: import("@convax/collaboration").Id128
    }) => {
      const projectRoot = await projectManager.resolveProjectRoot({ projectId: identity.projectId })
      const manifest = await readProjectNativeStoreManifest(join(projectRoot, ".convax", "collaboration"), {
        protocolDigest: collaborationAuthority.protocolDigest,
        schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
        uriProtocolDigest: collaborationAuthority.protocolSchemaBundle.core.uriProtocolDigest,
      })
      if (
        manifest.projectIndexScope.projectId !== identity.projectId ||
        manifest.projectIndexScope.projectEpoch !== identity.projectEpoch
      )
        return "rejected" as const
      return localProjectOwnerAuthority.resolveExact({
        projectId: identity.projectId,
        projectEpoch: identity.projectEpoch,
        initializationAuthorityDigest: manifest.initializationAuthorityDigest,
      })
    }
    const localOwnerCollaborationAuthority = createLocalProjectOwnerCurrentLocalReplicaAuthoritySource({
      protocolDigest: collaborationAuthority.protocolDigest,
      resolveOwner: resolveLocalProjectOwner,
    })
    const localCollaborationAuthority = createLocalFirstCurrentLocalReplicaAuthoritySource({
      team: teamLocalCollaborationAuthority,
      localOwner: localOwnerCollaborationAuthority,
      async teamState(projectId) {
        const state = await collaborationTeamStore.open(projectId)
        return state === "missing" ? "missing" : state === "rejected" ? "rejected" : "active"
      },
    })
    const incomingCollaborationAuthority = createCurrentIncomingReplicaAuthoritySource({
      localOwner: createLocalProjectOwnerIncomingReplicaAuthoritySource({
        protocolDigest: collaborationAuthority.protocolDigest,
        resolveOwner: resolveLocalProjectOwner,
      }),
      team: createLocalTeamIncomingReplicaAuthoritySource(collaborationTeamStore),
    })
    const canvasOwner = createMainCanvasOwnerRuntime(collaborationAuthority)
    const localCanvasGenesisAuthor = createLocalProjectOwnerCanvasGenesisAuthority({
      authority: collaborationAuthority,
      resolveOwner: resolveLocalProjectOwner,
    })
    const canvasGenesisAuthority = createCanvasDocumentGenesisAuthority({
      authority: collaborationAuthority,
      runtime: canvasOwner,
      historicalAuthorVerifier: localCanvasGenesisAuthor.historicalAuthorVerifier,
      authorProvider: localCanvasGenesisAuthor.authorProvider,
    })
    collaborationProjectIndexes = new MainProjectIndexRuntimeRegistry({
      authority: collaborationAuthority,
      projects: collaborationProjects,
      firstRegistration: createLocalProjectOwnerIndexRegistrationPort(
        collaborationAuthority,
        localProjectOwnerAuthority,
        projectManager,
      ),
      materializers: collaborationMaterializers,
      localAuthority: localCollaborationAuthority,
      incomingAuthority: incomingCollaborationAuthority,
      signatureVerifier: collaborationSignatureVerifier,
      createOperationId: createCollaborationId,
      createShardEpoch: createCollaborationId,
      describeProjectIndex({ scope, owner, project, blobs }) {
        const blobFactPorts = createLocalBlobProjectIndexFactPorts({
          factory: owner.externalFactPortFactory,
          scope,
          blobs,
        })
        const genesisFactPorts = createProjectIndexCanvasGenesisFactPorts({
          factory: owner.externalFactPortFactory,
          scope,
          persistence: project.persistence,
          genesisVerifier: canvasGenesisAuthority.genesisVerifier,
          proofVerifier: canvasGenesisAuthority.proofVerifier,
          preflightAuthor: canvasGenesisAuthority.preflight,
          async withGenesisMaterializer(scope, operation) {
            const release = collaborationMaterializers.register({
              scope,
              materializer: createCanvasGenesisNodeReplicaHeadMaterializer({
                authority: collaborationAuthority,
                runtime: canvasOwner,
                scope,
              }),
            })
            try {
              return await operation()
            } finally {
              release()
            }
          },
        })
        const selectFacts = (dependencies: import("@convax/collaboration").OwnerIntentDependencies<"project-index">) =>
          dependencies.externalFacts.every((fact) => fact.kind === "canvas-genesis-currentness")
            ? genesisFactPorts
            : blobFactPorts
        return {
          createDocument: createProjectIndexReconstructionYDoc,
          incomingFacts: Object.freeze({
            resolve(request: Parameters<typeof genesisFactPorts.incomingFacts.resolve>[0]) {
              return selectFacts(
                request.declaredDependencies as import("@convax/collaboration").OwnerIntentDependencies<"project-index">,
              ).incomingFacts.resolve(request)
            },
          }),
          requiredBlobDigests: requiredProjectIndexBlobDigests,
          facts: Object.freeze({
            resolve(request: Parameters<typeof genesisFactPorts.facts.resolve>[0]) {
              return selectFacts(request.dependencies).facts.resolve(request)
            },
          }),
          canvasGenesis: genesisFactPorts.canvasGenesis,
        }
      },
    })
    const pluginStateSchemaArtifactAuthority: {
      current?: Pick<PluginStateSchemaAuthorityV1, "resolveArtifact">
    } = {}
    const canvasSubmitDiagnostics =
      process.env.CONVAX_CANVAS_RESOURCE_LATENCY_RECORD_ALL === "1"
        ? {
            record(diagnostic: object) {
              try {
                console.warn("[convax:canvas-submit-latency]", JSON.stringify(diagnostic))
              } catch {
                /* Benchmark diagnostics never affect a Canvas command. */
              }
            },
          }
        : undefined
    collaborationCanvasComposition = createMainCanvasCollaborationComposition({
      authority: collaborationAuthority,
      canvasOwner,
      projects: collaborationProjects,
      projectIndexes: collaborationProjectIndexes,
      materializers: collaborationMaterializers,
      localAuthority: localCollaborationAuthority,
      incomingAuthority: incomingCollaborationAuthority,
      signatureVerifier: collaborationSignatureVerifier,
      applicationCommands: createProductionCanvasApplicationCommandAdapter(),
      diagnostics: canvasSubmitDiagnostics,
      createOperationId: createCollaborationId,
      createSessionId: createCollaborationId,
      createCursorToken: createCollaborationId,
      artifactAuthority: {
        async resolve({ ref }) {
          const authority = pluginStateSchemaArtifactAuthority.current
          if (!authority) {
            return Object.freeze({ status: "pending" as const, ref })
          }
          return authority.resolveArtifact(ref)
        },
      },
      factAuthority: createProjectIndexBackedCanvasExternalFactAuthority({
        currentResources: collaborationProjectIndexes,
        availableBlobs: collaborationProjectIndexes,
      }),
    })
    collaborationCanvasSessions = collaborationCanvasComposition.sessions
    collaborationCanvasRoutes = collaborationCanvasComposition.routes
    collaborationFacade = createMainProjectCollaborationComposition({
      projectIndexes: collaborationProjectIndexes,
      canvasSessions: collaborationCanvasSessions,
      canvasRoutes: collaborationCanvasRoutes,
    })
    collaborationCanvasSessions = collaborationFacade.canvasSessions
    projectTeamRuntimeGate = createProjectTeamRuntimeGate({
      activateProjectSharing: ({ projectId, service }) =>
        activateProjectSharingFromDurableBinding({
          projectId,
          sharing: collaborationTeamStore,
          service,
        }),
      createRuntime: () => {
        const collaborationControlConfig = parseDesktopCollaborationControlRuntimeConfig(
          process.env.CONVAX_COLLABORATION_CONTROL_RUNTIME,
        )
        const collaborationControlVerifier = collaborationControlConfig
          ? createPinnedControlServiceVerifier({
              keys: collaborationControlConfig.keys,
              verifier: createProjectControlEd25519Verifier(),
            })
          : Object.freeze({
              async verify() {
                return false
              },
            })
        const collaborationTrustBundleDigest =
          collaborationControlConfig?.trustBundleDigest ?? parseDigest("0".repeat(64))
        const collaborationControl = createDesktopCollaborationControlHttpClient({
          serviceBaseUrl: collaborationControlConfig?.serviceBaseUrl,
          verifier: collaborationControlVerifier,
        })
        const collaborationTeamAdmission = createDesktopTeamAuthorityAdmission({
          verifier: collaborationControlVerifier,
          protocolDigest: collaborationAuthority.protocolDigest,
          trustBundleDigest: collaborationTrustBundleDigest,
        })
        const collaborationTeamIdentityVault = new ElectronTeamIdentityVault(
          join(userDataDirectory, "collaboration", "team-identity-vault"),
          safeStorage,
        )
        const collaborationMemberIdentities = new NodeProjectTeamMemberIdentityStore(
          join(userDataDirectory, "collaboration", "member-identities"),
        )
        const collaborationValidationArtifacts = parseValidationArtifactSet({
          format: "convax.validation-artifact-set",
          artifacts: collaborationAuthority.protocolSchemaBundle.core.artifacts
            .map((artifact, index) => ({
              owner: (["canvas", "kernel", "control-plane", "project-index"] as const)[index],
              format: artifact.format,
              artifactDigest: artifact.artifactDigest,
            }))
            .sort((left, right) => String(left.owner).localeCompare(String(right.owner))),
        })
        const localReplicaEnrollment = createLocalReplicaEnrollmentVerifierFactory({
          async verifyCurrent(candidate) {
            const record = await collaborationTeamStore.open(candidate.projectId)
            if (typeof record === "string") return false
            const actor = record.replicaActorCredential
            const edit = record.replicaEditAuthorization
            return Boolean(
              actor &&
                edit &&
                record.membershipSnapshot.core.projectEpoch === candidate.projectEpoch &&
                record.membershipSnapshot.core.membershipSequence === candidate.membershipSequence &&
                record.membershipSnapshot.core.protocolDigest === candidate.protocolDigest &&
                actor.core.actorId === candidate.actorId &&
                actor.core.replicaSigningPublicKey === candidate.replicaSigningPublicKey &&
                actor.coreDigest === candidate.signerAuthority.replicaActorCredentialCoreDigest &&
                edit.coreDigest === candidate.controlEvidenceDigest &&
                edit.coreDigest === candidate.signerAuthority.replicaEditAuthorizationCoreDigest &&
                record.membershipSnapshot.coreDigest === candidate.signerAuthority.membershipSnapshotDigest,
            )
          },
        })
        const teamReplicaProvisioner = new DesktopProjectTeamReplicaProvisioner({
          control: collaborationControl,
          teamAdmission: collaborationTeamAdmission,
          teamStore: collaborationTeamStore,
          memberVault: collaborationTeamIdentityVault,
          replicaVault: collaborationReplicaVault,
          // The first active-editor floor requires the API's isolated content
          // attester to replay the exact ProjectIndex closure. Until that signed
          // artifact exists, the durable pending-editor replica remains explicit.
          floor: {
            async activate() {
              return "pending" as const
            },
          },
          localEnrollment: localReplicaEnrollment,
          localAuthority: collaborationAuthorityCache,
          validationArtifacts: collaborationValidationArtifacts,
          createId: createCollaborationId,
        })
        const productionTeamFactory = new ProductionProjectTeamPeerSessionFactory({
          control: collaborationControl,
          teamAdmission: collaborationTeamAdmission,
          teamStore: collaborationTeamStore,
          memberIdentity: collaborationMemberIdentities,
          memberVault: collaborationTeamIdentityVault,
          nativeFacts: {
            async resolve(projectId) {
              const projectRoot = await projectManager.resolveProjectRoot({ projectId })
              const manifest = await readProjectNativeStoreManifest(join(projectRoot, ".convax", "collaboration"), {
                protocolDigest: collaborationAuthority.protocolDigest,
                schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
                uriProtocolDigest: collaborationAuthority.protocolSchemaBundle.core.uriProtocolDigest,
              })
              return Object.freeze({
                projectId: manifest.projectIndexScope.projectId,
                projectEpoch: manifest.projectIndexScope.projectEpoch,
                projectIndexShardEpoch: manifest.projectIndexScope.shardEpoch,
                initializationAuthorityDigest: manifest.initializationAuthorityDigest,
                initialProjectIndexCheckpointDigest: manifest.emptyProjectIndexCheckpointObjectDigest,
                initialProjectIndexFullUpdateDigest: manifest.emptyProjectIndexFullUpdateDigest,
                initialProjectIndexStateVectorDigest: manifest.emptyProjectIndexStateVectorDigest,
                initialProjectIndexCanonicalStateDigest: manifest.emptyProjectIndexCanonicalStateDigest,
              })
            },
          },
          provisioner: teamReplicaProvisioner,
          sessions: {
            async open() {
              throw new Error("Verified Peer handshake/channel-open session port is unavailable")
            },
          },
          protocolDigest: collaborationAuthority.protocolDigest,
          trustBundleDigest: collaborationTrustBundleDigest,
          createId: createCollaborationId,
          async afterAuthorityChange(projectId) {
            if (!collaborationFacade) throw new Error("Project collaboration facade is unavailable")
            await collaborationFacade.quiesceProject(projectId)
            await collaborationFacade.prepareProject(projectId)
            activeCollaborationProjectId = projectId
          },
        })
        const service = new ProjectTeamCollaborationManager(productionTeamFactory)
        service.setOnline(net.isOnline())
        const refreshConnectivity = () => service.setOnline(net.isOnline())
        powerMonitor.on("resume", refreshConnectivity)
        app.on("browser-window-focus", refreshConnectivity)
        return Object.freeze({
          service,
          async dispose() {
            powerMonitor.removeListener("resume", refreshConnectivity)
            app.removeListener("browser-window-focus", refreshConnectivity)
            await service.dispose()
          },
        })
      },
    })
    const petAssetInspector = createElectronPetAssetInspector(nativeImage)
    const customPets = new CustomPetStore({
      createId: randomUUID,
      inspector: petAssetInspector,
      petsRoot: join(userDataDirectory, "pets"),
    })
    const marketplaceProductRoot = app.isPackaged
      ? join(process.resourcesPath, "marketplace-product")
      : join(app.getAppPath(), ".packaging", "marketplace-product")
    let marketplaceProduct: PackagedMarketplaceProduct | null = null
    try {
      marketplaceProduct = await PackagedMarketplaceProduct.load(marketplaceProductRoot)
    } catch (error) {
      console.error("Packaged Marketplace product is unavailable; fixed sources remain reserved", error)
    }
    const packagedRetiredPluginSourceMigrations = marketplaceProduct?.retiredPluginSourceMigrations() ?? []
    const pluginRuntimeSession = await openDesktopPluginRuntimeSession(userDataDirectory, {
      retiredSourceMigrations: packagedRetiredPluginSourceMigrations,
    })
    await recordPackagedSmokeStartup("plugin-runtime-ready")
    const pluginInstallations = pluginRuntimeSession.installations
    const pluginUpdateInstallations = pluginRuntimeSession.updateInstallations
    const retiredHostApiRecovery =
      pluginRuntimeSession.state.state === "quarantined" ? pluginRuntimeSession.state.retiredHostApiRecovery : undefined
    if (pluginRuntimeSession.state.state === "quarantined") {
      console.error("Plugin ActiveSet is invalid; Plugin execution is quarantined for this session", {
        errorType: pluginRuntimeSession.state.errorType,
        updateRecoveryPlugins: retiredHostApiRecovery?.plugins.length ?? 0,
      })
    }
    const pluginSnapshotInstaller = new PluginSnapshotInstaller(pluginUpdateInstallations, {
      ...(retiredHostApiRecovery ? { retiredHostApiRecovery } : {}),
      retiredSourceMigrations: packagedRetiredPluginSourceMigrations,
    })
    const generationEnvironment = generationPluginEnvironment(process.env)
    const pluginServiceAuthorizationCheckpoints = new PluginServiceAuthorizationCheckpointStore(
      join(pluginRuntimeSession.dataDirectory, "plugin-service-authorization-checkpoints"),
    )
    const reconcileToolPluginExecutionStateForPlugin = async (pluginId: string) => {
      try {
        await pluginServiceAuthorizationCheckpoints.remove(pluginId)
      } catch (error) {
        console.warn(`Could not discard changed Plugin service authorization checkpoint: ${pluginId}`, error)
      }
    }
    const projectCanvases = new NodeProjectCanvasManager({
      queryCatalog(input) {
        if (!collaborationFacade) throw new Error("ProjectIndex collaboration runtime is unavailable")
        return collaborationFacade.projectIndexes.queryCatalog(input)
      },
      submitRouteCommand(input) {
        if (!collaborationFacade) throw new Error("ProjectIndex collaboration runtime is unavailable")
        return collaborationFacade.projectIndexes.submitRouteCommand(input)
      },
    })
    const projectAssets = new ProjectManagedAssetStore(projectManager)
    const projectFilePublisher = new ProjectFilePublisher(projectManager, projectAssets)
    const projectAssetGcScheduler = new ProjectAssetGcScheduler({
      gc: new ProjectAssetGc({
        assets: projectAssets,
        references: collaborationFacade.projectIndexes,
        projects: projectManager,
      }),
    })
    const canvasDocuments = new ProjectCanvasDocumentService(
      {
        query(ref, query) {
          if (!collaborationCanvasSessions) throw new Error("Canvas collaboration runtime is unavailable")
          return collaborationCanvasSessions.query(ref, query)
        },
        submit(request) {
          if (!collaborationCanvasSessions) throw new Error("Canvas collaboration runtime is unavailable")
          return collaborationCanvasSessions.submit(request)
        },
      },
      canvasSubmitDiagnostics,
    )
    const canvasResourceHydrator = new ProjectCanvasResourceHydrator(
      projectManager,
      projectAssets,
      createProjectResourceUrl,
      { currentResources: collaborationFacade.projectIndexes },
    )
    const projectResourceReader = new ProjectResourceReader(projectManager, projectAssets)
    const canvasDocumentChanges = new CanvasDocumentChangeBus()
    // The application service uses the initializing document service so a
    // Plugin/Agent can address a catalogued Canvas before it has ever mounted.
    const canvasApplication = new CanvasApplicationService(canvasDocuments, {
      diagnostics: canvasSubmitDiagnostics,
      onDidCommit(event) {
        canvasDocumentChanges.publish({
          ref: { canvasId: event.canvasId, projectId: event.scopeId },
          operationReceipt: event.operationReceipt,
          source: event.actor.kind === "plugin" ? "plugin" : event.actor.kind === "renderer" ? "renderer" : "host",
        })
      },
    })
    const canvasResourceBusinessDiagnostics =
      process.env.CONVAX_CANVAS_RESOURCE_LATENCY_RECORD_ALL === "1"
        ? {
            record(diagnostic: object) {
              try {
                console.warn("[convax:canvas-resource-latency]", JSON.stringify(diagnostic))
              } catch {
                /* Benchmark diagnostics never affect a business command. */
              }
            },
          }
        : undefined
    const canvasResourcePreparation = new ProjectCanvasResourcePreparation(
      projectManager,
      projectFilePublisher,
      projectAssets,
      createProjectCanvasMediaInspector({
        decoder: nativeImage,
      }),
      collaborationFacade.projectIndexes,
      canvasResourceBusinessDiagnostics,
    )
    const canvasResources = new CanvasResourceBusinessService(
      canvasResourcePreparation,
      canvasApplication,
      canvasSubmitDiagnostics,
    )
    const canvasGenerationRuns = new CanvasNodeGenerationRunBusinessService(canvasApplication)
    const managedCanvasMedia = new ManagedCanvasMediaResolver({
      assets: projectAssets,
      application: canvasApplication,
      projects: projectManager,
    })
    const canvasExternalMediaDrag = new CanvasExternalMediaDragService({
      createIcon: createCanvasExternalMediaDragIconFactory({
        adapter: {
          createFromBitmap: (buffer, options) => nativeImage.createFromBitmap(buffer, options),
          createFromPath: (file) => nativeImage.createFromPath(file),
          createThumbnailFromPath: (file, size) => nativeImage.createThumbnailFromPath(file, size),
        },
      }),
      media: managedCanvasMedia,
      onCleanupError: (error) => console.warn("Could not clean Canvas native drag media", error),
      stagingRoot: join(userDataDirectory, "canvas-external-drags"),
    })
    void canvasExternalMediaDrag.initialize().catch((error) => {
      console.warn("Could not initialize Canvas native drag media", error)
    })
    const canvasRenderer = createCanvasRendererBridge({
      isTrustedSender: ipcSecurity.isTrustedSender,
      isTrustedWebContentsId: (id) => trustedWebContents.has(id),
    })
    const canvasProjectionSubscription = canvasDocumentChanges.subscribeAll((event) => {
      if (event.source === "renderer") return
      void canvasRenderer
        .reloadDocument({ canvasId: event.ref.canvasId, scopeId: event.ref.projectId })
        .catch((error) => console.warn("Could not refresh the Canvas renderer projection", error))
    })
    const pluginPrincipals = new InstalledPluginPrincipalResolver(pluginInstallations)
    const pluginStateSchemas = new PluginStateSchemaAuthorityV1(pluginInstallations)
    await pluginStateSchemas.primeActive()
    pluginStateSchemaArtifactAuthority.current = pluginStateSchemas
    const pluginCanvasStates = new PluginCanvasStateServiceV1({
      canvas: {
        queryAuthoritative(ref) {
          if (!collaborationCanvasSessions) throw new Error("Canvas collaboration runtime is unavailable")
          return collaborationCanvasSessions.queryAuthoritative(ref)
        },
        submitAuthoritative(input) {
          if (!collaborationCanvasSessions) throw new Error("Canvas collaboration runtime is unavailable")
          return collaborationCanvasSessions.submitAuthoritative(input)
        },
      },
      schemas: pluginStateSchemas,
    })
    const pluginConnectedMedia = new PluginConnectedMediaService({
      changes: canvasDocumentChanges,
      application: canvasApplication,
      images: createElectronPluginConnectedImageInspector(nativeImage),
      media: managedCanvasMedia,
      plugins: pluginInstallations,
      resources: canvasResourceHydrator,
    })
    const pluginMaterialization = new PluginMaterializationService({
      application: canvasApplication,
      plugins: pluginInstallations,
    })
    const pluginSurfaces = new PluginSurfaceService({
      application: canvasApplication,
      plugins: pluginInstallations,
      schemas: pluginStateSchemas,
    })
    const pluginCanvasCapabilities = new PluginCanvasCapabilityService({
      application: canvasApplication,
      canvases: projectCanvases,
      changes: canvasDocumentChanges,
      plugins: pluginPrincipals,
      projects: projectManager,
    })
    const pluginCanvasImages = new PluginCanvasImageService({
      application: canvasApplication,
      plugins: pluginInstallations,
      projects: projectFilePublisher,
      resources: canvasResources,
    })
    let marketplaceRuntimeState: FileMarketplaceStateStore | undefined
    const marketplacePluginRuntimeState = async (pluginId: string) => {
      const plugin = (await pluginInstallations.list()).find((entry) => entry.id === pluginId)
      if (!plugin) return "disabled" as const
      const authorizationContractDigest = await pluginInstallations.executionAuthorizationIdentity(pluginId)
      const state = await marketplaceRuntimeState?.read()
      if (
        state?.transitions.some(
          (transition) => transition.identity.kind === "plugin" && transition.identity.id === pluginId,
        )
      ) {
        return "recovering" as const
      }
      return isMarketplacePluginRuntimeAdmitted({
        authorizationContractDigest,
        pluginId,
        pluginVersion: plugin.version,
        state,
      })
        ? ("enabled" as const)
        : ("disabled" as const)
    }
    const isMarketplacePluginEnabled = async (pluginId: string) =>
      (await marketplacePluginRuntimeState(pluginId)) === "enabled"
    let pluginHostApi: PluginHostApiService | undefined
    const generationRuntime = new GenerationPluginRuntime({
      bunRuntime: desktopBunRuntime({
        applicationDirectory: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesDirectory: process.resourcesPath,
      }),
      canvasCapabilities: {
        async connect(input) {
          const host = pluginHostApi
          if (!host) throw new Error("Plugin Host API router is not initialized")
          const canvas = await pluginCanvasCapabilities.connect(
            { principal: input.principal, scope: input.scope },
            input.invocationLease,
          )
          return host.connect({ ...input, canvas })
        },
        principals: pluginPrincipals,
      },
      environment: generationEnvironment,
      isPluginEnabled: isMarketplacePluginEnabled,
      pluginRuntimeState: marketplacePluginRuntimeState,
      plugins: pluginInstallations,
      recoveryRuntimeDirectory: join(pluginRuntimeSession.dataDirectory, "generation-sidecars", "runtime-v3"),
      recoveryStateDirectory: join(pluginRuntimeSession.dataDirectory, "generation-sidecars", "operation-v1"),
    })
    await generationRuntime.initialize()
    await recordPackagedSmokeStartup("generation-runtime-ready")
    const pluginCapabilityBroker = new PluginCapabilityBrokerMainService({
      installations: pluginInstallations,
      principals: pluginPrincipals,
      sidecars: generationRuntime,
    })
    const pluginServiceBrowserAuthorization = createElectronPluginServiceBrowserAuthorizationBroker(
      pluginServiceAuthorizationCheckpoints,
    )
    const pluginServiceExternalAuthorization = createElectronPluginServiceExternalAuthorizationBroker()
    let refreshAgentConfiguration: (() => Promise<void>) | undefined
    let refreshGenerationCatalogAfterServiceMutation: (() => void) | undefined
    const pluginServices = new PluginServiceHost(
      generationRuntime,
      pluginServiceBrowserAuthorization,
      pluginServiceExternalAuthorization,
      createElectronPluginServiceCheckoutNavigation(),
      async () => {
        refreshGenerationCatalogAfterServiceMutation?.()
        await refreshAgentConfiguration?.()
      },
      activateMainWindow,
    )
    const availableGenerationTools = new ServiceAwareGenerationTools(generationRuntime, pluginServices)
    const scheduleGenerationCatalogRefresh = (reason: string) => {
      if (pluginRuntimeSession.state.state === "quarantined") return
      availableGenerationTools.invalidate()
      void availableGenerationTools.refresh().catch((error) => {
        console.warn(`Could not refresh the generation model catalog after ${reason}`, {
          errorType: error instanceof Error ? error.name : typeof error,
        })
      })
    }
    refreshGenerationCatalogAfterServiceMutation = () => scheduleGenerationCatalogRefresh("a Plugin service mutation")
    const generationOperations = new GenerationOperationStore(
      join(userDataDirectory, "generation-operations", "operation-v1"),
    )
    const generationInputSnapshots = new GenerationInputSnapshotStore(
      join(userDataDirectory, "generation-operations", "input-v1"),
    )
    const generation = new GenerationCanvasService({
      assets: projectAssets,
      application: canvasApplication,
      currentResources: collaborationFacade.projectIndexes,
      inputSnapshots: generationInputSnapshots,
      operations: generationOperations,
      publisher: projectFilePublisher,
      projects: projectManager,
      renderer: canvasRenderer,
      resources: canvasResources,
      runs: canvasGenerationRuns,
      tools: availableGenerationTools,
    })
    const generationRecoveryActor = { id: "desktop:main-supervisor", kind: "host" } as const
    const logGenerationRecoveryFailure = (stage: string, error: unknown) => {
      const errorType = error instanceof Error ? error.name : typeof error
      console.warn(`Generation recovery ${stage} failed`, { errorType })
    }
    const reconcileProjectGeneration = async (projectId: string) => {
      const catalog = await projectCanvases.getCanvasCatalog({ projectId })
      for (const canvas of catalog.visibleCanvases) {
        try {
          await generation.reconcileCanvas({ canvasId: canvas.canvasId, scopeId: projectId }, generationRecoveryActor)
        } catch (error) {
          logGenerationRecoveryFailure("Canvas reconciliation", error)
        }
      }
    }
    const reconcileProjectGenerationSafely = async (projectId: string) => {
      try {
        await reconcileProjectGeneration(projectId)
      } catch (error) {
        logGenerationRecoveryFailure("Project reconciliation", error)
      }
    }
    try {
      const projects = await projectManager.list()
      await Promise.all(
        projects
          .filter((project) => !project.missing && (!project.recovery || project.recovery.status === "current"))
          .map((project) => reconcileProjectGenerationSafely(project.id)),
      )
    } catch (error) {
      logGenerationRecoveryFailure("startup", error)
    }
    let resolveManagedMcpPrincipal: (serverKey: string) => Promise<ManagedMcpPrincipalState | null> = async () => null
    const managedMcpAgentTools = new ManagedMcpAgentToolRegistry({
      resolvePrincipal: (serverKey) => resolveManagedMcpPrincipal(serverKey),
    })
    const managedMcpRuntimes = new ManagedMcpRuntimeManager({
      agentTools: managedMcpAgentTools,
      bunRuntime: desktopBunRuntime({
        applicationDirectory: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesDirectory: process.resourcesPath,
      }),
      root: join(userDataDirectory, "mcp-server-runtime"),
    })
    const agentPluginConfigurations = new PluginAgentConfigurationResolver({
      plugins: pluginInstallations,
      readMarketplaceState: () => Promise.resolve(marketplaceRuntimeState?.read()),
    })
    const agentRuntime = new OpenCodeAgentRuntime({
      binaryDirectory: desktopOpenCodeBinaryDirectory({
        isPackaged: app.isPackaged,
        resourcesDirectory: process.resourcesPath,
      }),
      configDirectory: openCodeConfigDirectory,
      resolvePluginConfiguration: () => agentPluginConfigurations.resolve(),
      async resolveProviders() {
        try {
          const providers = await generationRuntime.connectLlmProviders()
          const availability = await Promise.all(
            providers.map(async (provider) => ({
              available: await availableGenerationTools.isPluginAvailable(provider.pluginId),
              provider,
            })),
          )
          return Object.fromEntries(
            availability
              .filter(({ available }) => available)
              .map(({ provider }) => [
                provider.providerId,
                {
                  models: Object.fromEntries(provider.models.map((model) => [model.id, { name: model.name }])),
                  name: provider.name,
                  npm:
                    provider.protocol === "openrouter"
                      ? "@openrouter/ai-sdk-provider"
                      : provider.protocol === "openai"
                        ? "@ai-sdk/openai"
                        : "@ai-sdk/openai-compatible",
                  options: {
                    apiKey: provider.apiKey,
                    baseURL: provider.baseUrl,
                  },
                },
              ]),
          )
        } catch (error) {
          console.warn("Could not connect installed Plugin LLM providers", error)
          return {}
        }
      },
      protectedPathPatterns: [".convax", ".convax/**", "**/.convax", "**/.convax/**"],
      protectedPaths: [".convax"],
      // Progress heartbeats reset this inactivity guard, so accepted generation
      // jobs have no absolute Agent deadline. OpenCode Stop still cancels the MCP
      // request and propagates through the host AbortSignal.
      toolCallTimeout: agentHostToolInactivityTimeout,
      toolProvider: createCompositeAgentToolProvider([
        managedMcpAgentTools,
        createCanvasAgentToolProvider({
          application: canvasApplication,
          canvases: projectCanvases,
          renderer: canvasRenderer,
          resources: canvasResources,
          textResources: createCanvasTextResourceWriter({
            application: canvasApplication,
            currentResources: collaborationFacade.projectIndexes,
            files: projectManager,
            preparation: canvasResourcePreparation,
            resources: canvasResources,
          }),
        }),
        createGenerationAgentToolProvider(generation),
        createPluginOperationAgentToolProvider(generation, {
          async resolveActiveCanvas() {
            const snapshot = await canvasRenderer.getViewSnapshot("desktop-main")
            return snapshot
              ? {
                  canvasId: snapshot.documentId,
                  scopeId: snapshot.scopeId,
                }
              : null
          },
        }),
      ]),
      toolServerName: "convax",
    })
    refreshAgentConfiguration = () => agentRuntime.refreshConfiguration()
    const petStateStore = new PetStateStore(join(userDataDirectory, "pet-state-v1.json"))
    const activity = new AgentActivityController({
      projects: projectManager,
      runtime: agentRuntime,
      watermarks: petStateStore,
    })
    const activityLifecycle = createDemandDrivenAsyncLifecycle({
      onError: (error) => console.warn("Could not refresh Pet activity", error),
      start: () => activity.start(),
      stop: () => activity.stop(),
    })
    const petActivity = {
      getSnapshot: () => activity.getSnapshot(),
      subscribe(listener: Parameters<typeof activity.subscribe>[0]) {
        const unsubscribe = activity.subscribe(listener)
        let release: () => void
        try {
          release = activityLifecycle.acquire()
        } catch (error) {
          unsubscribe()
          throw error
        }
        let disposed = false
        return () => {
          if (disposed) return
          disposed = true
          unsubscribe()
          release()
        }
      },
    }
    let petDisplayState = await petStateStore.read()
    let connectPetOverlay: ReturnType<typeof registerPetIpc>["connectOverlay"] = () => {
      throw new Error("Pet overlay IPC is not ready")
    }
    let pets: PetProviderController
    const petWindow = new PetWindow({
      createWindow: (options) => new BrowserWindow(options as BrowserWindowConstructorOptions),
      onFatal: createDetachedAsyncCallback(
        () => pets.setAwake({ awake: false }),
        (error) => console.warn("Could not tuck a failed Pet overlay", error),
      ),
      onLoaded: (webContents, provider) => connectPetOverlay(webContents, provider),
      async onPositionChanged(displayId, position, scaleFactor) {
        petDisplayState = await petStateStore.update((state) => ({
          ...state,
          displayId,
          positions: { ...state.positions, [displayId]: { ...position, scaleFactor } },
        }))
      },
      powerMonitor,
      preloadPath: join(import.meta.dirname, "../preload/pet.js"),
      resolveDisplayId: () => petDisplayState.displayId,
      resolvePosition: (displayId) => petDisplayState.positions[displayId],
      screen,
    })
    pets = new PetProviderController({
      activity: petActivity,
      pluginManager: pluginInstallations,
      stateStore: petStateStore,
      window: petWindow,
    })
    const petIpc = registerPetIpc(pets, activity, petWindow, {
      createMessageChannel: () => new MessageChannelMain(),
      customPets,
      getMainWindow: () => mainWindow,
      ipcMain,
      isTrustedMainSender: ipcSecurity.isTrustedSender,
      async openMainWindow() {
        return mainWindow && !mainWindow.isDestroyed()
          ? mainWindow
          : createWindow(projectManager, projectAssetGcScheduler, projectFilePreviews)
      },
      async pickCustomPetSource() {
        const options: OpenDialogOptions = {
          filters: [
            { extensions: ["png"], name: "PNG atlas" },
            { extensions: ["webp"], name: "WebP atlas" },
          ],
          properties: ["openFile"],
          title: "Add custom pet",
        }
        const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
        const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
        return result.canceled ? undefined : result.filePaths[0]
      },
    })
    connectPetOverlay = petIpc.connectOverlay
    const pluginAgentMcpConnection = new PluginAgentMcpConnectionService(
      agentRuntime,
      pluginRuntimeSession.dataDirectory,
    )
    const managedSkillStore = new ManagedAgentSkillStore(openCodeConfigDirectory)
    const skillMutations = new DesktopSkillMutationCoordinator()
    const pluginSkillReservations = {
      async assertSettled() {
        await pluginInstallations.readActive()
      },
      async reservations() {
        const activeSet = await pluginInstallations.acquireActivePluginSet()
        try {
          return activeSet.plugins.flatMap((handle) =>
            handle.descriptor.ownedSkills.map((skill) => ({
              pluginId: handle.plugin.id,
              pluginName: handle.plugin.name,
              pluginVersion: handle.plugin.version,
              skillName: skill.name,
              sourcePath:
                handle.plugin.contributes.skills?.find((contribution) => contribution.name === skill.name)?.path ??
                skill.name,
              sourceSha256: pluginSnapshotCanonicalDigest(skill),
            })),
          )
        } finally {
          activeSet.release()
        }
      },
    }
    const skillManager = new DesktopSkillManager(
      managedSkillStore,
      agentRuntime,
      userDataDirectory,
      [],
      [],
      pluginSkillReservations,
      skillMutations,
    )
    const marketplaceArtifactInstaller = new MarketplaceArtifactInstaller({
      beforePluginPublish: async ({ pluginId, sourceIdentity }) => {
        pluginRuntimeSession.assertUpdateMutable({ pluginId, sourceIdentity })
        await pluginServices.discardPlugin(pluginId)
      },
      deferExecutionAuthorization: true,
      skillManager,
      snapshotInstaller: pluginSnapshotInstaller,
    })
    let developmentOfficialArtifacts: DevelopmentOfficialMarketplaceArtifacts | null = null
    const developmentOfficialArtifactRoot = process.env.CONVAX_OFFICIAL_MARKETPLACE_ARTIFACT_ROOT
    if (!app.isPackaged && developmentOfficialArtifactRoot) {
      try {
        developmentOfficialArtifacts = await DevelopmentOfficialMarketplaceArtifacts.load(
          developmentOfficialArtifactRoot,
        )
      } catch (error) {
        console.warn("Development Official Marketplace artifacts are unavailable", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        })
      }
    }
    const admittedRetiredPluginSourceMigrations = packagedRetiredPluginSourceMigrations.filter((migration) =>
      retiredHostApiRecovery?.plugins.some(
        (plugin) => plugin.pluginId === migration.pluginId && plugin.sourceIdentity === migration.fromSourceIdentity,
      ),
    )
    const marketplaceFetcher = new PinnedHttpsFetcher()
    const marketplaceState = new FileMarketplaceStateStore(join(userDataDirectory, "marketplaces", "state-v1.json"), {
      sourceMigrations: admittedRetiredPluginSourceMigrations.map((migration) => ({
        fromSourceKey: migration.fromSourceIdentity as SourceKey,
        id: migration.pluginId,
        kind: "plugin",
        toSourceKey: migration.toSourceIdentity as SourceKey,
      })),
    })
    marketplaceRuntimeState = marketplaceState
    const networkMarketplaces = new NetworkMarketplaceManager({
      fetcher: marketplaceFetcher,
      reservedMarketplaceIds: new Set(["convax-builtin", "convax-local", "convax-official"]),
      root: join(userDataDirectory, "marketplaces", "network"),
    })
    const officialSourceKey = officialMarketplaceSourceKey
    let localMarketplaceSourceKey: SourceKey | undefined
    let localMarketplace: LocalMarketplaceStore | undefined
    const localCandidate = new LocalMarketplaceStore({
      hasRetainedReferences: async () => {
        const state = await marketplaceState.read()
        if (!localMarketplaceSourceKey) {
          const knownNonLocal = new Set<SourceKey>([
            builtinSourceKey(),
            officialSourceKey,
            ...(await networkMarketplaces.listSources()).map((entry) => entry.sourceKey),
          ])
          return (
            state.installations.some((entry) => !knownNonLocal.has(entry.sourceKey)) ||
            state.transitions.some(
              (entry) =>
                (entry.previous && !knownNonLocal.has(entry.previous.sourceKey)) ||
                (entry.next && !knownNonLocal.has(entry.next.sourceKey)),
            )
          )
        }
        return (
          state.installations.some((entry) => entry.sourceKey === localMarketplaceSourceKey) ||
          state.transitions.some(
            (entry) =>
              entry.previous?.sourceKey === localMarketplaceSourceKey ||
              entry.next?.sourceKey === localMarketplaceSourceKey,
          )
        )
      },
      marketplaceId: "convax-local",
      root: join(userDataDirectory, "marketplaces", "local", "primary"),
      transition: new FileLocalMarketplaceImportTransition(
        join(userDataDirectory, "marketplaces", "local", "primary-import-transition-v1.json"),
      ),
    })
    try {
      const localIdentity = await localCandidate.initialize()
      localMarketplaceSourceKey = computeSourceKey({
        kind: "local",
        marketplaceId: localIdentity.marketplaceId,
        policyVersion: localIdentity.policyVersion,
        sourceInstanceId: localIdentity.sourceInstanceId,
      })
      localMarketplace = localCandidate
    } catch (error) {
      console.error("Local Marketplace is degraded; fixed and Network sources remain available", error)
    }
    const marketplaceMcp = new MarketplaceMcpMetadataStore({
      companionRoot: join(userDataDirectory, "marketplaces", "mcp-companions"),
      file: join(userDataDirectory, "marketplaces", "mcp-metadata-v1.json"),
      refreshAgentConfiguration: () => agentRuntime.refreshConfiguration(),
      runtimes: managedMcpRuntimes,
    })
    resolveManagedMcpPrincipal = async (serverKey) => {
      const metadata = (await marketplaceMcp.read()).records.find(
        (record) => marketplaceMcpServerKey(record.id) === serverKey,
      )
      if (!metadata) return null
      const state = await marketplaceState.read()
      const installed = state.installations.find(
        (record) =>
          record.kind === "mcp-server" &&
          record.id === metadata.id &&
          record.sourceKey === metadata.sourceKey &&
          record.version === metadata.version,
      )
      const grant = state.executionGrants.find(
        (record) =>
          record.identity.kind === "mcp-server" &&
          record.identity.id === metadata.id &&
          record.sourceKey === metadata.sourceKey,
      )
      const preference = state.runtimePreferences.find(
        (record) =>
          record.identity.kind === "mcp-server" &&
          record.identity.id === metadata.id &&
          record.sourceKey === metadata.sourceKey,
      )
      if (
        !installed ||
        !grant ||
        preference?.desired === "disabled" ||
        !(await marketplaceMcp.verifyAuthorization(metadata, grant.authorizationContractDigest))
      )
        return null
      return {
        authorizationContractDigest: grant.authorizationContractDigest,
        enabled: true,
        principalRevision: metadata.revision,
      }
    }
    const resolveMarketplacePackage = async (item: SourceQualifiedItem) => {
      const fixed =
        marketplaceProduct &&
        item.marketplaceId === marketplaceProduct.descriptor.id &&
        item.sourceKey === officialSourceKey
          ? marketplaceProduct.registry.packages.find(
              (entry) => entry.id === item.id && entry.kind === item.kind && entry.version === item.version,
            )
          : undefined
      return fixed ?? networkMarketplaces.resolvePackage(item)
    }
    const repositoryAuthority = async (item: SourceQualifiedItem) => {
      if (marketplaceProduct && item.marketplaceId === marketplaceProduct.descriptor.id) {
        return {
          owner: marketplaceProduct.descriptor.repository.owner,
          repository: marketplaceProduct.descriptor.repository.name,
        }
      }
      return networkMarketplaces.repositoryAuthority(item.sourceKey)
    }
    const marketplaceInstaller = new DesktopMarketplaceCapabilityInstaller({
      authorizePlugin: async (id, mode) => {
        pluginRuntimeSession.assertMutable()
        const current = await pluginInstallations.readActive()
        const plugin = current.plugins.find((entry) => entry.plugin.id === id)?.plugin
        if (!plugin) throw new Error("Installed Plugin is unavailable")
        if (mode === "automatic-product-lock" && plugin.hooks) {
          throw new Error("Automatic Plugin setup cannot authorize executable Hook modules")
        }
        if (
          mode === "automatic-product-lock" &&
          (plugin.contributes.service !== undefined ||
            (plugin.contributes.capabilities?.exports.length ?? 0) > 0 ||
            (plugin.contributes.capabilities?.imports.optional.length ?? 0) > 0 ||
            (plugin.contributes.capabilities?.imports.required.length ?? 0) > 0)
        ) {
          throw new Error("Automatic Plugin setup cannot authorize extra runtime authority")
        }
        if (mode === "automatic-product-lock" && !plugin.runtime) {
          throw new Error("Automatic Plugin setup requires an immutable managed companion")
        }
        await pluginInstallations.authorizeExecution(current.revision, id, {
          companion: plugin.runtime !== undefined,
          hook: mode !== "automatic-product-lock" && plugin.hooks !== undefined,
        })
        return pluginInstallations.executionAuthorizationIdentity(id)
      },
      currentPluginAuthorization: async (id) => {
        return pluginUpdateInstallations.executionAuthorizationIdentity(id)
      },
      disablePlugin: async (id) => {
        pluginRuntimeSession.assertMutable()
        availableGenerationTools.invalidate()
        generationRuntime.disposePlugin(id)
        await pluginServices.discardPlugin(id)
        scheduleGenerationCatalogRefresh("a Plugin runtime disable")
      },
      enablePlugin: async () => {
        pluginRuntimeSession.assertMutable()
        // The durable RuntimePreference is committed before the hard refresh.
      },
      hardRefreshPlugin: async (pluginId) => {
        if (retiredHostApiRecovery) return
        pluginRuntimeSession.assertMutable()
        availableGenerationTools.invalidate()
        generationRuntime.disposePlugin(pluginId)
        await pluginServices.discardPlugin(pluginId)
        skillManager.notifyInventoryChanged()
        await agentRuntime.refreshConfiguration()
        scheduleGenerationCatalogRefresh("a Marketplace Plugin change")
        await reconcileToolPluginExecutionStateForPlugin(pluginId)
        publishPluginServiceChange()
      },
      refreshPetProvider: () => {
        if (retiredHostApiRecovery) return Promise.resolve()
        pluginRuntimeSession.assertMutable()
        return pets.refresh()
      },
      fetchArtifact: async (item, artifact) => {
        const repository = await repositoryAuthority(item)
        return marketplaceFetcher.fetch(artifact.url, "release", {
          maxBytes: artifact.size,
          repository,
        })
      },
      installLocalPlugin: async (directory, options, item) => {
        if (!localMarketplaceSourceKey) throw new Error("Local Marketplace SourceKey is unavailable")
        pluginRuntimeSession.assertUpdateMutable({
          pluginId: item.id,
          sourceIdentity: localMarketplaceSourceKey,
        })
        await pluginSnapshotInstaller.installLocalDirectory(
          directory,
          {
            authorizeExecution: options.authorizeExecution,
            sourceIdentity: localMarketplaceSourceKey,
          },
          {
            allowCurrent: true,
            ...(options.previousVersion ? { expectedInstalledVersion: options.previousVersion } : {}),
          },
        )
      },
      installLocalSkill: async (directory, options) => {
        if (options.replaceExistingSkill) {
          await skillManager.replaceFromDirectory(directory, undefined, options.recoverExistingSkillOnly === true)
          return
        }
        await skillManager.importFromDirectory(directory)
      },
      mcp: marketplaceMcp,
      remote: marketplaceArtifactInstaller,
      resolveInstalledTransition: async (transition) => {
        if (transition.identity.kind === "plugin") {
          const current = await pluginUpdateInstallations
            .list()
            .then((entries) => entries.find((entry) => entry.id === transition.identity.id))
            .catch((error: unknown) => {
              if (!retiredHostApiRecovery) throw error
              return undefined
            })
          const currentVersion =
            current?.version ??
            retiredHostApiRecovery?.plugins.find((entry) => entry.pluginId === transition.identity.id)?.version
          if (!currentVersion) return transition.next === null ? "next" : "previous"
          if (transition.next?.version === currentVersion) return "next"
          if (transition.previous?.version === currentVersion) return "previous"
          return "unknown"
        }
        const installed = (await skillManager.listManaged()).some((entry) => entry.name === transition.identity.id)
        if (!installed && transition.previous === null) return "previous"
        if (installed && transition.next === null) return "previous"
        return "unknown"
      },
      resolvePackage: resolveMarketplacePackage,
      uninstallPlugin: async (id) => {
        pluginRuntimeSession.assertMutable()
        await pluginSnapshotInstaller.uninstall(id)
      },
      uninstallSkill: async (id) => {
        await skillManager.uninstall(id)
      },
      verifyPluginAuthorization: async (id, expected) => {
        return (await pluginInstallations.executionAuthorizationIdentity(id).catch(() => null)) === expected
      },
    })
    const marketplace = new MarketplaceApplicationService({
      activePluginBindings: async () => {
        let active: Array<{
          active: boolean
          artifact: { sha256: string; size: number }
          id: string
          snapshotDigest: string
          sourceKey: SourceKey
          version: string
        }> = []
        let activeReadable = false
        try {
          const activeSet = await pluginUpdateInstallations.acquireActivePluginSet()
          try {
            active = activeSet.plugins.map((handle) => ({
              active: true,
              artifact: { ...handle.descriptor.package.artifact },
              id: handle.plugin.id,
              snapshotDigest: handle.identity.snapshotDigest,
              sourceKey: handle.descriptor.sourceIdentity as SourceKey,
              version: handle.plugin.version,
            }))
            activeReadable = true
          } finally {
            activeSet.release()
          }
        } catch (error) {
          if (!retiredHostApiRecovery) throw error
        }
        const activeIds = new Set(active.map((binding) => binding.id))
        return [
          ...active,
          ...(retiredHostApiRecovery?.plugins
            .filter((plugin) => !activeIds.has(plugin.pluginId))
            .map((plugin) => ({
              active: !activeReadable,
              artifact: { ...plugin.artifact },
              id: plugin.pluginId,
              snapshotDigest: plugin.snapshotDigest,
              sourceKey: plugin.sourceIdentity as SourceKey,
              version: plugin.version,
            })) ?? []),
        ]
      },
      assertCapabilityMutationAllowed: (identity, mutation) => {
        if (identity.kind !== "plugin") return
        if (mutation === "update") {
          if (!identity.sourceKey) throw new Error("Marketplace Plugin update source is unavailable")
          pluginRuntimeSession.assertUpdateMutable({
            pluginId: identity.id,
            sourceIdentity: identity.sourceKey,
          })
          return
        }
        pluginRuntimeSession.assertMutable()
      },
      assertLocalImportAllowed: () => pluginRuntimeSession.assertMutable(),
      fixedCatalog: async () => marketplaceProduct?.catalog() ?? [],
      fixedSources: async () =>
        marketplaceProduct
          ? [
              {
                health: "available",
                id: marketplaceProduct.descriptor.id,
                label: marketplaceProduct.descriptor.name,
                packageCount: marketplaceProduct.registry.packages.filter((entry) => !entry.yanked).length,
                publisher: marketplaceProduct.descriptor.publisher.name,
                removable: false,
                repository: `${marketplaceProduct.descriptor.repository.owner}/${marketplaceProduct.descriptor.repository.name}`,
              },
            ]
          : [
              {
                health: "attention",
                id: "convax-official",
                label: "Convax Official",
                packageCount: 0,
                publisher: "microvoid",
                removable: false,
                repository: "convaxai/convax-plugins",
              },
            ],
      installer: marketplaceInstaller,
      local: localMarketplace,
      ...(localMarketplaceSourceKey ? { localSourceKey: localMarketplaceSourceKey } : {}),
      mutations: new CapabilityMutationCoordinator(),
      network: networkMarketplaces,
      networkFetch: marketplaceFetcher,
      pluginRuntimeState: pluginRuntimeSession.state.state === "quarantined" ? "unavailable-for-session" : "available",
      ...(admittedRetiredPluginSourceMigrations.length > 0
        ? {
            pluginUpdateRecoveryBindings: new Map(
              admittedRetiredPluginSourceMigrations.map((migration) => [
                migration.pluginId,
                {
                  fromSourceKey: migration.fromSourceIdentity as SourceKey,
                  toSourceKey: migration.toSourceIdentity as SourceKey,
                },
              ]),
            ),
          }
        : {}),
      prepareFixedArtifact: async (item) => {
        if (item.sourceKey !== officialSourceKey) return null
        const registryItem = marketplaceProduct?.registry.packages.find(
          (entry) => entry.id === item.id && entry.kind === item.kind && entry.version === item.version,
        )
        if (!registryItem || registryItem.delivery.kind !== "artifact") return null
        const selected = marketplaceProduct?.lock.resolved.packages.find(
          (entry) =>
            entry.id === item.id &&
            entry.kind === item.kind &&
            entry.version === item.version &&
            entry.marketplaceId === item.marketplaceId,
        )
        const recoveryBinding = retiredHostApiRecovery?.plugins.find((entry) => entry.pluginId === item.id)
        const candidate = selected
          ? await marketplaceProduct!.verifiedCandidate(registryItem)
          : recoveryBinding
            ? await marketplaceProduct?.verifiedRecoveryCandidate(registryItem, recoveryBinding)
            : await developmentOfficialArtifacts?.verifiedCandidate(registryItem)
        if (!candidate) return null
        return {
          artifactBytes: candidate.artifactBytes,
          companionBytes: candidate.companionBytes ?? {},
        }
      },
      refreshFixedSource: async (id) => {
        if (id !== "convax-official") return false
        const refreshedProduct = await PackagedMarketplaceProduct.load(marketplaceProductRoot)
        if (refreshedProduct.descriptor.id !== id) {
          throw new Error("Fixed Marketplace identity changed during refresh")
        }
        let refreshedDevelopmentArtifacts = developmentOfficialArtifacts
        if (!app.isPackaged && developmentOfficialArtifactRoot) {
          refreshedDevelopmentArtifacts = await DevelopmentOfficialMarketplaceArtifacts.load(
            developmentOfficialArtifactRoot,
          )
        }
        marketplaceProduct = refreshedProduct
        developmentOfficialArtifacts = refreshedDevelopmentArtifacts
        return true
      },
      preinstalledPolicy: (identity) => {
        const entry = marketplaceProduct?.lock.policy.preinstalledPackages.find(
          (candidate) => candidate.id === identity.id && candidate.kind === identity.kind,
        )
        const resolved = marketplaceProduct?.lock.resolved.packages.find(
          (candidate) => candidate.id === identity.id && candidate.kind === identity.kind,
        )
        if (!entry || !resolved || identity.sourceKey !== officialSourceKey || identity.version !== resolved.version)
          return undefined
        return {
          marketplaceId: entry.marketplaceId,
          observedPolicyRevision: marketplaceProduct!.lock.policy.revision,
          policyEntryDigest: sha256Hex(canonicalJson({ entry, resolved })),
          setup: entry.setup,
        }
      },
      readFixedArtifact: (item) => {
        if (!marketplaceProduct) throw new Error("Builtin Marketplace bundle is unavailable")
        return Promise.resolve(marketplaceProduct.readBuiltinArtifact(item))
      },
      reservedBuiltinIdentities: builtinMarketplaceReservation.members,
      repositoryAuthority,
      state: marketplaceState,
    })
    const legacyMigration = new MarketplaceLegacyMigration({
      defaultCapabilitiesFile: join(userDataDirectory, "default-capabilities.json"),
      preinstalledPolicies:
        marketplaceProduct?.lock.policy.preinstalledPackages.flatMap((entry) => {
          const resolved = marketplaceProduct?.lock.resolved.packages.find(
            (candidate) =>
              candidate.id === entry.id &&
              candidate.kind === entry.kind &&
              candidate.marketplaceId === entry.marketplaceId,
          )
          return resolved
            ? [
                {
                  identity: { id: entry.id, kind: entry.kind },
                  marketplaceId: entry.marketplaceId,
                  observedPolicyRevision: marketplaceProduct!.lock.policy.revision,
                  policyEntryDigest: sha256Hex(canonicalJson({ entry, resolved })),
                  sourceKey: officialSourceKey,
                },
              ]
            : []
        }) ?? [],
      proveInstallations: async () => {
        const marketplaceSnapshot = await marketplaceState.read()
        const activePluginAuthorizations = []
        for (const plugin of await pluginInstallations.list()) {
          const handle = await pluginInstallations.acquireActivePlugin(plugin.id)
          try {
            activePluginAuthorizations.push({
              authorizationContractDigest: pluginExecutionAuthorizationIdentity(handle.descriptor),
              id: handle.descriptor.pluginId,
              sourceIdentity: handle.descriptor.sourceIdentity,
              version: handle.descriptor.version,
            })
          } finally {
            handle.release()
          }
        }
        const proofs: MarketplaceInstallationProof[] = proveCurrentPluginExecutionAuthorizations(
          marketplaceSnapshot,
          activePluginAuthorizations,
        )
        if (!marketplaceProduct) return proofs
        const storyboard = marketplaceProduct
          .catalog()
          .find((item) => item.kind === "skill" && item.id === "canvas-storyboard" && item.sourceKind === "builtin")
        const installedStoryboard = storyboard
          ? (await skillManager.listManaged()).find(
              (skill) => skill.name === storyboard.id && skill.management.kind === "standalone",
            )
          : undefined
        if (storyboard && installedStoryboard) {
          const archive = marketplaceProduct.readBuiltinArtifact(storyboard)
          const expectedFiles = Object.entries(unpackSafeZip(archive)).map(([filePath, content]) => ({
            content,
            path: filePath,
          }))
          const [actualDigest, expectedDigest] = await Promise.all([
            skillManager.exactManagedTreeDigest(storyboard.id),
            Promise.resolve(exactSkillTreeDigest(expectedFiles)),
          ])
          if (actualDigest === expectedDigest) {
            proofs.push({
              record: {
                artifactDigest: sha256Hex(canonicalJson(storyboard.delivery)),
                id: storyboard.id,
                kind: storyboard.kind,
                revision: 1,
                runtimeSurface: storyboard.runtimeSurface,
                sourceKey: storyboard.sourceKey,
                version: storyboard.version,
              },
            })
          }
        }
        const ffmpegRegistry = marketplaceProduct.registry.packages.find(
          (item) => item.kind === "plugin" && item.id === "ffmpeg-tools" && item.delivery.kind === "artifact",
        )
        const ffmpegCatalog = marketplaceProduct
          .catalog()
          .find(
            (item) =>
              item.kind === "plugin" &&
              item.id === "ffmpeg-tools" &&
              item.sourceKey === officialSourceKey &&
              item.version === ffmpegRegistry?.version,
          )
        const installedFfmpeg = (await pluginInstallations.list()).find(
          (plugin) => plugin.id === "ffmpeg-tools" && plugin.version === ffmpegRegistry?.version,
        )
        if (ffmpegRegistry && ffmpegCatalog && installedFfmpeg) {
          const verified = await marketplaceProduct.verifiedCandidate(ffmpegRegistry)
          const handle = await pluginInstallations.acquireActivePlugin(installedFfmpeg.id)
          try {
            if (
              handle.descriptor.package.artifact.sha256 === sha256Hex(verified.artifactBytes) &&
              handle.descriptor.package.artifact.size === verified.artifactBytes.byteLength
            ) {
              const authorizationContractDigest =
                (await pluginInstallations.executionAuthorizationIdentity(installedFfmpeg.id)) ?? undefined
              proofs.push({
                ...(authorizationContractDigest ? { authorizationContractDigest } : {}),
                record: {
                  artifactDigest: sha256Hex(canonicalJson(ffmpegCatalog.delivery)),
                  id: ffmpegCatalog.id,
                  kind: ffmpegCatalog.kind,
                  revision: 1,
                  runtimeSurface: ffmpegCatalog.runtimeSurface,
                  sourceKey: ffmpegCatalog.sourceKey,
                  version: ffmpegCatalog.version,
                },
              })
            }
          } finally {
            handle.release()
          }
        }
        return proofs
      },
      state: marketplaceState,
    })
    if (pluginRuntimeSession.state.state === "ready") {
      await legacyMigration.run()
      await marketplace.recoverTransitions()
      await provisionMarketplaceForStartup({
        provision: () => marketplace.provisionDefaults(),
        report: (diagnostic) => console.warn("Marketplace preinstalled provisioning failed closed", diagnostic),
      })
      await recordPackagedSmokeStartup("marketplace-provisioned")
      scheduleGenerationCatalogRefresh("startup provisioning")
    } else {
      console.warn("Marketplace Plugin migration and provisioning skipped while the Plugin runtime is quarantined")
    }
    const fetchPetAsset = (url: string, init: { headers: Headers }) => net.fetch(url, init)
    const disposePetPluginProtocol = registerPetPluginSessionProtocol(
      session,
      pluginInstallations,
      customPets,
      fetchPetAsset,
    )
    await pets.initialize()
    await recordPackagedSmokeStartup("pets-ready")
    const petActivityNotifier = new PetActivityNotifier({
      createNotification(options) {
        return Notification.isSupported() ? new Notification(options) : undefined
      },
      getMainWindow: () => mainWindow,
      onError: (error) => console.warn("Could not show or open a Pet activity notification", error),
      async openActivity(activityId) {
        const snapshot = pets.getActivitySnapshot()
        if (!snapshot.activities.some((activity) => activity.id === activityId)) return
        await petIpc.openActivity({ activityId, revision: snapshot.revision })
      },
    })
    petActivityNotifier.updatePreferences(pets.getPreferences())
    petActivityNotifier.updateActivity(pets.getActivitySnapshot())
    const unsubscribePetNotificationPreferences = pets.subscribePreferences((preferences) => {
      petActivityNotifier.updatePreferences(preferences)
    })
    const unsubscribePetNotificationActivity = pets.subscribeActivity((snapshot) => {
      petActivityNotifier.updateActivity(snapshot)
    })
    const disposePetActivityNotifier = () => {
      unsubscribePetNotificationActivity()
      unsubscribePetNotificationPreferences()
      petActivityNotifier.dispose()
    }
    const disposeDesktopProtocolIpc = registerDesktopProtocolIpc(ipcSecurity.isTrustedSender)
    const disposeMainWindowControlsIpc = registerMainWindowControlsIpc(
      () => mainWindow,
      ipcSecurity.isTrustedSender,
      process.platform,
    )
    const disposeMarketplaceIpc = registerMarketplaceIpc(marketplace, ipcSecurity.isTrustedSender)
    const disposeWorkspaceSystemStatusIpc = registerWorkspaceSystemStatusIpc(ipcSecurity.isTrustedSender)
    const disposeProjectIpc = await registerProjectIpc(projectManager, {
      ...ipcSecurity,
      filePreviews: {
        close: (input, ownerId) => projectFilePreviews.close(input, ownerId),
        open: (input, ownerId) => projectFilePreviews.open(input, ownerId),
        thumbnail: (input) => projectFilePreviews.thumbnail(input),
      },
      projectCreationDirectory,
      projectIndexFiles: collaborationFacade.projectIndexes,
      async onForgot(projectId) {
        projectAssetGcScheduler.close(projectId)
        await quiesceCollaborationProject(projectId)
      },
      async onActivated(project) {
        await activateCollaborationProject(project.id)
        await reconcileProjectGenerationSafely(project.id)
      },
    })
    if (!projectTeamRuntimeGate) throw new Error("Project Team collaboration runtime gate is unavailable")
    const projectTeamIpcRegistration = registerProjectTeamCollaborationIpc({
      ipcMain,
      service: projectTeamRuntimeGate.service,
      getActiveProjectId: () => activeCollaborationProjectId,
      getStatusTarget: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null),
      isTrustedSender: ipcSecurity.isTrustedSender,
    })
    disposeProjectTeamCollaborationIpc = () => projectTeamIpcRegistration.dispose()
    const disposeProjectRecoveryIpc = registerProjectRecoveryIpc(projectRecovery, ipcSecurity.isTrustedSender)
    const projectCanvasIpcProjection = {
      async getCanvasCatalog(input: { projectId: string }) {
        return projectCanvasUiCatalog(await projectCanvases.getCanvasCatalog(input))
      },
      async createCanvas(input: { projectId: string; name?: string }) {
        const result = await projectCanvases.createCanvas(input)
        const catalog = projectCanvasUiCatalog(result.catalog)
        const canvas = catalog.canvases.find((candidate) => candidate.id === result.canvasId)
        if (!canvas) throw new Error("Committed Canvas route is absent from the live ProjectIndex projection")
        return { canvas, catalog }
      },
      async renameCanvas(input: { projectId: string; canvasId: string; name: string }) {
        const result = await projectCanvases.renameCanvas(input)
        const catalog = projectCanvasUiCatalog(result.catalog)
        const canvas = catalog.canvases.find((candidate) => candidate.id === result.canvasId)
        if (!canvas) throw new Error("Renamed Canvas route is absent from the live ProjectIndex projection")
        return { canvas, catalog }
      },
      async deleteCanvas(input: { projectId: string; canvasId: string }) {
        const result = await projectCanvases.deleteCanvas(input)
        return { deleted: true, catalog: projectCanvasUiCatalog(result.catalog) }
      },
    }
    const disposeProjectCanvasIpc = registerProjectCanvasIpc(projectCanvasIpcProjection, {
      ...ipcSecurity,
      async onDeleted(input) {
        try {
          await generation.reconcileDeletedCanvas(
            { canvasId: input.canvasId, scopeId: input.projectId },
            generationRecoveryActor,
          )
        } catch (error) {
          logGenerationRecoveryFailure("deleted Canvas reconciliation", error)
        }
      },
    })
    const resolveActiveCanvas = async (event: IpcMainInvokeEvent) => {
      const ref = await canvasRenderer.getActiveWorkbenchRef(event.sender.id)
      return ref
        ? {
            canvasId: ref.canvasId,
            projectId: ref.scopeId,
          }
        : null
    }
    disposeCanvasSessionIpc = registerCanvasSessionIpc(collaborationCanvasSessions, {
      ipcMain,
      isTrustedSender: ipcSecurity.isTrustedSender,
      resolveActiveCanvas,
      async prepareProject(projectId) {
        await activateCollaborationProject(projectId)
      },
    })
    const disposeCanvasDocumentIpc = registerCanvasDocumentIpc(canvasApplication, canvasResourceHydrator, {
      ...ipcSecurity,
      prepareProjectCanvasAccess: (projectId) => projectAssetGcScheduler.prepareOpen(projectId),
      resolveActiveCanvas,
    })
    const disposeCanvasExternalMediaDragIpc = registerCanvasExternalMediaDragIpc(canvasExternalMediaDrag, {
      isTrustedSender: ipcSecurity.isTrustedSender,
      onError: (error) => console.warn("Canvas native media drag failed", error),
      onStartError: (_error, { senderId }) => {
        if (!trustedWebContents.has(senderId)) return
        void showCanvasExternalMediaDragStartFailure(canvasRenderer).catch((error) => {
          console.warn("Could not show Canvas native media drag failure", error)
        })
      },
      async resolveActiveCanvas(senderId) {
        if (process.platform !== "darwin" || !trustedWebContents.has(senderId)) return null
        const snapshot = await canvasRenderer.getViewSnapshot("desktop-main", senderId)
        return snapshot
          ? {
              canvasId: snapshot.documentId,
              scopeId: snapshot.scopeId,
              selectedEdgeIds: snapshot.selectedEdgeIds,
              selectedNodeIds: snapshot.selectedNodeIds,
            }
          : null
      },
    })
    const disposeCanvasResourceIpc = registerCanvasResourceIpc(canvasResources, canvasResourcePreparation, {
      ...ipcSecurity,
      application: canvasApplication,
      images: canvasResourceHydrator,
      resolveActiveCanvas,
      sessions: collaborationCanvasSessions,
      ...(canvasResourceBusinessDiagnostics ? { diagnostics: canvasResourceBusinessDiagnostics } : {}),
    })
    const disposeCanvasTextResourceIpc = registerCanvasTextResourceIpc(projectManager, canvasApplication, {
      ...ipcSecurity,
      currentResources: collaborationFacade.projectIndexes,
      preparation: canvasResourcePreparation,
      resolveActiveCanvas,
      resources: canvasResources,
    })
    const disposeGenerationIpc = registerGenerationIpc(
      {
        cancel: (request) => generation.cancel(request.operationId, { id: "desktop:renderer", kind: "ui" }),
        describeTool: (request) => generation.describeTool(request.toolId),
        generate: (request, signal) => generation.generate(request, { id: "desktop:renderer", kind: "ui" }, signal),
        listTools: (request) =>
          generation.listTools({
            ...(request.output ? { output: request.output } : {}),
            ...(request.refresh === undefined ? {} : { refresh: request.refresh }),
          }),
        reconcileCanvas: (request) => generation.reconcileCanvas(request.ref, { id: "desktop:renderer", kind: "ui" }),
      },
      { isTrustedSender: ipcSecurity.isTrustedSender },
    )
    const disposePluginServiceIpc = registerPluginServiceIpc(
      {
        authorize: (pluginId, signal) => {
          pluginRuntimeSession.assertMutable()
          return pluginServices.authorize(pluginId, signal)
        },
        cancelAuthorization: (pluginId, signal) => {
          pluginRuntimeSession.assertMutable()
          return pluginServices.cancelAuthorization(pluginId, signal)
        },
        checkout: (pluginId, planKey, signal) => {
          pluginRuntimeSession.assertMutable()
          return pluginServices.checkout(pluginId, planKey, signal)
        },
        getStatus: (pluginId, signal) => {
          pluginRuntimeSession.assertMutable()
          return pluginServices.getStatus(pluginId, signal)
        },
        getUsageHistory: (pluginId, signal) => {
          pluginRuntimeSession.assertMutable()
          return pluginServices.getUsageHistory(pluginId, signal)
        },
        listServices: () => pluginServices.listServices(),
        reauthorize: (pluginId, signal) => {
          pluginRuntimeSession.assertMutable()
          return pluginServices.reauthorize(pluginId, signal)
        },
        signOut: (pluginId, signal) => {
          pluginRuntimeSession.assertMutable()
          return pluginServices.signOut(pluginId, signal)
        },
      },
      {
        isTrustedSender: ipcSecurity.isTrustedSender,
      },
    )
    const pluginHostApiAdapter = new PluginHostApiMainAdapter({
      agent: agentRuntime,
      application: canvasApplication,
      canvases: projectCanvases,
      generation,
      images: pluginCanvasImages,
      media: pluginConnectedMedia,
      projects: projectManager,
      states: pluginCanvasStates,
    })
    pluginHostApi = new PluginHostApiService({
      nodes: pluginHostApiAdapter,
      operations: pluginHostApiAdapter,
      principals: {
        async liveState(principal) {
          const state = await marketplaceRuntimeState?.read()
          const recovering = Boolean(
            state?.transitions.some(
              (transition) => transition.identity.kind === "plugin" && transition.identity.id === principal.pluginId,
            ),
          )
          return {
            disabled: recovering || !(await isMarketplacePluginEnabled(principal.pluginId)),
            recovering,
            setupComplete: true,
          }
        },
        async resolve(principal) {
          const [resolved, identity] = await Promise.all([
            pluginPrincipals.resolve(principal),
            pluginInstallations.resolveCapabilityIdentity(principal.pluginId),
          ])
          if (
            !resolved ||
            !identity ||
            identity.plugin.id !== principal.pluginId ||
            identity.plugin.version !== principal.pluginVersion ||
            identity.activeRevision !== principal.activeRevision ||
            identity.activeSetDigest !== principal.activeSetDigest ||
            identity.snapshotDigest !== principal.snapshotDigest
          ) {
            return null
          }
          return { ...resolved, pluginName: identity.plugin.name }
        },
      },
    })
    const disposePluginCapabilityIpc = registerPluginCapabilityIpc({
      broker: pluginCanvasCapabilities,
      host: pluginHostApi,
      isTrustedSender: ipcSecurity.isTrustedSender,
      pluginBroker: pluginCapabilityBroker,
      principals: pluginPrincipals,
    })
    const disposePluginMaterializationIpc = registerPluginMaterializationIpc({
      isTrustedSender: ipcSecurity.isTrustedSender,
      service: pluginMaterialization,
    })
    const disposePluginSurfaceIpc = registerPluginSurfaceIpc({
      isTrustedSender: ipcSecurity.isTrustedSender,
      service: pluginSurfaces,
    })
    const disposePluginManagementIpc = registerPluginManagementIpc(
      pluginInstallations,
      [],
      ipcSecurity.isTrustedSender,
      undefined,
      {
        beforeChange: async (pluginId) => {
          pluginRuntimeSession.assertMutable()
          pluginConnectedMedia.revokePlugin(pluginId)
          await pluginServices.discardPlugin(pluginId)
        },
        connectAgentMcp: (plugin) => {
          pluginRuntimeSession.assertMutable()
          return pluginAgentMcpConnection.connect(plugin)
        },
        installLocal: async (directory) => {
          pluginRuntimeSession.assertMutable()
          if (!localMarketplace || !localMarketplaceSourceKey) {
            throw new Error("Local Marketplace is unavailable")
          }
          const candidate = await localMarketplace.importDirectory(directory)
          if (candidate.kind !== "plugin") throw new Error("Selected directory is not a Plugin package")
          return pluginSnapshotInstaller.installLocalDirectory(
            localMarketplace.resolveSnapshotDirectory(candidate),
            { authorizeExecution: true, sourceIdentity: localMarketplaceSourceKey },
            { allowCurrent: true },
          )
        },
        listAgentMcpStatuses: (plugins) => pluginAgentMcpConnection.listStatuses(plugins),
        async onDidChange(pluginId) {
          pluginRuntimeSession.assertMutable()
          availableGenerationTools.invalidate()
          generationRuntime.disposePlugin(pluginId)
          skillManager.notifyInventoryChanged()
          await agentRuntime.refreshConfiguration()
          scheduleGenerationCatalogRefresh("an installed Plugin change")
          publishPluginServiceChange()
        },
        async uninstall(pluginId) {
          pluginRuntimeSession.assertMutable()
          const current = (await pluginInstallations.list()).some((plugin) => plugin.id === pluginId)
          if (!current) return false
          await pluginSnapshotInstaller.uninstall(pluginId)
          await reconcileToolPluginExecutionStateForPlugin(pluginId)
          await pets.refresh()
          return true
        },
      },
    )
    const disposeSkillManagementIpc = registerSkillManagementIpc(
      skillManager,
      projectManager,
      ipcSecurity.isTrustedSender,
    )
    const disposeAgentIpc = registerAgentIpc(agentRuntime, projectManager, {
      ...ipcSecurity,
      activity,
      canvasSnapshots: {
        async resolveCanvasSnapshot(ref) {
          const [snapshot, catalog] = await Promise.all([
            canvasApplication.query({ canvasId: ref.canvasId, scopeId: ref.projectId }),
            projectCanvases.getCanvasCatalog({ projectId: ref.projectId }),
          ])
          const canvas = catalog.visibleCanvases.find((candidate) => candidate.canvasId === ref.canvasId)
          return {
            document: snapshot.projection,
            name: canvas?.title ?? snapshot.projection.metadata.title,
          }
        },
      },
    })
    const disposePetApplication = createIdempotentAsyncCleanup([
      disposePetActivityNotifier,
      () => petIpc.dispose(),
      () => pets.dispose(),
      () => activityLifecycle.dispose(),
      () => petWindow.dispose(),
    ])
    protocol.handle(
      webPluginAssetScheme,
      createWebPluginAssetHandler(pluginInstallations, {
        rendererUrl: trustedRendererUrl,
      }),
    )
    protocol.handle(pluginConnectedMediaScheme, (request) => pluginConnectedMedia.handle(request))
    protocol.handle(projectFilePreviewScheme, (request) => projectFilePreviews.handle(request))
    protocol.handle(petAssetScheme, createPetAssetHandler(customPets, fetchPetAsset))
    protocol.handle("convax-asset", async (request) => {
      try {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", { headers: { Allow: "GET, HEAD" }, status: 405 })
        }
        const parsed = parseProjectResourceUrl(request.url)
        const resource = await projectResourceReader.read({
          ...parsed,
          head: request.method === "HEAD",
          range: request.headers.get("range"),
          signal: request.signal,
        })
        return createProjectResourceProtocolResponse({
          accessControlAllowOrigin: projectResourceAccessControlAllowOrigin(request, trustedRendererUrl),
          cacheControl: resource.kind === "managed-asset" ? "private, max-age=31536000, immutable" : "no-store",
          request,
          resource,
        })
      } catch {
        return new Response("Asset was not found", { status: 404 })
      }
    })
    registerWillQuitCleanup(
      app,
      [
        () => void disposePetApplication(),
        disposePetPluginProtocol,
        () => protocol.unhandle("convax-asset"),
        () => protocol.unhandle(petAssetScheme),
        () => protocol.unhandle(webPluginAssetScheme),
        () => protocol.unhandle(pluginConnectedMediaScheme),
        () => protocol.unhandle(projectFilePreviewScheme),
        disposeMainWindowControlsIpc,
        disposeDesktopProtocolIpc,
        disposeMarketplaceIpc,
        disposeWorkspaceSystemStatusIpc,
        disposeProjectIpc,
        disposeProjectTeamCollaborationIpc,
        disposeProjectRecoveryIpc,
        disposeProjectCanvasIpc,
        disposeCanvasSessionIpc,
        disposeCanvasDocumentIpc,
        disposeCanvasExternalMediaDragIpc,
        disposeCanvasResourceIpc,
        disposeCanvasTextResourceIpc,
        disposeGenerationIpc,
        disposePluginServiceIpc,
        disposePluginCapabilityIpc,
        disposePluginMaterializationIpc,
        disposePluginSurfaceIpc,
        disposePluginManagementIpc,
        disposeSkillManagementIpc,
        disposeAgentIpc,
        () => {
          void canvasExternalMediaDrag.dispose().catch((error) => {
            console.warn("Could not dispose Canvas native drag media", error)
          })
        },
        () => pluginServices.dispose(),
        () => pluginServiceBrowserAuthorization.dispose(),
        () => projectAssetGcScheduler.dispose(),
        () => generationRuntime.dispose(),
        () => agentPluginConfigurations.dispose(),
        () => managedMcpRuntimes.close(),
        () => pluginConnectedMedia.dispose(),
        () => projectFilePreviews.dispose(),
        () => pluginRuntimeSession.dispose(),
        () => canvasProjectionSubscription.close(),
        () => canvasRenderer.dispose(),
        () => {
          void projectTeamRuntimeGate?.dispose().catch((error) => {
            console.warn("Could not dispose Project Team collaboration runtime gate", error)
          })
        },
        () => {
          void collaborationFacade?.dispose().catch((error) => {
            console.warn("Could not dispose Project collaboration facade", error)
          })
        },
        () => {
          void collaborationCanvasComposition?.dispose().catch((error) => {
            console.warn("Could not dispose Canvas collaboration composition", error)
          })
        },
        () => {
          void collaborationProjectIndexes?.dispose().catch((error) => {
            console.warn("Could not dispose ProjectIndex collaboration registry", error)
          })
        },
        () => {
          void collaborationProjects.dispose().catch((error) => {
            console.warn("Could not dispose Project collaboration runtime", error)
          })
        },
      ],
      (error, index) => console.warn(`Convax will-quit cleanup ${index + 1} failed`, error),
    )
    app.on("before-quit", (event) => {
      if (quitGate === "approved") return
      event.preventDefault()
      if (quitGate === "flushing") return
      quitGate = "flushing"
      void projectManager
        .flushPendingWrites()
        .then(async () => {
          await disposePetApplication()
          await agentRuntime.dispose()
          agentPluginConfigurations.dispose()
          await managedMcpRuntimes.close()
          await canvasExternalMediaDrag.dispose().catch((error) => {
            console.warn("Could not dispose Canvas native drag media during shutdown", error)
          })
          disposeProjectTeamCollaborationIpc()
          await projectTeamRuntimeGate?.dispose()
          disposeCanvasSessionIpc()
          await collaborationFacade?.dispose()
          await collaborationCanvasComposition?.dispose()
          await collaborationProjectIndexes?.dispose()
          await collaborationProjects.dispose()
          // Browser authorization may be between exact-origin Cookie capture,
          // checkpoint fsync, and sidecar persistence. Electron's will-quit
          // cleanup is synchronous, so drain that handoff before disposing the
          // shared sidecar runtime or allowing the process to exit.
          await pluginServices.dispose()
          await pluginServiceBrowserAuthorization.dispose()
          await generationRuntime.disposeAndWait()
          quitGate = "approved"
          app.quit()
        })
        .catch((error) => {
          quitGate = "idle"
          console.error("Convax stayed open because shutdown work could not be completed", error)
        })
    })

    createWindow(projectManager, projectAssetGcScheduler, projectFilePreviews)
    await recordPackagedSmokeStartup("window-created")
    if (developmentCachePolicy.legacyDirectoryNames.length > 0) {
      setTimeout(() => {
        void removeQuarantinedDevelopmentCaches(userDataDirectory).catch((error) => {
          console.warn("Could not remove quarantined Convax development caches", error)
        })
      }, 30_000).unref()
    }

    registerMainWindowActivation(
      app,
      () => mainWindow,
      () => {
        createWindow(projectManager, projectAssetGcScheduler, projectFilePreviews)
      },
    )
  })
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
}

function createPackagedDurabilityDiagnostics(): NodeLocalCommitDurabilityDiagnostics | undefined {
  if (process.env.CONVAX_COLLABORATION_LATENCY_RECORD_ALL !== "1") return undefined
  const attempts = new Map<string, NodeLocalCommitDurabilityMeasurement[]>()
  return Object.freeze({
    currentAttemptId(ref: Parameters<NodeLocalCommitDurabilityDiagnostics["currentAttemptId"]>[0]) {
      return `${ref.scope.docKind}:${ref.operationId}`
    },
    observe(measurement: NodeLocalCommitDurabilityMeasurement) {
      let entries = attempts.get(measurement.attemptId)
      if (entries === undefined) {
        entries = []
        attempts.set(measurement.attemptId, entries)
        while (attempts.size > 256) attempts.delete(attempts.keys().next().value!)
      }
      entries.push(measurement)
      const completed =
        measurement.outcome === "failed" ||
        (measurement.stage === "head" && measurement.barrierKind === "directory-sync")
      if (!completed) return
      attempts.delete(measurement.attemptId)
      const ownerKind = measurement.attemptId.startsWith("canvas:") ? "canvas" : "project-index"
      console.warn(
        "[convax:durability-latency]",
        JSON.stringify({
          format: "convax.durability-latency-diagnostic",
          version: 1,
          ownerKind,
          barrierCount: entries.length,
          barriers: entries.map((entry) => ({
            stage: entry.stage,
            barrierKind: entry.barrierKind,
            callCount: entry.callCount,
            durationMs: Number(entry.durationNanoseconds) / 1_000_000,
            outcome: entry.outcome,
          })),
        }),
      )
    },
  })
}

function projectCanvasUiCatalog(projection: ProjectCanvasCatalogProjection) {
  return {
    projectId: projection.projectId,
    creationAvailability: projection.creationAvailability,
    canvases: projection.visibleCanvases.map((route) => ({
      id: route.canvasId,
      name: route.title ?? "Canvas",
    })),
  }
}

const allowMultipleInstances = (!app.isPackaged && process.env.CONVAX_ALLOW_MULTIPLE_INSTANCES === "1") || packagedSmoke

if (allowMultipleInstances || app.requestSingleInstanceLock()) startApplication()
else app.quit()
