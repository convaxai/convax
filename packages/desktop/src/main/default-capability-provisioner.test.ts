import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import { provisionDefaultCapabilities } from "./default-capability-provisioner"
import { desktopDefaultRemoteCapabilityCatalog } from "./default-remote-capability-catalog"
import { WebPluginPublicationDeferredError } from "./plugin-manager"

const temporaryRoots: string[] = []

const preparePluginPublication = async () => ({
  async activate() {},
  async commit() {},
  async publish() {},
  async rollback() {},
})

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-default-capabilities-"))
  temporaryRoots.push(root)
  const skillFile = path.join(root, "plugins", "jianying-editor", "skills", "jianying-editor", "SKILL.md")
  await fs.mkdir(path.dirname(skillFile), { recursive: true })
  await fs.writeFile(skillFile, "---\nname: jianying-editor\n---\n")
  const manifest = {
    capabilities: [],
    contributes: { canvas: { renderer: { nodeKinds: ["integration.jianying"] } } },
    description: "JianYing",
    entry: "index.html",
    id: "jianying-editor",
    name: "JianYing",
    schema: "convax.plugin/1" as const,
    skill: "skills/jianying-editor/SKILL.md",
    version: "1.0.0",
  }
  const catalog = [
    {
      bundle: { files: { "index.html": "", "manifest.json": "{}", [manifest.skill]: "skill" } },
      companionSkillName: "jianying-editor",
      defaultInstall: true,
      defaultInstallCompanionSkill: true,
      manifest,
    },
  ] satisfies readonly DesktopBuiltinPluginBundle[]
  let installed = false
  let skillInstalled = false
  const pluginManager = {
    installOrUpdateBuiltinBundle: mock(async () => {
      installed = true
      return { ...manifest, trustedBuiltin: true as const }
    }),
    isBuiltinBundleInstalled: mock(async () => installed),
    list: mock(async () => (installed ? [{ ...manifest, trustedBuiltin: true as const }] : [])),
    resolveAsset: mock(async () => skillFile),
  }
  const skillManager = {
    installManagedAtStartup: mock(async () => {
      skillInstalled = true
      return {
        location: skillFile,
        management: { kind: "standalone" as const },
        managed: true,
        name: "jianying-editor",
        source: "managed" as const,
      }
    }),
    listManaged: mock(async () =>
      skillInstalled
        ? [
            {
              location: skillFile,
              management: { kind: "standalone" as const },
              managed: true,
              name: "jianying-editor",
              source: "managed" as const,
            },
          ]
        : [],
    ),
    refresh: mock(async () => undefined),
  }
  return {
    catalog,
    pluginManager,
    preparePluginPublication,
    removeInstalledPlugin: () => {
      installed = false
    },
    removeInstalledSkill: () => {
      skillInstalled = false
    },
    root,
    skillManager,
    stateFile: path.join(root, "default-capabilities.json"),
  }
}

async function setupRemote() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-default-remote-capabilities-"))
  temporaryRoots.push(root)
  const skillFile = path.join(root, "plugins", "ffmpeg-tools", "skills", "ffmpeg-canvas", "SKILL.md")
  await fs.mkdir(path.dirname(skillFile), { recursive: true })
  await fs.writeFile(skillFile, "---\nname: ffmpeg-canvas\n---\n")
  const manifest = {
    capabilities: [],
    contributes: { canvas: { renderer: { nodeKinds: ["integration.ffmpeg"] } } },
    description: "Local FFmpeg tools",
    entry: "index.html",
    id: "ffmpeg-tools",
    name: "FFmpeg Tools",
    schema: "convax.plugin/1" as const,
    skill: "skills/ffmpeg-canvas/SKILL.md",
    version: "1.0.0",
  }
  let installed = false
  let skillInstalled = false
  let installFailure: Error | undefined
  const events: string[] = []
  const pluginManager = {
    installOrUpdateBuiltinBundle: mock(async () => manifest),
    isBuiltinBundleInstalled: mock(async () => false),
    list: mock(async () => (installed ? [manifest] : [])),
    resolveAsset: mock(async () => skillFile),
  }
  const remoteInstaller = {
    installPlugin: mock(async () => {
      events.push("plugin.install")
      if (installFailure) throw installFailure
      installed = true
      return manifest
    }),
  }
  const skillManager = {
    installManagedAtStartup: mock(async () => {
      skillInstalled = true
      return {
        location: skillFile,
        management: { kind: "standalone" as const },
        managed: true,
        name: "ffmpeg-canvas",
        source: "managed" as const,
      }
    }),
    listManaged: mock(async () =>
      skillInstalled
        ? [
            {
              location: skillFile,
              management: { kind: "standalone" as const },
              managed: true,
              name: "ffmpeg-canvas",
              source: "managed" as const,
            },
          ]
        : [],
    ),
    refresh: mock(async () => {
      events.push("skills.refresh")
    }),
  }
  return {
    catalog: [],
    events,
    failInstall(error?: Error) {
      installFailure = error
    },
    markPluginInstalled() {
      installed = true
    },
    pluginManager,
    preparePluginPublication,
    remote: {
      catalog: desktopDefaultRemoteCapabilityCatalog,
      installer: remoteInstaller,
    },
    remoteInstaller,
    removeInstalledPlugin() {
      installed = false
    },
    removeInstalledSkill() {
      skillInstalled = false
    },
    root,
    skillManager,
    stateFile: path.join(root, "default-capabilities.json"),
  }
}

describe("provisionDefaultCapabilities", () => {
  test("installs each default Plugin and companion Skill once, preserving later user removal", async () => {
    const input = await setup()
    await provisionDefaultCapabilities(input)
    expect(input.pluginManager.installOrUpdateBuiltinBundle).toHaveBeenCalledTimes(1)
    expect(input.skillManager.installManagedAtStartup).toHaveBeenCalledTimes(1)
    expect(input.skillManager.refresh).toHaveBeenCalledTimes(1)
    expect(JSON.parse(await fs.readFile(input.stateFile, "utf8"))).toEqual({
      plugins: ["jianying-editor"],
      schema: "convax.default-capabilities/1",
      skills: ["jianying-editor"],
    })

    input.removeInstalledPlugin()
    input.removeInstalledSkill()
    await provisionDefaultCapabilities(input)
    expect(input.pluginManager.installOrUpdateBuiltinBundle).toHaveBeenCalledTimes(1)
    expect(input.skillManager.installManagedAtStartup).toHaveBeenCalledTimes(1)
    expect(input.skillManager.refresh).toHaveBeenCalledTimes(2)
  })

  test("fails closed on a corrupt receipt instead of silently reinstalling removed capabilities", async () => {
    const input = await setup()
    await fs.writeFile(input.stateFile, "not-json")
    await expect(provisionDefaultCapabilities(input)).rejects.toThrow("invalid JSON")
    expect(input.pluginManager.installOrUpdateBuiltinBundle).not.toHaveBeenCalled()
    expect(input.skillManager.refresh).toHaveBeenCalledTimes(1)
  })

  test("installs the default remote Plugin without separately provisioning an owned Skill", async () => {
    const input = await setupRemote()

    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })

    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(1)
    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledWith("ffmpeg-tools")
    expect(input.pluginManager.resolveAsset).not.toHaveBeenCalled()
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
    expect(input.skillManager.refresh).toHaveBeenCalledTimes(1)
    expect(input.events).toEqual(["plugin.install", "skills.refresh"])
    expect(JSON.parse(await fs.readFile(input.stateFile, "utf8"))).toEqual({
      plugins: ["ffmpeg-tools"],
      schema: "convax.default-capabilities/1",
      skills: [],
    })
  })

  test("keeps a present default remote Plugin current on later startups", async () => {
    const input = await setupRemote()
    await provisionDefaultCapabilities(input)

    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })

    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(2)
    expect(input.remoteInstaller.installPlugin).toHaveBeenLastCalledWith("ffmpeg-tools", { allowCurrent: true })
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
  })

  test("verifies and repairs a pre-existing same-id package before recording the default receipt", async () => {
    const input = await setupRemote()
    input.markPluginInstalled()

    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })

    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledWith("ffmpeg-tools", { allowCurrent: true })
    expect(JSON.parse(await fs.readFile(input.stateFile, "utf8"))).toMatchObject({ plugins: ["ffmpeg-tools"] })
  })

  test("keeps remote Plugin removal durable without managing an owned Skill separately", async () => {
    const input = await setupRemote()
    await provisionDefaultCapabilities(input)

    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })
    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(2)
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()

    input.removeInstalledPlugin()
    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })
    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(2)
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
  })

  test("keeps an installed default usable when its silent update fails", async () => {
    const input = await setupRemote()
    await provisionDefaultCapabilities(input)
    const failure = new Error("registry unavailable")
    input.failInstall(failure)

    expect(await provisionDefaultCapabilities(input)).toEqual({
      failures: [{ error: failure, id: "ffmpeg-tools", kind: "plugin" }],
    })
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
  })

  test("reports a remote failure without rejecting startup and retries while no receipt exists", async () => {
    const input = await setupRemote()
    const failure = new Error("registry unavailable")
    input.failInstall(failure)

    expect(await provisionDefaultCapabilities(input)).toEqual({
      failures: [{ error: failure, id: "ffmpeg-tools", kind: "plugin" }],
    })
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
    expect(await fs.readFile(input.stateFile, "utf8").catch((error: unknown) => error)).toMatchObject({
      code: "ENOENT",
    })

    input.failInstall()
    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })
    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(2)
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
  })

  test("does not downgrade a recovery-required Plugin publication into an ordinary default failure", async () => {
    const input = await setupRemote()
    const cause = new Error("package rollback failed")
    const deferred = new WebPluginPublicationDeferredError([cause], "Plugin publication requires startup recovery", {
      cause,
    })
    input.failInstall(deferred)

    await expect(provisionDefaultCapabilities(input)).rejects.toBe(deferred)
    expect(input.skillManager.refresh).not.toHaveBeenCalled()
    expect(await fs.readFile(input.stateFile, "utf8").catch((error: unknown) => error)).toMatchObject({
      code: "ENOENT",
    })
  })
})
