import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import {
  assertBoundedNfcString,
  assertDenseArray,
  assertExactKeys,
  compareBytes,
  compareDecodedBase64url,
  comparePortableStamps,
  compareUtf8,
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  ordinarySha256,
  ownerCanonicalizerDescriptorDigest,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parseMemberId,
  parsePortableStamp,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint32,
  parseUint64,
  structuredDigest,
  type ActualWriteEvidence,
  type ActorId,
  type CanvasId,
  type Digest,
  type DecodedCausalEditFrame,
  type DocumentOwnerProtocolDefinition,
  type DocumentScope,
  type Id128,
  type OwnerApplyResult,
  type OwnerCanonicalizerDescriptor,
  type OwnerExternalFactPort,
  type OwnerExternalFactRequirement,
  type OwnerIntentConstructionContext,
  type OwnerIntentClosureDefinition,
  type OwnerIntentDependencies,
  type OwnerIntentValidationContext,
  type OwnerProcessValueFactory,
  type OwnerValidatedState,
  type PortableStamp,
  type ProjectId,
  type SelectedDocumentOwnerArtifactDefinition,
  type Uint32,
  type Uint64,
} from "@convax/collaboration"
import {
  parseProjectDirectoryId,
  parseProjectEntryId,
  parseProjectFileId,
  type ProjectDirectoryId,
  type ProjectEntryId,
  type ProjectFileId,
} from "@convax/project-files/identity"
export type { ProjectDirectoryId, ProjectFileId, ProjectEntryId } from "@convax/project-files/identity"
import { canonicalize, fromProjectUri, parseProjectUri } from "@convax/uri"
import * as Y from "yjs"
import type {
  CanvasDocumentScope,
  DocumentShardResetApprovalCore,
  DocumentShardResetApproval,
  DocumentShardResetClaimCore,
  DocumentShardResetClaim,
  DocumentShardResetConfirmationCore,
  DocumentShardResetConfirmation,
  DocumentShardResetReason,
  DocumentShardResetRouteCasCore,
} from "../collaboration-protocol/reset-contracts"

export const PROJECT_INDEX_ROOT_NAME = "convax.project-index.v2"
export const PROJECT_INDEX_ROOT_KEYS = Object.freeze([
  "identity",
  "entries",
  "entryLocations",
  "entryTombstones",
  "contentFamilies",
  "contentConflictCopies",
  "pathReservations",
  "canvasRoutes",
  "operations",
] as const)

export const PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST: Digest = parseDigest(
  "99ebca8cc048f6cf919d55a9829091e2450e59a10b87b5410d9b0243459be37c",
)

const encoder = new TextEncoder()
const RECORD_DOMAIN = encoder.encode("convax.project-index-record-digest\0")
const INTENT_DOMAIN = encoder.encode("convax.project-index-intent-digest\0")
const RESOURCE_REFERENCE_DOMAIN = encoder.encode("convax.project-resource-reference-digest\0")
const DERIVED_DOMAIN = "convax.project-derived-identity" as const
const VERSION = /^pv_[0-9a-f]{64}$/u
const FACT = /^(pl|pt|pp|pr|cr)_[0-9a-f]{64}$/u
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u

export type ProjectVersionId = `pv_${string}`
export type ProjectFactId = `${"pl" | "pt" | "pp" | "pr" | "cr"}_${string}`
export type ProjectIndexScope = DocumentScope & { readonly docKind: "project-index"; readonly docId: "project-index" }

export type ProjectContentPolicy = "none" | "immutable" | "conflict-preserving-text" | "overwritable-binary"
export type ProjectStorageClass = "project-file" | "managed-blob"

export interface ProjectIndexIdentityRecord {
  readonly format: "convax.project-index-identity"
  readonly schema: "convax.project-index.v2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly shardEpoch: Id128
  readonly rootDirectoryId: ProjectDirectoryId
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly uriProtocolDigest: Digest
}

export interface ProjectEntryRecord {
  readonly format: "convax.project-entry"
  readonly entryId: ProjectEntryId
  readonly kind: "file" | "directory"
  readonly storageClass: ProjectStorageClass | null
  readonly contentPolicy: ProjectContentPolicy
  readonly provenance: "project-root" | "user" | "generated" | "managed-admission" | "content-conflict-copy"
  readonly conflictSource: null | {
    readonly primaryFileId: ProjectFileId
    readonly sourceVersionId: ProjectVersionId
    readonly conflictCopyId: ProjectFactId
    readonly reservationId: ProjectFactId
  }
  readonly createdByActorId: ActorId
  readonly createdByOperationId: Id128
  readonly createdStamp: PortableStamp
}

export interface ProjectEntryLocationClaim {
  readonly format: "convax.project-entry-location"
  readonly claimId: ProjectFactId
  readonly entryId: ProjectEntryId
  readonly state: "linked" | "declared-missing"
  readonly parentDirectoryId: ProjectDirectoryId
  readonly basename: string
  readonly reason: "create" | "move" | "rename" | "explicit-relink" | "explicit-missing"
  readonly stamp: PortableStamp
}

export interface ProjectEntryTombstone {
  readonly format: "convax.project-entry-tombstone"
  readonly tombstoneId: ProjectFactId
  readonly entryId: ProjectEntryId
  readonly reason: "explicit-delete"
  readonly observedEntryDigest: Digest
  readonly stamp: PortableStamp
}

export interface ProjectBlobRef {
  readonly format: "convax.blob-ref"
  readonly algorithm: "sha256"
  readonly digest: Digest
  readonly byteLength: Uint64
  readonly mime: string
}

export interface ProjectContentVersionRecord {
  readonly format: "convax.project-content-version"
  readonly primaryFileId: ProjectFileId
  readonly versionId: ProjectVersionId
  readonly writeClass: "initial" | "text-write" | "binary-overwrite"
  readonly blob: ProjectBlobRef
  readonly canonicalRevisionUri: string
  readonly supersedesVersionIds: readonly ProjectVersionId[]
  readonly binaryLogicalCounter: Uint64 | null
  readonly creatorActorId: ActorId
  readonly creatorOperationId: Id128
  readonly stamp: PortableStamp
}

export interface ProjectContentConflictCopyRecord {
  readonly format: "convax.project-content-conflict-copy"
  readonly conflictCopyId: ProjectFactId
  readonly primaryFileId: ProjectFileId
  readonly versionId: ProjectVersionId
  readonly reservedConflictFileId: ProjectFileId
  readonly reservationId: ProjectFactId
  readonly stamp: PortableStamp
}

export interface ProjectIndexResourceReference {
  readonly format: "convax.project-resource-reference"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly entryFileId: ProjectFileId
  readonly familyPrimaryFileId: ProjectFileId
  readonly versionId: ProjectVersionId
  readonly canonicalUri: string
  readonly blob: ProjectBlobRef
  readonly versionRecordDigest: Digest
}

export interface ProjectPathReservationRecord {
  readonly format: "convax.project-path-reservation"
  readonly reservationId: ProjectFactId
  readonly kind: "content-conflict-copy"
  readonly primaryFileId: ProjectFileId
  readonly versionId: ProjectVersionId
  readonly reservedEntryId: ProjectFileId
  readonly canonicalPath: string
  readonly originalBasenameHint: string
  readonly stamp: PortableStamp
}

export interface CanvasRouteStage {
  readonly format: "convax.canvas-route-stage"
  readonly transitionId: ProjectFactId
  readonly canvasId: CanvasId
  readonly shardEpoch: Id128
  readonly title: string
  readonly reason: "create"
  readonly stamp: PortableStamp
}

export interface CanvasRouteActivation {
  readonly format: "convax.canvas-route-activation"
  readonly transitionId: ProjectFactId
  readonly canvasId: CanvasId
  readonly shardEpoch: Id128
  readonly predecessorActivationDigest: null
  readonly stageRecordDigest: Digest
  readonly projectIndexRouteDependencyFrameDigest: Digest
  readonly canvasGenesisCheckpointObjectDigest: Digest
  readonly stagedProjectIndexFrontierDigest: Digest
  readonly stamp: PortableStamp
}

export interface CanvasRouteMetadataClaim {
  readonly format: "convax.canvas-route-metadata"
  readonly transitionId: ProjectFactId
  readonly canvasId: CanvasId
  readonly title: string
  readonly observedActivationDigest: Digest
  readonly stamp: PortableStamp
}

export interface CanvasRouteTombstone {
  readonly format: "convax.canvas-route-tombstone"
  readonly transitionId: ProjectFactId
  readonly canvasId: CanvasId
  readonly observedActivationDigest: Digest | null
  readonly reason: "explicit-delete"
  readonly stamp: PortableStamp
}

export interface CanvasRouteResetCommit {
  readonly format: "convax.canvas-route-reset-commit"
  readonly transitionId: ProjectFactId
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

export type CanvasRouteFact =
  | CanvasRouteStage
  | CanvasRouteActivation
  | CanvasRouteMetadataClaim
  | CanvasRouteResetCommit
  | CanvasRouteTombstone

export type ProjectIndexIntentKind =
  | "project.directory.create"
  | "project.file.create"
  | "project.entry.locate"
  | "project.entry.tombstone"
  | "project.file.write-text"
  | "project.file.overwrite-binary"
  | "project.canvas.route.stage"
  | "project.canvas.route.activate"
  | "project.canvas.route.rename"
  | "project.canvas.route.tombstone"
  | "project.canvas.route.reset"

export interface ProjectOperationReceipt {
  readonly format: "convax.project-operation-receipt"
  readonly actorId: ActorId
  readonly operationId: Id128
  readonly intentKind: ProjectIndexIntentKind
  readonly intentDigest: Digest
  readonly allocatedIds: readonly string[]
  readonly firstWriteOrdinal: Uint32
  readonly writeCount: Uint32
  readonly stampLamport: Uint64
}

export type ProjectGuardAtom =
  | Readonly<{ kind: "entry-absent"; entryId: ProjectEntryId }>
  | Readonly<{ kind: "entry-live"; entryId: ProjectEntryId; entryDigest: Digest }>
  | Readonly<{ kind: "entry-location"; entryId: ProjectEntryId; projectionDigest: Digest }>
  | Readonly<{ kind: "directory-live"; directoryId: ProjectDirectoryId; entryDigest: Digest }>
  | Readonly<{
      kind: "family-live-heads"
      primaryFileId: ProjectFileId
      versionIds: readonly ProjectVersionId[]
      projectionDigest: Digest
    }>
  | Readonly<{
      kind: "route-state"
      canvasId: CanvasId
      state: "absent" | "staged" | "live" | "tombstoned"
      shardEpoch: Id128 | null
      activationDigest: Digest | null
      projectionDigest: Digest
    }>
  | Readonly<{
      kind: "fact-absent"
      map: Exclude<(typeof PROJECT_INDEX_ROOT_KEYS)[number], "identity">
      key: string
    }>

interface IntentBase<K extends ProjectIndexIntentKind, B> {
  readonly format: "convax.typed-intent"
  readonly kind: K
  readonly guards: readonly ProjectGuardAtom[]
  readonly body: B
}

export type ProjectIndexIntent =
  | IntentBase<"project.directory.create", { readonly entry: ProjectEntryRecord; readonly location: ProjectEntryLocationClaim }>
  | IntentBase<"project.file.create", { readonly entry: ProjectEntryRecord; readonly location: ProjectEntryLocationClaim | null; readonly initialVersion: ProjectContentVersionRecord }>
  | IntentBase<"project.entry.locate", { readonly location: ProjectEntryLocationClaim }>
  | IntentBase<"project.entry.tombstone", { readonly tombstone: ProjectEntryTombstone }>
  | IntentBase<"project.file.write-text", { readonly version: ProjectContentVersionRecord; readonly conflictEntry: ProjectEntryRecord; readonly conflictCopy: ProjectContentConflictCopyRecord; readonly reservation: ProjectPathReservationRecord }>
  | IntentBase<"project.file.overwrite-binary", { readonly version: ProjectContentVersionRecord }>
  | IntentBase<"project.canvas.route.stage", { readonly stage: CanvasRouteStage }>
  | IntentBase<"project.canvas.route.activate", { readonly activation: CanvasRouteActivation }>
  | IntentBase<"project.canvas.route.rename", { readonly metadata: CanvasRouteMetadataClaim }>
  | IntentBase<"project.canvas.route.tombstone", { readonly tombstone: CanvasRouteTombstone }>
  | IntentBase<"project.canvas.route.reset", {
      readonly resetCommit: CanvasRouteResetCommit
      readonly routeCasCore: DocumentShardResetRouteCasCore
      readonly resetClaim: DocumentShardResetClaim
      readonly confirmation: DocumentShardResetConfirmation
      readonly approval: DocumentShardResetApproval
    }>

export interface ProjectCanonicalState {
  readonly format: "convax.project-index-canonical-state"
  readonly identity: readonly (readonly [string, ProjectIndexIdentityRecord])[]
  readonly entries: readonly (readonly [string, ProjectEntryRecord])[]
  readonly entryLocations: readonly (readonly [string, ProjectEntryLocationClaim])[]
  readonly entryTombstones: readonly (readonly [string, ProjectEntryTombstone])[]
  readonly contentFamilies: readonly (readonly [string, ProjectContentVersionRecord])[]
  readonly contentConflictCopies: readonly (readonly [string, ProjectContentConflictCopyRecord])[]
  readonly pathReservations: readonly (readonly [string, ProjectPathReservationRecord])[]
  readonly canvasRoutes: readonly (readonly [string, CanvasRouteFact])[]
  readonly operations: readonly (readonly [string, ProjectOperationReceipt])[]
}

export interface ProjectContentFamilyView {
  readonly primaryFileId: ProjectFileId
  readonly contentPolicy: ProjectContentPolicy | null
  readonly versionIds: readonly ProjectVersionId[]
  readonly liveHeadVersionIds: readonly ProjectVersionId[]
  readonly currentVersionId: ProjectVersionId | null
  readonly currentResourceReference: ProjectIndexResourceReference | null
  readonly currentResourceReferenceDigest: Digest | null
  readonly activeConflictFileIds: readonly ProjectFileId[]
}

export type ProjectEntryLocationCause =
  | "entry-absent"
  | "entry-tombstoned"
  | "project-root"
  | "dormant-content-conflict"
  | "managed-blob"
  | "selected-declared-missing"
  | "linked-ordinary"
  | "linked-orphan"
  | "linked-directory-cycle"
  | "linked-path-claim-loser"
  | "linked-under-path-claim-loser"
  | "active-conflict-reservation-no-explicit"
  | "active-conflict-reservation-after-declared-missing"

export interface ProjectEntryLocationOutcomeValue {
  readonly format: "convax.project-entry-location-projection"
  readonly entryId: ProjectEntryId
  readonly entryRecordDigest: Digest | null
  readonly tombstoneRecordDigests: readonly Digest[]
  readonly selectedLocationRecordDigest: Digest | null
  readonly state:
    | "absent"
    | "dormant-conflict"
    | "live-linked"
    | "live-declared-missing"
    | "live-managed-unlocated"
    | "conflict-path"
    | "tombstoned"
  readonly cause: ProjectEntryLocationCause
  readonly portablePath: string | null
  readonly pathClaimWinnerEntryId: ProjectEntryId | null
}

export interface ProjectEntryLocationProjection extends ProjectEntryLocationOutcomeValue {
  readonly resolutionDependencyRecordDigests: readonly Digest[]
}

export interface ProjectConflictProjection {
  readonly format: "convax.project-conflict-projection"
  readonly primaryFileId: ProjectFileId
  readonly sourceVersionId: ProjectVersionId
  readonly sourceVersionRecordDigest: Digest
  readonly conflictCopyRecordDigest: Digest
  readonly reservationRecordDigest: Digest
  readonly reservedEntryId: ProjectFileId
  readonly reservedEntryRecordDigest: Digest
  readonly reservedEntryLocationProjectionDigest: Digest | null
  readonly state: "dormant" | "active-reserved-path" | "active-explicit-path" | "tombstoned"
  readonly cause:
    | "conflict-copy-dormant"
    | "active-reservation-no-explicit"
    | "active-reservation-after-declared-missing"
    | "active-explicit-location"
    | "reserved-entry-tombstoned"
  readonly materializedPath: string | null
}

export interface ProjectContentFamilyProjection {
  readonly format: "convax.project-content-family-projection"
  readonly primaryFileId: ProjectFileId
  readonly primaryEntryRecordDigest: Digest | null
  readonly contentPolicy: ProjectContentPolicy | null
  readonly versions: readonly (readonly [ProjectVersionId, Digest])[]
  readonly liveHeadVersionIds: readonly ProjectVersionId[]
  readonly currentVersionId: ProjectVersionId | null
  readonly activeConflictProjectionDigests: readonly Digest[]
}

export interface ProjectCanvasRouteProjection {
  readonly format: "convax.project-route-projection"
  readonly canvasId: CanvasId
  readonly state: "absent" | "staged" | "live" | "tombstoned"
  readonly stageRecordDigest: Digest | null
  readonly ancestryRecordDigests: readonly Digest[]
  readonly currentActivationDigest: Digest | null
  readonly currentShardEpoch: Id128 | null
  readonly currentTitle: string | null
  readonly currentTitleRecordDigest: Digest | null
  readonly currentTombstoneRecordDigest: Digest | null
}

export interface ProjectIndexProjection {
  readonly identity: ProjectIndexIdentityRecord
  readonly liveEntryIds: readonly ProjectEntryId[]
  readonly tombstonedEntryIds: readonly ProjectEntryId[]
  readonly contentFamilies: readonly ProjectContentFamilyView[]
  readonly canvasRoutes: readonly ProjectCanvasRouteProjection[]
}

export interface ProjectIndexSnapshot {
  readonly identity: ProjectIndexIdentityRecord
  readonly entries: ReadonlyMap<string, ProjectEntryRecord>
  readonly entryLocations: ReadonlyMap<string, ProjectEntryLocationClaim>
  readonly entryTombstones: ReadonlyMap<string, ProjectEntryTombstone>
  readonly contentFamilies: ReadonlyMap<string, ProjectContentVersionRecord>
  readonly contentConflictCopies: ReadonlyMap<string, ProjectContentConflictCopyRecord>
  readonly pathReservations: ReadonlyMap<string, ProjectPathReservationRecord>
  readonly canvasRoutes: ReadonlyMap<string, CanvasRouteFact>
  readonly operations: ReadonlyMap<string, ProjectOperationReceipt>
}

export interface ProjectIndexApplyResult {
  readonly format: "convax.project-index-intent-result"
  readonly intentDigest: Digest
  readonly inserted: readonly { readonly root: Exclude<(typeof PROJECT_INDEX_ROOT_KEYS)[number], "identity">; readonly key: string; readonly record: object }[]
}

export interface ProjectIndexExternalFactContext {
  verifyBlob(versionRecordDigest: Digest, blob: ProjectBlobRef): boolean
  verifyCanvasGenesis(activation: CanvasRouteActivation): boolean
  verifyResetAuthorization(input: Extract<ProjectIndexIntent, { readonly kind: "project.canvas.route.reset" }>["body"]): boolean
}

export class ProjectIndexSchemaError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "ProjectIndexSchemaError"
  }
}

export function projectIndexOwnerCanonicalizerDescriptor(schemaDigest: Digest): OwnerCanonicalizerDescriptor {
  return Object.freeze({
    format: "convax.owner-canonicalizer-descriptor",
    owner: "project-index",
    ownerSchemaDigest: parseDigest(schemaDigest),
    canonicalStateFormat: "convax.project-index-canonical-state",
    canonicalStateCodec: "restricted-jcs-utf8",
    exactBytePolicy: "parse-reencode-byte-equal",
    unknownStatePolicy: "reject",
  })
}

export function createProjectIndexYDoc(identityInput: ProjectIndexIdentityRecord, rootEntryInput: ProjectEntryRecord): Y.Doc {
  const identity = parseIdentity(identityInput)
  const rootEntry = parseEntry(rootEntryInput)
  if (rootEntry.entryId !== identity.rootDirectoryId || rootEntry.provenance !== "project-root" || rootEntry.kind !== "directory") {
    fail("invalid-genesis", "ProjectIndex genesis root directory does not match identity")
  }
  const document = new Y.Doc()
  document.transact(() => {
    const root = document.getMap(PROJECT_INDEX_ROOT_NAME)
    for (const key of PROJECT_INDEX_ROOT_KEYS) root.set(key, new Y.Map<unknown>())
    childMap(root, "identity").set("project", freezeJcs(identity))
    childMap(root, "entries").set(rootEntry.entryId, freezeJcs(rootEntry))
  }, "project-index-genesis-v2")
  validateProjectIndexYDoc(document)
  return document
}

/** Binds only the ProjectIndex-owned root; installed bytes remain the sole state source. */
export function createProjectIndexReconstructionYDoc(): Y.Doc {
  const document = new Y.Doc({ gc: false })
  document.getMap(PROJECT_INDEX_ROOT_NAME)
  return document
}

export function cloneProjectIndexYDoc(document: Y.Doc): Y.Doc {
  validateProjectIndexYDoc(document)
  const clone = new Y.Doc()
  clone.getMap(PROJECT_INDEX_ROOT_NAME)
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(document), "project-index-candidate-clone-v2")
  return clone
}

export function validateProjectIndexYDoc(document: Y.Doc, scope?: ProjectIndexScope): ProjectIndexSnapshot {
  const names = [...document.share.keys()]
  if (names.length !== 1 || names[0] !== PROJECT_INDEX_ROOT_NAME) fail("unknown-root", "ProjectIndex must contain exactly convax.project-index.v2")
  const root = document.share.get(PROJECT_INDEX_ROOT_NAME)
  if (!(root instanceof Y.Map)) fail("invalid-root", "ProjectIndex root is not a Y.Map")
  assertMapKeys(root, PROJECT_INDEX_ROOT_KEYS, "ProjectIndex root")
  const identityMap = childMap(root, "identity")
  if (identityMap.size !== 1 || !identityMap.has("project")) fail("invalid-identity", "ProjectIndex identity must contain only project")
  const identity = parseIdentity(identityMap.get("project"))
  if (scope !== undefined && (scope.docKind !== "project-index" || scope.docId !== "project-index" || scope.projectId !== identity.projectId || scope.projectEpoch !== identity.projectEpoch || scope.shardEpoch !== identity.shardEpoch)) {
    fail("scope-mismatch", "ProjectIndex identity differs from the outer scope")
  }
  const entries = readFactMap(root, "entries", parseEntry, (key, value) => key === value.entryId)
  const entryLocations = readFactMap(root, "entryLocations", parseLocation, (key, value) => key === `l:${value.entryId}:${value.claimId}`)
  const entryTombstones = readFactMap(root, "entryTombstones", parseEntryTombstone, (key, value) => key === `t:${value.entryId}:${value.tombstoneId}`)
  const contentFamilies = readFactMap(root, "contentFamilies", (value) => parseContentVersion(value, identity), (key, value) => key === `v:${value.primaryFileId}:${value.versionId}`)
  const contentConflictCopies = readFactMap(root, "contentConflictCopies", parseConflictCopy, (key, value) => key === `p:${value.primaryFileId}:${value.conflictCopyId}`)
  const pathReservations = readFactMap(root, "pathReservations", parseReservation, (key, value) => key === `x:${value.reservationId}`)
  const canvasRoutes = readFactMap(root, "canvasRoutes", parseCanvasRoute, (key, value) => key === `r:${value.canvasId}:${value.transitionId}`)
  const operations = readFactMap(root, "operations", parseReceipt, (key, value) => key === `o:${value.actorId}:${value.operationId}`)
  const rootEntry = entries.get(identity.rootDirectoryId)
  if (!rootEntry || rootEntry.kind !== "directory" || rootEntry.provenance !== "project-root") fail("invalid-root-entry", "Project root entry is absent or invalid")
  if ([...entryLocations.values()].some((claim) => claim.entryId === identity.rootDirectoryId) || [...entryTombstones.values()].some((fact) => fact.entryId === identity.rootDirectoryId)) {
    fail("invalid-root-entry", "Project root cannot have location or tombstone facts")
  }
  validateRelations({ identity, entries, entryLocations, entryTombstones, contentFamilies, contentConflictCopies, pathReservations, canvasRoutes, operations })
  return Object.freeze({ identity, entries, entryLocations, entryTombstones, contentFamilies, contentConflictCopies, pathReservations, canvasRoutes, operations })
}

export function extractProjectCanonicalState(document: Y.Doc): ProjectCanonicalState {
  const snapshot = validateProjectIndexYDoc(document)
  return Object.freeze({
    format: "convax.project-index-canonical-state",
    identity: Object.freeze([["project", snapshot.identity] as const]),
    entries: canonicalEntries(snapshot.entries),
    entryLocations: canonicalEntries(snapshot.entryLocations),
    entryTombstones: canonicalEntries(snapshot.entryTombstones),
    contentFamilies: canonicalEntries(snapshot.contentFamilies),
    contentConflictCopies: canonicalEntries(snapshot.contentConflictCopies),
    pathReservations: canonicalEntries(snapshot.pathReservations),
    canvasRoutes: canonicalEntries(snapshot.canvasRoutes),
    operations: canonicalEntries(snapshot.operations),
  })
}

export function encodeProjectCanonicalState(document: Y.Doc): Uint8Array {
  return encodeRestrictedJcs(extractProjectCanonicalState(document))
}

export function projectProjectIndex(document: Y.Doc): ProjectIndexProjection {
  return projectProjectIndexSnapshot(validateProjectIndexYDoc(document))
}

/**
 * Exact portable resource roots selected by ProjectIndex. This is the only
 * structural source for blob currentness: native presence, transfer journals and
 * filesystem enumeration must never choose a version.
 */
export function projectIndexCurrentBlobReferences(document: Y.Doc): readonly ProjectIndexResourceReference[] {
  return projectIndexCurrentBlobReferencesFromSnapshot(validateProjectIndexYDoc(document))
}

/**
 * Projects current blob roots from the already owner-validated state exposed by
 * the Collaboration session. Desktop callers never receive the Y.Doc or infer
 * currentness from native files.
 */
export function projectIndexCurrentBlobReferencesFromValidatedOwnerState(
  state: OwnerValidatedState<"project-index">,
): readonly ProjectIndexResourceReference[] {
  const snapshot = projectIndexSnapshotFromValidatedOwnerState(state)
  if (snapshot === null) fail("invalid-owner-state", "ProjectIndex owner returned an invalid validated state")
  return projectIndexCurrentBlobReferencesFromSnapshot(snapshot)
}

function projectIndexCurrentBlobReferencesFromSnapshot(
  snapshot: ProjectIndexSnapshot,
): readonly ProjectIndexResourceReference[] {
  const projection = projectProjectIndexSnapshot(snapshot)
  const references: ProjectIndexResourceReference[] = []
  for (const family of projection.contentFamilies) {
    if (family.currentResourceReference !== null) references.push(family.currentResourceReference)
    for (const conflictFileId of family.activeConflictFileIds) {
      const entry = snapshot.entries.get(conflictFileId)
      const sourceVersionId = entry?.conflictSource?.sourceVersionId
      if (!entry || !sourceVersionId) fail("invalid-conflict-copy", "Active conflict copy lacks its source version")
      const version = snapshot.contentFamilies.get(`v:${family.primaryFileId}:${sourceVersionId}`)
      if (!version) fail("invalid-conflict-copy", "Active conflict copy source version is absent")
      references.push(resourceReference(snapshot.identity, version, conflictFileId))
    }
  }
  return Object.freeze(references.sort((left, right) => {
    const entry = compareUtf8(left.entryFileId, right.entryFileId)
    return entry === 0 ? compareUtf8(left.versionId, right.versionId) : entry
  }))
}

export function projectProjectIndexSnapshot(snapshot: ProjectIndexSnapshot): ProjectIndexProjection {
  const tombstoned = tombstonedEntries(snapshot)
  const families = projectFamilies(snapshot, tombstoned)
  return Object.freeze({
    identity: snapshot.identity,
    liveEntryIds: Object.freeze([...snapshot.entries.keys()].filter((id) => !tombstoned.has(id)).sort(compareUtf8) as ProjectEntryId[]),
    tombstonedEntryIds: Object.freeze([...tombstoned].sort(compareUtf8) as ProjectEntryId[]),
    contentFamilies: Object.freeze(families),
    canvasRoutes: Object.freeze(projectRoutes(snapshot)),
  })
}

export function projectIndexRecordDigest(record: { readonly format: string }): Digest {
  return digestParts(RECORD_DOMAIN, encoder.encode(record.format), Uint8Array.of(0), encodeRestrictedJcs(record))
}

export function projectIndexIntentDigest(intent: ProjectIndexIntent): Digest {
  return digestParts(INTENT_DOMAIN, encodeRestrictedJcs(intent))
}

export function projectIndexResourceReferenceDigest(reference: ProjectIndexResourceReference): Digest {
  return digestParts(RESOURCE_REFERENCE_DOMAIN, encodeRestrictedJcs(parseProjectIndexResourceReference(reference)))
}

export function parseProjectIndexResourceReference(value: unknown): ProjectIndexResourceReference {
  assertExactKeys(value, [
    "format", "projectId", "projectEpoch", "entryFileId", "familyPrimaryFileId",
    "versionId", "canonicalUri", "blob", "versionRecordDigest",
  ], "Project resource reference")
  const record = value as unknown as ProjectIndexResourceReference
  if (record.format !== "convax.project-resource-reference") fail("invalid-resource-reference", "Project resource reference format is invalid")
  const projectId = parseProjectId(record.projectId)
  const projectEpoch = parseId128(record.projectEpoch)
  const entryFileId = parseProjectFileId(record.entryFileId)
  const familyPrimaryFileId = parseProjectFileId(record.familyPrimaryFileId)
  const versionId = parseVersionId(record.versionId)
  if (typeof record.canonicalUri !== "string" || canonicalize(record.canonicalUri) !== record.canonicalUri) {
    fail("invalid-resource-reference", "Project resource reference URI is not canonical")
  }
  const blob = parseBlob(record.blob)
  const uri = parseProjectUri(record.canonicalUri)
  if (
    uri.projectId !== projectId || uri.projectEpoch !== projectEpoch ||
    uri.entryId !== familyPrimaryFileId || uri.blob !== `sha256:${blob.digest}`
  ) fail("invalid-resource-reference", "Project resource reference URI binding is invalid")
  const versionRecordDigest = parseDigest(record.versionRecordDigest)
  return freezeJcs({
    format: record.format,
    projectId,
    projectEpoch,
    entryFileId,
    familyPrimaryFileId,
    versionId,
    canonicalUri: record.canonicalUri,
    blob,
    versionRecordDigest,
  })
}

export function projectCanvasRouteProjectionDigest(
  projection: ProjectCanvasRouteProjection,
): Digest {
  return structuredDigest("convax.project-route-projection", projection)
}

export function projectEntryLocationProjectionDigest(
  projection: ProjectEntryLocationProjection,
): Digest {
  return structuredDigest("convax.project-entry-location-projection", projection)
}

export function projectContentFamilyProjectionDigest(
  projection: ProjectContentFamilyProjection,
): Digest {
  return structuredDigest("convax.project-content-family-projection", projection)
}

export function projectConflictProjectionDigest(
  projection: ProjectConflictProjection,
): Digest {
  return structuredDigest("convax.project-conflict-projection", projection)
}

export function projectEntryLocationProjection(
  snapshot: ProjectIndexSnapshot,
  entryIdInput: ProjectEntryId,
): ProjectEntryLocationProjection {
  const entryId = parseProjectEntryId(entryIdInput)
  const base = projectEntryLocationOutcome(snapshot, entryId)
  const baseBytes = encodeRestrictedJcs({
    format: "convax.project-entry-location-counterfactual-outcome",
    status: "valid",
    projection: base,
  })
  const dependencies: Digest[] = []
  const seen = new Set<Digest>()
  for (const candidate of locationCounterfactualCandidates(snapshot, entryId)) {
    const digest = projectIndexRecordDigest(candidate.record as { readonly format: string })
    if (seen.has(digest)) fail("duplicate-record-digest", "Project location candidates reuse a record digest")
    seen.add(digest)
    const reduced = snapshotWithoutRecord(snapshot, candidate.root, candidate.key)
    let counterfactual: unknown
    try {
      counterfactual = {
        format: "convax.project-entry-location-counterfactual-outcome",
        status: "valid",
        projection: projectEntryLocationOutcome(reduced, entryId),
      }
    } catch {
      counterfactual = {
        format: "convax.project-entry-location-counterfactual-outcome",
        status: "invalid",
        entryId,
        reason: "accepted-record-removal-invalidated-resolution",
      }
    }
    if (compareUint8(baseBytes, encodeRestrictedJcs(counterfactual)) !== 0) dependencies.push(digest)
  }
  dependencies.sort(compareUtf8)
  return Object.freeze({ ...base, resolutionDependencyRecordDigests: Object.freeze(dependencies) })
}

export function projectContentFamilyProjection(
  snapshot: ProjectIndexSnapshot,
  primaryFileIdInput: ProjectFileId,
): ProjectContentFamilyProjection {
  const primaryFileId = parseProjectFileId(primaryFileIdInput)
  const entry = snapshot.entries.get(primaryFileId) ?? null
  const versions = [...snapshot.contentFamilies.values()]
    .filter((version) => version.primaryFileId === primaryFileId)
    .sort((left, right) => compareUtf8(left.versionId, right.versionId))
  const superseded = new Set(versions.flatMap((version) => [...version.supersedesVersionIds]))
  const live = versions
    .filter((version) => !superseded.has(version.versionId))
    .sort((left, right) => compareUtf8(left.versionId, right.versionId))
  const tombstoned = !isLiveEntry(snapshot, primaryFileId)
  let current: ProjectContentVersionRecord | null = null
  if (!tombstoned) {
    if (entry?.contentPolicy === "overwritable-binary") current = maxBinary(versions)
    else if (entry?.contentPolicy === "immutable") current = versions[0] ?? null
    else current = maxStamp(live)
  }
  const activeConflictProjectionDigests = [...snapshot.contentConflictCopies.values()]
    .filter((conflictCopy) => conflictCopy.primaryFileId === primaryFileId)
    .map((conflictCopy) => projectConflictProjection(snapshot, conflictCopy))
    .filter((projection) => projection.state !== "dormant")
    .map(projectConflictProjectionDigest)
    .sort(compareUtf8)
  return Object.freeze({
    format: "convax.project-content-family-projection",
    primaryFileId,
    primaryEntryRecordDigest: entry === null ? null : projectIndexRecordDigest(entry),
    contentPolicy: entry?.contentPolicy ?? null,
    versions: Object.freeze(versions.map((version) => Object.freeze([
      version.versionId,
      projectIndexRecordDigest(version),
    ] as const))),
    liveHeadVersionIds: Object.freeze(live.map((version) => version.versionId)),
    currentVersionId: current?.versionId ?? null,
    activeConflictProjectionDigests: Object.freeze(activeConflictProjectionDigests),
  })
}

function projectConflictProjection(
  snapshot: ProjectIndexSnapshot,
  conflictCopy: ProjectContentConflictCopyRecord,
): ProjectConflictProjection {
  const source = snapshot.contentFamilies.get(`v:${conflictCopy.primaryFileId}:${conflictCopy.versionId}`)
  const reservation = snapshot.pathReservations.get(`x:${conflictCopy.reservationId}`)
  const entry = snapshot.entries.get(conflictCopy.reservedConflictFileId)
  if (!source || !reservation || !entry || entry.entryId !== reservation.reservedEntryId) {
    fail("invalid-conflict-copy", "Conflict projection records do not cross-bind")
  }
  const active = activeConflictCopies(
    snapshot,
    [...snapshot.contentFamilies.values()].filter((version) => version.primaryFileId === conflictCopy.primaryFileId),
  ).includes(conflictCopy.reservedConflictFileId)
  const tombstoned = !isLiveEntry(snapshot, conflictCopy.reservedConflictFileId)
  if (!active && !tombstoned) {
    return Object.freeze({
      format: "convax.project-conflict-projection",
      primaryFileId: conflictCopy.primaryFileId,
      sourceVersionId: source.versionId,
      sourceVersionRecordDigest: projectIndexRecordDigest(source),
      conflictCopyRecordDigest: projectIndexRecordDigest(conflictCopy),
      reservationRecordDigest: projectIndexRecordDigest(reservation),
      reservedEntryId: conflictCopy.reservedConflictFileId,
      reservedEntryRecordDigest: projectIndexRecordDigest(entry),
      reservedEntryLocationProjectionDigest: null,
      state: "dormant",
      cause: "conflict-copy-dormant",
      materializedPath: null,
    })
  }
  const location = projectEntryLocationProjection(snapshot, conflictCopy.reservedConflictFileId)
  const locationDigest = projectEntryLocationProjectionDigest(location)
  if (tombstoned) {
    return Object.freeze({
      format: "convax.project-conflict-projection",
      primaryFileId: conflictCopy.primaryFileId,
      sourceVersionId: source.versionId,
      sourceVersionRecordDigest: projectIndexRecordDigest(source),
      conflictCopyRecordDigest: projectIndexRecordDigest(conflictCopy),
      reservationRecordDigest: projectIndexRecordDigest(reservation),
      reservedEntryId: conflictCopy.reservedConflictFileId,
      reservedEntryRecordDigest: projectIndexRecordDigest(entry),
      reservedEntryLocationProjectionDigest: locationDigest,
      state: "tombstoned",
      cause: "reserved-entry-tombstoned",
      materializedPath: null,
    })
  }
  const reserved = location.cause === "active-conflict-reservation-no-explicit" ||
    location.cause === "active-conflict-reservation-after-declared-missing"
  return Object.freeze({
    format: "convax.project-conflict-projection",
    primaryFileId: conflictCopy.primaryFileId,
    sourceVersionId: source.versionId,
    sourceVersionRecordDigest: projectIndexRecordDigest(source),
    conflictCopyRecordDigest: projectIndexRecordDigest(conflictCopy),
    reservationRecordDigest: projectIndexRecordDigest(reservation),
    reservedEntryId: conflictCopy.reservedConflictFileId,
    reservedEntryRecordDigest: projectIndexRecordDigest(entry),
    reservedEntryLocationProjectionDigest: locationDigest,
    state: reserved ? "active-reserved-path" : "active-explicit-path",
    cause: location.cause === "active-conflict-reservation-no-explicit"
      ? "active-reservation-no-explicit"
      : location.cause === "active-conflict-reservation-after-declared-missing"
        ? "active-reservation-after-declared-missing"
        : "active-explicit-location",
    materializedPath: location.portablePath,
  })
}

function projectEntryLocationOutcome(
  snapshot: ProjectIndexSnapshot,
  entryId: ProjectEntryId,
): ProjectEntryLocationOutcomeValue {
  const entry = snapshot.entries.get(entryId)
  if (!entry) return locationOutcome(entryId, null, [], null, "absent", "entry-absent", null, null)
  const entryDigest = projectIndexRecordDigest(entry)
  const tombstones = [...snapshot.entryTombstones.values()]
    .filter((record) => record.entryId === entryId)
    .map(projectIndexRecordDigest)
    .sort(compareUtf8)
  if (tombstones.length > 0) {
    return locationOutcome(entryId, entryDigest, tombstones, null, "tombstoned", "entry-tombstoned", null, null)
  }
  if (entryId === snapshot.identity.rootDirectoryId) {
    return locationOutcome(entryId, entryDigest, [], null, "live-linked", "project-root", "", null)
  }
  const claims = selectedLocationClaims(snapshot, entryId)
  const selected = maxStamp(claims)
  const selectedDigest = selected === null ? null : projectIndexRecordDigest(selected)
  if (entry.provenance === "content-conflict-copy") {
    const active = conflictEntryIsActive(snapshot, entry)
    if (!active) {
      if (selected !== null) fail("invalid-location", "Dormant conflict entry has an explicit location")
      return locationOutcome(entryId, entryDigest, [], null, "dormant-conflict", "dormant-content-conflict", null, null)
    }
    const reservation = snapshot.pathReservations.get(`x:${entry.conflictSource!.reservationId}`)
    if (!reservation) fail("invalid-location", "Active conflict entry lacks its reservation")
    if (selected === null) {
      return locationOutcome(entryId, entryDigest, [], null, "conflict-path", "active-conflict-reservation-no-explicit", reservation.canonicalPath, null)
    }
    if (selected.state === "declared-missing") {
      return locationOutcome(entryId, entryDigest, [], selectedDigest, "conflict-path", "active-conflict-reservation-after-declared-missing", reservation.canonicalPath, null)
    }
  }
  if (entry.storageClass === "managed-blob") {
    if (selected !== null) fail("invalid-location", "Managed blob cannot have a Project location")
    return locationOutcome(entryId, entryDigest, [], null, "live-managed-unlocated", "managed-blob", null, null)
  }
  if (selected === null) fail("invalid-location", "Live Project entry lacks a location")
  if (selected.state === "declared-missing") {
    return locationOutcome(entryId, entryDigest, [], selectedDigest, "live-declared-missing", "selected-declared-missing", null, null)
  }
  return resolveLinkedLocationOutcome(snapshot, entry, selected, entryDigest, selectedDigest!)
}

function resolveLinkedLocationOutcome(
  snapshot: ProjectIndexSnapshot,
  entry: ProjectEntryRecord,
  selected: ProjectEntryLocationClaim,
  entryDigest: Digest,
  selectedDigest: Digest,
): ProjectEntryLocationOutcomeValue {
  const chain: Array<Readonly<{ entry: ProjectEntryRecord; claim: ProjectEntryLocationClaim }>> = []
  const seen = new Set<ProjectEntryId>([entry.entryId])
  let currentEntry = entry
  let currentClaim = selected
  while (true) {
    chain.push({ entry: currentEntry, claim: currentClaim })
    const parentId = currentClaim.parentDirectoryId
    if (parentId === snapshot.identity.rootDirectoryId) break
    const parent = snapshot.entries.get(parentId)
    if (!parent || parent.kind !== "directory" || !isLiveEntry(snapshot, parentId)) {
      return locationOutcome(entry.entryId, entryDigest, [], selectedDigest, "conflict-path", "linked-orphan", `.convax-conflicts/orphans/${entry.entryId}/content`, null)
    }
    if (seen.has(parent.entryId)) {
      return locationOutcome(entry.entryId, entryDigest, [], selectedDigest, "conflict-path", "linked-directory-cycle", `.convax-conflicts/directory-cycles/${entry.entryId}/content`, null)
    }
    seen.add(parent.entryId)
    const parentClaim = maxStamp(selectedLocationClaims(snapshot, parent.entryId))
    if (!parentClaim || parentClaim.state !== "linked") {
      return locationOutcome(entry.entryId, entryDigest, [], selectedDigest, "conflict-path", "linked-orphan", `.convax-conflicts/orphans/${entry.entryId}/content`, null)
    }
    currentEntry = parent
    currentClaim = parentClaim
  }
  const rootToEntry = [...chain].reverse()
  const pathSegments = rootToEntry.map((item) => item.claim.basename)
  for (let index = 0; index < rootToEntry.length; index += 1) {
    const segment = rootToEntry[index]!
    const winner = pathClaimWinner(snapshot, segment.claim.parentDirectoryId, segment.claim.basename)
    if (winner !== segment.entry.entryId) {
      const suffix = pathSegments.slice(index + 1)
      const conflictRoot = `.convax-conflicts/path-claims/${segment.entry.entryId}/content`
      return locationOutcome(
        entry.entryId,
        entryDigest,
        [],
        selectedDigest,
        "conflict-path",
        index === rootToEntry.length - 1 ? "linked-path-claim-loser" : "linked-under-path-claim-loser",
        suffix.length === 0 ? conflictRoot : `${conflictRoot}/${suffix.join("/")}`,
        winner,
      )
    }
  }
  return locationOutcome(entry.entryId, entryDigest, [], selectedDigest, "live-linked", "linked-ordinary", pathSegments.join("/"), entry.entryId)
}

function locationOutcome(
  entryId: ProjectEntryId,
  entryRecordDigest: Digest | null,
  tombstoneRecordDigests: readonly Digest[],
  selectedLocationRecordDigest: Digest | null,
  state: ProjectEntryLocationOutcomeValue["state"],
  cause: ProjectEntryLocationCause,
  portablePath: string | null,
  pathClaimWinnerEntryId: ProjectEntryId | null,
): ProjectEntryLocationOutcomeValue {
  return Object.freeze({
    format: "convax.project-entry-location-projection",
    entryId,
    entryRecordDigest,
    tombstoneRecordDigests: Object.freeze([...tombstoneRecordDigests]),
    selectedLocationRecordDigest,
    state,
    cause,
    portablePath,
    pathClaimWinnerEntryId,
  })
}

function selectedLocationClaims(snapshot: ProjectIndexSnapshot, entryId: ProjectEntryId) {
  return [...snapshot.entryLocations.values()].filter((claim) => claim.entryId === entryId)
}

function pathClaimWinner(
  snapshot: ProjectIndexSnapshot,
  parentDirectoryId: ProjectDirectoryId,
  basename: string,
): ProjectEntryId {
  const candidates = [...snapshot.entries.values()]
    .filter((entry) => isLiveEntry(snapshot, entry.entryId))
    .flatMap((entry) => {
      const claim = maxStamp(selectedLocationClaims(snapshot, entry.entryId))
      return claim?.state === "linked" && claim.parentDirectoryId === parentDirectoryId && claim.basename === basename
        ? [{ entryId: entry.entryId, claim }]
        : []
    })
    .sort((left, right) => {
      const byStamp = comparePortableStamps(left.claim.stamp, right.claim.stamp)
      return byStamp === 0 ? compareUtf8(left.entryId, right.entryId) : byStamp
    })
  const winner = candidates.at(-1)
  if (!winner) fail("invalid-location", "Linked path has no claim winner")
  return winner.entryId
}

function conflictEntryIsActive(snapshot: ProjectIndexSnapshot, entry: ProjectEntryRecord): boolean {
  if (entry.conflictSource === null) return false
  const versions = [...snapshot.contentFamilies.values()].filter(
    (version) => version.primaryFileId === entry.conflictSource!.primaryFileId,
  )
  return activeConflictCopies(snapshot, versions).includes(entry.entryId as ProjectFileId)
}

type LocationCounterfactualRoot =
  | "entries"
  | "entryLocations"
  | "entryTombstones"
  | "contentFamilies"
  | "contentConflictCopies"
  | "pathReservations"

function locationCounterfactualCandidates(snapshot: ProjectIndexSnapshot, entryId: ProjectEntryId) {
  const result: Array<Readonly<{ root: LocationCounterfactualRoot; key: string; record: object }>> = []
  const add = (root: LocationCounterfactualRoot, map: ReadonlyMap<string, object>) => {
    for (const [key, record] of map) {
      if (root === "entries" && key === entryId) continue
      if (root === "entryTombstones" && "entryId" in record && record.entryId === entryId) continue
      result.push({ root, key, record })
    }
  }
  add("entries", snapshot.entries)
  add("entryLocations", snapshot.entryLocations)
  add("entryTombstones", snapshot.entryTombstones)
  add("contentFamilies", snapshot.contentFamilies)
  add("contentConflictCopies", snapshot.contentConflictCopies)
  add("pathReservations", snapshot.pathReservations)
  return result.sort((left, right) => {
    const byRoot = compareUtf8(left.root, right.root)
    if (byRoot !== 0) return byRoot
    const byKey = compareUtf8(left.key, right.key)
    if (byKey !== 0) return byKey
    return compareUtf8(
      projectIndexRecordDigest(left.record as { readonly format: string }),
      projectIndexRecordDigest(right.record as { readonly format: string }),
    )
  })
}

function snapshotWithoutRecord(
  snapshot: ProjectIndexSnapshot,
  root: LocationCounterfactualRoot,
  key: string,
): ProjectIndexSnapshot {
  const replacement = new Map(snapshot[root] as ReadonlyMap<string, unknown>)
  replacement.delete(key)
  return Object.freeze({ ...snapshot, [root]: replacement }) as ProjectIndexSnapshot
}

export type ProjectDerivedIdentityKind = "file" | "directory" | "version" | "location" | "tombstone" | "conflictCopy" | "reservation" | "canvas" | "route-transition"

export function deriveProjectIdentity(context: OwnerIntentConstructionContext, kind: ProjectDerivedIdentityKind, ordinalInput: Uint32): string {
  const ordinal = parseUint32(ordinalInput)
  const core = {
    format: "convax.project-derived-identity-core",
    scope: parseProjectIndexScope(context.scope),
    actorId: parseActorId(context.actorId),
    operationId: parseId128(context.operationId),
    ordinal,
    kind,
  } as const
  const suffix = structuredDigest(DERIVED_DOMAIN, core)
  const prefix = { file: "pf_", directory: "pd_", version: "pv_", location: "pl_", tombstone: "pt_", conflictCopy: "pp_", reservation: "pr_", canvas: "cv_", "route-transition": "cr_" }[kind]
  return `${prefix}${suffix}`
}

/** Exact precommit helper for Project-owned default-Canvas creation claims. */
export function deriveProjectCanvasIdForOperation(input: Readonly<{
  scope: DocumentScope & { readonly docKind: "project-index" }
  actorId: ActorId
  operationId: Id128
}>): CanvasId {
  const core = Object.freeze({
    format: "convax.project-derived-identity-core",
    scope: parseProjectIndexScope(input.scope),
    actorId: parseActorId(input.actorId),
    operationId: parseId128(input.operationId),
    ordinal: parseUint32("0"),
    kind: "canvas" as const,
  })
  return parseCanvasId(`cv_${structuredDigest(DERIVED_DOMAIN, core)}`)
}

export function projectIndexSnapshotFromValidatedOwnerState(
  base: OwnerValidatedState<"project-index">,
): ProjectIndexSnapshot | null {
  const value = base.value
  if (
    typeof value !== "object" ||
    value === null ||
    !((value as { entries?: unknown }).entries instanceof Map) ||
    !((value as { canvasRoutes?: unknown }).canvasRoutes instanceof Map) ||
    !((value as { operations?: unknown }).operations instanceof Map)
  ) {
    return null
  }
  return value as ProjectIndexSnapshot
}

export function constructProjectDirectoryCreateIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly parentDirectoryId: ProjectDirectoryId
  readonly basename: string
}): Readonly<{ readonly directoryId: ProjectDirectoryId; readonly intent: ProjectIndexIntent }> | "rejected" {
  try {
    const directoryId = parseProjectDirectoryId(deriveProjectIdentity(input.context, "directory", "0" as Uint32))
    const entry: ProjectEntryRecord = Object.freeze({
      format: "convax.project-entry",
      entryId: directoryId,
      kind: "directory",
      storageClass: null,
      contentPolicy: "none",
      provenance: "user",
      conflictSource: null,
      createdByActorId: input.context.actorId,
      createdByOperationId: input.context.operationId,
      createdStamp: stampForConstruction(input.context, "0"),
    })
    const location: ProjectEntryLocationClaim = Object.freeze({
      format: "convax.project-entry-location",
      claimId: deriveProjectIdentity(input.context, "location", "1" as Uint32) as ProjectFactId,
      entryId: directoryId,
      state: "linked",
      parentDirectoryId: parseProjectDirectoryId(input.parentDirectoryId),
      basename: requirePortableBasename(input.basename),
      reason: "create",
      stamp: stampForConstruction(input.context, "1"),
    })
    const intent = materializeProjectIndexIntentGuards({
      snapshot: input.snapshot,
      context: input.context,
      intent: { format: "convax.typed-intent", kind: "project.directory.create", guards: [], body: { entry, location } },
    })
    return intent === "rejected" ? "rejected" : Object.freeze({ directoryId, intent })
  } catch { return "rejected" }
}

export function constructProjectFileCreateIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly parentDirectoryId: ProjectDirectoryId | null
  readonly basename: string | null
  readonly blob: ProjectBlobRef
  readonly contentPolicy: Exclude<ProjectContentPolicy, "none">
  readonly storageClass: ProjectStorageClass
  readonly provenance: Exclude<ProjectEntryRecord["provenance"], "project-root" | "content-conflict-copy">
  readonly pathHint?: string
}): Readonly<{ readonly fileId: ProjectFileId; readonly version: ProjectContentVersionRecord; readonly intent: ProjectIndexIntent }> | "rejected" {
  try {
    const fileId = parseProjectFileId(deriveProjectIdentity(input.context, "file", "0" as Uint32))
    const entry: ProjectEntryRecord = Object.freeze({
      format: "convax.project-entry",
      entryId: fileId,
      kind: "file",
      storageClass: input.storageClass,
      contentPolicy: input.contentPolicy,
      provenance: input.provenance,
      conflictSource: null,
      createdByActorId: input.context.actorId,
      createdByOperationId: input.context.operationId,
      createdStamp: stampForConstruction(input.context, "0"),
    })
    const location = input.storageClass === "project-file" ? Object.freeze({
      format: "convax.project-entry-location" as const,
      claimId: deriveProjectIdentity(input.context, "location", "1" as Uint32) as ProjectFactId,
      entryId: fileId,
      state: "linked" as const,
      parentDirectoryId: parseProjectDirectoryId(input.parentDirectoryId),
      basename: requirePortableBasename(input.basename),
      reason: "create" as const,
      stamp: stampForConstruction(input.context, "1"),
    }) : null
    if (input.storageClass === "managed-blob" && (input.parentDirectoryId !== null || input.basename !== null)) return "rejected"
    const versionId = deriveProjectIdentity(input.context, "version", "2" as Uint32) as ProjectVersionId
    const blob = parseBlob(input.blob)
    const version: ProjectContentVersionRecord = Object.freeze({
      format: "convax.project-content-version",
      primaryFileId: fileId,
      versionId,
      writeClass: "initial",
      blob,
      canonicalRevisionUri: projectRevisionUri(input.snapshot.identity, fileId, blob, input.pathHint),
      supersedesVersionIds: Object.freeze([]),
      binaryLogicalCounter: input.contentPolicy === "overwritable-binary" ? "0" as Uint64 : null,
      creatorActorId: input.context.actorId,
      creatorOperationId: input.context.operationId,
      stamp: stampForConstruction(input.context, "2"),
    })
    const intent = materializeProjectIndexIntentGuards({
      snapshot: input.snapshot,
      context: input.context,
      intent: { format: "convax.typed-intent", kind: "project.file.create", guards: [], body: { entry, location, initialVersion: version } },
    })
    return intent === "rejected" ? "rejected" : Object.freeze({ fileId, version, intent })
  } catch { return "rejected" }
}

export function constructProjectEntryLocateIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly entryId: ProjectEntryId
  readonly parentDirectoryId: ProjectDirectoryId
  readonly basename: string
  readonly reason: "move" | "rename" | "explicit-relink"
}): ProjectIndexIntent | "rejected" {
  try {
    const location: ProjectEntryLocationClaim = Object.freeze({
      format: "convax.project-entry-location",
      claimId: deriveProjectIdentity(input.context, "location", "0" as Uint32) as ProjectFactId,
      entryId: parseProjectEntryId(input.entryId),
      state: "linked",
      parentDirectoryId: parseProjectDirectoryId(input.parentDirectoryId),
      basename: requirePortableBasename(input.basename),
      reason: input.reason,
      stamp: stampForConstruction(input.context, "0"),
    })
    return materializeProjectIndexIntentGuards({ snapshot: input.snapshot, context: input.context, intent: { format: "convax.typed-intent", kind: "project.entry.locate", guards: [], body: { location } } })
  } catch { return "rejected" }
}

export function constructProjectEntryTombstoneIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly entryId: ProjectEntryId
}): ProjectIndexIntent | "rejected" {
  try {
    const entryId = parseProjectEntryId(input.entryId)
    const entry = input.snapshot.entries.get(entryId)
    if (!entry) return "rejected"
    const tombstone: ProjectEntryTombstone = Object.freeze({
      format: "convax.project-entry-tombstone",
      tombstoneId: deriveProjectIdentity(input.context, "tombstone", "0" as Uint32) as ProjectFactId,
      entryId,
      reason: "explicit-delete",
      observedEntryDigest: projectIndexRecordDigest(entry),
      stamp: stampForConstruction(input.context, "0"),
    })
    return materializeProjectIndexIntentGuards({ snapshot: input.snapshot, context: input.context, intent: { format: "convax.typed-intent", kind: "project.entry.tombstone", guards: [], body: { tombstone } } })
  } catch { return "rejected" }
}

export function constructProjectFileWriteIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly fileId: ProjectFileId
  readonly blob: ProjectBlobRef
  readonly pathHint?: string
  readonly basenameHint: string
}): Readonly<{ readonly version: ProjectContentVersionRecord; readonly intent: ProjectIndexIntent }> | "rejected" {
  try {
    const fileId = parseProjectFileId(input.fileId)
    const entry = input.snapshot.entries.get(fileId)
    if (!entry || entry.kind !== "file") return "rejected"
    const family = projectContentFamilyProjection(input.snapshot, fileId)
    const versionId = deriveProjectIdentity(input.context, "version", "0" as Uint32) as ProjectVersionId
    const blob = parseBlob(input.blob)
    if (entry.contentPolicy === "overwritable-binary") {
      const currentId = family.currentVersionId
      const current = currentId === null ? null : input.snapshot.contentFamilies.get(`v:${fileId}:${currentId}`)
      if (!current) return "rejected"
      const version: ProjectContentVersionRecord = Object.freeze({
        format: "convax.project-content-version", primaryFileId: fileId, versionId,
        writeClass: "binary-overwrite", blob,
        canonicalRevisionUri: projectRevisionUri(input.snapshot.identity, fileId, blob, input.pathHint),
        supersedesVersionIds: Object.freeze([current.versionId]),
        binaryLogicalCounter: String(BigInt(current.binaryLogicalCounter ?? "0") + 1n) as Uint64,
        creatorActorId: input.context.actorId, creatorOperationId: input.context.operationId,
        stamp: stampForConstruction(input.context, "0"),
      })
      const intent = materializeProjectIndexIntentGuards({ snapshot: input.snapshot, context: input.context, intent: { format: "convax.typed-intent", kind: "project.file.overwrite-binary", guards: [], body: { version } } })
      return intent === "rejected" ? "rejected" : Object.freeze({ version, intent })
    }
    if (entry.contentPolicy !== "conflict-preserving-text") return "rejected"
    const conflictFileId = deriveProjectIdentity(input.context, "file", "1" as Uint32) as ProjectFileId
    const conflictCopyId = deriveProjectIdentity(input.context, "conflictCopy", "2" as Uint32) as ProjectFactId
    const reservationId = deriveProjectIdentity(input.context, "reservation", "3" as Uint32) as ProjectFactId
    const version: ProjectContentVersionRecord = Object.freeze({
      format: "convax.project-content-version", primaryFileId: fileId, versionId,
      writeClass: "text-write", blob,
      canonicalRevisionUri: projectRevisionUri(input.snapshot.identity, fileId, blob, input.pathHint),
      supersedesVersionIds: Object.freeze([...family.liveHeadVersionIds]), binaryLogicalCounter: null,
      creatorActorId: input.context.actorId, creatorOperationId: input.context.operationId,
      stamp: stampForConstruction(input.context, "0"),
    })
    const conflictEntry: ProjectEntryRecord = Object.freeze({
      format: "convax.project-entry", entryId: conflictFileId, kind: "file", storageClass: "project-file",
      contentPolicy: "conflict-preserving-text", provenance: "content-conflict-copy",
      conflictSource: { primaryFileId: fileId, sourceVersionId: versionId, conflictCopyId, reservationId },
      createdByActorId: input.context.actorId, createdByOperationId: input.context.operationId,
      createdStamp: stampForConstruction(input.context, "1"),
    })
    const conflictCopy: ProjectContentConflictCopyRecord = Object.freeze({ format: "convax.project-content-conflict-copy", conflictCopyId, primaryFileId: fileId, versionId, reservedConflictFileId: conflictFileId, reservationId, stamp: stampForConstruction(input.context, "2") })
    const reservation: ProjectPathReservationRecord = Object.freeze({ format: "convax.project-path-reservation", reservationId, kind: "content-conflict-copy", primaryFileId: fileId, versionId, reservedEntryId: conflictFileId, canonicalPath: `.convax-conflicts/${conflictFileId}/content`, originalBasenameHint: requirePortableBasename(input.basenameHint), stamp: stampForConstruction(input.context, "3") })
    const intent = materializeProjectIndexIntentGuards({ snapshot: input.snapshot, context: input.context, intent: { format: "convax.typed-intent", kind: "project.file.write-text", guards: [], body: { version, conflictEntry, conflictCopy, reservation } } })
    return intent === "rejected" ? "rejected" : Object.freeze({ version, intent })
  } catch { return "rejected" }
}

export function projectIndexResourceReferenceForVersion(
  snapshot: ProjectIndexSnapshot,
  version: ProjectContentVersionRecord,
  entryFileId: ProjectFileId = version.primaryFileId,
): ProjectIndexResourceReference {
  return resourceReference(snapshot.identity, version, parseProjectFileId(entryFileId))
}

function projectRevisionUri(
  identity: ProjectIndexIdentityRecord,
  fileId: ProjectFileId,
  blob: ProjectBlobRef,
  pathHint?: string,
): string {
  return fromProjectUri({
    projectId: identity.projectId,
    projectEpoch: identity.projectEpoch,
    entryId: fileId,
    blob: `sha256:${blob.digest}`,
    ...(pathHint === undefined ? {} : { path: pathHint }),
  }).toString()
}

function requirePortableBasename(value: string | null): string {
  if (value === null) fail("invalid-basename", "Project basename is required")
  assertPortableBasename(value)
  return value
}

export function constructProjectCanvasRouteStageIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly shardEpoch: Id128
  readonly title: string
}): Readonly<{ readonly canvasId: CanvasId; readonly intent: ProjectIndexIntent }> | "rejected" {
  try {
    const canvasId = parseCanvasId(deriveProjectIdentity(input.context, "canvas", parseUint32("0")))
    if (routeFacts(input.snapshot, canvasId).length > 0) return "rejected"
    const transitionId = deriveProjectIdentity(
      input.context,
      "route-transition",
      parseUint32("1"),
    ) as ProjectFactId
    const stage: CanvasRouteStage = Object.freeze({
      format: "convax.canvas-route-stage",
      transitionId,
      canvasId,
      shardEpoch: parseId128(input.shardEpoch),
      title: requireRouteTitle(input.title),
      reason: "create",
      stamp: stampForConstruction(input.context, "1"),
    })
    return Object.freeze({
      canvasId,
      intent: Object.freeze({
        format: "convax.typed-intent",
        kind: "project.canvas.route.stage",
        guards: routeMutationGuards(
          input.snapshot,
          input.context,
          canvasId,
          `r:${canvasId}:${transitionId}`,
        ),
        body: Object.freeze({ stage }),
      }),
    })
  } catch {
    return "rejected"
  }
}

export function constructProjectCanvasRouteActivationIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly canvasId: CanvasId
  readonly projectIndexRouteDependencyFrameDigest: Digest
  readonly canvasGenesisCheckpointObjectDigest: Digest
  readonly stagedProjectIndexFrontierDigest: Digest
}): ProjectIndexIntent | "rejected" {
  try {
    const canvasId = parseCanvasId(input.canvasId)
    const facts = routeFacts(input.snapshot, canvasId)
    const stages = facts.filter((fact): fact is CanvasRouteStage => fact.format === "convax.canvas-route-stage")
    if (stages.length !== 1 || facts.some((fact) => fact.format === "convax.canvas-route-tombstone")) {
      return "rejected"
    }
    const stage = stages[0]!
    const activation: CanvasRouteActivation = Object.freeze({
      format: "convax.canvas-route-activation",
      transitionId: deriveProjectIdentity(
        input.context,
        "route-transition",
        parseUint32("0"),
      ) as ProjectFactId,
      canvasId,
      shardEpoch: stage.shardEpoch,
      predecessorActivationDigest: null,
      stageRecordDigest: projectIndexRecordDigest(stage),
      projectIndexRouteDependencyFrameDigest: parseDigest(input.projectIndexRouteDependencyFrameDigest),
      canvasGenesisCheckpointObjectDigest: parseDigest(input.canvasGenesisCheckpointObjectDigest),
      stagedProjectIndexFrontierDigest: parseDigest(input.stagedProjectIndexFrontierDigest),
      stamp: stampForConstruction(input.context, "0"),
    })
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "project.canvas.route.activate",
      guards: routeMutationGuards(
        input.snapshot,
        input.context,
        canvasId,
        `r:${canvasId}:${activation.transitionId}`,
      ),
      body: Object.freeze({ activation }),
    })
  } catch {
    return "rejected"
  }
}

export function constructProjectCanvasRouteRenameIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly canvasId: CanvasId
  readonly title: string
}): ProjectIndexIntent | "rejected" {
  try {
    const canvasId = parseCanvasId(input.canvasId)
    const route = projectRoutes(input.snapshot).find((candidate) => candidate.canvasId === canvasId)
    if (route?.state !== "live" || route.currentActivationDigest === null) return "rejected"
    const metadata: CanvasRouteMetadataClaim = Object.freeze({
      format: "convax.canvas-route-metadata",
      transitionId: deriveProjectIdentity(
        input.context,
        "route-transition",
        parseUint32("0"),
      ) as ProjectFactId,
      canvasId,
      title: requireRouteTitle(input.title),
      observedActivationDigest: route.currentActivationDigest,
      stamp: stampForConstruction(input.context, "0"),
    })
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "project.canvas.route.rename",
      guards: routeMutationGuards(
        input.snapshot,
        input.context,
        canvasId,
        `r:${canvasId}:${metadata.transitionId}`,
      ),
      body: Object.freeze({ metadata }),
    })
  } catch {
    return "rejected"
  }
}

export function constructProjectCanvasRouteTombstoneIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly canvasId: CanvasId
}): ProjectIndexIntent | "rejected" {
  try {
    const canvasId = parseCanvasId(input.canvasId)
    const route = projectCanvasRouteProjection(input.snapshot, canvasId)
    if (!route || route.state === "tombstoned") return "rejected"
    const tombstone: CanvasRouteTombstone = Object.freeze({
      format: "convax.canvas-route-tombstone",
      transitionId: deriveProjectIdentity(
        input.context,
        "route-transition",
        parseUint32("0"),
      ) as ProjectFactId,
      canvasId,
      observedActivationDigest: route.currentActivationDigest,
      reason: "explicit-delete",
      stamp: stampForConstruction(input.context, "0"),
    })
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "project.canvas.route.tombstone",
      guards: routeMutationGuards(
        input.snapshot,
        input.context,
        canvasId,
        `r:${canvasId}:${tombstone.transitionId}`,
      ),
      body: Object.freeze({ tombstone }),
    })
  } catch {
    return "rejected"
  }
}

export function constructProjectCanvasRouteResetIntent(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly routeCasCore: DocumentShardResetRouteCasCore
  readonly resetClaim: DocumentShardResetClaim
  readonly confirmation: DocumentShardResetConfirmation
  readonly approval: DocumentShardResetApproval
}): Extract<ProjectIndexIntent, { readonly kind: "project.canvas.route.reset" }> | "rejected" {
  try {
    const routeCasCore = parseDocumentShardResetRouteCasCore(input.routeCasCore)
    const resetClaim = parseDocumentShardResetClaim(input.resetClaim)
    const confirmation = parseDocumentShardResetConfirmation(input.confirmation)
    const approval = parseDocumentShardResetApproval(input.approval)
    const canvasId = routeCasCore.canvasId
    const route = projectCanvasRouteProjection(input.snapshot, canvasId)
    if (
      route.state !== "live" ||
      route.currentActivationDigest === null ||
      route.currentShardEpoch === null ||
      routeCasCore.operationId !== input.context.operationId ||
      routeCasCore.oldScope.shardEpoch !== route.currentShardEpoch ||
      routeCasCore.predecessorActivationDigest !== route.currentActivationDigest
    ) return "rejected"
    const resetCommit: CanvasRouteResetCommit = Object.freeze({
      format: "convax.canvas-route-reset-commit",
      transitionId: deriveProjectIdentity(
        input.context,
        "route-transition",
        parseUint32("0"),
      ) as ProjectFactId,
      canvasId,
      oldShardEpoch: routeCasCore.oldScope.shardEpoch,
      newShardEpoch: routeCasCore.newScope.shardEpoch,
      predecessorActivationDigest: routeCasCore.predecessorActivationDigest,
      stagedGenesisCheckpointObjectDigest: routeCasCore.stagedGenesisCheckpointObjectDigest,
      stagedGenesisFullUpdateDigest: routeCasCore.stagedGenesisFullUpdateDigest,
      stagedGenesisStateVectorDigest: routeCasCore.stagedGenesisStateVectorDigest,
      resetClaimCoreDigest: resetClaim.coreDigest,
      confirmationCoreDigest: confirmation.coreDigest,
      approvalCoreDigest: approval.coreDigest,
      routeCasCoreDigest: structuredDigest(
        "convax.document-shard-reset-route-cas-core-digest",
        routeCasCore,
      ),
      stamp: stampForConstruction(input.context, "0"),
    })
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "project.canvas.route.reset",
      guards: routeMutationGuards(
        input.snapshot,
        input.context,
        canvasId,
        `r:${canvasId}:${resetCommit.transitionId}`,
      ),
      body: Object.freeze({ resetCommit, routeCasCore, resetClaim, confirmation, approval }),
    })
  } catch {
    return "rejected"
  }
}

export function materializeProjectIndexIntentGuards(input: {
  readonly snapshot: ProjectIndexSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly intent: ProjectIndexIntent
}): ProjectIndexIntent | "rejected" {
  try {
    return parseIntent({
      ...input.intent,
      guards: projectIndexRequiredGuards(input.snapshot, input.context, input.intent),
    })
  } catch {
    return "rejected"
  }
}

export function applyProjectIndexCandidateIntent(
  document: Y.Doc,
  context: OwnerIntentValidationContext,
  intentInput: ProjectIndexIntent,
  facts: ProjectIndexExternalFactContext,
): ProjectIndexApplyResult | "rejected" {
  try {
    const intent = parseIntent(intentInput)
    const snapshot = validateProjectIndexYDoc(document, parseProjectIndexScope(context.scope))
    // Current frame authority is validated by the collaboration kernel; the
    // owner still binds the exact ProjectIndex schema here.
    if (context.ownerSchemaDigest !== snapshot.identity.schemaDigest) return "rejected"
    // The durable receipt and actual-write evidence bind the current wire
    // protocol's typed-intent digest. ProjectIndex's domain digest remains for
    // dependency requests and deterministic construction only.
    const intentDigest = parseDigest(context.intentDigest)
    const operationKey = `o:${context.actorId}:${context.operationId}`
    const existing = snapshot.operations.get(operationKey)
    if (existing) return existing.intentDigest === intentDigest && existing.intentKind === intent.kind ? { format: "convax.project-index-intent-result", intentDigest, inserted: [] } : "rejected"
    const inserted = recordsForIntent(snapshot, context, intent, facts)
    if (inserted === "rejected") return "rejected"
    const allocatedIds = [...new Set(inserted.flatMap((item) => allocatedRecordIds(item.record)))].sort(compareUtf8)
    const ordinals = inserted.map((item) => parseUint32(recordStamp(item.record).writeOrdinal)).map(Number)
    const receipt: ProjectOperationReceipt = {
      format: "convax.project-operation-receipt",
      actorId: context.actorId,
      operationId: context.operationId,
      intentKind: intent.kind,
      intentDigest,
      allocatedIds,
      firstWriteOrdinal: String(Math.min(...ordinals)) as Uint32,
      writeCount: String(inserted.length + 1) as Uint32,
      stampLamport: context.lamport,
    }
    const all = [...inserted, { root: "operations" as const, key: operationKey, record: receipt }]
    document.transact(() => {
      const root = getRoot(document)
      for (const item of all) putImmutableFact(childMap(root, item.root), item.key, item.record)
    }, "project-index-intent-v2")
    validateProjectIndexYDoc(document, parseProjectIndexScope(context.scope))
    return Object.freeze({ format: "convax.project-index-intent-result", intentDigest, inserted: Object.freeze(all) })
  } catch {
    return "rejected"
  }
}

export const selectedProjectIndexDocumentOwnerArtifactDefinition: SelectedDocumentOwnerArtifactDefinition<"project-index"> = Object.freeze({
  owner: "project-index",
  createDefinitions(processValues: OwnerProcessValueFactory<"project-index">) {
    return Object.freeze({ protocol: projectIndexProtocolDefinition(processValues), closure: projectIndexClosureDefinition() })
  },
})

function projectIndexProtocolDefinition(processValues: OwnerProcessValueFactory<"project-index">): DocumentOwnerProtocolDefinition<"project-index"> {
  const schemaDigest = PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST
  const canonicalizerDescriptor = projectIndexOwnerCanonicalizerDescriptor(schemaDigest)
  const canonicalizerDigest = ownerCanonicalizerDescriptorDigest(canonicalizerDescriptor)
  return Object.freeze({
    owner: "project-index",
    schemaDigest,
    canonicalizerDescriptor,
    canonicalizerDigest,
    decodeIntent(exactJcs: Uint8Array) {
      try { return parseIntent(decodeRestrictedJcs(exactJcs)) } catch { return "rejected" }
    },
    validateBase(document: Y.Doc) {
      try { return processValues.wrapValidatedState(validateProjectIndexYDoc(document)) } catch { return "rejected" }
    },
    applyIntent(candidate: Y.Doc, context: OwnerIntentValidationContext, intent: unknown, externalFacts: OwnerExternalFactPort<"project-index">) {
      try {
        const parsed = parseIntent(intent)
        const dependencies = projectIndexIntentDependencies(context, parsed)
        const factContext = consumeExternalFacts(dependencies, externalFacts)
        if (factContext === "pending" || factContext === "rejected") return factContext
        const result = applyProjectIndexCandidateIntent(candidate, context, parsed, factContext)
        return result === "rejected" ? "rejected" : processValues.wrapApplyResult(Object.freeze({ result, scope: context.scope }))
      } catch { return "rejected" }
    },
    validatePost(_base: OwnerValidatedState<"project-index">, candidate: Y.Doc, result: OwnerApplyResult<"project-index">) {
      return ownerResult(result) === null ? "rejected" : processValues.wrapValidatedState(validateProjectIndexYDoc(candidate))
    },
    canonicalStateBytes(document: Y.Doc) {
      try { return encodeProjectCanonicalState(document) } catch { return "rejected" }
    },
    deriveActualWriteEvidence(result: OwnerApplyResult<"project-index">) {
      const value = ownerResult(result)
      if (value === null) throw new TypeError("ProjectIndex owner result is invalid")
      const writes = value.result.inserted.map((item) => {
        const record = item.record as { readonly format: string }
        let recordDigest: Digest
        try {
          recordDigest = projectIndexRecordDigest(record)
        } catch (error) {
          console.error("ProjectIndex evidence record JCS rejected", item.root, item.key, record)
          throw error
        }
        if (typeof record.format !== "string") {
          console.error("ProjectIndex evidence record format missing", item.root, item.key, record)
        }
        return {
          entityKind: `project-index.${item.root}`,
          entityId: item.key,
          field: "record",
          valueDigest: structuredDigest("convax.project-index-write-value", { format: "convax.project-index-write-value", root: item.root, key: item.key, recordFormat: record.format, recordDigest }),
        }
      }).sort((left, right) => compareUtf8(`${left.entityKind}/${left.entityId}`, `${right.entityKind}/${right.entityId}`))
      return {
        format: "convax.actual-write-evidence",
        scope: value.scope,
        owner: "project-index",
        ownerSchemaDigest: schemaDigest,
        intentDigest: value.result.intentDigest,
        changedPaths: writes.map((write) => `${write.entityKind.slice("project-index.".length)}/${write.entityId}`),
        writes,
      } satisfies ActualWriteEvidence
    },
  })
}

function projectIndexClosureDefinition(): OwnerIntentClosureDefinition<"project-index"> {
  return Object.freeze({
    inspectIntent(intent: unknown) { try { parseIntent(intent); return Object.freeze({ kind: "ordinary" as const }) } catch { return "rejected" } },
    discoverDependencies(input: Parameters<OwnerIntentClosureDefinition<"project-index">["discoverDependencies"]>[0]) {
      try { return projectIndexIntentDependencies(input.context, parseIntent(input.intent)) } catch { return "rejected" }
    },
    history: null,
  })
}

export function projectIndexIntentDependencies(context: OwnerIntentValidationContext, intent: ProjectIndexIntent): OwnerIntentDependencies<"project-index"> {
  const request = externalFactRequest(context, intent)
  if (request === null) return Object.freeze({ validationArtifacts: Object.freeze([]), externalFacts: Object.freeze([]) })
  const exactJcs = encodeRestrictedJcs(request)
  const sha256 = ordinarySha256(exactJcs)
  return Object.freeze({
    validationArtifacts: Object.freeze([]),
    externalFacts: Object.freeze([{ owner: "project-index" as const, kind: request.kind, factDigest: sha256, request: Object.freeze({ sha256, exactJcs }) }]),
  })
}

/** Exact immutable blob closure for ProjectIndex persistence and replication ACK gating. */
export function requiredProjectIndexBlobDigests(frame: DecodedCausalEditFrame): readonly Digest[] {
  if (frame.header.core.scope.docKind !== "project-index") {
    throw new TypeError("ProjectIndex blob dependency extraction received another document owner")
  }
  const exactJcs = new Uint8Array(frame.sections.typedIntentJcs)
  const intent = parseIntent(decodeRestrictedJcs(exactJcs))
  if (frame.header.core.intentKind !== intent.kind) {
    throw new TypeError("ProjectIndex frame intent kind does not match its exact typed intent")
  }
  if (compareBytes(encodeRestrictedJcs(intent), exactJcs) !== 0) {
    throw new TypeError("ProjectIndex typed intent bytes are not canonical restricted JCS")
  }
  if (intent.kind === "project.file.create") {
    return Object.freeze([parseDigest(intent.body.initialVersion.blob.digest)])
  }
  if (intent.kind === "project.file.write-text" || intent.kind === "project.file.overwrite-binary") {
    return Object.freeze([parseDigest(intent.body.version.blob.digest)])
  }
  return Object.freeze([])
}

type ProjectIndexExternalFactRequest = Readonly<Record<string, unknown> & {
  readonly kind:
    | "blob-publication-currentness"
    | "canvas-genesis-currentness"
    | "reset-authorization-currentness"
}>

/**
 * Closed Project-owned wire view used by the native Canvas-genesis verifier.
 * Desktop may perform I/O for this request, but it must not redeclare or loosen
 * the ProjectIndex request grammar.
 */
export interface ProjectIndexCanvasGenesisCurrentnessRequest {
  readonly format: "convax.project-index-external-fact-request"
  readonly kind: "canvas-genesis-currentness"
  readonly projectIndexScope: ProjectIndexScope
  readonly operationId: Id128
  readonly intentDigest: Digest
  readonly canvasScope: CanvasDocumentScope
  readonly stageRecordDigest: Digest
  readonly routeDependencyFrameDigest: Digest
  readonly genesisCheckpointObjectDigest: Digest
  readonly stagedProjectIndexFrontierDigest: Digest
}

export interface ProjectIndexBlobPublicationCurrentnessRequest {
  readonly format: "convax.project-index-external-fact-request"
  readonly kind: "blob-publication-currentness"
  readonly projectIndexScope: ProjectIndexScope
  readonly operationId: Id128
  readonly intentDigest: Digest
  readonly versionRecordDigest: Digest
  readonly blob: ProjectBlobRef
}

export function decodeProjectIndexBlobPublicationCurrentnessRequest(
  exactJcs: Readonly<Uint8Array>,
): ProjectIndexBlobPublicationCurrentnessRequest | "rejected" {
  try {
    if (!(exactJcs instanceof Uint8Array)) return "rejected"
    const decoded = decodeRestrictedJcs(new Uint8Array(exactJcs))
    if (compareBytes(encodeRestrictedJcs(decoded), exactJcs) !== 0) return "rejected"
    assertExactKeys(decoded, [
      "format", "kind", "projectIndexScope", "operationId", "intentDigest",
      "versionRecordDigest", "blob",
    ], "ProjectIndex blob publication currentness request")
    if (decoded.format !== "convax.project-index-external-fact-request" || decoded.kind !== "blob-publication-currentness") return "rejected"
    return Object.freeze({
      format: decoded.format,
      kind: decoded.kind,
      projectIndexScope: parseProjectIndexScope(decoded.projectIndexScope as DocumentScope),
      operationId: parseId128(decoded.operationId),
      intentDigest: parseDigest(decoded.intentDigest),
      versionRecordDigest: parseDigest(decoded.versionRecordDigest),
      blob: parseBlob(decoded.blob),
    })
  } catch { return "rejected" }
}

/** Parse/re-encode equality is mandatory before native code resolves G. */
export function decodeProjectIndexCanvasGenesisCurrentnessRequest(
  exactJcs: Readonly<Uint8Array>,
): ProjectIndexCanvasGenesisCurrentnessRequest | "rejected" {
  try {
    if (!(exactJcs instanceof Uint8Array)) return "rejected"
    const decoded = decodeRestrictedJcs(new Uint8Array(exactJcs))
    if (compareBytes(encodeRestrictedJcs(decoded), exactJcs) !== 0) return "rejected"
    assertExactKeys(decoded, [
      "format", "kind", "projectIndexScope", "operationId", "intentDigest", "canvasScope",
      "stageRecordDigest", "routeDependencyFrameDigest", "genesisCheckpointObjectDigest",
      "stagedProjectIndexFrontierDigest",
    ], "ProjectIndex Canvas genesis currentness request")
    if (
      decoded.format !== "convax.project-index-external-fact-request" ||
      decoded.kind !== "canvas-genesis-currentness"
    ) return "rejected"
    const projectIndexScope = parseProjectIndexScope(decoded.projectIndexScope as DocumentScope)
    const canvasScope = parseCanvasDocumentScope(decoded.canvasScope)
    if (
      projectIndexScope.projectId !== canvasScope.projectId ||
      projectIndexScope.projectEpoch !== canvasScope.projectEpoch
    ) return "rejected"
    return Object.freeze({
      format: decoded.format,
      kind: decoded.kind,
      projectIndexScope,
      operationId: parseId128(decoded.operationId),
      intentDigest: parseDigest(decoded.intentDigest),
      canvasScope,
      stageRecordDigest: parseDigest(decoded.stageRecordDigest),
      routeDependencyFrameDigest: parseDigest(decoded.routeDependencyFrameDigest),
      genesisCheckpointObjectDigest: parseDigest(decoded.genesisCheckpointObjectDigest),
      stagedProjectIndexFrontierDigest: parseDigest(decoded.stagedProjectIndexFrontierDigest),
    })
  } catch {
    return "rejected"
  }
}

function externalFactRequest(context: OwnerIntentValidationContext, intent: ProjectIndexIntent): ProjectIndexExternalFactRequest | null {
  const projectIndexScope = parseProjectIndexScope(context.scope)
  // The frame context binds the current wire protocol's digest. External facts
  // are ProjectIndex-domain facts, so their request identity is derived from the
  // ProjectIndex domain rather than from framing.
  const base = {
    format: "convax.project-index-external-fact-request",
    projectIndexScope,
    operationId: context.operationId,
    intentDigest: projectIndexIntentDigest(intent),
  }
  if (intent.kind === "project.file.create" || intent.kind === "project.file.write-text" || intent.kind === "project.file.overwrite-binary") {
    const version = intent.kind === "project.file.create" ? intent.body.initialVersion : intent.body.version
    return { ...base, kind: "blob-publication-currentness", versionRecordDigest: projectIndexRecordDigest(version), blob: version.blob }
  }
  if (intent.kind === "project.canvas.route.activate") {
    const activation = intent.body.activation
    return { ...base, kind: "canvas-genesis-currentness", canvasScope: { ...projectIndexScope, docKind: "canvas", docId: activation.canvasId, shardEpoch: activation.shardEpoch }, stageRecordDigest: activation.stageRecordDigest, routeDependencyFrameDigest: activation.projectIndexRouteDependencyFrameDigest, genesisCheckpointObjectDigest: activation.canvasGenesisCheckpointObjectDigest, stagedProjectIndexFrontierDigest: activation.stagedProjectIndexFrontierDigest }
  }
  if (intent.kind === "project.canvas.route.reset") {
    const { routeCasCore, resetClaim, confirmation, approval } = intent.body
    return {
      ...base,
      kind: "reset-authorization-currentness",
      oldScope: routeCasCore.oldScope,
      newScope: routeCasCore.newScope,
      claimCoreDigest: resetClaim.coreDigest,
      confirmationCoreDigest: confirmation.coreDigest,
      approvalCoreDigest: approval.coreDigest,
      routeCasCoreDigest: structuredDigest(
        "convax.document-shard-reset-route-cas-core-digest",
        routeCasCore,
      ),
      predecessorActivationDigest: routeCasCore.predecessorActivationDigest,
    }
  }
  return null
}

function consumeExternalFacts(dependencies: OwnerIntentDependencies<"project-index">, port: OwnerExternalFactPort<"project-index">): ProjectIndexExternalFactContext | "pending" | "rejected" {
  const verified = new Set<string>()
  for (const requirement of dependencies.externalFacts) {
    const resolved = port.resolveFact(requirement)
    if (resolved.status !== "resolved") return resolved.status
    if (!validFactResult(resolved.value, requirement)) return "rejected"
    verified.add(requirement.factDigest)
  }
  return Object.freeze({
    verifyBlob(versionRecordDigest: Digest, blob: ProjectBlobRef) { return requirementMatches(dependencies.externalFacts, "blob-publication-currentness", versionRecordDigest, blob, verified) },
    verifyCanvasGenesis(activation: CanvasRouteActivation) { return dependencies.externalFacts.some((item) => {
      if (item.kind !== "canvas-genesis-currentness" || !verified.has(item.factDigest)) return false
      const request = decodeRestrictedJcs(item.request.exactJcs)
      return typeof request === "object" && request !== null && "stageRecordDigest" in request && request.stageRecordDigest === activation.stageRecordDigest
    }) },
    verifyResetAuthorization(
      body: Extract<ProjectIndexIntent, { readonly kind: "project.canvas.route.reset" }>["body"],
    ) { return dependencies.externalFacts.some((item) => {
      if (item.kind !== "reset-authorization-currentness" || !verified.has(item.factDigest)) return false
      const request = decodeRestrictedJcs(item.request.exactJcs)
      return typeof request === "object" && request !== null &&
        "claimCoreDigest" in request && request.claimCoreDigest === body.resetClaim.coreDigest &&
        "confirmationCoreDigest" in request && request.confirmationCoreDigest === body.confirmation.coreDigest &&
        "approvalCoreDigest" in request && request.approvalCoreDigest === body.approval.coreDigest &&
        "routeCasCoreDigest" in request && request.routeCasCoreDigest === body.resetCommit.routeCasCoreDigest
    }) },
  })
}

function validFactResult(value: unknown, requirement: OwnerExternalFactRequirement<"project-index">): boolean {
  try {
    assertExactKeys(value, ["format", "kind", "requestSha256", "factDigest", "decision"], "ProjectIndex external fact")
    return value.format === "convax.project-index-external-fact-result" && value.kind === requirement.kind && value.requestSha256 === requirement.request.sha256 && value.factDigest === requirement.factDigest && value.decision === "verified"
  } catch { return false }
}

function requirementMatches(requirements: readonly OwnerExternalFactRequirement<"project-index">[], kind: string, versionRecordDigest: Digest, blob: ProjectBlobRef, verified: Set<string>): boolean {
  return requirements.some((item) => {
    if (item.kind !== kind || !verified.has(item.factDigest)) return false
    const request = decodeRestrictedJcs(item.request.exactJcs)
    return typeof request === "object" && request !== null && "versionRecordDigest" in request && "blob" in request && request.versionRecordDigest === versionRecordDigest && encodeEqual(request.blob, blob)
  })
}

function recordsForIntent(snapshot: ProjectIndexSnapshot, context: OwnerIntentValidationContext, intent: ProjectIndexIntent, facts: ProjectIndexExternalFactContext): ProjectIndexApplyResult["inserted"] | "rejected" {
  const add = (root: ProjectIndexApplyResult["inserted"][number]["root"], key: string, record: object) => ({ root, key, record })
  if (!projectGuardsEqualAndHold(snapshot, context, intent)) {
    console.error("ProjectIndex intent guards rejected", { kind: intent.kind, guards: intent.guards, expected: projectIndexRequiredGuards(snapshot, context, intent) })
    return "rejected"
  }
  if (intent.kind === "project.directory.create") {
    if (!recordMatchesContext(intent.body.entry, context, "directory", "0") || !recordMatchesContext(intent.body.location, context, "location", "1")) return "rejected"
    return [add("entries", intent.body.entry.entryId, intent.body.entry), add("entryLocations", `l:${intent.body.location.entryId}:${intent.body.location.claimId}`, intent.body.location)]
  }
  if (intent.kind === "project.file.create") {
    const { entry, location, initialVersion } = intent.body
    if (!recordMatchesContext(entry, context, "file", "0")) fail("derived-entry", "file entry mismatch")
    if (location !== null && !recordMatchesContext(location, context, "location", "1")) fail("derived-location", "file location mismatch")
    if (!recordMatchesContext(initialVersion, context, "version", "2")) fail("derived-version", "initial version mismatch")
    if (snapshot.entries.has(entry.entryId) || initialVersion.primaryFileId !== entry.entryId || initialVersion.writeClass !== "initial") return "rejected"
    if ((entry.storageClass === "project-file") !== (location !== null)) return "rejected"
    if ((entry.provenance === "generated" || entry.provenance === "managed-admission") && entry.contentPolicy !== "immutable") return "rejected"
    if (!facts.verifyBlob(projectIndexRecordDigest(initialVersion), initialVersion.blob)) return "rejected"
    return [add("entries", entry.entryId, entry), ...(location === null ? [] : [add("entryLocations", `l:${location.entryId}:${location.claimId}`, location)]), add("contentFamilies", `v:${initialVersion.primaryFileId}:${initialVersion.versionId}`, initialVersion)]
  }
  if (intent.kind === "project.entry.locate") {
    const location = intent.body.location
    if (!recordMatchesContext(location, context, "location", "0") || !isLiveEntry(snapshot, location.entryId)) return "rejected"
    return [add("entryLocations", `l:${location.entryId}:${location.claimId}`, location)]
  }
  if (intent.kind === "project.entry.tombstone") {
    const tombstone = intent.body.tombstone
    if (!recordMatchesContext(tombstone, context, "tombstone", "0") || !isLiveEntry(snapshot, tombstone.entryId)) return "rejected"
    return [add("entryTombstones", `t:${tombstone.entryId}:${tombstone.tombstoneId}`, tombstone)]
  }
  if (intent.kind === "project.file.write-text") {
    const { version, conflictEntry, conflictCopy, reservation } = intent.body
    if (!recordMatchesContext(version, context, "version", "0") || !recordMatchesContext(conflictEntry, context, "file", "1") || !recordMatchesContext(conflictCopy, context, "conflictCopy", "2") || !recordMatchesContext(reservation, context, "reservation", "3")) return "rejected"
    const family = projectFamilies(snapshot, tombstonedEntries(snapshot)).find((item) => item.primaryFileId === version.primaryFileId)
    const primary = snapshot.entries.get(version.primaryFileId)
    if (!primary || primary.contentPolicy !== "conflict-preserving-text" || !encodeEqual(family?.liveHeadVersionIds ?? [], version.supersedesVersionIds)) return "rejected"
    if (conflictEntry.conflictSource === null || conflictEntry.conflictSource.primaryFileId !== version.primaryFileId || conflictEntry.conflictSource.sourceVersionId !== version.versionId || conflictEntry.conflictSource.conflictCopyId !== conflictCopy.conflictCopyId || conflictEntry.conflictSource.reservationId !== reservation.reservationId || conflictCopy.primaryFileId !== version.primaryFileId || conflictCopy.versionId !== version.versionId || conflictCopy.reservedConflictFileId !== conflictEntry.entryId || conflictCopy.reservationId !== reservation.reservationId || reservation.primaryFileId !== version.primaryFileId || reservation.versionId !== version.versionId || reservation.reservedEntryId !== conflictEntry.entryId) return "rejected"
    if (!facts.verifyBlob(projectIndexRecordDigest(version), version.blob)) return "rejected"
    return [add("contentFamilies", `v:${version.primaryFileId}:${version.versionId}`, version), add("entries", conflictEntry.entryId, conflictEntry), add("contentConflictCopies", `p:${conflictCopy.primaryFileId}:${conflictCopy.conflictCopyId}`, conflictCopy), add("pathReservations", `x:${reservation.reservationId}`, reservation)]
  }
  if (intent.kind === "project.file.overwrite-binary") {
    const version = intent.body.version
    if (!recordMatchesContext(version, context, "version", "0") || !facts.verifyBlob(projectIndexRecordDigest(version), version.blob)) return "rejected"
    const existing = [...snapshot.contentFamilies.values()].filter((item) => item.primaryFileId === version.primaryFileId)
    const current = maxBinary(existing)
    if (snapshot.entries.get(version.primaryFileId)?.contentPolicy !== "overwritable-binary" || current === null || version.supersedesVersionIds.length !== 1 || version.supersedesVersionIds[0] !== current.versionId || BigInt(version.binaryLogicalCounter ?? "0") !== BigInt(current.binaryLogicalCounter ?? "0") + 1n) return "rejected"
    return [add("contentFamilies", `v:${version.primaryFileId}:${version.versionId}`, version)]
  }
  if (intent.kind === "project.canvas.route.stage") {
    const stage = intent.body.stage
    const key = `r:${stage.canvasId}:${stage.transitionId}`
    if (
      !routeGuardsEqual(snapshot, context, intent.guards, stage.canvasId, key) ||
      !recordMatchesContext(stage, context, "route-transition", "1") ||
      stage.canvasId !== deriveProjectIdentity(context, "canvas", "0" as Uint32) ||
      routeFacts(snapshot, stage.canvasId).length > 0
    ) return "rejected"
    return [add("canvasRoutes", key, stage)]
  }
  if (intent.kind === "project.canvas.route.activate") {
    const activation = intent.body.activation
    const key = `r:${activation.canvasId}:${activation.transitionId}`
    const route = projectCanvasRouteProjection(snapshot, activation.canvasId)
    const stages = routeFacts(snapshot, activation.canvasId).filter((fact): fact is CanvasRouteStage => fact.format === "convax.canvas-route-stage")
    const activationChecks = Object.freeze({
      routeGuards: routeGuardsEqual(snapshot, context, intent.guards, activation.canvasId, key),
      staged: route.state === "staged",
      record: recordMatchesContext(activation, context, "route-transition", "0"),
      oneStage: stages.length === 1,
      stageDigest: stages.length === 1 && projectIndexRecordDigest(stages[0]!) === activation.stageRecordDigest,
      shardEpoch: stages.length === 1 && stages[0]!.shardEpoch === activation.shardEpoch,
      canvasGenesis: facts.verifyCanvasGenesis(activation),
    })
    if (Object.values(activationChecks).some((value) => !value)) {
      console.error("ProjectIndex route activation rejected", activationChecks)
      return "rejected"
    }
    return [add("canvasRoutes", key, activation)]
  }
  if (intent.kind === "project.canvas.route.rename") {
    const metadata = intent.body.metadata
    const key = `r:${metadata.canvasId}:${metadata.transitionId}`
    const route = projectCanvasRouteProjection(snapshot, metadata.canvasId)
    if (
      !routeGuardsEqual(snapshot, context, intent.guards, metadata.canvasId, key) ||
      route.state !== "live" ||
      route.currentActivationDigest !== metadata.observedActivationDigest ||
      !recordMatchesContext(metadata, context, "route-transition", "0")
    ) return "rejected"
    return [add("canvasRoutes", key, metadata)]
  }
  if (intent.kind === "project.canvas.route.tombstone") {
    const tombstone = intent.body.tombstone
    const key = `r:${tombstone.canvasId}:${tombstone.transitionId}`
    const route = projectCanvasRouteProjection(snapshot, tombstone.canvasId)
    if (
      !routeGuardsEqual(snapshot, context, intent.guards, tombstone.canvasId, key) ||
      (route.state !== "staged" && route.state !== "live") ||
      route.currentActivationDigest !== tombstone.observedActivationDigest ||
      !recordMatchesContext(tombstone, context, "route-transition", "0")
    ) return "rejected"
    return [add("canvasRoutes", key, tombstone)]
  }
  const body = intent.body
  const resetCommit = body.resetCommit
  const key = `r:${resetCommit.canvasId}:${resetCommit.transitionId}`
  const route = projectCanvasRouteProjection(snapshot, resetCommit.canvasId)
  if (
    !routeGuardsEqual(snapshot, context, intent.guards, resetCommit.canvasId, key) ||
    route.state !== "live" ||
    !recordMatchesContext(resetCommit, context, "route-transition", "0") ||
    !resetBodyBindingsValid(snapshot, context, route, body) ||
    !facts.verifyResetAuthorization(body)
  ) return "rejected"
  return [add("canvasRoutes", key, resetCommit)]
}

function resetBodyBindingsValid(
  snapshot: ProjectIndexSnapshot,
  context: OwnerIntentValidationContext,
  route: ProjectCanvasRouteProjection,
  body: Extract<ProjectIndexIntent, { readonly kind: "project.canvas.route.reset" }>["body"],
): boolean {
  const { resetCommit, routeCasCore, resetClaim, confirmation, approval } = body
  const claim = resetClaim.core
  const confirmationCore = confirmation.core
  const approvalCore = approval.core
  const routeCasCoreDigest = structuredDigest(
    "convax.document-shard-reset-route-cas-core-digest",
    routeCasCore,
  )
  const projectIndexScope = parseProjectIndexScope(context.scope)
  const sameScopes =
    encodeEqual(routeCasCore.oldScope, claim.oldScope) &&
    encodeEqual(routeCasCore.oldScope, confirmationCore.oldScope) &&
    encodeEqual(routeCasCore.oldScope, approvalCore.oldScope) &&
    encodeEqual(routeCasCore.newScope, claim.newScope) &&
    encodeEqual(routeCasCore.newScope, confirmationCore.newScope) &&
    encodeEqual(routeCasCore.newScope, approvalCore.newScope)
  const sameReason =
    claim.reason === confirmationCore.reason && claim.reason === approvalCore.reason
  const sameProject =
    encodeEqual(claim.projectIndexScope, projectIndexScope) &&
    routeCasCore.oldScope.projectId === projectIndexScope.projectId &&
    routeCasCore.oldScope.projectEpoch === projectIndexScope.projectEpoch &&
    confirmationCore.projectId === projectIndexScope.projectId &&
    confirmationCore.projectEpoch === projectIndexScope.projectEpoch &&
    approvalCore.projectId === projectIndexScope.projectId &&
    approvalCore.projectEpoch === projectIndexScope.projectEpoch
  const sameInitiator =
    claim.initiatorMemberId === confirmationCore.initiatorMemberId &&
    claim.initiatorReplicaId === confirmationCore.initiatorReplicaId &&
    claim.initiatorActorId === confirmationCore.initiatorActorId
  const sameGenesis =
    routeCasCore.stagedGenesisCheckpointObjectDigest === resetCommit.stagedGenesisCheckpointObjectDigest &&
    routeCasCore.stagedGenesisCheckpointObjectDigest === claim.stagedGenesisCheckpointObjectDigest &&
    routeCasCore.stagedGenesisCheckpointObjectDigest === confirmationCore.stagedGenesisCheckpointObjectDigest &&
    routeCasCore.stagedGenesisFullUpdateDigest === resetCommit.stagedGenesisFullUpdateDigest &&
    routeCasCore.stagedGenesisFullUpdateDigest === claim.stagedGenesisFullUpdateDigest &&
    routeCasCore.stagedGenesisFullUpdateDigest === confirmationCore.stagedGenesisFullUpdateDigest &&
    routeCasCore.stagedGenesisStateVectorDigest === resetCommit.stagedGenesisStateVectorDigest &&
    routeCasCore.stagedGenesisStateVectorDigest === claim.stagedGenesisStateVectorDigest &&
    routeCasCore.stagedGenesisStateVectorDigest === confirmationCore.stagedGenesisStateVectorDigest
  const transition = snapshot.canvasRoutes.get(`r:${resetCommit.canvasId}:${resetCommit.transitionId}`)
  return transition === undefined &&
    route.currentActivationDigest !== null &&
    route.currentShardEpoch !== null &&
    routeCasCore.operationId === context.operationId &&
    routeCasCore.canvasId === resetCommit.canvasId &&
    routeCasCore.oldScope.docId === resetCommit.canvasId &&
    routeCasCore.newScope.docId === resetCommit.canvasId &&
    routeCasCore.oldScope.shardEpoch === resetCommit.oldShardEpoch &&
    routeCasCore.newScope.shardEpoch === resetCommit.newShardEpoch &&
    route.currentShardEpoch === resetCommit.oldShardEpoch &&
    route.currentActivationDigest === resetCommit.predecessorActivationDigest &&
    routeCasCore.predecessorActivationDigest === resetCommit.predecessorActivationDigest &&
    confirmationCore.predecessorActivationDigest === resetCommit.predecessorActivationDigest &&
    sameScopes && sameReason && sameProject && sameInitiator && sameGenesis &&
    routeCasCoreDigest === claim.routeCasCoreDigest &&
    routeCasCoreDigest === confirmationCore.routeCasCoreDigest &&
    routeCasCoreDigest === approvalCore.routeCasCoreDigest &&
    routeCasCoreDigest === resetCommit.routeCasCoreDigest &&
    confirmation.coreDigest === claim.explicitConfirmationReceiptDigest &&
    approvalCore.resetClaimCoreDigest === resetClaim.coreDigest &&
    approvalCore.confirmationCoreDigest === confirmation.coreDigest &&
    approvalCore.adminCapabilityCoreDigest === claim.adminAuthorizationDigest &&
    approval.coreDigest === resetClaim.adminApprovalDigest &&
    resetCommit.resetClaimCoreDigest === resetClaim.coreDigest &&
    resetCommit.confirmationCoreDigest === confirmation.coreDigest &&
    resetCommit.approvalCoreDigest === approval.coreDigest &&
    claim.adminMemberId === approvalCore.adminMemberId &&
    claim.newProtocolDigest === confirmationCore.protocolDigest &&
    claim.newProtocolDigest === approvalCore.protocolDigest &&
    claim.newProtocolDigest === context.protocolDigest
}

function routeGuardsEqual(
  snapshot: ProjectIndexSnapshot,
  context: OwnerIntentValidationContext,
  actual: readonly ProjectGuardAtom[],
  canvasId: CanvasId,
  insertedRouteKey: string,
): boolean {
  return encodeEqual(actual, routeMutationGuards(snapshot, context, canvasId, insertedRouteKey))
}

function isLiveEntry(snapshot: ProjectIndexSnapshot, entryId: string): boolean {
  return snapshot.entries.has(entryId) && ![...snapshot.entryTombstones.values()].some((fact) => fact.entryId === entryId)
}

function routeFacts(snapshot: ProjectIndexSnapshot, canvasId: CanvasId): CanvasRouteFact[] {
  return [...snapshot.canvasRoutes.values()].filter((fact) => fact.canvasId === canvasId)
}

function recordMatchesContext(record: object, context: OwnerIntentValidationContext, kind: ProjectDerivedIdentityKind, ordinal: string): boolean {
  const stamp = recordStamp(record)
  const id = allocatedRecordIds(record)[0]
  return stamp.actorId === context.actorId && stamp.operationId === context.operationId && stamp.lamport === context.lamport && stamp.writeOrdinal === ordinal && id === deriveProjectIdentity(context, kind, ordinal as Uint32)
}

function allocatedRecordIds(record: object): string[] {
  if ("claimId" in record) return [String(record.claimId)]
  if ("tombstoneId" in record) return [String(record.tombstoneId)]
  if ("versionId" in record && (record as { format?: string }).format === "convax.project-content-version") return [String(record.versionId)]
  if ("conflictCopyId" in record) return [String(record.conflictCopyId)]
  if ("reservationId" in record) return [String(record.reservationId)]
  if ("transitionId" in record) return [String(record.transitionId)]
  if ("entryId" in record) return [String(record.entryId)]
  return []
}

function recordStamp(record: object): PortableStamp {
  const value = "stamp" in record ? record.stamp : "createdStamp" in record ? record.createdStamp : null
  return parsePortableStamp(value)
}

function stampForConstruction(
  context: OwnerIntentConstructionContext,
  writeOrdinal: Uint32 | string,
): PortableStamp {
  return Object.freeze({
    format: "convax.portable-stamp",
    lamport: context.lamport,
    actorId: context.actorId,
    operationId: context.operationId,
    writeOrdinal: parseUint32(writeOrdinal),
  })
}

function requireRouteTitle(value: unknown): string {
  assertBoundedNfcString(value, 1, 512, "Canvas route title")
  return value
}

function routeMutationGuards(
  snapshot: ProjectIndexSnapshot,
  context: OwnerIntentConstructionContext,
  canvasId: CanvasId,
  insertedRouteKey: string,
): readonly ProjectGuardAtom[] {
  const projection = projectCanvasRouteProjection(snapshot, canvasId)
  return sortProjectGuards([
    {
      kind: "route-state",
      canvasId,
      state: projection.state,
      shardEpoch: projection.currentShardEpoch,
      activationDigest: projection.currentActivationDigest,
      projectionDigest: projectCanvasRouteProjectionDigest(projection),
    },
    { kind: "fact-absent", map: "canvasRoutes", key: insertedRouteKey },
    {
      kind: "fact-absent",
      map: "operations",
      key: `o:${context.actorId}:${context.operationId}`,
    },
  ])
}

function projectIndexRequiredGuards(
  snapshot: ProjectIndexSnapshot,
  context: OwnerIntentConstructionContext,
  intent: ProjectIndexIntent,
): readonly ProjectGuardAtom[] {
  if (
    intent.kind === "project.canvas.route.stage" ||
    intent.kind === "project.canvas.route.activate" ||
    intent.kind === "project.canvas.route.rename" ||
    intent.kind === "project.canvas.route.tombstone" ||
    intent.kind === "project.canvas.route.reset"
  ) {
    const record = intent.kind === "project.canvas.route.stage" ? intent.body.stage
      : intent.kind === "project.canvas.route.activate" ? intent.body.activation
        : intent.kind === "project.canvas.route.rename" ? intent.body.metadata
          : intent.kind === "project.canvas.route.tombstone" ? intent.body.tombstone
            : intent.body.resetCommit
    return routeMutationGuards(
      snapshot,
      context,
      record.canvasId,
      `r:${record.canvasId}:${record.transitionId}`,
    )
  }
  const guards: ProjectGuardAtom[] = [operationAbsentGuard(context)]
  if (intent.kind === "project.directory.create") {
    const { entry, location } = intent.body
    guards.push(
      { kind: "entry-absent", entryId: entry.entryId },
      directoryLiveGuard(snapshot, location.parentDirectoryId),
      { kind: "fact-absent", map: "entries", key: entry.entryId },
      { kind: "fact-absent", map: "entryLocations", key: `l:${location.entryId}:${location.claimId}` },
    )
  } else if (intent.kind === "project.file.create") {
    const { entry, location, initialVersion } = intent.body
    guards.push(
      { kind: "entry-absent", entryId: entry.entryId },
      { kind: "fact-absent", map: "entries", key: entry.entryId },
      {
        kind: "fact-absent",
        map: "contentFamilies",
        key: `v:${initialVersion.primaryFileId}:${initialVersion.versionId}`,
      },
    )
    if (location !== null) {
      guards.push(
        directoryLiveGuard(snapshot, location.parentDirectoryId),
        { kind: "fact-absent", map: "entryLocations", key: `l:${location.entryId}:${location.claimId}` },
      )
    }
  } else if (intent.kind === "project.entry.locate") {
    const { location } = intent.body
    guards.push(
      entryLiveGuard(snapshot, location.entryId),
      entryLocationGuard(snapshot, location.entryId),
      directoryLiveGuard(snapshot, location.parentDirectoryId),
      { kind: "fact-absent", map: "entryLocations", key: `l:${location.entryId}:${location.claimId}` },
    )
  } else if (intent.kind === "project.entry.tombstone") {
    const { tombstone } = intent.body
    guards.push(
      entryLiveGuard(snapshot, tombstone.entryId),
      { kind: "fact-absent", map: "entryTombstones", key: `t:${tombstone.entryId}:${tombstone.tombstoneId}` },
    )
  } else if (intent.kind === "project.file.write-text") {
    const { version, conflictEntry, conflictCopy, reservation } = intent.body
    guards.push(
      entryLiveGuard(snapshot, version.primaryFileId),
      familyLiveHeadsGuard(snapshot, version.primaryFileId),
      { kind: "fact-absent", map: "contentFamilies", key: `v:${version.primaryFileId}:${version.versionId}` },
      { kind: "fact-absent", map: "entries", key: conflictEntry.entryId },
      { kind: "fact-absent", map: "contentConflictCopies", key: `p:${conflictCopy.primaryFileId}:${conflictCopy.conflictCopyId}` },
      { kind: "fact-absent", map: "pathReservations", key: `x:${reservation.reservationId}` },
    )
  } else if (intent.kind === "project.file.overwrite-binary") {
    const { version } = intent.body
    guards.push(
      entryLiveGuard(snapshot, version.primaryFileId),
      familyLiveHeadsGuard(snapshot, version.primaryFileId),
      { kind: "fact-absent", map: "contentFamilies", key: `v:${version.primaryFileId}:${version.versionId}` },
    )
  } else {
    fail("guard-construction", "ProjectIndex intent kind is unsupported")
  }
  return sortProjectGuards(guards)
}

function operationAbsentGuard(context: OwnerIntentConstructionContext): ProjectGuardAtom {
  return { kind: "fact-absent", map: "operations", key: `o:${context.actorId}:${context.operationId}` }
}

function entryLiveGuard(snapshot: ProjectIndexSnapshot, entryId: ProjectEntryId): ProjectGuardAtom {
  const entry = snapshot.entries.get(entryId)
  if (!entry || !isLiveEntry(snapshot, entryId)) fail("guard-construction", "Project entry is not live")
  return { kind: "entry-live", entryId, entryDigest: projectIndexRecordDigest(entry) }
}

function directoryLiveGuard(
  snapshot: ProjectIndexSnapshot,
  directoryId: ProjectDirectoryId,
): ProjectGuardAtom {
  const directory = snapshot.entries.get(directoryId)
  if (!directory || directory.kind !== "directory" || !isLiveEntry(snapshot, directoryId)) {
    fail("guard-construction", "Project directory is not live")
  }
  return { kind: "directory-live", directoryId, entryDigest: projectIndexRecordDigest(directory) }
}

function entryLocationGuard(snapshot: ProjectIndexSnapshot, entryId: ProjectEntryId): ProjectGuardAtom {
  const projection = projectEntryLocationProjection(snapshot, entryId)
  return { kind: "entry-location", entryId, projectionDigest: projectEntryLocationProjectionDigest(projection) }
}

function familyLiveHeadsGuard(snapshot: ProjectIndexSnapshot, primaryFileId: ProjectFileId): ProjectGuardAtom {
  const projection = projectContentFamilyProjection(snapshot, primaryFileId)
  return {
    kind: "family-live-heads",
    primaryFileId,
    versionIds: projection.liveHeadVersionIds,
    projectionDigest: projectContentFamilyProjectionDigest(projection),
  }
}

function projectGuardsEqualAndHold(
  snapshot: ProjectIndexSnapshot,
  context: OwnerIntentValidationContext,
  intent: ProjectIndexIntent,
): boolean {
  const expected = projectIndexRequiredGuards(snapshot, context, intent)
  return encodeEqual(intent.guards, expected) && expected.every((guard) => projectGuardHolds(snapshot, guard))
}

function projectGuardHolds(snapshot: ProjectIndexSnapshot, guard: ProjectGuardAtom): boolean {
  if (guard.kind === "entry-absent") return !snapshot.entries.has(guard.entryId)
  if (guard.kind === "entry-live") {
    const entry = snapshot.entries.get(guard.entryId)
    return Boolean(entry && isLiveEntry(snapshot, guard.entryId) && projectIndexRecordDigest(entry) === guard.entryDigest)
  }
  if (guard.kind === "directory-live") {
    const entry = snapshot.entries.get(guard.directoryId)
    return Boolean(entry && entry.kind === "directory" && isLiveEntry(snapshot, guard.directoryId) && projectIndexRecordDigest(entry) === guard.entryDigest)
  }
  if (guard.kind === "entry-location") {
    return projectEntryLocationProjectionDigest(
      projectEntryLocationProjection(snapshot, guard.entryId),
    ) === guard.projectionDigest
  }
  if (guard.kind === "family-live-heads") {
    const projection = projectContentFamilyProjection(snapshot, guard.primaryFileId)
    return encodeEqual(projection.liveHeadVersionIds, guard.versionIds) &&
      projectContentFamilyProjectionDigest(projection) === guard.projectionDigest
  }
  if (guard.kind === "route-state") {
    const projection = projectCanvasRouteProjection(snapshot, guard.canvasId)
    return projection.state === guard.state &&
      projection.currentShardEpoch === guard.shardEpoch &&
      projection.currentActivationDigest === guard.activationDigest &&
      projectCanvasRouteProjectionDigest(projection) === guard.projectionDigest
  }
  return !snapshot[guard.map].has(guard.key)
}

function sortProjectGuards(guards: readonly ProjectGuardAtom[]): readonly ProjectGuardAtom[] {
  return Object.freeze(
    [...guards]
      .map((guard) => freezeJcs(guard))
      .sort((left, right) => {
        const byKind = compareUtf8(left.kind, right.kind)
        if (byKind !== 0) return byKind
        const byPrimary = compareUtf8(projectGuardPrimaryId(left), projectGuardPrimaryId(right))
        if (byPrimary !== 0) return byPrimary
        return compareUint8(encodeRestrictedJcs(left), encodeRestrictedJcs(right))
      }),
  )
}

function projectGuardPrimaryId(guard: ProjectGuardAtom): string {
  if (guard.kind === "entry-absent" || guard.kind === "entry-live" || guard.kind === "entry-location") {
    return guard.entryId
  }
  if (guard.kind === "directory-live") return guard.directoryId
  if (guard.kind === "family-live-heads") return guard.primaryFileId
  if (guard.kind === "route-state") return guard.canvasId
  return `${guard.map}:${guard.key}`
}

function parseProjectGuard(value: unknown): ProjectGuardAtom {
  if (typeof value !== "object" || value === null || typeof (value as { kind?: unknown }).kind !== "string") {
    fail("invalid-guard", "ProjectIndex guard is invalid")
  }
  const guard = value as Record<string, unknown>
  if (guard.kind === "entry-absent") {
    assertExactKeys(guard, ["kind", "entryId"], "entry-absent guard")
    return freezeJcs({ kind: guard.kind, entryId: parseProjectEntryId(guard.entryId) })
  }
  if (guard.kind === "entry-live") {
    assertExactKeys(guard, ["kind", "entryId", "entryDigest"], "entry-live guard")
    return freezeJcs({
      kind: guard.kind,
      entryId: parseProjectEntryId(guard.entryId),
      entryDigest: parseDigest(guard.entryDigest),
    })
  }
  if (guard.kind === "entry-location") {
    assertExactKeys(guard, ["kind", "entryId", "projectionDigest"], "entry-location guard")
    return freezeJcs({
      kind: guard.kind,
      entryId: parseProjectEntryId(guard.entryId),
      projectionDigest: parseDigest(guard.projectionDigest),
    })
  }
  if (guard.kind === "directory-live") {
    assertExactKeys(guard, ["kind", "directoryId", "entryDigest"], "directory-live guard")
    return freezeJcs({
      kind: guard.kind,
      directoryId: parseProjectDirectoryId(guard.directoryId),
      entryDigest: parseDigest(guard.entryDigest),
    })
  }
  if (guard.kind === "family-live-heads") {
    assertExactKeys(
      guard,
      ["kind", "primaryFileId", "versionIds", "projectionDigest"],
      "family-live-heads guard",
    )
    assertDenseArray(guard.versionIds, "family-live-heads version ids")
    if (guard.versionIds.length > 256) fail("invalid-guard", "family-live-heads exceeds its bound")
    const versionIds = guard.versionIds.map(parseVersionId)
    if (versionIds.some((id, index) => index > 0 && compareUtf8(versionIds[index - 1]!, id) >= 0)) {
      fail("invalid-guard", "family-live-heads version ids are not strict sorted unique")
    }
    return freezeJcs({
      kind: guard.kind,
      primaryFileId: parseProjectFileId(guard.primaryFileId),
      versionIds: Object.freeze(versionIds),
      projectionDigest: parseDigest(guard.projectionDigest),
    })
  }
  if (guard.kind === "route-state") {
    assertExactKeys(
      guard,
      ["kind", "canvasId", "state", "shardEpoch", "activationDigest", "projectionDigest"],
      "route-state guard",
    )
    if (
      guard.state !== "absent" &&
      guard.state !== "staged" &&
      guard.state !== "live" &&
      guard.state !== "tombstoned"
    ) {
      fail("invalid-guard", "route-state guard state is invalid")
    }
    const shardEpoch = guard.shardEpoch === null ? null : parseId128(guard.shardEpoch)
    const activationDigest =
      guard.activationDigest === null ? null : parseDigest(guard.activationDigest)
    if (
      (guard.state === "live" && (shardEpoch === null || activationDigest === null)) ||
      (guard.state === "staged" && (shardEpoch === null || activationDigest !== null)) ||
      ((guard.state === "absent" || guard.state === "tombstoned") &&
        (shardEpoch !== null || activationDigest !== null))
    ) {
      fail("invalid-guard", "route-state guard fields disagree with its state")
    }
    return freezeJcs({
      kind: guard.kind,
      canvasId: parseCanvasId(guard.canvasId),
      state: guard.state,
      shardEpoch,
      activationDigest,
      projectionDigest: parseDigest(guard.projectionDigest),
    })
  }
  if (guard.kind === "fact-absent") {
    assertExactKeys(guard, ["kind", "map", "key"], "fact-absent guard")
    if (
      typeof guard.map !== "string" ||
      guard.map === "identity" ||
      !PROJECT_INDEX_ROOT_KEYS.includes(guard.map as (typeof PROJECT_INDEX_ROOT_KEYS)[number]) ||
      typeof guard.key !== "string" ||
      guard.key.length < 1 ||
      new TextEncoder().encode(guard.key).byteLength > 1024 ||
      guard.key.includes("/")
    ) {
      fail("invalid-guard", "fact-absent guard is invalid")
    }
    return freezeJcs({
      kind: guard.kind,
      map: guard.map as Exclude<(typeof PROJECT_INDEX_ROOT_KEYS)[number], "identity">,
      key: guard.key,
    })
  }
  fail("invalid-guard", "ProjectIndex guard kind is unknown")
}

function projectFamilies(snapshot: ProjectIndexSnapshot, tombstoned: ReadonlySet<string>): ProjectContentFamilyView[] {
  const byFamily = new Map<string, ProjectContentVersionRecord[]>()
  for (const version of snapshot.contentFamilies.values()) {
    const list = byFamily.get(version.primaryFileId) ?? []
    list.push(version)
    byFamily.set(version.primaryFileId, list)
  }
  const result: ProjectContentFamilyView[] = []
  for (const [primaryFileId, versions] of byFamily) {
    const entry = snapshot.entries.get(primaryFileId)
    const superseded = new Set(versions.flatMap((version) => [...version.supersedesVersionIds]))
    const live = versions.filter((version) => !superseded.has(version.versionId)).sort((left, right) => compareUtf8(left.versionId, right.versionId))
    let current: ProjectContentVersionRecord | null = null
    if (!tombstoned.has(primaryFileId)) {
      if (entry?.contentPolicy === "overwritable-binary") current = maxBinary(versions)
      else if (entry?.contentPolicy === "immutable") current = versions[0] ?? null
      else current = maxStamp(live)
    }
    const active = entry?.contentPolicy === "conflict-preserving-text" ? activeConflictCopies(snapshot, versions) : []
    const currentResourceReference = current === null ? null : resourceReference(snapshot.identity, current, current.primaryFileId)
    result.push(Object.freeze({
      primaryFileId: parseProjectFileId(primaryFileId),
      contentPolicy: entry?.contentPolicy ?? null,
      versionIds: Object.freeze(versions.map((item) => item.versionId).sort(compareUtf8)),
      liveHeadVersionIds: Object.freeze(live.map((item) => item.versionId)),
      currentVersionId: current?.versionId ?? null,
      currentResourceReference,
      currentResourceReferenceDigest: currentResourceReference === null ? null : projectIndexResourceReferenceDigest(currentResourceReference),
      activeConflictFileIds: Object.freeze(active),
    }))
  }
  return result.sort((left, right) => compareUtf8(left.primaryFileId, right.primaryFileId))
}

function resourceReference(
  identity: ProjectIndexIdentityRecord,
  version: ProjectContentVersionRecord,
  entryFileId: ProjectFileId,
): ProjectIndexResourceReference {
  const parsed = parseProjectUri(version.canonicalRevisionUri)
  if (
    parsed.projectId !== identity.projectId || parsed.projectEpoch !== identity.projectEpoch ||
    parsed.entryId !== version.primaryFileId || parsed.blob !== `sha256:${version.blob.digest}`
  ) fail("invalid-uri", "Current resource URI does not bind Project identity, family and blob")
  return Object.freeze({
    format: "convax.project-resource-reference",
    projectId: identity.projectId,
    projectEpoch: identity.projectEpoch,
    entryFileId,
    familyPrimaryFileId: version.primaryFileId,
    versionId: version.versionId,
    canonicalUri: version.canonicalRevisionUri,
    blob: version.blob,
    versionRecordDigest: projectIndexRecordDigest(version),
  })
}

function activeConflictCopies(snapshot: ProjectIndexSnapshot, versions: readonly ProjectContentVersionRecord[]): ProjectFileId[] {
  const result = new Set<ProjectFileId>()
  for (const source of versions) {
    if (source.writeClass !== "text-write") continue
    const activated = versions.some((other) => comparePortableStamps(other.stamp, source.stamp) > 0 && !reaches(versions, other.versionId, source.versionId) && !reaches(versions, source.versionId, other.versionId))
    if (!activated) continue
    for (const conflictCopy of snapshot.contentConflictCopies.values()) if (conflictCopy.primaryFileId === source.primaryFileId && conflictCopy.versionId === source.versionId) result.add(conflictCopy.reservedConflictFileId)
  }
  return [...result].sort(compareUtf8)
}

function reaches(versions: readonly ProjectContentVersionRecord[], descendant: string, ancestor: string, seen = new Set<string>()): boolean {
  if (descendant === ancestor) return true
  if (seen.has(descendant)) return false
  seen.add(descendant)
  const record = versions.find((item) => item.versionId === descendant)
  return record?.supersedesVersionIds.some((parent) => reaches(versions, parent, ancestor, seen)) ?? false
}

function maxBinary(versions: readonly ProjectContentVersionRecord[]): ProjectContentVersionRecord | null {
  return [...versions].sort((left, right) => {
    const counter = BigInt(left.binaryLogicalCounter ?? "0") - BigInt(right.binaryLogicalCounter ?? "0")
    if (counter !== 0n) return counter < 0n ? -1 : 1
    const actor = compareDecodedBase64url(left.creatorActorId, right.creatorActorId)
    return actor === 0 ? compareUtf8(left.versionId, right.versionId) : actor
  }).at(-1) ?? null
}

function maxStamp<T extends { readonly stamp: PortableStamp }>(records: readonly T[]): T | null {
  return [...records].sort((left, right) => comparePortableStamps(left.stamp, right.stamp)).at(-1) ?? null
}

export function projectCanvasRouteProjection(
  snapshot: ProjectIndexSnapshot,
  canvasIdInput: CanvasId,
): ProjectCanvasRouteProjection {
  const canvasId = parseCanvasId(canvasIdInput)
  const facts = routeFacts(snapshot, canvasId)
  if (facts.length === 0) {
    return Object.freeze({
      format: "convax.project-route-projection",
      canvasId,
      state: "absent",
      stageRecordDigest: null,
      ancestryRecordDigests: Object.freeze([]),
      currentActivationDigest: null,
      currentShardEpoch: null,
      currentTitle: null,
      currentTitleRecordDigest: null,
      currentTombstoneRecordDigest: null,
    })
  }
  const tombstones = facts.filter(
    (fact): fact is CanvasRouteTombstone => fact.format === "convax.canvas-route-tombstone",
  )
  const tombstone = maxStamp(tombstones)
  if (tombstone !== null) {
    return Object.freeze({
      format: "convax.project-route-projection",
      canvasId,
      state: "tombstoned",
      stageRecordDigest: null,
      ancestryRecordDigests: Object.freeze([]),
      currentActivationDigest: null,
      currentShardEpoch: null,
      currentTitle: null,
      currentTitleRecordDigest: null,
      currentTombstoneRecordDigest: projectIndexRecordDigest(tombstone),
    })
  }
  const stages = facts.filter(
    (fact): fact is CanvasRouteStage => fact.format === "convax.canvas-route-stage",
  )
  if (stages.length !== 1) fail("invalid-route", "Canvas route must contain exactly one stage")
  const stage = stages[0]!
  const stageRecordDigest = projectIndexRecordDigest(stage)
  const activations = facts.filter(
    (fact): fact is CanvasRouteActivation => fact.format === "convax.canvas-route-activation",
  )
  for (const activation of activations) {
    if (
      activation.predecessorActivationDigest !== null ||
      activation.stageRecordDigest !== stageRecordDigest ||
      activation.shardEpoch !== stage.shardEpoch
    ) {
      fail("invalid-route", "Canvas activation does not bind its unique stage")
    }
  }
  const resets = facts.filter(
    (fact): fact is CanvasRouteResetCommit => fact.format === "convax.canvas-route-reset-commit",
  )
  const transitionByDigest = new Map<
    Digest,
    CanvasRouteActivation | CanvasRouteResetCommit
  >()
  for (const transition of [...activations, ...resets]) {
    transitionByDigest.set(projectIndexRecordDigest(transition), transition)
  }
  for (const reset of resets) {
    const predecessor = transitionByDigest.get(reset.predecessorActivationDigest)
    const predecessorEpoch =
      predecessor?.format === "convax.canvas-route-activation"
        ? predecessor.shardEpoch
        : predecessor?.newShardEpoch
    if (
      predecessor === undefined ||
      predecessorEpoch !== reset.oldShardEpoch ||
      reset.newShardEpoch === reset.oldShardEpoch
    ) {
      fail("invalid-route", "Canvas reset does not bind a valid predecessor transition")
    }
  }
  const currentTransition = maxStamp([...activations, ...resets])
  const ancestryRecordDigests = Object.freeze(
    currentTransition === null
      ? [stageRecordDigest]
      : routeTransitionAncestry(currentTransition, transitionByDigest, stageRecordDigest),
  )
  const currentActivationDigest =
    currentTransition === null ? null : projectIndexRecordDigest(currentTransition)
  const metadata = maxStamp(
    facts.filter(
      (fact): fact is CanvasRouteMetadataClaim =>
        fact.format === "convax.canvas-route-metadata" &&
        ancestryRecordDigests.includes(fact.observedActivationDigest),
    ),
  )
  return Object.freeze({
    format: "convax.project-route-projection",
    canvasId,
    state: currentTransition === null ? "staged" : "live",
    stageRecordDigest,
    ancestryRecordDigests,
    currentActivationDigest,
    currentShardEpoch:
      currentTransition?.format === "convax.canvas-route-activation"
        ? currentTransition.shardEpoch
        : currentTransition?.newShardEpoch ?? stage.shardEpoch,
    currentTitle: metadata?.title ?? stage.title,
    currentTitleRecordDigest:
      metadata === null ? stageRecordDigest : projectIndexRecordDigest(metadata),
    currentTombstoneRecordDigest: null,
  })
}

function routeTransitionAncestry(
  head: CanvasRouteActivation | CanvasRouteResetCommit,
  transitions: ReadonlyMap<Digest, CanvasRouteActivation | CanvasRouteResetCommit>,
  stageRecordDigest: Digest,
): Digest[] {
  const reverse: Digest[] = []
  const seen = new Set<Digest>()
  let current: CanvasRouteActivation | CanvasRouteResetCommit | undefined = head
  while (current !== undefined) {
    const digest = projectIndexRecordDigest(current)
    if (seen.has(digest)) fail("invalid-route", "Canvas route transition ancestry contains a cycle")
    seen.add(digest)
    reverse.push(digest)
    if (current.format === "convax.canvas-route-activation") break
    current = transitions.get(current.predecessorActivationDigest)
  }
  if (current?.format !== "convax.canvas-route-activation") {
    fail("invalid-route", "Canvas route transition ancestry does not reach its activation")
  }
  return [stageRecordDigest, ...reverse.reverse()]
}

function projectRoutes(snapshot: ProjectIndexSnapshot): ProjectCanvasRouteProjection[] {
  const grouped = new Map<CanvasId, CanvasRouteFact[]>()
  for (const fact of snapshot.canvasRoutes.values()) {
    const list = grouped.get(fact.canvasId) ?? []
    list.push(fact)
    grouped.set(fact.canvasId, list)
  }
  const result = [...grouped.keys()].map((canvasId) => projectCanvasRouteProjection(snapshot, canvasId))
  return result.sort((left, right) => compareUtf8(left.canvasId, right.canvasId))
}

function tombstonedEntries(snapshot: ProjectIndexSnapshot): Set<string> {
  return new Set([...snapshot.entryTombstones.values()].map((fact) => fact.entryId))
}

function validateRelations(snapshot: ProjectIndexSnapshot): void {
  for (const claim of snapshot.entryLocations.values()) {
    if (!snapshot.entries.has(claim.entryId)) fail("dangling-location", "Location names an absent entry")
    const parent = snapshot.entries.get(claim.parentDirectoryId)
    if (!parent || parent.kind !== "directory") fail("invalid-location-parent", "Location parent is not a directory")
  }
  for (const tombstone of snapshot.entryTombstones.values()) {
    const entry = snapshot.entries.get(tombstone.entryId)
    if (!entry || projectIndexRecordDigest(entry) !== tombstone.observedEntryDigest) fail("invalid-tombstone", "Entry tombstone does not bind the accepted entry")
  }
  const byFamily = new Map<string, ProjectContentVersionRecord[]>()
  for (const version of snapshot.contentFamilies.values()) {
    const entry = snapshot.entries.get(version.primaryFileId)
    if (!entry || entry.kind !== "file" || entry.provenance === "content-conflict-copy") fail("invalid-family", "Content family has no primary file")
    if ((entry.contentPolicy === "immutable" && version.writeClass !== "initial") || (entry.contentPolicy === "conflict-preserving-text" && version.writeClass === "binary-overwrite") || (entry.contentPolicy === "overwritable-binary" && version.writeClass === "text-write")) fail("policy-mismatch", "Content version violates its file policy")
    const list = byFamily.get(version.primaryFileId) ?? []
    list.push(version); byFamily.set(version.primaryFileId, list)
  }
  for (const [family, versions] of byFamily) validateVersionDag(family, versions)
  for (const conflictCopy of snapshot.contentConflictCopies.values()) {
    const version = snapshot.contentFamilies.get(`v:${conflictCopy.primaryFileId}:${conflictCopy.versionId}`)
    const reservation = snapshot.pathReservations.get(`x:${conflictCopy.reservationId}`)
    const conflict = snapshot.entries.get(conflictCopy.reservedConflictFileId)
    if (!version || !reservation || !conflict || conflict.provenance !== "content-conflict-copy" || reservation.reservedEntryId !== conflictCopy.reservedConflictFileId) fail("invalid-conflict-copy", "Conflict-copy records do not cross-bind")
  }
  for (const canvasId of new Set([...snapshot.canvasRoutes.values()].map((fact) => fact.canvasId))) {
    projectCanvasRouteProjection(snapshot, canvasId)
  }
}

function validateVersionDag(family: string, versions: readonly ProjectContentVersionRecord[]): void {
  const ids = new Set(versions.map((item) => item.versionId))
  for (const version of versions) {
    if (version.writeClass === "initial" && version.supersedesVersionIds.length !== 0) fail("invalid-version-dag", "Initial version supersedes another version")
    if (version.writeClass !== "initial" && version.supersedesVersionIds.length < 1) fail("invalid-version-dag", "A write must bind its exact base heads")
    if (version.supersedesVersionIds.some((id) => !ids.has(id))) fail("invalid-version-dag", `Version in ${family} names a missing parent`)
    if (reaches(versions, version.versionId, version.versionId, new Set([version.versionId]))) {
      for (const parent of version.supersedesVersionIds) if (reaches(versions, parent, version.versionId)) fail("invalid-version-dag", "Content version DAG contains a cycle")
    }
  }
}

function parseIntent(value: unknown): ProjectIndexIntent {
  assertExactKeys(value, ["format", "kind", "guards", "body"], "ProjectIndexIntent")
  if (value.format !== "convax.typed-intent" || typeof value.kind !== "string" || !INTENT_KINDS.has(value.kind as ProjectIndexIntentKind)) fail("invalid-intent", "ProjectIndex intent tag is invalid")
  assertDenseArray(value.guards, "ProjectIndex guards")
  if (value.guards.length > 64) fail("invalid-guard", "ProjectIndex guards exceed their bound")
  const guards = value.guards.map(parseProjectGuard)
  const canonicalGuards = sortProjectGuards(guards)
  if (canonicalGuards.some((guard, index) => index > 0 && encodeEqual(canonicalGuards[index - 1], guard))) {
    fail("invalid-guard", "ProjectIndex guards must be duplicate-free")
  }
  if (!encodeEqual(guards, canonicalGuards)) {
    fail("invalid-guard", "ProjectIndex guards must be strict sorted and duplicate-free")
  }
  const intent = { ...value, guards: canonicalGuards } as unknown as ProjectIndexIntent
  const body = value.body
  if (intent.kind === "project.directory.create") { assertExactKeys(body, ["entry", "location"], "directory body"); parseEntry(body.entry); parseLocation(body.location) }
  else if (intent.kind === "project.file.create") { assertExactKeys(body, ["entry", "location", "initialVersion"], "file body"); parseEntry(body.entry); if (body.location !== null) parseLocation(body.location); parseContentVersionWithoutIdentity(body.initialVersion) }
  else if (intent.kind === "project.entry.locate") { assertExactKeys(body, ["location"], "locate body"); parseLocation(body.location) }
  else if (intent.kind === "project.entry.tombstone") { assertExactKeys(body, ["tombstone"], "entry tombstone body"); parseEntryTombstone(body.tombstone) }
  else if (intent.kind === "project.file.write-text") { assertExactKeys(body, ["version", "conflictEntry", "conflictCopy", "reservation"], "text body"); parseContentVersionWithoutIdentity(body.version); parseEntry(body.conflictEntry); parseConflictCopy(body.conflictCopy); parseReservation(body.reservation) }
  else if (intent.kind === "project.file.overwrite-binary") { assertExactKeys(body, ["version"], "binary body"); parseContentVersionWithoutIdentity(body.version) }
  else if (intent.kind === "project.canvas.route.stage") { assertExactKeys(body, ["stage"], "stage body"); parseCanvasRoute(body.stage) }
  else if (intent.kind === "project.canvas.route.activate") { assertExactKeys(body, ["activation"], "activation body"); parseCanvasRoute(body.activation) }
  else if (intent.kind === "project.canvas.route.rename") { assertExactKeys(body, ["metadata"], "rename body"); parseCanvasRoute(body.metadata) }
  else if (intent.kind === "project.canvas.route.tombstone") { assertExactKeys(body, ["tombstone"], "route tombstone body"); parseCanvasRoute(body.tombstone) }
  else {
    assertExactKeys(
      body,
      ["resetCommit", "routeCasCore", "resetClaim", "confirmation", "approval"],
      "route reset body",
    )
    parseCanvasRoute(body.resetCommit)
    parseDocumentShardResetRouteCasCore(body.routeCasCore)
    parseDocumentShardResetClaim(body.resetClaim)
    parseDocumentShardResetConfirmation(body.confirmation)
    parseDocumentShardResetApproval(body.approval)
  }
  return freezeJcs(intent)
}

const INTENT_KINDS = new Set<ProjectIndexIntentKind>([
  "project.directory.create", "project.file.create", "project.entry.locate", "project.entry.tombstone", "project.file.write-text", "project.file.overwrite-binary", "project.canvas.route.stage", "project.canvas.route.activate", "project.canvas.route.rename", "project.canvas.route.tombstone", "project.canvas.route.reset",
])

function parseIdentity(value: unknown): ProjectIndexIdentityRecord {
  assertExactKeys(value, ["format", "schema", "projectId", "projectEpoch", "shardEpoch", "rootDirectoryId", "protocolDigest", "schemaDigest", "uriProtocolDigest"], "ProjectIndex identity")
  if (value.format !== "convax.project-index-identity" || value.schema !== "convax.project-index.v2") fail("invalid-identity", "ProjectIndex identity is not v2")
  const identity = value as unknown as ProjectIndexIdentityRecord
  parseProjectId(identity.projectId); parseId128(identity.projectEpoch); parseId128(identity.shardEpoch); parseProjectDirectoryId(identity.rootDirectoryId); parseDigest(identity.protocolDigest); parseDigest(identity.schemaDigest); parseDigest(identity.uriProtocolDigest)
  if (identity.schemaDigest !== PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST) fail("schema-mismatch", "ProjectIndex identity does not bind the current protocol artifact")
  return freezeJcs(identity)
}

function parseEntry(value: unknown): ProjectEntryRecord {
  assertExactKeys(value, ["format", "entryId", "kind", "storageClass", "contentPolicy", "provenance", "conflictSource", "createdByActorId", "createdByOperationId", "createdStamp"], "Project entry")
  const record = value as unknown as ProjectEntryRecord
  if (record.format !== "convax.project-entry") fail("invalid-entry", "Project entry format is invalid")
  parseProjectEntryId(record.entryId); parseActorId(record.createdByActorId); parseId128(record.createdByOperationId); parsePortableStamp(record.createdStamp)
  if ((record.kind === "directory") !== record.entryId.startsWith("pd_")) fail("invalid-entry", "Project entry kind/id differ")
  if (record.kind === "directory" ? record.storageClass !== null || record.contentPolicy !== "none" : record.storageClass === null || record.contentPolicy === "none") fail("invalid-entry", "Project entry storage/content policy is invalid")
  if (record.provenance === "content-conflict-copy") { if (record.conflictSource === null) fail("invalid-entry", "Conflict copy lacks source"); parseConflictSource(record.conflictSource) }
  else if (record.conflictSource !== null) fail("invalid-entry", "Ordinary entry has conflict source")
  return freezeJcs(record)
}

function parseConflictSource(value: unknown): void {
  assertExactKeys(value, ["primaryFileId", "sourceVersionId", "conflictCopyId", "reservationId"], "Conflict source")
  parseProjectFileId(value.primaryFileId); parseVersionId(value.sourceVersionId); parseFactId(value.conflictCopyId, "pp"); parseFactId(value.reservationId, "pr")
}

function parseLocation(value: unknown): ProjectEntryLocationClaim {
  assertExactKeys(value, ["format", "claimId", "entryId", "state", "parentDirectoryId", "basename", "reason", "stamp"], "Project location")
  const record = value as unknown as ProjectEntryLocationClaim
  if (record.format !== "convax.project-entry-location") fail("invalid-location", "Project location format is invalid")
  parseFactId(record.claimId, "pl"); parseProjectEntryId(record.entryId); parseProjectDirectoryId(record.parentDirectoryId); assertPortableBasename(record.basename); parsePortableStamp(record.stamp)
  if (!(["linked", "declared-missing"] as unknown[]).includes(record.state) || !(["create", "move", "rename", "explicit-relink", "explicit-missing"] as unknown[]).includes(record.reason)) fail("invalid-location", "Project location union is invalid")
  return freezeJcs(record)
}

function parseEntryTombstone(value: unknown): ProjectEntryTombstone {
  assertExactKeys(value, ["format", "tombstoneId", "entryId", "reason", "observedEntryDigest", "stamp"], "Project entry tombstone")
  const record = value as unknown as ProjectEntryTombstone
  if (record.format !== "convax.project-entry-tombstone" || record.reason !== "explicit-delete") fail("invalid-tombstone", "Project tombstone is invalid")
  parseFactId(record.tombstoneId, "pt"); parseProjectEntryId(record.entryId); parseDigest(record.observedEntryDigest); parsePortableStamp(record.stamp)
  return freezeJcs(record)
}

function parseBlob(value: unknown): ProjectBlobRef {
  assertExactKeys(value, ["format", "algorithm", "digest", "byteLength", "mime"], "Project blob ref")
  const blob = value as unknown as ProjectBlobRef
  if (blob.format !== "convax.blob-ref" || blob.algorithm !== "sha256") fail("invalid-blob", "Blob ref format is invalid")
  parseDigest(blob.digest); parseUint64(blob.byteLength)
  if (typeof blob.mime !== "string" || !MIME.test(blob.mime) || encoder.encode(blob.mime).byteLength > 255) fail("invalid-blob", "Blob MIME is invalid")
  return freezeJcs(blob)
}

function parseContentVersionWithoutIdentity(value: unknown): ProjectContentVersionRecord {
  return parseContentVersion(value)
}

function parseContentVersion(value: unknown, identity?: ProjectIndexIdentityRecord): ProjectContentVersionRecord {
  assertExactKeys(value, ["format", "primaryFileId", "versionId", "writeClass", "blob", "canonicalRevisionUri", "supersedesVersionIds", "binaryLogicalCounter", "creatorActorId", "creatorOperationId", "stamp"], "Project content version")
  const record = value as unknown as ProjectContentVersionRecord
  if (record.format !== "convax.project-content-version") fail("invalid-version", "Content version format is invalid")
  parseProjectFileId(record.primaryFileId); parseVersionId(record.versionId); parseBlob(record.blob); parseActorId(record.creatorActorId); parseId128(record.creatorOperationId); parsePortableStamp(record.stamp)
  assertDenseArray(record.supersedesVersionIds, "Superseded versions")
  if (record.supersedesVersionIds.length > 256) fail("invalid-version", "Superseded versions exceed their bound")
  const parents = record.supersedesVersionIds.map(parseVersionId)
  if (!isStrictSorted(parents, compareUtf8)) fail("invalid-version", "Superseded versions must be sorted unique")
  if (record.binaryLogicalCounter !== null) parseUint64(record.binaryLogicalCounter)
  if (record.writeClass === "initial" && record.binaryLogicalCounter !== null && record.binaryLogicalCounter !== "0") fail("invalid-version", "Binary initial counter must be zero")
  if (record.writeClass === "text-write" && record.binaryLogicalCounter !== null) fail("invalid-version", "Text write has a binary counter")
  if (record.writeClass === "binary-overwrite" && record.binaryLogicalCounter === null) fail("invalid-version", "Binary overwrite lacks a counter")
  if (canonicalize(record.canonicalRevisionUri) !== record.canonicalRevisionUri) fail("invalid-uri", "Revision URI is not canonical")
  const uri = parseProjectUri(record.canonicalRevisionUri)
  if (uri.entryId !== record.primaryFileId || uri.blob !== `sha256:${record.blob.digest}` || (identity && (uri.projectId !== identity.projectId || uri.projectEpoch !== identity.projectEpoch))) fail("invalid-uri", "Revision URI does not bind the version family/blob")
  return freezeJcs(record)
}

function parseConflictCopy(value: unknown): ProjectContentConflictCopyRecord {
  assertExactKeys(value, ["format", "conflictCopyId", "primaryFileId", "versionId", "reservedConflictFileId", "reservationId", "stamp"], "Project conflictCopy")
  const record = value as unknown as ProjectContentConflictCopyRecord
  if (record.format !== "convax.project-content-conflict-copy") fail("invalid-conflict-copy", "Promotion format is invalid")
  parseFactId(record.conflictCopyId, "pp"); parseProjectFileId(record.primaryFileId); parseVersionId(record.versionId); parseProjectFileId(record.reservedConflictFileId); parseFactId(record.reservationId, "pr"); parsePortableStamp(record.stamp)
  return freezeJcs(record)
}

function parseReservation(value: unknown): ProjectPathReservationRecord {
  assertExactKeys(value, ["format", "reservationId", "kind", "primaryFileId", "versionId", "reservedEntryId", "canonicalPath", "originalBasenameHint", "stamp"], "Project reservation")
  const record = value as unknown as ProjectPathReservationRecord
  if (record.format !== "convax.project-path-reservation" || record.kind !== "content-conflict-copy") fail("invalid-reservation", "Reservation format is invalid")
  parseFactId(record.reservationId, "pr"); parseProjectFileId(record.primaryFileId); parseVersionId(record.versionId); parseProjectFileId(record.reservedEntryId); parsePortableStamp(record.stamp); assertPortableBasename(record.originalBasenameHint)
  if (record.canonicalPath !== `.convax-conflicts/${record.reservedEntryId}/content`) fail("invalid-reservation", "Conflict reservation path is not canonical")
  return freezeJcs(record)
}

function parseCanvasRoute(value: unknown): CanvasRouteFact {
  if (typeof value !== "object" || value === null || !("format" in value)) fail("invalid-route", "Canvas route fact is invalid")
  const format = (value as { format?: unknown }).format
  if (format === "convax.canvas-route-stage") {
    assertExactKeys(value, ["format", "transitionId", "canvasId", "shardEpoch", "title", "reason", "stamp"], "Canvas route stage")
    const record = value as unknown as CanvasRouteStage; parseFactId(record.transitionId, "cr"); parseCanvasId(record.canvasId); parseId128(record.shardEpoch); assertBoundedNfcString(record.title, 1, 512, "Canvas title"); parsePortableStamp(record.stamp); if (record.reason !== "create") fail("invalid-route", "Stage reason is invalid"); return freezeJcs(record)
  }
  if (format === "convax.canvas-route-activation") {
    assertExactKeys(value, ["format", "transitionId", "canvasId", "shardEpoch", "predecessorActivationDigest", "stageRecordDigest", "projectIndexRouteDependencyFrameDigest", "canvasGenesisCheckpointObjectDigest", "stagedProjectIndexFrontierDigest", "stamp"], "Canvas route activation")
    const record = value as unknown as CanvasRouteActivation; parseFactId(record.transitionId, "cr"); parseCanvasId(record.canvasId); parseId128(record.shardEpoch); if (record.predecessorActivationDigest !== null) fail("invalid-route", "Initial activation predecessor is not null"); parseDigest(record.stageRecordDigest); parseDigest(record.projectIndexRouteDependencyFrameDigest); parseDigest(record.canvasGenesisCheckpointObjectDigest); parseDigest(record.stagedProjectIndexFrontierDigest); parsePortableStamp(record.stamp); return freezeJcs(record)
  }
  if (format === "convax.canvas-route-metadata") {
    assertExactKeys(value, ["format", "transitionId", "canvasId", "title", "observedActivationDigest", "stamp"], "Canvas route metadata")
    const record = value as unknown as CanvasRouteMetadataClaim; parseFactId(record.transitionId, "cr"); parseCanvasId(record.canvasId); assertBoundedNfcString(record.title, 1, 512, "Canvas title"); parseDigest(record.observedActivationDigest); parsePortableStamp(record.stamp); return freezeJcs(record)
  }
  if (format === "convax.canvas-route-reset-commit") {
    assertExactKeys(value, [
      "format", "transitionId", "canvasId", "oldShardEpoch", "newShardEpoch",
      "predecessorActivationDigest", "stagedGenesisCheckpointObjectDigest",
      "stagedGenesisFullUpdateDigest", "stagedGenesisStateVectorDigest",
      "resetClaimCoreDigest", "confirmationCoreDigest", "approvalCoreDigest",
      "routeCasCoreDigest", "stamp",
    ], "Canvas route reset commit")
    const record = value as unknown as CanvasRouteResetCommit
    parseFactId(record.transitionId, "cr")
    parseCanvasId(record.canvasId)
    parseId128(record.oldShardEpoch)
    parseId128(record.newShardEpoch)
    if (record.oldShardEpoch === record.newShardEpoch) fail("invalid-route", "Canvas reset must rotate shard epoch")
    parseDigest(record.predecessorActivationDigest)
    parseDigest(record.stagedGenesisCheckpointObjectDigest)
    parseDigest(record.stagedGenesisFullUpdateDigest)
    parseDigest(record.stagedGenesisStateVectorDigest)
    parseDigest(record.resetClaimCoreDigest)
    parseDigest(record.confirmationCoreDigest)
    parseDigest(record.approvalCoreDigest)
    parseDigest(record.routeCasCoreDigest)
    parsePortableStamp(record.stamp)
    return freezeJcs(record)
  }
  assertExactKeys(value, ["format", "transitionId", "canvasId", "observedActivationDigest", "reason", "stamp"], "Canvas route tombstone")
  const record = value as unknown as CanvasRouteTombstone
  if (record.format !== "convax.canvas-route-tombstone" || record.reason !== "explicit-delete") fail("invalid-route", "Route tombstone is invalid")
  parseFactId(record.transitionId, "cr"); parseCanvasId(record.canvasId); if (record.observedActivationDigest !== null) parseDigest(record.observedActivationDigest); parsePortableStamp(record.stamp); return freezeJcs(record)
}

function parseReceipt(value: unknown): ProjectOperationReceipt {
  assertExactKeys(value, ["format", "actorId", "operationId", "intentKind", "intentDigest", "allocatedIds", "firstWriteOrdinal", "writeCount", "stampLamport"], "Project operation receipt")
  const record = value as unknown as ProjectOperationReceipt
  if (record.format !== "convax.project-operation-receipt" || !INTENT_KINDS.has(record.intentKind)) fail("invalid-receipt", "Operation receipt is invalid")
  parseActorId(record.actorId); parseId128(record.operationId); parseDigest(record.intentDigest); parseUint32(record.firstWriteOrdinal); parseUint32(record.writeCount); parseUint64(record.stampLamport); assertDenseArray(record.allocatedIds, "Allocated ids")
  if (record.allocatedIds.length > 8) fail("invalid-receipt", "Allocated ids exceed their bound")
  if (!isStrictSorted(record.allocatedIds, compareUtf8)) fail("invalid-receipt", "Allocated ids are not sorted unique")
  return freezeJcs(record)
}

function parseProjectIndexScope(value: DocumentScope): ProjectIndexScope {
  if (value.docKind !== "project-index" || value.docId !== "project-index") fail("scope-mismatch", "Project owner requires ProjectIndex scope")
  parseProjectId(value.projectId); parseId128(value.projectEpoch); parseId128(value.shardEpoch)
  return value as ProjectIndexScope
}

function parseCanvasDocumentScope(value: unknown): CanvasDocumentScope {
  const scope = parseDocumentScope(value)
  if (scope.docKind !== "canvas" || scope.docId !== parseCanvasId(scope.docId)) {
    fail("invalid-reset", "Canvas reset scope is invalid")
  }
  return scope as CanvasDocumentScope
}

function parseDocumentShardResetReason(value: unknown): DocumentShardResetReason {
  if (
    value !== "incompatible-canvas-schema" &&
    value !== "document-lamport-exhaustion" &&
    value !== "unrecoverable-certified-history-corruption"
  ) {
    fail("invalid-reset", "Canvas reset reason is invalid")
  }
  return value
}

function parseDocumentShardResetRouteCasCore(
  value: unknown,
): DocumentShardResetRouteCasCore {
  assertExactKeys(value, [
    "format", "operationId", "canvasId", "oldScope", "newScope",
    "predecessorActivationDigest", "stagedGenesisCheckpointObjectDigest",
    "stagedGenesisFullUpdateDigest", "stagedGenesisStateVectorDigest",
  ], "Document shard reset route CAS core")
  if (value.format !== "convax.document-shard-reset-route-cas-core") {
    fail("invalid-reset", "Canvas reset route CAS format is invalid")
  }
  const oldScope = parseCanvasDocumentScope(value.oldScope)
  const newScope = parseCanvasDocumentScope(value.newScope)
  const canvasId = parseCanvasId(value.canvasId)
  if (
    oldScope.projectId !== newScope.projectId ||
    oldScope.projectEpoch !== newScope.projectEpoch ||
    oldScope.docId !== canvasId ||
    newScope.docId !== canvasId ||
    oldScope.shardEpoch === newScope.shardEpoch
  ) {
    fail("invalid-reset", "Canvas reset route CAS scopes do not rotate exactly one shard")
  }
  return freezeJcs({
    format: value.format,
    operationId: parseId128(value.operationId),
    canvasId,
    oldScope,
    newScope,
    predecessorActivationDigest: parseDigest(value.predecessorActivationDigest),
    stagedGenesisCheckpointObjectDigest: parseDigest(value.stagedGenesisCheckpointObjectDigest),
    stagedGenesisFullUpdateDigest: parseDigest(value.stagedGenesisFullUpdateDigest),
    stagedGenesisStateVectorDigest: parseDigest(value.stagedGenesisStateVectorDigest),
  })
}

function parseDocumentShardResetClaimCore(value: unknown): DocumentShardResetClaimCore {
  assertExactKeys(value, [
    "format", "projectIndexScope", "oldScope", "newScope", "reason",
    "oldProtocolDigest", "newProtocolDigest", "oldSchemaDigest", "newSchemaDigest",
    "stagedGenesisCheckpointObjectDigest", "stagedGenesisFullUpdateDigest",
    "stagedGenesisStateVectorDigest", "routeCasCoreDigest", "initiatorMemberId",
    "initiatorReplicaId", "initiatorActorId", "adminMemberId",
    "adminAuthorizationDigest", "explicitConfirmationReceiptDigest",
  ], "Document shard reset claim core")
  if (value.format !== "convax.document-shard-reset-claim-core") {
    fail("invalid-reset", "Canvas reset claim core format is invalid")
  }
  const projectIndexScope = parseProjectIndexScope(parseDocumentScope(value.projectIndexScope))
  const oldScope = parseCanvasDocumentScope(value.oldScope)
  const newScope = parseCanvasDocumentScope(value.newScope)
  if (
    projectIndexScope.projectId !== oldScope.projectId ||
    projectIndexScope.projectEpoch !== oldScope.projectEpoch ||
    oldScope.projectId !== newScope.projectId ||
    oldScope.projectEpoch !== newScope.projectEpoch ||
    oldScope.docId !== newScope.docId ||
    oldScope.shardEpoch === newScope.shardEpoch
  ) {
    fail("invalid-reset", "Canvas reset claim scopes disagree")
  }
  return freezeJcs({
    format: value.format,
    projectIndexScope,
    oldScope,
    newScope,
    reason: parseDocumentShardResetReason(value.reason),
    oldProtocolDigest: parseDigest(value.oldProtocolDigest),
    newProtocolDigest: parseDigest(value.newProtocolDigest),
    oldSchemaDigest: parseDigest(value.oldSchemaDigest),
    newSchemaDigest: parseDigest(value.newSchemaDigest),
    stagedGenesisCheckpointObjectDigest: parseDigest(value.stagedGenesisCheckpointObjectDigest),
    stagedGenesisFullUpdateDigest: parseDigest(value.stagedGenesisFullUpdateDigest),
    stagedGenesisStateVectorDigest: parseDigest(value.stagedGenesisStateVectorDigest),
    routeCasCoreDigest: parseDigest(value.routeCasCoreDigest),
    initiatorMemberId: parseMemberId(value.initiatorMemberId),
    initiatorReplicaId: parseReplicaId(value.initiatorReplicaId),
    initiatorActorId: parseActorId(value.initiatorActorId),
    adminMemberId: parseMemberId(value.adminMemberId),
    adminAuthorizationDigest: parseDigest(value.adminAuthorizationDigest),
    explicitConfirmationReceiptDigest: parseDigest(value.explicitConfirmationReceiptDigest),
  })
}

function parseDocumentShardResetClaim(value: unknown): DocumentShardResetClaim {
  assertExactKeys(
    value,
    ["format", "core", "coreDigest", "initiatorSignature", "adminApprovalDigest"],
    "Document shard reset claim",
  )
  if (value.format !== "convax.document-shard-reset-claim") {
    fail("invalid-reset", "Canvas reset claim format is invalid")
  }
  const core = parseDocumentShardResetClaimCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== structuredDigest("convax.document-shard-reset-claim-core-digest", core)) {
    fail("invalid-reset", "Canvas reset claim core digest is invalid")
  }
  return freezeJcs({
    format: value.format,
    core,
    coreDigest,
    initiatorSignature: parseSignature(value.initiatorSignature),
    adminApprovalDigest: parseDigest(value.adminApprovalDigest),
  })
}

function parseDocumentShardResetConfirmationCore(
  value: unknown,
): DocumentShardResetConfirmationCore {
  assertExactKeys(value, [
    "format", "confirmationId", "projectId", "projectEpoch", "oldScope", "newScope",
    "reason", "routeCasCoreDigest", "predecessorActivationDigest",
    "stagedGenesisCheckpointObjectDigest", "stagedGenesisFullUpdateDigest",
    "stagedGenesisStateVectorDigest", "initiatorMemberId", "initiatorReplicaId",
    "initiatorActorId", "initiatorActorCredentialCoreDigest", "confirmationStatement",
    "protocolDigest",
  ], "Document shard reset confirmation core")
  if (
    value.format !== "convax.document-shard-reset-confirmation-core" ||
    value.confirmationStatement !== "replace-one-canvas-shard-and-retain-old-recovery-bytes"
  ) {
    fail("invalid-reset", "Canvas reset confirmation core is invalid")
  }
  return freezeJcs({
    format: value.format,
    confirmationId: parseId128(value.confirmationId),
    projectId: parseProjectId(value.projectId),
    projectEpoch: parseId128(value.projectEpoch),
    oldScope: parseCanvasDocumentScope(value.oldScope),
    newScope: parseCanvasDocumentScope(value.newScope),
    reason: parseDocumentShardResetReason(value.reason),
    routeCasCoreDigest: parseDigest(value.routeCasCoreDigest),
    predecessorActivationDigest: parseDigest(value.predecessorActivationDigest),
    stagedGenesisCheckpointObjectDigest: parseDigest(value.stagedGenesisCheckpointObjectDigest),
    stagedGenesisFullUpdateDigest: parseDigest(value.stagedGenesisFullUpdateDigest),
    stagedGenesisStateVectorDigest: parseDigest(value.stagedGenesisStateVectorDigest),
    initiatorMemberId: parseMemberId(value.initiatorMemberId),
    initiatorReplicaId: parseReplicaId(value.initiatorReplicaId),
    initiatorActorId: parseActorId(value.initiatorActorId),
    initiatorActorCredentialCoreDigest: parseDigest(value.initiatorActorCredentialCoreDigest),
    confirmationStatement: value.confirmationStatement,
    protocolDigest: parseDigest(value.protocolDigest),
  })
}

function parseDocumentShardResetConfirmation(
  value: unknown,
): DocumentShardResetConfirmation {
  assertExactKeys(
    value,
    ["format", "core", "coreDigest", "initiatorReplicaSignature"],
    "Document shard reset confirmation",
  )
  if (value.format !== "convax.document-shard-reset-confirmation") {
    fail("invalid-reset", "Canvas reset confirmation format is invalid")
  }
  const core = parseDocumentShardResetConfirmationCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== structuredDigest("convax.document-shard-reset-confirmation-core", core)) {
    fail("invalid-reset", "Canvas reset confirmation core digest is invalid")
  }
  return freezeJcs({
    format: value.format,
    core,
    coreDigest,
    initiatorReplicaSignature: parseSignature(value.initiatorReplicaSignature),
  })
}

function parseDocumentShardResetApprovalCore(value: unknown): DocumentShardResetApprovalCore {
  assertExactKeys(value, [
    "format", "approvalId", "resetClaimCoreDigest", "confirmationCoreDigest",
    "projectId", "projectEpoch", "oldScope", "newScope", "reason",
    "routeCasCoreDigest", "adminMemberId", "adminMemberAuthorizationEpoch",
    "adminCapabilityCoreDigest", "approvalStatement", "protocolDigest",
  ], "Document shard reset approval core")
  if (
    value.format !== "convax.document-shard-reset-approval-core" ||
    value.approvalStatement !== "approve-exact-canvas-shard-reset"
  ) {
    fail("invalid-reset", "Canvas reset approval core is invalid")
  }
  return freezeJcs({
    format: value.format,
    approvalId: parseId128(value.approvalId),
    resetClaimCoreDigest: parseDigest(value.resetClaimCoreDigest),
    confirmationCoreDigest: parseDigest(value.confirmationCoreDigest),
    projectId: parseProjectId(value.projectId),
    projectEpoch: parseId128(value.projectEpoch),
    oldScope: parseCanvasDocumentScope(value.oldScope),
    newScope: parseCanvasDocumentScope(value.newScope),
    reason: parseDocumentShardResetReason(value.reason),
    routeCasCoreDigest: parseDigest(value.routeCasCoreDigest),
    adminMemberId: parseMemberId(value.adminMemberId),
    adminMemberAuthorizationEpoch: parseId128(value.adminMemberAuthorizationEpoch),
    adminCapabilityCoreDigest: parseDigest(value.adminCapabilityCoreDigest),
    approvalStatement: value.approvalStatement,
    protocolDigest: parseDigest(value.protocolDigest),
  })
}

function parseDocumentShardResetApproval(value: unknown): DocumentShardResetApproval {
  assertExactKeys(
    value,
    ["format", "core", "coreDigest", "adminMemberSignature"],
    "Document shard reset approval",
  )
  if (value.format !== "convax.document-shard-reset-approval") {
    fail("invalid-reset", "Canvas reset approval format is invalid")
  }
  const core = parseDocumentShardResetApprovalCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== structuredDigest("convax.document-shard-reset-approval-core", core)) {
    fail("invalid-reset", "Canvas reset approval core digest is invalid")
  }
  return freezeJcs({
    format: value.format,
    core,
    coreDigest,
    adminMemberSignature: parseSignature(value.adminMemberSignature),
  })
}

function parseVersionId(value: unknown): ProjectVersionId {
  if (typeof value !== "string" || !VERSION.test(value)) fail("invalid-version-id", "Project version id is invalid")
  return value as ProjectVersionId
}

function parseFactId(value: unknown, prefix?: "pl" | "pt" | "pp" | "pr" | "cr"): ProjectFactId {
  if (typeof value !== "string" || !FACT.test(value) || (prefix && !value.startsWith(`${prefix}_`))) fail("invalid-fact-id", "Project fact id is invalid")
  return value as ProjectFactId
}

function assertPortableBasename(value: string): void {
  assertBoundedNfcString(value, 1, 255, "Project basename")
  if (/[\\/\0\u0001-\u001f\u007f]/u.test(value) || value === "." || value === ".." || /[. ]$/u.test(value) || /^(\.convax|\.convax-conflicts)$/iu.test(value) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/iu.test(value)) fail("invalid-basename", "Project basename is not portable")
}

function getRoot(document: Y.Doc): Y.Map<unknown> {
  const root = document.share.get(PROJECT_INDEX_ROOT_NAME)
  if (!(root instanceof Y.Map)) fail("invalid-root", "ProjectIndex root is missing")
  return root
}

function childMap(root: Y.Map<unknown>, key: (typeof PROJECT_INDEX_ROOT_KEYS)[number]): Y.Map<unknown> {
  const value = root.get(key)
  if (!(value instanceof Y.Map)) fail("invalid-root", `${key} is not a Y.Map`)
  return value
}

function assertMapKeys(map: Y.Map<unknown>, expected: readonly string[], label: string): void {
  const actual = [...map.keys()].sort(compareUtf8)
  const wanted = [...expected].sort(compareUtf8)
  if (!encodeEqual(actual, wanted)) fail("unknown-root-key", `${label} has unknown or missing keys`)
}

function readFactMap<T>(root: Y.Map<unknown>, name: (typeof PROJECT_INDEX_ROOT_KEYS)[number], parser: (value: unknown) => T, keyMatches: (key: string, value: T) => boolean): ReadonlyMap<string, T> {
  const map = childMap(root, name)
  const result = new Map<string, T>()
  for (const [key, raw] of map.entries()) {
    if (!/^[\x20-\x7e]{1,256}$/u.test(key) || key.includes("/")) fail("invalid-key", `${name} key is not bounded ASCII`)
    if (raw instanceof Y.AbstractType) fail("nested-yjs-type", `${name} values must be plain JCS objects`)
    const value = parser(raw)
    if (!keyMatches(key, value)) fail("key-value-mismatch", `${name} key does not match its value`)
    result.set(key, value)
  }
  return result
}

function canonicalEntries<T>(map: ReadonlyMap<string, T>): readonly (readonly [string, T])[] {
  return Object.freeze([...map.entries()].sort(([left], [right]) => compareUtf8(left, right)).map(([key, value]) => Object.freeze([key, value] as const)))
}

function putImmutableFact(map: Y.Map<unknown>, key: string, record: object): void {
  const existing = map.get(key)
  if (existing !== undefined) {
    if (!encodeEqual(existing, record)) fail("equivocation", "Immutable Project fact key was reused with different bytes")
    return
  }
  map.set(key, freezeJcs(record))
}

function freezeJcs<T>(value: T): T {
  const clone = decodeRestrictedJcs(encodeRestrictedJcs(value)) as T
  return deepFreeze(clone)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as object)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

function isStrictSorted<T>(values: readonly T[], compare: (left: T, right: T) => number): boolean {
  for (let index = 1; index < values.length; index += 1) if (compare(values[index - 1]!, values[index]!) >= 0) return false
  return true
}

function encodeEqual(left: unknown, right: unknown): boolean {
  const a = encodeRestrictedJcs(left); const b = encodeRestrictedJcs(right)
  return a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index])
}

function compareUint8(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): number {
  const length = Math.min(left.byteLength, right.byteLength)
  for (let index = 0; index < length; index += 1) {
    const difference = left[index]! - right[index]!
    if (difference !== 0) return difference
  }
  return left.byteLength - right.byteLength
}

function digestParts(...parts: readonly Uint8Array[]): Digest {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
  return parseDigest(bytesToHex(sha256(bytes)))
}

function ownerResult(result: OwnerApplyResult<"project-index">): { readonly result: ProjectIndexApplyResult; readonly scope: ProjectIndexScope } | null {
  const value = result.value
  return typeof value === "object" && value !== null && "result" in value && (value as { result?: { format?: unknown } }).result?.format === "convax.project-index-intent-result" ? value as { readonly result: ProjectIndexApplyResult; readonly scope: ProjectIndexScope } : null
}

function fail(code: string, message: string): never {
  throw new ProjectIndexSchemaError(code, message)
}
