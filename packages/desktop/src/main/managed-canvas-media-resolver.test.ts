import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createCanvasDocument, createMediaNode } from "@convax/canvas"
import { projectResourceReferenceKey, type ProjectResourceReference } from "@convax/project/canvas"

import { ManagedCanvasMediaResolver } from "./managed-canvas-media-resolver"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function setupAsset(name: string, bytes: Uint8Array) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-managed-media-test-"))
  temporaryRoots.push(root)
  const asset = path.join(root, name)
  await fs.mkdir(path.dirname(asset), { recursive: true })
  await fs.writeFile(asset, bytes)
  return { asset, root }
}

function managedAudioReference(
  name: string,
  sha256: string,
): Extract<ProjectResourceReference, { kind: "managed-asset" }> {
  return { kind: "managed-asset", mediaType: "audio/mpeg", name, sha256 }
}

function audioDocument(reference: Extract<ProjectResourceReference, { kind: "managed-asset" }>) {
  const audio = createMediaNode({
    id: "audio-1",
    position: { x: 0, y: 0 },
    resource: {
      id: "audio-resource",
      kind: "audio",
      metadata: { [projectResourceReferenceKey]: reference },
      name: "Soundtrack",
      state: { status: "ready", url: "convax-asset://project/audio" },
    },
  })
  return { ...createCanvasDocument({ id: "canvas-1", nodes: [audio], title: "Canvas" }), revision: 3 }
}

describe("ManagedCanvasMediaResolver", () => {
  test("resolves a validated managed audio file with an immutable native identity", async () => {
    const { asset } = await setupAsset("soundtrack.mp3", Buffer.from("ID3\u0004\u0000\u0000"))
    const reference = managedAudioReference("soundtrack.mp3", "a".repeat(64))
    const document = audioDocument(reference)
    const resolver = new ManagedCanvasMediaResolver({
      assets: { resolve: mock(async () => asset) },
      documents: { load: mock(async () => ({ document, storageVersion: "v1" })) },
      projects: {
        readFileInfo: mock(async () => {
          throw new Error("Managed assets must not use Project file info")
        }),
        resolveEntryPath: mock(async () => {
          throw new Error("Managed assets must not use Project entry paths")
        }),
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
      resourcePath: `managed-asset:${reference.sha256}`,
      size: stat.size,
    })
  })

  test("rejects a symlink or forged bytes before publishing a native path", async () => {
    const valid = await setupAsset("valid.mp3", Buffer.from("ID3\u0004\u0000\u0000"))
    const linked = path.join(valid.root, "linked.mp3")
    await fs.symlink(valid.asset, linked)
    const linkedReference = managedAudioReference("linked.mp3", "b".repeat(64))
    const linkedDocument = audioDocument(linkedReference)
    const resolver = new ManagedCanvasMediaResolver({
      assets: { resolve: mock(async () => linked) },
      documents: { load: mock(async () => ({ document: linkedDocument, storageVersion: "v1" })) },
      projects: {
        readFileInfo: mock(async () => {
          throw new Error("Managed assets must not use Project file info")
        }),
        resolveEntryPath: mock(async () => {
          throw new Error("Managed assets must not use Project entry paths")
        }),
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
    const forgedReference = managedAudioReference("forged.mp3", "c".repeat(64))
    const forgedDocument = audioDocument(forgedReference)
    const forgedResolver = new ManagedCanvasMediaResolver({
      assets: { resolve: mock(async () => forged.asset) },
      documents: { load: mock(async () => ({ document: forgedDocument, storageVersion: "v1" })) },
      projects: {
        readFileInfo: mock(async () => {
          throw new Error("Managed assets must not use Project file info")
        }),
        resolveEntryPath: mock(async () => {
          throw new Error("Managed assets must not use Project entry paths")
        }),
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
