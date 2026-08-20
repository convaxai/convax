import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { canvasProjectionResourceMetadataKey } from "@convax/canvas/collaboration"
import { createCanvasDocument, createMediaNode, createTextNode } from "@convax/canvas/core"
import { encodeBase64url, ordinarySha256, parseId128, parseProjectId } from "@convax/collaboration"
import { projectResourceReferenceKey } from "../../canvas/project-resources"
import { projectIndexResourceReferenceDigest, type ProjectIndexResourceReference } from "../../collaboration/project-index"
import { NodeProjectManager } from "../project-manager"
import { ProjectCanvasResourceHydrator } from "./project-canvas-resource-hydrator"
import { ProjectManagedAssetStore } from "./project-managed-asset-store"

let temporaryRoot = ""
let projectRoot = ""
let projectId = ""
let manager: NodeProjectManager
let assets: ProjectManagedAssetStore
let hydrator: ProjectCanvasResourceHydrator

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-resource-hydrator-"))
  projectRoot = path.join(temporaryRoot, "project")
  await fs.mkdir(projectRoot)
  manager = new NodeProjectManager({
    maxReadableFileBytes: 1024,
    maxTextFileBytes: 1024,
    registryFile: path.join(temporaryRoot, "user-data", "projects.json"),
  })
  projectId = (await manager.addProject(projectRoot)).id
  assets = new ProjectManagedAssetStore(manager, { maximumBytes: 1024 })
  hydrator = new ProjectCanvasResourceHydrator(
    manager,
    assets,
    ({ contentRevision, projectId: scopedProjectId, reference }) => {
      const url = new URL(`convax-asset://${scopedProjectId}/${reference.kind}`)
      if (reference.kind === "project-file") url.searchParams.set("path", reference.path)
      if (reference.kind === "managed-asset") url.searchParams.set("sha256", reference.sha256)
      if (contentRevision) url.searchParams.set("revision", contentRevision)
      return url.href
    },
    { maximumMediaBytes: 1024 },
  )
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { force: true, recursive: true })
})

describe("ProjectCanvasResourceHydrator", () => {
  test("re-reads editable Project Markdown from disk without a cache", async () => {
    await fs.mkdir(path.join(projectRoot, "Notes"))
    const target = path.join(projectRoot, "Notes", "brief.md")
    await fs.writeFile(target, "# First")
    const reference = { kind: "project-file", path: "Notes/brief.md" } as const

    const first = await hydrator.resolve({ projectId, reference })
    await fs.writeFile(target, "# Second")
    const second = await hydrator.resolve({ projectId, reference })

    expect(first).toEqual({
      contentRevision: createHash("sha256").update("# First").digest("hex"),
      editableText: true,
      mediaType: "text/markdown",
      name: "brief.md",
      status: "ready",
      text: "# First",
    })
    expect(second).toEqual({
      contentRevision: createHash("sha256").update("# Second").digest("hex"),
      editableText: true,
      mediaType: "text/markdown",
      name: "brief.md",
      status: "ready",
      text: "# Second",
    })
  })

  test("returns bounded missing, corrupt UTF-8, and unsupported states", async () => {
    await fs.writeFile(path.join(projectRoot, "invalid.txt"), Buffer.from([0xc3, 0x28]))
    await fs.writeFile(path.join(projectRoot, "archive.bin"), "binary")

    await expect(
      hydrator.resolve({ projectId, reference: { kind: "project-file", path: "missing.md" } }),
    ).resolves.toEqual({ status: "missing" })
    await expect(
      hydrator.resolve({ projectId, reference: { kind: "project-file", path: "invalid.txt" } }),
    ).resolves.toEqual({ error: "Project text resource is corrupt", status: "corrupt" })
    await expect(
      hydrator.resolve({ projectId, reference: { kind: "project-file", path: "archive.bin" } }),
    ).resolves.toEqual({ status: "unsupported" })
  })

  test("hydrates Project media to a typed revision URL that changes with same-path bytes", async () => {
    await fs.writeFile(path.join(projectRoot, "hero.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const first = await hydrator.resolve({
      projectId,
      reference: { kind: "project-file", path: "hero.png" },
    })
    await fs.writeFile(path.join(projectRoot, "hero.png"), Buffer.from([0x89, 0x50, 0x4e, 0x48]))
    const second = await hydrator.resolve({
      projectId,
      reference: { kind: "project-file", path: "hero.png" },
    })

    const firstRevision = createHash("sha256")
      .update(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      .digest("hex")
    const secondRevision = createHash("sha256")
      .update(Buffer.from([0x89, 0x50, 0x4e, 0x48]))
      .digest("hex")
    expect(first).toEqual({
      contentRevision: firstRevision,
      mediaType: "image/png",
      name: "hero.png",
      status: "ready",
      url: `convax-asset://${projectId}/project-file?path=hero.png&revision=${firstRevision}`,
    })
    expect(second).toEqual({
      contentRevision: secondRevision,
      mediaType: "image/png",
      name: "hero.png",
      status: "ready",
      url: `convax-asset://${projectId}/project-file?path=hero.png&revision=${secondRevision}`,
    })
    expect(first.url).not.toBe(second.url)
    expect(JSON.stringify([first, second])).not.toContain(projectRoot)
  })

  test("reuses managed-asset digest verification and keeps managed text read-only", async () => {
    const outside = path.join(temporaryRoot, "outside.md")
    await fs.writeFile(outside, "managed text")
    const reference = await assets.admitExternalFile({ name: "outside.md", projectId, sourcePath: outside })

    const result = await hydrator.resolve({ projectId, reference })

    expect(result).toEqual({
      contentRevision: reference.sha256,
      editableText: false,
      canSaveEditableCopy: true,
      mediaType: "text/markdown",
      name: "outside.md",
      status: "ready",
      text: "managed text",
    })

    await fs.writeFile(path.join(projectRoot, ".convax", "assets", "blobs", reference.sha256), "tampered")
    await expect(hydrator.resolve({ projectId, reference })).resolves.toEqual({
      error: "Managed resource is corrupt",
      status: "corrupt",
    })
  })

  test("hydrates managed media with only its typed URL", async () => {
    const outside = path.join(temporaryRoot, "outside.png")
    await fs.writeFile(outside, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const reference = await assets.admitExternalFile({
      mediaType: "image/png",
      name: "outside.png",
      projectId,
      sourcePath: outside,
    })

    const result = await hydrator.resolve({ projectId, reference })

    expect(result).toEqual({
      mediaType: "image/png",
      name: "outside.png",
      status: "ready",
      url: `convax-asset://${projectId}/managed-asset?sha256=${reference.sha256}`,
    })
    expect(JSON.stringify(result)).not.toContain(".convax")
    expect(JSON.stringify(result)).not.toContain(projectRoot)
  })

  test("reads Project and managed images through one bounded typed byte capability", async () => {
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    await fs.writeFile(path.join(projectRoot, "hero.png"), pngBytes)
    const outside = path.join(temporaryRoot, "outside.webp")
    const webpBytes = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])
    await fs.writeFile(outside, webpBytes)
    const managed = await assets.admitExternalFile({
      mediaType: "image/webp",
      name: "outside.webp",
      projectId,
      sourcePath: outside,
    })

    const projectImage = await hydrator.readImage({
      maximumBytes: 1024,
      projectId,
      reference: { kind: "project-file", path: "hero.png" },
    })
    const managedImage = await hydrator.readImage({ maximumBytes: 1024, projectId, reference: managed })

    expect(projectImage).toEqual({
      bytes: pngBytes,
      contentDigest: createHash("sha256").update(pngBytes).digest("hex"),
      mimeType: "image/png",
      name: "hero.png",
      size: pngBytes.byteLength,
    })
    expect(managedImage).toEqual({
      bytes: webpBytes,
      contentDigest: managed.sha256,
      mimeType: "image/webp",
      name: "outside.webp",
      size: webpBytes.byteLength,
    })
    expect(JSON.stringify([projectImage, managedImage])).not.toContain(projectRoot)
    expect(JSON.stringify([projectImage, managedImage])).not.toContain("convaxProjectResource")

    await fs.writeFile(path.join(projectRoot, ".convax", "assets", "blobs", managed.sha256), webpBytes.subarray(0, 12))
    await expect(hydrator.readImage({ maximumBytes: 1024, projectId, reference: managed })).rejects.toThrow(/digest/i)
  })

  test("accepts an image at the exact configured byte ceiling", async () => {
    const exact = Buffer.alloc(16 * 1024 * 1024, 1)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(exact)
    await fs.writeFile(path.join(projectRoot, "exact.png"), exact)
    const bounded = new ProjectCanvasResourceHydrator(manager, assets, () => "convax-asset://bounded", {
      maximumMediaBytes: exact.byteLength,
    })

    const result = await bounded.readImage({
      maximumBytes: exact.byteLength,
      projectId,
      reference: { kind: "project-file", path: "exact.png" },
    })

    expect(result.size).toBe(exact.byteLength)
    expect(result.contentDigest).toBe(createHash("sha256").update(exact).digest("hex"))
  })

  test("rejects image bytes that exceed the bound or disagree with declared metadata", async () => {
    await fs.writeFile(path.join(projectRoot, "fake.jpg"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    await fs.writeFile(path.join(projectRoot, "large.png"), Buffer.alloc(17, 1))
    await fs.writeFile(path.join(projectRoot, "bounded.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]))

    await expect(
      hydrator.readImage({
        maximumBytes: 1024,
        projectId,
        reference: { kind: "project-file", path: "fake.jpg" },
      }),
    ).rejects.toThrow(/MIME|signature/i)
    await expect(
      hydrator.readImage({
        maximumBytes: 16,
        projectId,
        reference: { kind: "project-file", path: "large.png" },
      }),
    ).rejects.toThrow(/large/i)
    await expect(
      hydrator.readImage({
        maximumBytes: 1025,
        projectId,
        reference: { kind: "project-file", path: "bounded.png" },
      }),
    ).rejects.toThrow(/limit/i)
    await expect(
      hydrator.readImage({
        maximumBytes: 1024,
        projectId,
        reference: { kind: "project-directory", path: "images" },
      }),
    ).rejects.toThrow(/directories/i)
  })

  test("cancels a typed image read before native path resolution", async () => {
    const controller = new AbortController()
    controller.abort(new DOMException("Image read canceled", "AbortError"))

    await expect(
      hydrator.readImage({
        maximumBytes: 1024,
        projectId,
        reference: { kind: "project-file", path: "hero.png" },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" })
  })

  test("hydrates a full document while preserving the typed reference", async () => {
    await fs.writeFile(path.join(projectRoot, "brief.txt"), "hello")
    const reference = { kind: "project-file", path: "brief.txt" } as const
    const document = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "brief",
          metadata: { [projectResourceReferenceKey]: reference },
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        }),
      ],
    })

    const hydrated = await hydrator.hydrate({ document, projectId })

    expect(hydrated.nodes[0]!.data.metadata).toEqual({ [projectResourceReferenceKey]: reference })
    expect(hydrated.nodes[0]!.data.resourceState).toMatchObject({ status: "ready", text: "hello" })
  })

  test("resolves a canonical Canvas resource through current ProjectIndex before hydration", async () => {
    const directory = path.join(projectRoot, "assets", "images")
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, "hero.png"), bytes)
    const reference = currentProjectReference(projectId, bytes, "image/png")
    const ownerProofDigest = projectIndexResourceReferenceDigest(reference)
    const queryCurrentResources = mock(async () => {
      throw new Error("Hydration must not query the full ProjectIndex resource projection")
    })
    const queryCurrentResourcesExact = mock(async () => [{
      materializedPath: "assets/images/hero.png",
      reference,
      storageClass: "project-file" as const,
    }])
    const canonicalHydrator = new ProjectCanvasResourceHydrator(
      manager,
      assets,
      ({ contentRevision, projectId: scopedProjectId, reference: projectedReference }) => {
        const url = new URL(`convax-asset://${scopedProjectId}/${projectedReference.kind}`)
        if (projectedReference.kind === "project-file") url.searchParams.set("path", projectedReference.path)
        if (contentRevision) url.searchParams.set("revision", contentRevision)
        return url.href
      },
      {
        currentResources: {
          async queryCurrentBlobDigests() { return new Set([reference.blob.digest]) },
          queryCurrentResources,
          queryCurrentResourcesExact,
        },
        maximumMediaBytes: 1024,
      },
    )
    const resource = {
      format: "convax.canvas-resource-ref" as const,
      uri: reference.canonicalUri,
      mediaClass: "image" as const,
      mime: reference.blob.mime,
      byteLength: reference.blob.byteLength,
      contentDigest: reference.blob.digest,
      ownerProofDigest,
    }
    const document = createCanvasDocument({
      id: "canvas-canonical-resource",
      nodes: [
        createMediaNode({
          id: "hero",
          position: { x: 0, y: 0 },
          resource: {
            id: "hero-resource",
            kind: "image",
            metadata: { [canvasProjectionResourceMetadataKey]: resource },
            name: "hero.png",
            state: { status: "stale" },
          },
        }),
      ],
    })

    const hydrated = await canonicalHydrator.hydrateStale({ document, projectId })

    expect(hydrated.nodes[0]!.data.metadata).toEqual({
      [canvasProjectionResourceMetadataKey]: resource,
    })
    expect(hydrated.nodes[0]!.data.resourceState).toMatchObject({
      contentRevision: reference.blob.digest,
      mediaType: "image/png",
      name: "hero.png",
      status: "ready",
      url: expect.stringContaining("convax-asset://"),
    })
    expect(queryCurrentResources).not.toHaveBeenCalled()
    expect(queryCurrentResourcesExact).toHaveBeenCalledWith({
      projectId,
      targets: [{ uri: reference.canonicalUri, ownerProofDigest }],
    })
  })

  test("fails closed without an exact owner query and never falls back to the full resource projection", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const reference = currentProjectReference(projectId, bytes, "image/png")
    const resource = {
      format: "convax.canvas-resource-ref" as const,
      uri: reference.canonicalUri,
      mediaClass: "image" as const,
      mime: reference.blob.mime,
      byteLength: reference.blob.byteLength,
      contentDigest: reference.blob.digest,
      ownerProofDigest: projectIndexResourceReferenceDigest(reference),
    }
    const queryCurrentResources = mock(async () => {
      throw new Error("Hydration must not query the full ProjectIndex resource projection")
    })
    const exactOnlyHydrator = new ProjectCanvasResourceHydrator(
      manager,
      assets,
      () => { throw new Error("An unverified resource must not receive a runtime URL") },
      {
        currentResources: {
          async queryCurrentBlobDigests() { return new Set([reference.blob.digest]) },
          queryCurrentResources,
        },
      },
    )
    const document = createCanvasDocument({
      id: "canvas-exact-owner-unavailable",
      nodes: [createMediaNode({
        id: "unverified",
        position: { x: 0, y: 0 },
        resource: {
          id: "unverified-resource",
          kind: "image",
          metadata: { [canvasProjectionResourceMetadataKey]: resource },
          name: "unverified.png",
          state: { status: "stale" },
        },
      })],
    })

    const hydrated = await exactOnlyHydrator.hydrateStale({ document, projectId })
    expect(hydrated.nodes[0]!.data.resourceState).toEqual({ status: "stale" })
    expect(queryCurrentResources).not.toHaveBeenCalled()
  })

  test("hydrates a canonical managed resource from its exact ProjectIndex storage class without persisting native metadata", async () => {
    const outside = path.join(temporaryRoot, "managed.png")
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await fs.writeFile(outside, bytes)
    const managed = await assets.admitExternalFile({
      mediaType: "image/png",
      name: "managed.png",
      projectId,
      sourcePath: outside,
    })
    if (managed.kind !== "managed-asset") throw new Error("Managed admission did not return a managed asset")
    const reference = currentProjectReference(projectId, bytes, "image/png")
    const ownerProofDigest = projectIndexResourceReferenceDigest(reference)
    const canonicalHydrator = new ProjectCanvasResourceHydrator(
      manager,
      assets,
      ({ projectId: scopedProjectId, reference: projectedReference }) => {
        const url = new URL(`convax-asset://${scopedProjectId}/${projectedReference.kind}`)
        if (projectedReference.kind === "managed-asset") url.searchParams.set("sha256", projectedReference.sha256)
        return url.href
      },
      {
        currentResources: {
          async queryCurrentBlobDigests() { return new Set([reference.blob.digest]) },
          async queryCurrentResources() { throw new Error("must not query the full projection") },
          async queryCurrentResourcesExact() {
            return [{ materializedPath: null, reference, storageClass: "managed-blob" as const }]
          },
        },
        maximumMediaBytes: 1024,
      },
    )
    const resource = {
      format: "convax.canvas-resource-ref" as const,
      uri: reference.canonicalUri,
      mediaClass: "image" as const,
      mime: reference.blob.mime,
      byteLength: reference.blob.byteLength,
      contentDigest: reference.blob.digest,
      ownerProofDigest,
    }
    const document = createCanvasDocument({
      id: "canvas-canonical-managed-resource",
      nodes: [createMediaNode({
        id: "managed",
        position: { x: 0, y: 0 },
        resource: {
          id: "managed-resource",
          kind: "image",
          metadata: { [canvasProjectionResourceMetadataKey]: resource },
          name: "managed.png",
          state: { status: "stale" },
        },
      })],
    })

    const hydrated = await canonicalHydrator.hydrateStale({ document, projectId })

    expect(hydrated.nodes[0]!.data.metadata).toEqual({ [canvasProjectionResourceMetadataKey]: resource })
    expect(hydrated.nodes[0]!.data.resourceState).toMatchObject({
      mediaType: "image/png",
      name: "managed.png",
      status: "ready",
      url: `convax-asset://${projectId}/managed-asset?sha256=${managed.sha256}`,
    })
  })

  test("does not reinterpret a current but unmaterialized Project file as a managed asset", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const reference = currentProjectReference(projectId, bytes, "image/png")
    const resource = {
      format: "convax.canvas-resource-ref" as const,
      uri: reference.canonicalUri,
      mediaClass: "image" as const,
      mime: reference.blob.mime,
      byteLength: reference.blob.byteLength,
      contentDigest: reference.blob.digest,
      ownerProofDigest: projectIndexResourceReferenceDigest(reference),
    }
    const canonicalHydrator = new ProjectCanvasResourceHydrator(
      manager,
      assets,
      () => { throw new Error("Unmaterialized Project file must not receive a runtime URL") },
      {
        currentResources: {
          async queryCurrentBlobDigests() { return new Set([reference.blob.digest]) },
          async queryCurrentResources() { throw new Error("must not query the full projection") },
          async queryCurrentResourcesExact() {
            return [{ materializedPath: null, reference, storageClass: "project-file" as const }]
          },
        },
      },
    )
    const document = createCanvasDocument({
      id: "canvas-declared-missing-resource",
      nodes: [createMediaNode({
        id: "missing",
        position: { x: 0, y: 0 },
        resource: {
          id: "missing-resource",
          kind: "image",
          metadata: { [canvasProjectionResourceMetadataKey]: resource },
          name: "missing.png",
          state: { status: "stale" },
        },
      })],
    })

    const hydrated = await canonicalHydrator.hydrateStale({ document, projectId })
    expect(hydrated.nodes[0]!.data.metadata).toEqual({ [canvasProjectionResourceMetadataKey]: resource })
    expect(hydrated.nodes[0]!.data.resourceState).toEqual({ status: "missing" })
  })

  test("refreshes only stale mutable references and observes delete then recreate without a cache", async () => {
    const target = path.join(projectRoot, "brief.txt")
    await fs.writeFile(target, "before")
    const reference = { kind: "project-file", path: "brief.txt" } as const
    const document = createCanvasDocument({
      id: "canvas-refresh",
      nodes: [
        createTextNode({
          id: "brief",
          metadata: { [projectResourceReferenceKey]: reference },
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        }),
        createTextNode({
          id: "already-ready",
          metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "untouched.txt" } },
          position: { x: 20, y: 0 },
          resourceState: { status: "ready", text: "keep" },
        }),
      ],
    })

    const first = await hydrator.hydrateStale({ document, projectId })
    expect(first.nodes[0]!.data.resourceState).toMatchObject({ status: "ready", text: "before" })
    expect(first.nodes[1]).toBe(document.nodes[1])

    await fs.unlink(target)
    const missing = await hydrator.hydrateStale({
      document: {
        ...first,
        nodes: first.nodes.map((node) =>
          node.id === "brief" ? { ...node, data: { ...node.data, resourceState: { status: "stale" } } } : node,
        ),
      },
      projectId,
    })
    expect(missing.nodes[0]!.data.resourceState).toEqual({ status: "missing" })

    await fs.writeFile(target, "after")
    const recreated = await hydrator.hydrateStale({
      document: {
        ...missing,
        nodes: missing.nodes.map((node) =>
          node.id === "brief" ? { ...node, data: { ...node.data, resourceState: { status: "stale" } } } : node,
        ),
      },
      projectId,
    })
    expect(recreated.nodes[0]!.data.resourceState).toMatchObject({ status: "ready", text: "after" })
  })
})

function currentProjectReference(projectIdValue: string, bytes: Uint8Array, mime: string): ProjectIndexResourceReference {
  const projectId = parseProjectId(projectIdValue)
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))
  const digest = ordinarySha256(bytes)
  const fileId = `pf_${"a".repeat(64)}` as ProjectIndexResourceReference["entryFileId"]
  return Object.freeze({
    format: "convax.project-resource-reference",
    projectId,
    projectEpoch,
    entryFileId: fileId,
    familyPrimaryFileId: fileId,
    versionId: `pv_${"b".repeat(64)}`,
    canonicalUri: `convax-project://${projectId}/epochs/${projectEpoch}/entries/${fileId}?blob=sha256%3A${digest}`,
    blob: {
      format: "convax.blob-ref" as const,
      algorithm: "sha256" as const,
      digest,
      byteLength: String(bytes.byteLength) as never,
      mime,
    },
    versionRecordDigest: ordinarySha256(new TextEncoder().encode(`version:${digest}`)),
  })
}
