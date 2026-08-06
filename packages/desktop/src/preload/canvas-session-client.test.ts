import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "@convax/canvas/core"
import {
  encodeBase64url,
  parseActorId,
  parseDigest,
  parseId128,
} from "@convax/collaboration"

import { canvasSessionIpcChannels } from "../canvas-session-contracts"
import { createCanvasSessionPreloadClient } from "./canvas-session-client"

const ref = Object.freeze({ canvasId: "canvas-one", scopeId: "project-one" })
const sessionId = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))
const entitySuffix = encodeBase64url(new Uint8Array(32).fill(2))
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
  format: "convax.canvas-session-projection" as const,
  ref,
  sessionId,
  document,
  nodeEntities: Object.freeze([Object.freeze({ nodeId: entity.id, entity })]),
  canUndo: true,
  canRedo: false,
})
const operationReceipt = Object.freeze({
  format: "convax.canvas-operation-receipt" as const,
  actorId: parseActorId(encodeBase64url(new Uint8Array(32).fill(3))),
  operationId: parseId128(encodeBase64url(new Uint8Array(16).fill(4))),
  intentKind: "canvas.nodes.set-geometry" as const,
  intentDigest: parseDigest("a".repeat(64)),
  baseFrontierDigest: parseDigest("b".repeat(64)),
  resultEntities: Object.freeze([entity]),
  semanticRoot: true,
  historyMaterialDigest: parseDigest("c".repeat(64)),
})
const acceptedFrameDigest = parseDigest("d".repeat(64))

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
    client: createCanvasSessionPreloadClient({ invoke, on, removeListener }),
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
        return {
          acceptedFrameDigest,
          operationReceipt,
          projection,
          ...(channel === canvasSessionIpcChannels.redo
            ? { historyTransition: { direction: "redo", rootOperationId: operationReceipt.operationId } }
            : {}),
        }
      }
      if (channel === canvasSessionIpcChannels.executeApplication) {
        return {
          acceptedFrameDigest,
          affectedNodeIds: [entity.id],
          changed: true,
          createdNodeIds: [],
          operationReceipt,
          projection,
          warnings: [],
        }
      }
      if (channel === canvasSessionIpcChannels.undo) return null
      if (channel === canvasSessionIpcChannels.flush || channel === canvasSessionIpcChannels.close) return undefined
      return projection
    })
    const scope = { ref, sessionId }
    const command = {
      format: "convax.canvas-renderer-command" as const,
      kind: "canvas.nodes.set-geometry" as const,
      body: { updates: [{ node: entity, position: { x: 30, y: 40 } }] },
    }

    await expect(bridge.client.open(ref)).resolves.toMatchObject({ document: { id: ref.canvasId }, sessionId })
    await expect(bridge.client.query(scope)).resolves.toMatchObject({ canUndo: true, sessionId })
    await expect(bridge.client.executeApplication({
      ...scope,
      command: { type: "nodes.setTitle", nodeId: entity.id, title: "Title" },
      commandId: "title-one",
    })).resolves.toMatchObject({ acceptedFrameDigest, projection: { sessionId } })
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
      canvasSessionIpcChannels.executeApplication,
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

    const otherSessionId = parseId128(encodeBase64url(new Uint8Array(16).fill(9)))
    const wrongSession = setup(() => ({ ...projection, sessionId: otherSessionId }))
    await expect(wrongSession.client.query({ ref, sessionId })).rejects.toThrow("stale renderer lease")

    const malformedReceipt = setup(() => ({
      acceptedFrameDigest,
      operationReceipt: { ...operationReceipt, revision: 7 },
      projection,
    }))
    await expect(
      malformedReceipt.client.redo({ ref, sessionId, commandId: "redo-one" }),
    ).rejects.toThrow("BoundedOperationReceipt")
  })

  test("does not deliver an invalid Main invalidation to renderer listeners", () => {
    const bridge = setup(() => projection)
    const listener = mock(() => undefined)
    const unsubscribe = bridge.client.subscribe(listener)

    expect(() => bridge.emit({
      format: "convax.canvas-session-invalidation",
      ref,
      sessionId,
      frameDigest: acceptedFrameDigest,
      revision: 7,
    })).toThrow("field set")
    expect(listener).not.toHaveBeenCalled()

    bridge.emit({ format: "convax.canvas-session-invalidation", ref, sessionId, frameDigest: acceptedFrameDigest })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(bridge.removeListener).toHaveBeenCalledTimes(1)
  })
})
