import { afterEach, describe, expect, mock, test } from "bun:test"
import type { InstalledWebPluginSummary, WebPluginManifest } from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type { WebPluginManager } from "./plugin-manager"

type InvokeHandler = (event: TestIpcEvent, input?: unknown) => unknown
type TestIpcEvent = { sender: { id: number } }

const handlers = new Map<string, InvokeHandler>()
const removedHandlers: string[] = []
const windows: TestWindow[] = []
const dialogCalls: unknown[][] = []
let dialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
let dialogOwner: TestWindow | undefined

interface TestWindow {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send: ReturnType<typeof mock>
  }
}

const isIsolatedRun = process.env.CONVAX_PLUGIN_MANAGEMENT_IPC_TEST === "isolated"

async function runIsolatedTestFile() {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", import.meta.path],
    env: { ...globalThis.process.env, CONVAX_PLUGIN_MANAGEMENT_IPC_TEST: "isolated" },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Isolated Plugin IPC tests failed:\n${stdout}\n${stderr}`)
}

if (!isIsolatedRun) {
  test("runs the Electron-mocked Plugin IPC contract in isolation", runIsolatedTestFile)
} else {
  mock.module("electron", () => ({
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
  }))

  afterEach(() => {
    handlers.clear()
    removedHandlers.splice(0)
    windows.splice(0)
    dialogCalls.splice(0)
    dialogResult = { canceled: true, filePaths: [] }
    dialogOwner = undefined
  })
}

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

const catalogEntry = (id: string): DesktopBuiltinPluginBundle => ({
  bundle: { files: { "index.html": "<!doctype html>", "manifest.json": "{}" } },
  manifest: manifest(id),
})

function createManager(installed: InstalledWebPluginSummary[] = []) {
  return {
    install: mock(async (_source: string) => manifest("imported-plugin")),
    installBundle: mock(async (_bundle: unknown) => manifest("catalog-plugin")),
    list: mock(async () => installed),
    uninstall: mock(async (_id: string) => true),
  } as unknown as WebPluginManager
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

if (isIsolatedRun) describe("registerPluginManagementIpc", () => {
  test("keeps the preload client channel contract stable", async () => {
    const { pluginManagementIpcChannels } = await import("./plugin-management-ipc")
    expect(pluginManagementIpcChannels).toEqual({
      changed: "plugin:changed",
      importPlugin: "plugin:import",
      installCatalogPlugin: "plugin:catalog-install",
      listPlugins: "plugin:list",
      uninstallPlugin: "plugin:uninstall",
    })
  })

  test("rejects every request from an untrusted renderer", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    const dispose = registerPluginManagementIpc(manager, [catalogEntry("catalog-plugin")], (event) => event.sender.id === 1)

    for (const channel of [
      pluginManagementIpcChannels.listPlugins,
      pluginManagementIpcChannels.importPlugin,
      pluginManagementIpcChannels.installCatalogPlugin,
      pluginManagementIpcChannels.uninstallPlugin,
    ]) {
      await expect(Promise.resolve().then(() => invoke(
        channel,
        {},
        { sender: { id: 2 } },
      ))).rejects.toThrow("untrusted renderer")
    }
    expect(manager.list).not.toHaveBeenCalled()
    expect(manager.install).not.toHaveBeenCalled()
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
    const dispose = registerPluginManagementIpc(manager, catalog, () => true)

    await expect(invoke(pluginManagementIpcChannels.listPlugins)).resolves.toEqual({
      catalog: [
        { ...catalog[0]!.manifest, installed: true },
        { ...catalog[1]!.manifest, installed: false },
      ],
      installed: [installed],
    })

    dialogResult = { canceled: false, filePaths: ["/portable/plugin-source"] }
    await expect(invoke(pluginManagementIpcChannels.importPlugin)).resolves.toMatchObject({ id: "imported-plugin" })
    expect(manager.install).toHaveBeenCalledWith("/portable/plugin-source")
    expect(dialogCalls[0]).toEqual([
      sent,
      expect.objectContaining({ properties: ["openDirectory"] }),
    ])

    await expect(invoke(pluginManagementIpcChannels.installCatalogPlugin, { id: "catalog-plugin" }))
      .resolves.toMatchObject({ id: "catalog-plugin" })
    expect(manager.installBundle).toHaveBeenCalledWith(catalog[1]!.bundle)
    await expect(invoke(pluginManagementIpcChannels.uninstallPlugin, { id: "installed-plugin" })).resolves.toBe(true)
    expect(manager.uninstall).toHaveBeenCalledWith("installed-plugin")
    expect(sent.webContents.send).toHaveBeenCalledTimes(3)
    expect(sent.webContents.send).toHaveBeenCalledWith(pluginManagementIpcChannels.changed)

    await expect(Promise.resolve().then(() => invoke(
      pluginManagementIpcChannels.installCatalogPlugin,
      { id: "missing" },
    )))
      .rejects.toThrow("catalog item was not found")
    expect(sent.webContents.send).toHaveBeenCalledTimes(3)
    dispose()
  })

  test("does not publish canceled imports and removes every handler on dispose", async () => {
    const { pluginManagementIpcChannels, registerPluginManagementIpc } = await import("./plugin-management-ipc")
    const manager = createManager()
    const target = testWindow()
    windows.push(target)
    const dispose = registerPluginManagementIpc(manager, [], () => true)

    await expect(invoke(pluginManagementIpcChannels.importPlugin)).resolves.toBeNull()
    expect(manager.install).not.toHaveBeenCalled()
    expect(target.webContents.send).not.toHaveBeenCalled()

    const registered = [...handlers.keys()]
    dispose()
    expect(registered).toHaveLength(4)
    expect(removedHandlers.sort()).toEqual(registered.sort())
    expect(handlers).toHaveLength(0)
  })
})
