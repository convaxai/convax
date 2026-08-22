import { describe, expect, mock, test } from "bun:test"
import { parseActorId, parseDigest, parseId128 } from "@convax/collaboration"
import type { BoundedOperationReceipt } from "../collaboration"
import { createCanvasDocument, createMediaNode } from "../document"
import type { CanvasUploadItem } from "../types"
import { CanvasResourceBusinessService, CanvasResourcePartialFailureError } from "./resources"
import type { CanvasApplicationCommandResult } from "./service"
import { canvasResourceProofMetadataKey } from "../collaboration/application-command-adapter"
import { canvasProjectionResourceMetadataKey } from "../collaboration/projection"

const receipt: BoundedOperationReceipt = {
  format: "convax.canvas-operation-receipt",
  actorId: parseActorId("A".repeat(43)),
  operationId: parseId128("A".repeat(22)),
  intentDigest: parseDigest("d".repeat(64)),
  baseFrontierDigest: parseDigest("e".repeat(64)),
  intentKind: "canvas.agent.create",
  resultEntities: [],
  semanticRoot: true,
  historyMaterialDigest: parseDigest("f".repeat(64)),
}

function resourceIdentity(seed: string, mediaClass: "image" | "text") {
  return {
    format: "convax.canvas-resource-ref" as const,
    uri: `convax-project://test/${seed}`,
    mediaClass,
    mime: mediaClass === "image" ? "image/png" : "text/plain",
    byteLength: "1",
    contentDigest: `${seed}-content`,
    ownerProofDigest: `${seed}-owner`,
  }
}

function resourceProof(resource: ReturnType<typeof resourceIdentity>) {
  return {
    format: "convax.canvas-resource-proof-ref" as const,
    mode: "current-owner-state" as const,
    resource,
    ownerProofDigest: resource.ownerProofDigest,
    requireCurrentLiveVersion: true as const,
  }
}

const imageResource = resourceIdentity("prepared-image", "image")
const image: CanvasUploadItem = {
  id: "prepared-image",
  kind: "image",
  metadata: { [canvasResourceProofMetadataKey]: resourceProof(imageResource) },
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
    const diagnostics: Array<{ stage: string; resources?: number }> = []
    const service = new CanvasResourceBusinessService(
      { prepare },
      { execute, query: mock() },
      { record: (diagnostic) => diagnostics.push({ stage: diagnostic.stage, resources: diagnostic.sizes?.resources }) },
    )

    await expect(service.addResources(baseRequest)).resolves.toMatchObject({ warnings: ["prepared", "committed"] })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(diagnostics).toEqual([{ stage: "business-prepare", resources: 1 }])
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      canvasId: "canvas",
      envelope: { command: { type: "resources.add" }, commandId: "add-one" },
      scopeId: "project",
    })
  })

  test("retains the validated prepared runtime state in the first authoritative projection", async () => {
    const committedDocument = createCanvasDocument({
      id: "canvas",
      nodes: [
        createMediaNode({
          id: "image-node",
          position: { x: 10, y: 20 },
          resource: {
            id: "prepared-image",
            kind: "image",
            metadata: { [canvasProjectionResourceMetadataKey]: imageResource },
            name: "image.png",
            state: { status: "stale" },
          },
        }),
      ],
    })
    const execute = mock(async () => ({
      ...result(),
      affectedNodeIds: ["image-node"],
      createdNodeIds: ["image-node"],
      document: committedDocument,
    }))
    const service = new CanvasResourceBusinessService(
      { prepare: async () => ({ items: [image] }) },
      { execute, query: mock() },
    )

    const applied = await service.addResources(baseRequest)

    expect(applied.document.nodes[0]?.data.resourceState).toEqual({
      status: "ready",
      url: "canvas-resource://prepared-image",
    })
    expect(committedDocument.nodes[0]?.data.resourceState).toEqual({ status: "stale" })
  })

  test("binds prepared runtime state by persisted resource identity when receipt node ids reverse item order", async () => {
    const firstResource = resourceIdentity("first", "image")
    const secondResource = resourceIdentity("second", "image")
    const first: CanvasUploadItem = {
      id: "first-source",
      kind: "image",
      metadata: { [canvasResourceProofMetadataKey]: resourceProof(firstResource) },
      name: "first.png",
      state: { status: "ready", url: "canvas-resource://first" },
    }
    const second: CanvasUploadItem = {
      id: "second-source",
      kind: "image",
      metadata: { [canvasResourceProofMetadataKey]: resourceProof(secondResource) },
      name: "second.png",
      state: { status: "ready", url: "canvas-resource://second" },
    }
    const committedDocument = createCanvasDocument({
      id: "canvas",
      nodes: [
        createMediaNode({
          id: "a-node",
          position: { x: 10, y: 20 },
          resource: {
            id: "second-source",
            kind: "image",
            metadata: { [canvasProjectionResourceMetadataKey]: secondResource },
            name: "second.png",
            state: { status: "stale" },
          },
        }),
        createMediaNode({
          id: "z-node",
          position: { x: 354, y: 20 },
          resource: {
            id: "first-source",
            kind: "image",
            metadata: { [canvasProjectionResourceMetadataKey]: firstResource },
            name: "first.png",
            state: { status: "stale" },
          },
        }),
      ],
    })
    const service = new CanvasResourceBusinessService(
      { prepare: async () => ({ items: [first, second] }) },
      {
        execute: async () => ({
          ...result(),
          affectedNodeIds: ["a-node", "z-node"],
          // Operation receipts sort entity ids, which is the opposite of item order here.
          createdNodeIds: ["a-node", "z-node"],
          document: committedDocument,
        }),
        query: mock(),
      },
    )

    const applied = await service.addResources({
      ...baseRequest,
      sources: [
        { kind: "host-file", path: "first.png", sourceId: "first-source" },
        { kind: "host-file", path: "second.png", sourceId: "second-source" },
      ],
    })

    expect(applied.document.nodes.find((node) => node.id === "z-node")?.data.resourceState).toEqual(first.state)
    expect(applied.document.nodes.find((node) => node.id === "a-node")?.data.resourceState).toEqual(second.state)
  })

  test("does not cross differing runtime states between indistinguishable duplicate resources", async () => {
    const duplicateResource = resourceIdentity("duplicate", "image")
    const items: CanvasUploadItem[] = [
      {
        id: "duplicate-one",
        kind: "image",
        metadata: { [canvasResourceProofMetadataKey]: resourceProof(duplicateResource) },
        name: "duplicate.png",
        state: { status: "ready", url: "canvas-resource://one" },
      },
      {
        id: "duplicate-two",
        kind: "image",
        metadata: { [canvasResourceProofMetadataKey]: resourceProof(duplicateResource) },
        name: "duplicate.png",
        state: { status: "ready", url: "canvas-resource://two" },
      },
    ]
    const committedDocument = createCanvasDocument({
      id: "canvas",
      nodes: ["a-node", "z-node"].map((id, index) =>
        createMediaNode({
          id,
          position: { x: index * 344, y: 0 },
          resource: {
            id,
            kind: "image",
            metadata: { [canvasProjectionResourceMetadataKey]: duplicateResource },
            name: "duplicate.png",
            state: { status: "stale" },
          },
        }),
      ),
    })
    const service = new CanvasResourceBusinessService(
      { prepare: async () => ({ items }) },
      {
        execute: async () => ({
          ...result(),
          affectedNodeIds: ["a-node", "z-node"],
          createdNodeIds: ["a-node", "z-node"],
          document: committedDocument,
        }),
        query: mock(),
      },
    )

    const applied = await service.addResources({
      ...baseRequest,
      sources: [
        { kind: "host-file", path: "duplicate.png", sourceId: "duplicate-one" },
        { kind: "host-file", path: "duplicate.png", sourceId: "duplicate-two" },
      ],
    })

    expect(applied.document.nodes.map((node) => node.data.resourceState)).toEqual([
      { status: "stale" },
      { status: "stale" },
    ])
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

  test("centers the first prepared resource on an explicit pointer anchor using its final size", async () => {
    const execute = mock(async () => result())
    const service = new CanvasResourceBusinessService(
      { prepare: async () => ({ items: [{ ...image, height: 900, width: 1_600 }] }) },
      { execute, query: mock() },
    )

    await service.addResources({
      ...baseRequest,
      anchor: { x: 400, y: 260 },
      anchorOrigin: "center",
      commandId: "drop-centered",
    })

    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      envelope: {
        command: {
          placement: { anchor: { x: 240, y: 170 } },
          type: "resources.add",
        },
      },
    })
  })

  test("forwards and fingerprints an explicit pending generation presentation size", async () => {
    const execute = mock(async () => result())
    const service = new CanvasResourceBusinessService(
      { prepare: async () => ({ items: [image] }) },
      { execute, query: mock() },
    )
    const request = {
      actor: baseRequest.actor,
      anchor: baseRequest.anchor,
      canvasId: baseRequest.canvasId,
      commandId: "pending-sized",
      kind: "image" as const,
      operationId: "operation-sized",
      prompt: "Remove the background",
      scopeId: baseRequest.scopeId,
      size: { height: 206, width: 480 },
      toolId: "image-tools/remove",
    }

    await service.createPendingGenerationResource(request)
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      envelope: {
        command: {
          size: { height: 206, width: 480 },
          type: "resources.pending-generation.create",
        },
      },
    })
    await expect(
      service.createPendingGenerationResource({ ...request, size: { height: 207, width: 480 } }),
    ).rejects.toThrow("reused with a different payload")
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
    await expect(service.addResources({ ...baseRequest, anchorOrigin: "center" })).rejects.toThrow(
      "reused with a different payload",
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
