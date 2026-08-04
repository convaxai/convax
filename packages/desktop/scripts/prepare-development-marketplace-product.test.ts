import { afterEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { prepareDevelopmentMarketplaceProduct } from "./prepare-development-marketplace-product"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function temporaryProduct() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-development-marketplace-"))
  temporaryRoots.push(root)
  return { outputDirectory: path.join(root, "marketplace-product"), root }
}

test("development preparation keeps one strictly prepared Marketplace product", async () => {
  const { outputDirectory } = await temporaryProduct()
  const result = await prepareDevelopmentMarketplaceProduct({
    outputDirectory,
    prepare: async () => {
      await fs.mkdir(outputDirectory)
      await fs.writeFile(path.join(outputDirectory, "manifest.json"), "prepared")
    },
  })

  expect(result).toEqual({ status: "ready" })
  expect(await fs.readFile(path.join(outputDirectory, "manifest.json"), "utf8")).toBe("prepared")
})

test("development preparation disables stale staged bytes when the current lock is incompatible", async () => {
  const { outputDirectory, root } = await temporaryProduct()
  await fs.mkdir(outputDirectory)
  await fs.writeFile(path.join(outputDirectory, "manifest.json"), "stale")

  const result = await prepareDevelopmentMarketplaceProduct({
    outputDirectory,
    prepare: async () => {
      throw new Error("Plugin manifest hostApi major must be 3")
    },
  })

  expect(result).toEqual({
    reason: "Plugin manifest hostApi major must be 3",
    status: "unavailable",
  })
  await expect(fs.lstat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" })
  expect((await fs.readdir(root)).filter((entry) => entry.includes(".disabled."))).toEqual([])
})
