import {
  assertBoundedNfcString,
  assertDenseArray,
  assertExactKeys,
  comparePortableStamps,
  compareUtf8,
  decodeBase64url,
  documentScopeDigest,
  encodeBase64url,
  encodeRestrictedJcs,
  ordinarySha256,
  ownerCanonicalizerDescriptorDigest,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parsePortableStamp,
  parseUint32,
  parseUint64,
  structuredDigest,
  uint32ToNumber,
} from "@convax/collaboration"
import { canonicalize as canonicalizeUri } from "@convax/uri"
import type {
  ActorId,
  BoundedOperationReceiptV2,
  CanvasActualWriteV2,
  CanvasCanonicalSemanticHistoryValueV2,
  CanvasEdgeDataV2,
  CanvasEdgeIdentityV2,
  CanvasEntityRefV2,
  CanvasGenesisCoreV2,
  CanvasHistoryBindingV2,
  CanvasHistoryNodeSnapshotV2,
  CanvasHistoryNodeTargetV2,
  CanvasHistoryTemplateV2,
  CanvasIdentityV2,
  CanvasNodeIdentityV2,
  CanvasOperationIdV2,
  CanvasPointV2,
  CanvasResourceProofRefV2,
  CanvasResourceRefV2,
  CanvasSizeV2,
  ContainmentChoiceV2,
  CreationGroupRefV2,
  Digest,
  GenerationBeginV2,
  GenerationDismissalV2,
  GenerationRecoveryFailureV2,
  NodeDataEnvelopeV2,
  OwnerGenerationTerminalV2,
  PluginRequirementV2,
  PluginStateEnvelopeV2,
  StampedClaimV2,
  TombstoneFactV2,
  Uint32,
} from "./types"
import type {
  OwnerCanonicalizerDescriptor,
  OwnerIntentConstructionContext,
} from "@convax/collaboration"

export const CANVAS_DIGEST_DOMAINS_V2 = Object.freeze([
  "convax.canvas-actual-write-value/2",
  "convax.canvas-containment-slot/2",
  "convax.canvas-creation-group-member-set/2",
  "convax.canvas-data-register/2",
  "convax.canvas-derived-id/2",
  "convax.canvas-edge-identity/2",
  "convax.canvas-effective-child-set/2",
  "convax.canvas-effective-data/2",
  "convax.canvas-effective-plugin/2",
  "convax.canvas-generation-begin/2",
  "convax.canvas-generation-dismissal/2",
  "convax.canvas-generation-lifecycle/2",
  "convax.canvas-generation-recovery-failure/2",
  "convax.canvas-generation-terminal/2",
  "convax.canvas-genesis-core/2",
  "convax.canvas-geometry/2",
  "convax.canvas-group-geometry-plan/2",
  "convax.canvas-history-footprint/2",
  "convax.canvas-history-material/2",
  "convax.canvas-history-materialization/2",
  "convax.canvas-metadata-effective/2",
  "convax.canvas-metadata-slot/2",
  "convax.canvas-node-identity/2",
  "convax.canvas-obstacle-projection/2",
  "convax.canvas-operation-receipt/2",
  "convax.canvas-projected-generation/2",
  "convax.canvas-semantic-guard/2",
  "convax.canvas-semantic-history-root/2",
  "convax.canvas-semantic-history-state/2",
] as const)

export type CanvasDigestDomainV2 = (typeof CANVAS_DIGEST_DOMAINS_V2)[number]

export class CanvasSchemaErrorV2 extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "CanvasSchemaErrorV2"
  }
}

export function canvasDigestV2(domain: CanvasDigestDomainV2, value: unknown): Digest {
  return structuredDigest(domain, value)
}

export function canvasOwnerCanonicalizerDescriptorV2(ownerSchemaDigest: Digest): OwnerCanonicalizerDescriptor {
  return Object.freeze({
    format: "convax.owner-canonicalizer-descriptor/2",
    owner: "canvas",
    ownerSchemaDigest: parseDigest(ownerSchemaDigest),
    canonicalStateFormat: "convax.canvas-canonical-state/2",
    canonicalStateCodec: "restricted-jcs-utf8",
    exactBytePolicy: "parse-reencode-byte-equal",
    unknownStatePolicy: "reject",
  })
}

export function canvasOwnerCanonicalizerDigestV2(ownerSchemaDigest: Digest): Digest {
  return ownerCanonicalizerDescriptorDigest(canvasOwnerCanonicalizerDescriptorV2(ownerSchemaDigest))
}

export function canvasGenesisCoreV2(identity: Omit<CanvasIdentityV2, "genesisDigest">): CanvasGenesisCoreV2 {
  return {
    format: "convax.canvas-genesis-core/2",
    scopeId: identity.scopeId,
    canvasId: identity.canvasId,
    ownerSchemaDigest: identity.ownerSchemaDigest,
    protocolDigest: identity.protocolDigest,
    canonicalizerDigest: identity.canonicalizerDigest,
    projectIndexRouteDependencyFrameDigest: identity.projectIndexRouteDependencyFrameDigest,
  }
}

export function assertCanvasIdentityV2(
  value: unknown,
  scope?: import("@convax/collaboration").DocumentScope,
): asserts value is CanvasIdentityV2 {
  assertExactKeys(
    value,
    [
      "format",
      "scopeId",
      "canvasId",
      "ownerSchemaDigest",
      "protocolDigest",
      "canonicalizerDigest",
      "projectIndexRouteDependencyFrameDigest",
      "genesisDigest",
    ],
    "CanvasIdentityV2",
  )
  if (value.format !== "convax.canvas.v2") fail("invalid-format", "Canvas identity format is not v2")
  const identity = value as unknown as CanvasIdentityV2
  parseDigest(identity.scopeId)
  parseCanvasId(identity.canvasId)
  parseDigest(identity.ownerSchemaDigest)
  parseDigest(identity.protocolDigest)
  parseDigest(identity.canonicalizerDigest)
  parseDigest(identity.projectIndexRouteDependencyFrameDigest)
  parseDigest(identity.genesisDigest)
  if (identity.canonicalizerDigest !== canvasOwnerCanonicalizerDigestV2(identity.ownerSchemaDigest)) {
    fail("canonicalizer-mismatch", "Canvas identity canonicalizer digest is not the selected owner descriptor")
  }
  if (identity.genesisDigest !== canvasDigestV2("convax.canvas-genesis-core/2", canvasGenesisCoreV2(identity))) {
    fail("genesis-mismatch", "Canvas identity genesis digest is invalid")
  }
  if (scope !== undefined) {
    if (
      scope.docKind !== "canvas" ||
      scope.docId !== identity.canvasId ||
      documentScopeDigest(scope) !== identity.scopeId
    ) {
      fail("scope-mismatch", "Canvas identity is not byte-equal to its outer Canvas document scope")
    }
  }
}

const ENTITY_SUFFIX = /^[A-Za-z0-9_-]{43}$/u
const ENTITY_CODE = Object.freeze({
  node: 1,
  incarnation: 2,
  edge: 3,
  edgeIncarnation: 4,
  generation: 5,
  relation: 6,
  creationGroup: 7,
})

export function assertDerivedIdV2(
  value: unknown,
  prefix: "n_" | "ni_" | "e_" | "ei_" | "g_" | "r_" | "cg_",
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !value.startsWith(prefix) || !ENTITY_SUFFIX.test(value.slice(prefix.length))) {
    fail("invalid-derived-id", `${label} is not a canonical ${prefix} derived id`)
  }
  if (decodeBase64url(value.slice(prefix.length)).byteLength !== 32)
    fail("invalid-derived-id", `${label} has the wrong decoded length`)
}

export function deriveCanvasIdV2(
  kind: "node" | "incarnation" | "edge" | "edgeIncarnation" | "generation" | "relation" | "creationGroup",
  context: OwnerIntentConstructionContext,
  ordinal: Uint32,
): string {
  const scope = hexBytes(documentScopeDigest(context.scope))
  const actor = decodeBase64url(context.actorId)
  const operation = decodeBase64url(context.operationId)
  const number = uint32ToNumber(parseUint32(ordinal))
  const preimagePrefix = new TextEncoder().encode("convax.canvas-derived-id/2\0")
  const preimage = new Uint8Array(preimagePrefix.length + 1 + 32 + 32 + 16 + 4)
  preimage.set(preimagePrefix)
  let offset = preimagePrefix.length
  preimage[offset++] = ENTITY_CODE[kind]
  preimage.set(scope, offset)
  offset += 32
  preimage.set(actor, offset)
  offset += 32
  preimage.set(operation, offset)
  offset += 16
  new DataView(preimage.buffer).setUint32(offset, number, false)
  const encoded = encodeBase64url(hexBytes(ordinarySha256(preimage)))
  const prefix =
    kind === "node"
      ? "n_"
      : kind === "incarnation"
        ? "ni_"
        : kind === "edge"
          ? "e_"
          : kind === "edgeIncarnation"
            ? "ei_"
            : kind === "generation"
              ? "g_"
              : kind === "relation"
                ? "r_"
                : "cg_"
  return `${prefix}${encoded}`
}

export function derivedNodeRefV2(
  context: OwnerIntentConstructionContext,
  ordinal: Uint32,
): CanvasEntityRefV2 & { readonly kind: "node" } {
  return {
    kind: "node",
    id: deriveCanvasIdV2("node", context, ordinal),
    incarnation: deriveCanvasIdV2("incarnation", context, ordinal),
  }
}

export function derivedEdgeRefV2(
  context: OwnerIntentConstructionContext,
  ordinal: Uint32,
): CanvasEntityRefV2 & { readonly kind: "edge" } {
  return {
    kind: "edge",
    id: deriveCanvasIdV2("edge", context, ordinal),
    incarnation: deriveCanvasIdV2("edgeIncarnation", context, ordinal),
  }
}

export function canvasEntityKeyV2(ref: CanvasEntityRefV2): string {
  assertEntityRefV2(ref, ref.kind)
  return `${ref.kind}/${ref.id}/${ref.incarnation}`
}

export function assertEntityRefV2(value: unknown, expectedKind?: "node" | "edge"): asserts value is CanvasEntityRefV2 {
  assertExactKeys(value, ["kind", "id", "incarnation"], "CanvasEntityRefV2")
  if (value.kind !== "node" && value.kind !== "edge") fail("invalid-entity-ref", "Entity kind is invalid")
  if (expectedKind !== undefined && value.kind !== expectedKind)
    fail("invalid-entity-ref", `Expected a ${expectedKind} ref`)
  if (value.kind === "node") {
    assertDerivedIdV2(value.id, "n_", "node id")
    assertDerivedIdV2(value.incarnation, "ni_", "node incarnation")
  } else {
    assertDerivedIdV2(value.id, "e_", "edge id")
    assertDerivedIdV2(value.incarnation, "ei_", "edge incarnation")
  }
}

export function assertPointV2(value: unknown, label = "CanvasPointV2"): asserts value is CanvasPointV2 {
  assertExactKeys(value, ["x", "y"], label)
  assertCoordinate(value.x, `${label}.x`)
  assertCoordinate(value.y, `${label}.y`)
}

export function assertSizeV2(value: unknown, label = "CanvasSizeV2"): asserts value is CanvasSizeV2 {
  assertExactKeys(value, ["width", "height"], label)
  for (const [key, component] of [
    ["width", value.width],
    ["height", value.height],
  ] as const) {
    if (typeof component !== "number" || !Number.isFinite(component) || component <= 0 || component > 1_000_000) {
      fail("invalid-geometry", `${label}.${key} is outside (0,1000000]`)
    }
  }
}

export function assertResourceRefV2(
  value: unknown,
  label = "CanvasResourceRefV2",
): asserts value is CanvasResourceRefV2 {
  assertExactKeys(
    value,
    ["format", "uri", "mediaClass", "mime", "byteLength", "contentDigest", "ownerProofDigest"],
    label,
  )
  if (value.format !== "convax.canvas-resource-ref/2") fail("invalid-format", `${label}.format is invalid`)
  if (typeof value.uri !== "string" || canonicalizeUri(value.uri) !== value.uri)
    fail("invalid-resource", `${label}.uri must be canonical`)
  if (!new Set(["text", "image", "video", "audio", "file"]).has(value.mediaClass as string))
    fail("invalid-resource", `${label}.mediaClass is invalid`)
  assertText(value.mime, 1, 4096, `${label}.mime`)
  parseUint64(value.byteLength)
  parseDigest(value.contentDigest)
  parseDigest(value.ownerProofDigest)
}

export function assertResourceProofV2(
  value: unknown,
  allowRetained: boolean,
): asserts value is CanvasResourceProofRefV2 {
  if (typeof value !== "object" || value === null) fail("invalid-proof", "Resource proof must be an object")
  const mode = (value as { mode?: unknown }).mode
  if (mode === "current-owner-state") {
    assertExactKeys(
      value,
      ["format", "mode", "resource", "ownerProofDigest", "requireCurrentLiveVersion"],
      "current resource proof",
    )
    if (value.format !== "convax.canvas-resource-proof-ref/2" || value.requireCurrentLiveVersion !== true)
      fail("invalid-proof", "Current proof discriminator is invalid")
    assertResourceRefV2(value.resource)
    if (parseDigest(value.ownerProofDigest) !== value.resource.ownerProofDigest)
      fail("invalid-proof", "Current proof digest does not match resource")
    return
  }
  if (mode !== "retained-canvas-history" || !allowRetained)
    fail("invalid-proof", "Retained resource proof is not admitted here")
  assertExactKeys(
    value,
    [
      "format",
      "mode",
      "sourceState",
      "sourceOperationId",
      "sourceNode",
      "sourceDataDigest",
      "resource",
      "requireExactRetainedMaterial",
    ],
    "retained resource proof",
  )
  if (value.format !== "convax.canvas-resource-proof-ref/2" || value.requireExactRetainedMaterial !== true)
    fail("invalid-proof", "Retained proof discriminator is invalid")
  if (
    !new Set(["history-root-pre", "history-root-post", "current-applied-post", "last-history-post"]).has(
      value.sourceState as string,
    )
  )
    fail("invalid-proof", "Retained source state is invalid")
  parseId128(value.sourceOperationId)
  assertEntityRefV2(value.sourceNode, "node")
  parseDigest(value.sourceDataDigest)
  assertResourceRefV2(value.resource)
}

export function assertPluginRequirementV2(
  value: unknown,
  label = "PluginRequirementV2",
): asserts value is PluginRequirementV2 {
  assertExactKeys(value, ["pluginId", "snapshotDigest", "pluginStateSchemaDigest", "validationArtifact"], label)
  assertText(value.pluginId, 1, 4096, `${label}.pluginId`)
  parseDigest(value.snapshotDigest)
  parseDigest(value.pluginStateSchemaDigest)
  assertExactKeys(value.validationArtifact, ["owner", "format", "artifactDigest"], `${label}.validationArtifact`)
  if (value.validationArtifact.owner !== "plugin") fail("invalid-plugin", `${label}.validationArtifact.owner must be plugin`)
  assertText(value.validationArtifact.format, 1, 4096, `${label}.validationArtifact.format`)
  parseDigest(value.validationArtifact.artifactDigest)
}

export function assertPluginStateV2(
  value: unknown,
  label = "PluginStateEnvelopeV2",
): asserts value is PluginStateEnvelopeV2 {
  assertExactKeys(
    value,
    ["format", "pluginId", "snapshotDigest", "pluginStateSchemaDigest", "validationArtifact", "state"],
    label,
  )
  if (value.format !== "convax.canvas-plugin-state/2") fail("invalid-format", `${label}.format is invalid`)
  assertPluginRequirementV2({
    pluginId: value.pluginId,
    snapshotDigest: value.snapshotDigest,
    pluginStateSchemaDigest: value.pluginStateSchemaDigest,
    validationArtifact: value.validationArtifact,
  })
  assertJsonBound(value.state, 32, 4096, 256 * 1024, `${label}.state`)
}

export function assertNodeDataV2(value: unknown, label = "NodeDataEnvelopeV2"): asserts value is NodeDataEnvelopeV2 {
  if (typeof value !== "object" || value === null) fail("invalid-node-data", `${label} must be an object`)
  const candidate = value as Record<string, unknown>
  if (candidate.format !== "convax.canvas-node-data/2") fail("invalid-format", `${label}.format is invalid`)
  if (candidate.kind === "agent") {
    assertExactKeys(value, ["format", "kind", "title", "instructions"], label)
    assertText(value.title, 0, 4096, `${label}.title`)
    if (value.instructions !== null) assertText(value.instructions, 0, 64 * 1024, `${label}.instructions`)
  } else if (candidate.kind === "group") {
    assertExactKeys(value, ["format", "kind", "title"], label)
    assertText(value.title, 0, 4096, `${label}.title`)
  } else if (candidate.kind === "resource") {
    assertExactKeys(value, ["format", "kind", "title", "resource"], label)
    assertText(value.title, 0, 4096, `${label}.title`)
    assertResourceRefV2(value.resource)
  } else if (candidate.kind === "placeholder" && candidate.owner === "generation") {
    assertExactKeys(value, ["format", "kind", "owner", "title", "expectedClass"], label)
    assertText(value.title, 0, 4096, `${label}.title`)
    assertMediaClass(value.expectedClass, `${label}.expectedClass`)
  } else if (candidate.kind === "placeholder" && candidate.owner === "manual-pending") {
    assertExactKeys(value, ["format", "kind", "owner", "title", "expectedClass", "state"], label)
    assertText(value.title, 0, 4096, `${label}.title`)
    assertMediaClass(value.expectedClass, `${label}.expectedClass`)
    if (typeof value.state !== "object" || value.state === null) fail("invalid-node-data", `${label}.state is invalid`)
    if ((value.state as { phase?: unknown }).phase === "pending")
      assertExactKeys(value.state, ["phase"], `${label}.state`)
    else {
      assertExactKeys(value.state, ["phase", "failureCode", "publicMessage"], `${label}.state`)
      if (value.state.phase !== "failed") fail("invalid-node-data", `${label}.state phase is invalid`)
      assertText(value.state.failureCode, 1, 4096, `${label}.failureCode`)
      if (value.state.publicMessage !== null) assertText(value.state.publicMessage, 0, 4096, `${label}.publicMessage`)
    }
  } else fail("invalid-node-data", `${label}.kind/owner is invalid`)
  if (encodeRestrictedJcs(value).byteLength > 64 * 1024) fail("value-too-large", `${label} exceeds 64 KiB`)
}

export function assertEdgeDataV2(value: unknown): asserts value is CanvasEdgeDataV2 {
  assertExactKeys(value, ["format", "kind", "label"], "CanvasEdgeDataV2")
  if (value.format !== "convax.canvas-edge-data/2" || value.kind !== "business")
    fail("invalid-edge-data", "Edge data discriminator is invalid")
  if (value.label !== null) assertText(value.label, 0, 4096, "edge label")
}

export function assertNodeIdentityV2(value: unknown): asserts value is CanvasNodeIdentityV2 {
  assertExactKeys(value, ["format", "ref", "role", "createdBy"], "CanvasNodeIdentityV2")
  if (value.format !== "convax.canvas-node-identity/2" || (value.role !== "file" && value.role !== "agent"))
    fail("invalid-node-identity", "Node identity is invalid")
  assertEntityRefV2(value.ref, "node")
  parseId128(value.createdBy)
}

export function assertEdgeIdentityV2(value: unknown): asserts value is CanvasEdgeIdentityV2 {
  assertExactKeys(value, ["format", "ref", "source", "target", "createdBy"], "CanvasEdgeIdentityV2")
  if (value.format !== "convax.canvas-edge-identity/2") fail("invalid-edge-identity", "Edge identity format is invalid")
  assertEntityRefV2(value.ref, "edge")
  assertEntityRefV2(value.source, "node")
  assertEntityRefV2(value.target, "node")
  parseId128(value.createdBy)
}

export function assertStampedClaimV2<T>(
  value: unknown,
  validate: (input: unknown) => asserts input is T,
): asserts value is StampedClaimV2<T> {
  assertExactKeys(value, ["format", "stamp", "value"], "StampedClaimV2")
  if (value.format !== "convax.canvas-stamped-claim/2") fail("invalid-format", "Stamped claim format is invalid")
  parsePortableStamp(value.stamp)
  validate(value.value)
}

export function assertTombstoneV2(value: unknown, ownerRef?: CanvasEntityRefV2): asserts value is TombstoneFactV2 {
  assertExactKeys(value, ["format", "entity", "stamp"], "TombstoneFactV2")
  if (value.format !== "convax.canvas-tombstone/2") fail("invalid-format", "Tombstone format is invalid")
  assertEntityRefV2(value.entity)
  parsePortableStamp(value.stamp)
  if (ownerRef !== undefined && canvasEntityKeyV2(value.entity) !== canvasEntityKeyV2(ownerRef))
    fail("tombstone-owner-mismatch", "Tombstone entity does not match record")
}

export function assertContainmentChoiceV2(value: unknown): asserts value is ContainmentChoiceV2 {
  assertExactKeys(value, ["format", "relationId", "child", "parent", "stamp"], "ContainmentChoiceV2")
  if (value.format !== "convax.canvas-containment-choice/2") fail("invalid-format", "Containment format is invalid")
  assertDerivedIdV2(value.relationId, "r_", "relationId")
  assertEntityRefV2(value.child, "node")
  if (value.parent !== null) assertEntityRefV2(value.parent, "node")
  parsePortableStamp(value.stamp)
}

export function assertCreationGroupV2(value: unknown): asserts value is CreationGroupRefV2 {
  assertExactKeys(
    value,
    ["format", "groupId", "source", "sourceDataDigest", "plugin", "memberSetDigest"],
    "CreationGroupRefV2",
  )
  if (value.format !== "convax.canvas-creation-group-ref/2") fail("invalid-format", "Creation-group format is invalid")
  assertDerivedIdV2(value.groupId, "cg_", "creation group id")
  assertEntityRefV2(value.source, "node")
  parseDigest(value.sourceDataDigest)
  assertPluginRequirementV2(value.plugin)
  parseDigest(value.memberSetDigest)
}

export function assertGenerationBeginV2(value: unknown): asserts value is GenerationBeginV2 {
  assertExactKeys(
    value,
    [
      "format",
      "generationId",
      "node",
      "beginActorId",
      "beginAuthorizationEpochDigest",
      "beginStamp",
      "outputClaimStamp",
      "toolRefDigest",
      "prompt",
      "targetEffectiveDataDigest",
      "targetPluginDigest",
    ],
    "GenerationBeginV2",
  )
  if (value.format !== "convax.canvas-generation-begin/2") fail("invalid-format", "Generation begin format is invalid")
  assertDerivedIdV2(value.generationId, "g_", "generation id")
  assertEntityRefV2(value.node, "node")
  parseActorId(value.beginActorId)
  parseDigest(value.beginAuthorizationEpochDigest)
  const begin = parsePortableStamp(value.beginStamp)
  const output = parsePortableStamp(value.outputClaimStamp)
  if (begin.actorId !== value.beginActorId || output.actorId !== value.beginActorId)
    fail("generation-actor-mismatch", "Generation stamps do not match begin actor")
  parseDigest(value.toolRefDigest)
  assertText(value.prompt, 0, 64 * 1024, "generation prompt")
  parseDigest(value.targetEffectiveDataDigest)
  if (value.targetPluginDigest !== null) parseDigest(value.targetPluginDigest)
}

export function assertGenerationTerminalV2(value: unknown): asserts value is OwnerGenerationTerminalV2 {
  if (typeof value !== "object" || value === null) fail("invalid-terminal", "Generation terminal must be an object")
  if ((value as { phase?: unknown }).phase === "succeeded") {
    assertExactKeys(
      value,
      ["format", "phase", "generationId", "node", "beginDigest", "beginActorId", "outputData", "outputProofDigest"],
      "succeeded terminal",
    )
    if (value.format !== "convax.canvas-generation-terminal/2") fail("invalid-format", "Terminal format is invalid")
    assertNodeDataV2(value.outputData)
    if (value.outputData.kind !== "resource")
      fail("invalid-terminal", "Succeeded terminal output must be resource data")
    parseDigest(value.outputProofDigest)
  } else {
    assertExactKeys(
      value,
      ["format", "phase", "generationId", "node", "beginDigest", "beginActorId", "failureCode", "publicMessage"],
      "failed terminal",
    )
    if (value.format !== "convax.canvas-generation-terminal/2" || value.phase !== "failed")
      fail("invalid-terminal", "Terminal phase is invalid")
    assertText(value.failureCode, 1, 4096, "failureCode")
    if (value.publicMessage !== null) assertText(value.publicMessage, 0, 4096, "publicMessage")
  }
  assertDerivedIdV2(value.generationId, "g_", "generation id")
  assertEntityRefV2(value.node, "node")
  parseDigest(value.beginDigest)
  parseActorId(value.beginActorId)
}

export function assertGenerationDismissalV2(value: unknown): asserts value is GenerationDismissalV2 {
  assertExactKeys(value, ["format", "generationId", "beginDigest", "marker"], "GenerationDismissalV2")
  if (value.format !== "convax.canvas-generation-dismissal/2" || value.marker !== "dismissed")
    fail("invalid-dismissal", "Generation dismissal is invalid")
  assertDerivedIdV2(value.generationId, "g_", "generation id")
  parseDigest(value.beginDigest)
}

export function assertGenerationRecoveryFailureV2(value: unknown): asserts value is GenerationRecoveryFailureV2 {
  assertExactKeys(
    value,
    ["format", "generationId", "beginDigest", "proofDigest", "failureCode"],
    "GenerationRecoveryFailureV2",
  )
  if (
    value.format !== "convax.canvas-generation-recovery-failure/2" ||
    value.failureCode !== "generation-owner-unavailable"
  )
    fail("invalid-recovery", "Generation recovery failure is invalid")
  assertDerivedIdV2(value.generationId, "g_", "generation id")
  parseDigest(value.beginDigest)
  parseDigest(value.proofDigest)
}

export function assertOperationReceiptV2(value: unknown): asserts value is BoundedOperationReceiptV2 {
  assertExactKeys(
    value,
    [
      "format",
      "operationId",
      "actorId",
      "intentKind",
      "intentDigest",
      "baseFrontierDigest",
      "resultEntities",
      "semanticRoot",
      "historyMaterialDigest",
    ],
    "BoundedOperationReceiptV2",
  )
  if (value.format !== "convax.canvas-operation-receipt/2")
    fail("invalid-format", "Operation receipt format is invalid")
  parseId128(value.operationId)
  parseActorId(value.actorId)
  parseDigest(value.intentDigest)
  parseDigest(value.baseFrontierDigest)
  assertDenseArray(value.resultEntities, "resultEntities")
  let prior: string | undefined
  for (const ref of value.resultEntities) {
    assertEntityRefV2(ref)
    const key = canvasEntityKeyV2(ref)
    if (prior !== undefined && compareUtf8(prior, key) >= 0)
      fail("invalid-set-order", "Result entities are not sorted unique")
    prior = key
  }
  if (typeof value.semanticRoot !== "boolean") fail("invalid-receipt", "semanticRoot must be boolean")
  if (value.historyMaterialDigest !== null) parseDigest(value.historyMaterialDigest)
  if (value.semanticRoot !== (value.historyMaterialDigest !== null))
    fail("invalid-receipt", "History digest presence disagrees with semanticRoot")
}

export function assertSemanticHistoryValueV2(value: unknown): asserts value is CanvasCanonicalSemanticHistoryValueV2 {
  if (typeof value !== "object" || value === null) fail("invalid-history", "History value must be an object")
  const format = (value as { format?: unknown }).format
  if (format === "convax.canvas-semantic-history-root/2") {
    assertExactKeys(
      value,
      [
        "format",
        "rootOperationId",
        "sourceIntentKind",
        "sourceIntentDigest",
        "initialBindings",
        "inverseTemplate",
        "forwardTemplate",
        "retainedResources",
        "materialDigest",
      ],
      "SemanticHistoryRootV2",
    )
    parseId128(value.rootOperationId)
    parseDigest(value.sourceIntentDigest)
    parseDigest(value.materialDigest)
    if (!UNDOABLE_INTENT_KINDS.has(value.sourceIntentKind as string))
      fail("invalid-history", "History root source intent is not one of the 14 undoable families")
    assertDenseArray(value.initialBindings, "history initialBindings")
    assertHistoryBindingsV2(value.initialBindings)
    assertDenseArray(value.inverseTemplate, "history inverseTemplate")
    assertDenseArray(value.forwardTemplate, "history forwardTemplate")
    for (const template of value.inverseTemplate) assertHistoryTemplateV2(template)
    for (const template of value.forwardTemplate) assertHistoryTemplateV2(template)
    if (value.inverseTemplate.length === 0 || value.forwardTemplate.length === 0)
      fail("invalid-history", "Both history directions must be non-empty")
    assertDenseArray(value.retainedResources, "history retainedResources")
    assertSortedRetainedResources(value.retainedResources)
    const core = {
      format: "convax.canvas-history-material/2",
      rootOperationId: value.rootOperationId,
      sourceIntentKind: value.sourceIntentKind,
      sourceIntentDigest: value.sourceIntentDigest,
      initialBindings: value.initialBindings,
      inverseTemplate: value.inverseTemplate,
      forwardTemplate: value.forwardTemplate,
      retainedResources: value.retainedResources,
    }
    if (value.materialDigest !== canvasDigestV2("convax.canvas-history-material/2", core))
      fail("invalid-history", "History material digest is invalid")
    return
  }
  if (format === "convax.canvas-semantic-history-transition/2") {
    assertExactKeys(
      value,
      [
        "format",
        "rootOperationId",
        "mode",
        "priorHistoryDigest",
        "transitionOperationId",
        "stamp",
        "materializationDigest",
        "resultFootprintDigest",
        "resultBindings",
      ],
      "SemanticHistoryTransitionV2",
    )
    parseId128(value.rootOperationId)
    parseId128(value.transitionOperationId)
    parsePortableStamp(value.stamp)
    parseDigest(value.priorHistoryDigest)
    parseDigest(value.materializationDigest)
    parseDigest(value.resultFootprintDigest)
    if (value.mode !== "undone" && value.mode !== "redone") fail("invalid-history", "Transition mode is invalid")
    assertDenseArray(value.resultBindings, "history resultBindings")
    assertHistoryBindingsV2(value.resultBindings)
    return
  }
  fail("invalid-history", "Unknown semantic history format")
}

const UNDOABLE_INTENT_KINDS = new Set([
  "canvas.nodes.create/2",
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
  "canvas.plugin.creation-group.create/2",
])

export function assertHistoryTemplateV2(value: unknown): asserts value is CanvasHistoryTemplateV2 {
  if (typeof value !== "object" || value === null) fail("invalid-history", "History template must be an object")
  const op = (value as { op?: unknown }).op
  switch (op) {
    case "node.create":
      assertExactKeys(value, ["op", "handle", "snapshot"], "history node.create")
      assertHistoryHandle(value.handle, "node")
      assertHistoryNodeSnapshot(value.snapshot)
      return
    case "node.tombstone":
      assertExactKeys(value, ["op", "handle"], "history node.tombstone")
      assertHistoryHandle(value.handle, "node")
      return
    case "node.geometry":
      assertExactKeys(value, ["op", "handle", "position", "size"], "history node.geometry")
      assertHistoryHandle(value.handle, "node")
      assertPointV2(value.position)
      assertSizeV2(value.size)
      return
    case "node.data":
      assertExactKeys(value, ["op", "handle", "data", "resource"], "history node.data")
      assertHistoryHandle(value.handle, "node")
      assertNodeDataV2(value.data)
      if (value.resource !== null) assertResourceRefV2(value.resource)
      if (
        value.data.kind === "resource"
          ? !sameCanonicalValueV2(value.resource, value.data.resource)
          : value.resource !== null
      )
        fail("invalid-history", "History node.data resource does not match data")
      return
    case "node.plugin":
      assertExactKeys(value, ["op", "handle", "plugin"], "history node.plugin")
      assertHistoryHandle(value.handle, "node")
      if (value.plugin !== null) assertPluginStateV2(value.plugin)
      return
    case "edge.create":
      assertExactKeys(value, ["op", "handle", "snapshot"], "history edge.create")
      assertHistoryHandle(value.handle, "edge")
      assertHistoryEdgeSnapshot(value.snapshot)
      return
    case "edge.tombstone":
      assertExactKeys(value, ["op", "handle"], "history edge.tombstone")
      assertHistoryHandle(value.handle, "edge")
      return
    case "containment.set":
      assertExactKeys(value, ["op", "child", "parent"], "history containment.set")
      assertHistoryTarget(value.child)
      if (value.parent !== null) assertHistoryTarget(value.parent)
      return
    case "metadata.set":
      assertExactKeys(value, ["op", "field", "value"], "history metadata.set")
      if (value.field !== "title" && value.field !== "description" && value.field !== "tags")
        fail("invalid-history", "History metadata field is invalid")
      if (value.field === "tags") assertHistoryTags(value.value)
      else if (value.value !== null) assertText(value.value, 0, 64 * 1024, "history metadata value")
      return
    case "creation-group.restore":
      assertExactKeys(
        value,
        ["op", "groupHandle", "source", "sourceDataDigest", "plugin", "nodes", "edges"],
        "history creation-group.restore",
      )
      assertGroupHandle(value.groupHandle)
      assertHistoryTarget(value.source)
      parseDigest(value.sourceDataDigest)
      assertPluginRequirementV2(value.plugin)
      assertDenseArray(value.nodes, "history creation-group nodes")
      assertDenseArray(value.edges, "history creation-group edges")
      if (value.nodes.length + value.edges.length === 0)
        fail("invalid-history", "History creation group must contain a member")
      assertSortedHistoryMembers(value.nodes, "node")
      assertSortedHistoryMembers(value.edges, "edge")
      for (const item of value.nodes as readonly { readonly snapshot: unknown }[])
        assertHistoryNodeSnapshot(item.snapshot)
      for (const item of value.edges as readonly { readonly snapshot: unknown }[])
        assertHistoryEdgeSnapshot(item.snapshot)
      return
    case "pending-generation.restore":
      assertExactKeys(
        value,
        ["op", "node", "edges", "generationId", "fallbackTitle", "expectedClass", "position", "size"],
        "history pending-generation.restore",
      )
      assertHistoryHandle(value.node, "node")
      assertDenseArray(value.edges, "history pending generation edges")
      assertSortedHistoryMembers(value.edges, "edge")
      for (const item of value.edges as readonly { readonly snapshot: unknown }[])
        assertHistoryEdgeSnapshot(item.snapshot)
      assertDerivedIdV2(value.generationId, "g_", "generation id")
      assertText(value.fallbackTitle, 0, 4096, "fallback title")
      assertMediaClass(value.expectedClass, "expectedClass")
      assertPointV2(value.position)
      assertSizeV2(value.size)
      return
    default:
      fail("invalid-history", "Unknown history template operation")
  }
}

function assertHistoryBindingsV2(bindings: readonly unknown[]): void {
  let prior: string | undefined
  for (const value of bindings) {
    assertExactKeys(value, ["handle", "ref"], "CanvasHistoryBindingV2")
    const binding = value as unknown as CanvasHistoryBindingV2
    assertHistoryHandle(binding.handle)
    if (binding.ref !== null) {
      assertEntityRefV2(binding.ref)
      if (binding.handle.startsWith("n/") !== (binding.ref.kind === "node"))
        fail("invalid-history", "History binding handle/ref kinds disagree")
    }
    if (prior !== undefined && compareUtf8(prior, binding.handle) >= 0)
      fail("invalid-history", "History bindings must be handle-sorted and duplicate-free")
    prior = binding.handle
  }
}

function assertHistoryTarget(value: unknown): asserts value is CanvasHistoryNodeTargetV2 {
  if (typeof value !== "object" || value === null) fail("invalid-history", "History target must be an object")
  if ((value as { mode?: unknown }).mode === "handle") {
    assertExactKeys(value, ["mode", "handle"], "history handle target")
    assertHistoryHandle(value.handle, "node")
    return
  }
  assertExactKeys(value, ["mode", "ref"], "history external target")
  if (value.mode !== "external") fail("invalid-history", "History target mode is invalid")
  assertEntityRefV2(value.ref, "node")
}

function assertHistoryNodeSnapshot(value: unknown): asserts value is CanvasHistoryNodeSnapshotV2 {
  assertExactKeys(value, ["role", "position", "size", "data", "plugin", "resource"], "CanvasHistoryNodeSnapshotV2")
  if (value.role !== "file" && value.role !== "agent") fail("invalid-history", "History node role is invalid")
  assertPointV2(value.position)
  assertSizeV2(value.size)
  assertNodeDataV2(value.data)
  if (value.role === "agent" ? value.data.kind !== "agent" : value.data.kind === "agent")
    fail("invalid-history", "History node role/data disagree")
  if (value.plugin !== null) assertPluginStateV2(value.plugin)
  if (value.resource !== null) assertResourceRefV2(value.resource)
  if (
    value.data.kind === "resource"
      ? !sameCanonicalValueV2(value.resource, value.data.resource)
      : value.resource !== null
  )
    fail("invalid-history", "History node resource does not match data")
}

function assertHistoryEdgeSnapshot(value: unknown): void {
  assertExactKeys(value, ["source", "target", "data"], "CanvasHistoryEdgeSnapshotV2")
  assertHistoryTarget(value.source)
  assertHistoryTarget(value.target)
  assertEdgeDataV2(value.data)
}

function assertSortedHistoryMembers(values: readonly unknown[], kind: "node" | "edge"): void {
  let prior: string | undefined
  for (const value of values) {
    assertExactKeys(value, ["handle", "snapshot"], `history ${kind} member`)
    assertHistoryHandle(value.handle, kind)
    if (prior !== undefined && compareUtf8(prior, value.handle) >= 0)
      fail("invalid-history", "History members must be handle-sorted and duplicate-free")
    prior = value.handle
  }
}

function assertSortedRetainedResources(resources: readonly unknown[]): void {
  let prior: CanvasResourceRefV2 | undefined
  for (const resource of resources) {
    assertResourceRefV2(resource)
    if (prior !== undefined) {
      const order =
        compareUtf8(prior.contentDigest, resource.contentDigest) ||
        compareUtf8(prior.uri, resource.uri) ||
        compareUtf8(
          new TextDecoder().decode(encodeRestrictedJcs(prior)),
          new TextDecoder().decode(encodeRestrictedJcs(resource)),
        )
      if (order >= 0) fail("invalid-history", "Retained resources must be sorted and complete-value unique")
      if (prior.contentDigest === resource.contentDigest && !sameCanonicalValueV2(prior, resource))
        fail("invalid-history", "Retained resource digest collision has unequal refs")
    }
    prior = resource
  }
}

function assertHistoryHandle(value: unknown, expected?: "node" | "edge"): asserts value is string {
  if (typeof value !== "string" || !/^[ne]\/(0|[1-9]\d*)$/u.test(value))
    fail("invalid-history", "History handle is invalid")
  parseUint32(value.slice(2))
  if ((expected === "node" && !value.startsWith("n/")) || (expected === "edge" && !value.startsWith("e/")))
    fail("invalid-history", "History handle kind is invalid")
}

function assertGroupHandle(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^g\/(0|[1-9]\d*)$/u.test(value))
    fail("invalid-history", "History creation-group handle is invalid")
  parseUint32(value.slice(2))
}

function assertHistoryTags(value: unknown): void {
  if (!Array.isArray(value)) fail("invalid-history", "History tags must be an array")
  let prior: string | undefined
  for (const tag of value) {
    assertText(tag, 0, 256, "history tag")
    if (prior !== undefined && compareUtf8(prior, tag) >= 0)
      fail("invalid-history", "History tags must be sorted and unique")
    prior = tag
  }
}

export function operationKeyV2(actorId: ActorId, operationId: CanvasOperationIdV2): string {
  return `operation/${parseActorId(actorId)}/${parseId128(operationId)}`
}

export function historyRootKeyV2(operationId: CanvasOperationIdV2): string {
  return `root/${parseId128(operationId)}`
}

export function historyTransitionKeyV2(
  root: CanvasOperationIdV2,
  actor: ActorId,
  operation: CanvasOperationIdV2,
): string {
  return `transition/${parseId128(root)}/actor/${parseActorId(actor)}/operation/${parseId128(operation)}`
}

export function containmentKeyV2(child: CanvasEntityRefV2 & { readonly kind: "node" }, actorId: ActorId): string {
  return `${canvasEntityKeyV2(child)}/actor/${parseActorId(actorId)}`
}

export function compareClaimsV2<T>(left: StampedClaimV2<T>, right: StampedClaimV2<T>): number {
  return comparePortableStamps(left.stamp, right.stamp)
}

export function maxClaimV2<T>(claims: readonly StampedClaimV2<T>[]): StampedClaimV2<T> | null {
  let winner: StampedClaimV2<T> | null = null
  for (const claim of claims) if (winner === null || compareClaimsV2(winner, claim) < 0) winner = claim
  return winner
}

export function makeStampV2(
  context: OwnerIntentConstructionContext,
  writeOrdinal: Uint32,
): import("@convax/collaboration").PortableStamp {
  return {
    format: "convax.portable-stamp/2",
    lamport: context.lamport,
    actorId: context.actorId,
    operationId: context.operationId,
    writeOrdinal: parseUint32(writeOrdinal),
  }
}

export function actualWriteValueDigestV2(
  path: string,
  write: Omit<CanvasActualWriteV2, "valueDigest">,
  value: unknown,
): Digest {
  const stored = value === null ? { presence: "present-null", value: null } : { presence: "present-value", value }
  return canvasDigestV2("convax.canvas-actual-write-value/2", {
    format: "convax.canvas-actual-write-value/2",
    path,
    entityKind: write.entityKind,
    entityId: write.entityId,
    field: write.field,
    value: stored,
  })
}

export function strictSortedUnique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  let previous: string | undefined
  for (const value of values) {
    const current = key(value)
    if (previous !== undefined && compareUtf8(previous, current) >= 0)
      fail("invalid-set-order", `${label} must be UTF-8 sorted and duplicate-free`)
    previous = current
  }
}

export function sameCanonicalValueV2(left: unknown, right: unknown): boolean {
  const a = encodeRestrictedJcs(left)
  const b = encodeRestrictedJcs(right)
  if (a.length !== b.length) return false
  return a.every((byte, index) => byte === b[index])
}

function assertCoordinate(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -10_000_000 || value > 10_000_000)
    fail("invalid-geometry", `${label} is outside Canvas bounds`)
}

function assertMediaClass(value: unknown, label: string): void {
  if (!new Set(["text", "image", "video", "audio", "file"]).has(value as string))
    fail("invalid-node-data", `${label} is invalid`)
}

function assertText(value: unknown, minimum: number, maximum: number, label: string): asserts value is string {
  assertBoundedNfcString(value, minimum, maximum, label)
}

function assertJsonBound(
  value: unknown,
  maximumDepth: number,
  maximumValues: number,
  maximumBytes: number,
  label: string,
): void {
  let values = 0
  const visit = (input: unknown, depth: number): void => {
    values += 1
    if (values > maximumValues || depth > maximumDepth) fail("value-too-large", `${label} exceeds structural bounds`)
    if (Array.isArray(input)) for (const item of input) visit(item, depth + 1)
    else if (typeof input === "object" && input !== null)
      for (const item of Object.values(input)) visit(item, depth + 1)
  }
  visit(value, 0)
  if (encodeRestrictedJcs(value).byteLength > maximumBytes) fail("value-too-large", `${label} exceeds encoded bounds`)
}

function hexBytes(value: Digest | string): Uint8Array {
  const digest = parseDigest(value)
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index += 1) bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

function fail(code: string, message: string): never {
  throw new CanvasSchemaErrorV2(code, message)
}

if (
  CANVAS_DIGEST_DOMAINS_V2.length !== 29 ||
  [...CANVAS_DIGEST_DOMAINS_V2].sort(compareUtf8).some((domain, index) => domain !== CANVAS_DIGEST_DOMAINS_V2[index])
) {
  throw new Error("Canvas R5 digest ledger is not the exact sorted 29-domain set")
}
