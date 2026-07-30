import { describe, expect, test } from "bun:test"
import { WorkbenchLayoutParts } from "@convax/workbench"
import {
  currentWorkbenchLayoutPreferenceKey,
  previousWorkbenchLayoutPreferenceKey,
  readWorkbenchLayoutPreferences,
  writeWorkbenchLayoutPreferences,
  type WorkbenchLayoutPreferenceBounds,
} from "./workbench-layout-preferences"

const bounds: WorkbenchLayoutPreferenceBounds = {
  primarySidebar: { defaultSize: 240, defaultVisible: false, maxSize: 480, minSize: 220 },
  secondarySidebar: { defaultSize: 380, defaultVisible: false, maxSize: 620, minSize: 300 },
}

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    values,
  }
}

describe("Workbench layout preferences", () => {
  test("uses host defaults when no preference exists", () => {
    expect(readWorkbenchLayoutPreferences(memoryStorage(), bounds)).toEqual({
      primarySidebar: { pinned: false, size: 240, visible: false },
      secondarySidebar: { size: 380, visible: false },
    })
  })

  test("clamps v3 persisted sizes and restores pin and visibility", () => {
    const storage = memoryStorage({
      [currentWorkbenchLayoutPreferenceKey]: JSON.stringify({
        parts: {
          [WorkbenchLayoutParts.PrimarySidebar]: { pinned: true, size: 999, visible: true },
          [WorkbenchLayoutParts.SecondarySidebar]: { size: 120, visible: false },
        },
        version: 3,
      }),
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds)).toEqual({
      primarySidebar: { pinned: true, size: 480, visible: true },
      secondarySidebar: { size: 300, visible: false },
    })
  })

  test("migrates only the exact v2 primary default from 292 to the v3 default", () => {
    const oldDefaultStorage = memoryStorage({
      [previousWorkbenchLayoutPreferenceKey]: JSON.stringify({
        parts: {
          [WorkbenchLayoutParts.PrimarySidebar]: { pinned: true, size: 292, visible: true },
          [WorkbenchLayoutParts.SecondarySidebar]: { size: 380, visible: true },
        },
        version: 2,
      }),
    })
    const customSizeStorage = memoryStorage({
      [previousWorkbenchLayoutPreferenceKey]: JSON.stringify({
        parts: {
          [WorkbenchLayoutParts.PrimarySidebar]: { pinned: true, size: 293, visible: true },
          [WorkbenchLayoutParts.SecondarySidebar]: { size: 420, visible: false },
        },
        version: 2,
      }),
    })

    expect(readWorkbenchLayoutPreferences(oldDefaultStorage, bounds)).toEqual({
      primarySidebar: { pinned: true, size: 240, visible: true },
      secondarySidebar: { size: 380, visible: true },
    })
    expect(readWorkbenchLayoutPreferences(customSizeStorage, bounds)).toEqual({
      primarySidebar: { pinned: true, size: 293, visible: true },
      secondarySidebar: { size: 420, visible: false },
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

  test("keeps the existing legacy fallback when the v2 record is malformed", () => {
    const storage = memoryStorage({
      "convax.workbench.layout.v1": JSON.stringify({
        parts: {
          [WorkbenchLayoutParts.PrimarySidebar]: { size: 310, visible: true },
          [WorkbenchLayoutParts.SecondarySidebar]: { size: 456, visible: false },
        },
        version: 1,
      }),
      [previousWorkbenchLayoutPreferenceKey]: "{",
    })

    expect(readWorkbenchLayoutPreferences(storage, bounds)).toEqual({
      primarySidebar: { pinned: true, size: 310, visible: true },
      secondarySidebar: { size: 456, visible: false },
    })
  })

  test("migrates the former Agent panel keys while new Project Details stays closed", () => {
    const storage = memoryStorage({
      "convax:agent-panel:open": "false",
      "convax:agent-panel:width": "456",
    })
    expect(readWorkbenchLayoutPreferences(storage, bounds).primarySidebar).toEqual({
      pinned: false,
      size: 240,
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
    expect(JSON.parse(storage.values.get(currentWorkbenchLayoutPreferenceKey) ?? "{}")).toMatchObject({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { pinned: true, size: 320, visible: true },
      },
      version: 3,
    })
    expect(storage.values.has(previousWorkbenchLayoutPreferenceKey)).toBeFalse()
    expect(readWorkbenchLayoutPreferences(storage, bounds)).toEqual({
      primarySidebar: { pinned: true, size: 320, visible: true },
      secondarySidebar: { size: 440, visible: false },
    })
    expect(
      writeWorkbenchLayoutPreferences(
        {
          getItem() {
            return null
          },
          setItem() {
            throw new Error("blocked")
          },
        },
        snapshot,
        { projectDetailsPinned: false },
      ),
    ).toBe(false)
  })

  test("does not overwrite a future v3-key schema while persisting Workbench snapshots", () => {
    const futureRecord = JSON.stringify({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { pinned: true, size: 360, visible: true },
      },
      version: 99,
    })
    const storage = memoryStorage({
      [currentWorkbenchLayoutPreferenceKey]: futureRecord,
    })
    const snapshot = {
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { size: 240, visible: false },
        [WorkbenchLayoutParts.SecondarySidebar]: { size: 380, visible: false },
      },
      resize: null,
    }

    expect(writeWorkbenchLayoutPreferences(storage, snapshot)).toBeFalse()
    expect(storage.values.get(currentWorkbenchLayoutPreferenceKey)).toBe(futureRecord)
  })

  test("fails safe on malformed or future v3 records without reviving v2 preferences", () => {
    const previous = JSON.stringify({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { pinned: true, size: 360, visible: true },
        [WorkbenchLayoutParts.SecondarySidebar]: { size: 440, visible: true },
      },
      version: 2,
    })
    for (const stored of ["{", JSON.stringify({ parts: {}, version: 99 })]) {
      expect(
        readWorkbenchLayoutPreferences(
          memoryStorage({
            [currentWorkbenchLayoutPreferenceKey]: stored,
            [previousWorkbenchLayoutPreferenceKey]: previous,
          }),
          bounds,
        ),
      ).toEqual({
        primarySidebar: { pinned: false, size: 240, visible: false },
        secondarySidebar: { size: 380, visible: false },
      })
    }
  })

  test("tolerates storage that is unavailable for reads", () => {
    expect(
      readWorkbenchLayoutPreferences(
        {
          getItem() {
            throw new Error("blocked")
          },
        },
        bounds,
      ),
    ).toEqual({
      primarySidebar: { pinned: false, size: 240, visible: false },
      secondarySidebar: { size: 380, visible: false },
    })
  })
})
