import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron"
import {
  compareWebPluginVersions,
  requireWebPluginId,
  type ActiveInstalledWebPluginSummary,
  type InstalledWebPluginSummary,
  type WebPluginCatalogItem,
  type WebPluginClient,
} from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"

export interface PluginManagementCatalogPort {
  getPluginReleaseUrl(id: string): Promise<string>
  installPlugin(
    id: string,
    options?: { allowCurrent?: boolean; allowHooks?: boolean },
  ): Promise<InstalledWebPluginSummary>
  listPluginCatalog(installedIds: ReadonlySet<string>): Promise<WebPluginCatalogItem[]>
  subscribe?(listener: () => void): () => void
}

export interface PluginManagementInventory {
  list(): Promise<ActiveInstalledWebPluginSummary[]>
}

type PluginClientInput<Method extends Exclude<keyof WebPluginClient, "onDidChange">> = Parameters<
  WebPluginClient[Method]
>[0]

export const pluginManagementIpcChannels = {
  agentMcpStatuses: "plugin:agent-mcp-statuses",
  changed: "plugin:changed",
  connectAgentMcp: "plugin:agent-mcp-connect",
  importPlugin: "plugin:import",
  installCatalogPlugin: "plugin:catalog-install",
  listPlugins: "plugin:list",
  openCatalogPluginRelease: "plugin:catalog-open-release",
  uninstallPlugin: "plugin:uninstall",
} as const

function showDirectoryDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

export function registerPluginManagementIpc(
  manager: PluginManagementInventory,
  catalog: readonly DesktopBuiltinPluginBundle[],
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  remoteCatalog?: PluginManagementCatalogPort,
  lifecycle?: {
    beforeChange?(pluginId: string): Promise<void> | void
    connectAgentMcp?(plugin: InstalledWebPluginSummary): Promise<void>
    listAgentMcpStatuses?(
      plugins: readonly InstalledWebPluginSummary[],
    ): ReturnType<WebPluginClient["listAgentMcpStatuses"]>
    installLocal?(directory: string): Promise<InstalledWebPluginSummary>
    uninstall?(pluginId: string): Promise<boolean>
    /** Lock-free invalidation. This may wait for Agent work that resolves Plugin state. */
    onDidChange?(pluginId: string): Promise<void> | void
  },
) {
  const register = <Input, Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, input: Input) => Promise<Result> | Result,
  ) => {
    ipcMain.handle(channel, (event, input: Input) => {
      if (!isTrustedSender(event)) throw new Error("Plugin IPC request came from an untrusted renderer")
      return handler(event, input)
    })
    return () => ipcMain.removeHandler(channel)
  }
  const publishChange = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      window.webContents.send(pluginManagementIpcChannels.changed)
    }
  }
  const unsubscribeRemote = remoteCatalog?.subscribe?.(publishChange)
  const listPlugins = async (): ReturnType<WebPluginClient["listPlugins"]> => {
    const installed = await manager.list()
    const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]))
    const installedIds = new Set(installedById.keys())
    const remote = ((await remoteCatalog?.listPluginCatalog(installedIds).catch(() => [])) ?? []).map((item) => {
      const current = installedById.get(item.id)
      return {
        ...item,
        ...(current
          ? {
              installedVersion: current.version,
              updateAvailable: compareWebPluginVersions(item.version, current.version) > 0,
            }
          : {}),
      }
    })
    return {
      catalog: [
        ...catalog.map(({ companionSkillName, manifest }) => {
          const current = installedById.get(manifest.id)
          return {
            ...manifest,
            ...(companionSkillName ? { companionSkillName } : {}),
            // Installation presence and trusted built-in provenance are distinct.
            // Legacy sandboxed Plugins remain installed even when they predate the
            // host marker; native capabilities still use isBuiltinBundleInstalled.
            installed: Boolean(current),
            ...(current
              ? {
                  installedVersion: current.version,
                  updateAvailable: compareWebPluginVersions(manifest.version, current.version) > 0,
                }
              : {}),
          }
        }),
        ...remote,
      ],
      installed,
    }
  }
  let changedLifecycleTail = Promise.resolve()
  const runChangedLifecycle = async (changedPluginId: string) => {
    try {
      await lifecycle?.onDidChange?.(changedPluginId)
    } catch (error) {
      // The ActiveSet mutation is already committed. Startup reconciliation
      // retries cleanup, so post-publication invalidation cannot fail the
      // successful install or uninstall result.
      console.warn(`Could not finish changed Plugin cleanup: ${changedPluginId}`, error)
    }
  }
  const changed = async <Result>(
    operation: () => Promise<Result>,
    pluginId: (result: Result) => string | undefined,
  ): Promise<Result> => {
    const result = await operation()
    const changedPluginId = pluginId(result)
    publishChange()
    if (changedPluginId) {
      // Agent refresh is global and remains ordered, but it is post-publication
      // convergence: it must not hold this result or an unrelated immutable
      // ActiveSet mutation hostage.
      changedLifecycleTail = changedLifecycleTail.then(() => runChangedLifecycle(changedPluginId))
    }
    return result
  }
  const disposers = [
    register<undefined, Awaited<ReturnType<WebPluginClient["listAgentMcpStatuses"]>>>(
      pluginManagementIpcChannels.agentMcpStatuses,
      async () => lifecycle?.listAgentMcpStatuses?.(await manager.list()) ?? {},
    ),
    register<PluginClientInput<"connectAgentMcp">, Awaited<ReturnType<WebPluginClient["connectAgentMcp"]>>>(
      pluginManagementIpcChannels.connectAgentMcp,
      async (_event, input) => {
        const pluginId = requireWebPluginId(input?.id)
        let attempted = false
        try {
          const plugin = (await manager.list()).find((candidate) => candidate.id === pluginId)
          if (!plugin) throw new Error(`Installed Plugin was not found: ${pluginId}`)
          if (!lifecycle?.connectAgentMcp) throw new Error("Plugin Agent MCP connection is unavailable")
          attempted = true
          await lifecycle.connectAgentMcp(plugin)
        } finally {
          if (attempted) publishChange()
        }
      },
    ),
    register<undefined, Awaited<ReturnType<WebPluginClient["listPlugins"]>>>(
      pluginManagementIpcChannels.listPlugins,
      () => listPlugins(),
    ),
    register<undefined, Awaited<ReturnType<WebPluginClient["importPlugin"]>>>(
      pluginManagementIpcChannels.importPlugin,
      async (event) => {
        const selected = await showDirectoryDialog(event, {
          buttonLabel: "Import Plugin",
          properties: ["openDirectory"],
          title: "Choose a Plugin folder containing manifest.json",
        })
        if (selected.canceled || !selected.filePaths[0]) return null
        const sourceDirectory = selected.filePaths[0]
        if (!lifecycle?.installLocal) throw new Error("Local Plugin import is unavailable")
        return changed(
          () => lifecycle.installLocal!(sourceDirectory),
          (plugin) => plugin.id,
        )
      },
    ),
    register<PluginClientInput<"installCatalogPlugin">, Awaited<ReturnType<WebPluginClient["installCatalogPlugin"]>>>(
      pluginManagementIpcChannels.installCatalogPlugin,
      (_event, input) => {
        const item = catalog.find((candidate) => candidate.manifest.id === input.id)
        if (item) {
          throw new Error(`Legacy built-in Plugin packages are unsupported by the v8 installer: ${item.manifest.id}`)
        }
        if (remoteCatalog)
          return changed(
            () => remoteCatalog.installPlugin(input.id, { allowHooks: true }),
            (plugin) => plugin.id,
          )
        throw new Error(`Plugin catalog item was not found: ${input.id}`)
      },
    ),
    register<
      PluginClientInput<"openCatalogPluginRelease">,
      Awaited<ReturnType<WebPluginClient["openCatalogPluginRelease"]>>
    >(pluginManagementIpcChannels.openCatalogPluginRelease, async (_event, input) => {
      if (!remoteCatalog) return false
      await shell.openExternal(await remoteCatalog.getPluginReleaseUrl(input.id))
      return true
    }),
    register<PluginClientInput<"uninstallPlugin">, Awaited<ReturnType<WebPluginClient["uninstallPlugin"]>>>(
      pluginManagementIpcChannels.uninstallPlugin,
      (_event, input) =>
        changed(
          async () => {
            const current = (await manager.list()).some((plugin) => plugin.id === input.id)
            if (!current) return false
            if (!lifecycle?.uninstall) throw new Error("Plugin uninstall is unavailable")
            await lifecycle.beforeChange?.(input.id)
            return lifecycle.uninstall(input.id)
          },
          (removed) => (removed ? input.id : undefined),
        ),
    ),
  ]
  return () => {
    unsubscribeRemote?.()
    disposers.forEach((dispose) => dispose())
  }
}
