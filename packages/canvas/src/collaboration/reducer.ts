import {
  compareUtf8,
  comparePortableStamps,
  encodeRestrictedJcs,
  parseDigest,
  parseUint32,
  uint32ToNumber,
  type OwnerIntentConstructionContext,
  type OwnerIntentValidationContext,
} from "@convax/collaboration"
import * as Y from "yjs"
import type {
  BoundedOperationReceiptV2,
  CanvasActualWriteEvidenceV2,
  CanvasActualWriteV2,
  CanvasEdgeSnapshotV2,
  CanvasEntityRefV2,
  CanvasExternalFactContextV2,
  CanvasHistoryBindingV2,
  CanvasHistoryDerivedObjectV2,
  CanvasHistoryEdgeSnapshotV2,
  CanvasHistoryFootprintCoreV2,
  CanvasHistoryNodeSnapshotV2,
  CanvasHistoryNodeTargetV2,
  CanvasHistoryTemplateV2,
  CanvasIntentApplyResultV2,
  CanvasNodeSnapshotV2,
  CanvasOperationIdV2,
  CanvasResourceRefV2,
  CanvasResourceProofRefV2,
  CanvasSemanticOperationV2,
  CanvasSnapshotV2,
  CanvasTypedIntentUnionV2,
  CanvasUndoableIntentKindV2,
  CreationGroupRefV2,
  Digest,
  NodeDataEnvelopeV2,
  PluginRequirementV2,
  SemanticHistoryRootV2,
  SemanticHistoryTransitionV2,
  Uint32,
} from "./types"
import {
  buildCanvasProjectionIndexV2,
  dataRegisterDigestV2,
  edgeIdentityDigestV2,
  effectiveDataDigestV2,
  effectiveNodeDataV2,
  effectivePluginDigestV2,
  effectivePluginV2,
  generationLifecycleCoreV2,
  generationLifecycleDigestV2,
  geometryDigestV2,
  nodeIdentityDigestV2,
  obstacleProjectionDigestV2,
  projectedGenerationDigestV2,
} from "./projection"
import {
  actualWriteValueDigestV2,
  canvasDigestV2,
  canvasEntityKeyV2,
  containmentKeyV2,
  derivedEdgeRefV2,
  derivedNodeRefV2,
  deriveCanvasIdV2,
  historyRootKeyV2,
  historyTransitionKeyV2,
  makeStampV2,
  operationKeyV2,
  sameCanonicalValueV2,
  strictSortedUnique,
  CanvasSchemaErrorV2,
} from "./validation"
import { getCanvasChildMapV2, validateCanvasYDocV2 } from "./ydoc"
import { planCanvasHistoryDerivedOrdinalsV2, scheduleCanvasHistoryTemplatesV2 } from "./history-schedule"

export type CanvasReducerOutcomeV2 = CanvasIntentApplyResultV2 | "pending" | "rejected"

interface PlannedWrite {
  readonly path: string
  readonly entityKind: CanvasActualWriteV2["entityKind"]
  readonly entityId: string
  readonly field: string
  readonly value: (ordinal: Uint32) => unknown
  readonly apply: (value: unknown) => void
}

const UNDOABLE = new Set<string>([
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
  "canvas.plugin.creation-group.create/2",
  "canvas.plugin.surface.create",
])

interface ProvisionalHistoryNodeV2 {
  readonly ref: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly role: "file" | "agent"
  readonly data: NodeDataEnvelopeV2
  readonly plugin: import("./types").PluginStateEnvelopeV2 | null
  readonly position: import("./types").CanvasPointV2
  readonly size: import("./types").CanvasSizeV2
  readonly dataWriteOrdinal: Uint32
  readonly createdBy: CanvasOperationIdV2
}

/**
 * Pure owner-side construction of one closed semantic history intent.
 * It allocates from the imported construction context only and never mutates a Y.Doc.
 */
export function materializeCanvasSemanticHistoryIntentV2(
  base: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  direction: "undo" | "redo",
  rootOperationId: CanvasOperationIdV2,
): CanvasTypedIntentUnionV2 | "rejected" {
  try {
    if (
      context.scope.docKind !== "canvas" ||
      context.scope.docId !== base.identity.canvasId ||
      context.ownerSchemaDigest !== base.identity.ownerSchemaDigest ||
      context.protocolDigest !== base.identity.protocolDigest
    )
      throw new CanvasSchemaErrorV2("scope-mismatch", "History construction context does not bind the Canvas")
    const rootValue = base.semanticHistory.get(historyRootKeyV2(rootOperationId))
    if (rootValue?.format !== "convax.canvas-semantic-history-root/2")
      throw new CanvasSchemaErrorV2("history-root-missing", "Semantic history root is absent")
    const receipts = [...base.operations.values()].filter((candidate) => candidate.operationId === rootOperationId)
    if (receipts.length !== 1)
      throw new CanvasSchemaErrorV2("history-root-receipt", "Semantic history root receipt is absent or ambiguous")
    const receipt = receipts[0]!
    const state = semanticHistoryState(base, rootValue, receipt)
    const expectedMode = direction === "undo" ? "applied" : "undone"
    if (state.mode !== expectedMode)
      throw new CanvasSchemaErrorV2("history-mode", "Semantic history is not in the requested source phase")
    assertCurrentHistoryPhaseV2(base, rootValue, state.bindings, direction)

    const selected = scheduleCanvasHistoryTemplatesV2(
      direction === "undo" ? rootValue.inverseTemplate : rootValue.forwardTemplate,
      state.bindings,
    )
    const ordinalPlan = planCanvasHistoryDerivedOrdinalsV2(selected, state.bindings)
    const derivedByOperation: CanvasHistoryDerivedObjectV2[][] = []
    let ordinalCursor = 0
    for (const template of selected) {
      const count = historyDerivedCountV2(template)
      const slice = ordinalPlan.slice(ordinalCursor, ordinalCursor + count)
      if (slice.length !== count) throw new CanvasSchemaErrorV2("history-ordinal", "History ordinal plan truncated")
      derivedByOperation.push(
        slice.map((planned) => historyDerivedObjectV2(planned, template, context)),
      )
      ordinalCursor += count
    }
    if (ordinalCursor !== ordinalPlan.length)
      throw new CanvasSchemaErrorV2("history-ordinal", "History ordinal plan has trailing allocations")

    const writeOrdinals = historyPlannedWriteOrdinalsV2(selected, derivedByOperation, state.bindings, context)
    const bindings = new Map(state.bindings.map((binding) => [binding.handle, binding.ref] as const))
    const provisionalNodes = new Map<string, ProvisionalHistoryNodeV2>()
    const operations: CanvasSemanticOperationV2[] = []
    for (const [index, template] of selected.entries()) {
      const derived = derivedByOperation[index]!
      const materializedGuard = materializedHistoryGuardV2(
        base,
        context,
        rootValue,
        template,
        bindings,
        provisionalNodes,
        derived,
      )
      const retainedResourceProofs = retainedHistoryProofsV2(
        base,
        rootValue,
        direction,
        template,
        bindings,
      )
      const operationIndex = parseUint32(String(index))
      const guardDigest = canvasDigestV2("convax.canvas-semantic-guard/2", {
        format: "convax.canvas-semantic-guard/2",
        rootOperationId,
        direction: direction === "undo" ? "inverse" : "forward",
        operationIndex,
        template,
        materializedGuard,
      })
      operations.push(Object.freeze({
        format: "convax.canvas-semantic-operation/2",
        template,
        materializedGuard,
        derived: Object.freeze(derived),
        guardDigest,
        retainedResourceProofs: Object.freeze(retainedResourceProofs),
      }))
      publishHistoryProvisionalResultsV2(
        template,
        derived,
        bindings,
        provisionalNodes,
        writeOrdinals,
        context,
      )
    }
    const guard = Object.freeze({
      rootOperationId,
      expectedRootReceiptDigest: canvasDigestV2("convax.canvas-operation-receipt/2", receipt),
      expectedHistoryRootDigest: canvasDigestV2("convax.canvas-semantic-history-root/2", rootValue),
      expectedHistoryStateDigest: state.digest,
      expectedMode,
    })
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: direction === "undo" ? "canvas.undo.semantic-inverse/2" : "canvas.redo.semantic-forward/2",
      guard,
      body: Object.freeze({ operations: Object.freeze(operations) }),
    }) as CanvasTypedIntentUnionV2
  } catch {
    return "rejected"
  }
}

function reduceCanvasIntentInternalV2(
  candidate: Y.Doc,
  context: OwnerIntentValidationContext,
  intent: CanvasTypedIntentUnionV2,
  externalFacts: CanvasExternalFactContextV2,
): CanvasReducerOutcomeV2 {
  try {
    assertContext(context)
    const base = validateCanvasYDocV2(candidate)
    if (
      context.scope.docKind !== "canvas" ||
      base.identity.canvasId !== context.scope.docId ||
      base.identity.ownerSchemaDigest !== context.ownerSchemaDigest ||
      base.identity.protocolDigest !== context.protocolDigest
    )
      throw new CanvasSchemaErrorV2("scope-mismatch", "Canvas operation context does not bind the candidate identity")
    if (base.operations.has(operationKeyV2(context.actorId, context.operationId)))
      throw new CanvasSchemaErrorV2("operation-replay", "Operation receipt already exists")
    const writes: PlannedWrite[] = []
    const resultEntities: CanvasEntityRefV2[] = []
    const invalidatedEntities: CanvasEntityRefV2[] = []
    const invalidatedMetaFields: ("title" | "description" | "tags")[] = []
    const baseIndex = buildCanvasProjectionIndexV2(base)

    const fact = planIntent(
      intent,
      base,
      baseIndex,
      context,
      externalFacts,
      writes,
      resultEntities,
      invalidatedEntities,
      invalidatedMetaFields,
    )
    if (fact !== "valid") return fact === "pending" ? "pending" : "rejected"
    writes.sort((left, right) => compareUtf8(left.path, right.path))
    strictSortedUnique(writes, (write) => write.path, "Canvas actual changed paths")

    let historyRoot: SemanticHistoryRootV2 | null = null
    const isHistoryTransition =
      intent.kind === "canvas.undo.semantic-inverse/2" || intent.kind === "canvas.redo.semantic-forward/2"
    const receiptKey = operationKeyV2(context.actorId, context.operationId)
    const provisionalReceipt: BoundedOperationReceiptV2 = {
      format: "convax.canvas-operation-receipt/2",
      operationId: context.operationId,
      actorId: context.actorId,
      intentKind: intent.kind,
      intentDigest: context.intentDigest,
      baseFrontierDigest: context.baseFrontierDigest,
      resultEntities: sortedRefs(resultEntities),
      semanticRoot: false,
      historyMaterialDigest: null,
    }
    candidate.transact(() => {
      applyPlannedWrites(writes, context)
      // Creation-group validation binds the complete creator receipt. Install a
      // transaction-local acyclic receipt before reading the authored post state;
      // the same key is replaced with its final history binding below.
      const operations = getCanvasChildMapV2(candidate, "operations")
      writeJson(operations, receiptKey, provisionalReceipt)
      const postDomain = validateCanvasYDocV2(candidate)
      if (UNDOABLE.has(intent.kind))
        historyRoot = captureHistoryRootV2(base, postDomain, intent, context, resultEntities)
      const receipt: BoundedOperationReceiptV2 = {
        format: "convax.canvas-operation-receipt/2",
        operationId: context.operationId,
        actorId: context.actorId,
        intentKind: intent.kind,
        intentDigest: context.intentDigest,
        baseFrontierDigest: context.baseFrontierDigest,
        resultEntities: sortedRefs(resultEntities),
        semanticRoot: historyRoot !== null,
        historyMaterialDigest: historyRoot?.materialDigest ?? null,
      }
      if (historyRoot !== null) {
        const path = `semanticHistory/${historyRootKeyV2(context.operationId)}`
        writeJson(getCanvasChildMapV2(candidate, "semanticHistory"), historyRootKeyV2(context.operationId), historyRoot)
        writes.push(logicalValueWrite(path, "history", context.operationId, "root", historyRoot))
      } else if (isHistoryTransition) {
        const transition = createHistoryTransitionV2(validateCanvasYDocV2(candidate), intent, context)
        const key = historyTransitionKeyV2(transition.rootOperationId, context.actorId, context.operationId)
        writeJson(getCanvasChildMapV2(candidate, "semanticHistory"), key, transition)
        writes.push(
          logicalValueWrite(
            `semanticHistory/${key}`,
            "history",
            transition.rootOperationId,
            `transition/actor/${context.actorId}/operation/${context.operationId}`,
            transition,
          ),
        )
      }
      writeJson(operations, receiptKey, receipt)
      writes.push(logicalValueWrite(`operations/${receiptKey}`, "operation", receiptKey, "receipt", receipt))
    }, `canvas-intent:${intent.kind}`)

    writes.sort((left, right) => compareUtf8(left.path, right.path))
    if (writes.length > 512)
      throw new CanvasSchemaErrorV2("write-count-overflow", "Canvas intent exceeds 512 logical writes")
    const changedPaths = writes.map((write) => write.path)
    const actualWrites = writes
      .map((write) => {
        const value = valueAtPath(candidate, write.path)
        const bare = { entityKind: write.entityKind, entityId: write.entityId, field: write.field }
        return { ...bare, valueDigest: actualWriteValueDigestV2(write.path, bare, value) }
      })
      .sort(compareActualWrites)
    const evidence: CanvasActualWriteEvidenceV2 = {
      format: "convax.canvas-actual-write-evidence/2",
      changedPaths,
      writes: actualWrites,
    }
    if (encodeRestrictedJcs(evidence).byteLength > 256 * 1024)
      throw new CanvasSchemaErrorV2("evidence-too-large", "Canvas write evidence exceeds 256 KiB")
    validateCanvasYDocV2(candidate)
    const receipt = getCanvasChildMapV2(candidate, "operations").get(
      operationKeyV2(context.actorId, context.operationId),
    ) as BoundedOperationReceiptV2
    return Object.freeze({
      format: "convax.canvas-intent-result/2",
      receipt,
      actualWriteEvidence: evidence,
      semanticHistoryRoot: historyRoot,
      invalidatedEntities: sortedRefs(invalidatedEntities),
      invalidatedMetaFields: [...new Set(invalidatedMetaFields)].sort(compareUtf8),
    })
  } catch (error) {
    if (error instanceof CanvasPendingFactError) return "pending"
    if (error instanceof CanvasSchemaErrorV2 || error instanceof TypeError || error instanceof RangeError)
      return "rejected"
    throw error
  }
}

function planIntent(
  intent: CanvasTypedIntentUnionV2,
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  context: OwnerIntentValidationContext,
  facts: CanvasExternalFactContextV2,
  writes: PlannedWrite[],
  results: CanvasEntityRefV2[],
  invalidated: CanvasEntityRefV2[],
  invalidatedMeta: ("title" | "description" | "tags")[],
): "valid" | "pending" | "invalid" {
  switch (intent.kind) {
    case "canvas.agent.create": {
      if (intent.body.node.ordinal !== "0") return "invalid"
      const ref = requireDerivedNode(base, context, intent.guard, intent.body.node)
      if (
        intent.body.node.role !== "agent" ||
        intent.body.node.data.kind !== "agent" ||
        intent.body.node.plugin !== null
      )
        return "invalid"
      planNodeCreate(writes, ref, intent.body.node, context, null)
      results.push(ref)
      invalidated.push(ref)
      return "valid"
    }
    case "canvas.resources.add/2":
    case "canvas.resources.pending.create/2": {
      const resourceMode = intent.kind === "canvas.resources.add/2"
      if (
        intent.body.nodes.length < 1 ||
        intent.body.nodes.length > 85 ||
        intent.body.edges.length > 168 ||
        6 * intent.body.nodes.length + 3 * intent.body.edges.length + 2 > 512
      )
        return "invalid"
      if (!hasContiguousCreationOrdinals([...intent.body.nodes, ...intent.body.edges])) return "invalid"
      requirePlacement(base, intent.body.placement)
      for (const guard of intent.guard.existingEndpoints) requireConnectable(base, index, guard)
      const nodeRefs = new Map<string, CanvasEntityRefV2 & { kind: "node" }>()
      const positions = placeCreatedNodes(
        base,
        intent.body.placement.anchor,
        intent.body.nodes.map((node) => ({ ordinal: node.ordinal, size: node.size })),
      )
      for (const [positionIndex, node] of intent.body.nodes.entries()) {
        const guard = intent.guard.derivedNodes.find((candidate) => candidate.ordinal === node.ordinal)
        if (guard === undefined) return "invalid"
        const ref = requireDerivedNode(base, context, guard, node)
        if (resourceMode) {
          const resourceNode = node as (typeof intent.body.nodes)[number] & { resource: CanvasResourceRefV2 }
          const proof = (intent.guard as Extract<typeof intent.guard, { resourceProofs: unknown }>).resourceProofs.find(
            (binding) => binding.createdNodeOrdinal === node.ordinal,
          )
          if (proof === undefined || !sameCanonicalValueV2(proof.proof.resource, resourceNode.resource))
            return "invalid"
          requireFact(facts.validateCurrentResource(proof.proof))
          planNodeCreate(
            writes,
            ref,
            {
              ...node,
              role: "file",
              position: positions[positionIndex]!,
              data: {
                format: "convax.canvas-node-data/2",
                kind: "resource",
                title: node.title,
                resource: resourceNode.resource,
              },
              plugin: null,
            },
            context,
            null,
          )
        } else {
          const pending = node as (typeof intent.body.nodes)[number] & {
            expectedClass: "text" | "image" | "video" | "audio" | "file"
          }
          planNodeCreate(
            writes,
            ref,
            {
              ...node,
              role: "file",
              position: positions[positionIndex]!,
              data: {
                format: "convax.canvas-node-data/2",
                kind: "placeholder",
                owner: "manual-pending",
                title: node.title,
                expectedClass: pending.expectedClass,
                state: { phase: "pending" },
              },
              plugin: null,
            },
            context,
            null,
          )
        }
        nodeRefs.set(node.ordinal, ref)
        results.push(ref)
        invalidated.push(ref)
      }
      for (const edge of intent.body.edges) {
        const guard = intent.guard.derivedEdges.find((candidate) => candidate.ordinal === edge.ordinal)
        if (guard === undefined) return "invalid"
        const ref = requireDerivedEdge(base, context, guard, edge)
        const source = resolveEndpoint(edge.source, nodeRefs, base, index)
        const target = resolveEndpoint(edge.target, nodeRefs, base, index)
        planEdgeCreate(writes, ref, source, target, edge.data, context, null)
        results.push(ref)
        invalidated.push(ref)
      }
      return "valid"
    }
    case "canvas.resources.pending-generation.create/2": {
      if (intent.body.edges.length > 167 || 3 * intent.body.edges.length + 9 > 512) return "invalid"
      if (!hasContiguousCreationOrdinals([intent.body.node, ...intent.body.edges])) return "invalid"
      requirePlacement(base, intent.body.placement)
      for (const guard of intent.guard.existingEndpoints) requireConnectable(base, index, guard)
      const node = intent.body.node
      const ref = requireDerivedNode(base, context, intent.guard.derivedNode, node)
      const position = placeCreatedNodes(base, intent.body.placement.anchor, [
        { ordinal: node.ordinal, size: node.size },
      ])[0]!
      if (
        canvasEntityKeyV2(intent.body.begin.node) !== canvasEntityKeyV2(ref) ||
        intent.body.begin.beginActorId !== context.actorId ||
        intent.body.begin.beginStamp.writeOrdinal !== "5" ||
        intent.body.begin.outputClaimStamp.writeOrdinal !== "6" ||
        intent.body.begin.generationId !== deriveCanvasIdV2("generation", context, intent.body.node.ordinal)
      )
        return "invalid"
      requireFact(facts.validateGenerationBegin(intent.body.begin))
      planNodeCreate(
        writes,
        ref,
        {
          ...node,
          role: "file",
          position,
          data: {
            format: "convax.canvas-node-data/2",
            kind: "placeholder",
            owner: "generation",
            title: node.title,
            expectedClass: node.expectedClass,
          },
          plugin: null,
        },
        context,
        null,
      )
      planJsonWrite(
        writes,
        `generationBegins/${intent.body.begin.generationId}`,
        "generation",
        intent.body.begin.generationId,
        "begin",
        intent.body.begin,
        getMapSetter("generationBegins", intent.body.begin.generationId),
      )
      const nodeRefs = new Map([[node.ordinal, ref]])
      for (const edge of intent.body.edges) {
        const guard = intent.guard.derivedEdges.find((candidate) => candidate.ordinal === edge.ordinal)
        if (guard === undefined) return "invalid"
        const edgeRef = requireDerivedEdge(base, context, guard, edge)
        planEdgeCreate(
          writes,
          edgeRef,
          resolveEndpoint(edge.source, nodeRefs, base, index),
          resolveEndpoint(edge.target, nodeRefs, base, index),
          edge.data,
          context,
          null,
        )
        results.push(edgeRef)
        invalidated.push(edgeRef)
      }
      results.push(ref)
      invalidated.push(ref)
      return "valid"
    }
    case "canvas.elements.remove/2": {
      if (
        !intent.guard.requireObservedIncidentEdgeClosure ||
        intent.body.nodes.length + intent.body.edges.length < 1 ||
        intent.body.nodes.length + intent.body.edges.length > 510
      )
        return "invalid"
      const observedEdges = new Set(intent.body.edges.map(canvasEntityKeyV2))
      for (const nodeRef of intent.body.nodes) {
        const guard = intent.guard.nodes.find(
          (candidate) => canvasEntityKeyV2(candidate.node) === canvasEntityKeyV2(nodeRef),
        )
        if (guard === undefined) return "invalid"
        requireNode(base, index, guard)
        for (const edge of index.projection.edges)
          if (
            (canvasEntityKeyV2(edge.source) === canvasEntityKeyV2(nodeRef) ||
              canvasEntityKeyV2(edge.target) === canvasEntityKeyV2(nodeRef)) &&
            !observedEdges.has(canvasEntityKeyV2(edge.ref))
          )
            return "invalid"
        planTombstone(writes, nodeRef, context)
        results.push(nodeRef)
        invalidated.push(nodeRef)
      }
      for (const edgeRef of intent.body.edges) {
        const guard = intent.guard.edges.find(
          (candidate) => canvasEntityKeyV2(candidate.edge) === canvasEntityKeyV2(edgeRef),
        )
        if (guard === undefined) return "invalid"
        requireEdge(base, index, guard)
        planTombstone(writes, edgeRef, context)
        results.push(edgeRef)
        invalidated.push(edgeRef)
      }
      return "valid"
    }
    case "canvas.nodes.set-geometry/2": {
      if (
        intent.body.updates.length < 1 ||
        intent.body.updates.length > 256 ||
        intent.body.updates.length + intent.body.updates.filter((update) => update.size !== null).length + 2 > 512
      )
        return "invalid"
      for (const update of intent.body.updates) {
        const guard = intent.guard.nodes.find(
          (candidate) => canvasEntityKeyV2(candidate.node) === canvasEntityKeyV2(update.node),
        )
        if (guard === undefined) return "invalid"
        const node = requireNode(base, index, guard)
        if (geometryDigestV2(node) !== guard.expectedGeometryDigest) return "invalid"
        planClaim(writes, "node", update.node, "position", update.position, context)
        if (update.size !== null) planClaim(writes, "node", update.node, "size", update.size, context)
        results.push(update.node)
        invalidated.push(update.node)
      }
      return "valid"
    }
    case "canvas.nodes.update-data/2": {
      const node = requireNodeData(base, index, intent.guard.node)
      if (canvasEntityKeyV2(intent.body.node) !== node.key) return "invalid"
      if (intent.body.data.kind === "agent" ? node.identity.role !== "agent" : node.identity.role !== "file")
        return "invalid"
      const beforeResource = effectiveNodeDataV2(base, node).data
      const afterResource = intent.body.data
      const changesResource = !sameCanonicalValueV2(
        beforeResource.kind === "resource" ? beforeResource.resource : null,
        afterResource.kind === "resource" ? afterResource.resource : null,
      )
      if (changesResource !== (intent.guard.resourceProof !== null)) return "invalid"
      if (intent.guard.resourceProof !== null) {
        if (
          afterResource.kind !== "resource" ||
          !sameCanonicalValueV2(intent.guard.resourceProof.resource, afterResource.resource)
        )
          return "invalid"
        requireFact(facts.validateCurrentResource(intent.guard.resourceProof))
      }
      planClaim(writes, "node", intent.body.node, "data", intent.body.data, context)
      results.push(intent.body.node)
      invalidated.push(intent.body.node)
      return "valid"
    }
    case "canvas.nodes.set-plugin-state/2": {
      const node = requireNode(base, index, intent.guard.node)
      if (
        effectivePluginDigestV2(node) !== intent.guard.node.expectedPluginDigest ||
        !sameRequirement(intent.body.plugin, intent.guard.node.requirement)
      )
        return "invalid"
      if (intent.body.plugin !== null) requireFact(facts.validatePluginState(intent.body.plugin))
      planClaim(writes, "node", intent.body.node, "plugin", intent.body.plugin, context)
      results.push(intent.body.node)
      invalidated.push(intent.body.node)
      return "valid"
    }
    case "canvas.nodes.set-structural-parent/2": {
      const child = requireNode(base, index, intent.guard.child)
      if (
        canvasEntityKeyV2(child.identity.ref) !== canvasEntityKeyV2(intent.body.child) ||
        ownContainmentSlotDigest(base, child.identity.ref, context.actorId) !== intent.guard.child.expectedOwnSlotDigest
      )
        return "invalid"
      if (intent.body.parent !== null) {
        if (
          intent.guard.parent === null ||
          canvasEntityKeyV2(intent.guard.parent.node) !== canvasEntityKeyV2(intent.body.parent)
        )
          return "invalid"
        const parent = requireNode(base, index, intent.guard.parent)
        if (effectiveNodeDataV2(base, parent).data.kind !== "group") return "invalid"
      }
      const expectedRelation = deriveCanvasIdV2("relation", context, "0" as Uint32)
      if (intent.body.relationId !== expectedRelation) return "invalid"
      planContainment(writes, intent.body.child, intent.body.parent, intent.body.relationId, context)
      results.push(intent.body.child)
      invalidated.push(intent.body.child)
      return "valid"
    }
    case "canvas.nodes.group/2": {
      if (
        intent.body.children.length < 1 ||
        intent.body.children.length > 256 ||
        intent.body.children.length !== intent.body.relationIds.length
      )
        return "invalid"
      if (
        intent.body.group.ordinal !== "0" ||
        intent.body.relationIds.some(
          (relationId, index) => relationId !== deriveCanvasIdV2("relation", context, String(index + 1) as Uint32),
        )
      )
        return "invalid"
      const groupRef = requireDerivedNode(base, context, intent.guard.group, intent.body.group)
      if (
        intent.body.group.role !== "file" ||
        intent.body.group.data.kind !== "group" ||
        intent.body.group.plugin !== null
      )
        return "invalid"
      const childGeometry = intent.body.children
        .map((ref) => {
          const node = requireNode(
            base,
            index,
            intent.guard.children.find((guard) => canvasEntityKeyV2(guard.node) === canvasEntityKeyV2(ref))!,
          )
          return { node: ref, position: effectivePosition(node), size: effectiveSize(node) }
        })
        .sort((a, b) => compareUtf8(canvasEntityKeyV2(a.node), canvasEntityKeyV2(b.node)))
      const planDigest = canvasDigestV2("convax.canvas-group-geometry-plan/2", {
        format: "convax.canvas-group-geometry-plan/2",
        children: childGeometry,
        groupPosition: intent.body.group.position,
        groupSize: intent.body.group.size,
      })
      if (planDigest !== intent.guard.expectedGeometryPlanDigest) return "invalid"
      planNodeCreate(writes, groupRef, intent.body.group, context, null)
      results.push(groupRef)
      invalidated.push(groupRef)
      for (const [position, child] of intent.body.children.entries()) {
        const guard = intent.guard.children.find(
          (candidate) => canvasEntityKeyV2(candidate.node) === canvasEntityKeyV2(child),
        )
        if (
          guard === undefined ||
          ownContainmentSlotDigest(base, child, context.actorId) !== guard.expectedOwnSlotDigest
        )
          return "invalid"
        planContainment(writes, child, groupRef, intent.body.relationIds[position]!, context)
        results.push(child)
        invalidated.push(child)
      }
      return "valid"
    }
    case "canvas.nodes.ungroup/2": {
      const group = requireNode(base, index, intent.guard.group)
      if (
        intent.body.nullRelationIds.some(
          (relationId, position) => relationId !== deriveCanvasIdV2("relation", context, String(position) as Uint32),
        )
      )
        return "invalid"
      if (effectiveNodeDataV2(base, group).data.kind !== "group") return "invalid"
      const effectiveChildren = [...index.selectedContainments.entries()]
        .filter(
          ([, choice]) => choice?.parent !== null && choice !== null && canvasEntityKeyV2(choice.parent) === group.key,
        )
        .map(([key]) => base.nodes.get(key)!.identity.ref)
        .sort((a, b) => compareUtf8(canvasEntityKeyV2(a), canvasEntityKeyV2(b)))
      const digest = canvasDigestV2("convax.canvas-effective-child-set/2", {
        format: "convax.canvas-effective-child-set/2",
        group: group.identity.ref,
        children: effectiveChildren,
      })
      if (
        digest !== intent.guard.expectedEffectiveChildSetDigest ||
        !sameCanonicalValueV2(effectiveChildren, intent.body.children) ||
        intent.body.children.length !== intent.body.nullRelationIds.length
      )
        return "invalid"
      for (const [position, child] of intent.body.children.entries()) {
        const guard = intent.guard.children.find(
          (candidate) => canvasEntityKeyV2(candidate.node) === canvasEntityKeyV2(child),
        )
        if (
          guard === undefined ||
          ownContainmentSlotDigest(base, child, context.actorId) !== guard.expectedOwnSlotDigest
        )
          return "invalid"
        planContainment(writes, child, null, intent.body.nullRelationIds[position]!, context)
        results.push(child)
        invalidated.push(child)
      }
      planTombstone(writes, intent.body.group, context)
      results.push(intent.body.group)
      invalidated.push(intent.body.group)
      return "valid"
    }
    case "canvas.edges.connect/2": {
      if (intent.body.edge.ordinal !== "0") return "invalid"
      const ref = requireDerivedEdge(base, context, intent.guard.edge, intent.body.edge)
      if ("createdNodeOrdinal" in intent.body.edge.source || "createdNodeOrdinal" in intent.body.edge.target)
        return "invalid"
      requireConnectable(base, index, intent.guard.source)
      requireConnectable(base, index, intent.guard.target)
      if (
        canvasEntityKeyV2(intent.body.edge.source) !== canvasEntityKeyV2(intent.guard.source.node) ||
        canvasEntityKeyV2(intent.body.edge.target) !== canvasEntityKeyV2(intent.guard.target.node)
      )
        return "invalid"
      planEdgeCreate(
        writes,
        ref,
        intent.guard.source.node,
        intent.guard.target.node,
        intent.body.edge.data,
        context,
        null,
      )
      results.push(ref)
      invalidated.push(ref)
      return "valid"
    }
    case "canvas.metadata.update/2": {
      if (intent.body.fields.length < 1 || intent.body.fields.length > 3) return "invalid"
      for (const update of intent.body.fields) {
        const guard = intent.guard.fields.find((candidate) => candidate.field === update.field)
        if (
          guard === undefined ||
          metadataEffectiveDigest(base, update.field) !== guard.expectedEffectiveDigest ||
          metadataOwnSlotDigest(base, update.field, context.actorId) !== guard.expectedOwnSlotDigest
        )
          return "invalid"
        planMetadata(writes, base.identity.canvasId, update.field, update.value, context)
        invalidatedMeta.push(update.field)
      }
      return "valid"
    }
    case "canvas.generation.begin/2": {
      const node = requireNodeData(base, index, intent.guard)
      if (
        node.identity.role !== "file" ||
        effectivePluginDigestV2(node) !== intent.guard.expectedPluginDigest ||
        projectedGenerationDigestV2(base, node.identity.ref) !== intent.guard.expectedProjectedGenerationDigest
      )
        return "invalid"
      const begin = intent.body.begin
      if (
        canvasEntityKeyV2(begin.node) !== node.key ||
        begin.beginActorId !== context.actorId ||
        begin.beginStamp.writeOrdinal !== "0" ||
        begin.outputClaimStamp.writeOrdinal !== "1" ||
        base.generationBegins.has(begin.generationId)
      )
        return "invalid"
      if (deriveCanvasIdV2("generation", context, "0" as Uint32) !== begin.generationId) return "invalid"
      requireFact(facts.validateGenerationBegin(begin))
      planJsonWrite(
        writes,
        `generationBegins/${begin.generationId}`,
        "generation",
        begin.generationId,
        "begin",
        begin,
        getMapSetter("generationBegins", begin.generationId),
      )
      invalidated.push(node.identity.ref)
      return "valid"
    }
    case "canvas.generation.complete/2":
    case "canvas.generation.fail/2": {
      const node = requireGenerationGuard(base, index, intent.guard)
      if (
        intent.body.terminal.beginActorId !== context.actorId ||
        intent.body.terminal.beginActorId !== base.generationBegins.get(intent.guard.generationId)?.beginActorId ||
        intent.guard.expectedTerminalDigest !== null
      )
        return "invalid"
      if (intent.kind === "canvas.generation.complete/2") {
        if (
          intent.body.terminal.phase !== "succeeded" ||
          !sameCanonicalValueV2(intent.guard.resourceProof.resource, intent.body.terminal.outputData.resource) ||
          intent.body.terminal.outputProofDigest !== intent.guard.resourceProof.ownerProofDigest
        )
          return "invalid"
        requireFact(facts.validateCurrentResource(intent.guard.resourceProof))
      }
      const key = `${intent.guard.generationId}/owner/${context.actorId}`
      planJsonWrite(
        writes,
        `generationTerminals/${key}`,
        "generation",
        intent.guard.generationId,
        `terminal/owner/${context.actorId}`,
        intent.body.terminal,
        getMapSetter("generationTerminals", key),
      )
      invalidated.push(node.identity.ref)
      return "valid"
    }
    case "canvas.generations.fail-owned/2": {
      if (
        !intent.guard.requireBeginActorEqualsOperationActor ||
        intent.body.failures.length < 1 ||
        intent.body.failures.length > 256 ||
        intent.body.failures.length !== intent.guard.generations.length
      )
        return "invalid"
      for (const failure of intent.body.failures) {
        const guard = intent.guard.generations.find((candidate) => candidate.generationId === failure.generationId)
        if (guard === undefined) return "invalid"
        const node = requireGenerationGuard(base, index, guard)
        const begin = base.generationBegins.get(failure.generationId)!
        if (
          begin.beginActorId !== context.actorId ||
          guard.expectedTerminalDigest !== null ||
          failure.beginDigest !== guard.beginDigest
        )
          return "invalid"
        const terminal = {
          format: "convax.canvas-generation-terminal/2",
          phase: "failed",
          generationId: failure.generationId,
          node: begin.node,
          beginDigest: failure.beginDigest,
          beginActorId: context.actorId,
          failureCode: failure.failureCode,
          publicMessage: failure.publicMessage,
        } as const
        const key = `${failure.generationId}/owner/${context.actorId}`
        planJsonWrite(
          writes,
          `generationTerminals/${key}`,
          "generation",
          failure.generationId,
          `terminal/owner/${context.actorId}`,
          terminal,
          getMapSetter("generationTerminals", key),
        )
        invalidated.push(node.identity.ref)
      }
      return "valid"
    }
    case "canvas.generation.dismiss/2": {
      const node = requireGenerationGuard(base, index, intent.guard)
      if (
        intent.guard.expectedDismissalDigest !== null ||
        intent.body.dismissal.generationId !== intent.guard.generationId ||
        intent.body.dismissal.beginDigest !== intent.guard.beginDigest
      )
        return "invalid"
      planJsonWrite(
        writes,
        `generationDismissals/${intent.guard.generationId}`,
        "generation",
        intent.guard.generationId,
        "dismissal",
        intent.body.dismissal,
        getMapSetter("generationDismissals", intent.guard.generationId),
      )
      invalidated.push(node.identity.ref)
      return "valid"
    }
    case "canvas.generation.fail-recovery/2": {
      const node = requireGenerationGuard(base, index, intent.guard)
      if (
        intent.guard.expectedRecoveryFailureDigest !== null ||
        intent.body.recoveryFailure.generationId !== intent.guard.generationId ||
        intent.body.recoveryFailure.beginDigest !== intent.guard.beginDigest
      )
        return "invalid"
      requireFact(facts.validateGenerationRecovery(intent.body.recoveryFailure.proofDigest))
      planJsonWrite(
        writes,
        `generationRecoveryFailures/${intent.guard.generationId}`,
        "generation",
        intent.guard.generationId,
        "recoveryFailure",
        intent.body.recoveryFailure,
        getMapSetter("generationRecoveryFailures", intent.guard.generationId),
      )
      invalidated.push(node.identity.ref)
      return "valid"
    }
    case "canvas.plugin.creation-group.create/2": {
      const source = requireNodeData(base, index, intent.guard.source)
      if (
        source.key !== canvasEntityKeyV2(intent.body.source) ||
        intent.body.nodes.length < 1 ||
        intent.body.nodes.length > 85 ||
        intent.body.edges.length > 168 ||
        6 * intent.body.nodes.length + 3 * intent.body.edges.length + 2 > 512
      )
        return "invalid"
      if (
        intent.body.groupOrdinal !== "0" ||
        !hasContiguousCreationOrdinals([
          { ordinal: intent.body.groupOrdinal },
          ...intent.body.nodes,
          ...intent.body.edges,
        ])
      )
        return "invalid"
      requireFact(facts.validatePluginArtifact(intent.guard.pluginRequirement))
      const groupId = deriveCanvasIdV2("creationGroup", context, intent.body.groupOrdinal)
      const nodeRefs = new Map<string, CanvasEntityRefV2 & { kind: "node" }>()
      const members: CanvasEntityRefV2[] = []
      for (const node of intent.body.nodes) {
        const guard = intent.guard.derivedNodes.find((candidate) => candidate.ordinal === node.ordinal)
        if (
          guard === undefined ||
          node.plugin === null ||
          !sameRequirement(node.plugin, intent.guard.pluginRequirement)
        )
          return "invalid"
        requireFact(facts.validatePluginState(node.plugin))
        const ref = requireDerivedNode(base, context, guard, node)
        nodeRefs.set(node.ordinal, ref)
        members.push(ref)
      }
      for (const edge of intent.body.edges) {
        const guard = intent.guard.derivedEdges.find((candidate) => candidate.ordinal === edge.ordinal)
        if (guard === undefined) return "invalid"
        members.push(requireDerivedEdge(base, context, guard, edge))
      }
      const sortedMembers = sortedRefs(members)
      const groupRef: CreationGroupRefV2 = {
        format: "convax.canvas-creation-group-ref/2",
        groupId,
        source: intent.body.source,
        sourceDataDigest: intent.guard.source.expectedEffectiveDataDigest,
        plugin: intent.guard.pluginRequirement,
        memberSetDigest: canvasDigestV2("convax.canvas-creation-group-member-set/2", {
          format: "convax.canvas-creation-group-member-set/2",
          groupId,
          source: intent.body.source,
          members: sortedMembers,
        }),
      }
      for (const node of intent.body.nodes) {
        const ref = nodeRefs.get(node.ordinal)!
        const proof = intent.guard.resourceProofs.find((candidate) => candidate.createdNodeOrdinal === node.ordinal)
        if (node.data.kind === "resource") {
          if (proof === undefined || !sameCanonicalValueV2(proof.proof.resource, node.data.resource)) return "invalid"
          requireFact(facts.validateCurrentResource(proof.proof))
        } else if (proof !== undefined) return "invalid"
        planNodeCreate(writes, ref, node, context, groupRef)
        results.push(ref)
        invalidated.push(ref)
      }
      for (const edge of intent.body.edges) {
        const ref = members.find(
          (candidate) => candidate.kind === "edge" && candidate.id === edge.edgeId,
        )! as CanvasEntityRefV2 & { kind: "edge" }
        planEdgeCreate(
          writes,
          ref,
          resolveEndpoint(edge.source, nodeRefs, base, index),
          resolveEndpoint(edge.target, nodeRefs, base, index),
          edge.data,
          context,
          groupRef,
        )
        results.push(ref)
        invalidated.push(ref)
      }
      return "valid"
    }
    case "canvas.plugin.surface.create": {
      const node = intent.body.node
      if (node.ordinal !== "0") return "invalid"
      requirePlacement(base, intent.body.placement)
      const ref = requireDerivedNode(base, context, intent.guard.derivedNode, node)
      const position = placeCreatedNodes(base, intent.body.placement.anchor, [
        { ordinal: node.ordinal, size: node.size },
      ])[0]!
      requireFact(facts.validatePluginArtifact(pluginRequirementV2(node.plugin)!))
      requireFact(facts.validatePluginState(node.plugin))
      planNodeCreate(
        writes,
        ref,
        {
          ...node,
          role: "file",
          position,
          data: { format: "convax.canvas-node-data/2", kind: "plugin-surface", title: node.title },
          plugin: node.plugin,
        },
        context,
        null,
      )
      results.push(ref)
      invalidated.push(ref)
      return "valid"
    }
    case "canvas.undo.semantic-inverse/2":
    case "canvas.redo.semantic-forward/2":
      return planSemanticOperations(intent, base, index, context, facts, writes, results, invalidated)
  }
  return "invalid"
}

function planSemanticOperations(
  intent: Extract<
    CanvasTypedIntentUnionV2,
    { kind: "canvas.undo.semantic-inverse/2" | "canvas.redo.semantic-forward/2" }
  >,
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  context: OwnerIntentValidationContext,
  facts: CanvasExternalFactContextV2,
  writes: PlannedWrite[],
  results: CanvasEntityRefV2[],
  invalidated: CanvasEntityRefV2[],
): "valid" | "pending" | "invalid" {
  const rootValue = base.semanticHistory.get(historyRootKeyV2(intent.guard.rootOperationId))
  if (rootValue?.format !== "convax.canvas-semantic-history-root/2") return "invalid"
  const receipt = [...base.operations.values()].find((candidate) => candidate.operationId === rootValue.rootOperationId)
  if (
    receipt === undefined ||
    canvasDigestV2("convax.canvas-operation-receipt/2", receipt) !== intent.guard.expectedRootReceiptDigest ||
    canvasDigestV2("convax.canvas-semantic-history-root/2", rootValue) !== intent.guard.expectedHistoryRootDigest
  )
    return "invalid"
  const state = semanticHistoryState(base, rootValue, receipt)
  if (state.digest !== intent.guard.expectedHistoryStateDigest || state.mode !== intent.guard.expectedMode)
    return "invalid"
  assertCurrentHistoryPhaseV2(
    base,
    rootValue,
    state.bindings,
    intent.kind === "canvas.undo.semantic-inverse/2" ? "undo" : "redo",
  )
  if (intent.body.operations.length < 1 || intent.body.operations.length > 510) return "invalid"
  const selectedTemplates =
    intent.kind === "canvas.undo.semantic-inverse/2" ? rootValue.inverseTemplate : rootValue.forwardTemplate
  const scheduledTemplates = scheduleCanvasHistoryTemplatesV2(selectedTemplates, state.bindings)
  if (
    scheduledTemplates.length !== intent.body.operations.length ||
    intent.body.operations.some(
      (operation, position) => !sameCanonicalValueV2(operation.template, scheduledTemplates[position]),
    )
  )
    return "invalid"
  const allDerived = intent.body.operations.flatMap((operation) => operation.derived)
  const ordinalPlan = planCanvasHistoryDerivedOrdinalsV2(selectedTemplates, state.bindings)
  if (
    allDerived.length !== ordinalPlan.length ||
    allDerived.some(
      (derived, position) =>
        derived.kind !== ordinalPlan[position]!.kind ||
        derived.ordinal !== ordinalPlan[position]!.ordinal ||
        historyDerivedPlanHandleV2(derived) !== ordinalPlan[position]!.handle,
    )
  )
    return "invalid"
  for (const operation of intent.body.operations) {
    const guardDigest = canvasDigestV2("convax.canvas-semantic-guard/2", {
      format: "convax.canvas-semantic-guard/2",
      rootOperationId: rootValue.rootOperationId,
      direction: intent.kind === "canvas.undo.semantic-inverse/2" ? "inverse" : "forward",
      operationIndex: operationIndex(intent.body.operations, operation),
      template: operation.template,
      materializedGuard: operation.materializedGuard,
    })
    if (guardDigest !== operation.guardDigest) return "invalid"
    if (!validateSemanticDerivedIdentities(operation.derived, base, context)) return "invalid"
    for (const proof of operation.retainedResourceProofs) requireFact(facts.validateCurrentResource(proof))
    const template = operation.template
    if (template.op === "node.tombstone" || template.op === "edge.tombstone") {
      const binding = state.bindings.find((candidate) => candidate.handle === template.handle)
      const boundRef = binding?.ref
      if (boundRef === null || boundRef === undefined) return "invalid"
      if (template.op === "node.tombstone") {
        if (
          !isNodeRef(boundRef) ||
          operation.materializedGuard.op !== "node.tombstone" ||
          canvasEntityKeyV2(boundRef) !== canvasEntityKeyV2(operation.materializedGuard.guard.node)
        )
          return "invalid"
        requireNode(base, index, operation.materializedGuard.guard)
        requireNoNewIncidentEdges(index, boundRef, state.bindings)
      } else {
        if (
          !isEdgeRef(boundRef) ||
          operation.materializedGuard.op !== "edge.tombstone" ||
          canvasEntityKeyV2(boundRef) !== canvasEntityKeyV2(operation.materializedGuard.guard.edge)
        )
          return "invalid"
        requireEdge(base, index, operation.materializedGuard.guard)
      }
      planTombstone(writes, boundRef, context)
      results.push(boundRef)
      invalidated.push(boundRef)
    } else if (template.op === "node.create") {
      if (operation.materializedGuard.op !== "node.create" || operation.materializedGuard.guard !== null)
        return "invalid"
      const derived = findDerivedNode(operation.derived, template.handle)
      if (derived === undefined) return "invalid"
      const derivedRef = derived.ref
      planNodeCreate(
        writes,
        derivedRef,
        {
          role: template.snapshot.role,
          position: template.snapshot.position,
          size: template.snapshot.size,
          data: template.snapshot.data,
          plugin: template.snapshot.plugin,
        },
        context,
        null,
      )
      results.push(derivedRef)
      invalidated.push(derivedRef)
    } else if (template.op === "node.geometry") {
      const binding = state.bindings.find((candidate) => candidate.handle === template.handle)
      if (
        binding?.ref?.kind !== "node" ||
        operation.materializedGuard.op !== "node.geometry" ||
        canvasEntityKeyV2(binding.ref) !== canvasEntityKeyV2(operation.materializedGuard.guard.node)
      )
        return "invalid"
      const node = requireNode(base, index, operation.materializedGuard.guard)
      if (geometryDigestV2(node) !== operation.materializedGuard.guard.expectedGeometryDigest) return "invalid"
      planClaim(writes, "node", binding.ref, "position", template.position, context)
      planClaim(writes, "node", binding.ref, "size", template.size, context)
      results.push(binding.ref)
      invalidated.push(binding.ref)
    } else if (template.op === "node.data") {
      const binding = state.bindings.find((candidate) => candidate.handle === template.handle)
      if (
        binding?.ref?.kind !== "node" ||
        operation.materializedGuard.op !== "node.data" ||
        canvasEntityKeyV2(binding.ref) !== canvasEntityKeyV2(operation.materializedGuard.guard.node)
      )
        return "invalid"
      const node = requireNodeData(base, index, operation.materializedGuard.guard)
      if (template.data.kind === "agent" ? node.identity.role !== "agent" : node.identity.role !== "file")
        return "invalid"
      planClaim(writes, "node", binding.ref, "data", template.data, context)
      results.push(binding.ref)
      invalidated.push(binding.ref)
    } else if (template.op === "node.plugin") {
      const binding = state.bindings.find((candidate) => candidate.handle === template.handle)
      if (
        binding?.ref?.kind !== "node" ||
        operation.materializedGuard.op !== "node.plugin" ||
        canvasEntityKeyV2(binding.ref) !== canvasEntityKeyV2(operation.materializedGuard.guard.node)
      )
        return "invalid"
      const node = requireNode(base, index, operation.materializedGuard.guard)
      if (
        effectivePluginDigestV2(node) !== operation.materializedGuard.guard.expectedPluginDigest ||
        !sameRequirement(template.plugin, operation.materializedGuard.guard.requirement)
      )
        return "invalid"
      if (template.plugin !== null) requireFact(facts.validatePluginState(template.plugin))
      planClaim(writes, "node", binding.ref, "plugin", template.plugin, context)
      results.push(binding.ref)
      invalidated.push(binding.ref)
    } else if (template.op === "edge.create") {
      const derived = findDerivedEdge(operation.derived, template.handle)
      if (
        derived === undefined ||
        operation.materializedGuard.op !== "edge.create" ||
        !sameCanonicalValueV2(operation.materializedGuard.guard.edge.edge, derived.ref) ||
        operation.materializedGuard.guard.edge.ordinal !== derived.ordinal
      )
        return "invalid"
      const source = resolveHistoryTarget(template.snapshot.source, state.bindings, allDerived)
      const target = resolveHistoryTarget(template.snapshot.target, state.bindings, allDerived)
      if (
        canvasEntityKeyV2(source) !== canvasEntityKeyV2(operation.materializedGuard.guard.source.node) ||
        canvasEntityKeyV2(target) !== canvasEntityKeyV2(operation.materializedGuard.guard.target.node)
      )
        return "invalid"
      requireHistoryConnectable(
        base,
        index,
        operation.materializedGuard.guard.source,
        allDerived,
        intent.body.operations,
      )
      requireHistoryConnectable(
        base,
        index,
        operation.materializedGuard.guard.target,
        allDerived,
        intent.body.operations,
      )
      const derivedRef = derived.ref
      planEdgeCreate(writes, derivedRef, source, target, template.snapshot.data, context, null)
      results.push(derivedRef)
      invalidated.push(derivedRef)
    } else if (template.op === "containment.set") {
      if (operation.materializedGuard.op !== "containment.set") return "invalid"
      const child = resolveHistoryTarget(template.child, state.bindings, allDerived)
      const parent = template.parent === null ? null : resolveHistoryTarget(template.parent, state.bindings, allDerived)
      if (canvasEntityKeyV2(child) !== canvasEntityKeyV2(operation.materializedGuard.guard.child.node)) return "invalid"
      const childNode = base.nodes.get(canvasEntityKeyV2(child))
      if (childNode === undefined) {
        requireHistoryNode(
          base,
          index,
          operation.materializedGuard.guard.child,
          allDerived,
          intent.body.operations,
          false,
        )
        if (operation.materializedGuard.guard.child.expectedOwnSlotDigest !== null) return "invalid"
      } else if (
        canvasEntityKeyV2(requireNode(base, index, operation.materializedGuard.guard.child).identity.ref) !==
          canvasEntityKeyV2(child) ||
        ownContainmentSlotDigest(base, child, context.actorId) !==
          operation.materializedGuard.guard.child.expectedOwnSlotDigest
      )
        return "invalid"
      if (parent === null) {
        if (operation.materializedGuard.guard.parent !== null) return "invalid"
      } else {
        const parentGuard = operation.materializedGuard.guard.parent
        if (parentGuard === null || canvasEntityKeyV2(parent) !== canvasEntityKeyV2(parentGuard.node)) return "invalid"
        requireHistoryNode(base, index, parentGuard, allDerived, intent.body.operations, true)
      }
      const derived = operation.derived.find(
        (candidate): candidate is Extract<CanvasHistoryDerivedObjectV2, { kind: "relation" }> =>
          candidate.kind === "relation",
      )
      if (derived === undefined) return "invalid"
      planContainment(writes, child, parent, derived.relationId, context)
      results.push(child)
      invalidated.push(child)
    } else if (template.op === "metadata.set") {
      if (
        operation.materializedGuard.op !== "metadata.set" ||
        operation.materializedGuard.guard.field !== template.field ||
        metadataEffectiveDigest(base, template.field) !== operation.materializedGuard.guard.expectedEffectiveDigest ||
        metadataOwnSlotDigest(base, template.field, context.actorId) !==
          operation.materializedGuard.guard.expectedOwnSlotDigest
      )
        return "invalid"
      planMetadata(writes, base.identity.canvasId, template.field, template.value, context)
    } else if (template.op === "creation-group.restore") {
      if (
        operation.materializedGuard.op !== "creation-group.restore" ||
        !sameRequirement(template.plugin, operation.materializedGuard.guard.pluginRequirement) ||
        !derivedGuardsMatch(
          operation.materializedGuard.guard.derivedNodes,
          operation.materializedGuard.guard.derivedEdges,
          operation.derived,
        )
      )
        return "invalid"
      const groupDerived = operation.derived.find(
        (candidate): candidate is Extract<CanvasHistoryDerivedObjectV2, { kind: "creation-group" }> =>
          candidate.kind === "creation-group" && candidate.handle === template.groupHandle,
      )
      if (groupDerived === undefined) return "invalid"
      const source = resolveHistoryTarget(template.source, state.bindings, allDerived)
      if (canvasEntityKeyV2(source) !== canvasEntityKeyV2(operation.materializedGuard.guard.source.node))
        return "invalid"
      const sourceNode = base.nodes.get(canvasEntityKeyV2(source))
      if (sourceNode === undefined) {
        requireHistoryNode(
          base,
          index,
          operation.materializedGuard.guard.source,
          allDerived,
          intent.body.operations,
          false,
        )
        const sourceData = historyCreatedNodeData(
          intent.body.operations,
          template.source.mode === "handle" ? template.source.handle : "",
        )
        if (
          sourceData === undefined ||
          canvasDigestV2("convax.canvas-effective-data/2", {
            format: "convax.canvas-effective-data/2",
            data: sourceData,
          }) !== template.sourceDataDigest ||
          operation.materializedGuard.guard.source.expectedEffectiveDataDigest !== template.sourceDataDigest
        )
          return "invalid"
      } else {
        requireNodeData(base, index, operation.materializedGuard.guard.source)
        if (effectiveDataDigestV2(base, sourceNode) !== template.sourceDataDigest) return "invalid"
      }
      requireFact(facts.validatePluginArtifact(template.plugin))
      const memberRefs = operation.derived.filter(isDerivedEntity).map((candidate) => candidate.ref)
      const groupRef: CreationGroupRefV2 = {
        format: "convax.canvas-creation-group-ref/2",
        groupId: groupDerived.groupId,
        source,
        sourceDataDigest: template.sourceDataDigest,
        plugin: template.plugin,
        memberSetDigest: canvasDigestV2("convax.canvas-creation-group-member-set/2", {
          format: "convax.canvas-creation-group-member-set/2",
          groupId: groupDerived.groupId,
          source,
          members: sortedRefs(memberRefs),
        }),
      }
      for (const item of template.nodes) {
        const derived = findDerivedNode(operation.derived, item.handle)
        if (derived === undefined) return "invalid"
        const derivedRef = derived.ref
        planNodeCreate(
          writes,
          derivedRef,
          {
            role: item.snapshot.role,
            position: item.snapshot.position,
            size: item.snapshot.size,
            data: item.snapshot.data,
            plugin: item.snapshot.plugin,
          },
          context,
          groupRef,
        )
        results.push(derivedRef)
        invalidated.push(derivedRef)
      }
      for (const item of template.edges) {
        const derived = findDerivedEdge(operation.derived, item.handle)
        if (derived === undefined) return "invalid"
        const derivedRef = derived.ref
        const sourceRef = resolveHistoryTarget(item.snapshot.source, state.bindings, allDerived)
        const targetRef = resolveHistoryTarget(item.snapshot.target, state.bindings, allDerived)
        requireHistoryEndpoint(base, index, sourceRef, allDerived, intent.body.operations)
        requireHistoryEndpoint(base, index, targetRef, allDerived, intent.body.operations)
        planEdgeCreate(writes, derivedRef, sourceRef, targetRef, item.snapshot.data, context, groupRef)
        results.push(derivedRef)
        invalidated.push(derivedRef)
      }
    } else if (template.op === "pending-generation.restore") {
      if (
        operation.materializedGuard.op !== "pending-generation.restore" ||
        operation.materializedGuard.guard.lifecycle.rootOperationId !== rootValue.rootOperationId ||
        operation.materializedGuard.guard.lifecycle.nodeHandle !== template.node ||
        operation.materializedGuard.guard.lifecycle.generationId !== template.generationId ||
        !derivedGuardsMatch(
          [operation.materializedGuard.guard.derivedNode],
          operation.materializedGuard.guard.derivedEdges,
          operation.derived,
        )
      )
        return "invalid"
      const derivedNode = findDerivedNode(operation.derived, template.node)
      if (derivedNode === undefined) return "invalid"
      const begin = base.generationBegins.get(template.generationId)
      const retainedBinding = rootValue.initialBindings.find((binding) => binding.handle === template.node)
      if (
        begin === undefined ||
        retainedBinding?.ref?.kind !== "node" ||
        canvasEntityKeyV2(begin.node) !== canvasEntityKeyV2(retainedBinding.ref) ||
        canvasDigestV2("convax.canvas-generation-begin/2", begin) !==
          operation.materializedGuard.guard.lifecycle.retainedBeginDigest
      )
        return "invalid"
      const lifecycle = generationLifecycleCoreV2(base, template.generationId)
      if (
        generationLifecycleDigestV2(base, template.generationId) !==
          operation.materializedGuard.guard.lifecycle.expectedLifecycleDigest ||
        nullableDigest("convax.canvas-generation-terminal/2", lifecycle.terminal) !==
          operation.materializedGuard.guard.lifecycle.expectedTerminalDigest ||
        nullableDigest("convax.canvas-generation-dismissal/2", lifecycle.dismissal) !==
          operation.materializedGuard.guard.lifecycle.expectedDismissalDigest ||
        nullableDigest("convax.canvas-generation-recovery-failure/2", lifecycle.recoveryFailure) !==
          operation.materializedGuard.guard.lifecycle.expectedRecoveryFailureDigest
      )
        return "invalid"
      if (lifecycle.dismissal !== null || (lifecycle.terminal === null && lifecycle.recoveryFailure === null))
        return "invalid"
      let data: NodeDataEnvelopeV2 = {
        format: "convax.canvas-node-data/2",
        kind: "placeholder",
        owner: "manual-pending",
        title: template.fallbackTitle,
        expectedClass: template.expectedClass,
        state: {
          phase: "failed",
          failureCode:
            lifecycle.recoveryFailure?.failureCode ??
            (lifecycle.terminal?.phase === "failed" ? lifecycle.terminal.failureCode : "generation-failed"),
          publicMessage: lifecycle.terminal?.phase === "failed" ? lifecycle.terminal.publicMessage : null,
        },
      }
      if (lifecycle.terminal?.phase === "succeeded") data = lifecycle.terminal.outputData
      const restoredResource = data.kind === "resource" ? data.resource : null
      if (
        operation.retainedResourceProofs.length !== (restoredResource === null ? 0 : 1) ||
        (restoredResource !== null &&
          !sameCanonicalValueV2(operation.retainedResourceProofs[0]!.resource, restoredResource))
      )
        return "invalid"
      const derivedRef = derivedNode.ref
      planNodeCreate(
        writes,
        derivedRef,
        { role: "file", position: template.position, size: template.size, data, plugin: null },
        context,
        null,
      )
      results.push(derivedRef)
      invalidated.push(derivedRef)
      for (const item of template.edges) {
        const derivedEdge = findDerivedEdge(operation.derived, item.handle)
        if (derivedEdge === undefined) return "invalid"
        const source = resolveHistoryTarget(item.snapshot.source, state.bindings, allDerived)
        const target = resolveHistoryTarget(item.snapshot.target, state.bindings, allDerived)
        requireHistoryEndpoint(base, index, source, allDerived, intent.body.operations)
        requireHistoryEndpoint(base, index, target, allDerived, intent.body.operations)
        planEdgeCreate(writes, derivedEdge.ref, source, target, item.snapshot.data, context, null)
        results.push(derivedEdge.ref)
        invalidated.push(derivedEdge.ref)
      }
    }
  }
  return "valid"
}

function historyDerivedPlanHandleV2(value: CanvasHistoryDerivedObjectV2): string {
  return value.kind === "relation" ? historyTargetSortKey(value.child) : value.handle
}

function historyDerivedCountV2(template: CanvasHistoryTemplateV2): number {
  if (template.op === "node.create" || template.op === "edge.create" || template.op === "containment.set") return 1
  if (template.op === "pending-generation.restore") return 1 + template.edges.length
  if (template.op === "creation-group.restore") return 1 + template.nodes.length + template.edges.length
  return 0
}

function historyDerivedObjectV2(
  planned: ReturnType<typeof planCanvasHistoryDerivedOrdinalsV2>[number],
  template: CanvasHistoryTemplateV2,
  context: OwnerIntentConstructionContext,
): CanvasHistoryDerivedObjectV2 {
  if (planned.kind === "node")
    return Object.freeze({ kind: "node", handle: planned.handle, ordinal: planned.ordinal, ref: derivedNodeRefV2(context, planned.ordinal) })
  if (planned.kind === "edge")
    return Object.freeze({ kind: "edge", handle: planned.handle, ordinal: planned.ordinal, ref: derivedEdgeRefV2(context, planned.ordinal) })
  if (planned.kind === "creation-group")
    return Object.freeze({
      kind: "creation-group",
      handle: planned.handle,
      ordinal: planned.ordinal,
      groupId: deriveCanvasIdV2("creationGroup", context, planned.ordinal),
    })
  if (template.op !== "containment.set")
    throw new CanvasSchemaErrorV2("history-ordinal", "Relation allocation belongs to no containment template")
  return Object.freeze({
    kind: "relation",
    ordinal: planned.ordinal,
    relationId: deriveCanvasIdV2("relation", context, planned.ordinal),
    child: template.child,
  })
}

function historyPlannedWriteOrdinalsV2(
  templates: readonly CanvasHistoryTemplateV2[],
  derivedByOperation: readonly (readonly CanvasHistoryDerivedObjectV2[])[],
  initialBindings: readonly CanvasHistoryBindingV2[],
  context: OwnerIntentConstructionContext,
): ReadonlyMap<string, Uint32> {
  const bindings = new Map(initialBindings.map((binding) => [binding.handle, binding.ref] as const))
  const paths: string[] = []
  const addNode = (ref: CanvasEntityRefV2 & { kind: "node" }) => {
    const key = canvasEntityKeyV2(ref)
    paths.push(
      `nodes/${key}/identity`,
      `nodes/${key}/position/actor/${context.actorId}`,
      `nodes/${key}/size/actor/${context.actorId}`,
      `nodes/${key}/data/actor/${context.actorId}`,
      `nodes/${key}/plugin/actor/${context.actorId}`,
      `nodes/${key}/creationGroup`,
    )
  }
  const addEdge = (ref: CanvasEntityRefV2 & { kind: "edge" }) => {
    const key = canvasEntityKeyV2(ref)
    paths.push(
      `edges/${key}/identity`,
      `edges/${key}/data/actor/${context.actorId}`,
      `edges/${key}/creationGroup`,
    )
  }
  for (const [index, template] of templates.entries()) {
    const derived = derivedByOperation[index]!
    if (template.op === "node.create") addNode(requireDerivedHistoryNodeV2(derived, template.handle))
    else if (template.op === "edge.create") addEdge(requireDerivedHistoryEdgeV2(derived, template.handle))
    else if (template.op === "creation-group.restore") {
      for (const item of template.nodes) addNode(requireDerivedHistoryNodeV2(derived, item.handle))
      for (const item of template.edges) addEdge(requireDerivedHistoryEdgeV2(derived, item.handle))
    } else if (template.op === "pending-generation.restore") {
      addNode(requireDerivedHistoryNodeV2(derived, template.node))
      for (const item of template.edges) addEdge(requireDerivedHistoryEdgeV2(derived, item.handle))
    } else if (template.op === "node.geometry") {
      const ref = requireHistoryBindingNodeV2(bindings, template.handle)
      const key = canvasEntityKeyV2(ref)
      paths.push(`nodes/${key}/position/actor/${context.actorId}`, `nodes/${key}/size/actor/${context.actorId}`)
    } else if (template.op === "node.data" || template.op === "node.plugin") {
      const ref = requireHistoryBindingNodeV2(bindings, template.handle)
      paths.push(`nodes/${canvasEntityKeyV2(ref)}/${template.op === "node.data" ? "data" : "plugin"}/actor/${context.actorId}`)
    } else if (template.op === "node.tombstone") {
      const ref = requireHistoryBindingNodeV2(bindings, template.handle)
      paths.push(`nodes/${canvasEntityKeyV2(ref)}/tombstones/${context.actorId}`)
    } else if (template.op === "edge.tombstone") {
      const ref = requireHistoryBindingEdgeV2(bindings, template.handle)
      paths.push(`edges/${canvasEntityKeyV2(ref)}/tombstones/${context.actorId}`)
    } else if (template.op === "containment.set") {
      const child = resolveHistoryConstructionTargetV2(template.child, bindings)
      paths.push(`containments/${containmentKeyV2(child, context.actorId)}`)
    } else if (template.op === "metadata.set") paths.push(`meta/${template.field}/actor/${context.actorId}`)
    publishHistoryBindingRefsV2(template, derived, bindings)
  }
  paths.sort(compareUtf8)
  strictSortedUnique(paths, (path) => path, "History planned write paths")
  return new Map(paths.map((path, index) => [path, parseUint32(String(index))] as const))
}

function materializedHistoryGuardV2(
  base: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  root: SemanticHistoryRootV2,
  template: CanvasHistoryTemplateV2,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNodeV2>,
  derived: readonly CanvasHistoryDerivedObjectV2[],
): CanvasSemanticOperationV2["materializedGuard"] {
  if (template.op === "node.create") return Object.freeze({ op: "node.create", guard: null })
  if (template.op === "node.tombstone")
    return Object.freeze({ op: template.op, guard: historyNodeLiveGuardV2(base, bindings, provisionalNodes, template.handle) })
  if (template.op === "edge.tombstone") {
    const ref = requireHistoryBindingEdgeV2(bindings, template.handle)
    const edge = base.edges.get(canvasEntityKeyV2(ref))
    const index = buildCanvasProjectionIndexV2(base)
    if (edge === undefined || !index.isEdgeLive(ref)) throw new CanvasSchemaErrorV2("history-conflict", "History edge is not live")
    return Object.freeze({ op: template.op, guard: Object.freeze({ edge: ref, expectedLive: true, expectedIdentityDigest: edgeIdentityDigestV2(edge) }) })
  }
  if (template.op === "node.geometry") {
    const nodeGuard = historyNodeLiveGuardV2(base, bindings, provisionalNodes, template.handle)
    const node = base.nodes.get(canvasEntityKeyV2(nodeGuard.node))
    if (node === undefined) throw new CanvasSchemaErrorV2("history-conflict", "Geometry target is not stored")
    return Object.freeze({ op: template.op, guard: Object.freeze({ ...nodeGuard, expectedGeometryDigest: geometryDigestV2(node) }) })
  }
  if (template.op === "node.data")
    return Object.freeze({ op: template.op, guard: historyNodeDataGuardV2(base, bindings, provisionalNodes, template.handle, context) })
  if (template.op === "node.plugin") {
    const nodeGuard = historyNodeLiveGuardV2(base, bindings, provisionalNodes, template.handle)
    const provisional = provisionalNodes.get(canvasEntityKeyV2(nodeGuard.node))
    const node = base.nodes.get(canvasEntityKeyV2(nodeGuard.node))
    const plugin = provisional?.plugin ?? (node === undefined ? null : effectivePluginV2(node))
    return Object.freeze({
      op: template.op,
      guard: Object.freeze({ ...nodeGuard, expectedPluginDigest: pluginRequirementDigestV2(plugin), requirement: pluginRequirementV2(template.plugin) }),
    })
  }
  if (template.op === "edge.create") {
    const edge = requireDerivedHistoryEdgeObjectV2(derived, template.handle)
    const source = historyConnectableGuardV2(base, bindings, provisionalNodes, template.snapshot.source)
    const target = historyConnectableGuardV2(base, bindings, provisionalNodes, template.snapshot.target)
    return Object.freeze({ op: template.op, guard: Object.freeze({ edge: derivedEdgeGuardV2(edge), source, target }) })
  }
  if (template.op === "containment.set") {
    const child = historyContainmentGuardV2(base, context, bindings, provisionalNodes, template.child)
    const parent = template.parent === null ? null : historyNodeLiveGuardForTargetV2(base, bindings, provisionalNodes, template.parent)
    return Object.freeze({ op: template.op, guard: Object.freeze({ child, parent }) })
  }
  if (template.op === "metadata.set")
    return Object.freeze({
      op: template.op,
      guard: Object.freeze({
        field: template.field,
        expectedEffectiveDigest: metadataEffectiveDigest(base, template.field),
        expectedOwnSlotDigest: metadataOwnSlotDigest(base, template.field, context.actorId),
      }),
    })
  if (template.op === "creation-group.restore") {
    const source = historyNodeDataGuardForTargetV2(base, context, bindings, provisionalNodes, template.source)
    if (source.expectedEffectiveDataDigest !== template.sourceDataDigest)
      throw new CanvasSchemaErrorV2("history-conflict", "Creation-group source data changed")
    return Object.freeze({
      op: template.op,
      guard: Object.freeze({
        source,
        pluginRequirement: template.plugin,
        derivedNodes: Object.freeze(template.nodes.map((item) => derivedNodeGuardV2(requireDerivedHistoryNodeObjectV2(derived, item.handle)))),
        derivedEdges: Object.freeze(template.edges.map((item) => derivedEdgeGuardV2(requireDerivedHistoryEdgeObjectV2(derived, item.handle)))),
      }),
    })
  }
  const begin = base.generationBegins.get(template.generationId)
  const initial = originalHistoryRefV2(base, root, template.node)
  if (begin === undefined || initial?.kind !== "node" || canvasEntityKeyV2(begin.node) !== canvasEntityKeyV2(initial))
    throw new CanvasSchemaErrorV2("history-conflict", "Retained generation begin is not bound to the history node")
  const lifecycle = generationLifecycleCoreV2(base, template.generationId)
  if (lifecycle.dismissal !== null || (lifecycle.terminal === null && lifecycle.recoveryFailure === null))
    throw new CanvasSchemaErrorV2("history-redo-unavailable", "Generation lifecycle cannot be restored")
  return Object.freeze({
    op: template.op,
    guard: Object.freeze({
      lifecycle: Object.freeze({
        rootOperationId: root.rootOperationId,
        nodeHandle: template.node,
        generationId: template.generationId,
        retainedBeginDigest: canvasDigestV2("convax.canvas-generation-begin/2", begin),
        expectedLifecycleDigest: generationLifecycleDigestV2(base, template.generationId),
        expectedTerminalDigest: nullableDigest("convax.canvas-generation-terminal/2", lifecycle.terminal),
        expectedDismissalDigest: nullableDigest("convax.canvas-generation-dismissal/2", lifecycle.dismissal),
        expectedRecoveryFailureDigest: nullableDigest("convax.canvas-generation-recovery-failure/2", lifecycle.recoveryFailure),
      }),
      derivedNode: derivedNodeGuardV2(requireDerivedHistoryNodeObjectV2(derived, template.node)),
      derivedEdges: Object.freeze(template.edges.map((item) => derivedEdgeGuardV2(requireDerivedHistoryEdgeObjectV2(derived, item.handle)))),
    }),
  })
}

function publishHistoryProvisionalResultsV2(
  template: CanvasHistoryTemplateV2,
  derived: readonly CanvasHistoryDerivedObjectV2[],
  bindings: Map<string, CanvasEntityRefV2 | null>,
  provisionalNodes: Map<string, ProvisionalHistoryNodeV2>,
  writeOrdinals: ReadonlyMap<string, Uint32>,
  context: OwnerIntentConstructionContext,
): void {
  publishHistoryBindingRefsV2(template, derived, bindings)
  const publishNode = (handle: string, snapshot: CanvasHistoryNodeSnapshotV2) => {
    const ref = requireDerivedHistoryNodeV2(derived, handle)
    const path = `nodes/${canvasEntityKeyV2(ref)}/data/actor/${context.actorId}`
    const dataWriteOrdinal = writeOrdinals.get(path)
    if (dataWriteOrdinal === undefined) throw new CanvasSchemaErrorV2("history-ordinal", "Created node data write has no ordinal")
    provisionalNodes.set(canvasEntityKeyV2(ref), Object.freeze({
      ref,
      role: snapshot.role,
      data: snapshot.data,
      plugin: snapshot.plugin,
      position: snapshot.position,
      size: snapshot.size,
      dataWriteOrdinal,
      createdBy: context.operationId,
    }))
  }
  if (template.op === "node.create") publishNode(template.handle, template.snapshot)
  else if (template.op === "creation-group.restore")
    for (const item of template.nodes) publishNode(item.handle, item.snapshot)
  if (template.op === "node.tombstone") bindings.set(template.handle, null)
  if (template.op === "edge.tombstone") bindings.set(template.handle, null)
}

function publishHistoryBindingRefsV2(
  template: CanvasHistoryTemplateV2,
  derived: readonly CanvasHistoryDerivedObjectV2[],
  bindings: Map<string, CanvasEntityRefV2 | null>,
): void {
  if (template.op === "node.create") bindings.set(template.handle, requireDerivedHistoryNodeV2(derived, template.handle))
  else if (template.op === "edge.create") bindings.set(template.handle, requireDerivedHistoryEdgeV2(derived, template.handle))
  else if (template.op === "creation-group.restore") {
    for (const item of template.nodes) bindings.set(item.handle, requireDerivedHistoryNodeV2(derived, item.handle))
    for (const item of template.edges) bindings.set(item.handle, requireDerivedHistoryEdgeV2(derived, item.handle))
  } else if (template.op === "pending-generation.restore") {
    bindings.set(template.node, requireDerivedHistoryNodeV2(derived, template.node))
    for (const item of template.edges) bindings.set(item.handle, requireDerivedHistoryEdgeV2(derived, item.handle))
  } else if (template.op === "node.tombstone" || template.op === "edge.tombstone") bindings.set(template.handle, null)
}

function requireDerivedHistoryNodeObjectV2(
  values: readonly CanvasHistoryDerivedObjectV2[],
  handle: string,
): Extract<CanvasHistoryDerivedObjectV2, { kind: "node" }> {
  const matches = values.filter(
    (value): value is Extract<CanvasHistoryDerivedObjectV2, { kind: "node" }> => value.kind === "node" && value.handle === handle,
  )
  if (matches.length !== 1) throw new CanvasSchemaErrorV2("history-ordinal", `History node ${handle} is not allocated exactly once`)
  return matches[0]!
}

function requireDerivedHistoryEdgeObjectV2(
  values: readonly CanvasHistoryDerivedObjectV2[],
  handle: string,
): Extract<CanvasHistoryDerivedObjectV2, { kind: "edge" }> {
  const matches = values.filter(
    (value): value is Extract<CanvasHistoryDerivedObjectV2, { kind: "edge" }> => value.kind === "edge" && value.handle === handle,
  )
  if (matches.length !== 1) throw new CanvasSchemaErrorV2("history-ordinal", `History edge ${handle} is not allocated exactly once`)
  return matches[0]!
}

function requireDerivedHistoryNodeV2(
  values: readonly CanvasHistoryDerivedObjectV2[],
  handle: string,
): CanvasEntityRefV2 & { kind: "node" } {
  return requireDerivedHistoryNodeObjectV2(values, handle).ref
}

function requireDerivedHistoryEdgeV2(
  values: readonly CanvasHistoryDerivedObjectV2[],
  handle: string,
): CanvasEntityRefV2 & { kind: "edge" } {
  return requireDerivedHistoryEdgeObjectV2(values, handle).ref
}

function requireHistoryBindingNodeV2(
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  handle: string,
): CanvasEntityRefV2 & { kind: "node" } {
  const ref = bindings.get(handle)
  if (ref?.kind !== "node") throw new CanvasSchemaErrorV2("history-binding-missing", `History node ${handle} is not bound`)
  return ref as CanvasEntityRefV2 & { kind: "node" }
}

function requireHistoryBindingEdgeV2(
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  handle: string,
): CanvasEntityRefV2 & { kind: "edge" } {
  const ref = bindings.get(handle)
  if (ref?.kind !== "edge") throw new CanvasSchemaErrorV2("history-binding-missing", `History edge ${handle} is not bound`)
  return ref as CanvasEntityRefV2 & { kind: "edge" }
}

function resolveHistoryConstructionTargetV2(
  target: CanvasHistoryNodeTargetV2,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
): CanvasEntityRefV2 & { kind: "node" } {
  return target.mode === "external" ? target.ref : requireHistoryBindingNodeV2(bindings, target.handle)
}

function historyNodeLiveGuardForTargetV2(
  base: CanvasSnapshotV2,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNodeV2>,
  target: CanvasHistoryNodeTargetV2,
) {
  const ref = resolveHistoryConstructionTargetV2(target, bindings)
  const provisional = provisionalNodes.get(canvasEntityKeyV2(ref))
  if (provisional !== undefined)
    return Object.freeze({
      node: ref,
      expectedLive: true as const,
      expectedIdentityDigest: canvasDigestV2("convax.canvas-node-identity/2", {
        format: "convax.canvas-node-identity/2",
        ref,
        role: provisional.role,
        createdBy: provisional.createdBy,
      }),
    })
  const node = base.nodes.get(canvasEntityKeyV2(ref))
  if (node === undefined || !buildCanvasProjectionIndexV2(base).isNodeLive(ref))
    throw new CanvasSchemaErrorV2("history-conflict", "History node is not effective-live")
  return Object.freeze({ node: ref, expectedLive: true as const, expectedIdentityDigest: nodeIdentityDigestV2(node) })
}

function historyNodeLiveGuardV2(
  base: CanvasSnapshotV2,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNodeV2>,
  handle: string,
) {
  return historyNodeLiveGuardForTargetV2(base, bindings, provisionalNodes, { mode: "handle", handle })
}

function historyNodeDataGuardForTargetV2(
  base: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNodeV2>,
  target: CanvasHistoryNodeTargetV2,
) {
  const ref = resolveHistoryConstructionTargetV2(target, bindings)
  const live = historyNodeLiveGuardForTargetV2(base, bindings, provisionalNodes, target)
  const provisional = provisionalNodes.get(canvasEntityKeyV2(ref))
  if (provisional !== undefined) {
    const claim = {
      format: "convax.canvas-stamped-claim/2",
      stamp: makeStampV2(context, provisional.dataWriteOrdinal),
      value: provisional.data,
    } as const
    return Object.freeze({
      ...live,
      expectedEffectiveDataDigest: canvasDigestV2("convax.canvas-effective-data/2", {
        format: "convax.canvas-effective-data/2",
        data: provisional.data,
      }),
      expectedDataRegisterDigest: canvasDigestV2("convax.canvas-data-register/2", {
        format: "convax.canvas-data-register/2",
        node: ref,
        actorSlots: [[context.actorId, claim]],
      }),
    })
  }
  const node = base.nodes.get(canvasEntityKeyV2(ref))
  if (node === undefined) throw new CanvasSchemaErrorV2("history-conflict", "History data node is absent")
  return Object.freeze({
    ...live,
    expectedEffectiveDataDigest: effectiveDataDigestV2(base, node),
    expectedDataRegisterDigest: dataRegisterDigestV2(node),
  })
}

function historyNodeDataGuardV2(
  base: CanvasSnapshotV2,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNodeV2>,
  handle: string,
  context: OwnerIntentConstructionContext,
) {
  return historyNodeDataGuardForTargetV2(base, context, bindings, provisionalNodes, { mode: "handle", handle })
}

function historyConnectableGuardV2(
  base: CanvasSnapshotV2,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNodeV2>,
  target: CanvasHistoryNodeTargetV2,
) {
  const guard = historyNodeLiveGuardForTargetV2(base, bindings, provisionalNodes, target)
  const provisional = provisionalNodes.get(canvasEntityKeyV2(guard.node))
  const node = base.nodes.get(canvasEntityKeyV2(guard.node))
  const data = provisional?.data ?? (node === undefined ? undefined : effectiveNodeDataV2(base, node).data)
  if (data === undefined || data.kind === "group")
    throw new CanvasSchemaErrorV2("history-conflict", "History endpoint is not connectable")
  return Object.freeze({ ...guard, expectedConnectable: true as const })
}

function historyContainmentGuardV2(
  base: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNodeV2>,
  target: CanvasHistoryNodeTargetV2,
) {
  const guard = historyNodeLiveGuardForTargetV2(base, bindings, provisionalNodes, target)
  const provisional = provisionalNodes.has(canvasEntityKeyV2(guard.node))
  return Object.freeze({
    ...guard,
    expectedOwnSlotDigest: provisional ? null : ownContainmentSlotDigest(base, guard.node, context.actorId),
  })
}

function pluginRequirementDigestV2(plugin: import("./types").PluginStateEnvelopeV2 | null): Digest | null {
  return plugin === null
    ? null
    : canvasDigestV2("convax.canvas-effective-plugin/2", { format: "convax.canvas-effective-plugin/2", plugin })
}

function pluginRequirementV2(plugin: import("./types").PluginStateEnvelopeV2 | null): PluginRequirementV2 | null {
  return plugin === null ? null : Object.freeze({
    pluginId: plugin.pluginId,
    snapshotDigest: plugin.snapshotDigest,
    pluginStateSchemaDigest: plugin.pluginStateSchemaDigest,
    validationArtifact: plugin.validationArtifact,
  })
}

function derivedNodeGuardV2(value: Extract<CanvasHistoryDerivedObjectV2, { kind: "node" }>) {
  return Object.freeze({ ordinal: value.ordinal, node: value.ref, expectedAbsent: true as const })
}

function derivedEdgeGuardV2(value: Extract<CanvasHistoryDerivedObjectV2, { kind: "edge" }>) {
  return Object.freeze({ ordinal: value.ordinal, edge: value.ref, expectedAbsent: true as const })
}

function originalHistoryRefV2(
  base: CanvasSnapshotV2,
  root: SemanticHistoryRootV2,
  handle: string,
): CanvasEntityRefV2 | null {
  const initial = root.initialBindings.find((binding) => binding.handle === handle)
  if (initial?.ref !== null && initial?.ref !== undefined) return initial.ref
  const receipt = [...base.operations.values()].find((candidate) => candidate.operationId === root.rootOperationId)
  if (receipt === undefined) return null
  const prefix = handle.slice(0, 2)
  const index = Number(handle.slice(2))
  if (!Number.isSafeInteger(index) || index < 0) return null
  const kind = prefix === "n/" ? "node" : prefix === "e/" ? "edge" : null
  return kind === null ? null : receipt.resultEntities.filter((ref) => ref.kind === kind)[index] ?? null
}

function retainedHistoryProofsV2(
  base: CanvasSnapshotV2,
  root: SemanticHistoryRootV2,
  direction: "undo" | "redo",
  template: CanvasHistoryTemplateV2,
  bindings: ReadonlyMap<string, CanvasEntityRefV2 | null>,
): Extract<CanvasResourceProofRefV2, { mode: "retained-canvas-history" }>[] {
  const sources: { handle: string; data: NodeDataEnvelopeV2 }[] = []
  if (template.op === "node.create") sources.push({ handle: template.handle, data: template.snapshot.data })
  else if (template.op === "node.data") sources.push({ handle: template.handle, data: template.data })
  else if (template.op === "creation-group.restore")
    for (const item of template.nodes) sources.push({ handle: item.handle, data: item.snapshot.data })
  else if (template.op === "pending-generation.restore") {
    const data = restoredPendingGenerationDataV2(base, template)
    sources.push({ handle: template.node, data })
  }
  const proofByResource = new Map<string, Extract<CanvasResourceProofRefV2, { mode: "retained-canvas-history" }>>()
  for (const source of sources.sort((left, right) => compareUtf8(left.handle, right.handle))) {
    if (source.data.kind !== "resource") continue
    const sourceNode = originalHistoryRefV2(base, root, source.handle)
    if (sourceNode?.kind !== "node")
      throw new CanvasSchemaErrorV2("history-proof", "Retained resource has no original node binding")
    const retainedSourceNode = sourceNode as CanvasEntityRefV2 & { kind: "node" }
    const proof = Object.freeze({
      format: "convax.canvas-resource-proof-ref/2" as const,
      mode: "retained-canvas-history" as const,
      sourceState: direction === "undo" ? "history-root-pre" as const : "history-root-post" as const,
      sourceOperationId: root.rootOperationId,
      sourceNode: retainedSourceNode,
      sourceDataDigest: canvasDigestV2("convax.canvas-effective-data/2", {
        format: "convax.canvas-effective-data/2",
        data: source.data,
      }),
      resource: source.data.resource,
      requireExactRetainedMaterial: true as const,
    })
    const key = new TextDecoder().decode(encodeRestrictedJcs(source.data.resource))
    if (!proofByResource.has(key)) proofByResource.set(key, proof)
  }
  void bindings
  return [...proofByResource.values()].sort((left, right) =>
    compareUtf8(new TextDecoder().decode(encodeRestrictedJcs(left.resource)), new TextDecoder().decode(encodeRestrictedJcs(right.resource))),
  )
}

function restoredPendingGenerationDataV2(
  base: CanvasSnapshotV2,
  template: Extract<CanvasHistoryTemplateV2, { op: "pending-generation.restore" }>,
): NodeDataEnvelopeV2 {
  const lifecycle = generationLifecycleCoreV2(base, template.generationId)
  if (lifecycle.terminal?.phase === "succeeded") return lifecycle.terminal.outputData
  return {
    format: "convax.canvas-node-data/2",
    kind: "placeholder",
    owner: "manual-pending",
    title: template.fallbackTitle,
    expectedClass: template.expectedClass,
    state: {
      phase: "failed",
      failureCode:
        lifecycle.recoveryFailure?.failureCode ??
        (lifecycle.terminal?.phase === "failed" ? lifecycle.terminal.failureCode : "generation-failed"),
      publicMessage: lifecycle.terminal?.phase === "failed" ? lifecycle.terminal.publicMessage : null,
    },
  }
}

function assertCurrentHistoryPhaseV2(
  base: CanvasSnapshotV2,
  root: SemanticHistoryRootV2,
  bindings: readonly CanvasHistoryBindingV2[],
  direction: "undo" | "redo",
): void {
  const selected = scheduleCanvasHistoryTemplatesV2(
    direction === "undo" ? root.inverseTemplate : root.forwardTemplate,
    bindings,
  )
  const current = direction === "undo" ? root.forwardTemplate : root.inverseTemplate
  const bindingMap = new Map(bindings.map((binding) => [binding.handle, binding.ref] as const))
  const index = buildCanvasProjectionIndexV2(base)
  const handles = new Map<string, string>()
  for (const binding of bindings) if (binding.ref !== null) handles.set(canvasEntityKeyV2(binding.ref), binding.handle)

  const nodeProducer = (handle: string): CanvasHistoryNodeSnapshotV2 | null => {
    for (const template of current) {
      if (template.op === "node.create" && template.handle === handle) return template.snapshot
      if (template.op === "creation-group.restore") {
        const item = template.nodes.find((candidate) => candidate.handle === handle)
        if (item !== undefined) return item.snapshot
      }
      if (template.op === "pending-generation.restore" && template.node === handle) {
        const ref = requireHistoryBindingNodeV2(bindingMap, handle)
        const node = base.nodes.get(canvasEntityKeyV2(ref))
        if (node === undefined) return null
        const data = effectiveNodeDataV2(base, node).data
        return {
          role: "file",
          position: template.position,
          size: template.size,
          data,
          plugin: null,
          resource: data.kind === "resource" ? data.resource : null,
        }
      }
    }
    return null
  }
  const edgeProducer = (handle: string): CanvasHistoryEdgeSnapshotV2 | null => {
    for (const template of current) {
      if (template.op === "edge.create" && template.handle === handle) return template.snapshot
      if (template.op === "creation-group.restore" || template.op === "pending-generation.restore") {
        const item = template.edges.find((candidate) => candidate.handle === handle)
        if (item !== undefined) return item.snapshot
      }
    }
    return null
  }
  const counterpart = (template: CanvasHistoryTemplateV2): CanvasHistoryTemplateV2 | undefined => {
    if (template.op === "node.geometry" || template.op === "node.data" || template.op === "node.plugin")
      return current.find((candidate) => candidate.op === template.op && candidate.handle === template.handle)
    if (template.op === "metadata.set")
      return current.find((candidate) => candidate.op === "metadata.set" && candidate.field === template.field)
    if (template.op === "containment.set")
      return current.find(
        (candidate) => candidate.op === "containment.set" && historyTargetSortKey(candidate.child) === historyTargetSortKey(template.child),
      )
    return undefined
  }

  for (const template of selected) {
    if (template.op === "node.create") {
      if (bindingMap.get(template.handle) !== null)
        throw new CanvasSchemaErrorV2("history-conflict", "History node creation source phase is not absent")
    } else if (template.op === "edge.create") {
      if (bindingMap.get(template.handle) !== null)
        throw new CanvasSchemaErrorV2("history-conflict", "History edge creation source phase is not absent")
    } else if (template.op === "creation-group.restore") {
      for (const item of [...template.nodes, ...template.edges])
        if (bindingMap.get(item.handle) !== null)
          throw new CanvasSchemaErrorV2("history-conflict", "Creation-group restoration source phase is not absent")
    } else if (template.op === "pending-generation.restore") {
      if (bindingMap.get(template.node) !== null || template.edges.some((item) => bindingMap.get(item.handle) !== null))
        throw new CanvasSchemaErrorV2("history-conflict", "Pending-generation restoration source phase is not absent")
    } else if (template.op === "node.tombstone") {
      const ref = requireHistoryBindingNodeV2(bindingMap, template.handle)
      const node = base.nodes.get(canvasEntityKeyV2(ref))
      if (node === undefined || !index.isNodeLive(ref))
        throw new CanvasSchemaErrorV2("history-conflict", "History node tombstone target is not live")
      const expected = nodeProducer(template.handle)
      if (
        expected === null ||
        (root.sourceIntentKind !== "canvas.resources.pending-generation.create/2" &&
          !sameCanonicalValueV2(historyNodeSnapshot(base, ref), expected))
      )
        throw new CanvasSchemaErrorV2("history-conflict", "History node phase snapshot changed")
      requireNoNewIncidentEdges(index, ref, bindings)
    } else if (template.op === "edge.tombstone") {
      const ref = requireHistoryBindingEdgeV2(bindingMap, template.handle)
      if (!index.isEdgeLive(ref)) throw new CanvasSchemaErrorV2("history-conflict", "History edge tombstone target is not live")
      const expected = edgeProducer(template.handle)
      if (expected === null || !sameCanonicalValueV2(historyEdgeSnapshot(base, ref, handles), expected))
        throw new CanvasSchemaErrorV2("history-conflict", "History edge phase snapshot changed")
    } else if (template.op === "node.geometry") {
      const ref = requireHistoryBindingNodeV2(bindingMap, template.handle)
      const node = base.nodes.get(canvasEntityKeyV2(ref))
      const expected = counterpart(template)
      if (
        node === undefined || expected?.op !== "node.geometry" ||
        !sameCanonicalValueV2(effectivePosition(node), expected.position) ||
        !sameCanonicalValueV2(effectiveSize(node), expected.size)
      ) throw new CanvasSchemaErrorV2("history-conflict", "History geometry phase changed")
    } else if (template.op === "node.data") {
      const ref = requireHistoryBindingNodeV2(bindingMap, template.handle)
      const node = base.nodes.get(canvasEntityKeyV2(ref))
      const expected = counterpart(template)
      if (node === undefined || expected?.op !== "node.data" || !sameCanonicalValueV2(effectiveNodeDataV2(base, node).data, expected.data))
        throw new CanvasSchemaErrorV2("history-conflict", "History data phase changed")
    } else if (template.op === "node.plugin") {
      const ref = requireHistoryBindingNodeV2(bindingMap, template.handle)
      const node = base.nodes.get(canvasEntityKeyV2(ref))
      const expected = counterpart(template)
      if (node === undefined || expected?.op !== "node.plugin" || !sameCanonicalValueV2(effectivePluginV2(node), expected.plugin))
        throw new CanvasSchemaErrorV2("history-conflict", "History Plugin phase changed")
    } else if (template.op === "containment.set") {
      if (template.child.mode === "handle" && bindingMap.get(template.child.handle) === null) continue
      const child = resolveHistoryConstructionTargetV2(template.child, bindingMap)
      const expected = counterpart(template)
      if (expected?.op !== "containment.set") throw new CanvasSchemaErrorV2("history-conflict", "History containment phase is missing")
      const expectedParent = expected.parent === null ? null : resolveHistoryConstructionTargetV2(expected.parent, bindingMap)
      const actualParent = effectiveParent(base, child)
      if (
        (expectedParent === null) !== (actualParent === null) ||
        (expectedParent !== null && actualParent !== null && canvasEntityKeyV2(expectedParent) !== canvasEntityKeyV2(actualParent))
      ) throw new CanvasSchemaErrorV2("history-conflict", "History containment phase changed")
    } else if (template.op === "metadata.set") {
      const expected = counterpart(template)
      if (expected?.op !== "metadata.set" || !sameCanonicalValueV2(metadataEffectiveValue(base, template.field), expected.value))
        throw new CanvasSchemaErrorV2("history-conflict", "History metadata phase changed")
    }
  }

  for (const template of current) {
    const snapshots = template.op === "node.create"
      ? [{ handle: template.handle, snapshot: template.snapshot }]
      : template.op === "creation-group.restore"
        ? template.nodes
        : []
    for (const item of snapshots) {
      if (item.snapshot.data.kind !== "group") continue
      const group = requireHistoryBindingNodeV2(bindingMap, item.handle)
      const expectedChildren = current
        .filter((candidate): candidate is Extract<CanvasHistoryTemplateV2, { op: "containment.set" }> => candidate.op === "containment.set")
        .filter((candidate) => candidate.parent?.mode === "handle" && candidate.parent.handle === item.handle)
        .map((candidate) => historyTargetSortKey(candidate.child))
        .sort(compareUtf8)
      const actualChildren = [...index.selectedContainments.entries()]
        .filter(([, choice]) => choice?.parent !== null && choice !== null && canvasEntityKeyV2(choice.parent) === canvasEntityKeyV2(group))
        .map(([childKey]) => {
          const handle = handles.get(childKey)
          return handle === undefined ? historyTargetSortKey({ mode: "external", ref: base.nodes.get(childKey)!.identity.ref }) : historyTargetSortKey({ mode: "handle", handle })
        })
        .sort(compareUtf8)
      if (!sameCanonicalValueV2(actualChildren, expectedChildren))
        throw new CanvasSchemaErrorV2("history-conflict", "History group effective child set changed")
    }
  }
}

function validateSemanticDerivedIdentities(
  values: readonly CanvasHistoryDerivedObjectV2[],
  base: CanvasSnapshotV2,
  context: OwnerIntentValidationContext,
): boolean {
  for (const value of values) {
    if (value.kind === "node") {
      const expected = derivedNodeRefV2(context, value.ordinal)
      if (!sameCanonicalValueV2(value.ref, expected) || base.nodes.has(canvasEntityKeyV2(value.ref))) return false
    } else if (value.kind === "edge") {
      const expected = derivedEdgeRefV2(context, value.ordinal)
      if (!sameCanonicalValueV2(value.ref, expected) || base.edges.has(canvasEntityKeyV2(value.ref))) return false
    } else if (value.kind === "relation") {
      if (value.relationId !== deriveCanvasIdV2("relation", context, value.ordinal)) return false
    } else if (value.groupId !== deriveCanvasIdV2("creationGroup", context, value.ordinal)) return false
  }
  return true
}

function captureHistoryRootV2(
  base: CanvasSnapshotV2,
  post: CanvasSnapshotV2,
  intent: CanvasTypedIntentUnionV2,
  context: OwnerIntentValidationContext,
  results: readonly CanvasEntityRefV2[],
): SemanticHistoryRootV2 {
  const sourceIntentKind = intent.kind as CanvasUndoableIntentKindV2
  const affected = historyAffectedRefs(base, post, intent, results)
  const nodeRefs = affected
    .filter((ref): ref is CanvasEntityRefV2 & { kind: "node" } => ref.kind === "node")
    .sort(refCompare)
  const edgeRefs = affected
    .filter((ref): ref is CanvasEntityRefV2 & { kind: "edge" } => ref.kind === "edge")
    .sort(refCompare)
  const handles = new Map<string, string>()
  nodeRefs.forEach((ref, index) => handles.set(canvasEntityKeyV2(ref), `n/${index}`))
  edgeRefs.forEach((ref, index) => handles.set(canvasEntityKeyV2(ref), `e/${index}`))
  const postIndex = buildCanvasProjectionIndexV2(post)
  const initialBindings: CanvasHistoryBindingV2[] = [...nodeRefs, ...edgeRefs]
    .map((ref) => {
      const live =
        ref.kind === "node"
          ? postIndex.isNodeLive(ref as CanvasEntityRefV2 & { kind: "node" })
          : postIndex.isEdgeLive(ref as CanvasEntityRefV2 & { kind: "edge" })
      return { handle: handles.get(canvasEntityKeyV2(ref))!, ref: live ? ref : null }
    })
    .sort((a, b) => compareUtf8(a.handle, b.handle))
  const inverseTemplate: CanvasHistoryTemplateV2[] = []
  const forwardTemplate: CanvasHistoryTemplateV2[] = []

  if (intent.kind === "canvas.nodes.set-geometry/2")
    for (const ref of nodeRefs) {
      inverseTemplate.push({
        op: "node.geometry",
        handle: handles.get(canvasEntityKeyV2(ref))!,
        position: effectivePosition(base.nodes.get(canvasEntityKeyV2(ref))!),
        size: effectiveSize(base.nodes.get(canvasEntityKeyV2(ref))!),
      })
      forwardTemplate.push({
        op: "node.geometry",
        handle: handles.get(canvasEntityKeyV2(ref))!,
        position: effectivePosition(post.nodes.get(canvasEntityKeyV2(ref))!),
        size: effectiveSize(post.nodes.get(canvasEntityKeyV2(ref))!),
      })
    }
  else if (intent.kind === "canvas.nodes.update-data/2")
    for (const ref of nodeRefs) {
      const before = effectiveNodeDataV2(base, base.nodes.get(canvasEntityKeyV2(ref))!).data
      const after = effectiveNodeDataV2(post, post.nodes.get(canvasEntityKeyV2(ref))!).data
      inverseTemplate.push({
        op: "node.data",
        handle: handles.get(canvasEntityKeyV2(ref))!,
        data: before,
        resource: before.kind === "resource" ? before.resource : null,
      })
      forwardTemplate.push({
        op: "node.data",
        handle: handles.get(canvasEntityKeyV2(ref))!,
        data: after,
        resource: after.kind === "resource" ? after.resource : null,
      })
    }
  else if (intent.kind === "canvas.nodes.set-plugin-state/2")
    for (const ref of nodeRefs) {
      inverseTemplate.push({
        op: "node.plugin",
        handle: handles.get(canvasEntityKeyV2(ref))!,
        plugin: effectivePluginV2(base.nodes.get(canvasEntityKeyV2(ref))!),
      })
      forwardTemplate.push({
        op: "node.plugin",
        handle: handles.get(canvasEntityKeyV2(ref))!,
        plugin: effectivePluginV2(post.nodes.get(canvasEntityKeyV2(ref))!),
      })
    }
  else if (intent.kind === "canvas.metadata.update/2")
    for (const field of intent.body.fields) {
      inverseTemplate.push({ op: "metadata.set", field: field.field, value: metadataEffectiveValue(base, field.field) })
      forwardTemplate.push({ op: "metadata.set", field: field.field, value: metadataEffectiveValue(post, field.field) })
    }
  else if (intent.kind === "canvas.nodes.set-structural-parent/2") {
    const handle = handles.get(canvasEntityKeyV2(intent.body.child))!
    inverseTemplate.push({
      op: "containment.set",
      child: { mode: "handle", handle },
      parent: historyTarget(effectiveParent(base, intent.body.child), handles),
    })
    forwardTemplate.push({
      op: "containment.set",
      child: { mode: "handle", handle },
      parent: historyTarget(effectiveParent(post, intent.body.child), handles),
    })
  } else if (intent.kind === "canvas.nodes.group/2") {
    const groupHandle = handles.get(canvasEntityKeyV2(intent.guard.group.node))!
    forwardTemplate.push({
      op: "node.create",
      handle: groupHandle,
      snapshot: historyNodeSnapshot(post, intent.guard.group.node),
    })
    inverseTemplate.push({ op: "node.tombstone", handle: groupHandle })
    for (const child of intent.body.children) {
      const childHandle = handles.get(canvasEntityKeyV2(child))!
      inverseTemplate.push({
        op: "containment.set",
        child: { mode: "handle", handle: childHandle },
        parent: historyTarget(effectiveParent(base, child), handles),
      })
      forwardTemplate.push({
        op: "containment.set",
        child: { mode: "handle", handle: childHandle },
        parent: { mode: "handle", handle: groupHandle },
      })
    }
  } else if (intent.kind === "canvas.nodes.ungroup/2") {
    const groupHandle = handles.get(canvasEntityKeyV2(intent.body.group))!
    inverseTemplate.push({
      op: "node.create",
      handle: groupHandle,
      snapshot: historyNodeSnapshot(base, intent.body.group),
    })
    inverseTemplate.push({
      op: "containment.set",
      child: { mode: "handle", handle: groupHandle },
      parent: historyTarget(effectiveParent(base, intent.body.group), handles),
    })
    forwardTemplate.push({ op: "node.tombstone", handle: groupHandle })
    for (const child of intent.body.children) {
      const childHandle = handles.get(canvasEntityKeyV2(child))!
      inverseTemplate.push({
        op: "containment.set",
        child: { mode: "handle", handle: childHandle },
        parent: { mode: "handle", handle: groupHandle },
      })
      forwardTemplate.push({ op: "containment.set", child: { mode: "handle", handle: childHandle }, parent: null })
    }
  } else if (intent.kind === "canvas.resources.pending-generation.create/2") {
    const nodeRef = nodeRefs[0]!
    for (const ref of edgeRefs)
      inverseTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKeyV2(ref))! })
    inverseTemplate.push({ op: "node.tombstone", handle: handles.get(canvasEntityKeyV2(nodeRef))! })
    forwardTemplate.push({
      op: "pending-generation.restore",
      node: handles.get(canvasEntityKeyV2(nodeRef))!,
      edges: edgeRefs.map((ref) => ({
        handle: handles.get(canvasEntityKeyV2(ref))!,
        snapshot: historyEdgeSnapshot(post, ref, handles),
      })),
      generationId: intent.body.begin.generationId,
      fallbackTitle: intent.body.node.title,
      expectedClass: intent.body.node.expectedClass,
      position: effectivePosition(post.nodes.get(canvasEntityKeyV2(nodeRef))!),
      size: effectiveSize(post.nodes.get(canvasEntityKeyV2(nodeRef))!),
    })
  } else if (intent.kind === "canvas.plugin.creation-group.create/2") {
    for (const ref of edgeRefs)
      inverseTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKeyV2(ref))! })
    for (const ref of nodeRefs)
      inverseTemplate.push({ op: "node.tombstone", handle: handles.get(canvasEntityKeyV2(ref))! })
    forwardTemplate.push({
      op: "creation-group.restore",
      groupHandle: "g/0",
      source: { mode: "external", ref: intent.body.source },
      sourceDataDigest: intent.guard.source.expectedEffectiveDataDigest,
      plugin: intent.guard.pluginRequirement,
      nodes: nodeRefs.map((ref) => ({
        handle: handles.get(canvasEntityKeyV2(ref))!,
        snapshot: historyNodeSnapshot(post, ref),
      })),
      edges: edgeRefs.map((ref) => ({
        handle: handles.get(canvasEntityKeyV2(ref))!,
        snapshot: historyEdgeSnapshot(post, ref, handles),
      })),
    })
  } else if (intent.kind === "canvas.elements.remove/2") {
    const removedNodeKeys = new Set(intent.body.nodes.map(canvasEntityKeyV2))
    const grouped = new Map<
      string,
      {
        ref: CreationGroupRefV2
        nodes: (CanvasEntityRefV2 & { kind: "node" })[]
        edges: (CanvasEntityRefV2 & { kind: "edge" })[]
      }
    >()
    for (const ref of intent.body.nodes) {
      const group = base.nodes.get(canvasEntityKeyV2(ref))!.creationGroup
      if (group === null)
        inverseTemplate.push({
          op: "node.create",
          handle: handles.get(canvasEntityKeyV2(ref))!,
          snapshot: historyNodeSnapshot(base, ref),
        })
      else {
        const bucket = grouped.get(group.groupId) ?? { ref: group, nodes: [], edges: [] }
        if (!sameCanonicalValueV2(bucket.ref, group))
          throw new CanvasSchemaErrorV2("creation-group-equivocation", "Removed creation-group members disagree")
        bucket.nodes.push(ref)
        grouped.set(group.groupId, bucket)
      }
      forwardTemplate.push({ op: "node.tombstone", handle: handles.get(canvasEntityKeyV2(ref))! })
    }
    for (const ref of intent.body.edges) {
      const group = base.edges.get(canvasEntityKeyV2(ref))!.creationGroup
      if (group === null)
        inverseTemplate.push({
          op: "edge.create",
          handle: handles.get(canvasEntityKeyV2(ref))!,
          snapshot: historyEdgeSnapshot(base, ref, handles),
        })
      else {
        const bucket = grouped.get(group.groupId) ?? { ref: group, nodes: [], edges: [] }
        if (!sameCanonicalValueV2(bucket.ref, group))
          throw new CanvasSchemaErrorV2("creation-group-equivocation", "Removed creation-group members disagree")
        bucket.edges.push(ref)
        grouped.set(group.groupId, bucket)
      }
      forwardTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKeyV2(ref))! })
    }
    for (const [index, bucket] of [...grouped.values()]
      .sort((left, right) => compareUtf8(left.ref.groupId, right.ref.groupId))
      .entries()) {
      inverseTemplate.push({
        op: "creation-group.restore",
        groupHandle: `g/${index}`,
        source: historyTarget(bucket.ref.source, handles)!,
        sourceDataDigest: bucket.ref.sourceDataDigest,
        plugin: bucket.ref.plugin,
        nodes: bucket.nodes
          .sort(refCompare)
          .map((ref) => ({ handle: handles.get(canvasEntityKeyV2(ref))!, snapshot: historyNodeSnapshot(base, ref) })),
        edges: bucket.edges.sort(refCompare).map((ref) => ({
          handle: handles.get(canvasEntityKeyV2(ref))!,
          snapshot: historyEdgeSnapshot(base, ref, handles),
        })),
      })
    }
    for (const ref of intent.body.nodes) {
      const childHandle = handles.get(canvasEntityKeyV2(ref))!
      inverseTemplate.push({
        op: "containment.set",
        child: { mode: "handle", handle: childHandle },
        parent: historyTarget(effectiveParent(base, ref), handles),
      })
      const node = base.nodes.get(canvasEntityKeyV2(ref))!
      if (effectiveNodeDataV2(base, node).data.kind !== "group") continue
      for (const [childKey, choice] of buildCanvasProjectionIndexV2(base).selectedContainments) {
        if (
          choice?.parent === null ||
          choice === null ||
          canvasEntityKeyV2(choice.parent) !== canvasEntityKeyV2(ref) ||
          removedNodeKeys.has(childKey)
        )
          continue
        const child = base.nodes.get(childKey)!.identity.ref
        inverseTemplate.push({
          op: "containment.set",
          child: { mode: "external", ref: child },
          parent: { mode: "handle", handle: childHandle },
        })
      }
    }
  } else {
    for (const ref of edgeRefs) {
      inverseTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKeyV2(ref))! })
      forwardTemplate.push({
        op: "edge.create",
        handle: handles.get(canvasEntityKeyV2(ref))!,
        snapshot: historyEdgeSnapshot(post, ref, handles),
      })
    }
    for (const ref of nodeRefs) {
      inverseTemplate.push({ op: "node.tombstone", handle: handles.get(canvasEntityKeyV2(ref))! })
      forwardTemplate.unshift({
        op: "node.create",
        handle: handles.get(canvasEntityKeyV2(ref))!,
        snapshot: historyNodeSnapshot(post, ref),
      })
    }
  }
  const scheduledInverse = scheduleCanvasHistoryTemplatesV2(inverseTemplate, initialBindings)
  const scheduledForward = scheduleCanvasHistoryTemplatesV2(forwardTemplate, initialBindings)
  const retainedResources = collectResources(scheduledInverse, scheduledForward)
  const core = {
    format: "convax.canvas-history-material/2",
    rootOperationId: context.operationId,
    sourceIntentKind,
    sourceIntentDigest: context.intentDigest,
    initialBindings,
    inverseTemplate: scheduledInverse,
    forwardTemplate: scheduledForward,
    retainedResources,
  } as const
  return {
    rootOperationId: core.rootOperationId,
    sourceIntentKind: core.sourceIntentKind,
    sourceIntentDigest: core.sourceIntentDigest,
    initialBindings: core.initialBindings,
    inverseTemplate: core.inverseTemplate,
    forwardTemplate: core.forwardTemplate,
    retainedResources: core.retainedResources,
    format: "convax.canvas-semantic-history-root/2",
    materialDigest: canvasDigestV2("convax.canvas-history-material/2", core),
  }
}

function createHistoryTransitionV2(
  snapshot: CanvasSnapshotV2,
  intent: Extract<
    CanvasTypedIntentUnionV2,
    { kind: "canvas.undo.semantic-inverse/2" | "canvas.redo.semantic-forward/2" }
  >,
  context: OwnerIntentValidationContext,
): SemanticHistoryTransitionV2 {
  const root = snapshot.semanticHistory.get(historyRootKeyV2(intent.guard.rootOperationId)) as SemanticHistoryRootV2
  const receipt = [...snapshot.operations.values()].find((candidate) => candidate.operationId === root.rootOperationId)!
  const prior = semanticHistoryState(snapshot, root, receipt)
  const resultBindings = root.initialBindings.map((binding) => {
    const created = intent.body.operations
      .flatMap((operation) => operation.derived)
      .filter(isDerivedEntity)
      .find((derived) => derived.handle === binding.handle)
    const tombstoned = intent.body.operations.some(
      (operation) =>
        (operation.template.op === "node.tombstone" || operation.template.op === "edge.tombstone") &&
        operation.template.handle === binding.handle,
    )
    return {
      handle: binding.handle,
      ref: tombstoned
        ? null
        : (created?.ref ?? prior.bindings.find((candidate) => candidate.handle === binding.handle)?.ref ?? null),
    }
  })
  const materialCore = {
    format: "convax.canvas-history-materialization/2",
    rootOperationId: root.rootOperationId,
    direction: intent.kind === "canvas.undo.semantic-inverse/2" ? "inverse" : "forward",
    priorHistoryStateDigest: prior.digest,
    operations: intent.body.operations,
    resultBindings,
  } as const
  const footprint = historyFootprint(
    snapshot,
    root,
    resultBindings,
    intent.kind === "canvas.undo.semantic-inverse/2" ? "undone" : "applied",
  )
  return {
    format: "convax.canvas-semantic-history-transition/2",
    rootOperationId: root.rootOperationId,
    mode: intent.kind === "canvas.undo.semantic-inverse/2" ? "undone" : "redone",
    priorHistoryDigest: prior.digest,
    transitionOperationId: context.operationId,
    stamp: makeStampV2(context, "0" as Uint32),
    materializationDigest: canvasDigestV2("convax.canvas-history-materialization/2", materialCore),
    resultFootprintDigest: canvasDigestV2("convax.canvas-history-footprint/2", footprint),
    resultBindings,
  }
}

function planNodeCreate(
  writes: PlannedWrite[],
  ref: CanvasEntityRefV2 & { kind: "node" },
  template: { role: "file" | "agent"; position: unknown; size: unknown; data: unknown; plugin: unknown },
  context: OwnerIntentValidationContext,
  creationGroup: CreationGroupRefV2 | null,
): void {
  const key = canvasEntityKeyV2(ref)
  const record = () => ensureNodeRecord(key)
  const identity = {
    format: "convax.canvas-node-identity/2",
    ref,
    role: template.role,
    createdBy: context.operationId,
  } as const
  planJsonWrite(writes, `nodes/${key}/identity`, "node", key, "identity", identity, (value) =>
    record().set("identity", value),
  )
  planClaim(writes, "node", ref, "position", template.position, context, record)
  planClaim(writes, "node", ref, "size", template.size, context, record)
  planClaim(writes, "node", ref, "data", template.data, context, record)
  planClaim(writes, "node", ref, "plugin", template.plugin, context, record)
  planJsonWrite(writes, `nodes/${key}/creationGroup`, "node", key, "creationGroup", creationGroup, (value) =>
    record().set("creationGroup", value),
  )
}

function planEdgeCreate(
  writes: PlannedWrite[],
  ref: CanvasEntityRefV2 & { kind: "edge" },
  source: CanvasEntityRefV2 & { kind: "node" },
  target: CanvasEntityRefV2 & { kind: "node" },
  data: unknown,
  context: OwnerIntentValidationContext,
  creationGroup: CreationGroupRefV2 | null,
): void {
  const key = canvasEntityKeyV2(ref)
  const record = () => ensureEdgeRecord(key)
  const identity = {
    format: "convax.canvas-edge-identity/2",
    ref,
    source,
    target,
    createdBy: context.operationId,
  } as const
  planJsonWrite(writes, `edges/${key}/identity`, "edge", key, "identity", identity, (value) =>
    record().set("identity", value),
  )
  planClaim(writes, "edge", ref, "data", data, context, record)
  planJsonWrite(writes, `edges/${key}/creationGroup`, "edge", key, "creationGroup", creationGroup, (value) =>
    record().set("creationGroup", value),
  )
}

let applyingDocument: Y.Doc | null = null

function applyPlannedWrites(writes: readonly PlannedWrite[], context: OwnerIntentValidationContext): void {
  for (const [index, write] of writes.entries()) {
    const value = write.value(String(index) as Uint32)
    write.apply(value)
  }
  void context
}

function planClaim(
  writes: PlannedWrite[],
  kind: "node" | "edge",
  ref: CanvasEntityRefV2,
  field: string,
  raw: unknown,
  context: OwnerIntentValidationContext,
  recordFactory?: () => Y.Map<unknown>,
): void {
  const key = canvasEntityKeyV2(ref)
  const path = `${kind === "node" ? "nodes" : "edges"}/${key}/${field}/actor/${context.actorId}`
  writes.push({
    path,
    entityKind: kind,
    entityId: key,
    field: `${field}/actor/${context.actorId}`,
    value: (ordinal) => ({ format: "convax.canvas-stamped-claim/2", stamp: makeStampV2(context, ordinal), value: raw }),
    apply: (value) => {
      const record = recordFactory?.() ?? (kind === "node" ? getRecord("nodes", key) : getRecord("edges", key))
      const slots = record.get(field)
      if (!(slots instanceof Y.Map))
        throw new CanvasSchemaErrorV2("invalid-y-type", `${path} parent is not an actor map`)
      slots.set(context.actorId, value)
    },
  })
}

function planTombstone(writes: PlannedWrite[], ref: CanvasEntityRefV2, context: OwnerIntentValidationContext): void {
  const key = canvasEntityKeyV2(ref)
  const root = ref.kind === "node" ? "nodes" : "edges"
  const path = `${root}/${key}/tombstones/${context.actorId}`
  writes.push({
    path,
    entityKind: ref.kind,
    entityId: key,
    field: `tombstones/${context.actorId}`,
    value: (ordinal) => ({ format: "convax.canvas-tombstone/2", entity: ref, stamp: makeStampV2(context, ordinal) }),
    apply: (value) => {
      const map = getRecord(root, key).get("tombstones")
      if (!(map instanceof Y.Map)) throw new CanvasSchemaErrorV2("invalid-y-type", "tombstones must be a map")
      map.set(context.actorId, value)
    },
  })
}

function planContainment(
  writes: PlannedWrite[],
  child: CanvasEntityRefV2 & { kind: "node" },
  parent: (CanvasEntityRefV2 & { kind: "node" }) | null,
  relationId: string,
  context: OwnerIntentValidationContext,
): void {
  const key = containmentKeyV2(child, context.actorId)
  planJsonWrite(
    writes,
    `containments/${key}`,
    "containment",
    key,
    "choice",
    (ordinal: Uint32) => ({
      format: "convax.canvas-containment-choice/2",
      relationId,
      child,
      parent,
      stamp: makeStampV2(context, ordinal),
    }),
    getMapSetter("containments", key),
  )
}

function planMetadata(
  writes: PlannedWrite[],
  canvasId: string,
  field: "title" | "description" | "tags",
  raw: unknown,
  context: OwnerIntentValidationContext,
): void {
  const path = `meta/${field}/actor/${context.actorId}`
  writes.push({
    path,
    entityKind: "canvas",
    entityId: canvasId,
    field: `${field}/actor/${context.actorId}`,
    value: (ordinal) => ({ format: "convax.canvas-stamped-claim/2", stamp: makeStampV2(context, ordinal), value: raw }),
    apply: (value) => {
      const fieldMap = getCanvasChildMapV2(currentDocument(), "meta").get(field)
      if (!(fieldMap instanceof Y.Map)) throw new CanvasSchemaErrorV2("invalid-y-type", "metadata actor slot missing")
      fieldMap.set(context.actorId, value)
    },
  })
}

function planJsonWrite(
  writes: PlannedWrite[],
  path: string,
  entityKind: CanvasActualWriteV2["entityKind"],
  entityId: string,
  field: string,
  value: unknown,
  apply: (value: unknown) => void,
): void {
  writes.push({
    path,
    entityKind,
    entityId,
    field,
    value: typeof value === "function" ? (value as (ordinal: Uint32) => unknown) : () => value,
    apply,
  })
}

function logicalValueWrite(
  path: string,
  entityKind: CanvasActualWriteV2["entityKind"],
  entityId: string,
  field: string,
  value: unknown,
): PlannedWrite {
  return { path, entityKind, entityId, field, value: () => value, apply: () => undefined }
}

function ensureNodeRecord(key: string): Y.Map<unknown> {
  const nodes = getCanvasChildMapV2(currentDocument(), "nodes")
  const existing = nodes.get(key)
  if (existing instanceof Y.Map) return existing
  if (existing !== undefined) throw new CanvasSchemaErrorV2("derived-entity-present", `Node ${key} already exists`)
  const record = new Y.Map<unknown>()
  record.set("identity", null)
  for (const field of ["position", "size", "data", "plugin", "tombstones"]) record.set(field, new Y.Map<unknown>())
  record.set("creationGroup", null)
  nodes.set(key, record)
  return record
}

function ensureEdgeRecord(key: string): Y.Map<unknown> {
  const edges = getCanvasChildMapV2(currentDocument(), "edges")
  const existing = edges.get(key)
  if (existing instanceof Y.Map) return existing
  if (existing !== undefined) throw new CanvasSchemaErrorV2("derived-entity-present", `Edge ${key} already exists`)
  const record = new Y.Map<unknown>()
  record.set("identity", null)
  record.set("data", new Y.Map<unknown>())
  record.set("tombstones", new Y.Map<unknown>())
  record.set("creationGroup", null)
  edges.set(key, record)
  return record
}

function getRecord(root: "nodes" | "edges", key: string): Y.Map<unknown> {
  const value = getCanvasChildMapV2(currentDocument(), root).get(key)
  if (!(value instanceof Y.Map)) throw new CanvasSchemaErrorV2("entity-missing", `${root}/${key} is missing`)
  return value
}

function getMapSetter(
  root:
    | "containments"
    | "generationBegins"
    | "generationTerminals"
    | "generationDismissals"
    | "generationRecoveryFailures",
  key: string,
): (value: unknown) => void {
  return (value) => writeJson(getCanvasChildMapV2(currentDocument(), root), key, value)
}

function currentDocument(): Y.Doc {
  if (applyingDocument === null) throw new Error("Canvas reducer has no current candidate")
  return applyingDocument
}

function writeJson(map: Y.Map<unknown>, key: string, value: unknown): void {
  map.set(key, value)
}

// Wrapper keeps candidate selection process-local and guarantees helpers never see
// replicaDoc. It intentionally does not own clone/commit/durability; the kernel does.
export function applyCanvasCandidateIntentV2(
  candidate: Y.Doc,
  context: OwnerIntentValidationContext,
  intent: CanvasTypedIntentUnionV2,
  facts: CanvasExternalFactContextV2,
): CanvasReducerOutcomeV2 {
  if (applyingDocument !== null) return "rejected"
  applyingDocument = candidate
  try {
    return reduceCanvasIntentInternalV2(candidate, context, intent, facts)
  } finally {
    applyingDocument = null
  }
}

/** Public pure candidate reducer. The collaboration kernel supplies only an
 * isolated candidateDoc here; callers never receive this entry point directly. */
export const reduceCanvasIntentV2 = applyCanvasCandidateIntentV2

function requireNode(
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  guard: { node: CanvasEntityRefV2 & { kind: "node" }; expectedIdentityDigest: Digest },
): CanvasNodeSnapshotV2 {
  const node = base.nodes.get(canvasEntityKeyV2(guard.node))
  if (
    node === undefined ||
    !index.isNodeLive(guard.node) ||
    nodeIdentityDigestV2(node) !== guard.expectedIdentityDigest
  )
    throw new CanvasSchemaErrorV2("stale-node-guard", "Node live/identity guard is stale")
  return node
}

function requireNodeData(
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  guard: {
    node: CanvasEntityRefV2 & { kind: "node" }
    expectedIdentityDigest: Digest
    expectedEffectiveDataDigest: Digest
    expectedDataRegisterDigest: Digest
  },
): CanvasNodeSnapshotV2 {
  const node = requireNode(base, index, guard)
  if (
    effectiveDataDigestV2(base, node) !== guard.expectedEffectiveDataDigest ||
    dataRegisterDigestV2(node) !== guard.expectedDataRegisterDigest
  )
    throw new CanvasSchemaErrorV2("stale-data-guard", "Node data guard is stale")
  return node
}

function requireEdge(
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  guard: { edge: CanvasEntityRefV2 & { kind: "edge" }; expectedIdentityDigest: Digest },
): CanvasEdgeSnapshotV2 {
  const edge = base.edges.get(canvasEntityKeyV2(guard.edge))
  if (
    edge === undefined ||
    !index.isEdgeLive(guard.edge) ||
    edgeIdentityDigestV2(edge) !== guard.expectedIdentityDigest
  )
    throw new CanvasSchemaErrorV2("stale-edge-guard", "Edge live/identity guard is stale")
  return edge
}

function requireConnectable(
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  guard: { node: CanvasEntityRefV2 & { kind: "node" }; expectedIdentityDigest: Digest },
): CanvasNodeSnapshotV2 {
  const node = requireNode(base, index, guard)
  if (effectiveNodeDataV2(base, node).data.kind === "group")
    throw new CanvasSchemaErrorV2("not-connectable", "Structural groups are not business-edge endpoints")
  return node
}

function requireNoNewIncidentEdges(
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  node: CanvasEntityRefV2 & { kind: "node" },
  bindings: readonly CanvasHistoryBindingV2[],
): void {
  const allowed = new Set(
    bindings
      .filter((binding) => binding.handle.startsWith("e/") && binding.ref?.kind === "edge")
      .map((binding) => canvasEntityKeyV2(binding.ref!)),
  )
  for (const edge of index.projection.edges)
    if (
      (canvasEntityKeyV2(edge.source) === canvasEntityKeyV2(node) ||
        canvasEntityKeyV2(edge.target) === canvasEntityKeyV2(node)) &&
      !allowed.has(canvasEntityKeyV2(edge.ref))
    )
      throw new CanvasSchemaErrorV2("history-conflict", "Node gained a live incident edge outside the history root")
}

function requireGenerationGuard(
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  guard: {
    node: CanvasEntityRefV2 & { kind: "node" }
    expectedIdentityDigest: Digest
    generationId: string
    beginDigest: Digest
    expectedLifecycleDigest: Digest
    expectedTerminalDigest: Digest | null
    expectedDismissalDigest: Digest | null
    expectedRecoveryFailureDigest: Digest | null
  },
): CanvasNodeSnapshotV2 {
  const node = requireNode(base, index, guard)
  const begin = base.generationBegins.get(guard.generationId)
  if (
    begin === undefined ||
    canvasEntityKeyV2(begin.node) !== node.key ||
    canvasDigestV2("convax.canvas-generation-begin/2", begin) !== guard.beginDigest ||
    generationLifecycleDigestV2(base, guard.generationId) !== guard.expectedLifecycleDigest
  )
    throw new CanvasSchemaErrorV2("stale-generation-guard", "Generation guard is stale")
  const lifecycle = generationLifecycleCoreV2(base, guard.generationId)
  if (
    nullableDigest("convax.canvas-generation-terminal/2", lifecycle.terminal) !== guard.expectedTerminalDigest ||
    nullableDigest("convax.canvas-generation-dismissal/2", lifecycle.dismissal) !== guard.expectedDismissalDigest ||
    nullableDigest("convax.canvas-generation-recovery-failure/2", lifecycle.recoveryFailure) !==
      guard.expectedRecoveryFailureDigest
  )
    throw new CanvasSchemaErrorV2("stale-generation-guard", "Generation observed facts changed")
  return node
}

function requireDerivedNode(
  base: CanvasSnapshotV2,
  context: OwnerIntentValidationContext,
  guard: { ordinal: Uint32; node: CanvasEntityRefV2 },
  template: { ordinal: Uint32; nodeId: string; incarnation: string },
): CanvasEntityRefV2 & { kind: "node" } {
  const derived = derivedNodeRefV2(context, guard.ordinal)
  if (
    guard.ordinal !== template.ordinal ||
    !sameCanonicalValueV2(derived, guard.node) ||
    template.nodeId !== derived.id ||
    template.incarnation !== derived.incarnation ||
    base.nodes.has(canvasEntityKeyV2(derived))
  )
    throw new CanvasSchemaErrorV2("derived-node-mismatch", "Derived node identity/absence guard is invalid")
  return derived
}

function requireDerivedEdge(
  base: CanvasSnapshotV2,
  context: OwnerIntentValidationContext,
  guard: { ordinal: Uint32; edge: CanvasEntityRefV2 },
  template: { ordinal: Uint32; edgeId: string; incarnation: string },
): CanvasEntityRefV2 & { kind: "edge" } {
  const derived = derivedEdgeRefV2(context, guard.ordinal)
  if (
    guard.ordinal !== template.ordinal ||
    !sameCanonicalValueV2(derived, guard.edge) ||
    template.edgeId !== derived.id ||
    template.incarnation !== derived.incarnation ||
    base.edges.has(canvasEntityKeyV2(derived))
  )
    throw new CanvasSchemaErrorV2("derived-edge-mismatch", "Derived edge identity/absence guard is invalid")
  return derived
}

function requirePlacement(
  base: CanvasSnapshotV2,
  placement: { obstacleProjectionDigest: Digest; gap: number },
): void {
  if (placement.gap !== 24 || obstacleProjectionDigestV2(base) !== placement.obstacleProjectionDigest)
    throw new CanvasSchemaErrorV2("stale-placement", "Causal placement obstacle projection is stale")
}

function placeCreatedNodes(
  base: CanvasSnapshotV2,
  anchor: { x: number; y: number },
  specs: readonly { ordinal: Uint32; size: { width: number; height: number } }[],
): { x: number; y: number }[] {
  const projection = buildCanvasProjectionIndexV2(base).projection
  const obstacles = projection.nodes
    .filter((node) => node.parent === null)
    .map((node) => ({ ...node.position, ...node.size }))
  const result = new Map<string, { x: number; y: number }>()
  for (const spec of [...specs].sort((a, b) => uint32ToNumber(a.ordinal) - uint32ToNumber(b.ordinal))) {
    let position = { ...anchor }
    let iterations = 0
    while (true) {
      const collisions = obstacles.filter(
        (obstacle) =>
          position.x < obstacle.x + obstacle.width + 24 &&
          position.x + spec.size.width + 24 > obstacle.x &&
          position.y < obstacle.y + obstacle.height + 24 &&
          position.y + spec.size.height + 24 > obstacle.y,
      )
      if (collisions.length === 0) break
      position = { x: Math.max(...collisions.map((obstacle) => obstacle.x + obstacle.width + 24)), y: position.y }
      if (++iterations > obstacles.length + 1 || !Number.isFinite(position.x) || position.x > 10_000_000)
        throw new CanvasSchemaErrorV2("placement-unavailable", "Causal placement cannot find a bounded position")
    }
    obstacles.push({ ...position, ...spec.size })
    result.set(spec.ordinal, position)
  }
  return specs.map((spec) => result.get(spec.ordinal)!)
}

function resolveEndpoint(
  value: CanvasEntityRefV2 | { createdNodeOrdinal: Uint32 },
  created: ReadonlyMap<string, CanvasEntityRefV2 & { kind: "node" }>,
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
): CanvasEntityRefV2 & { kind: "node" } {
  if ("createdNodeOrdinal" in value) {
    const ref = created.get(value.createdNodeOrdinal)
    if (ref === undefined)
      throw new CanvasSchemaErrorV2("unknown-created-endpoint", "Edge references an unknown created-node ordinal")
    return ref
  }
  if (value.kind !== "node") throw new CanvasSchemaErrorV2("invalid-endpoint", "Business edge endpoint must be a node")
  const nodeRef = value as CanvasEntityRefV2 & { kind: "node" }
  const node = base.nodes.get(canvasEntityKeyV2(nodeRef))
  if (node === undefined || !index.isNodeLive(nodeRef) || effectiveNodeDataV2(base, node).data.kind === "group")
    throw new CanvasSchemaErrorV2("stale-endpoint", "Business edge endpoint is not live/connectable")
  return nodeRef
}

function requireFact(result: "valid" | "pending" | "invalid"): void {
  if (result === "pending") throw new CanvasPendingFactError()
  if (result === "invalid") throw new CanvasSchemaErrorV2("external-fact-invalid", "External fact failed closed")
}

function hasContiguousCreationOrdinals(values: readonly { readonly ordinal: Uint32 }[]): boolean {
  const decoded = values
    .map((value) => uint32ToNumber(parseUint32(value.ordinal)))
    .sort((left, right) => left - right)
  return decoded.every((value, index) => value === index)
}

class CanvasPendingFactError extends Error {}

function assertContext(context: OwnerIntentValidationContext): void {
  if (context.scope.docKind !== "canvas")
    throw new CanvasSchemaErrorV2("invalid-context", "Canvas operation context does not select the Canvas owner")
  parseDigest(context.intentDigest)
  parseDigest(context.baseFrontierDigest)
  parseDigest(context.protocolDigest)
  parseDigest(context.ownerSchemaDigest)
  parseDigest(context.validationArtifactSetDigest)
}

function nullableDigest(
  domain:
    | "convax.canvas-generation-terminal/2"
    | "convax.canvas-generation-dismissal/2"
    | "convax.canvas-generation-recovery-failure/2",
  value: unknown,
): Digest | null {
  return value === null ? null : canvasDigestV2(domain, value)
}

function sameRequirement(plugin: PluginRequirementV2 | null, requirement: PluginRequirementV2 | null): boolean {
  if (plugin === null || requirement === null) return plugin === requirement
  return (
    plugin.pluginId === requirement.pluginId &&
    plugin.snapshotDigest === requirement.snapshotDigest &&
    plugin.pluginStateSchemaDigest === requirement.pluginStateSchemaDigest &&
    sameCanonicalValueV2(plugin.validationArtifact, requirement.validationArtifact)
  )
}

function ownContainmentSlotDigest(
  base: CanvasSnapshotV2,
  child: CanvasEntityRefV2 & { kind: "node" },
  actorId: string,
): Digest | null {
  const choice = base.containments.get(`${canvasEntityKeyV2(child)}/actor/${actorId}`)
  return choice === undefined
    ? null
    : canvasDigestV2("convax.canvas-containment-slot/2", { format: "convax.canvas-containment-slot/2", choice })
}

function metadataEffectiveValue(
  base: CanvasSnapshotV2,
  field: "title" | "description" | "tags",
): string | readonly string[] | null {
  const entries = base.meta[field]
  if (entries.length === 0) return field === "tags" ? [] : null
  return entries.reduce((winner, next) =>
    comparePortableStamps(winner[1].stamp, next[1].stamp) < 0 ? next : winner,
  )[1].value
}

function metadataEffectiveDigest(base: CanvasSnapshotV2, field: "title" | "description" | "tags"): Digest {
  return canvasDigestV2("convax.canvas-metadata-effective/2", {
    format: "convax.canvas-metadata-effective/2",
    field,
    value: metadataEffectiveValue(base, field),
  })
}

function metadataOwnSlotDigest(
  base: CanvasSnapshotV2,
  field: "title" | "description" | "tags",
  actorId: string,
): Digest | null {
  const claim = base.meta[field].find(([actor]) => actor === actorId)?.[1]
  return claim === undefined
    ? null
    : canvasDigestV2("convax.canvas-metadata-slot/2", { format: "convax.canvas-metadata-slot/2", field, claim })
}

function effectivePosition(node: CanvasNodeSnapshotV2) {
  return node.position.reduce((winner, next) =>
    comparePortableStamps(winner[1].stamp, next[1].stamp) < 0 ? next : winner,
  )[1].value
}
function effectiveSize(node: CanvasNodeSnapshotV2) {
  return node.size.reduce((winner, next) =>
    comparePortableStamps(winner[1].stamp, next[1].stamp) < 0 ? next : winner,
  )[1].value
}

function effectiveParent(
  base: CanvasSnapshotV2,
  ref: CanvasEntityRefV2 & { kind: "node" },
): (CanvasEntityRefV2 & { kind: "node" }) | null {
  return buildCanvasProjectionIndexV2(base).selectedContainments.get(canvasEntityKeyV2(ref))?.parent ?? null
}

function historyTarget(
  ref: (CanvasEntityRefV2 & { kind: "node" }) | null,
  handles: ReadonlyMap<string, string>,
): CanvasHistoryNodeTargetV2 | null {
  if (ref === null) return null
  const handle = handles.get(canvasEntityKeyV2(ref))
  return handle === undefined ? { mode: "external", ref } : { mode: "handle", handle }
}

function historyNodeSnapshot(
  base: CanvasSnapshotV2,
  ref: CanvasEntityRefV2 & { kind: "node" },
): CanvasHistoryNodeSnapshotV2 {
  const node = base.nodes.get(canvasEntityKeyV2(ref))!
  const data = effectiveNodeDataV2(base, node).data
  return {
    role: node.identity.role,
    position: effectivePosition(node),
    size: effectiveSize(node),
    data,
    plugin: effectivePluginV2(node),
    resource: data.kind === "resource" ? data.resource : null,
  }
}

function historyEdgeSnapshot(
  base: CanvasSnapshotV2,
  ref: CanvasEntityRefV2 & { kind: "edge" },
  handles: ReadonlyMap<string, string>,
): CanvasHistoryEdgeSnapshotV2 {
  const edge = base.edges.get(canvasEntityKeyV2(ref))!
  const data = edge.data[edge.data.length - 1]![1].value
  return {
    source: historyTarget(edge.identity.source, handles)!,
    target: historyTarget(edge.identity.target, handles)!,
    data,
  }
}

function historyAffectedRefs(
  base: CanvasSnapshotV2,
  _post: CanvasSnapshotV2,
  intent: CanvasTypedIntentUnionV2,
  results: readonly CanvasEntityRefV2[],
): CanvasEntityRefV2[] {
  if (intent.kind === "canvas.nodes.set-geometry/2") return intent.body.updates.map((update) => update.node)
  if (intent.kind === "canvas.nodes.update-data/2" || intent.kind === "canvas.nodes.set-plugin-state/2")
    return [intent.body.node]
  if (intent.kind === "canvas.nodes.set-structural-parent/2") return [intent.body.child]
  if (intent.kind === "canvas.metadata.update/2") return []
  if (intent.kind === "canvas.elements.remove/2") {
    const affected = [...results]
    const removed = new Set(intent.body.nodes.map(canvasEntityKeyV2))
    const index = buildCanvasProjectionIndexV2(base)
    for (const groupRef of intent.body.nodes) {
      const group = base.nodes.get(canvasEntityKeyV2(groupRef))
      if (group === undefined || effectiveNodeDataV2(base, group).data.kind !== "group") continue
      for (const [childKey, choice] of index.selectedContainments) {
        if (
          choice?.parent === null ||
          choice === null ||
          canvasEntityKeyV2(choice.parent) !== group.key ||
          removed.has(childKey)
        )
          continue
        affected.push(base.nodes.get(childKey)!.identity.ref)
      }
    }
    return sortedRefs(affected)
  }
  return [...results]
}

function collectResources(...sets: readonly (readonly CanvasHistoryTemplateV2[])[]): CanvasResourceRefV2[] {
  const resources: CanvasResourceRefV2[] = []
  for (const template of sets.flat()) {
    if (
      (template.op === "node.create" || template.op === "node.data") &&
      (template.op === "node.create" ? template.snapshot.resource : template.resource) !== null
    )
      resources.push((template.op === "node.create" ? template.snapshot.resource : template.resource)!)
    if (template.op === "creation-group.restore")
      for (const node of template.nodes) if (node.snapshot.resource !== null) resources.push(node.snapshot.resource)
  }
  resources.sort(
    (a, b) =>
      compareUtf8(a.contentDigest, b.contentDigest) ||
      compareUtf8(a.uri, b.uri) ||
      compareUtf8(
        new TextDecoder().decode(encodeRestrictedJcs(a)),
        new TextDecoder().decode(encodeRestrictedJcs(b)),
      ),
  )
  return resources.filter((resource, index) => index === 0 || !sameCanonicalValueV2(resource, resources[index - 1]))
}

function semanticHistoryState(
  base: CanvasSnapshotV2,
  root: SemanticHistoryRootV2,
  receipt: BoundedOperationReceiptV2,
): { mode: "applied" | "undone"; bindings: readonly CanvasHistoryBindingV2[]; digest: Digest } {
  const entries = [...base.semanticHistory.entries()]
    .filter(
      (entry): entry is [string, SemanticHistoryTransitionV2] =>
        entry[1].format === "convax.canvas-semantic-history-transition/2" &&
        entry[1].rootOperationId === root.rootOperationId,
    )
    .sort((left, right) => compareUtf8(left[0], right[0]))
  const transitions = entries.map(([, transition]) => transition)
  const effectiveEntry = entries.reduce<(typeof entries)[number] | null>((winner, candidate) => {
    if (winner === null) return candidate
    const stampOrder = comparePortableStamps(winner[1].stamp, candidate[1].stamp)
    return stampOrder < 0 || (stampOrder === 0 && compareUtf8(winner[0], candidate[0]) < 0) ? candidate : winner
  }, null)
  const effective = effectiveEntry?.[1] ?? null
  const mode = effective?.mode === "undone" ? "undone" : "applied"
  const bindings = effective?.resultBindings ?? root.initialBindings
  const core = {
    format: "convax.canvas-semantic-history-state/2",
    rootReceiptDigest: canvasDigestV2("convax.canvas-operation-receipt/2", receipt),
    historyRootDigest: canvasDigestV2("convax.canvas-semantic-history-root/2", root),
    transitions,
    effectiveTransitionOperationId: effective?.transitionOperationId ?? null,
    effectiveMode: mode,
    effectiveBindings: bindings,
  }
  return { mode, bindings, digest: canvasDigestV2("convax.canvas-semantic-history-state/2", core) }
}

function historyFootprint(
  base: CanvasSnapshotV2,
  root: SemanticHistoryRootV2,
  bindings: readonly CanvasHistoryBindingV2[],
  mode: "applied" | "undone",
): CanvasHistoryFootprintCoreV2 {
  const index = buildCanvasProjectionIndexV2(base)
  const handles = new Map<string, string>()
  for (const binding of bindings) if (binding.ref !== null) handles.set(canvasEntityKeyV2(binding.ref), binding.handle)

  const entities: CanvasHistoryFootprintCoreV2["entities"][number][] = []
  for (const binding of bindings) {
    if (binding.handle.startsWith("n/")) {
      const ref = isNodeRef(binding.ref) ? binding.ref : null
      const live = ref !== null && index.isNodeLive(ref)
      const incidentLiveEdges =
        ref === null
          ? []
          : index.projection.edges
              .filter(
                (edge) =>
                  canvasEntityKeyV2(edge.source) === canvasEntityKeyV2(ref) ||
                  canvasEntityKeyV2(edge.target) === canvasEntityKeyV2(ref),
              )
              .map((edge) => {
                const handle = handles.get(canvasEntityKeyV2(edge.ref))
                if (handle === undefined || !handle.startsWith("e/"))
                  throw new CanvasSchemaErrorV2(
                    "history-conflict",
                    "History footprint contains an unbound live incident edge",
                  )
                return handle
              })
              .sort(compareUtf8)
      entities.push({
        kind: "node",
        handle: binding.handle,
        ref,
        snapshot: live ? historyNodeSnapshot(base, ref) : null,
        effectiveParent: live ? historyTarget(effectiveParent(base, ref), handles) : null,
        incidentLiveEdges,
      })
    } else {
      const ref = isEdgeRef(binding.ref) ? binding.ref : null
      entities.push({
        kind: "edge",
        handle: binding.handle,
        ref,
        snapshot: ref !== null && index.isEdgeLive(ref) ? historyEdgeSnapshot(base, ref, handles) : null,
      })
    }
  }
  entities.sort((left, right) => {
    const rank = (left.kind === "node" ? 0 : 1) - (right.kind === "node" ? 0 : 1)
    return rank || compareUtf8(left.handle, right.handle)
  })

  const metadataFields = [...root.inverseTemplate, ...root.forwardTemplate]
    .filter(
      (template): template is Extract<CanvasHistoryTemplateV2, { op: "metadata.set" }> =>
        template.op === "metadata.set",
    )
    .map((template) => template.field)
    .filter((field, position, fields) => fields.indexOf(field) === position)
    .sort((left, right) => metadataFieldRank(left) - metadataFieldRank(right))
  const metadata = metadataFields.map((field) => ({
    format: "convax.canvas-metadata-effective/2" as const,
    field,
    value: metadataEffectiveValue(base, field),
  }))

  const containmentTargets = [...root.inverseTemplate, ...root.forwardTemplate]
    .filter(
      (template): template is Extract<CanvasHistoryTemplateV2, { op: "containment.set" }> =>
        template.op === "containment.set",
    )
    .map((template) => template.child)
    .sort(compareHistoryTargets)
    .filter(
      (target, position, targets) =>
        position === 0 || historyTargetSortKey(target) !== historyTargetSortKey(targets[position - 1]!),
    )
  const containments = containmentTargets.map((child) => {
    if (child.mode === "handle" && bindings.find((binding) => binding.handle === child.handle)?.ref === null)
      return { child, parent: null }
    const childRef = resolveHistoryTarget(child, bindings, [])
    return { child, parent: historyTarget(effectiveParent(base, childRef), handles) }
  })

  if (entities.length + metadata.length + containments.length === 0)
    throw new CanvasSchemaErrorV2("invalid-history", "History footprint must not be completely empty")
  return {
    format: "convax.canvas-history-footprint/2",
    rootOperationId: root.rootOperationId,
    mode,
    entities,
    metadata,
    containments,
  }
}

function metadataFieldRank(field: "title" | "description" | "tags"): number {
  return field === "title" ? 0 : field === "description" ? 1 : 2
}

function historyTargetSortKey(target: CanvasHistoryNodeTargetV2): string {
  return target.mode === "handle" ? `0/${target.handle}` : `1/node/${target.ref.id}/${target.ref.incarnation}`
}

function compareHistoryTargets(left: CanvasHistoryNodeTargetV2, right: CanvasHistoryNodeTargetV2): number {
  return compareUtf8(historyTargetSortKey(left), historyTargetSortKey(right))
}

function isNodeRef(value: CanvasEntityRefV2 | null): value is CanvasEntityRefV2 & { kind: "node" } {
  return value?.kind === "node"
}

function isEdgeRef(value: CanvasEntityRefV2 | null): value is CanvasEntityRefV2 & { kind: "edge" } {
  return value?.kind === "edge"
}

function resolveHistoryTarget(
  target: CanvasHistoryNodeTargetV2,
  bindings: readonly CanvasHistoryBindingV2[],
  derived: readonly CanvasHistoryDerivedObjectV2[],
): CanvasEntityRefV2 & { kind: "node" } {
  if (target.mode === "external") return target.ref
  const ref =
    derived.filter(isDerivedEntity).find((candidate) => candidate.handle === target.handle)?.ref ??
    bindings.find((candidate) => candidate.handle === target.handle)?.ref
  if (ref?.kind !== "node")
    throw new CanvasSchemaErrorV2("history-binding-missing", "History node target is unresolved")
  return ref as CanvasEntityRefV2 & { kind: "node" }
}

function requireHistoryNode(
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  guard: { node: CanvasEntityRefV2 & { kind: "node" }; expectedIdentityDigest: Digest },
  derived: readonly CanvasHistoryDerivedObjectV2[],
  operations: readonly CanvasSemanticOperationV2[],
  requireGroup: boolean,
): void {
  if (base.nodes.has(canvasEntityKeyV2(guard.node))) {
    const node = requireNode(base, index, guard)
    if (requireGroup && effectiveNodeDataV2(base, node).data.kind !== "group")
      throw new CanvasSchemaErrorV2("history-conflict", "History parent is not a structural group")
    return
  }
  const handle = historyHandleForRef(derived, guard.node)
  const created = handle === undefined ? undefined : findDerivedNode(derived, handle)
  if (created === undefined || !sameCanonicalValueV2(created.ref, guard.node))
    throw new CanvasSchemaErrorV2("history-conflict", "History node guard does not resolve in the transition")
  const data = historyCreatedNodeData(operations, created.handle)
  if (data === undefined || (requireGroup && data.kind !== "group"))
    throw new CanvasSchemaErrorV2("history-conflict", "History-created node has the wrong semantic role")
}

function requireHistoryConnectable(
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  guard: { node: CanvasEntityRefV2 & { kind: "node" }; expectedIdentityDigest: Digest },
  derived: readonly CanvasHistoryDerivedObjectV2[],
  operations: readonly CanvasSemanticOperationV2[],
): void {
  if (base.nodes.has(canvasEntityKeyV2(guard.node))) {
    requireConnectable(base, index, guard)
    return
  }
  const handle = historyHandleForRef(derived, guard.node)
  const data = handle === undefined ? undefined : historyCreatedNodeData(operations, handle)
  if (data === undefined || data.kind === "group")
    throw new CanvasSchemaErrorV2("history-conflict", "History endpoint is not transition-live/connectable")
}

function requireHistoryEndpoint(
  base: CanvasSnapshotV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  ref: CanvasEntityRefV2 & { kind: "node" },
  derived: readonly CanvasHistoryDerivedObjectV2[],
  operations: readonly CanvasSemanticOperationV2[],
): void {
  const node = base.nodes.get(canvasEntityKeyV2(ref))
  if (node !== undefined) {
    if (!index.isNodeLive(ref) || effectiveNodeDataV2(base, node).data.kind === "group")
      throw new CanvasSchemaErrorV2("history-conflict", "History endpoint is not live/connectable")
    return
  }
  const handle = historyHandleForRef(derived, ref)
  const data = handle === undefined ? undefined : historyCreatedNodeData(operations, handle)
  if (data === undefined || data.kind === "group")
    throw new CanvasSchemaErrorV2("history-conflict", "History-created endpoint is not connectable")
}

function historyHandleForRef(
  derived: readonly CanvasHistoryDerivedObjectV2[],
  ref: CanvasEntityRefV2,
): string | undefined {
  return derived
    .filter((value): value is Extract<CanvasHistoryDerivedObjectV2, { kind: "node" }> => value.kind === "node")
    .find((value) => canvasEntityKeyV2(value.ref) === canvasEntityKeyV2(ref))?.handle
}

function historyCreatedNodeData(
  operations: readonly CanvasSemanticOperationV2[],
  handle: string,
): NodeDataEnvelopeV2 | undefined {
  for (const operation of operations) {
    const template = operation.template
    if (template.op === "node.create" && template.handle === handle) return template.snapshot.data
    if (template.op === "creation-group.restore") {
      const member = template.nodes.find((node) => node.handle === handle)
      if (member !== undefined) return member.snapshot.data
    }
    if (template.op === "pending-generation.restore" && template.node === handle) {
      if (operation.materializedGuard.op === "pending-generation.restore")
        return {
          format: "convax.canvas-node-data/2",
          kind: "placeholder",
          owner: "manual-pending",
          title: template.fallbackTitle,
          expectedClass: template.expectedClass,
          state: { phase: "failed", failureCode: "history-restored", publicMessage: null },
        }
    }
  }
  return undefined
}

function isDerivedEntity(
  value: CanvasHistoryDerivedObjectV2,
): value is Extract<CanvasHistoryDerivedObjectV2, { kind: "node" | "edge" }> {
  return value.kind === "node" || value.kind === "edge"
}

function findDerivedNode(
  values: readonly CanvasHistoryDerivedObjectV2[],
  handle: string,
): Extract<CanvasHistoryDerivedObjectV2, { kind: "node" }> | undefined {
  return values.find(
    (value): value is Extract<CanvasHistoryDerivedObjectV2, { kind: "node" }> =>
      value.kind === "node" && value.handle === handle,
  )
}

function findDerivedEdge(
  values: readonly CanvasHistoryDerivedObjectV2[],
  handle: string,
): Extract<CanvasHistoryDerivedObjectV2, { kind: "edge" }> | undefined {
  return values.find(
    (value): value is Extract<CanvasHistoryDerivedObjectV2, { kind: "edge" }> =>
      value.kind === "edge" && value.handle === handle,
  )
}

function derivedGuardsMatch(
  nodeGuards: readonly { ordinal: Uint32; node: CanvasEntityRefV2 }[],
  edgeGuards: readonly { ordinal: Uint32; edge: CanvasEntityRefV2 }[],
  derived: readonly CanvasHistoryDerivedObjectV2[],
): boolean {
  const nodes = derived.filter(
    (value): value is Extract<CanvasHistoryDerivedObjectV2, { kind: "node" }> => value.kind === "node",
  )
  const edges = derived.filter(
    (value): value is Extract<CanvasHistoryDerivedObjectV2, { kind: "edge" }> => value.kind === "edge",
  )
  return (
    nodes.length === nodeGuards.length &&
    edges.length === edgeGuards.length &&
    nodes.every((value) =>
      nodeGuards.some((guard) => guard.ordinal === value.ordinal && sameCanonicalValueV2(guard.node, value.ref)),
    ) &&
    edges.every((value) =>
      edgeGuards.some((guard) => guard.ordinal === value.ordinal && sameCanonicalValueV2(guard.edge, value.ref)),
    )
  )
}

function operationIndex(
  operations: readonly CanvasSemanticOperationV2[],
  operation: CanvasSemanticOperationV2,
): Uint32 {
  return String(operations.indexOf(operation)) as Uint32
}
function sortedRefs(refs: readonly CanvasEntityRefV2[]): CanvasEntityRefV2[] {
  return [...refs]
    .sort(refCompare)
    .filter((ref, index, all) => index === 0 || canvasEntityKeyV2(ref) !== canvasEntityKeyV2(all[index - 1]!))
}
function refCompare(left: CanvasEntityRefV2, right: CanvasEntityRefV2): number {
  return compareUtf8(canvasEntityKeyV2(left), canvasEntityKeyV2(right))
}
function compareActualWrites(left: CanvasActualWriteV2, right: CanvasActualWriteV2): number {
  return (
    compareUtf8(left.entityKind, right.entityKind) ||
    compareUtf8(left.entityId, right.entityId) ||
    compareUtf8(left.field, right.field)
  )
}

function valueAtPath(document: Y.Doc, path: string): unknown {
  const parts = path.split("/")
  if (parts[0] === "meta")
    return (getCanvasChildMapV2(document, "meta").get(parts[1]!) as Y.Map<unknown>).get(parts[3]!)
  if (parts[0] === "nodes" || parts[0] === "edges") {
    const entityKey = parts.slice(1, 4).join("/")
    const record = getCanvasChildMapV2(document, parts[0]).get(entityKey) as Y.Map<unknown>
    const field = parts[4]!
    if (parts[5] === "actor") return (record.get(field) as Y.Map<unknown>).get(parts[6]!)
    if (field === "tombstones") return (record.get(field) as Y.Map<unknown>).get(parts[5]!)
    return record.get(field)
  }
  const rootMap = getCanvasChildMapV2(document, parts[0] as "containments")
  return rootMap.get(parts.slice(1).join("/"))
}
