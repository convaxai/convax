import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { ProjectManagedAssetStore } from "./project-managed-asset-store"
import { ProjectAssetGc, projectAssetGcGraceMs, projectAssetStagingRetentionMs } from "./project-asset-gc"

let temporaryRoot = ""
let projectRoot = ""
let now = 0

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-asset-gc-"))
  projectRoot = path.join(temporaryRoot, "project")
  await fs.mkdir(path.join(projectRoot, ".convax", "assets", "blobs"), { recursive: true })
  await fs.mkdir(path.join(projectRoot, ".convax", "assets", ".staging"), { recursive: true })
  await fs.mkdir(path.join(projectRoot, ".convax", "staging"), { recursive: true })
  now = Date.UTC(2026, 0, 1)
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { force: true, recursive: true })
})

describe("ProjectAssetGc", () => {
  test("marks first and deletes only after seven days plus a fresh full scan", async () => {
    const orphan = await writeBlob("orphan")
    const setup = harness()

    await setup.gc.scan("project_one")
    expect(await blobExists(orphan)).toBe(true)
    expect((await readState()).entries[orphan]).toEqual({ unreferencedSince: iso(now) })

    now += projectAssetGcGraceMs - 1
    await setup.gc.scan("project_one")
    expect(await blobExists(orphan)).toBe(true)

    now += 1
    await setup.gc.scan("project_one")
    expect(setup.loadAllStrict).toHaveBeenCalledTimes(4)
    expect(await blobExists(orphan)).toBe(false)
    expect((await readState()).entries).toEqual({})
  })

  test.each([
    ["missing", (): string | undefined => undefined],
    ["malformed", (): string | undefined => "not json"],
    ["unknown version", (): string | undefined => JSON.stringify({ entries: {}, schemaVersion: 2 })],
    [
      "future timestamp",
      (): string | undefined =>
        JSON.stringify({
          entries: { ["a".repeat(64)]: { unreferencedSince: iso(Date.UTC(3000, 0, 1)) } },
          schemaVersion: 1,
        }),
    ],
    ["extra fields", (): string | undefined => JSON.stringify({ entries: {}, extra: true, schemaVersion: 1 })],
  ] as const)("rebuilds %s state after a full scan and deletes nothing", async (_label, createContent) => {
    const orphan = await writeBlob(`orphan-${_label}`)
    now += projectAssetGcGraceMs
    const content =
      _label === "future timestamp"
        ? JSON.stringify({
            entries: { ["a".repeat(64)]: { unreferencedSince: iso(now + 1) } },
            schemaVersion: 1,
          })
        : createContent()
    if (content !== undefined) await fs.writeFile(gcStatePath(), content)
    const setup = harness()

    await setup.gc.scan("project_one")

    expect(setup.loadAllStrict).toHaveBeenCalledTimes(1)
    expect(await blobExists(orphan)).toBe(true)
    expect((await readState()).entries[orphan]).toEqual({ unreferencedSince: iso(now) })
  })

  test("does not unlink when gc.json publication fails", async () => {
    const due = await writeBlob("due-publication")
    await writeState({ [due]: { unreferencedSince: iso(now) } })
    now += projectAssetGcGraceMs
    const setup = harness()
    const originalRename = fs.rename
    fs.rename = (async (source, target) => {
      if (path.basename(String(target)) === "gc.json") throw new Error("disk full")
      return Reflect.apply(originalRename, fs, [source, target])
    }) as typeof fs.rename

    try {
      await expect(setup.gc.scan("project_one")).rejects.toThrow("disk full")
    } finally {
      fs.rename = originalRename
    }

    expect(await blobExists(due)).toBe(true)
    expect(await quarantineExists(due)).toBe(false)
    expect(setup.loadAllStrict).toHaveBeenCalledTimes(1)
  })

  test("clears a due mark without deleting when the second scan observes a new reference", async () => {
    const digest = await writeBlob("re-referenced")
    await writeState({ [digest]: { unreferencedSince: iso(now) } })
    now += projectAssetGcGraceMs
    const setup = harness([new Set(), new Set([digest])])

    await setup.gc.scan("project_one")

    expect(setup.loadAllStrict).toHaveBeenCalledTimes(2)
    expect(await blobExists(digest)).toBe(true)
    expect((await readState()).entries).toEqual({})
  })

  test("retains a due mark when quarantine deletion fails and retries the crash alias", async () => {
    const digest = await writeBlob("quarantine-retry")
    await writeState({ [digest]: { unreferencedSince: iso(now) } })
    now += projectAssetGcGraceMs
    const setup = harness()
    const originalUnlink = fs.unlink
    let failOnce = true
    fs.unlink = (async (target) => {
      if (failOnce && path.basename(String(target)) === `gc-delete-${digest}`) {
        failOnce = false
        throw new Error("injected unlink failure")
      }
      return Reflect.apply(originalUnlink, fs, [target])
    }) as typeof fs.unlink

    try {
      await setup.gc.scan("project_one")
    } finally {
      fs.unlink = originalUnlink
    }

    expect(await blobExists(digest)).toBe(false)
    expect(await quarantineExists(digest)).toBe(true)
    expect((await readState()).entries[digest]).toEqual({ unreferencedSince: iso(now - projectAssetGcGraceMs) })

    await setup.gc.scan("project_one")
    expect(await quarantineExists(digest)).toBe(false)
    expect((await readState()).entries).toEqual({})
  })

  test("recovers a due canonical quarantine alias left by a crash", async () => {
    const digest = await writeBlob("quarantine-crash")
    await fs.rename(blobPath(digest), quarantinePath(digest))
    await writeState({ [digest]: { unreferencedSince: iso(now) } })
    now += projectAssetGcGraceMs

    await harness().gc.scan("project_one")

    expect(await quarantineExists(digest)).toBe(false)
    expect((await readState()).entries).toEqual({})
  })

  test("restores a live quarantine-only blob without replacing its file identity", async () => {
    const content = "live-quarantine-only"
    const digest = await writeBlob(content)
    await fs.rename(blobPath(digest), quarantinePath(digest))
    const quarantined = await fs.lstat(quarantinePath(digest), { bigint: true })
    await writeState({ [digest]: { unreferencedSince: iso(now) } })

    await harness([new Set([digest])]).gc.scan("project_one")

    const restored = await fs.lstat(blobPath(digest), { bigint: true })
    expect([restored.dev, restored.ino]).toEqual([quarantined.dev, quarantined.ino])
    expect(await fs.readFile(blobPath(digest), "utf8")).toBe(content)
    expect(await quarantineExists(digest)).toBe(false)
    expect((await readState()).entries).toEqual({})
  })

  test("keeps an existing live canonical blob and removes its redundant quarantine without replacement", async () => {
    const content = "live-canonical-and-quarantine"
    const digest = await writeBlob(content)
    const canonical = await fs.lstat(blobPath(digest), { bigint: true })
    await fs.writeFile(quarantinePath(digest), content)
    const quarantined = await fs.lstat(quarantinePath(digest), { bigint: true })
    expect([quarantined.dev, quarantined.ino]).not.toEqual([canonical.dev, canonical.ino])
    await writeState({})

    await harness([new Set([digest])]).gc.scan("project_one")

    const current = await fs.lstat(blobPath(digest), { bigint: true })
    expect([current.dev, current.ino]).toEqual([canonical.dev, canonical.ino])
    expect(await fs.readFile(blobPath(digest), "utf8")).toBe(content)
    expect(await quarantineExists(digest)).toBe(false)
    expect((await readState()).entries).toEqual({})
  })

  test("does not restore or unlink a live quarantine while rebuilding invalid state", async () => {
    const digest = await writeBlob("live-quarantine-invalid-state")
    await fs.rename(blobPath(digest), quarantinePath(digest))

    await harness([new Set([digest])]).gc.scan("project_one")

    expect(await blobExists(digest)).toBe(false)
    expect(await quarantineExists(digest)).toBe(true)
    expect((await readState()).entries).toEqual({})
  })

  test("preflights every due candidate before renaming or unlinking any candidate", async () => {
    const first = await writeBlob("preflight-first")
    const second = await writeBlob("preflight-second")
    await writeState({
      [first]: { unreferencedSince: iso(now) },
      [second]: { unreferencedSince: iso(now) },
    })
    now += projectAssetGcGraceMs
    const setup = harness([
      new Set(),
      async () => {
        await fs.writeFile(blobPath(second), "changed after scan B")
        return new Set<string>()
      },
    ])

    await expect(setup.gc.scan("project_one")).rejects.toThrow(/digest mismatch|changed/i)

    expect(await blobExists(first)).toBe(true)
    expect(await quarantineExists(first)).toBe(false)
    expect(await blobExists(second)).toBe(true)
    expect(await quarantineExists(second)).toBe(false)
  })

  test("fails closed on canonical quarantine symlinks and digest mismatch", async () => {
    const outside = path.join(temporaryRoot, "outside-quarantine")
    await fs.writeFile(outside, "outside")
    const symlinkDigest = "2".repeat(64)
    await fs.symlink(outside, quarantinePath(symlinkDigest))
    await expect(harness().gc.scan("project_one")).rejects.toThrow(/symbolic link|regular file/i)
    await fs.rm(quarantinePath(symlinkDigest))

    const mismatchedDigest = "3".repeat(64)
    await fs.writeFile(quarantinePath(mismatchedDigest), "wrong quarantine bytes")
    await expect(harness().gc.scan("project_one")).rejects.toThrow(/digest mismatch/i)
    expect(await fs.readFile(quarantinePath(mismatchedDigest), "utf8")).toBe("wrong quarantine bytes")
  })

  test("fails closed on digest mismatch, canonical symlinks, oversized blobs, and unreadable Canvas scans", async () => {
    const mismatched = "e".repeat(64)
    await fs.writeFile(blobPath(mismatched), "wrong bytes")
    await expect(harness().gc.scan("project_one")).rejects.toThrow(/digest mismatch/i)
    await fs.rm(blobPath(mismatched))

    const outside = path.join(temporaryRoot, "outside.bin")
    await fs.writeFile(outside, "outside")
    const symlinkDigest = "f".repeat(64)
    await fs.symlink(outside, blobPath(symlinkDigest))
    await expect(harness().gc.scan("project_one")).rejects.toThrow(/symbolic link|regular file/i)
    await fs.rm(blobPath(symlinkDigest))

    const oversized = await writeBlob("12345")
    await expect(harness([], 4).gc.scan("project_one")).rejects.toThrow(/maximum size/i)
    await fs.rm(blobPath(oversized))

    const scanError = new Error("Canvas document could not be read")
    await expect(harness([scanError]).gc.scan("project_one")).rejects.toThrow(scanError.message)
    expect(
      await fs.access(gcStatePath()).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

  test("ignores unknown blob names, prunes missing records, and never enumerates Project-public directories", async () => {
    const missing = "1".repeat(64)
    const unknown = "A".repeat(64)
    await fs.writeFile(path.join(projectRoot, ".convax", "assets", "blobs", unknown), "unknown")
    await fs.mkdir(path.join(projectRoot, "Notes"))
    await fs.mkdir(path.join(projectRoot, "Generated"))
    await fs.writeFile(path.join(projectRoot, "Notes", missing), "note")
    await fs.writeFile(path.join(projectRoot, "Generated", missing), "generated")
    await writeState({ [missing]: { unreferencedSince: iso(now) } })

    await harness().gc.scan("project_one")

    expect((await readState()).entries).toEqual({})
    expect(await fs.readFile(path.join(projectRoot, ".convax", "assets", "blobs", unknown), "utf8")).toBe("unknown")
    expect(await fs.readFile(path.join(projectRoot, "Notes", missing), "utf8")).toBe("note")
    expect(await fs.readFile(path.join(projectRoot, "Generated", missing), "utf8")).toBe("generated")
  })

  test("cleans only old regular staging files without recursion, symlink following, or quarantine cleanup", async () => {
    const assetStaging = path.join(projectRoot, ".convax", "assets", ".staging")
    const publicationStaging = path.join(projectRoot, ".convax", "staging")
    const oldAsset = path.join(assetStaging, "old-asset")
    const youngAsset = path.join(assetStaging, "young-asset")
    const oldPublication = path.join(publicationStaging, "old-publication")
    const oldDirectory = path.join(assetStaging, "old-directory")
    const outside = path.join(temporaryRoot, "outside-staging")
    const symlink = path.join(publicationStaging, "old-symlink")
    const quarantineDigest = createHash("sha256").update("quarantine").digest("hex")
    await fs.writeFile(oldAsset, "old")
    await fs.writeFile(youngAsset, "young")
    await fs.writeFile(oldPublication, "old")
    await fs.mkdir(oldDirectory)
    await fs.writeFile(path.join(oldDirectory, "nested"), "keep")
    await fs.writeFile(outside, "outside")
    await fs.symlink(outside, symlink)
    await fs.writeFile(quarantinePath(quarantineDigest), "quarantine")
    await writeState({})
    const old = new Date(now - projectAssetStagingRetentionMs - 1)
    await Promise.all(
      [oldAsset, oldPublication, oldDirectory, symlink, quarantinePath(quarantineDigest)].map((item) =>
        fs.utimes(item, old, old),
      ),
    )
    const oldSnapshots = await Promise.all(
      [oldAsset, oldPublication, oldDirectory, symlink, quarantinePath(quarantineDigest)].map((item) => fs.lstat(item)),
    )
    now =
      Math.ceil(Math.max(...oldSnapshots.flatMap((stat) => [stat.ctimeMs, stat.mtimeMs]))) +
      projectAssetStagingRetentionMs +
      1
    const recent = new Date(now)
    await fs.utimes(youngAsset, recent, recent)

    await harness().gc.scan("project_one")

    await expect(fs.access(oldAsset)).rejects.toThrow()
    await expect(fs.access(oldPublication)).rejects.toThrow()
    expect(await fs.readFile(youngAsset, "utf8")).toBe("young")
    expect(await fs.readFile(path.join(oldDirectory, "nested"), "utf8")).toBe("keep")
    expect((await fs.lstat(symlink)).isSymbolicLink()).toBe(true)
    expect(await fs.readFile(outside, "utf8")).toBe("outside")
    expect(await fs.readFile(quarantinePath(quarantineDigest), "utf8")).toBe("quarantine")
  })
})

function harness(
  scans: Array<ReadonlySet<string> | Error | (() => Promise<ReadonlySet<string>>)> = [],
  maximumBytes = 1024 * 1024,
) {
  let scanIndex = 0
  const loadAllStrict = mock(async () => {
    const result = scans[scanIndex++] ?? new Set<string>()
    if (result instanceof Error) throw result
    return typeof result === "function" ? result() : result
  })
  const catalogs = {
    runCurrentCatalogMaintenance: async <T>(
      _input: { projectId: string },
      operation: (catalog: {
        canvases: Array<{ createdAt: number; id: string; name: string; updatedAt: number }>
      }) => Promise<T>,
    ) => operation({ canvases: [{ createdAt: 1, id: "canvas-main", name: "Main", updatedAt: 1 }] }),
  }
  const roots = {
    async resolveProjectRoot() {
      return projectRoot
    },
  }
  const assets = new ProjectManagedAssetStore(roots, { maximumBytes })
  return {
    gc: new ProjectAssetGc({
      assets,
      catalogs,
      documents: { loadAllStrict },
      now: () => now,
      projects: roots,
    }),
    loadAllStrict,
  }
}

async function writeBlob(content: string) {
  const digest = createHash("sha256").update(content).digest("hex")
  await fs.writeFile(blobPath(digest), content)
  return digest
}

function blobPath(digest: string) {
  return path.join(projectRoot, ".convax", "assets", "blobs", digest)
}

function quarantinePath(digest: string) {
  return path.join(projectRoot, ".convax", "assets", ".staging", `gc-delete-${digest}`)
}

function gcStatePath() {
  return path.join(projectRoot, ".convax", "assets", "gc.json")
}

async function blobExists(digest: string) {
  return fs.access(blobPath(digest)).then(
    () => true,
    () => false,
  )
}

async function quarantineExists(digest: string) {
  return fs.access(quarantinePath(digest)).then(
    () => true,
    () => false,
  )
}

async function writeState(entries: Record<string, { unreferencedSince: string }>) {
  await fs.writeFile(gcStatePath(), `${JSON.stringify({ entries, schemaVersion: 1 }, null, 2)}\n`)
}

async function readState() {
  return JSON.parse(await fs.readFile(gcStatePath(), "utf8")) as {
    entries: Record<string, { unreferencedSince: string }>
    schemaVersion: 1
  }
}

function iso(value: number) {
  return new Date(value).toISOString()
}
