import { inspectAgentSkillDirectory, ManagedAgentSkillStore } from "@convax/agent-runtime/node"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import type { WebPluginPublicationCandidate } from "./plugin-manager"
import {
  composePluginPublicationTransactions,
  DesktopSkillMutationCoordinator,
  PluginSkillLifecycle,
  PluginSkillOwnershipStore,
} from "./plugin-skill-lifecycle"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

const skillDocument = (name: string, description: string) =>
  ["---", `name: ${name}`, `description: ${description}`, "---", "", "Follow the owned workflow."].join("\n")

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-skill-lifecycle-"))
  temporaryRoots.push(root)
  const skills = new ManagedAgentSkillStore(path.join(root, "opencode"))
  const ownershipFile = path.join(root, "plugin-owned-skills.json")
  const ownership = new PluginSkillOwnershipStore(ownershipFile)
  let discoveredSkills: Array<{ description?: string; location?: string; name: string }> = []
  return {
    lifecycle: new PluginSkillLifecycle(
      skills,
      ownership,
      async () => discoveredSkills,
      new DesktopSkillMutationCoordinator(),
    ),
    ownership,
    ownershipFile,
    root,
    setDiscoveredSkills(value: typeof discoveredSkills) {
      discoveredSkills = value
    },
    skills,
  }
}

async function candidate(
  root: string,
  declarations: Readonly<Record<string, { description: string; marker?: string }>>,
): Promise<WebPluginPublicationCandidate> {
  const candidates = path.join(root, "candidates")
  await fs.mkdir(candidates, { recursive: true })
  const packageRoot = await fs.mkdtemp(path.join(candidates, "package-"))
  for (const [name, declaration] of Object.entries(declarations)) {
    const directory = path.join(packageRoot, "skills", name)
    await fs.mkdir(path.join(directory, "references"), { recursive: true })
    await fs.writeFile(path.join(directory, "SKILL.md"), skillDocument(name, declaration.description))
    await fs.writeFile(path.join(directory, "references", "version.txt"), declaration.marker ?? declaration.description)
  }
  return { root: packageRoot }
}

function plugin(id: string, version: string, skillNames: readonly string[]): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: {
      generation: {
        models: [],
        tools: [
          {
            acceptedInputs: [],
            description: "A test operation that keeps the v4 Plugin independently useful",
            id: "test.operation",
            output: "text",
            title: "Test operation",
          },
        ],
      },
      skills: skillNames.map((name) => ({ name, path: `skills/${name}` })),
    },
    description: `Plugin ${id}`,
    id,
    name: id
      .split("-")
      .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
      .join(" "),
    runtime: { command: `${id}-mcp`, type: "mcp-stdio" },
    schema: "convax.plugin/4",
    version,
  }
}

function legacyPlugin(id: string, version: string, skillName: string): InstalledWebPluginSummary {
  const current = plugin(id, version, [])
  return {
    ...current,
    schema: "convax.plugin/3",
    skill: `skills/${skillName}/SKILL.md`,
  }
}

async function install(
  lifecycle: PluginSkillLifecycle,
  installedPlugin: InstalledWebPluginSummary,
  packageCandidate: WebPluginPublicationCandidate,
) {
  const transaction = await lifecycle.prepareInstall(installedPlugin, packageCandidate)
  await transaction.publish()
  await transaction.activate?.()
  await transaction.commit()
}

describe("PluginSkillLifecycle", () => {
  test("lets the package owner observe a composed rollback failure after a later publish fails", async () => {
    const first = {
      commit: async () => undefined,
      publish: mock(async () => undefined),
      rollback: mock(async () => {
        throw new Error("first rollback failed")
      }),
    }
    const second = {
      commit: async () => undefined,
      publish: mock(async () => {
        throw new Error("second publish failed")
      }),
      rollback: mock(async () => undefined),
    }
    const publication = composePluginPublicationTransactions([first, second])

    await expect(publication.publish()).rejects.toThrow("second publish failed")
    expect(first.rollback).not.toHaveBeenCalled()
    await expect(publication.rollback()).rejects.toThrow("Plugin publication rollback failed")
    expect(first.rollback).toHaveBeenCalledTimes(1)
    expect(second.rollback).toHaveBeenCalledTimes(1)
  })

  test("publishes an owned Skill with durable Plugin ownership", async () => {
    const setup = await fixture()
    const packageCandidate = await candidate(setup.root, {
      "media-workflow": { description: "Original media workflow", marker: "v1" },
    })
    const transaction = await setup.lifecycle.prepareInstall(
      plugin("media-tools", "1.0.0", ["media-workflow"]),
      packageCandidate,
    )

    expect(await setup.skills.list()).toEqual([])
    expect(await setup.ownership.list()).toEqual([])

    await transaction.publish()
    expect(await setup.skills.list()).toEqual([])
    expect(await setup.ownership.list()).toEqual([])

    await transaction.activate?.()
    expect((await setup.skills.inspect("media-workflow")).description).toBe("Original media workflow")
    expect((await setup.ownership.list())[0]).toMatchObject({ pluginId: "media-tools" })

    await transaction.commit()
    const persisted = await new PluginSkillOwnershipStore(setup.ownershipFile).list()
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      pluginId: "media-tools",
      pluginName: "Media Tools",
      pluginVersion: "1.0.0",
      skillName: "media-workflow",
      sourcePath: "skills/media-workflow",
    })
    expect(persisted[0]!.sourceSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.parse(await fs.readFile(setup.ownershipFile, "utf8"))).toMatchObject({
      schema: "convax.plugin-owned-skills/1",
    })
  })

  test("treats ownership.begin as committed after rename even when temporary cleanup fails", async () => {
    const setup = await fixture()
    const transaction = await setup.lifecycle.prepareInstall(
      plugin("journal-tools", "1.0.0", ["journal-workflow"]),
      await candidate(setup.root, {
        "journal-workflow": { description: "Journal workflow" },
      }),
    )
    const originalRm = fs.rm.bind(fs)
    let injectedFailures = 0
    const rm = spyOn(fs, "rm").mockImplementation(async (target, options) => {
      const targetPath = String(target)
      if (targetPath.startsWith(`${setup.ownershipFile}.`) && targetPath.endsWith(".tmp")) {
        const state = JSON.parse(await fs.readFile(setup.ownershipFile, "utf8")) as {
          bindings: unknown[]
          pending?: unknown
        }
        if (state.pending && state.bindings.length === 0) {
          injectedFailures += 1
          throw new Error("simulated ownership.begin temporary cleanup failure")
        }
      }
      return originalRm(target, options)
    })
    try {
      await expect(transaction.publish()).resolves.toBeUndefined()
      expect((await setup.ownership.read()).pending).toBeDefined()
      await transaction.rollback()
    } finally {
      rm.mockRestore()
    }

    expect(injectedFailures).toBe(1)
    expect((await setup.ownership.read()).pending).toBeUndefined()
    expect(await setup.skills.list()).toEqual([])
  })

  test("keeps a durable commit decision when its temporary cleanup fails", async () => {
    const setup = await fixture()
    const delegate = setup.skills
    const faultingStore = {
      cleanupAbandonedPublications: (...args: Parameters<typeof delegate.cleanupAbandonedPublications>) =>
        delegate.cleanupAbandonedPublications(...args),
      inspect: (...args: Parameters<typeof delegate.inspect>) => delegate.inspect(...args),
      isManagedLocation: (...args: Parameters<typeof delegate.isManagedLocation>) =>
        delegate.isManagedLocation(...args),
      list: (...args: Parameters<typeof delegate.list>) => delegate.list(...args),
      prepareInstallFromFiles: async (...args: Parameters<typeof delegate.prepareInstallFromFiles>) => {
        const transaction = await delegate.prepareInstallFromFiles(...args)
        return {
          ...transaction,
          async commit() {
            throw new Error("simulated managed Skill cleanup failure")
          },
        }
      },
      prepareUninstall: (...args: Parameters<typeof delegate.prepareUninstall>) => delegate.prepareUninstall(...args),
      recoverPublication: (...args: Parameters<typeof delegate.recoverPublication>) =>
        delegate.recoverPublication(...args),
    }
    const lifecycle = new PluginSkillLifecycle(
      faultingStore,
      setup.ownership,
      async () => [],
      new DesktopSkillMutationCoordinator(),
    )
    const installedPlugin = plugin("decision-tools", "1.0.0", ["decision-workflow"])
    const packageCandidate = await candidate(setup.root, {
      "decision-workflow": { description: "Decision workflow" },
    })
    const transaction = await lifecycle.prepareInstall(installedPlugin, packageCandidate)
    await transaction.publish()
    await transaction.activate?.()

    const originalRm = fs.rm.bind(fs)
    let injectedFailures = 0
    const rm = spyOn(fs, "rm").mockImplementation(async (target, options) => {
      const targetPath = String(target)
      if (targetPath.startsWith(`${setup.ownershipFile}.`) && targetPath.endsWith(".tmp")) {
        const state = JSON.parse(await fs.readFile(setup.ownershipFile, "utf8")) as {
          pending?: { decision?: string }
        }
        if (state.pending?.decision === "commit") {
          injectedFailures += 1
          throw new Error("simulated commit-decision temporary cleanup failure")
        }
      }
      return originalRm(target, options)
    })
    try {
      await expect(transaction.commit()).resolves.toBeUndefined()
      expect((await setup.ownership.read()).pending?.decision).toBe("commit")
      await transaction.rollback()
    } finally {
      rm.mockRestore()
    }

    expect(injectedFailures).toBe(1)
    const restarted = new PluginSkillLifecycle(
      setup.skills,
      setup.ownership,
      async () => [],
      new DesktopSkillMutationCoordinator(),
    )
    await restarted.reconcileAll([installedPlugin], async (_pluginId, relativePath) =>
      path.join(packageCandidate.root, ...relativePath.split("/")),
    )
    expect((await setup.ownership.read()).pending).toBeUndefined()
    expect((await setup.ownership.list())[0]).toMatchObject({
      pluginId: "decision-tools",
      skillName: "decision-workflow",
    })
    expect((await setup.skills.inspect("decision-workflow")).description).toBe("Decision workflow")
  })

  test("updates a Skill for the same owner and restores the old bytes and binding on rollback", async () => {
    const setup = await fixture()
    await install(
      setup.lifecycle,
      plugin("media-tools", "1.0.0", ["media-workflow"]),
      await candidate(setup.root, {
        "media-workflow": { description: "Original media workflow", marker: "v1" },
      }),
    )
    const originalBinding = (await setup.ownership.list())[0]!

    const updatedPlugin = plugin("media-tools", "2.0.0", ["media-workflow"])
    const updatedCandidate = await candidate(setup.root, {
      "media-workflow": { description: "Updated media workflow", marker: "v2" },
    })
    const rolledBack = await setup.lifecycle.prepareInstall(updatedPlugin, updatedCandidate)
    await rolledBack.publish()
    expect((await setup.skills.inspect("media-workflow")).description).toBe("Original media workflow")
    expect((await setup.ownership.list())[0]).toEqual(originalBinding)

    await rolledBack.rollback()
    expect((await setup.skills.inspect("media-workflow")).description).toBe("Original media workflow")
    expect(
      await fs.readFile(path.join(setup.skills.userDirectory, "media-workflow", "references", "version.txt"), "utf8"),
    ).toBe("v1")
    expect((await setup.ownership.list())[0]).toEqual(originalBinding)

    const committed = await setup.lifecycle.prepareInstall(updatedPlugin, updatedCandidate)
    await committed.publish()
    await committed.activate?.()
    await committed.commit()
    const updatedBinding = (await setup.ownership.list())[0]!
    expect((await setup.skills.inspect("media-workflow")).description).toBe("Updated media workflow")
    expect(updatedBinding).toMatchObject({ pluginId: "media-tools", pluginVersion: "2.0.0" })
    expect(updatedBinding.sourceSha256).not.toBe(originalBinding.sourceSha256)
  })

  test("removes every Skill owned by an uninstalled Plugin and can roll the removal back", async () => {
    const setup = await fixture()
    const installedPlugin = plugin("media-tools", "1.0.0", ["image-workflow", "video-workflow"])
    await install(
      setup.lifecycle,
      installedPlugin,
      await candidate(setup.root, {
        "image-workflow": { description: "Image workflow" },
        "video-workflow": { description: "Video workflow" },
      }),
    )
    const originalBindings = await setup.ownership.list()

    const rolledBack = await setup.lifecycle.prepareUninstall(installedPlugin)
    await rolledBack.publish()
    expect((await setup.skills.list()).map((skill) => skill.name)).toEqual(["image-workflow", "video-workflow"])
    expect(await setup.ownership.list()).toEqual(originalBindings)

    await rolledBack.rollback()
    expect((await setup.skills.list()).map((skill) => skill.name)).toEqual(["image-workflow", "video-workflow"])
    expect(await setup.ownership.list()).toEqual(originalBindings)

    const committed = await setup.lifecycle.prepareUninstall(installedPlugin)
    await committed.publish()
    await committed.activate?.()
    await committed.commit()
    expect(await setup.skills.list()).toEqual([])
    expect(await setup.ownership.list()).toEqual([])
  })

  test("rejects collisions with a standalone Skill or a Skill owned by another Plugin", async () => {
    const setup = await fixture()
    await setup.skills.installFromFiles({
      "SKILL.md": skillDocument("standalone-workflow", "Standalone workflow"),
    })

    await expect(
      setup.lifecycle.prepareInstall(
        plugin("first-tools", "1.0.0", ["standalone-workflow"]),
        await candidate(setup.root, {
          "standalone-workflow": { description: "Plugin workflow" },
        }),
      ),
    ).rejects.toThrow("standalone managed Skill")
    expect((await setup.skills.inspect("standalone-workflow")).description).toBe("Standalone workflow")
    expect(await setup.ownership.list()).toEqual([])

    await install(
      setup.lifecycle,
      plugin("first-tools", "1.0.0", ["owned-workflow"]),
      await candidate(setup.root, {
        "owned-workflow": { description: "First owner workflow" },
      }),
    )
    const firstOwnerBinding = (await setup.ownership.list())[0]!

    await expect(
      setup.lifecycle.prepareInstall(
        plugin("second-tools", "1.0.0", ["owned-workflow"]),
        await candidate(setup.root, {
          "owned-workflow": { description: "Second owner workflow" },
        }),
      ),
    ).rejects.toThrow("owned by another Plugin")
    expect((await setup.skills.inspect("owned-workflow")).description).toBe("First owner workflow")
    expect((await setup.ownership.list())[0]).toEqual(firstOwnerBinding)
  })

  test("adopts only an exact legacy companion Skill during a v3 to v4 update", async () => {
    const setup = await fixture()
    const previousCandidate = await candidate(setup.root, {
      "legacy-workflow": { description: "Legacy workflow", marker: "legacy" },
    })
    const previousInspection = await inspectAgentSkillDirectory(
      path.join(previousCandidate.root, "skills", "legacy-workflow"),
    )
    await setup.skills.installFromFiles(
      Object.fromEntries(previousInspection.files.map((file) => [file.path, file.content])),
    )
    const nextCandidate = await candidate(setup.root, {
      "legacy-workflow": { description: "Owned workflow", marker: "owned" },
    })

    await install(setup.lifecycle, plugin("legacy-tools", "2.0.0", ["legacy-workflow"]), {
      previous: {
        plugin: legacyPlugin("legacy-tools", "1.0.0", "legacy-workflow"),
        root: previousCandidate.root,
      },
      root: nextCandidate.root,
    })

    expect((await setup.skills.inspect("legacy-workflow")).description).toBe("Owned workflow")
    expect((await setup.ownership.list())[0]).toMatchObject({
      pluginId: "legacy-tools",
      pluginVersion: "2.0.0",
      skillName: "legacy-workflow",
    })

    const mismatch = await fixture()
    await mismatch.skills.installFromFiles({
      "SKILL.md": skillDocument("legacy-workflow", "User-authored standalone workflow"),
    })
    await expect(
      mismatch.lifecycle.prepareInstall(plugin("legacy-tools", "2.0.0", ["legacy-workflow"]), {
        previous: {
          plugin: legacyPlugin("legacy-tools", "1.0.0", "legacy-workflow"),
          root: previousCandidate.root,
        },
        root: nextCandidate.root,
      }),
    ).rejects.toThrow("standalone managed Skill")
    expect((await mismatch.skills.inspect("legacy-workflow")).description).toBe("User-authored standalone workflow")
  })

  test("forwards an exact v3 to v4 adoption when the Plugin package survived a crash", async () => {
    for (const activateBeforeCrash of [false, true]) {
      const setup = await fixture()
      const previousCandidate = await candidate(setup.root, {
        "legacy-workflow": { description: "Legacy workflow", marker: "legacy" },
      })
      const previousInspection = await inspectAgentSkillDirectory(
        path.join(previousCandidate.root, "skills", "legacy-workflow"),
      )
      await setup.skills.installFromFiles(
        Object.fromEntries(previousInspection.files.map((file) => [file.path, file.content])),
      )
      const nextCandidate = await candidate(setup.root, {
        "legacy-workflow": { description: "Owned workflow", marker: "owned" },
      })
      const nextPlugin = plugin("legacy-tools", "2.0.0", ["legacy-workflow"])
      const interrupted = await setup.lifecycle.prepareInstall(nextPlugin, {
        previous: {
          plugin: legacyPlugin("legacy-tools", "1.0.0", "legacy-workflow"),
          root: previousCandidate.root,
        },
        root: nextCandidate.root,
      })
      await interrupted.publish()
      if (activateBeforeCrash) await interrupted.activate?.()

      const restarted = new PluginSkillLifecycle(
        setup.skills,
        setup.ownership,
        async () => [],
        new DesktopSkillMutationCoordinator(),
      )
      await restarted.reconcileAll([nextPlugin], async (_pluginId, relativePath) =>
        path.join(nextCandidate.root, ...relativePath.split("/")),
      )

      expect((await setup.skills.inspect("legacy-workflow")).description).toBe("Owned workflow")
      expect((await setup.ownership.read()).pending).toBeUndefined()
      expect((await setup.ownership.list())[0]).toMatchObject({
        pluginId: "legacy-tools",
        pluginVersion: "2.0.0",
        skillName: "legacy-workflow",
      })
    }
  })

  test("rejects external global collisions both during prepare and immediately before publication", async () => {
    const setup = await fixture()
    const packageCandidate = await candidate(setup.root, {
      "global-workflow": { description: "Plugin workflow" },
    })
    setup.setDiscoveredSkills([{ location: "/external/global-workflow/SKILL.md", name: "global-workflow" }])
    await expect(
      setup.lifecycle.prepareInstall(plugin("global-tools", "1.0.0", ["global-workflow"]), packageCandidate),
    ).rejects.toThrow("global Skill")

    setup.setDiscoveredSkills([])
    const transaction = await setup.lifecycle.prepareInstall(
      plugin("global-tools", "1.0.0", ["global-workflow"]),
      packageCandidate,
    )
    setup.setDiscoveredSkills([{ name: "global-workflow" }])
    await expect(transaction.publish()).rejects.toThrow("global Skill")
    await transaction.rollback()
    expect(await setup.ownership.list()).toEqual([])
    expect(await setup.skills.list()).toEqual([])

    setup.setDiscoveredSkills([])
    await install(setup.lifecycle, plugin("global-tools", "1.0.0", ["global-workflow"]), packageCandidate)
    setup.setDiscoveredSkills([{ location: "/external/global-workflow/SKILL.md", name: "global-workflow" }])
    await expect(
      setup.lifecycle.prepareInstall(
        plugin("global-tools", "2.0.0", ["global-workflow"]),
        await candidate(setup.root, {
          "global-workflow": { description: "Updated Plugin workflow" },
        }),
      ),
    ).rejects.toThrow("global Skill")
    expect((await setup.skills.inspect("global-workflow")).description).toBe("Plugin workflow")
  })

  test("recovers crashes before activation and after a durable commit decision", async () => {
    const setup = await fixture()
    const installedPlugin = plugin("crash-tools", "1.0.0", ["crash-workflow"])
    const packageCandidate = await candidate(setup.root, {
      "crash-workflow": { description: "Crash-safe workflow", marker: "safe" },
    })
    const beforeActivation = await setup.lifecycle.prepareInstall(installedPlugin, packageCandidate)
    await beforeActivation.publish()
    expect((await setup.ownership.read()).pending).toBeDefined()
    expect(await setup.skills.list()).toEqual([])

    const restartedBeforeActivation = new PluginSkillLifecycle(
      setup.skills,
      setup.ownership,
      async () => [],
      new DesktopSkillMutationCoordinator(),
    )
    await restartedBeforeActivation.reconcileAll([], async () => {
      throw new Error("No Plugin asset should be resolved")
    })
    expect((await setup.ownership.read()).pending).toBeUndefined()
    expect(await setup.skills.list()).toEqual([])

    const afterActivation = await restartedBeforeActivation.prepareInstall(installedPlugin, packageCandidate)
    await afterActivation.publish()
    await afterActivation.activate?.()
    const activatedState = await setup.ownership.read()
    const pending = activatedState.pending!
    await setup.ownership.advance(pending, pending.nextBindings, "commit")

    const restartedAfterDecision = new PluginSkillLifecycle(
      setup.skills,
      setup.ownership,
      async () => [],
      new DesktopSkillMutationCoordinator(),
    )
    await restartedAfterDecision.reconcileAll([installedPlugin], async (_pluginId, relativePath) =>
      path.join(packageCandidate.root, ...relativePath.split("/")),
    )
    expect((await setup.ownership.read()).pending).toBeUndefined()
    expect((await setup.ownership.list())[0]).toMatchObject({ pluginId: "crash-tools", pluginVersion: "1.0.0" })
    expect((await setup.skills.inspect("crash-workflow")).description).toBe("Crash-safe workflow")
    expect((await fs.readdir(setup.skills.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
  })

  test("finishes an uninstall selected by the absent Plugin package before or after Skill activation", async () => {
    for (const activateBeforeCrash of [false, true]) {
      const setup = await fixture()
      const installedPlugin = plugin("removed-tools", "1.0.0", ["removed-workflow"])
      await install(
        setup.lifecycle,
        installedPlugin,
        await candidate(setup.root, {
          "removed-workflow": { description: "Removed workflow" },
        }),
      )
      const interrupted = await setup.lifecycle.prepareUninstall(installedPlugin)
      await interrupted.publish()
      if (activateBeforeCrash) await interrupted.activate?.()

      const restarted = new PluginSkillLifecycle(
        setup.skills,
        setup.ownership,
        async () => [],
        new DesktopSkillMutationCoordinator(),
      )
      await restarted.reconcileAll([], async () => {
        throw new Error("An uninstalled Plugin has no resolvable asset")
      })

      expect(await setup.ownership.list()).toEqual([])
      expect((await setup.ownership.read()).pending).toBeUndefined()
      expect(await setup.skills.list()).toEqual([])
      expect((await fs.readdir(setup.skills.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
    }
  })

  test("retains the recovery journal when synchronous Skill rollback fails and retries it on startup", async () => {
    const setup = await fixture()
    const previousPlugin = plugin("rollback-tools", "1.0.0", ["rollback-workflow"])
    const previousCandidate = await candidate(setup.root, {
      "rollback-workflow": { description: "Previous workflow", marker: "previous" },
    })
    await install(setup.lifecycle, previousPlugin, previousCandidate)
    const delegate = setup.skills
    let failPublication = true
    const faultingStore = {
      cleanupAbandonedPublications: (...args: Parameters<typeof delegate.cleanupAbandonedPublications>) =>
        delegate.cleanupAbandonedPublications(...args),
      inspect: (...args: Parameters<typeof delegate.inspect>) => delegate.inspect(...args),
      isManagedLocation: (...args: Parameters<typeof delegate.isManagedLocation>) =>
        delegate.isManagedLocation(...args),
      list: (...args: Parameters<typeof delegate.list>) => delegate.list(...args),
      prepareInstallFromFiles: async (...args: Parameters<typeof delegate.prepareInstallFromFiles>) => {
        const transaction = await delegate.prepareInstallFromFiles(...args)
        if (!failPublication) return transaction
        failPublication = false
        return {
          ...transaction,
          async publish() {
            await transaction.publish()
            throw new Error("simulated post-rename publication failure")
          },
          async rollback() {
            throw new Error("simulated filesystem rollback failure")
          },
        }
      },
      prepareUninstall: (...args: Parameters<typeof delegate.prepareUninstall>) => delegate.prepareUninstall(...args),
      recoverPublication: (...args: Parameters<typeof delegate.recoverPublication>) =>
        delegate.recoverPublication(...args),
    }
    const interruptedLifecycle = new PluginSkillLifecycle(
      faultingStore,
      setup.ownership,
      async () => [],
      new DesktopSkillMutationCoordinator(),
    )
    const nextPlugin = plugin("rollback-tools", "2.0.0", ["rollback-workflow"])
    const publication = await interruptedLifecycle.prepareInstall(
      nextPlugin,
      await candidate(setup.root, {
        "rollback-workflow": { description: "Next workflow", marker: "next" },
      }),
    )
    await publication.publish()
    await expect(publication.activate?.()).rejects.toThrow("post-rename publication failure")
    await expect(publication.rollback()).rejects.toThrow("Plugin-owned Skill rollback failed")

    expect((await setup.ownership.read()).pending).toBeDefined()
    expect((await fs.readdir(setup.skills.userDirectory)).some((name) => name.startsWith(".install-backup-"))).toBe(
      true,
    )

    const restarted = new PluginSkillLifecycle(
      setup.skills,
      setup.ownership,
      async () => [],
      new DesktopSkillMutationCoordinator(),
    )
    await restarted.reconcileAll([previousPlugin], async (_pluginId, relativePath) =>
      path.join(previousCandidate.root, ...relativePath.split("/")),
    )
    expect((await setup.ownership.read()).pending).toBeUndefined()
    expect((await setup.skills.inspect("rollback-workflow")).description).toBe("Previous workflow")
    expect((await fs.readdir(setup.skills.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
  })

  test("defers a partial activation so the package-selected Plugin can finish every owned Skill", async () => {
    const setup = await fixture()
    const delegate = setup.skills
    let publications = 0
    const faultingStore = {
      cleanupAbandonedPublications: (...args: Parameters<typeof delegate.cleanupAbandonedPublications>) =>
        delegate.cleanupAbandonedPublications(...args),
      inspect: (...args: Parameters<typeof delegate.inspect>) => delegate.inspect(...args),
      isManagedLocation: (...args: Parameters<typeof delegate.isManagedLocation>) =>
        delegate.isManagedLocation(...args),
      list: (...args: Parameters<typeof delegate.list>) => delegate.list(...args),
      prepareInstallFromFiles: async (...args: Parameters<typeof delegate.prepareInstallFromFiles>) => {
        const transaction = await delegate.prepareInstallFromFiles(...args)
        return {
          ...transaction,
          async publish() {
            publications += 1
            if (publications === 2) throw new Error("simulated second Skill publication failure")
            await transaction.publish()
          },
        }
      },
      prepareUninstall: (...args: Parameters<typeof delegate.prepareUninstall>) => delegate.prepareUninstall(...args),
      recoverPublication: (...args: Parameters<typeof delegate.recoverPublication>) =>
        delegate.recoverPublication(...args),
    }
    const interrupted = new PluginSkillLifecycle(
      faultingStore,
      setup.ownership,
      async () => [],
      new DesktopSkillMutationCoordinator(),
    )
    const installedPlugin = plugin("partial-tools", "1.0.0", ["first-workflow", "second-workflow"])
    const packageCandidate = await candidate(setup.root, {
      "first-workflow": { description: "First workflow" },
      "second-workflow": { description: "Second workflow" },
    })
    const publication = await interrupted.prepareInstall(installedPlugin, packageCandidate)
    await publication.publish()
    await expect(publication.activate?.()).rejects.toThrow("second Skill publication failure")
    await publication.deferToRecovery?.()

    expect((await setup.ownership.read()).pending).toBeDefined()
    expect((await setup.skills.list()).map((skill) => skill.name)).toEqual(["first-workflow"])

    const restarted = new PluginSkillLifecycle(
      setup.skills,
      setup.ownership,
      async () => [],
      new DesktopSkillMutationCoordinator(),
    )
    await restarted.reconcileAll([installedPlugin], async (_pluginId, relativePath) =>
      path.join(packageCandidate.root, ...relativePath.split("/")),
    )
    expect((await setup.skills.list()).map((skill) => skill.name)).toEqual(["first-workflow", "second-workflow"])
    expect((await setup.ownership.list()).map((binding) => binding.skillName)).toEqual([
      "first-workflow",
      "second-workflow",
    ])
    expect((await setup.ownership.read()).pending).toBeUndefined()
    expect((await fs.readdir(setup.skills.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
  })

  test("reconciliation removes the last owned Skill when the installed Plugin declares none", async () => {
    const setup = await fixture()
    await install(
      setup.lifecycle,
      plugin("shrinking-tools", "1.0.0", ["removed-workflow"]),
      await candidate(setup.root, {
        "removed-workflow": { description: "Soon removed" },
      }),
    )

    await setup.lifecycle.reconcileAll([plugin("shrinking-tools", "2.0.0", [])], async () => {
      throw new Error("A Plugin without owned Skills must not resolve a Skill asset")
    })

    expect(await setup.skills.list()).toEqual([])
    expect(await setup.ownership.list()).toEqual([])
  })
})
