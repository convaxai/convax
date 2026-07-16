import {
  CanvasStorageConflictError,
  parseStoredCanvasDocument,
  serializeCanvasDocument,
  type CanvasDocumentRef,
  type CanvasDocumentRepository,
  type CanvasDocumentSaveRequest,
} from "@convax/canvas/application"
import type { ProjectCanvas, ProjectCanvasCatalog } from "../../canvas/contracts"
import { dehydrateProjectCanvasDocument } from "../../canvas/project-resources"
import {
  ProjectPrivateStorageConflictError,
  type ProjectPrivateStorage,
} from "../project-private-storage"

export interface ProjectCanvasCatalogStore {
  getCanvasCatalog(input: { projectId: string }): Promise<ProjectCanvasCatalog>
  touchCanvas(input: { canvasId: string; projectId: string }): Promise<ProjectCanvas>
}

export class ProjectCanvasDocumentRepository implements CanvasDocumentRepository {
  constructor(
    private readonly storage: ProjectPrivateStorage,
    private readonly catalog: ProjectCanvasCatalogStore,
  ) {}

  async load(ref: CanvasDocumentRef) {
    await this.assertOwnership(ref)
    const stored = await this.storage.readPrivateTextFile(storageRef(ref))
    return {
      document: stored.exists ? parseStoredCanvasDocument(stored.content, ref.canvasId) : null,
      storageVersion: stored.version,
    }
  }

  async save(request: CanvasDocumentSaveRequest) {
    await this.assertOwnership(request.ref)
    if (request.document.id !== request.ref.canvasId) {
      throw new Error(`Canvas document does not belong to ${request.ref.canvasId}`)
    }
    try {
      const result = await this.storage.writePrivateTextFile({
        ...storageRef(request.ref),
        content: serializeCanvasDocument(dehydrateProjectCanvasDocument(request.document)),
        expectedVersion: request.expectedStorageVersion,
      })
      // The document is the source of truth. A catalog timestamp failure must not make callers
      // retry a write that has already committed with a new storage version.
      await this.catalog.touchCanvas({
        canvasId: request.ref.canvasId,
        projectId: request.ref.scopeId,
      }).catch(() => undefined)
      try {
        await this.assertOwnership(request.ref)
      } catch (error) {
        await this.storage.removePrivatePath?.({
          namespace: "canvases",
          path: request.ref.canvasId,
          projectId: request.ref.scopeId,
        }).catch(() => undefined)
        throw error
      }
      return { storageVersion: result.version }
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
