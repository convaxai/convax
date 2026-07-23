import { describe, expect, mock, test } from "bun:test"

import { desktopBuiltinPluginCatalog } from "./builtin-plugin-catalog"
import { migrateRetiredBuiltinPlugins, retiredBuiltinPluginIds } from "./retired-builtin-plugin-migrations"

describe("retired built-in Plugin migrations", () => {
  test("releases the historical Panorama identity for Registry installation", async () => {
    const retireInstalledBuiltinProvenance = mock(async () => true)
    const onError = mock(() => undefined)

    await migrateRetiredBuiltinPlugins({ retireInstalledBuiltinProvenance }, onError)

    expect(retiredBuiltinPluginIds).toEqual(["panorama-viewer"])
    expect(desktopBuiltinPluginCatalog.some((entry) => entry.manifest.id === "panorama-viewer")).toBe(false)
    expect(retireInstalledBuiltinProvenance).toHaveBeenCalledWith("panorama-viewer")
    expect(onError).not.toHaveBeenCalled()
  })

  test("reports a rejected legacy marker without blocking other startup work", async () => {
    const error = new Error("provenance mismatch")
    const onError = mock(() => undefined)

    await migrateRetiredBuiltinPlugins(
      {
        retireInstalledBuiltinProvenance: mock(async () => {
          throw error
        }),
      },
      onError,
    )

    expect(onError).toHaveBeenCalledWith("panorama-viewer", error)
  })
})
