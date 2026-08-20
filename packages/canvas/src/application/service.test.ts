import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument } from "../document"
import { parseActorId, parseDigest, parseId128 } from "@convax/collaboration"
import type { BoundedOperationReceipt } from "../collaboration"
import {
  CanvasApplicationService,
  type CanvasApplicationCommandRequest,
  type CanvasCertifiedResourceAppendRequest,
  type CanvasCollaborationApplicationPort,
} from "./service"

const receipt: BoundedOperationReceipt = {
  format: "convax.canvas-operation-receipt",
  actorId: parseActorId("A".repeat(43)),
  operationId: parseId128("A".repeat(22)),
  intentDigest: parseDigest("d".repeat(64)),
  baseFrontierDigest: parseDigest("e".repeat(64)),
  intentKind: "canvas.nodes.set-geometry",
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigest("f".repeat(64)),
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

function certifiedRequest(): CanvasCertifiedResourceAppendRequest {
  return {
    canvasId: "canvas",
    scopeId: "project",
    resultProjection: "certified-resource-append-patch",
    envelope: {
      actor: { id: "renderer", kind: "renderer" },
      command: {
        type: "resources.pending.create",
        kind: "image",
        label: "Image",
        nodeId: "provisional-only",
        placement: { anchor: { x: 1, y: 2 } },
      },
      commandId: "certified-append",
    },
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
    const submitCertifiedResourceAppend = mock(async () => ({
      affectedNodeIds: ["node"],
      changed: true,
      createdNodeIds: ["node"],
      createdResourceNodeIds: ["node"],
      operationReceipt: receipt,
      projectionDelivery: { status: "unavailable" as const },
      warnings: [],
    }))
    const commits: unknown[] = []
    const diagnostics: string[] = []
    const port: CanvasCollaborationApplicationPort = { query, submit }
    const service = new CanvasApplicationService(port, {
      certifiedResourceAppend: { submitCertifiedResourceAppend },
      diagnostics: {
        record(diagnostic) {
          diagnostics.push(diagnostic.stage)
          throw new Error("diagnostic failure is isolated")
        },
      },
      onDidCommit(event) {
        commits.push(event)
        throw new Error("observer failure is isolated")
      },
    })
    const command = request()

    await expect(service.execute(command)).resolves.toMatchObject({ operationReceipt: receipt })
    expect(submit).toHaveBeenCalledWith(command)
    expect(diagnostics).toEqual(["application-intent", "onDidCommit/event"])
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

    const patchRequest = certifiedRequest()
    await expect(service.executeCertifiedResourceAppend(patchRequest)).resolves.toEqual({
      affectedNodeIds: ["node"],
      changed: true,
      createdNodeIds: ["node"],
      createdResourceNodeIds: ["node"],
      operationReceipt: receipt,
      projectionDelivery: { status: "unavailable" },
      warnings: [],
    })
    expect(submitCertifiedResourceAppend).toHaveBeenCalledWith(patchRequest)
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

  test("rejects non-resource commands before the certified Main port", async () => {
    const submitCertifiedResourceAppend = mock(async () => {
      throw new Error("must not run")
    })
    const service = new CanvasApplicationService(
      {
        query: mock(async () => ({ nodes: [], projection: createCanvasDocument({ id: "canvas" }) })),
        submit: mock(async () => { throw new Error("must not run") }),
      },
      { certifiedResourceAppend: { submitCertifiedResourceAppend } },
    )
    await expect(service.executeCertifiedResourceAppend({
      ...request(),
      resultProjection: "certified-resource-append-patch",
    } as unknown as CanvasCertifiedResourceAppendRequest)).rejects.toThrow(
      "certified projection requests require one resource append",
    )
    expect(submitCertifiedResourceAppend).not.toHaveBeenCalled()
  })

  test("keeps the certified extension optional for generic full-document ports", async () => {
    const port: CanvasCollaborationApplicationPort = {
      query: mock(async () => ({ nodes: [], projection: createCanvasDocument({ id: "canvas" }) })),
      submit: mock(async () => { throw new Error("must not run") }),
    }
    await expect(
      new CanvasApplicationService(port).executeCertifiedResourceAppend(certifiedRequest()),
    ).rejects.toThrow("certified resource append port is unavailable")
  })
})
