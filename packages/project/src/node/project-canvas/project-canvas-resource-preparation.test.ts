import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  ordinarySha256,
  parseId128,
  parseProjectId,
  type Digest,
} from "@convax/collaboration"
import { CanvasResourcePartialFailureError } from "@convax/canvas/application"
import type { ProjectIndexResourceReference } from "../../collaboration/project-index"
import type {
  ProjectIndexFileApplicationPort,
  ProjectIndexFileMaterializationProjectionPort,
} from "../../canvas/project-index-file-application"
import { getProjectResourceReference, type ProjectResourceReference as CanvasProjectResourceReference } from "../../canvas/project-resources"
import {
  ProjectCanvasResourcePreparation,
  type ProjectCanvasFilePublisher,
  type ProjectCanvasResourceHost,
} from "./project-canvas-resource-preparation"
import { ProjectManagedAssetStore } from "./project-managed-asset-store"

const requestRef = { canvasId: "canvas_main", scopeId: "project_one" }

describe("project canvas resource preparation", () => {
  test.each([
    ["Brief.md", ".md", "text/markdown"],
    ["notes.TXT", ".txt", "text/plain"],
  ] as const)("publishes a verified managed %s as an editable Notes copy", async (name, extension, mimeType) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-editable-copy-"))
    const sourcePath = path.join(root, name)
    const content = "# 你好\nPlain text"
    const bytes = Buffer.from(content, "utf8")
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    await fs.writeFile(sourcePath, bytes)
    const publications: unknown[] = []
    const preparation = new ProjectCanvasResourcePreparation(
      host(),
      {
        async publishText(input) {
          publications.push(input)
          return { contentRevision: sha256, path: `Notes/${name}-copy${extension}` }
        },
      },
      {
        async resolve(input: unknown) {
          expect(input).toEqual({
            projectId: "project_one",
            reference: { kind: "managed-asset", mediaType: mimeType, name, sha256 },
          })
          return fs.realpath(sourcePath)
        },
      } as unknown as ProjectManagedAssetStore,
    )

    try {
      const prepared = await preparation.prepareManagedTextEditableCopy({
        projectId: "project_one",
        reference: { kind: "managed-asset", mediaType: mimeType, name, sha256 },
        sourceId: "editable-copy",
      })

      expect(publications).toEqual([
        {
          content,
          directory: "Notes",
          extension,
          name,
          projectId: "project_one",
        },
      ])
      expect(prepared.retainedOnFailure).toEqual([{ label: `Notes/${name}-copy${extension}` }])
      expect(prepared.items[0]).toMatchObject({
        id: "editable-copy",
        kind: "text",
        metadata: {
          convaxProjectResource: { kind: "project-file", path: `Notes/${name}-copy${extension}` },
        },
        mimeType,
        name: `${name}-copy${extension}`,
        state: {
          contentRevision: sha256,
          editableText: true,
          status: "ready",
          text: content,
        },
      })
      expect(await fs.readFile(sourcePath)).toEqual(bytes)
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  test("rejects non-text, invalid UTF-8, and digest-mismatched managed editable copies before publication", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-invalid-editable-copy-"))
    const sourcePath = path.join(root, "invalid.md")
    let publications = 0
    const preparation = new ProjectCanvasResourcePreparation(
      host(),
      {
        async publishText() {
          publications += 1
          throw new Error("must not publish")
        },
      },
      {
        async resolve() {
          return fs.realpath(sourcePath)
        },
      } as unknown as ProjectManagedAssetStore,
    )
    const base = { projectId: "project_one", sourceId: "editable-copy" }

    try {
      await fs.writeFile(sourcePath, "valid")
      await expect(
        preparation.prepareManagedTextEditableCopy({
          ...base,
          reference: { kind: "managed-asset", name: "image.png", sha256: "a".repeat(64) },
        }),
      ).rejects.toThrow("Markdown or plain text")
      await expect(
        preparation.prepareManagedTextEditableCopy({
          ...base,
          reference: { kind: "project-file", path: "Notes/already.md" },
        }),
      ).rejects.toThrow("managed asset")
      await expect(
        preparation.prepareManagedTextEditableCopy({
          ...base,
          reference: { kind: "managed-asset", name: "wrong.md", sha256: "a".repeat(64) },
        }),
      ).rejects.toThrow("digest")

      await fs.writeFile(sourcePath, Buffer.from([0xc3, 0x28]))
      const invalidDigest = createHash("sha256")
        .update(Buffer.from([0xc3, 0x28]))
        .digest("hex")
      await expect(
        preparation.prepareManagedTextEditableCopy({
          ...base,
          reference: { kind: "managed-asset", name: "invalid.md", sha256: invalidDigest },
        }),
      ).rejects.toThrow("UTF-8")
      expect(publications).toBe(0)
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  test("keeps every Project file in place", async () => {
    let assetCalls = 0
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo(input) {
          return { mimeType: "image/png", name: "hero.png", path: input.path, size: 42 }
        },
      }),
      unusedPublisher(),
      {
        admitExternalFile() {
          assetCalls += 1
          throw new Error("Project files must not be admitted as managed assets")
        },
      } as unknown as ProjectManagedAssetStore,
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "host-file", path: "media/hero.png", sourceId: "hero" }],
    })

    expect(assetCalls).toBe(0)
    expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
      kind: "project-file",
      path: "media/hero.png",
    })
    expect(result.items[0]).toMatchObject({
      id: "hero",
      kind: "image",
      name: "hero.png",
      state: { status: "stale" },
    })
    expect(result.items[0]).not.toHaveProperty("path")
    expect(result.items[0]).not.toHaveProperty("url")
  })

  test("reads Project text directly into runtime state", async () => {
    const readPaths: string[] = []
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo(input) {
          readPaths.push(input.path)
          return { mimeType: "text/markdown", name: "brief.md", path: input.path, size: 7 }
        },
        async readTextFile(input) {
          readPaths.push(input.path)
          return { content: "# Brief", contentRevision: "stable-byte-revision", exists: true, path: input.path }
        },
      }),
      unusedPublisher(),
      unusedAssets(),
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "host-file", path: "docs/brief.md", sourceId: "brief" }],
    })

    expect(readPaths).toEqual(["docs/brief.md", "docs/brief.md"])
    expect(result.items[0]).toMatchObject({
      id: "brief",
      kind: "text",
      mimeType: "text/markdown",
      name: "brief.md",
      state: {
        contentRevision: "stable-byte-revision",
        status: "ready",
        text: "# Brief",
      },
    })
    expect(result.items[0]).not.toHaveProperty("format")
    expect(result.items[0]).not.toHaveProperty("text")
  })

  test("keeps Project media inspection URLs only in transient resource state", async () => {
    const inspections: unknown[] = []
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo(input) {
          return { mimeType: "video/mp4", name: "clip.mp4", path: input.path, size: 42 }
        },
      }),
      unusedPublisher(),
      unusedAssets(),
      {
        async inspect(input) {
          inspections.push(input)
          return { durationMs: 1_500, height: 720, posterUrl: "blob:poster", width: 1_280 }
        },
      },
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "host-file", path: "media/clip.mp4", sourceId: "clip" }],
    })

    expect(inspections).toEqual([
      {
        kind: "video",
        mimeType: "video/mp4",
        name: "clip.mp4",
        path: "media/clip.mp4",
        projectId: "project_one",
      },
    ])
    expect(result.items[0]).toMatchObject({
      durationMs: 1_500,
      height: 720,
      id: "clip",
      kind: "video",
      state: { posterUrl: "blob:poster", status: "stale" },
      width: 1_280,
    })
    expect(result.items[0]).not.toHaveProperty("posterUrl")
    expect(result.items[0]).not.toHaveProperty("path")
    expect(result.items[0]).not.toHaveProperty("url")
  })

  test("publishes new text below Notes before returning a prepared item", async () => {
    const publications: unknown[] = []
    const publisher: ProjectCanvasFilePublisher = {
      async publishText(input) {
        publications.push(input)
        return { contentRevision: "revision-a", path: "Notes/Brief-a1.md" }
      },
    }
    const preparation = new ProjectCanvasResourcePreparation(host(), publisher, unusedAssets())

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "new-text", name: "Brief", sourceId: "new", text: "# Brief" }],
    })

    expect(publications).toEqual([
      {
        content: "# Brief",
        directory: "Notes",
        extension: ".md",
        name: "Brief",
        projectId: "project_one",
      },
    ])
    expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
      kind: "project-file",
      path: "Notes/Brief-a1.md",
    })
    expect(result.items[0]).toMatchObject({
      id: "new",
      kind: "text",
      mimeType: "text/markdown",
      name: "Brief-a1.md",
      state: { contentRevision: "revision-a", status: "ready", text: "# Brief" },
    })
    expect(result.items[0]).not.toHaveProperty("format")
    expect(result.retainedOnFailure).toEqual([{ label: "Notes/Brief-a1.md" }])
  })

  test("overlaps new-text publication with Notes owner preparation and reuses the verified plan", async () => {
    const content = "# Brief"
    const bytes = new TextEncoder().encode(content)
    const reference = projectIndexReference(bytes, "text/markdown")
    let planQueries = 0
    let planQueryStarted = false
    let publicationObservedPlanQuery = false
    const directories: string[] = []
    const indexFiles = {
      async queryFileMaterializationPlan() {
        planQueries += 1
        planQueryStarted = true
        return { projectId: parseProjectId("project_one"), entries: [] }
      },
      async createDirectory(input: { path: string }) {
        directories.push(input.path)
        return {
          status: "committed" as const,
          entryId: `pd_${"c".repeat(64)}` as never,
          versionId: null,
          reference: null,
        }
      },
      async publishFile(input: { exactBytes: Readonly<Uint8Array>; path: string }) {
        expect(input.path).toBe("Notes/Brief-a1.md")
        expect([...input.exactBytes]).toEqual([...bytes])
        return {
          status: "committed" as const,
          entryId: reference.entryFileId as never,
          versionId: reference.versionId,
          reference,
        }
      },
      async admitManagedBlob() { throw new Error("not used") },
      async relocateEntry() { throw new Error("not used") },
      async tombstoneEntry() { throw new Error("not used") },
    } as unknown as ProjectIndexFileApplicationPort & ProjectIndexFileMaterializationProjectionPort
    const preparation = new ProjectCanvasResourcePreparation(
      host(),
      {
        async publishText() {
          await Promise.resolve()
          publicationObservedPlanQuery = planQueryStarted
          return { contentRevision: ordinarySha256(bytes), path: "Notes/Brief-a1.md" }
        },
      },
      unusedAssets(),
      undefined,
      indexFiles,
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "new-text", sourceId: "new", text: content }],
    })

    expect(publicationObservedPlanQuery).toBeTrue()
    expect(planQueries).toBe(1)
    expect(directories).toEqual(["Notes"])
    expect(result.items[0]?.metadata).toMatchObject({
      convaxCanvasResourceProof: { mode: "current-owner-state" },
    })
  })

  test("reports a published Notes file when concurrent owner preparation fails", async () => {
    const ownerFailure = new Error("ProjectIndex Notes preparation failed")
    const preparation = new ProjectCanvasResourcePreparation(
      host(),
      {
        async publishText() {
          return { contentRevision: "revision-a", path: "Notes/retained-a1.md" }
        },
      },
      unusedAssets(),
      undefined,
      {
        async queryFileMaterializationPlan() {
          return { projectId: parseProjectId("project_one"), entries: [] }
        },
        async createDirectory() { throw ownerFailure },
        async publishFile() { throw new Error("not used") },
      } as unknown as ProjectIndexFileApplicationPort & ProjectIndexFileMaterializationProjectionPort,
    )

    const error = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "new-text", sourceId: "new", text: "" }],
    }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CanvasResourcePartialFailureError)
    expect((error as CanvasResourcePartialFailureError).cause).toBe(ownerFailure)
    expect((error as CanvasResourcePartialFailureError).retainedOnFailure).toEqual([
      { label: "Notes/retained-a1.md" },
    ])
  })

  test("reports only successfully published new text when later preparation fails", async () => {
    const laterFailure = new Error("native file lookup failed")
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo() {
          throw laterFailure
        },
      }),
      {
        async publishText() {
          return { contentRevision: "revision-a", path: "Notes/First-a1.md" }
        },
      },
      unusedAssets(),
    )

    try {
      await preparation.prepare({
        ...requestRef,
        sources: [
          { kind: "new-text", name: "First", sourceId: "first", text: "# First" },
          { kind: "host-file", path: "media/missing.png", sourceId: "missing" },
        ],
      })
      throw new Error("Expected preparation to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(CanvasResourcePartialFailureError)
      expect((error as CanvasResourcePartialFailureError).cause).toBe(laterFailure)
      expect((error as CanvasResourcePartialFailureError).retainedOnFailure).toEqual([{ label: "Notes/First-a1.md" }])
    }
  })

  test("does not report host-file preparation as a retained resource", async () => {
    const hostFailure = new Error("native file lookup failed")
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo() {
          throw hostFailure
        },
      }),
      unusedPublisher(),
      unusedAssets(),
    )

    await expect(
      preparation.prepare({
        ...requestRef,
        sources: [{ kind: "host-file", path: "media/missing.png", sourceId: "missing" }],
      }),
    ).rejects.toBe(hostFailure)
  })

  test("accepts only Project directories as folder references", async () => {
    const directoryRequests: unknown[] = []
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async listDirectory(input) {
          directoryRequests.push(input)
          return { entries: [], path: input.path ?? "", projectId: input.projectId }
        },
      }),
      unusedPublisher(),
      unusedAssets(),
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "host-directory", path: "design/references", sourceId: "folder" }],
    })

    expect(directoryRequests).toEqual([{ path: "design/references", projectId: "project_one" }])
    expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
      kind: "project-directory",
      path: "design/references",
    })
    expect(result.items[0]).not.toHaveProperty("path")
  })

  test("maps external admissions inside the managed-store callback without exposing source paths", async () => {
    const events: string[] = []
    const references: CanvasProjectResourceReference[] = [
      {
        kind: "managed-asset",
        mediaType: "image/png",
        name: "outside.png",
        sha256: "a".repeat(64),
      },
    ]
    const assets = {
      async withAdmittedLocalFiles(
        _input: unknown,
        commit: (value: readonly CanvasProjectResourceReference[]) => Promise<unknown>,
      ) {
        events.push("store:enter")
        const result = await commit(references)
        events.push("store:leave")
        return result
      },
    } as unknown as ProjectManagedAssetStore
    const preparation = new ProjectCanvasResourcePreparation(host(), unusedPublisher(), assets)

    const result = await preparation.withAdmittedLocalFiles(
      {
        files: [
          {
            mediaType: "image/png",
            name: "outside.png",
            sourceId: "outside",
            sourcePath: "/native/outside.png",
          },
        ],
        projectId: "project_one",
      },
      async (prepared) => {
        events.push("commit")
        expect(JSON.stringify(prepared)).not.toContain("/native/outside.png")
        expect(getProjectResourceReference(prepared.items[0]!.metadata)).toEqual(references[0])
        expect(prepared.items[0]).toMatchObject({
          id: "outside",
          kind: "image",
          state: { status: "stale" },
        })
        return "committed"
      },
    )

    expect(result).toBe("committed")
    expect(events).toEqual(["store:enter", "commit", "store:leave"])
  })

  test("maps a Project-local File token to a direct project-file item without a managed copy", async () => {
    const reference = { kind: "project-file" as const, path: "Images/local.png" }
    const assets = {
      async withAdmittedLocalFiles(
        _input: unknown,
        commit: (value: readonly CanvasProjectResourceReference[]) => Promise<unknown>,
      ) {
        return commit([reference])
      },
    } as unknown as ProjectManagedAssetStore
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo(input) {
          return { mimeType: "image/png", name: "local.png", path: input.path, size: 1 }
        },
      }),
      unusedPublisher(),
      assets,
    )

    await preparation.withAdmittedLocalFiles(
      {
        files: [
          {
            mediaType: "image/png",
            name: "local.png",
            sourceId: "local",
            sourcePath: "/native/project/Images/local.png",
          },
        ],
        projectId: "project_one",
      },
      async ({ items }) => {
        expect(getProjectResourceReference(items[0]!.metadata)).toEqual(reference)
        expect(items[0]).toMatchObject({
          id: "local",
          kind: "image",
          mimeType: "image/png",
          name: "local.png",
          state: { status: "stale" },
        })
        expect(JSON.stringify(items[0])).not.toContain("/native/project")
      },
    )
  })

  test("publishes explicitly selected Project-local bytes to ProjectIndex before returning a current proof", async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const reference = projectIndexReference(bytes, "image/png")
    const directories: string[] = []
    const publications: unknown[] = []
    const indexFiles = {
      async queryFileMaterializationPlan() {
        return { projectId: parseProjectId("project_one"), entries: [] }
      },
      async createDirectory(input: { path: string }) {
        directories.push(input.path)
        return {
          status: "committed" as const,
          entryId: `pd_${directories.length.toString(16).padStart(64, "0")}` as never,
          versionId: null,
          reference: null,
        }
      },
      async publishFile(input: { exactBytes: Readonly<Uint8Array>; path: string }) {
        publications.push({ bytes: [...input.exactBytes], path: input.path })
        return {
          status: "committed" as const,
          entryId: reference.entryFileId as never,
          versionId: reference.versionId,
          reference,
        }
      },
      async relocateEntry() {
        throw new Error("not used")
      },
      async tombstoneEntry() {
        throw new Error("not used")
      },
    } as unknown as ProjectIndexFileApplicationPort & ProjectIndexFileMaterializationProjectionPort
    const assets = {
      async withAdmittedLocalFiles(
        _input: unknown,
        commit: (value: readonly CanvasProjectResourceReference[]) => Promise<unknown>,
      ) {
        return commit([{ kind: "project-file", path: "assets/characters/bear/hero.png" }])
      },
    } as unknown as ProjectManagedAssetStore
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo(input) {
          return { mimeType: "image/png", name: "hero.png", path: input.path, size: bytes.byteLength }
        },
        async readFile(input) {
          return {
            dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
            mimeType: "image/png",
            name: "hero.png",
            path: input.path,
            size: bytes.byteLength,
          }
        },
      }),
      unusedPublisher(),
      assets,
      undefined,
      indexFiles,
    )

    await preparation.withAdmittedLocalFiles(
      {
        files: [
          {
            mediaType: "image/png",
            name: "hero.png",
            sourceId: "local",
            sourcePath: "/native/project/assets/characters/bear/hero.png",
          },
        ],
        projectId: "project_one",
      },
      async ({ items }) => {
        expect(items[0]).toMatchObject({
          id: "local",
          kind: "image",
          metadata: {
            convaxCanvasResourceProof: {
              format: "convax.canvas-resource-proof-ref",
              mode: "current-owner-state",
              requireCurrentLiveVersion: true,
              resource: {
                byteLength: String(bytes.byteLength),
                contentDigest: ordinarySha256(bytes),
                mediaClass: "image",
                mime: "image/png",
                uri: reference.canonicalUri,
              },
            },
            convaxProjectResource: { kind: "project-file", path: "assets/characters/bear/hero.png" },
          },
        })
      },
    )

    expect(directories).toEqual(["assets", "assets/characters", "assets/characters/bear"])
    expect(publications).toEqual([{ bytes: [...bytes], path: "assets/characters/bear/hero.png" }])
  })

  test("streams an external managed asset into ProjectIndex before returning a current Canvas proof", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-managed-proof-"))
    const projectRoot = path.join(root, "project")
    const outside = path.join(root, "outside.png")
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...new Array(128).fill(7)])
    await fs.mkdir(path.join(projectRoot, ".convax"), { recursive: true })
    await fs.writeFile(outside, bytes)
    const assets = new ProjectManagedAssetStore(
      { async resolveProjectRoot() { return projectRoot } },
      { maximumBytes: 1024 },
    )
    const reference = projectIndexReference(bytes, "image/png")
    let admitted: Uint8Array | undefined
    const indexFiles = {
      async admitManagedBlob(input: Parameters<ProjectIndexFileApplicationPort["admitManagedBlob"]>[0]) {
        const chunks: number[] = []
        await input.admission.readChunks(async (chunk) => { chunks.push(...chunk) })
        admitted = Uint8Array.from(chunks)
        return {
          status: "committed" as const,
          entryId: reference.entryFileId as never,
          versionId: reference.versionId,
          reference,
        }
      },
      async queryFileMaterializationPlan() {
        return { projectId: parseProjectId("project_one"), entries: [] }
      },
      async createDirectory() { throw new Error("not used") },
      async publishFile() { throw new Error("not used") },
      async relocateEntry() { throw new Error("not used") },
      async tombstoneEntry() { throw new Error("not used") },
    } as unknown as ProjectIndexFileApplicationPort & ProjectIndexFileMaterializationProjectionPort
    const preparation = new ProjectCanvasResourcePreparation(host(), unusedPublisher(), assets, undefined, indexFiles)

    try {
      await preparation.withAdmittedLocalFiles(
        {
          files: [{ mediaType: "image/png", name: "outside.png", sourceId: "external", sourcePath: outside }],
          projectId: "project_one",
        },
        async ({ items }) => {
          expect(admitted).toEqual(bytes)
          expect(items[0]).toMatchObject({
            id: "external",
            kind: "image",
            metadata: {
              convaxCanvasResourceProof: {
                mode: "current-owner-state",
                resource: {
                  contentDigest: ordinarySha256(bytes),
                  mediaClass: "image",
                  mime: "image/png",
                },
              },
              convaxProjectResource: {
                kind: "managed-asset",
                name: "outside.png",
                sha256: ordinarySha256(bytes),
              },
            },
          })
        },
      )
    } finally {
      await fs.rm(root, { force: true, recursive: true })
    }
  })

  test("classifies admitted managed Markdown and plain text without reading source bytes", async () => {
    for (const [name, mediaType] of [
      ["brief.md", "text/markdown"],
      ["notes.txt", undefined],
    ] as const) {
      const reference = {
        kind: "managed-asset" as const,
        mediaType,
        name,
        sha256: "b".repeat(64),
      }
      const assets = {
        async withAdmittedLocalFiles(
          _input: unknown,
          commit: (value: readonly CanvasProjectResourceReference[]) => Promise<unknown>,
        ) {
          return commit([reference])
        },
      } as unknown as ProjectManagedAssetStore
      const preparation = new ProjectCanvasResourcePreparation(host(), unusedPublisher(), assets)

      await preparation.withAdmittedLocalFiles(
        {
          files: [
            {
              mediaType: reference.mediaType,
              name: reference.name,
              sourceId: "managed-text",
              sourcePath: `/outside/${reference.name}`,
            },
          ],
          projectId: "project_one",
        },
        async ({ items }) => {
          expect(items[0]).toMatchObject({
            id: "managed-text",
            kind: "text",
            mimeType: reference.mediaType ?? "text/plain",
            name: reference.name,
            state: { status: "stale" },
          })
          expect(items[0]).not.toHaveProperty("format")
          expect(items[0]!.state).not.toHaveProperty("text")
          expect(items[0]!.state).not.toHaveProperty("contentRevision")
        },
      )
    }
  })
})

function host(overrides: Partial<ProjectCanvasResourceHost> = {}): ProjectCanvasResourceHost {
  return {
    async listDirectory(input) {
      return { entries: [], path: input.path ?? "", projectId: input.projectId }
    },
    async readFileInfo(input) {
      return { mimeType: "application/octet-stream", name: "file.bin", path: input.path, size: 1 }
    },
    async readFile(input) {
      return {
        dataUrl: "data:application/octet-stream;base64,AA==",
        mimeType: "application/octet-stream",
        name: "file.bin",
        path: input.path,
        size: 1,
      }
    },
    async readTextFile(input) {
      return { content: "", contentRevision: "", exists: false, path: input.path }
    },
    ...overrides,
  }
}

function unusedPublisher(): ProjectCanvasFilePublisher {
  return {
    async publishText() {
      throw new Error("Publisher must not be used")
    },
  }
}

function projectIndexReference(bytes: Uint8Array, mime: string): ProjectIndexResourceReference {
  const projectId = parseProjectId("project_one")
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
    versionRecordDigest: ordinarySha256(new TextEncoder().encode("version")) as Digest,
  })
}

function unusedAssets() {
  return {
    async withAdmittedLocalFiles() {
      throw new Error("Managed assets must not be used")
    },
  } as unknown as ProjectManagedAssetStore
}
