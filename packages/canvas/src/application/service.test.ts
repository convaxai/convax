import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "../document"
import type {
  CanvasDocumentRepository,
  CanvasDocumentSaveRequest,
  CanvasDocumentSnapshot,
} from "./persistence"
import {
  CanvasApplicationService,
  CanvasCommandIdConflictError,
  type CanvasApplicationCommandRequest,
} from "./service"

describe("canvas application service", () => {
  test("loads, executes, and compare-and-swap saves one business command", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({
        id: "canvas-main",
        nodes: [createTextNode({ id: "first", position: { x: 0, y: 0 }, text: "Launch brief" })],
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
    const service = new CanvasApplicationService(repository)
    const request: CanvasApplicationCommandRequest = {
      canvasId: "canvas-main",
      projectId: "project_one",
      envelope: {
        actor: { id: "agent_one", kind: "agent" },
        command: { type: "nodes.move", delta: { x: 20, y: 10 }, nodeIds: ["first"] },
        commandId: "move_first",
        expectedRevision: 0,
      },
    }
    const result = await service.execute(request)

    expect(result.document).toMatchObject({ revision: 1, nodes: [{ id: "first", position: { x: 20, y: 10 } }] })
    expect(result.storageVersion).toBe("v2")
    expect(saves[0]?.expectedStorageVersion).toBe("v1")
    expect(await service.execute(request)).toBe(result)
    expect(saves).toHaveLength(1)
    await expect(service.execute({
      ...request,
      envelope: {
        ...request.envelope,
        command: { type: "nodes.move", delta: { x: 1, y: 1 }, nodeIds: ["first"] },
      },
    })).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
    expect((await service.query(
      { canvasId: "canvas-main", projectId: "project_one" },
      { text: "launch" },
    )).nodes.map((node) => node.id)).toEqual(["first"])
  })
})
