import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { boundPetState, defaultPetState, PetStateStore } from "./pet-state-store"

const temporaryRoots: string[] = []

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-pet-state-"))
  temporaryRoots.push(root)
  const file = path.join(root, "state", "pet-state-v1.json")
  return { file, store: new PetStateStore(file) }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("PetStateStore", () => {
  test("atomically persists selection, wake state, display positions, and watermarks", async () => {
    const { file, store } = await fixture()
    await store.write({
      awake: true,
      positions: { displayA: { x: 40, y: 60 } },
      seen: { "project-a\u0000session-a": 100 },
      selected: { kind: "plugin", pluginId: "convax-pet" },
    })

    expect(await store.read()).toEqual({
      awake: true,
      positions: { displayA: { x: 40, y: 60 } },
      schema: "convax.pet-state/1",
      seen: { "project-a\u0000session-a": 100 },
      selected: { kind: "plugin", pluginId: "convax-pet" },
    })
    if (process.platform !== "win32") expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    expect((await fs.readdir(path.dirname(file))).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  test("falls back to a fresh default for missing, corrupt, or unknown-schema state", async () => {
    const { file, store } = await fixture()
    expect(await store.read()).toEqual(defaultPetState)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, "{broken")
    expect(await store.read()).toEqual(defaultPetState)
    await fs.writeFile(file, JSON.stringify({ ...defaultPetState, schema: "convax.pet-state/2" }))
    expect(await store.read()).toEqual(defaultPetState)

    const first = await store.read()
    first.positions.modified = { x: 1, y: 2 }
    expect((await store.read()).positions).not.toHaveProperty("modified")
  })

  test("bounds watermarks and display positions deterministically", () => {
    const seen = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`activity-${index}`, index]))
    const positions = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [`display-${index}`, { x: index, y: index }]),
    )
    const state = boundPetState({ awake: false, positions, seen })

    expect(Object.keys(state.seen)).toHaveLength(256)
    expect(Object.values(state.seen)).not.toContain(0)
    expect(Object.keys(state.positions)).toHaveLength(64)
  })

  test("serializes independent preference and watermark updates without lost writes", async () => {
    const { store } = await fixture()
    await Promise.all([
      store.update((state) => ({ ...state, awake: true, selected: { kind: "plugin", pluginId: "convax-pet" } })),
      store.markSeen("project-a\u0000session-a", 900),
    ])

    expect(await store.read()).toMatchObject({
      awake: true,
      seen: { "project-a\u0000session-a": 900 },
      selected: { kind: "plugin", pluginId: "convax-pet" },
    })
  })

  test("rejects unsafe selection, coordinates, timestamps, and unknown fields on write", async () => {
    const { store } = await fixture()
    await expect(
      store.write({
        awake: true,
        positions: { displayA: { x: Number.NaN, y: 0 } },
        seen: {},
      }),
    ).rejects.toThrow("position")
    await expect(
      store.write({
        awake: true,
        positions: {},
        seen: { activity: -1 },
      }),
    ).rejects.toThrow("watermark")
    expect(() =>
      boundPetState({
        awake: true,
        extra: true,
        positions: {},
        seen: {},
        selected: { kind: "plugin", pluginId: "../escape" },
      }),
    ).toThrow()
  })
})
