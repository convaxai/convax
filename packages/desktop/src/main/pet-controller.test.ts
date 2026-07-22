import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { InstalledWebPluginSummary } from "../plugin-contracts"
import { PetController } from "./pet-controller"
import { PetStateStore } from "./pet-state-store"

const temporaryRoots: string[] = []

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-pet-controller-"))
  temporaryRoots.push(root)
  const asset = path.join(root, "plugin-assets", "violet.webp")
  await fs.mkdir(path.dirname(asset), { recursive: true })
  await fs.writeFile(asset, Uint8Array.from([1, 2, 3]))
  const plugin: InstalledWebPluginSummary = {
    capabilities: [],
    contributes: {
      pet: {
        alt: "Violet, the Convax pixel companion",
        description: "A calm companion that reflects Agent activity.",
        name: "Violet",
        spritesheet: "assets/violet.webp",
        spriteVersion: 2,
      },
    },
    description: "Adds Violet as a desktop companion",
    id: "any-pet-plugin",
    name: "Any Pet Plugin",
    schema: "convax.plugin/5",
    version: "0.1.0",
  }
  let plugins = [plugin]
  const pluginManager = {
    list: mock(async () => plugins),
    resolveAsset: mock(async () => asset),
  }
  const inspector = {
    inspect: mock(async () => ({
      format: "webp" as const,
      hasTransparency: true,
      height: 1_872,
      width: 1_536,
    })),
  }
  const activity = {
    getSnapshot: mock(() => ({ activities: [], revision: 0 })),
    subscribe: mock((_listener: (snapshot: { activities: []; revision: number }) => void) => () => undefined),
  }
  const window = {
    close: mock(() => undefined),
    open: mock(async () => undefined),
    update: mock(() => undefined),
  }
  let nextId = 0
  const controller = new PetController({
    activity,
    createId: () => `custom-${++nextId}`,
    inspector,
    petsRoot: path.join(root, "pets"),
    pluginManager,
    stateStore: new PetStateStore(path.join(root, "state", "pet-state-v1.json")),
    window,
  })
  return {
    asset,
    controller,
    inspector,
    pluginManager,
    removePlugins: () => {
      plugins = []
    },
    root,
    window,
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("PetController", () => {
  test("maps any declarative pet Plugin without id-specific behavior and wakes only explicitly", async () => {
    const value = await fixture()
    await value.controller.initialize()

    expect((await value.controller.listPets()).pets).toEqual([
      expect.objectContaining({ id: "plugin:any-pet-plugin", name: "Violet", source: "plugin" }),
    ])
    await value.controller.select("plugin:any-pet-plugin")
    expect(value.window.open).not.toHaveBeenCalled()
    await value.controller.setAwake(true)
    expect(value.window.open).toHaveBeenCalledTimes(1)
    expect(await value.controller.resolveSelectedAsset()).toBe(value.asset)
  })

  test("closes before a selected Plugin changes and clears selection after uninstall", async () => {
    const value = await fixture()
    await value.controller.initialize()
    await value.controller.select("plugin:any-pet-plugin")
    await value.controller.setAwake(true)

    await value.controller.beforePluginChange("any-pet-plugin")
    expect(value.window.close).toHaveBeenCalled()
    value.removePlugins()
    await value.controller.pluginChanged("any-pet-plugin")
    expect(await value.controller.listPets()).toMatchObject({ awake: false, pets: [] })
    expect((await value.controller.listPets()).selectedId).toBeUndefined()
  })

  test("stages and atomically imports a valid local custom pet without retaining its source path", async () => {
    const value = await fixture()
    const source = path.join(value.root, "outside", "personal.webp")
    await fs.mkdir(path.dirname(source), { recursive: true })
    await fs.writeFile(source, Uint8Array.from([7, 8, 9]))
    await value.controller.initialize()

    const imported = await value.controller.importCustom(source)
    expect(imported).toMatchObject({ id: "custom:custom-1", name: "personal", source: "custom" })
    const metadata = await fs.readFile(path.join(value.root, "pets", "custom-1", "metadata.json"), "utf8")
    expect(metadata).not.toContain(source)
    expect((await fs.readdir(path.join(value.root, "pets"))).filter((name) => name.startsWith(".staging-"))).toEqual(
      [],
    )
    expect(await value.controller.resolvePetAsset(imported.id)).toBe(
      await fs.realpath(path.join(value.root, "pets", "custom-1", "spritesheet.webp")),
    )
  })

  test("removes failed custom import staging and preserves the current selection", async () => {
    const value = await fixture()
    const source = path.join(value.root, "outside", "invalid.webp")
    await fs.mkdir(path.dirname(source), { recursive: true })
    await fs.writeFile(source, Uint8Array.from([7, 8, 9]))
    await value.controller.initialize()
    await value.controller.select("plugin:any-pet-plugin")
    value.inspector.inspect.mockResolvedValueOnce({
      format: "webp",
      hasTransparency: true,
      height: 1_871,
      width: 1_536,
    })

    await expect(value.controller.importCustom(source)).rejects.toThrow("1536 by 1872")
    expect((await value.controller.listPets()).selectedId).toBe("plugin:any-pet-plugin")
    const petsRoot = path.join(value.root, "pets")
    expect((await fs.readdir(petsRoot)).filter((name) => name.startsWith(".staging-"))).toEqual([])
  })
})
