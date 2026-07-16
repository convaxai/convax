import { describe, expect, test } from "bun:test"
import { WorkbenchLayoutParts } from "@convax/workbench"
import {
  readWorkbenchLayoutPreferences,
  writeWorkbenchLayoutPreferences,
  type WorkbenchLayoutPreferenceBounds,
} from "./workbench-layout-preferences"

const bounds: WorkbenchLayoutPreferenceBounds = {
  primarySidebar: { defaultSize: 292, defaultVisible: true, maxSize: 480, minSize: 220 },
  secondarySidebar: { defaultSize: 380, defaultVisible: true, maxSize: 620, minSize: 300 },
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
      primarySidebar: { size: 292, visible: true },
      secondarySidebar: { size: 380, visible: true },
    })
  })

  test("clamps persisted sizes and restores secondary visibility", () => {
    const storage = memoryStorage({
      "convax.workbench.layout.v1": JSON.stringify({
        parts: {
          [WorkbenchLayoutParts.PrimarySidebar]: { size: 999, visible: false },
          [WorkbenchLayoutParts.SecondarySidebar]: { size: 120, visible: false },
        },
        version: 1,
      }),
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds)).toEqual({
      primarySidebar: { size: 480, visible: false },
      secondarySidebar: { size: 300, visible: false },
    })
  })

  test("migrates the former Agent panel keys", () => {
    const storage = memoryStorage({
      "convax:agent-panel:open": "false",
      "convax:agent-panel:width": "456",
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds).secondarySidebar).toEqual({ size: 456, visible: false })
  })

  test("writes a versioned snapshot and tolerates unavailable storage", () => {
    const storage = memoryStorage()
    const snapshot = {
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { size: 320, visible: true },
        [WorkbenchLayoutParts.SecondarySidebar]: { size: 440, visible: false },
      },
      resize: null,
    }
    expect(writeWorkbenchLayoutPreferences(storage, snapshot)).toBe(true)
    expect(readWorkbenchLayoutPreferences(storage, bounds)).toEqual({
      primarySidebar: { size: 320, visible: true },
      secondarySidebar: { size: 440, visible: false },
    })
    expect(writeWorkbenchLayoutPreferences({ setItem() { throw new Error("blocked") } }, snapshot)).toBe(false)
  })
})
