import { describe, expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ManagedAgentSkillStore } from "@convax/agent-runtime/node"
import { DesktopSkillManager } from "./skill-manager"

const skill = (name: string, description = "Test workflow") => [
  "---",
  `name: ${name}`,
  `description: ${description}`,
  "---",
  "",
  "Use existing tools.",
].join("\n")

async function fixture(globalSkills: Array<{ description?: string; location?: string; name: string }> = []) {
  const root = await mkdtemp(join(tmpdir(), "desktop-skill-manager-"))
  const store = new ManagedAgentSkillStore(join(root, "opencode"))
  const refreshSkills = mock(async () => undefined)
  const runtime = {
    listSkills: mock(async () => globalSkills),
    refreshSkills,
  }
  const manager = new DesktopSkillManager(store, runtime, root, [{
    description: "Built-in workflow",
    files: { "SKILL.md": skill("storyboard") },
    id: "storyboard",
    name: "Storyboard",
  }])
  return { manager, refreshSkills, root }
}

describe("DesktopSkillManager", () => {
  test("lists global Skills read-only and installs/uninstalls a catalog Skill", async () => {
    const setup = await fixture([{ description: "Global", location: "/global/SKILL.md", name: "global-skill" }])
    try {
      expect(await setup.manager.list()).toEqual({
        catalog: [{ description: "Built-in workflow", id: "storyboard", installed: false, name: "Storyboard" }],
        skills: [{
          description: "Global",
          location: "/global/SKILL.md",
          managed: false,
          name: "global-skill",
          source: "global",
        }],
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
})
