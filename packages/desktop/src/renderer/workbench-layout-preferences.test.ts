import { describe, expect, test } from "bun:test"
import { WorkbenchLayoutParts } from "@convax/workbench"
import {
  readWorkbenchLayoutPreferences,
  writeWorkbenchLayoutPreferences,
  type WorkbenchLayoutPreferenceBounds,
} from "./workbench-layout-preferences"

const bounds: WorkbenchLayoutPreferenceBounds = {
  primarySidebar: { defaultSize: 292, defaultVisible: false, maxSize: 480, minSize: 220 },
  secondarySidebar: { defaultSize: 380, defaultVisible: false, maxSize: 620, minSize: 300 },
}

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  return {
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) { values.set(key, value) },
    values,
  }
}

describe("Workbench layout preferences", () => {
  test("uses host defaults when no preference exists", () => {
    expect(readWorkbenchLayoutPreferences(memoryStorage(), bounds)).toEqual({
      primarySidebar: { pinned: false, size: 292, visible: false },
      secondarySidebar: { size: 380, visible: false },
    })
  })

  test("clamps v2 persisted sizes and restores pin and visibility", () => {
    const storage = memoryStorage({
      "convax.workbench.layout.v2": JSON.stringify({
        parts: {
          [WorkbenchLayoutParts.PrimarySidebar]: { pinned: true, size: 999, visible: true },
          [WorkbenchLayoutParts.SecondarySidebar]: { size: 120, visible: false },
        },
        version: 2,
      }),
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds)).toEqual({
      primarySidebar: { pinned: true, size: 480, visible: true },
      secondarySidebar: { size: 300, visible: false },
    })
  })

  test("migrates valid v1 layout and treats a visible primary sidebar as pinned", () => {
    const storage = memoryStorage({
      "convax.workbench.layout.v1": JSON.stringify({
        parts: {
          [WorkbenchLayoutParts.PrimarySidebar]: { size: 320, visible: true },
          [WorkbenchLayoutParts.SecondarySidebar]: { size: 440, visible: false },
        },
        version: 1,
      }),
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds)).toEqual({
      primarySidebar: { pinned: true, size: 320, visible: true },
      secondarySidebar: { size: 440, visible: false },
    })
  })

  test("migrates the former Agent panel keys while new Project Details stays closed", () => {
    const storage = memoryStorage({
      "convax:agent-panel:open": "false",
      "convax:agent-panel:width": "456",
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds).primarySidebar).toEqual({
      pinned: false,
      size: 292,
      visible: false,
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds).secondarySidebar).toEqual({ size: 456, visible: false })
  })

  test("writes a versioned snapshot with Desktop pin policy and tolerates unavailable storage", () => {
    const storage = memoryStorage()
    const snapshot = {
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { size: 320, visible: true },
        [WorkbenchLayoutParts.SecondarySidebar]: { size: 440, visible: false },
      },
      resize: null,
    }
    expect(writeWorkbenchLayoutPreferences(storage, snapshot, { projectDetailsPinned: true })).toBe(true)
    expect(JSON.parse(storage.values.get("convax.workbench.layout.v2") ?? "{}")).toMatchObject({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { pinned: true, size: 320, visible: true },
      },
      version: 2,
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds)).toEqual({
      primarySidebar: { pinned: true, size: 320, visible: true },
      secondarySidebar: { size: 440, visible: false },
    })
    expect(writeWorkbenchLayoutPreferences(
      { setItem() { throw new Error("blocked") } },
      snapshot,
      { projectDetailsPinned: false },
    )).toBe(false)
  })

  test("falls back safely from malformed and future preference versions", () => {
    for (const stored of ["{", JSON.stringify({ parts: {}, version: 99 })]) {
      expect(readWorkbenchLayoutPreferences(memoryStorage({
        "convax.workbench.layout.v2": stored,
      }), bounds)).toEqual({
        primarySidebar: { pinned: false, size: 292, visible: false },
        secondarySidebar: { size: 380, visible: false },
      })
    }
  })

  test("tolerates storage that is unavailable for reads", () => {
    expect(readWorkbenchLayoutPreferences({
      getItem() {
        throw new Error("blocked")
      },
    }, bounds)).toEqual({
      primarySidebar: { pinned: false, size: 292, visible: false },
      secondarySidebar: { size: 380, visible: false },
    })
  })
})
