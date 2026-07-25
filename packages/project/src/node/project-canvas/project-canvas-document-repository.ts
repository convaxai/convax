import {
  CanvasStorageConflictError,
  parseStoredCanvasDocument,
  serializeCanvasDocument,
  type CanvasDocumentRef,
  type CanvasDocumentRepository,
  type CanvasDocumentSaveRequest,
} from "@convax/canvas/application"
import type { ProjectCanvas, ProjectCanvasCatalog } from "../../canvas/contracts"
import { collectProjectManagedAssetReferences, dehydrateProjectCanvasDocument } from "../../canvas/project-resources"
import { ProjectPrivateStorageConflictError, type ProjectPrivateStorage } from "../project-private-storage"
import type { ProjectManagedAssetStore } from "./project-managed-asset-store"

export interface ProjectCanvasCatalogStore {
  getCanvasCatalog(input: { projectId: string }): Promise<ProjectCanvasCatalog>
  touchCanvas(input: { canvasId: string; projectId: string }): Promise<ProjectCanvas>
}

export class ProjectCanvasDocumentRepository implements CanvasDocumentRepository {
  constructor(
    private readonly storage: ProjectPrivateStorage,
    private readonly catalog: ProjectCanvasCatalogStore,
    private readonly assets: ProjectManagedAssetStore,
  ) {}

  async loadAllStrict(input: { canvases: readonly ProjectCanvas[]; projectId: string }): Promise<ReadonlySet<string>> {
    const digests = new Set<string>()
    for (const canvas of input.canvases) {
      const ref = { canvasId: canvas.id, scopeId: input.projectId }
      const stored = await this.storage.readPrivateTextFile(storageRef(ref))
      if (!stored.exists) throw new Error(`Project Canvas document is missing: ${canvas.id}`)
      const parsed = parseStoredCanvasDocument(stored.content, canvas.id)
      const document = dehydrateProjectCanvasDocument(parsed)
      for (const reference of collectProjectManagedAssetReferences(document)) digests.add(reference.sha256)
    }
    return digests
  }

  async load(ref: CanvasDocumentRef) {
    await this.assertOwnership(ref)
    const stored = await this.storage.readPrivateTextFile(storageRef(ref))
    const parsed = stored.exists ? parseStoredCanvasDocument(stored.content, ref.canvasId) : null
    const document = parsed ? dehydrateProjectCanvasDocument(parsed) : null
    if (document) collectProjectManagedAssetReferences(document)
    return {
      document,
      storageVersion: stored.version,
    }
  }

  async save(request: CanvasDocumentSaveRequest) {
    await this.assertOwnership(request.ref)
    if (request.document.id !== request.ref.canvasId) {
      throw new Error(`Canvas document does not belong to ${request.ref.canvasId}`)
    }
    try {
      const durableDocument = dehydrateProjectCanvasDocument(request.document)
      const content = serializeCanvasDocument(durableDocument)
      const references = collectProjectManagedAssetReferences(durableDocument)
      return await this.assets.withVerifiedReferences(
        {
          projectId: request.ref.scopeId,
          references,
        },
        async () => {
          const result = await this.storage.writePrivateTextFile({
            ...storageRef(request.ref),
            content,
            expectedVersion: request.expectedStorageVersion,
          })
          // The document is the source of truth. A catalog timestamp failure must not make callers
          // retry a write that has already committed with a new storage version.
          await this.catalog
            .touchCanvas({
              canvasId: request.ref.canvasId,
              projectId: request.ref.scopeId,
            })
            .catch(() => undefined)
          try {
            await this.assertOwnership(request.ref)
          } catch (error) {
            await this.storage
              .removePrivatePath?.({
                namespace: "canvases",
                path: request.ref.canvasId,
                projectId: request.ref.scopeId,
              })
              .catch(() => undefined)
            throw error
          }
          return { storageVersion: result.version }
        },
      )
    } catch (error) {
      if (error instanceof ProjectPrivateStorageConflictError) {
        throw new CanvasStorageConflictError(error.expectedVersion, error.actualVersion)
      }
      throw error
    }
  }

  private async assertOwnership(ref: CanvasDocumentRef) {
    const catalog = await this.catalog.getCanvasCatalog({ projectId: ref.scopeId })
    if (!catalog.canvases.some((canvas) => canvas.id === ref.canvasId)) {
      throw new Error(`Canvas was not found in project ${ref.scopeId}: ${ref.canvasId}`)
    }
  }
}

function storageRef(ref: CanvasDocumentRef) {
  return {
    namespace: "canvases",
    path: `${ref.canvasId}/document.json`,
    projectId: ref.scopeId,
  }
}
