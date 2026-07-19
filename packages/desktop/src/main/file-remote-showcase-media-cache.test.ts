import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { FileRemoteShowcaseMediaCache } from "./file-remote-showcase-media-cache"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function cacheRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-showcase-cache-"))
  roots.push(root)
  return path.join(root, "media-v1")
}

function media(...bytes: number[]) {
  const value = Uint8Array.from(bytes)
  return { bytes: value, sha256: createHash("sha256").update(value).digest("hex") }
}

describe("FileRemoteShowcaseMediaCache", () => {
  test("requires an absolute root and persists a verified content-addressed hit", async () => {
    expect(() => new FileRemoteShowcaseMediaCache("relative/cache")).toThrow("absolute")
    const root = await cacheRoot()
    const first = new FileRemoteShowcaseMediaCache(root)
    const entry = media(0x89, 0x50, 0x4e, 0x47, 1, 2, 3)

    await first.write(entry)

    const restarted = new FileRemoteShowcaseMediaCache(root)
    await expect(restarted.read({ sha256: entry.sha256, size: entry.bytes.byteLength })).resolves.toEqual(entry.bytes)
    expect((await fs.lstat(path.join(root, entry.sha256))).isFile()).toBe(true)
  })

  test("treats truncated and same-size tampered regular files as misses and removes them", async () => {
    const root = await cacheRoot()
    const cache = new FileRemoteShowcaseMediaCache(root)
    const entry = media(1, 2, 3, 4)
    const target = path.join(root, entry.sha256)
    await cache.write(entry)

    await fs.writeFile(target, entry.bytes.subarray(0, 2))
    await expect(cache.read({ sha256: entry.sha256, size: entry.bytes.byteLength })).resolves.toBeNull()
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" })

    await cache.write(entry)
    await fs.writeFile(target, Uint8Array.from([4, 3, 2, 1]))
    await expect(cache.read({ sha256: entry.sha256, size: entry.bytes.byteLength })).resolves.toBeNull()
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("removes an abandoned atomic-write temporary file before serving the cache", async () => {
    const root = await cacheRoot()
    await fs.mkdir(root, { recursive: true })
    const temporary = path.join(root, `.${"a".repeat(64)}.12345678-1234-4123-8123-123456789abc.tmp`)
    await fs.writeFile(temporary, Uint8Array.from([1, 2, 3]))
    const cache = new FileRemoteShowcaseMediaCache(root)

    await expect(cache.read({ sha256: "b".repeat(64), size: 3 })).resolves.toBeNull()
    await expect(fs.lstat(temporary)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("fails closed for a symlinked root or content target without touching its destination", async () => {
    const root = await cacheRoot()
    const outside = path.join(path.dirname(root), "outside.bin")
    const entry = media(9, 8, 7, 6)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(outside, entry.bytes)
    await fs.symlink(outside, path.join(root, entry.sha256))

    const cache = new FileRemoteShowcaseMediaCache(root)
    await expect(cache.read({ sha256: entry.sha256, size: entry.bytes.byteLength })).rejects.toThrow(
      "real regular file",
    )
    await expect(cache.write(entry)).rejects.toThrow("real regular file")
    expect(new Uint8Array(await fs.readFile(outside))).toEqual(entry.bytes)

    const realRoot = path.join(path.dirname(root), "real-cache")
    const linkedRoot = path.join(path.dirname(root), "linked-cache")
    await fs.mkdir(realRoot)
    await fs.symlink(realRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir")
    const linked = new FileRemoteShowcaseMediaCache(linkedRoot)
    await expect(linked.read({ sha256: entry.sha256, size: entry.bytes.byteLength })).rejects.toThrow("real directory")
  })

  test("evicts least-recently-used content until the configured total is bounded", async () => {
    const root = await cacheRoot()
    const cache = new FileRemoteShowcaseMediaCache(root, { maxTotalBytes: 8 })
    const oldest = media(1, 1, 1, 1)
    const retained = media(2, 2, 2, 2)
    const newest = media(3, 3, 3, 3)
    await cache.write(oldest)
    await cache.write(retained)
    await fs.utimes(path.join(root, oldest.sha256), new Date(1_000), new Date(1_000))
    await fs.utimes(path.join(root, retained.sha256), new Date(2_000), new Date(2_000))

    await cache.write(newest)

    await expect(cache.read({ sha256: oldest.sha256, size: oldest.bytes.byteLength })).resolves.toBeNull()
    await expect(cache.read({ sha256: retained.sha256, size: retained.bytes.byteLength })).resolves.toEqual(
      retained.bytes,
    )
    await expect(cache.read({ sha256: newest.sha256, size: newest.bytes.byteLength })).resolves.toEqual(newest.bytes)
    const sizes = await Promise.all(
      (await fs.readdir(root))
        .filter((name) => /^[a-f0-9]{64}$/.test(name))
        .map((name) => fs.stat(path.join(root, name))),
    )
    expect(sizes.reduce((sum, stat) => sum + stat.size, 0)).toBeLessThanOrEqual(8)
  })
})
