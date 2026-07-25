import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createCanvasDocument, createMediaNode } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"

import { JianyingCanvasService } from "./jianying-canvas-service"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function setup(
  resolveEntryPath: (input: { path: string; projectId: string }) => Promise<string> = async ({ path }) =>
    `/project/${path}`,
  readFileInfo: (input: { path: string; projectId: string }) => Promise<{
    mimeType: string
    name: string
    path: string
    size: number
  }> = async ({ path: resourcePath }) => ({
    mimeType: resourcePath.endsWith(".mp4") ? "video/mp4" : "image/png",
    name: path.basename(resourcePath),
    path: resourcePath,
    size: 1,
  }),
  isEnabled: () => Promise<boolean> = async () => true,
  resolveManagedAsset: (input: {
    projectId: string
    reference: { kind: "managed-asset"; mediaType?: string; name: string; sha256: string }
  }) => Promise<string> = async ({ reference }) => `/managed/${reference.sha256}`,
) {
  const image = createMediaNode({
    id: "image-1",
    position: { x: 0, y: 0 },
    resource: {
      id: "image-resource",
      kind: "image",
      metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Media/image.png" } },
      name: "Image",
      state: { status: "ready" },
    },
  })
  const video = createMediaNode({
    id: "video-1",
    position: { x: 10, y: 10 },
    resource: {
      id: "video-resource",
      kind: "video",
      metadata: {
        [projectResourceReferenceKey]: {
          kind: "managed-asset",
          mediaType: "video/mp4",
          name: "video.mp4",
          sha256: "a".repeat(64),
        },
      },
      name: "Video",
      state: { status: "ready" },
    },
  })
  const document = { ...createCanvasDocument({ id: "canvas-1", title: "Canvas" }), nodes: [image, video], revision: 7 }
  const exportMedia = mock(async () => ({
    createdDraft: false,
    draftName: "Current",
    importedMediaCount: 2,
    importStatus: "dispatched" as const,
  }))
  const loadDocument = mock(async () => ({ document, storageVersion: "v1" }))
  const readProjectFileInfo = mock(readFileInfo)
  const resolveProjectEntryPath = mock(resolveEntryPath)
  const resolveManagedProjectAsset = mock(resolveManagedAsset)
  const service = new JianyingCanvasService({
    assets: { resolve: resolveManagedProjectAsset },
    documents: { load: loadDocument },
    integration: { exportMedia, getDraftStatus: mock(async () => ({ status: "active" as const })) },
    isEnabled: mock(isEnabled),
    projects: { readFileInfo: readProjectFileInfo, resolveEntryPath: resolveProjectEntryPath },
  })
  return {
    document,
    exportMedia,
    loadDocument,
    readProjectFileInfo,
    resolveManagedProjectAsset,
    resolveProjectEntryPath,
    service,
  }
}

describe("JianyingCanvasService", () => {
  test("checks the trusted built-in before reading Canvas files or dispatching native work", async () => {
    const { exportMedia, loadDocument, readProjectFileInfo, resolveManagedProjectAsset, resolveProjectEntryPath, service } = setup(
      undefined,
      undefined,
      async () => false,
    )
    await expect(
      service.exportCanvasMedia({
        expectedRevision: 7,
        nodeIds: ["image-1"],
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
        target: { kind: "current-or-new" },
      }),
    ).rejects.toThrow("not installed")
    expect(loadDocument).not.toHaveBeenCalled()
    expect(readProjectFileInfo).not.toHaveBeenCalled()
    expect(resolveManagedProjectAsset).not.toHaveBeenCalled()
    expect(resolveProjectEntryPath).not.toHaveBeenCalled()
    expect(exportMedia).not.toHaveBeenCalled()
  })

  test("resolves only Project-backed image and video nodes inside main", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-jianying-canvas-"))
    temporaryRoots.push(root)
    await fs.mkdir(path.join(root, "Media"), { recursive: true })
    await fs.mkdir(path.join(root, ".convax", "assets", "blobs"), { recursive: true })
    await fs.writeFile(
      path.join(root, "Media", "image.png"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    )
    await fs.writeFile(
      path.join(root, ".convax", "assets", "blobs", "a".repeat(64)),
      Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisom")]),
    )
    const { exportMedia, service } = setup(
      async ({ path: relativePath }) => path.join(root, relativePath),
      undefined,
      undefined,
      async ({ reference }) => path.join(root, ".convax", "assets", "blobs", reference.sha256),
    )
    await expect(
      service.exportCanvasMedia({
        expectedRevision: 7,
        nodeIds: ["image-1", "video-1"],
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
        target: { kind: "current-or-new" },
      }),
    ).resolves.toMatchObject({ importedMediaCount: 2 })
    const canonicalRoot = await fs.realpath(root)
    expect(exportMedia).toHaveBeenCalledWith(
      [
        { mimeType: "image/png", path: path.join(canonicalRoot, "Media", "image.png") },
        { mimeType: "video/mp4", path: path.join(canonicalRoot, ".convax", "assets", "blobs", "a".repeat(64)) },
      ],
      { kind: "current-or-new" },
    )
  })

  test("rejects stale revisions, duplicate ids, and non-media nodes before native export", async () => {
    const { document, exportMedia, service } = setup()
    await expect(
      service.exportCanvasMedia({
        expectedRevision: 6,
        nodeIds: ["image-1"],
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
        target: { kind: "current-or-new" },
      }),
    ).rejects.toThrow("expected revision")
    await expect(
      service.exportCanvasMedia({
        expectedRevision: 7,
        nodeIds: ["image-1", "image-1"],
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
        target: { kind: "current-or-new" },
      }),
    ).rejects.toThrow("unique")
    document.nodes.push({
      ...document.nodes[0]!,
      data: { kind: "audio", label: "Audio", metadata: {}, resourceState: { status: "stale" } },
      id: "audio-1",
    })
    await expect(
      service.exportCanvasMedia({
        expectedRevision: 7,
        nodeIds: ["audio-1"],
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
        target: { kind: "current-or-new" },
      }),
    ).rejects.toThrow("Only Canvas images and videos")
    expect(exportMedia).not.toHaveBeenCalled()
  })

  test("rejects forged private references and media kinds that do not match the actual Project file", async () => {
    const { document, exportMedia, service } = setup()
    document.nodes[0]!.data.metadata = {
      [projectResourceReferenceKey]: { kind: "project-file", path: ".convax/canvases/canvas-1/document.json" },
    }
    await expect(
      service.exportCanvasMedia({
        expectedRevision: 7,
        nodeIds: ["image-1"],
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
        target: { kind: "current-or-new" },
      }),
    ).rejects.toThrow("stored in the active Project")
    document.nodes[0]!.data.metadata = {
      [projectResourceReferenceKey]: { kind: "project-file", path: "Media/not-an-image.json" },
    }
    const mismatch = setup(undefined, async ({ path: resourcePath }) => ({
      mimeType: "application/json",
      name: "not-an-image.json",
      path: resourcePath,
      size: 1,
    }))
    mismatch.document.nodes[0]!.data.metadata = document.nodes[0]!.data.metadata
    await expect(
      mismatch.service.exportCanvasMedia({
        expectedRevision: 7,
        nodeIds: ["image-1"],
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
        target: { kind: "current-or-new" },
      }),
    ).rejects.toThrow("matching media file")
    expect(exportMedia).not.toHaveBeenCalled()
    expect(mismatch.exportMedia).not.toHaveBeenCalled()
  })

  test("rejects a file whose bytes do not match its image extension", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-jianying-canvas-"))
    temporaryRoots.push(root)
    const asset = path.join(root, "Media", "image.png")
    await fs.mkdir(path.dirname(asset), { recursive: true })
    await fs.writeFile(asset, JSON.stringify({ private: "not an image" }))
    const { exportMedia, service } = setup(async () => asset)

    await expect(
      service.exportCanvasMedia({
        expectedRevision: 7,
        nodeIds: ["image-1"],
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
        target: { kind: "current-or-new" },
      }),
    ).rejects.toThrow("content does not match")
    expect(exportMedia).not.toHaveBeenCalled()
  })
})
