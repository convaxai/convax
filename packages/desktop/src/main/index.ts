import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { ManagedAgentSkillStore, OpenCodeAgentRuntime } from "@convax/agent-runtime/node"
import {
  CanvasApplicationService,
  CanvasResourceBusinessService,
  serializeCanvasDocument,
} from "@convax/canvas/application"
import {
  NodeProjectManager,
  ProjectCanvasDocumentRepository,
  ProjectCanvasDocumentService,
  NodeProjectCanvasManager,
  ProjectCanvasResourcePreparation,
} from "@convax/project/node"
import { app, BrowserWindow, net, protocol, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron"
import appIcon from "../../resources/icon.png?asset"
import { registerAgentIpc } from "./agent-ipc"
import { registerWillQuitCleanup } from "./application-lifecycle"
import { desktopProductName, desktopUserDataDirectory } from "./app-branding"
import { createCanvasAgentToolProvider } from "./canvas-agent-tools"
import { createCompositeAgentToolProvider } from "./composite-agent-tools"
import { registerCanvasDocumentIpc } from "./canvas-document-ipc"
import { createCanvasRendererBridge } from "./canvas-renderer-bridge"
import { desktopBuiltinPluginCatalog } from "./builtin-plugin-catalog"
import { desktopBuiltinSkillCatalog } from "./builtin-skill-catalog"
import { desktopBuiltinSkillPresentations } from "./builtin-skill-presentations"
import { registerDesktopProtocolIpc } from "./desktop-protocol-ipc"
import {
  desktopDevelopmentCachePolicy,
  quarantineLegacyDevelopmentCaches,
  removeQuarantinedDevelopmentCaches,
} from "./development-cache-policy"
import { createWebPluginAssetHandler, webPluginAssetPrivileges, webPluginAssetScheme } from "./plugin-asset-protocol"
import { registerPluginManagementIpc } from "./plugin-management-ipc"
import { WebPluginManager } from "./plugin-manager"
import { registerProjectCanvasIpc } from "./project-canvas-ipc"
import { registerProjectIpc } from "./project-ipc"
import { registerSkillManagementIpc } from "./skill-management-ipc"
import { DesktopSkillManager } from "./skill-manager"
import { provisionDefaultCapabilities } from "./default-capability-provisioner"
import { JianyingCanvasService } from "./jianying-canvas-service"
import { createJianyingAgentToolProvider } from "./jianying-agent-tools"
import { MacOSJianyingDeepLinkTransport } from "./jianying-deeplink"
import { registerJianyingIpc } from "./jianying-ipc"
import { createJianyingNativeAdapter, JianyingIntegrationService } from "./jianying-service"
import { jianyingBuiltinPluginId, jianyingBuiltinPluginVersion } from "../jianying-contracts"
import { FileRemoteRegistryCache } from "./file-remote-registry-cache"
import { createElectronRemoteCapabilityFetch } from "./electron-remote-capability-fetch"
import { RemoteCapabilityInstaller } from "./remote-capability-installer"
import { RemoteCapabilityRegistryClient } from "./remote-capability-registry"

const trustedWebContents = new Set<number>()
type CloseGate = "approved" | "flushing" | "idle"

let quitGate: CloseGate = "idle"
const rendererUrl = process.env.ELECTRON_RENDERER_URL
const trustedRendererUrl = rendererUrl ?? pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href
const developmentCachePolicy = desktopDevelopmentCachePolicy({
  isPackaged: app.isPackaged,
  rendererUrl,
})

for (const commandLineSwitch of developmentCachePolicy.switches) {
  app.commandLine.appendSwitch(commandLineSwitch.name, commandLineSwitch.value)
}

app.setName(desktopProductName)

const userDataDirectoryOverride = desktopUserDataDirectory({
  appDataDirectory: app.getPath("appData"),
  isPackaged: app.isPackaged,
  requestedDirectory: process.env.CONVAX_USER_DATA_DIR,
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

function createWindow(projectManager: NodeProjectManager) {
  const window = new BrowserWindow({
    title: desktopProductName,
    icon: appIcon,
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
  const webContentsId = window.webContents.id
  trustedWebContents.add(webContentsId)
  window.once("closed", () => trustedWebContents.delete(webContentsId))
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
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
    return
  }

  void window.loadURL(trustedRendererUrl)
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
  ])
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  void app.whenReady().then(async () => {
    if (process.platform === "darwin" && app.dock) app.dock.setIcon(appIcon)

    const openCodeConfigDirectory = join(userDataDirectory, "opencode")
    const projectManager = new NodeProjectManager({
      registryFile: join(userDataDirectory, "projects.json"),
      trash: (targetPath: string) => shell.trashItem(targetPath),
    })
    const pluginManager = new WebPluginManager(
      join(userDataDirectory, "plugins"),
      {},
      desktopBuiltinPluginCatalog.map((item) => item.manifest.id),
    )
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
    const projectCanvases = new NodeProjectCanvasManager(projectManager, projectManager)
    const canvasDocumentRepository = new ProjectCanvasDocumentRepository(projectManager, projectCanvases)
    const canvasDocuments = new ProjectCanvasDocumentService(canvasDocumentRepository, projectCanvases)
    const canvasApplication = new CanvasApplicationService(canvasDocumentRepository)
    const canvasResources = new CanvasResourceBusinessService(
      new ProjectCanvasResourcePreparation(projectManager),
      canvasApplication,
    )
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
      documents: canvasDocuments,
      integration: jianyingIntegration,
      isEnabled: isJianyingEnabled,
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
    const agentRuntime = new OpenCodeAgentRuntime({
      configDirectory: openCodeConfigDirectory,
      protectedPathPatterns: [".convax", ".convax/**", "**/.convax", "**/.convax/**"],
      protectedPaths: [".convax"],
      toolProvider: createCompositeAgentToolProvider([
        createCanvasAgentToolProvider({
          application: canvasApplication,
          renderer: canvasRenderer,
          resources: canvasResources,
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
    const skillManager = new DesktopSkillManager(
      new ManagedAgentSkillStore(openCodeConfigDirectory),
      agentRuntime,
      userDataDirectory,
      desktopBuiltinSkillCatalog,
      desktopBuiltinSkillPresentations,
    )
    const remoteCapabilities = new RemoteCapabilityInstaller({
      builtinPlugins: desktopBuiltinPluginCatalog,
      builtinSkills: desktopBuiltinSkillCatalog,
      pluginManager,
      registry: new RemoteCapabilityRegistryClient({
        cache: new FileRemoteRegistryCache(join(userDataDirectory, "capability-registry", "index-v1.json")),
        fetch: createElectronRemoteCapabilityFetch(net),
      }),
      skillManager,
    })
    await provisionDefaultCapabilities({
      catalog: desktopBuiltinPluginCatalog,
      pluginManager,
      skillManager,
      stateFile: join(userDataDirectory, "default-capabilities.json"),
    }).catch((error) => {
      console.error("Could not provision default Convax capabilities", error)
    })
    const disposeDesktopProtocolIpc = registerDesktopProtocolIpc(ipcSecurity.isTrustedSender)
    const disposeProjectIpc = await registerProjectIpc(projectManager, ipcSecurity)
    const disposeProjectCanvasIpc = registerProjectCanvasIpc(projectCanvases, ipcSecurity)
    const disposeCanvasDocumentIpc = registerCanvasDocumentIpc(canvasDocuments, ipcSecurity)
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
    )
    const disposeSkillManagementIpc = registerSkillManagementIpc(
      skillManager,
      projectManager,
      pluginManager,
      ipcSecurity.isTrustedSender,
      remoteCapabilities,
    )
    const disposeAgentIpc = registerAgentIpc(agentRuntime, projectManager, {
      ...ipcSecurity,
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
    protocol.handle(
      webPluginAssetScheme,
      createWebPluginAssetHandler(pluginManager, {
        rendererUrl: trustedRendererUrl,
      }),
    )
    protocol.handle("convax-asset", async (request) => {
      try {
        const url = new URL(request.url)
        const relativePath = url.searchParams.get("path")
        if (!url.hostname || !relativePath) return new Response("Asset was not found", { status: 404 })
        const absolutePath = await projectManager.resolveEntryPath({ path: relativePath, projectId: url.hostname })
        return net.fetch(pathToFileURL(absolutePath).href, { headers: request.headers })
      } catch {
        return new Response("Asset was not found", { status: 404 })
      }
    })
    registerWillQuitCleanup(
      app,
      [
        () => protocol.unhandle("convax-asset"),
        () => protocol.unhandle(webPluginAssetScheme),
        disposeDesktopProtocolIpc,
        disposeProjectIpc,
        disposeProjectCanvasIpc,
        disposeCanvasDocumentIpc,
        disposeJianyingIpc,
        disposePluginManagementIpc,
        disposeSkillManagementIpc,
        disposeAgentIpc,
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
          await agentRuntime.dispose()
          quitGate = "approved"
          app.quit()
        })
        .catch((error) => {
          quitGate = "idle"
          console.error("Convax stayed open because project files could not be saved", error)
        })
    })

    createWindow(projectManager)
    if (developmentCachePolicy.legacyDirectoryNames.length > 0) {
      setTimeout(() => {
        void removeQuarantinedDevelopmentCaches(userDataDirectory).catch((error) => {
          console.warn("Could not remove quarantined Convax development caches", error)
        })
      }, 30_000).unref()
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length > 0) return
      createWindow(projectManager)
    })
  })
  app.on("window-all-closed", () => {
    if (process.platform === "darwin") return
    app.quit()
  })
}

const allowMultipleInstances = !app.isPackaged && process.env.CONVAX_ALLOW_MULTIPLE_INSTANCES === "1"

if (allowMultipleInstances || app.requestSingleInstanceLock()) startApplication()
else app.quit()
