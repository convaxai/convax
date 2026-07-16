import { afterEach, describe, expect, mock, test } from "bun:test"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import type { DesktopSkillManager } from "./skill-manager"
import type { WebPluginManager } from "./plugin-manager"

type InvokeHandler = (event: TestIpcEvent, input?: unknown) => unknown
type TestIpcEvent = { sender: { id: number } }

const handlers = new Map<string, InvokeHandler>()
const removedHandlers: string[] = []
const windows: TestWindow[] = []
let dialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
let dialogOwner: TestWindow | undefined

interface TestWindow {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send: ReturnType<typeof mock>
  }
}

const isIsolatedRun = process.env.CONVAX_SKILL_MANAGEMENT_IPC_TEST === "isolated"

async function runIsolatedTestFile() {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", import.meta.path],
    env: { ...globalThis.process.env, CONVAX_SKILL_MANAGEMENT_IPC_TEST: "isolated" },
    stderr: "pipe",
    stdout: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`Isolated Skill IPC tests failed:\n${stdout}\n${stderr}`)
}

if (!isIsolatedRun) {
  test("runs the Electron-mocked Skill IPC contract in isolation", runIsolatedTestFile)
} else {
  mock.module("electron", () => ({
  BrowserWindow: {
    fromWebContents: () => dialogOwner,
    getAllWindows: () => windows,
  },
  dialog: {
    showOpenDialog: async () => dialogResult,
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
    dialogResult = { canceled: true, filePaths: [] }
    dialogOwner = undefined
  })
}

function createManager() {
  let changeListener: (() => void) | undefined
  const unsubscribe = mock(() => undefined)
  const manager = {
    importFromDirectory: mock(async (source: string) => ({
      location: `${source}/SKILL.md`, managed: true, name: "imported", source: "managed" as const,
    })),
    installCatalogSkill: mock(async (id: string) => ({
      location: `/managed/${id}/SKILL.md`, managed: true, name: id, source: "managed" as const,
    })),
    list: mock(async (directory?: string) => ({ catalog: [], directory, skills: [] })),
    subscribe: mock((listener: () => void) => {
      changeListener = listener
      return unsubscribe
    }),
    uninstall: mock(async (_name: string) => true),
  } as unknown as DesktopSkillManager
  return { emitChange: () => changeListener?.(), manager, unsubscribe }
}

function createPlugins() {
  const list = mock(async (): Promise<InstalledWebPluginSummary[]> => [{
    capabilities: [],
    contributes: { canvas: { renderer: { create: true } } },
    description: "Director",
    entry: "index.html",
    id: "director-stage",
    name: "Director",
    schema: "convax.plugin/1",
    skill: "skills/director/SKILL.md",
    version: "1.0.0",
  }])
  return {
    list,
    resolveAsset: mock(async () => "/plugins/director-stage/skills/director/SKILL.md"),
  } satisfies Pick<WebPluginManager, "list" | "resolveAsset">
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

if (isIsolatedRun) describe("registerSkillManagementIpc", () => {
  test("keeps the preload client channel contract stable", async () => {
    const { skillManagementIpcChannels } = await import("./skill-management-ipc")
    expect(skillManagementIpcChannels).toEqual({
      changed: "agent:skills-changed",
      importSkill: "agent:skill-import",
      installCatalogSkill: "agent:skill-catalog-install",
      installPluginSkill: "agent:skill-plugin-install",
      listSkills: "agent:skills-list",
      uninstallSkill: "agent:skill-uninstall",
    })
  })

  test("rejects every request from an untrusted renderer", async () => {
    const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
    const setup = createManager()
    const projects = { resolveEntryPath: mock(async () => "/project") }
    const dispose = registerSkillManagementIpc(setup.manager, projects, createPlugins(), (event) => event.sender.id === 1)

    for (const channel of [
      skillManagementIpcChannels.listSkills,
      skillManagementIpcChannels.importSkill,
      skillManagementIpcChannels.installCatalogSkill,
      skillManagementIpcChannels.installPluginSkill,
      skillManagementIpcChannels.uninstallSkill,
    ]) {
      await expect(Promise.resolve().then(() => invoke(
        channel,
        {},
        { sender: { id: 2 } },
      ))).rejects.toThrow("untrusted renderer")
    }
    expect(setup.manager.list).not.toHaveBeenCalled()
    expect(projects.resolveEntryPath).not.toHaveBeenCalled()
    dispose()
  })

  test("resolves Project scope and routes import, catalog, plugin Skill, and uninstall operations", async () => {
    const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
    const setup = createManager()
    const projects = { resolveEntryPath: mock(async ({ projectId }: { projectId: string }) => `/projects/${projectId}`) }
    const plugins = createPlugins()
    dialogResult = { canceled: false, filePaths: ["/skills/import-me"] }
    const dispose = registerSkillManagementIpc(setup.manager, projects, plugins, () => true)

    await invoke(skillManagementIpcChannels.listSkills)
    expect(setup.manager.list).toHaveBeenLastCalledWith(undefined)
    await invoke(skillManagementIpcChannels.listSkills, { scopeId: "project-one" })
    expect(projects.resolveEntryPath).toHaveBeenCalledWith({ projectId: "project-one" })
    expect(setup.manager.list).toHaveBeenLastCalledWith("/projects/project-one")

    await invoke(skillManagementIpcChannels.importSkill)
    expect(setup.manager.importFromDirectory).toHaveBeenCalledWith("/skills/import-me")
    await invoke(skillManagementIpcChannels.installCatalogSkill, { id: "storyboard" })
    expect(setup.manager.installCatalogSkill).toHaveBeenCalledWith("storyboard")
    await invoke(skillManagementIpcChannels.installPluginSkill, { pluginId: "director-stage" })
    expect(plugins.resolveAsset).toHaveBeenCalledWith("director-stage", "skills/director/SKILL.md")
    expect(setup.manager.importFromDirectory).toHaveBeenLastCalledWith("/plugins/director-stage/skills/director")
    await invoke(skillManagementIpcChannels.uninstallSkill, { name: "storyboard" })
    expect(setup.manager.uninstall).toHaveBeenCalledWith("storyboard")
    dispose()
  })

  test("handles canceled import and invalid companion Skills without mutating the manager", async () => {
    const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
    const setup = createManager()
    const projects = { resolveEntryPath: mock(async () => "/project") }
    const plugins = createPlugins()
    plugins.list.mockResolvedValueOnce([])
    const dispose = registerSkillManagementIpc(setup.manager, projects, plugins, () => true)

    await expect(invoke(skillManagementIpcChannels.importSkill)).resolves.toBeNull()
    expect(setup.manager.importFromDirectory).not.toHaveBeenCalled()
    await expect(invoke(skillManagementIpcChannels.installPluginSkill, { pluginId: "missing" }))
      .rejects.toThrow("Installed Plugin was not found")

    plugins.list.mockResolvedValueOnce([{
      capabilities: [],
      contributes: { canvas: { renderer: { create: true } } },
      description: "No Skill",
      entry: "index.html",
      id: "no-skill",
      name: "No Skill",
      schema: "convax.plugin/1",
      version: "1.0.0",
    }])
    await expect(invoke(skillManagementIpcChannels.installPluginSkill, { pluginId: "no-skill" }))
      .rejects.toThrow("does not include a companion Skill")
    expect(plugins.resolveAsset).not.toHaveBeenCalled()
    dispose()
  })

  test("broadcasts manager changes to live windows and fully disposes subscriptions and handlers", async () => {
    const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
    const setup = createManager()
    const live = testWindow()
    windows.push(live, testWindow({ destroyed: true }), testWindow({ webContentsDestroyed: true }))
    const dispose = registerSkillManagementIpc(
      setup.manager,
      { resolveEntryPath: mock(async () => "/project") },
      createPlugins(),
      () => true,
    )

    setup.emitChange()
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    expect(live.webContents.send).toHaveBeenCalledWith(skillManagementIpcChannels.changed)

    const registered = [...handlers.keys()]
    dispose()
    expect(setup.unsubscribe).toHaveBeenCalledTimes(1)
    expect(registered).toHaveLength(5)
    expect(removedHandlers.sort()).toEqual(registered.sort())
    expect(handlers).toHaveLength(0)
  })
})
