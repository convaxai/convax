import {
  compareDecodedBase64urlV2,
  compareUtf8V2,
  documentScopeDigestV2,
  encodeRestrictedJcsV2,
  parseActorIdV2,
  parseDigestV2,
  parseReplicaIdV2,
  replicaIdToYjsClientIdV2,
  parseDocumentScopeV2,
} from "@convax/collaboration"
import * as Y from "yjs"
import type {
  BoundedOperationReceiptV2,
  CanvasActorSlotEntriesV2,
  CanvasCanonicalMapEntriesV2,
  CanvasCanonicalMetaV2,
  CanvasCanonicalSemanticHistoryValueV2,
  CanvasCanonicalStateV2,
  CanvasEdgeDataV2,
  CanvasEdgeIdentityV2,
  CanvasEdgeSnapshotV2,
  CanvasEntityRefV2,
  CanvasIdentityV2,
  CanvasNodeIdentityV2,
  CanvasNodeSnapshotV2,
  CanvasPointV2,
  CanvasSizeV2,
  CanvasSnapshotV2,
  ContainmentChoiceV2,
  CreationGroupRefV2,
  DigestV2,
  DocumentScopeV2,
  GenerationBeginV2,
  GenerationDismissalV2,
  GenerationRecoveryFailureV2,
  NodeDataEnvelopeV2,
  OwnerGenerationTerminalV2,
  PluginStateEnvelopeV2,
  StampedClaimV2,
  SemanticHistoryRootV2,
  SemanticHistoryTransitionV2,
  TombstoneFactV2,
} from "./types"
import {
  assertCanvasIdentityV2,
  assertContainmentChoiceV2,
  assertCreationGroupV2,
  assertEdgeDataV2,
  assertEdgeIdentityV2,
  assertGenerationBeginV2,
  assertGenerationDismissalV2,
  assertGenerationRecoveryFailureV2,
  assertGenerationTerminalV2,
  assertNodeDataV2,
  assertNodeIdentityV2,
  assertOperationReceiptV2,
  assertPluginStateV2,
  assertPointV2,
  assertSemanticHistoryValueV2,
  assertSizeV2,
  assertStampedClaimV2,
  assertTombstoneV2,
  canvasDigestV2,
  canvasEntityKeyV2,
  canvasOwnerCanonicalizerDigestV2,
  CanvasSchemaErrorV2,
  operationKeyV2,
  sameCanonicalValueV2,
} from "./validation"
import { assertCanvasHistoryTemplateScheduleV2 } from "./history-schedule"

export const CANVAS_ROOT_NAME_V2 = "convax.canvas.v2"
export const CANVAS_ROOT_KEYS_V2 = Object.freeze([
  "identity",
  "meta",
  "nodes",
  "edges",
  "containments",
  "generationBegins",
  "generationTerminals",
  "generationDismissals",
  "generationRecoveryFailures",
  "semanticHistory",
  "operations",
] as const)

const META_KEYS = ["title", "description", "tags"] as const
const NODE_KEYS = ["identity", "position", "size", "data", "plugin", "tombstones", "creationGroup"] as const
const EDGE_KEYS = ["identity", "data", "tombstones", "creationGroup"] as const
const IDENTITY_KEYS = [
  "format",
  "scopeId",
  "canvasId",
  "ownerSchemaDigest",
  "protocolDigest",
  "canonicalizerDigest",
  "projectIndexRouteDependencyFrameDigest",
  "genesisDigest",
] as const

export function createCanvasYDocV2(
  scopeInput: DocumentScopeV2,
  ownerSchemaDigestInput: DigestV2,
  protocolDigestInput: DigestV2,
  projectIndexRouteDependencyFrameDigestInput: DigestV2,
  checkpointAuthorReplicaIdInput: import("@convax/collaboration").ReplicaIdV2,
): Y.Doc {
  const scope = parseDocumentScopeV2(scopeInput)
  if (scope.docKind !== "canvas")
    throw new CanvasSchemaErrorV2("scope-mismatch", "Canvas genesis requires a Canvas scope")
  const ownerSchemaDigest = parseDigestV2(ownerSchemaDigestInput)
  const protocolDigest = parseDigestV2(protocolDigestInput)
  const projectIndexRouteDependencyFrameDigest = parseDigestV2(projectIndexRouteDependencyFrameDigestInput)
  const checkpointAuthorReplicaId = parseReplicaIdV2(checkpointAuthorReplicaIdInput)
  const scopeId = documentScopeDigestV2(scope)
  const canonicalizerDigest = canvasOwnerCanonicalizerDigestV2(ownerSchemaDigest)
  const core = {
    format: "convax.canvas-genesis-core/2",
    scopeId,
    canvasId: scope.docId as import("@convax/collaboration").CanvasIdV2,
    ownerSchemaDigest,
    protocolDigest,
    canonicalizerDigest,
    projectIndexRouteDependencyFrameDigest,
  } as const
  const identity: CanvasIdentityV2 = {
    ...core,
    format: "convax.canvas.v2",
    genesisDigest: canvasDigestV2("convax.canvas-genesis-core/2", core),
  }
  const document = createCanvasReconstructionYDocV2()
  // Genesis structs are authored by the checkpoint replica's reserved Yjs client
  // id. A random process client id would make otherwise identical genesis bytes
  // unverifiable against the retained author credential chain.
  document.clientID = replicaIdToYjsClientIdV2(checkpointAuthorReplicaId)
  document.transact(() => {
    const root = document.getMap(CANVAS_ROOT_NAME_V2)
    const identityMap = new Y.Map<unknown>()
    for (const key of IDENTITY_KEYS) identityMap.set(key, identity[key])
    const meta = new Y.Map<unknown>()
    for (const key of META_KEYS) meta.set(key, new Y.Map<unknown>())
    root.set("identity", identityMap)
    root.set("meta", meta)
    for (const key of CANVAS_ROOT_KEYS_V2.slice(2)) root.set(key, new Y.Map<unknown>())
  }, "canvas-genesis-v2")
  validateCanvasYDocV2(document, scope)
  return document
}

export function cloneCanvasYDocV2(document: Y.Doc): Y.Doc {
  const clone = createCanvasReconstructionYDocV2()
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(document), "canvas-candidate-clone-v2")
  return clone
}

/** Owner-specific reconstruction factory: binds the sole named root before an update is applied. */
export function createCanvasReconstructionYDocV2(): Y.Doc {
  const document = new Y.Doc()
  document.getMap(CANVAS_ROOT_NAME_V2)
  return document
}

export function getCanvasRootV2(document: Y.Doc): Y.Map<unknown> {
  const root = document.share.get(CANVAS_ROOT_NAME_V2)
  if (!(root instanceof Y.Map))
    throw new CanvasSchemaErrorV2("invalid-root", "Canvas v2 root is missing or is not a Y.Map")
  return root
}

export function getCanvasChildMapV2(document: Y.Doc, key: (typeof CANVAS_ROOT_KEYS_V2)[number]): Y.Map<unknown> {
  return asMap(getCanvasRootV2(document).get(key), `${CANVAS_ROOT_NAME_V2}.${key}`)
}

export function validateCanvasYDocV2(document: Y.Doc, scope?: DocumentScopeV2): CanvasSnapshotV2 {
  const sharedNames = [...document.share.keys()]
  if (sharedNames.length !== 1 || sharedNames[0] !== CANVAS_ROOT_NAME_V2) {
    throw new CanvasSchemaErrorV2("unknown-root", "Canvas Y.Doc must contain exactly the convax.canvas.v2 named root")
  }
  const root = getCanvasRootV2(document)
  assertMapKeys(root, CANVAS_ROOT_KEYS_V2, CANVAS_ROOT_NAME_V2)
  const identity = readIdentity(asMap(root.get("identity"), "identity"), scope)
  const meta = readMeta(asMap(root.get("meta"), "meta"))
  const nodes = readMap(root, "nodes", readNode)
  const edges = readMap(root, "edges", readEdge)
  const containments = readMap(root, "containments", readContainment)
  const generationBegins = readMap(root, "generationBegins", readBegin)
  const generationTerminals = readMap(root, "generationTerminals", readTerminal)
  const generationDismissals = readMap(root, "generationDismissals", readDismissal)
  const generationRecoveryFailures = readMap(root, "generationRecoveryFailures", readRecovery)
  const semanticHistory = readMap(root, "semanticHistory", readHistory)
  const operations = readMap(root, "operations", readOperation)

  for (const [key, choice] of containments) {
    if (key !== `${canvasEntityKeyV2(choice.child)}/actor/${choice.stamp.actorId}`)
      throw new CanvasSchemaErrorV2("containment-key-mismatch", `${key} does not match containment value`)
  }
  validateGenerationRelations(
    nodes,
    generationBegins,
    generationTerminals,
    generationDismissals,
    generationRecoveryFailures,
  )
  validateCreationGroups(nodes, edges, operations)
  validateSemanticHistory(semanticHistory, operations)

  return Object.freeze({
    identity,
    meta,
    nodes,
    edges,
    containments,
    generationBegins,
    generationTerminals,
    generationDismissals,
    generationRecoveryFailures,
    semanticHistory,
    operations,
  })
}

export function extractCanvasCanonicalStateV2(document: Y.Doc, scope?: DocumentScopeV2): CanvasCanonicalStateV2 {
  const snapshot = validateCanvasYDocV2(document, scope)
  return {
    format: "convax.canvas-canonical-state/2",
    identity: snapshot.identity,
    meta: snapshot.meta,
    nodes: mapEntries(snapshot.nodes, ({ key: _key, ...record }) => record),
    edges: mapEntries(snapshot.edges, ({ key: _key, ...record }) => record),
    containments: mapEntries(snapshot.containments),
    generationBegins: mapEntries(snapshot.generationBegins),
    generationTerminals: mapEntries(snapshot.generationTerminals),
    generationDismissals: mapEntries(snapshot.generationDismissals),
    generationRecoveryFailures: mapEntries(snapshot.generationRecoveryFailures),
    semanticHistory: mapEntries(snapshot.semanticHistory),
    operations: mapEntries(snapshot.operations),
  }
}

export function encodeCanvasCanonicalStateV2(document: Y.Doc, scope?: DocumentScopeV2): Uint8Array {
  return encodeRestrictedJcsV2(extractCanvasCanonicalStateV2(document, scope))
}

function readIdentity(map: Y.Map<unknown>, scope?: DocumentScopeV2): CanvasIdentityV2 {
  assertMapKeys(map, IDENTITY_KEYS, "identity")
  const value = Object.fromEntries(IDENTITY_KEYS.map((key) => [key, map.get(key)]))
  assertCanvasIdentityV2(value, scope)
  return value
}

function readMeta(map: Y.Map<unknown>): CanvasCanonicalMetaV2 {
  assertMapKeys(map, META_KEYS, "meta")
  return {
    title: actorEntries(asMap(map.get("title"), "meta.title"), (value) =>
      assertStampedClaimV2(value, assertNullableText),
    ),
    description: actorEntries(asMap(map.get("description"), "meta.description"), (value) =>
      assertStampedClaimV2(value, assertNullableText),
    ),
    tags: actorEntries(asMap(map.get("tags"), "meta.tags"), (value) => assertStampedClaimV2(value, assertTags)),
  }
}

function readNode(key: string, value: unknown): CanvasNodeSnapshotV2 {
  const record = asMap(value, `nodes.${key}`)
  assertMapKeys(record, NODE_KEYS, `nodes.${key}`)
  const identity = record.get("identity")
  assertNodeIdentityV2(identity)
  if (canvasEntityKeyV2(identity.ref) !== key)
    throw new CanvasSchemaErrorV2("identity-key-mismatch", `Node ${key} identity does not match key`)
  const position = actorEntries<StampedClaimV2<CanvasPointV2>>(
    asMap(record.get("position"), `${key}.position`),
    (claim: unknown): asserts claim is StampedClaimV2<CanvasPointV2> => assertStampedClaimV2(claim, assertPointV2),
  )
  const size = actorEntries<StampedClaimV2<CanvasSizeV2>>(
    asMap(record.get("size"), `${key}.size`),
    (claim: unknown): asserts claim is StampedClaimV2<CanvasSizeV2> => assertStampedClaimV2(claim, assertSizeV2),
  )
  const data = actorEntries<StampedClaimV2<NodeDataEnvelopeV2>>(
    asMap(record.get("data"), `${key}.data`),
    (claim: unknown): asserts claim is StampedClaimV2<NodeDataEnvelopeV2> =>
      assertStampedClaimV2(claim, assertNodeDataV2),
  )
  const plugin = actorEntries<StampedClaimV2<PluginStateEnvelopeV2 | null>>(
    asMap(record.get("plugin"), `${key}.plugin`),
    (claim: unknown): asserts claim is StampedClaimV2<PluginStateEnvelopeV2 | null> =>
      assertStampedClaimV2(claim, assertNullablePlugin),
  )
  const tombstones = actorEntries<TombstoneFactV2>(
    asMap(record.get("tombstones"), `${key}.tombstones`),
    (fact: unknown): asserts fact is TombstoneFactV2 => assertTombstoneV2(fact, identity.ref),
    true,
  )
  if (position.length === 0 || size.length === 0 || data.length === 0 || plugin.length === 0)
    throw new CanvasSchemaErrorV2("missing-register-value", `Node ${key} lacks a creator value`)
  for (const [, claim] of data) {
    if (identity.role === "agent" ? claim.value.kind !== "agent" : claim.value.kind === "agent")
      throw new CanvasSchemaErrorV2("role-data-mismatch", `Node ${key} role and data disagree`)
  }
  const creationGroup = record.get("creationGroup")
  if (creationGroup !== null) assertCreationGroupV2(creationGroup)
  return Object.freeze({ key, identity, position, size, data, plugin, tombstones, creationGroup })
}

function readEdge(key: string, value: unknown): CanvasEdgeSnapshotV2 {
  const record = asMap(value, `edges.${key}`)
  assertMapKeys(record, EDGE_KEYS, `edges.${key}`)
  const identity = record.get("identity")
  assertEdgeIdentityV2(identity)
  if (canvasEntityKeyV2(identity.ref) !== key)
    throw new CanvasSchemaErrorV2("identity-key-mismatch", `Edge ${key} identity does not match key`)
  const data = actorEntries<StampedClaimV2<CanvasEdgeDataV2>>(
    asMap(record.get("data"), `${key}.data`),
    (claim: unknown): asserts claim is StampedClaimV2<CanvasEdgeDataV2> =>
      assertStampedClaimV2(claim, assertEdgeDataV2),
  )
  const tombstones = actorEntries<TombstoneFactV2>(
    asMap(record.get("tombstones"), `${key}.tombstones`),
    (fact: unknown): asserts fact is TombstoneFactV2 => assertTombstoneV2(fact, identity.ref),
    true,
  )
  if (data.length === 0) throw new CanvasSchemaErrorV2("missing-register-value", `Edge ${key} lacks creator data`)
  const creationGroup = record.get("creationGroup")
  if (creationGroup !== null) assertCreationGroupV2(creationGroup)
  return Object.freeze({ key, identity, data, tombstones, creationGroup })
}

function readContainment(key: string, value: unknown): ContainmentChoiceV2 {
  assertContainmentChoiceV2(value)
  return value
}

function readBegin(key: string, value: unknown): GenerationBeginV2 {
  assertGenerationBeginV2(value)
  if (key !== value.generationId)
    throw new CanvasSchemaErrorV2("generation-key-mismatch", "Generation begin key mismatch")
  return value
}

function readTerminal(key: string, value: unknown): OwnerGenerationTerminalV2 {
  assertGenerationTerminalV2(value)
  if (key !== `${value.generationId}/owner/${value.beginActorId}`)
    throw new CanvasSchemaErrorV2("generation-key-mismatch", "Generation terminal key mismatch")
  return value
}

function readDismissal(key: string, value: unknown): GenerationDismissalV2 {
  assertGenerationDismissalV2(value)
  if (key !== value.generationId)
    throw new CanvasSchemaErrorV2("generation-key-mismatch", "Generation dismissal key mismatch")
  return value
}

function readRecovery(key: string, value: unknown): GenerationRecoveryFailureV2 {
  assertGenerationRecoveryFailureV2(value)
  if (key !== value.generationId)
    throw new CanvasSchemaErrorV2("generation-key-mismatch", "Generation recovery key mismatch")
  return value
}

function readHistory(_key: string, value: unknown): CanvasCanonicalSemanticHistoryValueV2 {
  assertSemanticHistoryValueV2(value)
  return value
}

function readOperation(key: string, value: unknown): BoundedOperationReceiptV2 {
  assertOperationReceiptV2(value)
  if (key !== operationKeyV2(value.actorId, value.operationId))
    throw new CanvasSchemaErrorV2("operation-key-mismatch", "Operation receipt key mismatch")
  return value
}

function validateGenerationRelations(
  nodes: ReadonlyMap<string, CanvasNodeSnapshotV2>,
  begins: ReadonlyMap<string, GenerationBeginV2>,
  terminals: ReadonlyMap<string, OwnerGenerationTerminalV2>,
  dismissals: ReadonlyMap<string, GenerationDismissalV2>,
  recoveries: ReadonlyMap<string, GenerationRecoveryFailureV2>,
): void {
  for (const begin of begins.values()) {
    if (!nodes.has(canvasEntityKeyV2(begin.node)))
      throw new CanvasSchemaErrorV2("generation-node-missing", "Generation begin targets an unknown node")
  }
  for (const terminal of terminals.values()) {
    const begin = begins.get(terminal.generationId)
    if (
      begin === undefined ||
      terminal.beginActorId !== begin.beginActorId ||
      terminal.beginDigest !== canvasDigestV2("convax.canvas-generation-begin/2", begin) ||
      canvasEntityKeyV2(terminal.node) !== canvasEntityKeyV2(begin.node)
    ) {
      throw new CanvasSchemaErrorV2("generation-begin-mismatch", "Generation terminal does not bind the exact begin")
    }
  }
  for (const marker of [...dismissals.values(), ...recoveries.values()]) {
    const begin = begins.get(marker.generationId)
    if (begin === undefined || marker.beginDigest !== canvasDigestV2("convax.canvas-generation-begin/2", begin))
      throw new CanvasSchemaErrorV2("generation-begin-mismatch", "Generation marker does not bind the exact begin")
  }
}

function validateCreationGroups(
  nodes: ReadonlyMap<string, CanvasNodeSnapshotV2>,
  edges: ReadonlyMap<string, CanvasEdgeSnapshotV2>,
  operations: ReadonlyMap<string, BoundedOperationReceiptV2>,
): void {
  const groups = new Map<string, { ref: CreationGroupRefV2; members: CanvasEntityRefV2[] }>()
  for (const record of [...nodes.values(), ...edges.values()]) {
    const ref = record.creationGroup
    if (ref === null) continue
    const current = groups.get(ref.groupId)
    if (current !== undefined && !sameCanonicalValueV2(current.ref, ref))
      throw new CanvasSchemaErrorV2("creation-group-equivocation", `Creation group ${ref.groupId} has divergent refs`)
    const bucket = current ?? { ref, members: [] }
    bucket.members.push(record.identity.ref)
    groups.set(ref.groupId, bucket)
  }
  const groupByNode = new Map<string, string>()
  for (const [key, node] of nodes) if (node.creationGroup !== null) groupByNode.set(key, node.creationGroup.groupId)
  for (const [groupId, group] of groups) {
    group.members.sort((left, right) => compareUtf8V2(canvasEntityKeyV2(left), canvasEntityKeyV2(right)))
    const core = {
      format: "convax.canvas-creation-group-member-set/2",
      groupId,
      source: group.ref.source,
      members: group.members,
    }
    if (group.ref.memberSetDigest !== canvasDigestV2("convax.canvas-creation-group-member-set/2", core))
      throw new CanvasSchemaErrorV2("member-set-mismatch", `Creation group ${groupId} member digest is invalid`)
    const source = nodes.get(canvasEntityKeyV2(group.ref.source))
    if (source === undefined)
      throw new CanvasSchemaErrorV2("creation-group-source-missing", `Creation group ${groupId} source is absent`)
    const creatorIds = new Set(
      group.members.map((member) =>
        member.kind === "node"
          ? nodes.get(canvasEntityKeyV2(member))?.identity.createdBy
          : edges.get(canvasEntityKeyV2(member))?.identity.createdBy,
      ),
    )
    if (creatorIds.size !== 1 || creatorIds.has(undefined))
      throw new CanvasSchemaErrorV2("creation-group-creator-mismatch", `Creation group ${groupId} spans creators`)
    const creator = [...creatorIds][0]
    const receipt = [...operations.values()].find((candidate) => candidate.operationId === creator)
    if (
      receipt === undefined ||
      receipt.resultEntities.length !== group.members.length ||
      receipt.resultEntities.some(
        (member, index) => canvasEntityKeyV2(member) !== canvasEntityKeyV2(group.members[index]!),
      )
    ) {
      throw new CanvasSchemaErrorV2(
        "creation-group-receipt-mismatch",
        `Creation group ${groupId} is not the creator's complete result set`,
      )
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (groupId: string): void => {
    if (visiting.has(groupId))
      throw new CanvasSchemaErrorV2("creation-group-source-cycle", "Creation-group source cycle is invalid")
    if (visited.has(groupId)) return
    visiting.add(groupId)
    const group = groups.get(groupId)
    const parent = group === undefined ? undefined : groupByNode.get(canvasEntityKeyV2(group.ref.source))
    if (parent !== undefined) visit(parent)
    visiting.delete(groupId)
    visited.add(groupId)
  }
  for (const groupId of groups.keys()) visit(groupId)
}

function validateSemanticHistory(
  history: ReadonlyMap<string, CanvasCanonicalSemanticHistoryValueV2>,
  operations: ReadonlyMap<string, BoundedOperationReceiptV2>,
): void {
  const roots = new Map<string, SemanticHistoryRootV2>()
  for (const [key, value] of history) {
    const expected =
      value.format === "convax.canvas-semantic-history-root/2"
        ? `root/${value.rootOperationId}`
        : `transition/${value.rootOperationId}/actor/${value.stamp.actorId}/operation/${value.transitionOperationId}`
    if (key !== expected)
      throw new CanvasSchemaErrorV2("history-key-mismatch", `Semantic history key ${key} is invalid`)
    if (value.format === "convax.canvas-semantic-history-root/2") {
      assertCanvasHistoryTemplateScheduleV2(value.inverseTemplate, value.initialBindings)
      assertCanvasHistoryTemplateScheduleV2(value.forwardTemplate, value.initialBindings)
      roots.set(value.rootOperationId, value)
    }
  }
  for (const root of roots.values()) {
    const receipt = [...operations.values()].find((candidate) => candidate.operationId === root.rootOperationId)
    if (
      receipt === undefined ||
      !receipt.semanticRoot ||
      receipt.historyMaterialDigest !== root.materialDigest ||
      receipt.intentKind !== root.sourceIntentKind ||
      receipt.intentDigest !== root.sourceIntentDigest
    ) {
      throw new CanvasSchemaErrorV2(
        "history-receipt-mismatch",
        `Semantic history root ${root.rootOperationId} does not bind its receipt`,
      )
    }
  }
  for (const value of history.values()) {
    if (value.format === "convax.canvas-semantic-history-transition/2" && !roots.has(value.rootOperationId)) {
      throw new CanvasSchemaErrorV2(
        "history-root-missing",
        `Semantic history transition ${value.transitionOperationId} has no root`,
      )
    }
  }
}

function readMap<T>(
  root: Y.Map<unknown>,
  key: string,
  read: (key: string, value: unknown) => T,
): ReadonlyMap<string, T> {
  const map = asMap(root.get(key), key)
  const result = new Map<string, T>()
  for (const [entryKey, value] of map.entries()) result.set(entryKey, read(entryKey, value))
  return result
}

function actorEntries<T>(
  map: Y.Map<unknown>,
  validate: (value: unknown) => asserts value is T,
  tombstone = false,
): CanvasActorSlotEntriesV2<T> {
  const entries: [import("@convax/collaboration").ActorIdV2, T][] = []
  for (const [actor, value] of map.entries()) {
    const actorId = parseActorIdV2(actor)
    validate(value)
    const embeddedActor = tombstone
      ? (value as TombstoneFactV2).stamp.actorId
      : (value as StampedClaimV2<unknown>).stamp.actorId
    if (embeddedActor !== actorId)
      throw new CanvasSchemaErrorV2("actor-slot-mismatch", `Actor slot ${actor} disagrees with embedded stamp`)
    entries.push([actorId, value])
  }
  entries.sort((left, right) => compareDecodedBase64urlV2(left[0], right[0]))
  return entries
}

function mapEntries<K extends string, V, O = V>(
  map: ReadonlyMap<K, V>,
  convert?: (value: V) => O,
): CanvasCanonicalMapEntriesV2<K, O> {
  return [...map.entries()]
    .sort((left, right) => compareUtf8V2(left[0], right[0]))
    .map(([key, value]) => [key, convert === undefined ? (value as unknown as O) : convert(value)] as const)
}

function assertMapKeys(map: Y.Map<unknown>, keys: readonly string[], label: string): void {
  if (map.size !== keys.length)
    throw new CanvasSchemaErrorV2("closed-map-mismatch", `${label} has missing or unknown keys`)
  for (const key of keys)
    if (!map.has(key)) throw new CanvasSchemaErrorV2("closed-map-mismatch", `${label}.${key} is required`)
}

function asMap(value: unknown, label: string): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) throw new CanvasSchemaErrorV2("invalid-y-type", `${label} must be a Y.Map`)
  return value
}

function assertNullableText(value: unknown): asserts value is string | null {
  if (
    value !== null &&
    (typeof value !== "string" ||
      value.normalize("NFC") !== value ||
      new TextEncoder().encode(value).length > 64 * 1024)
  )
    throw new CanvasSchemaErrorV2("invalid-string", "Metadata string is invalid")
}

function assertTags(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > 128)
    throw new CanvasSchemaErrorV2("invalid-tags", "Tags must be an array of at most 128 entries")
  let prior: string | undefined
  for (const tag of value) {
    if (typeof tag !== "string" || tag.normalize("NFC") !== tag || new TextEncoder().encode(tag).length > 256)
      throw new CanvasSchemaErrorV2("invalid-tags", "Tag is invalid")
    if (prior !== undefined && compareUtf8V2(prior, tag) >= 0)
      throw new CanvasSchemaErrorV2("invalid-tags", "Tags must be UTF-8 sorted and duplicate-free")
    prior = tag
  }
}

function assertNullablePlugin(value: unknown): asserts value is PluginStateEnvelopeV2 | null {
  if (value !== null) assertPluginStateV2(value)
}

// Keeps these imports part of the closed canonical-state implementation instead of
// allowing them to silently drift into renderer-only declarations.
void (null as unknown as
  | CanvasPointV2
  | CanvasSizeV2
  | NodeDataEnvelopeV2
  | CanvasEdgeDataV2
  | CanvasNodeIdentityV2
  | CanvasEdgeIdentityV2
  | StampedClaimV2<unknown>
  | TombstoneFactV2
  | SemanticHistoryRootV2
  | SemanticHistoryTransitionV2)
