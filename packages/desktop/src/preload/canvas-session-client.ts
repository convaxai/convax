import type { CanvasDocumentRef } from "@convax/canvas/application"
import {
  parseCanvasCertifiedProjectionIdentity,
  parseCanvasRendererResourceHierarchySnapshot,
} from "@convax/canvas/collaboration"
import { parseCanvasDocument } from "@convax/canvas/core"

import {
  canvasSessionIpcChannels,
  type CanvasRendererSessionMutationResult,
  type CanvasRendererApplicationMutationResult,
  type CanvasRendererSessionScope,
  type CanvasRendererSessionTransport,
  type CanvasSessionInvalidationDto,
  type CanvasSessionProjectionDto,
} from "../canvas-session-contracts"
import {
  assertEntityRefDto,
  assertOperationReceiptDto,
  requireDigestDto,
  requireId128Dto,
} from "./canvas-operation-receipt-codec"

export interface CanvasSessionPreloadClientOptions {
  readonly invoke: (channel: string, input: unknown) => Promise<unknown>
  readonly on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void
  readonly removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) => void
}

/** Browser-safe DTO bridge. Main remains the only document/kernel owner. */
export function createCanvasSessionPreloadClient(
  options: CanvasSessionPreloadClientOptions,
): CanvasRendererSessionTransport {
  const client: CanvasRendererSessionTransport = {
    async open(ref) {
      return requireCanvasSessionProjection(await options.invoke(canvasSessionIpcChannels.open, ref), ref)
    },
    async query(scope) {
      return requireCanvasSessionProjection(
        await options.invoke(canvasSessionIpcChannels.query, scope),
        scope.ref,
        scope.sessionId,
      )
    },
    async executeApplication(input) {
      return requireApplicationMutation(await options.invoke(canvasSessionIpcChannels.executeApplication, input), input)
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

function requireMutation(value: unknown, scope: CanvasRendererSessionScope): CanvasRendererSessionMutationResult {
  const valueRecord = value as Record<string, unknown> | null
  const hasHistory = Boolean(valueRecord && Object.prototype.hasOwnProperty.call(valueRecord, "historyTransition"))
  const record = exactRecord(
    value,
    hasHistory
      ? ["acceptedFrameDigest", "historyTransition", "operationReceipt", "projection"]
      : ["acceptedFrameDigest", "operationReceipt", "projection"],
    "Canvas session mutation result",
  )
  assertOperationReceiptDto(record.operationReceipt)
  let historyTransition: CanvasRendererSessionMutationResult["historyTransition"]
  if (hasHistory) {
    const transition = exactRecord(
      record.historyTransition,
      ["direction", "rootOperationId"],
      "Canvas history transition",
    )
    if (transition.direction !== "undo" && transition.direction !== "redo") {
      throw new Error("Canvas history transition direction is invalid")
    }
    historyTransition = Object.freeze({
      direction: transition.direction,
      rootOperationId: requireId128Dto(transition.rootOperationId, "Canvas history root operation id"),
    })
  }
  return Object.freeze({
    operationReceipt: structuredClone(record.operationReceipt),
    projection: requireCanvasSessionProjection(record.projection, scope.ref, scope.sessionId),
    acceptedFrameDigest: requireDigestDto(record.acceptedFrameDigest, "Canvas accepted frame digest"),
    ...(historyTransition ? { historyTransition } : {}),
  })
}

function requireApplicationMutation(
  value: unknown,
  scope: CanvasRendererSessionScope,
): CanvasRendererApplicationMutationResult {
  const record = exactRecord(
    value,
    [
      "acceptedFrameDigest",
      "affectedNodeIds",
      "changed",
      "createdNodeIds",
      "operationReceipt",
      "projection",
      "warnings",
    ],
    "Canvas application mutation result",
  )
  assertOperationReceiptDto(record.operationReceipt)
  if (record.changed !== true) throw new Error("Canvas application mutation changed marker is invalid")
  const affectedNodeIds = requireStringArray(record.affectedNodeIds, "Canvas affected node ids", 4_096)
  const createdNodeIds = requireStringArray(record.createdNodeIds, "Canvas created node ids", 4_096)
  const warnings = requireStringArray(record.warnings, "Canvas application warnings", 64)
  return Object.freeze({
    acceptedFrameDigest: requireDigestDto(record.acceptedFrameDigest, "Canvas accepted frame digest"),
    affectedNodeIds,
    changed: true,
    createdNodeIds,
    operationReceipt: structuredClone(record.operationReceipt),
    projection: requireCanvasSessionProjection(record.projection, scope.ref, scope.sessionId),
    warnings,
  })
}

export function requireCanvasSessionProjection(
  value: unknown,
  expectedRef: CanvasDocumentRef,
  expectedSessionId?: CanvasSessionProjectionDto["sessionId"],
): CanvasSessionProjectionDto {
  const record = exactRecord(
    value,
    [
      "canRedo",
      "canUndo",
      "document",
      "edgeEntities",
      "format",
      "nodeEntities",
      "projectionIdentity",
      "ref",
      "resourceHierarchy",
      "sessionId",
    ],
    "Canvas session projection",
  )
  if (record.format !== "convax.canvas-session-projection")
    throw new Error("Canvas session projection format is invalid")
  const ref = requireRef(record.ref)
  if (!sameRef(ref, expectedRef)) throw new Error("Canvas session projection crossed document scope")
  const sessionId = requireId128Dto(record.sessionId, "Canvas session id")
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
  const projectionIdentity = parseCanvasCertifiedProjectionIdentity(record.projectionIdentity)
  if (projectionIdentity.canvasId !== ref.canvasId) {
    throw new Error("Canvas session owner projection identity crossed document scope")
  }
  const resourceHierarchy = parseCanvasRendererResourceHierarchySnapshot(record.resourceHierarchy)
  if (
    resourceHierarchy.projectionIdentity.canvasId !== projectionIdentity.canvasId ||
    resourceHierarchy.projectionIdentity.ownerSchemaDigest !== projectionIdentity.ownerSchemaDigest ||
    resourceHierarchy.projectionIdentity.stateCommitmentDigest !== projectionIdentity.stateCommitmentDigest
  ) {
    throw new Error("Canvas session resource hierarchy crossed owner projection identity")
  }
  if (!Array.isArray(record.nodeEntities) || record.nodeEntities.length !== document.nodes.length) {
    throw new Error("Canvas session entity projection is incomplete")
  }
  if (!Array.isArray(record.edgeEntities) || record.edgeEntities.length !== document.edges.length) {
    throw new Error("Canvas session edge entity projection is incomplete")
  }
  const seenEdges = new Set<string>()
  const edgeEntities = record.edgeEntities.map((value) => {
    const entry = exactRecord(value, ["edgeId", "entity"], "Canvas session edge entity entry")
    const entity = entry.entity
    assertEntityRefDto(entity, "edge")
    if (
      entity.kind !== "edge" ||
      typeof entry.edgeId !== "string" ||
      entry.edgeId !== entity.id ||
      seenEdges.has(entry.edgeId)
    ) {
      throw new Error("Canvas session edge entity reference is invalid")
    }
    seenEdges.add(entry.edgeId)
    return Object.freeze({
      edgeId: entry.edgeId,
      entity: Object.freeze({ kind: "edge" as const, id: entity.id, incarnation: entity.incarnation }),
    })
  })
  if (document.edges.some((edge) => !seenEdges.has(edge.id))) {
    throw new Error("Canvas session edge entity projection is incomplete")
  }
  const seen = new Set<string>()
  const nodeEntities = record.nodeEntities.map((value) => {
    const entry = exactRecord(value, ["entity", "nodeId"], "Canvas session entity entry")
    const entity = entry.entity
    assertEntityRefDto(entity, "node")
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
  if (document.nodes.some((node) => !seen.has(node.id)))
    throw new Error("Canvas session entity projection is incomplete")
  return Object.freeze({
    format: "convax.canvas-session-projection",
    ref,
    sessionId,
    document,
    edgeEntities: Object.freeze(edgeEntities),
    nodeEntities: Object.freeze(nodeEntities),
    projectionIdentity,
    resourceHierarchy,
    canUndo: record.canUndo,
    canRedo: record.canRedo,
  })
}

function requireInvalidation(value: unknown): CanvasSessionInvalidationDto {
  const record = exactRecord(value, ["format", "frameDigest", "ref", "sessionId"], "Canvas session invalidation")
  if (record.format !== "convax.canvas-session-invalidation") {
    throw new Error("Canvas session invalidation has an invalid field set")
  }
  return Object.freeze({
    format: "convax.canvas-session-invalidation",
    ref: requireRef(record.ref),
    sessionId: requireId128Dto(record.sessionId, "Canvas session id"),
    frameDigest: requireDigestDto(record.frameDigest, "Canvas invalidation frame digest"),
  })
}

function requireStringArray(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} is invalid`)
  const result = value.map((item) => {
    if (
      typeof item !== "string" ||
      item.length < 1 ||
      item.includes("\0") ||
      new TextEncoder().encode(item).byteLength > 1_024
    ) {
      throw new Error(`${label} is invalid`)
    }
    return item
  })
  return result
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
