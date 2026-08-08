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
  BoundedOperationReceipt,
  CanvasActualWriteEvidence,
  CanvasActualWrite,
  CanvasEdgeSnapshot,
  CanvasEntityRef,
  CanvasExternalFactContext,
  CanvasHistoryBinding,
  CanvasHistoryDerivedObject,
  CanvasHistoryEdgeSnapshot,
  CanvasHistoryFootprintCore,
  CanvasHistoryNodeSnapshot,
  CanvasHistoryNodeTarget,
  CanvasHistoryTemplate,
  CanvasIntentApplyResult,
  CanvasNodeSnapshot,
  CanvasOperationId,
  CanvasResourceRef,
  CanvasResourceProofRef,
  CanvasSemanticOperation,
  CanvasSnapshot,
  CanvasTypedIntentUnion,
  CanvasUndoableIntentKind,
  CreationGroupRef,
  Digest,
  NodeDataEnvelope,
  PluginRequirement,
  SemanticHistoryRoot,
  SemanticHistoryTransition,
  Uint32,
} from "./types"
import {
  buildCanvasProjectionIndex,
  dataRegisterDigest,
  edgeIdentityDigest,
  effectiveDataDigest,
  effectiveNodeData,
  effectivePluginDigest,
  effectivePlugin,
  generationLifecycleCore,
  generationLifecycleDigest,
  geometryDigest,
  nodeIdentityDigest,
  obstacleProjectionDigest,
  projectedGenerationDigestV2,
} from "./projection"
import {
  actualWriteValueDigest,
  canvasDigest,
  canvasEntityKey,
  containmentKey,
  derivedEdgeRef,
  derivedNodeRef,
  deriveCanvasId,
  historyRootKey,
  historyTransitionKey,
  makeStamp,
  operationKey,
  sameCanonicalValue,
  strictSortedUnique,
  CanvasSchemaError,
} from "./validation"
import {
  CANVAS_ROOT_KEYS,
  CANVAS_ROOT_NAME,
  getCanvasChildMap,
  readCanvasContainmentRecordForOwner,
  readCanvasEdgeRecordForOwner,
  readCanvasHistoryRecordForOwner,
  readCanvasNodeRecordForOwner,
  readCanvasOperationRecordForOwner,
  validateCanvasYDoc,
} from "./ydoc"
import { planCanvasHistoryDerivedOrdinals, scheduleCanvasHistoryTemplates } from "./history-schedule"

export type CanvasReducerOutcome = CanvasIntentApplyResult | "pending" | "rejected"

interface PlannedWrite {
  readonly path: string
  readonly entityKind: CanvasActualWrite["entityKind"]
  readonly entityId: string
  readonly field: string
  readonly value: (ordinal: Uint32) => unknown
  readonly apply: (value: unknown) => void
}

interface CanvasDuplicateFastPost {
  readonly base: CanvasSnapshot
  readonly snapshot: CanvasSnapshot
  readonly expectedTopLevelChanges: ReadonlyMap<string, readonly string[]>
  readonly createdNodeKeys: readonly string[]
  readonly createdEdgeKeys: readonly string[]
}

interface CanvasDuplicateCapture {
  readonly base: CanvasSnapshot
  readonly context: OwnerIntentValidationContext
  readonly root: Y.Map<unknown>
  readonly childMaps: ReadonlyMap<string, Y.Map<unknown>>
  transaction: Y.Transaction | null
  seal: Readonly<{ transaction: Y.Transaction; changed: ReadonlyMap<Y.AbstractType<any>, ReadonlySet<string | null>>; deletedStructCount: number }> | null
  invalid: boolean
}

const canvasDuplicateFastPosts = new WeakMap<Y.Doc, CanvasDuplicateFastPost>()
const canvasDuplicateCaptures = new WeakMap<Y.Doc, CanvasDuplicateCapture>()

export function armCanvasDuplicateCandidateCapture(
  candidate: Y.Doc,
  base: CanvasSnapshot,
  context: OwnerIntentValidationContext,
): void {
  if (candidate._transaction !== null) throw new TypeError("Canvas candidate capture must arm before a transaction")
  const names = [...candidate.share.keys()]
  const root = candidate.share.get(CANVAS_ROOT_NAME)
  if (names.length !== 1 || names[0] !== CANVAS_ROOT_NAME || !(root instanceof Y.Map))
    throw new TypeError("Canvas candidate capture requires the exact Canvas root")
  const childMaps = new Map<string, Y.Map<unknown>>()
  for (const key of CANVAS_ROOT_KEYS) childMaps.set(key, getCanvasChildMap(candidate, key))
  const capture: CanvasDuplicateCapture = { base, context, root, childMaps, transaction: null, seal: null, invalid: false }
  canvasDuplicateCaptures.set(candidate, capture)
  const before = (transaction: Y.Transaction) => {
    if (capture.transaction !== null || capture.seal !== null) capture.invalid = true
    else capture.transaction = transaction
  }
  const after = (transaction: Y.Transaction) => {
    if (capture.transaction !== transaction || capture.seal !== null) capture.invalid = true
    capture.seal = Object.freeze({
      transaction,
      changed: new Map([...transaction.changed].map(([type, keys]) => [type, new Set(keys)] as const)),
      deletedStructCount: [...transaction.deleteSet.clients.values()].flat().reduce((total, range) => total + range.len, 0),
    })
    candidate.off("beforeTransaction", before)
    candidate.off("afterTransaction", after)
  }
  candidate.on("beforeTransaction", before)
  candidate.on("afterTransaction", after)
}

const UNDOABLE = new Set<string>([
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
  "canvas.plugin.creation-group.create",
  "canvas.plugin.surface.create",
])

interface ProvisionalHistoryNode {
  readonly ref: CanvasEntityRef & { readonly kind: "node" }
  readonly role: "file" | "agent"
  readonly data: NodeDataEnvelope
  readonly plugin: import("./types").PluginStateEnvelope | null
  readonly position: import("./types").CanvasPoint
  readonly size: import("./types").CanvasSize
  readonly dataWriteOrdinal: Uint32
  readonly createdBy: CanvasOperationId
}

/**
 * Pure owner-side construction of one closed semantic history intent.
 * It allocates from the imported construction context only and never mutates a Y.Doc.
 */
export function materializeCanvasSemanticHistoryIntent(
  base: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  direction: "undo" | "redo",
  rootOperationId: CanvasOperationId,
): CanvasTypedIntentUnion | "rejected" {
  try {
    if (
      context.scope.docKind !== "canvas" ||
      context.scope.docId !== base.identity.canvasId ||
      context.ownerSchemaDigest !== base.identity.ownerSchemaDigest ||
      context.protocolDigest !== base.identity.protocolDigest
    )
      throw new CanvasSchemaError("scope-mismatch", "History construction context does not bind the Canvas")
    const rootValue = base.semanticHistory.get(historyRootKey(rootOperationId))
    if (rootValue?.format !== "convax.canvas-semantic-history-root")
      throw new CanvasSchemaError("history-root-missing", "Semantic history root is absent")
    const receipts = [...base.operations.values()].filter((candidate) => candidate.operationId === rootOperationId)
    if (receipts.length !== 1)
      throw new CanvasSchemaError("history-root-receipt", "Semantic history root receipt is absent or ambiguous")
    const receipt = receipts[0]!
    const state = semanticHistoryState(base, rootValue, receipt)
    const expectedMode = direction === "undo" ? "applied" : "undone"
    if (state.mode !== expectedMode)
      throw new CanvasSchemaError("history-mode", "Semantic history is not in the requested source phase")
    assertCurrentHistoryPhase(base, rootValue, state.bindings, direction)

    const selected = scheduleCanvasHistoryTemplates(
      direction === "undo" ? rootValue.inverseTemplate : rootValue.forwardTemplate,
      state.bindings,
    )
    const ordinalPlan = planCanvasHistoryDerivedOrdinals(selected, state.bindings)
    const derivedByOperation: CanvasHistoryDerivedObject[][] = []
    let ordinalCursor = 0
    for (const template of selected) {
      const count = historyDerivedCount(template)
      const slice = ordinalPlan.slice(ordinalCursor, ordinalCursor + count)
      if (slice.length !== count) throw new CanvasSchemaError("history-ordinal", "History ordinal plan truncated")
      derivedByOperation.push(
        slice.map((planned) => historyDerivedObject(planned, template, context)),
      )
      ordinalCursor += count
    }
    if (ordinalCursor !== ordinalPlan.length)
      throw new CanvasSchemaError("history-ordinal", "History ordinal plan has trailing allocations")

    const writeOrdinals = historyPlannedWriteOrdinals(selected, derivedByOperation, state.bindings, context)
    const bindings = new Map(state.bindings.map((binding) => [binding.handle, binding.ref] as const))
    const provisionalNodes = new Map<string, ProvisionalHistoryNode>()
    const operations: CanvasSemanticOperation[] = []
    for (const [index, template] of selected.entries()) {
      const derived = derivedByOperation[index]!
      const materializedGuard = materializedHistoryGuard(
        base,
        context,
        rootValue,
        template,
        bindings,
        provisionalNodes,
        derived,
      )
      const retainedResourceProofs = retainedHistoryProofs(
        base,
        rootValue,
        direction,
        template,
      )
      const operationIndex = parseUint32(String(index))
      const guardDigest = canvasDigest("convax.canvas-semantic-guard", {
        format: "convax.canvas-semantic-guard",
        rootOperationId,
        direction: direction === "undo" ? "inverse" : "forward",
        operationIndex,
        template,
        materializedGuard,
      })
      operations.push(Object.freeze({
        format: "convax.canvas-semantic-operation",
        template,
        materializedGuard,
        derived: Object.freeze(derived),
        guardDigest,
        retainedResourceProofs: Object.freeze(retainedResourceProofs),
      }))
      publishHistoryProvisionalResults(
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
      expectedRootReceiptDigest: canvasDigest("convax.canvas-operation-receipt", receipt),
      expectedHistoryRootDigest: canvasDigest("convax.canvas-semantic-history-root", rootValue),
      expectedHistoryStateDigest: state.digest,
      expectedMode,
    })
    return Object.freeze({
      format: "convax.typed-intent",
      kind: direction === "undo" ? "canvas.undo.semantic-inverse" : "canvas.redo.semantic-forward",
      guard,
      body: Object.freeze({ operations: Object.freeze(operations) }),
    }) as CanvasTypedIntentUnion
  } catch {
    return "rejected"
  }
}

function reduceCanvasIntentInternal(
  candidate: Y.Doc,
  context: OwnerIntentValidationContext,
  intent: CanvasTypedIntentUnion,
  externalFacts: CanvasExternalFactContext,
  validatedBase?: CanvasSnapshot,
): CanvasReducerOutcome {
  try {
    assertContext(context)
    const base = validatedBase ?? validateCanvasYDoc(candidate)
    if (
      context.scope.docKind !== "canvas" ||
      base.identity.canvasId !== context.scope.docId ||
      base.identity.ownerSchemaDigest !== context.ownerSchemaDigest ||
      base.identity.protocolDigest !== context.protocolDigest
    )
      throw new CanvasSchemaError("scope-mismatch", "Canvas operation context does not bind the candidate identity")
    if (base.operations.has(operationKey(context.actorId, context.operationId)))
      throw new CanvasSchemaError("operation-replay", "Operation receipt already exists")
    const writes: PlannedWrite[] = []
    const resultEntities: CanvasEntityRef[] = []
    const invalidatedEntities: CanvasEntityRef[] = []
    const invalidatedMetaFields: ("title" | "description" | "tags")[] = []
    const baseIndex = buildCanvasProjectionIndex(base)

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

    let historyRoot: SemanticHistoryRoot | null = null
    const isHistoryTransition =
      intent.kind === "canvas.undo.semantic-inverse" || intent.kind === "canvas.redo.semantic-forward"
    const receiptKey = operationKey(context.actorId, context.operationId)
    const provisionalReceipt: BoundedOperationReceipt = {
      format: "convax.canvas-operation-receipt",
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
      const operations = getCanvasChildMap(candidate, "operations")
      // Duplicate's incremental history snapshot does not require a temporary
      // receipt. Avoiding an in-transaction overwrite keeps its exact append-only
      // transaction seal free of a Yjs delete set.
      if (intent.kind !== "canvas.nodes.duplicate") writeJson(operations, receiptKey, provisionalReceipt)
      const postDomain = intent.kind === "canvas.nodes.duplicate"
        ? buildCanvasDuplicateIncrementalSnapshot(candidate, base, writes)
        : validateCanvasYDoc(candidate)
      if (UNDOABLE.has(intent.kind))
        historyRoot = captureHistoryRoot(base, postDomain, intent, context, resultEntities)
      const receipt: BoundedOperationReceipt = {
        format: "convax.canvas-operation-receipt",
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
        const path = `semanticHistory/${historyRootKey(context.operationId)}`
        writeJson(getCanvasChildMap(candidate, "semanticHistory"), historyRootKey(context.operationId), historyRoot)
        writes.push(logicalValueWrite(path, "history", context.operationId, "root", historyRoot))
      } else if (isHistoryTransition) {
        const transition = createHistoryTransition(validateCanvasYDoc(candidate), intent, context)
        const key = historyTransitionKey(transition.rootOperationId, context.actorId, context.operationId)
        writeJson(getCanvasChildMap(candidate, "semanticHistory"), key, transition)
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
      throw new CanvasSchemaError("write-count-overflow", "Canvas intent exceeds 512 logical writes")
    const changedPaths = writes.map((write) => write.path)
    const actualWrites = writes
      .map((write) => {
        const value = valueAtPath(candidate, write.path)
        const bare = { entityKind: write.entityKind, entityId: write.entityId, field: write.field }
        return { ...bare, valueDigest: actualWriteValueDigest(write.path, bare, value) }
      })
      .sort(compareActualWrites)
    const evidence: CanvasActualWriteEvidence = {
      format: "convax.canvas-actual-write-evidence",
      changedPaths,
      writes: actualWrites,
    }
    if (encodeRestrictedJcs(evidence).byteLength > 256 * 1024)
      throw new CanvasSchemaError("evidence-too-large", "Canvas write evidence exceeds 256 KiB")
    const fastPost = intent.kind === "canvas.nodes.duplicate"
      ? buildCanvasDuplicateIncrementalSnapshot(candidate, base, writes)
      : null
    if (fastPost === null) validateCanvasYDoc(candidate)
    const receipt = getCanvasChildMap(candidate, "operations").get(
      operationKey(context.actorId, context.operationId),
    ) as BoundedOperationReceipt
    const outcome = Object.freeze({
      format: "convax.canvas-intent-result",
      receipt,
      actualWriteEvidence: evidence,
      semanticHistoryRoot: historyRoot,
      invalidatedEntities: sortedRefs(invalidatedEntities),
      invalidatedMetaFields: [...new Set(invalidatedMetaFields)].sort(compareUtf8),
    })
    if (fastPost !== null) {
      canvasDuplicateFastPosts.set(candidate, Object.freeze({
        base,
        snapshot: fastPost,
        expectedTopLevelChanges: duplicateExpectedTopLevelChanges(writes),
        createdNodeKeys: Object.freeze(resultEntities.filter((ref) => ref.kind === "node").map(canvasEntityKey).sort(compareUtf8)),
        createdEdgeKeys: Object.freeze(resultEntities.filter((ref) => ref.kind === "edge").map(canvasEntityKey).sort(compareUtf8)),
      }))
    }
    return outcome
  } catch (error) {
    if (error instanceof CanvasPendingFactError) return "pending"
    if (error instanceof CanvasSchemaError || error instanceof TypeError || error instanceof RangeError)
      return "rejected"
    throw error
  }
}

function duplicateWriteRootAndKey(path: string): readonly [string, string] | null {
  const parts = path.split("/")
  const root = parts[0]!
  if (root === "nodes" || root === "edges") return [root, parts.slice(1, 4).join("/")]
  if (root === "containments" || root === "semanticHistory" || root === "operations")
    return [root, parts.slice(1).join("/")]
  return null
}

function duplicateExpectedTopLevelChanges(writes: readonly PlannedWrite[]): ReadonlyMap<string, readonly string[]> {
  const changed = new Map<string, Set<string>>()
  for (const write of writes) {
    const entry = duplicateWriteRootAndKey(write.path)
    if (entry === null) continue
    const keys = changed.get(entry[0]) ?? new Set<string>()
    keys.add(entry[1])
    changed.set(entry[0], keys)
  }
  return new Map([...changed].map(([root, keys]) => [root, Object.freeze([...keys].sort(compareUtf8))] as const))
}

function buildCanvasDuplicateIncrementalSnapshot(
  candidate: Y.Doc,
  base: CanvasSnapshot,
  writes: readonly PlannedWrite[],
): CanvasSnapshot {
  const changed = duplicateExpectedTopLevelChanges(writes)
  const nodes = new Map(base.nodes)
  const edges = new Map(base.edges)
  const containments = new Map(base.containments)
  const semanticHistory = new Map(base.semanticHistory)
  const operations = new Map(base.operations)
  for (const key of changed.get("nodes") ?? []) {
    if (base.nodes.has(key)) throw new CanvasSchemaError("fast-path-overwrite", `Duplicate overwrote node ${key}`)
    nodes.set(key, readCanvasNodeRecordForOwner(candidate, key))
  }
  for (const key of changed.get("edges") ?? []) {
    if (base.edges.has(key)) throw new CanvasSchemaError("fast-path-overwrite", `Duplicate overwrote edge ${key}`)
    edges.set(key, readCanvasEdgeRecordForOwner(candidate, key))
  }
  for (const key of changed.get("containments") ?? []) {
    if (base.containments.has(key)) throw new CanvasSchemaError("fast-path-overwrite", `Duplicate overwrote containment ${key}`)
    const choice = readCanvasContainmentRecordForOwner(candidate, key)
    if (key !== `${canvasEntityKey(choice.child)}/actor/${choice.stamp.actorId}`)
      throw new CanvasSchemaError("containment-key-mismatch", `${key} does not match containment value`)
    containments.set(key, choice)
  }
  for (const key of changed.get("semanticHistory") ?? []) {
    if (base.semanticHistory.has(key)) throw new CanvasSchemaError("fast-path-overwrite", `Duplicate overwrote history ${key}`)
    semanticHistory.set(key, readCanvasHistoryRecordForOwner(candidate, key))
  }
  for (const key of changed.get("operations") ?? []) {
    if (base.operations.has(key)) throw new CanvasSchemaError("fast-path-overwrite", `Duplicate overwrote operation ${key}`)
    operations.set(key, readCanvasOperationRecordForOwner(candidate, key))
  }
  return Object.freeze({
    ...base,
    nodes,
    edges,
    containments,
    semanticHistory,
    operations,
  })
}

export function consumeCanvasDuplicateValidatedPost(
  candidate: Y.Doc,
  base: CanvasSnapshot,
  result: CanvasIntentApplyResult,
): Readonly<{ snapshot: CanvasSnapshot; changed: ReadonlyMap<string, readonly string[]> }> | null {
  try {
    const post = canvasDuplicateFastPosts.get(candidate)
    canvasDuplicateFastPosts.delete(candidate)
    const capture = canvasDuplicateCaptures.get(candidate)
    canvasDuplicateCaptures.delete(candidate)
    if (!post || !capture || post.base !== base || capture.base !== base || capture.invalid || !capture.transaction || !capture.seal) {
      return null
    }
    if (capture.transaction !== capture.seal.transaction) return null
    // Node/edge record construction replaces exactly two integrated placeholders
    // (identity and creationGroup) per created entity. Any additional deletion is
    // an unplanned delete/reinsert and forces the full validator.
    if (capture.seal.deletedStructCount !== 2 * (post.createdNodeKeys.length + post.createdEdgeKeys.length)) {
      return null
    }
    if ((candidate.share.get(CANVAS_ROOT_NAME) as object | undefined) !== (capture.root as object)) return null
    for (const key of CANVAS_ROOT_KEYS) if (getCanvasChildMap(candidate, key) !== capture.childMaps.get(key)) return null

    const allowedNested = new Set<Y.AbstractType<any>>()
    for (const [rootName, keys] of post.expectedTopLevelChanges) {
      const rootMap = capture.childMaps.get(rootName)
      if (!rootMap) return null
      const actual = capture.seal.changed.get(rootMap)
      if (!actual || actual.has(null) || actual.size !== keys.length || keys.some((key) => !actual.has(key))) {
        return null
      }
    }
    for (const key of post.createdNodeKeys) collectCanvasNestedTypes(getCanvasChildMap(candidate, "nodes").get(key), allowedNested)
    for (const key of post.createdEdgeKeys) collectCanvasNestedTypes(getCanvasChildMap(candidate, "edges").get(key), allowedNested)
    for (const [type] of capture.seal.changed) {
      const isExpectedRoot = [...post.expectedTopLevelChanges.keys()].some((name) => capture.childMaps.get(name) === type)
      if (!isExpectedRoot && !allowedNested.has(type)) {
        return null
      }
    }
    return Object.freeze({ snapshot: post.snapshot, changed: post.expectedTopLevelChanges })
  } catch {
    return null
  }
}

function collectCanvasNestedTypes(value: unknown, result: Set<Y.AbstractType<any>>): void {
  if (!(value instanceof Y.AbstractType) || result.has(value)) return
  result.add(value)
  if (value instanceof Y.Map) for (const child of value.values()) collectCanvasNestedTypes(child, result)
}

function planIntent(
  intent: CanvasTypedIntentUnion,
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  context: OwnerIntentValidationContext,
  facts: CanvasExternalFactContext,
  writes: PlannedWrite[],
  results: CanvasEntityRef[],
  invalidated: CanvasEntityRef[],
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
    case "canvas.resources.add":
    case "canvas.resources.pending.create": {
      const resourceMode = intent.kind === "canvas.resources.add"
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
      const nodeRefs = new Map<string, CanvasEntityRef & { kind: "node" }>()
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
          const resourceNode = node as (typeof intent.body.nodes)[number] & { resource: CanvasResourceRef }
          const proof = (intent.guard as Extract<typeof intent.guard, { resourceProofs: unknown }>).resourceProofs.find(
            (binding) => binding.createdNodeOrdinal === node.ordinal,
          )
          if (proof === undefined || !sameCanonicalValue(proof.proof.resource, resourceNode.resource))
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
                format: "convax.canvas-node-data",
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
              data: pending.generationRun === undefined
                ? {
                    format: "convax.canvas-node-data",
                    kind: "placeholder",
                    owner: "manual-pending",
                    title: node.title,
                    expectedClass: pending.expectedClass,
                    state: { phase: "pending" },
                  }
                : {
                    format: "convax.canvas-node-data",
                    kind: "placeholder",
                    owner: "generation",
                    title: node.title,
                    expectedClass: pending.expectedClass,
                    generationRun: structuredClone(pending.generationRun),
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
    case "canvas.resources.pending-generation.create": {
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
        canvasEntityKey(intent.body.begin.node) !== canvasEntityKey(ref) ||
        intent.body.begin.beginActorId !== context.actorId ||
        intent.body.begin.beginStamp.writeOrdinal !== "5" ||
        intent.body.begin.outputClaimStamp.writeOrdinal !== "6" ||
        intent.body.begin.generationId !== deriveCanvasId("generation", context, intent.body.node.ordinal)
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
            format: "convax.canvas-node-data",
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
    case "canvas.elements.remove": {
      if (
        !intent.guard.requireObservedIncidentEdgeClosure ||
        intent.body.nodes.length + intent.body.edges.length < 1 ||
        intent.body.nodes.length + intent.body.edges.length > 510
      )
        return "invalid"
      const observedEdges = new Set(intent.body.edges.map(canvasEntityKey))
      for (const nodeRef of intent.body.nodes) {
        const guard = intent.guard.nodes.find(
          (candidate) => canvasEntityKey(candidate.node) === canvasEntityKey(nodeRef),
        )
        if (guard === undefined) return "invalid"
        requireNode(base, index, guard)
        for (const edge of index.projection.edges)
          if (
            (canvasEntityKey(edge.source) === canvasEntityKey(nodeRef) ||
              canvasEntityKey(edge.target) === canvasEntityKey(nodeRef)) &&
            !observedEdges.has(canvasEntityKey(edge.ref))
          )
            return "invalid"
        planTombstone(writes, nodeRef, context)
        results.push(nodeRef)
        invalidated.push(nodeRef)
      }
      for (const edgeRef of intent.body.edges) {
        const guard = intent.guard.edges.find(
          (candidate) => canvasEntityKey(candidate.edge) === canvasEntityKey(edgeRef),
        )
        if (guard === undefined) return "invalid"
        requireEdge(base, index, guard)
        planTombstone(writes, edgeRef, context)
        results.push(edgeRef)
        invalidated.push(edgeRef)
      }
      return "valid"
    }
    case "canvas.nodes.set-geometry": {
      if (
        intent.body.updates.length < 1 ||
        intent.body.updates.length > 256 ||
        intent.body.updates.length + intent.body.updates.filter((update) => update.size !== null).length + 2 > 512
      )
        return "invalid"
      for (const update of intent.body.updates) {
        const guard = intent.guard.nodes.find(
          (candidate) => canvasEntityKey(candidate.node) === canvasEntityKey(update.node),
        )
        if (guard === undefined) return "invalid"
        const node = requireNode(base, index, guard)
        if (geometryDigest(node) !== guard.expectedGeometryDigest) return "invalid"
        planClaim(writes, "node", update.node, "position", update.position, context)
        if (update.size !== null) planClaim(writes, "node", update.node, "size", update.size, context)
        results.push(update.node)
        invalidated.push(update.node)
      }
      return "valid"
    }
    case "canvas.nodes.duplicate": {
      if (
        intent.body.nodes.length < 1 ||
        intent.body.nodes.length > 85 ||
        intent.body.edges.length > 168 ||
        intent.body.containments.length > intent.body.nodes.length ||
        (intent.body.offset.x === 0 && intent.body.offset.y === 0) ||
        !Number.isFinite(intent.body.offset.x) ||
        !Number.isFinite(intent.body.offset.y) ||
        6 * intent.body.nodes.length + 3 * intent.body.edges.length + intent.body.containments.length + 2 > 512
      ) return "invalid"
      if (intent.guard.sources.length !== intent.body.nodes.length) return "invalid"
      const nodeRefs = new Map<string, CanvasEntityRef & { kind: "node" }>()
      for (let position = 0; position < intent.body.nodes.length; position += 1) {
        const template = intent.body.nodes[position]!
        const sourceGuard = intent.guard.sources[position]!
        const source = requireNodeData(base, index, sourceGuard)
        const sourceData = effectiveNodeData(base, source).data
        const sourcePlugin = effectivePlugin(source)
        if (
          template.ordinal !== String(position) ||
          template.role !== source.identity.role ||
          !sameCanonicalValue(template.data, sourceData) ||
          !sameCanonicalValue(template.plugin, sourcePlugin) ||
          template.position.x !== effectivePosition(source).x + intent.body.offset.x ||
          template.position.y !== effectivePosition(source).y + intent.body.offset.y ||
          !sameCanonicalValue(template.size, effectiveSize(source))
        ) return "invalid"
        if (template.plugin !== null) requireFact(facts.validatePluginState(template.plugin))
        const guard = intent.guard.derivedNodes.find((candidate) => candidate.ordinal === template.ordinal)
        if (!guard) return "invalid"
        const ref = requireDerivedNode(base, context, guard, template)
        nodeRefs.set(template.ordinal, ref)
        planNodeCreate(writes, ref, template, context, null)
        results.push(ref)
        invalidated.push(ref)
      }
      for (const edge of intent.body.edges) {
        const guard = intent.guard.derivedEdges.find((candidate) => candidate.ordinal === edge.ordinal)
        if (!guard) return "invalid"
        const ref = requireDerivedEdge(base, context, guard, edge)
        const source = resolveEndpoint(edge.source, nodeRefs, base, index)
        const target = resolveEndpoint(edge.target, nodeRefs, base, index)
        for (const endpoint of [edge.source, edge.target]) {
          if ("createdNodeOrdinal" in endpoint) continue
          const endpointGuard = intent.guard.existingEndpoints.find((candidate) =>
            canvasEntityKey(candidate.node) === canvasEntityKey(endpoint),
          )
          if (!endpointGuard) return "invalid"
          requireNode(base, index, endpointGuard)
        }
        planEdgeCreate(writes, ref, source, target, edge.data, context, null)
        results.push(ref)
        invalidated.push(ref)
      }
      for (const containment of intent.body.containments) {
        const child = nodeRefs.get(containment.childCreatedNodeOrdinal)
        if (!child) return "invalid"
        let parent: CanvasEntityRef & { kind: "node" }
        if ("createdNodeOrdinal" in containment.parent) {
          const parentOrdinal = containment.parent.createdNodeOrdinal
          const createdParent = nodeRefs.get(parentOrdinal)
          if (!createdParent) return "invalid"
          const parentTemplate = intent.body.nodes.find((candidate) => candidate.ordinal === parentOrdinal)
          if (parentTemplate?.data.kind !== "group") return "invalid"
          parent = createdParent
        } else {
          const parentGuard = intent.guard.existingParents.find((candidate) =>
            canvasEntityKey(candidate.node) === canvasEntityKey(containment.parent as CanvasEntityRef),
          )
          if (!parentGuard) return "invalid"
          const parentNode = requireNode(base, index, parentGuard)
          if (effectiveNodeData(base, parentNode).data.kind !== "group") return "invalid"
          parent = parentNode.identity.ref
        }
        planContainment(writes, child, parent, containment.relationId, context)
      }
      return "valid"
    }
    case "canvas.nodes.update-data": {
      const node = requireNodeData(base, index, intent.guard.node)
      if (canvasEntityKey(intent.body.node) !== node.key) return "invalid"
      if (intent.body.data.kind === "agent" ? node.identity.role !== "agent" : node.identity.role !== "file")
        return "invalid"
      const beforeResource = effectiveNodeData(base, node).data
      const afterResource = intent.body.data
      const changesResource = !sameCanonicalValue(
        beforeResource.kind === "resource" ? beforeResource.resource : null,
        afterResource.kind === "resource" ? afterResource.resource : null,
      )
      if (changesResource !== (intent.guard.resourceProof !== null)) return "invalid"
      if (intent.guard.resourceProof !== null) {
        if (
          afterResource.kind !== "resource" ||
          !sameCanonicalValue(intent.guard.resourceProof.resource, afterResource.resource)
        )
          return "invalid"
        requireFact(facts.validateCurrentResource(intent.guard.resourceProof))
      }
      planClaim(writes, "node", intent.body.node, "data", intent.body.data, context)
      results.push(intent.body.node)
      invalidated.push(intent.body.node)
      return "valid"
    }
    case "canvas.generation.runs.update": {
      if (
        intent.body.updates.length < 1 ||
        intent.body.updates.length > 256 ||
        intent.body.updates.length !== intent.guard.updates.length
      ) return "invalid"
      const seen = new Set<string>()
      for (const update of intent.body.updates) {
        const key = canvasEntityKey(update.node)
        if (seen.has(key)) return "invalid"
        seen.add(key)
        const guarded = intent.guard.updates.find(
          (candidate) => canvasEntityKey(candidate.node.node) === key,
        )
        if (!guarded) return "invalid"
        const node = requireNodeData(base, index, guarded.node)
        if (update.data.kind !== "resource" && update.data.kind !== "placeholder") return "invalid"
        if (update.data.generationRun === undefined || node.identity.role !== "file") return "invalid"
        const before = effectiveNodeData(base, node).data
        const changesResource = !sameCanonicalValue(
          before.kind === "resource" ? before.resource : null,
          update.data.kind === "resource" ? update.data.resource : null,
        )
        if (changesResource !== (guarded.resourceProof !== null)) return "invalid"
        if (guarded.resourceProof !== null) {
          if (
            update.data.kind !== "resource" ||
            !sameCanonicalValue(guarded.resourceProof.resource, update.data.resource)
          ) return "invalid"
          requireFact(facts.validateCurrentResource(guarded.resourceProof))
        }
        planClaim(writes, "node", update.node, "data", update.data, context)
        results.push(update.node)
        invalidated.push(update.node)
      }
      return "valid"
    }
    case "canvas.nodes.set-plugin-state": {
      const node = requireNode(base, index, intent.guard.node)
      if (
        effectivePluginDigest(node) !== intent.guard.node.expectedPluginDigest ||
        !sameRequirement(intent.body.plugin, intent.guard.node.requirement)
      )
        return "invalid"
      if (intent.body.plugin !== null) requireFact(facts.validatePluginState(intent.body.plugin))
      planClaim(writes, "node", intent.body.node, "plugin", intent.body.plugin, context)
      results.push(intent.body.node)
      invalidated.push(intent.body.node)
      return "valid"
    }
    case "canvas.nodes.set-structural-parent": {
      const child = requireNode(base, index, intent.guard.child)
      if (
        canvasEntityKey(child.identity.ref) !== canvasEntityKey(intent.body.child) ||
        ownContainmentSlotDigest(base, child.identity.ref, context.actorId) !== intent.guard.child.expectedOwnSlotDigest ||
        (intent.guard.child.expectedGeometryDigest !== undefined && geometryDigest(child) !== intent.guard.child.expectedGeometryDigest)
      )
        return "invalid"
      if (intent.body.parent !== null) {
        if (
          intent.guard.parent === null ||
          canvasEntityKey(intent.guard.parent.node) !== canvasEntityKey(intent.body.parent)
        )
          return "invalid"
        const parent = requireNode(base, index, intent.guard.parent)
        if (effectiveNodeData(base, parent).data.kind !== "group") return "invalid"
      }
      const expectedRelation = deriveCanvasId("relation", context, "0" as Uint32)
      if (intent.body.relationId !== expectedRelation) return "invalid"
      if (intent.body.position !== undefined) planClaim(writes, "node", intent.body.child, "position", intent.body.position, context)
      planContainment(writes, intent.body.child, intent.body.parent, intent.body.relationId, context)
      results.push(intent.body.child)
      invalidated.push(intent.body.child)
      return "valid"
    }
    case "canvas.nodes.group": {
      if (
        intent.body.children.length < 1 ||
        intent.body.children.length > 256 ||
        intent.body.children.length !== intent.body.relationIds.length
      )
        return "invalid"
      if (
        intent.body.group.ordinal !== "0" ||
        intent.body.relationIds.some(
          (relationId, index) => relationId !== deriveCanvasId("relation", context, String(index + 1) as Uint32),
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
            intent.guard.children.find((guard) => canvasEntityKey(guard.node) === canvasEntityKey(ref))!,
          )
          return { node: ref, position: effectivePosition(node), size: effectiveSize(node) }
        })
        .sort((a, b) => compareUtf8(canvasEntityKey(a.node), canvasEntityKey(b.node)))
      const planDigest = canvasDigest("convax.canvas-group-geometry-plan", {
        format: "convax.canvas-group-geometry-plan",
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
          (candidate) => canvasEntityKey(candidate.node) === canvasEntityKey(child),
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
    case "canvas.nodes.ungroup": {
      const group = requireNode(base, index, intent.guard.group)
      if (
        intent.body.nullRelationIds.some(
          (relationId, position) => relationId !== deriveCanvasId("relation", context, String(position) as Uint32),
        )
      )
        return "invalid"
      if (effectiveNodeData(base, group).data.kind !== "group") return "invalid"
      const effectiveChildren = [...index.selectedContainments.entries()]
        .filter(
          ([, choice]) => choice?.parent !== null && choice !== null && canvasEntityKey(choice.parent) === group.key,
        )
        .map(([key]) => base.nodes.get(key)!.identity.ref)
        .sort((a, b) => compareUtf8(canvasEntityKey(a), canvasEntityKey(b)))
      const digest = canvasDigest("convax.canvas-effective-child-set", {
        format: "convax.canvas-effective-child-set",
        group: group.identity.ref,
        children: effectiveChildren,
      })
      if (
        digest !== intent.guard.expectedEffectiveChildSetDigest ||
        !sameCanonicalValue(effectiveChildren, intent.body.children) ||
        intent.body.children.length !== intent.body.nullRelationIds.length
      )
        return "invalid"
      for (const [position, child] of intent.body.children.entries()) {
        const guard = intent.guard.children.find(
          (candidate) => canvasEntityKey(candidate.node) === canvasEntityKey(child),
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
    case "canvas.edges.connect": {
      if (intent.body.edge.ordinal !== "0") return "invalid"
      const ref = requireDerivedEdge(base, context, intent.guard.edge, intent.body.edge)
      if ("createdNodeOrdinal" in intent.body.edge.source || "createdNodeOrdinal" in intent.body.edge.target)
        return "invalid"
      requireConnectable(base, index, intent.guard.source)
      requireConnectable(base, index, intent.guard.target)
      if (
        canvasEntityKey(intent.body.edge.source) !== canvasEntityKey(intent.guard.source.node) ||
        canvasEntityKey(intent.body.edge.target) !== canvasEntityKey(intent.guard.target.node)
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
    case "canvas.metadata.update": {
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
    case "canvas.generation.begin": {
      const node = requireNodeData(base, index, intent.guard)
      if (
        node.identity.role !== "file" ||
        effectivePluginDigest(node) !== intent.guard.expectedPluginDigest ||
        projectedGenerationDigestV2(base, node.identity.ref) !== intent.guard.expectedProjectedGenerationDigest
      )
        return "invalid"
      const begin = intent.body.begin
      if (
        canvasEntityKey(begin.node) !== node.key ||
        begin.beginActorId !== context.actorId ||
        begin.beginStamp.writeOrdinal !== "0" ||
        begin.outputClaimStamp.writeOrdinal !== "1" ||
        base.generationBegins.has(begin.generationId)
      )
        return "invalid"
      if (deriveCanvasId("generation", context, "0" as Uint32) !== begin.generationId) return "invalid"
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
    case "canvas.generation.complete":
    case "canvas.generation.fail": {
      const node = requireGenerationGuard(base, index, intent.guard)
      if (
        intent.body.terminal.beginActorId !== context.actorId ||
        intent.body.terminal.beginActorId !== base.generationBegins.get(intent.guard.generationId)?.beginActorId ||
        intent.guard.expectedTerminalDigest !== null
      )
        return "invalid"
      if (intent.kind === "canvas.generation.complete") {
        if (
          intent.body.terminal.phase !== "succeeded" ||
          !sameCanonicalValue(intent.guard.resourceProof.resource, intent.body.terminal.outputData.resource) ||
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
    case "canvas.generations.fail-owned": {
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
    case "canvas.generation.dismiss": {
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
    case "canvas.generation.fail-recovery": {
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
    case "canvas.plugin.creation-group.create": {
      const source = requireNodeData(base, index, intent.guard.source)
      if (
        source.key !== canvasEntityKey(intent.body.source) ||
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
      const groupId = deriveCanvasId("creationGroup", context, intent.body.groupOrdinal)
      const nodeRefs = new Map<string, CanvasEntityRef & { kind: "node" }>()
      const members: CanvasEntityRef[] = []
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
      const groupRef: CreationGroupRef = {
        format: "convax.canvas-creation-group-ref",
        groupId,
        source: intent.body.source,
        sourceDataDigest: intent.guard.source.expectedEffectiveDataDigest,
        plugin: intent.guard.pluginRequirement,
        memberSetDigest: canvasDigest("convax.canvas-creation-group-member-set", {
          format: "convax.canvas-creation-group-member-set",
          groupId,
          source: intent.body.source,
          members: sortedMembers,
        }),
      }
      for (const node of intent.body.nodes) {
        const ref = nodeRefs.get(node.ordinal)!
        const proof = intent.guard.resourceProofs.find((candidate) => candidate.createdNodeOrdinal === node.ordinal)
        if (node.data.kind === "resource") {
          if (proof === undefined || !sameCanonicalValue(proof.proof.resource, node.data.resource)) return "invalid"
          requireFact(facts.validateCurrentResource(proof.proof))
        } else if (proof !== undefined) return "invalid"
        planNodeCreate(writes, ref, node, context, groupRef)
        results.push(ref)
        invalidated.push(ref)
      }
      for (const edge of intent.body.edges) {
        const ref = members.find(
          (candidate) => candidate.kind === "edge" && candidate.id === edge.edgeId,
        )! as CanvasEntityRef & { kind: "edge" }
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
      requireFact(facts.validatePluginArtifact(pluginRequirement(node.plugin)!))
      requireFact(facts.validatePluginState(node.plugin))
      planNodeCreate(
        writes,
        ref,
        {
          ...node,
          role: "file",
          position,
          data: { format: "convax.canvas-node-data", kind: "plugin-surface", title: node.title },
          plugin: node.plugin,
        },
        context,
        null,
      )
      results.push(ref)
      invalidated.push(ref)
      return "valid"
    }
    case "canvas.undo.semantic-inverse":
    case "canvas.redo.semantic-forward":
      return planSemanticOperations(intent, base, index, context, facts, writes, results, invalidated)
  }
  return "invalid"
}

function planSemanticOperations(
  intent: Extract<
    CanvasTypedIntentUnion,
    { kind: "canvas.undo.semantic-inverse" | "canvas.redo.semantic-forward" }
  >,
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  context: OwnerIntentValidationContext,
  facts: CanvasExternalFactContext,
  writes: PlannedWrite[],
  results: CanvasEntityRef[],
  invalidated: CanvasEntityRef[],
): "valid" | "pending" | "invalid" {
  const rootValue = base.semanticHistory.get(historyRootKey(intent.guard.rootOperationId))
  if (rootValue?.format !== "convax.canvas-semantic-history-root") return "invalid"
  const receipt = [...base.operations.values()].find((candidate) => candidate.operationId === rootValue.rootOperationId)
  if (
    receipt === undefined ||
    canvasDigest("convax.canvas-operation-receipt", receipt) !== intent.guard.expectedRootReceiptDigest ||
    canvasDigest("convax.canvas-semantic-history-root", rootValue) !== intent.guard.expectedHistoryRootDigest
  )
    return "invalid"
  const state = semanticHistoryState(base, rootValue, receipt)
  if (state.digest !== intent.guard.expectedHistoryStateDigest || state.mode !== intent.guard.expectedMode)
    return "invalid"
  assertCurrentHistoryPhase(
    base,
    rootValue,
    state.bindings,
    intent.kind === "canvas.undo.semantic-inverse" ? "undo" : "redo",
  )
  if (intent.body.operations.length < 1 || intent.body.operations.length > 510) return "invalid"
  const selectedTemplates =
    intent.kind === "canvas.undo.semantic-inverse" ? rootValue.inverseTemplate : rootValue.forwardTemplate
  const historyDirection = intent.kind === "canvas.undo.semantic-inverse" ? "undo" : "redo"
  const scheduledTemplates = scheduleCanvasHistoryTemplates(selectedTemplates, state.bindings)
  if (
    scheduledTemplates.length !== intent.body.operations.length ||
    intent.body.operations.some(
      (operation, position) => !sameCanonicalValue(operation.template, scheduledTemplates[position]),
    )
  )
    return "invalid"
  const allDerived = intent.body.operations.flatMap((operation) => operation.derived)
  const ordinalPlan = planCanvasHistoryDerivedOrdinals(selectedTemplates, state.bindings)
  if (
    allDerived.length !== ordinalPlan.length ||
    allDerived.some(
      (derived, position) =>
        derived.kind !== ordinalPlan[position]!.kind ||
        derived.ordinal !== ordinalPlan[position]!.ordinal ||
        historyDerivedPlanHandle(derived) !== ordinalPlan[position]!.handle,
    )
  )
    return "invalid"
  for (const operation of intent.body.operations) {
    const guardDigest = canvasDigest("convax.canvas-semantic-guard", {
      format: "convax.canvas-semantic-guard",
      rootOperationId: rootValue.rootOperationId,
      direction: intent.kind === "canvas.undo.semantic-inverse" ? "inverse" : "forward",
      operationIndex: operationIndex(intent.body.operations, operation),
      template: operation.template,
      materializedGuard: operation.materializedGuard,
    })
    if (guardDigest !== operation.guardDigest) return "invalid"
    if (!validateSemanticDerivedIdentities(operation.derived, base, context)) return "invalid"
    const expectedRetainedResourceProofs = retainedHistoryProofs(
      base,
      rootValue,
      historyDirection,
      operation.template,
    )
    if (!sameCanonicalValue(operation.retainedResourceProofs, expectedRetainedResourceProofs)) return "invalid"
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
          canvasEntityKey(boundRef) !== canvasEntityKey(operation.materializedGuard.guard.node)
        )
          return "invalid"
        requireNode(base, index, operation.materializedGuard.guard)
        requireNoNewIncidentEdges(index, boundRef, state.bindings)
      } else {
        if (
          !isEdgeRef(boundRef) ||
          operation.materializedGuard.op !== "edge.tombstone" ||
          canvasEntityKey(boundRef) !== canvasEntityKey(operation.materializedGuard.guard.edge)
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
        canvasEntityKey(binding.ref) !== canvasEntityKey(operation.materializedGuard.guard.node)
      )
        return "invalid"
      const node = requireNode(base, index, operation.materializedGuard.guard)
      if (geometryDigest(node) !== operation.materializedGuard.guard.expectedGeometryDigest) return "invalid"
      planClaim(writes, "node", binding.ref, "position", template.position, context)
      planClaim(writes, "node", binding.ref, "size", template.size, context)
      results.push(binding.ref)
      invalidated.push(binding.ref)
    } else if (template.op === "node.data") {
      const binding = state.bindings.find((candidate) => candidate.handle === template.handle)
      if (
        binding?.ref?.kind !== "node" ||
        operation.materializedGuard.op !== "node.data" ||
        canvasEntityKey(binding.ref) !== canvasEntityKey(operation.materializedGuard.guard.node)
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
        canvasEntityKey(binding.ref) !== canvasEntityKey(operation.materializedGuard.guard.node)
      )
        return "invalid"
      const node = requireNode(base, index, operation.materializedGuard.guard)
      if (
        effectivePluginDigest(node) !== operation.materializedGuard.guard.expectedPluginDigest ||
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
        !sameCanonicalValue(operation.materializedGuard.guard.edge.edge, derived.ref) ||
        operation.materializedGuard.guard.edge.ordinal !== derived.ordinal
      )
        return "invalid"
      const source = resolveHistoryTarget(template.snapshot.source, state.bindings, allDerived)
      const target = resolveHistoryTarget(template.snapshot.target, state.bindings, allDerived)
      if (
        canvasEntityKey(source) !== canvasEntityKey(operation.materializedGuard.guard.source.node) ||
        canvasEntityKey(target) !== canvasEntityKey(operation.materializedGuard.guard.target.node)
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
      if (canvasEntityKey(child) !== canvasEntityKey(operation.materializedGuard.guard.child.node)) return "invalid"
      const childNode = base.nodes.get(canvasEntityKey(child))
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
        canvasEntityKey(requireNode(base, index, operation.materializedGuard.guard.child).identity.ref) !==
          canvasEntityKey(child) ||
        ownContainmentSlotDigest(base, child, context.actorId) !==
          operation.materializedGuard.guard.child.expectedOwnSlotDigest
      )
        return "invalid"
      if (parent === null) {
        if (operation.materializedGuard.guard.parent !== null) return "invalid"
      } else {
        const parentGuard = operation.materializedGuard.guard.parent
        if (parentGuard === null || canvasEntityKey(parent) !== canvasEntityKey(parentGuard.node)) return "invalid"
        requireHistoryNode(base, index, parentGuard, allDerived, intent.body.operations, true)
      }
      const derived = operation.derived.find(
        (candidate): candidate is Extract<CanvasHistoryDerivedObject, { kind: "relation" }> =>
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
        (candidate): candidate is Extract<CanvasHistoryDerivedObject, { kind: "creation-group" }> =>
          candidate.kind === "creation-group" && candidate.handle === template.groupHandle,
      )
      if (groupDerived === undefined) return "invalid"
      const source = resolveHistoryTarget(template.source, state.bindings, allDerived)
      if (canvasEntityKey(source) !== canvasEntityKey(operation.materializedGuard.guard.source.node))
        return "invalid"
      const sourceNode = base.nodes.get(canvasEntityKey(source))
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
          canvasDigest("convax.canvas-effective-data", {
            format: "convax.canvas-effective-data",
            data: sourceData,
          }) !== template.sourceDataDigest ||
          operation.materializedGuard.guard.source.expectedEffectiveDataDigest !== template.sourceDataDigest
        )
          return "invalid"
      } else {
        requireNodeData(base, index, operation.materializedGuard.guard.source)
        if (effectiveDataDigest(base, sourceNode) !== template.sourceDataDigest) return "invalid"
      }
      requireFact(facts.validatePluginArtifact(template.plugin))
      const memberRefs = operation.derived.filter(isDerivedEntity).map((candidate) => candidate.ref)
      const groupRef: CreationGroupRef = {
        format: "convax.canvas-creation-group-ref",
        groupId: groupDerived.groupId,
        source,
        sourceDataDigest: template.sourceDataDigest,
        plugin: template.plugin,
        memberSetDigest: canvasDigest("convax.canvas-creation-group-member-set", {
          format: "convax.canvas-creation-group-member-set",
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
        canvasEntityKey(begin.node) !== canvasEntityKey(retainedBinding.ref) ||
        canvasDigest("convax.canvas-generation-begin/2", begin) !==
          operation.materializedGuard.guard.lifecycle.retainedBeginDigest
      )
        return "invalid"
      const lifecycle = generationLifecycleCore(base, template.generationId)
      if (
        generationLifecycleDigest(base, template.generationId) !==
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
      let data: NodeDataEnvelope = {
        format: "convax.canvas-node-data",
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
          !sameCanonicalValue(operation.retainedResourceProofs[0]!.resource, restoredResource))
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

function historyDerivedPlanHandle(value: CanvasHistoryDerivedObject): string {
  return value.kind === "relation" ? historyTargetSortKey(value.child) : value.handle
}

function historyDerivedCount(template: CanvasHistoryTemplate): number {
  if (template.op === "node.create" || template.op === "edge.create" || template.op === "containment.set") return 1
  if (template.op === "pending-generation.restore") return 1 + template.edges.length
  if (template.op === "creation-group.restore") return 1 + template.nodes.length + template.edges.length
  return 0
}

function historyDerivedObject(
  planned: ReturnType<typeof planCanvasHistoryDerivedOrdinals>[number],
  template: CanvasHistoryTemplate,
  context: OwnerIntentConstructionContext,
): CanvasHistoryDerivedObject {
  if (planned.kind === "node")
    return Object.freeze({ kind: "node", handle: planned.handle, ordinal: planned.ordinal, ref: derivedNodeRef(context, planned.ordinal) })
  if (planned.kind === "edge")
    return Object.freeze({ kind: "edge", handle: planned.handle, ordinal: planned.ordinal, ref: derivedEdgeRef(context, planned.ordinal) })
  if (planned.kind === "creation-group")
    return Object.freeze({
      kind: "creation-group",
      handle: planned.handle,
      ordinal: planned.ordinal,
      groupId: deriveCanvasId("creationGroup", context, planned.ordinal),
    })
  if (template.op !== "containment.set")
    throw new CanvasSchemaError("history-ordinal", "Relation allocation belongs to no containment template")
  return Object.freeze({
    kind: "relation",
    ordinal: planned.ordinal,
    relationId: deriveCanvasId("relation", context, planned.ordinal),
    child: template.child,
  })
}

function historyPlannedWriteOrdinals(
  templates: readonly CanvasHistoryTemplate[],
  derivedByOperation: readonly (readonly CanvasHistoryDerivedObject[])[],
  initialBindings: readonly CanvasHistoryBinding[],
  context: OwnerIntentConstructionContext,
): ReadonlyMap<string, Uint32> {
  const bindings = new Map(initialBindings.map((binding) => [binding.handle, binding.ref] as const))
  const paths: string[] = []
  const addNode = (ref: CanvasEntityRef & { kind: "node" }) => {
    const key = canvasEntityKey(ref)
    paths.push(
      `nodes/${key}/identity`,
      `nodes/${key}/position/actor/${context.actorId}`,
      `nodes/${key}/size/actor/${context.actorId}`,
      `nodes/${key}/data/actor/${context.actorId}`,
      `nodes/${key}/plugin/actor/${context.actorId}`,
      `nodes/${key}/creationGroup`,
    )
  }
  const addEdge = (ref: CanvasEntityRef & { kind: "edge" }) => {
    const key = canvasEntityKey(ref)
    paths.push(
      `edges/${key}/identity`,
      `edges/${key}/data/actor/${context.actorId}`,
      `edges/${key}/creationGroup`,
    )
  }
  for (const [index, template] of templates.entries()) {
    const derived = derivedByOperation[index]!
    if (template.op === "node.create") addNode(requireDerivedHistoryNode(derived, template.handle))
    else if (template.op === "edge.create") addEdge(requireDerivedHistoryEdge(derived, template.handle))
    else if (template.op === "creation-group.restore") {
      for (const item of template.nodes) addNode(requireDerivedHistoryNode(derived, item.handle))
      for (const item of template.edges) addEdge(requireDerivedHistoryEdge(derived, item.handle))
    } else if (template.op === "pending-generation.restore") {
      addNode(requireDerivedHistoryNode(derived, template.node))
      for (const item of template.edges) addEdge(requireDerivedHistoryEdge(derived, item.handle))
    } else if (template.op === "node.geometry") {
      const ref = requireHistoryBindingNode(bindings, template.handle)
      const key = canvasEntityKey(ref)
      paths.push(`nodes/${key}/position/actor/${context.actorId}`, `nodes/${key}/size/actor/${context.actorId}`)
    } else if (template.op === "node.data" || template.op === "node.plugin") {
      const ref = requireHistoryBindingNode(bindings, template.handle)
      paths.push(`nodes/${canvasEntityKey(ref)}/${template.op === "node.data" ? "data" : "plugin"}/actor/${context.actorId}`)
    } else if (template.op === "node.tombstone") {
      const ref = requireHistoryBindingNode(bindings, template.handle)
      paths.push(`nodes/${canvasEntityKey(ref)}/tombstones/${context.actorId}`)
    } else if (template.op === "edge.tombstone") {
      const ref = requireHistoryBindingEdge(bindings, template.handle)
      paths.push(`edges/${canvasEntityKey(ref)}/tombstones/${context.actorId}`)
    } else if (template.op === "containment.set") {
      const child = resolveHistoryConstructionTarget(template.child, bindings)
      paths.push(`containments/${containmentKey(child, context.actorId)}`)
    } else if (template.op === "metadata.set") paths.push(`meta/${template.field}/actor/${context.actorId}`)
    publishHistoryBindingRefs(template, derived, bindings)
  }
  paths.sort(compareUtf8)
  strictSortedUnique(paths, (path) => path, "History planned write paths")
  return new Map(paths.map((path, index) => [path, parseUint32(String(index))] as const))
}

function materializedHistoryGuard(
  base: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  root: SemanticHistoryRoot,
  template: CanvasHistoryTemplate,
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNode>,
  derived: readonly CanvasHistoryDerivedObject[],
): CanvasSemanticOperation["materializedGuard"] {
  if (template.op === "node.create") return Object.freeze({ op: "node.create", guard: null })
  if (template.op === "node.tombstone")
    return Object.freeze({ op: template.op, guard: historyNodeLiveGuard(base, bindings, provisionalNodes, template.handle) })
  if (template.op === "edge.tombstone") {
    const ref = requireHistoryBindingEdge(bindings, template.handle)
    const edge = base.edges.get(canvasEntityKey(ref))
    const index = buildCanvasProjectionIndex(base)
    if (edge === undefined || !index.isEdgeLive(ref)) throw new CanvasSchemaError("history-conflict", "History edge is not live")
    return Object.freeze({ op: template.op, guard: Object.freeze({ edge: ref, expectedLive: true, expectedIdentityDigest: edgeIdentityDigest(edge) }) })
  }
  if (template.op === "node.geometry") {
    const nodeGuard = historyNodeLiveGuard(base, bindings, provisionalNodes, template.handle)
    const node = base.nodes.get(canvasEntityKey(nodeGuard.node))
    if (node === undefined) throw new CanvasSchemaError("history-conflict", "Geometry target is not stored")
    return Object.freeze({ op: template.op, guard: Object.freeze({ ...nodeGuard, expectedGeometryDigest: geometryDigest(node) }) })
  }
  if (template.op === "node.data")
    return Object.freeze({ op: template.op, guard: historyNodeDataGuard(base, bindings, provisionalNodes, template.handle, context) })
  if (template.op === "node.plugin") {
    const nodeGuard = historyNodeLiveGuard(base, bindings, provisionalNodes, template.handle)
    const provisional = provisionalNodes.get(canvasEntityKey(nodeGuard.node))
    const node = base.nodes.get(canvasEntityKey(nodeGuard.node))
    const plugin = provisional?.plugin ?? (node === undefined ? null : effectivePlugin(node))
    return Object.freeze({
      op: template.op,
      guard: Object.freeze({ ...nodeGuard, expectedPluginDigest: pluginRequirementDigest(plugin), requirement: pluginRequirement(template.plugin) }),
    })
  }
  if (template.op === "edge.create") {
    const edge = requireDerivedHistoryEdgeObject(derived, template.handle)
    const source = historyConnectableGuard(base, bindings, provisionalNodes, template.snapshot.source)
    const target = historyConnectableGuard(base, bindings, provisionalNodes, template.snapshot.target)
    return Object.freeze({ op: template.op, guard: Object.freeze({ edge: derivedEdgeGuard(edge), source, target }) })
  }
  if (template.op === "containment.set") {
    const child = historyContainmentGuard(base, context, bindings, provisionalNodes, template.child)
    const parent = template.parent === null ? null : historyNodeLiveGuardForTarget(base, bindings, provisionalNodes, template.parent)
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
    const source = historyNodeDataGuardForTarget(base, context, bindings, provisionalNodes, template.source)
    if (source.expectedEffectiveDataDigest !== template.sourceDataDigest)
      throw new CanvasSchemaError("history-conflict", "Creation-group source data changed")
    return Object.freeze({
      op: template.op,
      guard: Object.freeze({
        source,
        pluginRequirement: template.plugin,
        derivedNodes: Object.freeze(template.nodes.map((item) => derivedNodeGuard(requireDerivedHistoryNodeObject(derived, item.handle)))),
        derivedEdges: Object.freeze(template.edges.map((item) => derivedEdgeGuard(requireDerivedHistoryEdgeObject(derived, item.handle)))),
      }),
    })
  }
  const begin = base.generationBegins.get(template.generationId)
  const initial = originalHistoryRef(base, root, template.node)
  if (begin === undefined || initial?.kind !== "node" || canvasEntityKey(begin.node) !== canvasEntityKey(initial))
    throw new CanvasSchemaError("history-conflict", "Retained generation begin is not bound to the history node")
  const lifecycle = generationLifecycleCore(base, template.generationId)
  if (lifecycle.dismissal !== null || (lifecycle.terminal === null && lifecycle.recoveryFailure === null))
    throw new CanvasSchemaError("history-redo-unavailable", "Generation lifecycle cannot be restored")
  return Object.freeze({
    op: template.op,
    guard: Object.freeze({
      lifecycle: Object.freeze({
        rootOperationId: root.rootOperationId,
        nodeHandle: template.node,
        generationId: template.generationId,
        retainedBeginDigest: canvasDigest("convax.canvas-generation-begin/2", begin),
        expectedLifecycleDigest: generationLifecycleDigest(base, template.generationId),
        expectedTerminalDigest: nullableDigest("convax.canvas-generation-terminal/2", lifecycle.terminal),
        expectedDismissalDigest: nullableDigest("convax.canvas-generation-dismissal/2", lifecycle.dismissal),
        expectedRecoveryFailureDigest: nullableDigest("convax.canvas-generation-recovery-failure/2", lifecycle.recoveryFailure),
      }),
      derivedNode: derivedNodeGuard(requireDerivedHistoryNodeObject(derived, template.node)),
      derivedEdges: Object.freeze(template.edges.map((item) => derivedEdgeGuard(requireDerivedHistoryEdgeObject(derived, item.handle)))),
    }),
  })
}

function publishHistoryProvisionalResults(
  template: CanvasHistoryTemplate,
  derived: readonly CanvasHistoryDerivedObject[],
  bindings: Map<string, CanvasEntityRef | null>,
  provisionalNodes: Map<string, ProvisionalHistoryNode>,
  writeOrdinals: ReadonlyMap<string, Uint32>,
  context: OwnerIntentConstructionContext,
): void {
  publishHistoryBindingRefs(template, derived, bindings)
  const publishNode = (handle: string, snapshot: CanvasHistoryNodeSnapshot) => {
    const ref = requireDerivedHistoryNode(derived, handle)
    const path = `nodes/${canvasEntityKey(ref)}/data/actor/${context.actorId}`
    const dataWriteOrdinal = writeOrdinals.get(path)
    if (dataWriteOrdinal === undefined) throw new CanvasSchemaError("history-ordinal", "Created node data write has no ordinal")
    provisionalNodes.set(canvasEntityKey(ref), Object.freeze({
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

function publishHistoryBindingRefs(
  template: CanvasHistoryTemplate,
  derived: readonly CanvasHistoryDerivedObject[],
  bindings: Map<string, CanvasEntityRef | null>,
): void {
  if (template.op === "node.create") bindings.set(template.handle, requireDerivedHistoryNode(derived, template.handle))
  else if (template.op === "edge.create") bindings.set(template.handle, requireDerivedHistoryEdge(derived, template.handle))
  else if (template.op === "creation-group.restore") {
    for (const item of template.nodes) bindings.set(item.handle, requireDerivedHistoryNode(derived, item.handle))
    for (const item of template.edges) bindings.set(item.handle, requireDerivedHistoryEdge(derived, item.handle))
  } else if (template.op === "pending-generation.restore") {
    bindings.set(template.node, requireDerivedHistoryNode(derived, template.node))
    for (const item of template.edges) bindings.set(item.handle, requireDerivedHistoryEdge(derived, item.handle))
  } else if (template.op === "node.tombstone" || template.op === "edge.tombstone") bindings.set(template.handle, null)
}

function requireDerivedHistoryNodeObject(
  values: readonly CanvasHistoryDerivedObject[],
  handle: string,
): Extract<CanvasHistoryDerivedObject, { kind: "node" }> {
  const matches = values.filter(
    (value): value is Extract<CanvasHistoryDerivedObject, { kind: "node" }> => value.kind === "node" && value.handle === handle,
  )
  if (matches.length !== 1) throw new CanvasSchemaError("history-ordinal", `History node ${handle} is not allocated exactly once`)
  return matches[0]!
}

function requireDerivedHistoryEdgeObject(
  values: readonly CanvasHistoryDerivedObject[],
  handle: string,
): Extract<CanvasHistoryDerivedObject, { kind: "edge" }> {
  const matches = values.filter(
    (value): value is Extract<CanvasHistoryDerivedObject, { kind: "edge" }> => value.kind === "edge" && value.handle === handle,
  )
  if (matches.length !== 1) throw new CanvasSchemaError("history-ordinal", `History edge ${handle} is not allocated exactly once`)
  return matches[0]!
}

function requireDerivedHistoryNode(
  values: readonly CanvasHistoryDerivedObject[],
  handle: string,
): CanvasEntityRef & { kind: "node" } {
  return requireDerivedHistoryNodeObject(values, handle).ref
}

function requireDerivedHistoryEdge(
  values: readonly CanvasHistoryDerivedObject[],
  handle: string,
): CanvasEntityRef & { kind: "edge" } {
  return requireDerivedHistoryEdgeObject(values, handle).ref
}

function requireHistoryBindingNode(
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  handle: string,
): CanvasEntityRef & { kind: "node" } {
  const ref = bindings.get(handle)
  if (ref?.kind !== "node") throw new CanvasSchemaError("history-binding-missing", `History node ${handle} is not bound`)
  return ref as CanvasEntityRef & { kind: "node" }
}

function requireHistoryBindingEdge(
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  handle: string,
): CanvasEntityRef & { kind: "edge" } {
  const ref = bindings.get(handle)
  if (ref?.kind !== "edge") throw new CanvasSchemaError("history-binding-missing", `History edge ${handle} is not bound`)
  return ref as CanvasEntityRef & { kind: "edge" }
}

function resolveHistoryConstructionTarget(
  target: CanvasHistoryNodeTarget,
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
): CanvasEntityRef & { kind: "node" } {
  return target.mode === "external" ? target.ref : requireHistoryBindingNode(bindings, target.handle)
}

function historyNodeLiveGuardForTarget(
  base: CanvasSnapshot,
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNode>,
  target: CanvasHistoryNodeTarget,
) {
  const ref = resolveHistoryConstructionTarget(target, bindings)
  const provisional = provisionalNodes.get(canvasEntityKey(ref))
  if (provisional !== undefined)
    return Object.freeze({
      node: ref,
      expectedLive: true as const,
      expectedIdentityDigest: canvasDigest("convax.canvas-node-identity", {
        format: "convax.canvas-node-identity",
        ref,
        role: provisional.role,
        createdBy: provisional.createdBy,
      }),
    })
  const node = base.nodes.get(canvasEntityKey(ref))
  if (node === undefined || !buildCanvasProjectionIndex(base).isNodeLive(ref))
    throw new CanvasSchemaError("history-conflict", "History node is not effective-live")
  return Object.freeze({ node: ref, expectedLive: true as const, expectedIdentityDigest: nodeIdentityDigest(node) })
}

function historyNodeLiveGuard(
  base: CanvasSnapshot,
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNode>,
  handle: string,
) {
  return historyNodeLiveGuardForTarget(base, bindings, provisionalNodes, { mode: "handle", handle })
}

function historyNodeDataGuardForTarget(
  base: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNode>,
  target: CanvasHistoryNodeTarget,
) {
  const ref = resolveHistoryConstructionTarget(target, bindings)
  const live = historyNodeLiveGuardForTarget(base, bindings, provisionalNodes, target)
  const provisional = provisionalNodes.get(canvasEntityKey(ref))
  if (provisional !== undefined) {
    const claim = {
      format: "convax.canvas-stamped-claim",
      stamp: makeStamp(context, provisional.dataWriteOrdinal),
      value: provisional.data,
    } as const
    return Object.freeze({
      ...live,
      expectedEffectiveDataDigest: canvasDigest("convax.canvas-effective-data", {
        format: "convax.canvas-effective-data",
        data: provisional.data,
      }),
      expectedDataRegisterDigest: canvasDigest("convax.canvas-data-register", {
        format: "convax.canvas-data-register",
        node: ref,
        actorSlots: [[context.actorId, claim]],
      }),
    })
  }
  const node = base.nodes.get(canvasEntityKey(ref))
  if (node === undefined) throw new CanvasSchemaError("history-conflict", "History data node is absent")
  return Object.freeze({
    ...live,
    expectedEffectiveDataDigest: effectiveDataDigest(base, node),
    expectedDataRegisterDigest: dataRegisterDigest(node),
  })
}

function historyNodeDataGuard(
  base: CanvasSnapshot,
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNode>,
  handle: string,
  context: OwnerIntentConstructionContext,
) {
  return historyNodeDataGuardForTarget(base, context, bindings, provisionalNodes, { mode: "handle", handle })
}

function historyConnectableGuard(
  base: CanvasSnapshot,
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNode>,
  target: CanvasHistoryNodeTarget,
) {
  const guard = historyNodeLiveGuardForTarget(base, bindings, provisionalNodes, target)
  const provisional = provisionalNodes.get(canvasEntityKey(guard.node))
  const node = base.nodes.get(canvasEntityKey(guard.node))
  const data = provisional?.data ?? (node === undefined ? undefined : effectiveNodeData(base, node).data)
  if (data === undefined || data.kind === "group")
    throw new CanvasSchemaError("history-conflict", "History endpoint is not connectable")
  return Object.freeze({ ...guard, expectedConnectable: true as const })
}

function historyContainmentGuard(
  base: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  bindings: ReadonlyMap<string, CanvasEntityRef | null>,
  provisionalNodes: ReadonlyMap<string, ProvisionalHistoryNode>,
  target: CanvasHistoryNodeTarget,
) {
  const guard = historyNodeLiveGuardForTarget(base, bindings, provisionalNodes, target)
  const provisional = provisionalNodes.has(canvasEntityKey(guard.node))
  return Object.freeze({
    ...guard,
    expectedOwnSlotDigest: provisional ? null : ownContainmentSlotDigest(base, guard.node, context.actorId),
  })
}

function pluginRequirementDigest(plugin: import("./types").PluginStateEnvelope | null): Digest | null {
  return plugin === null
    ? null
    : canvasDigest("convax.canvas-effective-plugin", { format: "convax.canvas-effective-plugin", plugin })
}

function pluginRequirement(plugin: import("./types").PluginStateEnvelope | null): PluginRequirement | null {
  return plugin === null ? null : Object.freeze({
    pluginId: plugin.pluginId,
    snapshotDigest: plugin.snapshotDigest,
    pluginStateSchemaDigest: plugin.pluginStateSchemaDigest,
    validationArtifact: plugin.validationArtifact,
  })
}

function derivedNodeGuard(value: Extract<CanvasHistoryDerivedObject, { kind: "node" }>) {
  return Object.freeze({ ordinal: value.ordinal, node: value.ref, expectedAbsent: true as const })
}

function derivedEdgeGuard(value: Extract<CanvasHistoryDerivedObject, { kind: "edge" }>) {
  return Object.freeze({ ordinal: value.ordinal, edge: value.ref, expectedAbsent: true as const })
}

function originalHistoryRef(
  base: CanvasSnapshot,
  root: SemanticHistoryRoot,
  handle: string,
): CanvasEntityRef | null {
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

function retainedHistoryProofs(
  base: CanvasSnapshot,
  root: SemanticHistoryRoot,
  direction: "undo" | "redo",
  template: CanvasHistoryTemplate,
): Extract<CanvasResourceProofRef, { mode: "retained-canvas-history" }>[] {
  const sources: { handle: string; data: NodeDataEnvelope }[] = []
  if (template.op === "node.create") sources.push({ handle: template.handle, data: template.snapshot.data })
  else if (template.op === "node.data") sources.push({ handle: template.handle, data: template.data })
  else if (template.op === "creation-group.restore")
    for (const item of template.nodes) sources.push({ handle: item.handle, data: item.snapshot.data })
  else if (template.op === "pending-generation.restore") {
    const data = restoredPendingGenerationDataV2(base, template)
    sources.push({ handle: template.node, data })
  }
  const proofByResource = new Map<string, Extract<CanvasResourceProofRef, { mode: "retained-canvas-history" }>>()
  for (const source of sources.sort((left, right) => compareUtf8(left.handle, right.handle))) {
    if (source.data.kind !== "resource") continue
    const sourceNode = originalHistoryRef(base, root, source.handle)
    if (sourceNode?.kind !== "node")
      throw new CanvasSchemaError("history-proof", "Retained resource has no original node binding")
    const retainedSourceNode = sourceNode as CanvasEntityRef & { kind: "node" }
    const proof = Object.freeze({
      format: "convax.canvas-resource-proof-ref" as const,
      mode: "retained-canvas-history" as const,
      sourceState: direction === "undo" ? "history-root-pre" as const : "history-root-post" as const,
      sourceOperationId: root.rootOperationId,
      sourceNode: retainedSourceNode,
      sourceDataDigest: canvasDigest("convax.canvas-effective-data", {
        format: "convax.canvas-effective-data",
        data: source.data,
      }),
      resource: source.data.resource,
      requireExactRetainedMaterial: true as const,
    })
    const key = new TextDecoder().decode(encodeRestrictedJcs(source.data.resource))
    if (!proofByResource.has(key)) proofByResource.set(key, proof)
  }
  return [...proofByResource.values()].sort((left, right) =>
    compareUtf8(new TextDecoder().decode(encodeRestrictedJcs(left.resource)), new TextDecoder().decode(encodeRestrictedJcs(right.resource))),
  )
}

function restoredPendingGenerationDataV2(
  base: CanvasSnapshot,
  template: Extract<CanvasHistoryTemplate, { op: "pending-generation.restore" }>,
): NodeDataEnvelope {
  const lifecycle = generationLifecycleCore(base, template.generationId)
  if (lifecycle.terminal?.phase === "succeeded") return lifecycle.terminal.outputData
  return {
    format: "convax.canvas-node-data",
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

function assertCurrentHistoryPhase(
  base: CanvasSnapshot,
  root: SemanticHistoryRoot,
  bindings: readonly CanvasHistoryBinding[],
  direction: "undo" | "redo",
): void {
  const selected = scheduleCanvasHistoryTemplates(
    direction === "undo" ? root.inverseTemplate : root.forwardTemplate,
    bindings,
  )
  const current = direction === "undo" ? root.forwardTemplate : root.inverseTemplate
  const bindingMap = new Map(bindings.map((binding) => [binding.handle, binding.ref] as const))
  const index = buildCanvasProjectionIndex(base)
  const handles = new Map<string, string>()
  for (const binding of bindings) if (binding.ref !== null) handles.set(canvasEntityKey(binding.ref), binding.handle)

  const nodeProducer = (handle: string): CanvasHistoryNodeSnapshot | null => {
    for (const template of current) {
      if (template.op === "node.create" && template.handle === handle) return template.snapshot
      if (template.op === "creation-group.restore") {
        const item = template.nodes.find((candidate) => candidate.handle === handle)
        if (item !== undefined) return item.snapshot
      }
      if (template.op === "pending-generation.restore" && template.node === handle) {
        const ref = requireHistoryBindingNode(bindingMap, handle)
        const node = base.nodes.get(canvasEntityKey(ref))
        if (node === undefined) return null
        const data = effectiveNodeData(base, node).data
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
  const edgeProducer = (handle: string): CanvasHistoryEdgeSnapshot | null => {
    for (const template of current) {
      if (template.op === "edge.create" && template.handle === handle) return template.snapshot
      if (template.op === "creation-group.restore" || template.op === "pending-generation.restore") {
        const item = template.edges.find((candidate) => candidate.handle === handle)
        if (item !== undefined) return item.snapshot
      }
    }
    return null
  }
  const counterpart = (template: CanvasHistoryTemplate): CanvasHistoryTemplate | undefined => {
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
        throw new CanvasSchemaError("history-conflict", "History node creation source phase is not absent")
    } else if (template.op === "edge.create") {
      if (bindingMap.get(template.handle) !== null)
        throw new CanvasSchemaError("history-conflict", "History edge creation source phase is not absent")
    } else if (template.op === "creation-group.restore") {
      for (const item of [...template.nodes, ...template.edges])
        if (bindingMap.get(item.handle) !== null)
          throw new CanvasSchemaError("history-conflict", "Creation-group restoration source phase is not absent")
    } else if (template.op === "pending-generation.restore") {
      if (bindingMap.get(template.node) !== null || template.edges.some((item) => bindingMap.get(item.handle) !== null))
        throw new CanvasSchemaError("history-conflict", "Pending-generation restoration source phase is not absent")
    } else if (template.op === "node.tombstone") {
      const ref = requireHistoryBindingNode(bindingMap, template.handle)
      const node = base.nodes.get(canvasEntityKey(ref))
      if (node === undefined || !index.isNodeLive(ref))
        throw new CanvasSchemaError("history-conflict", "History node tombstone target is not live")
      const expected = nodeProducer(template.handle)
      if (
        expected === null ||
        (root.sourceIntentKind !== "canvas.resources.pending-generation.create" &&
          !sameCanonicalValue(historyNodeSnapshot(base, ref), expected))
      )
        throw new CanvasSchemaError("history-conflict", "History node phase snapshot changed")
      requireNoNewIncidentEdges(index, ref, bindings)
    } else if (template.op === "edge.tombstone") {
      const ref = requireHistoryBindingEdge(bindingMap, template.handle)
      if (!index.isEdgeLive(ref)) throw new CanvasSchemaError("history-conflict", "History edge tombstone target is not live")
      const expected = edgeProducer(template.handle)
      if (expected === null || !sameCanonicalValue(historyEdgeSnapshot(base, ref, handles), expected))
        throw new CanvasSchemaError("history-conflict", "History edge phase snapshot changed")
    } else if (template.op === "node.geometry") {
      const ref = requireHistoryBindingNode(bindingMap, template.handle)
      const node = base.nodes.get(canvasEntityKey(ref))
      const expected = counterpart(template)
      if (
        node === undefined || expected?.op !== "node.geometry" ||
        !sameCanonicalValue(effectivePosition(node), expected.position) ||
        !sameCanonicalValue(effectiveSize(node), expected.size)
      ) throw new CanvasSchemaError("history-conflict", "History geometry phase changed")
    } else if (template.op === "node.data") {
      const ref = requireHistoryBindingNode(bindingMap, template.handle)
      const node = base.nodes.get(canvasEntityKey(ref))
      const expected = counterpart(template)
      if (node === undefined || expected?.op !== "node.data" || !sameCanonicalValue(effectiveNodeData(base, node).data, expected.data))
        throw new CanvasSchemaError("history-conflict", "History data phase changed")
    } else if (template.op === "node.plugin") {
      const ref = requireHistoryBindingNode(bindingMap, template.handle)
      const node = base.nodes.get(canvasEntityKey(ref))
      const expected = counterpart(template)
      if (node === undefined || expected?.op !== "node.plugin" || !sameCanonicalValue(effectivePlugin(node), expected.plugin))
        throw new CanvasSchemaError("history-conflict", "History Plugin phase changed")
    } else if (template.op === "containment.set") {
      if (template.child.mode === "handle" && bindingMap.get(template.child.handle) === null) continue
      const child = resolveHistoryConstructionTarget(template.child, bindingMap)
      const expected = counterpart(template)
      if (expected?.op !== "containment.set") throw new CanvasSchemaError("history-conflict", "History containment phase is missing")
      const expectedParent = expected.parent === null ? null : resolveHistoryConstructionTarget(expected.parent, bindingMap)
      const actualParent = effectiveParent(base, child)
      if (
        (expectedParent === null) !== (actualParent === null) ||
        (expectedParent !== null && actualParent !== null && canvasEntityKey(expectedParent) !== canvasEntityKey(actualParent))
      ) throw new CanvasSchemaError("history-conflict", "History containment phase changed")
    } else if (template.op === "metadata.set") {
      const expected = counterpart(template)
      if (expected?.op !== "metadata.set" || !sameCanonicalValue(metadataEffectiveValue(base, template.field), expected.value))
        throw new CanvasSchemaError("history-conflict", "History metadata phase changed")
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
      const group = requireHistoryBindingNode(bindingMap, item.handle)
      const expectedChildren = current
        .filter((candidate): candidate is Extract<CanvasHistoryTemplate, { op: "containment.set" }> => candidate.op === "containment.set")
        .filter((candidate) => candidate.parent?.mode === "handle" && candidate.parent.handle === item.handle)
        .map((candidate) => historyTargetSortKey(candidate.child))
        .sort(compareUtf8)
      const actualChildren = [...index.selectedContainments.entries()]
        .filter(([, choice]) => choice?.parent !== null && choice !== null && canvasEntityKey(choice.parent) === canvasEntityKey(group))
        .map(([childKey]) => {
          const handle = handles.get(childKey)
          return handle === undefined ? historyTargetSortKey({ mode: "external", ref: base.nodes.get(childKey)!.identity.ref }) : historyTargetSortKey({ mode: "handle", handle })
        })
        .sort(compareUtf8)
      if (!sameCanonicalValue(actualChildren, expectedChildren))
        throw new CanvasSchemaError("history-conflict", "History group effective child set changed")
    }
  }
}

function validateSemanticDerivedIdentities(
  values: readonly CanvasHistoryDerivedObject[],
  base: CanvasSnapshot,
  context: OwnerIntentValidationContext,
): boolean {
  for (const value of values) {
    if (value.kind === "node") {
      const expected = derivedNodeRef(context, value.ordinal)
      if (!sameCanonicalValue(value.ref, expected) || base.nodes.has(canvasEntityKey(value.ref))) return false
    } else if (value.kind === "edge") {
      const expected = derivedEdgeRef(context, value.ordinal)
      if (!sameCanonicalValue(value.ref, expected) || base.edges.has(canvasEntityKey(value.ref))) return false
    } else if (value.kind === "relation") {
      if (value.relationId !== deriveCanvasId("relation", context, value.ordinal)) return false
    } else if (value.groupId !== deriveCanvasId("creationGroup", context, value.ordinal)) return false
  }
  return true
}

function captureHistoryRoot(
  base: CanvasSnapshot,
  post: CanvasSnapshot,
  intent: CanvasTypedIntentUnion,
  context: OwnerIntentValidationContext,
  results: readonly CanvasEntityRef[],
): SemanticHistoryRoot {
  const sourceIntentKind = intent.kind as CanvasUndoableIntentKind
  const affected = historyAffectedRefs(base, post, intent, results)
  const nodeRefs = affected
    .filter((ref): ref is CanvasEntityRef & { kind: "node" } => ref.kind === "node")
    .sort(refCompare)
  const edgeRefs = affected
    .filter((ref): ref is CanvasEntityRef & { kind: "edge" } => ref.kind === "edge")
    .sort(refCompare)
  const handles = new Map<string, string>()
  nodeRefs.forEach((ref, index) => handles.set(canvasEntityKey(ref), `n/${index}`))
  edgeRefs.forEach((ref, index) => handles.set(canvasEntityKey(ref), `e/${index}`))
  const postIndex = buildCanvasProjectionIndex(post)
  const initialBindings: CanvasHistoryBinding[] = [...nodeRefs, ...edgeRefs]
    .map((ref) => {
      const live =
        ref.kind === "node"
          ? postIndex.isNodeLive(ref as CanvasEntityRef & { kind: "node" })
          : postIndex.isEdgeLive(ref as CanvasEntityRef & { kind: "edge" })
      return { handle: handles.get(canvasEntityKey(ref))!, ref: live ? ref : null }
    })
    .sort((a, b) => compareUtf8(a.handle, b.handle))
  const inverseTemplate: CanvasHistoryTemplate[] = []
  const forwardTemplate: CanvasHistoryTemplate[] = []

  if (intent.kind === "canvas.nodes.set-geometry")
    for (const ref of nodeRefs) {
      inverseTemplate.push({
        op: "node.geometry",
        handle: handles.get(canvasEntityKey(ref))!,
        position: effectivePosition(base.nodes.get(canvasEntityKey(ref))!),
        size: effectiveSize(base.nodes.get(canvasEntityKey(ref))!),
      })
      forwardTemplate.push({
        op: "node.geometry",
        handle: handles.get(canvasEntityKey(ref))!,
        position: effectivePosition(post.nodes.get(canvasEntityKey(ref))!),
        size: effectiveSize(post.nodes.get(canvasEntityKey(ref))!),
      })
    }
  else if (intent.kind === "canvas.nodes.update-data")
    for (const ref of nodeRefs) {
      const before = effectiveNodeData(base, base.nodes.get(canvasEntityKey(ref))!).data
      const after = effectiveNodeData(post, post.nodes.get(canvasEntityKey(ref))!).data
      inverseTemplate.push({
        op: "node.data",
        handle: handles.get(canvasEntityKey(ref))!,
        data: before,
        resource: before.kind === "resource" ? before.resource : null,
      })
      forwardTemplate.push({
        op: "node.data",
        handle: handles.get(canvasEntityKey(ref))!,
        data: after,
        resource: after.kind === "resource" ? after.resource : null,
      })
    }
  else if (intent.kind === "canvas.nodes.set-plugin-state")
    for (const ref of nodeRefs) {
      inverseTemplate.push({
        op: "node.plugin",
        handle: handles.get(canvasEntityKey(ref))!,
        plugin: effectivePlugin(base.nodes.get(canvasEntityKey(ref))!),
      })
      forwardTemplate.push({
        op: "node.plugin",
        handle: handles.get(canvasEntityKey(ref))!,
        plugin: effectivePlugin(post.nodes.get(canvasEntityKey(ref))!),
      })
    }
  else if (intent.kind === "canvas.metadata.update")
    for (const field of intent.body.fields) {
      inverseTemplate.push({ op: "metadata.set", field: field.field, value: metadataEffectiveValue(base, field.field) })
      forwardTemplate.push({ op: "metadata.set", field: field.field, value: metadataEffectiveValue(post, field.field) })
    }
  else if (intent.kind === "canvas.nodes.set-structural-parent") {
    const handle = handles.get(canvasEntityKey(intent.body.child))!
    if (intent.body.position !== undefined)
      inverseTemplate.push({
        op: "node.geometry",
        handle,
        position: effectivePosition(base.nodes.get(canvasEntityKey(intent.body.child))!),
        size: effectiveSize(base.nodes.get(canvasEntityKey(intent.body.child))!),
      })
    inverseTemplate.push({
      op: "containment.set",
      child: { mode: "handle", handle },
      parent: historyTarget(effectiveParent(base, intent.body.child), handles),
    })
    if (intent.body.position !== undefined)
      forwardTemplate.push({
        op: "node.geometry",
        handle,
        position: effectivePosition(post.nodes.get(canvasEntityKey(intent.body.child))!),
        size: effectiveSize(post.nodes.get(canvasEntityKey(intent.body.child))!),
      })
    forwardTemplate.push({
      op: "containment.set",
      child: { mode: "handle", handle },
      parent: historyTarget(effectiveParent(post, intent.body.child), handles),
    })
  } else if (intent.kind === "canvas.nodes.group") {
    const groupHandle = handles.get(canvasEntityKey(intent.guard.group.node))!
    forwardTemplate.push({
      op: "node.create",
      handle: groupHandle,
      snapshot: historyNodeSnapshot(post, intent.guard.group.node),
    })
    inverseTemplate.push({ op: "node.tombstone", handle: groupHandle })
    for (const child of intent.body.children) {
      const childHandle = handles.get(canvasEntityKey(child))!
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
  } else if (intent.kind === "canvas.nodes.ungroup") {
    const groupHandle = handles.get(canvasEntityKey(intent.body.group))!
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
      const childHandle = handles.get(canvasEntityKey(child))!
      inverseTemplate.push({
        op: "containment.set",
        child: { mode: "handle", handle: childHandle },
        parent: { mode: "handle", handle: groupHandle },
      })
      forwardTemplate.push({ op: "containment.set", child: { mode: "handle", handle: childHandle }, parent: null })
    }
  } else if (intent.kind === "canvas.resources.pending-generation.create") {
    const nodeRef = nodeRefs[0]!
    for (const ref of edgeRefs)
      inverseTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKey(ref))! })
    inverseTemplate.push({ op: "node.tombstone", handle: handles.get(canvasEntityKey(nodeRef))! })
    forwardTemplate.push({
      op: "pending-generation.restore",
      node: handles.get(canvasEntityKey(nodeRef))!,
      edges: edgeRefs.map((ref) => ({
        handle: handles.get(canvasEntityKey(ref))!,
        snapshot: historyEdgeSnapshot(post, ref, handles),
      })),
      generationId: intent.body.begin.generationId,
      fallbackTitle: intent.body.node.title,
      expectedClass: intent.body.node.expectedClass,
      position: effectivePosition(post.nodes.get(canvasEntityKey(nodeRef))!),
      size: effectiveSize(post.nodes.get(canvasEntityKey(nodeRef))!),
    })
  } else if (intent.kind === "canvas.plugin.creation-group.create") {
    for (const ref of edgeRefs)
      inverseTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKey(ref))! })
    for (const ref of nodeRefs)
      inverseTemplate.push({ op: "node.tombstone", handle: handles.get(canvasEntityKey(ref))! })
    forwardTemplate.push({
      op: "creation-group.restore",
      groupHandle: "g/0",
      source: { mode: "external", ref: intent.body.source },
      sourceDataDigest: intent.guard.source.expectedEffectiveDataDigest,
      plugin: intent.guard.pluginRequirement,
      nodes: nodeRefs.map((ref) => ({
        handle: handles.get(canvasEntityKey(ref))!,
        snapshot: historyNodeSnapshot(post, ref),
      })),
      edges: edgeRefs.map((ref) => ({
        handle: handles.get(canvasEntityKey(ref))!,
        snapshot: historyEdgeSnapshot(post, ref, handles),
      })),
    })
  } else if (intent.kind === "canvas.nodes.duplicate") {
    for (const ref of edgeRefs) {
      inverseTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKey(ref))! })
      forwardTemplate.push({
        op: "edge.create",
        handle: handles.get(canvasEntityKey(ref))!,
        snapshot: historyEdgeSnapshot(post, ref, handles),
      })
    }
    for (const ref of nodeRefs) {
      const handle = handles.get(canvasEntityKey(ref))!
      inverseTemplate.push({ op: "node.tombstone", handle })
      forwardTemplate.unshift({ op: "node.create", handle, snapshot: historyNodeSnapshot(post, ref) })
      const parent = effectiveParent(post, ref)
      if (parent !== null) {
        forwardTemplate.push({
          op: "containment.set",
          child: { mode: "handle", handle },
          parent: historyTarget(parent, handles),
        })
      }
    }
  } else if (intent.kind === "canvas.elements.remove") {
    const removedNodeKeys = new Set(intent.body.nodes.map(canvasEntityKey))
    const grouped = new Map<
      string,
      {
        ref: CreationGroupRef
        nodes: (CanvasEntityRef & { kind: "node" })[]
        edges: (CanvasEntityRef & { kind: "edge" })[]
      }
    >()
    for (const ref of intent.body.nodes) {
      const group = base.nodes.get(canvasEntityKey(ref))!.creationGroup
      if (group === null)
        inverseTemplate.push({
          op: "node.create",
          handle: handles.get(canvasEntityKey(ref))!,
          snapshot: historyNodeSnapshot(base, ref),
        })
      else {
        const bucket = grouped.get(group.groupId) ?? { ref: group, nodes: [], edges: [] }
        if (!sameCanonicalValue(bucket.ref, group))
          throw new CanvasSchemaError("creation-group-equivocation", "Removed creation-group members disagree")
        bucket.nodes.push(ref)
        grouped.set(group.groupId, bucket)
      }
      forwardTemplate.push({ op: "node.tombstone", handle: handles.get(canvasEntityKey(ref))! })
    }
    for (const ref of intent.body.edges) {
      const group = base.edges.get(canvasEntityKey(ref))!.creationGroup
      if (group === null)
        inverseTemplate.push({
          op: "edge.create",
          handle: handles.get(canvasEntityKey(ref))!,
          snapshot: historyEdgeSnapshot(base, ref, handles),
        })
      else {
        const bucket = grouped.get(group.groupId) ?? { ref: group, nodes: [], edges: [] }
        if (!sameCanonicalValue(bucket.ref, group))
          throw new CanvasSchemaError("creation-group-equivocation", "Removed creation-group members disagree")
        bucket.edges.push(ref)
        grouped.set(group.groupId, bucket)
      }
      forwardTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKey(ref))! })
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
          .map((ref) => ({ handle: handles.get(canvasEntityKey(ref))!, snapshot: historyNodeSnapshot(base, ref) })),
        edges: bucket.edges.sort(refCompare).map((ref) => ({
          handle: handles.get(canvasEntityKey(ref))!,
          snapshot: historyEdgeSnapshot(base, ref, handles),
        })),
      })
    }
    for (const ref of intent.body.nodes) {
      const childHandle = handles.get(canvasEntityKey(ref))!
      inverseTemplate.push({
        op: "containment.set",
        child: { mode: "handle", handle: childHandle },
        parent: historyTarget(effectiveParent(base, ref), handles),
      })
      const node = base.nodes.get(canvasEntityKey(ref))!
      if (effectiveNodeData(base, node).data.kind !== "group") continue
      for (const [childKey, choice] of buildCanvasProjectionIndex(base).selectedContainments) {
        if (
          choice?.parent === null ||
          choice === null ||
          canvasEntityKey(choice.parent) !== canvasEntityKey(ref) ||
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
      inverseTemplate.push({ op: "edge.tombstone", handle: handles.get(canvasEntityKey(ref))! })
      forwardTemplate.push({
        op: "edge.create",
        handle: handles.get(canvasEntityKey(ref))!,
        snapshot: historyEdgeSnapshot(post, ref, handles),
      })
    }
    for (const ref of nodeRefs) {
      inverseTemplate.push({ op: "node.tombstone", handle: handles.get(canvasEntityKey(ref))! })
      forwardTemplate.unshift({
        op: "node.create",
        handle: handles.get(canvasEntityKey(ref))!,
        snapshot: historyNodeSnapshot(post, ref),
      })
    }
  }
  const scheduledInverse = scheduleCanvasHistoryTemplates(inverseTemplate, initialBindings)
  const scheduledForward = scheduleCanvasHistoryTemplates(forwardTemplate, initialBindings)
  const retainedResources = collectResources(scheduledInverse, scheduledForward)
  const core = {
    format: "convax.canvas-history-material",
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
    format: "convax.canvas-semantic-history-root",
    materialDigest: canvasDigest("convax.canvas-history-material", core),
  }
}

function createHistoryTransition(
  snapshot: CanvasSnapshot,
  intent: Extract<
    CanvasTypedIntentUnion,
    { kind: "canvas.undo.semantic-inverse" | "canvas.redo.semantic-forward" }
  >,
  context: OwnerIntentValidationContext,
): SemanticHistoryTransition {
  const root = snapshot.semanticHistory.get(historyRootKey(intent.guard.rootOperationId)) as SemanticHistoryRoot
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
    format: "convax.canvas-history-materialization",
    rootOperationId: root.rootOperationId,
    direction: intent.kind === "canvas.undo.semantic-inverse" ? "inverse" : "forward",
    priorHistoryStateDigest: prior.digest,
    operations: intent.body.operations,
    resultBindings,
  } as const
  const footprint = historyFootprint(
    snapshot,
    root,
    resultBindings,
    intent.kind === "canvas.undo.semantic-inverse" ? "undone" : "applied",
  )
  return {
    format: "convax.canvas-semantic-history-transition",
    rootOperationId: root.rootOperationId,
    mode: intent.kind === "canvas.undo.semantic-inverse" ? "undone" : "redone",
    priorHistoryDigest: prior.digest,
    transitionOperationId: context.operationId,
    stamp: makeStamp(context, "0" as Uint32),
    materializationDigest: canvasDigest("convax.canvas-history-materialization", materialCore),
    resultFootprintDigest: canvasDigest("convax.canvas-history-footprint", footprint),
    resultBindings,
  }
}

function planNodeCreate(
  writes: PlannedWrite[],
  ref: CanvasEntityRef & { kind: "node" },
  template: { role: "file" | "agent"; position: unknown; size: unknown; data: unknown; plugin: unknown },
  context: OwnerIntentValidationContext,
  creationGroup: CreationGroupRef | null,
): void {
  const key = canvasEntityKey(ref)
  const record = () => ensureNodeRecord(key)
  const identity = {
    format: "convax.canvas-node-identity",
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
  ref: CanvasEntityRef & { kind: "edge" },
  source: CanvasEntityRef & { kind: "node" },
  target: CanvasEntityRef & { kind: "node" },
  data: unknown,
  context: OwnerIntentValidationContext,
  creationGroup: CreationGroupRef | null,
): void {
  const key = canvasEntityKey(ref)
  const record = () => ensureEdgeRecord(key)
  const identity = {
    format: "convax.canvas-edge-identity",
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
  ref: CanvasEntityRef,
  field: string,
  raw: unknown,
  context: OwnerIntentValidationContext,
  recordFactory?: () => Y.Map<unknown>,
): void {
  const key = canvasEntityKey(ref)
  const path = `${kind === "node" ? "nodes" : "edges"}/${key}/${field}/actor/${context.actorId}`
  writes.push({
    path,
    entityKind: kind,
    entityId: key,
    field: `${field}/actor/${context.actorId}`,
    value: (ordinal) => ({ format: "convax.canvas-stamped-claim", stamp: makeStamp(context, ordinal), value: raw }),
    apply: (value) => {
      const record = recordFactory?.() ?? (kind === "node" ? getRecord("nodes", key) : getRecord("edges", key))
      const slots = record.get(field)
      if (!(slots instanceof Y.Map))
        throw new CanvasSchemaError("invalid-y-type", `${path} parent is not an actor map`)
      slots.set(context.actorId, value)
    },
  })
}

function planTombstone(writes: PlannedWrite[], ref: CanvasEntityRef, context: OwnerIntentValidationContext): void {
  const key = canvasEntityKey(ref)
  const root = ref.kind === "node" ? "nodes" : "edges"
  const path = `${root}/${key}/tombstones/${context.actorId}`
  writes.push({
    path,
    entityKind: ref.kind,
    entityId: key,
    field: `tombstones/${context.actorId}`,
    value: (ordinal) => ({ format: "convax.canvas-tombstone", entity: ref, stamp: makeStamp(context, ordinal) }),
    apply: (value) => {
      const map = getRecord(root, key).get("tombstones")
      if (!(map instanceof Y.Map)) throw new CanvasSchemaError("invalid-y-type", "tombstones must be a map")
      map.set(context.actorId, value)
    },
  })
}

function planContainment(
  writes: PlannedWrite[],
  child: CanvasEntityRef & { kind: "node" },
  parent: (CanvasEntityRef & { kind: "node" }) | null,
  relationId: string,
  context: OwnerIntentValidationContext,
): void {
  const key = containmentKey(child, context.actorId)
  planJsonWrite(
    writes,
    `containments/${key}`,
    "containment",
    key,
    "choice",
    (ordinal: Uint32) => ({
      format: "convax.canvas-containment-choice",
      relationId,
      child,
      parent,
      stamp: makeStamp(context, ordinal),
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
    value: (ordinal) => ({ format: "convax.canvas-stamped-claim", stamp: makeStamp(context, ordinal), value: raw }),
    apply: (value) => {
      const fieldMap = getCanvasChildMap(currentDocument(), "meta").get(field)
      if (!(fieldMap instanceof Y.Map)) throw new CanvasSchemaError("invalid-y-type", "metadata actor slot missing")
      fieldMap.set(context.actorId, value)
    },
  })
}

function planJsonWrite(
  writes: PlannedWrite[],
  path: string,
  entityKind: CanvasActualWrite["entityKind"],
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
  entityKind: CanvasActualWrite["entityKind"],
  entityId: string,
  field: string,
  value: unknown,
): PlannedWrite {
  return { path, entityKind, entityId, field, value: () => value, apply: () => undefined }
}

function ensureNodeRecord(key: string): Y.Map<unknown> {
  const nodes = getCanvasChildMap(currentDocument(), "nodes")
  const existing = nodes.get(key)
  if (existing instanceof Y.Map) return existing
  if (existing !== undefined) throw new CanvasSchemaError("derived-entity-present", `Node ${key} already exists`)
  const record = new Y.Map<unknown>()
  record.set("identity", null)
  for (const field of ["position", "size", "data", "plugin", "tombstones"]) record.set(field, new Y.Map<unknown>())
  record.set("creationGroup", null)
  nodes.set(key, record)
  return record
}

function ensureEdgeRecord(key: string): Y.Map<unknown> {
  const edges = getCanvasChildMap(currentDocument(), "edges")
  const existing = edges.get(key)
  if (existing instanceof Y.Map) return existing
  if (existing !== undefined) throw new CanvasSchemaError("derived-entity-present", `Edge ${key} already exists`)
  const record = new Y.Map<unknown>()
  record.set("identity", null)
  record.set("data", new Y.Map<unknown>())
  record.set("tombstones", new Y.Map<unknown>())
  record.set("creationGroup", null)
  edges.set(key, record)
  return record
}

function getRecord(root: "nodes" | "edges", key: string): Y.Map<unknown> {
  const value = getCanvasChildMap(currentDocument(), root).get(key)
  if (!(value instanceof Y.Map)) throw new CanvasSchemaError("entity-missing", `${root}/${key} is missing`)
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
  return (value) => writeJson(getCanvasChildMap(currentDocument(), root), key, value)
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
export function applyCanvasCandidateIntent(
  candidate: Y.Doc,
  context: OwnerIntentValidationContext,
  intent: CanvasTypedIntentUnion,
  facts: CanvasExternalFactContext,
): CanvasReducerOutcome {
  if (applyingDocument !== null) return "rejected"
  applyingDocument = candidate
  try {
    return reduceCanvasIntentInternal(candidate, context, intent, facts)
  } finally {
    applyingDocument = null
  }
}

/** Owner-runtime-only entry: the base is a branded, already validated snapshot. */
export function applyCanvasOwnerCandidateIntent(
  candidate: Y.Doc,
  base: CanvasSnapshot,
  context: OwnerIntentValidationContext,
  intent: CanvasTypedIntentUnion,
  facts: CanvasExternalFactContext,
): CanvasReducerOutcome {
  if (applyingDocument !== null) return "rejected"
  applyingDocument = candidate
  try {
    return reduceCanvasIntentInternal(candidate, context, intent, facts, base)
  } finally {
    applyingDocument = null
  }
}

/** Public pure candidate reducer. The collaboration kernel supplies only an
 * isolated candidateDoc here; callers never receive this entry point directly. */
export const reduceCanvasIntent = applyCanvasCandidateIntent

function requireNode(
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  guard: { node: CanvasEntityRef & { kind: "node" }; expectedIdentityDigest: Digest },
): CanvasNodeSnapshot {
  const node = base.nodes.get(canvasEntityKey(guard.node))
  if (
    node === undefined ||
    !index.isNodeLive(guard.node) ||
    nodeIdentityDigest(node) !== guard.expectedIdentityDigest
  )
    throw new CanvasSchemaError("stale-node-guard", "Node live/identity guard is stale")
  return node
}

function requireNodeData(
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  guard: {
    node: CanvasEntityRef & { kind: "node" }
    expectedIdentityDigest: Digest
    expectedEffectiveDataDigest: Digest
    expectedDataRegisterDigest: Digest
  },
): CanvasNodeSnapshot {
  const node = requireNode(base, index, guard)
  if (
    effectiveDataDigest(base, node) !== guard.expectedEffectiveDataDigest ||
    dataRegisterDigest(node) !== guard.expectedDataRegisterDigest
  )
    throw new CanvasSchemaError("stale-data-guard", "Node data guard is stale")
  return node
}

function requireEdge(
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  guard: { edge: CanvasEntityRef & { kind: "edge" }; expectedIdentityDigest: Digest },
): CanvasEdgeSnapshot {
  const edge = base.edges.get(canvasEntityKey(guard.edge))
  if (
    edge === undefined ||
    !index.isEdgeLive(guard.edge) ||
    edgeIdentityDigest(edge) !== guard.expectedIdentityDigest
  )
    throw new CanvasSchemaError("stale-edge-guard", "Edge live/identity guard is stale")
  return edge
}

function requireConnectable(
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  guard: { node: CanvasEntityRef & { kind: "node" }; expectedIdentityDigest: Digest },
): CanvasNodeSnapshot {
  const node = requireNode(base, index, guard)
  if (effectiveNodeData(base, node).data.kind === "group")
    throw new CanvasSchemaError("not-connectable", "Structural groups are not business-edge endpoints")
  return node
}

function requireNoNewIncidentEdges(
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  node: CanvasEntityRef & { kind: "node" },
  bindings: readonly CanvasHistoryBinding[],
): void {
  const allowed = new Set(
    bindings
      .filter((binding) => binding.handle.startsWith("e/") && binding.ref?.kind === "edge")
      .map((binding) => canvasEntityKey(binding.ref!)),
  )
  for (const edge of index.projection.edges)
    if (
      (canvasEntityKey(edge.source) === canvasEntityKey(node) ||
        canvasEntityKey(edge.target) === canvasEntityKey(node)) &&
      !allowed.has(canvasEntityKey(edge.ref))
    )
      throw new CanvasSchemaError("history-conflict", "Node gained a live incident edge outside the history root")
}

function requireGenerationGuard(
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  guard: {
    node: CanvasEntityRef & { kind: "node" }
    expectedIdentityDigest: Digest
    generationId: string
    beginDigest: Digest
    expectedLifecycleDigest: Digest
    expectedTerminalDigest: Digest | null
    expectedDismissalDigest: Digest | null
    expectedRecoveryFailureDigest: Digest | null
  },
): CanvasNodeSnapshot {
  const node = requireNode(base, index, guard)
  const begin = base.generationBegins.get(guard.generationId)
  if (
    begin === undefined ||
    canvasEntityKey(begin.node) !== node.key ||
    canvasDigest("convax.canvas-generation-begin/2", begin) !== guard.beginDigest ||
    generationLifecycleDigest(base, guard.generationId) !== guard.expectedLifecycleDigest
  )
    throw new CanvasSchemaError("stale-generation-guard", "Generation guard is stale")
  const lifecycle = generationLifecycleCore(base, guard.generationId)
  if (
    nullableDigest("convax.canvas-generation-terminal/2", lifecycle.terminal) !== guard.expectedTerminalDigest ||
    nullableDigest("convax.canvas-generation-dismissal/2", lifecycle.dismissal) !== guard.expectedDismissalDigest ||
    nullableDigest("convax.canvas-generation-recovery-failure/2", lifecycle.recoveryFailure) !==
      guard.expectedRecoveryFailureDigest
  )
    throw new CanvasSchemaError("stale-generation-guard", "Generation observed facts changed")
  return node
}

function requireDerivedNode(
  base: CanvasSnapshot,
  context: OwnerIntentValidationContext,
  guard: { ordinal: Uint32; node: CanvasEntityRef },
  template: { ordinal: Uint32; nodeId: string; incarnation: string },
): CanvasEntityRef & { kind: "node" } {
  const derived = derivedNodeRef(context, guard.ordinal)
  if (
    guard.ordinal !== template.ordinal ||
    !sameCanonicalValue(derived, guard.node) ||
    template.nodeId !== derived.id ||
    template.incarnation !== derived.incarnation ||
    base.nodes.has(canvasEntityKey(derived))
  )
    throw new CanvasSchemaError("derived-node-mismatch", "Derived node identity/absence guard is invalid")
  return derived
}

function requireDerivedEdge(
  base: CanvasSnapshot,
  context: OwnerIntentValidationContext,
  guard: { ordinal: Uint32; edge: CanvasEntityRef },
  template: { ordinal: Uint32; edgeId: string; incarnation: string },
): CanvasEntityRef & { kind: "edge" } {
  const derived = derivedEdgeRef(context, guard.ordinal)
  if (
    guard.ordinal !== template.ordinal ||
    !sameCanonicalValue(derived, guard.edge) ||
    template.edgeId !== derived.id ||
    template.incarnation !== derived.incarnation ||
    base.edges.has(canvasEntityKey(derived))
  )
    throw new CanvasSchemaError("derived-edge-mismatch", "Derived edge identity/absence guard is invalid")
  return derived
}

function requirePlacement(
  base: CanvasSnapshot,
  placement: { obstacleProjectionDigest: Digest; gap: number },
): void {
  if (placement.gap !== 24 || obstacleProjectionDigest(base) !== placement.obstacleProjectionDigest)
    throw new CanvasSchemaError("stale-placement", "Causal placement obstacle projection is stale")
}

function placeCreatedNodes(
  base: CanvasSnapshot,
  anchor: { x: number; y: number },
  specs: readonly { ordinal: Uint32; size: { width: number; height: number } }[],
): { x: number; y: number }[] {
  const projection = buildCanvasProjectionIndex(base).projection
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
        throw new CanvasSchemaError("placement-unavailable", "Causal placement cannot find a bounded position")
    }
    obstacles.push({ ...position, ...spec.size })
    result.set(spec.ordinal, position)
  }
  return specs.map((spec) => result.get(spec.ordinal)!)
}

function resolveEndpoint(
  value: CanvasEntityRef | { createdNodeOrdinal: Uint32 },
  created: ReadonlyMap<string, CanvasEntityRef & { kind: "node" }>,
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
): CanvasEntityRef & { kind: "node" } {
  if ("createdNodeOrdinal" in value) {
    const ref = created.get(value.createdNodeOrdinal)
    if (ref === undefined)
      throw new CanvasSchemaError("unknown-created-endpoint", "Edge references an unknown created-node ordinal")
    return ref
  }
  if (value.kind !== "node") throw new CanvasSchemaError("invalid-endpoint", "Business edge endpoint must be a node")
  const nodeRef = value as CanvasEntityRef & { kind: "node" }
  const node = base.nodes.get(canvasEntityKey(nodeRef))
  if (node === undefined || !index.isNodeLive(nodeRef) || effectiveNodeData(base, node).data.kind === "group")
    throw new CanvasSchemaError("stale-endpoint", "Business edge endpoint is not live/connectable")
  return nodeRef
}

function requireFact(result: "valid" | "pending" | "invalid"): void {
  if (result === "pending") throw new CanvasPendingFactError()
  if (result === "invalid") throw new CanvasSchemaError("external-fact-invalid", "External fact failed closed")
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
    throw new CanvasSchemaError("invalid-context", "Canvas operation context does not select the Canvas owner")
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
  return value === null ? null : canvasDigest(domain, value)
}

function sameRequirement(plugin: PluginRequirement | null, requirement: PluginRequirement | null): boolean {
  if (plugin === null || requirement === null) return plugin === requirement
  return (
    plugin.pluginId === requirement.pluginId &&
    plugin.snapshotDigest === requirement.snapshotDigest &&
    plugin.pluginStateSchemaDigest === requirement.pluginStateSchemaDigest &&
    sameCanonicalValue(plugin.validationArtifact, requirement.validationArtifact)
  )
}

function ownContainmentSlotDigest(
  base: CanvasSnapshot,
  child: CanvasEntityRef & { kind: "node" },
  actorId: string,
): Digest | null {
  const choice = base.containments.get(`${canvasEntityKey(child)}/actor/${actorId}`)
  return choice === undefined
    ? null
    : canvasDigest("convax.canvas-containment-slot", { format: "convax.canvas-containment-slot", choice })
}

function metadataEffectiveValue(
  base: CanvasSnapshot,
  field: "title" | "description" | "tags",
): string | readonly string[] | null {
  const entries = base.meta[field]
  if (entries.length === 0) return field === "tags" ? [] : null
  return entries.reduce((winner, next) =>
    comparePortableStamps(winner[1].stamp, next[1].stamp) < 0 ? next : winner,
  )[1].value
}

function metadataEffectiveDigest(base: CanvasSnapshot, field: "title" | "description" | "tags"): Digest {
  return canvasDigest("convax.canvas-metadata-effective", {
    format: "convax.canvas-metadata-effective",
    field,
    value: metadataEffectiveValue(base, field),
  })
}

function metadataOwnSlotDigest(
  base: CanvasSnapshot,
  field: "title" | "description" | "tags",
  actorId: string,
): Digest | null {
  const claim = base.meta[field].find(([actor]) => actor === actorId)?.[1]
  return claim === undefined
    ? null
    : canvasDigest("convax.canvas-metadata-slot", { format: "convax.canvas-metadata-slot", field, claim })
}

function effectivePosition(node: CanvasNodeSnapshot) {
  return node.position.reduce((winner, next) =>
    comparePortableStamps(winner[1].stamp, next[1].stamp) < 0 ? next : winner,
  )[1].value
}
function effectiveSize(node: CanvasNodeSnapshot) {
  return node.size.reduce((winner, next) =>
    comparePortableStamps(winner[1].stamp, next[1].stamp) < 0 ? next : winner,
  )[1].value
}

function effectiveParent(
  base: CanvasSnapshot,
  ref: CanvasEntityRef & { kind: "node" },
): (CanvasEntityRef & { kind: "node" }) | null {
  return buildCanvasProjectionIndex(base).selectedContainments.get(canvasEntityKey(ref))?.parent ?? null
}

function historyTarget(
  ref: (CanvasEntityRef & { kind: "node" }) | null,
  handles: ReadonlyMap<string, string>,
): CanvasHistoryNodeTarget | null {
  if (ref === null) return null
  const handle = handles.get(canvasEntityKey(ref))
  return handle === undefined ? { mode: "external", ref } : { mode: "handle", handle }
}

function historyNodeSnapshot(
  base: CanvasSnapshot,
  ref: CanvasEntityRef & { kind: "node" },
): CanvasHistoryNodeSnapshot {
  const node = base.nodes.get(canvasEntityKey(ref))!
  const data = effectiveNodeData(base, node).data
  return {
    role: node.identity.role,
    position: effectivePosition(node),
    size: effectiveSize(node),
    data,
    plugin: effectivePlugin(node),
    resource: data.kind === "resource" ? data.resource : null,
  }
}

function historyEdgeSnapshot(
  base: CanvasSnapshot,
  ref: CanvasEntityRef & { kind: "edge" },
  handles: ReadonlyMap<string, string>,
): CanvasHistoryEdgeSnapshot {
  const edge = base.edges.get(canvasEntityKey(ref))!
  const data = edge.data[edge.data.length - 1]![1].value
  return {
    source: historyTarget(edge.identity.source, handles)!,
    target: historyTarget(edge.identity.target, handles)!,
    data,
  }
}

function historyAffectedRefs(
  base: CanvasSnapshot,
  _post: CanvasSnapshot,
  intent: CanvasTypedIntentUnion,
  results: readonly CanvasEntityRef[],
): CanvasEntityRef[] {
  if (intent.kind === "canvas.nodes.set-geometry") return intent.body.updates.map((update) => update.node)
  if (intent.kind === "canvas.nodes.update-data" || intent.kind === "canvas.nodes.set-plugin-state")
    return [intent.body.node]
  if (intent.kind === "canvas.nodes.set-structural-parent") return [intent.body.child]
  if (intent.kind === "canvas.metadata.update") return []
  if (intent.kind === "canvas.elements.remove") {
    const affected = [...results]
    const removed = new Set(intent.body.nodes.map(canvasEntityKey))
    const index = buildCanvasProjectionIndex(base)
    for (const groupRef of intent.body.nodes) {
      const group = base.nodes.get(canvasEntityKey(groupRef))
      if (group === undefined || effectiveNodeData(base, group).data.kind !== "group") continue
      for (const [childKey, choice] of index.selectedContainments) {
        if (
          choice?.parent === null ||
          choice === null ||
          canvasEntityKey(choice.parent) !== group.key ||
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

function collectResources(...sets: readonly (readonly CanvasHistoryTemplate[])[]): CanvasResourceRef[] {
  const resources: CanvasResourceRef[] = []
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
  return resources.filter((resource, index) => index === 0 || !sameCanonicalValue(resource, resources[index - 1]))
}

function semanticHistoryState(
  base: CanvasSnapshot,
  root: SemanticHistoryRoot,
  receipt: BoundedOperationReceipt,
): { mode: "applied" | "undone"; bindings: readonly CanvasHistoryBinding[]; digest: Digest } {
  const entries = [...base.semanticHistory.entries()]
    .filter(
      (entry): entry is [string, SemanticHistoryTransition] =>
        entry[1].format === "convax.canvas-semantic-history-transition" &&
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
    format: "convax.canvas-semantic-history-state",
    rootReceiptDigest: canvasDigest("convax.canvas-operation-receipt", receipt),
    historyRootDigest: canvasDigest("convax.canvas-semantic-history-root", root),
    transitions,
    effectiveTransitionOperationId: effective?.transitionOperationId ?? null,
    effectiveMode: mode,
    effectiveBindings: bindings,
  }
  return { mode, bindings, digest: canvasDigest("convax.canvas-semantic-history-state", core) }
}

function historyFootprint(
  base: CanvasSnapshot,
  root: SemanticHistoryRoot,
  bindings: readonly CanvasHistoryBinding[],
  mode: "applied" | "undone",
): CanvasHistoryFootprintCore {
  const index = buildCanvasProjectionIndex(base)
  const handles = new Map<string, string>()
  for (const binding of bindings) if (binding.ref !== null) handles.set(canvasEntityKey(binding.ref), binding.handle)

  const entities: CanvasHistoryFootprintCore["entities"][number][] = []
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
                  canvasEntityKey(edge.source) === canvasEntityKey(ref) ||
                  canvasEntityKey(edge.target) === canvasEntityKey(ref),
              )
              .map((edge) => {
                const handle = handles.get(canvasEntityKey(edge.ref))
                if (handle === undefined || !handle.startsWith("e/"))
                  throw new CanvasSchemaError(
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
      (template): template is Extract<CanvasHistoryTemplate, { op: "metadata.set" }> =>
        template.op === "metadata.set",
    )
    .map((template) => template.field)
    .filter((field, position, fields) => fields.indexOf(field) === position)
    .sort((left, right) => metadataFieldRank(left) - metadataFieldRank(right))
  const metadata = metadataFields.map((field) => ({
    format: "convax.canvas-metadata-effective" as const,
    field,
    value: metadataEffectiveValue(base, field),
  }))

  const containmentTargets = [...root.inverseTemplate, ...root.forwardTemplate]
    .filter(
      (template): template is Extract<CanvasHistoryTemplate, { op: "containment.set" }> =>
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
    throw new CanvasSchemaError("invalid-history", "History footprint must not be completely empty")
  return {
    format: "convax.canvas-history-footprint",
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

function historyTargetSortKey(target: CanvasHistoryNodeTarget): string {
  return target.mode === "handle" ? `0/${target.handle}` : `1/node/${target.ref.id}/${target.ref.incarnation}`
}

function compareHistoryTargets(left: CanvasHistoryNodeTarget, right: CanvasHistoryNodeTarget): number {
  return compareUtf8(historyTargetSortKey(left), historyTargetSortKey(right))
}

function isNodeRef(value: CanvasEntityRef | null): value is CanvasEntityRef & { kind: "node" } {
  return value?.kind === "node"
}

function isEdgeRef(value: CanvasEntityRef | null): value is CanvasEntityRef & { kind: "edge" } {
  return value?.kind === "edge"
}

function resolveHistoryTarget(
  target: CanvasHistoryNodeTarget,
  bindings: readonly CanvasHistoryBinding[],
  derived: readonly CanvasHistoryDerivedObject[],
): CanvasEntityRef & { kind: "node" } {
  if (target.mode === "external") return target.ref
  const ref =
    derived.filter(isDerivedEntity).find((candidate) => candidate.handle === target.handle)?.ref ??
    bindings.find((candidate) => candidate.handle === target.handle)?.ref
  if (ref?.kind !== "node")
    throw new CanvasSchemaError("history-binding-missing", "History node target is unresolved")
  return ref as CanvasEntityRef & { kind: "node" }
}

function requireHistoryNode(
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  guard: { node: CanvasEntityRef & { kind: "node" }; expectedIdentityDigest: Digest },
  derived: readonly CanvasHistoryDerivedObject[],
  operations: readonly CanvasSemanticOperation[],
  requireGroup: boolean,
): void {
  if (base.nodes.has(canvasEntityKey(guard.node))) {
    const node = requireNode(base, index, guard)
    if (requireGroup && effectiveNodeData(base, node).data.kind !== "group")
      throw new CanvasSchemaError("history-conflict", "History parent is not a structural group")
    return
  }
  const handle = historyHandleForRef(derived, guard.node)
  const created = handle === undefined ? undefined : findDerivedNode(derived, handle)
  if (created === undefined || !sameCanonicalValue(created.ref, guard.node))
    throw new CanvasSchemaError("history-conflict", "History node guard does not resolve in the transition")
  const data = historyCreatedNodeData(operations, created.handle)
  if (data === undefined || (requireGroup && data.kind !== "group"))
    throw new CanvasSchemaError("history-conflict", "History-created node has the wrong semantic role")
}

function requireHistoryConnectable(
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  guard: { node: CanvasEntityRef & { kind: "node" }; expectedIdentityDigest: Digest },
  derived: readonly CanvasHistoryDerivedObject[],
  operations: readonly CanvasSemanticOperation[],
): void {
  if (base.nodes.has(canvasEntityKey(guard.node))) {
    requireConnectable(base, index, guard)
    return
  }
  const handle = historyHandleForRef(derived, guard.node)
  const data = handle === undefined ? undefined : historyCreatedNodeData(operations, handle)
  if (data === undefined || data.kind === "group")
    throw new CanvasSchemaError("history-conflict", "History endpoint is not transition-live/connectable")
}

function requireHistoryEndpoint(
  base: CanvasSnapshot,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  ref: CanvasEntityRef & { kind: "node" },
  derived: readonly CanvasHistoryDerivedObject[],
  operations: readonly CanvasSemanticOperation[],
): void {
  const node = base.nodes.get(canvasEntityKey(ref))
  if (node !== undefined) {
    if (!index.isNodeLive(ref) || effectiveNodeData(base, node).data.kind === "group")
      throw new CanvasSchemaError("history-conflict", "History endpoint is not live/connectable")
    return
  }
  const handle = historyHandleForRef(derived, ref)
  const data = handle === undefined ? undefined : historyCreatedNodeData(operations, handle)
  if (data === undefined || data.kind === "group")
    throw new CanvasSchemaError("history-conflict", "History-created endpoint is not connectable")
}

function historyHandleForRef(
  derived: readonly CanvasHistoryDerivedObject[],
  ref: CanvasEntityRef,
): string | undefined {
  return derived
    .filter((value): value is Extract<CanvasHistoryDerivedObject, { kind: "node" }> => value.kind === "node")
    .find((value) => canvasEntityKey(value.ref) === canvasEntityKey(ref))?.handle
}

function historyCreatedNodeData(
  operations: readonly CanvasSemanticOperation[],
  handle: string,
): NodeDataEnvelope | undefined {
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
          format: "convax.canvas-node-data",
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
  value: CanvasHistoryDerivedObject,
): value is Extract<CanvasHistoryDerivedObject, { kind: "node" | "edge" }> {
  return value.kind === "node" || value.kind === "edge"
}

function findDerivedNode(
  values: readonly CanvasHistoryDerivedObject[],
  handle: string,
): Extract<CanvasHistoryDerivedObject, { kind: "node" }> | undefined {
  return values.find(
    (value): value is Extract<CanvasHistoryDerivedObject, { kind: "node" }> =>
      value.kind === "node" && value.handle === handle,
  )
}

function findDerivedEdge(
  values: readonly CanvasHistoryDerivedObject[],
  handle: string,
): Extract<CanvasHistoryDerivedObject, { kind: "edge" }> | undefined {
  return values.find(
    (value): value is Extract<CanvasHistoryDerivedObject, { kind: "edge" }> =>
      value.kind === "edge" && value.handle === handle,
  )
}

function derivedGuardsMatch(
  nodeGuards: readonly { ordinal: Uint32; node: CanvasEntityRef }[],
  edgeGuards: readonly { ordinal: Uint32; edge: CanvasEntityRef }[],
  derived: readonly CanvasHistoryDerivedObject[],
): boolean {
  const nodes = derived.filter(
    (value): value is Extract<CanvasHistoryDerivedObject, { kind: "node" }> => value.kind === "node",
  )
  const edges = derived.filter(
    (value): value is Extract<CanvasHistoryDerivedObject, { kind: "edge" }> => value.kind === "edge",
  )
  return (
    nodes.length === nodeGuards.length &&
    edges.length === edgeGuards.length &&
    nodes.every((value) =>
      nodeGuards.some((guard) => guard.ordinal === value.ordinal && sameCanonicalValue(guard.node, value.ref)),
    ) &&
    edges.every((value) =>
      edgeGuards.some((guard) => guard.ordinal === value.ordinal && sameCanonicalValue(guard.edge, value.ref)),
    )
  )
}

function operationIndex(
  operations: readonly CanvasSemanticOperation[],
  operation: CanvasSemanticOperation,
): Uint32 {
  return String(operations.indexOf(operation)) as Uint32
}
function sortedRefs(refs: readonly CanvasEntityRef[]): CanvasEntityRef[] {
  return [...refs]
    .sort(refCompare)
    .filter((ref, index, all) => index === 0 || canvasEntityKey(ref) !== canvasEntityKey(all[index - 1]!))
}
function refCompare(left: CanvasEntityRef, right: CanvasEntityRef): number {
  return compareUtf8(canvasEntityKey(left), canvasEntityKey(right))
}
function compareActualWrites(left: CanvasActualWrite, right: CanvasActualWrite): number {
  return (
    compareUtf8(left.entityKind, right.entityKind) ||
    compareUtf8(left.entityId, right.entityId) ||
    compareUtf8(left.field, right.field)
  )
}

function valueAtPath(document: Y.Doc, path: string): unknown {
  const parts = path.split("/")
  if (parts[0] === "meta")
    return (getCanvasChildMap(document, "meta").get(parts[1]!) as Y.Map<unknown>).get(parts[3]!)
  if (parts[0] === "nodes" || parts[0] === "edges") {
    const entityKey = parts.slice(1, 4).join("/")
    const record = getCanvasChildMap(document, parts[0]).get(entityKey) as Y.Map<unknown>
    const field = parts[4]!
    if (parts[5] === "actor") return (record.get(field) as Y.Map<unknown>).get(parts[6]!)
    if (field === "tombstones") return (record.get(field) as Y.Map<unknown>).get(parts[5]!)
    return record.get(field)
  }
  const rootMap = getCanvasChildMap(document, parts[0] as "containments")
  return rootMap.get(parts.slice(1).join("/"))
}
