import { createHash } from "node:crypto"
import { renameSync, symlinkSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { managedAssetPath, type ProjectResourceReference } from "../../canvas/project-resources"
import { ProjectManagedAssetStore, type ProjectRootResolver } from "./project-managed-asset-store"

const projectId = "project-a"

let temporaryRoot = ""
let projectRoot = ""
let externalRoot = ""
let roots: ProjectRootResolver

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-managed-assets-"))
  projectRoot = path.join(temporaryRoot, "project")
  externalRoot = path.join(temporaryRoot, "external")
  await fs.mkdir(path.join(projectRoot, ".convax", "assets"), { recursive: true })
  await fs.mkdir(externalRoot)
  roots = {
    async resolveProjectRoot(input) {
      if (input.projectId !== projectId) throw new Error(`Unknown Project: ${input.projectId}`)
      return fs.realpath(projectRoot)
    },
  }
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { force: true, recursive: true })
})

function digest(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function writeExternal(name: string, bytes: Uint8Array | string) {
  const sourcePath = path.join(externalRoot, name)
  await fs.writeFile(sourcePath, bytes)
  return sourcePath
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe("ProjectManagedAssetStore admission", () => {
  test("deduplicates equal external bytes and never retains the source path", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const firstSource = await writeExternal("first.png", pngBytes)
    const secondSource = await writeExternal("renamed.png", pngBytes)
    const store = new ProjectManagedAssetStore(roots)

    const first = await store.admitExternalFile({
      mediaType: "image/png",
      name: "first.png",
      projectId,
      sourcePath: firstSource,
    })
    const second = await store.admitExternalFile({
      mediaType: "image/png",
      name: "renamed.png",
      projectId,
      sourcePath: secondSource,
    })

    expect(first).toEqual({
      kind: "managed-asset",
      mediaType: "image/png",
      name: "first.png",
      sha256: digest(pngBytes),
    })
    expect(second).toEqual({
      kind: "managed-asset",
      mediaType: "image/png",
      name: "renamed.png",
      sha256: first.sha256,
    })
    expect(await fs.readdir(path.join(projectRoot, ".convax", "assets", "blobs"))).toEqual([first.sha256])
    expect(JSON.stringify([first, second])).not.toContain(externalRoot)
    expect(first).not.toHaveProperty("sourcePath")

    await fs.writeFile(firstSource, "changed after admission")
    expect(await fs.readFile(path.join(projectRoot, managedAssetPath(first.sha256)))).toEqual(pngBytes)
  })

  test("classifies Project-local files as direct references and copies only external files", async () => {
    const localPath = path.join(projectRoot, "Images", "local.png")
    const externalPath = await writeExternal("outside.png", "outside")
    await fs.mkdir(path.dirname(localPath), { recursive: true })
    await fs.writeFile(localPath, "local")
    const store = new ProjectManagedAssetStore(roots)

    const references = await store.withAdmittedLocalFiles(
      {
        files: [
          { mediaType: "image/png", name: "local.png", sourcePath: localPath },
          { mediaType: "image/png", name: "outside.png", sourcePath: externalPath },
        ],
        projectId,
      },
      async (value) => value,
    )

    expect(references[0]).toEqual({ kind: "project-file", path: "Images/local.png" })
    expect(references[1]).toEqual({
      kind: "managed-asset",
      mediaType: "image/png",
      name: "outside.png",
      sha256: digest("outside"),
    })
    expect(await fs.readdir(path.join(projectRoot, ".convax", "assets", "blobs"))).toEqual([digest("outside")])
    expect(JSON.stringify(references)).not.toContain(temporaryRoot)
  })

  test("publishes concurrent equal imports once without clobbering either reference", async () => {
    const bytes = Buffer.from("shared bytes")
    const firstSource = await writeExternal("first.bin", bytes)
    const secondSource = await writeExternal("second.bin", bytes)
    const firstStore = new ProjectManagedAssetStore(roots, { randomId: () => "first-operation" })
    const secondStore = new ProjectManagedAssetStore(roots, { randomId: () => "second-operation" })

    const [first, second] = await Promise.all([
      firstStore.admitExternalFile({ name: "first.bin", projectId, sourcePath: firstSource }),
      secondStore.admitExternalFile({ name: "second.bin", projectId, sourcePath: secondSource }),
    ])

    expect(first.sha256).toBe(second.sha256)
    expect(first.name).toBe("first.bin")
    expect(second.name).toBe("second.bin")
    expect(await fs.readdir(path.join(projectRoot, ".convax", "assets", "blobs"))).toEqual([digest(bytes)])
  })

  test("rejects Project-local, directory, and final-symlink sources", async () => {
    const store = new ProjectManagedAssetStore(roots)
    const insideSource = path.join(projectRoot, "inside.txt")
    const directorySource = path.join(externalRoot, "directory")
    const outsideTarget = await writeExternal("target.txt", "target")
    const symlinkSource = path.join(externalRoot, "link.txt")
    await fs.writeFile(insideSource, "inside")
    await fs.mkdir(directorySource)
    await fs.symlink(outsideTarget, symlinkSource)

    await expect(
      store.admitExternalFile({
        name: "inside.txt",
        projectId,
        sourcePath: insideSource,
      }),
    ).rejects.toThrow(/inside|Project/i)
    await expect(
      store.admitExternalFile({
        name: "directory",
        projectId,
        sourcePath: directorySource,
      }),
    ).rejects.toThrow(/regular file|directory/i)
    await expect(
      store.admitExternalFile({
        name: "link.txt",
        projectId,
        sourcePath: symlinkSource,
      }),
    ).rejects.toThrow(/symbolic link|symlink/i)
  })

  test("fails closed on a corrupt digest winner and removes only its own staging file", async () => {
    const bytes = Buffer.from("expected bytes")
    const expectedDigest = digest(bytes)
    const sourcePath = await writeExternal("asset.bin", bytes)
    const blobs = path.join(projectRoot, ".convax", "assets", "blobs")
    const staging = path.join(projectRoot, ".convax", "assets", ".staging")
    await fs.mkdir(blobs, { recursive: true })
    await fs.mkdir(staging, { recursive: true })
    await fs.writeFile(path.join(blobs, expectedDigest), "corrupt existing bytes")
    await fs.writeFile(path.join(staging, "foreign-operation"), "not ours")
    const store = new ProjectManagedAssetStore(roots, { randomId: () => "our-operation" })

    await expect(
      store.admitExternalFile({
        name: "asset.bin",
        projectId,
        sourcePath,
      }),
    ).rejects.toThrow(/digest|hash|corrupt/i)

    expect(await fs.readFile(path.join(blobs, expectedDigest), "utf8")).toBe("corrupt existing bytes")
    expect(await fs.readdir(staging)).toEqual(["foreign-operation"])
  })

  test("enforces the streamed size ceiling and cleans its staging file", async () => {
    const sourcePath = await writeExternal("too-large.bin", Buffer.alloc(17, 0x61))
    const store = new ProjectManagedAssetStore(roots, {
      maximumBytes: 16,
      randomId: () => "oversized-operation",
    })

    await expect(
      store.admitExternalFile({
        name: "too-large.bin",
        projectId,
        sourcePath,
      }),
    ).rejects.toThrow(/large|maximum|size/i)

    expect(await fs.readdir(path.join(projectRoot, ".convax", "assets", ".staging"))).toEqual([])
    expect(await fs.readdir(path.join(projectRoot, ".convax", "assets", "blobs"))).toEqual([])
  })

  for (const privateDirectory of [".staging", "blobs"] as const) {
    test(`fails closed when the managed ${privateDirectory} directory is replaced after layout resolution`, async () => {
      const sourcePath = await writeExternal("asset.bin", "asset")
      const assetRoot = path.join(projectRoot, ".convax", "assets")
      const targetDirectory = path.join(assetRoot, privateDirectory)
      const movedDirectory = path.join(assetRoot, `${privateDirectory}-moved`)
      const outsideDirectory = path.join(temporaryRoot, `${privateDirectory}-outside`)
      await fs.mkdir(path.join(assetRoot, "blobs"), { recursive: true })
      await fs.mkdir(path.join(assetRoot, ".staging"), { recursive: true })
      await fs.mkdir(outsideDirectory)
      const store = new ProjectManagedAssetStore(roots, {
        randomId: () => {
          renameSync(targetDirectory, movedDirectory)
          symlinkSync(outsideDirectory, targetDirectory, process.platform === "win32" ? "junction" : "dir")
          return "replaced-parent-operation"
        },
      })

      await expect(store.admitExternalFile({ name: "asset.bin", projectId, sourcePath })).rejects.toThrow(
        /changed|symbolic link|directory/i,
      )

      expect(await fs.readdir(outsideDirectory)).toEqual([])
      expect(await fs.readdir(movedDirectory)).toEqual([])
    })
  }
})

describe("ProjectManagedAssetStore mutex", () => {
  test("serializes one Project in FIFO order and continues after a failure", async () => {
    const store = new ProjectManagedAssetStore(roots)
    const firstEntered = deferred()
    const releaseFirst = deferred()
    const events: string[] = []
    let active = 0
    let maximumActive = 0
    const enter = (name: string) => {
      events.push(`${name}:start`)
      active += 1
      maximumActive = Math.max(maximumActive, active)
    }
    const leave = (name: string) => {
      active -= 1
      events.push(`${name}:end`)
    }

    const first = store.runExclusive(projectId, async () => {
      enter("first")
      firstEntered.resolve()
      await releaseFirst.promise
      leave("first")
    })
    await firstEntered.promise
    const second = store.runExclusive(projectId, async () => {
      enter("second")
      leave("second")
      throw new Error("expected failure")
    })
    const third = store.runExclusive(projectId, async () => {
      enter("third")
      leave("third")
    })

    await Promise.resolve()
    expect(events).toEqual(["first:start"])
    releaseFirst.resolve()
    await first
    await expect(second).rejects.toThrow("expected failure")
    await third

    expect(maximumActive).toBe(1)
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end", "third:start", "third:end"])
  })

  test("allows different Projects to overlap", async () => {
    const otherProjectRoot = path.join(temporaryRoot, "other-project")
    await fs.mkdir(path.join(otherProjectRoot, ".convax", "assets"), { recursive: true })
    roots = {
      async resolveProjectRoot(input) {
        return fs.realpath(input.projectId === projectId ? projectRoot : otherProjectRoot)
      },
    }
    const store = new ProjectManagedAssetStore(roots)
    const bothEntered = deferred()
    const release = deferred()
    let active = 0
    let maximumActive = 0
    const operation = async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      if (active === 2) bothEntered.resolve()
      await release.promise
      active -= 1
    }

    const first = store.runExclusive(projectId, operation)
    const second = store.runExclusive("project-b", operation)
    await bothEntered.promise
    expect(maximumActive).toBe(2)
    release.resolve()
    await Promise.all([first, second])
  })
})

describe("ProjectManagedAssetStore verification", () => {
  test("allows nested verification without releasing the admission lock", async () => {
    const sourcePath = await writeExternal("nested.txt", "nested")
    const store = new ProjectManagedAssetStore(roots)
    const nestedEntered = deferred()
    const releaseNested = deferred()
    const queuedEntered = deferred()
    let admissionSettled = false

    const admission = store.withAdmittedLocalFiles(
      {
        files: [{ name: "nested.txt", sourcePath }],
        projectId,
      },
      async (references) => {
        const managed = references.filter((reference) => reference.kind === "managed-asset")
        if (managed.length !== references.length) throw new Error("Expected only external managed assets")
        void store.withVerifiedReferences({ projectId, references: managed }, async () => {
          nestedEntered.resolve()
          await releaseNested.promise
        })
        return references
      },
    )
    void admission.then(() => {
      admissionSettled = true
    })

    await nestedEntered.promise
    const queued = store.runExclusive(projectId, async () => {
      queuedEntered.resolve()
    })
    let queuedRan = false
    void queuedEntered.promise.then(() => {
      queuedRan = true
    })
    await Promise.resolve()
    expect(admissionSettled).toBe(false)
    expect(queuedRan).toBe(false)

    releaseNested.resolve()
    const references = await admission
    await queued
    expect(references).toHaveLength(1)
    expect(queuedRan).toBe(true)
  })

  test("does not let an escaped async context bypass a later lock", async () => {
    const store = new ProjectManagedAssetStore(roots)
    const triggerEscapedVerification = deferred()
    const escapedEntered = deferred()
    const blockerEntered = deferred()
    const releaseBlocker = deferred()
    let escaped!: Promise<void>

    await store.runExclusive(projectId, async () => {
      escaped = triggerEscapedVerification.promise.then(() =>
        store.withVerifiedReferences({ projectId, references: [] }, async () => {
          escapedEntered.resolve()
        }),
      )
    })

    const blocker = store.runExclusive(projectId, async () => {
      blockerEntered.resolve()
      await releaseBlocker.promise
    })
    await blockerEntered.promise
    triggerEscapedVerification.resolve()
    let escapedRan = false
    void escapedEntered.promise.then(() => {
      escapedRan = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(escapedRan).toBe(false)

    releaseBlocker.resolve()
    await blocker
    await escaped
    expect(escapedRan).toBe(true)
  })

  test("fails fast for every non-verification re-entry on an active lock context", async () => {
    const store = new ProjectManagedAssetStore(roots)
    let nested: Promise<void> | undefined

    await expect(
      store.runExclusive(projectId, async () => {
        nested = store.runExclusive(projectId, async () => {})
        const outcome = await Promise.race([
          nested.then(
            () => "resolved",
            (error: unknown) => (error instanceof Error ? error.message : String(error)),
          ),
          new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 25)),
        ])
        if (outcome === "timed out") throw new Error("Nested Project asset lock did not fail fast")
        expect(outcome).toContain("withVerifiedReferences")
      }),
    ).resolves.toBeUndefined()
    if (!nested) throw new Error("Nested Project asset lock was not attempted")
    await expect(nested).rejects.toThrow("withVerifiedReferences")
  })

  test("fails fast instead of cycling when active Projects cross-request each other", async () => {
    const store = new ProjectManagedAssetStore(roots)
    const bothEntered = deferred()
    let entered = 0
    const crossRequest = (project: string, otherProject: string) =>
      store.runExclusive(project, async () => {
        entered += 1
        if (entered === 2) bothEntered.resolve()
        await bothEntered.promise
        const outcome = await Promise.race([
          store
            .runExclusive(otherProject, async () => {})
            .then(
              () => "resolved",
              (error: unknown) => (error instanceof Error ? error.message : String(error)),
            ),
          new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 25)),
        ])
        if (outcome === "timed out") throw new Error("Cross-Project asset locks formed a cycle")
        expect(outcome).toContain("active Project asset lock")
      })

    await expect(
      Promise.all([crossRequest("project-a", "project-b"), crossRequest("project-b", "project-a")]),
    ).resolves.toEqual([undefined, undefined])
  })

  test("preserves an awaited nested verification rejection by identity", async () => {
    const store = new ProjectManagedAssetStore(roots)
    const sentinel = new Error("storage conflict sentinel")

    await expect(
      store.runExclusive(projectId, async () => {
        await store.withVerifiedReferences({ projectId, references: [] }, async () => {
          throw sentinel
        })
      }),
    ).rejects.toBe(sentinel)
  })

  test("does not revive a nested verification rejection caught by the application", async () => {
    const store = new ProjectManagedAssetStore(roots)
    const sentinel = new Error("retryable storage conflict")

    const result = await store.runExclusive(projectId, async () => {
      try {
        await store.withVerifiedReferences({ projectId, references: [] }, async () => {
          throw sentinel
        })
      } catch (error) {
        expect(error).toBe(sentinel)
      }
      return "retried successfully"
    })

    expect(result).toBe("retried successfully")
  })

  test("resolve and withVerifiedReferences re-hash blobs and reject tampering and symlinks", async () => {
    const sourcePath = await writeExternal("asset.bin", "original")
    const store = new ProjectManagedAssetStore(roots)
    const reference = await store.admitExternalFile({
      name: "asset.bin",
      projectId,
      sourcePath,
    })
    const blobPath = path.join(projectRoot, managedAssetPath(reference.sha256))
    expect(await store.resolve({ projectId, reference })).toBe(
      path.join(await fs.realpath(projectRoot), managedAssetPath(reference.sha256)),
    )

    await fs.writeFile(blobPath, "tampered")
    let committed = false
    await expect(store.resolve({ projectId, reference })).rejects.toThrow(/digest|hash|corrupt/i)
    await expect(
      store.withVerifiedReferences({ projectId, references: [reference] }, async () => {
        committed = true
      }),
    ).rejects.toThrow(/digest|hash|corrupt/i)
    expect(committed).toBe(false)

    await fs.rm(blobPath)
    const outside = await writeExternal("outside.bin", "original")
    await fs.symlink(outside, blobPath)
    await expect(store.resolve({ projectId, reference })).rejects.toThrow(/symbolic link|symlink/i)
  })

  test("keeps batch admission and its commit callback inside the same Project lock", async () => {
    const firstSource = await writeExternal("first.txt", "first")
    const secondSource = await writeExternal("second.txt", "second")
    const store = new ProjectManagedAssetStore(roots)
    const callbackEntered = deferred()
    const releaseCallback = deferred()
    const queuedEntered = deferred()

    const admitted = store.withAdmittedLocalFiles(
      {
        files: [
          { mediaType: "text/plain", name: "first.txt", sourcePath: firstSource },
          { name: "second.txt", sourcePath: secondSource },
        ],
        projectId,
      },
      async (references) => {
        if (references.some((reference) => reference.kind !== "managed-asset")) {
          throw new Error("Expected only external managed assets")
        }
        const managed = references as Array<Extract<ProjectResourceReference, { kind: "managed-asset" }>>
        expect(managed.map((reference) => reference.name)).toEqual(["first.txt", "second.txt"])
        expect(references[0]).toHaveProperty("mediaType", "text/plain")
        expect(JSON.stringify(references)).not.toContain(externalRoot)
        callbackEntered.resolve()
        await releaseCallback.promise
        return references
      },
    )

    await callbackEntered.promise
    const queued = store.runExclusive(projectId, async () => {
      queuedEntered.resolve()
    })
    await Promise.resolve()
    let queuedRan = false
    void queuedEntered.promise.then(() => {
      queuedRan = true
    })
    await Promise.resolve()
    expect(queuedRan).toBe(false)

    releaseCallback.resolve()
    const references = await admitted
    await queued
    expect(references).toHaveLength(2)
    expect(queuedRan).toBe(true)
  })
})
