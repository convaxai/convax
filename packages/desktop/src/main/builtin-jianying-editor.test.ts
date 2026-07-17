import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { jianyingBuiltinPluginId } from "../jianying-contracts"
import { desktopBuiltinPluginCatalog } from "./builtin-plugin-catalog"
import { WebPluginManager } from "./plugin-manager"

const resourceRoot = path.resolve(import.meta.dir, "..", "..", "resources")
const pluginRoot = path.join(resourceRoot, "plugins", "jianying-editor")
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("built-in JianYing Editor integration", () => {
  test("bundles a declarative Plugin and tool-only companion Skill", async () => {
    const item = desktopBuiltinPluginCatalog.find((candidate) => candidate.manifest.id === jianyingBuiltinPluginId)
    expect(item).toBeDefined()
    expect(item).toMatchObject({ defaultInstall: true, defaultInstallCompanionSkill: true })
    expect(item!.manifest).toMatchObject({
      capabilities: [],
      skill: "skills/jianying-editor/SKILL.md",
      version: "1.0.0",
    })
    const skill = await fs.readFile(path.join(pluginRoot, item!.manifest.skill!), "utf8")
    expect(skill).toContain("jianying_get_draft_status")
    expect(skill).toContain("ask the user")
    expect(skill).not.toMatch(/python3|```(?:bash|sh)/i)
    expect(await fs.readFile(path.join(pluginRoot, "LICENSE"), "utf8")).toContain("MIT License")
    expect(await fs.readFile(path.join(pluginRoot, "UPSTREAM.md"), "utf8")).toContain(
      "luoluoluo22/jianying-editor-skill",
    )
  })

  test("installs with the normal sandboxed Plugin manager and contains no native bridge", async () => {
    const item = desktopBuiltinPluginCatalog.find((candidate) => candidate.manifest.id === jianyingBuiltinPluginId)!
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-builtin-jianying-"))
    temporaryRoots.push(root)
    const manager = new WebPluginManager(path.join(root, "plugins"))
    await expect(manager.installOrUpdateBuiltinBundle(item.bundle)).resolves.toEqual({
      ...item.manifest,
      trustedBuiltin: true,
    })
    expect(Object.keys(item.bundle.files).sort()).toEqual([
      "LICENSE",
      "UPSTREAM.md",
      "index.html",
      "manifest.json",
      "skills/jianying-editor/SKILL.md",
    ])
    const staticBundle = Object.values(item.bundle.files).join("\n")
    expect(staticBundle).not.toMatch(
      /(?:contextBridge|ipcRenderer|require\(["']electron["']\)|osascript|System Events|AXPress|macos_import_media)/i,
    )
  })
})
