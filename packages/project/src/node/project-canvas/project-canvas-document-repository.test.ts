import { describe, expect, test } from "bun:test"
import { CanvasStorageConflictError } from "@convax/canvas/application"
import { createCanvasDocument, createMediaNode } from "@convax/canvas/core"
import { projectFileReferenceKey } from "../../canvas/project-resources"
import {
  ProjectPrivateStorageConflictError,
  type ProjectPrivateStorage,
  type ProjectPrivateTextFileSnapshot,
} from "../project-private-storage"
import { ProjectCanvasDocumentRepository, type ProjectCanvasCatalogStore } from "./project-canvas-document-repository"

function harness() {
  let stored: ProjectPrivateTextFileSnapshot = { content: "", exists: false, version: null }
  const storage: ProjectPrivateStorage = {
    async readPrivateTextFile() {
      return stored
    },
    async writePrivateTextFile(input) {
      if (input.expectedVersion !== undefined && input.expectedVersion !== stored.version) {
        throw new ProjectPrivateStorageConflictError(input.expectedVersion, stored.version)
      }
      stored = { content: input.content, exists: true, version: `version_${input.content.length}` }
      return { version: stored.version! }
    },
  }
  let touched = 0
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
  return {
    getStored: () => stored,
    getTouched: () => touched,
    repository: new ProjectCanvasDocumentRepository(storage, catalog),
  }
}

describe("project canvas document repository", () => {
  test("owns Canvas JSON and removes runtime project asset URLs", async () => {
    const { getStored, getTouched, repository } = harness()
    const document = createCanvasDocument({
      id: "canvas-main",
      nodes: [createMediaNode({
        id: "image",
        position: { x: 0, y: 0 },
        resource: {
          id: "asset",
          kind: "image",
          metadata: { [projectFileReferenceKey]: { path: ".convax/assets/poster.png" } },
          posterUrl: "blob:runtime-poster",
          url: "convax-asset://project/file?path=poster.png",
        },
      })],
    })
    const saved = await repository.save({
      document,
      expectedStorageVersion: null,
      ref: { canvasId: "canvas-main", scopeId: "project_one" },
    })

    expect(saved.storageVersion).toStartWith("version_")
    const storedEnvelope = JSON.parse(getStored().content)
    expect(storedEnvelope.schemaVersion).toBe("convax.canvas/2")
    expect(storedEnvelope.document.nodes[0].data.url).toBe("")
    expect(storedEnvelope.document.nodes[0].data).not.toHaveProperty("posterUrl")
    expect((await repository.load({ canvasId: "canvas-main", scopeId: "project_one" })).document?.id).toBe("canvas-main")
    expect(getTouched()).toBe(1)
  })

  test("maps private storage compare-and-swap failures", async () => {
    const { repository } = harness()
    await repository.save({
      document: createCanvasDocument({ id: "canvas-main" }),
      expectedStorageVersion: null,
      ref: { canvasId: "canvas-main", scopeId: "project_one" },
    })
    await expect(repository.save({
      document: createCanvasDocument({ id: "canvas-main" }),
      expectedStorageVersion: null,
      ref: { canvasId: "canvas-main", scopeId: "project_one" },
    })).rejects.toBeInstanceOf(CanvasStorageConflictError)
  })
})
