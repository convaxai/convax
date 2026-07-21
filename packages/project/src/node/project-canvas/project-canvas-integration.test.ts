import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  CanvasApplicationService,
  CanvasResourceBusinessService,
  CanvasResourcePartialFailureError,
  CanvasStorageConflictError,
} from "@convax/canvas/application"
import { getProjectResourceReference } from "../../canvas/project-resources"
import { NodeProjectManager } from "../project-manager"
import type { ProjectPrivateStorage } from "../project-private-storage"
import { ProjectCanvasDocumentRepository } from "./project-canvas-document-repository"
import { ProjectCanvasDocumentService } from "./project-canvas-document-service"
import { ProjectFilePublisher } from "./project-file-publisher"
import { NodeProjectCanvasManager } from "./project-canvas-manager"
import { ProjectCanvasResourcePreparation } from "./project-canvas-resource-preparation"
import { ProjectManagedAssetStore } from "./project-managed-asset-store"

let temporaryRoot = ""

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-catalog-"))
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { force: true, recursive: true })
})

describe("project canvas persistence integration", () => {
  test("creates an empty document and rejects stale whole-document saves", async () => {
    const projectRoot = path.join(temporaryRoot, "project")
    await fs.mkdir(projectRoot)
    const manager = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "user-data", "projects.json") })
    const project = await manager.addProject(projectRoot)
    const canvases = new NodeProjectCanvasManager(manager, manager)
    const assets = new ProjectManagedAssetStore(manager)
    const repository = new ProjectCanvasDocumentRepository(manager, canvases, assets)
    const service = new ProjectCanvasDocumentService(repository, canvases)
    const ref = { canvasId: "canvas-main", scopeId: project.id }

    const initialized = await service.load(ref)
    expect(initialized.document?.nodes).toEqual([])
    expect(initialized.storageVersion).toHaveLength(64)
    const storedEnvelope = JSON.parse(
      await fs.readFile(path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json"), "utf8"),
    )
    expect(storedEnvelope.schemaVersion).toBe("convax.canvas/2")
    expect(storedEnvelope.document).toMatchObject({ id: "canvas-main", nodes: [], edges: [] })

    if (!initialized.document) throw new Error("Canvas was not initialized")
    const saved = await service.save({
      document: {
        ...initialized.document,
        metadata: { ...initialized.document.metadata, title: "Updated" },
        revision: 1,
      },
      expectedStorageVersion: initialized.storageVersion,
      ref,
    })
    expect(saved.storageVersion).not.toBe(initialized.storageVersion)
    await expect(
      service.save({
        document: initialized.document,
        expectedStorageVersion: initialized.storageVersion,
        ref,
      }),
    ).rejects.toBeInstanceOf(CanvasStorageConflictError)
  })

  test("does not resurrect a canvas deleted after ownership validation", async () => {
    const projectRoot = path.join(temporaryRoot, "project")
    await fs.mkdir(projectRoot)
    const manager = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "user-data", "projects.json") })
    const project = await manager.addProject(projectRoot)
    const canvases = new NodeProjectCanvasManager(manager, manager)
    const assets = new ProjectManagedAssetStore(manager)
    const created = await canvases.createCanvas({ name: "Temporary", projectId: project.id })
    const ref = { canvasId: created.canvas.id, scopeId: project.id }
    const baseRepository = new ProjectCanvasDocumentRepository(manager, canvases, assets)
    const initialized = await new ProjectCanvasDocumentService(baseRepository, canvases).load(ref)
    if (!initialized.document) throw new Error("Canvas was not initialized")

    let releaseWrite: () => void = () => undefined
    let announceWrite: () => void = () => undefined
    const writeStarted = new Promise<void>((resolve) => {
      announceWrite = resolve
    })
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const delayedStorage: ProjectPrivateStorage = {
      readPrivateTextFile: (input) => manager.readPrivateTextFile(input),
      removePrivatePath: (input) => manager.removePrivatePath(input),
      async writePrivateTextFile(input) {
        announceWrite()
        await writeReleased
        return manager.writePrivateTextFile(input)
      },
    }
    const repository = new ProjectCanvasDocumentRepository(delayedStorage, canvases, assets)
    const save = repository.save({
      document: { ...initialized.document, revision: 1 },
      expectedStorageVersion: initialized.storageVersion,
      ref,
    })
    await writeStarted
    await canvases.deleteCanvas({ canvasId: ref.canvasId, projectId: ref.scopeId })
    releaseWrite()

    await expect(save).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, ".convax", "canvases", created.canvas.id))).rejects.toThrow()
  })

  test("holds one real asset lock from external preparation through Canvas application save", async () => {
    const projectRoot = path.join(temporaryRoot, "project")
    const sourcePath = path.join(temporaryRoot, "outside.png")
    await fs.mkdir(projectRoot)
    await fs.writeFile(sourcePath, "outside-image")
    const manager = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "user-data", "projects.json") })
    const project = await manager.addProject(projectRoot)
    const canvases = new NodeProjectCanvasManager(manager, manager)
    const assets = new ProjectManagedAssetStore(manager)
    const baseRepository = new ProjectCanvasDocumentRepository(manager, canvases, assets)
    const ref = { canvasId: "canvas-main", scopeId: project.id }
    const initialized = await new ProjectCanvasDocumentService(baseRepository, canvases).load(ref)
    if (!initialized.document || !initialized.storageVersion) throw new Error("Canvas was not initialized")
    const initialDocument = initialized.document

    let releaseWrite: () => void = () => undefined
    let announceWrite: () => void = () => undefined
    const writeStarted = new Promise<void>((resolve) => {
      announceWrite = resolve
    })
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const delayedStorage: ProjectPrivateStorage = {
      readPrivateTextFile: (input) => manager.readPrivateTextFile(input),
      removePrivatePath: (input) => manager.removePrivatePath(input),
      async writePrivateTextFile(input) {
        announceWrite()
        await writeReleased
        return manager.writePrivateTextFile(input)
      },
    }
    const repository = new ProjectCanvasDocumentRepository(delayedStorage, canvases, assets)
    const application = new CanvasApplicationService(repository)
    const preparation = new ProjectCanvasResourcePreparation(
      manager,
      {
        async publishText() {
          throw new Error("Text publication must not be used")
        },
      },
      assets,
    )
    const resources = new CanvasResourceBusinessService(preparation, application)

    const admission = preparation.withAdmittedExternalFiles(
      {
        files: [
          {
            mediaType: "image/png",
            name: "outside.png",
            sourceId: "outside",
            sourcePath,
          },
        ],
        projectId: project.id,
      },
      async (prepared) =>
        resources.addPreparedResources(
          {
            actor: { id: "integration", kind: "test" },
            anchor: { x: 10, y: 20 },
            canvasId: ref.canvasId,
            commandId: "admit-and-save",
            expectedRevision: initialDocument.revision,
            scopeId: ref.scopeId,
            sources: [],
          },
          prepared,
        ),
    )
    await writeStarted
    let queuedEntered = false
    const queued = assets.runExclusive(project.id, async () => {
      queuedEntered = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(queuedEntered).toBe(false)

    releaseWrite()
    const result = await admission
    await queued
    expect(result.createdNodeIds).toHaveLength(1)
    expect(queuedEntered).toBe(true)
    const stored = await baseRepository.load(ref)
    expect(stored.document?.nodes).toHaveLength(1)
    expect(getProjectResourceReference(stored.document!.nodes[0]!.data.metadata)).toMatchObject({
      kind: "managed-asset",
      mediaType: "image/png",
      name: "outside.png",
    })
  })

  test("retains a published Note when the Canvas commit fails", async () => {
    const projectRoot = path.join(temporaryRoot, "project")
    await fs.mkdir(projectRoot)
    const manager = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "user-data", "projects.json") })
    const project = await manager.addProject(projectRoot)
    const canvases = new NodeProjectCanvasManager(manager, manager)
    const assets = new ProjectManagedAssetStore(manager)
    const repository = new ProjectCanvasDocumentRepository(manager, canvases, assets)
    const ref = { canvasId: "canvas-main", scopeId: project.id }
    const initialized = await new ProjectCanvasDocumentService(repository, canvases).load(ref)
    if (!initialized.document) throw new Error("Canvas was not initialized")

    const commitFailure = new Error("private repository path must not escape")
    const application = new CanvasApplicationService({
      load: (input) => repository.load(input),
      async save() {
        throw commitFailure
      },
    })
    const preparation = new ProjectCanvasResourcePreparation(
      manager,
      new ProjectFilePublisher(manager, { randomId: () => "retained-a1" }),
      assets,
    )
    const resources = new CanvasResourceBusinessService(preparation, application)

    try {
      await resources.addResources({
        actor: { id: "integration", kind: "test" },
        anchor: { x: 10, y: 20 },
        canvasId: ref.canvasId,
        commandId: "publish-then-fail",
        expectedRevision: initialized.document.revision,
        scopeId: ref.scopeId,
        sources: [{ kind: "new-text", name: "Brief", sourceId: "brief", text: "# Retained brief" }],
      })
      throw new Error("Expected the Canvas commit to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(CanvasResourcePartialFailureError)
      expect((error as CanvasResourcePartialFailureError).cause).toBe(commitFailure)
      expect((error as CanvasResourcePartialFailureError).retainedOnFailure).toEqual([
        { label: "Notes/Brief-retained-a1.md" },
      ])
    }

    expect(await fs.readFile(path.join(projectRoot, "Notes", "Brief-retained-a1.md"), "utf8")).toBe("# Retained brief")
  })
})
