import { randomUUID } from "node:crypto"
import { stat as statFile } from "node:fs/promises"
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
  serializeCanvasDocument,
} from "@convax/canvas/application"
import {
  NodeProjectManager,
  ProjectAssetGc,
  ProjectCanvasDocumentRepository,
  ProjectCanvasDocumentService,
  ProjectFilePublisher,
  NodeProjectCanvasManager,
  ProjectCanvasResourceHydrator,
  ProjectCanvasResourcePreparation,
  ProjectManagedAssetStore,
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
import { MarketplaceLegacyMigration } from "./marketplace-legacy-migration"
import { authorizeMarketplacePluginSetup } from "./marketplace-plugin-setup-authorization"
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
import {
  generationPluginEnvironment,
  GenerationPluginRuntime,
  resolveGenerationPluginExecutable,
} from "./generation-plugin-runtime"
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
import { createCanvasRendererBridge } from "./canvas-renderer-bridge"
import { CanvasDocumentChangeBus } from "./canvas-document-change-bus"
import { desktopBuiltinPluginCatalog } from "./builtin-plugin-catalog"
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
  webPluginIdForAssetUrl,
} from "./plugin-asset-protocol"
import { registerPluginManagementIpc } from "./plugin-management-ipc"
import { registerPluginCapabilityIpc } from "./plugin-capability-ipc"
import { registerPluginMaterializationIpc } from "./plugin-materialization-ipc"
import { PluginMaterializationService } from "./plugin-materialization-service"
import { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
import { registerPluginCanvasImageIpc } from "./plugin-canvas-image-ipc"
import { PluginCanvasImageService } from "./plugin-canvas-image-service"
import { installedPluginAgentMcpServers } from "./plugin-agent-mcp"
import { PluginAgentMcpConnectionService } from "./plugin-agent-mcp-connection"
import { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import { pluginConnectedMediaPrivileges, pluginConnectedMediaScheme } from "../plugin-connected-media-contracts"
import {
  WebPluginManager,
  WebPluginPublicationDeferredError,
  type WebPluginPublicationCandidate,
} from "./plugin-manager"
import { PluginServiceHost } from "./plugin-service-host"
import { registerPluginServiceIpc } from "./plugin-service-ipc"
import { ServiceAwareGenerationTools } from "./service-aware-generation-tools"
import { createElectronPluginServiceBrowserAuthorizationBroker } from "./electron-plugin-service-browser-authorization"
import { createElectronPluginServiceCheckoutNavigation } from "./electron-plugin-service-checkout"
import { createElectronPluginServiceExternalAuthorizationBroker } from "./electron-plugin-service-external-authorization"
import { PluginServiceAuthorizationCheckpointStore } from "./plugin-service-authorization-checkpoints"
import { registerProjectCanvasIpc } from "./project-canvas-ipc"
import { registerProjectIpc } from "./project-ipc"
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
import { FileRemoteRegistryCache } from "./file-remote-registry-cache"
import { FileRemoteArtifactCache, FileRemoteShowcaseMediaCache } from "./file-remote-showcase-media-cache"
import { createElectronRemoteCapabilityFetch } from "./electron-remote-capability-fetch"
import { RemoteCapabilityInstaller, type RemoteCapabilityRegistryPort } from "./remote-capability-installer"
import { RemoteCapabilityRegistryClient } from "./remote-capability-registry"
import { ManagedPluginCompanionStore } from "./managed-plugin-companions"
import { PluginHookAuthorizationStore } from "./plugin-hook-authorizations"
import { ToolPluginAuthorizationStore } from "./tool-plugin-authorizations"
import { ManagedCanvasMediaResolver } from "./managed-canvas-media-resolver"
import { registerPluginConnectedMediaIpc } from "./plugin-connected-media-ipc"
import { PluginConnectedMediaService } from "./plugin-connected-media-service"
import { desktopBunRuntime, desktopOpenCodeBinaryDirectory } from "./packaged-runtime"
import {
  composePluginPublicationTransactions,
  DesktopSkillMutationCoordinator,
  PluginSkillLifecycle,
  PluginSkillOwnershipStore,
} from "./plugin-skill-lifecycle"
import {
  createProjectResourceProtocolResponse,
  createProjectResourceUrl,
  resolveProjectResourceProtocolPath,
} from "./project-resource-protocol"
import { ProjectAssetGcScheduler } from "./project-asset-gc-scheduler"

const trustedWebContents = new Set<number>()
const agentHostToolInactivityTimeout = 60 * 60_000
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
  const pluginFrameBindings = new Map<number, string>()
  trustedWebContents.add(webContentsId)
  window.once("closed", () => {
    pluginFrameBindings.clear()
    trustedWebContents.delete(webContentsId)
    if (mainWindow === window) mainWindow = null
    projectAssetGcScheduler.closeAll()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  const restoreNativeMainWindowControls = () =>
    setNativeMainWindowControlsVisible(process.platform, window, true)
  window.webContents.on("did-start-navigation", (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) restoreNativeMainWindowControls()
  })
  window.webContents.on("render-process-gone", restoreNativeMainWindowControls)
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
    const frameId = frame.frameTreeNodeId
    const boundPluginId = webPluginFrameBindingForNavigation(frame.url, event.url, pluginFrameBindings.get(frameId))
    if (boundPluginId && !pluginFrameBindings.has(frameId)) pluginFrameBindings.set(frameId, boundPluginId)
    if (!isAllowedWebPluginFrameNavigation(frame.url, event.url, boundPluginId)) {
      event.preventDefault()
    }
  })
  window.webContents.on(
    "did-frame-navigate",
    (_event, url, _httpResponseCode, _httpStatusText, isMainFrame, frameProcessId, frameRoutingId) => {
      if (isMainFrame) return
      const pluginId = webPluginIdForAssetUrl(url)
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId)
      if (!pluginId || !frame) return
      const bound = pluginFrameBindings.get(frame.frameTreeNodeId)
      if (!bound) pluginFrameBindings.set(frame.frameTreeNodeId, pluginId)
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
    { scheme: petAssetScheme, privileges: petAssetPrivileges },
  ])
  app.on("second-instance", activateMainWindow)

  void app.whenReady().then(async () => {
    if (process.platform === "darwin" && app.dock) app.dock.setIcon(appIcon)

    const openCodeConfigDirectory = join(userDataDirectory, "opencode")
    const projectCreationDirectory = desktopProjectWorkspaceDirectory(app.getPath("documents"))
    const projectManager = new NodeProjectManager({
      registryFile: join(userDataDirectory, "projects.json"),
      trash: (targetPath: string) => shell.trashItem(targetPath),
    })
    const petAssetInspector = createElectronPetAssetInspector(nativeImage)
    const customPets = new CustomPetStore({
      createId: randomUUID,
      inspector: petAssetInspector,
      petsRoot: join(userDataDirectory, "pets"),
    })
    const pluginManager = new WebPluginManager(
      join(userDataDirectory, "plugins"),
      {},
      desktopBuiltinPluginCatalog.map((item) => item.manifest.id),
      { petAssetInspector },
    )
    // Package recovery selects the authoritative Plugin version used by every
    // dependent authorization and owned-Skill journal. An ambiguous package
    // state must stop startup instead of letting later recovery guess.
    await pluginManager.reconcilePublicationState()
    const companionStore = new ManagedPluginCompanionStore(join(userDataDirectory, "plugin-companions"))
    const generationEnvironment = generationPluginEnvironment(process.env)
    const toolPluginAuthorizations = new ToolPluginAuthorizationStore(
      join(userDataDirectory, "plugin-authorizations"),
      {
        environment: generationEnvironment,
        resolveExecutable: resolveGenerationPluginExecutable,
        resolveManagedExecutable: (pluginId, pluginVersion, command) =>
          companionStore.resolve(pluginId, pluginVersion, command),
      },
    )
    const pluginHookAuthorizations = new PluginHookAuthorizationStore(
      join(userDataDirectory, "plugin-hook-authorizations"),
      {
        resolveInstalledHook: (plugin) => pluginManager.resolveAsset(plugin.id, plugin.hooks!),
      },
    )
    const pluginServiceAuthorizationCheckpoints = new PluginServiceAuthorizationCheckpointStore(
      join(userDataDirectory, "plugin-service-authorization-checkpoints"),
    )
    const reconcileToolPluginExecutionState = async (
      installedPlugins: Awaited<ReturnType<typeof pluginManager.list>>,
    ) => {
      try {
        await companionStore.reconcile(installedPlugins)
      } catch (error) {
        console.warn("Could not reconcile installed Tool Plugin companions", error)
      }
      try {
        await toolPluginAuthorizations.reconcile(installedPlugins)
      } catch (error) {
        console.warn("Could not reconcile installed Tool Plugin authorizations", error)
      }
      try {
        await pluginHookAuthorizations.reconcile(installedPlugins)
      } catch (error) {
        console.warn("Could not reconcile installed Plugin Hook authorizations", error)
      }

      const identities: Array<{ pluginId: string; serviceIdentity: string }> = []
      const retainUnknownPluginIds: string[] = []
      for (const plugin of installedPlugins) {
        if (plugin.contributes.service === undefined) continue
        try {
          const serviceIdentity = await toolPluginAuthorizations.authorizedServiceIdentity(plugin)
          if (serviceIdentity) identities.push({ pluginId: plugin.id, serviceIdentity })
        } catch (error) {
          // Keep a bounded recovery checkpoint when only identity inspection is
          // unavailable. Runtime verification and checkpoint read still require
          // an exact match before any Cookie can leave main.
          retainUnknownPluginIds.push(plugin.id)
          console.warn(`Could not inspect installed Tool Plugin service identity: ${plugin.id}`, error)
        }
      }
      try {
        await pluginServiceAuthorizationCheckpoints.reconcile(identities, retainUnknownPluginIds)
      } catch (error) {
        console.warn("Could not reconcile Plugin service authorization recovery state", error)
      }
    }
    const reconcileToolPluginExecutionStateForPlugin = async (pluginId: string) => {
      const current = (await pluginManager.list()).find((plugin) => plugin.id === pluginId)
      try {
        await companionStore.reconcilePlugin(pluginId, current)
      } catch (error) {
        console.warn(`Could not reconcile changed Tool Plugin companion: ${pluginId}`, error)
      }
      try {
        await toolPluginAuthorizations.reconcilePlugin(pluginId, current)
      } catch (error) {
        console.warn(`Could not reconcile changed Tool Plugin authorization: ${pluginId}`, error)
      }
      try {
        await pluginServiceAuthorizationCheckpoints.remove(pluginId)
      } catch (error) {
        console.warn(`Could not discard changed Plugin service authorization checkpoint: ${pluginId}`, error)
      }
    }
    for (const item of desktopBuiltinPluginCatalog) {
      await pluginManager
        .claimInstalledBuiltinBundle(
          item.bundle,
          "legacyBundleDigests" in item ? { legacyBundleDigests: item.legacyBundleDigests } : {},
        )
        .catch((error) => {
          console.warn(`Could not claim installed built-in Plugin ${item.manifest.id}`, error)
        })
    }
    await pluginManager
      .list()
      .then(reconcileToolPluginExecutionState)
      .catch((error) => {
        console.warn("Could not list installed Tool Plugins for execution-state reconciliation", error)
      })
    const projectCanvases = new NodeProjectCanvasManager(projectManager, projectManager)
    const projectAssets = new ProjectManagedAssetStore(projectManager)
    const projectFilePublisher = new ProjectFilePublisher(projectManager, projectAssets)
    const canvasDocumentRepository = new ProjectCanvasDocumentRepository(projectManager, projectCanvases, projectAssets)
    const projectAssetGcScheduler = new ProjectAssetGcScheduler({
      gc: new ProjectAssetGc({
        assets: projectAssets,
        catalogs: projectCanvases,
        documents: canvasDocumentRepository,
        projects: projectManager,
      }),
    })
    const canvasDocuments = new ProjectCanvasDocumentService(canvasDocumentRepository, projectCanvases)
    const canvasResourceHydrator = new ProjectCanvasResourceHydrator(
      projectManager,
      projectAssets,
      createProjectResourceUrl,
    )
    const canvasDocumentChanges = new CanvasDocumentChangeBus()
    // The application service uses the initializing document service so a
    // Plugin/Agent can address a catalogued Canvas before it has ever mounted.
    const canvasApplication = new CanvasApplicationService(canvasDocuments, {
      onDidCommit(event) {
        canvasDocumentChanges.publish({
          ref: { canvasId: event.canvasId, projectId: event.scopeId },
          revision: event.revision,
          source: event.actor.kind === "plugin" ? "plugin" : event.actor.kind === "renderer" ? "renderer" : "host",
        })
      },
    })
    const canvasResourcePreparation = new ProjectCanvasResourcePreparation(
      projectManager,
      projectFilePublisher,
      projectAssets,
    )
    const canvasResources = new CanvasResourceBusinessService(canvasResourcePreparation, canvasApplication)
    const canvasGenerationRuns = new CanvasNodeGenerationRunBusinessService(canvasApplication)
    const managedCanvasMedia = new ManagedCanvasMediaResolver({
      assets: projectAssets,
      documents: canvasDocuments,
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
    const ipcSecurity = {
      isTrustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) =>
        trustedWebContents.has(event.sender.id) &&
        Boolean(event.senderFrame && isTrustedRendererUrl(event.senderFrame.url)),
    }
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
    const pluginPrincipals = new InstalledPluginPrincipalResolver(pluginManager)
    const pluginConnectedMedia = new PluginConnectedMediaService({
      changes: canvasDocumentChanges,
      documents: canvasDocuments,
      media: managedCanvasMedia,
      plugins: pluginManager,
    })
    const pluginMaterialization = new PluginMaterializationService({
      application: canvasApplication,
      plugins: pluginManager,
    })
    const pluginCanvasCapabilities = new PluginCanvasCapabilityService({
      application: canvasApplication,
      canvases: projectCanvases,
      changes: canvasDocumentChanges,
      documents: canvasDocuments,
      plugins: pluginPrincipals,
      projects: projectManager,
    })
    const pluginCanvasImages = new PluginCanvasImageService({
      documents: canvasDocuments,
      plugins: pluginManager,
      projects: projectFilePublisher,
      resources: canvasResources,
    })
    let marketplaceRuntimeState: FileMarketplaceStateStore | undefined
    const isMarketplacePluginEnabled = async (pluginId: string) => {
      const plugin = (await pluginManager.list()).find((entry) => entry.id === pluginId)
      if (!plugin) return false
      const [tool, hook] = await Promise.all([
        toolPluginAuthorizations.verifyInstalledIdentity(plugin).catch(() => null),
        pluginHookAuthorizations.verifyInstalledIdentity(plugin).catch(() => null),
      ])
      const authorizationContractDigest = tool || hook ? sha256Hex(canonicalJson({ hook, tool })) : null
      const state = await marketplaceRuntimeState?.read()
      return isMarketplacePluginRuntimeAdmitted({
        authorizationContractDigest,
        pluginId,
        pluginVersion: plugin.version,
        state,
      })
    }
    const generationRuntime = new GenerationPluginRuntime({
      bunRuntime: desktopBunRuntime({
        applicationDirectory: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesDirectory: process.resourcesPath,
      }),
      canvasCapabilities: {
        broker: pluginCanvasCapabilities,
        principals: pluginPrincipals,
      },
      environment: generationEnvironment,
      isPluginEnabled: isMarketplacePluginEnabled,
      plugins: pluginManager,
      recoveryRuntimeDirectory: join(userDataDirectory, "generation-sidecars", "runtime-v1"),
      recoveryStateDirectory: join(userDataDirectory, "generation-sidecars", "operation-v1"),
      resolveManagedExecutable: (pluginId, pluginVersion, command) =>
        companionStore.resolve(pluginId, pluginVersion, command),
      verifyAuthorization: ({ binding, bindingKind, plugin }) =>
        toolPluginAuthorizations.verify(plugin, bindingKind, binding),
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
      documents: canvasDocuments,
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
      for (const canvas of catalog.canvases) {
        try {
          await generation.reconcileCanvas({ canvasId: canvas.id, scopeId: projectId }, generationRecoveryActor)
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
        projects.filter((project) => !project.missing).map((project) => reconcileProjectGenerationSafely(project.id)),
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
    const agentRuntime = new OpenCodeAgentRuntime({
      binaryDirectory: desktopOpenCodeBinaryDirectory({
        isPackaged: app.isPackaged,
        resourcesDirectory: process.resourcesPath,
      }),
      configDirectory: openCodeConfigDirectory,
      async resolveMcpServers() {
        const configured = installedPluginAgentMcpServers(await pluginManager.list())
        if (Object.keys(configured).length > 0) {
          console.warn(
            "Internet MCP servers remain disabled because OpenCode does not expose a socket-level outbound-policy boundary",
          )
        }
        return {}
      },
      async resolveHookModules() {
        const modules: Array<{ fileUrl: string }> = []
        const ids = (await pluginManager.list())
          .filter((plugin) => plugin.hooks !== undefined)
          .map((plugin) => plugin.id)
          .sort()
        for (const pluginId of ids) {
          if (!(await isMarketplacePluginEnabled(pluginId))) continue
          try {
            const fileUrl = await pluginManager.withPluginMutation(pluginId, async () => {
              const current = (await pluginManager.list()).find((plugin) => plugin.id === pluginId)
              return current ? pluginHookAuthorizations.resolve(current) : null
            })
            if (fileUrl) modules.push({ fileUrl })
          } catch (error) {
            console.warn(`Disabled changed or unauthorized Plugin Hook module: ${pluginId}`, error)
          }
        }
        return modules
      },
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
                  npm: "@ai-sdk/openai-compatible",
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
        }),
        createGenerationAgentToolProvider(generation),
        createPluginOperationAgentToolProvider(generation, {
          async resolveActiveCanvas() {
            const snapshot = await canvasRenderer.getViewSnapshot("desktop-main")
            return snapshot
              ? {
                  canvasId: snapshot.documentId,
                  revision: snapshot.revision,
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
      pluginManager,
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
          : createWindow(projectManager, projectAssetGcScheduler)
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
      restoreProvider: (pluginId) => pets.restoreProviderRuntime(pluginId),
    })
    connectPetOverlay = petIpc.connectOverlay
    const pluginAgentMcpConnection = new PluginAgentMcpConnectionService(agentRuntime, userDataDirectory)
    const managedSkillStore = new ManagedAgentSkillStore(openCodeConfigDirectory)
    const pluginSkillOwnership = new PluginSkillOwnershipStore(
      join(userDataDirectory, "plugin-skill-bindings", "index-v1.json"),
    )
    const skillMutations = new DesktopSkillMutationCoordinator()
    const pluginSkillLifecycle = new PluginSkillLifecycle(
      managedSkillStore,
      pluginSkillOwnership,
      () => agentRuntime.listSkills({ directory: userDataDirectory }),
      skillMutations,
    )
    const installedPluginsForSkillReconciliation = await pluginManager.list()
    await pluginSkillLifecycle.reconcileAll(installedPluginsForSkillReconciliation, (pluginId, relativePath) =>
      pluginManager.resolveAsset(pluginId, relativePath),
    )
    const skillManager = new DesktopSkillManager(
      managedSkillStore,
      agentRuntime,
      userDataDirectory,
      [],
      [],
      pluginSkillOwnership,
      skillMutations,
    )
    const createRemoteCapabilityInstaller = (
      registry: RemoteCapabilityRegistryPort,
      deferExecutionAuthorization = false,
    ) =>
      new RemoteCapabilityInstaller({
        authorizationStore: toolPluginAuthorizations,
        beforePluginPublish: async (pluginId) => {
          await pluginServices.discardPlugin(pluginId)
        },
        builtinPlugins: desktopBuiltinPluginCatalog,
        builtinSkills: [],
        companionStore,
        deferExecutionAuthorization,
        hookAuthorizationStore: pluginHookAuthorizations,
        pluginManager,
        pluginSkillLifecycle,
        preparePluginPublication: async (pluginId) => petIpc.prepareProviderChange(pluginId),
        registry,
        skillManager,
      })
    const remoteCapabilityRegistry = new RemoteCapabilityRegistryClient({
      artifactCache: new FileRemoteArtifactCache(join(userDataDirectory, "capability-registry", "artifact-v1")),
      cache: new FileRemoteRegistryCache(join(userDataDirectory, "capability-registry", "index-v1.json")),
      fetch: createElectronRemoteCapabilityFetch(net),
      showcaseCache: new FileRemoteRegistryCache(join(userDataDirectory, "capability-registry", "showcase-v1.json")),
      showcaseMediaCache: new FileRemoteShowcaseMediaCache(
        join(userDataDirectory, "capability-registry", "showcase-media-v1"),
      ),
    })
    const remoteCapabilities = createRemoteCapabilityInstaller(remoteCapabilityRegistry)
    const marketplaceRemoteCapabilities = createRemoteCapabilityInstaller(remoteCapabilityRegistry, true)
    const prepareLocalPluginPublication = async (
      plugin: InstalledWebPluginSummary,
      candidate: WebPluginPublicationCandidate,
    ) => {
      const authorization = await toolPluginAuthorizations.prepareInstall(plugin)
      let hookAuthorization
      try {
        hookAuthorization = await pluginHookAuthorizations.prepareInstall(plugin, candidate)
        const ownedSkills = await pluginSkillLifecycle.prepareInstall(plugin, candidate)
        // Pet state, owned Skills, and exact execution authorization all share
        // the package publication decision.
        return composePluginPublicationTransactions([
          petIpc.prepareProviderChange(plugin.id),
          ownedSkills,
          hookAuthorization,
          authorization,
        ])
      } catch (error) {
        await hookAuthorization?.rollback().catch(() => undefined)
        await authorization.rollback().catch(() => undefined)
        throw error
      }
    }
    const marketplaceProductRoot = app.isPackaged
      ? join(process.resourcesPath, "marketplace-product")
      : join(app.getAppPath(), ".packaging", "marketplace-product")
    let marketplaceProduct: PackagedMarketplaceProduct | null = null
    try {
      marketplaceProduct = await PackagedMarketplaceProduct.load(marketplaceProductRoot)
    } catch (error) {
      console.error("Packaged Marketplace product is unavailable; fixed sources remain reserved", error)
    }
    let developmentOfficialArtifacts: DevelopmentOfficialMarketplaceArtifacts | null = null
    const developmentOfficialArtifactRoot = process.env.CONVAX_OFFICIAL_MARKETPLACE_ARTIFACT_ROOT
    if (!app.isPackaged && developmentOfficialArtifactRoot) {
      try {
        developmentOfficialArtifacts =
          await DevelopmentOfficialMarketplaceArtifacts.load(developmentOfficialArtifactRoot)
      } catch (error) {
        console.warn("Development Official Marketplace artifacts are unavailable", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        })
      }
    }
    const marketplaceFetcher = new PinnedHttpsFetcher()
    const marketplaceState = new FileMarketplaceStateStore(join(userDataDirectory, "marketplaces", "state-v1.json"))
    marketplaceRuntimeState = marketplaceState
    const networkMarketplaces = new NetworkMarketplaceManager({
      fetcher: marketplaceFetcher,
      reservedMarketplaceIds: new Set(["convax-builtin", "convax-local", "convax-official"]),
      root: join(userDataDirectory, "marketplaces", "network"),
    })
    const officialSourceKey = computeSourceKey({
      deliveryPolicy: "github-pages-releases",
      descriptorUrl: "https://microvoid.github.io/convax-plugins/marketplace.json",
      kind: "network",
      marketplaceId: "convax-official",
      repository: { name: "convax-plugins", owner: "microvoid" },
    })
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
        const plugin = (await pluginManager.list()).find((entry) => entry.id === id)
        if (!plugin) throw new Error("Installed Plugin is unavailable")
        return authorizeMarketplacePluginSetup(plugin, mode, {
          authorizeHook: (candidate) => pluginHookAuthorizations.authorizeInstalled(candidate),
          authorizeTool: (candidate, options) => toolPluginAuthorizations.authorizeInstalled(candidate, options),
        })
      },
      currentPluginAuthorization: async (id) => {
        const plugin = (await pluginManager.list()).find((entry) => entry.id === id)
        if (!plugin) throw new Error("Installed Plugin is unavailable")
        const [tool, hook] = await Promise.all([
          toolPluginAuthorizations.verifyInstalledIdentity(plugin),
          pluginHookAuthorizations.verifyInstalledIdentity(plugin),
        ])
        return tool || hook ? sha256Hex(canonicalJson({ hook, tool })) : null
      },
      disablePlugin: async (id) => {
        availableGenerationTools.invalidate()
        generationRuntime.disposePlugin(id)
        await pluginServices.discardPlugin(id)
        scheduleGenerationCatalogRefresh("a Plugin runtime disable")
      },
      enablePlugin: async () => {
        // The durable RuntimePreference is committed before the hard refresh.
      },
      hardRefreshPlugin: async (pluginId) => {
        availableGenerationTools.invalidate()
        generationRuntime.disposePlugin(pluginId)
        await pluginServices.discardPlugin(pluginId)
        skillManager.notifyInventoryChanged()
        await agentRuntime.refreshConfiguration()
        scheduleGenerationCatalogRefresh("a Marketplace Plugin change")
        await reconcileToolPluginExecutionStateForPlugin(pluginId)
        const current = (await pluginManager.list()).find((plugin) => plugin.id === pluginId)
        try {
          await pluginHookAuthorizations.reconcilePlugin(pluginId, current)
        } catch (error) {
          console.warn(`Could not reconcile changed Marketplace Plugin Hook authorization: ${pluginId}`, error)
        }
      },
      refreshPetProvider: () => pets.refresh(),
      fetchArtifact: async (item, artifact) => {
        const repository = await repositoryAuthority(item)
        return marketplaceFetcher.fetch(artifact.url, "release", {
          maxBytes: artifact.size,
          repository,
        })
      },
      installLocalPlugin: async (directory, options) => {
        await pluginManager.install(directory, {
          beforePublish: options.authorizeExecution
            ? prepareLocalPluginPublication
            : async (plugin, candidate) =>
                composePluginPublicationTransactions([
                  petIpc.prepareProviderChange(plugin.id),
                  await pluginSkillLifecycle.prepareInstall(plugin, candidate),
                ]),
          updateExisting: true,
        })
      },
      installLocalSkill: async (directory) => {
        await skillManager.importFromDirectory(directory)
      },
      mcp: marketplaceMcp,
      remote: marketplaceRemoteCapabilities,
      resolveInstalledTransition: async (transition) => {
        if (transition.identity.kind === "plugin") {
          const current = (await pluginManager.list()).find((entry) => entry.id === transition.identity.id)
          if (!current) return transition.next === null ? "next" : "previous"
          if (transition.next?.version === current.version) return "next"
          if (transition.previous?.version === current.version) return "previous"
          return "unknown"
        }
        const installed = (await skillManager.listManaged()).some((entry) => entry.name === transition.identity.id)
        return installed ? (transition.next ? "next" : "previous") : transition.next ? "previous" : "next"
      },
      resolvePackage: resolveMarketplacePackage,
      uninstallPlugin: async (id) => {
        await pluginManager.uninstall(id, {
          beforeRemove: async (plugin) =>
            composePluginPublicationTransactions([
              petIpc.prepareProviderChange(plugin.id),
              await pluginSkillLifecycle.prepareUninstall(plugin),
            ]),
        })
      },
      uninstallSkill: async (id) => {
        await skillManager.uninstall(id)
      },
      verifyPluginAuthorization: async (id, expected) => {
        const plugin = (await pluginManager.list()).find((entry) => entry.id === id)
        if (!plugin) return false
        const [tool, hook] = await Promise.all([
          toolPluginAuthorizations.verifyInstalledIdentity(plugin),
          pluginHookAuthorizations.verifyInstalledIdentity(plugin),
        ])
        return sha256Hex(canonicalJson({ hook, tool })) === expected
      },
    })
    const marketplace = new MarketplaceApplicationService({
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
                repository: "microvoid/convax-plugins",
              },
            ],
      installer: marketplaceInstaller,
      local: localMarketplace,
      ...(localMarketplaceSourceKey ? { localSourceKey: localMarketplaceSourceKey } : {}),
      mutations: new CapabilityMutationCoordinator(),
      network: networkMarketplaces,
      networkFetch: marketplaceFetcher,
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
        const candidate = selected
          ? await marketplaceProduct!.verifiedCandidate(registryItem)
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
          refreshedDevelopmentArtifacts =
            await DevelopmentOfficialMarketplaceArtifacts.load(developmentOfficialArtifactRoot)
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
        if (!marketplaceProduct) return []
        const proofs = []
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
        const installedFfmpeg = (await pluginManager.list()).find(
          (plugin) => plugin.id === "ffmpeg-tools" && plugin.version === ffmpegRegistry?.version,
        )
        if (ffmpegRegistry && ffmpegCatalog && installedFfmpeg) {
          const verified = await marketplaceProduct.verifiedCandidate(ffmpegRegistry)
          if (await pluginManager.isBundleInstalled({ files: unpackSafeZip(verified.artifactBytes) })) {
            const [tool, hook] = await Promise.all([
              toolPluginAuthorizations.verifyInstalledIdentity(installedFfmpeg).catch(() => null),
              pluginHookAuthorizations.verifyInstalledIdentity(installedFfmpeg).catch(() => null),
            ])
            const authorizationContractDigest = tool || hook ? sha256Hex(canonicalJson({ hook, tool })) : undefined
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
        }
        return proofs
      },
      state: marketplaceState,
    })
    await legacyMigration.run()
    await marketplace.recoverTransitions()
    await provisionMarketplaceForStartup({
      provision: () => marketplace.provisionDefaults(),
      report: (diagnostic) => console.warn("Marketplace preinstalled provisioning failed closed", diagnostic),
    })
    scheduleGenerationCatalogRefresh("startup provisioning")
    const fetchPetAsset = (url: string, init: { headers: Headers }) => net.fetch(url, init)
    const disposePetPluginProtocol = registerPetPluginSessionProtocol(session, pluginManager, customPets, fetchPetAsset)
    await pets.initialize()
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
      projectCreationDirectory,
      onForgot: (projectId) => projectAssetGcScheduler.close(projectId),
      onOpened: (project) => reconcileProjectGenerationSafely(project.id),
    })
    const disposeProjectCanvasIpc = registerProjectCanvasIpc(projectCanvases, {
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
      const snapshot = await canvasRenderer.getViewSnapshot("desktop-main", event.sender.id)
      return snapshot
        ? {
            canvasId: snapshot.documentId,
            projectId: snapshot.scopeId,
            revision: snapshot.revision,
          }
        : null
    }
    const disposeCanvasDocumentIpc = registerCanvasDocumentIpc(
      canvasDocuments,
      canvasApplication,
      canvasResourceHydrator,
      {
        ...ipcSecurity,
        prepareProjectCanvasAccess: (projectId) => projectAssetGcScheduler.prepareOpen(projectId),
        resolveActiveCanvas,
      },
    )
    const disposePluginCanvasImageIpc = registerPluginCanvasImageIpc(pluginCanvasImages, ipcSecurity)
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
              revision: snapshot.revision,
              scopeId: snapshot.scopeId,
              selectedEdgeIds: snapshot.selectedEdgeIds,
              selectedNodeIds: snapshot.selectedNodeIds,
            }
          : null
      },
    })
    const disposeCanvasResourceIpc = registerCanvasResourceIpc(canvasResources, canvasResourcePreparation, {
      ...ipcSecurity,
      documents: canvasDocuments,
      images: canvasResourceHydrator,
      resolveActiveCanvas,
    })
    const disposeCanvasTextResourceIpc = registerCanvasTextResourceIpc(projectManager, canvasDocuments, {
      ...ipcSecurity,
      resolveActiveCanvas,
    })
    const disposeGenerationIpc = registerGenerationIpc(
      {
        cancel: (request) => generation.cancel(request.operationId, { id: "desktop:renderer", kind: "ui" }),
        describeTool: (request) => generation.describeTool(request.toolId),
        generate: (request, signal) => generation.generate(request, { id: "desktop:renderer", kind: "ui" }, signal),
        listTools: (request) => generation.listTools(request.output ? { output: request.output } : {}),
        reconcileCanvas: (request) => generation.reconcileCanvas(request.ref, { id: "desktop:renderer", kind: "ui" }),
      },
      { isTrustedSender: ipcSecurity.isTrustedSender },
    )
    const disposePluginServiceIpc = registerPluginServiceIpc(
      {
        authorize: (pluginId, signal) => pluginServices.authorize(pluginId, signal),
        cancelAuthorization: (pluginId, signal) => pluginServices.cancelAuthorization(pluginId, signal),
        checkout: (pluginId, planKey, signal) => pluginServices.checkout(pluginId, planKey, signal),
        getStatus: (pluginId, signal) => pluginServices.getStatus(pluginId, signal),
        listServices: () => pluginServices.listServices(),
        reauthorize: (pluginId, signal) => pluginServices.reauthorize(pluginId, signal),
        signOut: (pluginId, signal) => pluginServices.signOut(pluginId, signal),
      },
      {
        isTrustedSender: ipcSecurity.isTrustedSender,
      },
    )
    const disposePluginCapabilityIpc = registerPluginCapabilityIpc({
      broker: pluginCanvasCapabilities,
      isTrustedSender: ipcSecurity.isTrustedSender,
      principals: pluginPrincipals,
    })
    const disposePluginConnectedMediaIpc = registerPluginConnectedMediaIpc({
      isTrustedSender: ipcSecurity.isTrustedSender,
      service: pluginConnectedMedia,
    })
    const disposePluginMaterializationIpc = registerPluginMaterializationIpc({
      isTrustedSender: ipcSecurity.isTrustedSender,
      service: pluginMaterialization,
    })
    const disposePluginManagementIpc = registerPluginManagementIpc(
      pluginManager,
      desktopBuiltinPluginCatalog,
      ipcSecurity.isTrustedSender,
      remoteCapabilities,
      {
        beforeChange: async (pluginId) => {
          pluginConnectedMedia.revokePlugin(pluginId)
          await pluginServices.discardPlugin(pluginId)
        },
        connectAgentMcp: (plugin) => pluginAgentMcpConnection.connect(plugin),
        listAgentMcpStatuses: (plugins) => pluginAgentMcpConnection.listStatuses(plugins),
        prepareInstall: prepareLocalPluginPublication,
        prepareRemove: async (plugin) =>
          composePluginPublicationTransactions([
            petIpc.prepareProviderChange(plugin.id),
            await pluginSkillLifecycle.prepareUninstall(plugin),
          ]),
        async onDidChange(pluginId) {
          availableGenerationTools.invalidate()
          generationRuntime.disposePlugin(pluginId)
          skillManager.notifyInventoryChanged()
          await agentRuntime.refreshConfiguration()
          scheduleGenerationCatalogRefresh("an installed Plugin change")
        },
        async reconcileAfterChange(pluginId, mutation) {
          await reconcileToolPluginExecutionStateForPlugin(pluginId)
          await pets.refresh(mutation)
          const current = (await pluginManager.list()).find((plugin) => plugin.id === pluginId)
          try {
            await pluginHookAuthorizations.reconcilePlugin(pluginId, current)
          } catch (error) {
            console.warn(`Could not reconcile changed Plugin Hook authorization: ${pluginId}`, error)
          }
        },
      },
    )
    const disposeSkillManagementIpc = registerSkillManagementIpc(
      skillManager,
      projectManager,
      ipcSecurity.isTrustedSender,
      remoteCapabilities,
      pluginManager,
    )
    const disposeAgentIpc = registerAgentIpc(agentRuntime, projectManager, {
      ...ipcSecurity,
      activity,
      canvasSnapshots: {
        async resolveCanvasSnapshot(ref) {
          const [snapshot, catalog] = await Promise.all([
            canvasDocuments.load({ canvasId: ref.canvasId, scopeId: ref.projectId }),
            projectCanvases.getCanvasCatalog({ projectId: ref.projectId }),
          ])
          if (!snapshot.document) throw new Error(`Canvas document was not found: ${ref.canvasId}`)
          const canvas = catalog.canvases.find((candidate) => candidate.id === ref.canvasId)
          return {
            content: serializeCanvasDocument(snapshot.document),
            name: canvas?.name ?? snapshot.document.metadata.title,
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
      createWebPluginAssetHandler(pluginManager, {
        rendererUrl: trustedRendererUrl,
      }),
    )
    protocol.handle(pluginConnectedMediaScheme, (request) => pluginConnectedMedia.handle(request))
    protocol.handle(petAssetScheme, createPetAssetHandler(customPets, fetchPetAsset))
    protocol.handle("convax-asset", async (request) => {
      try {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Method not allowed", { headers: { Allow: "GET, HEAD" }, status: 405 })
        }
        const resolved = await resolveProjectResourceProtocolPath(request.url, projectManager, projectAssets)
        const [response, file] = await Promise.all([
          net.fetch(pathToFileURL(resolved.absolutePath).href, {
            headers: request.headers,
            method: request.method,
          }),
          statFile(resolved.absolutePath),
        ])
        if (!file.isFile()) throw new Error("Project resource is not a file")
        return createProjectResourceProtocolResponse({
          cacheControl: resolved.kind === "managed-asset" ? "private, max-age=31536000, immutable" : "no-store",
          request,
          response,
          size: file.size,
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
        disposeMainWindowControlsIpc,
        disposeDesktopProtocolIpc,
        disposeMarketplaceIpc,
        disposeWorkspaceSystemStatusIpc,
        disposeProjectIpc,
        disposeProjectCanvasIpc,
        disposeCanvasDocumentIpc,
        disposePluginCanvasImageIpc,
        disposeCanvasExternalMediaDragIpc,
        disposeCanvasResourceIpc,
        disposeCanvasTextResourceIpc,
        disposeGenerationIpc,
        disposePluginServiceIpc,
        disposePluginCapabilityIpc,
        disposePluginConnectedMediaIpc,
        disposePluginMaterializationIpc,
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
        () => managedMcpRuntimes.close(),
        () => pluginConnectedMedia.dispose(),
        () => canvasProjectionSubscription.close(),
        () => canvasRenderer.dispose(),
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
          await managedMcpRuntimes.close()
          await canvasExternalMediaDrag.dispose().catch((error) => {
            console.warn("Could not dispose Canvas native drag media during shutdown", error)
          })
          // Browser authorization may be between exact-origin Cookie capture,
          // checkpoint fsync, and sidecar persistence. Electron's will-quit
          // cleanup is synchronous, so drain that handoff before disposing the
          // shared sidecar runtime or allowing the process to exit.
          await pluginServices.dispose()
          await pluginServiceBrowserAuthorization.dispose()
          generationRuntime.dispose()
          quitGate = "approved"
          app.quit()
        })
        .catch((error) => {
          quitGate = "idle"
          console.error("Convax stayed open because shutdown work could not be completed", error)
        })
    })

    createWindow(projectManager, projectAssetGcScheduler)
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
        createWindow(projectManager, projectAssetGcScheduler)
      },
    )
  })
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
}

const allowMultipleInstances = (!app.isPackaged && process.env.CONVAX_ALLOW_MULTIPLE_INSTANCES === "1") || packagedSmoke

if (allowMultipleInstances || app.requestSingleInstanceLock()) startApplication()
else app.quit()
