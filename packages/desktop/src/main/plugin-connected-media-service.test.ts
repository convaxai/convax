import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createCanvasDocument, type CanvasDocument } from "@convax/canvas/core"

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
  capabilities = ["canvas.connectedMedia.stream"] as string[],
  optionalHostApis = ["canvas.inputs.list", "canvas.inputs.open", "canvas.inputs.close"] as string[],
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
  test("maps an authoritative media-resolution failure to the Catalog resource error", async () => {
    const document = canvas()
    const currentPlugin = plugin()
    const service = new PluginConnectedMediaService({
      changes: new CanvasDocumentChangeBus(),
      documents: { load: async () => ({ document, storageVersion: "stored-1" }) },
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
    await expect(service.open(request, 7)).rejects.toThrow("not authorized")
    currentPlugin = plugin("1.0.0", ["canvas.connectedMedia.stream"], [])
    await expect(service.open(request, 7)).rejects.toThrow("not authorized")
    currentPlugin = plugin()
    active = false
    await expect(service.open(request, 7)).rejects.toThrow("not authorized")
    active = true
    currentPlugin = { ...plugin(), schema: "convax.plugin/7" } as unknown as ReturnType<typeof plugin>
    await expect(service.open(request, 7)).rejects.toThrow("not authorized")
    service.dispose()
  })
})
