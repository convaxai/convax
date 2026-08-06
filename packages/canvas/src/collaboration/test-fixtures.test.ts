import {
  encodeBase64url,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseProjectId,
  parseReplicaId,
  parseUint32,
  parseUint64,
} from "@convax/collaboration"
import type { OwnerIntentValidationContext } from "@convax/collaboration"
import * as Y from "yjs"
import { assertCanvasTypedIntent } from "./intent-validation"
import {
  dataRegisterDigest,
  effectiveDataDigest,
  nodeIdentityDigest,
  obstacleProjectionDigest,
} from "./projection"
import { applyCanvasCandidateIntent } from "./reducer"
import type {
  CanvasEntityRef,
  CanvasExternalFactContext,
  CanvasIntentApplyResult,
  CanvasTypedIntentUnion,
  Digest,
  DocumentScope,
} from "./types"
import { derivedNodeRef } from "./validation"
import { cloneCanvasYDoc, createCanvasYDoc, validateCanvasYDoc } from "./ydoc"

export const SCHEMA_DIGEST = parseDigest("09d5f8748d91474de45eb3a88fe6d3054adb79e8a44dd311c9024ab95b27250a")
export const PROTOCOL_DIGEST = parseDigest("8295f918e8f7b8297c080db03672fc410542280f639d9b40a8e324e560f07ae9")
export const VALIDATION_ARTIFACT_SET_DIGEST = parseDigest(
  "163cab7b5ca1bd13bb4f96d9b41b4e6e884e29619a4e1fc964ec72d630950db2",
)
export const PROJECT_INDEX_ROUTE_DEPENDENCY_FRAME_DIGEST = parseDigest(
  "9a781f03bd02abed189fb0f7ae93c48448f7ced7eab32e25ac0436e30b7efd2e",
)
export const ZERO_DIGEST = parseDigest("0".repeat(64))
export const U0 = parseUint32("0")

export const SCOPE: DocumentScope = Object.freeze({
  projectId: parseProjectId("project"),
  projectEpoch: id128(201),
  docKind: "canvas",
  docId: parseCanvasId(`cv_${"2".repeat(64)}`),
  shardEpoch: id128(202),
})

export const VALID_FACTS: CanvasExternalFactContext = Object.freeze({
  validateCurrentResource: () => "valid",
  validatePluginArtifact: () => "valid",
  validatePluginState: () => "valid",
  validateGenerationBegin: () => "valid",
  validateEditorAction: () => "valid",
  validateGenerationRecovery: () => "valid",
})

export function actor(seed: number) {
  return parseActorId(encoded(seed, 32))
}

export function id128(seed: number) {
  return parseId128(encoded(seed, 16))
}

export function context(actorSeed: number, operationSeed: number, lamport: number): OwnerIntentValidationContext {
  return Object.freeze({
    scope: SCOPE,
    actorId: actor(actorSeed),
    actorSequence: parseUint64(String(lamport)),
    operationId: id128(operationSeed),
    lamport: parseUint64(String(lamport)),
    intentDigest: digest(operationSeed),
    baseFrontierDigest: digest(operationSeed + 128),
    protocolDigest: PROTOCOL_DIGEST,
    ownerSchemaDigest: SCHEMA_DIGEST,
    validationArtifactSetDigest: VALIDATION_ARTIFACT_SET_DIGEST,
  })
}

export function digest(seed: number): Digest {
  return parseDigest([...bytes(seed, 32)].map((value) => value.toString(16).padStart(2, "0")).join(""))
}

export function newCanvas(): Y.Doc {
  return createCanvasYDoc(
    SCOPE,
    SCHEMA_DIGEST,
    PROTOCOL_DIGEST,
    PROJECT_INDEX_ROUTE_DEPENDENCY_FRAME_DIGEST,
    parseReplicaId("replica_00000001"),
  )
}

export function fork(document: Y.Doc): Y.Doc {
  return cloneCanvasYDoc(document)
}

export function merge(
  base: Y.Doc,
  branches: readonly Y.Doc[],
  order: readonly number[],
  duplicateIndex: number | null = null,
): Y.Doc {
  const result = fork(base)
  for (const index of order) {
    const update = Y.encodeStateAsUpdate(branches[index]!)
    Y.applyUpdate(result, update, `merge-${index}`)
    if (duplicateIndex === index) Y.applyUpdate(result, update, `duplicate-${index}`)
  }
  return result
}

export function applyOk(
  document: Y.Doc,
  operationContext: OwnerIntentValidationContext,
  intent: CanvasTypedIntentUnion,
  facts: CanvasExternalFactContext = VALID_FACTS,
): CanvasIntentApplyResult {
  assertCanvasTypedIntent(intent)
  const result = applyCanvasCandidateIntent(document, operationContext, intent, facts)
  if (result === "pending" || result === "rejected") throw new Error(`Fixture intent unexpectedly ${result}`)
  return result
}

export function createAgent(
  document: Y.Doc,
  operationContext: OwnerIntentValidationContext,
  title = `agent-${operationContext.operationId}`,
): CanvasEntityRef & { kind: "node" } {
  const node = derivedNodeRef(operationContext, U0)
  applyOk(document, operationContext, {
    format: "convax.typed-intent",
    kind: "canvas.agent.create",
    guard: { ordinal: U0, node, expectedAbsent: true },
    body: {
      node: {
        ordinal: U0,
        nodeId: node.id,
        incarnation: node.incarnation,
        role: "agent",
        position: { x: 0, y: 0 },
        size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data", kind: "agent", title, instructions: null },
        plugin: null,
      },
    },
  })
  return node
}

export function createPendingFile(
  document: Y.Doc,
  operationContext: OwnerIntentValidationContext,
  title = `file-${operationContext.operationId}`,
): CanvasEntityRef & { kind: "node" } {
  const node = derivedNodeRef(operationContext, U0)
  const base = validateCanvasYDoc(document)
  applyOk(document, operationContext, {
    format: "convax.typed-intent",
    kind: "canvas.resources.pending.create",
    guard: { existingEndpoints: [], derivedNodes: [{ ordinal: U0, node, expectedAbsent: true }], derivedEdges: [] },
    body: {
      placement: { anchor: { x: 0, y: 0 }, gap: 24, obstacleProjectionDigest: obstacleProjectionDigest(base) },
      nodes: [
        {
          ordinal: U0,
          nodeId: node.id,
          incarnation: node.incarnation,
          size: { width: 240, height: 120 },
          title,
          expectedClass: "image",
        },
      ],
      edges: [],
    },
  })
  return node
}

export function nodeDataGuard(document: Y.Doc, node: CanvasEntityRef & { kind: "node" }) {
  const snapshot = validateCanvasYDoc(document)
  const record = snapshot.nodes.get(`node/${node.id}/${node.incarnation}`)!
  return {
    node,
    expectedLive: true as const,
    expectedIdentityDigest: nodeIdentityDigest(record),
    expectedEffectiveDataDigest: effectiveDataDigest(snapshot, record),
    expectedDataRegisterDigest: dataRegisterDigest(record),
  }
}

export function nodeLiveGuard(document: Y.Doc, node: CanvasEntityRef & { kind: "node" }) {
  const record = validateCanvasYDoc(document).nodes.get(`node/${node.id}/${node.incarnation}`)!
  return { node, expectedLive: true as const, expectedIdentityDigest: nodeIdentityDigest(record) }
}

function encoded(seed: number, length: number): string {
  return encodeBase64url(bytes(seed, length))
}

function bytes(seed: number, length: number): Uint8Array {
  const result = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) result[index] = (seed + index * 17) & 0xff
  return result
}
