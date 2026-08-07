import {
  compareDecodedBase64url,
  compareUtf8,
  documentScopeDigest,
  encodeRestrictedJcs,
  parseActorId,
  parseDigest,
  parseReplicaId,
  replicaIdToYjsClientId,
  parseDocumentScope,
} from "@convax/collaboration"
import * as Y from "yjs"
import type {
  BoundedOperationReceipt,
  CanvasActorSlotEntries,
  CanvasCanonicalMapEntries,
  CanvasCanonicalMeta,
  CanvasCanonicalSemanticHistoryValue,
  CanvasCanonicalState,
  CanvasEdgeData,
  CanvasEdgeIdentity,
  CanvasEdgeSnapshot,
  CanvasEntityRef,
  CanvasIdentity,
  CanvasNodeIdentity,
  CanvasNodeSnapshot,
  CanvasPoint,
  CanvasSize,
  CanvasSnapshot,
  ContainmentChoice,
  CreationGroupRef,
  Digest,
  DocumentScope,
  GenerationBeginV2,
  GenerationDismissalV2,
  GenerationRecoveryFailureV2,
  NodeDataEnvelope,
  OwnerGenerationTerminalV2,
  PluginStateEnvelope,
  StampedClaim,
  SemanticHistoryRoot,
  SemanticHistoryTransition,
  TombstoneFact,
} from "./types"
import {
  assertCanvasIdentity,
  assertContainmentChoice,
  assertCreationGroup,
  assertEdgeData,
  assertEdgeIdentity,
  assertGenerationBeginV2,
  assertGenerationDismissalV2,
  assertGenerationRecoveryFailureV2,
  assertGenerationTerminalV2,
  assertNodeData,
  assertNodeIdentity,
  assertOperationReceipt,
  assertPluginState,
  assertPoint,
  assertSemanticHistoryValue,
  assertSize,
  assertStampedClaim,
  assertTombstone,
  canvasDigest,
  canvasEntityKey,
  canvasOwnerCanonicalizerDigest,
  CanvasSchemaError,
  operationKey,
  sameCanonicalValue,
} from "./validation"
import { assertCanvasHistoryTemplateSchedule } from "./history-schedule"

export const CANVAS_ROOT_NAME = "convax.canvas"
export const CANVAS_ROOT_KEYS = Object.freeze([
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

export function createCanvasYDoc(
  scopeInput: DocumentScope,
  ownerSchemaDigestInput: Digest,
  protocolDigestInput: Digest,
  projectIndexRouteDependencyFrameDigestInput: Digest,
  checkpointAuthorReplicaIdInput: import("@convax/collaboration").ReplicaId,
): Y.Doc {
  const scope = parseDocumentScope(scopeInput)
  if (scope.docKind !== "canvas")
    throw new CanvasSchemaError("scope-mismatch", "Canvas genesis requires a Canvas scope")
  const ownerSchemaDigest = parseDigest(ownerSchemaDigestInput)
  const protocolDigest = parseDigest(protocolDigestInput)
  const projectIndexRouteDependencyFrameDigest = parseDigest(projectIndexRouteDependencyFrameDigestInput)
  const checkpointAuthorReplicaId = parseReplicaId(checkpointAuthorReplicaIdInput)
  const scopeId = documentScopeDigest(scope)
  const canonicalizerDigest = canvasOwnerCanonicalizerDigest(ownerSchemaDigest)
  const core = {
    format: "convax.canvas-genesis-core",
    scopeId,
    canvasId: scope.docId as import("@convax/collaboration").CanvasId,
    ownerSchemaDigest,
    protocolDigest,
    canonicalizerDigest,
    projectIndexRouteDependencyFrameDigest,
  } as const
  const identity: CanvasIdentity = {
    ...core,
    format: "convax.canvas",
    genesisDigest: canvasDigest("convax.canvas-genesis-core", core),
  }
  const document = createCanvasReconstructionYDoc()
  // Genesis structs are authored by the checkpoint replica's reserved Yjs client
  // id. A random process client id would make otherwise identical genesis bytes
  // unverifiable against the retained author credential chain.
  document.clientID = replicaIdToYjsClientId(checkpointAuthorReplicaId)
  document.transact(() => {
    const root = document.getMap(CANVAS_ROOT_NAME)
    const identityMap = new Y.Map<unknown>()
    for (const key of IDENTITY_KEYS) identityMap.set(key, identity[key])
    const meta = new Y.Map<unknown>()
    for (const key of META_KEYS) meta.set(key, new Y.Map<unknown>())
    root.set("identity", identityMap)
    root.set("meta", meta)
    for (const key of CANVAS_ROOT_KEYS.slice(2)) root.set(key, new Y.Map<unknown>())
  }, "canvas-genesis-v2")
  validateCanvasYDoc(document, scope)
  return document
}

export function cloneCanvasYDoc(document: Y.Doc): Y.Doc {
  const clone = createCanvasReconstructionYDoc()
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(document), "canvas-candidate-clone-v2")
  return clone
}

/** Owner-specific reconstruction factory: binds the sole named root before an update is applied. */
export function createCanvasReconstructionYDoc(): Y.Doc {
  const document = new Y.Doc()
  document.getMap(CANVAS_ROOT_NAME)
  return document
}

export function getCanvasRoot(document: Y.Doc): Y.Map<unknown> {
  const root = document.share.get(CANVAS_ROOT_NAME)
  if (!(root instanceof Y.Map))
    throw new CanvasSchemaError("invalid-root", "Canvas v2 root is missing or is not a Y.Map")
  return root
}

export function getCanvasChildMap(document: Y.Doc, key: (typeof CANVAS_ROOT_KEYS)[number]): Y.Map<unknown> {
  return asMap(getCanvasRoot(document).get(key), `${CANVAS_ROOT_NAME}.${key}`)
}

export function validateCanvasYDoc(document: Y.Doc, scope?: DocumentScope): CanvasSnapshot {
  const sharedNames = [...document.share.keys()]
  if (sharedNames.length !== 1 || sharedNames[0] !== CANVAS_ROOT_NAME) {
    throw new CanvasSchemaError("unknown-root", "Canvas Y.Doc must contain exactly the convax.canvas.v2 named root")
  }
  const root = getCanvasRoot(document)
  assertMapKeys(root, CANVAS_ROOT_KEYS, CANVAS_ROOT_NAME)
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
    if (key !== `${canvasEntityKey(choice.child)}/actor/${choice.stamp.actorId}`)
      throw new CanvasSchemaError("containment-key-mismatch", `${key} does not match containment value`)
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

export function extractCanvasCanonicalState(document: Y.Doc, scope?: DocumentScope): CanvasCanonicalState {
  const snapshot = validateCanvasYDoc(document, scope)
  return {
    format: "convax.canvas-canonical-state",
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

export function encodeCanvasCanonicalState(document: Y.Doc, scope?: DocumentScope): Uint8Array {
  return encodeRestrictedJcs(extractCanvasCanonicalState(document, scope))
}

/** Internal owner-runtime helper for encoding an already fully validated snapshot. */
export function encodeValidatedCanvasCanonicalState(snapshot: CanvasSnapshot): Uint8Array {
  return encodeRestrictedJcs({
    format: "convax.canvas-canonical-state",
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
  } satisfies CanvasCanonicalState)
}

function readIdentity(map: Y.Map<unknown>, scope?: DocumentScope): CanvasIdentity {
  assertMapKeys(map, IDENTITY_KEYS, "identity")
  const value = Object.fromEntries(IDENTITY_KEYS.map((key) => [key, map.get(key)]))
  assertCanvasIdentity(value, scope)
  return value
}

function readMeta(map: Y.Map<unknown>): CanvasCanonicalMeta {
  assertMapKeys(map, META_KEYS, "meta")
  return {
    title: actorEntries(asMap(map.get("title"), "meta.title"), (value) =>
      assertStampedClaim(value, assertNullableText),
    ),
    description: actorEntries(asMap(map.get("description"), "meta.description"), (value) =>
      assertStampedClaim(value, assertNullableText),
    ),
    tags: actorEntries(asMap(map.get("tags"), "meta.tags"), (value) => assertStampedClaim(value, assertTags)),
  }
}

function readNode(key: string, value: unknown): CanvasNodeSnapshot {
  const record = asMap(value, `nodes.${key}`)
  assertMapKeys(record, NODE_KEYS, `nodes.${key}`)
  const identity = record.get("identity")
  assertNodeIdentity(identity)
  if (canvasEntityKey(identity.ref) !== key)
    throw new CanvasSchemaError("identity-key-mismatch", `Node ${key} identity does not match key`)
  const position = actorEntries<StampedClaim<CanvasPoint>>(
    asMap(record.get("position"), `${key}.position`),
    (claim: unknown): asserts claim is StampedClaim<CanvasPoint> => assertStampedClaim(claim, assertPoint),
  )
  const size = actorEntries<StampedClaim<CanvasSize>>(
    asMap(record.get("size"), `${key}.size`),
    (claim: unknown): asserts claim is StampedClaim<CanvasSize> => assertStampedClaim(claim, assertSize),
  )
  const data = actorEntries<StampedClaim<NodeDataEnvelope>>(
    asMap(record.get("data"), `${key}.data`),
    (claim: unknown): asserts claim is StampedClaim<NodeDataEnvelope> =>
      assertStampedClaim(claim, assertNodeData),
  )
  const plugin = actorEntries<StampedClaim<PluginStateEnvelope | null>>(
    asMap(record.get("plugin"), `${key}.plugin`),
    (claim: unknown): asserts claim is StampedClaim<PluginStateEnvelope | null> =>
      assertStampedClaim(claim, assertNullablePlugin),
  )
  const tombstones = actorEntries<TombstoneFact>(
    asMap(record.get("tombstones"), `${key}.tombstones`),
    (fact: unknown): asserts fact is TombstoneFact => assertTombstone(fact, identity.ref),
    true,
  )
  if (position.length === 0 || size.length === 0 || data.length === 0 || plugin.length === 0)
    throw new CanvasSchemaError("missing-register-value", `Node ${key} lacks a creator value`)
  for (const [, claim] of data) {
    if (identity.role === "agent" ? claim.value.kind !== "agent" : claim.value.kind === "agent")
      throw new CanvasSchemaError("role-data-mismatch", `Node ${key} role and data disagree`)
  }
  const creationGroup = record.get("creationGroup")
  if (creationGroup !== null) assertCreationGroup(creationGroup)
  return Object.freeze({ key, identity, position, size, data, plugin, tombstones, creationGroup })
}

function readEdge(key: string, value: unknown): CanvasEdgeSnapshot {
  const record = asMap(value, `edges.${key}`)
  assertMapKeys(record, EDGE_KEYS, `edges.${key}`)
  const identity = record.get("identity")
  assertEdgeIdentity(identity)
  if (canvasEntityKey(identity.ref) !== key)
    throw new CanvasSchemaError("identity-key-mismatch", `Edge ${key} identity does not match key`)
  const data = actorEntries<StampedClaim<CanvasEdgeData>>(
    asMap(record.get("data"), `${key}.data`),
    (claim: unknown): asserts claim is StampedClaim<CanvasEdgeData> =>
      assertStampedClaim(claim, assertEdgeData),
  )
  const tombstones = actorEntries<TombstoneFact>(
    asMap(record.get("tombstones"), `${key}.tombstones`),
    (fact: unknown): asserts fact is TombstoneFact => assertTombstone(fact, identity.ref),
    true,
  )
  if (data.length === 0) throw new CanvasSchemaError("missing-register-value", `Edge ${key} lacks creator data`)
  const creationGroup = record.get("creationGroup")
  if (creationGroup !== null) assertCreationGroup(creationGroup)
  return Object.freeze({ key, identity, data, tombstones, creationGroup })
}

function readContainment(key: string, value: unknown): ContainmentChoice {
  assertContainmentChoice(value)
  return value
}

function readBegin(key: string, value: unknown): GenerationBeginV2 {
  assertGenerationBeginV2(value)
  if (key !== value.generationId)
    throw new CanvasSchemaError("generation-key-mismatch", "Generation begin key mismatch")
  return value
}

function readTerminal(key: string, value: unknown): OwnerGenerationTerminalV2 {
  assertGenerationTerminalV2(value)
  if (key !== `${value.generationId}/owner/${value.beginActorId}`)
    throw new CanvasSchemaError("generation-key-mismatch", "Generation terminal key mismatch")
  return value
}

function readDismissal(key: string, value: unknown): GenerationDismissalV2 {
  assertGenerationDismissalV2(value)
  if (key !== value.generationId)
    throw new CanvasSchemaError("generation-key-mismatch", "Generation dismissal key mismatch")
  return value
}

function readRecovery(key: string, value: unknown): GenerationRecoveryFailureV2 {
  assertGenerationRecoveryFailureV2(value)
  if (key !== value.generationId)
    throw new CanvasSchemaError("generation-key-mismatch", "Generation recovery key mismatch")
  return value
}

function readHistory(_key: string, value: unknown): CanvasCanonicalSemanticHistoryValue {
  assertSemanticHistoryValue(value)
  return value
}

function readOperation(key: string, value: unknown): BoundedOperationReceipt {
  assertOperationReceipt(value)
  if (key !== operationKey(value.actorId, value.operationId))
    throw new CanvasSchemaError("operation-key-mismatch", "Operation receipt key mismatch")
  return value
}

/** Package-internal owner fast-path readers. They validate one exact changed
 * record with the same parsers used by the public full-document validator. */
export function readCanvasNodeRecordForOwner(document: Y.Doc, key: string): CanvasNodeSnapshot {
  return readNode(key, getCanvasChildMap(document, "nodes").get(key))
}

export function readCanvasEdgeRecordForOwner(document: Y.Doc, key: string): CanvasEdgeSnapshot {
  return readEdge(key, getCanvasChildMap(document, "edges").get(key))
}

export function readCanvasContainmentRecordForOwner(document: Y.Doc, key: string): ContainmentChoice {
  return readContainment(key, getCanvasChildMap(document, "containments").get(key))
}

export function readCanvasHistoryRecordForOwner(
  document: Y.Doc,
  key: string,
): CanvasCanonicalSemanticHistoryValue {
  return readHistory(key, getCanvasChildMap(document, "semanticHistory").get(key))
}

export function readCanvasOperationRecordForOwner(document: Y.Doc, key: string): BoundedOperationReceipt {
  return readOperation(key, getCanvasChildMap(document, "operations").get(key))
}

function validateGenerationRelations(
  nodes: ReadonlyMap<string, CanvasNodeSnapshot>,
  begins: ReadonlyMap<string, GenerationBeginV2>,
  terminals: ReadonlyMap<string, OwnerGenerationTerminalV2>,
  dismissals: ReadonlyMap<string, GenerationDismissalV2>,
  recoveries: ReadonlyMap<string, GenerationRecoveryFailureV2>,
): void {
  for (const begin of begins.values()) {
    if (!nodes.has(canvasEntityKey(begin.node)))
      throw new CanvasSchemaError("generation-node-missing", "Generation begin targets an unknown node")
  }
  for (const terminal of terminals.values()) {
    const begin = begins.get(terminal.generationId)
    if (
      begin === undefined ||
      terminal.beginActorId !== begin.beginActorId ||
      terminal.beginDigest !== canvasDigest("convax.canvas-generation-begin/2", begin) ||
      canvasEntityKey(terminal.node) !== canvasEntityKey(begin.node)
    ) {
      throw new CanvasSchemaError("generation-begin-mismatch", "Generation terminal does not bind the exact begin")
    }
  }
  for (const marker of [...dismissals.values(), ...recoveries.values()]) {
    const begin = begins.get(marker.generationId)
    if (begin === undefined || marker.beginDigest !== canvasDigest("convax.canvas-generation-begin/2", begin))
      throw new CanvasSchemaError("generation-begin-mismatch", "Generation marker does not bind the exact begin")
  }
}

function validateCreationGroups(
  nodes: ReadonlyMap<string, CanvasNodeSnapshot>,
  edges: ReadonlyMap<string, CanvasEdgeSnapshot>,
  operations: ReadonlyMap<string, BoundedOperationReceipt>,
): void {
  const groups = new Map<string, { ref: CreationGroupRef; members: CanvasEntityRef[] }>()
  for (const record of [...nodes.values(), ...edges.values()]) {
    const ref = record.creationGroup
    if (ref === null) continue
    const current = groups.get(ref.groupId)
    if (current !== undefined && !sameCanonicalValue(current.ref, ref))
      throw new CanvasSchemaError("creation-group-equivocation", `Creation group ${ref.groupId} has divergent refs`)
    const bucket = current ?? { ref, members: [] }
    bucket.members.push(record.identity.ref)
    groups.set(ref.groupId, bucket)
  }
  const groupByNode = new Map<string, string>()
  for (const [key, node] of nodes) if (node.creationGroup !== null) groupByNode.set(key, node.creationGroup.groupId)
  for (const [groupId, group] of groups) {
    group.members.sort((left, right) => compareUtf8(canvasEntityKey(left), canvasEntityKey(right)))
    const core = {
      format: "convax.canvas-creation-group-member-set",
      groupId,
      source: group.ref.source,
      members: group.members,
    }
    if (group.ref.memberSetDigest !== canvasDigest("convax.canvas-creation-group-member-set", core))
      throw new CanvasSchemaError("member-set-mismatch", `Creation group ${groupId} member digest is invalid`)
    const source = nodes.get(canvasEntityKey(group.ref.source))
    if (source === undefined)
      throw new CanvasSchemaError("creation-group-source-missing", `Creation group ${groupId} source is absent`)
    const creatorIds = new Set(
      group.members.map((member) =>
        member.kind === "node"
          ? nodes.get(canvasEntityKey(member))?.identity.createdBy
          : edges.get(canvasEntityKey(member))?.identity.createdBy,
      ),
    )
    if (creatorIds.size !== 1 || creatorIds.has(undefined))
      throw new CanvasSchemaError("creation-group-creator-mismatch", `Creation group ${groupId} spans creators`)
    const creator = [...creatorIds][0]
    const receipt = [...operations.values()].find((candidate) => candidate.operationId === creator)
    if (
      receipt === undefined ||
      receipt.resultEntities.length !== group.members.length ||
      receipt.resultEntities.some(
        (member, index) => canvasEntityKey(member) !== canvasEntityKey(group.members[index]!),
      )
    ) {
      throw new CanvasSchemaError(
        "creation-group-receipt-mismatch",
        `Creation group ${groupId} is not the creator's complete result set`,
      )
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (groupId: string): void => {
    if (visiting.has(groupId))
      throw new CanvasSchemaError("creation-group-source-cycle", "Creation-group source cycle is invalid")
    if (visited.has(groupId)) return
    visiting.add(groupId)
    const group = groups.get(groupId)
    const parent = group === undefined ? undefined : groupByNode.get(canvasEntityKey(group.ref.source))
    if (parent !== undefined) visit(parent)
    visiting.delete(groupId)
    visited.add(groupId)
  }
  for (const groupId of groups.keys()) visit(groupId)
}

function validateSemanticHistory(
  history: ReadonlyMap<string, CanvasCanonicalSemanticHistoryValue>,
  operations: ReadonlyMap<string, BoundedOperationReceipt>,
): void {
  const roots = new Map<string, SemanticHistoryRoot>()
  for (const [key, value] of history) {
    const expected =
      value.format === "convax.canvas-semantic-history-root"
        ? `root/${value.rootOperationId}`
        : `transition/${value.rootOperationId}/actor/${value.stamp.actorId}/operation/${value.transitionOperationId}`
    if (key !== expected)
      throw new CanvasSchemaError("history-key-mismatch", `Semantic history key ${key} is invalid`)
    if (value.format === "convax.canvas-semantic-history-root") {
      assertCanvasHistoryTemplateSchedule(value.inverseTemplate, value.initialBindings)
      assertCanvasHistoryTemplateSchedule(value.forwardTemplate, value.initialBindings)
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
      throw new CanvasSchemaError(
        "history-receipt-mismatch",
        `Semantic history root ${root.rootOperationId} does not bind its receipt`,
      )
    }
  }
  for (const value of history.values()) {
    if (value.format === "convax.canvas-semantic-history-transition" && !roots.has(value.rootOperationId)) {
      throw new CanvasSchemaError(
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
): CanvasActorSlotEntries<T> {
  const entries: [import("@convax/collaboration").ActorId, T][] = []
  for (const [actor, value] of map.entries()) {
    const actorId = parseActorId(actor)
    validate(value)
    const embeddedActor = tombstone
      ? (value as TombstoneFact).stamp.actorId
      : (value as StampedClaim<unknown>).stamp.actorId
    if (embeddedActor !== actorId)
      throw new CanvasSchemaError("actor-slot-mismatch", `Actor slot ${actor} disagrees with embedded stamp`)
    entries.push([actorId, value])
  }
  entries.sort((left, right) => compareDecodedBase64url(left[0], right[0]))
  return entries
}

function mapEntries<K extends string, V, O = V>(
  map: ReadonlyMap<K, V>,
  convert?: (value: V) => O,
): CanvasCanonicalMapEntries<K, O> {
  return [...map.entries()]
    .sort((left, right) => compareUtf8(left[0], right[0]))
    .map(([key, value]) => [key, convert === undefined ? (value as unknown as O) : convert(value)] as const)
}

function assertMapKeys(map: Y.Map<unknown>, keys: readonly string[], label: string): void {
  if (map.size !== keys.length)
    throw new CanvasSchemaError("closed-map-mismatch", `${label} has missing or unknown keys`)
  for (const key of keys)
    if (!map.has(key)) throw new CanvasSchemaError("closed-map-mismatch", `${label}.${key} is required`)
}

function asMap(value: unknown, label: string): Y.Map<unknown> {
  if (!(value instanceof Y.Map)) throw new CanvasSchemaError("invalid-y-type", `${label} must be a Y.Map`)
  return value
}

function assertNullableText(value: unknown): asserts value is string | null {
  if (
    value !== null &&
    (typeof value !== "string" ||
      value.normalize("NFC") !== value ||
      new TextEncoder().encode(value).length > 64 * 1024)
  )
    throw new CanvasSchemaError("invalid-string", "Metadata string is invalid")
}

function assertTags(value: unknown): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > 128)
    throw new CanvasSchemaError("invalid-tags", "Tags must be an array of at most 128 entries")
  let prior: string | undefined
  for (const tag of value) {
    if (typeof tag !== "string" || tag.normalize("NFC") !== tag || new TextEncoder().encode(tag).length > 256)
      throw new CanvasSchemaError("invalid-tags", "Tag is invalid")
    if (prior !== undefined && compareUtf8(prior, tag) >= 0)
      throw new CanvasSchemaError("invalid-tags", "Tags must be UTF-8 sorted and duplicate-free")
    prior = tag
  }
}

function assertNullablePlugin(value: unknown): asserts value is PluginStateEnvelope | null {
  if (value !== null) assertPluginState(value)
}

// Keeps these imports part of the closed canonical-state implementation instead of
// allowing them to silently drift into renderer-only declarations.
void (null as unknown as
  | CanvasPoint
  | CanvasSize
  | NodeDataEnvelope
  | CanvasEdgeData
  | CanvasNodeIdentity
  | CanvasEdgeIdentity
  | StampedClaim<unknown>
  | TombstoneFact
  | SemanticHistoryRoot
  | SemanticHistoryTransition)
