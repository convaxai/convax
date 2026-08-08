import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, mock, test } from "bun:test"

import { ProjectFilePreviewService } from "./project-file-preview-service"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

test("streams an explicitly hovered file with HTTP ranges without a file-size cutoff and revokes it on close", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-preview-"))
  roots.push(root)
  const file = path.join(root, "large.mp4")
  const size = 70 * 1024 * 1024
  const handle = await fs.open(file, "w")
  await handle.truncate(size)
  await handle.write(Buffer.from([1, 2, 3, 4]), 0, 4, size - 4)
  await handle.close()
  const service = previewService(file, "video/mp4")

  const lease = await service.open({ path: "Media/large.mp4", projectId: "project-one" }, 7)
  const response = await service.handle(new Request(lease.url, { headers: { Range: `bytes=${size - 4}-${size - 1}` } }))

  expect(response.status).toBe(206)
  expect(response.headers.get("content-range")).toBe(`bytes ${size - 4}-${size - 1}/${size}`)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3, 4]))
  expect(service.close({ leaseId: lease.leaseId }, 7)).toBeTrue()
  expect((await service.handle(new Request(lease.url))).status).toBe(404)
  service.dispose()
})

test("allows the exact file renderer to decode and capture a hovered video frame", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-preview-cors-"))
  roots.push(root)
  const file = path.join(root, "clip.mp4")
  await fs.writeFile(file, "video")
  const service = previewService(file, "video/mp4")
  const lease = await service.open({ path: "Media/clip.mp4", projectId: "project-one" }, 7)

  const response = await service.handle(
    new Request(lease.url, {
      headers: { Origin: "null", Referer: "file:///renderer/index.html" },
    }),
  )

  expect(response.status).toBe(200)
  expect(response.headers.get("access-control-allow-origin")).toBe("null")
  service.dispose()
})

test("keeps only one preview lease per renderer and returns a small image thumbnail separately", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-thumbnail-"))
  roots.push(root)
  const file = path.join(root, "clip.mp4")
  await fs.writeFile(file, "video")
  const resize = mock(() => ({
    getSize: () => ({ height: 40, width: 40 }),
    isEmpty: () => false,
    resize,
    toDataURL: () => "data:image/png;base64,small",
  }))
  const thumbnail = {
    getSize: () => ({ height: 80, width: 80 }),
    isEmpty: () => false,
    resize,
    toDataURL: () => "unused",
  }
  const createFromPath = mock(() => thumbnail)
  const service = previewService(file, "image/png", { createFromPath })

  const first = await service.open({ path: "Media/clip.mp4", projectId: "project-one" }, 7)
  const second = await service.open({ path: "Media/clip.mp4", projectId: "project-one" }, 7)
  expect((await service.handle(new Request(first.url))).status).toBe(404)
  expect((await service.handle(new Request(second.url, { method: "HEAD" }))).status).toBe(200)
  await expect(service.thumbnail({ path: "Media/clip.mp4", projectId: "project-one" })).resolves.toEqual({
    dataUrl: "data:image/png;base64,small",
  })
  expect(createFromPath).toHaveBeenCalledWith(file)
  expect(resize).toHaveBeenCalledWith({ height: 40, quality: "better", width: 40 })
  service.dispose()
})

test("opens bounded video-thumbnail streams independently from the hover preview", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-thumbnail-timeout-"))
  roots.push(root)
  const file = path.join(root, "large.mp4")
  const handle = await fs.open(file, "w")
  await handle.truncate(9 * 1024 * 1024)
  await handle.close()
  const createFromPath = mock(() => {
    throw new Error("video thumbnails must be captured by Chromium")
  })
  const service = previewService(file, "video/mp4", { createFromPath })

  await expect(
    service.open(
      { path: "Media/large.mp4", projectId: "project-one", purpose: "invalid" as "thumbnail" },
      7,
    ),
  ).rejects.toThrow("purpose is invalid")
  await expect(service.thumbnail({ path: "Media/large.mp4", projectId: "project-one" })).resolves.toEqual({
    dataUrl: null,
  })
  const firstThumbnail = await service.open(
    { path: "Media/large.mp4", projectId: "project-one", purpose: "thumbnail" },
    7,
  )
  const secondThumbnail = await service.open(
    { path: "Media/large.mp4", projectId: "project-one", purpose: "thumbnail" },
    7,
  )
  await expect(
    service.open({ path: "Media/large.mp4", projectId: "project-one", purpose: "thumbnail" }, 7),
  ).rejects.toThrow("thumbnail concurrency limit")

  const firstPreview = await service.open(
    { path: "Media/large.mp4", projectId: "project-one", purpose: "preview" },
    7,
  )
  const secondPreview = await service.open(
    { path: "Media/large.mp4", projectId: "project-one", purpose: "preview" },
    7,
  )
  expect((await service.handle(new Request(firstThumbnail.url, { method: "HEAD" }))).status).toBe(200)
  expect((await service.handle(new Request(secondThumbnail.url, { method: "HEAD" }))).status).toBe(200)
  expect((await service.handle(new Request(firstPreview.url, { method: "HEAD" }))).status).toBe(404)
  expect((await service.handle(new Request(secondPreview.url, { method: "HEAD" }))).status).toBe(200)
  expect(createFromPath).not.toHaveBeenCalled()
  service.dispose()
})

function previewService(
  file: string,
  mimeType: string,
  images: Partial<ConstructorParameters<typeof ProjectFilePreviewService>[0]["images"]> = {},
) {
  const empty = {
    getSize: () => ({ height: 0, width: 0 }),
    isEmpty: () => true,
    resize: () => empty,
    toDataURL: () => "",
  }
  return new ProjectFilePreviewService({
    images: {
      createFromPath: images.createFromPath ?? (() => empty),
    },
    projects: {
      async readFileInfo() {
        return { mimeType }
      },
      async resolveEntryPath() {
        return file
      },
    },
    trustedRendererUrl: "file:///renderer/index.html",
  })
}
