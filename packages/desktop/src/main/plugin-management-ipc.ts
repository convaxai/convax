import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron"
import { compareWebPluginVersions, type WebPluginClient } from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type { WebPluginManager } from "./plugin-manager"
import type { RemotePluginCatalogPort } from "./remote-capability-installer"

type PluginClientInput<Method extends Exclude<keyof WebPluginClient, "onDidChange">> = Parameters<
  WebPluginClient[Method]
>[0]

export const pluginManagementIpcChannels = {
  changed: "plugin:changed",
  importPlugin: "plugin:import",
  installCatalogPlugin: "plugin:catalog-install",
  listPlugins: "plugin:list",
  uninstallPlugin: "plugin:uninstall",
} as const

function showDirectoryDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

export function registerPluginManagementIpc(
  manager: WebPluginManager,
  catalog: readonly DesktopBuiltinPluginBundle[],
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  remoteCatalog?: RemotePluginCatalogPort,
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
  const listPlugins = async (): ReturnType<WebPluginClient["listPlugins"]> => {
    const installed = await manager.list()
    const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]))
    const installedIds = new Set(installedById.keys())
    const remote = (await remoteCatalog?.listPluginCatalog(installedIds).catch(() => [])) ?? []
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
  const changed = async <Result>(operation: () => Promise<Result>) => {
    const result = await operation()
    publishChange()
    return result
  }
  const disposers = [
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
        return changed(() => manager.install(selected.filePaths[0]!))
      },
    ),
    register<PluginClientInput<"installCatalogPlugin">, Awaited<ReturnType<WebPluginClient["installCatalogPlugin"]>>>(
      pluginManagementIpcChannels.installCatalogPlugin,
      (_event, input) => {
        const item = catalog.find((candidate) => candidate.manifest.id === input.id)
        if (item) {
          return changed(async () => {
            const current = (await manager.list()).find((plugin) => plugin.id === item.manifest.id)
            if (current && compareWebPluginVersions(item.manifest.version, current.version) <= 0) {
              throw new Error(`Plugin is already installed: ${item.manifest.id}`)
            }
            return "legacyBundleDigests" in item
              ? manager.installOrUpdateBuiltinBundle(item.bundle, {
                  legacyBundleDigests: item.legacyBundleDigests,
                })
              : manager.installOrUpdateBuiltinBundle(item.bundle)
          })
        }
        if (remoteCatalog) return changed(() => remoteCatalog.installPlugin(input.id))
        throw new Error(`Plugin catalog item was not found: ${input.id}`)
      },
    ),
    register<PluginClientInput<"uninstallPlugin">, Awaited<ReturnType<WebPluginClient["uninstallPlugin"]>>>(
      pluginManagementIpcChannels.uninstallPlugin,
      (_event, input) => changed(() => manager.uninstall(input.id)),
    ),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
