import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NodeProjectManager } from "./project-manager"
import { ProjectManagedAssetStore } from "./project-canvas/project-managed-asset-store"
import { ProjectResourceReader, type ProjectResourceReadResult } from "./project-resource-reader"

let temporaryRoot = ""
let projectRoot = ""
let projectId = ""
let manager: NodeProjectManager
let assets: ProjectManagedAssetStore
let reader: ProjectResourceReader

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-resource-reader-"))
  projectRoot = path.join(temporaryRoot, "project")
  await fs.mkdir(projectRoot)
  manager = new NodeProjectManager({
    registryFile: path.join(temporaryRoot, "user-data", "projects.json"),
  })
  projectId = (await manager.addProject(projectRoot)).id
  assets = new ProjectManagedAssetStore(manager, { maximumBytes: 1024 })
  reader = new ProjectResourceReader(manager, assets, { maximumProjectFileBytes: 1024 })
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { force: true, recursive: true })
})

describe("ProjectResourceReader", () => {
  test("rejects an old Project-file revision after same-path replacement", async () => {
    const target = path.join(projectRoot, "clip.mp4")
    const oldBytes = Buffer.from("old-project-file")
    await fs.writeFile(target, oldBytes)
    const contentRevision = digest(oldBytes)
    await fs.rename(target, path.join(projectRoot, "old-clip.mp4"))
    await fs.writeFile(target, "new-project-file")

    await expect(
      reader.read({
        contentRevision,
        projectId,
        reference: { kind: "project-file", path: "clip.mp4" },
      }),
    ).rejects.toThrow(/revision|digest/i)
  })

  test("streams the verified handle rather than a replacement pathname", async () => {
    const target = path.join(projectRoot, "clip.mp4")
    const original = Buffer.from("0123456789")
    await fs.writeFile(target, original)

    const result = await reader.read({
      contentRevision: digest(original),
      projectId,
      range: "bytes=2-6",
      reference: { kind: "project-file", path: "clip.mp4" },
    })
    expect(result).toMatchObject({
      contentLength: 5,
      contentRange: { end: 6, start: 2 },
      kind: "project-file",
      mediaType: "video/mp4",
      size: 10,
      status: "ready",
    })
    expect(result).not.toHaveProperty("absolutePath")

    await fs.rename(target, path.join(projectRoot, "original-clip.mp4"))
    await fs.writeFile(target, "abcdefghij")

    expect(await readBody(result)).toEqual(original.subarray(2, 7))
  })

  test("fails closed when a Project path becomes a symlink even if its bytes match the revision", async () => {
    const target = path.join(projectRoot, "clip.mp4")
    const outside = path.join(temporaryRoot, "outside.mp4")
    const bytes = Buffer.from("same bytes")
    await fs.writeFile(target, bytes)
    const contentRevision = digest(bytes)
    await fs.rm(target)
    await fs.writeFile(outside, bytes)
    await fs.symlink(outside, target)

    await expect(
      reader.read({
        contentRevision,
        projectId,
        reference: { kind: "project-file", path: "clip.mp4" },
      }),
    ).rejects.toThrow(/symbolic link|symlink/i)
  })

  test("rejects a symlink installed after Project resolution but before native open", async () => {
    const target = path.join(projectRoot, "clip.mp4")
    const outside = path.join(temporaryRoot, "outside.mp4")
    const bytes = Buffer.from("same bytes")
    await fs.writeFile(target, bytes)
    await fs.writeFile(outside, bytes)
    const racingReader = new ProjectResourceReader(
      {
        async resolveEntryPath(input) {
          const resolved = await manager.resolveEntryPath(input)
          await fs.rm(target)
          await fs.symlink(outside, target)
          return resolved
        },
      },
      assets,
      { maximumProjectFileBytes: 1024 },
    )

    await expect(
      racingReader.read({
        contentRevision: digest(bytes),
        projectId,
        reference: { kind: "project-file", path: "clip.mp4" },
      }),
    ).rejects.toThrow(/regular file|symbolic link|symlink/i)
  })

  test("keeps managed assets bound to their digest and never returns a native path", async () => {
    const outside = path.join(temporaryRoot, "outside.png")
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    await fs.writeFile(outside, bytes)
    const reference = await assets.admitExternalFile({
      mediaType: "image/png",
      name: "outside.png",
      projectId,
      sourcePath: outside,
    })

    const result = await reader.read({ projectId, reference })
    expect(result).toMatchObject({
      contentLength: bytes.byteLength,
      kind: "managed-asset",
      mediaType: "image/png",
      size: bytes.byteLength,
      status: "ready",
    })
    expect(result).not.toHaveProperty("absolutePath")
    expect(await readBody(result)).toEqual(bytes)

    await fs.writeFile(path.join(projectRoot, ".convax", "assets", "blobs", reference.sha256), "tampered")
    await expect(reader.read({ projectId, reference })).rejects.toThrow(/digest/i)
  })

  test("rejects a managed-asset symlink installed after URL issuance but before native open", async () => {
    const outside = path.join(temporaryRoot, "outside.png")
    const replacement = path.join(temporaryRoot, "replacement.png")
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    await fs.writeFile(outside, bytes)
    await fs.writeFile(replacement, bytes)
    const reference = await assets.admitExternalFile({
      mediaType: "image/png",
      name: "outside.png",
      projectId,
      sourcePath: outside,
    })
    const blob = path.join(projectRoot, ".convax", "assets", "blobs", reference.sha256)
    await fs.rename(blob, `${blob}.replaced`)
    await fs.symlink(replacement, blob)

    await expect(reader.read({ projectId, reference })).rejects.toThrow(/regular file|symbolic link|symlink/i)
  })

  test("handles HEAD, suffix Range, empty files, and unsatisfiable Range without opening a second path", async () => {
    const bytes = Buffer.from("0123456789")
    await fs.writeFile(path.join(projectRoot, "clip.mp4"), bytes)
    const input = {
      contentRevision: digest(bytes),
      projectId,
      reference: { kind: "project-file" as const, path: "clip.mp4" },
    }

    const head = await reader.read({ ...input, head: true })
    expect(head).toMatchObject({ body: null, contentLength: 10, size: 10, status: "ready" })

    const suffix = await reader.read({ ...input, range: "bytes=-3" })
    expect(suffix).toMatchObject({
      contentLength: 3,
      contentRange: { end: 9, start: 7 },
      status: "ready",
    })
    expect(await readBody(suffix)).toEqual(Buffer.from("789"))

    const unsatisfiable = await reader.read({ ...input, range: "bytes=10-11" })
    expect(unsatisfiable).toEqual({
      kind: "project-file",
      mediaType: "video/mp4",
      size: 10,
      status: "range-not-satisfiable",
    })

    const empty = Buffer.alloc(0)
    await fs.writeFile(path.join(projectRoot, "empty.mp4"), empty)
    const emptyResult = await reader.read({
      contentRevision: digest(empty),
      projectId,
      reference: { kind: "project-file", path: "empty.mp4" },
    })
    expect(emptyResult).toMatchObject({ body: null, contentLength: 0, size: 0, status: "ready" })
  })

  test("closes the same handle on cancellation before the request, before the first pull, or while streaming", async () => {
    const bytes = Buffer.alloc(256, 7)
    await fs.writeFile(path.join(projectRoot, "clip.mp4"), bytes)
    const input = {
      contentRevision: digest(bytes),
      projectId,
      reference: { kind: "project-file" as const, path: "clip.mp4" },
    }

    const before = new AbortController()
    before.abort(new DOMException("read canceled", "AbortError"))
    await expect(reader.read({ ...input, signal: before.signal })).rejects.toMatchObject({ name: "AbortError" })

    const after = new AbortController()
    const result = await reader.read({ ...input, signal: after.signal })
    after.abort(new DOMException("stream canceled", "AbortError"))
    await expect(readBody(result)).rejects.toMatchObject({ name: "AbortError" })

    const beforePull = await reader.read(input)
    if (beforePull.status !== "ready" || !beforePull.body) throw new Error("Expected a readable Project resource")
    await beforePull.body.cancel("not consumed")
  })

  test("rejects Windows drive, UNC, backslash, and alternate-stream paths before native resolution", async () => {
    for (const portablePath of [
      "C:/outside.mp4",
      "//server/share/outside.mp4",
      "Media\\outside.mp4",
      "Media/outside.mp4:stream",
    ]) {
      await expect(
        reader.read({
          contentRevision: "a".repeat(64),
          projectId,
          reference: { kind: "project-file", path: portablePath },
        }),
      ).rejects.toThrow()
    }
  })
})

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function readBody(result: ProjectResourceReadResult) {
  if (result.status !== "ready" || !result.body) throw new Error("Project resource result has no body")
  return Buffer.from(await new Response(result.body).arrayBuffer())
}
