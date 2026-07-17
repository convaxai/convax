import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import { provisionDefaultCapabilities } from "./default-capability-provisioner"

const temporaryRoots: string[] = []

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
      return { location: skillFile, managed: true, name: "jianying-editor", source: "managed" as const }
    }),
    listManaged: mock(async () => (
      skillInstalled
        ? [{ location: skillFile, managed: true, name: "jianying-editor", source: "managed" as const }]
        : []
    )),
  }
  return {
    catalog,
    pluginManager,
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

describe("provisionDefaultCapabilities", () => {
  test("installs each default Plugin and companion Skill once, preserving later user removal", async () => {
    const input = await setup()
    await provisionDefaultCapabilities(input)
    expect(input.pluginManager.installOrUpdateBuiltinBundle).toHaveBeenCalledTimes(1)
    expect(input.skillManager.installManagedAtStartup).toHaveBeenCalledTimes(1)
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
  })

  test("fails closed on a corrupt receipt instead of silently reinstalling removed capabilities", async () => {
    const input = await setup()
    await fs.writeFile(input.stateFile, "not-json")
    await expect(provisionDefaultCapabilities(input)).rejects.toThrow("invalid JSON")
    expect(input.pluginManager.installOrUpdateBuiltinBundle).not.toHaveBeenCalled()
  })
})
