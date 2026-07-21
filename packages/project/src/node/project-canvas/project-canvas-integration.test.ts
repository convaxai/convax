import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  CanvasApplicationService,
  CanvasStorageConflictError,
  createAddCanvasResourcesCommand,
} from "@convax/canvas/application"
import { getProjectResourceReference } from "../../canvas/project-resources"
import { NodeProjectManager } from "../project-manager"
import type { ProjectPrivateStorage } from "../project-private-storage"
import { ProjectCanvasDocumentRepository } from "./project-canvas-document-repository"
import { ProjectCanvasDocumentService } from "./project-canvas-document-service"
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
        application.execute({
          canvasId: ref.canvasId,
          envelope: {
            actor: { id: "integration", kind: "test" },
            command: createAddCanvasResourcesCommand({ anchor: { x: 10, y: 20 }, items: prepared.items }),
            commandId: "admit-and-save",
            expectedRevision: initialDocument.revision,
          },
          scopeId: ref.scopeId,
        }),
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
})
