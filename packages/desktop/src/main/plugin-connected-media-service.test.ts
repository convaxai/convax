import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createCanvasDocument, type CanvasDocument } from "@convax/canvas/core"
import { projectResourceReferenceKey } from "@convax/project/canvas"

import type { PluginPrincipal } from "../plugin-capability-contracts"
import type { PluginCapabilityRendererClient } from "../plugin-capability-ipc"
import { desktopPluginHostProtocolV8, pluginCapabilityProtocolV3 } from "../plugin-host-protocol"
import { RendererPluginHostConnection } from "../renderer/plugin-host-connection"
import { PluginHostApiMainAdapter } from "./plugin-host-api-main-adapter"
import { PluginHostApiService } from "./plugin-host-api-service"
import { parseWebPluginManifest } from "../plugin-contracts"
import { PluginHostApiResourceUnavailableError } from "../plugin-host-errors"
import {
  canvasOperationReceipt,
  canvasQueryApplication,
  canvasReadOnlyApplication,
} from "./canvas-application-test-fixtures"
import { CanvasDocumentChangeBus } from "./canvas-document-change-bus"
import { ManagedCanvasMediaResourceUnavailableError } from "./managed-canvas-media-resolver"
import { PluginConnectedMediaService } from "./plugin-connected-media-service"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function drainReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialBytes: number,
): Promise<{ bytesRead: number; error?: unknown }> {
  let bytesRead = initialBytes
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return { bytesRead }
      bytesRead += next.value.byteLength
    }
  } catch (error) {
    return { bytesRead, error }
  }
}

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
      major: 3,
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

function mixedMediaCanvas(): CanvasDocument {
  const document = imageCanvas()
  return {
    ...document,
    edges: [...document.edges, { id: "edge-video", source: "video-1", target: "plugin-1" }],
    nodes: [
      ...document.nodes,
      {
        data: {
          durationMs: 2_000,
          height: 1080,
          kind: "video",
          label: "Video source",
          metadata: {
            [projectResourceReferenceKey]: { kind: "project-file", path: "Videos/source.mp4" },
          },
          mimeType: "video/mp4",
          name: "source.mp4",
          width: 1920,
        },
        id: "video-1",
        position: { x: 0, y: 300 },
        type: "file",
      },
    ],
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
  return createCanvasDocument({
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
  })
}

describe("PluginConnectedMediaService", () => {
  test("uses one monotonic deadline domain for idle refresh, absolute expiry, and capacity cleanup", async () => {
    const document = imageCanvas()
    const currentPlugin = plugin()
    let monotonicNow = 10_000
    let wallNow = 2_000_000_000_000
    const originalDateNow = Date.now
    Date.now = () => wallNow
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      clock: { now: () => monotonicNow },
      application: canvasQueryApplication(() => document),
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
      resources: { readImage: async () => imageRead(validPng, "image/png", "source.png") },
    })
    const frame = (frameId: string) => ({
      canvasId: "canvas-1",
      frameId,
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "image-1",
    })

    try {
      const opened = await service.openImage(frame("lifetime-frame"), 7)
      const openedAt = monotonicNow
      const absoluteLifetime = 4 * 60 * 60_000
      const accessInterval = 14 * 60_000
      for (let elapsed = accessInterval; elapsed < absoluteLifetime; elapsed += accessInterval) {
        monotonicNow = openedAt + elapsed
        wallNow -= 24 * 60 * 60_000
        expect((await service.handle(new Request(opened.url, { method: "HEAD" }))).status).toBe(200)
      }
      monotonicNow = openedAt + absoluteLifetime - 1
      wallNow -= 365 * 24 * 60 * 60_000
      expect((await service.handle(new Request(opened.url, { method: "HEAD" }))).status).toBe(200)
      monotonicNow = openedAt + absoluteLifetime
      expect((await service.handle(new Request(opened.url, { method: "HEAD" }))).status).toBe(404)
      expect(service.revokeFrame(frame("lifetime-frame"), 7)).toBe(0)

      const capacitySessions = []
      capacitySessions.push(await service.openImage(frame("capacity-frame-1"), 7))
      capacitySessions.push(await service.openImage(frame("capacity-frame-1"), 7))
      capacitySessions.push(await service.openImage(frame("capacity-frame-2"), 7))
      capacitySessions.push(await service.openImage(frame("capacity-frame-2"), 7))
      const capacityError = await service.openImage(frame("capacity-frame-3"), 7).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(capacityError).toBeInstanceOf(PluginHostApiResourceUnavailableError)
      expect(capacityError).toMatchObject({ message: "Connected-image session capacity is exhausted" })
      monotonicNow += 15 * 60_000
      const replacement = await service.openImage(frame("capacity-frame-3"), 7)
      expect(service.revokeFrame(frame("capacity-frame-3"), 7)).toBe(1)
      expect((await service.handle(new Request(replacement.url))).status).toBe(404)

      service.dispose()
      for (const session of capacitySessions) {
        expect((await service.handle(new Request(session.url))).status).toBe(404)
      }
    } finally {
      Date.now = originalDateNow
      service.dispose()
    }
  })

  test("opens bounded PNG, JPEG, and WebP snapshots through the typed Project image port", async () => {
    for (const fixture of [
      { bytes: validPng, height: 4, mimeType: "image/png", name: "source.png", width: 2 },
      { bytes: validJpeg, height: 20, mimeType: "image/jpeg", name: "source.jpg", width: 18 },
      { bytes: validWebp, height: 1, mimeType: "image/webp", name: "source.webp", width: 1 },
    ] as const) {
      const document = imageCanvas()
      const currentPlugin = plugin()
      const sourceBytes = Buffer.from(fixture.bytes)
      let observedSignal: AbortSignal | undefined
      const service = new PluginConnectedMediaService({
        changes: new CanvasDocumentChangeBus(),
        application: canvasQueryApplication(() => document),
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
            return imageRead(sourceBytes, fixture.mimeType, fixture.name)
          },
        },
      })
      const controller = new AbortController()
      const result = await service.openImage(
        {
          canvasId: "canvas-1",
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
      sourceBytes[sourceBytes.length - 1] = sourceBytes[sourceBytes.length - 1]! ^ 1
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
      const head = await service.handle(new Request(result.url, { method: "HEAD" }))
      expect(head.status).toBe(200)
      expect(head.headers.get("content-length")).toBe(String(fixture.bytes.byteLength))
      expect((await head.arrayBuffer()).byteLength).toBe(0)
      const rangedHead = await service.handle(
        new Request(result.url, { headers: { Range: "bytes=1-3" }, method: "HEAD" }),
      )
      expect(rangedHead.status).toBe(206)
      expect(rangedHead.headers.get("content-range")).toBe(`bytes 1-3/${fixture.bytes.byteLength}`)
      expect(rangedHead.headers.get("content-length")).toBe("3")
      expect((await rangedHead.arrayBuffer()).byteLength).toBe(0)
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
      const retainedResponse = await service.handle(new Request(result.url))
      expect(retainedResponse.status).toBe(200)
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
      expect(Buffer.from(await retainedResponse.arrayBuffer())).toEqual(fixture.bytes)
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
      application: canvasQueryApplication(() => document),
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
        application: canvasQueryApplication(imageCanvas()),
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
      application: canvasQueryApplication(() => document),
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
      application: canvasQueryApplication(imageCanvas()),
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
      application: canvasQueryApplication(() => document),
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
      application: canvasQueryApplication(() => document),
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
      application: canvasQueryApplication(() => document),
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
      application: canvasQueryApplication(() => document),
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
      application: canvasQueryApplication(() => document),
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
    const head = await service.handle(new Request(opened.url, { method: "HEAD" }))
    expect(head.status).toBe(200)
    expect(head.headers.get("content-length")).toBe(String(stat.size))
    expect((await head.arrayBuffer()).byteLength).toBe(0)
    const rangedHead = await service.handle(
      new Request(opened.url, { headers: { Range: "bytes=4-7" }, method: "HEAD" }),
    )
    expect(rangedHead.status).toBe(206)
    expect(rangedHead.headers.get("content-range")).toBe(`bytes 4-7/${stat.size}`)
    expect(rangedHead.headers.get("content-length")).toBe("4")
    expect((await rangedHead.arrayBuffer()).byteLength).toBe(0)
    const unsatisfiable = await service.handle(new Request(opened.url, { headers: { Range: `bytes=${stat.size}-` } }))
    expect(unsatisfiable.status).toBe(416)
    expect(unsatisfiable.headers.get("content-range")).toBe(`bytes */${stat.size}`)

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
      operationReceipt: canvasOperationReceipt("canvas-changed-1"),
      ref: { canvasId: "canvas-1", projectId: "project-1" },
      source: "renderer",
    })
    expect((await service.handle(new Request(canvasChanged.url))).status).toBe(404)
    service.dispose()
  })

  test("interrupts concurrent slow-consumer file responses on close, frame, Plugin, Canvas and service revocation", async () => {
    const mediaBytes = Buffer.alloc(4 * 1024 * 1024, 0x61)
    mediaBytes.write("0000ftyp", 0, "ascii")
    for (const revoke of ["close", "frame", "plugin", "canvas", "dispose"] as const) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), `convax-connected-media-${revoke}-`))
      roots.push(root)
      const sourcePath = path.join(root, "source.mp4")
      await fs.writeFile(sourcePath, mediaBytes)
      const stat = await fs.lstat(sourcePath)
      const identity = {
        ctimeMs: stat.ctimeMs,
        dev: stat.dev,
        ino: stat.ino,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      }
      const document = canvas()
      const currentPlugin = plugin()
      const changes = new CanvasDocumentChangeBus()
      const service = new PluginConnectedMediaService({
        changes,
        application: canvasQueryApplication(() => document),
        images: testImageInspector,
        media: {
          resolve: async () => [
            {
              identity,
              kind: "video" as const,
              mimeType: "video/mp4",
              name: "source.mp4",
              path: sourcePath,
              resourcePath: ".convax/assets/source.mp4",
              size: identity.size,
            },
          ],
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
      const frame = {
        canvasId: "canvas-1",
        frameId: "frame-1",
        nodeId: "plugin-1",
        pluginId: "media-surface",
        pluginVersion: "1.0.0",
        projectId: "project-1",
        sourceNodeId: "video-1",
      }
      const opened = await service.open(frame, 7)
      const responses = await Promise.all([
        service.handle(new Request(opened.url)),
        service.handle(new Request(opened.url)),
      ])
      const readers = responses.map((response) => {
        expect(response.status).toBe(200)
        expect(response.body).not.toBeNull()
        return response.body!.getReader()
      })
      const firstChunks = await Promise.all(readers.map((reader) => reader.read()))
      const firstByteCounts = firstChunks.map((chunk) => {
        expect(chunk.done).toBeFalse()
        if (chunk.done || !chunk.value) throw new Error("Connected-media response ended before its first chunk")
        expect(chunk.value.byteLength).toBeGreaterThan(0)
        return chunk.value.byteLength
      })

      if (revoke === "close") {
        expect(service.close({ ...frame, sessionId: opened.sessionId }, 7)).toBeTrue()
      } else if (revoke === "frame") {
        expect(service.revokeFrame(frame, 7)).toBeGreaterThan(0)
      } else if (revoke === "plugin") {
        expect(service.revokePlugin("media-surface")).toBeGreaterThan(0)
      } else if (revoke === "canvas") {
        changes.publish({
          operationReceipt: canvasOperationReceipt("canvas-changed-slow-consumer"),
          ref: { canvasId: "canvas-1", projectId: "project-1" },
          source: "renderer",
        })
      } else {
        service.dispose()
      }

      const outcomes = await Promise.all(readers.map((reader, index) => drainReader(reader, firstByteCounts[index])))
      for (const outcome of outcomes) {
        expect(outcome.bytesRead).toBeLessThan(mediaBytes.byteLength)
      }
      expect((await service.handle(new Request(opened.url))).status).toBe(404)
      service.dispose()
    }
  })

  test("does not create a stream session after caller cancellation wins an unresolved media lookup", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-connected-media-open-abort-"))
    roots.push(root)
    const sourcePath = path.join(root, "source.mp4")
    await fs.writeFile(sourcePath, Buffer.from("0000ftypabcdefgh"))
    const stat = await fs.lstat(sourcePath)
    const identity = {
      ctimeMs: stat.ctimeMs,
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    }
    const document = canvas()
    const currentPlugin = plugin()
    const resolution = deferred<
      readonly [
        {
          identity: typeof identity
          kind: "video"
          mimeType: string
          name: string
          path: string
          resourcePath: string
          size: number
        },
      ]
    >()
    const resolutionStarted = deferred<void>()
    let observedSignal: AbortSignal | undefined
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      application: canvasQueryApplication(() => document),
      images: testImageInspector,
      media: {
        resolve: async (_request, _options, signal) => {
          observedSignal = signal
          resolutionStarted.resolve()
          return resolution.promise
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
    const frame = {
      canvasId: "canvas-1",
      frameId: "frame-1",
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "video-1",
    }
    const controller = new AbortController()
    const opening = service.open(frame, 7, controller.signal)
    await resolutionStarted.promise
    controller.abort(new Error("frame disposed"))
    resolution.resolve([
      {
        identity,
        kind: "video",
        mimeType: "video/mp4",
        name: "source.mp4",
        path: sourcePath,
        resourcePath: "Videos/source.mp4",
        size: stat.size,
      },
    ])

    await expect(opening).rejects.toThrow("frame disposed")
    expect(observedSignal?.aborted).toBeTrue()
    expect(service.revokeFrame(frame, 7)).toBe(0)
    service.dispose()
  })

  test("rechecks per-frame stream capacity after concurrent asynchronous preparation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-connected-media-capacity-"))
    roots.push(root)
    const sourcePath = path.join(root, "source.mp4")
    await fs.writeFile(sourcePath, Buffer.from("0000ftypabcdefgh"))
    const stat = await fs.lstat(sourcePath)
    const identity = {
      ctimeMs: stat.ctimeMs,
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    }
    const document = canvas()
    const currentPlugin = plugin()
    const release = deferred<void>()
    let started = 0
    const allStarted = deferred<void>()
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      application: canvasQueryApplication(() => document),
      images: testImageInspector,
      media: {
        resolve: async () => {
          started += 1
          if (started === 17) allStarted.resolve()
          await release.promise
          return [
            {
              identity,
              kind: "video" as const,
              mimeType: "video/mp4",
              name: "source.mp4",
              path: sourcePath,
              resourcePath: "Videos/source.mp4",
              size: stat.size,
            },
          ]
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
    const frame = {
      canvasId: "canvas-1",
      frameId: "frame-1",
      nodeId: "plugin-1",
      pluginId: "media-surface",
      pluginVersion: "1.0.0",
      projectId: "project-1",
      sourceNodeId: "video-1",
    }
    const openings = Array.from({ length: 17 }, () => service.open(frame, 7))
    await allStarted.promise
    release.resolve()
    const settled = await Promise.allSettled(openings)

    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(16)
    const rejected = settled.filter(({ status }) => status === "rejected")
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({ message: expect.stringContaining("exceeds 16") }),
    })
    expect(service.revokeFrame(frame, 7)).toBe(16)
    service.dispose()
  })

  test("payload-free renderer disconnect synchronously revokes image and stream bearers through the real Host adapter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-connected-media-host-close-"))
    roots.push(root)
    const sourcePath = path.join(root, "source.mp4")
    await fs.writeFile(sourcePath, Buffer.from("0000ftypabcdefgh"))
    const stat = await fs.lstat(sourcePath)
    const identity = {
      ctimeMs: stat.ctimeMs,
      dev: stat.dev,
      ino: stat.ino,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    }
    const document = mixedMediaCanvas()
    const currentPlugin = plugin("1.0.0", [
      "canvas.connectedImages.read",
      "canvas.connectedInputs.read",
      "canvas.connectedMedia.stream",
    ])
    const principal: PluginPrincipal = {
      activeRevision: 1,
      activeSetDigest: "a".repeat(64),
      manifestDigest: "c".repeat(64),
      pluginId: currentPlugin.id,
      pluginVersion: currentPlugin.version,
      runtime: "web",
      snapshotDigest: "b".repeat(64),
    }
    const application = canvasReadOnlyApplication(() => document)
    const media = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      application,
      images: testImageInspector,
      media: {
        resolve: async () => [
          {
            identity,
            kind: "video" as const,
            mimeType: "video/mp4",
            name: "source.mp4",
            path: sourcePath,
            resourcePath: "Videos/source.mp4",
            size: stat.size,
          },
        ],
      },
      plugins: {
        resolveCapabilityIdentity: async () => ({
          activeRevision: principal.activeRevision,
          activeSetDigest: principal.activeSetDigest,
          digest: principal.manifestDigest,
          plugin: currentPlugin,
          snapshotDigest: principal.snapshotDigest,
        }),
      },
      resources: { readImage: async () => imageRead(validPng, "image/png", "source.png") },
    })
    const adapter = new PluginHostApiMainAdapter({
      agent: {} as never,
      application,
      canvases: {
        async getCanvasCatalog({ projectId }: { projectId: string }) {
          const route = {
            activationDigest: "a".repeat(64),
            canvasId: "canvas-1",
            routeProjectionDigest: "b".repeat(64),
            shardEpoch: "AAAAAAAAAAAAAAAAAAAAAA",
            state: "live",
            title: "Canvas",
          }
          return {
            format: "convax.project-canvas-catalog-projection/2",
            projectId,
            projectEpoch: "BBBBBBBBBBBBBBBBBBBBBB",
            routes: [route],
            visibleCanvases: [route],
          } as never
        },
      },
      generation: {} as never,
      images: {} as never,
      media,
      projects: {
        async list() {
          return [
            {
              createdAt: 1,
              id: "project-1",
              lastOpenedAt: 1,
              name: "Project",
              rootPath: "/must-not-cross-the-host-boundary",
            },
          ]
        },
        async readTextFile(): Promise<never> {
          throw new Error("unused")
        },
        async resolveEntryPath(): Promise<never> {
          throw new Error("unused")
        },
      },
      states: {} as never,
    })
    const host = new PluginHostApiService({
      createId: () => "connection-1",
      nodes: adapter,
      operations: adapter,
      principals: {
        async liveState() {
          return { disabled: false, recovering: false, setupComplete: true }
        },
        async resolve() {
          return {
            activeRevision: principal.activeRevision,
            activeSetDigest: principal.activeSetDigest,
            capabilities: currentPlugin.capabilities,
            hostApi: currentPlugin.hostApi!,
            manifestDigest: principal.manifestDigest,
            pluginId: principal.pluginId,
            pluginName: currentPlugin.name,
            pluginVersion: principal.pluginVersion,
            snapshotDigest: principal.snapshotDigest,
          }
        },
      },
    })
    const connect = (frameId: string) =>
      host.connect({
        canvas: {} as never,
        node: { canvasId: "canvas-1", nodeId: "plugin-1", projectId: "project-1" },
        principal,
        scope: { kind: "project", projectId: "project-1" },
        transport: { frameId, senderId: 7 },
      })
    const first = await connect("frame-1")
    const listed = (await first.execute({ method: "canvas.inputs.list" }, { operationId: "list-first" })) as {
      inputs: Array<{ inputKey: string; kind: string }>
    }
    const imageKey = listed.inputs.find(({ kind }) => kind === "image")?.inputKey
    const videoKey = listed.inputs.find(({ kind }) => kind === "video")?.inputKey
    if (!imageKey || !videoKey) throw new Error("Expected image and video input keys")
    const openedImage = (await first.execute(
      { method: "canvas.inputs.image.open", params: { inputKey: imageKey } },
      { operationId: "open-image-first" },
    )) as { sessionId: string; url: string }
    const openedStream = (await first.execute(
      { method: "canvas.inputs.open", params: { inputKey: videoKey } },
      { operationId: "open-stream-first" },
    )) as { sessionId: string; url: string }
    expect((await media.handle(new Request(openedImage.url, { method: "HEAD" }))).status).toBe(200)
    expect((await media.handle(new Request(openedStream.url, { method: "HEAD" }))).status).toBe(200)

    const rendererClient: PluginCapabilityRendererClient = {
      async cancel() {
        return false
      },
      async call() {
        throw new Error("unused")
      },
      async connect() {
        return { connectionId: "isolated-renderer-connection", protocol: pluginCapabilityProtocolV3 }
      },
      async disconnect({ connectionId }) {
        expect(connectionId).toBe("isolated-renderer-connection")
        first.close()
        return true
      },
      async getPluginAvailability() {
        throw new Error("unused")
      },
      async invokePlugin() {
        throw new Error("unused")
      },
      onEvent() {
        return () => undefined
      },
    }
    const rendererConnection = new RendererPluginHostConnection(
      rendererClient,
      {
        activeRevision: principal.activeRevision,
        activeSetDigest: principal.activeSetDigest,
        canvasId: "canvas-1",
        nodeId: "plugin-1",
        pluginId: principal.pluginId,
        pluginVersion: principal.pluginVersion,
        projectId: "project-1",
        runtime: "web",
        snapshotDigest: principal.snapshotDigest,
      },
      () => undefined,
    )
    await rendererConnection.dispatch({
      protocol: desktopPluginHostProtocolV8,
      type: "disconnect",
    })
    for (const url of [openedImage.url, openedStream.url]) {
      expect((await media.handle(new Request(url))).status).toBe(404)
      expect((await media.handle(new Request(url, { method: "HEAD" }))).status).toBe(404)
    }
    expect(
      media.closeImage(
        {
          canvasId: "canvas-1",
          frameId: "frame-1",
          nodeId: "plugin-1",
          pluginId: principal.pluginId,
          pluginVersion: principal.pluginVersion,
          projectId: "project-1",
          sessionId: openedImage.sessionId,
        },
        7,
      ),
    ).toBeFalse()
    expect(
      media.close(
        {
          canvasId: "canvas-1",
          frameId: "frame-1",
          nodeId: "plugin-1",
          pluginId: principal.pluginId,
          pluginVersion: principal.pluginVersion,
          projectId: "project-1",
          sessionId: openedStream.sessionId,
        },
        7,
      ),
    ).toBeFalse()

    const replacement = await connect("frame-2")
    const replacementInputs = (await replacement.execute(
      { method: "canvas.inputs.list" },
      { operationId: "list-replacement" },
    )) as { inputs: Array<{ inputKey: string; kind: string }> }
    const replacementImageKey = replacementInputs.inputs.find(({ kind }) => kind === "image")?.inputKey
    if (!replacementImageKey) throw new Error("Expected replacement image input key")
    const replacementImage = (await replacement.execute(
      { method: "canvas.inputs.image.open", params: { inputKey: replacementImageKey } },
      { operationId: "open-image-replacement" },
    )) as { url: string }
    expect((await media.handle(new Request(replacementImage.url))).status).toBe(200)
    replacement.close()
    expect((await media.handle(new Request(replacementImage.url))).status).toBe(404)
    media.dispose()
  })

  test("rejects missing grants, undeclared APIs, inactive identities, and legacy schemas", async () => {
    let currentPlugin = plugin("1.0.0", [])
    let active = true
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      application: canvasQueryApplication(canvas()),
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
