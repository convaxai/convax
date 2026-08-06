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
import { assertCanvasTypedIntentV2 } from "./intent-validation"
import {
  dataRegisterDigestV2,
  effectiveDataDigestV2,
  nodeIdentityDigestV2,
  obstacleProjectionDigestV2,
} from "./projection"
import { applyCanvasCandidateIntentV2 } from "./reducer"
import type {
  CanvasEntityRefV2,
  CanvasExternalFactContextV2,
  CanvasIntentApplyResultV2,
  CanvasTypedIntentUnionV2,
  Digest,
  DocumentScope,
} from "./types"
import { derivedNodeRefV2 } from "./validation"
import { cloneCanvasYDocV2, createCanvasYDocV2, validateCanvasYDocV2 } from "./ydoc"

export const SCHEMA_DIGEST = parseDigest("cb69352106c9fc61d28c6412b22b7efb453cd7b9db5324946c0d978772c54d36")
export const PROTOCOL_DIGEST = parseDigest("de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5")
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

export const VALID_FACTS: CanvasExternalFactContextV2 = Object.freeze({
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
  return createCanvasYDocV2(
    SCOPE,
    SCHEMA_DIGEST,
    PROTOCOL_DIGEST,
    PROJECT_INDEX_ROUTE_DEPENDENCY_FRAME_DIGEST,
    parseReplicaId("replica_00000001"),
  )
}

export function fork(document: Y.Doc): Y.Doc {
  return cloneCanvasYDocV2(document)
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
  intent: CanvasTypedIntentUnionV2,
  facts: CanvasExternalFactContextV2 = VALID_FACTS,
): CanvasIntentApplyResultV2 {
  assertCanvasTypedIntentV2(intent)
  const result = applyCanvasCandidateIntentV2(document, operationContext, intent, facts)
  if (result === "pending" || result === "rejected") throw new Error(`Fixture intent unexpectedly ${result}`)
  return result
}

export function createAgent(
  document: Y.Doc,
  operationContext: OwnerIntentValidationContext,
  title = `agent-${operationContext.operationId}`,
): CanvasEntityRefV2 & { kind: "node" } {
  const node = derivedNodeRefV2(operationContext, U0)
  applyOk(document, operationContext, {
    format: "convax.typed-intent/2",
    kind: "canvas.nodes.create/2",
    guard: { ordinal: U0, node, expectedAbsent: true },
    body: {
      node: {
        ordinal: U0,
        nodeId: node.id,
        incarnation: node.incarnation,
        role: "agent",
        position: { x: 0, y: 0 },
        size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data/2", kind: "agent", title, instructions: null },
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
): CanvasEntityRefV2 & { kind: "node" } {
  const node = derivedNodeRefV2(operationContext, U0)
  const base = validateCanvasYDocV2(document)
  applyOk(document, operationContext, {
    format: "convax.typed-intent/2",
    kind: "canvas.resources.pending.create/2",
    guard: { existingEndpoints: [], derivedNodes: [{ ordinal: U0, node, expectedAbsent: true }], derivedEdges: [] },
    body: {
      placement: { anchor: { x: 0, y: 0 }, gap: 24, obstacleProjectionDigest: obstacleProjectionDigestV2(base) },
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

export function nodeDataGuard(document: Y.Doc, node: CanvasEntityRefV2 & { kind: "node" }) {
  const snapshot = validateCanvasYDocV2(document)
  const record = snapshot.nodes.get(`node/${node.id}/${node.incarnation}`)!
  return {
    node,
    expectedLive: true as const,
    expectedIdentityDigest: nodeIdentityDigestV2(record),
    expectedEffectiveDataDigest: effectiveDataDigestV2(snapshot, record),
    expectedDataRegisterDigest: dataRegisterDigestV2(record),
  }
}

export function nodeLiveGuard(document: Y.Doc, node: CanvasEntityRefV2 & { kind: "node" }) {
  const record = validateCanvasYDocV2(document).nodes.get(`node/${node.id}/${node.incarnation}`)!
  return { node, expectedLive: true as const, expectedIdentityDigest: nodeIdentityDigestV2(record) }
}

function encoded(seed: number, length: number): string {
  return encodeBase64url(bytes(seed, length))
}

function bytes(seed: number, length: number): Uint8Array {
  const result = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) result[index] = (seed + index * 17) & 0xff
  return result
}
