import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

const sourceRoot = import.meta.dir

async function productionSources(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await productionSources(resolved)))
    } else if (/\.(?:css|html|ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\.[^.]+$/.test(entry.name)) {
      files.push(resolved)
    }
  }
  return files
}

describe("pet feature ownership boundary", () => {
  test("keeps product rendering and packaged inventory outside the host", async () => {
    const legacyFiles = [
      "main/pet-controller.ts",
      "main/pet-controller.test.ts",
      "renderer/pet-settings.tsx",
      "renderer/pet-settings.test.tsx",
      "renderer/pet/index.html",
      "renderer/pet/index.tsx",
      "renderer/pet/pet-entry.test.ts",
      "renderer/pet/pet-view.tsx",
      "renderer/pet/pet-view.test.tsx",
      "renderer/pet/styles.css",
    ]

    for (const relativePath of legacyFiles) {
      await expect(fs.stat(path.join(sourceRoot, relativePath))).rejects.toMatchObject({ code: "ENOENT" })
    }

    const forbiddenFragments = [
      "Violet",
      "PetInventory",
      "PetRendererSnapshot",
      "PetSettingsContent",
      "petAnimations",
      '"pets.import"',
      '"pet:import-custom"',
      '"pet:delete-custom"',
    ]
    const sources = await productionSources(sourceRoot)
    const violations: string[] = []

    for (const file of sources) {
      const contents = await fs.readFile(file, "utf8")
      for (const fragment of forbiddenFragments) {
        if (contents.includes(fragment)) violations.push(`${path.relative(sourceRoot, file)}: ${fragment}`)
      }
    }

    expect(violations).toEqual([])
  })

  test("retains only the documented feature-plugin host composition", async () => {
    const expectedExports = new Map([
      ["main/agent-activity-controller.ts", "export class AgentActivityController"],
      ["main/custom-pet-store.ts", "export class CustomPetStore"],
      ["main/pet-asset-protocol.ts", 'export const petAssetScheme = "convax-pet-asset"'],
      ["main/pet-provider-controller.ts", "export class PetProviderController"],
      ["main/pet-window.ts", "export class PetWindow"],
      ["pet-contracts.ts", 'from "@convax/plugin-sdk/pet"'],
    ])

    for (const [relativePath, expected] of expectedExports) {
      expect(await fs.readFile(path.join(sourceRoot, relativePath), "utf8")).toContain(expected)
    }
  })

  test("uses the public SDK Pet protocol at every renderer boundary", async () => {
    const [contracts, preload, settings] = await Promise.all([
      fs.readFile(path.join(sourceRoot, "pet-contracts.ts"), "utf8"),
      fs.readFile(path.join(sourceRoot, "preload/pet.ts"), "utf8"),
      fs.readFile(path.join(sourceRoot, "renderer/pet-settings-host.tsx"), "utf8"),
    ])

    for (const source of [contracts, preload, settings]) {
      expect(source).toContain("@convax/plugin-sdk/pet")
      expect(source).not.toContain('const petHostProtocol = "convax.pet-host/1"')
    }
  })
})
