import type { CanvasDocumentRef } from "@convax/canvas/application"
import { parseCanvasDocument } from "@convax/canvas/core"

import {
  canvasSessionIpcChannels,
  type CanvasRendererSessionMutationResultV2,
  type CanvasRendererSessionScopeV2,
  type CanvasRendererSessionTransportV2,
  type CanvasSessionInvalidationDtoV2,
  type CanvasSessionProjectionDtoV2,
} from "../canvas-session-contracts"
import {
  assertEntityRefDtoV2,
  assertOperationReceiptDtoV2,
  requireId128DtoV2,
} from "./canvas-operation-receipt-codec"

export interface CanvasSessionPreloadClientOptionsV2 {
  readonly invoke: (channel: string, input: unknown) => Promise<unknown>
  readonly on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void
  readonly removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) => void
}

/** Browser-safe DTO bridge. Main remains the only document/kernel owner. */
export function createCanvasSessionPreloadClientV2(
  options: CanvasSessionPreloadClientOptionsV2,
): CanvasRendererSessionTransportV2 {
  const client: CanvasRendererSessionTransportV2 = {
    async open(ref) {
      return requireProjection(await options.invoke(canvasSessionIpcChannels.open, ref), ref)
    },
    async query(scope) {
      return requireProjection(await options.invoke(canvasSessionIpcChannels.query, scope), scope.ref, scope.sessionId)
    },
    async submit(input) {
      return requireMutation(await options.invoke(canvasSessionIpcChannels.submit, input), input)
    },
    async undo(input) {
      const value = await options.invoke(canvasSessionIpcChannels.undo, input)
      return value === null ? null : requireMutation(value, input)
    },
    async redo(input) {
      const value = await options.invoke(canvasSessionIpcChannels.redo, input)
      return value === null ? null : requireMutation(value, input)
    },
    async flush(scope) {
      requireVoid(await options.invoke(canvasSessionIpcChannels.flush, scope))
    },
    async close(scope) {
      requireVoid(await options.invoke(canvasSessionIpcChannels.close, scope))
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Canvas session invalidation listener is required")
      const bridge = (_event: unknown, payload: unknown) => listener(requireInvalidation(payload))
      options.on(canvasSessionIpcChannels.invalidated, bridge)
      return () => options.removeListener(canvasSessionIpcChannels.invalidated, bridge)
    },
  }
  return Object.freeze(client)
}

function requireMutation(
  value: unknown,
  scope: CanvasRendererSessionScopeV2,
): CanvasRendererSessionMutationResultV2 {
  const record = exactRecord(value, ["operationReceipt", "projection"], "Canvas session mutation result")
  assertOperationReceiptDtoV2(record.operationReceipt)
  return Object.freeze({
    operationReceipt: structuredClone(record.operationReceipt),
    projection: requireProjection(record.projection, scope.ref, scope.sessionId),
  })
}

function requireProjection(
  value: unknown,
  expectedRef: CanvasDocumentRef,
  expectedSessionId?: CanvasSessionProjectionDtoV2["sessionId"],
): CanvasSessionProjectionDtoV2 {
  const record = exactRecord(
    value,
    ["canRedo", "canUndo", "document", "format", "nodeEntities", "ref", "sessionId"],
    "Canvas session projection",
  )
  if (record.format !== "convax.canvas-session-projection/2") throw new Error("Canvas session projection format is invalid")
  const ref = requireRef(record.ref)
  if (!sameRef(ref, expectedRef)) throw new Error("Canvas session projection crossed document scope")
  const sessionId = requireId128DtoV2(record.sessionId, "Canvas session id")
  if (expectedSessionId !== undefined && sessionId !== expectedSessionId) {
    throw new Error("Canvas session projection belongs to a stale renderer lease")
  }
  const documentRecord = exactRecord(
    record.document,
    ["edges", "id", "metadata", "nodes"],
    "Canvas session document projection",
  )
  const document = parseCanvasDocument(documentRecord, ref.canvasId)
  if (!document) throw new Error("Canvas session document projection is invalid")
  if (typeof record.canUndo !== "boolean" || typeof record.canRedo !== "boolean") {
    throw new Error("Canvas session history projection is invalid")
  }
  if (!Array.isArray(record.nodeEntities) || record.nodeEntities.length !== document.nodes.length) {
    throw new Error("Canvas session entity projection is incomplete")
  }
  const seen = new Set<string>()
  const nodeEntities = record.nodeEntities.map((value) => {
    const entry = exactRecord(value, ["entity", "nodeId"], "Canvas session entity entry")
    const entity = entry.entity
    assertEntityRefDtoV2(entity, "node")
    if (
      entity.kind !== "node" ||
      typeof entry.nodeId !== "string" ||
      entry.nodeId !== entity.id ||
      seen.has(entry.nodeId)
    ) {
      throw new Error("Canvas session entity reference is invalid")
    }
    seen.add(entry.nodeId)
    return Object.freeze({
      nodeId: entry.nodeId,
      entity: Object.freeze({ kind: "node" as const, id: entity.id, incarnation: entity.incarnation }),
    })
  })
  if (document.nodes.some((node) => !seen.has(node.id))) throw new Error("Canvas session entity projection is incomplete")
  return Object.freeze({
    format: "convax.canvas-session-projection/2",
    ref,
    sessionId,
    document,
    nodeEntities: Object.freeze(nodeEntities),
    canUndo: record.canUndo,
    canRedo: record.canRedo,
  })
}

function requireInvalidation(value: unknown): CanvasSessionInvalidationDtoV2 {
  const record = exactRecord(value, ["format", "ref", "sessionId"], "Canvas session invalidation")
  if (record.format !== "convax.canvas-session-invalidation/2") {
    throw new Error("Canvas session invalidation has an invalid field set")
  }
  return Object.freeze({
    format: "convax.canvas-session-invalidation/2",
    ref: requireRef(record.ref),
    sessionId: requireId128DtoV2(record.sessionId, "Canvas session id"),
  })
}

function requireRef(value: unknown): CanvasDocumentRef {
  const record = exactRecord(value, ["canvasId", "scopeId"], "Canvas session reference")
  return Object.freeze({
    canvasId: requireAuthorityComponent(record.canvasId, "Canvas id"),
    scopeId: requireAuthorityComponent(record.scopeId, "Canvas scope id"),
  })
}

function requireAuthorityComponent(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value !== value.normalize("NFC") ||
    new TextEncoder().encode(value).byteLength > 256
  ) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const record = value as Record<string, unknown>
  const actual = Object.keys(record).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) {
    throw new Error(`${label} has an invalid field set`)
  }
  return record
}

function requireVoid(value: unknown): void {
  if (value !== undefined) throw new Error("Canvas session void response is invalid")
}

function sameRef(left: CanvasDocumentRef, right: CanvasDocumentRef): boolean {
  return left.canvasId === right.canvasId && left.scopeId === right.scopeId
}
