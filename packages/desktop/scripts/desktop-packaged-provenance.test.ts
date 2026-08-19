import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { scanPackagedProvenance } from "./desktop-packaged-provenance"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function temporaryTree() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-packaged-provenance-"))
  temporaryRoots.push(root)
  return root
}

describe("packaged application provenance", () => {
  test("accepts portable bytes and detects a local path split across read chunks", async () => {
    const root = await temporaryTree()
    await fs.writeFile(path.join(root, "portable.bin"), "portable release bytes")
    expect(await scanPackagedProvenance(root, ["/Users/release-builder"], 4)).toEqual([])

    await fs.writeFile(path.join(root, "leaked.bin"), "prefix-/Users/release-builder/project-suffix")
    expect(await scanPackagedProvenance(root, ["/users/release-builder"], 4)).toEqual([
      { file: "leaked.bin", marker: "prohibited marker 1" },
    ])
  })

  test("scans every packaged runtime directory without backend-specific exceptions", async () => {
    const root = await temporaryTree()
    const openCode = path.join(root, "Contents", "Resources", "opencode", "bin")
    await fs.mkdir(openCode, { recursive: true })
    await fs.writeFile(path.join(openCode, "opencode"), "private-vendor-marker")
    await fs.writeFile(path.join(root, "outside.bin"), "PRIVATE-VENDOR-MARKER")

    expect(await scanPackagedProvenance(root, ["private-vendor-marker"], 5)).toEqual([
      { file: path.join("Contents", "Resources", "opencode", "bin", "opencode"), marker: "prohibited marker 1" },
      { file: "outside.bin", marker: "prohibited marker 1" },
    ])
  })

  test("rejects empty, duplicate, and unbounded denylists", async () => {
    const root = await temporaryTree()
    await fs.writeFile(path.join(root, "portable.bin"), "portable release bytes")
    await expect(scanPackagedProvenance(root, [])).rejects.toThrow("1-32 markers")
    await expect(scanPackagedProvenance(root, ["duplicate", "duplicate"])).rejects.toThrow("duplicate markers")
    await expect(scanPackagedProvenance(root, ["x".repeat(129)])).rejects.toThrow("invalid length")
  })
})
