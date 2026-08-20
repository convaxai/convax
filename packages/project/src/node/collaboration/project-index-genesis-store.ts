import { createHash, timingSafeEqual } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  acceptedHeadMaterializedStateDigest,
  causalFrontierDigest,
  applyYjsUpdate,
  decodeRestrictedJcs,
  encodeFullUpdate,
  encodeRestrictedJcs,
  encodeStateVector,
  installCurrentProtocolAuthority,
  ownerCanonicalizerDescriptorDigest,
  parseActorId,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parseMemberId,
  parseReplicaId,
  parseReplicaCheckpoint,
  parseUint32,
  parseUint64,
  replicaActorHeadSetDigest,
  replicaCheckpointObjectDigest,
  replicaCheckpointCoreDigest,
  stateVectorDigest,
  structuredDigest,
  yjsUpdateDigest,
  type ActorId,
  type Digest,
  type DocumentScope,
  type Id128,
  type MemberId,
  type ReplicaCheckpointCore,
  type ReplicaCheckpoint,
  type ReplicaId,
} from "@convax/collaboration"
import type * as Y from "yjs"
import { IMMEDIATE_PREDECESSOR_PROTOCOL } from "@convax/collaboration/migration"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  createProjectIndexReconstructionYDoc,
  createProjectIndexYDoc,
  projectIndexCanonicalStateCommitmentDigest,
  projectIndexOwnerCanonicalizerDescriptor,
  validateProjectIndexYDoc,
  type ProjectEntryRecord,
} from "../../collaboration/project-index"
import {
  NodeCollaborationPersistenceError,
  NodeCollaborationPersistence,
  type NodeAcceptedReplicaHead,
  type NodeCollaborationPersistenceFaultHooks,
  type NodeReplicaHeadMaterializer,
} from "./persistence-store"
import { fsyncProjectDirectory } from "./directory-durability"
import { deriveDocumentNativeKey, deriveObjectNativeKey } from "./native-store-keys"
import { readProjectResetRecords } from "./project-reset-store"

const MANIFEST_MAGIC = Buffer.from("CVXPIMAN", "ascii")
const MANIFEST_HEADER_BYTES = 12
const MANIFEST_CHECKSUM_BYTES = 32
const MAX_MANIFEST_PAYLOAD_BYTES = 64 * 1024
const LOCAL_RECORD_DOMAIN = Buffer.from("convax.local-project-store-record-digest\0", "utf8")
const STORE_IDENTITY = "convax.project-collaboration-native-store" as const
type ProjectIndexDocumentScope = DocumentScope & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

export interface ProjectNativeStoreManifest {
  readonly format: "convax.project-native-store-manifest"
  readonly storeIdentity: typeof STORE_IDENTITY
  readonly projectIndexScope: ProjectIndexDocumentScope
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly uriProtocolDigest: Digest
  readonly initializationAuthorityDigest: Digest
  readonly projectIndexGenesisKind: "empty" | "immediate-predecessor-import"
  readonly migrationImportBaseProofDigest: Digest | null
  readonly projectIndexGenesisCheckpointObjectDigest: Digest
  readonly projectIndexGenesisFullUpdateDigest: Digest
  readonly projectIndexGenesisStateVectorDigest: Digest
  readonly projectIndexGenesisCanonicalStateDigest: Digest
}

export interface ImmediatePredecessorProjectNativeStoreManifest {
  readonly format: "convax.project-native-store-manifest"
  readonly storeIdentity: typeof STORE_IDENTITY
  readonly projectIndexScope: ProjectIndexDocumentScope
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly uriProtocolDigest: Digest
  readonly initializationAuthorityDigest: Digest
  readonly emptyProjectIndexCheckpointObjectDigest: Digest
  readonly emptyProjectIndexFullUpdateDigest: Digest
  readonly emptyProjectIndexStateVectorDigest: Digest
  readonly emptyProjectIndexCanonicalStateDigest: Digest
}

export interface ProjectNativeStoreAuthority {
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly uriProtocolDigest: Digest
}

export interface VerifiedProjectIndexGenesis {
  readonly manifest: ProjectNativeStoreManifest
  readonly manifestLocalRecordDigest: Digest
  readonly checkpointExactBytes: Uint8Array
  readonly acceptedBase: Omit<NodeAcceptedReplicaHead, "headDigest">
}

export type VerifiedEmptyProjectIndexGenesis = VerifiedProjectIndexGenesis & Readonly<{
  manifest: ProjectNativeStoreManifest & Readonly<{
    projectIndexGenesisKind: "empty"
    migrationImportBaseProofDigest: null
  }>
}>

export type VerifiedImmediatePredecessorImportedProjectIndexGenesis = VerifiedProjectIndexGenesis & Readonly<{
  manifest: ProjectNativeStoreManifest & Readonly<{
    projectIndexGenesisKind: "immediate-predecessor-import"
    migrationImportBaseProofDigest: Digest
  }>
}>

export interface ProjectIndexGenesisCheckpointVerifier {
  verify(checkpoint: ReplicaCheckpoint): Promise<boolean>
}

export interface ProjectIndexNativeStoreInitializationFaults {
  afterManifestFsync?(): Promise<void>
  afterGenesisFsync?(): Promise<void>
  beforePublishRename?(): Promise<void>
}

/**
 * Project-owned constructor for the only legal empty ProjectIndex base. A new
 * Project creates this current genesis once; there is no earlier genesis and no
 * later conflictCopy. Desktop supplies already-durable principal identities and
 * signs the returned core; it never assembles Project schema bytes itself.
 */
export function createEmptyProjectIndexGenesisCandidate(input: {
  readonly scope: DocumentScope
  readonly actorId: ActorId
  readonly operationId: Id128
  readonly checkpointId: Id128
  readonly authorMemberId: MemberId
  readonly authorReplicaId: ReplicaId
  readonly authorAuthorizationDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly authority: ProjectNativeStoreAuthority
}): Readonly<{ document: Y.Doc; checkpointCore: ReplicaCheckpointCore }> {
  const scope = requireProjectIndexScope(input.scope)
  const actorId = parseActorId(input.actorId)
  const operationId = parseId128(input.operationId)
  const rootDirectoryId = `pd_${structuredDigest("convax.project-derived-identity", {
    format: "convax.project-derived-identity-core",
    scope,
    actorId,
    operationId,
    ordinal: parseUint32("0"),
    kind: "directory",
  })}` as const
  const rootEntry: ProjectEntryRecord = Object.freeze({
    format: "convax.project-entry",
    entryId: rootDirectoryId,
    kind: "directory",
    storageClass: null,
    contentPolicy: "none",
    provenance: "project-root",
    conflictSource: null,
    createdByActorId: actorId,
    createdByOperationId: operationId,
    createdStamp: Object.freeze({
      format: "convax.portable-stamp",
      lamport: parseUint64("0"),
      actorId,
      operationId,
      writeOrdinal: parseUint32("0"),
    }),
  })
  const document = createProjectIndexYDoc(
    Object.freeze({
      format: "convax.project-index-identity",
      schema: "convax.project-index.v2",
      projectId: scope.projectId,
      projectEpoch: scope.projectEpoch,
      shardEpoch: scope.shardEpoch,
      rootDirectoryId,
      protocolDigest: parseDigest(input.authority.protocolDigest),
      schemaDigest: parseDigest(input.authority.schemaDigest),
      uriProtocolDigest: parseDigest(input.authority.uriProtocolDigest),
      migrationImportBaseProofDigest: null,
    }),
    rootEntry,
  )
  const fullUpdate = encodeFullUpdate(document)
  const stateVector = encodeStateVector(document)
  const canonicalStateDigest = projectIndexCanonicalStateCommitmentDigest(
    document,
    installCurrentProtocolAuthority(),
  )
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const frontierDigest = causalFrontierDigest(frontier)
  const actorHeads = Object.freeze({
    format: "convax.replica-actor-head-set" as const,
    scope,
    heads: Object.freeze([]),
  })
  const checkpointCore: ReplicaCheckpointCore = Object.freeze({
    format: "convax.replica-checkpoint-core",
    scope,
    checkpointId: parseId128(input.checkpointId),
    authorMemberId: parseMemberId(input.authorMemberId),
    authorReplicaId: parseReplicaId(input.authorReplicaId),
    authorActorId: actorId,
    authorAuthorizationDigest: parseDigest(input.authorAuthorizationDigest),
    directParentCheckpointDigests: Object.freeze([]),
    baseFrontierDigest: frontierDigest,
    computedFrontierDigest: frontierDigest,
    actorHeadBoundaryDigest: replicaActorHeadSetDigest(actorHeads),
    stateVectorDigest: stateVectorDigest(stateVector),
    canonicalStateDigest,
    fullUpdateDigest: yjsUpdateDigest(fullUpdate),
    fullUpdateByteLength: parseUint64(String(fullUpdate.byteLength)),
    protocolDigest: parseDigest(input.authority.protocolDigest),
    schemaDigest: parseDigest(input.authority.schemaDigest),
    canonicalizerDigest: ownerCanonicalizerDescriptorDigest(
      projectIndexOwnerCanonicalizerDescriptor(input.authority.schemaDigest),
    ),
    validationArtifactSetDigest: parseDigest(input.validationArtifactSetDigest),
  })
  // Parse/digest once here so callers cannot receive a structurally plausible,
  // codec-invalid core and sign it as local-owner authority.
  replicaCheckpointCoreDigest(checkpointCore)
  return Object.freeze({ document, checkpointCore })
}

/** Builds a current checkpoint core over an already rebuilt non-empty import. */
export function createImmediatePredecessorImportedProjectIndexCheckpointCandidate(input: {
  readonly scope: DocumentScope
  readonly document: Y.Doc
  readonly actorId: ActorId
  readonly checkpointId: Id128
  readonly authorMemberId: MemberId
  readonly authorReplicaId: ReplicaId
  readonly authorAuthorizationDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly authority: ProjectNativeStoreAuthority
  readonly migrationImportBaseProofDigest: Digest
}): Readonly<{ document: Y.Doc; checkpointCore: ReplicaCheckpointCore }> {
  const scope = requireProjectIndexScope(input.scope)
  const snapshot = validateProjectIndexYDoc(input.document, scope)
  if (
    snapshot.identity.protocolDigest !== parseDigest(input.authority.protocolDigest) ||
    snapshot.identity.schemaDigest !== parseDigest(input.authority.schemaDigest) ||
    snapshot.identity.uriProtocolDigest !== parseDigest(input.authority.uriProtocolDigest) ||
    snapshot.identity.migrationImportBaseProofDigest !== parseDigest(input.migrationImportBaseProofDigest)
  ) throw new TypeError("Imported ProjectIndex document is not current")
  const fullUpdate = encodeFullUpdate(input.document)
  const stateVector = encodeStateVector(input.document)
  const canonicalStateDigest = projectIndexCanonicalStateCommitmentDigest(
    input.document,
    installCurrentProtocolAuthority(),
  )
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const frontierDigest = causalFrontierDigest(frontier)
  const actorHeads = Object.freeze({
    format: "convax.replica-actor-head-set" as const,
    scope,
    heads: Object.freeze([]),
  })
  const checkpointCore: ReplicaCheckpointCore = Object.freeze({
    format: "convax.replica-checkpoint-core",
    scope,
    checkpointId: parseId128(input.checkpointId),
    authorMemberId: parseMemberId(input.authorMemberId),
    authorReplicaId: parseReplicaId(input.authorReplicaId),
    authorActorId: parseActorId(input.actorId),
    authorAuthorizationDigest: parseDigest(input.authorAuthorizationDigest),
    directParentCheckpointDigests: Object.freeze([]),
    baseFrontierDigest: frontierDigest,
    computedFrontierDigest: frontierDigest,
    actorHeadBoundaryDigest: replicaActorHeadSetDigest(actorHeads),
    stateVectorDigest: stateVectorDigest(stateVector),
    canonicalStateDigest,
    fullUpdateDigest: yjsUpdateDigest(fullUpdate),
    fullUpdateByteLength: parseUint64(String(fullUpdate.byteLength)),
    protocolDigest: snapshot.identity.protocolDigest,
    schemaDigest: snapshot.identity.schemaDigest,
    canonicalizerDigest: ownerCanonicalizerDescriptorDigest(
      projectIndexOwnerCanonicalizerDescriptor(snapshot.identity.schemaDigest),
    ),
    validationArtifactSetDigest: parseDigest(input.validationArtifactSetDigest),
  })
  replicaCheckpointCoreDigest(checkpointCore)
  return Object.freeze({ document: input.document, checkpointCore })
}

/** Host-private envelope: magic + uint32 JCS length + JCS + ordinary SHA-256 checksum. */
export function encodeProjectNativeStoreManifest(input: ProjectNativeStoreManifest): Uint8Array {
  const manifest = parseProjectNativeStoreManifest(input)
  const payload = encodeRestrictedJcs(manifest)
  if (payload.byteLength > MAX_MANIFEST_PAYLOAD_BYTES) throw new TypeError("Project native manifest is too large")
  const output = Buffer.alloc(MANIFEST_HEADER_BYTES + payload.byteLength + MANIFEST_CHECKSUM_BYTES)
  MANIFEST_MAGIC.copy(output, 0)
  output.writeUInt32BE(payload.byteLength, MANIFEST_MAGIC.byteLength)
  output.set(payload, MANIFEST_HEADER_BYTES)
  output.set(createHash("sha256").update(payload).digest(), MANIFEST_HEADER_BYTES + payload.byteLength)
  return Uint8Array.from(output)
}

export function decodeProjectNativeStoreManifest(exactBytes: Readonly<Uint8Array>): ProjectNativeStoreManifest {
  return decodeProjectNativeStoreManifestForSchema(exactBytes, PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST)
}

/** Exact manifest decoder available only to the sealed one-shot migrator. */
export function decodeImmediatePredecessorProjectNativeStoreManifest(
  exactBytes: Readonly<Uint8Array>,
): ImmediatePredecessorProjectNativeStoreManifest {
  const manifest = decodeImmediatePredecessorManifestEnvelope(exactBytes)
  if (
    manifest.protocolDigest !== IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest ||
    manifest.uriProtocolDigest !== IMMEDIATE_PREDECESSOR_PROTOCOL.uriProtocolDigest
  ) throw new TypeError("Project native manifest is not the sealed immediate predecessor")
  return manifest
}

function decodeImmediatePredecessorManifestEnvelope(
  exactBytes: Readonly<Uint8Array>,
): ImmediatePredecessorProjectNativeStoreManifest {
  const payload = decodeManifestEnvelopePayload(exactBytes)
  const manifest = parseImmediatePredecessorProjectNativeStoreManifest(decodeRestrictedJcs(payload))
  if (!sameBytes(payload, encodeRestrictedJcs(manifest))) {
    throw new TypeError("Immediate-predecessor Project native manifest JCS bytes are not canonical")
  }
  return manifest
}

function decodeProjectNativeStoreManifestForSchema(
  exactBytes: Readonly<Uint8Array>,
  expectedSchemaDigest: Digest,
): ProjectNativeStoreManifest {
  const payload = decodeManifestEnvelopePayload(exactBytes)
  const manifest = parseProjectNativeStoreManifest(decodeRestrictedJcs(payload), expectedSchemaDigest)
  if (!sameBytes(payload, encodeRestrictedJcs(manifest))) {
    throw new TypeError("Project native manifest JCS bytes are not canonical")
  }
  return manifest
}

function decodeManifestEnvelopePayload(exactBytes: Readonly<Uint8Array>): Uint8Array {
  if (!(exactBytes instanceof Uint8Array)) throw new TypeError("Project native manifest must be bytes")
  const bytes = Buffer.from(exactBytes)
  if (
    bytes.byteLength < MANIFEST_HEADER_BYTES + MANIFEST_CHECKSUM_BYTES ||
    !bytes.subarray(0, MANIFEST_MAGIC.byteLength).equals(MANIFEST_MAGIC)
  ) {
    throw new TypeError("Project native manifest envelope is invalid")
  }
  const payloadLength = bytes.readUInt32BE(MANIFEST_MAGIC.byteLength)
  if (
    payloadLength < 1 ||
    payloadLength > MAX_MANIFEST_PAYLOAD_BYTES ||
    bytes.byteLength !== MANIFEST_HEADER_BYTES + payloadLength + MANIFEST_CHECKSUM_BYTES
  ) {
    throw new TypeError("Project native manifest length is invalid")
  }
  const payload = bytes.subarray(MANIFEST_HEADER_BYTES, MANIFEST_HEADER_BYTES + payloadLength)
  const checksum = bytes.subarray(MANIFEST_HEADER_BYTES + payloadLength)
  const computed = createHash("sha256").update(payload).digest()
  if (!timingSafeEqual(checksum, computed)) throw new TypeError("Project native manifest checksum mismatches")
  return Uint8Array.from(payload)
}

export function projectNativeStoreManifestLocalRecordDigest(input: ProjectNativeStoreManifest): Digest {
  const manifest = parseProjectNativeStoreManifest(input)
  return parseDigest(
    createHash("sha256")
      .update(LOCAL_RECORD_DOMAIN)
      .update(Buffer.from(manifest.format, "utf8"))
      .update(Buffer.from("\0", "utf8"))
      .update(encodeRestrictedJcs(manifest))
      .digest("hex"),
  )
}

export async function verifyEmptyProjectIndexGenesis(input: {
  readonly scope: DocumentScope
  readonly document: Y.Doc
  readonly checkpointExactBytes: Readonly<Uint8Array>
  readonly initializationAuthorityDigest: Digest
  readonly verifier: ProjectIndexGenesisCheckpointVerifier
}): Promise<VerifiedEmptyProjectIndexGenesis> {
  const scope = requireProjectIndexScope(input.scope)
  const snapshot = validateProjectIndexYDoc(input.document, scope)
  if (snapshot.identity.migrationImportBaseProofDigest !== null) {
    throw new TypeError("Empty ProjectIndex genesis cannot carry a migration import proof")
  }
  if (
    snapshot.entries.size !== 1 ||
    !snapshot.entries.has(snapshot.identity.rootDirectoryId) ||
    snapshot.entryLocations.size !== 0 ||
    snapshot.entryTombstones.size !== 0 ||
    snapshot.contentFamilies.size !== 0 ||
    snapshot.contentConflictCopies.size !== 0 ||
    snapshot.pathReservations.size !== 0 ||
    snapshot.canvasRoutes.size !== 0 ||
    snapshot.operations.size !== 0
  ) {
    throw new TypeError("ProjectIndex genesis is not the exact empty catalog")
  }
  return verifyProjectIndexGenesis({
    ...input,
    scope,
    projectIndexGenesisKind: "empty",
    migrationImportBaseProofDigest: null,
  }) as Promise<VerifiedEmptyProjectIndexGenesis>
}

/**
 * Current non-empty base admitted only after the sealed predecessor reader has
 * rebuilt and re-signed its semantic snapshot. Ordinary Project creation keeps
 * using verifyEmptyProjectIndexGenesis and can never select this base kind.
 */
export async function verifyImmediatePredecessorImportedProjectIndexGenesis(input: {
  readonly scope: DocumentScope
  readonly document: Y.Doc
  readonly checkpointExactBytes: Readonly<Uint8Array>
  readonly initializationAuthorityDigest: Digest
  readonly migrationImportBaseProofDigest: Digest
  readonly verifier: ProjectIndexGenesisCheckpointVerifier
}): Promise<VerifiedImmediatePredecessorImportedProjectIndexGenesis> {
  const scope = requireProjectIndexScope(input.scope)
  const snapshot = validateProjectIndexYDoc(input.document, scope)
  if (snapshot.identity.migrationImportBaseProofDigest !== parseDigest(input.migrationImportBaseProofDigest)) {
    throw new TypeError("Imported ProjectIndex owner state does not bind the requested import proof")
  }
  return verifyProjectIndexGenesis({
    ...input,
    scope,
    projectIndexGenesisKind: "immediate-predecessor-import",
    migrationImportBaseProofDigest: parseDigest(input.migrationImportBaseProofDigest),
  }) as Promise<VerifiedImmediatePredecessorImportedProjectIndexGenesis>
}

async function verifyProjectIndexGenesis(input: {
  readonly scope: ProjectIndexDocumentScope
  readonly document: Y.Doc
  readonly checkpointExactBytes: Readonly<Uint8Array>
  readonly initializationAuthorityDigest: Digest
  readonly projectIndexGenesisKind: ProjectNativeStoreManifest["projectIndexGenesisKind"]
  readonly migrationImportBaseProofDigest: Digest | null
  readonly verifier: ProjectIndexGenesisCheckpointVerifier
}): Promise<VerifiedProjectIndexGenesis> {
  const scope = input.scope
  const snapshot = validateProjectIndexYDoc(input.document, scope)
  if (snapshot.identity.migrationImportBaseProofDigest !== input.migrationImportBaseProofDigest) {
    throw new TypeError("ProjectIndex genesis manifest proof differs from signed owner state")
  }
  const checkpoint = decodeExactCheckpoint(input.checkpointExactBytes)
  const fullUpdate = encodeFullUpdate(input.document)
  const stateVector = encodeStateVector(input.document)
  const canonicalStateDigest = projectIndexCanonicalStateCommitmentDigest(
    input.document,
    installCurrentProtocolAuthority(),
  )
  const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
  const frontierDigest = causalFrontierDigest(frontier)
  const actorHeads = Object.freeze({
    format: "convax.replica-actor-head-set" as const,
    scope,
    heads: Object.freeze([]),
  })
  const canonicalizerDigest = ownerCanonicalizerDescriptorDigest(
    projectIndexOwnerCanonicalizerDescriptor(snapshot.identity.schemaDigest),
  )
  const core = checkpoint.core
  if (
    !sameScope(core.scope, scope) ||
    core.directParentCheckpointDigests.length !== 0 ||
    core.baseFrontierDigest !== frontierDigest ||
    core.computedFrontierDigest !== frontierDigest ||
    core.actorHeadBoundaryDigest !== replicaActorHeadSetDigest(actorHeads) ||
    core.stateVectorDigest !== stateVectorDigest(stateVector) ||
    core.fullUpdateDigest !== yjsUpdateDigest(fullUpdate) ||
    core.fullUpdateByteLength !== String(fullUpdate.byteLength) ||
    core.canonicalStateDigest !== canonicalStateDigest ||
    core.protocolDigest !== snapshot.identity.protocolDigest ||
    core.schemaDigest !== snapshot.identity.schemaDigest ||
    core.canonicalizerDigest !== canonicalizerDigest
  ) {
    throw new TypeError("ProjectIndex genesis checkpoint does not bind the exact current candidate")
  }
  if (!(await input.verifier.verify(checkpoint)))
    throw new TypeError("ProjectIndex genesis checkpoint authority is rejected")
  const checkpointObjectDigest = replicaCheckpointObjectDigest(checkpoint)
  const materializationDigest = acceptedHeadMaterializedStateDigest({
    scope,
    headDigest: checkpointObjectDigest,
    frontier,
    frontierDigest,
    actorHeads,
    fullUpdate,
    stateVector,
    canonicalStateDigest,
    // The base digest is computed from the exact materialized state and does not
    // consume this field; bind a valid digest so the complete view stays typed.
    materializationDigest: checkpointObjectDigest,
  })
  const manifest = parseProjectNativeStoreManifest({
    format: "convax.project-native-store-manifest",
    storeIdentity: STORE_IDENTITY,
    projectIndexScope: scope,
    protocolDigest: snapshot.identity.protocolDigest,
    schemaDigest: snapshot.identity.schemaDigest,
    uriProtocolDigest: snapshot.identity.uriProtocolDigest,
    initializationAuthorityDigest: parseDigest(input.initializationAuthorityDigest),
    projectIndexGenesisKind: input.projectIndexGenesisKind,
    migrationImportBaseProofDigest: input.migrationImportBaseProofDigest,
    projectIndexGenesisCheckpointObjectDigest: checkpointObjectDigest,
    projectIndexGenesisFullUpdateDigest: yjsUpdateDigest(fullUpdate),
    projectIndexGenesisStateVectorDigest: stateVectorDigest(stateVector),
    projectIndexGenesisCanonicalStateDigest: canonicalStateDigest,
  })
  return Object.freeze({
    manifest,
    manifestLocalRecordDigest: projectNativeStoreManifestLocalRecordDigest(manifest),
    checkpointExactBytes: Uint8Array.from(input.checkpointExactBytes),
    acceptedBase: Object.freeze({
      scope,
      frontier,
      frontierDigest,
      actorHeads,
      fullUpdate,
      stateVector,
      canonicalStateDigest,
      materializationDigest,
    }),
  })
}

/**
 * Initializes a new Project through a same-filesystem sibling stage. The final
 * collaboration directory is therefore either absent or a complete reopenable store.
 */
export async function initializeUnteamedProjectIndexNativeStore(input: {
  readonly collaborationDirectory: string
  readonly localActorId: ActorId
  readonly materializer: NodeReplicaHeadMaterializer
  readonly genesis: VerifiedProjectIndexGenesis
  readonly persistenceHooks?: NodeCollaborationPersistenceFaultHooks
  readonly faults?: ProjectIndexNativeStoreInitializationFaults
}): Promise<NodeAcceptedReplicaHead> {
  if (!path.isAbsolute(input.collaborationDirectory)) throw new TypeError("Collaboration directory must be absolute")
  const target = path.resolve(input.collaborationDirectory)
  if (target !== input.collaborationDirectory) throw new TypeError("Collaboration directory must be canonical")
  const parent = path.dirname(target)
  await requirePlainDirectory(parent, "Project private directory")
  const expectedManifestBytes = encodeProjectNativeStoreManifest(input.genesis.manifest)
  const existing = await lstatOrNull(target)
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new TypeError("Collaboration store is not a plain directory")
    return verifyCompleteStore(target, expectedManifestBytes, input)
  }

  const staging = `${target}.staging`
  const staged = await lstatOrNull(staging)
  if (!staged) {
    await fs.mkdir(staging, { mode: 0o700 })
    await fsyncProjectDirectory(parent)
    await writeNewManifest(path.join(staging, "manifest-v2.bin"), expectedManifestBytes)
    await input.faults?.afterManifestFsync?.()
  } else if (!staged.isDirectory() || staged.isSymbolicLink()) {
    throw new TypeError("Project collaboration staging is not a plain directory")
  } else {
    await requireExactManifest(staging, expectedManifestBytes)
  }

  const head = await initializeOrVerifyStagedStore(staging, input)
  await input.faults?.afterGenesisFsync?.()
  await fsyncProjectDirectory(staging)
  await input.faults?.beforePublishRename?.()
  try {
    await fs.rename(staging, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" || (error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
      return verifyCompleteStore(target, expectedManifestBytes, input)
    }
    throw error
  }
  await fsyncProjectDirectory(parent)
  return head
}

/**
 * Initializes an imported ProjectIndex inside the cutover-owned empty stage.
 * Ordinary Project creation cannot call this path with an empty genesis, and
 * this function never publishes or renames the stage itself.
 */
export async function initializeImmediatePredecessorImportedProjectIndexNativeStoreInPlace(input: {
  readonly collaborationDirectory: string
  readonly localActorId: ActorId
  readonly materializer: NodeReplicaHeadMaterializer
  readonly genesis: VerifiedImmediatePredecessorImportedProjectIndexGenesis
  readonly persistenceHooks?: NodeCollaborationPersistenceFaultHooks
  readonly faults?: Pick<ProjectIndexNativeStoreInitializationFaults, "afterManifestFsync" | "afterGenesisFsync">
}): Promise<NodeAcceptedReplicaHead> {
  if (!path.isAbsolute(input.collaborationDirectory)) throw new TypeError("Collaboration directory must be absolute")
  const target = path.resolve(input.collaborationDirectory)
  if (target !== input.collaborationDirectory) throw new TypeError("Collaboration directory must be canonical")
  if (
    input.genesis.manifest.projectIndexGenesisKind !== "immediate-predecessor-import" ||
    input.genesis.manifest.migrationImportBaseProofDigest === null
  ) throw new TypeError("Migration stage requires an immediate-predecessor imported ProjectIndex genesis")
  await requirePlainDirectory(path.dirname(target), "Project private directory")
  await requirePlainDirectory(target, "Project collaboration migration stage")
  const expectedManifestBytes = encodeProjectNativeStoreManifest(input.genesis.manifest)
  const entries = await fs.readdir(target)
  if (entries.length === 0) {
    await writeNewManifest(path.join(target, "manifest-v2.bin"), expectedManifestBytes)
    await input.faults?.afterManifestFsync?.()
  } else {
    await requireExactManifest(target, expectedManifestBytes)
  }
  const head = await initializeOrVerifyStagedStore(target, input)
  await input.faults?.afterGenesisFsync?.()
  await fsyncProjectDirectory(target)
  return head
}

/**
 * Recognizes only the exact empty local-owner genesis emitted by
 * initializeUnteamedProjectIndexNativeStore. This is a narrow recovery probe for
 * a Project whose bootstrap was published before the resolver guard ran; it is
 * not a general current-Project reset or epoch-rollover authority.
 */
export async function verifyPristineUnteamedProjectIndexNativeStore(input: {
  readonly collaborationDirectory: string
  readonly localActorId: ActorId
  readonly materializer: NodeReplicaHeadMaterializer
  readonly manifest: ProjectNativeStoreManifest
  readonly verifier: ProjectIndexGenesisCheckpointVerifier
}): Promise<void> {
  if (
    !path.isAbsolute(input.collaborationDirectory) ||
    path.resolve(input.collaborationDirectory) !== input.collaborationDirectory
  ) {
    throw new TypeError("Collaboration directory must be canonical and absolute")
  }
  const manifest = parseProjectNativeStoreManifest(input.manifest)
  if (manifest.projectIndexGenesisKind !== "empty" || manifest.migrationImportBaseProofDigest !== null) {
    throw new TypeError("Pristine ProjectIndex probe requires an empty genesis")
  }
  await requireExactManifest(input.collaborationDirectory, encodeProjectNativeStoreManifest(manifest))
  const store = await NodeCollaborationPersistence.openReadOnly({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: input.localActorId,
    materializer: input.materializer,
  })
  let installed: NodeAcceptedReplicaHead
  try {
    installed = await store.loadInstalledBase(manifest.projectIndexScope)
  } finally {
    store.dispose()
  }
  const document = createProjectIndexReconstructionYDoc()
  try {
    applyYjsUpdate(
      document,
      installed.fullUpdate,
      Object.freeze({
        format: "convax.pristine-project-index-bootstrap-inspection",
      }),
    )
    const documentKey = deriveDocumentNativeKey(manifest.projectIndexScope)
    const checkpointKey = deriveObjectNativeKey("checkpoint", manifest.projectIndexGenesisCheckpointObjectDigest)
    const checkpointExactBytes = await readPlainBoundedFile(
      path.join(
        input.collaborationDirectory,
        "documents",
        documentKey,
        "objects",
        "checkpoints",
        `${checkpointKey}.bin`,
      ),
    )
    const verified = await verifyEmptyProjectIndexGenesis({
      scope: manifest.projectIndexScope,
      document,
      checkpointExactBytes,
      initializationAuthorityDigest: manifest.initializationAuthorityDigest,
      verifier: input.verifier,
    })
    if (
      !sameBytes(encodeProjectNativeStoreManifest(verified.manifest), encodeProjectNativeStoreManifest(manifest))
    ) {
      throw new TypeError("Installed ProjectIndex bootstrap differs from its empty genesis manifest")
    }
  } finally {
    document.destroy()
  }
  await requirePristineBootstrapInventory(input.collaborationDirectory, manifest)
}

export async function resolveCurrentProjectIndexScope(
  collaborationDirectory: string,
  authority: ProjectNativeStoreAuthority,
): Promise<ProjectIndexDocumentScope> {
  const manifest = await readProjectNativeStoreManifest(collaborationDirectory, authority)
  return manifest.projectIndexScope
}

export async function readProjectNativeStoreManifest(
  collaborationDirectory: string,
  authority: ProjectNativeStoreAuthority,
): Promise<ProjectNativeStoreManifest> {
  if (!path.isAbsolute(collaborationDirectory) || path.resolve(collaborationDirectory) !== collaborationDirectory) {
    throw new TypeError("Collaboration directory must be canonical and absolute")
  }
  await requirePlainDirectory(collaborationDirectory, "Collaboration store")
  const bytes = await readPlainBoundedFile(path.join(collaborationDirectory, "manifest-v2.bin"))
  const manifest = decodeProjectNativeStoreManifest(bytes)
  if (
    manifest.protocolDigest !== parseDigest(authority.protocolDigest) ||
    manifest.schemaDigest !== parseDigest(authority.schemaDigest) ||
    manifest.uriProtocolDigest !== parseDigest(authority.uriProtocolDigest)
  ) {
    throw new TypeError("Project native manifest authority is not current")
  }
  return manifest
}

export async function readImmediatePredecessorProjectNativeStoreManifest(
  collaborationDirectory: string,
): Promise<ImmediatePredecessorProjectNativeStoreManifest> {
  if (!path.isAbsolute(collaborationDirectory) || path.resolve(collaborationDirectory) !== collaborationDirectory) {
    throw new TypeError("Collaboration directory must be canonical and absolute")
  }
  await requirePlainDirectory(collaborationDirectory, "Collaboration store")
  return decodeImmediatePredecessorProjectNativeStoreManifest(
    await readPlainBoundedFile(path.join(collaborationDirectory, "manifest-v2.bin")),
  )
}

export async function describeProjectIndexInstalledBase(input: {
  readonly persistence: Pick<NodeCollaborationPersistence, "loadInstalledBase">
  readonly scope: DocumentScope
}): Promise<NodeAcceptedReplicaHead> {
  const scope = requireProjectIndexScope(input.scope)
  const installed = await input.persistence.loadInstalledBase(scope)
  if (!sameScope(installed.scope, scope)) throw new TypeError("Installed ProjectIndex base crossed scope")
  return installed
}

function parseProjectNativeStoreManifest(
  value: unknown,
  expectedSchemaDigest: Digest = PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
): ProjectNativeStoreManifest {
  const keys = [
    "format",
    "storeIdentity",
    "projectIndexScope",
    "protocolDigest",
    "schemaDigest",
    "uriProtocolDigest",
    "initializationAuthorityDigest",
    "projectIndexGenesisKind",
    "migrationImportBaseProofDigest",
    "projectIndexGenesisCheckpointObjectDigest",
    "projectIndexGenesisFullUpdateDigest",
    "projectIndexGenesisStateVectorDigest",
    "projectIndexGenesisCanonicalStateDigest",
  ] as const
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, keys) ||
    value.format !== "convax.project-native-store-manifest" ||
    value.storeIdentity !== STORE_IDENTITY
  ) {
    throw new TypeError("Project native manifest schema is invalid")
  }
  const scope = requireProjectIndexScope(value.projectIndexScope)
  const schemaDigest = parseDigest(value.schemaDigest)
  if (schemaDigest !== parseDigest(expectedSchemaDigest)) {
    throw new TypeError("Project native manifest schema is unsupported")
  }
  const projectIndexGenesisKind = parseProjectIndexGenesisKind(value.projectIndexGenesisKind)
  const migrationImportBaseProofDigest = value.migrationImportBaseProofDigest === null
    ? null
    : parseDigest(value.migrationImportBaseProofDigest)
  if (
    (projectIndexGenesisKind === "empty" && migrationImportBaseProofDigest !== null) ||
    (projectIndexGenesisKind === "immediate-predecessor-import" && migrationImportBaseProofDigest === null)
  ) throw new TypeError("Project native manifest genesis kind and migration proof disagree")
  return Object.freeze({
    format: value.format,
    storeIdentity: value.storeIdentity,
    projectIndexScope: scope,
    protocolDigest: parseDigest(value.protocolDigest),
    schemaDigest,
    uriProtocolDigest: parseDigest(value.uriProtocolDigest),
    initializationAuthorityDigest: parseDigest(value.initializationAuthorityDigest),
    projectIndexGenesisKind,
    migrationImportBaseProofDigest,
    projectIndexGenesisCheckpointObjectDigest: parseDigest(value.projectIndexGenesisCheckpointObjectDigest),
    projectIndexGenesisFullUpdateDigest: parseDigest(value.projectIndexGenesisFullUpdateDigest),
    projectIndexGenesisStateVectorDigest: parseDigest(value.projectIndexGenesisStateVectorDigest),
    projectIndexGenesisCanonicalStateDigest: parseDigest(value.projectIndexGenesisCanonicalStateDigest),
  })
}

function parseImmediatePredecessorProjectNativeStoreManifest(
  value: unknown,
): ImmediatePredecessorProjectNativeStoreManifest {
  const keys = [
    "format", "storeIdentity", "projectIndexScope", "protocolDigest", "schemaDigest",
    "uriProtocolDigest", "initializationAuthorityDigest",
    "emptyProjectIndexCheckpointObjectDigest", "emptyProjectIndexFullUpdateDigest",
    "emptyProjectIndexStateVectorDigest", "emptyProjectIndexCanonicalStateDigest",
  ] as const
  if (
    !isPlainObject(value) || !hasExactKeys(value, keys) ||
    value.format !== "convax.project-native-store-manifest" || value.storeIdentity !== STORE_IDENTITY
  ) throw new TypeError("Immediate-predecessor Project native manifest schema is invalid")
  const schemaDigest = parseDigest(value.schemaDigest)
  if (schemaDigest !== IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest) {
    throw new TypeError("Immediate-predecessor Project native manifest schema is unsupported")
  }
  return Object.freeze({
    format: value.format,
    storeIdentity: value.storeIdentity,
    projectIndexScope: requireProjectIndexScope(value.projectIndexScope),
    protocolDigest: parseDigest(value.protocolDigest),
    schemaDigest,
    uriProtocolDigest: parseDigest(value.uriProtocolDigest),
    initializationAuthorityDigest: parseDigest(value.initializationAuthorityDigest),
    emptyProjectIndexCheckpointObjectDigest: parseDigest(value.emptyProjectIndexCheckpointObjectDigest),
    emptyProjectIndexFullUpdateDigest: parseDigest(value.emptyProjectIndexFullUpdateDigest),
    emptyProjectIndexStateVectorDigest: parseDigest(value.emptyProjectIndexStateVectorDigest),
    emptyProjectIndexCanonicalStateDigest: parseDigest(value.emptyProjectIndexCanonicalStateDigest),
  })
}

function parseProjectIndexGenesisKind(
  value: unknown,
): ProjectNativeStoreManifest["projectIndexGenesisKind"] {
  if (value !== "empty" && value !== "immediate-predecessor-import") {
    throw new TypeError("Project native manifest genesis kind is invalid")
  }
  return value
}

function requireProjectIndexScope(value: unknown): ProjectIndexDocumentScope {
  const scope = parseDocumentScope(value)
  if (scope.docKind !== "project-index" || scope.docId !== "project-index") {
    throw new TypeError("ProjectIndex scope is invalid")
  }
  return scope as ProjectIndexDocumentScope
}

function decodeExactCheckpoint(exactBytes: Readonly<Uint8Array>): ReplicaCheckpoint {
  if (!(exactBytes instanceof Uint8Array)) throw new TypeError("ProjectIndex checkpoint must be bytes")
  const checkpoint = parseReplicaCheckpoint(decodeRestrictedJcs(exactBytes))
  if (!sameBytes(exactBytes, encodeRestrictedJcs(checkpoint))) {
    throw new TypeError("ProjectIndex checkpoint bytes are not exact restricted JCS")
  }
  return checkpoint
}

async function initializeOrVerifyStagedStore(
  staging: string,
  input: Parameters<typeof initializeUnteamedProjectIndexNativeStore>[0],
): Promise<NodeAcceptedReplicaHead> {
  const store = await NodeCollaborationPersistence.open({
    collaborationDirectory: staging,
    localActorId: input.localActorId,
    materializer: input.materializer,
    ...(input.persistenceHooks ? { hooks: input.persistenceHooks } : {}),
  })
  try {
    try {
      const installed = await store.loadInstalledBase(input.genesis.manifest.projectIndexScope)
      assertInstalledMatchesGenesis(installed, input.genesis)
      return installed
    } catch (error) {
      if (!(error instanceof NodeCollaborationPersistenceError) || error.code !== "document-not-found") throw error
    }
    return await store.initializeShard({
      scope: input.genesis.manifest.projectIndexScope,
      checkpointObjectDigest: input.genesis.manifest.projectIndexGenesisCheckpointObjectDigest,
      checkpointExactBytes: input.genesis.checkpointExactBytes,
      acceptedBase: input.genesis.acceptedBase,
    })
  } finally {
    store.dispose()
  }
}

async function verifyCompleteStore(
  directory: string,
  expectedManifestBytes: Uint8Array,
  input: Parameters<typeof initializeUnteamedProjectIndexNativeStore>[0],
): Promise<NodeAcceptedReplicaHead> {
  await requireExactManifest(directory, expectedManifestBytes)
  const store = await NodeCollaborationPersistence.open({
    collaborationDirectory: directory,
    localActorId: input.localActorId,
    materializer: input.materializer,
  })
  try {
    const installed = await store.loadInstalledBase(input.genesis.manifest.projectIndexScope)
    assertInstalledMatchesGenesis(installed, input.genesis)
    return installed
  } finally {
    store.dispose()
  }
}

async function requirePristineBootstrapInventory(
  collaborationDirectory: string,
  manifest: ProjectNativeStoreManifest,
): Promise<void> {
  const scope = manifest.projectIndexScope
  const documentKey = deriveDocumentNativeKey(scope)
  const documentRoot = `documents/${documentKey}`
  const allowedDirectories = new Set([
    "documents",
    documentRoot,
    `${documentRoot}/objects`,
    `${documentRoot}/objects/frames`,
    `${documentRoot}/objects/acks`,
    `${documentRoot}/objects/checkpoints`,
    `${documentRoot}/objects/certificates`,
    `${documentRoot}/objects/genesis-proofs`,
    `${documentRoot}/floors`,
    `${documentRoot}/snapshots`,
    `${documentRoot}/snapshots/sets`,
    `${documentRoot}/journals`,
    `${documentRoot}/journals/bases`,
    `${documentRoot}/journals/segments`,
    `${documentRoot}/heads`,
    `${documentRoot}/outbox`,
    `${documentRoot}/outbox/frames`,
    `${documentRoot}/inbox`,
    `${documentRoot}/inbox/pending-frames`,
    `${documentRoot}/recovery`,
    `${documentRoot}/recovery/operations`,
    `${documentRoot}/quarantine`,
    `${documentRoot}/prune`,
    `${documentRoot}/prune/plans`,
    `${documentRoot}/prune/trash`,
    "blob-replication",
    "blob-replication/acks",
    "blob-replication/cache",
    "blob-replication/cache/sha256",
    "blob-replication/transfers",
  ])
  const exactFiles = new Set([
    "manifest-v2.bin",
    `${documentRoot}/heads/durable-head.bin`,
    `${documentRoot}/journals/accepted-frames.wal`,
  ])
  const singletonFamilies = new Map<string, RegExp>([
    ["checkpoint", new RegExp(`^${escapeRegExp(documentRoot)}/objects/checkpoints/[0-9a-f]{64}\\.bin$`, "u")],
    ["checkpoint-set", new RegExp(`^${escapeRegExp(documentRoot)}/snapshots/sets/[0-9a-f]{64}\\.bin$`, "u")],
    ["journal-base", new RegExp(`^${escapeRegExp(documentRoot)}/journals/bases/[0-9a-f]{64}\\.bin$`, "u")],
  ])
  const counts = new Map([...singletonFamilies.keys()].map((key) => [key, 0]))
  let presenceIndexCount = 0
  let resetRecordCount = 0

  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(collaborationDirectory, absolute).split(path.sep).join("/")
      if (entry.isSymbolicLink()) throw new TypeError("Pristine ProjectIndex bootstrap contains a symbolic link")
      if (entry.isDirectory()) {
        if (!allowedDirectories.has(relative)) {
          throw new TypeError(`Pristine ProjectIndex bootstrap contains an unexpected directory: ${relative}`)
        }
        await visit(absolute)
        continue
      }
      if (!entry.isFile()) throw new TypeError(`Pristine ProjectIndex bootstrap contains a non-file: ${relative}`)
      if (exactFiles.has(relative)) continue
      if (relative === "blob-replication/presence-index-v2.bin") {
        presenceIndexCount += 1
        continue
      }
      if (relative === "project-reset-records-v2.jcs") {
        resetRecordCount += 1
        continue
      }
      const family = [...singletonFamilies].find(([, pattern]) => pattern.test(relative))?.[0]
      if (!family) throw new TypeError(`Pristine ProjectIndex bootstrap contains unexpected state: ${relative}`)
      counts.set(family, (counts.get(family) ?? 0) + 1)
    }
  }
  await visit(collaborationDirectory)
  if ([...counts.values()].some((count) => count !== 1) || presenceIndexCount > 1 || resetRecordCount > 1) {
    throw new TypeError("Pristine ProjectIndex bootstrap inventory is incomplete or ambiguous")
  }
  if (resetRecordCount === 1) await requireMatchingLocalResetPublication(collaborationDirectory, manifest)
}

async function requireMatchingLocalResetPublication(
  collaborationDirectory: string,
  manifest: ProjectNativeStoreManifest,
): Promise<void> {
  const records = await readProjectResetRecords(collaborationDirectory)
  const reset = records.manifest
  const principal = records.confirmation.core.confirmationPrincipal
  if (
    reset.projectId !== manifest.projectIndexScope.projectId ||
    reset.oldProjectEpoch !== null ||
    reset.newProjectEpoch !== manifest.projectIndexScope.projectEpoch ||
    reset.newMembershipEpoch !== null ||
    reset.newProjectIndexShardEpoch !== manifest.projectIndexScope.shardEpoch ||
    reset.requestedProtocolDigest !== manifest.protocolDigest ||
    reset.requestedSchemaDigest !== manifest.schemaDigest ||
    reset.requestedUriProtocolDigest !== manifest.uriProtocolDigest ||
    reset.projectResetApprovalCoreDigest !== null ||
    reset.teamEpochRolloverRequestDigest !== null ||
    reset.emptyProjectIndexGenesisAttestationCoreDigest !== null ||
    reset.teamEpochRolloverReceiptCoreDigest !== null ||
    (reset.state !== "reset-published" && reset.state !== "reset-retiring-old" && reset.state !== "reset-complete") ||
    principal.kind !== "local-project-owner" ||
    principal.localProjectBindingDigest !== manifest.initializationAuthorityDigest
  ) {
    throw new TypeError("Project reset record does not bind the exact unteamed empty bootstrap")
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function assertInstalledMatchesGenesis(
  installed: NodeAcceptedReplicaHead,
  genesis: VerifiedProjectIndexGenesis,
): void {
  const expected = genesis.acceptedBase
  if (
    !sameScope(installed.scope, expected.scope) ||
    installed.frontierDigest !== expected.frontierDigest ||
    installed.canonicalStateDigest !== expected.canonicalStateDigest ||
    !sameBytes(installed.fullUpdate, expected.fullUpdate) ||
    !sameBytes(installed.stateVector, expected.stateVector)
  ) {
    throw new TypeError("Installed ProjectIndex base differs from the manifest-bound genesis")
  }
}

async function requireExactManifest(directory: string, expected: Uint8Array): Promise<void> {
  const actual = await readPlainBoundedFile(path.join(directory, "manifest-v2.bin"))
  decodeProjectNativeStoreManifest(actual)
  if (!sameBytes(actual, expected)) throw new TypeError("Project native manifest initialization equivocation")
}

async function writeNewManifest(target: string, bytes: Uint8Array): Promise<void> {
  const handle = await fs.open(target, "wx", 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fsyncProjectDirectory(path.dirname(target))
}

async function readPlainBoundedFile(target: string): Promise<Uint8Array> {
  const stat = await fs.lstat(target)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MANIFEST_HEADER_BYTES + MAX_MANIFEST_PAYLOAD_BYTES + MANIFEST_CHECKSUM_BYTES
  ) {
    throw new TypeError("Project native manifest is not a bounded plain file")
  }
  return Uint8Array.from(await fs.readFile(target))
}

async function requirePlainDirectory(target: string, label: string): Promise<void> {
  const stat = await fs.lstat(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError(`${label} is not a plain directory`)
}

async function lstatOrNull(target: string) {
  return fs.lstat(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  })
}

function sameScope(left: DocumentScope, right: DocumentScope): boolean {
  return (
    left.projectId === right.projectId &&
    left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind &&
    left.docId === right.docId &&
    left.shardEpoch === right.shardEpoch
  )
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false
  return true
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}
