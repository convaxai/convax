import { describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ManagedAgentSkillStore } from "@convax/agent-runtime/node"
import { CapabilityPublicationRecoveryRequiredError } from "./capability-publication-error"
import { DesktopSkillManager } from "./skill-manager"
import { DesktopSkillMutationCoordinator } from "./skill-mutation-coordinator"
import type { PluginOwnedSkillBinding, PluginOwnedSkillReservationSource } from "./skill-manager"

const skill = (name: string, description = "Test workflow") =>
  ["---", `name: ${name}`, `description: ${description}`, "---", "", "Use existing tools."].join("\n")

async function fixture(
  globalSkills: Array<{ description?: string; location?: string; name: string }> = [],
  includePresentation = false,
) {
  const root = await mkdtemp(join(tmpdir(), "desktop-skill-manager-"))
  const store = new ManagedAgentSkillStore(join(root, "opencode"))
  let bindings: PluginOwnedSkillBinding[] = []
  const ownership: PluginOwnedSkillReservationSource & {
    write(next: readonly PluginOwnedSkillBinding[]): Promise<void>
  } = {
    async assertSettled() {},
    async reservations() {
      return bindings
    },
    async write(next) {
      bindings = [...next]
    },
  }
  const mutations = new DesktopSkillMutationCoordinator()
  const refreshSkills = mock(async () => undefined)
  const runtime = {
    listSkills: mock(async () => globalSkills),
    refreshSkills,
  }
  const presentations = includePresentation
    ? [
        {
          displayName: "Storyboard Showcase",
          id: "storyboard",
          showcase: {
            animation: {
              altText: "Storyboard animation",
              mimeType: "video/mp4" as const,
              path: join(root, "animation.mp4"),
            },
            poster: {
              altText: "Storyboard poster",
              mimeType: "image/png" as const,
              path: join(root, "poster.png"),
            },
          },
        },
      ]
    : []
  if (includePresentation) {
    await writeFile(join(root, "poster.png"), Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    await writeFile(join(root, "animation.mp4"), Uint8Array.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]))
  }
  const manager = new DesktopSkillManager(
    store,
    runtime,
    root,
    [
      {
        description: "Built-in workflow",
        files: { "SKILL.md": skill("storyboard"), "references/guide.md": "# Guide" },
        id: "storyboard",
        name: "Storyboard",
        version: "0.1.0",
      },
    ],
    presentations,
    ownership,
    mutations,
  )
  return { globalSkills, manager, mutations, ownership, refreshSkills, root, store }
}

describe("DesktopSkillManager", () => {
  test("publishes an externally committed inventory change without refreshing OpenCode", async () => {
    const setup = await fixture()
    const listener = mock(() => undefined)
    const unsubscribe = setup.manager.subscribe(listener)
    try {
      setup.manager.notifyInventoryChanged()

      expect(listener).toHaveBeenCalledTimes(1)
      expect(setup.refreshSkills).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("lists global Skills read-only and installs/uninstalls a catalog Skill", async () => {
    const setup = await fixture([{ description: "Global", location: "/global/SKILL.md", name: "global-skill" }])
    try {
      expect(await setup.manager.list()).toEqual({
        catalog: [{ description: "Built-in workflow", id: "storyboard", installed: false, name: "Storyboard" }],
        skills: [
          {
            description: "Global",
            location: "/global/SKILL.md",
            management: { kind: "standalone" },
            managed: false,
            name: "global-skill",
            source: "global",
          },
        ],
      })

      const installed = await setup.manager.installCatalogSkill("storyboard")
      expect(installed).toMatchObject({
        management: { kind: "standalone" },
        managed: true,
        name: "storyboard",
        source: "managed",
      })
      expect(setup.refreshSkills).toHaveBeenCalledTimes(1)
      expect(await setup.manager.list()).toMatchObject({
        catalog: [{ id: "storyboard", installed: true }],
        skills: expect.arrayContaining([expect.objectContaining({ name: "storyboard" })]),
      })

      expect(await setup.manager.uninstall("storyboard")).toBe(true)
      expect(await setup.manager.uninstall("storyboard")).toBe(false)
      expect(setup.refreshSkills).toHaveBeenCalledTimes(2)
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("rolls back a managed install that conflicts with a global Skill", async () => {
    const setup = await fixture([{ location: "/global/storyboard/SKILL.md", name: "storyboard" }])
    try {
      await expect(setup.manager.installCatalogSkill("storyboard")).rejects.toThrow("global Skill")
      expect(setup.refreshSkills).not.toHaveBeenCalled()
      expect((await setup.manager.list()).catalog[0]?.installed).toBe(false)
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("resolves only a discovered Skill name to its host-owned location", async () => {
    const setup = await fixture([
      { location: " /global/review/SKILL.md ", name: "review" },
      { name: "location-unavailable" },
    ])
    try {
      expect(await setup.manager.resolveSkillLocation(" review ")).toBe("/global/review/SKILL.md")
      await expect(setup.manager.resolveSkillLocation("missing")).rejects.toThrow("Skill was not found: missing")
      await expect(setup.manager.resolveSkillLocation("location-unavailable")).rejects.toThrow(
        "Skill location is unavailable: location-unavailable",
      )
      await expect(setup.manager.resolveSkillLocation("  ")).rejects.toThrow("Skill name is required")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("publishes changes after durable mutations", async () => {
    const setup = await fixture()
    try {
      const listener = mock(() => undefined)
      const dispose = setup.manager.subscribe(listener)
      await setup.manager.installCatalogSkill("storyboard")
      await setup.manager.uninstall("storyboard")
      dispose()
      await setup.manager.installCatalogSkill("storyboard")
      expect(listener).toHaveBeenCalledTimes(2)
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("replaces an existing managed Skill through the recoverable publication path", async () => {
    const setup = await fixture()
    try {
      await setup.manager.installFromFiles({
        "SKILL.md": skill("storyboard", "Old workflow"),
      })

      await expect(
        setup.manager.installFromFiles(
          {
            "SKILL.md": skill("storyboard", "Updated workflow"),
            "references/update.md": "# Updated",
          },
          undefined,
          "storyboard",
          true,
        ),
      ).resolves.toMatchObject({ description: "Updated workflow", name: "storyboard" })

      expect(await setup.store.inspect("storyboard")).toMatchObject({
        description: "Updated workflow",
        files: expect.arrayContaining([expect.objectContaining({ path: "references/update.md" })]),
      })
      expect(setup.refreshSkills).toHaveBeenCalledTimes(2)
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("retries after replacement bytes were published before Marketplace state committed", async () => {
    const setup = await fixture()
    try {
      await setup.store.installFromFiles({ "SKILL.md": skill("storyboard", "Old workflow") })
      const files = {
        "SKILL.md": skill("storyboard", "Recovered workflow"),
        "references/recovered.md": "# Recovered",
      }
      const interrupted = await setup.store.prepareInstallFromFiles(files, {
        expectedName: "storyboard",
        replaceExisting: true,
      })
      await interrupted.publish()

      await expect(setup.manager.installFromFiles(files, undefined, "storyboard", true, true)).resolves.toMatchObject({
        description: "Recovered workflow",
        name: "storyboard",
      })
      expect(await setup.store.inspect("storyboard")).toMatchObject({
        description: "Recovered workflow",
        files: expect.arrayContaining([expect.objectContaining({ path: "references/recovered.md" })]),
      })
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("recovery never overwrites an unrelated existing Skill with the same name", async () => {
    const setup = await fixture()
    try {
      await setup.store.installFromFiles({ "SKILL.md": skill("storyboard", "Unrelated workflow") })

      await expect(
        setup.manager.installFromFiles(
          { "SKILL.md": skill("storyboard", "Marketplace candidate") },
          undefined,
          "storyboard",
          true,
          true,
        ),
      ).rejects.toThrow("unrelated existing Skill")
      expect(await setup.store.inspect("storyboard")).toMatchObject({ description: "Unrelated workflow" })
      expect(setup.refreshSkills).not.toHaveBeenCalled()
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("signals recovery-required when published Skill rollback cannot be proven", async () => {
    const setup = await fixture()
    try {
      await setup.store.installFromFiles({ "SKILL.md": skill("storyboard", "Old workflow") })
      const prepare = setup.store.prepareInstallFromFiles.bind(setup.store)
      setup.store.prepareInstallFromFiles = mock(async (files, options) => {
        const publication = await prepare(files, options)
        return {
          ...publication,
          rollback: async () => {
            throw new Error("injected rollback failure")
          },
        }
      })
      setup.refreshSkills.mockRejectedValueOnce(new Error("injected refresh failure"))

      await expect(
        setup.manager.installFromFiles(
          { "SKILL.md": skill("storyboard", "Published but ambiguous workflow") },
          undefined,
          "storyboard",
          true,
        ),
      ).rejects.toBeInstanceOf(CapabilityPublicationRecoveryRequiredError)
      expect(await setup.store.inspect("storyboard")).toMatchObject({
        description: "Published but ambiguous workflow",
      })
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("serializes standalone mutations with a Plugin-owned Skill publication", async () => {
    const setup = await fixture()
    try {
      const release = await setup.mutations.acquire()
      let completed = false
      const install = setup.manager.installCatalogSkill("storyboard").then((result) => {
        completed = true
        return result
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(completed).toBe(false)
      expect(await setup.store.list()).toEqual([])

      release()
      await expect(install).resolves.toMatchObject({ name: "storyboard" })
      expect(completed).toBe(true)
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("labels Plugin-owned Skills and rejects independent uninstall", async () => {
    const setup = await fixture()
    try {
      await setup.store.installFromFiles({ "SKILL.md": skill("plugin-workflow", "Owned workflow") })
      await setup.ownership.write([
        {
          pluginId: "media-tools",
          pluginName: "Media Tools",
          pluginVersion: "1.2.0",
          skillName: "plugin-workflow",
          sourcePath: "skills/plugin-workflow",
          sourceSha256: "a".repeat(64),
        },
      ])

      expect((await setup.manager.list()).skills).toEqual([
        expect.objectContaining({
          management: {
            kind: "plugin",
            pluginId: "media-tools",
            pluginName: "Media Tools",
            pluginVersion: "1.2.0",
          },
          name: "plugin-workflow",
        }),
      ])
      await expect(setup.manager.uninstall("plugin-workflow")).rejects.toThrow("managed by Plugin Media Tools")
      expect((await setup.store.list()).map((entry) => entry.name)).toEqual(["plugin-workflow"])
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("rejects every standalone install path when an owned Skill binding survives missing bytes", async () => {
    const setup = await fixture()
    try {
      await setup.ownership.write([
        {
          pluginId: "media-tools",
          pluginName: "Media Tools",
          pluginVersion: "1.2.0",
          skillName: "storyboard",
          sourcePath: "skills/storyboard",
          sourceSha256: "a".repeat(64),
        },
      ])
      const source = join(setup.root, "standalone-source", "storyboard")
      await mkdir(source, { recursive: true })
      await writeFile(join(source, "SKILL.md"), skill("storyboard"))
      const attempts = [
        () => setup.manager.installManagedAtStartup(source),
        () => setup.manager.importFromDirectory(source),
        () => setup.manager.installFromFiles({ "SKILL.md": skill("storyboard") }),
        () => setup.manager.installCatalogSkill("storyboard"),
      ]

      for (const attempt of attempts) {
        await expect(attempt()).rejects.toThrow("managed by Plugin Media Tools")
        expect(await setup.store.list()).toEqual([])
      }
      expect(setup.refreshSkills).not.toHaveBeenCalled()
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("previews catalog, managed, and read-only global Skill directories", async () => {
    const globalSkills: Array<{ description?: string; location?: string; name: string }> = []
    const setup = await fixture(globalSkills)
    try {
      const globalDirectory = join(setup.root, "global-skill")
      await mkdir(join(globalDirectory, "references"), { recursive: true })
      await writeFile(join(globalDirectory, "SKILL.md"), skill("global-skill", "Global workflow"))
      await writeFile(join(globalDirectory, "references", "notes.md"), "# Global notes")
      globalSkills.push({
        description: "Global workflow",
        location: join(globalDirectory, "SKILL.md"),
        name: "global-skill",
      })
      await setup.manager.installFromFiles({
        "README.md": "# Managed notes",
        "SKILL.md": skill("managed-skill", "Managed workflow"),
      })

      expect(await setup.manager.getCatalogSkillDetails("storyboard")).toMatchObject({
        description: "Built-in workflow",
        files: [
          expect.objectContaining({ kind: "text", path: "references/guide.md" }),
          expect.objectContaining({ kind: "text", path: "SKILL.md" }),
        ],
        id: "storyboard",
        name: "Storyboard",
        version: "0.1.0",
      })
      expect(await setup.manager.getInstalledSkillDetails("managed-skill", "managed")).toMatchObject({
        description: "Managed workflow",
        files: [
          expect.objectContaining({ content: "# Managed notes", path: "README.md" }),
          expect.objectContaining({ path: "SKILL.md" }),
        ],
        id: "managed-skill",
      })
      expect(await setup.manager.getInstalledSkillDetails("global-skill", "global")).toMatchObject({
        description: "Global workflow",
        files: [
          expect.objectContaining({ path: "references/notes.md" }),
          expect.objectContaining({ path: "SKILL.md" }),
        ],
        id: "global-skill",
      })
      await expect(setup.manager.getInstalledSkillDetails("missing-skill", "global")).rejects.toThrow(
        "could not be resolved uniquely",
      )
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("serves only validated bounded built-in showcase assets", async () => {
    const setup = await fixture([], true)
    try {
      expect((await setup.manager.list()).skills).toEqual([])
      await setup.manager.installCatalogSkill("storyboard")
      expect((await setup.manager.list()).skills[0]).toMatchObject({
        displayName: "Storyboard Showcase",
        name: "storyboard",
      })
      await expect(setup.manager.getBuiltinSkillShowcase("storyboard", "poster")).resolves.toEqual({
        altText: "Storyboard poster",
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        mimeType: "image/png",
        size: 8,
      })
      await expect(setup.manager.getBuiltinSkillShowcase("missing", "poster")).resolves.toBeNull()
      await writeFile(join(setup.root, "animation.mp4"), "not an mp4")
      await expect(setup.manager.getBuiltinSkillShowcase("storyboard", "animation")).rejects.toThrow("invalid bytes")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })
})
