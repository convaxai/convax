import {
  assertDenseArray,
  assertExactKeys,
  compareUtf8,
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  parseUint32,
} from "@convax/collaboration"
import type {
  CanvasHistoryDerivedObject,
  CanvasHistoryTemplate,
  CanvasIntentKind,
  CanvasResourceRef,
  CanvasSemanticOperation,
  CanvasTypedIntentUnion,
  ConnectableNodeGuard,
  DerivedEdgeAbsentGuard,
  DerivedNodeAbsentGuard,
  EdgeCreateTemplate,
  EdgeLiveGuard,
  GeometryGuard,
  NodeCreateTemplate,
  NodeDataGuard,
  NodeLiveGuard,
  SemanticHistoryGuard,
} from "./types"
import {
  assertContainmentChoice,
  assertDerivedId,
  assertEdgeData,
  assertEntityRef,
  assertGenerationBeginV2,
  assertGenerationDismissalV2,
  assertGenerationRecoveryFailureV2,
  assertGenerationTerminalV2,
  assertHistoryTemplate,
  assertNodeData,
  assertPluginRequirement,
  assertPluginState,
  assertPoint,
  assertResourceProof,
  assertResourceRef,
  assertSize,
  canvasDigest,
  CanvasSchemaError,
} from "./validation"
import { parseCanvasNodeGenerationRun } from "../generation-run"

export const CANVAS_INTENT_KINDS = Object.freeze([
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
  "canvas.generation.runs.update",
  "canvas.generation.complete",
  "canvas.generation.fail",
  "canvas.generations.fail-owned",
  "canvas.generation.dismiss",
  "canvas.generation.fail-recovery",
  "canvas.plugin.creation-group.create",
  "canvas.plugin.surface.create",
  "canvas.undo.semantic-inverse",
  "canvas.redo.semantic-forward",
] as const satisfies readonly CanvasIntentKind[])

const INTENT_KIND_SET = new Set<string>(CANVAS_INTENT_KINDS)

export function decodeCanvasTypedIntent(bytes: Uint8Array): CanvasTypedIntentUnion {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 512 * 1024)
    throw new CanvasSchemaError("intent-too-large", "Canvas typed intent exceeds 512 KiB")
  const value = decodeRestrictedJcs(bytes)
  assertCanvasTypedIntent(value)
  if (encodeRestrictedJcs(value.guard).byteLength > 256 * 1024)
    throw new CanvasSchemaError("guard-too-large", "Canvas intent guard exceeds 256 KiB")
  return value
}

export function assertCanvasTypedIntent(value: unknown): asserts value is CanvasTypedIntentUnion {
  assertExactKeys(value, ["format", "kind", "guard", "body"], "CanvasTypedIntent")
  if (value.format !== "convax.typed-intent" || typeof value.kind !== "string" || !INTENT_KIND_SET.has(value.kind)) {
    throw new CanvasSchemaError("unknown-intent", "Canvas typed-intent discriminator is not in the closed union")
  }
  switch (value.kind as CanvasIntentKind) {
    case "canvas.agent.create":
      assertDerivedNodeGuard(value.guard)
      assertExactKeys(value.body, ["node"], "agent.create body")
      assertNodeTemplate(value.body.node)
      return
    case "canvas.resources.add":
      assertCreateSetGuard(value.guard, true)
      assertExactKeys(value.body, ["placement", "nodes", "edges"], "resources.add body")
      assertPlacement(value.body.placement)
      assertArray(value.body.nodes, assertResourceNode)
      assertArray(value.body.edges, assertEdgeTemplate)
      return
    case "canvas.resources.pending.create":
      assertCreateSetGuard(value.guard, false)
      assertExactKeys(value.body, ["placement", "nodes", "edges"], "pending.create body")
      assertPlacement(value.body.placement)
      assertArray(value.body.nodes, assertPendingNode)
      assertArray(value.body.edges, assertEdgeTemplate)
      return
    case "canvas.resources.pending-generation.create":
      assertExactKeys(value.guard, ["existingEndpoints", "derivedNode", "derivedEdges"], "pending-generation guard")
      assertArray(value.guard.existingEndpoints, assertConnectableGuard)
      assertDerivedNodeGuard(value.guard.derivedNode)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      assertExactKeys(value.body, ["placement", "node", "edges", "begin"], "pending-generation body")
      assertPlacement(value.body.placement)
      assertPendingNode(value.body.node)
      assertArray(value.body.edges, assertEdgeTemplate)
      assertGenerationBeginV2(value.body.begin)
      return
    case "canvas.elements.remove":
      assertExactKeys(value.guard, ["nodes", "edges", "requireObservedIncidentEdgeClosure"], "remove guard")
      if (value.guard.requireObservedIncidentEdgeClosure !== true)
        invalid("remove guard must require incident edge closure")
      assertArray(value.guard.nodes, assertNodeLiveGuard)
      assertArray(value.guard.edges, assertEdgeLiveGuard)
      assertExactKeys(value.body, ["nodes", "edges"], "remove body")
      assertArray(value.body.nodes, (item) => assertEntityRef(item, "node"))
      assertArray(value.body.edges, (item) => assertEntityRef(item, "edge"))
      return
    case "canvas.nodes.set-geometry":
      assertExactKeys(value.guard, ["nodes"], "geometry guard")
      assertArray(value.guard.nodes, assertGeometryGuard)
      assertExactKeys(value.body, ["updates"], "geometry body")
      assertArray(value.body.updates, (item) => {
        assertExactKeys(item, ["node", "position", "size"], "geometry update")
        assertEntityRef(item.node, "node")
        assertPoint(item.position)
        if (item.size !== null) assertSize(item.size)
      })
      return
    case "canvas.nodes.duplicate":
      assertExactKeys(value.guard, ["sources", "existingEndpoints", "existingParents", "derivedNodes", "derivedEdges"], "duplicate guard")
      assertArray(value.guard.sources, assertNodeDataGuard)
      assertArray(value.guard.existingEndpoints, assertConnectableGuard)
      assertArray(value.guard.existingParents, assertNodeLiveGuard)
      assertArray(value.guard.derivedNodes, assertDerivedNodeGuard)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      assertExactKeys(value.body, ["offset", "nodes", "edges", "containments"], "duplicate body")
      assertPoint(value.body.offset)
      assertArray(value.body.nodes, assertNodeTemplate)
      assertArray(value.body.edges, assertEdgeTemplate)
      assertArray(value.body.containments, (item) => {
        assertExactKeys(item, ["childCreatedNodeOrdinal", "parent", "relationId"], "duplicate containment")
        parseUint32(item.childCreatedNodeOrdinal)
        assertEndpoint(item.parent)
        assertDerivedId(item.relationId, "r_", "relationId")
      })
      return
    case "canvas.nodes.update-data":
      assertExactKeys(value.guard, ["node", "resourceProof"], "update-data guard")
      assertNodeDataGuard(value.guard.node)
      if (value.guard.resourceProof !== null) assertResourceProof(value.guard.resourceProof, false)
      assertExactKeys(value.body, ["node", "data"], "update-data body")
      assertEntityRef(value.body.node, "node")
      assertNodeData(value.body.data)
      return
    case "canvas.generation.runs.update":
      assertExactKeys(value.guard, ["updates"], "generation run update guard")
      assertArray(value.guard.updates, (item) => {
        assertExactKeys(item, ["node", "resourceProof"], "generation run update guard item")
        assertNodeDataGuard(item.node)
        if (item.resourceProof !== null) assertResourceProof(item.resourceProof, false)
      })
      assertExactKeys(value.body, ["updates"], "generation run update body")
      assertArray(value.body.updates, (item) => {
        assertExactKeys(item, ["node", "data"], "generation run update body item")
        assertEntityRef(item.node, "node")
        assertNodeData(item.data)
        if (
          (item.data.kind !== "resource" && item.data.kind !== "placeholder") ||
          item.data.generationRun === undefined
        ) invalid("generation run update body must carry a portable run")
      })
      return
    case "canvas.nodes.set-plugin-state":
      assertExactKeys(value.guard, ["node"], "plugin guard wrapper")
      assertPluginGuard(value.guard.node)
      assertExactKeys(value.body, ["node", "plugin"], "plugin body")
      assertEntityRef(value.body.node, "node")
      if (value.body.plugin !== null) assertPluginState(value.body.plugin)
      return
    case "canvas.nodes.set-structural-parent":
      assertExactKeys(value.guard, ["child", "parent"], "parent guard")
      const hasStructuralGeometry = typeof value.guard.child === "object" && value.guard.child !== null && "expectedGeometryDigest" in value.guard.child
      assertExactKeys(value.guard.child, !hasStructuralGeometry
        ? ["node", "expectedLive", "expectedIdentityDigest", "expectedOwnSlotDigest"]
        : ["node", "expectedLive", "expectedIdentityDigest", "expectedOwnSlotDigest", "expectedGeometryDigest"], "structural child guard")
      assertEntityRef(value.guard.child.node, "node")
      if (value.guard.child.expectedLive !== true) invalid("structural child must be live")
      parseDigest(value.guard.child.expectedIdentityDigest)
      if (value.guard.child.expectedOwnSlotDigest !== null) parseDigest(value.guard.child.expectedOwnSlotDigest)
      if (value.guard.child.expectedGeometryDigest !== undefined) parseDigest(value.guard.child.expectedGeometryDigest)
      if (value.guard.parent !== null) assertNodeLiveGuard(value.guard.parent)
      const hasStructuralPosition = typeof value.body === "object" && value.body !== null && "position" in value.body
      assertExactKeys(value.body, !hasStructuralPosition
        ? ["child", "parent", "relationId"]
        : ["child", "parent", "position", "relationId"], "parent body")
      assertEntityRef(value.body.child, "node")
      if (value.body.parent !== null) assertEntityRef(value.body.parent, "node")
      if (value.body.position !== undefined) assertPoint(value.body.position)
      if ((value.body.position === undefined) !== (value.guard.child.expectedGeometryDigest === undefined)) invalid("structural geometry guard/body mismatch")
      assertDerivedId(value.body.relationId, "r_", "relation id")
      return
    case "canvas.nodes.group":
      assertExactKeys(value.guard, ["group", "children", "expectedGeometryPlanDigest"], "group guard")
      assertDerivedNodeGuard(value.guard.group)
      assertArray(value.guard.children, assertContainmentGuard)
      parseDigest(value.guard.expectedGeometryPlanDigest)
      assertExactKeys(value.body, ["group", "children", "relationIds"], "group body")
      assertNodeTemplate(value.body.group)
      assertArray(value.body.children, (item) => assertEntityRef(item, "node"))
      assertArray(value.body.relationIds, (item) => assertDerivedId(item, "r_", "relation id"))
      return
    case "canvas.nodes.ungroup":
      assertExactKeys(value.guard, ["group", "children", "expectedEffectiveChildSetDigest"], "ungroup guard")
      assertNodeLiveGuard(value.guard.group)
      assertArray(value.guard.children, assertContainmentGuard)
      parseDigest(value.guard.expectedEffectiveChildSetDigest)
      assertExactKeys(value.body, ["group", "children", "nullRelationIds"], "ungroup body")
      assertEntityRef(value.body.group, "node")
      assertArray(value.body.children, (item) => assertEntityRef(item, "node"))
      assertArray(value.body.nullRelationIds, (item) => assertDerivedId(item, "r_", "relation id"))
      return
    case "canvas.edges.connect":
      assertExactKeys(value.guard, ["edge", "source", "target"], "connect guard")
      assertDerivedEdgeGuard(value.guard.edge)
      assertConnectableGuard(value.guard.source)
      assertConnectableGuard(value.guard.target)
      assertExactKeys(value.body, ["edge"], "connect body")
      assertEdgeTemplate(value.body.edge)
      return
    case "canvas.metadata.update":
      assertExactKeys(value.guard, ["fields"], "metadata guard")
      assertArray(value.guard.fields, assertMetadataGuard)
      assertExactKeys(value.body, ["fields"], "metadata body")
      assertArray(value.body.fields, assertMetadataUpdate)
      return
    case "canvas.generation.begin":
      assertGenerationBeginGuard(value.guard)
      assertExactKeys(value.body, ["begin"], "generation begin body")
      assertGenerationBeginV2(value.body.begin)
      return
    case "canvas.generation.complete":
      assertGenerationObservedGuard(value.guard, true)
      assertExactKeys(value.body, ["terminal"], "generation complete body")
      assertGenerationTerminalV2(value.body.terminal)
      if (value.body.terminal.phase !== "succeeded") invalid("complete terminal must succeed")
      return
    case "canvas.generation.fail":
      assertGenerationObservedGuard(value.guard, false)
      assertExactKeys(value.body, ["terminal"], "generation fail body")
      assertGenerationTerminalV2(value.body.terminal)
      if (value.body.terminal.phase !== "failed") invalid("fail terminal must fail")
      return
    case "canvas.generations.fail-owned":
      assertExactKeys(value.guard, ["generations", "requireBeginActorEqualsOperationActor"], "fail-owned guard")
      if (value.guard.requireBeginActorEqualsOperationActor !== true) invalid("fail-owned actor requirement missing")
      assertArray(value.guard.generations, (item) => assertGenerationObservedGuard(item, false))
      assertExactKeys(value.body, ["failures"], "fail-owned body")
      assertArray(value.body.failures, (item) => {
        assertExactKeys(item, ["generationId", "beginDigest", "failureCode", "publicMessage"], "owned failure")
        assertDerivedId(item.generationId, "g_", "generation id")
        parseDigest(item.beginDigest)
        assertString(item.failureCode)
        if (item.publicMessage !== null) assertString(item.publicMessage)
      })
      return
    case "canvas.generation.dismiss":
      assertGenerationObservedGuard(value.guard, false)
      assertExactKeys(value.body, ["dismissal"], "dismiss body")
      assertGenerationDismissalV2(value.body.dismissal)
      return
    case "canvas.generation.fail-recovery":
      assertGenerationObservedGuard(value.guard, false)
      assertExactKeys(value.body, ["recoveryFailure"], "recovery body")
      assertGenerationRecoveryFailureV2(value.body.recoveryFailure)
      return
    case "canvas.plugin.creation-group.create":
      assertExactKeys(
        value.guard,
        ["source", "pluginRequirement", "derivedNodes", "derivedEdges", "resourceProofs"],
        "creation-group guard",
      )
      assertNodeDataGuard(value.guard.source)
      assertPluginRequirement(value.guard.pluginRequirement)
      assertArray(value.guard.derivedNodes, assertDerivedNodeGuard)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      assertArray(value.guard.resourceProofs, assertProofBinding)
      assertExactKeys(value.body, ["groupOrdinal", "source", "nodes", "edges"], "creation-group body")
      parseUint32(value.body.groupOrdinal)
      assertEntityRef(value.body.source, "node")
      assertArray(value.body.nodes, assertNodeTemplate)
      assertArray(value.body.edges, assertEdgeTemplate)
      return
    case "canvas.plugin.surface.create":
      assertExactKeys(value.guard, ["derivedNode"], "plugin surface guard")
      assertDerivedNodeGuard(value.guard.derivedNode)
      assertExactKeys(value.body, ["placement", "node"], "plugin surface body")
      assertPlacement(value.body.placement)
      assertPluginSurfaceNode(value.body.node)
      return
    case "canvas.undo.semantic-inverse":
    case "canvas.redo.semantic-forward":
      assertHistoryGuard(value.guard, value.kind === "canvas.undo.semantic-inverse" ? "applied" : "undone")
      assertExactKeys(value.body, ["operations"], "semantic history body")
      assertDenseArray(value.body.operations, "semantic operations")
      for (const [index, operation] of value.body.operations.entries())
        assertSemanticOperation(
          operation,
          value.guard.rootOperationId,
          value.kind === "canvas.undo.semantic-inverse" ? "inverse" : "forward",
          parseUint32(String(index)),
        )
      return
  }
}

function assertNodeLiveGuard(value: unknown): asserts value is NodeLiveGuard {
  assertExactKeys(value, ["node", "expectedLive", "expectedIdentityDigest"], "NodeLiveGuard")
  assertEntityRef(value.node, "node")
  if (value.expectedLive !== true) invalid("node guard expectedLive must be true")
  parseDigest(value.expectedIdentityDigest)
}

function assertEdgeLiveGuard(value: unknown): asserts value is EdgeLiveGuard {
  assertExactKeys(value, ["edge", "expectedLive", "expectedIdentityDigest"], "EdgeLiveGuard")
  assertEntityRef(value.edge, "edge")
  if (value.expectedLive !== true) invalid("edge guard expectedLive must be true")
  parseDigest(value.expectedIdentityDigest)
}

function assertNodeDataGuard(value: unknown): asserts value is NodeDataGuard {
  assertExactKeys(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedEffectiveDataDigest", "expectedDataRegisterDigest"],
    "NodeDataGuard",
  )
  assertEntityRef(value.node, "node")
  if (value.expectedLive !== true) invalid("node guard expectedLive must be true")
  parseDigest(value.expectedIdentityDigest)
  parseDigest(value.expectedEffectiveDataDigest)
  parseDigest(value.expectedDataRegisterDigest)
}

function assertGeometryGuard(value: unknown): asserts value is GeometryGuard {
  assertExactKeys(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedGeometryDigest"],
    "GeometryGuard",
  )
  assertEntityRef(value.node, "node")
  if (value.expectedLive !== true) invalid("geometry expectedLive must be true")
  parseDigest(value.expectedIdentityDigest)
  parseDigest(value.expectedGeometryDigest)
}

function assertConnectableGuard(value: unknown): asserts value is ConnectableNodeGuard {
  assertExactKeys(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedConnectable"],
    "ConnectableNodeGuard",
  )
  assertEntityRef(value.node, "node")
  if (value.expectedLive !== true || value.expectedConnectable !== true)
    invalid("connectable guard booleans are invalid")
  parseDigest(value.expectedIdentityDigest)
}

function assertDerivedNodeGuard(value: unknown): asserts value is DerivedNodeAbsentGuard {
  assertExactKeys(value, ["ordinal", "node", "expectedAbsent"], "DerivedNodeAbsentGuard")
  parseUint32(value.ordinal)
  assertEntityRef(value.node, "node")
  if (value.expectedAbsent !== true) invalid("derived node expectedAbsent must be true")
}

function assertDerivedEdgeGuard(value: unknown): asserts value is DerivedEdgeAbsentGuard {
  assertExactKeys(value, ["ordinal", "edge", "expectedAbsent"], "DerivedEdgeAbsentGuard")
  parseUint32(value.ordinal)
  assertEntityRef(value.edge, "edge")
  if (value.expectedAbsent !== true) invalid("derived edge expectedAbsent must be true")
}

function assertNodeTemplate(value: unknown): asserts value is NodeCreateTemplate {
  assertExactKeys(
    value,
    ["ordinal", "nodeId", "incarnation", "role", "position", "size", "data", "plugin"],
    "NodeCreateTemplate",
  )
  parseUint32(value.ordinal)
  assertDerivedId(value.nodeId, "n_", "nodeId")
  assertDerivedId(value.incarnation, "ni_", "incarnation")
  if (value.role !== "file" && value.role !== "agent") invalid("node role is invalid")
  assertPoint(value.position)
  assertSize(value.size)
  assertNodeData(value.data)
  if (value.plugin !== null) assertPluginState(value.plugin)
}

function assertEdgeTemplate(value: unknown): asserts value is EdgeCreateTemplate {
  assertExactKeys(value, ["ordinal", "edgeId", "incarnation", "source", "target", "data"], "EdgeCreateTemplate")
  parseUint32(value.ordinal)
  assertDerivedId(value.edgeId, "e_", "edgeId")
  assertDerivedId(value.incarnation, "ei_", "incarnation")
  assertEndpoint(value.source)
  assertEndpoint(value.target)
  assertEdgeData(value.data)
}

function assertEndpoint(value: unknown): void {
  if (typeof value === "object" && value !== null && "createdNodeOrdinal" in value) {
    assertExactKeys(value, ["createdNodeOrdinal"], "created endpoint")
    parseUint32(value.createdNodeOrdinal)
  } else assertEntityRef(value, "node")
}

function assertPlacement(value: unknown): void {
  assertExactKeys(value, ["anchor", "gap", "obstacleProjectionDigest"], "CausalPlacement")
  assertPoint(value.anchor)
  if (value.gap !== 24) invalid("placement gap must be 24")
  parseDigest(value.obstacleProjectionDigest)
}

function assertResourceNode(value: unknown): void {
  assertExactKeys(
    value,
    ["ordinal", "nodeId", "incarnation", "size", "title", "resource"],
    "ResourceNodeCreateSpec",
  )
  parseUint32(value.ordinal)
  assertDerivedId(value.nodeId, "n_", "nodeId")
  assertDerivedId(value.incarnation, "ni_", "incarnation")
  assertSize(value.size)
  assertString(value.title)
  assertResourceRef(value.resource)
}

function assertPendingNode(value: unknown): void {
  const hasGenerationRun = typeof value === "object" && value !== null && "generationRun" in value
  assertExactKeys(
    value,
    [
      "ordinal",
      "nodeId",
      "incarnation",
      "size",
      "title",
      "expectedClass",
      ...(hasGenerationRun ? ["generationRun"] : []),
    ],
    "PendingNodeCreateSpec",
  )
  parseUint32(value.ordinal)
  assertDerivedId(value.nodeId, "n_", "nodeId")
  assertDerivedId(value.incarnation, "ni_", "incarnation")
  assertSize(value.size)
  assertString(value.title)
  if (!new Set(["text", "image", "video", "audio", "file"]).has(value.expectedClass as string))
    invalid("expectedClass is invalid")
  if (value.generationRun !== undefined && parseCanvasNodeGenerationRun(value.generationRun) === undefined)
    invalid("generationRun is invalid")
}

function assertPluginSurfaceNode(value: unknown): void {
  assertExactKeys(value, ["ordinal", "nodeId", "incarnation", "size", "title", "plugin"], "PluginSurfaceCreateSpec")
  parseUint32(value.ordinal)
  assertDerivedId(value.nodeId, "n_", "nodeId")
  assertDerivedId(value.incarnation, "ni_", "incarnation")
  assertSize(value.size)
  assertString(value.title)
  assertPluginState(value.plugin)
}

function assertCreateSetGuard(value: unknown, resources: boolean): void {
  const keys = resources
    ? ["existingEndpoints", "derivedNodes", "derivedEdges", "resourceProofs"]
    : ["existingEndpoints", "derivedNodes", "derivedEdges"]
  assertExactKeys(value, keys, "create-set guard")
  assertArray(value.existingEndpoints, assertConnectableGuard)
  assertArray(value.derivedNodes, assertDerivedNodeGuard)
  assertArray(value.derivedEdges, assertDerivedEdgeGuard)
  if (resources) assertArray(value.resourceProofs, assertProofBinding)
}

function assertProofBinding(value: unknown): void {
  assertExactKeys(value, ["createdNodeOrdinal", "proof"], "resource proof binding")
  parseUint32(value.createdNodeOrdinal)
  assertResourceProof(value.proof, false)
}

function assertPluginGuard(value: unknown): void {
  assertExactKeys(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedPluginDigest", "requirement"],
    "PluginGuard",
  )
  assertEntityRef(value.node, "node")
  if (value.expectedLive !== true) invalid("plugin expectedLive must be true")
  parseDigest(value.expectedIdentityDigest)
  if (value.expectedPluginDigest !== null) parseDigest(value.expectedPluginDigest)
  if (value.requirement !== null) assertPluginRequirement(value.requirement)
}

function assertContainmentGuard(value: unknown): void {
  assertExactKeys(
    value,
    ["node", "expectedLive", "expectedIdentityDigest", "expectedOwnSlotDigest"],
    "ContainmentGuard",
  )
  assertEntityRef(value.node, "node")
  if (value.expectedLive !== true) invalid("containment expectedLive must be true")
  parseDigest(value.expectedIdentityDigest)
  if (value.expectedOwnSlotDigest !== null) parseDigest(value.expectedOwnSlotDigest)
}

function assertMetadataGuard(value: unknown): void {
  assertExactKeys(value, ["field", "expectedEffectiveDigest", "expectedOwnSlotDigest"], "MetadataFieldGuard")
  assertMetadataField(value.field)
  parseDigest(value.expectedEffectiveDigest)
  if (value.expectedOwnSlotDigest !== null) parseDigest(value.expectedOwnSlotDigest)
}

function assertMetadataUpdate(value: unknown): void {
  assertExactKeys(value, ["field", "value"], "MetadataFieldUpdate")
  assertMetadataField(value.field)
  if (value.field === "tags") {
    if (!Array.isArray(value.value)) invalid("tags update must be array")
  } else if (value.value !== null) assertString(value.value)
}

function assertGenerationBeginGuard(value: unknown): void {
  assertExactKeys(
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
  assertEntityRef(value.node, "node")
  if (value.expectedLive !== true) invalid("generation expectedLive must be true")
  for (const key of [
    "expectedIdentityDigest",
    "expectedEffectiveDataDigest",
    "expectedDataRegisterDigest",
    "expectedProjectedGenerationDigest",
  ] as const)
    parseDigest(value[key])
  if (value.expectedPluginDigest !== null) parseDigest(value.expectedPluginDigest)
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
  assertExactKeys(value, keys, "GenerationObservedGuardV2")
  assertEntityRef(value.node, "node")
  if (value.expectedLive !== true) invalid("generation expectedLive must be true")
  assertDerivedId(value.generationId, "g_", "generation id")
  for (const key of ["expectedIdentityDigest", "beginDigest", "expectedLifecycleDigest"] as const)
    parseDigest(value[key])
  for (const key of ["expectedTerminalDigest", "expectedDismissalDigest", "expectedRecoveryFailureDigest"] as const)
    if (value[key] !== null) parseDigest(value[key])
  if (resource) assertResourceProof(value.resourceProof, false)
}

function assertHistoryGuard(value: unknown, mode: "applied" | "undone"): asserts value is SemanticHistoryGuard {
  assertExactKeys(
    value,
    [
      "rootOperationId",
      "expectedRootReceiptDigest",
      "expectedHistoryRootDigest",
      "expectedHistoryStateDigest",
      "expectedMode",
    ],
    "SemanticHistoryGuard",
  )
  parseId128(value.rootOperationId)
  if (value.expectedMode !== mode) invalid("history mode is invalid")
  for (const key of ["expectedRootReceiptDigest", "expectedHistoryRootDigest", "expectedHistoryStateDigest"] as const)
    parseDigest(value[key])
}

function assertSemanticOperation(
  value: unknown,
  rootOperationId: import("@convax/collaboration").Id128,
  direction: "inverse" | "forward",
  operationIndex: import("@convax/collaboration").Uint32,
): asserts value is CanvasSemanticOperation {
  assertExactKeys(
    value,
    ["format", "template", "materializedGuard", "derived", "guardDigest", "retainedResourceProofs"],
    "CanvasSemanticOperation",
  )
  if (value.format !== "convax.canvas-semantic-operation") invalid("semantic operation format is invalid")
  assertHistoryTemplate(value.template)
  assertMaterializedHistoryGuard(value.materializedGuard, value.template)
  parseDigest(value.guardDigest)
  assertDenseArray(value.derived, "semantic derived")
  assertSemanticDerivedObjects(value.derived, value.template)
  assertDenseArray(value.retainedResourceProofs, "semantic retained proofs")
  assertSemanticResourceProofs(value.retainedResourceProofs, value.template)
  const guardDigest = canvasDigest("convax.canvas-semantic-guard", {
    format: "convax.canvas-semantic-guard",
    rootOperationId,
    direction,
    operationIndex,
    template: value.template,
    materializedGuard: value.materializedGuard,
  })
  if (value.guardDigest !== guardDigest) invalid("semantic operation guard digest is invalid")
}

function assertMaterializedHistoryGuard(value: unknown, template: CanvasHistoryTemplate): void {
  assertExactKeys(value, ["op", "guard"], "CanvasMaterializedHistoryGuard")
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
      assertExactKeys(value.guard, ["edge", "source", "target"], "history edge.create guard")
      assertDerivedEdgeGuard(value.guard.edge)
      assertConnectableGuard(value.guard.source)
      assertConnectableGuard(value.guard.target)
      return
    case "edge.tombstone":
      assertEdgeLiveGuard(value.guard)
      return
    case "containment.set":
      assertExactKeys(value.guard, ["child", "parent"], "history containment guard")
      assertContainmentGuard(value.guard.child)
      if (value.guard.parent !== null) assertNodeLiveGuard(value.guard.parent)
      return
    case "metadata.set":
      assertMetadataGuard(value.guard)
      return
    case "creation-group.restore":
      assertExactKeys(
        value.guard,
        ["source", "pluginRequirement", "derivedNodes", "derivedEdges"],
        "history creation-group guard",
      )
      assertNodeDataGuard(value.guard.source)
      assertPluginRequirement(value.guard.pluginRequirement)
      assertArray(value.guard.derivedNodes, assertDerivedNodeGuard)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      return
    case "pending-generation.restore":
      assertExactKeys(value.guard, ["lifecycle", "derivedNode", "derivedEdges"], "history pending guard")
      assertHistoryGenerationGuard(value.guard.lifecycle)
      assertDerivedNodeGuard(value.guard.derivedNode)
      assertArray(value.guard.derivedEdges, assertDerivedEdgeGuard)
      return
  }
}

function assertHistoryGenerationGuard(value: unknown): void {
  assertExactKeys(
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
  parseId128(value.rootOperationId)
  assertHistoryNodeHandle(value.nodeHandle)
  assertDerivedId(value.generationId, "g_", "generation id")
  parseDigest(value.retainedBeginDigest)
  parseDigest(value.expectedLifecycleDigest)
  for (const key of ["expectedTerminalDigest", "expectedDismissalDigest", "expectedRecoveryFailureDigest"] as const)
    if (value[key] !== null) parseDigest(value[key])
}

function assertSemanticDerivedObjects(values: readonly unknown[], template: CanvasHistoryTemplate): void {
  const derived: CanvasHistoryDerivedObject[] = []
  let priorOrdinal = -1
  for (const value of values) {
    assertSemanticDerivedObject(value)
    const ordinal = Number(parseUint32(value.ordinal))
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

function assertSemanticDerivedObject(value: unknown): asserts value is CanvasHistoryDerivedObject {
  if (typeof value !== "object" || value === null) invalid("semantic derived object must be an object")
  const kind = (value as { kind?: unknown }).kind
  switch (kind) {
    case "node":
      assertExactKeys(value, ["kind", "handle", "ordinal", "ref"], "history derived node")
      assertHistoryNodeHandle(value.handle)
      parseUint32(value.ordinal)
      assertEntityRef(value.ref, "node")
      return
    case "edge":
      assertExactKeys(value, ["kind", "handle", "ordinal", "ref"], "history derived edge")
      assertHistoryEdgeHandle(value.handle)
      parseUint32(value.ordinal)
      assertEntityRef(value.ref, "edge")
      return
    case "relation":
      assertExactKeys(value, ["kind", "ordinal", "relationId", "child"], "history derived relation")
      parseUint32(value.ordinal)
      assertDerivedId(value.relationId, "r_", "relation id")
      assertHistoryNodeTarget(value.child)
      return
    case "creation-group":
      assertExactKeys(value, ["kind", "handle", "ordinal", "groupId"], "history derived creation group")
      assertHistoryGroupHandle(value.handle)
      parseUint32(value.ordinal)
      assertDerivedId(value.groupId, "cg_", "creation group id")
      return
    default:
      invalid("unknown semantic derived object kind")
  }
}

function expectedDerivedKeys(template: CanvasHistoryTemplate): readonly string[] {
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

function derivedObjectKey(value: CanvasHistoryDerivedObject): string {
  if (value.kind === "relation") return `relation:${historyTargetKey(value.child)}`
  return `${value.kind}:${value.handle}`
}

function assertSemanticResourceProofs(values: readonly unknown[], template: CanvasHistoryTemplate): void {
  const resources = introducedResources(template)
  let prior: CanvasResourceRef | undefined
  const actual: CanvasResourceRef[] = []
  for (const value of values) {
    assertResourceProof(value, true)
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

function introducedResources(template: CanvasHistoryTemplate): readonly CanvasResourceRef[] {
  const values: CanvasResourceRef[] = []
  if (template.op === "node.create" && template.snapshot.resource !== null) values.push(template.snapshot.resource)
  if (template.op === "node.data" && template.resource !== null) values.push(template.resource)
  if (template.op === "creation-group.restore")
    for (const member of template.nodes) if (member.snapshot.resource !== null) values.push(member.snapshot.resource)
  return values
    .sort(compareResources)
    .filter((resource, index, all) => index === 0 || canonicalJson(resource) !== canonicalJson(all[index - 1]))
}

function compareResources(left: CanvasResourceRef, right: CanvasResourceRef): number {
  return (
    compareUtf8(left.contentDigest, right.contentDigest) ||
    compareUtf8(left.uri, right.uri) ||
    compareUtf8(canonicalJson(left), canonicalJson(right))
  )
}

function canonicalJson(value: unknown): string {
  return new TextDecoder().decode(encodeRestrictedJcs(value))
}

function assertHistoryNodeTarget(value: unknown): void {
  if (typeof value !== "object" || value === null) invalid("history node target must be an object")
  if ((value as { mode?: unknown }).mode === "handle") {
    assertExactKeys(value, ["mode", "handle"], "history node handle target")
    assertHistoryNodeHandle(value.handle)
    return
  }
  assertExactKeys(value, ["mode", "ref"], "history external node target")
  if (value.mode !== "external") invalid("history node target mode is invalid")
  assertEntityRef(value.ref, "node")
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
  parseUint32(value.slice(2))
}

function assertArray(value: unknown, validate: (item: any) => void): void {
  assertDenseArray(value, "array")
  for (const item of value) validate(item)
}

function assertMetadataField(value: unknown): void {
  if (value !== "title" && value !== "description" && value !== "tags") invalid("metadata field is invalid")
}

function assertString(value: unknown): void {
  if (typeof value !== "string" || value.normalize("NFC") !== value) invalid("string must be NFC")
}

function invalid(message: string): never {
  throw new CanvasSchemaError("invalid-intent", message)
}

// Compile-time equality: a missing/extra discriminator on either side is a type error.
type _KindsEqual = CanvasIntentKind extends keyof import("./types").CanvasIntentContractMap
  ? keyof import("./types").CanvasIntentContractMap extends CanvasIntentKind
    ? true
    : never
  : never
const kindsEqual: _KindsEqual = true
void kindsEqual
void assertContainmentChoice
