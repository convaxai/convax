import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument } from "../document"
import { parseActorIdV2, parseDigestV2, parseId128V2 } from "@convax/collaboration"
import type { BoundedOperationReceiptV2 } from "../collaboration"
import {
  CanvasApplicationService,
  type CanvasApplicationCommandRequest,
  type CanvasCollaborationApplicationPort,
} from "./service"

const receipt: BoundedOperationReceiptV2 = {
  format: "convax.canvas-operation-receipt/2",
  actorId: parseActorIdV2("A".repeat(43)),
  operationId: parseId128V2("A".repeat(22)),
  intentDigest: parseDigestV2("d".repeat(64)),
  baseFrontierDigest: parseDigestV2("e".repeat(64)),
  intentKind: "canvas.nodes.set-geometry/2",
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigestV2("f".repeat(64)),
}

function request(signal?: AbortSignal): CanvasApplicationCommandRequest {
  return {
    canvasId: "canvas",
    scopeId: "project",
    envelope: {
      actor: { id: "agent", kind: "agent" },
      command: { type: "nodes.setGeometry", updates: [{ nodeId: "node", position: { x: 1, y: 2 } }] },
      commandId: "correlation-only",
    },
    ...(signal ? { signal } : {}),
  }
}

describe("Canvas application collaboration facade", () => {
  test("delegates mutation/query to the sole collaboration application and emits a receipt", async () => {
    const document = createCanvasDocument({ id: "canvas" })
    const submit = mock(async () => ({
      affectedNodeIds: [],
      changed: true,
      createdNodeIds: [],
      document,
      operationReceipt: receipt,
      warnings: [],
    }))
    const query = mock(async () => ({ nodes: [], projection: document }))
    const commits: unknown[] = []
    const port: CanvasCollaborationApplicationPort = { query, submit }
    const service = new CanvasApplicationService(port, {
      onDidCommit(event) {
        commits.push(event)
        throw new Error("observer failure is isolated")
      },
    })
    const command = request()

    await expect(service.execute(command)).resolves.toMatchObject({ operationReceipt: receipt })
    expect(submit).toHaveBeenCalledWith(command)
    expect(commits).toEqual([{
      actor: { id: "agent", kind: "agent" },
      canvasId: "canvas",
      operationReceipt: receipt,
      scopeId: "project",
    }])
    await expect(service.query({ canvasId: "canvas", scopeId: "project" })).resolves.toEqual({
      nodes: [],
      projection: document,
    })
    expect(query).toHaveBeenCalledTimes(1)
  })

  test("does not call Main after caller cancellation", async () => {
    const port: CanvasCollaborationApplicationPort = {
      query: mock(async () => ({ nodes: [], projection: createCanvasDocument({ id: "canvas" }) })),
      submit: mock(async () => {
        throw new Error("must not run")
      }),
    }
    const controller = new AbortController()
    const reason = new DOMException("cancelled", "AbortError")
    controller.abort(reason)
    await expect(new CanvasApplicationService(port).execute(request(controller.signal))).rejects.toBe(reason)
    expect(port.submit).not.toHaveBeenCalled()
  })
})
