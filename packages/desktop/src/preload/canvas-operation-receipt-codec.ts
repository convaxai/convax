import type { BoundedOperationReceipt, CanvasEntityRef } from "@convax/canvas/collaboration"
import type { Id128 } from "@convax/collaboration"

const digestPattern = /^[0-9a-f]{64}$/
const id128Pattern = /^[A-Za-z0-9_-]{21}[AQgw]$/
const actorIdPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const entitySuffixPattern = actorIdPattern

export function requireDigestDto(value: unknown, label: string): import("@convax/collaboration").Digest {
  if (typeof value !== "string" || !digestPattern.test(value)) throw new Error(`${label} is invalid`)
  return value as import("@convax/collaboration").Digest
}

const canvasIntentKinds = new Set([
  "canvas.agent.create",
  "canvas.resources.add",
  "canvas.resources.pending.create",
  "canvas.resources.pending-generation.create",
  "canvas.elements.remove",
  "canvas.nodes.set-geometry",
  "canvas.nodes.duplicate",
  "canvas.nodes.update-data",
  "canvas.nodes.set-plugin-state",
  "canvas.nodes.set-structural-parent",
  "canvas.nodes.group",
  "canvas.nodes.ungroup",
  "canvas.edges.connect",
  "canvas.metadata.update",
  "canvas.generation.begin",
  "canvas.generation.complete",
  "canvas.generation.fail",
  "canvas.generations.fail-owned",
  "canvas.generation.dismiss",
  "canvas.generation.fail-recovery",
  "canvas.plugin.creation-group.create",
  "canvas.plugin.surface.create",
  "canvas.undo.semantic-inverse",
  "canvas.redo.semantic-forward",
])

/**
 * Electron sandbox-local wire validation. This deliberately does not import the
 * Yjs-bearing collaboration runtime into preload.
 */
export function assertOperationReceiptDto(value: unknown): asserts value is BoundedOperationReceipt {
  const record = exactDataRecord(value, [
    "actorId",
    "baseFrontierDigest",
    "format",
    "historyMaterialDigest",
    "intentDigest",
    "intentKind",
    "operationId",
    "resultEntities",
    "semanticRoot",
  ], "BoundedOperationReceipt")
  if (
    record.format !== "convax.canvas-operation-receipt" ||
    !actorIdPattern.test(String(record.actorId)) ||
    !id128Pattern.test(String(record.operationId)) ||
    !canvasIntentKinds.has(String(record.intentKind)) ||
    !digestPattern.test(String(record.intentDigest)) ||
    !digestPattern.test(String(record.baseFrontierDigest)) ||
    (record.historyMaterialDigest !== null && !digestPattern.test(String(record.historyMaterialDigest))) ||
    typeof record.semanticRoot !== "boolean" ||
    record.semanticRoot !== (record.historyMaterialDigest !== null) ||
    !isDenseBoundedArray(record.resultEntities, 4_096)
  ) {
    throw new Error("BoundedOperationReceipt is invalid")
  }

  let prior: string | undefined
  for (const entity of record.resultEntities) {
    assertEntityRefDto(entity)
    const key = `${entity.kind}/${entity.id}/${entity.incarnation}`
    if (prior !== undefined && prior >= key) {
      throw new Error("BoundedOperationReceipt result entities are not sorted unique")
    }
    prior = key
  }
}

export function assertEntityRefDto(
  value: unknown,
  expectedKind?: "node" | "edge",
): asserts value is CanvasEntityRef {
  const record = exactDataRecord(value, ["id", "incarnation", "kind"], "CanvasEntityRef")
  const kind = record.kind
  if ((kind !== "node" && kind !== "edge") || (expectedKind !== undefined && kind !== expectedKind)) {
    throw new Error("CanvasEntityRef kind is invalid")
  }
  const idPrefix = kind === "node" ? "n_" : "e_"
  const incarnationPrefix = kind === "node" ? "ni_" : "ei_"
  if (
    typeof record.id !== "string" ||
    !record.id.startsWith(idPrefix) ||
    !entitySuffixPattern.test(record.id.slice(idPrefix.length)) ||
    typeof record.incarnation !== "string" ||
    !record.incarnation.startsWith(incarnationPrefix) ||
    !entitySuffixPattern.test(record.incarnation.slice(incarnationPrefix.length))
  ) {
    throw new Error(
      `CanvasEntityRef must use canonical ${idPrefix} id and canonical ${incarnationPrefix} incarnation`,
    )
  }
}

export function requireId128Dto(value: unknown, label: string): Id128 {
  if (typeof value !== "string" || !id128Pattern.test(value)) throw new Error(`${label} is invalid`)
  return value as Id128
}

function exactDataRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} is invalid`)
  const record = value as Record<string, unknown>
  const actual = Reflect.ownKeys(record)
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== "string") ||
    (actual as string[]).sort().some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has an invalid field set`)
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new Error(`${label} is invalid`)
    }
  }
  return record
}

function isDenseBoundedArray(value: unknown, maximumLength: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength || Object.keys(value).length !== value.length) return false
  return Reflect.ownKeys(value).every((key) => key === "length" || (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key)))
}
