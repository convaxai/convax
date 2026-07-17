import { describe, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ManagedAgentSkillStore } from "@convax/agent-runtime/node"
import { DesktopSkillManager } from "./skill-manager"

const skill = (name: string, description = "Test workflow") =>
  ["---", `name: ${name}`, `description: ${description}`, "---", "", "Use existing tools."].join("\n")

async function fixture(
  globalSkills: Array<{ description?: string; location?: string; name: string }> = [],
  includePresentation = false,
) {
  const root = await mkdtemp(join(tmpdir(), "desktop-skill-manager-"))
  const store = new ManagedAgentSkillStore(join(root, "opencode"))
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
  )
  return { globalSkills, manager, refreshSkills, root }
}

describe("DesktopSkillManager", () => {
  test("lists global Skills read-only and installs/uninstalls a catalog Skill", async () => {
    const setup = await fixture([{ description: "Global", location: "/global/SKILL.md", name: "global-skill" }])
    try {
      expect(await setup.manager.list()).toEqual({
        catalog: [{ description: "Built-in workflow", id: "storyboard", installed: false, name: "Storyboard" }],
        skills: [
          {
            description: "Global",
            location: "/global/SKILL.md",
            managed: false,
            name: "global-skill",
            source: "global",
          },
        ],
      })

      const installed = await setup.manager.installCatalogSkill("storyboard")
      expect(installed).toMatchObject({ managed: true, name: "storyboard", source: "managed" })
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
