import { afterEach, describe, expect, mock, test } from "bun:test"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import type { DesktopSkillInventory, DesktopSkillShowcase } from "../skill-management-contracts"
import type { DesktopSkillManager } from "./skill-manager"
import type { WebPluginManager } from "./plugin-manager"
import type { RemoteSkillCatalogPort } from "./remote-capability-installer"

type InvokeHandler = (event: TestIpcEvent, input?: unknown) => unknown
type TestIpcEvent = { sender: { id: number } }

const handlers = new Map<string, InvokeHandler>()
const removedHandlers: string[] = []
const windows: TestWindow[] = []
let dialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
let dialogOwner: TestWindow | undefined
let openPathError = ""
const openedPaths: string[] = []

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
    shell: {
      openPath: async (path: string) => {
        openedPaths.push(path)
        return openPathError
      },
    },
  }))

  afterEach(() => {
    handlers.clear()
    removedHandlers.splice(0)
    windows.splice(0)
    dialogResult = { canceled: true, filePaths: [] }
    dialogOwner = undefined
    openPathError = ""
    openedPaths.splice(0)
  })
}

function createManager(inventory: DesktopSkillInventory = { catalog: [], skills: [] }) {
  let changeListener: (() => void) | undefined
  const unsubscribe = mock(() => undefined)
  const getBuiltinSkillShowcase = mock(
    async (_id: string, _media: "animation" | "poster"): Promise<DesktopSkillShowcase | null> => null,
  )
  const getCatalogSkillDetails = mock(async (id: string) => ({
    description: "Built-in workflow",
    files: [{ content: "# Built in", kind: "text" as const, path: "SKILL.md", size: 10 }],
    id,
    name: "Storyboard",
    version: "0.1.0",
  }))
  const getInstalledSkillDetails = mock(async (name: string, source: "global" | "managed") => ({
    description: `${source} workflow`,
    files: [{ content: `# ${name}`, kind: "text" as const, path: "SKILL.md", size: name.length + 2 }],
    id: name,
    name,
  }))
  const manager = {
    getBuiltinSkillShowcase,
    getCatalogSkillDetails,
    getInstalledSkillDetails,
    hasCatalogSkill: mock((id: string) => id === "storyboard"),
    importFromDirectory: mock(async (source: string) => ({
      location: `${source}/SKILL.md`,
      managed: true,
      name: "imported",
      source: "managed" as const,
    })),
    installCatalogSkill: mock(async (id: string) => ({
      location: `/managed/${id}/SKILL.md`,
      managed: true,
      name: id,
      source: "managed" as const,
    })),
    list: mock(async (_directory?: string) => inventory),
    resolveSkillLocation: mock(
      async (name: string, directory?: string) => `${directory ?? "/default"}/${name}/SKILL.md`,
    ),
    subscribe: mock((listener: () => void) => {
      changeListener = listener
      return unsubscribe
    }),
    uninstall: mock(async (_name: string) => true),
  } as unknown as DesktopSkillManager
  return {
    emitChange: () => changeListener?.(),
    getBuiltinSkillShowcase,
    getCatalogSkillDetails,
    getInstalledSkillDetails,
    manager,
    unsubscribe,
  }
}

function createRemoteCatalog() {
  return {
    getSkillDetails: mock(async (id: string) => ({
      description: "Remote workflow",
      files: [{ content: "# Remote", kind: "text" as const, path: "SKILL.md", size: 8 }],
      id,
      name: "Remote Review",
      version: "1.0.0",
    })),
    getSkillShowcase: mock(async (_id: string, media: "animation" | "poster") => ({
      altText: "Remote workflow preview",
      bytes: Uint8Array.from([1, 2, 3]),
      mimeType: media === "poster" ? ("image/png" as const) : ("video/mp4" as const),
      size: 3,
    })),
    installSkill: mock(async (id: string) => ({
      location: `/managed/${id}/SKILL.md`,
      managed: true,
      name: id,
      source: "managed" as const,
    })),
    listSkillCatalog: mock(async (installedNames: ReadonlySet<string>) => [
      {
        description: "Remote workflow",
        id: "remote-review",
        installed: installedNames.has("remote-review"),
        name: "Remote Review",
      },
    ]),
  } satisfies RemoteSkillCatalogPort
}

function createPlugins() {
  const list = mock(
    async (): Promise<InstalledWebPluginSummary[]> => [
      {
        capabilities: [],
        contributes: { canvas: { renderer: { create: true } } },
        description: "Director",
        entry: "index.html",
        id: "director-stage",
        name: "Director",
        schema: "convax.plugin/1",
        skill: "skills/director/SKILL.md",
        version: "1.0.0",
      },
    ],
  )
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

if (isIsolatedRun)
  describe("registerSkillManagementIpc", () => {
    test("keeps the preload client channel contract stable", async () => {
      const { skillManagementIpcChannels } = await import("./skill-management-ipc")
      expect(skillManagementIpcChannels).toEqual({
        changed: "agent:skills-changed",
        getSkillDetails: "agent:skill-details",
        getSkillShowcase: "agent:skill-showcase",
        importSkill: "agent:skill-import",
        installCatalogSkill: "agent:skill-catalog-install",
        installPluginSkill: "agent:skill-plugin-install",
        listSkills: "agent:skills-list",
        openSkill: "agent:skill-open",
        uninstallSkill: "agent:skill-uninstall",
      })
    })

    test("rejects every request from an untrusted renderer", async () => {
      const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
      const setup = createManager()
      const projects = { resolveEntryPath: mock(async () => "/project") }
      const dispose = registerSkillManagementIpc(
        setup.manager,
        projects,
        createPlugins(),
        (event) => event.sender.id === 1,
      )

      for (const channel of [
        skillManagementIpcChannels.getSkillDetails,
        skillManagementIpcChannels.getSkillShowcase,
        skillManagementIpcChannels.listSkills,
        skillManagementIpcChannels.importSkill,
        skillManagementIpcChannels.installCatalogSkill,
        skillManagementIpcChannels.installPluginSkill,
        skillManagementIpcChannels.openSkill,
        skillManagementIpcChannels.uninstallSkill,
      ]) {
        await expect(Promise.resolve().then(() => invoke(channel, {}, { sender: { id: 2 } }))).rejects.toThrow(
          "untrusted renderer",
        )
      }
      expect(setup.manager.list).not.toHaveBeenCalled()
      expect(projects.resolveEntryPath).not.toHaveBeenCalled()
      dispose()
    })

    test("resolves Project scope and routes import, catalog, plugin Skill, open, and uninstall operations", async () => {
      const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
      const setup = createManager()
      const projects = {
        resolveEntryPath: mock(async ({ projectId }: { projectId: string }) => `/projects/${projectId}`),
      }
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
      await invoke(skillManagementIpcChannels.openSkill, {
        name: "review",
        path: "/renderer/must-not-control-this.md",
        scopeId: "project-one",
      })
      expect(setup.manager.resolveSkillLocation).toHaveBeenCalledWith("review", "/projects/project-one")
      expect(openedPaths).toEqual(["/projects/project-one/review/SKILL.md"])
      await invoke(skillManagementIpcChannels.uninstallSkill, { name: "storyboard" })
      expect(setup.manager.uninstall).toHaveBeenCalledWith("storyboard")
      dispose()
    })

    test("surfaces native errors while opening a resolved Skill location", async () => {
      const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
      const setup = createManager()
      openPathError = "No application is registered"
      const dispose = registerSkillManagementIpc(
        setup.manager,
        { resolveEntryPath: mock(async () => "/project") },
        createPlugins(),
        () => true,
      )

      await expect(invoke(skillManagementIpcChannels.openSkill, { name: "review" })).rejects.toThrow(
        "Open Skill failed: No application is registered",
      )
      expect(setup.manager.resolveSkillLocation).toHaveBeenCalledWith("review", undefined)
      expect(openedPaths).toEqual(["/default/review/SKILL.md"])
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
      await expect(invoke(skillManagementIpcChannels.installPluginSkill, { pluginId: "missing" })).rejects.toThrow(
        "Installed Plugin was not found",
      )

      plugins.list.mockResolvedValueOnce([
        {
          capabilities: [],
          contributes: { canvas: { renderer: { create: true } } },
          description: "No Skill",
          entry: "index.html",
          id: "no-skill",
          name: "No Skill",
          schema: "convax.plugin/1",
          version: "1.0.0",
        },
      ])
      await expect(invoke(skillManagementIpcChannels.installPluginSkill, { pluginId: "no-skill" })).rejects.toThrow(
        "does not include a companion Skill",
      )
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
      expect(registered).toHaveLength(8)
      expect(removedHandlers.sort()).toEqual(registered.sort())
      expect(handlers).toHaveLength(0)
    })

    test("merges remote Skills and routes non-built-in catalog ids without accepting a URL", async () => {
      const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
      const setup = createManager({
        catalog: [{ description: "Built in", id: "storyboard", installed: false, name: "Storyboard" }],
        skills: [
          {
            location: "/managed/remote-review/SKILL.md",
            managed: true,
            name: "remote-review",
            source: "managed",
          },
        ],
      })
      const remote = createRemoteCatalog()
      const dispose = registerSkillManagementIpc(
        setup.manager,
        { resolveEntryPath: mock(async () => "/project") },
        createPlugins(),
        () => true,
        remote,
      )

      await expect(invoke(skillManagementIpcChannels.listSkills)).resolves.toEqual({
        catalog: [
          { description: "Built in", id: "storyboard", installed: false, name: "Storyboard" },
          { description: "Remote workflow", id: "remote-review", installed: true, name: "Remote Review" },
        ],
        skills: [
          {
            location: "/managed/remote-review/SKILL.md",
            managed: true,
            name: "remote-review",
            source: "managed",
          },
        ],
      })
      expect(remote.listSkillCatalog).toHaveBeenCalledWith(new Set(["remote-review"]))

      await expect(
        invoke(skillManagementIpcChannels.installCatalogSkill, {
          id: "remote-review",
          url: "https://attacker.invalid/skill.zip",
        }),
      ).resolves.toMatchObject({ name: "remote-review" })
      expect(remote.installSkill).toHaveBeenCalledWith("remote-review")

      await invoke(skillManagementIpcChannels.installCatalogSkill, { id: "storyboard" })
      expect(setup.manager.installCatalogSkill).toHaveBeenCalledTimes(1)
      expect(remote.installSkill).toHaveBeenCalledTimes(1)
      dispose()
    })

    test("routes catalog and installed details and prefers built-in showcase media", async () => {
      const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
      const setup = createManager()
      const remote = createRemoteCatalog()
      const dispose = registerSkillManagementIpc(
        setup.manager,
        { resolveEntryPath: mock(async () => "/project") },
        createPlugins(),
        () => true,
        remote,
      )

      await expect(
        invoke(skillManagementIpcChannels.getSkillDetails, {
          target: { id: "storyboard", kind: "catalog" },
        }),
      ).resolves.toMatchObject({ id: "storyboard", version: "0.1.0" })
      expect(setup.getCatalogSkillDetails).toHaveBeenCalledWith("storyboard")
      expect(remote.getSkillDetails).not.toHaveBeenCalled()

      await expect(
        invoke(skillManagementIpcChannels.getSkillDetails, {
          target: { id: "remote-review", kind: "catalog" },
        }),
      ).resolves.toMatchObject({ id: "remote-review", version: "1.0.0" })
      expect(remote.getSkillDetails).toHaveBeenCalledWith("remote-review")

      await expect(
        invoke(skillManagementIpcChannels.getSkillDetails, {
          target: { kind: "installed", name: "remote-review", source: "managed" },
        }),
      ).resolves.toMatchObject({ description: "managed workflow", id: "remote-review" })
      await expect(
        invoke(skillManagementIpcChannels.getSkillDetails, {
          target: { kind: "installed", name: "global-review", source: "global" },
        }),
      ).resolves.toMatchObject({ description: "global workflow", id: "global-review" })
      expect(setup.getInstalledSkillDetails).toHaveBeenNthCalledWith(1, "remote-review", "managed")
      expect(setup.getInstalledSkillDetails).toHaveBeenNthCalledWith(2, "global-review", "global")

      setup.getBuiltinSkillShowcase.mockResolvedValueOnce({
        altText: "Built-in storyboard preview",
        bytes: Uint8Array.from([4, 5, 6]),
        mimeType: "image/png",
        size: 3,
      })
      await expect(
        invoke(skillManagementIpcChannels.getSkillShowcase, {
          media: "poster",
          target: { id: "storyboard", kind: "catalog" },
        }),
      ).resolves.toMatchObject({ altText: "Built-in storyboard preview", mimeType: "image/png" })
      expect(setup.getBuiltinSkillShowcase).toHaveBeenNthCalledWith(1, "storyboard", "poster")
      expect(remote.getSkillShowcase).not.toHaveBeenCalled()

      await expect(
        invoke(skillManagementIpcChannels.getSkillShowcase, {
          media: "poster",
          target: { kind: "installed", name: "remote-review", source: "managed" },
        }),
      ).resolves.toMatchObject({ mimeType: "image/png" })
      expect(setup.getBuiltinSkillShowcase).toHaveBeenNthCalledWith(2, "remote-review", "poster")
      expect(remote.getSkillShowcase).toHaveBeenCalledWith("remote-review", "poster")

      dispose()
    })

    test("strictly rejects extra keys, paths, URLs, invalid sources, and invalid showcase media", async () => {
      const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
      const setup = createManager()
      const remote = createRemoteCatalog()
      const dispose = registerSkillManagementIpc(
        setup.manager,
        { resolveEntryPath: mock(async () => "/project") },
        createPlugins(),
        () => true,
        remote,
      )

      for (const input of [
        { target: { id: "remote-review", kind: "catalog" }, url: "https://attacker.invalid/skill" },
        { path: "/private/skill", target: { id: "remote-review", kind: "catalog" } },
        { target: { id: "remote-review", kind: "catalog", url: "https://attacker.invalid/skill" } },
        { target: { id: "remote-review", kind: "catalog", path: "/private/skill" } },
        { target: { id: "../remote-review", kind: "catalog" } },
        { target: { kind: "installed", name: "remote-review", source: "project" } },
        { target: { kind: "installed", name: "remote-review", path: "/private/skill", source: "managed" } },
      ]) {
        await expect(
          Promise.resolve().then(() => invoke(skillManagementIpcChannels.getSkillDetails, input)),
        ).rejects.toThrow(/contain only a target|target is invalid/)
      }
      for (const input of [
        { target: { id: "remote-review", kind: "catalog" } },
        { media: "video", target: { id: "remote-review", kind: "catalog" } },
        {
          media: "animation",
          target: { id: "remote-review", kind: "catalog" },
          url: "https://attacker.invalid/media.mp4",
        },
        {
          media: "animation",
          path: "/private/media.mp4",
          target: { id: "remote-review", kind: "catalog" },
        },
        {
          media: "poster",
          target: { id: "remote-review", kind: "catalog", url: "https://attacker.invalid/media.png" },
        },
        {
          media: "poster",
          target: { kind: "installed", name: "remote-review", source: "project" },
        },
      ]) {
        await expect(
          Promise.resolve().then(() => invoke(skillManagementIpcChannels.getSkillShowcase, input)),
        ).rejects.toThrow(/target and media|poster or animation|target is invalid/)
      }
      expect(setup.getCatalogSkillDetails).not.toHaveBeenCalled()
      expect(setup.getInstalledSkillDetails).not.toHaveBeenCalled()
      expect(setup.getBuiltinSkillShowcase).not.toHaveBeenCalled()
      expect(remote.getSkillDetails).not.toHaveBeenCalled()
      expect(remote.getSkillShowcase).not.toHaveBeenCalled()
      dispose()
    })

    test("keeps built-in Skills available when the remote catalog cannot be loaded", async () => {
      const { registerSkillManagementIpc, skillManagementIpcChannels } = await import("./skill-management-ipc")
      const setup = createManager({
        catalog: [{ description: "Built in", id: "storyboard", installed: false, name: "Storyboard" }],
        skills: [],
      })
      const remote = createRemoteCatalog()
      remote.listSkillCatalog.mockRejectedValueOnce(new Error("network unavailable"))
      const dispose = registerSkillManagementIpc(
        setup.manager,
        { resolveEntryPath: mock(async () => "/project") },
        createPlugins(),
        () => true,
        remote,
      )

      await expect(invoke(skillManagementIpcChannels.listSkills)).resolves.toEqual({
        catalog: [{ description: "Built in", id: "storyboard", installed: false, name: "Storyboard" }],
        skills: [],
      })
      dispose()
    })
  })
