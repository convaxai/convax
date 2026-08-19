import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

test("Desktop distribution does not stage or verify a product-selected Marketplace", async () => {
  const rootManifest = JSON.parse(await readFile(join(import.meta.dir, "..", "..", "..", "package.json"), "utf8")) as {
    scripts?: Record<string, string>
  }
  const desktopManifest = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as {
    scripts?: Record<string, string>
  }
  const builderConfig = await readFile(join(import.meta.dir, "..", "electron-builder.config.ts"), "utf8")

  expect(Object.keys(rootManifest.scripts ?? {}).some((name) => name.startsWith("marketplace:"))).toBe(false)
  expect(Object.keys(desktopManifest.scripts ?? {}).some((name) => name.startsWith("marketplace:"))).toBe(false)
  expect(desktopManifest.scripts?.dev).not.toContain("marketplace:prepare")
  expect(desktopManifest.scripts?.["package:prepare"]).not.toContain("marketplace:prepare")
  expect(builderConfig).not.toContain("marketplace-product")
})
