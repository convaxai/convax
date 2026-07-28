import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron"
import {
  compareWebPluginVersions,
  requireWebPluginId,
  type InstalledWebPluginSummary,
  type WebPluginClient,
} from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type {
  WebPluginManager,
  WebPluginMutationContext,
  WebPluginPublicationCandidate,
  WebPluginPublicationTransaction,
} from "./plugin-manager"
import type { RemotePluginCatalogPort } from "./remote-capability-installer"

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
  manager: WebPluginManager,
  catalog: readonly DesktopBuiltinPluginBundle[],
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  remoteCatalog?: RemotePluginCatalogPort,
  lifecycle?: {
    beforeChange?(pluginId: string): Promise<void> | void
    connectAgentMcp?(plugin: InstalledWebPluginSummary): Promise<void>
    listAgentMcpStatuses?(
      plugins: readonly InstalledWebPluginSummary[],
    ): ReturnType<WebPluginClient["listAgentMcpStatuses"]>
    /** Lock-free invalidation. This may wait for Agent work that resolves Plugin state. */
    onDidChange?(pluginId: string): Promise<void> | void
    prepareInstall?(
      plugin: InstalledWebPluginSummary,
      candidate: WebPluginPublicationCandidate,
    ): Promise<WebPluginPublicationTransaction>
    prepareRemove?(plugin: InstalledWebPluginSummary): Promise<WebPluginPublicationTransaction>
    /** Final convergence against the latest package while holding its mutation lock. */
    reconcileAfterChange?(pluginId: string, mutation: WebPluginMutationContext): Promise<void> | void
  },
) {
  const prepareInstall = lifecycle?.prepareInstall?.bind(lifecycle)
  const preparePublication =
    prepareInstall || lifecycle?.beforeChange
      ? async (
          plugin: InstalledWebPluginSummary,
          candidate: WebPluginPublicationCandidate,
        ): Promise<WebPluginPublicationTransaction> => {
          const authorization = await prepareInstall?.(plugin, candidate)
          return {
            async activate() {
              await authorization?.activate?.()
            },
            async publish() {
              await lifecycle?.beforeChange?.(plugin.id)
              await authorization?.publish()
            },
            async commit() {
              await authorization?.commit()
            },
            async rollback() {
              await authorization?.rollback()
            },
            async deferToRecovery() {
              await authorization?.deferToRecovery?.()
            },
          }
        }
      : undefined
  const prepareRemove = lifecycle?.prepareRemove?.bind(lifecycle)
  const prepareRemoval =
    prepareRemove || lifecycle?.beforeChange
      ? async (plugin: InstalledWebPluginSummary): Promise<WebPluginPublicationTransaction> => {
          const publication = await prepareRemove?.(plugin)
          return {
            async activate() {
              await publication?.activate?.()
            },
            async publish() {
              await lifecycle?.beforeChange?.(plugin.id)
              await publication?.publish()
            },
            async commit() {
              await publication?.commit()
            },
            async rollback() {
              await publication?.rollback()
            },
            async deferToRecovery() {
              await publication?.deferToRecovery?.()
            },
          }
        }
      : undefined
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
  const runChangedLifecycle = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const previous = changedLifecycleTail
    let release!: () => void
    changedLifecycleTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
  const changed = async <Result>(
    operation: () => Promise<Result>,
    pluginId: (result: Result) => string | undefined,
  ) => {
    const result = await operation()
    const changedPluginId = pluginId(result)
    if (changedPluginId) {
      try {
        await runChangedLifecycle(async () => {
          await lifecycle?.onDidChange?.(changedPluginId)
          if (lifecycle?.reconcileAfterChange) {
            await manager.withPluginMutation(changedPluginId, (mutation) =>
              Promise.resolve(lifecycle.reconcileAfterChange?.(changedPluginId, mutation)),
            )
          }
        })
      } catch (error) {
        // The package mutation is already committed. Startup reconciliation
        // retries cleanup. Invalidation failure must also retain superseded
        // Hook snapshots because the old Agent generation may still need them.
        console.warn(`Could not finish changed Plugin cleanup: ${changedPluginId}`, error)
      }
    }
    publishChange()
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
          await manager.withPluginMutation(pluginId, async () => {
            const plugin = (await manager.list()).find((candidate) => candidate.id === pluginId)
            if (!plugin) throw new Error(`Installed Plugin was not found: ${pluginId}`)
            if (!lifecycle?.connectAgentMcp) throw new Error("Plugin Agent MCP connection is unavailable")
            attempted = true
            await lifecycle.connectAgentMcp(plugin)
          })
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
        return changed(
          () =>
            preparePublication
              ? manager.install(sourceDirectory, {
                  beforePublish: preparePublication,
                  updateExisting: true,
                })
              : manager.install(sourceDirectory, { updateExisting: true }),
          (plugin) => plugin.id,
        )
      },
    ),
    register<PluginClientInput<"installCatalogPlugin">, Awaited<ReturnType<WebPluginClient["installCatalogPlugin"]>>>(
      pluginManagementIpcChannels.installCatalogPlugin,
      (_event, input) => {
        const item = catalog.find((candidate) => candidate.manifest.id === input.id)
        if (item) {
          return changed(
            async () => {
              const current = (await manager.list()).find((plugin) => plugin.id === item.manifest.id)
              if (current && compareWebPluginVersions(item.manifest.version, current.version) <= 0) {
                throw new Error(`Plugin is already installed: ${item.manifest.id}`)
              }
              return "legacyBundleDigests" in item
                ? manager.installOrUpdateBuiltinBundle(item.bundle, {
                    ...(preparePublication ? { beforePublish: preparePublication } : {}),
                    legacyBundleDigests: item.legacyBundleDigests,
                  })
                : preparePublication
                  ? manager.installOrUpdateBuiltinBundle(item.bundle, {
                      beforePublish: preparePublication,
                    })
                  : manager.installOrUpdateBuiltinBundle(item.bundle)
            },
            (plugin) => plugin.id,
          )
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
            const removed = prepareRemoval
              ? await manager.uninstall(input.id, { beforeRemove: prepareRemoval })
              : await manager.uninstall(input.id)
            return removed
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
