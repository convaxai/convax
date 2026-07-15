import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "../document"
import { CanvasCommandValidationError } from "./commands"
import type {
  CanvasDocumentRepository,
  CanvasDocumentSaveRequest,
  CanvasDocumentSnapshot,
} from "./persistence"
import {
  CanvasResourceBusinessService,
  type CanvasResourcePreparationRequest,
  type CanvasResourceSource,
} from "./resources"
import { CanvasApplicationService, CanvasCommandIdConflictError } from "./service"

function source(): CanvasResourceSource {
  return { kind: "project-file", path: "assets/poster.png", sourceId: "poster_source" }
}

describe("canvas resource business service", () => {
  test("prepares serializable sources then applies the shared sizing, placement, relation, and persistence rules", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({
        id: "canvas-main",
        nodes: [createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Anchor" })],
      }),
      storageVersion: "v1",
    }
    const saves: CanvasDocumentSaveRequest[] = []
    const repository: CanvasDocumentRepository = {
      async load() {
        return snapshot
      },
      async save(request) {
        saves.push(request)
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    }
    const preparations: CanvasResourcePreparationRequest[] = []
    const business = new CanvasResourceBusinessService({
      async prepare(request) {
        preparations.push(request)
        return {
          items: [{
            height: 500,
            id: "poster_resource",
            kind: "image",
            name: "Poster.png",
            url: "asset://poster",
            width: 1_000,
          }],
          warnings: ["metadata was normalized"],
        }
      },
    }, new CanvasApplicationService(repository))
    const request = {
      actor: { id: "agent_one", kind: "agent" as const },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "add_poster",
      expectedRevision: 0,
      projectId: "project-one",
      relation: { anchorNodeIds: ["anchor"], mode: "connect" as const },
      sources: [source()],
    }

    expect(() => JSON.stringify(request.sources)).not.toThrow()
    const result = await business.addResources(request)

    expect(preparations).toEqual([{
      canvasId: "canvas-main",
      projectId: "project-one",
      sources: [{ kind: "project-file", path: "assets/poster.png", sourceId: "poster_source" }],
    }])
    const createdNodeId = result.createdNodeIds[0]!
    expect(result.document).toMatchObject({
      edges: [{ source: "anchor", target: createdNodeId }],
      revision: 1,
    })
    expect(result.document.nodes.find((node) => node.id === createdNodeId)).toMatchObject({
      data: { kind: "image", url: "asset://poster" },
      position: { x: 340, y: 0 },
      style: { height: 180, width: 320 },
    })
    expect(result.storageVersion).toBe("v2")
    expect(result.warnings).toEqual(["metadata was normalized"])
    expect(saves).toHaveLength(1)

    expect(await business.addResources(request)).toBe(result)
    expect(preparations).toHaveLength(1)
    await expect(business.addResources({
      ...request,
      sources: [{ kind: "remote-url", sourceId: "different", url: "https://example.com/image.png" }],
    })).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
  })

  test("validates sources before preparation and rejects invalid prepared resources", async () => {
    let preparationCalls = 0
    const application = {
      execute() {
        throw new Error("application should not run")
      },
    }
    const invalidSources = new CanvasResourceBusinessService({
      async prepare() {
        preparationCalls += 1
        return { items: [] }
      },
    }, application)
    await expect(invalidSources.addResources({
      actor: { id: "ui", kind: "ui" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas",
      commandId: "invalid_sources",
      expectedRevision: 0,
      projectId: "project",
      sources: [
        { kind: "project-file", path: "one.png", sourceId: "duplicate" },
        { kind: "project-file", path: "two.png", sourceId: "duplicate" },
      ],
    })).rejects.toBeInstanceOf(CanvasCommandValidationError)
    expect(preparationCalls).toBe(0)

    const invalidPreparation = new CanvasResourceBusinessService({
      async prepare() {
        return { items: [{ id: "broken", kind: "image", url: "asset://broken", width: -1 }] }
      },
    }, application)
    await expect(invalidPreparation.addResources({
      actor: { id: "ui", kind: "ui" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas",
      commandId: "invalid_preparation",
      expectedRevision: 0,
      projectId: "project",
      sources: [source()],
    })).rejects.toBeInstanceOf(CanvasCommandValidationError)
  })
})
