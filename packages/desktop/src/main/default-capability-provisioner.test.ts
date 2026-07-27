import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import { provisionDefaultCapabilities } from "./default-capability-provisioner"
import { desktopDefaultRemoteCapabilityCatalog } from "./default-remote-capability-catalog"
import { WebPluginPublicationDeferredError, type WebPluginManager } from "./plugin-manager"

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
  const skillFile = path.join(root, "plugins", "director-stage", "skills", "director-workflow", "SKILL.md")
  await fs.mkdir(path.dirname(skillFile), { recursive: true })
  await fs.writeFile(skillFile, "---\nname: director-workflow\n---\n")
  const manifest = {
    capabilities: [],
    contributes: { canvas: { renderer: { nodeKinds: ["director.stage"] } } },
    description: "Director Stage",
    entry: "index.html",
    id: "director-stage",
    name: "Director Stage",
    schema: "convax.plugin/1" as const,
    skill: "skills/director-workflow/SKILL.md",
    version: "1.0.0",
  }
  const catalog = [
    {
      bundle: { files: { "index.html": "", "manifest.json": "{}", [manifest.skill]: "skill" } },
      companionSkillName: "director-workflow",
      defaultInstall: true,
      defaultInstallCompanionSkill: true,
      manifest,
    },
  ] satisfies readonly DesktopBuiltinPluginBundle[]
  let installed = false
  let skillInstalled = false
  let publicationManifest: InstalledWebPluginSummary = { ...manifest, trustedBuiltin: true }
  const pluginManager = {
    installOrUpdateBuiltinBundle: mock(
      async (...args: Parameters<WebPluginManager["installOrUpdateBuiltinBundle"]>) => {
        const publication = await args[1]?.beforePublish?.(publicationManifest, { root })
        await publication?.publish()
        await publication?.activate?.()
        await publication?.commit()
        installed = true
        return publicationManifest
      },
    ),
    isBuiltinBundleInstalled: mock(async () => installed),
    list: mock(async () => (installed ? [publicationManifest] : [])),
    resolveAsset: mock(async () => skillFile),
  }
  const skillManager = {
    installManagedAtStartup: mock(async () => {
      skillInstalled = true
      return {
        location: skillFile,
        management: { kind: "standalone" as const },
        managed: true,
        name: "director-workflow",
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
              name: "director-workflow",
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
    setPublicationHooks(hooks?: string) {
      publicationManifest = {
        ...manifest,
        ...(hooks === undefined ? {} : { hooks }),
        trustedBuiltin: true,
      }
    },
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
  let bootstrapInstallFailure: Error | undefined
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
    updatePlugin: mock(async () => {
      events.push("plugin.update")
      if (installFailure) throw installFailure
      if (!installed) throw new Error("Remote Plugin update requires an installed Plugin: ffmpeg-tools")
      return manifest
    }),
  }
  const bootstrapInstaller = {
    installPlugin: mock(async () => {
      events.push("plugin.bootstrap")
      if (bootstrapInstallFailure) throw bootstrapInstallFailure
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
    bootstrapInstaller,
    catalog: [],
    events,
    failBootstrapInstall(error?: Error) {
      bootstrapInstallFailure = error
    },
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
      plugins: ["director-stage"],
      schema: "convax.default-capabilities/1",
      skills: ["director-workflow"],
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

  test("does not silently authorize Hook bytes during default provisioning", async () => {
    const input = await setup()
    const item = input.catalog[0]!
    const result = await provisionDefaultCapabilities({
      ...input,
      catalog: [
        {
          ...item,
          manifest: { ...item.manifest, hooks: "hooks/index.mjs" },
        },
      ],
    })

    expect(result.failures).toEqual([
      {
        error: expect.objectContaining({ message: expect.stringContaining("explicit user action") }),
        id: "director-stage",
        kind: "plugin",
      },
    ])
    expect(input.pluginManager.installOrUpdateBuiltinBundle).not.toHaveBeenCalled()
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
  })

  test("checks the parsed built-in candidate instead of trusting Hook-free catalog metadata", async () => {
    const input = await setup()
    input.setPublicationHooks("hooks/index.mjs")
    const prepare = mock(preparePluginPublication)

    await expect(
      provisionDefaultCapabilities({
        ...input,
        preparePluginPublication: prepare,
      }),
    ).rejects.toThrow("requires an explicit user action")

    expect(prepare).not.toHaveBeenCalled()
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
  })

  test("installs the default remote Plugin without separately provisioning an owned Skill", async () => {
    const input = await setupRemote()

    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })

    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(1)
    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledWith("ffmpeg-tools", { allowHooks: false })
    expect(input.remoteInstaller.updatePlugin).not.toHaveBeenCalled()
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

  test("installs a missing default from a verified bootstrap seed and records its receipt", async () => {
    const input = await setupRemote()

    expect(
      await provisionDefaultCapabilities({
        ...input,
        remote: { ...input.remote, bootstrapInstaller: input.bootstrapInstaller, mode: "bootstrap" },
      }),
    ).toEqual({ failures: [] })

    expect(input.bootstrapInstaller.installPlugin).toHaveBeenCalledTimes(1)
    expect(input.bootstrapInstaller.installPlugin).toHaveBeenCalledWith("ffmpeg-tools", { allowHooks: false })
    expect(input.remoteInstaller.installPlugin).not.toHaveBeenCalled()
    expect(input.remoteInstaller.updatePlugin).not.toHaveBeenCalled()
    expect(input.pluginManager.resolveAsset).not.toHaveBeenCalled()
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
    expect(input.events).toEqual(["plugin.bootstrap", "skills.refresh"])
    expect(JSON.parse(await fs.readFile(input.stateFile, "utf8"))).toEqual({
      plugins: ["ffmpeg-tools"],
      schema: "convax.default-capabilities/1",
      skills: [],
    })
  })

  test("skips a missing default during bootstrap when no seed installer is available", async () => {
    const input = await setupRemote()

    expect(
      await provisionDefaultCapabilities({
        ...input,
        remote: { ...input.remote, mode: "bootstrap" },
      }),
    ).toEqual({ failures: [] })

    expect(input.bootstrapInstaller.installPlugin).not.toHaveBeenCalled()
    expect(input.remoteInstaller.installPlugin).not.toHaveBeenCalled()
    expect(input.remoteInstaller.updatePlugin).not.toHaveBeenCalled()
    expect(await fs.readFile(input.stateFile, "utf8").catch((error: unknown) => error)).toMatchObject({
      code: "ENOENT",
    })
  })

  test("reports a bootstrap seed failure without writing a default receipt or contacting the network", async () => {
    const input = await setupRemote()
    const failure = new Error("bootstrap seed is invalid")
    input.failBootstrapInstall(failure)

    expect(
      await provisionDefaultCapabilities({
        ...input,
        remote: { ...input.remote, bootstrapInstaller: input.bootstrapInstaller, mode: "bootstrap" },
      }),
    ).toEqual({ failures: [{ error: failure, id: "ffmpeg-tools", kind: "plugin" }] })

    expect(input.bootstrapInstaller.installPlugin).toHaveBeenCalledTimes(1)
    expect(input.remoteInstaller.installPlugin).not.toHaveBeenCalled()
    expect(input.remoteInstaller.updatePlugin).not.toHaveBeenCalled()
    expect(await fs.readFile(input.stateFile, "utf8").catch((error: unknown) => error)).toMatchObject({
      code: "ENOENT",
    })
  })

  test("does not contact either installer or adopt existing state during bootstrap", async () => {
    const installed = await setupRemote()
    installed.markPluginInstalled()

    expect(
      await provisionDefaultCapabilities({
        ...installed,
        remote: { ...installed.remote, bootstrapInstaller: installed.bootstrapInstaller, mode: "bootstrap" },
      }),
    ).toEqual({ failures: [] })
    expect(installed.bootstrapInstaller.installPlugin).not.toHaveBeenCalled()
    expect(installed.remoteInstaller.installPlugin).not.toHaveBeenCalled()
    expect(installed.remoteInstaller.updatePlugin).not.toHaveBeenCalled()
    expect(await fs.readFile(installed.stateFile, "utf8").catch((error: unknown) => error)).toMatchObject({
      code: "ENOENT",
    })

    const receipted = await setupRemote()
    await fs.writeFile(
      receipted.stateFile,
      `${JSON.stringify({ plugins: ["ffmpeg-tools"], schema: "convax.default-capabilities/1", skills: [] })}\n`,
    )

    expect(
      await provisionDefaultCapabilities({
        ...receipted,
        remote: { ...receipted.remote, bootstrapInstaller: receipted.bootstrapInstaller, mode: "bootstrap" },
      }),
    ).toEqual({ failures: [] })
    expect(receipted.bootstrapInstaller.installPlugin).not.toHaveBeenCalled()
    expect(receipted.remoteInstaller.installPlugin).not.toHaveBeenCalled()
    expect(receipted.remoteInstaller.updatePlugin).not.toHaveBeenCalled()
    expect(JSON.parse(await fs.readFile(receipted.stateFile, "utf8"))).toEqual({
      plugins: ["ffmpeg-tools"],
      schema: "convax.default-capabilities/1",
      skills: [],
    })
  })

  test("keeps a present default remote Plugin current on later startups", async () => {
    const input = await setupRemote()
    await provisionDefaultCapabilities(input)

    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })

    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(1)
    expect(input.remoteInstaller.updatePlugin).toHaveBeenCalledTimes(1)
    expect(input.remoteInstaller.updatePlugin).toHaveBeenCalledWith("ffmpeg-tools", { allowHooks: false })
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
  })

  test("verifies and repairs a pre-existing same-id package before recording the default receipt", async () => {
    const input = await setupRemote()
    input.markPluginInstalled()

    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })

    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledWith("ffmpeg-tools", {
      allowCurrent: true,
      allowHooks: false,
    })
    expect(input.remoteInstaller.updatePlugin).not.toHaveBeenCalled()
    expect(JSON.parse(await fs.readFile(input.stateFile, "utf8"))).toMatchObject({ plugins: ["ffmpeg-tools"] })
  })

  test("keeps remote Plugin removal durable without managing an owned Skill separately", async () => {
    const input = await setupRemote()
    await provisionDefaultCapabilities(input)

    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })
    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(1)
    expect(input.remoteInstaller.updatePlugin).toHaveBeenCalledTimes(1)
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()

    input.removeInstalledPlugin()
    expect(await provisionDefaultCapabilities(input)).toEqual({ failures: [] })
    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(1)
    expect(input.remoteInstaller.updatePlugin).toHaveBeenCalledTimes(1)
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
    expect(input.remoteInstaller.installPlugin).toHaveBeenCalledTimes(1)
    expect(input.remoteInstaller.updatePlugin).toHaveBeenCalledTimes(1)
    expect(input.skillManager.installManagedAtStartup).not.toHaveBeenCalled()
  })

  test("reports a remote failure without rejecting startup and retries while no receipt exists", async () => {
    const input = await setupRemote()
    const failure = new Error("registry unavailable")
    input.failInstall(failure)

    expect(await provisionDefaultCapabilities(input)).toEqual({
      failures: [{ error: failure, id: "ffmpeg-tools", kind: "plugin" }],
    })
    expect(input.remoteInstaller.updatePlugin).not.toHaveBeenCalled()
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
