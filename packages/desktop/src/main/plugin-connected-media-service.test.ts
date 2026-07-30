import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createCanvasDocument, type CanvasDocument } from "@convax/canvas/core"
import { projectResourceReferenceKey } from "@convax/project/canvas"

import { parseWebPluginManifest } from "../plugin-contracts"
import { PluginHostApiResourceUnavailableError } from "../plugin-host-errors"
import { CanvasDocumentChangeBus } from "./canvas-document-change-bus"
import { ManagedCanvasMediaResourceUnavailableError } from "./managed-canvas-media-resolver"
import { PluginConnectedMediaService } from "./plugin-connected-media-service"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function plugin(
  version = "1.0.0",
  capabilities = ["canvas.connectedImages.read", "canvas.connectedMedia.stream"] as string[],
  optionalHostApis = [
    "canvas.inputs.list",
    "canvas.inputs.image.open",
    "canvas.inputs.image.close",
    "canvas.inputs.open",
    "canvas.inputs.close",
  ] as string[],
) {
  return parseWebPluginManifest({
    capabilities,
    contributes: { canvas: { renderer: { create: true } } },
    description: "Media preview",
    entry: "index.html",
    hostApi: {
      major: 1,
      optional: optionalHostApis,
      required: ["host.context.get"],
    },
    id: "media-surface",
    name: "Media Surface",
    schema: "convax.plugin/8",
    version,
  })
}

function imageCanvas(): CanvasDocument {
  const document = canvas()
  return {
    ...document,
    edges: [{ id: "edge-image", source: "image-1", target: "plugin-1" }],
    nodes: document.nodes.map((node) =>
      node.id !== "video-1"
        ? node
        : {
            ...node,
            data: {
              height: 3,
              kind: "image",
              label: "Image source",
              metadata: {
                [projectResourceReferenceKey]: { kind: "project-file", path: "Images/source.png" },
              },
              mimeType: "image/png",
              name: "source.png",
              width: 2,
            },
            id: "image-1",
          },
    ),
  }
}

const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAAECAIAAAArjXluAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8wwACLAxYKAAbdAEKX4LcXQAAAABJRU5ErkJggg==",
  "base64",
)
const validJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAFAASAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AiwEm38AAAAAB/9k=",
  "base64",
)
const validWebp = Buffer.from("UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA", "base64")

function pngHeaderOnly(width: number, height: number) {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

const testImageInspector = {
  inspect(bytes: Uint8Array) {
    const buffer = Buffer.from(bytes)
    if (buffer.equals(validPng)) return { height: 4, width: 2 }
    if (buffer.equals(validJpeg)) return { height: 20, width: 18 }
    if (buffer.equals(validWebp)) return { height: 1, width: 1 }
    if (buffer.length === 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) }
    }
    return null
  },
}

const unusedImageResources = {
  async readImage(): Promise<never> {
    throw new Error("Unexpected connected-image read")
  },
}

function imageRead(bytes: Uint8Array, mimeType: "image/jpeg" | "image/png" | "image/webp", name: string) {
  return {
    bytes,
    contentDigest: createHash("sha256").update(bytes).digest("hex"),
    mimeType,
    name,
    size: bytes.byteLength,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function canvas(): CanvasDocument {
  return {
    ...createCanvasDocument({
      edges: [{ id: "edge-1", source: "video-1", target: "plugin-1" }],
      id: "canvas-1",
      nodes: [
        {
          data: {
            durationMs: 2_000,
            height: 1080,
            kind: "video",
            label: "Source",
            mimeType: "video/mp4",
            width: 1920,
          },
          id: "video-1",
          position: { x: 0, y: 0 },
          type: "file",
        },
        {
          data: {
            kind: "plugin.media-surface",
            label: "Media Surface",
            metadata: { convaxPlugin: { entry: "index.html", id: "media-surface", version: "1.0.0" } },
          },
          id: "plugin-1",
          position: { x: 500, y: 0 },
          type: "file",
        },
        { data: { kind: "video", label: "Other" }, id: "other", position: { x: 0, y: 300 }, type: "file" },
      ],
    }),
    revision: 4,
  }
}

describe("PluginConnectedMediaService", () => {
  test("opens bounded PNG, JPEG, and WebP snapshots through the typed Project image port", async () => {
    for (const fixture of [
      { bytes: validPng, height: 4, mimeType: "image/png", name: "source.png", width: 2 },
      { bytes: validJpeg, height: 20, mimeType: "image/jpeg", name: "source.jpg", width: 18 },
      { bytes: validWebp, height: 1, mimeType: "image/webp", name: "source.webp", width: 1 },
    ] as const) {
      const document = imageCanvas()
      const currentPlugin = plugin()
      let observedSignal: AbortSignal | undefined
      const service = new PluginConnectedMediaService({
        changes: new CanvasDocumentChangeBus(),
        documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
        images: testImageInspector,
        media: { resolve: async () => Promise.reject(new Error("Native media resolver must not read images")) },
        plugins: {
          resolveCapabilityIdentity: async () => ({
            activeRevision: 1,
            activeSetDigest: "a".repeat(64),
            digest: `${currentPlugin.version}:digest`,
            plugin: currentPlugin,
            snapshotDigest: "b".repeat(64),
          }),
        },
        resources: {
          async readImage(input) {
            expect(input.maximumBytes).toBe(16 * 1024 * 1024)
            expect(input.projectId).toBe("project-1")
            expect(input.reference).toEqual({ kind: "project-file", path: "Images/source.png" })
            observedSignal = input.signal
            return imageRead(fixture.bytes, fixture.mimeType, fixture.name)
          },
        },
      })
      const controller = new AbortController()
      const result = await service.openImage(
        {
          canvasId: "canvas-1",
          expectedRevision: 4,
          frameId: "frame-1",
          nodeId: "plugin-1",
          pluginId: "media-surface",
          pluginVersion: "1.0.0",
          projectId: "project-1",
          sourceNodeId: "image-1",
        },
        7,
        controller.signal,
      )
      expect(observedSignal).toBeInstanceOf(AbortSignal)
      expect(result.url).toStartWith("convax-connected-media://")
      expect(new URL(result.url).pathname).toMatch(/^\/[a-f0-9]{32}$/u)
      expect(JSON.stringify(result)).not.toContain("data:")
      expect(JSON.stringify(result)).not.toContain("Images/source.png")
      expect(result.probe).toEqual({
        contentRevision: createHash("sha256").update(fixture.bytes).digest("hex"),
        height: fixture.height,
        kind: "image",
        mimeType: fixture.mimeType,
        size: fixture.bytes.byteLength,
        width: fixture.width,
      })
      const streamed = await service.handle(new Request(result.url))
      expect(streamed.status).toBe(200)
      expect(Buffer.from(await streamed.arrayBuffer())).toEqual(fixture.bytes)
      const partial = await service.handle(new Request(result.url, { headers: { Range: "bytes=1-3" } }))
      expect(partial.status).toBe(206)
      expect(Buffer.from(await partial.arrayBuffer())).toEqual(fixture.bytes.subarray(1, 4))
      const forgedBearer = new URL(result.url)
      forgedBearer.pathname = `/${"0".repeat(32)}`
      expect((await service.handle(new Request(forgedBearer))).status).toBe(404)
      expect(
        service.close(
          {
            canvasId: "canvas-1",
            frameId: "frame-1",
            nodeId: "plugin-1",
            pluginId: "media-surface",
            pluginVersion: "1.0.0",
            projectId: "project-1",
            sessionId: result.sessionId,
          },
          7,
        ),
      ).toBeFalse()
      expect(
        service.closeImage(
          {
            canvasId: "canvas-1",
            frameId: "frame-1",
            nodeId: "plugin-1",
            pluginId: "media-surface",
            pluginVersion: "1.0.0",
            projectId: "project-1",
            sessionId: result.sessionId,
          },
          8,
        ),
      ).toBeFalse()
      expect(
        service.closeImage(
          {
            canvasId: "canvas-1",
            frameId: "frame-1",
            nodeId: "plugin-1",
            pluginId: "media-surface",
            pluginVersion: "1.0.0",
            projectId: "project-1",
            sessionId: result.sessionId,
          },
          7,
        ),
      ).toBeTrue()
      expect(
        service.closeImage(
          {
            canvasId: "canvas-1",
            frameId: "frame-1",
            nodeId: "plugin-1",
            pluginId: "media-surface",
            pluginVersion: "1.0.0",
            projectId: "project-1",
            sessionId: result.sessionId,
          },
          7,
        ),
      ).toBeFalse()
      service.dispose()
    }
  })

  test("bounds image sessions separately and revalidates the direct edge before every fetch", async () => {
    let document = imageCanvas()
    const currentPlugin = plugin()
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
      images: testImageInspector,
      media: { resolve: async () => [] },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision: 1,
          activeSetDigest: "a".repeat(64),
          digest: `${currentPlugin.version}:digest`,
          plugin: currentPlugin,
          snapshotDigest: "b".repeat(64),
        }),
      },
      resources: { readImage: async () => imageRead(validPng, "image/png", "source.png") },
    })
    const request = {
      canvasId: "canvas-1",
      expectedRevision: 4,
      frameId: "frame-1",
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "image-1",
    }
    const first = await service.openImage(request, 7)
    const second = await service.openImage(request, 7)
    await expect(service.openImage(request, 7)).rejects.toBeInstanceOf(PluginHostApiResourceUnavailableError)
    expect(service.closeImage({ ...request, sessionId: second.sessionId }, 7)).toBeTrue()
    await expect(service.openImage(request, 7)).resolves.toMatchObject({ probe: { kind: "image" } })

    document = { ...document, edges: [] }
    expect((await service.handle(new Request(first.url))).status).toBe(404)
    service.dispose()
  })

  test("fails closed on decode, metadata, digest, size, dimensions, and stale direct-input edges", async () => {
    const currentPlugin = plugin()
    const request = {
      canvasId: "canvas-1",
      expectedRevision: 4,
      frameId: "frame-1",
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "image-1",
    }
    for (const testCase of [
      {
        image: imageRead(validPng.subarray(0, 24), "image/png", "source.png"),
        images: { inspect: () => null },
      },
      {
        image: imageRead(validPng, "image/jpeg", "source.jpg"),
        images: testImageInspector,
      },
      {
        image: { ...imageRead(validPng, "image/png", "source.png"), name: "../source.png" },
        images: testImageInspector,
      },
      {
        image: { ...imageRead(validPng, "image/png", "source.png"), size: 16 * 1024 * 1024 + 1 },
        images: testImageInspector,
      },
      {
        image: { ...imageRead(validPng, "image/png", "source.png"), contentDigest: "0".repeat(64) },
        images: testImageInspector,
      },
      {
        image: imageRead(pngHeaderOnly(8_193, 1), "image/png", "source.png"),
        images: {
          inspect(): never {
            throw new Error("Oversized image must be rejected before native decode")
          },
        },
      },
    ]) {
      const service = new PluginConnectedMediaService({
        changes: new CanvasDocumentChangeBus(),
        documents: { load: async () => ({ document: imageCanvas(), storageVersion: "stored-1" }) },
        images: testCase.images,
        media: { resolve: async () => [] },
        plugins: {
          resolveCapabilityIdentity: async () => ({
            activeRevision: 1,
            activeSetDigest: "a".repeat(64),
            digest: `${currentPlugin.version}:digest`,
            plugin: currentPlugin,
            snapshotDigest: "b".repeat(64),
          }),
        },
        resources: { readImage: async () => testCase.image as never },
      })
      await expect(service.openImage(request, 7)).rejects.toBeInstanceOf(PluginHostApiResourceUnavailableError)
      service.dispose()
    }

    let document = imageCanvas()
    const staleService = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
      images: testImageInspector,
      media: { resolve: async () => [] },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision: 1,
          activeSetDigest: "a".repeat(64),
          digest: `${currentPlugin.version}:digest`,
          plugin: currentPlugin,
          snapshotDigest: "b".repeat(64),
        }),
      },
      resources: {
        async readImage() {
          document = { ...document, edges: [] }
          return imageRead(validPng, "image/png", "source.png")
        },
      },
    })
    await expect(staleService.openImage(request, 7)).rejects.toMatchObject({ code: "stale-context" })
    staleService.dispose()

    let reads = 0
    const changedBytes = Buffer.from(validPng)
    changedBytes[changedBytes.length - 1] = changedBytes[changedBytes.length - 1]! ^ 1
    const changedService = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document: imageCanvas(), storageVersion: "stored-1" }) },
      images: testImageInspector,
      media: { resolve: async () => [] },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision: 1,
          activeSetDigest: "a".repeat(64),
          digest: `${currentPlugin.version}:digest`,
          plugin: currentPlugin,
          snapshotDigest: "b".repeat(64),
        }),
      },
      resources: {
        async readImage() {
          reads += 1
          return imageRead(reads === 1 ? validPng : changedBytes, "image/png", "source.png")
        },
      },
    })
    await expect(changedService.openImage(request, 7)).rejects.toMatchObject({ code: "stale-context" })
    expect(reads).toBe(2)
    changedService.dispose()
  })

  test("bounds validation concurrency and disposal aborts validation and rejects new calls", async () => {
    const document = imageCanvas()
    const currentPlugin = plugin()
    const started = deferred<void>()
    const restarted = deferred<void>()
    let reads = 0
    let observedSignal: AbortSignal | undefined
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
      images: testImageInspector,
      media: { resolve: async () => [] },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision: 1,
          activeSetDigest: "a".repeat(64),
          digest: `${currentPlugin.version}:digest`,
          plugin: currentPlugin,
          snapshotDigest: "b".repeat(64),
        }),
      },
      resources: {
        readImage: async ({ signal }) => {
          reads += 1
          observedSignal = signal
          if (reads === 1) started.resolve()
          else restarted.resolve()
          return new Promise((_, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
          })
        },
      },
    })
    const request = {
      canvasId: "canvas-1",
      expectedRevision: 4,
      frameId: "frame-1",
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "image-1",
    }
    const controller = new AbortController()
    const pending = service.openImage(request, 7, controller.signal)
    await started.promise
    await expect(service.openImage(request, 7)).rejects.toBeInstanceOf(PluginHostApiResourceUnavailableError)
    await expect(service.openImage({ ...request, frameId: "frame-2" }, 8)).rejects.toBeInstanceOf(
      PluginHostApiResourceUnavailableError,
    )
    expect(observedSignal).not.toBe(controller.signal)
    controller.abort(new Error("caller canceled"))
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    const restartedPending = service.openImage({ ...request, frameId: "frame-2" }, 8)
    await restarted.promise
    service.dispose()
    await expect(restartedPending).rejects.toMatchObject({ name: "AbortError" })
    await expect(service.openImage(request, 7)).rejects.toBeInstanceOf(PluginHostApiResourceUnavailableError)
  })

  test("reports grant or exact-identity drift after byte preparation as stale context", async () => {
    const document = imageCanvas()
    let currentPlugin = plugin()
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
      images: testImageInspector,
      media: { resolve: async () => [] },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision: 1,
          activeSetDigest: "a".repeat(64),
          digest: `${currentPlugin.version}:digest`,
          plugin: currentPlugin,
          snapshotDigest: "b".repeat(64),
        }),
      },
      resources: {
        async readImage() {
          currentPlugin = {
            ...plugin(),
            capabilities: ["canvas.connectedMedia.stream"],
          } as ReturnType<typeof plugin>
          return imageRead(validPng, "image/png", "source.png")
        },
      },
    })
    const request = {
      canvasId: "canvas-1",
      expectedRevision: 4,
      frameId: "frame-1",
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "image-1",
    }
    currentPlugin = {
      ...plugin(),
      capabilities: ["canvas.connectedMedia.stream"],
    } as ReturnType<typeof plugin>
    await expect(service.openImage(request, 7)).rejects.toMatchObject({ code: "permission-denied" })
    currentPlugin = plugin()
    await expect(service.openImage(request, 7)).rejects.toMatchObject({ code: "stale-context" })
    service.dispose()
  })

  test("maps an authoritative media-resolution failure to the Catalog resource error", async () => {
    const document = canvas()
    const currentPlugin = plugin()
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
      images: testImageInspector,
      media: {
        async resolve() {
          throw new ManagedCanvasMediaResourceUnavailableError("managed Project resource is missing")
        },
      },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision: 1,
          activeSetDigest: "a".repeat(64),
          digest: `${currentPlugin.version}:digest`,
          plugin: currentPlugin,
          snapshotDigest: "b".repeat(64),
        }),
      },
      resources: unusedImageResources,
    })

    await expect(
      service.open(
        {
          canvasId: "canvas-1",
          expectedRevision: 4,
          frameId: "frame-1",
          nodeId: "plugin-1",
          pluginId: "media-surface",
          pluginVersion: "1.0.0",
          projectId: "project-1",
          sourceNodeId: "video-1",
        },
        7,
      ),
    ).rejects.toBeInstanceOf(PluginHostApiResourceUnavailableError)
    service.dispose()
  })

  test("does not classify an unknown resolver bug as a retryable resource failure", async () => {
    const document = canvas()
    const currentPlugin = plugin()
    const bug = new TypeError("resolver invariant failed")
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
      images: testImageInspector,
      media: {
        async resolve() {
          throw bug
        },
      },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision: 1,
          activeSetDigest: "a".repeat(64),
          digest: `${currentPlugin.version}:digest`,
          plugin: currentPlugin,
          snapshotDigest: "b".repeat(64),
        }),
      },
      resources: unusedImageResources,
    })

    await expect(
      service.open(
        {
          canvasId: "canvas-1",
          expectedRevision: 4,
          frameId: "frame-1",
          nodeId: "plugin-1",
          pluginId: "media-surface",
          pluginVersion: "1.0.0",
          projectId: "project-1",
          sourceNodeId: "video-1",
        },
        7,
      ),
    ).rejects.toBe(bug)
    service.dispose()
  })

  test("streams ranges and revokes on edge, source, frame, Plugin and Canvas lifecycle changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-connected-media-"))
    roots.push(root)
    const sourcePath = path.join(root, "source.mp4")
    await fs.writeFile(sourcePath, Buffer.from("0000ftypabcdefgh"))
    const stat = await fs.lstat(sourcePath)
    const originalIdentity = {
      ctimeMs: stat.ctimeMs,
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    }
    let document = canvas()
    let currentPlugin = plugin()
    let activeRevision = 1
    let activeSetDigest = "a".repeat(64)
    let snapshotDigest = "b".repeat(64)
    let mediaIdentity = originalIdentity
    const changes = new CanvasDocumentChangeBus()
    const service = new PluginConnectedMediaService({
      changes,
      documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
      images: testImageInspector,
      media: {
        resolve: async () => [
          {
            identity: mediaIdentity,
            kind: "video" as const,
            mimeType: "video/mp4",
            name: "source.mp4",
            path: sourcePath,
            resourcePath: ".convax/assets/source.mp4",
            size: mediaIdentity.size,
          },
        ],
      },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision,
          activeSetDigest,
          digest: `${currentPlugin.version}:digest`,
          plugin: currentPlugin,
          snapshotDigest,
        }),
      },
      resources: unusedImageResources,
    })
    const frame = {
      canvasId: "canvas-1",
      expectedRevision: 4,
      frameId: "frame-1",
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "video-1",
    }

    await expect(service.open({ ...frame, sourceNodeId: "other" }, 7)).rejects.toThrow("not a direct input")
    const opened = await service.open(frame, 7)
    expect(opened.url).not.toContain(sourcePath)
    expect(opened.probe).toMatchObject({
      duration: { estimated: false, milliseconds: 2_000 },
      height: 1080,
      kind: "video",
      mimeType: "video/mp4",
      size: stat.size,
      width: 1920,
    })
    const partial = await service.handle(new Request(opened.url, { headers: { Range: "bytes=4-7" } }))
    expect(partial.status).toBe(206)
    expect(partial.headers.get("content-range")).toBe(`bytes 4-7/${stat.size}`)
    expect(await partial.text()).toBe("ftyp")

    document = { ...document, edges: [] }
    expect((await service.handle(new Request(opened.url))).status).toBe(404)
    document = canvas()

    const replaced = await service.open(frame, 7)
    mediaIdentity = { ...originalIdentity, size: originalIdentity.size + 1 }
    expect((await service.handle(new Request(replaced.url))).status).toBe(404)
    mediaIdentity = originalIdentity

    const frameClosed = await service.open(frame, 7)
    expect(service.revokeFrame(frame, 7)).toBeGreaterThan(0)
    expect((await service.handle(new Request(frameClosed.url))).status).toBe(404)

    const pluginChanged = await service.open(frame, 7)
    currentPlugin = plugin("2.0.0")
    expect((await service.handle(new Request(pluginChanged.url))).status).toBe(404)
    currentPlugin = plugin()

    const activeSetChanged = await service.open(frame, 7)
    activeRevision += 1
    activeSetDigest = "c".repeat(64)
    snapshotDigest = "d".repeat(64)
    expect((await service.handle(new Request(activeSetChanged.url))).status).toBe(404)

    const explicit = await service.open(frame, 7)
    expect(service.close({ ...frame, sessionId: explicit.sessionId }, 8)).toBeFalse()
    expect(service.close({ ...frame, sessionId: explicit.sessionId }, 7)).toBeTrue()
    expect((await service.handle(new Request(explicit.url))).status).toBe(404)

    const canvasChanged = await service.open(frame, 7)
    changes.publish({
      ref: { canvasId: "canvas-1", projectId: "project-1" },
      revision: 5,
      source: "renderer",
    })
    expect((await service.handle(new Request(canvasChanged.url))).status).toBe(404)
    service.dispose()
  })

  test("rejects missing grants, undeclared APIs, inactive identities, and legacy schemas", async () => {
    let currentPlugin = plugin("1.0.0", [])
    let active = true
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document: canvas(), storageVersion: "stored" }) },
      images: testImageInspector,
      media: { resolve: async () => [] },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          ...(active
            ? {
                activeRevision: 1,
                activeSetDigest: "a".repeat(64),
                snapshotDigest: "b".repeat(64),
              }
            : {}),
          digest: "digest",
          plugin: currentPlugin,
        }),
      },
      resources: unusedImageResources,
    })
    const request = {
      canvasId: "canvas-1",
      expectedRevision: 4,
      frameId: "frame-1",
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "video-1",
    }
    await expect(service.open(request, 7)).rejects.toMatchObject({ code: "permission-denied" })
    currentPlugin = plugin("1.0.0", ["canvas.connectedMedia.stream"], [])
    await expect(service.open(request, 7)).rejects.toMatchObject({ code: "permission-denied" })
    currentPlugin = plugin()
    active = false
    await expect(service.open(request, 7)).rejects.toMatchObject({ code: "stale-context" })
    active = true
    currentPlugin = { ...plugin(), schema: "convax.plugin/7" } as unknown as ReturnType<typeof plugin>
    await expect(service.open(request, 7)).rejects.toMatchObject({ code: "stale-context" })
    service.dispose()
  })
})
