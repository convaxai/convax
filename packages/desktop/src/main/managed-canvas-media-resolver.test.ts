import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { createCanvasDocument, createMediaNode } from "@convax/canvas"
import type { CanvasApplicationService } from "@convax/canvas/application"
import { canvasProjectionResourceMetadataKey, type CanvasResourceRef } from "@convax/canvas/collaboration"
import { encodeBase64url, ordinarySha256, parseId128, parseProjectId } from "@convax/collaboration"
import { parseProjectIndexResourceReference, projectIndexResourceReferenceDigest } from "@convax/project"
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
  return createCanvasDocument({ id: "canvas-1", nodes: [audio], title: "Canvas" })
}

function applicationFor(document: ReturnType<typeof audioDocument>): Pick<CanvasApplicationService, "query"> {
  return { query: mock(async () => ({ nodes: [], projection: document })) }
}

function noCurrentResources() {
  return { queryCurrentResources: mock(async () => []) }
}

function canonicalImageFixture(bytes: Uint8Array) {
  const projectId = parseProjectId("project-one")
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))
  const digest = ordinarySha256(bytes)
  const fileId = `pf_${"a".repeat(64)}`
  const reference = parseProjectIndexResourceReference({
    blob: {
      algorithm: "sha256",
      byteLength: String(bytes.byteLength),
      digest,
      format: "convax.blob-ref",
      mime: "image/png",
    },
    canonicalUri: `convax-project://${projectId}/epochs/${projectEpoch}/entries/${fileId}?blob=sha256%3A${digest}`,
    entryFileId: fileId,
    familyPrimaryFileId: fileId,
    format: "convax.project-resource-reference",
    projectEpoch,
    projectId,
    versionId: `pv_${"b".repeat(64)}`,
    versionRecordDigest: ordinarySha256(new TextEncoder().encode(`version:${digest}`)),
  })
  const resource: CanvasResourceRef = {
    byteLength: reference.blob.byteLength,
    contentDigest: reference.blob.digest,
    format: "convax.canvas-resource-ref",
    mediaClass: "image",
    mime: reference.blob.mime,
    ownerProofDigest: projectIndexResourceReferenceDigest(reference),
    uri: reference.canonicalUri,
  }
  const image = createMediaNode({
    id: "image-1",
    position: { x: 0, y: 0 },
    resource: {
      id: "image-resource",
      kind: "image",
      metadata: { [canvasProjectionResourceMetadataKey]: resource },
      name: "Current image",
      state: { status: "ready", url: "convax-asset://project/image" },
    },
  })
  return {
    document: createCanvasDocument({ id: "canvas-1", nodes: [image], title: "Canvas" }),
    projectId,
    reference,
  }
}

describe("ManagedCanvasMediaResolver", () => {
  test("resolves a validated managed audio file with an immutable native identity", async () => {
    const { asset } = await setupAsset("soundtrack.mp3", Buffer.from("ID3\u0004\u0000\u0000"))
    const reference = managedAudioReference("soundtrack.mp3", "a".repeat(64))
    const document = audioDocument(reference)
    const resolver = new ManagedCanvasMediaResolver({
      assets: { resolve: mock(async () => asset) },
      application: applicationFor(document),
      currentResources: noCurrentResources(),
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
      application: applicationFor(linkedDocument),
      currentResources: noCurrentResources(),
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
        { canvasId: "canvas-1", nodeIds: ["audio-1"], scopeId: "project-1" },
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
      application: applicationFor(forgedDocument),
      currentResources: noCurrentResources(),
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
        { canvasId: "canvas-1", nodeIds: ["audio-1"], scopeId: "project-1" },
        {
          allowedKinds: new Set(["audio"]),
          allowedKindsDescription: "audio",
          operationLabel: "external drag",
        },
      ),
    ).rejects.toThrow("content does not match")
  })

  test("resolves a canonical Canvas resource through the current ProjectIndex projection", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const { asset } = await setupAsset("current.png", bytes)
    const fixture = canonicalImageFixture(bytes)
    const current = [
      {
        materializedPath: "Media/current.png",
        reference: fixture.reference,
        storageClass: "project-file" as const,
      },
    ]
    const queryCurrentResources = mock(async () => current)
    const resolver = new ManagedCanvasMediaResolver({
      assets: {
        resolve: mock(async () => {
          throw new Error("Project files must not use managed asset paths")
        }),
      },
      application: applicationFor(fixture.document),
      currentResources: { queryCurrentResources },
      projects: {
        readFileInfo: mock(async () => ({
          kind: "file" as const,
          mimeType: "image/png",
          name: "current.png",
          path: "Media/current.png",
          size: bytes.byteLength,
        })),
        resolveEntryPath: mock(async () => asset),
      },
    })

    const [resolved] = await resolver.resolve(
      { canvasId: "canvas-1", nodeIds: ["image-1"], scopeId: fixture.projectId },
      {
        allowedKinds: new Set(["image"]),
        allowedKindsDescription: "media",
        operationLabel: "external drag",
      },
    )

    expect(resolved).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      name: "current.png",
      resourcePath: "Media/current.png",
    })
    expect(queryCurrentResources).toHaveBeenCalledTimes(2)
  })

  test("rejects a canonical resource when ProjectIndex ownership changes during preparation", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const { asset } = await setupAsset("stale.png", bytes)
    const fixture = canonicalImageFixture(bytes)
    const current = [
      {
        materializedPath: "Media/stale.png",
        reference: fixture.reference,
        storageClass: "project-file" as const,
      },
    ]
    let queries = 0
    const resolver = new ManagedCanvasMediaResolver({
      assets: { resolve: mock(async () => asset) },
      application: applicationFor(fixture.document),
      currentResources: {
        queryCurrentResources: mock(async () =>
          ++queries === 1 ? current : [{ ...current[0]!, materializedPath: "Media/replaced.png" }],
        ),
      },
      projects: {
        readFileInfo: mock(async () => ({
          kind: "file" as const,
          mimeType: "image/png",
          name: "stale.png",
          path: "Media/stale.png",
          size: bytes.byteLength,
        })),
        resolveEntryPath: mock(async () => asset),
      },
    })

    await expect(
      resolver.resolve(
        { canvasId: "canvas-1", nodeIds: ["image-1"], scopeId: fixture.projectId },
        {
          allowedKinds: new Set(["image"]),
          allowedKindsDescription: "media",
          operationLabel: "external drag",
        },
      ),
    ).rejects.toThrow("Project resource changed")
  })
})
