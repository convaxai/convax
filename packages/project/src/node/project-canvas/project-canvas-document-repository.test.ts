import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  CanvasStorageConflictError,
  serializeCanvasDocument,
  UnsupportedCanvasDocumentVersionError,
} from "@convax/canvas/application"
import {
  createCanvasDocument,
  createMediaNode,
  createTextNode,
  getCanvasNodeGenerationRun,
  getCanvasNodeGenerationToolId,
  setCanvasNodeGenerationToolId,
  startCanvasNodeGenerationRun,
  type CanvasNode,
} from "@convax/canvas/core"
import {
  projectResourceBindingsKey,
  projectResourceReferenceKey,
  type ProjectResourceReference,
} from "../../canvas/project-resources"
import {
  ProjectPrivateStorageConflictError,
  type ProjectPrivateStorage,
  type ProjectPrivateTextFileSnapshot,
} from "../project-private-storage"
import { ProjectCanvasDocumentRepository, type ProjectCanvasCatalogStore } from "./project-canvas-document-repository"
import { ProjectManagedAssetStore } from "./project-managed-asset-store"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

function harness(
  input: {
    assets?: ProjectManagedAssetStore
    stored?: ProjectPrivateTextFileSnapshot
    writeBarrier?: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }
  } = {},
) {
  let stored: ProjectPrivateTextFileSnapshot = input.stored ?? { content: "", exists: false, version: null }
  let writes = 0
  let removes = 0
  let touched = 0
  const storage: ProjectPrivateStorage = {
    async readPrivateTextFile() {
      return stored
    },
    async removePrivatePath() {
      removes += 1
      stored = { content: "", exists: false, version: null }
      return { removed: true }
    },
    async writePrivateTextFile(write) {
      writes += 1
      input.writeBarrier?.entered.resolve()
      if (input.writeBarrier) await input.writeBarrier.release.promise
      if (write.expectedVersion !== undefined && write.expectedVersion !== stored.version) {
        throw new ProjectPrivateStorageConflictError(write.expectedVersion, stored.version)
      }
      stored = { content: write.content, exists: true, version: `version_${write.content.length}` }
      return { version: stored.version! }
    },
  }
  const catalog: ProjectCanvasCatalogStore = {
    async getCanvasCatalog({ projectId }) {
      return {
        canvases: [{ createdAt: 1, id: "canvas-main", name: "Canvas", updatedAt: 1 }],
        projectId,
      }
    },
    async touchCanvas() {
      touched += 1
      return { createdAt: 1, id: "canvas-main", name: "Canvas", updatedAt: 2 }
    },
  }
  const assets =
    input.assets ??
    ({
      async withVerifiedReferences(_input: unknown, commit: () => Promise<unknown>) {
        return commit()
      },
    } as unknown as ProjectManagedAssetStore)
  return {
    getCounts: () => ({ removes, touched, writes }),
    getStored: () => stored,
    repository: new ProjectCanvasDocumentRepository(storage, catalog, assets),
  }
}

describe("project canvas document repository", () => {
  test("strict maintenance loads every current document and collects only exact typed managed references", async () => {
    const primaryDigest = "a".repeat(64)
    const posterDigest = "b".repeat(64)
    const pluginDigest = "c".repeat(64)
    const opaqueDigest = "d".repeat(64)
    const primary = createMediaNode({
      id: "image",
      position: { x: 0, y: 0 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: {
          [projectResourceBindingsKey]: {
            poster: { kind: "managed-asset", name: "poster.jpg", sha256: posterDigest },
          },
          [projectResourceReferenceKey]: { kind: "managed-asset", name: "image.png", sha256: primaryDigest },
        },
        state: { status: "stale" },
      },
    })
    const plugin = {
      id: "plugin",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "plugin.surface",
        label: "Plugin",
        metadata: {
          convaxPluginState: { arbitrary: opaqueDigest, nested: { digest: opaqueDigest } },
          [projectResourceBindingsKey]: {
            input: { kind: "managed-asset", name: "plugin.bin", sha256: pluginDigest },
          },
        },
      },
    } as CanvasNode
    const documents = new Map([
      ["canvas-main", serializeCanvasDocument(createCanvasDocument({ id: "canvas-main", nodes: [primary, plugin] }))],
    ])
    const reads: string[] = []
    const storage: ProjectPrivateStorage = {
      async readPrivateTextFile(input) {
        reads.push(input.path)
        const content = documents.get(input.path.split("/")[0])
        return content ? { content, exists: true, version: "v2" } : { content: "", exists: false, version: null }
      },
      async writePrivateTextFile() {
        throw new Error("strict maintenance must not write")
      },
    }
    const repository = new ProjectCanvasDocumentRepository(
      storage,
      {} as ProjectCanvasCatalogStore,
      {} as ProjectManagedAssetStore,
    )

    const digests = await repository.loadAllStrict({
      canvases: [{ createdAt: 1, id: "canvas-main", name: "Main", updatedAt: 1 }],
      projectId: "project_one",
    })

    expect([...digests].sort()).toEqual([pluginDigest, posterDigest, primaryDigest].sort())
    expect(digests.has(opaqueDigest)).toBe(false)
    expect(reads).toEqual(["canvas-main/document.json"])
  })

  test("strict maintenance rejects a missing catalog-owned document without write, touch, or migration", async () => {
    const reads: string[] = []
    const writePrivateTextFile = mock(async () => {
      throw new Error("strict maintenance must not write")
    })
    const getCanvasCatalog = mock(async () => {
      throw new Error("strict maintenance must not reload or migrate the catalog")
    })
    const touchCanvas = mock(async () => {
      throw new Error("strict maintenance must not touch the catalog")
    })
    const repository = new ProjectCanvasDocumentRepository(
      {
        async readPrivateTextFile(input) {
          reads.push(input.path)
          return { content: "", exists: false, version: null }
        },
        writePrivateTextFile,
      },
      { getCanvasCatalog, touchCanvas },
      {} as ProjectManagedAssetStore,
    )

    await expect(
      repository.loadAllStrict({
        canvases: [{ createdAt: 1, id: "canvas-empty", name: "Empty", updatedAt: 1 }],
        projectId: "project_one",
      }),
    ).rejects.toThrow(/document.*missing|missing.*document/i)

    expect(reads).toEqual(["canvas-empty/document.json"])
    expect(writePrivateTextFile).not.toHaveBeenCalled()
    expect(getCanvasCatalog).not.toHaveBeenCalled()
    expect(touchCanvas).not.toHaveBeenCalled()
  })

  test("strict maintenance rejects unsupported or malformed documents without catalog, write, touch, or migration paths", async () => {
    const malformed = serializeCanvasDocument(
      createCanvasDocument({
        id: "canvas-main",
        nodes: [
          {
            id: "plugin",
            type: "file",
            position: { x: 0, y: 0 },
            data: {
              kind: "plugin.surface",
              label: "Plugin",
              metadata: {
                [projectResourceBindingsKey]: { input: { kind: "managed-asset", name: "bad", sha256: "A".repeat(64) } },
              },
            },
          } as CanvasNode,
        ],
      }),
    )
    let content = malformed
    let writes = 0
    const storage: ProjectPrivateStorage = {
      async readPrivateTextFile() {
        return { content, exists: true, version: "original" }
      },
      async writePrivateTextFile() {
        writes += 1
        throw new Error("strict maintenance must not write")
      },
    }
    const getCanvasCatalog = mock(async () => {
      throw new Error("strict maintenance must not load the catalog")
    })
    const touchCanvas = mock(async () => {
      throw new Error("strict maintenance must not touch the catalog")
    })
    const repository = new ProjectCanvasDocumentRepository(
      storage,
      { getCanvasCatalog, touchCanvas },
      {} as ProjectManagedAssetStore,
    )
    const request = {
      canvases: [{ createdAt: 1, id: "canvas-main", name: "Main", updatedAt: 1 }],
      projectId: "project_one",
    }

    await expect(repository.loadAllStrict(request)).rejects.toThrow()
    content = '{"schemaVersion":"convax.canvas/1","document":{"id":"canvas-main"}}\n'
    await expect(repository.loadAllStrict(request)).rejects.toBeInstanceOf(UnsupportedCanvasDocumentVersionError)
    expect(writes).toBe(0)
    expect(getCanvasCatalog).not.toHaveBeenCalled()
    expect(touchCanvas).not.toHaveBeenCalled()
  })

  test("rejects unsupported bytes without write, touch, delete, or error wrapping", async () => {
    const original = '{"schemaVersion":"convax.canvas/1","document":{"id":"canvas-main"}}\n'
    const { getCounts, getStored, repository } = harness({
      stored: { content: original, exists: true, version: "old-version" },
    })

    await expect(repository.load({ canvasId: "canvas-main", scopeId: "project_one" })).rejects.toBeInstanceOf(
      UnsupportedCanvasDocumentVersionError,
    )
    expect(getStored().content).toBe(original)
    expect(getCounts()).toEqual({ removes: 0, touched: 0, writes: 0 })
  })

  test("rejects syntactically valid v2 documents with invalid Project resource metadata without mutation", async () => {
    const malformed = serializeCanvasDocument(
      createCanvasDocument({
        id: "canvas-main",
        nodes: [
          createMediaNode({
            id: "image",
            position: { x: 0, y: 0 },
            resource: {
              id: "image-resource",
              kind: "image",
              metadata: {},
              state: { status: "stale" },
            },
          }),
        ],
      }),
    )
    const { getCounts, getStored, repository } = harness({
      stored: { content: malformed, exists: true, version: "v2" },
    })

    await expect(repository.load({ canvasId: "canvas-main", scopeId: "project_one" })).rejects.toThrow(
      "Project resource reference",
    )
    expect(getStored().content).toBe(malformed)
    expect(getCounts()).toEqual({ removes: 0, touched: 0, writes: 0 })
  })

  test("rejects persisted legacy text format without mutating its bytes", async () => {
    const text = createTextNode({
      metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/brief.md" } },
      mimeType: "text/markdown",
      name: "brief.md",
      position: { x: 0, y: 0 },
      resourceState: { status: "stale" },
    })
    const { resourceState: _resourceState, ...textData } = text.data
    const document = createCanvasDocument({
      id: "canvas-main",
      nodes: [{ ...text, data: { ...textData, format: "markdown" } }],
    })
    const original = `${JSON.stringify({ document, schemaVersion: "convax.canvas/2" }, null, 2)}\n`
    const { getCounts, getStored, repository } = harness({
      stored: { content: original, exists: true, version: "v2" },
    })

    await expect(repository.load({ canvasId: "canvas-main", scopeId: "project_one" })).rejects.toThrow()
    expect(getStored().content).toBe(original)
    expect(getCounts()).toEqual({ removes: 0, touched: 0, writes: 0 })
  })

  test.each([
    [
      "inline text",
      {
        kind: "text",
        label: "Legacy text",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/legacy.md" } },
        text: "legacy",
      },
    ],
    [
      "remote URL",
      {
        kind: "image",
        label: "Legacy image",
        metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Images/legacy.png" } },
        url: "https://example.com/legacy.png",
      },
    ],
    [
      "path-only managed reference",
      {
        kind: "image",
        label: "Legacy managed image",
        metadata: { convaxProjectFile: { path: ".convax/assets/legacy.png" } },
      },
    ],
    [
      "folder path",
      {
        kind: "folder",
        label: "Legacy folder",
        metadata: { [projectResourceReferenceKey]: { kind: "project-directory", path: "legacy-folder" } },
        path: "legacy-folder",
      },
    ],
  ])("rejects removed %s persistence without mutating its bytes", async (_label, data) => {
    const document = createCanvasDocument({ id: "canvas-main" })
    const original = `${JSON.stringify(
      {
        document: {
          ...document,
          nodes: [
            {
              data,
              id: "legacy-node",
              position: { x: 0, y: 0 },
              type: "file",
            },
          ],
        },
        schemaVersion: "convax.canvas/2",
      },
      null,
      2,
    )}\n`
    const { getCounts, getStored, repository } = harness({
      stored: { content: original, exists: true, version: "v2" },
    })

    await expect(repository.load({ canvasId: "canvas-main", scopeId: "project_one" })).rejects.toThrow()
    expect(getStored().content).toBe(original)
    expect(getCounts()).toEqual({ removes: 0, touched: 0, writes: 0 })
  })

  test("strictly rejects a malformed typed primary slot on a non-resource node", async () => {
    const plugin = {
      id: "plugin",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "plugin.surface",
        label: "Plugin",
        metadata: {
          [projectResourceReferenceKey]: {
            kind: "managed-asset",
            name: "bad.bin",
            sha256: "A".repeat(64),
          },
        },
      },
    } as CanvasNode
    const malformed = serializeCanvasDocument(createCanvasDocument({ id: "canvas-main", nodes: [plugin] }))
    const { getCounts, repository } = harness({
      stored: { content: malformed, exists: true, version: "v2" },
    })

    await expect(repository.load({ canvasId: "canvas-main", scopeId: "project_one" })).rejects.toThrow()
    expect(getCounts()).toEqual({ removes: 0, touched: 0, writes: 0 })
  })

  test("saves and reloads existing and host-created unbacked Image generation targets", async () => {
    const image = createMediaNode({
      id: "image-target",
      position: { x: 0, y: 0 },
      resource: {
        id: "image-target",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "" },
      },
    })
    image.data.status = "idle"
    const pending = createMediaNode({
      id: "pending-image",
      position: { x: 360, y: 0 },
      resource: {
        id: "pending-image",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "" },
      },
    })
    pending.data.status = "pending"
    let document = createCanvasDocument({ id: "canvas-main", nodes: [image, pending] })
    document = setCanvasNodeGenerationToolId(document, image.id, "creative-tools/draw")
    document = startCanvasNodeGenerationRun(document, image.id, {
      operationId: "operation-one",
      prompt: "Prompt from a directly connected Project text file",
      toolId: "creative-tools/draw",
    })
    document = startCanvasNodeGenerationRun(document, pending.id, {
      operationId: "operation-two",
      prompt: "Create a new generated image",
      toolId: "creative-tools/draw",
    })
    const { getCounts, getStored, repository } = harness()

    await expect(
      repository.save({
        document,
        expectedStorageVersion: null,
        ref: { canvasId: "canvas-main", scopeId: "project_one" },
      }),
    ).resolves.toMatchObject({ storageVersion: expect.any(String) })

    expect(getCounts()).toEqual({ removes: 0, touched: 1, writes: 1 })
    expect(getStored().content).not.toContain("resourceState")
    const loaded = await repository.load({ canvasId: "canvas-main", scopeId: "project_one" })
    const loadedTarget = loaded.document?.nodes.find((node) => node.id === image.id)
    expect(loadedTarget).toBeDefined()
    expect(getCanvasNodeGenerationToolId(loadedTarget!)).toBe("creative-tools/draw")
    expect(getCanvasNodeGenerationRun(loadedTarget!)).toMatchObject({
      operationId: "operation-one",
      status: "submitting",
    })
    const loadedPending = loaded.document?.nodes.find((node) => node.id === pending.id)
    expect(loadedPending?.data.status).toBe("pending")
    expect(getCanvasNodeGenerationRun(loadedPending!)).toMatchObject({
      operationId: "operation-two",
      status: "submitting",
    })
  })

  test("verifies exact managed references while holding the asset lock through document write", async () => {
    const root = await createProjectRoot()
    const source = path.join(root, "..", "external.bin")
    await fs.writeFile(source, "asset")
    const assets = new ProjectManagedAssetStore({
      async resolveProjectRoot() {
        return root
      },
    })
    const reference = await assets.admitExternalFile({
      name: "external.bin",
      projectId: "project_one",
      sourcePath: source,
    })
    const barrier = { entered: deferred(), release: deferred() }
    const { repository } = harness({ assets, writeBarrier: barrier })

    const saving = repository.save({
      document: documentWith(reference),
      expectedStorageVersion: null,
      ref: { canvasId: "canvas-main", scopeId: "project_one" },
    })
    await barrier.entered.promise
    let gcEntered = false
    const gc = assets.runExclusive("project_one", async () => {
      gcEntered = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(gcEntered).toBe(false)

    barrier.release.resolve()
    await saving
    await gc
    expect(gcEntered).toBe(true)
  })

  test("reuses the active admission lock for repository save without releasing it early", async () => {
    const root = await createProjectRoot()
    const source = path.join(root, "..", "outside.png")
    await fs.writeFile(source, "outside")
    const assets = new ProjectManagedAssetStore({
      async resolveProjectRoot() {
        return root
      },
    })
    const barrier = { entered: deferred(), release: deferred() }
    const { repository } = harness({ assets, writeBarrier: barrier })

    const admission = assets.withAdmittedLocalFiles(
      {
        files: [{ mediaType: "image/png", name: "outside.png", sourcePath: source }],
        projectId: "project_one",
      },
      async ([reference]) => {
        if (reference?.kind !== "managed-asset") throw new Error("Expected an external managed asset")
        return repository.save({
          document: documentWith(reference!),
          expectedStorageVersion: null,
          ref: { canvasId: "canvas-main", scopeId: "project_one" },
        })
      },
    )
    await barrier.entered.promise
    let queuedEntered = false
    const queued = assets.runExclusive("project_one", async () => {
      queuedEntered = true
    })
    await Promise.resolve()
    expect(queuedEntered).toBe(false)

    barrier.release.resolve()
    await admission
    await queued
    expect(queuedEntered).toBe(true)
  })

  test("maps private storage compare-and-swap failures", async () => {
    const { repository } = harness()
    await repository.save({
      document: createCanvasDocument({ id: "canvas-main" }),
      expectedStorageVersion: null,
      ref: { canvasId: "canvas-main", scopeId: "project_one" },
    })
    await expect(
      repository.save({
        document: createCanvasDocument({ id: "canvas-main" }),
        expectedStorageVersion: null,
        ref: { canvasId: "canvas-main", scopeId: "project_one" },
      }),
    ).rejects.toBeInstanceOf(CanvasStorageConflictError)
  })
})

function documentWith(reference: Extract<ProjectResourceReference, { kind: "managed-asset" }>) {
  return createCanvasDocument({
    id: "canvas-main",
    nodes: [
      createMediaNode({
        id: "image",
        position: { x: 0, y: 0 },
        resource: {
          id: "image-resource",
          kind: "image",
          metadata: { [projectResourceReferenceKey]: reference },
          state: { status: "stale" },
        },
      }),
    ],
  })
}

async function createProjectRoot() {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-repository-assets-"))
  temporaryRoots.push(temporaryRoot)
  const root = path.join(temporaryRoot, "project")
  await fs.mkdir(path.join(root, ".convax", "assets"), { recursive: true })
  return root
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
