import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "@convax/canvas/core"
import {
  encodeBase64urlV2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
} from "@convax/collaboration"

import { canvasSessionIpcChannels } from "../canvas-session-contracts"
import { createCanvasSessionPreloadClientV2 } from "./canvas-session-client"

const ref = Object.freeze({ canvasId: "canvas-one", scopeId: "project-one" })
const sessionId = parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(1)))
const entitySuffix = encodeBase64urlV2(new Uint8Array(32).fill(2))
const entity = Object.freeze({
  kind: "node" as const,
  id: `n_${entitySuffix}`,
  incarnation: `ni_${entitySuffix}`,
})
const document = createCanvasDocument({
  id: ref.canvasId,
  nodes: [
    createTextNode({
      id: entity.id,
      metadata: {},
      position: { x: 10, y: 20 },
      resourceState: { status: "stale" },
    }),
  ],
})
const projection = Object.freeze({
  format: "convax.canvas-session-projection/2" as const,
  ref,
  sessionId,
  document,
  nodeEntities: Object.freeze([Object.freeze({ nodeId: entity.id, entity })]),
  canUndo: true,
  canRedo: false,
})
const operationReceipt = Object.freeze({
  format: "convax.canvas-operation-receipt/2" as const,
  actorId: parseActorIdV2(encodeBase64urlV2(new Uint8Array(32).fill(3))),
  operationId: parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(4))),
  intentKind: "canvas.nodes.set-geometry/2" as const,
  intentDigest: parseDigestV2("a".repeat(64)),
  baseFrontierDigest: parseDigestV2("b".repeat(64)),
  resultEntities: Object.freeze([entity]),
  semanticRoot: true,
  historyMaterialDigest: parseDigestV2("c".repeat(64)),
})

function setup(respond: (channel: string, input: unknown) => unknown | Promise<unknown>) {
  const invoke = mock(async (channel: string, input: unknown) => respond(channel, input))
  const eventListeners = new Set<(event: unknown, payload: unknown) => void>()
  const on = mock((channel: string, listener: (event: unknown, payload: unknown) => void) => {
    expect(channel).toBe(canvasSessionIpcChannels.invalidated)
    eventListeners.add(listener)
  })
  const removeListener = mock((channel: string, listener: (event: unknown, payload: unknown) => void) => {
    expect(channel).toBe(canvasSessionIpcChannels.invalidated)
    eventListeners.delete(listener)
  })
  return {
    client: createCanvasSessionPreloadClientV2({ invoke, on, removeListener }),
    emit(payload: unknown) {
      for (const listener of eventListeners) listener({}, payload)
    },
    invoke,
    on,
    removeListener,
  }
}

describe("preload Canvas session client", () => {
  test("validates every response while preserving the closed session transport", async () => {
    const bridge = setup((channel) => {
      if (channel === canvasSessionIpcChannels.submit || channel === canvasSessionIpcChannels.redo) {
        return { operationReceipt, projection }
      }
      if (channel === canvasSessionIpcChannels.undo) return null
      if (channel === canvasSessionIpcChannels.flush || channel === canvasSessionIpcChannels.close) return undefined
      return projection
    })
    const scope = { ref, sessionId }
    const command = {
      format: "convax.canvas-renderer-command/2" as const,
      kind: "canvas.nodes.set-geometry/2" as const,
      body: { updates: [{ node: entity, position: { x: 30, y: 40 } }] },
    }

    await expect(bridge.client.open(ref)).resolves.toMatchObject({ document: { id: ref.canvasId }, sessionId })
    await expect(bridge.client.query(scope)).resolves.toMatchObject({ canUndo: true, sessionId })
    await expect(
      bridge.client.submit({ ...scope, command, commandId: "move-one" }),
    ).resolves.toMatchObject({ operationReceipt: { operationId: operationReceipt.operationId } })
    await expect(bridge.client.undo({ ...scope, commandId: "undo-one" })).resolves.toBeNull()
    await expect(bridge.client.redo({ ...scope, commandId: "redo-one" })).resolves.toMatchObject({ projection: { sessionId } })
    await expect(bridge.client.flush(scope)).resolves.toBeUndefined()
    await expect(bridge.client.close(scope)).resolves.toBeUndefined()
    expect(bridge.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      canvasSessionIpcChannels.open,
      canvasSessionIpcChannels.query,
      canvasSessionIpcChannels.submit,
      canvasSessionIpcChannels.undo,
      canvasSessionIpcChannels.redo,
      canvasSessionIpcChannels.flush,
      canvasSessionIpcChannels.close,
    ])
  })

  test("rejects legacy revision fields, unknown envelopes, and non-canonical entity refs", async () => {
    const withEnvelopeRevision = setup(() => ({ ...projection, revision: 7 }))
    await expect(withEnvelopeRevision.client.open(ref)).rejects.toThrow("field set")

    const withDocumentRevision = setup(() => ({ ...projection, document: { ...document, revision: 7 } }))
    await expect(withDocumentRevision.client.open(ref)).rejects.toThrow("document projection")

    const withInvalidEntity = setup(() => ({
      ...projection,
      nodeEntities: [{ nodeId: entity.id, entity: { ...entity, incarnation: "node-v1" } }],
    }))
    await expect(withInvalidEntity.client.open(ref)).rejects.toThrow("canonical ni_")
  })

  test("rejects stale scope/session responses and malformed operation receipts", async () => {
    const wrongScope = setup(() => ({ ...projection, ref: { ...ref, scopeId: "project-two" } }))
    await expect(wrongScope.client.open(ref)).rejects.toThrow("crossed document scope")

    const otherSessionId = parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(9)))
    const wrongSession = setup(() => ({ ...projection, sessionId: otherSessionId }))
    await expect(wrongSession.client.query({ ref, sessionId })).rejects.toThrow("stale renderer lease")

    const malformedReceipt = setup(() => ({
      operationReceipt: { ...operationReceipt, revision: 7 },
      projection,
    }))
    await expect(
      malformedReceipt.client.redo({ ref, sessionId, commandId: "redo-one" }),
    ).rejects.toThrow("BoundedOperationReceiptV2")
  })

  test("does not deliver an invalid Main invalidation to renderer listeners", () => {
    const bridge = setup(() => projection)
    const listener = mock(() => undefined)
    const unsubscribe = bridge.client.subscribe(listener)

    expect(() => bridge.emit({
      format: "convax.canvas-session-invalidation/2",
      ref,
      sessionId,
      revision: 7,
    })).toThrow("field set")
    expect(listener).not.toHaveBeenCalled()

    bridge.emit({ format: "convax.canvas-session-invalidation/2", ref, sessionId })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(bridge.removeListener).toHaveBeenCalledTimes(1)
  })
})
