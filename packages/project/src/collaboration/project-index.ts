import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import {
  assertBoundedNfcStringV2,
  assertDenseArrayV2,
  assertExactKeysV2,
  compareBytesV2,
  compareDecodedBase64urlV2,
  comparePortableStampsV2,
  compareUtf8V2,
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  ownerCanonicalizerDescriptorDigestV2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseMemberIdV2,
  parsePortableStampV2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint32V2,
  parseUint64V2,
  structuredDigestV2,
  type ActualWriteEvidenceV2,
  type ActorIdV2,
  type CanvasIdV2,
  type DigestV2,
  type DecodedCausalEditFrameV2,
  type DecodedCausalEditFrameV3,
  type DocumentOwnerProtocolDefinitionV2,
  type DocumentScopeV2,
  type Id128V2,
  type OwnerApplyResultV2,
  type OwnerCanonicalizerDescriptorV2,
  type OwnerExternalFactPortV2,
  type OwnerExternalFactRequirementV2,
  type OwnerIntentConstructionContextV2,
  type OwnerIntentClosureDefinitionV2,
  type OwnerIntentDependenciesV2,
  type OwnerIntentValidationContextV2,
  type OwnerProcessValueFactoryV2,
  type OwnerValidatedStateV2,
  type PortableStampV2,
  type ProjectIdV2,
  type SelectedDocumentOwnerArtifactDefinitionV2,
  type Uint32V2,
  type Uint64V2,
} from "@convax/collaboration"
import {
  parseProjectDirectoryId,
  parseProjectEntryId,
  parseProjectFileId,
  type ProjectDirectoryId,
  type ProjectEntryId,
  type ProjectFileId,
} from "@convax/project-files/identity"
import { canonicalize, fromProjectUri, parseProjectUri } from "@convax/uri"
import * as Y from "yjs"
import type {
  CanvasDocumentScopeV2,
  DocumentShardResetApprovalCoreV2,
  DocumentShardResetApprovalV2,
  DocumentShardResetClaimCoreV2,
  DocumentShardResetClaimV2,
  DocumentShardResetConfirmationCoreV2,
  DocumentShardResetConfirmationV2,
  DocumentShardResetReasonV2,
  DocumentShardResetRouteCasCoreV2,
} from "../collaboration-protocol/reset-contracts"

export const PROJECT_INDEX_ROOT_NAME_V2 = "convax.project-index.v2"
export const PROJECT_INDEX_ROOT_KEYS_V2 = Object.freeze([
  "identity",
  "entries",
  "entryLocations",
  "entryTombstones",
  "contentFamilies",
  "contentPromotions",
  "pathReservations",
  "canvasRoutes",
  "operations",
] as const)

export const PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2: DigestV2 = parseDigestV2(
  "38f3d762cfd95a6826758750d3cdb518d900ac0b15b8338aa6dfd58733e9353c",
)

const encoder = new TextEncoder()
const RECORD_DOMAIN = encoder.encode("convax.project-index-record-digest/2\0")
const INTENT_DOMAIN = encoder.encode("convax.project-index-intent-digest/2\0")
const RESOURCE_REFERENCE_DOMAIN = encoder.encode("convax.project-resource-reference-digest/2\0")
const DERIVED_DOMAIN = "convax.project-derived-identity/2" as const
const VERSION = /^pv_[0-9a-f]{64}$/u
const FACT = /^(pl|pt|pp|pr|cr)_[0-9a-f]{64}$/u
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u

export type ProjectFileIdV2 = ProjectFileId
export type ProjectDirectoryIdV2 = ProjectDirectoryId
export type ProjectEntryIdV2 = ProjectEntryId
export type ProjectVersionIdV2 = `pv_${string}`
export type ProjectFactIdV2 = `${"pl" | "pt" | "pp" | "pr" | "cr"}_${string}`
export type ProjectIndexScopeV2 = DocumentScopeV2 & { readonly docKind: "project-index"; readonly docId: "project-index" }

export type ProjectContentPolicyV2 = "none" | "immutable" | "conflict-preserving-text" | "overwritable-binary"
export type ProjectStorageClassV2 = "project-file" | "managed-blob"

export interface ProjectIndexIdentityRecordV2 {
  readonly format: "convax.project-index-identity/2"
  readonly schema: "convax.project-index.v2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly shardEpoch: Id128V2
  readonly rootDirectoryId: ProjectDirectoryIdV2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
}

export interface ProjectEntryRecordV2 {
  readonly format: "convax.project-entry/2"
  readonly entryId: ProjectEntryIdV2
  readonly kind: "file" | "directory"
  readonly storageClass: ProjectStorageClassV2 | null
  readonly contentPolicy: ProjectContentPolicyV2
  readonly provenance: "project-root" | "user" | "generated" | "managed-admission" | "content-conflict-copy"
  readonly conflictSource: null | {
    readonly primaryFileId: ProjectFileIdV2
    readonly sourceVersionId: ProjectVersionIdV2
    readonly promotionId: ProjectFactIdV2
    readonly reservationId: ProjectFactIdV2
  }
  readonly createdByActorId: ActorIdV2
  readonly createdByOperationId: Id128V2
  readonly createdStamp: PortableStampV2
}

export interface ProjectEntryLocationClaimV2 {
  readonly format: "convax.project-entry-location/2"
  readonly claimId: ProjectFactIdV2
  readonly entryId: ProjectEntryIdV2
  readonly state: "linked" | "declared-missing"
  readonly parentDirectoryId: ProjectDirectoryIdV2
  readonly basename: string
  readonly reason: "create" | "move" | "rename" | "explicit-relink" | "explicit-missing"
  readonly stamp: PortableStampV2
}

export interface ProjectEntryTombstoneV2 {
  readonly format: "convax.project-entry-tombstone/2"
  readonly tombstoneId: ProjectFactIdV2
  readonly entryId: ProjectEntryIdV2
  readonly reason: "explicit-delete"
  readonly observedEntryDigest: DigestV2
  readonly stamp: PortableStampV2
}

export interface ProjectBlobRefV2 {
  readonly format: "convax.blob-ref/2"
  readonly algorithm: "sha256"
  readonly digest: DigestV2
  readonly byteLength: Uint64V2
  readonly mime: string
}

export interface ProjectContentVersionRecordV2 {
  readonly format: "convax.project-content-version/2"
  readonly primaryFileId: ProjectFileIdV2
  readonly versionId: ProjectVersionIdV2
  readonly writeClass: "initial" | "text-write" | "binary-overwrite"
  readonly blob: ProjectBlobRefV2
  readonly canonicalRevisionUri: string
  readonly supersedesVersionIds: readonly ProjectVersionIdV2[]
  readonly binaryLogicalCounter: Uint64V2 | null
  readonly creatorActorId: ActorIdV2
  readonly creatorOperationId: Id128V2
  readonly stamp: PortableStampV2
}

export interface ProjectContentPromotionRecordV2 {
  readonly format: "convax.project-content-promotion/2"
  readonly promotionId: ProjectFactIdV2
  readonly primaryFileId: ProjectFileIdV2
  readonly versionId: ProjectVersionIdV2
  readonly reservedConflictFileId: ProjectFileIdV2
  readonly reservationId: ProjectFactIdV2
  readonly stamp: PortableStampV2
}

export interface ProjectResourceReferenceV2 {
  readonly format: "convax.project-resource-reference/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly entryFileId: ProjectFileIdV2
  readonly familyPrimaryFileId: ProjectFileIdV2
  readonly versionId: ProjectVersionIdV2
  readonly canonicalUri: string
  readonly blob: ProjectBlobRefV2
  readonly versionRecordDigest: DigestV2
}

export interface ProjectPathReservationRecordV2 {
  readonly format: "convax.project-path-reservation/2"
  readonly reservationId: ProjectFactIdV2
  readonly kind: "content-conflict-copy"
  readonly primaryFileId: ProjectFileIdV2
  readonly versionId: ProjectVersionIdV2
  readonly reservedEntryId: ProjectFileIdV2
  readonly canonicalPath: string
  readonly originalBasenameHint: string
  readonly stamp: PortableStampV2
}

export interface CanvasRouteStageV2 {
  readonly format: "convax.canvas-route-stage/2"
  readonly transitionId: ProjectFactIdV2
  readonly canvasId: CanvasIdV2
  readonly shardEpoch: Id128V2
  readonly title: string
  readonly reason: "create"
  readonly stamp: PortableStampV2
}

export interface CanvasRouteActivationV2 {
  readonly format: "convax.canvas-route-activation/2"
  readonly transitionId: ProjectFactIdV2
  readonly canvasId: CanvasIdV2
  readonly shardEpoch: Id128V2
  readonly predecessorActivationDigest: null
  readonly stageRecordDigest: DigestV2
  readonly projectIndexRouteDependencyFrameDigest: DigestV2
  readonly canvasGenesisCheckpointObjectDigest: DigestV2
  readonly stagedProjectIndexFrontierDigest: DigestV2
  readonly stamp: PortableStampV2
}

export interface CanvasRouteMetadataClaimV2 {
  readonly format: "convax.canvas-route-metadata/2"
  readonly transitionId: ProjectFactIdV2
  readonly canvasId: CanvasIdV2
  readonly title: string
  readonly observedActivationDigest: DigestV2
  readonly stamp: PortableStampV2
}

export interface CanvasRouteTombstoneV2 {
  readonly format: "convax.canvas-route-tombstone/2"
  readonly transitionId: ProjectFactIdV2
  readonly canvasId: CanvasIdV2
  readonly observedActivationDigest: DigestV2 | null
  readonly reason: "explicit-delete"
  readonly stamp: PortableStampV2
}

export interface CanvasRouteResetCommitV2 {
  readonly format: "convax.canvas-route-reset-commit/2"
  readonly transitionId: ProjectFactIdV2
  readonly canvasId: CanvasIdV2
  readonly oldShardEpoch: Id128V2
  readonly newShardEpoch: Id128V2
  readonly predecessorActivationDigest: DigestV2
  readonly stagedGenesisCheckpointObjectDigest: DigestV2
  readonly stagedGenesisFullUpdateDigest: DigestV2
  readonly stagedGenesisStateVectorDigest: DigestV2
  readonly resetClaimCoreDigest: DigestV2
  readonly confirmationCoreDigest: DigestV2
  readonly approvalCoreDigest: DigestV2
  readonly routeCasCoreDigest: DigestV2
  readonly stamp: PortableStampV2
}

export type CanvasRouteFactV2 =
  | CanvasRouteStageV2
  | CanvasRouteActivationV2
  | CanvasRouteMetadataClaimV2
  | CanvasRouteResetCommitV2
  | CanvasRouteTombstoneV2

export type ProjectIndexIntentKindV2 =
  | "project.directory.create/2"
  | "project.file.create/2"
  | "project.entry.locate/2"
  | "project.entry.tombstone/2"
  | "project.file.write-text/2"
  | "project.file.overwrite-binary/2"
  | "project.canvas.route.stage/2"
  | "project.canvas.route.activate/2"
  | "project.canvas.route.rename/2"
  | "project.canvas.route.tombstone/2"
  | "project.canvas.route.reset/2"

export interface ProjectOperationReceiptV2 {
  readonly format: "convax.project-operation-receipt/2"
  readonly actorId: ActorIdV2
  readonly operationId: Id128V2
  readonly intentKind: ProjectIndexIntentKindV2
  readonly intentDigest: DigestV2
  readonly allocatedIds: readonly string[]
  readonly firstWriteOrdinal: Uint32V2
  readonly writeCount: Uint32V2
  readonly stampLamport: Uint64V2
}

export type ProjectGuardAtomV2 =
  | Readonly<{ kind: "entry-absent"; entryId: ProjectEntryIdV2 }>
  | Readonly<{ kind: "entry-live"; entryId: ProjectEntryIdV2; entryDigest: DigestV2 }>
  | Readonly<{ kind: "entry-location"; entryId: ProjectEntryIdV2; projectionDigest: DigestV2 }>
  | Readonly<{ kind: "directory-live"; directoryId: ProjectDirectoryIdV2; entryDigest: DigestV2 }>
  | Readonly<{
      kind: "family-live-heads"
      primaryFileId: ProjectFileIdV2
      versionIds: readonly ProjectVersionIdV2[]
      projectionDigest: DigestV2
    }>
  | Readonly<{
      kind: "route-state"
      canvasId: CanvasIdV2
      state: "absent" | "staged" | "live" | "tombstoned"
      shardEpoch: Id128V2 | null
      activationDigest: DigestV2 | null
      projectionDigest: DigestV2
    }>
  | Readonly<{
      kind: "fact-absent"
      map: Exclude<(typeof PROJECT_INDEX_ROOT_KEYS_V2)[number], "identity">
      key: string
    }>

interface IntentBase<K extends ProjectIndexIntentKindV2, B> {
  readonly format: "convax.typed-intent/2"
  readonly kind: K
  readonly guards: readonly ProjectGuardAtomV2[]
  readonly body: B
}

export type ProjectIndexIntentV2 =
  | IntentBase<"project.directory.create/2", { readonly entry: ProjectEntryRecordV2; readonly location: ProjectEntryLocationClaimV2 }>
  | IntentBase<"project.file.create/2", { readonly entry: ProjectEntryRecordV2; readonly location: ProjectEntryLocationClaimV2 | null; readonly initialVersion: ProjectContentVersionRecordV2 }>
  | IntentBase<"project.entry.locate/2", { readonly location: ProjectEntryLocationClaimV2 }>
  | IntentBase<"project.entry.tombstone/2", { readonly tombstone: ProjectEntryTombstoneV2 }>
  | IntentBase<"project.file.write-text/2", { readonly version: ProjectContentVersionRecordV2; readonly conflictEntry: ProjectEntryRecordV2; readonly promotion: ProjectContentPromotionRecordV2; readonly reservation: ProjectPathReservationRecordV2 }>
  | IntentBase<"project.file.overwrite-binary/2", { readonly version: ProjectContentVersionRecordV2 }>
  | IntentBase<"project.canvas.route.stage/2", { readonly stage: CanvasRouteStageV2 }>
  | IntentBase<"project.canvas.route.activate/2", { readonly activation: CanvasRouteActivationV2 }>
  | IntentBase<"project.canvas.route.rename/2", { readonly metadata: CanvasRouteMetadataClaimV2 }>
  | IntentBase<"project.canvas.route.tombstone/2", { readonly tombstone: CanvasRouteTombstoneV2 }>
  | IntentBase<"project.canvas.route.reset/2", {
      readonly resetCommit: CanvasRouteResetCommitV2
      readonly routeCasCore: DocumentShardResetRouteCasCoreV2
      readonly resetClaim: DocumentShardResetClaimV2
      readonly confirmation: DocumentShardResetConfirmationV2
      readonly approval: DocumentShardResetApprovalV2
    }>

export interface ProjectCanonicalStateV2 {
  readonly format: "convax.project-index-canonical-state/2"
  readonly identity: readonly (readonly [string, ProjectIndexIdentityRecordV2])[]
  readonly entries: readonly (readonly [string, ProjectEntryRecordV2])[]
  readonly entryLocations: readonly (readonly [string, ProjectEntryLocationClaimV2])[]
  readonly entryTombstones: readonly (readonly [string, ProjectEntryTombstoneV2])[]
  readonly contentFamilies: readonly (readonly [string, ProjectContentVersionRecordV2])[]
  readonly contentPromotions: readonly (readonly [string, ProjectContentPromotionRecordV2])[]
  readonly pathReservations: readonly (readonly [string, ProjectPathReservationRecordV2])[]
  readonly canvasRoutes: readonly (readonly [string, CanvasRouteFactV2])[]
  readonly operations: readonly (readonly [string, ProjectOperationReceiptV2])[]
}

export interface ProjectContentFamilyViewV2 {
  readonly primaryFileId: ProjectFileIdV2
  readonly contentPolicy: ProjectContentPolicyV2 | null
  readonly versionIds: readonly ProjectVersionIdV2[]
  readonly liveHeadVersionIds: readonly ProjectVersionIdV2[]
  readonly currentVersionId: ProjectVersionIdV2 | null
  readonly currentResourceReference: ProjectResourceReferenceV2 | null
  readonly currentResourceReferenceDigest: DigestV2 | null
  readonly activeConflictFileIds: readonly ProjectFileIdV2[]
}

export type ProjectEntryLocationCauseV2 =
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

export interface ProjectEntryLocationOutcomeValueV2 {
  readonly format: "convax.project-entry-location-projection/2"
  readonly entryId: ProjectEntryIdV2
  readonly entryRecordDigest: DigestV2 | null
  readonly tombstoneRecordDigests: readonly DigestV2[]
  readonly selectedLocationRecordDigest: DigestV2 | null
  readonly state:
    | "absent"
    | "dormant-conflict"
    | "live-linked"
    | "live-declared-missing"
    | "live-managed-unlocated"
    | "conflict-path"
    | "tombstoned"
  readonly cause: ProjectEntryLocationCauseV2
  readonly portablePath: string | null
  readonly pathClaimWinnerEntryId: ProjectEntryIdV2 | null
}

export interface ProjectEntryLocationProjectionV2 extends ProjectEntryLocationOutcomeValueV2 {
  readonly resolutionDependencyRecordDigests: readonly DigestV2[]
}

export interface ProjectConflictProjectionV2 {
  readonly format: "convax.project-conflict-projection/2"
  readonly primaryFileId: ProjectFileIdV2
  readonly sourceVersionId: ProjectVersionIdV2
  readonly sourceVersionRecordDigest: DigestV2
  readonly promotionRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly reservedEntryId: ProjectFileIdV2
  readonly reservedEntryRecordDigest: DigestV2
  readonly reservedEntryLocationProjectionDigest: DigestV2 | null
  readonly state: "dormant" | "active-reserved-path" | "active-explicit-path" | "tombstoned"
  readonly cause:
    | "promotion-dormant"
    | "active-reservation-no-explicit"
    | "active-reservation-after-declared-missing"
    | "active-explicit-location"
    | "reserved-entry-tombstoned"
  readonly materializedPath: string | null
}

export interface ProjectContentFamilyProjectionV2 {
  readonly format: "convax.project-content-family-projection/2"
  readonly primaryFileId: ProjectFileIdV2
  readonly primaryEntryRecordDigest: DigestV2 | null
  readonly contentPolicy: ProjectContentPolicyV2 | null
  readonly versions: readonly (readonly [ProjectVersionIdV2, DigestV2])[]
  readonly liveHeadVersionIds: readonly ProjectVersionIdV2[]
  readonly currentVersionId: ProjectVersionIdV2 | null
  readonly activeConflictProjectionDigests: readonly DigestV2[]
}

export interface ProjectCanvasRouteProjectionV2 {
  readonly format: "convax.project-route-projection/2"
  readonly canvasId: CanvasIdV2
  readonly state: "absent" | "staged" | "live" | "tombstoned"
  readonly stageRecordDigest: DigestV2 | null
  readonly ancestryRecordDigests: readonly DigestV2[]
  readonly currentActivationDigest: DigestV2 | null
  readonly currentShardEpoch: Id128V2 | null
  readonly currentTitle: string | null
  readonly currentTitleRecordDigest: DigestV2 | null
  readonly currentTombstoneRecordDigest: DigestV2 | null
}

export interface ProjectIndexProjectionV2 {
  readonly identity: ProjectIndexIdentityRecordV2
  readonly liveEntryIds: readonly ProjectEntryIdV2[]
  readonly tombstonedEntryIds: readonly ProjectEntryIdV2[]
  readonly contentFamilies: readonly ProjectContentFamilyViewV2[]
  readonly canvasRoutes: readonly ProjectCanvasRouteProjectionV2[]
}

export interface ProjectIndexSnapshotV2 {
  readonly identity: ProjectIndexIdentityRecordV2
  readonly entries: ReadonlyMap<string, ProjectEntryRecordV2>
  readonly entryLocations: ReadonlyMap<string, ProjectEntryLocationClaimV2>
  readonly entryTombstones: ReadonlyMap<string, ProjectEntryTombstoneV2>
  readonly contentFamilies: ReadonlyMap<string, ProjectContentVersionRecordV2>
  readonly contentPromotions: ReadonlyMap<string, ProjectContentPromotionRecordV2>
  readonly pathReservations: ReadonlyMap<string, ProjectPathReservationRecordV2>
  readonly canvasRoutes: ReadonlyMap<string, CanvasRouteFactV2>
  readonly operations: ReadonlyMap<string, ProjectOperationReceiptV2>
}

export interface ProjectIndexApplyResultV2 {
  readonly format: "convax.project-index-intent-result/2"
  readonly intentDigest: DigestV2
  readonly inserted: readonly { readonly root: Exclude<(typeof PROJECT_INDEX_ROOT_KEYS_V2)[number], "identity">; readonly key: string; readonly record: object }[]
}

export interface ProjectIndexExternalFactContextV2 {
  verifyBlob(versionRecordDigest: DigestV2, blob: ProjectBlobRefV2): boolean
  verifyCanvasGenesis(activation: CanvasRouteActivationV2): boolean
  verifyResetAuthorization(input: Extract<ProjectIndexIntentV2, { readonly kind: "project.canvas.route.reset/2" }>["body"]): boolean
}

export class ProjectIndexSchemaErrorV2 extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = "ProjectIndexSchemaErrorV2"
  }
}

export function projectIndexOwnerCanonicalizerDescriptorV2(schemaDigest: DigestV2): OwnerCanonicalizerDescriptorV2 {
  return Object.freeze({
    format: "convax.owner-canonicalizer-descriptor/2",
    owner: "project-index",
    ownerSchemaDigest: parseDigestV2(schemaDigest),
    canonicalStateFormat: "convax.project-index-canonical-state/2",
    canonicalStateCodec: "restricted-jcs-utf8",
    exactBytePolicy: "parse-reencode-byte-equal",
    unknownStatePolicy: "reject",
  })
}

export function createProjectIndexYDocV2(identityInput: ProjectIndexIdentityRecordV2, rootEntryInput: ProjectEntryRecordV2): Y.Doc {
  const identity = parseIdentity(identityInput)
  const rootEntry = parseEntry(rootEntryInput)
  if (rootEntry.entryId !== identity.rootDirectoryId || rootEntry.provenance !== "project-root" || rootEntry.kind !== "directory") {
    fail("invalid-genesis", "ProjectIndex genesis root directory does not match identity")
  }
  const document = new Y.Doc()
  document.transact(() => {
    const root = document.getMap(PROJECT_INDEX_ROOT_NAME_V2)
    for (const key of PROJECT_INDEX_ROOT_KEYS_V2) root.set(key, new Y.Map<unknown>())
    childMap(root, "identity").set("project", freezeJcs(identity))
    childMap(root, "entries").set(rootEntry.entryId, freezeJcs(rootEntry))
  }, "project-index-genesis-v2")
  validateProjectIndexYDocV2(document)
  return document
}

/** Binds only the ProjectIndex-owned root; installed bytes remain the sole state source. */
export function createProjectIndexReconstructionYDocV2(): Y.Doc {
  const document = new Y.Doc({ gc: false })
  document.getMap(PROJECT_INDEX_ROOT_NAME_V2)
  return document
}

export function cloneProjectIndexYDocV2(document: Y.Doc): Y.Doc {
  validateProjectIndexYDocV2(document)
  const clone = new Y.Doc()
  clone.getMap(PROJECT_INDEX_ROOT_NAME_V2)
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(document), "project-index-candidate-clone-v2")
  return clone
}

export function validateProjectIndexYDocV2(document: Y.Doc, scope?: ProjectIndexScopeV2): ProjectIndexSnapshotV2 {
  const names = [...document.share.keys()]
  if (names.length !== 1 || names[0] !== PROJECT_INDEX_ROOT_NAME_V2) fail("unknown-root", "ProjectIndex must contain exactly convax.project-index.v2")
  const root = document.share.get(PROJECT_INDEX_ROOT_NAME_V2)
  if (!(root instanceof Y.Map)) fail("invalid-root", "ProjectIndex root is not a Y.Map")
  assertMapKeys(root, PROJECT_INDEX_ROOT_KEYS_V2, "ProjectIndex root")
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
  const contentPromotions = readFactMap(root, "contentPromotions", parsePromotion, (key, value) => key === `p:${value.primaryFileId}:${value.promotionId}`)
  const pathReservations = readFactMap(root, "pathReservations", parseReservation, (key, value) => key === `x:${value.reservationId}`)
  const canvasRoutes = readFactMap(root, "canvasRoutes", parseCanvasRoute, (key, value) => key === `r:${value.canvasId}:${value.transitionId}`)
  const operations = readFactMap(root, "operations", parseReceipt, (key, value) => key === `o:${value.actorId}:${value.operationId}`)
  const rootEntry = entries.get(identity.rootDirectoryId)
  if (!rootEntry || rootEntry.kind !== "directory" || rootEntry.provenance !== "project-root") fail("invalid-root-entry", "Project root entry is absent or invalid")
  if ([...entryLocations.values()].some((claim) => claim.entryId === identity.rootDirectoryId) || [...entryTombstones.values()].some((fact) => fact.entryId === identity.rootDirectoryId)) {
    fail("invalid-root-entry", "Project root cannot have location or tombstone facts")
  }
  validateRelations({ identity, entries, entryLocations, entryTombstones, contentFamilies, contentPromotions, pathReservations, canvasRoutes, operations })
  return Object.freeze({ identity, entries, entryLocations, entryTombstones, contentFamilies, contentPromotions, pathReservations, canvasRoutes, operations })
}

export function extractProjectCanonicalStateV2(document: Y.Doc): ProjectCanonicalStateV2 {
  const snapshot = validateProjectIndexYDocV2(document)
  return Object.freeze({
    format: "convax.project-index-canonical-state/2",
    identity: Object.freeze([["project", snapshot.identity] as const]),
    entries: canonicalEntries(snapshot.entries),
    entryLocations: canonicalEntries(snapshot.entryLocations),
    entryTombstones: canonicalEntries(snapshot.entryTombstones),
    contentFamilies: canonicalEntries(snapshot.contentFamilies),
    contentPromotions: canonicalEntries(snapshot.contentPromotions),
    pathReservations: canonicalEntries(snapshot.pathReservations),
    canvasRoutes: canonicalEntries(snapshot.canvasRoutes),
    operations: canonicalEntries(snapshot.operations),
  })
}

export function encodeProjectCanonicalStateV2(document: Y.Doc): Uint8Array {
  return encodeRestrictedJcsV2(extractProjectCanonicalStateV2(document))
}

export function projectProjectIndexV2(document: Y.Doc): ProjectIndexProjectionV2 {
  return projectProjectIndexSnapshotV2(validateProjectIndexYDocV2(document))
}

/**
 * Exact portable resource roots selected by ProjectIndex. This is the only
 * structural source for blob currentness: native presence, transfer journals and
 * filesystem enumeration must never choose a version.
 */
export function projectIndexCurrentBlobReferencesV2(document: Y.Doc): readonly ProjectResourceReferenceV2[] {
  return projectIndexCurrentBlobReferencesFromSnapshotV2(validateProjectIndexYDocV2(document))
}

/**
 * Projects current blob roots from the already owner-validated state exposed by
 * the Collaboration session. Desktop callers never receive the Y.Doc or infer
 * currentness from native files.
 */
export function projectIndexCurrentBlobReferencesFromValidatedOwnerStateV2(
  state: OwnerValidatedStateV2<"project-index">,
): readonly ProjectResourceReferenceV2[] {
  const snapshot = projectIndexSnapshotFromValidatedOwnerStateV2(state)
  if (snapshot === null) fail("invalid-owner-state", "ProjectIndex owner returned an invalid validated state")
  return projectIndexCurrentBlobReferencesFromSnapshotV2(snapshot)
}

function projectIndexCurrentBlobReferencesFromSnapshotV2(
  snapshot: ProjectIndexSnapshotV2,
): readonly ProjectResourceReferenceV2[] {
  const projection = projectProjectIndexSnapshotV2(snapshot)
  const references: ProjectResourceReferenceV2[] = []
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
    const entry = compareUtf8V2(left.entryFileId, right.entryFileId)
    return entry === 0 ? compareUtf8V2(left.versionId, right.versionId) : entry
  }))
}

export function projectProjectIndexSnapshotV2(snapshot: ProjectIndexSnapshotV2): ProjectIndexProjectionV2 {
  const tombstoned = tombstonedEntries(snapshot)
  const families = projectFamilies(snapshot, tombstoned)
  return Object.freeze({
    identity: snapshot.identity,
    liveEntryIds: Object.freeze([...snapshot.entries.keys()].filter((id) => !tombstoned.has(id)).sort(compareUtf8V2) as ProjectEntryIdV2[]),
    tombstonedEntryIds: Object.freeze([...tombstoned].sort(compareUtf8V2) as ProjectEntryIdV2[]),
    contentFamilies: Object.freeze(families),
    canvasRoutes: Object.freeze(projectRoutes(snapshot)),
  })
}

export function projectIndexRecordDigestV2(record: { readonly format: string }): DigestV2 {
  return digestParts(RECORD_DOMAIN, encoder.encode(record.format), Uint8Array.of(0), encodeRestrictedJcsV2(record))
}

export function projectIndexIntentDigestV2(intent: ProjectIndexIntentV2): DigestV2 {
  return digestParts(INTENT_DOMAIN, encodeRestrictedJcsV2(intent))
}

export function projectResourceReferenceDigestV2(reference: ProjectResourceReferenceV2): DigestV2 {
  return digestParts(RESOURCE_REFERENCE_DOMAIN, encodeRestrictedJcsV2(parseProjectResourceReferenceV2(reference)))
}

export function parseProjectResourceReferenceV2(value: unknown): ProjectResourceReferenceV2 {
  assertExactKeysV2(value, [
    "format", "projectId", "projectEpoch", "entryFileId", "familyPrimaryFileId",
    "versionId", "canonicalUri", "blob", "versionRecordDigest",
  ], "Project resource reference")
  const record = value as unknown as ProjectResourceReferenceV2
  if (record.format !== "convax.project-resource-reference/2") fail("invalid-resource-reference", "Project resource reference format is invalid")
  const projectId = parseProjectIdV2(record.projectId)
  const projectEpoch = parseId128V2(record.projectEpoch)
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
  const versionRecordDigest = parseDigestV2(record.versionRecordDigest)
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

export function projectCanvasRouteProjectionDigestV2(
  projection: ProjectCanvasRouteProjectionV2,
): DigestV2 {
  return structuredDigestV2("convax.project-route-projection/2", projection)
}

export function projectEntryLocationProjectionDigestV2(
  projection: ProjectEntryLocationProjectionV2,
): DigestV2 {
  return structuredDigestV2("convax.project-entry-location-projection/2", projection)
}

export function projectContentFamilyProjectionDigestV2(
  projection: ProjectContentFamilyProjectionV2,
): DigestV2 {
  return structuredDigestV2("convax.project-content-family-projection/2", projection)
}

export function projectConflictProjectionDigestV2(
  projection: ProjectConflictProjectionV2,
): DigestV2 {
  return structuredDigestV2("convax.project-conflict-projection/2", projection)
}

export function projectEntryLocationProjectionV2(
  snapshot: ProjectIndexSnapshotV2,
  entryIdInput: ProjectEntryIdV2,
): ProjectEntryLocationProjectionV2 {
  const entryId = parseProjectEntryId(entryIdInput)
  const base = projectEntryLocationOutcomeV2(snapshot, entryId)
  const baseBytes = encodeRestrictedJcsV2({
    format: "convax.project-entry-location-counterfactual-outcome/2",
    status: "valid",
    projection: base,
  })
  const dependencies: DigestV2[] = []
  const seen = new Set<DigestV2>()
  for (const candidate of locationCounterfactualCandidates(snapshot, entryId)) {
    const digest = projectIndexRecordDigestV2(candidate.record as { readonly format: string })
    if (seen.has(digest)) fail("duplicate-record-digest", "Project location candidates reuse a record digest")
    seen.add(digest)
    const reduced = snapshotWithoutRecord(snapshot, candidate.root, candidate.key)
    let counterfactual: unknown
    try {
      counterfactual = {
        format: "convax.project-entry-location-counterfactual-outcome/2",
        status: "valid",
        projection: projectEntryLocationOutcomeV2(reduced, entryId),
      }
    } catch {
      counterfactual = {
        format: "convax.project-entry-location-counterfactual-outcome/2",
        status: "invalid",
        entryId,
        reason: "accepted-record-removal-invalidated-resolution",
      }
    }
    if (compareUint8(baseBytes, encodeRestrictedJcsV2(counterfactual)) !== 0) dependencies.push(digest)
  }
  dependencies.sort(compareUtf8V2)
  return Object.freeze({ ...base, resolutionDependencyRecordDigests: Object.freeze(dependencies) })
}

export function projectContentFamilyProjectionV2(
  snapshot: ProjectIndexSnapshotV2,
  primaryFileIdInput: ProjectFileIdV2,
): ProjectContentFamilyProjectionV2 {
  const primaryFileId = parseProjectFileId(primaryFileIdInput)
  const entry = snapshot.entries.get(primaryFileId) ?? null
  const versions = [...snapshot.contentFamilies.values()]
    .filter((version) => version.primaryFileId === primaryFileId)
    .sort((left, right) => compareUtf8V2(left.versionId, right.versionId))
  const superseded = new Set(versions.flatMap((version) => [...version.supersedesVersionIds]))
  const live = versions
    .filter((version) => !superseded.has(version.versionId))
    .sort((left, right) => compareUtf8V2(left.versionId, right.versionId))
  const tombstoned = !isLiveEntry(snapshot, primaryFileId)
  let current: ProjectContentVersionRecordV2 | null = null
  if (!tombstoned) {
    if (entry?.contentPolicy === "overwritable-binary") current = maxBinary(versions)
    else if (entry?.contentPolicy === "immutable") current = versions[0] ?? null
    else current = maxStamp(live)
  }
  const activeConflictProjectionDigests = [...snapshot.contentPromotions.values()]
    .filter((promotion) => promotion.primaryFileId === primaryFileId)
    .map((promotion) => projectConflictProjectionV2(snapshot, promotion))
    .filter((projection) => projection.state !== "dormant")
    .map(projectConflictProjectionDigestV2)
    .sort(compareUtf8V2)
  return Object.freeze({
    format: "convax.project-content-family-projection/2",
    primaryFileId,
    primaryEntryRecordDigest: entry === null ? null : projectIndexRecordDigestV2(entry),
    contentPolicy: entry?.contentPolicy ?? null,
    versions: Object.freeze(versions.map((version) => Object.freeze([
      version.versionId,
      projectIndexRecordDigestV2(version),
    ] as const))),
    liveHeadVersionIds: Object.freeze(live.map((version) => version.versionId)),
    currentVersionId: current?.versionId ?? null,
    activeConflictProjectionDigests: Object.freeze(activeConflictProjectionDigests),
  })
}

function projectConflictProjectionV2(
  snapshot: ProjectIndexSnapshotV2,
  promotion: ProjectContentPromotionRecordV2,
): ProjectConflictProjectionV2 {
  const source = snapshot.contentFamilies.get(`v:${promotion.primaryFileId}:${promotion.versionId}`)
  const reservation = snapshot.pathReservations.get(`x:${promotion.reservationId}`)
  const entry = snapshot.entries.get(promotion.reservedConflictFileId)
  if (!source || !reservation || !entry || entry.entryId !== reservation.reservedEntryId) {
    fail("invalid-conflict-copy", "Conflict projection records do not cross-bind")
  }
  const active = activeConflictCopies(
    snapshot,
    [...snapshot.contentFamilies.values()].filter((version) => version.primaryFileId === promotion.primaryFileId),
  ).includes(promotion.reservedConflictFileId)
  const tombstoned = !isLiveEntry(snapshot, promotion.reservedConflictFileId)
  if (!active && !tombstoned) {
    return Object.freeze({
      format: "convax.project-conflict-projection/2",
      primaryFileId: promotion.primaryFileId,
      sourceVersionId: source.versionId,
      sourceVersionRecordDigest: projectIndexRecordDigestV2(source),
      promotionRecordDigest: projectIndexRecordDigestV2(promotion),
      reservationRecordDigest: projectIndexRecordDigestV2(reservation),
      reservedEntryId: promotion.reservedConflictFileId,
      reservedEntryRecordDigest: projectIndexRecordDigestV2(entry),
      reservedEntryLocationProjectionDigest: null,
      state: "dormant",
      cause: "promotion-dormant",
      materializedPath: null,
    })
  }
  const location = projectEntryLocationProjectionV2(snapshot, promotion.reservedConflictFileId)
  const locationDigest = projectEntryLocationProjectionDigestV2(location)
  if (tombstoned) {
    return Object.freeze({
      format: "convax.project-conflict-projection/2",
      primaryFileId: promotion.primaryFileId,
      sourceVersionId: source.versionId,
      sourceVersionRecordDigest: projectIndexRecordDigestV2(source),
      promotionRecordDigest: projectIndexRecordDigestV2(promotion),
      reservationRecordDigest: projectIndexRecordDigestV2(reservation),
      reservedEntryId: promotion.reservedConflictFileId,
      reservedEntryRecordDigest: projectIndexRecordDigestV2(entry),
      reservedEntryLocationProjectionDigest: locationDigest,
      state: "tombstoned",
      cause: "reserved-entry-tombstoned",
      materializedPath: null,
    })
  }
  const reserved = location.cause === "active-conflict-reservation-no-explicit" ||
    location.cause === "active-conflict-reservation-after-declared-missing"
  return Object.freeze({
    format: "convax.project-conflict-projection/2",
    primaryFileId: promotion.primaryFileId,
    sourceVersionId: source.versionId,
    sourceVersionRecordDigest: projectIndexRecordDigestV2(source),
    promotionRecordDigest: projectIndexRecordDigestV2(promotion),
    reservationRecordDigest: projectIndexRecordDigestV2(reservation),
    reservedEntryId: promotion.reservedConflictFileId,
    reservedEntryRecordDigest: projectIndexRecordDigestV2(entry),
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

function projectEntryLocationOutcomeV2(
  snapshot: ProjectIndexSnapshotV2,
  entryId: ProjectEntryIdV2,
): ProjectEntryLocationOutcomeValueV2 {
  const entry = snapshot.entries.get(entryId)
  if (!entry) return locationOutcome(entryId, null, [], null, "absent", "entry-absent", null, null)
  const entryDigest = projectIndexRecordDigestV2(entry)
  const tombstones = [...snapshot.entryTombstones.values()]
    .filter((record) => record.entryId === entryId)
    .map(projectIndexRecordDigestV2)
    .sort(compareUtf8V2)
  if (tombstones.length > 0) {
    return locationOutcome(entryId, entryDigest, tombstones, null, "tombstoned", "entry-tombstoned", null, null)
  }
  if (entryId === snapshot.identity.rootDirectoryId) {
    return locationOutcome(entryId, entryDigest, [], null, "live-linked", "project-root", "", null)
  }
  const claims = selectedLocationClaims(snapshot, entryId)
  const selected = maxStamp(claims)
  const selectedDigest = selected === null ? null : projectIndexRecordDigestV2(selected)
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
  snapshot: ProjectIndexSnapshotV2,
  entry: ProjectEntryRecordV2,
  selected: ProjectEntryLocationClaimV2,
  entryDigest: DigestV2,
  selectedDigest: DigestV2,
): ProjectEntryLocationOutcomeValueV2 {
  const chain: Array<Readonly<{ entry: ProjectEntryRecordV2; claim: ProjectEntryLocationClaimV2 }>> = []
  const seen = new Set<ProjectEntryIdV2>([entry.entryId])
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
  entryId: ProjectEntryIdV2,
  entryRecordDigest: DigestV2 | null,
  tombstoneRecordDigests: readonly DigestV2[],
  selectedLocationRecordDigest: DigestV2 | null,
  state: ProjectEntryLocationOutcomeValueV2["state"],
  cause: ProjectEntryLocationCauseV2,
  portablePath: string | null,
  pathClaimWinnerEntryId: ProjectEntryIdV2 | null,
): ProjectEntryLocationOutcomeValueV2 {
  return Object.freeze({
    format: "convax.project-entry-location-projection/2",
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

function selectedLocationClaims(snapshot: ProjectIndexSnapshotV2, entryId: ProjectEntryIdV2) {
  return [...snapshot.entryLocations.values()].filter((claim) => claim.entryId === entryId)
}

function pathClaimWinner(
  snapshot: ProjectIndexSnapshotV2,
  parentDirectoryId: ProjectDirectoryIdV2,
  basename: string,
): ProjectEntryIdV2 {
  const candidates = [...snapshot.entries.values()]
    .filter((entry) => isLiveEntry(snapshot, entry.entryId))
    .flatMap((entry) => {
      const claim = maxStamp(selectedLocationClaims(snapshot, entry.entryId))
      return claim?.state === "linked" && claim.parentDirectoryId === parentDirectoryId && claim.basename === basename
        ? [{ entryId: entry.entryId, claim }]
        : []
    })
    .sort((left, right) => {
      const byStamp = comparePortableStampsV2(left.claim.stamp, right.claim.stamp)
      return byStamp === 0 ? compareUtf8V2(left.entryId, right.entryId) : byStamp
    })
  const winner = candidates.at(-1)
  if (!winner) fail("invalid-location", "Linked path has no claim winner")
  return winner.entryId
}

function conflictEntryIsActive(snapshot: ProjectIndexSnapshotV2, entry: ProjectEntryRecordV2): boolean {
  if (entry.conflictSource === null) return false
  const versions = [...snapshot.contentFamilies.values()].filter(
    (version) => version.primaryFileId === entry.conflictSource!.primaryFileId,
  )
  return activeConflictCopies(snapshot, versions).includes(entry.entryId as ProjectFileIdV2)
}

type LocationCounterfactualRootV2 =
  | "entries"
  | "entryLocations"
  | "entryTombstones"
  | "contentFamilies"
  | "contentPromotions"
  | "pathReservations"

function locationCounterfactualCandidates(snapshot: ProjectIndexSnapshotV2, entryId: ProjectEntryIdV2) {
  const result: Array<Readonly<{ root: LocationCounterfactualRootV2; key: string; record: object }>> = []
  const add = (root: LocationCounterfactualRootV2, map: ReadonlyMap<string, object>) => {
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
  add("contentPromotions", snapshot.contentPromotions)
  add("pathReservations", snapshot.pathReservations)
  return result.sort((left, right) => {
    const byRoot = compareUtf8V2(left.root, right.root)
    if (byRoot !== 0) return byRoot
    const byKey = compareUtf8V2(left.key, right.key)
    if (byKey !== 0) return byKey
    return compareUtf8V2(
      projectIndexRecordDigestV2(left.record as { readonly format: string }),
      projectIndexRecordDigestV2(right.record as { readonly format: string }),
    )
  })
}

function snapshotWithoutRecord(
  snapshot: ProjectIndexSnapshotV2,
  root: LocationCounterfactualRootV2,
  key: string,
): ProjectIndexSnapshotV2 {
  const replacement = new Map(snapshot[root] as ReadonlyMap<string, unknown>)
  replacement.delete(key)
  return Object.freeze({ ...snapshot, [root]: replacement }) as ProjectIndexSnapshotV2
}

export type ProjectDerivedIdentityKindV2 = "file" | "directory" | "version" | "location" | "tombstone" | "promotion" | "reservation" | "canvas" | "route-transition"

export function deriveProjectIdentityV2(context: OwnerIntentConstructionContextV2, kind: ProjectDerivedIdentityKindV2, ordinalInput: Uint32V2): string {
  const ordinal = parseUint32V2(ordinalInput)
  const core = {
    format: "convax.project-derived-identity-core/2",
    scope: parseProjectIndexScope(context.scope),
    actorId: parseActorIdV2(context.actorId),
    operationId: parseId128V2(context.operationId),
    ordinal,
    kind,
  } as const
  const suffix = structuredDigestV2(DERIVED_DOMAIN, core)
  const prefix = { file: "pf_", directory: "pd_", version: "pv_", location: "pl_", tombstone: "pt_", promotion: "pp_", reservation: "pr_", canvas: "cv_", "route-transition": "cr_" }[kind]
  return `${prefix}${suffix}`
}

/** Exact precommit helper for Project-owned default-Canvas creation claims. */
export function deriveProjectCanvasIdForOperationV2(input: Readonly<{
  scope: DocumentScopeV2 & { readonly docKind: "project-index" }
  actorId: ActorIdV2
  operationId: Id128V2
}>): CanvasIdV2 {
  const core = Object.freeze({
    format: "convax.project-derived-identity-core/2",
    scope: parseProjectIndexScope(input.scope),
    actorId: parseActorIdV2(input.actorId),
    operationId: parseId128V2(input.operationId),
    ordinal: parseUint32V2("0"),
    kind: "canvas" as const,
  })
  return parseCanvasIdV2(`cv_${structuredDigestV2(DERIVED_DOMAIN, core)}`)
}

export function projectIndexSnapshotFromValidatedOwnerStateV2(
  base: OwnerValidatedStateV2<"project-index">,
): ProjectIndexSnapshotV2 | null {
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
  return value as ProjectIndexSnapshotV2
}

export function constructProjectDirectoryCreateIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly parentDirectoryId: ProjectDirectoryIdV2
  readonly basename: string
}): Readonly<{ readonly directoryId: ProjectDirectoryIdV2; readonly intent: ProjectIndexIntentV2 }> | "rejected" {
  try {
    const directoryId = parseProjectDirectoryId(deriveProjectIdentityV2(input.context, "directory", "0" as Uint32V2))
    const entry: ProjectEntryRecordV2 = Object.freeze({
      format: "convax.project-entry/2",
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
    const location: ProjectEntryLocationClaimV2 = Object.freeze({
      format: "convax.project-entry-location/2",
      claimId: deriveProjectIdentityV2(input.context, "location", "1" as Uint32V2) as ProjectFactIdV2,
      entryId: directoryId,
      state: "linked",
      parentDirectoryId: parseProjectDirectoryId(input.parentDirectoryId),
      basename: requirePortableBasename(input.basename),
      reason: "create",
      stamp: stampForConstruction(input.context, "1"),
    })
    const intent = materializeProjectIndexIntentGuardsV2({
      snapshot: input.snapshot,
      context: input.context,
      intent: { format: "convax.typed-intent/2", kind: "project.directory.create/2", guards: [], body: { entry, location } },
    })
    return intent === "rejected" ? "rejected" : Object.freeze({ directoryId, intent })
  } catch { return "rejected" }
}

export function constructProjectFileCreateIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly parentDirectoryId: ProjectDirectoryIdV2 | null
  readonly basename: string | null
  readonly blob: ProjectBlobRefV2
  readonly contentPolicy: Exclude<ProjectContentPolicyV2, "none">
  readonly storageClass: ProjectStorageClassV2
  readonly provenance: Exclude<ProjectEntryRecordV2["provenance"], "project-root" | "content-conflict-copy">
  readonly pathHint?: string
}): Readonly<{ readonly fileId: ProjectFileIdV2; readonly version: ProjectContentVersionRecordV2; readonly intent: ProjectIndexIntentV2 }> | "rejected" {
  try {
    const fileId = parseProjectFileId(deriveProjectIdentityV2(input.context, "file", "0" as Uint32V2))
    const entry: ProjectEntryRecordV2 = Object.freeze({
      format: "convax.project-entry/2",
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
      format: "convax.project-entry-location/2" as const,
      claimId: deriveProjectIdentityV2(input.context, "location", "1" as Uint32V2) as ProjectFactIdV2,
      entryId: fileId,
      state: "linked" as const,
      parentDirectoryId: parseProjectDirectoryId(input.parentDirectoryId),
      basename: requirePortableBasename(input.basename),
      reason: "create" as const,
      stamp: stampForConstruction(input.context, "1"),
    }) : null
    if (input.storageClass === "managed-blob" && (input.parentDirectoryId !== null || input.basename !== null)) return "rejected"
    const versionId = deriveProjectIdentityV2(input.context, "version", "2" as Uint32V2) as ProjectVersionIdV2
    const blob = parseBlob(input.blob)
    const version: ProjectContentVersionRecordV2 = Object.freeze({
      format: "convax.project-content-version/2",
      primaryFileId: fileId,
      versionId,
      writeClass: "initial",
      blob,
      canonicalRevisionUri: projectRevisionUri(input.snapshot.identity, fileId, blob, input.pathHint),
      supersedesVersionIds: Object.freeze([]),
      binaryLogicalCounter: input.contentPolicy === "overwritable-binary" ? "0" as Uint64V2 : null,
      creatorActorId: input.context.actorId,
      creatorOperationId: input.context.operationId,
      stamp: stampForConstruction(input.context, "2"),
    })
    const intent = materializeProjectIndexIntentGuardsV2({
      snapshot: input.snapshot,
      context: input.context,
      intent: { format: "convax.typed-intent/2", kind: "project.file.create/2", guards: [], body: { entry, location, initialVersion: version } },
    })
    return intent === "rejected" ? "rejected" : Object.freeze({ fileId, version, intent })
  } catch { return "rejected" }
}

export function constructProjectEntryLocateIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly entryId: ProjectEntryIdV2
  readonly parentDirectoryId: ProjectDirectoryIdV2
  readonly basename: string
  readonly reason: "move" | "rename" | "explicit-relink"
}): ProjectIndexIntentV2 | "rejected" {
  try {
    const location: ProjectEntryLocationClaimV2 = Object.freeze({
      format: "convax.project-entry-location/2",
      claimId: deriveProjectIdentityV2(input.context, "location", "0" as Uint32V2) as ProjectFactIdV2,
      entryId: parseProjectEntryId(input.entryId),
      state: "linked",
      parentDirectoryId: parseProjectDirectoryId(input.parentDirectoryId),
      basename: requirePortableBasename(input.basename),
      reason: input.reason,
      stamp: stampForConstruction(input.context, "0"),
    })
    return materializeProjectIndexIntentGuardsV2({ snapshot: input.snapshot, context: input.context, intent: { format: "convax.typed-intent/2", kind: "project.entry.locate/2", guards: [], body: { location } } })
  } catch { return "rejected" }
}

export function constructProjectEntryTombstoneIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly entryId: ProjectEntryIdV2
}): ProjectIndexIntentV2 | "rejected" {
  try {
    const entryId = parseProjectEntryId(input.entryId)
    const entry = input.snapshot.entries.get(entryId)
    if (!entry) return "rejected"
    const tombstone: ProjectEntryTombstoneV2 = Object.freeze({
      format: "convax.project-entry-tombstone/2",
      tombstoneId: deriveProjectIdentityV2(input.context, "tombstone", "0" as Uint32V2) as ProjectFactIdV2,
      entryId,
      reason: "explicit-delete",
      observedEntryDigest: projectIndexRecordDigestV2(entry),
      stamp: stampForConstruction(input.context, "0"),
    })
    return materializeProjectIndexIntentGuardsV2({ snapshot: input.snapshot, context: input.context, intent: { format: "convax.typed-intent/2", kind: "project.entry.tombstone/2", guards: [], body: { tombstone } } })
  } catch { return "rejected" }
}

export function constructProjectFileWriteIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly fileId: ProjectFileIdV2
  readonly blob: ProjectBlobRefV2
  readonly pathHint?: string
  readonly basenameHint: string
}): Readonly<{ readonly version: ProjectContentVersionRecordV2; readonly intent: ProjectIndexIntentV2 }> | "rejected" {
  try {
    const fileId = parseProjectFileId(input.fileId)
    const entry = input.snapshot.entries.get(fileId)
    if (!entry || entry.kind !== "file") return "rejected"
    const family = projectContentFamilyProjectionV2(input.snapshot, fileId)
    const versionId = deriveProjectIdentityV2(input.context, "version", "0" as Uint32V2) as ProjectVersionIdV2
    const blob = parseBlob(input.blob)
    if (entry.contentPolicy === "overwritable-binary") {
      const currentId = family.currentVersionId
      const current = currentId === null ? null : input.snapshot.contentFamilies.get(`v:${fileId}:${currentId}`)
      if (!current) return "rejected"
      const version: ProjectContentVersionRecordV2 = Object.freeze({
        format: "convax.project-content-version/2", primaryFileId: fileId, versionId,
        writeClass: "binary-overwrite", blob,
        canonicalRevisionUri: projectRevisionUri(input.snapshot.identity, fileId, blob, input.pathHint),
        supersedesVersionIds: Object.freeze([current.versionId]),
        binaryLogicalCounter: String(BigInt(current.binaryLogicalCounter ?? "0") + 1n) as Uint64V2,
        creatorActorId: input.context.actorId, creatorOperationId: input.context.operationId,
        stamp: stampForConstruction(input.context, "0"),
      })
      const intent = materializeProjectIndexIntentGuardsV2({ snapshot: input.snapshot, context: input.context, intent: { format: "convax.typed-intent/2", kind: "project.file.overwrite-binary/2", guards: [], body: { version } } })
      return intent === "rejected" ? "rejected" : Object.freeze({ version, intent })
    }
    if (entry.contentPolicy !== "conflict-preserving-text") return "rejected"
    const conflictFileId = deriveProjectIdentityV2(input.context, "file", "1" as Uint32V2) as ProjectFileIdV2
    const promotionId = deriveProjectIdentityV2(input.context, "promotion", "2" as Uint32V2) as ProjectFactIdV2
    const reservationId = deriveProjectIdentityV2(input.context, "reservation", "3" as Uint32V2) as ProjectFactIdV2
    const version: ProjectContentVersionRecordV2 = Object.freeze({
      format: "convax.project-content-version/2", primaryFileId: fileId, versionId,
      writeClass: "text-write", blob,
      canonicalRevisionUri: projectRevisionUri(input.snapshot.identity, fileId, blob, input.pathHint),
      supersedesVersionIds: Object.freeze([...family.liveHeadVersionIds]), binaryLogicalCounter: null,
      creatorActorId: input.context.actorId, creatorOperationId: input.context.operationId,
      stamp: stampForConstruction(input.context, "0"),
    })
    const conflictEntry: ProjectEntryRecordV2 = Object.freeze({
      format: "convax.project-entry/2", entryId: conflictFileId, kind: "file", storageClass: "project-file",
      contentPolicy: "conflict-preserving-text", provenance: "content-conflict-copy",
      conflictSource: { primaryFileId: fileId, sourceVersionId: versionId, promotionId, reservationId },
      createdByActorId: input.context.actorId, createdByOperationId: input.context.operationId,
      createdStamp: stampForConstruction(input.context, "1"),
    })
    const promotion: ProjectContentPromotionRecordV2 = Object.freeze({ format: "convax.project-content-promotion/2", promotionId, primaryFileId: fileId, versionId, reservedConflictFileId: conflictFileId, reservationId, stamp: stampForConstruction(input.context, "2") })
    const reservation: ProjectPathReservationRecordV2 = Object.freeze({ format: "convax.project-path-reservation/2", reservationId, kind: "content-conflict-copy", primaryFileId: fileId, versionId, reservedEntryId: conflictFileId, canonicalPath: `.convax-conflicts/${conflictFileId}/content`, originalBasenameHint: requirePortableBasename(input.basenameHint), stamp: stampForConstruction(input.context, "3") })
    const intent = materializeProjectIndexIntentGuardsV2({ snapshot: input.snapshot, context: input.context, intent: { format: "convax.typed-intent/2", kind: "project.file.write-text/2", guards: [], body: { version, conflictEntry, promotion, reservation } } })
    return intent === "rejected" ? "rejected" : Object.freeze({ version, intent })
  } catch { return "rejected" }
}

export function projectResourceReferenceForVersionV2(
  snapshot: ProjectIndexSnapshotV2,
  version: ProjectContentVersionRecordV2,
  entryFileId: ProjectFileIdV2 = version.primaryFileId,
): ProjectResourceReferenceV2 {
  return resourceReference(snapshot.identity, version, parseProjectFileId(entryFileId))
}

function projectRevisionUri(
  identity: ProjectIndexIdentityRecordV2,
  fileId: ProjectFileIdV2,
  blob: ProjectBlobRefV2,
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

export function constructProjectCanvasRouteStageIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly shardEpoch: Id128V2
  readonly title: string
}): Readonly<{ readonly canvasId: CanvasIdV2; readonly intent: ProjectIndexIntentV2 }> | "rejected" {
  try {
    const canvasId = parseCanvasIdV2(deriveProjectIdentityV2(input.context, "canvas", parseUint32V2("0")))
    if (routeFacts(input.snapshot, canvasId).length > 0) return "rejected"
    const transitionId = deriveProjectIdentityV2(
      input.context,
      "route-transition",
      parseUint32V2("1"),
    ) as ProjectFactIdV2
    const stage: CanvasRouteStageV2 = Object.freeze({
      format: "convax.canvas-route-stage/2",
      transitionId,
      canvasId,
      shardEpoch: parseId128V2(input.shardEpoch),
      title: requireRouteTitle(input.title),
      reason: "create",
      stamp: stampForConstruction(input.context, "1"),
    })
    return Object.freeze({
      canvasId,
      intent: Object.freeze({
        format: "convax.typed-intent/2",
        kind: "project.canvas.route.stage/2",
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

export function constructProjectCanvasRouteActivationIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly canvasId: CanvasIdV2
  readonly projectIndexRouteDependencyFrameDigest: DigestV2
  readonly canvasGenesisCheckpointObjectDigest: DigestV2
  readonly stagedProjectIndexFrontierDigest: DigestV2
}): ProjectIndexIntentV2 | "rejected" {
  try {
    const canvasId = parseCanvasIdV2(input.canvasId)
    const facts = routeFacts(input.snapshot, canvasId)
    const stages = facts.filter((fact): fact is CanvasRouteStageV2 => fact.format === "convax.canvas-route-stage/2")
    if (stages.length !== 1 || facts.some((fact) => fact.format === "convax.canvas-route-tombstone/2")) {
      return "rejected"
    }
    const stage = stages[0]!
    const activation: CanvasRouteActivationV2 = Object.freeze({
      format: "convax.canvas-route-activation/2",
      transitionId: deriveProjectIdentityV2(
        input.context,
        "route-transition",
        parseUint32V2("0"),
      ) as ProjectFactIdV2,
      canvasId,
      shardEpoch: stage.shardEpoch,
      predecessorActivationDigest: null,
      stageRecordDigest: projectIndexRecordDigestV2(stage),
      projectIndexRouteDependencyFrameDigest: parseDigestV2(input.projectIndexRouteDependencyFrameDigest),
      canvasGenesisCheckpointObjectDigest: parseDigestV2(input.canvasGenesisCheckpointObjectDigest),
      stagedProjectIndexFrontierDigest: parseDigestV2(input.stagedProjectIndexFrontierDigest),
      stamp: stampForConstruction(input.context, "0"),
    })
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "project.canvas.route.activate/2",
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

export function constructProjectCanvasRouteRenameIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly canvasId: CanvasIdV2
  readonly title: string
}): ProjectIndexIntentV2 | "rejected" {
  try {
    const canvasId = parseCanvasIdV2(input.canvasId)
    const route = projectRoutes(input.snapshot).find((candidate) => candidate.canvasId === canvasId)
    if (route?.state !== "live" || route.currentActivationDigest === null) return "rejected"
    const metadata: CanvasRouteMetadataClaimV2 = Object.freeze({
      format: "convax.canvas-route-metadata/2",
      transitionId: deriveProjectIdentityV2(
        input.context,
        "route-transition",
        parseUint32V2("0"),
      ) as ProjectFactIdV2,
      canvasId,
      title: requireRouteTitle(input.title),
      observedActivationDigest: route.currentActivationDigest,
      stamp: stampForConstruction(input.context, "0"),
    })
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "project.canvas.route.rename/2",
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

export function constructProjectCanvasRouteTombstoneIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly canvasId: CanvasIdV2
}): ProjectIndexIntentV2 | "rejected" {
  try {
    const canvasId = parseCanvasIdV2(input.canvasId)
    const route = projectCanvasRouteProjectionV2(input.snapshot, canvasId)
    if (!route || route.state === "tombstoned") return "rejected"
    const tombstone: CanvasRouteTombstoneV2 = Object.freeze({
      format: "convax.canvas-route-tombstone/2",
      transitionId: deriveProjectIdentityV2(
        input.context,
        "route-transition",
        parseUint32V2("0"),
      ) as ProjectFactIdV2,
      canvasId,
      observedActivationDigest: route.currentActivationDigest,
      reason: "explicit-delete",
      stamp: stampForConstruction(input.context, "0"),
    })
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "project.canvas.route.tombstone/2",
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

export function constructProjectCanvasRouteResetIntentV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly routeCasCore: DocumentShardResetRouteCasCoreV2
  readonly resetClaim: DocumentShardResetClaimV2
  readonly confirmation: DocumentShardResetConfirmationV2
  readonly approval: DocumentShardResetApprovalV2
}): Extract<ProjectIndexIntentV2, { readonly kind: "project.canvas.route.reset/2" }> | "rejected" {
  try {
    const routeCasCore = parseDocumentShardResetRouteCasCoreV2(input.routeCasCore)
    const resetClaim = parseDocumentShardResetClaimV2(input.resetClaim)
    const confirmation = parseDocumentShardResetConfirmationV2(input.confirmation)
    const approval = parseDocumentShardResetApprovalV2(input.approval)
    const canvasId = routeCasCore.canvasId
    const route = projectCanvasRouteProjectionV2(input.snapshot, canvasId)
    if (
      route.state !== "live" ||
      route.currentActivationDigest === null ||
      route.currentShardEpoch === null ||
      routeCasCore.operationId !== input.context.operationId ||
      routeCasCore.oldScope.shardEpoch !== route.currentShardEpoch ||
      routeCasCore.predecessorActivationDigest !== route.currentActivationDigest
    ) return "rejected"
    const resetCommit: CanvasRouteResetCommitV2 = Object.freeze({
      format: "convax.canvas-route-reset-commit/2",
      transitionId: deriveProjectIdentityV2(
        input.context,
        "route-transition",
        parseUint32V2("0"),
      ) as ProjectFactIdV2,
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
      routeCasCoreDigest: structuredDigestV2(
        "convax.document-shard-reset-route-cas-core-digest/2",
        routeCasCore,
      ),
      stamp: stampForConstruction(input.context, "0"),
    })
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "project.canvas.route.reset/2",
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

export function materializeProjectIndexIntentGuardsV2(input: {
  readonly snapshot: ProjectIndexSnapshotV2
  readonly context: OwnerIntentConstructionContextV2
  readonly intent: ProjectIndexIntentV2
}): ProjectIndexIntentV2 | "rejected" {
  try {
    return parseIntent({
      ...input.intent,
      guards: projectIndexRequiredGuardsV2(input.snapshot, input.context, input.intent),
    })
  } catch {
    return "rejected"
  }
}

export function applyProjectIndexCandidateIntentV2(
  document: Y.Doc,
  context: OwnerIntentValidationContextV2,
  intentInput: ProjectIndexIntentV2,
  facts: ProjectIndexExternalFactContextV2,
): ProjectIndexApplyResultV2 | "rejected" {
  try {
    const intent = parseIntent(intentInput)
    const snapshot = validateProjectIndexYDocV2(document, parseProjectIndexScope(context.scope))
    if (context.ownerSchemaDigest !== snapshot.identity.schemaDigest || context.protocolDigest !== snapshot.identity.protocolDigest) return "rejected"
    const intentDigest = projectIndexIntentDigestV2(intent)
    if (context.intentDigest !== intentDigest) return "rejected"
    const operationKey = `o:${context.actorId}:${context.operationId}`
    const existing = snapshot.operations.get(operationKey)
    if (existing) return existing.intentDigest === intentDigest && existing.intentKind === intent.kind ? { format: "convax.project-index-intent-result/2", intentDigest, inserted: [] } : "rejected"
    const inserted = recordsForIntent(snapshot, context, intent, facts)
    if (inserted === "rejected") return "rejected"
    const allocatedIds = [...new Set(inserted.flatMap((item) => allocatedRecordIds(item.record)))].sort(compareUtf8V2)
    const ordinals = inserted.map((item) => parseUint32V2(recordStamp(item.record).writeOrdinal)).map(Number)
    const receipt: ProjectOperationReceiptV2 = {
      format: "convax.project-operation-receipt/2",
      actorId: context.actorId,
      operationId: context.operationId,
      intentKind: intent.kind,
      intentDigest,
      allocatedIds,
      firstWriteOrdinal: String(Math.min(...ordinals)) as Uint32V2,
      writeCount: String(inserted.length + 1) as Uint32V2,
      stampLamport: context.lamport,
    }
    const all = [...inserted, { root: "operations" as const, key: operationKey, record: receipt }]
    document.transact(() => {
      const root = getRoot(document)
      for (const item of all) putImmutableFact(childMap(root, item.root), item.key, item.record)
    }, "project-index-intent-v2")
    validateProjectIndexYDocV2(document, parseProjectIndexScope(context.scope))
    return Object.freeze({ format: "convax.project-index-intent-result/2", intentDigest, inserted: Object.freeze(all) })
  } catch {
    return "rejected"
  }
}

export const selectedProjectIndexDocumentOwnerArtifactDefinitionV2: SelectedDocumentOwnerArtifactDefinitionV2<"project-index"> = Object.freeze({
  owner: "project-index",
  createDefinitions(processValues: OwnerProcessValueFactoryV2<"project-index">) {
    return Object.freeze({ protocol: projectIndexProtocolDefinitionV2(processValues), closure: projectIndexClosureDefinitionV2() })
  },
})

function projectIndexProtocolDefinitionV2(processValues: OwnerProcessValueFactoryV2<"project-index">): DocumentOwnerProtocolDefinitionV2<"project-index"> {
  const schemaDigest = PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2
  const canonicalizerDescriptor = projectIndexOwnerCanonicalizerDescriptorV2(schemaDigest)
  const canonicalizerDigest = ownerCanonicalizerDescriptorDigestV2(canonicalizerDescriptor)
  return Object.freeze({
    owner: "project-index",
    schemaDigest,
    canonicalizerDescriptor,
    canonicalizerDigest,
    decodeIntent(exactJcs: Uint8Array) {
      try { return parseIntent(decodeRestrictedJcsV2(exactJcs)) } catch { return "rejected" }
    },
    validateBase(document: Y.Doc) {
      try { return processValues.wrapValidatedState(validateProjectIndexYDocV2(document)) } catch { return "rejected" }
    },
    applyIntent(candidate: Y.Doc, context: OwnerIntentValidationContextV2, intent: unknown, externalFacts: OwnerExternalFactPortV2<"project-index">) {
      try {
        const parsed = parseIntent(intent)
        const dependencies = projectIndexIntentDependenciesV2(context, parsed)
        const factContext = consumeExternalFacts(dependencies, externalFacts)
        if (factContext === "pending" || factContext === "rejected") return factContext
        const result = applyProjectIndexCandidateIntentV2(candidate, context, parsed, factContext)
        return result === "rejected" ? "rejected" : processValues.wrapApplyResult(Object.freeze({ result, scope: context.scope }))
      } catch { return "rejected" }
    },
    validatePost(_base: OwnerValidatedStateV2<"project-index">, candidate: Y.Doc, result: OwnerApplyResultV2<"project-index">) {
      return ownerResult(result) === null ? "rejected" : processValues.wrapValidatedState(validateProjectIndexYDocV2(candidate))
    },
    canonicalStateBytes(document: Y.Doc) {
      try { return encodeProjectCanonicalStateV2(document) } catch { return "rejected" }
    },
    deriveActualWriteEvidence(result: OwnerApplyResultV2<"project-index">) {
      const value = ownerResult(result)
      if (value === null) throw new TypeError("ProjectIndex owner result is invalid")
      const writes = value.result.inserted.map((item) => {
        const record = item.record as { readonly format: string }
        const recordDigest = projectIndexRecordDigestV2(record)
        return {
          entityKind: `project-index.${item.root}`,
          entityId: item.key,
          field: "record",
          valueDigest: structuredDigestV2("convax.project-index-write-value/2", { format: "convax.project-index-write-value/2", root: item.root, key: item.key, recordFormat: record.format, recordDigest }),
        }
      }).sort((left, right) => compareUtf8V2(`${left.entityKind}/${left.entityId}`, `${right.entityKind}/${right.entityId}`))
      return {
        format: "convax.actual-write-evidence/2",
        scope: value.scope,
        owner: "project-index",
        ownerSchemaDigest: schemaDigest,
        intentDigest: value.result.intentDigest,
        changedPaths: writes.map((write) => `${write.entityKind.slice("project-index.".length)}/${write.entityId}`),
        writes,
      } satisfies ActualWriteEvidenceV2
    },
  })
}

function projectIndexClosureDefinitionV2(): OwnerIntentClosureDefinitionV2<"project-index"> {
  return Object.freeze({
    inspectIntent(intent: unknown) { try { parseIntent(intent); return Object.freeze({ kind: "ordinary" as const }) } catch { return "rejected" } },
    discoverDependencies(input: Parameters<OwnerIntentClosureDefinitionV2<"project-index">["discoverDependencies"]>[0]) {
      try { return projectIndexIntentDependenciesV2(input.context, parseIntent(input.intent)) } catch { return "rejected" }
    },
    history: null,
  })
}

export function projectIndexIntentDependenciesV2(context: OwnerIntentValidationContextV2, intent: ProjectIndexIntentV2): OwnerIntentDependenciesV2<"project-index"> {
  const request = externalFactRequest(context, intent)
  if (request === null) return Object.freeze({ validationArtifacts: Object.freeze([]), externalFacts: Object.freeze([]) })
  const exactJcs = encodeRestrictedJcsV2(request)
  const sha256 = ordinarySha256V2(exactJcs)
  return Object.freeze({
    validationArtifacts: Object.freeze([]),
    externalFacts: Object.freeze([{ owner: "project-index" as const, kind: request.kind, factDigest: sha256, request: Object.freeze({ sha256, exactJcs }) }]),
  })
}

/** Exact immutable blob closure for ProjectIndex persistence and replication ACK gating. */
export function requiredProjectIndexBlobDigestsV2(frame: DecodedCausalEditFrameV2 | DecodedCausalEditFrameV3): readonly DigestV2[] {
  if (frame.header.core.scope.docKind !== "project-index") {
    throw new TypeError("ProjectIndex blob dependency extraction received another document owner")
  }
  const exactJcs = new Uint8Array(frame.sections.typedIntentJcs)
  const intent = parseIntent(decodeRestrictedJcsV2(exactJcs))
  if (frame.header.core.intentKind !== intent.kind) {
    throw new TypeError("ProjectIndex frame intent kind does not match its exact typed intent")
  }
  if (compareBytesV2(encodeRestrictedJcsV2(intent), exactJcs) !== 0) {
    throw new TypeError("ProjectIndex typed intent bytes are not canonical restricted JCS")
  }
  if (intent.kind === "project.file.create/2") {
    return Object.freeze([parseDigestV2(intent.body.initialVersion.blob.digest)])
  }
  if (intent.kind === "project.file.write-text/2" || intent.kind === "project.file.overwrite-binary/2") {
    return Object.freeze([parseDigestV2(intent.body.version.blob.digest)])
  }
  return Object.freeze([])
}

type ProjectIndexExternalFactRequestV2 = Readonly<Record<string, unknown> & {
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
export interface ProjectIndexCanvasGenesisCurrentnessRequestV2 {
  readonly format: "convax.project-index-external-fact-request/2"
  readonly kind: "canvas-genesis-currentness"
  readonly projectIndexScope: ProjectIndexScopeV2
  readonly operationId: Id128V2
  readonly intentDigest: DigestV2
  readonly canvasScope: CanvasDocumentScopeV2
  readonly stageRecordDigest: DigestV2
  readonly routeDependencyFrameDigest: DigestV2
  readonly genesisCheckpointObjectDigest: DigestV2
  readonly stagedProjectIndexFrontierDigest: DigestV2
}

export interface ProjectIndexBlobPublicationCurrentnessRequestV2 {
  readonly format: "convax.project-index-external-fact-request/2"
  readonly kind: "blob-publication-currentness"
  readonly projectIndexScope: ProjectIndexScopeV2
  readonly operationId: Id128V2
  readonly intentDigest: DigestV2
  readonly versionRecordDigest: DigestV2
  readonly blob: ProjectBlobRefV2
}

export function decodeProjectIndexBlobPublicationCurrentnessRequestV2(
  exactJcs: Readonly<Uint8Array>,
): ProjectIndexBlobPublicationCurrentnessRequestV2 | "rejected" {
  try {
    if (!(exactJcs instanceof Uint8Array)) return "rejected"
    const decoded = decodeRestrictedJcsV2(new Uint8Array(exactJcs))
    if (compareBytesV2(encodeRestrictedJcsV2(decoded), exactJcs) !== 0) return "rejected"
    assertExactKeysV2(decoded, [
      "format", "kind", "projectIndexScope", "operationId", "intentDigest",
      "versionRecordDigest", "blob",
    ], "ProjectIndex blob publication currentness request")
    if (decoded.format !== "convax.project-index-external-fact-request/2" || decoded.kind !== "blob-publication-currentness") return "rejected"
    return Object.freeze({
      format: decoded.format,
      kind: decoded.kind,
      projectIndexScope: parseProjectIndexScope(decoded.projectIndexScope as DocumentScopeV2),
      operationId: parseId128V2(decoded.operationId),
      intentDigest: parseDigestV2(decoded.intentDigest),
      versionRecordDigest: parseDigestV2(decoded.versionRecordDigest),
      blob: parseBlob(decoded.blob),
    })
  } catch { return "rejected" }
}

/** Parse/re-encode equality is mandatory before native code resolves G. */
export function decodeProjectIndexCanvasGenesisCurrentnessRequestV2(
  exactJcs: Readonly<Uint8Array>,
): ProjectIndexCanvasGenesisCurrentnessRequestV2 | "rejected" {
  try {
    if (!(exactJcs instanceof Uint8Array)) return "rejected"
    const decoded = decodeRestrictedJcsV2(new Uint8Array(exactJcs))
    if (compareBytesV2(encodeRestrictedJcsV2(decoded), exactJcs) !== 0) return "rejected"
    assertExactKeysV2(decoded, [
      "format", "kind", "projectIndexScope", "operationId", "intentDigest", "canvasScope",
      "stageRecordDigest", "routeDependencyFrameDigest", "genesisCheckpointObjectDigest",
      "stagedProjectIndexFrontierDigest",
    ], "ProjectIndex Canvas genesis currentness request")
    if (
      decoded.format !== "convax.project-index-external-fact-request/2" ||
      decoded.kind !== "canvas-genesis-currentness"
    ) return "rejected"
    const projectIndexScope = parseProjectIndexScope(decoded.projectIndexScope as DocumentScopeV2)
    const canvasScope = parseCanvasDocumentScopeV2(decoded.canvasScope)
    if (
      projectIndexScope.projectId !== canvasScope.projectId ||
      projectIndexScope.projectEpoch !== canvasScope.projectEpoch
    ) return "rejected"
    return Object.freeze({
      format: decoded.format,
      kind: decoded.kind,
      projectIndexScope,
      operationId: parseId128V2(decoded.operationId),
      intentDigest: parseDigestV2(decoded.intentDigest),
      canvasScope,
      stageRecordDigest: parseDigestV2(decoded.stageRecordDigest),
      routeDependencyFrameDigest: parseDigestV2(decoded.routeDependencyFrameDigest),
      genesisCheckpointObjectDigest: parseDigestV2(decoded.genesisCheckpointObjectDigest),
      stagedProjectIndexFrontierDigest: parseDigestV2(decoded.stagedProjectIndexFrontierDigest),
    })
  } catch {
    return "rejected"
  }
}

function externalFactRequest(context: OwnerIntentValidationContextV2, intent: ProjectIndexIntentV2): ProjectIndexExternalFactRequestV2 | null {
  const projectIndexScope = parseProjectIndexScope(context.scope)
  const base = { format: "convax.project-index-external-fact-request/2", projectIndexScope, operationId: context.operationId, intentDigest: context.intentDigest }
  if (intent.kind === "project.file.create/2" || intent.kind === "project.file.write-text/2" || intent.kind === "project.file.overwrite-binary/2") {
    const version = intent.kind === "project.file.create/2" ? intent.body.initialVersion : intent.body.version
    return { ...base, kind: "blob-publication-currentness", versionRecordDigest: projectIndexRecordDigestV2(version), blob: version.blob }
  }
  if (intent.kind === "project.canvas.route.activate/2") {
    const activation = intent.body.activation
    return { ...base, kind: "canvas-genesis-currentness", canvasScope: { ...projectIndexScope, docKind: "canvas", docId: activation.canvasId, shardEpoch: activation.shardEpoch }, stageRecordDigest: activation.stageRecordDigest, routeDependencyFrameDigest: activation.projectIndexRouteDependencyFrameDigest, genesisCheckpointObjectDigest: activation.canvasGenesisCheckpointObjectDigest, stagedProjectIndexFrontierDigest: activation.stagedProjectIndexFrontierDigest }
  }
  if (intent.kind === "project.canvas.route.reset/2") {
    const { routeCasCore, resetClaim, confirmation, approval } = intent.body
    return {
      ...base,
      kind: "reset-authorization-currentness",
      oldScope: routeCasCore.oldScope,
      newScope: routeCasCore.newScope,
      claimCoreDigest: resetClaim.coreDigest,
      confirmationCoreDigest: confirmation.coreDigest,
      approvalCoreDigest: approval.coreDigest,
      routeCasCoreDigest: structuredDigestV2(
        "convax.document-shard-reset-route-cas-core-digest/2",
        routeCasCore,
      ),
      predecessorActivationDigest: routeCasCore.predecessorActivationDigest,
    }
  }
  return null
}

function consumeExternalFacts(dependencies: OwnerIntentDependenciesV2<"project-index">, port: OwnerExternalFactPortV2<"project-index">): ProjectIndexExternalFactContextV2 | "pending" | "rejected" {
  const verified = new Set<string>()
  for (const requirement of dependencies.externalFacts) {
    const resolved = port.resolveFact(requirement)
    if (resolved.status !== "resolved") return resolved.status
    if (!validFactResult(resolved.value, requirement)) return "rejected"
    verified.add(requirement.factDigest)
  }
  return Object.freeze({
    verifyBlob(versionRecordDigest: DigestV2, blob: ProjectBlobRefV2) { return requirementMatches(dependencies.externalFacts, "blob-publication-currentness", versionRecordDigest, blob, verified) },
    verifyCanvasGenesis(activation: CanvasRouteActivationV2) { return dependencies.externalFacts.some((item) => {
      if (item.kind !== "canvas-genesis-currentness" || !verified.has(item.factDigest)) return false
      const request = decodeRestrictedJcsV2(item.request.exactJcs)
      return typeof request === "object" && request !== null && "stageRecordDigest" in request && request.stageRecordDigest === activation.stageRecordDigest
    }) },
    verifyResetAuthorization(
      body: Extract<ProjectIndexIntentV2, { readonly kind: "project.canvas.route.reset/2" }>["body"],
    ) { return dependencies.externalFacts.some((item) => {
      if (item.kind !== "reset-authorization-currentness" || !verified.has(item.factDigest)) return false
      const request = decodeRestrictedJcsV2(item.request.exactJcs)
      return typeof request === "object" && request !== null &&
        "claimCoreDigest" in request && request.claimCoreDigest === body.resetClaim.coreDigest &&
        "confirmationCoreDigest" in request && request.confirmationCoreDigest === body.confirmation.coreDigest &&
        "approvalCoreDigest" in request && request.approvalCoreDigest === body.approval.coreDigest &&
        "routeCasCoreDigest" in request && request.routeCasCoreDigest === body.resetCommit.routeCasCoreDigest
    }) },
  })
}

function validFactResult(value: unknown, requirement: OwnerExternalFactRequirementV2<"project-index">): boolean {
  try {
    assertExactKeysV2(value, ["format", "kind", "requestSha256", "factDigest", "decision"], "ProjectIndex external fact")
    return value.format === "convax.project-index-external-fact-result/2" && value.kind === requirement.kind && value.requestSha256 === requirement.request.sha256 && value.factDigest === requirement.factDigest && value.decision === "verified"
  } catch { return false }
}

function requirementMatches(requirements: readonly OwnerExternalFactRequirementV2<"project-index">[], kind: string, versionRecordDigest: DigestV2, blob: ProjectBlobRefV2, verified: Set<string>): boolean {
  return requirements.some((item) => {
    if (item.kind !== kind || !verified.has(item.factDigest)) return false
    const request = decodeRestrictedJcsV2(item.request.exactJcs)
    return typeof request === "object" && request !== null && "versionRecordDigest" in request && "blob" in request && request.versionRecordDigest === versionRecordDigest && encodeEqual(request.blob, blob)
  })
}

function recordsForIntent(snapshot: ProjectIndexSnapshotV2, context: OwnerIntentValidationContextV2, intent: ProjectIndexIntentV2, facts: ProjectIndexExternalFactContextV2): ProjectIndexApplyResultV2["inserted"] | "rejected" {
  const add = (root: ProjectIndexApplyResultV2["inserted"][number]["root"], key: string, record: object) => ({ root, key, record })
  if (!projectGuardsEqualAndHold(snapshot, context, intent)) return "rejected"
  if (intent.kind === "project.directory.create/2") {
    if (!recordMatchesContext(intent.body.entry, context, "directory", "0") || !recordMatchesContext(intent.body.location, context, "location", "1")) return "rejected"
    return [add("entries", intent.body.entry.entryId, intent.body.entry), add("entryLocations", `l:${intent.body.location.entryId}:${intent.body.location.claimId}`, intent.body.location)]
  }
  if (intent.kind === "project.file.create/2") {
    const { entry, location, initialVersion } = intent.body
    if (!recordMatchesContext(entry, context, "file", "0")) fail("derived-entry", "file entry mismatch")
    if (location !== null && !recordMatchesContext(location, context, "location", "1")) fail("derived-location", "file location mismatch")
    if (!recordMatchesContext(initialVersion, context, "version", "2")) fail("derived-version", "initial version mismatch")
    if (snapshot.entries.has(entry.entryId) || initialVersion.primaryFileId !== entry.entryId || initialVersion.writeClass !== "initial") return "rejected"
    if ((entry.storageClass === "project-file") !== (location !== null)) return "rejected"
    if ((entry.provenance === "generated" || entry.provenance === "managed-admission") && entry.contentPolicy !== "immutable") return "rejected"
    if (!facts.verifyBlob(projectIndexRecordDigestV2(initialVersion), initialVersion.blob)) return "rejected"
    return [add("entries", entry.entryId, entry), ...(location === null ? [] : [add("entryLocations", `l:${location.entryId}:${location.claimId}`, location)]), add("contentFamilies", `v:${initialVersion.primaryFileId}:${initialVersion.versionId}`, initialVersion)]
  }
  if (intent.kind === "project.entry.locate/2") {
    const location = intent.body.location
    if (!recordMatchesContext(location, context, "location", "0") || !isLiveEntry(snapshot, location.entryId)) return "rejected"
    return [add("entryLocations", `l:${location.entryId}:${location.claimId}`, location)]
  }
  if (intent.kind === "project.entry.tombstone/2") {
    const tombstone = intent.body.tombstone
    if (!recordMatchesContext(tombstone, context, "tombstone", "0") || !isLiveEntry(snapshot, tombstone.entryId)) return "rejected"
    return [add("entryTombstones", `t:${tombstone.entryId}:${tombstone.tombstoneId}`, tombstone)]
  }
  if (intent.kind === "project.file.write-text/2") {
    const { version, conflictEntry, promotion, reservation } = intent.body
    if (!recordMatchesContext(version, context, "version", "0") || !recordMatchesContext(conflictEntry, context, "file", "1") || !recordMatchesContext(promotion, context, "promotion", "2") || !recordMatchesContext(reservation, context, "reservation", "3")) return "rejected"
    const family = projectFamilies(snapshot, tombstonedEntries(snapshot)).find((item) => item.primaryFileId === version.primaryFileId)
    const primary = snapshot.entries.get(version.primaryFileId)
    if (!primary || primary.contentPolicy !== "conflict-preserving-text" || !encodeEqual(family?.liveHeadVersionIds ?? [], version.supersedesVersionIds)) return "rejected"
    if (conflictEntry.conflictSource === null || conflictEntry.conflictSource.primaryFileId !== version.primaryFileId || conflictEntry.conflictSource.sourceVersionId !== version.versionId || conflictEntry.conflictSource.promotionId !== promotion.promotionId || conflictEntry.conflictSource.reservationId !== reservation.reservationId || promotion.primaryFileId !== version.primaryFileId || promotion.versionId !== version.versionId || promotion.reservedConflictFileId !== conflictEntry.entryId || promotion.reservationId !== reservation.reservationId || reservation.primaryFileId !== version.primaryFileId || reservation.versionId !== version.versionId || reservation.reservedEntryId !== conflictEntry.entryId) return "rejected"
    if (!facts.verifyBlob(projectIndexRecordDigestV2(version), version.blob)) return "rejected"
    return [add("contentFamilies", `v:${version.primaryFileId}:${version.versionId}`, version), add("entries", conflictEntry.entryId, conflictEntry), add("contentPromotions", `p:${promotion.primaryFileId}:${promotion.promotionId}`, promotion), add("pathReservations", `x:${reservation.reservationId}`, reservation)]
  }
  if (intent.kind === "project.file.overwrite-binary/2") {
    const version = intent.body.version
    if (!recordMatchesContext(version, context, "version", "0") || !facts.verifyBlob(projectIndexRecordDigestV2(version), version.blob)) return "rejected"
    const existing = [...snapshot.contentFamilies.values()].filter((item) => item.primaryFileId === version.primaryFileId)
    const current = maxBinary(existing)
    if (snapshot.entries.get(version.primaryFileId)?.contentPolicy !== "overwritable-binary" || current === null || version.supersedesVersionIds.length !== 1 || version.supersedesVersionIds[0] !== current.versionId || BigInt(version.binaryLogicalCounter ?? "0") !== BigInt(current.binaryLogicalCounter ?? "0") + 1n) return "rejected"
    return [add("contentFamilies", `v:${version.primaryFileId}:${version.versionId}`, version)]
  }
  if (intent.kind === "project.canvas.route.stage/2") {
    const stage = intent.body.stage
    const key = `r:${stage.canvasId}:${stage.transitionId}`
    if (
      !routeGuardsEqual(snapshot, context, intent.guards, stage.canvasId, key) ||
      !recordMatchesContext(stage, context, "route-transition", "1") ||
      stage.canvasId !== deriveProjectIdentityV2(context, "canvas", "0" as Uint32V2) ||
      routeFacts(snapshot, stage.canvasId).length > 0
    ) return "rejected"
    return [add("canvasRoutes", key, stage)]
  }
  if (intent.kind === "project.canvas.route.activate/2") {
    const activation = intent.body.activation
    const key = `r:${activation.canvasId}:${activation.transitionId}`
    const route = projectCanvasRouteProjectionV2(snapshot, activation.canvasId)
    const stages = routeFacts(snapshot, activation.canvasId).filter((fact): fact is CanvasRouteStageV2 => fact.format === "convax.canvas-route-stage/2")
    if (
      !routeGuardsEqual(snapshot, context, intent.guards, activation.canvasId, key) ||
      route.state !== "staged" ||
      !recordMatchesContext(activation, context, "route-transition", "0") ||
      stages.length !== 1 ||
      projectIndexRecordDigestV2(stages[0]!) !== activation.stageRecordDigest ||
      stages[0]!.shardEpoch !== activation.shardEpoch ||
      !facts.verifyCanvasGenesis(activation)
    ) return "rejected"
    return [add("canvasRoutes", key, activation)]
  }
  if (intent.kind === "project.canvas.route.rename/2") {
    const metadata = intent.body.metadata
    const key = `r:${metadata.canvasId}:${metadata.transitionId}`
    const route = projectCanvasRouteProjectionV2(snapshot, metadata.canvasId)
    if (
      !routeGuardsEqual(snapshot, context, intent.guards, metadata.canvasId, key) ||
      route.state !== "live" ||
      route.currentActivationDigest !== metadata.observedActivationDigest ||
      !recordMatchesContext(metadata, context, "route-transition", "0")
    ) return "rejected"
    return [add("canvasRoutes", key, metadata)]
  }
  if (intent.kind === "project.canvas.route.tombstone/2") {
    const tombstone = intent.body.tombstone
    const key = `r:${tombstone.canvasId}:${tombstone.transitionId}`
    const route = projectCanvasRouteProjectionV2(snapshot, tombstone.canvasId)
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
  const route = projectCanvasRouteProjectionV2(snapshot, resetCommit.canvasId)
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
  snapshot: ProjectIndexSnapshotV2,
  context: OwnerIntentValidationContextV2,
  route: ProjectCanvasRouteProjectionV2,
  body: Extract<ProjectIndexIntentV2, { readonly kind: "project.canvas.route.reset/2" }>["body"],
): boolean {
  const { resetCommit, routeCasCore, resetClaim, confirmation, approval } = body
  const claim = resetClaim.core
  const confirmationCore = confirmation.core
  const approvalCore = approval.core
  const routeCasCoreDigest = structuredDigestV2(
    "convax.document-shard-reset-route-cas-core-digest/2",
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
  snapshot: ProjectIndexSnapshotV2,
  context: OwnerIntentValidationContextV2,
  actual: readonly ProjectGuardAtomV2[],
  canvasId: CanvasIdV2,
  insertedRouteKey: string,
): boolean {
  return encodeEqual(actual, routeMutationGuards(snapshot, context, canvasId, insertedRouteKey))
}

function isLiveEntry(snapshot: ProjectIndexSnapshotV2, entryId: string): boolean {
  return snapshot.entries.has(entryId) && ![...snapshot.entryTombstones.values()].some((fact) => fact.entryId === entryId)
}

function routeFacts(snapshot: ProjectIndexSnapshotV2, canvasId: CanvasIdV2): CanvasRouteFactV2[] {
  return [...snapshot.canvasRoutes.values()].filter((fact) => fact.canvasId === canvasId)
}

function recordMatchesContext(record: object, context: OwnerIntentValidationContextV2, kind: ProjectDerivedIdentityKindV2, ordinal: string): boolean {
  const stamp = recordStamp(record)
  const id = allocatedRecordIds(record)[0]
  return stamp.actorId === context.actorId && stamp.operationId === context.operationId && stamp.lamport === context.lamport && stamp.writeOrdinal === ordinal && id === deriveProjectIdentityV2(context, kind, ordinal as Uint32V2)
}

function allocatedRecordIds(record: object): string[] {
  if ("claimId" in record) return [String(record.claimId)]
  if ("tombstoneId" in record) return [String(record.tombstoneId)]
  if ("versionId" in record && (record as { format?: string }).format === "convax.project-content-version/2") return [String(record.versionId)]
  if ("promotionId" in record) return [String(record.promotionId)]
  if ("reservationId" in record) return [String(record.reservationId)]
  if ("transitionId" in record) return [String(record.transitionId)]
  if ("entryId" in record) return [String(record.entryId)]
  return []
}

function recordStamp(record: object): PortableStampV2 {
  const value = "stamp" in record ? record.stamp : "createdStamp" in record ? record.createdStamp : null
  return parsePortableStampV2(value)
}

function stampForConstruction(
  context: OwnerIntentConstructionContextV2,
  writeOrdinal: Uint32V2 | string,
): PortableStampV2 {
  return Object.freeze({
    format: "convax.portable-stamp/2",
    lamport: context.lamport,
    actorId: context.actorId,
    operationId: context.operationId,
    writeOrdinal: parseUint32V2(writeOrdinal),
  })
}

function requireRouteTitle(value: unknown): string {
  assertBoundedNfcStringV2(value, 1, 512, "Canvas route title")
  return value
}

function routeMutationGuards(
  snapshot: ProjectIndexSnapshotV2,
  context: OwnerIntentConstructionContextV2,
  canvasId: CanvasIdV2,
  insertedRouteKey: string,
): readonly ProjectGuardAtomV2[] {
  const projection = projectCanvasRouteProjectionV2(snapshot, canvasId)
  return sortProjectGuardsV2([
    {
      kind: "route-state",
      canvasId,
      state: projection.state,
      shardEpoch: projection.currentShardEpoch,
      activationDigest: projection.currentActivationDigest,
      projectionDigest: projectCanvasRouteProjectionDigestV2(projection),
    },
    { kind: "fact-absent", map: "canvasRoutes", key: insertedRouteKey },
    {
      kind: "fact-absent",
      map: "operations",
      key: `o:${context.actorId}:${context.operationId}`,
    },
  ])
}

function projectIndexRequiredGuardsV2(
  snapshot: ProjectIndexSnapshotV2,
  context: OwnerIntentConstructionContextV2,
  intent: ProjectIndexIntentV2,
): readonly ProjectGuardAtomV2[] {
  if (
    intent.kind === "project.canvas.route.stage/2" ||
    intent.kind === "project.canvas.route.activate/2" ||
    intent.kind === "project.canvas.route.rename/2" ||
    intent.kind === "project.canvas.route.tombstone/2" ||
    intent.kind === "project.canvas.route.reset/2"
  ) {
    const record = intent.kind === "project.canvas.route.stage/2" ? intent.body.stage
      : intent.kind === "project.canvas.route.activate/2" ? intent.body.activation
        : intent.kind === "project.canvas.route.rename/2" ? intent.body.metadata
          : intent.kind === "project.canvas.route.tombstone/2" ? intent.body.tombstone
            : intent.body.resetCommit
    return routeMutationGuards(
      snapshot,
      context,
      record.canvasId,
      `r:${record.canvasId}:${record.transitionId}`,
    )
  }
  const guards: ProjectGuardAtomV2[] = [operationAbsentGuard(context)]
  if (intent.kind === "project.directory.create/2") {
    const { entry, location } = intent.body
    guards.push(
      { kind: "entry-absent", entryId: entry.entryId },
      directoryLiveGuard(snapshot, location.parentDirectoryId),
      { kind: "fact-absent", map: "entries", key: entry.entryId },
      { kind: "fact-absent", map: "entryLocations", key: `l:${location.entryId}:${location.claimId}` },
    )
  } else if (intent.kind === "project.file.create/2") {
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
  } else if (intent.kind === "project.entry.locate/2") {
    const { location } = intent.body
    guards.push(
      entryLiveGuard(snapshot, location.entryId),
      entryLocationGuard(snapshot, location.entryId),
      directoryLiveGuard(snapshot, location.parentDirectoryId),
      { kind: "fact-absent", map: "entryLocations", key: `l:${location.entryId}:${location.claimId}` },
    )
  } else if (intent.kind === "project.entry.tombstone/2") {
    const { tombstone } = intent.body
    guards.push(
      entryLiveGuard(snapshot, tombstone.entryId),
      { kind: "fact-absent", map: "entryTombstones", key: `t:${tombstone.entryId}:${tombstone.tombstoneId}` },
    )
  } else if (intent.kind === "project.file.write-text/2") {
    const { version, conflictEntry, promotion, reservation } = intent.body
    guards.push(
      entryLiveGuard(snapshot, version.primaryFileId),
      familyLiveHeadsGuard(snapshot, version.primaryFileId),
      { kind: "fact-absent", map: "contentFamilies", key: `v:${version.primaryFileId}:${version.versionId}` },
      { kind: "fact-absent", map: "entries", key: conflictEntry.entryId },
      { kind: "fact-absent", map: "contentPromotions", key: `p:${promotion.primaryFileId}:${promotion.promotionId}` },
      { kind: "fact-absent", map: "pathReservations", key: `x:${reservation.reservationId}` },
    )
  } else if (intent.kind === "project.file.overwrite-binary/2") {
    const { version } = intent.body
    guards.push(
      entryLiveGuard(snapshot, version.primaryFileId),
      familyLiveHeadsGuard(snapshot, version.primaryFileId),
      { kind: "fact-absent", map: "contentFamilies", key: `v:${version.primaryFileId}:${version.versionId}` },
    )
  } else {
    fail("guard-construction", "ProjectIndex intent kind is unsupported")
  }
  return sortProjectGuardsV2(guards)
}

function operationAbsentGuard(context: OwnerIntentConstructionContextV2): ProjectGuardAtomV2 {
  return { kind: "fact-absent", map: "operations", key: `o:${context.actorId}:${context.operationId}` }
}

function entryLiveGuard(snapshot: ProjectIndexSnapshotV2, entryId: ProjectEntryIdV2): ProjectGuardAtomV2 {
  const entry = snapshot.entries.get(entryId)
  if (!entry || !isLiveEntry(snapshot, entryId)) fail("guard-construction", "Project entry is not live")
  return { kind: "entry-live", entryId, entryDigest: projectIndexRecordDigestV2(entry) }
}

function directoryLiveGuard(
  snapshot: ProjectIndexSnapshotV2,
  directoryId: ProjectDirectoryIdV2,
): ProjectGuardAtomV2 {
  const directory = snapshot.entries.get(directoryId)
  if (!directory || directory.kind !== "directory" || !isLiveEntry(snapshot, directoryId)) {
    fail("guard-construction", "Project directory is not live")
  }
  return { kind: "directory-live", directoryId, entryDigest: projectIndexRecordDigestV2(directory) }
}

function entryLocationGuard(snapshot: ProjectIndexSnapshotV2, entryId: ProjectEntryIdV2): ProjectGuardAtomV2 {
  const projection = projectEntryLocationProjectionV2(snapshot, entryId)
  return { kind: "entry-location", entryId, projectionDigest: projectEntryLocationProjectionDigestV2(projection) }
}

function familyLiveHeadsGuard(snapshot: ProjectIndexSnapshotV2, primaryFileId: ProjectFileIdV2): ProjectGuardAtomV2 {
  const projection = projectContentFamilyProjectionV2(snapshot, primaryFileId)
  return {
    kind: "family-live-heads",
    primaryFileId,
    versionIds: projection.liveHeadVersionIds,
    projectionDigest: projectContentFamilyProjectionDigestV2(projection),
  }
}

function projectGuardsEqualAndHold(
  snapshot: ProjectIndexSnapshotV2,
  context: OwnerIntentValidationContextV2,
  intent: ProjectIndexIntentV2,
): boolean {
  const expected = projectIndexRequiredGuardsV2(snapshot, context, intent)
  return encodeEqual(intent.guards, expected) && expected.every((guard) => projectGuardHolds(snapshot, guard))
}

function projectGuardHolds(snapshot: ProjectIndexSnapshotV2, guard: ProjectGuardAtomV2): boolean {
  if (guard.kind === "entry-absent") return !snapshot.entries.has(guard.entryId)
  if (guard.kind === "entry-live") {
    const entry = snapshot.entries.get(guard.entryId)
    return Boolean(entry && isLiveEntry(snapshot, guard.entryId) && projectIndexRecordDigestV2(entry) === guard.entryDigest)
  }
  if (guard.kind === "directory-live") {
    const entry = snapshot.entries.get(guard.directoryId)
    return Boolean(entry && entry.kind === "directory" && isLiveEntry(snapshot, guard.directoryId) && projectIndexRecordDigestV2(entry) === guard.entryDigest)
  }
  if (guard.kind === "entry-location") {
    return projectEntryLocationProjectionDigestV2(
      projectEntryLocationProjectionV2(snapshot, guard.entryId),
    ) === guard.projectionDigest
  }
  if (guard.kind === "family-live-heads") {
    const projection = projectContentFamilyProjectionV2(snapshot, guard.primaryFileId)
    return encodeEqual(projection.liveHeadVersionIds, guard.versionIds) &&
      projectContentFamilyProjectionDigestV2(projection) === guard.projectionDigest
  }
  if (guard.kind === "route-state") {
    const projection = projectCanvasRouteProjectionV2(snapshot, guard.canvasId)
    return projection.state === guard.state &&
      projection.currentShardEpoch === guard.shardEpoch &&
      projection.currentActivationDigest === guard.activationDigest &&
      projectCanvasRouteProjectionDigestV2(projection) === guard.projectionDigest
  }
  return !snapshot[guard.map].has(guard.key)
}

function sortProjectGuardsV2(guards: readonly ProjectGuardAtomV2[]): readonly ProjectGuardAtomV2[] {
  return Object.freeze(
    [...guards]
      .map((guard) => freezeJcs(guard))
      .sort((left, right) => {
        const byKind = compareUtf8V2(left.kind, right.kind)
        if (byKind !== 0) return byKind
        const byPrimary = compareUtf8V2(projectGuardPrimaryId(left), projectGuardPrimaryId(right))
        if (byPrimary !== 0) return byPrimary
        return compareUint8(encodeRestrictedJcsV2(left), encodeRestrictedJcsV2(right))
      }),
  )
}

function projectGuardPrimaryId(guard: ProjectGuardAtomV2): string {
  if (guard.kind === "entry-absent" || guard.kind === "entry-live" || guard.kind === "entry-location") {
    return guard.entryId
  }
  if (guard.kind === "directory-live") return guard.directoryId
  if (guard.kind === "family-live-heads") return guard.primaryFileId
  if (guard.kind === "route-state") return guard.canvasId
  return `${guard.map}:${guard.key}`
}

function parseProjectGuardV2(value: unknown): ProjectGuardAtomV2 {
  if (typeof value !== "object" || value === null || typeof (value as { kind?: unknown }).kind !== "string") {
    fail("invalid-guard", "ProjectIndex guard is invalid")
  }
  const guard = value as Record<string, unknown>
  if (guard.kind === "entry-absent") {
    assertExactKeysV2(guard, ["kind", "entryId"], "entry-absent guard")
    return freezeJcs({ kind: guard.kind, entryId: parseProjectEntryId(guard.entryId) })
  }
  if (guard.kind === "entry-live") {
    assertExactKeysV2(guard, ["kind", "entryId", "entryDigest"], "entry-live guard")
    return freezeJcs({
      kind: guard.kind,
      entryId: parseProjectEntryId(guard.entryId),
      entryDigest: parseDigestV2(guard.entryDigest),
    })
  }
  if (guard.kind === "entry-location") {
    assertExactKeysV2(guard, ["kind", "entryId", "projectionDigest"], "entry-location guard")
    return freezeJcs({
      kind: guard.kind,
      entryId: parseProjectEntryId(guard.entryId),
      projectionDigest: parseDigestV2(guard.projectionDigest),
    })
  }
  if (guard.kind === "directory-live") {
    assertExactKeysV2(guard, ["kind", "directoryId", "entryDigest"], "directory-live guard")
    return freezeJcs({
      kind: guard.kind,
      directoryId: parseProjectDirectoryId(guard.directoryId),
      entryDigest: parseDigestV2(guard.entryDigest),
    })
  }
  if (guard.kind === "family-live-heads") {
    assertExactKeysV2(
      guard,
      ["kind", "primaryFileId", "versionIds", "projectionDigest"],
      "family-live-heads guard",
    )
    assertDenseArrayV2(guard.versionIds, "family-live-heads version ids")
    if (guard.versionIds.length > 256) fail("invalid-guard", "family-live-heads exceeds its bound")
    const versionIds = guard.versionIds.map(parseVersionId)
    if (versionIds.some((id, index) => index > 0 && compareUtf8V2(versionIds[index - 1]!, id) >= 0)) {
      fail("invalid-guard", "family-live-heads version ids are not strict sorted unique")
    }
    return freezeJcs({
      kind: guard.kind,
      primaryFileId: parseProjectFileId(guard.primaryFileId),
      versionIds: Object.freeze(versionIds),
      projectionDigest: parseDigestV2(guard.projectionDigest),
    })
  }
  if (guard.kind === "route-state") {
    assertExactKeysV2(
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
    const shardEpoch = guard.shardEpoch === null ? null : parseId128V2(guard.shardEpoch)
    const activationDigest =
      guard.activationDigest === null ? null : parseDigestV2(guard.activationDigest)
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
      canvasId: parseCanvasIdV2(guard.canvasId),
      state: guard.state,
      shardEpoch,
      activationDigest,
      projectionDigest: parseDigestV2(guard.projectionDigest),
    })
  }
  if (guard.kind === "fact-absent") {
    assertExactKeysV2(guard, ["kind", "map", "key"], "fact-absent guard")
    if (
      typeof guard.map !== "string" ||
      guard.map === "identity" ||
      !PROJECT_INDEX_ROOT_KEYS_V2.includes(guard.map as (typeof PROJECT_INDEX_ROOT_KEYS_V2)[number]) ||
      typeof guard.key !== "string" ||
      guard.key.length < 1 ||
      new TextEncoder().encode(guard.key).byteLength > 1024 ||
      guard.key.includes("/")
    ) {
      fail("invalid-guard", "fact-absent guard is invalid")
    }
    return freezeJcs({
      kind: guard.kind,
      map: guard.map as Exclude<(typeof PROJECT_INDEX_ROOT_KEYS_V2)[number], "identity">,
      key: guard.key,
    })
  }
  fail("invalid-guard", "ProjectIndex guard kind is unknown")
}

function projectFamilies(snapshot: ProjectIndexSnapshotV2, tombstoned: ReadonlySet<string>): ProjectContentFamilyViewV2[] {
  const byFamily = new Map<string, ProjectContentVersionRecordV2[]>()
  for (const version of snapshot.contentFamilies.values()) {
    const list = byFamily.get(version.primaryFileId) ?? []
    list.push(version)
    byFamily.set(version.primaryFileId, list)
  }
  const result: ProjectContentFamilyViewV2[] = []
  for (const [primaryFileId, versions] of byFamily) {
    const entry = snapshot.entries.get(primaryFileId)
    const superseded = new Set(versions.flatMap((version) => [...version.supersedesVersionIds]))
    const live = versions.filter((version) => !superseded.has(version.versionId)).sort((left, right) => compareUtf8V2(left.versionId, right.versionId))
    let current: ProjectContentVersionRecordV2 | null = null
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
      versionIds: Object.freeze(versions.map((item) => item.versionId).sort(compareUtf8V2)),
      liveHeadVersionIds: Object.freeze(live.map((item) => item.versionId)),
      currentVersionId: current?.versionId ?? null,
      currentResourceReference,
      currentResourceReferenceDigest: currentResourceReference === null ? null : projectResourceReferenceDigestV2(currentResourceReference),
      activeConflictFileIds: Object.freeze(active),
    }))
  }
  return result.sort((left, right) => compareUtf8V2(left.primaryFileId, right.primaryFileId))
}

function resourceReference(
  identity: ProjectIndexIdentityRecordV2,
  version: ProjectContentVersionRecordV2,
  entryFileId: ProjectFileIdV2,
): ProjectResourceReferenceV2 {
  const parsed = parseProjectUri(version.canonicalRevisionUri)
  if (
    parsed.projectId !== identity.projectId || parsed.projectEpoch !== identity.projectEpoch ||
    parsed.entryId !== version.primaryFileId || parsed.blob !== `sha256:${version.blob.digest}`
  ) fail("invalid-uri", "Current resource URI does not bind Project identity, family and blob")
  return Object.freeze({
    format: "convax.project-resource-reference/2",
    projectId: identity.projectId,
    projectEpoch: identity.projectEpoch,
    entryFileId,
    familyPrimaryFileId: version.primaryFileId,
    versionId: version.versionId,
    canonicalUri: version.canonicalRevisionUri,
    blob: version.blob,
    versionRecordDigest: projectIndexRecordDigestV2(version),
  })
}

function activeConflictCopies(snapshot: ProjectIndexSnapshotV2, versions: readonly ProjectContentVersionRecordV2[]): ProjectFileIdV2[] {
  const result = new Set<ProjectFileIdV2>()
  for (const source of versions) {
    if (source.writeClass !== "text-write") continue
    const activated = versions.some((other) => comparePortableStampsV2(other.stamp, source.stamp) > 0 && !reaches(versions, other.versionId, source.versionId) && !reaches(versions, source.versionId, other.versionId))
    if (!activated) continue
    for (const promotion of snapshot.contentPromotions.values()) if (promotion.primaryFileId === source.primaryFileId && promotion.versionId === source.versionId) result.add(promotion.reservedConflictFileId)
  }
  return [...result].sort(compareUtf8V2)
}

function reaches(versions: readonly ProjectContentVersionRecordV2[], descendant: string, ancestor: string, seen = new Set<string>()): boolean {
  if (descendant === ancestor) return true
  if (seen.has(descendant)) return false
  seen.add(descendant)
  const record = versions.find((item) => item.versionId === descendant)
  return record?.supersedesVersionIds.some((parent) => reaches(versions, parent, ancestor, seen)) ?? false
}

function maxBinary(versions: readonly ProjectContentVersionRecordV2[]): ProjectContentVersionRecordV2 | null {
  return [...versions].sort((left, right) => {
    const counter = BigInt(left.binaryLogicalCounter ?? "0") - BigInt(right.binaryLogicalCounter ?? "0")
    if (counter !== 0n) return counter < 0n ? -1 : 1
    const actor = compareDecodedBase64urlV2(left.creatorActorId, right.creatorActorId)
    return actor === 0 ? compareUtf8V2(left.versionId, right.versionId) : actor
  }).at(-1) ?? null
}

function maxStamp<T extends { readonly stamp: PortableStampV2 }>(records: readonly T[]): T | null {
  return [...records].sort((left, right) => comparePortableStampsV2(left.stamp, right.stamp)).at(-1) ?? null
}

export function projectCanvasRouteProjectionV2(
  snapshot: ProjectIndexSnapshotV2,
  canvasIdInput: CanvasIdV2,
): ProjectCanvasRouteProjectionV2 {
  const canvasId = parseCanvasIdV2(canvasIdInput)
  const facts = routeFacts(snapshot, canvasId)
  if (facts.length === 0) {
    return Object.freeze({
      format: "convax.project-route-projection/2",
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
    (fact): fact is CanvasRouteTombstoneV2 => fact.format === "convax.canvas-route-tombstone/2",
  )
  const tombstone = maxStamp(tombstones)
  if (tombstone !== null) {
    return Object.freeze({
      format: "convax.project-route-projection/2",
      canvasId,
      state: "tombstoned",
      stageRecordDigest: null,
      ancestryRecordDigests: Object.freeze([]),
      currentActivationDigest: null,
      currentShardEpoch: null,
      currentTitle: null,
      currentTitleRecordDigest: null,
      currentTombstoneRecordDigest: projectIndexRecordDigestV2(tombstone),
    })
  }
  const stages = facts.filter(
    (fact): fact is CanvasRouteStageV2 => fact.format === "convax.canvas-route-stage/2",
  )
  if (stages.length !== 1) fail("invalid-route", "Canvas route must contain exactly one stage")
  const stage = stages[0]!
  const stageRecordDigest = projectIndexRecordDigestV2(stage)
  const activations = facts.filter(
    (fact): fact is CanvasRouteActivationV2 => fact.format === "convax.canvas-route-activation/2",
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
    (fact): fact is CanvasRouteResetCommitV2 => fact.format === "convax.canvas-route-reset-commit/2",
  )
  const transitionByDigest = new Map<
    DigestV2,
    CanvasRouteActivationV2 | CanvasRouteResetCommitV2
  >()
  for (const transition of [...activations, ...resets]) {
    transitionByDigest.set(projectIndexRecordDigestV2(transition), transition)
  }
  for (const reset of resets) {
    const predecessor = transitionByDigest.get(reset.predecessorActivationDigest)
    const predecessorEpoch =
      predecessor?.format === "convax.canvas-route-activation/2"
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
    currentTransition === null ? null : projectIndexRecordDigestV2(currentTransition)
  const metadata = maxStamp(
    facts.filter(
      (fact): fact is CanvasRouteMetadataClaimV2 =>
        fact.format === "convax.canvas-route-metadata/2" &&
        ancestryRecordDigests.includes(fact.observedActivationDigest),
    ),
  )
  return Object.freeze({
    format: "convax.project-route-projection/2",
    canvasId,
    state: currentTransition === null ? "staged" : "live",
    stageRecordDigest,
    ancestryRecordDigests,
    currentActivationDigest,
    currentShardEpoch:
      currentTransition?.format === "convax.canvas-route-activation/2"
        ? currentTransition.shardEpoch
        : currentTransition?.newShardEpoch ?? stage.shardEpoch,
    currentTitle: metadata?.title ?? stage.title,
    currentTitleRecordDigest:
      metadata === null ? stageRecordDigest : projectIndexRecordDigestV2(metadata),
    currentTombstoneRecordDigest: null,
  })
}

function routeTransitionAncestry(
  head: CanvasRouteActivationV2 | CanvasRouteResetCommitV2,
  transitions: ReadonlyMap<DigestV2, CanvasRouteActivationV2 | CanvasRouteResetCommitV2>,
  stageRecordDigest: DigestV2,
): DigestV2[] {
  const reverse: DigestV2[] = []
  const seen = new Set<DigestV2>()
  let current: CanvasRouteActivationV2 | CanvasRouteResetCommitV2 | undefined = head
  while (current !== undefined) {
    const digest = projectIndexRecordDigestV2(current)
    if (seen.has(digest)) fail("invalid-route", "Canvas route transition ancestry contains a cycle")
    seen.add(digest)
    reverse.push(digest)
    if (current.format === "convax.canvas-route-activation/2") break
    current = transitions.get(current.predecessorActivationDigest)
  }
  if (current?.format !== "convax.canvas-route-activation/2") {
    fail("invalid-route", "Canvas route transition ancestry does not reach its activation")
  }
  return [stageRecordDigest, ...reverse.reverse()]
}

function projectRoutes(snapshot: ProjectIndexSnapshotV2): ProjectCanvasRouteProjectionV2[] {
  const grouped = new Map<CanvasIdV2, CanvasRouteFactV2[]>()
  for (const fact of snapshot.canvasRoutes.values()) {
    const list = grouped.get(fact.canvasId) ?? []
    list.push(fact)
    grouped.set(fact.canvasId, list)
  }
  const result = [...grouped.keys()].map((canvasId) => projectCanvasRouteProjectionV2(snapshot, canvasId))
  return result.sort((left, right) => compareUtf8V2(left.canvasId, right.canvasId))
}

function tombstonedEntries(snapshot: ProjectIndexSnapshotV2): Set<string> {
  return new Set([...snapshot.entryTombstones.values()].map((fact) => fact.entryId))
}

function validateRelations(snapshot: ProjectIndexSnapshotV2): void {
  for (const claim of snapshot.entryLocations.values()) {
    if (!snapshot.entries.has(claim.entryId)) fail("dangling-location", "Location names an absent entry")
    const parent = snapshot.entries.get(claim.parentDirectoryId)
    if (!parent || parent.kind !== "directory") fail("invalid-location-parent", "Location parent is not a directory")
  }
  for (const tombstone of snapshot.entryTombstones.values()) {
    const entry = snapshot.entries.get(tombstone.entryId)
    if (!entry || projectIndexRecordDigestV2(entry) !== tombstone.observedEntryDigest) fail("invalid-tombstone", "Entry tombstone does not bind the accepted entry")
  }
  const byFamily = new Map<string, ProjectContentVersionRecordV2[]>()
  for (const version of snapshot.contentFamilies.values()) {
    const entry = snapshot.entries.get(version.primaryFileId)
    if (!entry || entry.kind !== "file" || entry.provenance === "content-conflict-copy") fail("invalid-family", "Content family has no primary file")
    if ((entry.contentPolicy === "immutable" && version.writeClass !== "initial") || (entry.contentPolicy === "conflict-preserving-text" && version.writeClass === "binary-overwrite") || (entry.contentPolicy === "overwritable-binary" && version.writeClass === "text-write")) fail("policy-mismatch", "Content version violates its file policy")
    const list = byFamily.get(version.primaryFileId) ?? []
    list.push(version); byFamily.set(version.primaryFileId, list)
  }
  for (const [family, versions] of byFamily) validateVersionDag(family, versions)
  for (const promotion of snapshot.contentPromotions.values()) {
    const version = snapshot.contentFamilies.get(`v:${promotion.primaryFileId}:${promotion.versionId}`)
    const reservation = snapshot.pathReservations.get(`x:${promotion.reservationId}`)
    const conflict = snapshot.entries.get(promotion.reservedConflictFileId)
    if (!version || !reservation || !conflict || conflict.provenance !== "content-conflict-copy" || reservation.reservedEntryId !== promotion.reservedConflictFileId) fail("invalid-conflict-copy", "Conflict-copy records do not cross-bind")
  }
  for (const canvasId of new Set([...snapshot.canvasRoutes.values()].map((fact) => fact.canvasId))) {
    projectCanvasRouteProjectionV2(snapshot, canvasId)
  }
}

function validateVersionDag(family: string, versions: readonly ProjectContentVersionRecordV2[]): void {
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

function parseIntent(value: unknown): ProjectIndexIntentV2 {
  assertExactKeysV2(value, ["format", "kind", "guards", "body"], "ProjectIndexIntentV2")
  if (value.format !== "convax.typed-intent/2" || typeof value.kind !== "string" || !INTENT_KINDS.has(value.kind as ProjectIndexIntentKindV2)) fail("invalid-intent", "ProjectIndex intent tag is invalid")
  assertDenseArrayV2(value.guards, "ProjectIndex guards")
  if (value.guards.length > 64) fail("invalid-guard", "ProjectIndex guards exceed their bound")
  const guards = value.guards.map(parseProjectGuardV2)
  const canonicalGuards = sortProjectGuardsV2(guards)
  if (canonicalGuards.some((guard, index) => index > 0 && encodeEqual(canonicalGuards[index - 1], guard))) {
    fail("invalid-guard", "ProjectIndex guards must be duplicate-free")
  }
  if (!encodeEqual(guards, canonicalGuards)) {
    fail("invalid-guard", "ProjectIndex guards must be strict sorted and duplicate-free")
  }
  const intent = { ...value, guards: canonicalGuards } as unknown as ProjectIndexIntentV2
  const body = value.body
  if (intent.kind === "project.directory.create/2") { assertExactKeysV2(body, ["entry", "location"], "directory body"); parseEntry(body.entry); parseLocation(body.location) }
  else if (intent.kind === "project.file.create/2") { assertExactKeysV2(body, ["entry", "location", "initialVersion"], "file body"); parseEntry(body.entry); if (body.location !== null) parseLocation(body.location); parseContentVersionWithoutIdentity(body.initialVersion) }
  else if (intent.kind === "project.entry.locate/2") { assertExactKeysV2(body, ["location"], "locate body"); parseLocation(body.location) }
  else if (intent.kind === "project.entry.tombstone/2") { assertExactKeysV2(body, ["tombstone"], "entry tombstone body"); parseEntryTombstone(body.tombstone) }
  else if (intent.kind === "project.file.write-text/2") { assertExactKeysV2(body, ["version", "conflictEntry", "promotion", "reservation"], "text body"); parseContentVersionWithoutIdentity(body.version); parseEntry(body.conflictEntry); parsePromotion(body.promotion); parseReservation(body.reservation) }
  else if (intent.kind === "project.file.overwrite-binary/2") { assertExactKeysV2(body, ["version"], "binary body"); parseContentVersionWithoutIdentity(body.version) }
  else if (intent.kind === "project.canvas.route.stage/2") { assertExactKeysV2(body, ["stage"], "stage body"); parseCanvasRoute(body.stage) }
  else if (intent.kind === "project.canvas.route.activate/2") { assertExactKeysV2(body, ["activation"], "activation body"); parseCanvasRoute(body.activation) }
  else if (intent.kind === "project.canvas.route.rename/2") { assertExactKeysV2(body, ["metadata"], "rename body"); parseCanvasRoute(body.metadata) }
  else if (intent.kind === "project.canvas.route.tombstone/2") { assertExactKeysV2(body, ["tombstone"], "route tombstone body"); parseCanvasRoute(body.tombstone) }
  else {
    assertExactKeysV2(
      body,
      ["resetCommit", "routeCasCore", "resetClaim", "confirmation", "approval"],
      "route reset body",
    )
    parseCanvasRoute(body.resetCommit)
    parseDocumentShardResetRouteCasCoreV2(body.routeCasCore)
    parseDocumentShardResetClaimV2(body.resetClaim)
    parseDocumentShardResetConfirmationV2(body.confirmation)
    parseDocumentShardResetApprovalV2(body.approval)
  }
  return freezeJcs(intent)
}

const INTENT_KINDS = new Set<ProjectIndexIntentKindV2>([
  "project.directory.create/2", "project.file.create/2", "project.entry.locate/2", "project.entry.tombstone/2", "project.file.write-text/2", "project.file.overwrite-binary/2", "project.canvas.route.stage/2", "project.canvas.route.activate/2", "project.canvas.route.rename/2", "project.canvas.route.tombstone/2", "project.canvas.route.reset/2",
])

function parseIdentity(value: unknown): ProjectIndexIdentityRecordV2 {
  assertExactKeysV2(value, ["format", "schema", "projectId", "projectEpoch", "shardEpoch", "rootDirectoryId", "protocolDigest", "schemaDigest", "uriProtocolDigest"], "ProjectIndex identity")
  if (value.format !== "convax.project-index-identity/2" || value.schema !== "convax.project-index.v2") fail("invalid-identity", "ProjectIndex identity is not v2")
  const identity = value as unknown as ProjectIndexIdentityRecordV2
  parseProjectIdV2(identity.projectId); parseId128V2(identity.projectEpoch); parseId128V2(identity.shardEpoch); parseProjectDirectoryId(identity.rootDirectoryId); parseDigestV2(identity.protocolDigest); parseDigestV2(identity.schemaDigest); parseDigestV2(identity.uriProtocolDigest)
  if (identity.schemaDigest !== PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2) fail("schema-mismatch", "ProjectIndex identity does not bind the selected R5 artifact")
  return freezeJcs(identity)
}

function parseEntry(value: unknown): ProjectEntryRecordV2 {
  assertExactKeysV2(value, ["format", "entryId", "kind", "storageClass", "contentPolicy", "provenance", "conflictSource", "createdByActorId", "createdByOperationId", "createdStamp"], "Project entry")
  const record = value as unknown as ProjectEntryRecordV2
  if (record.format !== "convax.project-entry/2") fail("invalid-entry", "Project entry format is invalid")
  parseProjectEntryId(record.entryId); parseActorIdV2(record.createdByActorId); parseId128V2(record.createdByOperationId); parsePortableStampV2(record.createdStamp)
  if ((record.kind === "directory") !== record.entryId.startsWith("pd_")) fail("invalid-entry", "Project entry kind/id differ")
  if (record.kind === "directory" ? record.storageClass !== null || record.contentPolicy !== "none" : record.storageClass === null || record.contentPolicy === "none") fail("invalid-entry", "Project entry storage/content policy is invalid")
  if (record.provenance === "content-conflict-copy") { if (record.conflictSource === null) fail("invalid-entry", "Conflict copy lacks source"); parseConflictSource(record.conflictSource) }
  else if (record.conflictSource !== null) fail("invalid-entry", "Ordinary entry has conflict source")
  return freezeJcs(record)
}

function parseConflictSource(value: unknown): void {
  assertExactKeysV2(value, ["primaryFileId", "sourceVersionId", "promotionId", "reservationId"], "Conflict source")
  parseProjectFileId(value.primaryFileId); parseVersionId(value.sourceVersionId); parseFactId(value.promotionId, "pp"); parseFactId(value.reservationId, "pr")
}

function parseLocation(value: unknown): ProjectEntryLocationClaimV2 {
  assertExactKeysV2(value, ["format", "claimId", "entryId", "state", "parentDirectoryId", "basename", "reason", "stamp"], "Project location")
  const record = value as unknown as ProjectEntryLocationClaimV2
  if (record.format !== "convax.project-entry-location/2") fail("invalid-location", "Project location format is invalid")
  parseFactId(record.claimId, "pl"); parseProjectEntryId(record.entryId); parseProjectDirectoryId(record.parentDirectoryId); assertPortableBasename(record.basename); parsePortableStampV2(record.stamp)
  if (!(["linked", "declared-missing"] as unknown[]).includes(record.state) || !(["create", "move", "rename", "explicit-relink", "explicit-missing"] as unknown[]).includes(record.reason)) fail("invalid-location", "Project location union is invalid")
  return freezeJcs(record)
}

function parseEntryTombstone(value: unknown): ProjectEntryTombstoneV2 {
  assertExactKeysV2(value, ["format", "tombstoneId", "entryId", "reason", "observedEntryDigest", "stamp"], "Project entry tombstone")
  const record = value as unknown as ProjectEntryTombstoneV2
  if (record.format !== "convax.project-entry-tombstone/2" || record.reason !== "explicit-delete") fail("invalid-tombstone", "Project tombstone is invalid")
  parseFactId(record.tombstoneId, "pt"); parseProjectEntryId(record.entryId); parseDigestV2(record.observedEntryDigest); parsePortableStampV2(record.stamp)
  return freezeJcs(record)
}

function parseBlob(value: unknown): ProjectBlobRefV2 {
  assertExactKeysV2(value, ["format", "algorithm", "digest", "byteLength", "mime"], "Project blob ref")
  const blob = value as unknown as ProjectBlobRefV2
  if (blob.format !== "convax.blob-ref/2" || blob.algorithm !== "sha256") fail("invalid-blob", "Blob ref format is invalid")
  parseDigestV2(blob.digest); parseUint64V2(blob.byteLength)
  if (typeof blob.mime !== "string" || !MIME.test(blob.mime) || encoder.encode(blob.mime).byteLength > 255) fail("invalid-blob", "Blob MIME is invalid")
  return freezeJcs(blob)
}

function parseContentVersionWithoutIdentity(value: unknown): ProjectContentVersionRecordV2 {
  return parseContentVersion(value)
}

function parseContentVersion(value: unknown, identity?: ProjectIndexIdentityRecordV2): ProjectContentVersionRecordV2 {
  assertExactKeysV2(value, ["format", "primaryFileId", "versionId", "writeClass", "blob", "canonicalRevisionUri", "supersedesVersionIds", "binaryLogicalCounter", "creatorActorId", "creatorOperationId", "stamp"], "Project content version")
  const record = value as unknown as ProjectContentVersionRecordV2
  if (record.format !== "convax.project-content-version/2") fail("invalid-version", "Content version format is invalid")
  parseProjectFileId(record.primaryFileId); parseVersionId(record.versionId); parseBlob(record.blob); parseActorIdV2(record.creatorActorId); parseId128V2(record.creatorOperationId); parsePortableStampV2(record.stamp)
  assertDenseArrayV2(record.supersedesVersionIds, "Superseded versions")
  if (record.supersedesVersionIds.length > 256) fail("invalid-version", "Superseded versions exceed their bound")
  const parents = record.supersedesVersionIds.map(parseVersionId)
  if (!isStrictSorted(parents, compareUtf8V2)) fail("invalid-version", "Superseded versions must be sorted unique")
  if (record.binaryLogicalCounter !== null) parseUint64V2(record.binaryLogicalCounter)
  if (record.writeClass === "initial" && record.binaryLogicalCounter !== null && record.binaryLogicalCounter !== "0") fail("invalid-version", "Binary initial counter must be zero")
  if (record.writeClass === "text-write" && record.binaryLogicalCounter !== null) fail("invalid-version", "Text write has a binary counter")
  if (record.writeClass === "binary-overwrite" && record.binaryLogicalCounter === null) fail("invalid-version", "Binary overwrite lacks a counter")
  if (canonicalize(record.canonicalRevisionUri) !== record.canonicalRevisionUri) fail("invalid-uri", "Revision URI is not canonical")
  const uri = parseProjectUri(record.canonicalRevisionUri)
  if (uri.entryId !== record.primaryFileId || uri.blob !== `sha256:${record.blob.digest}` || (identity && (uri.projectId !== identity.projectId || uri.projectEpoch !== identity.projectEpoch))) fail("invalid-uri", "Revision URI does not bind the version family/blob")
  return freezeJcs(record)
}

function parsePromotion(value: unknown): ProjectContentPromotionRecordV2 {
  assertExactKeysV2(value, ["format", "promotionId", "primaryFileId", "versionId", "reservedConflictFileId", "reservationId", "stamp"], "Project promotion")
  const record = value as unknown as ProjectContentPromotionRecordV2
  if (record.format !== "convax.project-content-promotion/2") fail("invalid-promotion", "Promotion format is invalid")
  parseFactId(record.promotionId, "pp"); parseProjectFileId(record.primaryFileId); parseVersionId(record.versionId); parseProjectFileId(record.reservedConflictFileId); parseFactId(record.reservationId, "pr"); parsePortableStampV2(record.stamp)
  return freezeJcs(record)
}

function parseReservation(value: unknown): ProjectPathReservationRecordV2 {
  assertExactKeysV2(value, ["format", "reservationId", "kind", "primaryFileId", "versionId", "reservedEntryId", "canonicalPath", "originalBasenameHint", "stamp"], "Project reservation")
  const record = value as unknown as ProjectPathReservationRecordV2
  if (record.format !== "convax.project-path-reservation/2" || record.kind !== "content-conflict-copy") fail("invalid-reservation", "Reservation format is invalid")
  parseFactId(record.reservationId, "pr"); parseProjectFileId(record.primaryFileId); parseVersionId(record.versionId); parseProjectFileId(record.reservedEntryId); parsePortableStampV2(record.stamp); assertPortableBasename(record.originalBasenameHint)
  if (record.canonicalPath !== `.convax-conflicts/${record.reservedEntryId}/content`) fail("invalid-reservation", "Conflict reservation path is not canonical")
  return freezeJcs(record)
}

function parseCanvasRoute(value: unknown): CanvasRouteFactV2 {
  if (typeof value !== "object" || value === null || !("format" in value)) fail("invalid-route", "Canvas route fact is invalid")
  const format = (value as { format?: unknown }).format
  if (format === "convax.canvas-route-stage/2") {
    assertExactKeysV2(value, ["format", "transitionId", "canvasId", "shardEpoch", "title", "reason", "stamp"], "Canvas route stage")
    const record = value as unknown as CanvasRouteStageV2; parseFactId(record.transitionId, "cr"); parseCanvasIdV2(record.canvasId); parseId128V2(record.shardEpoch); assertBoundedNfcStringV2(record.title, 1, 512, "Canvas title"); parsePortableStampV2(record.stamp); if (record.reason !== "create") fail("invalid-route", "Stage reason is invalid"); return freezeJcs(record)
  }
  if (format === "convax.canvas-route-activation/2") {
    assertExactKeysV2(value, ["format", "transitionId", "canvasId", "shardEpoch", "predecessorActivationDigest", "stageRecordDigest", "projectIndexRouteDependencyFrameDigest", "canvasGenesisCheckpointObjectDigest", "stagedProjectIndexFrontierDigest", "stamp"], "Canvas route activation")
    const record = value as unknown as CanvasRouteActivationV2; parseFactId(record.transitionId, "cr"); parseCanvasIdV2(record.canvasId); parseId128V2(record.shardEpoch); if (record.predecessorActivationDigest !== null) fail("invalid-route", "Initial activation predecessor is not null"); parseDigestV2(record.stageRecordDigest); parseDigestV2(record.projectIndexRouteDependencyFrameDigest); parseDigestV2(record.canvasGenesisCheckpointObjectDigest); parseDigestV2(record.stagedProjectIndexFrontierDigest); parsePortableStampV2(record.stamp); return freezeJcs(record)
  }
  if (format === "convax.canvas-route-metadata/2") {
    assertExactKeysV2(value, ["format", "transitionId", "canvasId", "title", "observedActivationDigest", "stamp"], "Canvas route metadata")
    const record = value as unknown as CanvasRouteMetadataClaimV2; parseFactId(record.transitionId, "cr"); parseCanvasIdV2(record.canvasId); assertBoundedNfcStringV2(record.title, 1, 512, "Canvas title"); parseDigestV2(record.observedActivationDigest); parsePortableStampV2(record.stamp); return freezeJcs(record)
  }
  if (format === "convax.canvas-route-reset-commit/2") {
    assertExactKeysV2(value, [
      "format", "transitionId", "canvasId", "oldShardEpoch", "newShardEpoch",
      "predecessorActivationDigest", "stagedGenesisCheckpointObjectDigest",
      "stagedGenesisFullUpdateDigest", "stagedGenesisStateVectorDigest",
      "resetClaimCoreDigest", "confirmationCoreDigest", "approvalCoreDigest",
      "routeCasCoreDigest", "stamp",
    ], "Canvas route reset commit")
    const record = value as unknown as CanvasRouteResetCommitV2
    parseFactId(record.transitionId, "cr")
    parseCanvasIdV2(record.canvasId)
    parseId128V2(record.oldShardEpoch)
    parseId128V2(record.newShardEpoch)
    if (record.oldShardEpoch === record.newShardEpoch) fail("invalid-route", "Canvas reset must rotate shard epoch")
    parseDigestV2(record.predecessorActivationDigest)
    parseDigestV2(record.stagedGenesisCheckpointObjectDigest)
    parseDigestV2(record.stagedGenesisFullUpdateDigest)
    parseDigestV2(record.stagedGenesisStateVectorDigest)
    parseDigestV2(record.resetClaimCoreDigest)
    parseDigestV2(record.confirmationCoreDigest)
    parseDigestV2(record.approvalCoreDigest)
    parseDigestV2(record.routeCasCoreDigest)
    parsePortableStampV2(record.stamp)
    return freezeJcs(record)
  }
  assertExactKeysV2(value, ["format", "transitionId", "canvasId", "observedActivationDigest", "reason", "stamp"], "Canvas route tombstone")
  const record = value as unknown as CanvasRouteTombstoneV2
  if (record.format !== "convax.canvas-route-tombstone/2" || record.reason !== "explicit-delete") fail("invalid-route", "Route tombstone is invalid")
  parseFactId(record.transitionId, "cr"); parseCanvasIdV2(record.canvasId); if (record.observedActivationDigest !== null) parseDigestV2(record.observedActivationDigest); parsePortableStampV2(record.stamp); return freezeJcs(record)
}

function parseReceipt(value: unknown): ProjectOperationReceiptV2 {
  assertExactKeysV2(value, ["format", "actorId", "operationId", "intentKind", "intentDigest", "allocatedIds", "firstWriteOrdinal", "writeCount", "stampLamport"], "Project operation receipt")
  const record = value as unknown as ProjectOperationReceiptV2
  if (record.format !== "convax.project-operation-receipt/2" || !INTENT_KINDS.has(record.intentKind)) fail("invalid-receipt", "Operation receipt is invalid")
  parseActorIdV2(record.actorId); parseId128V2(record.operationId); parseDigestV2(record.intentDigest); parseUint32V2(record.firstWriteOrdinal); parseUint32V2(record.writeCount); parseUint64V2(record.stampLamport); assertDenseArrayV2(record.allocatedIds, "Allocated ids")
  if (record.allocatedIds.length > 8) fail("invalid-receipt", "Allocated ids exceed their bound")
  if (!isStrictSorted(record.allocatedIds, compareUtf8V2)) fail("invalid-receipt", "Allocated ids are not sorted unique")
  return freezeJcs(record)
}

function parseProjectIndexScope(value: DocumentScopeV2): ProjectIndexScopeV2 {
  if (value.docKind !== "project-index" || value.docId !== "project-index") fail("scope-mismatch", "Project owner requires ProjectIndex scope")
  parseProjectIdV2(value.projectId); parseId128V2(value.projectEpoch); parseId128V2(value.shardEpoch)
  return value as ProjectIndexScopeV2
}

function parseCanvasDocumentScopeV2(value: unknown): CanvasDocumentScopeV2 {
  const scope = parseDocumentScopeV2(value)
  if (scope.docKind !== "canvas" || scope.docId !== parseCanvasIdV2(scope.docId)) {
    fail("invalid-reset", "Canvas reset scope is invalid")
  }
  return scope as CanvasDocumentScopeV2
}

function parseDocumentShardResetReasonV2(value: unknown): DocumentShardResetReasonV2 {
  if (
    value !== "incompatible-canvas-schema" &&
    value !== "document-lamport-exhaustion" &&
    value !== "unrecoverable-certified-history-corruption"
  ) {
    fail("invalid-reset", "Canvas reset reason is invalid")
  }
  return value
}

function parseDocumentShardResetRouteCasCoreV2(
  value: unknown,
): DocumentShardResetRouteCasCoreV2 {
  assertExactKeysV2(value, [
    "format", "operationId", "canvasId", "oldScope", "newScope",
    "predecessorActivationDigest", "stagedGenesisCheckpointObjectDigest",
    "stagedGenesisFullUpdateDigest", "stagedGenesisStateVectorDigest",
  ], "Document shard reset route CAS core")
  if (value.format !== "convax.document-shard-reset-route-cas-core/2") {
    fail("invalid-reset", "Canvas reset route CAS format is invalid")
  }
  const oldScope = parseCanvasDocumentScopeV2(value.oldScope)
  const newScope = parseCanvasDocumentScopeV2(value.newScope)
  const canvasId = parseCanvasIdV2(value.canvasId)
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
    operationId: parseId128V2(value.operationId),
    canvasId,
    oldScope,
    newScope,
    predecessorActivationDigest: parseDigestV2(value.predecessorActivationDigest),
    stagedGenesisCheckpointObjectDigest: parseDigestV2(value.stagedGenesisCheckpointObjectDigest),
    stagedGenesisFullUpdateDigest: parseDigestV2(value.stagedGenesisFullUpdateDigest),
    stagedGenesisStateVectorDigest: parseDigestV2(value.stagedGenesisStateVectorDigest),
  })
}

function parseDocumentShardResetClaimCoreV2(value: unknown): DocumentShardResetClaimCoreV2 {
  assertExactKeysV2(value, [
    "format", "projectIndexScope", "oldScope", "newScope", "reason",
    "oldProtocolDigest", "newProtocolDigest", "oldSchemaDigest", "newSchemaDigest",
    "stagedGenesisCheckpointObjectDigest", "stagedGenesisFullUpdateDigest",
    "stagedGenesisStateVectorDigest", "routeCasCoreDigest", "initiatorMemberId",
    "initiatorReplicaId", "initiatorActorId", "adminMemberId",
    "adminAuthorizationDigest", "explicitConfirmationReceiptDigest",
  ], "Document shard reset claim core")
  if (value.format !== "convax.document-shard-reset-claim-core/2") {
    fail("invalid-reset", "Canvas reset claim core format is invalid")
  }
  const projectIndexScope = parseProjectIndexScope(parseDocumentScopeV2(value.projectIndexScope))
  const oldScope = parseCanvasDocumentScopeV2(value.oldScope)
  const newScope = parseCanvasDocumentScopeV2(value.newScope)
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
    reason: parseDocumentShardResetReasonV2(value.reason),
    oldProtocolDigest: parseDigestV2(value.oldProtocolDigest),
    newProtocolDigest: parseDigestV2(value.newProtocolDigest),
    oldSchemaDigest: parseDigestV2(value.oldSchemaDigest),
    newSchemaDigest: parseDigestV2(value.newSchemaDigest),
    stagedGenesisCheckpointObjectDigest: parseDigestV2(value.stagedGenesisCheckpointObjectDigest),
    stagedGenesisFullUpdateDigest: parseDigestV2(value.stagedGenesisFullUpdateDigest),
    stagedGenesisStateVectorDigest: parseDigestV2(value.stagedGenesisStateVectorDigest),
    routeCasCoreDigest: parseDigestV2(value.routeCasCoreDigest),
    initiatorMemberId: parseMemberIdV2(value.initiatorMemberId),
    initiatorReplicaId: parseReplicaIdV2(value.initiatorReplicaId),
    initiatorActorId: parseActorIdV2(value.initiatorActorId),
    adminMemberId: parseMemberIdV2(value.adminMemberId),
    adminAuthorizationDigest: parseDigestV2(value.adminAuthorizationDigest),
    explicitConfirmationReceiptDigest: parseDigestV2(value.explicitConfirmationReceiptDigest),
  })
}

function parseDocumentShardResetClaimV2(value: unknown): DocumentShardResetClaimV2 {
  assertExactKeysV2(
    value,
    ["format", "core", "coreDigest", "initiatorSignature", "adminApprovalDigest"],
    "Document shard reset claim",
  )
  if (value.format !== "convax.document-shard-reset-claim/2") {
    fail("invalid-reset", "Canvas reset claim format is invalid")
  }
  const core = parseDocumentShardResetClaimCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== structuredDigestV2("convax.document-shard-reset-claim-core-digest/2", core)) {
    fail("invalid-reset", "Canvas reset claim core digest is invalid")
  }
  return freezeJcs({
    format: value.format,
    core,
    coreDigest,
    initiatorSignature: parseSignatureV2(value.initiatorSignature),
    adminApprovalDigest: parseDigestV2(value.adminApprovalDigest),
  })
}

function parseDocumentShardResetConfirmationCoreV2(
  value: unknown,
): DocumentShardResetConfirmationCoreV2 {
  assertExactKeysV2(value, [
    "format", "confirmationId", "projectId", "projectEpoch", "oldScope", "newScope",
    "reason", "routeCasCoreDigest", "predecessorActivationDigest",
    "stagedGenesisCheckpointObjectDigest", "stagedGenesisFullUpdateDigest",
    "stagedGenesisStateVectorDigest", "initiatorMemberId", "initiatorReplicaId",
    "initiatorActorId", "initiatorActorCredentialCoreDigest", "confirmationStatement",
    "protocolDigest",
  ], "Document shard reset confirmation core")
  if (
    value.format !== "convax.document-shard-reset-confirmation-core/2" ||
    value.confirmationStatement !== "replace-one-canvas-shard-and-retain-old-recovery-bytes"
  ) {
    fail("invalid-reset", "Canvas reset confirmation core is invalid")
  }
  return freezeJcs({
    format: value.format,
    confirmationId: parseId128V2(value.confirmationId),
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    oldScope: parseCanvasDocumentScopeV2(value.oldScope),
    newScope: parseCanvasDocumentScopeV2(value.newScope),
    reason: parseDocumentShardResetReasonV2(value.reason),
    routeCasCoreDigest: parseDigestV2(value.routeCasCoreDigest),
    predecessorActivationDigest: parseDigestV2(value.predecessorActivationDigest),
    stagedGenesisCheckpointObjectDigest: parseDigestV2(value.stagedGenesisCheckpointObjectDigest),
    stagedGenesisFullUpdateDigest: parseDigestV2(value.stagedGenesisFullUpdateDigest),
    stagedGenesisStateVectorDigest: parseDigestV2(value.stagedGenesisStateVectorDigest),
    initiatorMemberId: parseMemberIdV2(value.initiatorMemberId),
    initiatorReplicaId: parseReplicaIdV2(value.initiatorReplicaId),
    initiatorActorId: parseActorIdV2(value.initiatorActorId),
    initiatorActorCredentialCoreDigest: parseDigestV2(value.initiatorActorCredentialCoreDigest),
    confirmationStatement: value.confirmationStatement,
    protocolDigest: parseDigestV2(value.protocolDigest),
  })
}

function parseDocumentShardResetConfirmationV2(
  value: unknown,
): DocumentShardResetConfirmationV2 {
  assertExactKeysV2(
    value,
    ["format", "core", "coreDigest", "initiatorReplicaSignature"],
    "Document shard reset confirmation",
  )
  if (value.format !== "convax.document-shard-reset-confirmation/2") {
    fail("invalid-reset", "Canvas reset confirmation format is invalid")
  }
  const core = parseDocumentShardResetConfirmationCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== structuredDigestV2("convax.document-shard-reset-confirmation-core/2", core)) {
    fail("invalid-reset", "Canvas reset confirmation core digest is invalid")
  }
  return freezeJcs({
    format: value.format,
    core,
    coreDigest,
    initiatorReplicaSignature: parseSignatureV2(value.initiatorReplicaSignature),
  })
}

function parseDocumentShardResetApprovalCoreV2(value: unknown): DocumentShardResetApprovalCoreV2 {
  assertExactKeysV2(value, [
    "format", "approvalId", "resetClaimCoreDigest", "confirmationCoreDigest",
    "projectId", "projectEpoch", "oldScope", "newScope", "reason",
    "routeCasCoreDigest", "adminMemberId", "adminMemberAuthorizationEpoch",
    "adminCapabilityCoreDigest", "approvalStatement", "protocolDigest",
  ], "Document shard reset approval core")
  if (
    value.format !== "convax.document-shard-reset-approval-core/2" ||
    value.approvalStatement !== "approve-exact-canvas-shard-reset"
  ) {
    fail("invalid-reset", "Canvas reset approval core is invalid")
  }
  return freezeJcs({
    format: value.format,
    approvalId: parseId128V2(value.approvalId),
    resetClaimCoreDigest: parseDigestV2(value.resetClaimCoreDigest),
    confirmationCoreDigest: parseDigestV2(value.confirmationCoreDigest),
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    oldScope: parseCanvasDocumentScopeV2(value.oldScope),
    newScope: parseCanvasDocumentScopeV2(value.newScope),
    reason: parseDocumentShardResetReasonV2(value.reason),
    routeCasCoreDigest: parseDigestV2(value.routeCasCoreDigest),
    adminMemberId: parseMemberIdV2(value.adminMemberId),
    adminMemberAuthorizationEpoch: parseId128V2(value.adminMemberAuthorizationEpoch),
    adminCapabilityCoreDigest: parseDigestV2(value.adminCapabilityCoreDigest),
    approvalStatement: value.approvalStatement,
    protocolDigest: parseDigestV2(value.protocolDigest),
  })
}

function parseDocumentShardResetApprovalV2(value: unknown): DocumentShardResetApprovalV2 {
  assertExactKeysV2(
    value,
    ["format", "core", "coreDigest", "adminMemberSignature"],
    "Document shard reset approval",
  )
  if (value.format !== "convax.document-shard-reset-approval/2") {
    fail("invalid-reset", "Canvas reset approval format is invalid")
  }
  const core = parseDocumentShardResetApprovalCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== structuredDigestV2("convax.document-shard-reset-approval-core/2", core)) {
    fail("invalid-reset", "Canvas reset approval core digest is invalid")
  }
  return freezeJcs({
    format: value.format,
    core,
    coreDigest,
    adminMemberSignature: parseSignatureV2(value.adminMemberSignature),
  })
}

function parseVersionId(value: unknown): ProjectVersionIdV2 {
  if (typeof value !== "string" || !VERSION.test(value)) fail("invalid-version-id", "Project version id is invalid")
  return value as ProjectVersionIdV2
}

function parseFactId(value: unknown, prefix?: "pl" | "pt" | "pp" | "pr" | "cr"): ProjectFactIdV2 {
  if (typeof value !== "string" || !FACT.test(value) || (prefix && !value.startsWith(`${prefix}_`))) fail("invalid-fact-id", "Project fact id is invalid")
  return value as ProjectFactIdV2
}

function assertPortableBasename(value: string): void {
  assertBoundedNfcStringV2(value, 1, 255, "Project basename")
  if (/[\\/\0\u0001-\u001f\u007f]/u.test(value) || value === "." || value === ".." || /[. ]$/u.test(value) || /^(\.convax|\.convax-conflicts)$/iu.test(value) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/iu.test(value)) fail("invalid-basename", "Project basename is not portable")
}

function getRoot(document: Y.Doc): Y.Map<unknown> {
  const root = document.share.get(PROJECT_INDEX_ROOT_NAME_V2)
  if (!(root instanceof Y.Map)) fail("invalid-root", "ProjectIndex root is missing")
  return root
}

function childMap(root: Y.Map<unknown>, key: (typeof PROJECT_INDEX_ROOT_KEYS_V2)[number]): Y.Map<unknown> {
  const value = root.get(key)
  if (!(value instanceof Y.Map)) fail("invalid-root", `${key} is not a Y.Map`)
  return value
}

function assertMapKeys(map: Y.Map<unknown>, expected: readonly string[], label: string): void {
  const actual = [...map.keys()].sort(compareUtf8V2)
  const wanted = [...expected].sort(compareUtf8V2)
  if (!encodeEqual(actual, wanted)) fail("unknown-root-key", `${label} has unknown or missing keys`)
}

function readFactMap<T>(root: Y.Map<unknown>, name: (typeof PROJECT_INDEX_ROOT_KEYS_V2)[number], parser: (value: unknown) => T, keyMatches: (key: string, value: T) => boolean): ReadonlyMap<string, T> {
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
  return Object.freeze([...map.entries()].sort(([left], [right]) => compareUtf8V2(left, right)).map(([key, value]) => Object.freeze([key, value] as const)))
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
  const clone = decodeRestrictedJcsV2(encodeRestrictedJcsV2(value)) as T
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
  const a = encodeRestrictedJcsV2(left); const b = encodeRestrictedJcsV2(right)
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

function digestParts(...parts: readonly Uint8Array[]): DigestV2 {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
  return parseDigestV2(bytesToHex(sha256(bytes)))
}

function ownerResult(result: OwnerApplyResultV2<"project-index">): { readonly result: ProjectIndexApplyResultV2; readonly scope: ProjectIndexScopeV2 } | null {
  const value = result.value
  return typeof value === "object" && value !== null && "result" in value && (value as { result?: { format?: unknown } }).result?.format === "convax.project-index-intent-result/2" ? value as { readonly result: ProjectIndexApplyResultV2; readonly scope: ProjectIndexScopeV2 } : null
}

function fail(code: string, message: string): never {
  throw new ProjectIndexSchemaErrorV2(code, message)
}
