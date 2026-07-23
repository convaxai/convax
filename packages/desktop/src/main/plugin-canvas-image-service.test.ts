import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, type CanvasDocument } from "@convax/canvas/core"

import type { PluginCanvasImageCreateRequest } from "../plugin-canvas-image-contracts"
import { PluginCanvasImageService } from "./plugin-canvas-image-service"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function pngDataUrl(width = 2, height = 1) {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return `data:image/png;base64,${bytes.toString("base64")}`
}

function document(): CanvasDocument {
  return {
    ...createCanvasDocument({
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
    }),
    revision: 3,
  }
}

function request(): PluginCanvasImageCreateRequest {
  return {
    dataUrl: pngDataUrl(),
    expectedRevision: 3,
    name: "viewport-capture.png",
    operationId: "capture-1",
    ownerNodeId: "plugin-node-1",
    pluginId: "capture-surface",
    pluginVersion: "1.0.0",
    ref: { canvasId: "canvas-1", scopeId: "project-1" },
  }
}

describe("Plugin Canvas image service", () => {
  test("imports a validated PNG, creates one connected image node, and keeps only the managed asset", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-image-test-"))
    temporaryRoots.push(temporaryRoot)
    const canvas = document()
    const addResources = mock(async () => ({
      affectedNodeIds: ["image-1"],
      changed: true,
      createdNodeIds: ["image-1"],
      document: { ...canvas, revision: 4 },
      storageVersion: "storage-4",
      warnings: [],
    }))
    const importEntries = mock(async (input: { sourcePaths: string[] }) => {
      expect(await fs.readFile(input.sourcePaths[0]!)).toEqual(Buffer.from(pngDataUrl().split(",")[1]!, "base64"))
      return { targetPaths: [".convax/assets/viewport-capture.png"] }
    })
    const deleteManagedAssets = mock(async () => undefined)
    const service = new PluginCanvasImageService({
      documents: { load: async () => ({ document: canvas }) },
      projects: { deleteManagedAssets, importEntries },
      resources: { addResources },
      temporaryRoot,
    })

    await expect(service.create(request())).resolves.toEqual({ createdNodeId: "image-1", revision: 4 })
    expect(addResources).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: "capture-surface", kind: "plugin" },
        anchor: { x: 1144, y: 60 },
        relation: { anchorNodeIds: ["plugin-node-1"], direction: "from-anchor", mode: "connect" },
        sources: [expect.objectContaining({ kind: "host-file", path: ".convax/assets/viewport-capture.png" })],
      }),
    )
    expect(deleteManagedAssets).not.toHaveBeenCalled()
  })

  test("rolls back the imported asset when the Canvas commit fails", async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-image-test-"))
    temporaryRoots.push(temporaryRoot)
    const canvas = document()
    const deleteManagedAssets = mock(async () => undefined)
    const service = new PluginCanvasImageService({
      documents: { load: async () => ({ document: canvas }) },
      projects: {
        deleteManagedAssets,
        importEntries: async () => ({ targetPaths: [".convax/assets/capture.png"] }),
      },
      resources: {
        addResources: async () => {
          throw new Error("Canvas changed")
        },
      },
      temporaryRoot,
    })

    await expect(service.create(request())).rejects.toThrow("Canvas changed")
    expect(deleteManagedAssets).toHaveBeenCalledWith({
      paths: [".convax/assets/capture.png"],
      projectId: "project-1",
    })
  })
})
