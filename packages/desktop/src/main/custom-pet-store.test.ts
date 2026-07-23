import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { CustomPetStore } from "./custom-pet-store"

const roots: string[] = []

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-custom-pets-"))
  roots.push(root)
  const source = path.join(root, "outside", "Moon Fox.webp")
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.writeFile(source, Uint8Array.from([0x52, 0x49, 0x46, 0x46]))
  const inspector = {
    inspect: mock(async () => ({
      format: "webp" as const,
      hasTransparency: true,
      height: 1_872,
      width: 1_536,
    })),
  }
  const ids = ["pet-one", "pet-two"]
  const store = new CustomPetStore({
    createId: () => ids.shift() ?? "pet-extra",
    inspector,
    petsRoot: path.join(root, "managed-pets"),
  })
  return { inspector, root, source, store }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("CustomPetStore", () => {
  test("atomically imports a current-format atlas without retaining its source path", async () => {
    const value = await fixture()
    const changes: unknown[] = []
    value.store.subscribe((snapshot) => changes.push(snapshot))

    const imported = await value.store.importAtlas(value.source)

    expect(imported).toEqual({
      alt: "Moon Fox, a custom pixel companion",
      description: "A local custom companion.",
      displayName: "Moon Fox",
      id: "custom-pet-one",
      source: "custom",
      spritesheetUrl: "convax-pet-asset://pet/custom-pet-one",
      spriteVersion: 2,
    })
    expect(await value.store.getSnapshot()).toEqual({ pets: [imported], revision: 1 })
    expect(changes).toEqual([{ pets: [imported], revision: 1 }])
    const metadata = await fs.readFile(
      path.join(value.root, "managed-pets", "custom-pet-one", "metadata.json"),
      "utf8",
    )
    expect(metadata).not.toContain(value.source)
    expect((await fs.readdir(path.join(value.root, "managed-pets"))).filter((name) => name.startsWith("."))).toEqual([])
    expect(await value.store.resolveAsset(imported.id)).toBe(
      await fs.realpath(path.join(value.root, "managed-pets", "custom-pet-one", "spritesheet.webp")),
    )
  })

  test("removes failed staging and preserves the existing collection", async () => {
    const value = await fixture()
    await value.store.importAtlas(value.source)
    const secondSource = path.join(value.root, "outside", "Bad.webp")
    await fs.writeFile(secondSource, Uint8Array.from([0x52, 0x49, 0x46, 0x46]))
    value.inspector.inspect
      .mockResolvedValueOnce({
        format: "webp",
        hasTransparency: true,
        height: 1_872,
        width: 1_536,
      })
      .mockResolvedValueOnce({
      format: "webp",
      hasTransparency: false,
      height: 1_872,
      width: 1_536,
    })

    await expect(value.store.importAtlas(secondSource)).rejects.toThrow("transparency")
    expect((await value.store.getSnapshot()).pets.map((pet) => pet.id)).toEqual(["custom-pet-one"])
    expect((await fs.readdir(path.join(value.root, "managed-pets"))).filter((name) => name.startsWith("."))).toEqual([])
  })

  test("deletes only an exact managed custom pet and publishes the next revision", async () => {
    const value = await fixture()
    const imported = await value.store.importAtlas(value.source)
    const changes: unknown[] = []
    value.store.subscribe((snapshot) => changes.push(snapshot))

    await value.store.delete(imported.id)

    expect(await value.store.getSnapshot()).toEqual({ pets: [], revision: 2 })
    expect(changes).toEqual([{ pets: [], revision: 2 }])
    await expect(value.store.delete("violet")).rejects.toThrow("Custom pet id")
    await expect(value.store.delete("custom-../secret")).rejects.toThrow("Custom pet id")
  })

  test("hides tampered metadata and rejects symlinked records", async () => {
    const value = await fixture()
    const imported = await value.store.importAtlas(value.source)
    const directory = path.join(value.root, "managed-pets", imported.id)
    await fs.writeFile(path.join(directory, "metadata.json"), "{}")
    expect(await value.store.getSnapshot()).toEqual({ pets: [], revision: 1 })
    await expect(value.store.resolveAsset(imported.id)).rejects.toThrow()

    const outside = path.join(value.root, "outside-record")
    await fs.mkdir(outside)
    await fs.symlink(outside, path.join(value.root, "managed-pets", "custom-linked"))
    expect((await value.store.getSnapshot()).pets).toEqual([])
  })
})
