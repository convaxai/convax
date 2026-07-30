import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import type { ActiveInstalledWebPluginSummary, InstalledWebPluginSummary } from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"
import type { PluginManagementInventory } from "./plugin-management-ipc"
import type { PluginManagementCatalogPort as RemotePluginCatalogPort } from "./plugin-management-ipc"

const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")

type InvokeHandler = (event: TestIpcEvent, input?: unknown) => unknown
type TestIpcEvent = { sender: { id: number } }

interface TestWindow {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send: ReturnType<typeof mock>
  }
}

const handlers = new Map<string, InvokeHandler>()
const removedHandlers: string[] = []
const windows: TestWindow[] = []
const dialogCalls: unknown[][] = []
const openedExternalUrls: string[] = []
let dialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
let dialogOwner: TestWindow | undefined

function manifest(id: string, version = "1.0.0"): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: { canvas: { renderer: { create: true } } },
    description: `${id} description`,
    entry: "index.html",
    hostApi: { major: 1, optional: [], required: ["host.context.get"] },
    id,
    name: id,
    schema: "convax.plugin/8",
    version,
  }
}

function agentMcpManifest(id: string): InstalledWebPluginSummary {
  return {
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
    hostApi: { major: 1, optional: [], required: [] },
    id,
    name: id,
    schema: "convax.plugin/8",
    version: "1.0.0",
  }
}

function builtin(id: string): DesktopBuiltinPluginBundle {
  return {
    bundle: { files: { "index.html": "<!doctype html>", "manifest.json": "{}" } },
    manifest: manifest(id),
  }
}

function activeManifest(plugin: InstalledWebPluginSummary, activeRevision = 1): ActiveInstalledWebPluginSummary {
  return {
    ...plugin,
    activeRevision,
    activeSetDigest: "a".repeat(64),
    snapshotDigest: "b".repeat(64),
  }
}

function inventory(installed: InstalledWebPluginSummary[] = []): PluginManagementInventory {
  return { list: mock(async () => installed.map((plugin, index) => activeManifest(plugin, index + 1))) }
}

function remoteCatalog() {
  let listener: (() => void) | undefined
  const unsubscribe = mock(() => undefined)
  const port = {
    getPluginReleaseUrl: mock(
      async (id: string) => `https://github.com/microvoid/convax-plugins/releases/tag/plugin-${id}-v1.0.0`,
    ),
    installPlugin: mock(async (id: string) => manifest(id)),
    listPluginCatalog: mock(async (installedIds: ReadonlySet<string>) => [
      { ...manifest("remote-plugin"), installed: installedIds.has("remote-plugin") },
    ]),
    subscribe: mock((next: () => void) => {
      listener = next
      return unsubscribe
    }),
  } satisfies RemotePluginCatalogPort
  return { ...port, emitChange: () => listener?.(), unsubscribe }
}

function invoke(channel: string, input?: unknown, event: TestIpcEvent = { sender: { id: 1 } }) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler(event, input)
}

function windowFixture({ destroyed = false, webContentsDestroyed = false } = {}): TestWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => webContentsDestroyed,
      send: mock(() => undefined),
    },
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

describe("registerPluginManagementIpc v8 snapshot routing", () => {
  test("keeps the preload channel contract stable and rejects untrusted senders", async () => {
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
    const manager = inventory()
    const dispose = registerPluginManagementIpc(manager, [], (event) => event.sender.id === 1)
    for (const channel of Object.values(pluginManagementIpcChannels).filter(
      (channel) => channel !== pluginManagementIpcChannels.changed,
    )) {
      await expect(Promise.resolve().then(() => invoke(channel, {}, { sender: { id: 2 } }))).rejects.toThrow(
        "untrusted renderer",
      )
    }
    expect(manager.list).not.toHaveBeenCalled()
    dispose()
  })

  test("derives inventory and Agent MCP status only from the active Plugin set", async () => {
    const remote = remoteCatalog()
    const agent = agentMcpManifest("remote-agent")
    const manager = inventory([agent, manifest("remote-plugin")])
    const listAgentMcpStatuses = mock(async () => ({ "remote-agent": "connected" as const }))
    const connectAgentMcp = mock(async () => undefined)
    const target = windowFixture()
    windows.push(target)
    const dispose = registerPluginManagementIpc(manager, [builtin("builtin-plugin")], () => true, remote, {
      connectAgentMcp,
      listAgentMcpStatuses,
    })

    await expect(invoke(pluginManagementIpcChannels.agentMcpStatuses)).resolves.toEqual({
      "remote-agent": "connected",
    })
    expect(listAgentMcpStatuses).toHaveBeenCalledWith([
      activeManifest(agent),
      activeManifest(manifest("remote-plugin"), 2),
    ])
    await expect(invoke(pluginManagementIpcChannels.connectAgentMcp, { id: agent.id })).resolves.toBeUndefined()
    expect(connectAgentMcp).toHaveBeenCalledWith(activeManifest(agent))
    expect(target.webContents.send).toHaveBeenCalledWith(pluginManagementIpcChannels.changed)

    await expect(invoke(pluginManagementIpcChannels.listPlugins)).resolves.toMatchObject({
      catalog: [
        { id: "builtin-plugin", installed: false },
        { id: "remote-plugin", installed: true, installedVersion: "1.0.0" },
      ],
      installed: [activeManifest(agent), activeManifest(manifest("remote-plugin"), 2)],
    })
    dispose()
  })

  test("imports only through the v8 local snapshot installer and publishes only committed changes", async () => {
    const manager = inventory()
    const target = windowFixture()
    windows.push(target)
    dialogOwner = target
    const installLocal = mock(async (_directory: string) => manifest("imported-plugin"))
    const onDidChange = mock(async () => undefined)
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      installLocal,
      onDidChange,
    })

    await expect(invoke(pluginManagementIpcChannels.importPlugin)).resolves.toBeNull()
    expect(installLocal).not.toHaveBeenCalled()

    dialogResult = { canceled: false, filePaths: ["/portable/plugin-source"] }
    await expect(invoke(pluginManagementIpcChannels.importPlugin)).resolves.toMatchObject({
      id: "imported-plugin",
      schema: "convax.plugin/8",
    })
    expect(installLocal).toHaveBeenCalledWith("/portable/plugin-source")
    expect(dialogCalls[1]).toEqual([target, expect.objectContaining({ properties: ["openDirectory"] })])
    expect(onDidChange).toHaveBeenCalledWith("imported-plugin")
    expect(target.webContents.send).toHaveBeenCalledTimes(1)

    installLocal.mockRejectedValueOnce(new Error("snapshot publication failed"))
    await expect(invoke(pluginManagementIpcChannels.importPlugin)).rejects.toThrow("snapshot publication failed")
    expect(onDidChange).toHaveBeenCalledTimes(1)
    expect(target.webContents.send).toHaveBeenCalledTimes(1)
    dispose()
  })

  test("rejects legacy built-in bytes and routes remote installs by id through the snapshot catalog", async () => {
    const remote = remoteCatalog()
    const target = windowFixture()
    windows.push(target)
    const onDidChange = mock(async () => undefined)
    const dispose = registerPluginManagementIpc(inventory(), [builtin("legacy-builtin")], () => true, remote, {
      onDidChange,
    })

    expect(() => invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: "legacy-builtin" })).toThrow(
      "unsupported by the v8 installer",
    )
    expect(remote.installPlugin).not.toHaveBeenCalled()

    await expect(
      invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: "remote-plugin" }),
    ).resolves.toMatchObject({ id: "remote-plugin", schema: "convax.plugin/8" })
    expect(remote.installPlugin).toHaveBeenCalledWith("remote-plugin", { allowHooks: true })
    expect(onDidChange).toHaveBeenCalledWith("remote-plugin")
    expect(target.webContents.send).toHaveBeenCalledTimes(1)
    dispose()
  })

  test("uninstalls only active Plugins through the snapshot lifecycle", async () => {
    const current = manifest("installed-plugin")
    const manager = inventory([current])
    const beforeChange = mock(async () => undefined)
    const uninstall = mock(async () => true)
    const onDidChange = mock(async () => undefined)
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      beforeChange,
      onDidChange,
      uninstall,
    })

    await expect(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: current.id })).resolves.toBe(true)
    expect(beforeChange).toHaveBeenCalledWith(current.id)
    expect(uninstall).toHaveBeenCalledWith(current.id)
    expect(onDidChange).toHaveBeenCalledWith(current.id)

    manager.list = mock(async () => [])
    await expect(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "missing-plugin" })).resolves.toBe(false)
    expect(uninstall).toHaveBeenCalledTimes(1)
    expect(onDidChange).toHaveBeenCalledTimes(1)
    dispose()
  })

  test("serializes post-commit invalidation without blocking committed ActiveSet mutations", async () => {
    const manager = inventory([manifest("one"), manifest("two")])
    const target = windowFixture()
    windows.push(target)
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
    let releaseFirst!: () => void
    let enteredFirst!: () => void
    let enteredSecond!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const entered = new Promise<void>((resolve) => {
      enteredFirst = resolve
    })
    const secondEntered = new Promise<void>((resolve) => {
      enteredSecond = resolve
    })
    const order: string[] = []
    const onDidChange = mock(async (pluginId: string) => {
      order.push(pluginId)
      if (pluginId === "one") {
        enteredFirst()
        await gate
        throw new Error("temporary invalidation failure")
      }
      enteredSecond()
    })
    const uninstall = mock(async () => true)
    const dispose = registerPluginManagementIpc(manager, [], () => true, undefined, {
      onDidChange,
      uninstall,
    })

    const first = Promise.resolve(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "one" }))
    await entered
    await expect(first).resolves.toBe(true)
    const second = Promise.resolve(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "two" }))
    await expect(second).resolves.toBe(true)
    expect(order).toEqual(["one"])
    releaseFirst()
    await secondEntered
    expect(order).toEqual(["one", "two"])
    expect(warning).toHaveBeenCalledTimes(1)
    expect(target.webContents.send).toHaveBeenCalledTimes(2)
    dispose()
    warning.mockRestore()
  })

  test("opens release URLs, forwards remote invalidation, and removes every handler on dispose", async () => {
    const remote = remoteCatalog()
    const target = windowFixture()
    windows.push(target)
    const dispose = registerPluginManagementIpc(inventory(), [], () => true, remote)

    await expect(invoke(pluginManagementIpcChannels.openCatalogPluginRelease, { id: "remote-plugin" })).resolves.toBe(
      true,
    )
    expect(openedExternalUrls).toEqual([
      "https://github.com/microvoid/convax-plugins/releases/tag/plugin-remote-plugin-v1.0.0",
    ])
    remote.emitChange()
    expect(target.webContents.send).toHaveBeenCalledWith(pluginManagementIpcChannels.changed)

    const registered = [...handlers.keys()]
    dispose()
    expect(registered).toHaveLength(7)
    expect(removedHandlers.sort()).toEqual(registered.sort())
    expect(remote.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
