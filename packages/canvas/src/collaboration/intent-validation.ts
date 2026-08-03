import {
  assertDenseArrayV2,
  assertExactKeysV2,
  compareUtf8V2,
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  parseDigestV2,
  parseId128V2,
  parseUint32V2,
} from "@convax/collaboration"
import type {
  CanvasHistoryDerivedObjectV2,
  CanvasHistoryTemplateV2,
  CanvasIntentKindV2,
  CanvasResourceRefV2,
  CanvasSemanticOperationV2,
  CanvasTypedIntentUnionV2,
  ConnectableNodeGuardV2,
  DerivedEdgeAbsentGuardV2,
  DerivedNodeAbsentGuardV2,
  EdgeCreateTemplateV2,
  EdgeLiveGuardV2,
  GeometryGuardV2,
  NodeCreateTemplateV2,
  NodeDataGuardV2,
  NodeLiveGuardV2,
  SemanticHistoryGuardV2,
} from "./types"
import {
  assertContainmentChoiceV2,
  assertDerivedIdV2,
  assertEdgeDataV2,
  assertEntityRefV2,
  assertGenerationBeginV2,
  assertGenerationDismissalV2,
  assertGenerationRecoveryFailureV2,
  assertGenerationTerminalV2,
  assertHistoryTemplateV2,
  assertNodeDataV2,
  assertPluginRequirementV2,
  assertPluginStateV2,
  assertPointV2,
  assertResourceProofV2,
  assertResourceRefV2,
  assertSizeV2,
  canvasDigestV2,
  CanvasSchemaErrorV2,
} from "./validation"

export const CANVAS_INTENT_KINDS_V2 = Object.freeze([
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
  "canvas.generation.begin/2",
  "canvas.generation.complete/2",
  "canvas.generation.fail/2",
  "canvas.generations.fail-owned/2",
  "canvas.generation.dismiss/2",
  "canvas.generation.fail-recovery/2",
  "canvas.plugin.creation-group.create/2",
  "canvas.undo.semantic-inverse/2",
  "canvas.redo.semantic-forward/2",
] as const satisfies readonly CanvasIntentKindV2[])

const INTENT_KIND_SET = new Set<string>(CANVAS_INTENT_KINDS_V2)

export function decodeCanvasTypedIntentV2(bytes: Uint8Array): CanvasTypedIntentUnionV2 {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 512 * 1024)
    throw new CanvasSchemaErrorV2("intent-too-large", "Canvas typed intent exceeds 512 KiB")
  const value = decodeRestrictedJcsV2(bytes)
  assertCanvasTypedIntentV2(value)
  if (encodeRestrictedJcsV2(value.guard).byteLength > 256 * 1024)
    throw new CanvasSchemaErrorV2("guard-too-large", "Canvas intent guard exceeds 256 KiB")
  return value
}

export function assertCanvasTypedIntentV2(value: unknown): asserts value is CanvasTypedIntentUnionV2 {
  assertExactKeysV2(value, ["format", "kind", "guard", "body"], "CanvasTypedIntentV2")
  if (value.format !== "convax.typed-intent/2" || typeof value.kind !== "string" || !INTENT_KIND_SET.has(value.kind)) {
    throw new CanvasSchemaErrorV2("unknown-intent", "Canvas typed-intent discriminator is not in the closed /2 union")
  }
  switch (value.kind as CanvasIntentKindV2) {
    case "canvas.nodes.create/2":
      assertDerivedNodeGuard(value.guard)
      assertExactKeysV2(value.body, ["node"], "nodes.create body")
      assertNodeTemplate(value.body.node)
      return
    case "canvas.resources.add/2":
      assertCreateSetGuard(value.guard, true)
      assertExactKeysV2(value.body, ["placement", "nodes", "edges"], "resources.add body")
      assertPlacement(value.body.placement)
      assertArray(value.body.nodes, assertResourceNode)
      assertArray(value.body.edges, assertEdgeTemplate)
      return
    case "canvas.resources.pending.create/2":
      assertCreateSetGuard(value.guard, false)
      assertExactKeysV2(value.body, ["placement", "nodes", "edges"], "pending.create body")
      assertPlacement(value.body.placement)
      assertArray(value.body.nodes, assertPendingNode)
      assertArray(value.body.edges, assertEdgeTemplate)
      return
    case "canvas.resources.pending-generation.create/2":
      assertExactKeysV2(value.guard, ["existingEndpoints", "derivedNode", "derivedEdges"], "pending-generation guard")
      assertArray(value.guard.existingEndpoints, assertConnectableGuard)
      assertDerivedNodeGuard(value.guard.derivedNode)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      assertExactKeysV2(value.body, ["placement", "node", "edges", "begin"], "pending-generation body")
      assertPlacement(value.body.placement)
      assertPendingNode(value.body.node)
      assertArray(value.body.edges, assertEdgeTemplate)
      assertGenerationBeginV2(value.body.begin)
      return
    case "canvas.elements.remove/2":
      assertExactKeysV2(value.guard, ["nodes", "edges", "requireObservedIncidentEdgeClosure"], "remove guard")
      if (value.guard.requireObservedIncidentEdgeClosure !== true)
        invalid("remove guard must require incident edge closure")
      assertArray(value.guard.nodes, assertNodeLiveGuard)
      assertArray(value.guard.edges, assertEdgeLiveGuard)
      assertExactKeysV2(value.body, ["nodes", "edges"], "remove body")
      assertArray(value.body.nodes, (item) => assertEntityRefV2(item, "node"))
      assertArray(value.body.edges, (item) => assertEntityRefV2(item, "edge"))
      return
    case "canvas.nodes.set-geometry/2":
      assertExactKeysV2(value.guard, ["nodes"], "geometry guard")
      assertArray(value.guard.nodes, assertGeometryGuard)
      assertExactKeysV2(value.body, ["updates"], "geometry body")
      assertArray(value.body.updates, (item) => {
        assertExactKeysV2(item, ["node", "position", "size"], "geometry update")
        assertEntityRefV2(item.node, "node")
        assertPointV2(item.position)
        if (item.size !== null) assertSizeV2(item.size)
      })
      return
    case "canvas.nodes.update-data/2":
      assertExactKeysV2(value.guard, ["node", "resourceProof"], "update-data guard")
      assertNodeDataGuard(value.guard.node)
      if (value.guard.resourceProof !== null) assertResourceProofV2(value.guard.resourceProof, false)
      assertExactKeysV2(value.body, ["node", "data"], "update-data body")
      assertEntityRefV2(value.body.node, "node")
      assertNodeDataV2(value.body.data)
      return
    case "canvas.nodes.set-plugin-state/2":
      assertExactKeysV2(value.guard, ["node"], "plugin guard wrapper")
      assertPluginGuard(value.guard.node)
      assertExactKeysV2(value.body, ["node", "plugin"], "plugin body")
      assertEntityRefV2(value.body.node, "node")
      if (value.body.plugin !== null) assertPluginStateV2(value.body.plugin)
      return
    case "canvas.nodes.set-structural-parent/2":
      assertExactKeysV2(value.guard, ["child", "parent"], "parent guard")
      assertContainmentGuard(value.guard.child)
      if (value.guard.parent !== null) assertNodeLiveGuard(value.guard.parent)
      assertExactKeysV2(value.body, ["child", "parent", "relationId"], "parent body")
      assertEntityRefV2(value.body.child, "node")
      if (value.body.parent !== null) assertEntityRefV2(value.body.parent, "node")
      assertDerivedIdV2(value.body.relationId, "r_", "relation id")
      return
    case "canvas.nodes.group/2":
      assertExactKeysV2(value.guard, ["group", "children", "expectedGeometryPlanDigest"], "group guard")
      assertDerivedNodeGuard(value.guard.group)
      assertArray(value.guard.children, assertContainmentGuard)
      parseDigestV2(value.guard.expectedGeometryPlanDigest)
      assertExactKeysV2(value.body, ["group", "children", "relationIds"], "group body")
      assertNodeTemplate(value.body.group)
      assertArray(value.body.children, (item) => assertEntityRefV2(item, "node"))
      assertArray(value.body.relationIds, (item) => assertDerivedIdV2(item, "r_", "relation id"))
      return
    case "canvas.nodes.ungroup/2":
      assertExactKeysV2(value.guard, ["group", "children", "expectedEffectiveChildSetDigest"], "ungroup guard")
      assertNodeLiveGuard(value.guard.group)
      assertArray(value.guard.children, assertContainmentGuard)
      parseDigestV2(value.guard.expectedEffectiveChildSetDigest)
      assertExactKeysV2(value.body, ["group", "children", "nullRelationIds"], "ungroup body")
      assertEntityRefV2(value.body.group, "node")
      assertArray(value.body.children, (item) => assertEntityRefV2(item, "node"))
      assertArray(value.body.nullRelationIds, (item) => assertDerivedIdV2(item, "r_", "relation id"))
      return
    case "canvas.edges.connect/2":
      assertExactKeysV2(value.guard, ["edge", "source", "target"], "connect guard")
      assertDerivedEdgeGuard(value.guard.edge)
      assertConnectableGuard(value.guard.source)
      assertConnectableGuard(value.guard.target)
      assertExactKeysV2(value.body, ["edge"], "connect body")
      assertEdgeTemplate(value.body.edge)
      return
    case "canvas.metadata.update/2":
      assertExactKeysV2(value.guard, ["fields"], "metadata guard")
      assertArray(value.guard.fields, assertMetadataGuard)
      assertExactKeysV2(value.body, ["fields"], "metadata body")
      assertArray(value.body.fields, assertMetadataUpdate)
      return
    case "canvas.generation.begin/2":
      assertGenerationBeginGuard(value.guard)
      assertExactKeysV2(value.body, ["begin"], "generation begin body")
      assertGenerationBeginV2(value.body.begin)
      return
    case "canvas.generation.complete/2":
      assertGenerationObservedGuard(value.guard, true)
      assertExactKeysV2(value.body, ["terminal"], "generation complete body")
      assertGenerationTerminalV2(value.body.terminal)
      if (value.body.terminal.phase !== "succeeded") invalid("complete terminal must succeed")
      return
    case "canvas.generation.fail/2":
      assertGenerationObservedGuard(value.guard, false)
      assertExactKeysV2(value.body, ["terminal"], "generation fail body")
      assertGenerationTerminalV2(value.body.terminal)
      if (value.body.terminal.phase !== "failed") invalid("fail terminal must fail")
      return
    case "canvas.generations.fail-owned/2":
      assertExactKeysV2(value.guard, ["generations", "requireBeginActorEqualsOperationActor"], "fail-owned guard")
      if (value.guard.requireBeginActorEqualsOperationActor !== true) invalid("fail-owned actor requirement missing")
      assertArray(value.guard.generations, (item) => assertGenerationObservedGuard(item, false))
      assertExactKeysV2(value.body, ["failures"], "fail-owned body")
      assertArray(value.body.failures, (item) => {
        assertExactKeysV2(item, ["generationId", "beginDigest", "failureCode", "publicMessage"], "owned failure")
        assertDerivedIdV2(item.generationId, "g_", "generation id")
        parseDigestV2(item.beginDigest)
        assertString(item.failureCode)
        if (item.publicMessage !== null) assertString(item.publicMessage)
      })
      return
    case "canvas.generation.dismiss/2":
      assertGenerationObservedGuard(value.guard, false)
      assertExactKeysV2(value.body, ["dismissal"], "dismiss body")
      assertGenerationDismissalV2(value.body.dismissal)
      return
    case "canvas.generation.fail-recovery/2":
      assertGenerationObservedGuard(value.guard, false)
      assertExactKeysV2(value.body, ["recoveryFailure"], "recovery body")
      assertGenerationRecoveryFailureV2(value.body.recoveryFailure)
      return
    case "canvas.plugin.creation-group.create/2":
      assertExactKeysV2(
        value.guard,
        ["source", "pluginRequirement", "derivedNodes", "derivedEdges", "resourceProofs"],
        "creation-group guard",
      )
      assertNodeDataGuard(value.guard.source)
      assertPluginRequirementV2(value.guard.pluginRequirement)
      assertArray(value.guard.derivedNodes, assertDerivedNodeGuard)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      assertArray(value.guard.resourceProofs, assertProofBinding)
      assertExactKeysV2(value.body, ["groupOrdinal", "source", "nodes", "edges"], "creation-group body")
      parseUint32V2(value.body.groupOrdinal)
      assertEntityRefV2(value.body.source, "node")
      assertArray(value.body.nodes, assertNodeTemplate)
      assertArray(value.body.edges, assertEdgeTemplate)
      return
    case "canvas.undo.semantic-inverse/2":
    case "canvas.redo.semantic-forward/2":
      assertHistoryGuard(value.guard, value.kind === "canvas.undo.semantic-inverse/2" ? "applied" : "undone")
      assertExactKeysV2(value.body, ["operations"], "semantic history body")
      assertDenseArrayV2(value.body.operations, "semantic operations")
      for (const [index, operation] of value.body.operations.entries())
        assertSemanticOperation(
          operation,
          value.guard.rootOperationId,
          value.kind === "canvas.undo.semantic-inverse/2" ? "inverse" : "forward",
          parseUint32V2(String(index)),
        )
      return
  }
}

function assertNodeLiveGuard(value: unknown): asserts value is NodeLiveGuardV2 {
  assertExactKeysV2(value, ["node", "expectedLive", "expectedIdentityDigest"], "NodeLiveGuardV2")
  assertEntityRefV2(value.node, "node")
  if (value.expectedLive !== true) invalid("node guard expectedLive must be true")
  parseDigestV2(value.expectedIdentityDigest)
}

function assertEdgeLiveGuard(value: unknown): asserts value is EdgeLiveGuardV2 {
  assertExactKeysV2(value, ["edge", "expectedLive", "expectedIdentityDigest"], "EdgeLiveGuardV2")
  assertEntityRefV2(value.edge, "edge")
  if (value.expectedLive !== true) invalid("edge guard expectedLive must be true")
  parseDigestV2(value.expectedIdentityDigest)
}

function assertNodeDataGuard(value: unknown): asserts value is NodeDataGuardV2 {
  assertExactKeysV2(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedEffectiveDataDigest", "expectedDataRegisterDigest"],
    "NodeDataGuardV2",
  )
  assertEntityRefV2(value.node, "node")
  if (value.expectedLive !== true) invalid("node guard expectedLive must be true")
  parseDigestV2(value.expectedIdentityDigest)
  parseDigestV2(value.expectedEffectiveDataDigest)
  parseDigestV2(value.expectedDataRegisterDigest)
}

function assertGeometryGuard(value: unknown): asserts value is GeometryGuardV2 {
  assertExactKeysV2(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedGeometryDigest"],
    "GeometryGuardV2",
  )
  assertEntityRefV2(value.node, "node")
  if (value.expectedLive !== true) invalid("geometry expectedLive must be true")
  parseDigestV2(value.expectedIdentityDigest)
  parseDigestV2(value.expectedGeometryDigest)
}

function assertConnectableGuard(value: unknown): asserts value is ConnectableNodeGuardV2 {
  assertExactKeysV2(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedConnectable"],
    "ConnectableNodeGuardV2",
  )
  assertEntityRefV2(value.node, "node")
  if (value.expectedLive !== true || value.expectedConnectable !== true)
    invalid("connectable guard booleans are invalid")
  parseDigestV2(value.expectedIdentityDigest)
}

function assertDerivedNodeGuard(value: unknown): asserts value is DerivedNodeAbsentGuardV2 {
  assertExactKeysV2(value, ["ordinal", "node", "expectedAbsent"], "DerivedNodeAbsentGuardV2")
  parseUint32V2(value.ordinal)
  assertEntityRefV2(value.node, "node")
  if (value.expectedAbsent !== true) invalid("derived node expectedAbsent must be true")
}

function assertDerivedEdgeGuard(value: unknown): asserts value is DerivedEdgeAbsentGuardV2 {
  assertExactKeysV2(value, ["ordinal", "edge", "expectedAbsent"], "DerivedEdgeAbsentGuardV2")
  parseUint32V2(value.ordinal)
  assertEntityRefV2(value.edge, "edge")
  if (value.expectedAbsent !== true) invalid("derived edge expectedAbsent must be true")
}

function assertNodeTemplate(value: unknown): asserts value is NodeCreateTemplateV2 {
  assertExactKeysV2(
    value,
    ["ordinal", "nodeId", "incarnation", "role", "position", "size", "data", "plugin"],
    "NodeCreateTemplateV2",
  )
  parseUint32V2(value.ordinal)
  assertDerivedIdV2(value.nodeId, "n_", "nodeId")
  assertDerivedIdV2(value.incarnation, "ni_", "incarnation")
  if (value.role !== "file" && value.role !== "agent") invalid("node role is invalid")
  assertPointV2(value.position)
  assertSizeV2(value.size)
  assertNodeDataV2(value.data)
  if (value.plugin !== null) assertPluginStateV2(value.plugin)
}

function assertEdgeTemplate(value: unknown): asserts value is EdgeCreateTemplateV2 {
  assertExactKeysV2(value, ["ordinal", "edgeId", "incarnation", "source", "target", "data"], "EdgeCreateTemplateV2")
  parseUint32V2(value.ordinal)
  assertDerivedIdV2(value.edgeId, "e_", "edgeId")
  assertDerivedIdV2(value.incarnation, "ei_", "incarnation")
  assertEndpoint(value.source)
  assertEndpoint(value.target)
  assertEdgeDataV2(value.data)
}

function assertEndpoint(value: unknown): void {
  if (typeof value === "object" && value !== null && "createdNodeOrdinal" in value) {
    assertExactKeysV2(value, ["createdNodeOrdinal"], "created endpoint")
    parseUint32V2(value.createdNodeOrdinal)
  } else assertEntityRefV2(value, "node")
}

function assertPlacement(value: unknown): void {
  assertExactKeysV2(value, ["anchor", "gap", "obstacleProjectionDigest"], "CausalPlacementV2")
  assertPointV2(value.anchor)
  if (value.gap !== 24) invalid("placement gap must be 24")
  parseDigestV2(value.obstacleProjectionDigest)
}

function assertResourceNode(value: unknown): void {
  assertExactKeysV2(
    value,
    ["ordinal", "nodeId", "incarnation", "size", "title", "resource"],
    "ResourceNodeCreateSpecV2",
  )
  parseUint32V2(value.ordinal)
  assertDerivedIdV2(value.nodeId, "n_", "nodeId")
  assertDerivedIdV2(value.incarnation, "ni_", "incarnation")
  assertSizeV2(value.size)
  assertString(value.title)
  assertResourceRefV2(value.resource)
}

function assertPendingNode(value: unknown): void {
  assertExactKeysV2(
    value,
    ["ordinal", "nodeId", "incarnation", "size", "title", "expectedClass"],
    "PendingNodeCreateSpecV2",
  )
  parseUint32V2(value.ordinal)
  assertDerivedIdV2(value.nodeId, "n_", "nodeId")
  assertDerivedIdV2(value.incarnation, "ni_", "incarnation")
  assertSizeV2(value.size)
  assertString(value.title)
  if (!new Set(["text", "image", "video", "audio", "file"]).has(value.expectedClass as string))
    invalid("expectedClass is invalid")
}

function assertCreateSetGuard(value: unknown, resources: boolean): void {
  const keys = resources
    ? ["existingEndpoints", "derivedNodes", "derivedEdges", "resourceProofs"]
    : ["existingEndpoints", "derivedNodes", "derivedEdges"]
  assertExactKeysV2(value, keys, "create-set guard")
  assertArray(value.existingEndpoints, assertConnectableGuard)
  assertArray(value.derivedNodes, assertDerivedNodeGuard)
  assertArray(value.derivedEdges, assertDerivedEdgeGuard)
  if (resources) assertArray(value.resourceProofs, assertProofBinding)
}

function assertProofBinding(value: unknown): void {
  assertExactKeysV2(value, ["createdNodeOrdinal", "proof"], "resource proof binding")
  parseUint32V2(value.createdNodeOrdinal)
  assertResourceProofV2(value.proof, false)
}

function assertPluginGuard(value: unknown): void {
  assertExactKeysV2(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedPluginDigest", "requirement"],
    "PluginGuardV2",
  )
  assertEntityRefV2(value.node, "node")
  if (value.expectedLive !== true) invalid("plugin expectedLive must be true")
  parseDigestV2(value.expectedIdentityDigest)
  if (value.expectedPluginDigest !== null) parseDigestV2(value.expectedPluginDigest)
  if (value.requirement !== null) assertPluginRequirementV2(value.requirement)
}

function assertContainmentGuard(value: unknown): void {
  assertExactKeysV2(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedOwnSlotDigest"],
    "ContainmentGuardV2",
  )
  assertEntityRefV2(value.node, "node")
  if (value.expectedLive !== true) invalid("containment expectedLive must be true")
  parseDigestV2(value.expectedIdentityDigest)
  if (value.expectedOwnSlotDigest !== null) parseDigestV2(value.expectedOwnSlotDigest)
}

function assertMetadataGuard(value: unknown): void {
  assertExactKeysV2(value, ["field", "expectedEffectiveDigest", "expectedOwnSlotDigest"], "MetadataFieldGuardV2")
  assertMetadataField(value.field)
  parseDigestV2(value.expectedEffectiveDigest)
  if (value.expectedOwnSlotDigest !== null) parseDigestV2(value.expectedOwnSlotDigest)
}

function assertMetadataUpdate(value: unknown): void {
  assertExactKeysV2(value, ["field", "value"], "MetadataFieldUpdateV2")
  assertMetadataField(value.field)
  if (value.field === "tags") {
    if (!Array.isArray(value.value)) invalid("tags update must be array")
  } else if (value.value !== null) assertString(value.value)
}

function assertGenerationBeginGuard(value: unknown): void {
  assertExactKeysV2(
    value,
    [
      "node",
      "expectedLive",
      "expectedIdentityDigest",
      "expectedEffectiveDataDigest",
      "expectedDataRegisterDigest",
      "expectedPluginDigest",
      "expectedProjectedGenerationDigest",
    ],
    "GenerationBeginGuardV2",
  )
  assertEntityRefV2(value.node, "node")
  if (value.expectedLive !== true) invalid("generation expectedLive must be true")
  for (const key of [
    "expectedIdentityDigest",
    "expectedEffectiveDataDigest",
    "expectedDataRegisterDigest",
    "expectedProjectedGenerationDigest",
  ] as const)
    parseDigestV2(value[key])
  if (value.expectedPluginDigest !== null) parseDigestV2(value.expectedPluginDigest)
}

function assertGenerationObservedGuard(value: unknown, resource: boolean): void {
  const keys = [
    "node",
    "expectedLive",
    "expectedIdentityDigest",
    "generationId",
    "beginDigest",
    "expectedLifecycleDigest",
    "expectedTerminalDigest",
    "expectedDismissalDigest",
    "expectedRecoveryFailureDigest",
    ...(resource ? ["resourceProof"] : []),
  ]
  assertExactKeysV2(value, keys, "GenerationObservedGuardV2")
  assertEntityRefV2(value.node, "node")
  if (value.expectedLive !== true) invalid("generation expectedLive must be true")
  assertDerivedIdV2(value.generationId, "g_", "generation id")
  for (const key of ["expectedIdentityDigest", "beginDigest", "expectedLifecycleDigest"] as const)
    parseDigestV2(value[key])
  for (const key of ["expectedTerminalDigest", "expectedDismissalDigest", "expectedRecoveryFailureDigest"] as const)
    if (value[key] !== null) parseDigestV2(value[key])
  if (resource) assertResourceProofV2(value.resourceProof, false)
}

function assertHistoryGuard(value: unknown, mode: "applied" | "undone"): asserts value is SemanticHistoryGuardV2 {
  assertExactKeysV2(
    value,
    [
      "rootOperationId",
      "expectedRootReceiptDigest",
      "expectedHistoryRootDigest",
      "expectedHistoryStateDigest",
      "expectedMode",
    ],
    "SemanticHistoryGuardV2",
  )
  parseId128V2(value.rootOperationId)
  if (value.expectedMode !== mode) invalid("history mode is invalid")
  for (const key of ["expectedRootReceiptDigest", "expectedHistoryRootDigest", "expectedHistoryStateDigest"] as const)
    parseDigestV2(value[key])
}

function assertSemanticOperation(
  value: unknown,
  rootOperationId: import("@convax/collaboration").Id128V2,
  direction: "inverse" | "forward",
  operationIndex: import("@convax/collaboration").Uint32V2,
): asserts value is CanvasSemanticOperationV2 {
  assertExactKeysV2(
    value,
    ["format", "template", "materializedGuard", "derived", "guardDigest", "retainedResourceProofs"],
    "CanvasSemanticOperationV2",
  )
  if (value.format !== "convax.canvas-semantic-operation/2") invalid("semantic operation format is invalid")
  assertHistoryTemplateV2(value.template)
  assertMaterializedHistoryGuard(value.materializedGuard, value.template)
  parseDigestV2(value.guardDigest)
  assertDenseArrayV2(value.derived, "semantic derived")
  assertSemanticDerivedObjects(value.derived, value.template)
  assertDenseArrayV2(value.retainedResourceProofs, "semantic retained proofs")
  assertSemanticResourceProofs(value.retainedResourceProofs, value.template)
  const guardDigest = canvasDigestV2("convax.canvas-semantic-guard/2", {
    format: "convax.canvas-semantic-guard/2",
    rootOperationId,
    direction,
    operationIndex,
    template: value.template,
    materializedGuard: value.materializedGuard,
  })
  if (value.guardDigest !== guardDigest) invalid("semantic operation guard digest is invalid")
}

function assertMaterializedHistoryGuard(value: unknown, template: CanvasHistoryTemplateV2): void {
  assertExactKeysV2(value, ["op", "guard"], "CanvasMaterializedHistoryGuardV2")
  if (value.op !== template.op) invalid("materialized history guard operation does not match template")
  switch (template.op) {
    case "node.create":
      if (value.guard !== null) invalid("node.create materialized guard must be null")
      return
    case "node.tombstone":
      assertNodeLiveGuard(value.guard)
      return
    case "node.geometry":
      assertGeometryGuard(value.guard)
      return
    case "node.data":
      assertNodeDataGuard(value.guard)
      return
    case "node.plugin":
      assertPluginGuard(value.guard)
      return
    case "edge.create":
      assertExactKeysV2(value.guard, ["edge", "source", "target"], "history edge.create guard")
      assertDerivedEdgeGuard(value.guard.edge)
      assertConnectableGuard(value.guard.source)
      assertConnectableGuard(value.guard.target)
      return
    case "edge.tombstone":
      assertEdgeLiveGuard(value.guard)
      return
    case "containment.set":
      assertExactKeysV2(value.guard, ["child", "parent"], "history containment guard")
      assertContainmentGuard(value.guard.child)
      if (value.guard.parent !== null) assertNodeLiveGuard(value.guard.parent)
      return
    case "metadata.set":
      assertMetadataGuard(value.guard)
      return
    case "creation-group.restore":
      assertExactKeysV2(
        value.guard,
        ["source", "pluginRequirement", "derivedNodes", "derivedEdges"],
        "history creation-group guard",
      )
      assertNodeDataGuard(value.guard.source)
      assertPluginRequirementV2(value.guard.pluginRequirement)
      assertArray(value.guard.derivedNodes, assertDerivedNodeGuard)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      return
    case "pending-generation.restore":
      assertExactKeysV2(value.guard, ["lifecycle", "derivedNode", "derivedEdges"], "history pending guard")
      assertHistoryGenerationGuard(value.guard.lifecycle)
      assertDerivedNodeGuard(value.guard.derivedNode)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      return
  }
}

function assertHistoryGenerationGuard(value: unknown): void {
  assertExactKeysV2(
    value,
    [
      "rootOperationId",
      "nodeHandle",
      "generationId",
      "retainedBeginDigest",
      "expectedLifecycleDigest",
      "expectedTerminalDigest",
      "expectedDismissalDigest",
      "expectedRecoveryFailureDigest",
    ],
    "CanvasHistoryGenerationGuardV2",
  )
  parseId128V2(value.rootOperationId)
  assertHistoryNodeHandle(value.nodeHandle)
  assertDerivedIdV2(value.generationId, "g_", "generation id")
  parseDigestV2(value.retainedBeginDigest)
  parseDigestV2(value.expectedLifecycleDigest)
  for (const key of ["expectedTerminalDigest", "expectedDismissalDigest", "expectedRecoveryFailureDigest"] as const)
    if (value[key] !== null) parseDigestV2(value[key])
}

function assertSemanticDerivedObjects(values: readonly unknown[], template: CanvasHistoryTemplateV2): void {
  const derived: CanvasHistoryDerivedObjectV2[] = []
  let priorOrdinal = -1
  for (const value of values) {
    assertSemanticDerivedObject(value)
    const ordinal = Number(parseUint32V2(value.ordinal))
    if (ordinal <= priorOrdinal) invalid("semantic derived objects must be ordinal-sorted and unique")
    priorOrdinal = ordinal
    derived.push(value)
  }

  const expected = expectedDerivedKeys(template)
  const actual = derived.map(derivedObjectKey)
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    invalid("semantic derived objects do not exactly match the template allocation set")
  if (template.op === "creation-group.restore" && derived[0]?.kind !== "creation-group")
    invalid("creation group ordinal must precede its members")
}

function assertSemanticDerivedObject(value: unknown): asserts value is CanvasHistoryDerivedObjectV2 {
  if (typeof value !== "object" || value === null) invalid("semantic derived object must be an object")
  const kind = (value as { kind?: unknown }).kind
  switch (kind) {
    case "node":
      assertExactKeysV2(value, ["kind", "handle", "ordinal", "ref"], "history derived node")
      assertHistoryNodeHandle(value.handle)
      parseUint32V2(value.ordinal)
      assertEntityRefV2(value.ref, "node")
      return
    case "edge":
      assertExactKeysV2(value, ["kind", "handle", "ordinal", "ref"], "history derived edge")
      assertHistoryEdgeHandle(value.handle)
      parseUint32V2(value.ordinal)
      assertEntityRefV2(value.ref, "edge")
      return
    case "relation":
      assertExactKeysV2(value, ["kind", "ordinal", "relationId", "child"], "history derived relation")
      parseUint32V2(value.ordinal)
      assertDerivedIdV2(value.relationId, "r_", "relation id")
      assertHistoryNodeTarget(value.child)
      return
    case "creation-group":
      assertExactKeysV2(value, ["kind", "handle", "ordinal", "groupId"], "history derived creation group")
      assertHistoryGroupHandle(value.handle)
      parseUint32V2(value.ordinal)
      assertDerivedIdV2(value.groupId, "cg_", "creation group id")
      return
    default:
      invalid("unknown semantic derived object kind")
  }
}

function expectedDerivedKeys(template: CanvasHistoryTemplateV2): readonly string[] {
  switch (template.op) {
    case "node.create":
      return [`node:${template.handle}`]
    case "edge.create":
      return [`edge:${template.handle}`]
    case "containment.set":
      return [`relation:${historyTargetKey(template.child)}`]
    case "creation-group.restore":
      return [
        `creation-group:${template.groupHandle}`,
        ...template.nodes.map((node) => `node:${node.handle}`),
        ...template.edges.map((edge) => `edge:${edge.handle}`),
      ]
    case "pending-generation.restore":
      return [`node:${template.node}`, ...template.edges.map((edge) => `edge:${edge.handle}`)]
    default:
      return []
  }
}

function derivedObjectKey(value: CanvasHistoryDerivedObjectV2): string {
  if (value.kind === "relation") return `relation:${historyTargetKey(value.child)}`
  return `${value.kind}:${value.handle}`
}

function assertSemanticResourceProofs(values: readonly unknown[], template: CanvasHistoryTemplateV2): void {
  const resources = introducedResources(template)
  let prior: CanvasResourceRefV2 | undefined
  const actual: CanvasResourceRefV2[] = []
  for (const value of values) {
    assertResourceProofV2(value, true)
    if (value.mode !== "retained-canvas-history") invalid("semantic operation proof must be retained history")
    if (prior !== undefined && compareResources(prior, value.resource) >= 0)
      invalid("semantic resource proofs must be resource-sorted and duplicate-free")
    prior = value.resource
    actual.push(value.resource)
  }
  // A pending-generation restore derives the introduced resource from retained
  // lifecycle facts, so exact proof coverage is checked by the candidate reducer.
  if (template.op === "pending-generation.restore") return
  if (
    actual.length !== resources.length ||
    actual.some((resource, index) => canonicalJson(resource) !== canonicalJson(resources[index]))
  )
    invalid("semantic resource proofs do not exactly cover introduced resources")
}

function introducedResources(template: CanvasHistoryTemplateV2): readonly CanvasResourceRefV2[] {
  const values: CanvasResourceRefV2[] = []
  if (template.op === "node.create" && template.snapshot.resource !== null) values.push(template.snapshot.resource)
  if (template.op === "node.data" && template.resource !== null) values.push(template.resource)
  if (template.op === "creation-group.restore")
    for (const member of template.nodes) if (member.snapshot.resource !== null) values.push(member.snapshot.resource)
  return values
    .sort(compareResources)
    .filter((resource, index, all) => index === 0 || canonicalJson(resource) !== canonicalJson(all[index - 1]))
}

function compareResources(left: CanvasResourceRefV2, right: CanvasResourceRefV2): number {
  return (
    compareUtf8V2(left.contentDigest, right.contentDigest) ||
    compareUtf8V2(left.uri, right.uri) ||
    compareUtf8V2(canonicalJson(left), canonicalJson(right))
  )
}

function canonicalJson(value: unknown): string {
  return new TextDecoder().decode(encodeRestrictedJcsV2(value))
}

function assertHistoryNodeTarget(value: unknown): void {
  if (typeof value !== "object" || value === null) invalid("history node target must be an object")
  if ((value as { mode?: unknown }).mode === "handle") {
    assertExactKeysV2(value, ["mode", "handle"], "history node handle target")
    assertHistoryNodeHandle(value.handle)
    return
  }
  assertExactKeysV2(value, ["mode", "ref"], "history external node target")
  if (value.mode !== "external") invalid("history node target mode is invalid")
  assertEntityRefV2(value.ref, "node")
}

function historyTargetKey(
  value:
    | { readonly mode: "handle"; readonly handle: string }
    | {
        readonly mode: "external"
        readonly ref: { readonly kind: "node"; readonly id: string; readonly incarnation: string }
      },
): string {
  return value.mode === "handle" ? `handle/${value.handle}` : `external/node/${value.ref.id}/${value.ref.incarnation}`
}

function assertHistoryNodeHandle(value: unknown): void {
  assertHistoryHandle(value, "n")
}

function assertHistoryEdgeHandle(value: unknown): void {
  assertHistoryHandle(value, "e")
}

function assertHistoryGroupHandle(value: unknown): void {
  assertHistoryHandle(value, "g")
}

function assertHistoryHandle(value: unknown, prefix: "n" | "e" | "g"): void {
  if (typeof value !== "string" || !new RegExp(`^${prefix}/(0|[1-9]\\d*)$`, "u").test(value))
    invalid("history handle is invalid")
  parseUint32V2(value.slice(2))
}

function assertArray(value: unknown, validate: (item: any) => void): void {
  assertDenseArrayV2(value, "array")
  for (const item of value) validate(item)
}

function assertMetadataField(value: unknown): void {
  if (value !== "title" && value !== "description" && value !== "tags") invalid("metadata field is invalid")
}

function assertString(value: unknown): void {
  if (typeof value !== "string" || value.normalize("NFC") !== value) invalid("string must be NFC")
}

function invalid(message: string): never {
  throw new CanvasSchemaErrorV2("invalid-intent", message)
}

// Compile-time equality: a missing/extra discriminator on either side is a type error.
type _KindsEqual = CanvasIntentKindV2 extends keyof import("./types").CanvasIntentContractMapV2
  ? keyof import("./types").CanvasIntentContractMapV2 extends CanvasIntentKindV2
    ? true
    : never
  : never
const kindsEqual: _KindsEqual = true
void kindsEqual
void assertContainmentChoiceV2
