import { afterEach, describe, expect, mock, test } from "bun:test"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { CanvasExternalMediaDragRequest } from "../canvas-external-drag-contracts"
import { CanvasExternalMediaDragService } from "./canvas-external-media-drag-service"
import type { ResolvedManagedCanvasMedia } from "./managed-canvas-media-resolver"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

const request: CanvasExternalMediaDragRequest = {
  expectedRevision: 4,
  nodeIds: ["one", "two"],
  ref: { canvasId: "canvas-1", scopeId: "project-1" },
}

async function temporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-external-drag-test-"))
  temporaryRoots.push(root)
  return root
}

async function waitForMissing(target: string, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    try {
      await fs.stat(target)
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return
      throw error
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${target} to be removed`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function resolvedMedia(
  source: string,
  input: Partial<Pick<ResolvedManagedCanvasMedia, "kind" | "mimeType" | "name" | "resourcePath">> = {},
): Promise<ResolvedManagedCanvasMedia> {
  const stat = await fs.lstat(source)
  return {
    identity: {
      ctimeMs: stat.ctimeMs,
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    },
    kind: input.kind ?? "audio",
    mimeType: input.mimeType ?? "audio/mpeg",
    name: input.name ?? path.basename(source),
    path: source,
    resourcePath: input.resourcePath ?? `.convax/assets/${path.basename(source)}`,
    size: stat.size,
  }
}

describe("CanvasExternalMediaDragService", () => {
  test("stages collision-safe host copies, falls back from cloning, and consumes a sender ticket once", async () => {
    const root = await temporaryRoot()
    const sourceA = path.join(root, "a", "clip.mp3")
    const sourceB = path.join(root, "b", "clip.mp3")
    await fs.mkdir(path.dirname(sourceA), { recursive: true })
    await fs.mkdir(path.dirname(sourceB), { recursive: true })
    await fs.writeFile(sourceA, "first")
    await fs.writeFile(sourceB, "second")
    const media = [await resolvedMedia(sourceA), await resolvedMedia(sourceB)]
    const copyModes: number[] = []
    const createIcon = mock(async () => "material-preview")
    const service = new CanvasExternalMediaDragService({
      copyFile: async (source, destination, mode = 0) => {
        copyModes.push(mode)
        if (mode & fsConstants.COPYFILE_FICLONE_FORCE) {
          throw Object.assign(new Error("clone unsupported"), { code: "ENOTSUP" })
        }
        await fs.copyFile(source, destination, mode)
      },
      createIcon,
      media: { resolve: mock(async () => media) },
      postDragRetentionMs: 0,
      stagingRoot: path.join(root, "staging"),
      ticketTtlMs: 60_000,
    })

    const prepared = await service.prepare(7, request)
    expect(prepared.itemCount).toBe(2)
    expect(prepared.ticket).toMatch(/^drag_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(copyModes.filter((mode) => mode & fsConstants.COPYFILE_FICLONE_FORCE)).toHaveLength(2)
    expect(() => service.consume(8, prepared.ticket)).toThrow("unavailable")
    const lease = service.consume(7, prepared.ticket)
    expect(lease.files.map((file) => path.basename(file))).toEqual(["clip.mp3", "clip 2.mp3"])
    expect(createIcon).toHaveBeenCalledWith({
      file: lease.file,
      itemCount: 2,
      signal: undefined,
    })
    expect(lease.icon).toBe("material-preview")
    expect(await Promise.all(lease.files.map((file) => fs.readFile(file, "utf8")))).toEqual(["first", "second"])
    expect(() => service.consume(7, prepared.ticket)).toThrow("unavailable")
    lease.release()
    await waitForMissing(lease.files[0]!)
    await service.dispose()
  })

  test("reconciles only crash-orphan directories and rejects a symlink staging root", async () => {
    const root = await temporaryRoot()
    const stagingRoot = path.join(root, "staging")
    const orphan = path.join(stagingRoot, "selection-orphan")
    const unrelated = path.join(stagingRoot, "keep-me")
    await fs.mkdir(orphan, { recursive: true })
    await fs.mkdir(unrelated, { recursive: true })
    await fs.writeFile(path.join(orphan, "large.mp4"), "orphan")
    await fs.writeFile(path.join(unrelated, "owner.txt"), "keep")
    const service = new CanvasExternalMediaDragService({
      media: { resolve: mock(async () => []) },
      stagingRoot,
    })
    await service.initialize()
    await expect(fs.stat(orphan)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(fs.readFile(path.join(unrelated, "owner.txt"), "utf8")).resolves.toBe("keep")
    await service.dispose()

    const target = path.join(root, "target")
    const linked = path.join(root, "linked-staging")
    await fs.mkdir(target)
    await fs.symlink(target, linked)
    const unsafe = new CanvasExternalMediaDragService({
      media: { resolve: mock(async () => []) },
      stagingRoot: linked,
    })
    await expect(unsafe.initialize()).rejects.toThrow("real directory")
    await expect(unsafe.dispose()).resolves.toBeUndefined()
  })

  test("fails closed when a validated source is replaced before staging and cleans on cancel", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "source.mp3")
    await fs.writeFile(source, "first")
    const stale = await resolvedMedia(source)
    await fs.rm(source)
    await fs.writeFile(source, "other")
    const changed = new CanvasExternalMediaDragService({
      media: { resolve: mock(async () => [stale]) },
      stagingRoot: path.join(root, "changed-staging"),
    })
    await expect(changed.prepare(1, { ...request, nodeIds: ["one"] })).rejects.toThrow("changed before")
    await changed.dispose()

    const current = await resolvedMedia(source)
    const canceled = new CanvasExternalMediaDragService({
      media: { resolve: mock(async () => [current]) },
      stagingRoot: path.join(root, "cancel-staging"),
    })
    const prepared = await canceled.prepare(1, { ...request, nodeIds: ["one"] })
    const stagedRoot = path.dirname(canceled.consume(1, prepared.ticket).file)
    // Prepare another ticket so cancellation, rather than consumption, owns cleanup.
    const second = await canceled.prepare(1, { ...request, nodeIds: ["one"] })
    await canceled.cancel(2, second.ticket)
    expect(() => canceled.consume(1, second.ticket)).not.toThrow()
    const third = await canceled.prepare(1, { ...request, nodeIds: ["one"] })
    await canceled.cancel(1, third.ticket)
    expect(() => canceled.consume(1, third.ticket)).toThrow("unavailable")
    await canceled.dispose()
    await expect(fs.stat(stagedRoot)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("aborts an in-flight fallback copy and removes its partial staging directory", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "large.mp4")
    await fs.writeFile(source, "video")
    const media = await resolvedMedia(source, { kind: "video", mimeType: "video/mp4" })
    let fallbackStarted!: () => void
    const didStartFallback = new Promise<void>((resolve) => {
      fallbackStarted = resolve
    })
    const service = new CanvasExternalMediaDragService({
      copyFile: async (_source, _destination, mode = 0, signal) => {
        if (mode & fsConstants.COPYFILE_FICLONE_FORCE) {
          throw Object.assign(new Error("clone unsupported"), { code: "ENOTSUP" })
        }
        fallbackStarted()
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Canceled", "AbortError")), {
            once: true,
          })
        })
      },
      media: { resolve: mock(async () => [media]) },
      stagingRoot: path.join(root, "staging"),
    })
    const controller = new AbortController()
    const preparing = service.prepare(1, { ...request, nodeIds: ["one"] }, controller.signal)
    await didStartFallback
    controller.abort(new DOMException("Canceled", "AbortError"))
    await expect(preparing).rejects.toMatchObject({ name: "AbortError" })
    expect(await fs.readdir(path.join(root, "staging"))).toEqual([])
    await service.dispose()
  })

  test("aborts material preview creation and removes the staged selection", async () => {
    const root = await temporaryRoot()
    const source = path.join(root, "image.png")
    await fs.writeFile(source, "image")
    const media = await resolvedMedia(source, { kind: "image", mimeType: "image/png" })
    let previewStarted!: () => void
    const didStartPreview = new Promise<void>((resolve) => {
      previewStarted = resolve
    })
    const service = new CanvasExternalMediaDragService({
      createIcon: async ({ signal }) => {
        previewStarted()
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Canceled", "AbortError")), {
            once: true,
          })
        })
        return "not-reached"
      },
      media: { resolve: mock(async () => [media]) },
      stagingRoot: path.join(root, "staging"),
    })
    const controller = new AbortController()
    const preparing = service.prepare(1, { ...request, nodeIds: ["one"] }, controller.signal)
    await didStartPreview

    controller.abort(new DOMException("Canceled", "AbortError"))
    await expect(preparing).rejects.toMatchObject({ name: "AbortError" })
    expect(await fs.readdir(path.join(root, "staging"))).toEqual([])
    await service.dispose()
  })

  test("dispose waits for initialization and removes an empty private root", async () => {
    const root = await temporaryRoot()
    const stagingRoot = path.join(root, "staging")
    const service = new CanvasExternalMediaDragService({
      media: { resolve: mock(async () => []) },
      stagingRoot,
    })
    const initialization = service.initialize()
    const disposal = service.dispose()
    await Promise.all([initialization, disposal])
    await expect(fs.stat(stagingRoot)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(service.initialize()).rejects.toThrow("disposed")
  })
})
