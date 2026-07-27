import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { ManagedAgentSkillStore, OpenCodeAgentRuntime } from "@convax/agent-runtime/node"
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
import { resolveMainWindowChrome } from "./main-window-chrome"
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
import { desktopBuiltinSkillCatalog } from "./builtin-skill-catalog"
import { desktopBuiltinSkillPresentations } from "./builtin-skill-presentations"
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
import { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
import { registerPluginCanvasImageIpc } from "./plugin-canvas-image-ipc"
import { PluginCanvasImageService } from "./plugin-canvas-image-service"
import { installedPluginAgentMcpServers } from "./plugin-agent-mcp"
import { PluginAgentMcpConnectionService } from "./plugin-agent-mcp-connection"
import { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import {
  WebPluginManager,
  WebPluginPublicationDeferredError,
  type WebPluginPublicationCandidate,
} from "./plugin-manager"
import { PluginServiceHost } from "./plugin-service-host"
import { registerPluginServiceIpc } from "./plugin-service-ipc"
import { ServiceAwareGenerationTools } from "./service-aware-generation-tools"
import { createElectronPluginServiceBrowserAuthorizationBroker } from "./electron-plugin-service-browser-authorization"
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
import { provisionDefaultCapabilities } from "./default-capability-provisioner"
import { desktopDefaultRemoteCapabilityCatalog } from "./default-remote-capability-catalog"
import { JianyingCanvasService } from "./jianying-canvas-service"
import { createJianyingAgentToolProvider } from "./jianying-agent-tools"
import { MacOSJianyingDeepLinkTransport } from "./jianying-deeplink"
import { registerJianyingIpc } from "./jianying-ipc"
import { createJianyingNativeAdapter, JianyingIntegrationService } from "./jianying-service"
import { jianyingBuiltinPluginId, jianyingBuiltinPluginVersion } from "../jianying-contracts"
import { FileRemoteRegistryCache } from "./file-remote-registry-cache"
import { FileRemoteArtifactCache, FileRemoteShowcaseMediaCache } from "./file-remote-showcase-media-cache"
import { createElectronRemoteCapabilityFetch } from "./electron-remote-capability-fetch"
import { RemoteCapabilityInstaller, type RemoteCapabilityRegistryPort } from "./remote-capability-installer"
import { RemoteCapabilityRegistryClient } from "./remote-capability-registry"
import { ManagedPluginCompanionStore } from "./managed-plugin-companions"
import { PluginHookAuthorizationStore } from "./plugin-hook-authorizations"
import { ToolPluginAuthorizationStore } from "./tool-plugin-authorizations"
import { ManagedCanvasMediaResolver } from "./managed-canvas-media-resolver"
import { desktopBunRuntime, desktopOpenCodeBinaryDirectory } from "./packaged-runtime"
import { createPackagedDefaultCapabilityRegistry } from "./packaged-default-capabilities"
import {
  composePluginPublicationTransactions,
  DesktopSkillMutationCoordinator,
  PluginSkillLifecycle,
  PluginSkillOwnershipStore,
} from "./plugin-skill-lifecycle"
import { createProjectResourceUrl, resolveProjectResourceProtocolPath } from "./project-resource-protocol"
import { ProjectAssetGcScheduler } from "./project-asset-gc-scheduler"

const trustedWebContents = new Set<number>()
const agentHostToolInactivityTimeout = 60 * 60_000
type CloseGate = "approved" | "flushing" | "idle"

let quitGate: CloseGate = "idle"
let mainWindow: BrowserWindow | null = null
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
    { scheme: petAssetScheme, privileges: petAssetPrivileges },
  ])
  app.on("second-instance", () => {
    const window = mainWindow
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

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
    const jianyingIntegration = new JianyingIntegrationService(
      createJianyingNativeAdapter({
        transport: new MacOSJianyingDeepLinkTransport(),
      }),
    )
    const jianyingBuiltin = desktopBuiltinPluginCatalog.find((item) => item.manifest.id === jianyingBuiltinPluginId)
    if (!jianyingBuiltin || jianyingBuiltin.manifest.version !== jianyingBuiltinPluginVersion) {
      throw new Error("The built-in JianYing Plugin catalog entry does not match its host contract")
    }
    const isJianyingEnabled = () => pluginManager.isBuiltinBundleInstalled(jianyingBuiltin.bundle)
    const jianying = new JianyingCanvasService({
      assets: projectAssets,
      documents: canvasDocuments,
      integration: jianyingIntegration,
      isEnabled: isJianyingEnabled,
      media: managedCanvasMedia,
      projects: projectManager,
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
    const generationRuntime = new GenerationPluginRuntime({
      bunRuntime: desktopBunRuntime({
        isPackaged: app.isPackaged,
        resourcesDirectory: process.resourcesPath,
      }),
      canvasCapabilities: {
        broker: pluginCanvasCapabilities,
        principals: pluginPrincipals,
      },
      environment: generationEnvironment,
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
    let refreshAgentConfiguration: (() => Promise<void>) | undefined
    const pluginServices = new PluginServiceHost(
      generationRuntime,
      pluginServiceBrowserAuthorization,
      () => refreshAgentConfiguration?.(),
    )
    const availableGenerationTools = new ServiceAwareGenerationTools(generationRuntime, pluginServices)
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
    const agentRuntime = new OpenCodeAgentRuntime({
      binaryDirectory: desktopOpenCodeBinaryDirectory({
        isPackaged: app.isPackaged,
        resourcesDirectory: process.resourcesPath,
      }),
      configDirectory: openCodeConfigDirectory,
      async resolveMcpServers() {
        return installedPluginAgentMcpServers(await pluginManager.list())
      },
      async resolveHookModules() {
        const modules: Array<{ fileUrl: string }> = []
        const ids = (await pluginManager.list())
          .filter((plugin) => plugin.hooks !== undefined)
          .map((plugin) => plugin.id)
          .sort()
        for (const pluginId of ids) {
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
            availability.filter(({ available }) => available).map(({ provider }) => [
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
        createJianyingAgentToolProvider(jianying, {
          isEnabled: async () => process.platform === "darwin" && (await isJianyingEnabled()),
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
      desktopBuiltinSkillCatalog,
      desktopBuiltinSkillPresentations,
      pluginSkillOwnership,
      skillMutations,
    )
    const createRemoteCapabilityInstaller = (registry: RemoteCapabilityRegistryPort) =>
      new RemoteCapabilityInstaller({
        authorizationStore: toolPluginAuthorizations,
        beforePluginPublish: async (pluginId) => {
          await pluginServices.discardPlugin(pluginId)
        },
        builtinPlugins: desktopBuiltinPluginCatalog,
        builtinSkills: desktopBuiltinSkillCatalog,
        companionStore,
        hookAuthorizationStore: pluginHookAuthorizations,
        pluginManager,
        pluginSkillLifecycle,
        preparePluginPublication: async (pluginId) => petIpc.prepareProviderChange(pluginId),
        registry,
        skillManager,
      })
    const remoteCapabilities = createRemoteCapabilityInstaller(
      new RemoteCapabilityRegistryClient({
        artifactCache: new FileRemoteArtifactCache(join(userDataDirectory, "capability-registry", "artifact-v1")),
        cache: new FileRemoteRegistryCache(join(userDataDirectory, "capability-registry", "index-v1.json")),
        fetch: createElectronRemoteCapabilityFetch(net),
        showcaseCache: new FileRemoteRegistryCache(join(userDataDirectory, "capability-registry", "showcase-v1.json")),
        showcaseMediaCache: new FileRemoteShowcaseMediaCache(
          join(userDataDirectory, "capability-registry", "showcase-media-v1"),
        ),
      }),
    )
    let packagedDefaultCapabilities: RemoteCapabilityInstaller | undefined
    if (app.isPackaged) {
      const packagedDefault = desktopDefaultRemoteCapabilityCatalog[0]
      if (packagedDefault) {
        try {
          const registry = await createPackagedDefaultCapabilityRegistry({
            pluginId: packagedDefault.pluginId,
            root: join(process.resourcesPath, "default-capabilities"),
          })
          if (registry) packagedDefaultCapabilities = createRemoteCapabilityInstaller(registry)
          else console.error("Packaged default capability seed is missing")
        } catch (error) {
          // A damaged packaged seed never weakens Registry verification. Convax
          // still opens and the ordinary network phase can recover it later.
          console.error("Could not load the packaged default capability seed", error)
        }
      }
    }
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
    await provisionDefaultCapabilities({
      catalog: desktopBuiltinPluginCatalog,
      pluginManager,
      preparePluginPublication: prepareLocalPluginPublication,
      remote: {
        ...(packagedDefaultCapabilities ? { bootstrapInstaller: packagedDefaultCapabilities } : {}),
        catalog: desktopDefaultRemoteCapabilityCatalog,
        installer: remoteCapabilities,
        mode: "bootstrap",
      },
      skillManager,
      stateFile: join(userDataDirectory, "default-capabilities.json"),
    }).then(
      ({ failures }) => {
        for (const failure of failures) {
          console.error(`Could not provision default remote ${failure.kind} ${failure.id}`, failure.error)
        }
      },
      (error) => {
        console.error("Could not provision default Convax capabilities", error)
        if (error instanceof WebPluginPublicationDeferredError) throw error
      },
    )
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
    const disposePluginServiceIpc = registerPluginServiceIpc(pluginServices, {
      isTrustedSender: ipcSecurity.isTrustedSender,
    })
    const disposePluginCapabilityIpc = registerPluginCapabilityIpc({
      broker: pluginCanvasCapabilities,
      isTrustedSender: ipcSecurity.isTrustedSender,
      principals: pluginPrincipals,
    })
    const disposeJianyingIpc = registerJianyingIpc(jianying, {
      isTrustedSender: ipcSecurity.isTrustedSender,
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
    })
    const disposePluginManagementIpc = registerPluginManagementIpc(
      pluginManager,
      desktopBuiltinPluginCatalog,
      ipcSecurity.isTrustedSender,
      remoteCapabilities,
      {
        beforeChange: async (pluginId) => {
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
          generationRuntime.disposePlugin(pluginId)
          skillManager.notifyInventoryChanged()
          await agentRuntime.refreshConfiguration()
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
    protocol.handle(petAssetScheme, createPetAssetHandler(customPets, fetchPetAsset))
    protocol.handle("convax-asset", async (request) => {
      try {
        const resolved = await resolveProjectResourceProtocolPath(request.url, projectManager, projectAssets)
        const response = await net.fetch(pathToFileURL(resolved.absolutePath).href, { headers: request.headers })
        const headers = new Headers(response.headers)
        headers.set(
          "Cache-Control",
          resolved.kind === "managed-asset" ? "private, max-age=31536000, immutable" : "no-store",
        )
        return new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
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
        disposeDesktopProtocolIpc,
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
        disposeJianyingIpc,
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
    // Registry updates are intentionally outside the first-window critical
    // path. A packaged first install comes from the verified local seed above;
    // dev and damaged/offline packages remain usable while network recovery or
    // a newer immutable Registry release is checked in the background.
    void provisionDefaultCapabilities({
      catalog: desktopBuiltinPluginCatalog,
      pluginManager,
      preparePluginPublication: prepareLocalPluginPublication,
      remote: {
        catalog: desktopDefaultRemoteCapabilityCatalog,
        installer: remoteCapabilities,
        mode: "network",
      },
      skillManager,
      stateFile: join(userDataDirectory, "default-capabilities.json"),
    }).then(
      async ({ failures }) => {
        for (const failure of failures) {
          console.error(`Could not update default remote ${failure.kind} ${failure.id}`, failure.error)
        }
        // Background Registry publication bypasses Plugin management IPC. Rebuild
        // the lazy OpenCode configuration so provider and Agent MCP changes share
        // the same post-publication convergence path.
        await agentRuntime.refreshConfiguration()
      },
      (error) => console.error("Could not update default Convax capabilities", error),
    )
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
