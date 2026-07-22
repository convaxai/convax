import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { InstalledWebPluginSummary, WebPluginManifest } from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"
import type { WebPluginManager } from "./plugin-manager"
import type { RemotePluginCatalogPort } from "./remote-capability-installer"

type InvokeHandler = (event: TestIpcEvent, input?: unknown) => unknown
type TestIpcEvent = { sender: { id: number } }

const handlers = new Map<string, InvokeHandler>()
const removedHandlers: string[] = []
const windows: TestWindow[] = []
const dialogCalls: unknown[][] = []
const openedExternalUrls: string[] = []
let dialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
let dialogOwner: TestWindow | undefined

interface TestWindow {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send: ReturnType<typeof mock>
  }
}

beforeEach(() => {
  configureElectronMock({
    BrowserWindow: {
      fromWebContents: () => dialogOwner,
      getAllWindows: () => windows,
    },
    dialog: {
      showOpenDialog: async (...args: unknown[]) => {
        dialogCalls.push(args)
        return dialogResult
      },
    },
    ipcMain: {
      handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
      removeHandler: (channel: string) => {
        removedHandlers.push(channel)
        handlers.delete(channel)
      },
    },
    shell: {
      openExternal: async (url: string) => {
        openedExternalUrls.push(url)
      },
    },
  })
})

afterEach(() => {
  handlers.clear()
  removedHandlers.splice(0)
  windows.splice(0)
  dialogCalls.splice(0)
  openedExternalUrls.splice(0)
  dialogResult = { canceled: true, filePaths: [] }
  dialogOwner = undefined
  resetElectronMock()
})

const manifest = (id: string): WebPluginManifest => ({
  capabilities: [],
  contributes: { canvas: { renderer: { create: true } } },
  description: `${id} description`,
  entry: "index.html",
  id,
  name: id,
  schema: "convax.plugin/1",
  version: "1.0.0",
})

const agentMcpManifest = (id: string): WebPluginManifest => ({
  capabilities: [],
  contributes: {
    agent: {
      mcp: {
        oauth: "auto",
        type: "remote",
        url: "https://example.com/mcp",
      },
    },
  },
  description: `${id} remote Agent MCP`,
  id,
  name: id,
  schema: "convax.plugin/6",
  version: "1.0.0",
})

const catalogEntry = (id: string, version = "1.0.0"): DesktopBuiltinPluginBundle => ({
  bundle: { files: { "index.html": "<!doctype html>", "manifest.json": "{}" } },
  manifest: { ...manifest(id), version },
})

function createManager(installed: InstalledWebPluginSummary[] = []) {
  return {
    install: mock(async (_source: string) => manifest("imported-plugin")),
    installOrUpdateBuiltinBundle: mock(async (_bundle: unknown) => manifest("catalog-plugin")),
    isBuiltinBundleInstalled: mock(async () => false),
    list: mock(async () => installed),
    uninstall: mock(async (_id: string) => true),
    async withPluginMutation<Result>(pluginId: string, operation: (mutation: { pluginId: string }) => Promise<Result>) {
      return operation({ pluginId })
    },
  } as unknown as WebPluginManager
}

function createRemoteCatalog() {
  let changeListener: (() => void) | undefined
  const unsubscribe = mock(() => undefined)
  const catalog = {
    getPluginReleaseUrl: mock(
      async (id: string) => `https://github.com/microvoid/convax-plugins/releases/tag/plugin-${id}-v1.0.0`,
    ),
    installPlugin: mock(async (id: string) => manifest(id)),
    listPluginCatalog: mock(async (installedIds: ReadonlySet<string>) => [
      {
        ...manifest("remote-plugin"),
        installed: installedIds.has("remote-plugin"),
      },
    ]),
  } satisfies RemotePluginCatalogPort
  return {
    ...catalog,
    emitChange: () => changeListener?.(),
    subscribe: mock((listener: () => void) => {
      changeListener = listener
      return unsubscribe
    }),
    unsubscribe,
  }
}

function invoke(channel: string, input?: unknown, event: TestIpcEvent = { sender: { id: 1 } }) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler(event, input)
}

function testWindow({ destroyed = false, webContentsDestroyed = false } = {}): TestWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => webContentsDestroyed,
      send: mock(() => undefined),
    },
  }
}

describe("registerPluginManagementIpc", () => {
  test("keeps the preload client channel contract stable", async () => {
    const { pluginManagementIpcChannels } = await import("./plugin-management-ipc")
    expect(pluginManagementIpcChannels).toEqual({
      agentMcpStatuses: "plugin:agent-mcp-statuses",
      changed: "plugin:changed",
      connectAgentMcp: "plugin:agent-mcp-connect",
      importPlugin: "plugin:import",
      installCatalogPlugin: "plugin:catalog-install",
      listPlugins: "plugin:list",
      openCatalogPluginRelease: "plugin:catalog-open-release",
      uninstallPlugin: "plugin:uninstall",
    })
  })

  test("rejects every request from an untrusted renderer", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    const dispose = registerPluginManagementIpc(
      manager,
      [catalogEntry("catalog-plugin")],
      (event) => event.sender.id === 1,
    )

    for (const channel of [
      pluginManagementIpcChannels.agentMcpStatuses,
      pluginManagementIpcChannels.connectAgentMcp,
      pluginManagementIpcChannels.listPlugins,
      pluginManagementIpcChannels.importPlugin,
      pluginManagementIpcChannels.installCatalogPlugin,
      pluginManagementIpcChannels.openCatalogPluginRelease,
      pluginManagementIpcChannels.uninstallPlugin,
    ]) {
      await expect(Promise.resolve().then(() => invoke(channel, {}, { sender: { id: 2 } }))).rejects.toThrow(
        "untrusted renderer",
      )
    }
    expect(manager.list).not.toHaveBeenCalled()
    expect(manager.install).not.toHaveBeenCalled()
    dispose()
  })

  test("lists display-only Agent MCP status by installed Plugin id", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const plugin = agentMcpManifest("remote-editor")
    const manager = createManager([plugin])
    const listAgentMcpStatuses = mock(async (_plugins: readonly InstalledWebPluginSummary[]) => ({
      "remote-editor": "connected" as const,
    }))
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      listAgentMcpStatuses,
      onDidChange: async () => undefined,
    })

    await expect(invoke(pluginManagementIpcChannels.agentMcpStatuses)).resolves.toEqual({
      "remote-editor": "connected",
    })
    expect(listAgentMcpStatuses).toHaveBeenCalledWith([plugin])
    dispose()
  })

  test("serializes Agent MCP connection with Plugin mutations and publishes every real attempt", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const plugin = agentMcpManifest("remote-editor")
    const updatedPlugin = { ...plugin, version: "2.0.0" }
    const manager = createManager()
    const mutationOrder: string[] = []
    manager.list = mock(async () => {
      mutationOrder.push("list")
      return [updatedPlugin]
    })
    manager.withPluginMutation = mock(async (pluginId, operation) => {
      mutationOrder.push(`lock:${pluginId}`)
      return operation({ pluginId })
    }) as WebPluginManager["withPluginMutation"]
    const connectAgentMcp = mock(async (_plugin: InstalledWebPluginSummary) => undefined)
    const target = testWindow()
    windows.push(target)
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      connectAgentMcp,
      onDidChange: async () => undefined,
    })

    await expect(invoke(pluginManagementIpcChannels.connectAgentMcp, { id: "remote-editor" })).resolves.toBeUndefined()
    expect(manager.withPluginMutation).toHaveBeenCalledWith("remote-editor", expect.any(Function))
    expect(mutationOrder).toEqual(["lock:remote-editor", "list"])
    expect(connectAgentMcp).toHaveBeenCalledWith(updatedPlugin)
    expect(target.webContents.send).toHaveBeenCalledTimes(1)
    expect(target.webContents.send).toHaveBeenCalledWith(pluginManagementIpcChannels.changed)

    connectAgentMcp.mockRejectedValueOnce(new Error("authorization failed"))
    await expect(invoke(pluginManagementIpcChannels.connectAgentMcp, { id: "remote-editor" })).rejects.toThrow(
      "authorization failed",
    )
    expect(target.webContents.send).toHaveBeenCalledTimes(2)

    await expect(
      Promise.resolve().then(() => invoke(pluginManagementIpcChannels.connectAgentMcp, { id: "../remote-editor" })),
    ).rejects.toThrow("Plugin id")
    manager.list = mock(async () => [])
    await expect(
      Promise.resolve().then(() => invoke(pluginManagementIpcChannels.connectAgentMcp, { id: "missing" })),
    ).rejects.toThrow("Installed Plugin was not found")
    expect(connectAgentMcp).toHaveBeenCalledTimes(2)
    expect(target.webContents.send).toHaveBeenCalledTimes(2)
    dispose()
  })

  test("lists catalog installation state and routes import, catalog install, and uninstall", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const installed = manifest("installed-plugin")
    const manager = createManager([installed])
    const catalog = [catalogEntry("installed-plugin"), catalogEntry("catalog-plugin")]
    const sent = testWindow()
    windows.push(sent, testWindow({ destroyed: true }), testWindow({ webContentsDestroyed: true }))
    dialogOwner = sent
    const onDidChange = mock((_pluginId: string) => undefined)
    const dispose = registerPluginManagementIpc(manager, catalog, () => true, undefined, { onDidChange })

    await expect(invoke(pluginManagementIpcChannels.listPlugins)).resolves.toEqual({
      catalog: [
        {
          ...catalog[0]!.manifest,
          installed: true,
          installedVersion: installed.version,
          updateAvailable: false,
        },
        { ...catalog[1]!.manifest, installed: false },
      ],
      installed: [installed],
    })
    expect(manager.isBuiltinBundleInstalled).not.toHaveBeenCalled()

    dialogResult = { canceled: false, filePaths: ["/portable/plugin-source"] }
    await expect(invoke(pluginManagementIpcChannels.importPlugin)).resolves.toMatchObject({ id: "imported-plugin" })
    expect(manager.install).toHaveBeenCalledWith("/portable/plugin-source", { updateExisting: true })
    expect(dialogCalls[0]).toEqual([sent, expect.objectContaining({ properties: ["openDirectory"] })])

    await expect(
      invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: "catalog-plugin" }),
    ).resolves.toMatchObject({ id: "catalog-plugin" })
    expect(manager.installOrUpdateBuiltinBundle).toHaveBeenCalledWith(catalog[1]!.bundle)
    await expect(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "installed-plugin" })).resolves.toBe(true)
    expect(manager.uninstall).toHaveBeenCalledWith("installed-plugin")
    expect(onDidChange).toHaveBeenCalledTimes(3)
    expect(onDidChange.mock.calls.map(([pluginId]) => pluginId)).toEqual([
      "imported-plugin",
      "catalog-plugin",
      "installed-plugin",
    ])
    expect(sent.webContents.send).toHaveBeenCalledTimes(3)
    expect(sent.webContents.send).toHaveBeenCalledWith(pluginManagementIpcChannels.changed)

    await expect(
      Promise.resolve().then(() => invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: "missing" })),
    ).rejects.toThrow("catalog item was not found")
    expect(sent.webContents.send).toHaveBeenCalledTimes(3)
    dispose()
  })

  test("serializes changed lifecycles before acquiring each Plugin mutation", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    dialogResult = { canceled: false, filePaths: ["/portable/plugin-source"] }
    let releaseFirst!: () => void
    let markFirstEntered!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve
    })
    const lifecycleOrder: string[] = []
    const onDidChange = mock(async (pluginId: string) => {
      lifecycleOrder.push(pluginId)
      if (pluginId !== "imported-plugin") return
      markFirstEntered()
      await firstBlocked
    })
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, { onDidChange })

    const first = Promise.resolve(invoke(pluginManagementIpcChannels.importPlugin))
    await firstEntered
    const second = Promise.resolve(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "other-plugin" }))
    const secondState = await Promise.race([
      second.then(() => "completed" as const),
      Bun.sleep(25).then(() => "blocked" as const),
    ])
    releaseFirst()
    await Promise.all([first, second])

    expect(secondState).toBe("blocked")
    expect(lifecycleOrder).toEqual(["imported-plugin", "other-plugin"])
    dispose()
  })

  test("exposes and installs only a newer catalog Plugin version", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const installed = { ...manifest("installed-plugin"), version: "0.0.1-convax.1" }
    const manager = createManager([installed])
    const catalog = [catalogEntry("installed-plugin", "0.0.1-convax.2")]
    const sent = testWindow()
    windows.push(sent)
    const dispose = registerPluginManagementIpc(manager, catalog, () => true)

    await expect(invoke(pluginManagementIpcChannels.listPlugins)).resolves.toMatchObject({
      catalog: [
        {
          id: "installed-plugin",
          installed: true,
          installedVersion: "0.0.1-convax.1",
          updateAvailable: true,
          version: "0.0.1-convax.2",
        },
      ],
    })
    await invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: "installed-plugin" })
    expect(manager.installOrUpdateBuiltinBundle).toHaveBeenCalledWith(catalog[0]!.bundle)
    expect(sent.webContents.send).toHaveBeenCalledTimes(1)

    const sameManager = createManager([{ ...installed, version: "0.0.1-convax.2" }])
    const sameWindow = testWindow()
    windows.splice(0, windows.length, sameWindow)
    dispose()
    const disposeSame = registerPluginManagementIpc(sameManager, catalog, () => true)
    await expect(invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: "installed-plugin" })).rejects.toThrow(
      "already installed",
    )
    expect(sameManager.installOrUpdateBuiltinBundle).not.toHaveBeenCalled()
    expect(sameWindow.webContents.send).not.toHaveBeenCalled()
    disposeSame()
  })
  test("does not publish canceled imports and removes every handler on dispose", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    const target = testWindow()
    windows.push(target)
    const onDidChange = mock((_pluginId: string) => undefined)
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, { onDidChange })

    await expect(invoke(pluginManagementIpcChannels.importPlugin)).resolves.toBeNull()
    expect(manager.install).not.toHaveBeenCalled()
    expect(onDidChange).not.toHaveBeenCalled()
    expect(target.webContents.send).not.toHaveBeenCalled()

    const registered = [...handlers.keys()]
    dispose()
    expect(registered).toHaveLength(7)
    expect(removedHandlers.sort()).toEqual(registered.sort())
    expect(handlers).toHaveLength(0)
  })

  test("does not route remote catalog changes through the installed Plugin lifecycle", async () => {
    const { registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const remote = createRemoteCatalog()
    const live = testWindow()
    windows.push(live)
    const dispose = registerPluginManagementIpc(createManager(), [], () => true, remote)

    remote.emitChange()
    expect(remote.subscribe).not.toHaveBeenCalled()
    expect(live.webContents.send).not.toHaveBeenCalled()
    dispose()
    expect(remote.unsubscribe).not.toHaveBeenCalled()
  })

  test("does not publish change lifecycle when install-time executable authorization fails", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    manager.install = mock(async (_source: string, options) => {
      await options?.beforePublish?.(manifest("imported-plugin"))
      return manifest("imported-plugin")
    }) as WebPluginManager["install"]
    const target = testWindow()
    windows.push(target)
    dialogResult = { canceled: false, filePaths: ["/portable/plugin-source"] }
    const onDidChange = mock((_pluginId: string) => undefined)
    const prepareInstall = mock(async () => {
      throw new Error("Tool Plugin executable could not be verified during installation")
    })
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      onDidChange,
      prepareInstall,
    })

    await expect(invoke(pluginManagementIpcChannels.importPlugin)).rejects.toThrow("could not be verified")
    expect(prepareInstall).toHaveBeenCalledTimes(1)
    expect(onDidChange).not.toHaveBeenCalled()
    expect(target.webContents.send).not.toHaveBeenCalled()
    dispose()
  })

  test("forwards install authorization and reconciles only after a successful uninstall", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    const item = catalogEntry("catalog-plugin")
    const prepareInstall = mock(async () => ({
      commit: async () => undefined,
      publish: async () => undefined,
      rollback: async () => undefined,
    }))
    const onDidChange = mock((_pluginId: string) => undefined)
    dialogResult = { canceled: false, filePaths: ["/portable/plugin-source"] }
    const dispose = registerPluginManagementIpc(manager, [item], () => true, undefined, {
      onDidChange,
      prepareInstall,
    })

    await invoke(pluginManagementIpcChannels.importPlugin)
    expect(manager.install).toHaveBeenCalledWith("/portable/plugin-source", {
      beforePublish: expect.any(Function),
      updateExisting: true,
    })
    await invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: item.manifest.id })
    expect(manager.installOrUpdateBuiltinBundle).toHaveBeenCalledWith(item.bundle, {
      beforePublish: expect.any(Function),
    })
    await invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "installed-plugin" })
    expect(onDidChange).toHaveBeenCalledWith("installed-plugin")

    manager.uninstall = mock(async () => false) as WebPluginManager["uninstall"]
    await invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "missing-plugin" })
    expect(onDidChange).toHaveBeenCalledTimes(3)
    dispose()
  })

  test("drains service authorization before Plugin publication and uninstall", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const order: string[] = []
    const manager = createManager()
    manager.install = mock(async (_source: string, options) => {
      const installed = manifest("imported-plugin")
      const transaction = await options?.beforePublish?.(installed)
      await transaction?.publish()
      order.push("package.publish")
      await transaction?.commit()
      return installed
    }) as WebPluginManager["install"]
    manager.uninstall = mock(async (_pluginId: string, options) => {
      const transaction = await options.beforeRemove?.(manifest("imported-plugin"))
      await transaction?.publish()
      order.push("package.uninstall")
      await transaction?.activate?.()
      await transaction?.commit()
      return true
    }) as WebPluginManager["uninstall"]
    const beforeChange = mock(async (pluginId: string) => {
      order.push(`before:${pluginId}`)
    })
    const prepareInstall = mock(async () => ({
      commit: async () => {
        order.push("authorization.commit")
      },
      publish: async () => {
        order.push("authorization.publish")
      },
      rollback: async () => undefined,
    }))
    dialogResult = { canceled: false, filePaths: ["/portable/plugin-source"] }
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      beforeChange,
      onDidChange: async () => undefined,
      prepareInstall,
    })

    await invoke(pluginManagementIpcChannels.importPlugin)
    await invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "imported-plugin" })
    expect(order).toEqual([
      "before:imported-plugin",
      "authorization.publish",
      "package.publish",
      "authorization.commit",
      "before:imported-plugin",
      "package.uninstall",
    ])
    dispose()
  })

  test("does not report an already committed mutation as failed when post-change cleanup fails", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    const target = testWindow()
    windows.push(target)
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
    const reconcileAfterChange = mock(async () => undefined)
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      onDidChange: async () => {
        throw new Error("temporary cleanup failure")
      },
      reconcileAfterChange,
    })
    try {
      await expect(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "installed-plugin" })).resolves.toBe(true)
      expect(target.webContents.send).toHaveBeenCalledWith(pluginManagementIpcChannels.changed)
      expect(reconcileAfterChange).not.toHaveBeenCalled()
      expect(warning).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
      warning.mockRestore()
    }
  })

  test("invalidates outside the Plugin mutation lock and reconciles under the latest package lock", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    const phases: string[] = []
    let locked = false
    manager.withPluginMutation = mock(async (pluginId, operation) => {
      expect(locked).toBe(false)
      locked = true
      phases.push(`lock:${pluginId}`)
      try {
        return await operation({ pluginId })
      } finally {
        locked = false
      }
    }) as WebPluginManager["withPluginMutation"]
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      onDidChange: async (pluginId) => {
        phases.push(`invalidate:${pluginId}:${locked}`)
      },
      reconcileAfterChange: async (pluginId) => {
        phases.push(`reconcile:${pluginId}:${locked}`)
      },
    })

    try {
      await expect(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "installed-plugin" })).resolves.toBe(true)
      expect(phases).toEqual([
        "invalidate:installed-plugin:false",
        "lock:installed-plugin",
        "reconcile:installed-plugin:true",
      ])
    } finally {
      dispose()
    }
  })

  test("merges remote catalog entries and routes remote installs by id without accepting a URL", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager([manifest("remote-plugin")])
    const remote = createRemoteCatalog()
    const target = testWindow()
    windows.push(target)
    const dispose = registerPluginManagementIpc(manager, [catalogEntry("builtin-plugin")], () => true, remote)

    await expect(invoke(pluginManagementIpcChannels.listPlugins)).resolves.toEqual({
      catalog: [
        { ...manifest("builtin-plugin"), installed: false },
        {
          ...manifest("remote-plugin"),
          installed: true,
          installedVersion: "1.0.0",
          updateAvailable: false,
        },
      ],
      installed: [manifest("remote-plugin")],
    })
    expect(remote.listPluginCatalog).toHaveBeenCalledWith(new Set(["remote-plugin"]))

    await expect(
      invoke(pluginManagementIpcChannels.installCatalogPlugin, {
        id: "remote-plugin",
        url: "https://attacker.invalid/plugin.zip",
      }),
    ).resolves.toMatchObject({ id: "remote-plugin" })
    expect(remote.installPlugin).toHaveBeenCalledWith("remote-plugin", { allowHooks: true })
    expect(target.webContents.send).toHaveBeenCalledWith(pluginManagementIpcChannels.changed)

    await expect(
      invoke(pluginManagementIpcChannels.openCatalogPluginRelease, {
        id: "remote-plugin",
        url: "https://attacker.invalid/release",
      }),
    ).resolves.toBe(true)
    expect(remote.getPluginReleaseUrl).toHaveBeenCalledWith("remote-plugin")
    expect(openedExternalUrls).toEqual([
      "https://github.com/microvoid/convax-plugins/releases/tag/plugin-remote-plugin-v1.0.0",
    ])

    await invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: "builtin-plugin" })
    expect(manager.installOrUpdateBuiltinBundle).toHaveBeenCalledTimes(1)
    expect(remote.installPlugin).toHaveBeenCalledTimes(1)
    dispose()
  })

  test("keeps built-ins available when the remote catalog cannot be loaded", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const remote = createRemoteCatalog()
    remote.listPluginCatalog.mockRejectedValueOnce(new Error("network unavailable"))
    const manager = createManager()
    const dispose = registerPluginManagementIpc(manager, [catalogEntry("builtin-plugin")], () => true, remote)

    await expect(invoke(pluginManagementIpcChannels.listPlugins)).resolves.toEqual({
      catalog: [{ ...manifest("builtin-plugin"), installed: false }],
      installed: [],
    })
    dispose()
  })
})
