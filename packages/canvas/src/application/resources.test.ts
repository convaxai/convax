import { describe, expect, mock, test } from "bun:test"
import { parseActorId, parseDigest, parseId128 } from "@convax/collaboration"
import type { BoundedOperationReceiptV2 } from "../collaboration"
import { createCanvasDocument } from "../document"
import type { CanvasUploadItem } from "../types"
import { CanvasResourceBusinessService, CanvasResourcePartialFailureError } from "./resources"
import type { CanvasApplicationCommandResult } from "./service"

const receipt: BoundedOperationReceiptV2 = {
  format: "convax.canvas-operation-receipt/2",
  actorId: parseActorId("A".repeat(43)),
  operationId: parseId128("A".repeat(22)),
  intentDigest: parseDigest("d".repeat(64)),
  baseFrontierDigest: parseDigest("e".repeat(64)),
  intentKind: "canvas.nodes.create/2",
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigest("f".repeat(64)),
}

const image: CanvasUploadItem = {
  id: "prepared-image",
  kind: "image",
  metadata: {},
  name: "image.png",
  state: { status: "ready", url: "canvas-resource://prepared-image" },
}

function result(warnings: string[] = []): CanvasApplicationCommandResult {
  return {
    affectedNodeIds: [],
    changed: true,
    createdNodeIds: [],
    document: createCanvasDocument({ id: "canvas" }),
    operationReceipt: receipt,
    warnings,
  }
}

const baseRequest = {
  actor: { id: "agent", kind: "agent" },
  anchor: { x: 10, y: 20 },
  canvasId: "canvas",
  commandId: "add-one",
  scopeId: "project",
  sources: [{ kind: "host-file", path: "image.png", sourceId: "source" }] as const,
}

describe("Canvas resource collaboration orchestration", () => {
  test("prepares host bytes before one collaboration submit and preserves warnings", async () => {
    const prepare = mock(async () => ({ items: [image], warnings: ["prepared"] }))
    const execute = mock(async () => result(["committed"]))
    const service = new CanvasResourceBusinessService({ prepare }, { execute, query: mock() })

    await expect(service.addResources(baseRequest)).resolves.toMatchObject({ warnings: ["prepared", "committed"] })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      canvasId: "canvas",
      envelope: { command: { type: "resources.add" }, commandId: "add-one" },
      scopeId: "project",
    })
  })

  test("forwards Group placement in the same typed resource intent", async () => {
    const execute = mock(async () => result())
    const service = new CanvasResourceBusinessService(
      { prepare: async () => ({ items: [image] }) },
      { execute, query: mock() },
    )

    await service.addResources({ ...baseRequest, commandId: "add-nested", parentId: "focused-group" })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      envelope: {
        command: {
          placement: { parentId: "focused-group" },
          type: "resources.add",
        },
      },
    })
  })

  test("retains a prepared file when the Canvas collaboration commit fails", async () => {
    const service = new CanvasResourceBusinessService(
      { prepare: async () => ({ items: [image], retainedOnFailure: [{ label: "image.png" }] }) },
      {
        execute: async () => {
          throw new Error("candidate rejected")
        },
        query: mock(),
      },
    )
    const failure = await service.addResources(baseRequest).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CanvasResourcePartialFailureError)
    expect((failure as CanvasResourcePartialFailureError).retainedOnFailure).toEqual([{ label: "image.png" }])
  })

  test("deduplicates an in-flight correlation id and rejects payload reuse", async () => {
    const execute = mock(async () => result())
    const service = new CanvasResourceBusinessService(
      { prepare: async () => ({ items: [image] }) },
      { execute, query: mock() },
    )
    const first = service.addResources(baseRequest)
    const duplicate = service.addResources(baseRequest)
    expect(duplicate).toBe(first)
    await first
    await expect(service.addResources({ ...baseRequest, anchor: { x: 99, y: 20 } })).rejects.toThrow(
      "reused with a different payload",
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
