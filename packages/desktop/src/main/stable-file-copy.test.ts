import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, test } from "bun:test"

import { copyStableFile } from "./stable-file-copy"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

test("rejects a multiply-linked source at the pinned stable-copy boundary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-stable-copy-"))
  roots.push(root)
  const source = path.join(root, "source")
  await fs.writeFile(source, "exact bytes")
  await fs.link(source, path.join(root, "second-link"))
  await expect(
    copyStableFile({
      description: "fixture",
      expectedRealPath: await fs.realpath(source),
      maximumBytes: 1024,
      prepareTarget: () => path.join(root, "target"),
      sourcePath: source,
    }),
  ).rejects.toThrow("single-link")
  await expect(fs.lstat(path.join(root, "target"))).rejects.toMatchObject({ code: "ENOENT" })
})

test("detects a hard link introduced between the open and post-copy recheck", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-stable-copy-"))
  roots.push(root)
  const source = path.join(root, "source")
  await fs.writeFile(source, "exact bytes")
  await expect(
    copyStableFile({
      description: "fixture",
      expectedRealPath: await fs.realpath(source),
      maximumBytes: 1024,
      async prepareTarget() {
        await fs.link(source, path.join(root, "racing-link"))
        return path.join(root, "target")
      },
      sourcePath: source,
    }),
  ).rejects.toThrow("changed while it was being copied")
  await expect(fs.lstat(path.join(root, "target"))).rejects.toMatchObject({ code: "ENOENT" })
})
