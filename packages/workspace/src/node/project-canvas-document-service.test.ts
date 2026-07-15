import { describe, expect, test } from "bun:test"
import type {
  CanvasDocumentRepository,
  CanvasDocumentSaveRequest,
  CanvasDocumentSnapshot,
} from "@convax/canvas/application"
import type { ProjectCanvasCatalog } from "./project-canvas-document-repository"
import { ProjectCanvasDocumentService } from "./project-canvas-document-service"

describe("project canvas document service", () => {
  test("initializes a real empty document for a catalog canvas", async () => {
    let snapshot: CanvasDocumentSnapshot = { document: null, storageVersion: null }
    const repository: CanvasDocumentRepository = {
      async load() {
        return snapshot
      },
      async save(request: CanvasDocumentSaveRequest) {
        snapshot = { document: request.document, storageVersion: "created" }
        return { storageVersion: "created" }
      },
    }
    const catalog: ProjectCanvasCatalog = {
      async getWorkspace({ projectId }) {
        return {
          activeCanvasId: "canvas-main",
          canvases: [{ createdAt: 1, id: "canvas-main", name: "Storyboard", updatedAt: 1 }],
          projectId,
        }
      },
      async touchCanvas() {
        return { createdAt: 1, id: "canvas-main", name: "Storyboard", updatedAt: 2 }
      },
    }
    const service = new ProjectCanvasDocumentService(repository, catalog)
    const loaded = await service.load({ canvasId: "canvas-main", projectId: "project_one" })

    expect(loaded.storageVersion).toBe("created")
    expect(loaded.document).toMatchObject({
      id: "canvas-main",
      metadata: { title: "Storyboard" },
      nodes: [],
      edges: [],
      revision: 0,
    })
  })
})
