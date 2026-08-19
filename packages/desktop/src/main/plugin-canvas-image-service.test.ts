import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, type CanvasDocument } from "@convax/canvas/core"

import type { PluginCanvasImageCreateRequest } from "../plugin-canvas-image-contracts"
import type { PluginPrincipal } from "../plugin-capability-contracts"
import type { InstalledWebPluginSummary, WebPluginManifestV8 } from "../plugin-contracts"
import {
  PluginCanvasImagePublicationPartialSuccessError,
  PluginCanvasImageService,
} from "./plugin-canvas-image-service"
import { canvasCommandResult, canvasOperationReceipt, canvasQueryApplication } from "./canvas-application-test-fixtures"

function pngDataUrl(width = 2, height = 1) {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return `data:image/png;base64,${bytes.toString("base64")}`
}

function document(): CanvasDocument {
  return createCanvasDocument({
    id: "canvas-1",
    nodes: [
      {
        data: {
          kind: "plugin.capture-surface",
          label: "Capture Surface",
          metadata: {
            convaxPlugin: {
              entry: "index.html",
              id: "capture-surface",
              version: "1.0.0",
            },
          },
        },
        id: "plugin-node-1",
        position: { x: 100, y: 60 },
        style: { height: 640, width: 980 },
        type: "file",
      },
    ],
  })
}

function request(): PluginCanvasImageCreateRequest {
  return {
    dataUrl: pngDataUrl(),
    name: "viewport-capture.png",
    operationId: "capture-1",
    ownerNodeId: "plugin-node-1",
    pluginId: "capture-surface",
    pluginVersion: "1.0.0",
    ref: { canvasId: "canvas-1", scopeId: "project-1" },
  }
}

function pluginIdentity(
  overrides: Partial<WebPluginManifestV8> = {},
  digest = "a".repeat(64),
): { digest: string; plugin: InstalledWebPluginSummary } {
  return {
    digest,
    plugin: {
      capabilities: ["canvas.image.write"],
      contributes: { canvas: { renderer: { create: true, height: 640, width: 980 } } },
      description: "Capture one viewport",
      entry: "index.html",
      hostApi: { major: 3, optional: [], required: ["host.context.get"] },
      id: "capture-surface",
      name: "Capture Surface",
      schema: "convax.plugin/8",
      version: "1.0.0",
      ...overrides,
    },
  }
}

function applicationFor(...projections: readonly CanvasDocument[]) {
  let index = 0
  return canvasQueryApplication(() => projections[Math.min(index++, projections.length - 1)]!)
}

describe("Plugin Canvas image service", () => {
  test("publishes a validated PNG and creates one connected image node", async () => {
    const canvas = document()
    const addResources = mock(async () =>
      canvasCommandResult({ createdNodeIds: ["image-1"], document: canvas, operationId: "plugin-image:capture-1" }),
    )
    const publishGenerated = mock(async (input: { bytes?: Uint8Array; extension: string; name?: string }) => {
      expect(input.bytes).toEqual(Buffer.from(pngDataUrl().split(",")[1]!, "base64"))
      expect(input).toMatchObject({ extension: ".png", name: "viewport-capture.png" })
      return { path: "Generated/viewport-capture.png" }
    })
    const resolveCapabilityIdentity = mock(async () => pluginIdentity())
    const controller = new AbortController()
    const service = new PluginCanvasImageService({
      application: applicationFor(canvas),
      plugins: { resolveCapabilityIdentity },
      projects: { publishGenerated },
      resources: { addResources },
    })

    await expect(service.create(request(), controller.signal)).resolves.toEqual({
      createdNodeId: "image-1",
      operationReceipt: canvasOperationReceipt("plugin-image:capture-1"),
      projection: expect.objectContaining({ id: "canvas-1" }),
    })
    expect(resolveCapabilityIdentity).toHaveBeenCalledTimes(2)
    expect(addResources).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: "capture-surface", kind: "plugin" },
        anchor: { x: 1144, y: 60 },
        relation: { anchorNodeIds: ["plugin-node-1"], direction: "from-anchor", mode: "connect" },
        signal: controller.signal,
        sources: [expect.objectContaining({ kind: "host-file", path: "Generated/viewport-capture.png" })],
      }),
    )
  })

  test("an exact Host API snapshot change before publication creates no user file", async () => {
    const canvas = document()
    let current = true
    let published = 0
    const exactPrincipal: PluginPrincipal = {
      activeRevision: 9,
      activeSetDigest: "c".repeat(64),
      manifestDigest: "a".repeat(64),
      pluginId: "capture-surface",
      pluginVersion: "1.0.0",
      runtime: "web",
      snapshotDigest: "d".repeat(64),
    }
    const exactIdentity = () => ({
      activeRevision: current ? 9 : 10,
      activeSetDigest: current ? "c".repeat(64) : "e".repeat(64),
      ...pluginIdentity({}, current ? "a".repeat(64) : "b".repeat(64)),
      manifestDigest: current ? "a".repeat(64) : "b".repeat(64),
      snapshotDigest: current ? "d".repeat(64) : "f".repeat(64),
    })
    const service = new PluginCanvasImageService({
      application: applicationFor(canvas),
      plugins: { resolveCapabilityIdentity: async () => exactIdentity() },
      projects: {
        async publishGenerated(input) {
          current = false
          await input.beforePublish?.()
          published += 1
          return { path: "Generated/must-not-exist.png" }
        },
      },
      resources: {
        addResources: async () => {
          throw new Error("must not commit")
        },
      },
    })

    await expect(
      service.createForHostApi({
        binding: { canvasId: "canvas-1", nodeId: "plugin-node-1", projectId: "project-1" },
        checkpoint: { checkpoint: async () => nodeContextForImage(canvas) },
        dataUrl: pngDataUrl(),
        name: "capture.png",
        operationId: "operation-1",
        principal: exactPrincipal,
      }),
    ).rejects.toThrow("Plugin identity or Canvas image permission changed")
    expect(published).toBe(0)
  })

  test("retains the published image when the Canvas commit fails", async () => {
    const canvas = document()
    const publishGenerated = mock(async () => ({ path: "Generated/capture.png" }))
    const service = new PluginCanvasImageService({
      application: applicationFor(canvas),
      plugins: { resolveCapabilityIdentity: async () => pluginIdentity() },
      projects: { publishGenerated },
      resources: {
        addResources: async () => {
          throw new Error("Canvas changed")
        },
      },
    })

    await expect(service.create(request())).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "Canvas changed" }),
      message:
        "Plugin screenshot was saved, but the Canvas update could not be confirmed. Saved file: Generated/capture.png",
      name: "PluginCanvasImagePublicationPartialSuccessError",
      publishedPaths: ["Generated/capture.png"],
    } satisfies Partial<PluginCanvasImagePublicationPartialSuccessError>)
    expect(publishGenerated).toHaveBeenCalledTimes(1)
  })

  test("does not classify a pre-publication implementation bug as a resource or partial-success error", async () => {
    const canvas = document()
    const bug = new TypeError("publisher invariant failed")
    const service = new PluginCanvasImageService({
      application: applicationFor(canvas),
      plugins: { resolveCapabilityIdentity: async () => pluginIdentity() },
      projects: {
        async publishGenerated() {
          throw bug
        },
      },
      resources: {
        addResources: async () => {
          throw new Error("must not commit")
        },
      },
    })

    await expect(service.create(request())).rejects.toBe(bug)
  })

  test("rechecks the exact Plugin identity after publication before a stale commit", async () => {
    const canvas = document()
    const publishGenerated = mock(async () => ({ path: "Generated/capture.png" }))
    const addResources = mock(async () => {
      throw new Error("must not commit")
    })
    let resolution = 0
    const service = new PluginCanvasImageService({
      application: applicationFor(canvas),
      plugins: {
        resolveCapabilityIdentity: async () =>
          resolution++ === 0 ? pluginIdentity() : pluginIdentity({}, "b".repeat(64)),
      },
      projects: { publishGenerated },
      resources: { addResources },
    })

    await expect(service.create(request())).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "Plugin identity or Canvas image permission changed" }),
      name: "PluginCanvasImagePublicationPartialSuccessError",
      publishedPaths: ["Generated/capture.png"],
    })
    expect(addResources).not.toHaveBeenCalled()
    expect(publishGenerated).toHaveBeenCalledTimes(1)
  })

  test("rechecks the authoritative Plugin owner after publication before a stale commit", async () => {
    const canvas = document()
    const publishGenerated = mock(async () => ({ path: "Generated/capture.png" }))
    const addResources = mock(async () => {
      throw new Error("must not commit")
    })
    const service = new PluginCanvasImageService({
      application: applicationFor(canvas, createCanvasDocument({ id: canvas.id })),
      plugins: { resolveCapabilityIdentity: async () => pluginIdentity() },
      projects: { publishGenerated },
      resources: { addResources },
    })

    await expect(service.create(request())).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "Plugin screenshot owner node is no longer available" }),
      name: "PluginCanvasImagePublicationPartialSuccessError",
      publishedPaths: ["Generated/capture.png"],
    })
    expect(addResources).not.toHaveBeenCalled()
    expect(publishGenerated).toHaveBeenCalledTimes(1)
  })

  test("observes cancellation after publication without committing", async () => {
    const canvas = document()
    const controller = new AbortController()
    const publishGenerated = mock(async () => {
      controller.abort(new DOMException("capture canceled", "AbortError"))
      return { path: "Generated/capture.png" }
    })
    const addResources = mock(async () => {
      throw new Error("must not commit")
    })
    const service = new PluginCanvasImageService({
      application: applicationFor(canvas),
      plugins: { resolveCapabilityIdentity: async () => pluginIdentity() },
      projects: { publishGenerated },
      resources: { addResources },
    })

    await expect(service.create(request(), controller.signal)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "capture canceled" }),
      name: "PluginCanvasImagePublicationPartialSuccessError",
      publishedPaths: ["Generated/capture.png"],
    })
    expect(addResources).not.toHaveBeenCalled()
    expect(publishGenerated).toHaveBeenCalledTimes(1)
  })

  test("keeps a published image after the Canvas command committed even when its result is malformed", async () => {
    const canvas = document()
    const publishGenerated = mock(async () => ({ path: "Generated/capture.png" }))
    const service = new PluginCanvasImageService({
      application: applicationFor(canvas),
      plugins: { resolveCapabilityIdentity: async () => pluginIdentity() },
      projects: { publishGenerated },
      resources: {
        addResources: async () => canvasCommandResult({ document: canvas, operationId: "plugin-image:capture-1" }),
      },
    })

    await expect(service.create(request())).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("did not create exactly one Canvas image node"),
      }),
      name: "PluginCanvasImagePublicationPartialSuccessError",
      publishedPaths: ["Generated/capture.png"],
    })
    expect(publishGenerated).toHaveBeenCalledTimes(1)
  })
})

function nodeContextForImage(canvas: CanvasDocument) {
  const node = canvas.nodes[0]!
  return {
    canvas: { id: canvas.id },
    node: {
      data: node.data,
      id: node.id,
      position: node.position,
      style: node.style as Record<string, unknown>,
      type: node.type ?? "file",
    },
    project: { id: "project-1" },
  }
}
