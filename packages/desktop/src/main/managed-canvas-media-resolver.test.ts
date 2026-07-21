import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createCanvasDocument, createMediaNode } from "@convax/canvas"
import { projectFileReferenceKey } from "@convax/project/canvas"

import { ManagedCanvasMediaResolver } from "./managed-canvas-media-resolver"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function setupAsset(name: string, bytes: Uint8Array) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-managed-media-test-"))
  temporaryRoots.push(root)
  const resourcePath = `.convax/assets/${name}`
  const asset = path.join(root, resourcePath)
  await fs.mkdir(path.dirname(asset), { recursive: true })
  await fs.writeFile(asset, bytes)
  return { asset, resourcePath, root }
}

function audioDocument(resourcePath: string) {
  const audio = createMediaNode({
    id: "audio-1",
    position: { x: 0, y: 0 },
    resource: {
      id: "audio-resource",
      kind: "audio",
      metadata: { [projectFileReferenceKey]: { path: resourcePath } },
      name: "Soundtrack",
      url: "convax-asset://project/audio",
    },
  })
  return { ...createCanvasDocument({ id: "canvas-1", nodes: [audio], title: "Canvas" }), revision: 3 }
}

describe("ManagedCanvasMediaResolver", () => {
  test("resolves a validated managed audio file with an immutable native identity", async () => {
    const { asset, resourcePath } = await setupAsset("soundtrack.mp3", Buffer.from("ID3\u0004\u0000\u0000"))
    const document = audioDocument(resourcePath)
    const resolver = new ManagedCanvasMediaResolver({
      documents: { load: mock(async () => ({ document, storageVersion: "v1" })) },
      projects: {
        readFileInfo: mock(async () => ({
          mimeType: "audio/mpeg",
          name: "soundtrack.mp3",
          path: resourcePath,
          size: 10,
        })),
        resolveEntryPath: mock(async () => asset),
      },
    })

    const [resolved] = await resolver.resolve(
      {
        canvasId: document.id,
        expectedRevision: document.revision,
        nodeIds: ["audio-1"],
        scopeId: "project-1",
      },
      {
        allowedKinds: new Set(["audio"]),
        allowedKindsDescription: "audio",
        operationLabel: "external drag",
      },
    )

    const stat = await fs.lstat(asset)
    expect(resolved).toMatchObject({
      identity: { dev: stat.dev, ino: stat.ino, size: stat.size },
      kind: "audio",
      mimeType: "audio/mpeg",
      name: "soundtrack.mp3",
      path: await fs.realpath(asset),
      resourcePath,
      size: stat.size,
    })
  })

  test("rejects a symlink or forged bytes before publishing a native path", async () => {
    const valid = await setupAsset("valid.mp3", Buffer.from("ID3\u0004\u0000\u0000"))
    const linked = path.join(valid.root, ".convax", "assets", "linked.mp3")
    await fs.symlink(valid.asset, linked)
    const linkedResourcePath = ".convax/assets/linked.mp3"
    const linkedDocument = audioDocument(linkedResourcePath)
    const resolver = new ManagedCanvasMediaResolver({
      documents: { load: mock(async () => ({ document: linkedDocument, storageVersion: "v1" })) },
      projects: {
        readFileInfo: mock(async () => ({
          mimeType: "audio/mpeg",
          name: "linked.mp3",
          path: linkedResourcePath,
          size: 10,
        })),
        resolveEntryPath: mock(async () => linked),
      },
    })
    await expect(
      resolver.resolve(
        { canvasId: "canvas-1", expectedRevision: 3, nodeIds: ["audio-1"], scopeId: "project-1" },
        {
          allowedKinds: new Set(["audio"]),
          allowedKindsDescription: "audio",
          operationLabel: "external drag",
        },
      ),
    ).rejects.toThrow("not a regular Project file")

    const forged = await setupAsset("forged.mp3", Buffer.from("not audio"))
    const forgedDocument = audioDocument(forged.resourcePath)
    const forgedResolver = new ManagedCanvasMediaResolver({
      documents: { load: mock(async () => ({ document: forgedDocument, storageVersion: "v1" })) },
      projects: {
        readFileInfo: mock(async () => ({
          mimeType: "audio/mpeg",
          name: "forged.mp3",
          path: forged.resourcePath,
          size: 9,
        })),
        resolveEntryPath: mock(async () => forged.asset),
      },
    })
    await expect(
      forgedResolver.resolve(
        { canvasId: "canvas-1", expectedRevision: 3, nodeIds: ["audio-1"], scopeId: "project-1" },
        {
          allowedKinds: new Set(["audio"]),
          allowedKindsDescription: "audio",
          operationLabel: "external drag",
        },
      ),
    ).rejects.toThrow("content does not match")
  })
})
