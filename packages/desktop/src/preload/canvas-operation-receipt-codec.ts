import type { BoundedOperationReceiptV2, CanvasEntityRefV2 } from "@convax/canvas/collaboration"
import type { Id128 } from "@convax/collaboration"

const digestPattern = /^[0-9a-f]{64}$/
const id128Pattern = /^[A-Za-z0-9_-]{21}[AQgw]$/
const actorIdPattern = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const entitySuffixPattern = actorIdPattern

const canvasIntentKinds = new Set([
  "canvas.agent.create",
  "canvas.resources.add/2",
  "canvas.resources.pending.create/2",
  "canvas.resources.pending-generation.create/2",
  "canvas.elements.remove/2",
  "canvas.nodes.set-geometry/2",
  "canvas.nodes.update-data/2",
  "canvas.nodes.set-plugin-state/2",
  "canvas.nodes.set-structural-parent/2",
  "canvas.nodes.group/2",
  "canvas.nodes.ungroup/2",
  "canvas.edges.connect/2",
  "canvas.metadata.update/2",
  "canvas.generation.begin/2",
  "canvas.generation.complete/2",
  "canvas.generation.fail/2",
  "canvas.generations.fail-owned/2",
  "canvas.generation.dismiss/2",
  "canvas.generation.fail-recovery/2",
  "canvas.plugin.creation-group.create/2",
  "canvas.undo.semantic-inverse/2",
  "canvas.redo.semantic-forward/2",
])

/**
 * Electron sandbox-local wire validation. This deliberately does not import the
 * Yjs-bearing collaboration runtime into preload.
 */
export function assertOperationReceiptDtoV2(value: unknown): asserts value is BoundedOperationReceiptV2 {
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
  ], "BoundedOperationReceiptV2")
  if (
    record.format !== "convax.canvas-operation-receipt/2" ||
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
    throw new Error("BoundedOperationReceiptV2 is invalid")
  }

  let prior: string | undefined
  for (const entity of record.resultEntities) {
    assertEntityRefDtoV2(entity)
    const key = `${entity.kind}/${entity.id}/${entity.incarnation}`
    if (prior !== undefined && prior >= key) {
      throw new Error("BoundedOperationReceiptV2 result entities are not sorted unique")
    }
    prior = key
  }
}

export function assertEntityRefDtoV2(
  value: unknown,
  expectedKind?: "node" | "edge",
): asserts value is CanvasEntityRefV2 {
  const record = exactDataRecord(value, ["id", "incarnation", "kind"], "CanvasEntityRefV2")
  const kind = record.kind
  if ((kind !== "node" && kind !== "edge") || (expectedKind !== undefined && kind !== expectedKind)) {
    throw new Error("CanvasEntityRefV2 kind is invalid")
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
      `CanvasEntityRefV2 must use canonical ${idPrefix} id and canonical ${incarnationPrefix} incarnation`,
    )
  }
}

export function requireId128DtoV2(value: unknown, label: string): Id128 {
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
