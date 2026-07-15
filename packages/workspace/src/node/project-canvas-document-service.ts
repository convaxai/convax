import {
  CanvasStorageConflictError,
  type CanvasDocumentClient,
  type CanvasDocumentRef,
  type CanvasDocumentRepository,
} from "@convax/canvas/application"
import { createCanvasDocument } from "@convax/canvas/core"
import type { ProjectCanvasCatalog } from "./project-canvas-document-repository"

export class ProjectCanvasDocumentService implements CanvasDocumentClient {
  constructor(
    private readonly repository: CanvasDocumentRepository,
    private readonly catalog: ProjectCanvasCatalog,
  ) {}

  async load(ref: CanvasDocumentRef) {
    const current = await this.repository.load(ref)
    if (current.document) return current

    const workspace = await this.catalog.getWorkspace({ projectId: ref.projectId })
    const canvas = workspace.canvases.find((candidate) => candidate.id === ref.canvasId)
    if (!canvas) throw new Error(`Canvas was not found in project ${ref.projectId}: ${ref.canvasId}`)
    const document = createCanvasDocument({ id: canvas.id, title: canvas.name })
    try {
      const saved = await this.repository.save({
        document,
        expectedStorageVersion: null,
        ref,
      })
      return { document, storageVersion: saved.storageVersion }
    } catch (error) {
      if (!(error instanceof CanvasStorageConflictError)) throw error
      const concurrent = await this.repository.load(ref)
      if (concurrent.document) return concurrent
      throw error
    }
  }

  save(request: Parameters<CanvasDocumentRepository["save"]>[0]) {
    return this.repository.save(request)
  }
}
