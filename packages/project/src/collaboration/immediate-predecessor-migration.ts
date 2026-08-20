import {
  canonicalStateDigest,
  causalFrontierDigest,
  comparePortableStamps,
  encodeRestrictedJcs,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parsePortableStamp,
  parseProjectId,
  parseUint32,
  parseUint64,
  replicaIdToYjsClientId,
  structuredDigest,
  type ActorId,
  type CanvasId,
  type Digest,
  type DocumentScope,
  type Id128,
  type ReplicaId,
  type PortableStamp,
} from "@convax/collaboration"
import { IMMEDIATE_PREDECESSOR_PROTOCOL } from "@convax/collaboration/migration"
import * as Y from "yjs"

import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  PROJECT_INDEX_ROOT_KEYS,
  PROJECT_INDEX_ROOT_NAME,
  projectIndexRecordDigest,
  validateProjectIndexYDoc,
  type CanvasRouteActivation,
  type CanvasRouteStage,
  type CanvasRouteTombstone,
  type ProjectIndexIdentityRecord,
  type ProjectIndexScope,
} from "./project-index"

export interface MigratedCanvasGenesisBinding {
  readonly checkpointObjectDigest: Digest
  readonly fullUpdateDigest: Digest
  readonly stateVectorDigest: Digest
}

interface ImmediatePredecessorRouteProjection {
  readonly canvasId: CanvasId
  readonly state: "staged" | "live" | "tombstoned"
  readonly currentShardEpoch: Id128 | null
  readonly currentTitle: string | null
}

interface ImmediatePredecessorCanvasRouteActivation {
  readonly format: "convax.canvas-route-activation"
  readonly transitionId: `cr_${string}`
  readonly canvasId: CanvasId
  readonly shardEpoch: Id128
  readonly predecessorActivationDigest: null
  readonly stageRecordDigest: Digest
  readonly projectIndexRouteDependencyFrameDigest: Digest
  readonly canvasGenesisCheckpointObjectDigest: Digest
  readonly stagedProjectIndexFrontierDigest: Digest
  readonly stamp: PortableStamp
}

interface ImmediatePredecessorCanvasRouteMetadata {
  readonly format: "convax.canvas-route-metadata"
  readonly transitionId: `cr_${string}`
  readonly canvasId: CanvasId
  readonly title: string
  readonly observedActivationDigest: Digest
  readonly stamp: PortableStamp
}

interface ImmediatePredecessorCanvasRouteReset {
  readonly format: "convax.canvas-route-reset-commit"
  readonly transitionId: `cr_${string}`
  readonly canvasId: CanvasId
  readonly oldShardEpoch: Id128
  readonly newShardEpoch: Id128
  readonly predecessorActivationDigest: Digest
  readonly stagedGenesisCheckpointObjectDigest: Digest
  readonly stagedGenesisFullUpdateDigest: Digest
  readonly stagedGenesisStateVectorDigest: Digest
  readonly resetClaimCoreDigest: Digest
  readonly confirmationCoreDigest: Digest
  readonly approvalCoreDigest: Digest
  readonly routeCasCoreDigest: Digest
  readonly stamp: PortableStamp
}

type ImmediatePredecessorRouteFact = CanvasRouteStage | ImmediatePredecessorCanvasRouteActivation |
  ImmediatePredecessorCanvasRouteMetadata | ImmediatePredecessorCanvasRouteReset | CanvasRouteTombstone

type ImmediatePredecessorProjectIndexIdentityRecord = Omit<
  ProjectIndexIdentityRecord,
  "migrationImportBaseProofDigest"
>

export interface ImmediatePredecessorProjectIndexCanvasInventory {
  readonly liveScopes: readonly (DocumentScope & { readonly docKind: "canvas" })[]
  readonly historicalScopes: readonly (DocumentScope & { readonly docKind: "canvas" })[]
}

/** Exact live/retired inventory derived only from the verified predecessor PI route history. */
export function inspectImmediatePredecessorProjectIndexCanvasInventory(input: {
  readonly predecessorDocument: Y.Doc
  readonly predecessorScope: DocumentScope
  readonly currentProtocolDigest: Digest
  readonly currentUriProtocolDigest: Digest
  readonly checkpointAuthorReplicaId: ReplicaId
}): ImmediatePredecessorProjectIndexCanvasInventory {
  if (input.predecessorScope.docKind !== "project-index" || input.predecessorScope.docId !== "project-index") {
    throw new TypeError("Immediate-predecessor ProjectIndex scope is invalid")
  }
  const predecessorIdentity = readImmediatePredecessorIdentity(
    input.predecessorDocument,
    input.predecessorScope,
  )
  const document = createFreshProjectIndexDocument(
    input.predecessorDocument,
    Object.freeze({
      ...predecessorIdentity,
      protocolDigest: parseDigest(input.currentProtocolDigest),
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: parseDigest(input.currentUriProtocolDigest),
      migrationImportBaseProofDigest: null,
    }),
    input.checkpointAuthorReplicaId,
    false,
  )
  try {
    const scope = input.predecessorScope as ProjectIndexScope
    validateProjectIndexYDoc(document, scope)
    const routeInventory = readImmediatePredecessorRouteInventory(input.predecessorDocument)
    const liveScopes: Array<DocumentScope & { readonly docKind: "canvas" }> = []
    for (const projection of routeInventory.projections) {
      if (projection.state !== "live" || projection.currentShardEpoch === null) continue
      liveScopes.push(Object.freeze({
        projectId: scope.projectId,
        projectEpoch: scope.projectEpoch,
        docKind: "canvas",
        docId: projection.canvasId,
        shardEpoch: projection.currentShardEpoch,
      }))
    }
    const historicalScopes = routeInventory.historical.map(({ canvasId, shardEpoch }) => Object.freeze({
      projectId: scope.projectId,
      projectEpoch: scope.projectEpoch,
      docKind: "canvas" as const,
      docId: canvasId,
      shardEpoch,
    }))
    return Object.freeze({
      liveScopes: Object.freeze(liveScopes),
      historicalScopes: Object.freeze(historicalScopes),
    })
  } finally {
    document.destroy()
  }
}

export function rebuildImmediatePredecessorProjectIndexDocument(input: {
  readonly predecessorDocument: Y.Doc
  readonly predecessorScope: DocumentScope
  readonly currentScope: DocumentScope
  readonly currentProtocolDigest: Digest
  readonly currentUriProtocolDigest: Digest
  readonly checkpointAuthorReplicaId: ReplicaId
  readonly migrationActorId: ActorId
  readonly migrationOperationId: Id128
  readonly migrationImportBaseProofDigest: Digest
  readonly canvasGenesisByCanvasId: ReadonlyMap<string, MigratedCanvasGenesisBinding>
}): Readonly<{ predecessorCanonicalStateDigest: Digest; currentDocument: Y.Doc }> {
  const predecessorIdentity = readImmediatePredecessorIdentity(input.predecessorDocument, input.predecessorScope)
  if (
    input.currentScope.docKind !== "project-index" || input.currentScope.docId !== "project-index" ||
    input.currentScope.projectId !== predecessorIdentity.projectId ||
    input.currentScope.projectEpoch !== predecessorIdentity.projectEpoch ||
    input.currentScope.shardEpoch !== predecessorIdentity.shardEpoch
  ) throw new TypeError("Immediate-predecessor migration must preserve the ProjectIndex scope")
  const currentScope = input.currentScope as ProjectIndexScope

  const currentIdentity: ProjectIndexIdentityRecord = Object.freeze({
    ...predecessorIdentity,
    protocolDigest: parseDigest(input.currentProtocolDigest),
    schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    uriProtocolDigest: parseDigest(input.currentUriProtocolDigest),
    migrationImportBaseProofDigest: parseDigest(input.migrationImportBaseProofDigest),
  })
  const currentDocument = createFreshProjectIndexDocument(input.predecessorDocument, currentIdentity, input.checkpointAuthorReplicaId)
  try {
    validateProjectIndexYDoc(currentDocument, currentScope)
    const predecessorCanonicalStateDigest = canonicalStateDigest(
      IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest,
      encodeRestrictedJcs(extractImmediatePredecessorCanonicalState(input.predecessorDocument, predecessorIdentity)),
    )
    collapseCurrentRouteFacts(currentDocument, {
      actorId: parseActorId(input.migrationActorId),
      operationId: parseId128(input.migrationOperationId),
      migrationImportBaseProofDigest: parseDigest(input.migrationImportBaseProofDigest),
      canvasGenesisByCanvasId: input.canvasGenesisByCanvasId,
      predecessorRouteProjections: readImmediatePredecessorRouteInventory(input.predecessorDocument).projections,
    })
    validateProjectIndexYDoc(currentDocument, currentScope)
    return Object.freeze({ predecessorCanonicalStateDigest, currentDocument })
  } catch (error) {
    currentDocument.destroy()
    throw error
  }
}

/** Migration-only owner projection used while replaying verified predecessor frames. */
export function immediatePredecessorProjectIndexCanonicalStateDigest(input: {
  readonly predecessorDocument: Y.Doc
  readonly predecessorScope: DocumentScope
  readonly currentProtocolDigest: Digest
  readonly currentUriProtocolDigest: Digest
  readonly checkpointAuthorReplicaId: ReplicaId
}): Digest {
  if (input.predecessorScope.docKind !== "project-index" || input.predecessorScope.docId !== "project-index") {
    throw new TypeError("Immediate-predecessor ProjectIndex scope is invalid")
  }
  const predecessorScope = input.predecessorScope as ProjectIndexScope
  const predecessorIdentity = readImmediatePredecessorIdentity(
    input.predecessorDocument,
    predecessorScope,
  )
  return canonicalStateDigest(
    IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest,
    encodeRestrictedJcs(extractImmediatePredecessorCanonicalState(input.predecessorDocument, predecessorIdentity)),
  )
}

function readImmediatePredecessorIdentity(
  document: Y.Doc,
  scope: DocumentScope,
): ImmediatePredecessorProjectIndexIdentityRecord {
  const root = document.share.get(PROJECT_INDEX_ROOT_NAME)
  if (!(root instanceof Y.Map)) throw new TypeError("Immediate-predecessor ProjectIndex root is missing")
  const identityMap = root.get("identity")
  if (!(identityMap instanceof Y.Map) || identityMap.size !== 1) throw new TypeError("Immediate-predecessor ProjectIndex identity is missing")
  const identity = identityMap.get("project") as ImmediatePredecessorProjectIndexIdentityRecord
  if (
    identity?.format !== "convax.project-index-identity" || identity.schema !== "convax.project-index.v2" ||
    parseProjectId(identity.projectId) !== scope.projectId || parseId128(identity.projectEpoch) !== scope.projectEpoch ||
    parseId128(identity.shardEpoch) !== scope.shardEpoch ||
    parseDigest(identity.protocolDigest) !== IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest ||
    parseDigest(identity.schemaDigest) !== IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest ||
    parseDigest(identity.uriProtocolDigest) !== IMMEDIATE_PREDECESSOR_PROTOCOL.uriProtocolDigest
  ) throw new TypeError("ProjectIndex identity is not the sealed immediate predecessor")
  return Object.freeze({ ...identity })
}

function createFreshProjectIndexDocument(
  source: Y.Doc,
  identity: ProjectIndexIdentityRecord,
  authorReplicaId: ReplicaId,
  copyRoutes = false,
): Y.Doc {
  const sourceRoot = source.share.get(PROJECT_INDEX_ROOT_NAME)
  if (!(sourceRoot instanceof Y.Map)) throw new TypeError("Immediate-predecessor ProjectIndex root is missing")
  const document = new Y.Doc()
  document.clientID = replicaIdToYjsClientId(authorReplicaId)
  document.transact(() => {
    const root = document.getMap(PROJECT_INDEX_ROOT_NAME)
    for (const key of PROJECT_INDEX_ROOT_KEYS) {
      const next = new Y.Map<unknown>()
      if (key === "identity") next.set("project", clonePlain(identity))
      else {
        const prior = sourceRoot.get(key)
        if (!(prior instanceof Y.Map)) throw new TypeError(`Immediate-predecessor ProjectIndex ${key} is not a map`)
        for (const [factKey, value] of key === "canvasRoutes" && !copyRoutes ? [] : prior.entries()) {
          if (value instanceof Y.AbstractType) throw new TypeError(`Immediate-predecessor ProjectIndex ${key} contains nested Yjs state`)
          next.set(factKey, clonePlain(value))
        }
      }
      root.set(key, next)
    }
  }, "project-index-immediate-predecessor-migration")
  return document
}

function extractImmediatePredecessorCanonicalState(
  document: Y.Doc,
  identity: ImmediatePredecessorProjectIndexIdentityRecord,
) {
  const root = document.share.get(PROJECT_INDEX_ROOT_NAME)
  if (!(root instanceof Y.Map)) throw new TypeError("Immediate-predecessor ProjectIndex root is missing")
  const entries = (key: Exclude<(typeof PROJECT_INDEX_ROOT_KEYS)[number], "identity">) => {
    const map = root.get(key)
    if (!(map instanceof Y.Map)) throw new TypeError(`Immediate-predecessor ProjectIndex ${key} is not a map`)
    return Object.freeze([...map.entries()].map(([entryKey, value]) => {
      if (value instanceof Y.AbstractType) throw new TypeError(`Immediate-predecessor ProjectIndex ${key} contains nested Yjs state`)
      return Object.freeze([entryKey, clonePlain(value)] as const)
    }).sort((left, right) => Buffer.compare(Buffer.from(left[0]), Buffer.from(right[0]))))
  }
  return Object.freeze({
    format: "convax.project-index-canonical-state" as const,
    identity: Object.freeze([["project", identity] as const]),
    entries: entries("entries"),
    entryLocations: entries("entryLocations"),
    entryTombstones: entries("entryTombstones"),
    contentFamilies: entries("contentFamilies"),
    contentConflictCopies: entries("contentConflictCopies"),
    pathReservations: entries("pathReservations"),
    canvasRoutes: entries("canvasRoutes"),
    operations: entries("operations"),
  })
}

function readImmediatePredecessorRouteInventory(document: Y.Doc): Readonly<{
  projections: readonly ImmediatePredecessorRouteProjection[]
  historical: readonly Readonly<{ canvasId: CanvasId; shardEpoch: Id128 }>[]
}> {
  const root = document.share.get(PROJECT_INDEX_ROOT_NAME)
  const routes = root instanceof Y.Map ? root.get("canvasRoutes") : undefined
  if (!(routes instanceof Y.Map)) throw new TypeError("Immediate-predecessor ProjectIndex Canvas routes are missing")
  const grouped = new Map<CanvasId, ImmediatePredecessorRouteFact[]>()
  const historical = new Map<string, Readonly<{ canvasId: CanvasId; shardEpoch: Id128 }>>()
  for (const [key, raw] of routes.entries()) {
    const fact = parseImmediatePredecessorRouteFact(raw)
    if (key !== `r:${fact.canvasId}:${fact.transitionId}`) throw new TypeError("Immediate-predecessor Canvas route key mismatches")
    const list = grouped.get(fact.canvasId) ?? []
    list.push(fact)
    grouped.set(fact.canvasId, list)
    const retain = (shardEpoch: Id128) => historical.set(`${fact.canvasId}\0${shardEpoch}`, Object.freeze({
      canvasId: fact.canvasId,
      shardEpoch,
    }))
    if (fact.format === "convax.canvas-route-stage" || fact.format === "convax.canvas-route-activation") retain(fact.shardEpoch)
    if (fact.format === "convax.canvas-route-reset-commit") {
      retain(fact.oldShardEpoch)
      retain(fact.newShardEpoch)
    }
  }
  const projections = [...grouped.entries()]
    .map(([canvasId, facts]) => projectImmediatePredecessorRoute(canvasId, facts))
    .sort((left, right) => String(left.canvasId).localeCompare(String(right.canvasId)))
  return Object.freeze({
    projections: Object.freeze(projections),
    historical: Object.freeze([...historical.values()].sort((left, right) =>
      `${left.canvasId}\0${left.shardEpoch}`.localeCompare(`${right.canvasId}\0${right.shardEpoch}`))),
  })
}

function projectImmediatePredecessorRoute(
  canvasId: CanvasId,
  facts: readonly ImmediatePredecessorRouteFact[],
): ImmediatePredecessorRouteProjection {
  const tombstone = maxImmediatePredecessorStamp(facts.filter(
    (fact): fact is CanvasRouteTombstone => fact.format === "convax.canvas-route-tombstone",
  ))
  if (tombstone) return Object.freeze({ canvasId, state: "tombstoned", currentShardEpoch: null, currentTitle: null })
  const stages = facts.filter((fact): fact is CanvasRouteStage => fact.format === "convax.canvas-route-stage")
  if (stages.length !== 1) throw new TypeError("Immediate-predecessor Canvas route must contain exactly one stage")
  const stage = stages[0]!
  const stageDigest = projectIndexRecordDigest(stage)
  const activations = facts.filter(
    (fact): fact is ImmediatePredecessorCanvasRouteActivation => fact.format === "convax.canvas-route-activation",
  )
  for (const activation of activations) {
    if (activation.stageRecordDigest !== stageDigest || activation.shardEpoch !== stage.shardEpoch) {
      throw new TypeError("Immediate-predecessor Canvas activation does not bind its stage")
    }
  }
  const resets = facts.filter(
    (fact): fact is ImmediatePredecessorCanvasRouteReset => fact.format === "convax.canvas-route-reset-commit",
  )
  const transitions = new Map<Digest, ImmediatePredecessorCanvasRouteActivation | ImmediatePredecessorCanvasRouteReset>()
  for (const transition of [...activations, ...resets]) transitions.set(projectIndexRecordDigest(transition), transition)
  for (const reset of resets) {
    const predecessor = transitions.get(reset.predecessorActivationDigest)
    const predecessorEpoch = predecessor?.format === "convax.canvas-route-activation"
      ? predecessor.shardEpoch
      : predecessor?.newShardEpoch
    if (!predecessor || predecessorEpoch !== reset.oldShardEpoch || reset.oldShardEpoch === reset.newShardEpoch) {
      throw new TypeError("Immediate-predecessor Canvas reset does not bind its transition ancestry")
    }
  }
  const current = maxImmediatePredecessorStamp([...activations, ...resets])
  if (!current) return Object.freeze({ canvasId, state: "staged", currentShardEpoch: stage.shardEpoch, currentTitle: stage.title })
  const ancestry = immediatePredecessorRouteAncestry(current, transitions, stageDigest)
  const metadata = maxImmediatePredecessorStamp(facts.filter(
    (fact): fact is ImmediatePredecessorCanvasRouteMetadata =>
      fact.format === "convax.canvas-route-metadata" && ancestry.has(fact.observedActivationDigest),
  ))
  return Object.freeze({
    canvasId,
    state: "live",
    currentShardEpoch: current.format === "convax.canvas-route-activation" ? current.shardEpoch : current.newShardEpoch,
    currentTitle: metadata?.title ?? stage.title,
  })
}

function immediatePredecessorRouteAncestry(
  head: ImmediatePredecessorCanvasRouteActivation | ImmediatePredecessorCanvasRouteReset,
  transitions: ReadonlyMap<Digest, ImmediatePredecessorCanvasRouteActivation | ImmediatePredecessorCanvasRouteReset>,
  stageDigest: Digest,
): ReadonlySet<Digest> {
  const seen = new Set<Digest>([stageDigest])
  let current: ImmediatePredecessorCanvasRouteActivation | ImmediatePredecessorCanvasRouteReset | undefined = head
  while (current) {
    const digest = projectIndexRecordDigest(current)
    if (seen.has(digest)) throw new TypeError("Immediate-predecessor Canvas route ancestry contains a cycle")
    seen.add(digest)
    if (current.format === "convax.canvas-route-activation") return seen
    current = transitions.get(current.predecessorActivationDigest)
  }
  throw new TypeError("Immediate-predecessor Canvas route ancestry does not reach activation")
}

function maxImmediatePredecessorStamp<T extends { readonly stamp: PortableStamp }>(values: readonly T[]): T | null {
  return [...values].sort((left, right) => comparePortableStamps(left.stamp, right.stamp)).at(-1) ?? null
}

function parseImmediatePredecessorRouteFact(value: unknown): ImmediatePredecessorRouteFact {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Immediate-predecessor Canvas route is invalid")
  const record = value as Record<string, unknown>
  const common = () => {
    const transitionId = String(record.transitionId)
    if (!/^cr_[0-9a-f]{64}$/u.test(transitionId)) throw new TypeError("Immediate-predecessor route transition id is invalid")
    return Object.freeze({
      transitionId: transitionId as `cr_${string}`,
      canvasId: parseCanvasId(record.canvasId),
      stamp: parsePortableStamp(record.stamp),
    })
  }
  const exact = (keys: readonly string[]) => {
    if (Object.keys(record).sort().join("\0") !== [...keys].sort().join("\0")) throw new TypeError("Immediate-predecessor route fields are invalid")
  }
  if (record.format === "convax.canvas-route-stage") {
    exact(["format", "transitionId", "canvasId", "shardEpoch", "title", "reason", "stamp"])
    if (typeof record.title !== "string" || record.title.length < 1 || record.reason !== "create") throw new TypeError("Immediate-predecessor route stage is invalid")
    return Object.freeze({ format: record.format, ...common(), shardEpoch: parseId128(record.shardEpoch), title: record.title, reason: "create" })
  }
  if (record.format === "convax.canvas-route-activation") {
    exact(["format", "transitionId", "canvasId", "shardEpoch", "predecessorActivationDigest", "stageRecordDigest", "projectIndexRouteDependencyFrameDigest", "canvasGenesisCheckpointObjectDigest", "stagedProjectIndexFrontierDigest", "stamp"])
    if (record.predecessorActivationDigest !== null) throw new TypeError("Immediate-predecessor initial activation predecessor is invalid")
    return Object.freeze({ format: record.format, ...common(), shardEpoch: parseId128(record.shardEpoch), predecessorActivationDigest: null, stageRecordDigest: parseDigest(record.stageRecordDigest), projectIndexRouteDependencyFrameDigest: parseDigest(record.projectIndexRouteDependencyFrameDigest), canvasGenesisCheckpointObjectDigest: parseDigest(record.canvasGenesisCheckpointObjectDigest), stagedProjectIndexFrontierDigest: parseDigest(record.stagedProjectIndexFrontierDigest) })
  }
  if (record.format === "convax.canvas-route-metadata") {
    exact(["format", "transitionId", "canvasId", "title", "observedActivationDigest", "stamp"])
    if (typeof record.title !== "string" || record.title.length < 1) throw new TypeError("Immediate-predecessor route metadata is invalid")
    return Object.freeze({ format: record.format, ...common(), title: record.title, observedActivationDigest: parseDigest(record.observedActivationDigest) })
  }
  if (record.format === "convax.canvas-route-reset-commit") {
    exact(["format", "transitionId", "canvasId", "oldShardEpoch", "newShardEpoch", "predecessorActivationDigest", "stagedGenesisCheckpointObjectDigest", "stagedGenesisFullUpdateDigest", "stagedGenesisStateVectorDigest", "resetClaimCoreDigest", "confirmationCoreDigest", "approvalCoreDigest", "routeCasCoreDigest", "stamp"])
    return Object.freeze({ format: record.format, ...common(), oldShardEpoch: parseId128(record.oldShardEpoch), newShardEpoch: parseId128(record.newShardEpoch), predecessorActivationDigest: parseDigest(record.predecessorActivationDigest), stagedGenesisCheckpointObjectDigest: parseDigest(record.stagedGenesisCheckpointObjectDigest), stagedGenesisFullUpdateDigest: parseDigest(record.stagedGenesisFullUpdateDigest), stagedGenesisStateVectorDigest: parseDigest(record.stagedGenesisStateVectorDigest), resetClaimCoreDigest: parseDigest(record.resetClaimCoreDigest), confirmationCoreDigest: parseDigest(record.confirmationCoreDigest), approvalCoreDigest: parseDigest(record.approvalCoreDigest), routeCasCoreDigest: parseDigest(record.routeCasCoreDigest) })
  }
  if (record.format === "convax.canvas-route-tombstone") {
    exact(["format", "transitionId", "canvasId", "observedActivationDigest", "reason", "stamp"])
    if (record.reason !== "explicit-delete") throw new TypeError("Immediate-predecessor route tombstone is invalid")
    return Object.freeze({ format: record.format, ...common(), observedActivationDigest: record.observedActivationDigest === null ? null : parseDigest(record.observedActivationDigest), reason: "explicit-delete" })
  }
  throw new TypeError("Immediate-predecessor Canvas route format is invalid")
}

function collapseCurrentRouteFacts(
  document: Y.Doc,
  input: {
    readonly actorId: ActorId
    readonly operationId: Id128
    readonly migrationImportBaseProofDigest: Digest
    readonly canvasGenesisByCanvasId: ReadonlyMap<string, MigratedCanvasGenesisBinding>
    readonly predecessorRouteProjections: readonly ImmediatePredecessorRouteProjection[]
  },
): void {
  const root = document.share.get(PROJECT_INDEX_ROOT_NAME) as unknown as Y.Map<unknown>
  const routes = root.get("canvasRoutes")
  if (!(routes instanceof Y.Map)) throw new TypeError("Migrated ProjectIndex route map is missing")
  const canvasIds = new Set(input.predecessorRouteProjections.map((projection) => projection.canvasId))
  document.transact(() => {
    routes.clear()
    for (const canvasId of [...canvasIds].sort()) {
      const projection = input.predecessorRouteProjections.find((item) => item.canvasId === canvasId)
      if (!projection) throw new TypeError("Immediate-predecessor Canvas route projection disappeared")
      const transition = (kind: "stage" | "activation" | "tombstone") =>
        `cr_${structuredDigest("convax.project-index-immediate-predecessor-route-import", {
          format: "convax.project-index-immediate-predecessor-route-import",
          canvasId,
          kind,
          migrationImportBaseProofDigest: input.migrationImportBaseProofDigest,
        })}` as const
      const stamp = (lamport: "0" | "1") => Object.freeze({
        format: "convax.portable-stamp" as const,
        lamport: parseUint64(lamport),
        actorId: input.actorId,
        operationId: input.operationId,
        writeOrdinal: parseUint32(lamport),
      })
      if (projection.state === "tombstoned") {
        if (input.canvasGenesisByCanvasId.has(canvasId)) {
          throw new TypeError("Tombstoned Canvas unexpectedly has a migrated genesis")
        }
        const tombstone: CanvasRouteTombstone = Object.freeze({
          format: "convax.canvas-route-tombstone",
          transitionId: transition("tombstone"),
          canvasId,
          observedActivationDigest: null,
          reason: "explicit-delete",
          stamp: stamp("0"),
        })
        routes.set(`r:${canvasId}:${tombstone.transitionId}`, clonePlain(tombstone))
        continue
      }
      if (projection.currentShardEpoch === null || projection.currentTitle === null) {
        throw new TypeError("Immediate-predecessor Canvas route projection is incomplete")
      }
      const stage: CanvasRouteStage = Object.freeze({
        format: "convax.canvas-route-stage",
        transitionId: transition("stage"),
        canvasId,
        shardEpoch: projection.currentShardEpoch,
        title: projection.currentTitle,
        reason: "create",
        stamp: stamp("0"),
      })
      routes.set(`r:${canvasId}:${stage.transitionId}`, clonePlain(stage))
      if (projection.state === "staged") {
        if (input.canvasGenesisByCanvasId.has(canvasId)) {
          throw new TypeError("Staged Canvas unexpectedly has a migrated genesis")
        }
        continue
      }
      const binding = input.canvasGenesisByCanvasId.get(canvasId)
      if (!binding) throw new TypeError("Live Canvas lacks its migrated current genesis")
      const activation: CanvasRouteActivation = Object.freeze({
        format: "convax.canvas-route-activation",
        transitionId: transition("activation"),
        canvasId,
        shardEpoch: projection.currentShardEpoch,
        predecessorActivationDigest: null,
        stageRecordDigest: projectIndexRecordDigest(stage),
        projectIndexRouteDependency: Object.freeze({
          kind: "migration-import-base",
          digest: input.migrationImportBaseProofDigest,
        }),
        canvasGenesisCheckpointObjectDigest: parseDigest(binding.checkpointObjectDigest),
        stagedProjectIndexFrontierDigest: causalFrontierDigest(Object.freeze({
          format: "convax.causal-frontier",
          heads: Object.freeze([]),
        })),
        stamp: stamp("1"),
      })
      routes.set(`r:${canvasId}:${activation.transitionId}`, clonePlain(activation))
    }
  }, "project-index-migration-route-genesis-rebind")

  for (const canvasId of input.canvasGenesisByCanvasId.keys()) {
    if (!canvasIds.has(canvasId as CanvasId)) throw new TypeError("Migrated Canvas is absent from ProjectIndex")
  }
}

function clonePlain<T>(value: T): T {
  return JSON.parse(new TextDecoder().decode(encodeRestrictedJcs(value))) as T
}
