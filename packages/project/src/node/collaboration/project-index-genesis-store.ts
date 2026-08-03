import { createHash, timingSafeEqual } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  canonicalStateDigestV2,
  causalFrontierDigestV2,
  decodeRestrictedJcsV2,
  encodeFullUpdateV2,
  encodeRestrictedJcsV2,
  encodeStateVectorV2,
  ownerCanonicalizerDescriptorDigestV2,
  parseActorIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseMemberIdV2,
  parseReplicaIdV2,
  parseReplicaCheckpointV2,
  parseUint32V2,
  parseUint64V2,
  replicaActorHeadSetDigestV2,
  replicaCheckpointObjectDigestV2,
  replicaCheckpointCoreDigestV2,
  stateVectorDigestV2,
  structuredDigestV2,
  yjsUpdateDigestV2,
  type ActorIdV2,
  type DigestV2,
  type DocumentScopeV2,
  type Id128V2,
  type MemberIdV2,
  type ReplicaCheckpointCoreV2,
  type ReplicaCheckpointV2,
  type ReplicaIdV2,
} from "@convax/collaboration"
import type * as Y from "yjs"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2,
  createProjectIndexYDocV2,
  encodeProjectCanonicalStateV2,
  projectIndexOwnerCanonicalizerDescriptorV2,
  validateProjectIndexYDocV2,
  type ProjectEntryRecordV2,
} from "../../collaboration/project-index"
import {
  NodeCollaborationPersistenceErrorV2,
  NodeCollaborationPersistenceV2,
  type NodeAcceptedReplicaHeadV2,
  type NodeCollaborationPersistenceFaultHooksV2,
  type NodeReplicaHeadMaterializerV2,
} from "./persistence-store"

const MANIFEST_MAGIC = Buffer.from("CVXPMV02", "ascii")
const MANIFEST_HEADER_BYTES = 12
const MANIFEST_CHECKSUM_BYTES = 32
const MAX_MANIFEST_PAYLOAD_BYTES = 64 * 1024
const LOCAL_RECORD_DOMAIN = Buffer.from("convax.local-project-store-record-digest/2\0", "utf8")
const STORE_IDENTITY = "convax.project-collaboration-native-store/2" as const
type ProjectIndexDocumentScopeV2 = DocumentScopeV2 & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

export interface ProjectNativeStoreManifestV2 {
  readonly format: "convax.project-native-store-manifest/2"
  readonly storeIdentity: typeof STORE_IDENTITY
  readonly projectIndexScope: ProjectIndexDocumentScopeV2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
  readonly initializationAuthorityDigest: DigestV2
  readonly emptyProjectIndexCheckpointObjectDigest: DigestV2
  readonly emptyProjectIndexFullUpdateDigest: DigestV2
  readonly emptyProjectIndexStateVectorDigest: DigestV2
  readonly emptyProjectIndexCanonicalStateDigest: DigestV2
}

export interface ProjectNativeStoreAuthorityV2 {
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
}

export interface VerifiedEmptyProjectIndexGenesisV2 {
  readonly manifest: ProjectNativeStoreManifestV2
  readonly manifestLocalRecordDigest: DigestV2
  readonly checkpointExactBytes: Uint8Array
  readonly acceptedBase: Omit<NodeAcceptedReplicaHeadV2, "headDigest">
}

export interface ProjectIndexGenesisCheckpointVerifierV2 {
  verify(checkpoint: ReplicaCheckpointV2): Promise<boolean>
}

export interface ProjectIndexNativeStoreInitializationFaultsV2 {
  afterManifestFsync?(): Promise<void>
  afterGenesisFsync?(): Promise<void>
  beforePublishRename?(): Promise<void>
}

/**
 * Project-owned constructor for the only legal empty ProjectIndex base. Desktop
 * supplies already-durable principal identities and signs the returned core; it
 * never assembles Project schema bytes itself.
 */
export function createEmptyProjectIndexGenesisCandidateV2(input: {
  readonly scope: DocumentScopeV2
  readonly actorId: ActorIdV2
  readonly operationId: Id128V2
  readonly checkpointId: Id128V2
  readonly authorMemberId: MemberIdV2
  readonly authorReplicaId: ReplicaIdV2
  readonly authorAuthorizationDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly authority: ProjectNativeStoreAuthorityV2
}): Readonly<{ document: Y.Doc; checkpointCore: ReplicaCheckpointCoreV2 }> {
  const scope = requireProjectIndexScope(input.scope)
  const actorId = parseActorIdV2(input.actorId)
  const operationId = parseId128V2(input.operationId)
  const rootDirectoryId = `pd_${structuredDigestV2("convax.project-derived-identity/2", {
    format: "convax.project-derived-identity-core/2",
    scope,
    actorId,
    operationId,
    ordinal: parseUint32V2("0"),
    kind: "directory",
  })}` as const
  const rootEntry: ProjectEntryRecordV2 = Object.freeze({
    format: "convax.project-entry/2",
    entryId: rootDirectoryId,
    kind: "directory",
    storageClass: null,
    contentPolicy: "none",
    provenance: "project-root",
    conflictSource: null,
    createdByActorId: actorId,
    createdByOperationId: operationId,
    createdStamp: Object.freeze({
      format: "convax.portable-stamp/2",
      lamport: parseUint64V2("0"),
      actorId,
      operationId,
      writeOrdinal: parseUint32V2("0"),
    }),
  })
  const document = createProjectIndexYDocV2(Object.freeze({
    format: "convax.project-index-identity/2",
    schema: "convax.project-index.v2",
    projectId: scope.projectId,
    projectEpoch: scope.projectEpoch,
    shardEpoch: scope.shardEpoch,
    rootDirectoryId,
    protocolDigest: parseDigestV2(input.authority.protocolDigest),
    schemaDigest: parseDigestV2(input.authority.schemaDigest),
    uriProtocolDigest: parseDigestV2(input.authority.uriProtocolDigest),
  }), rootEntry)
  const fullUpdate = encodeFullUpdateV2(document)
  const stateVector = encodeStateVectorV2(document)
  const canonicalState = encodeProjectCanonicalStateV2(document)
  const frontier = Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) })
  const frontierDigest = causalFrontierDigestV2(frontier)
  const actorHeads = Object.freeze({
    format: "convax.replica-actor-head-set/2" as const,
    scope,
    heads: Object.freeze([]),
  })
  const checkpointCore: ReplicaCheckpointCoreV2 = Object.freeze({
    format: "convax.replica-checkpoint-core/2",
    scope,
    checkpointId: parseId128V2(input.checkpointId),
    authorMemberId: parseMemberIdV2(input.authorMemberId),
    authorReplicaId: parseReplicaIdV2(input.authorReplicaId),
    authorActorId: actorId,
    authorAuthorizationDigest: parseDigestV2(input.authorAuthorizationDigest),
    directParentCheckpointDigests: Object.freeze([]),
    baseFrontierDigest: frontierDigest,
    computedFrontierDigest: frontierDigest,
    actorHeadBoundaryDigest: replicaActorHeadSetDigestV2(actorHeads),
    stateVectorDigest: stateVectorDigestV2(stateVector),
    canonicalStateDigest: canonicalStateDigestV2(input.authority.schemaDigest, canonicalState),
    fullUpdateDigest: yjsUpdateDigestV2(fullUpdate),
    fullUpdateByteLength: parseUint64V2(String(fullUpdate.byteLength)),
    protocolDigest: parseDigestV2(input.authority.protocolDigest),
    schemaDigest: parseDigestV2(input.authority.schemaDigest),
    canonicalizerDigest: ownerCanonicalizerDescriptorDigestV2(
      projectIndexOwnerCanonicalizerDescriptorV2(input.authority.schemaDigest),
    ),
    validationArtifactSetDigest: parseDigestV2(input.validationArtifactSetDigest),
  })
  // Parse/digest once here so callers cannot receive a structurally plausible,
  // codec-invalid core and sign it as local-owner authority.
  replicaCheckpointCoreDigestV2(checkpointCore)
  return Object.freeze({ document, checkpointCore })
}

/** Host-private envelope: magic + uint32 JCS length + JCS + ordinary SHA-256 checksum. */
export function encodeProjectNativeStoreManifestV2(input: ProjectNativeStoreManifestV2): Uint8Array {
  const manifest = parseProjectNativeStoreManifestV2(input)
  const payload = encodeRestrictedJcsV2(manifest)
  if (payload.byteLength > MAX_MANIFEST_PAYLOAD_BYTES) throw new TypeError("Project native manifest is too large")
  const output = Buffer.alloc(MANIFEST_HEADER_BYTES + payload.byteLength + MANIFEST_CHECKSUM_BYTES)
  MANIFEST_MAGIC.copy(output, 0)
  output.writeUInt32BE(payload.byteLength, MANIFEST_MAGIC.byteLength)
  output.set(payload, MANIFEST_HEADER_BYTES)
  output.set(createHash("sha256").update(payload).digest(), MANIFEST_HEADER_BYTES + payload.byteLength)
  return Uint8Array.from(output)
}

export function decodeProjectNativeStoreManifestV2(exactBytes: Readonly<Uint8Array>): ProjectNativeStoreManifestV2 {
  if (!(exactBytes instanceof Uint8Array)) throw new TypeError("Project native manifest must be bytes")
  const bytes = Buffer.from(exactBytes)
  if (bytes.byteLength < MANIFEST_HEADER_BYTES + MANIFEST_CHECKSUM_BYTES ||
    !bytes.subarray(0, MANIFEST_MAGIC.byteLength).equals(MANIFEST_MAGIC)) {
    throw new TypeError("Project native manifest envelope is invalid")
  }
  const payloadLength = bytes.readUInt32BE(MANIFEST_MAGIC.byteLength)
  if (payloadLength < 1 || payloadLength > MAX_MANIFEST_PAYLOAD_BYTES ||
    bytes.byteLength !== MANIFEST_HEADER_BYTES + payloadLength + MANIFEST_CHECKSUM_BYTES) {
    throw new TypeError("Project native manifest length is invalid")
  }
  const payload = bytes.subarray(MANIFEST_HEADER_BYTES, MANIFEST_HEADER_BYTES + payloadLength)
  const checksum = bytes.subarray(MANIFEST_HEADER_BYTES + payloadLength)
  const computed = createHash("sha256").update(payload).digest()
  if (!timingSafeEqual(checksum, computed)) throw new TypeError("Project native manifest checksum mismatches")
  const manifest = parseProjectNativeStoreManifestV2(decodeRestrictedJcsV2(payload))
  if (!sameBytes(payload, encodeRestrictedJcsV2(manifest))) {
    throw new TypeError("Project native manifest JCS bytes are not canonical")
  }
  return manifest
}

export function projectNativeStoreManifestLocalRecordDigestV2(input: ProjectNativeStoreManifestV2): DigestV2 {
  const manifest = parseProjectNativeStoreManifestV2(input)
  return parseDigestV2(createHash("sha256")
    .update(LOCAL_RECORD_DOMAIN)
    .update(Buffer.from(manifest.format, "utf8"))
    .update(Buffer.from("\0", "utf8"))
    .update(encodeRestrictedJcsV2(manifest))
    .digest("hex"))
}

export async function verifyEmptyProjectIndexGenesisV2(input: {
  readonly scope: DocumentScopeV2
  readonly document: Y.Doc
  readonly checkpointExactBytes: Readonly<Uint8Array>
  readonly initializationAuthorityDigest: DigestV2
  readonly verifier: ProjectIndexGenesisCheckpointVerifierV2
}): Promise<VerifiedEmptyProjectIndexGenesisV2> {
  const scope = requireProjectIndexScope(input.scope)
  const snapshot = validateProjectIndexYDocV2(input.document, scope)
  if (snapshot.entries.size !== 1 || !snapshot.entries.has(snapshot.identity.rootDirectoryId) ||
    snapshot.entryLocations.size !== 0 || snapshot.entryTombstones.size !== 0 ||
    snapshot.contentFamilies.size !== 0 || snapshot.contentPromotions.size !== 0 ||
    snapshot.pathReservations.size !== 0 || snapshot.canvasRoutes.size !== 0 || snapshot.operations.size !== 0) {
    throw new TypeError("ProjectIndex genesis is not the exact empty catalog")
  }
  const checkpoint = decodeExactCheckpoint(input.checkpointExactBytes)
  const fullUpdate = encodeFullUpdateV2(input.document)
  const stateVector = encodeStateVectorV2(input.document)
  const canonicalState = encodeProjectCanonicalStateV2(input.document)
  const canonicalStateDigest = canonicalStateDigestV2(snapshot.identity.schemaDigest, canonicalState)
  const frontier = Object.freeze({ format: "convax.causal-frontier/2" as const, heads: Object.freeze([]) })
  const frontierDigest = causalFrontierDigestV2(frontier)
  const actorHeads = Object.freeze({
    format: "convax.replica-actor-head-set/2" as const,
    scope,
    heads: Object.freeze([]),
  })
  const canonicalizerDigest = ownerCanonicalizerDescriptorDigestV2(
    projectIndexOwnerCanonicalizerDescriptorV2(snapshot.identity.schemaDigest),
  )
  const core = checkpoint.core
  if (!sameScope(core.scope, scope) || core.directParentCheckpointDigests.length !== 0 ||
    core.baseFrontierDigest !== frontierDigest || core.computedFrontierDigest !== frontierDigest ||
    core.actorHeadBoundaryDigest !== replicaActorHeadSetDigestV2(actorHeads) ||
    core.stateVectorDigest !== stateVectorDigestV2(stateVector) ||
    core.fullUpdateDigest !== yjsUpdateDigestV2(fullUpdate) || core.fullUpdateByteLength !== String(fullUpdate.byteLength) ||
    core.canonicalStateDigest !== canonicalStateDigest || core.protocolDigest !== snapshot.identity.protocolDigest ||
    core.schemaDigest !== snapshot.identity.schemaDigest || core.canonicalizerDigest !== canonicalizerDigest) {
    throw new TypeError("ProjectIndex genesis checkpoint does not bind the exact empty candidate")
  }
  if (!(await input.verifier.verify(checkpoint))) throw new TypeError("ProjectIndex genesis checkpoint authority is rejected")
  const checkpointObjectDigest = replicaCheckpointObjectDigestV2(checkpoint)
  const manifest = parseProjectNativeStoreManifestV2({
    format: "convax.project-native-store-manifest/2",
    storeIdentity: STORE_IDENTITY,
    projectIndexScope: scope,
    protocolDigest: snapshot.identity.protocolDigest,
    schemaDigest: snapshot.identity.schemaDigest,
    uriProtocolDigest: snapshot.identity.uriProtocolDigest,
    initializationAuthorityDigest: parseDigestV2(input.initializationAuthorityDigest),
    emptyProjectIndexCheckpointObjectDigest: checkpointObjectDigest,
    emptyProjectIndexFullUpdateDigest: yjsUpdateDigestV2(fullUpdate),
    emptyProjectIndexStateVectorDigest: stateVectorDigestV2(stateVector),
    emptyProjectIndexCanonicalStateDigest: canonicalStateDigest,
  })
  return Object.freeze({
    manifest,
    manifestLocalRecordDigest: projectNativeStoreManifestLocalRecordDigestV2(manifest),
    checkpointExactBytes: Uint8Array.from(input.checkpointExactBytes),
    acceptedBase: Object.freeze({ scope, frontier, frontierDigest, actorHeads, fullUpdate, stateVector, canonicalStateDigest }),
  })
}

/**
 * Initializes a new Project through a same-filesystem sibling stage. The final
 * collaboration directory is therefore either absent or a complete reopenable store.
 */
export async function initializeUnteamedProjectIndexNativeStoreV2(input: {
  readonly collaborationDirectory: string
  readonly localActorId: ActorIdV2
  readonly materializer: NodeReplicaHeadMaterializerV2
  readonly genesis: VerifiedEmptyProjectIndexGenesisV2
  readonly persistenceHooks?: NodeCollaborationPersistenceFaultHooksV2
  readonly faults?: ProjectIndexNativeStoreInitializationFaultsV2
}): Promise<NodeAcceptedReplicaHeadV2> {
  if (!path.isAbsolute(input.collaborationDirectory)) throw new TypeError("Collaboration directory must be absolute")
  const target = path.resolve(input.collaborationDirectory)
  if (target !== input.collaborationDirectory) throw new TypeError("Collaboration directory must be canonical")
  const parent = path.dirname(target)
  await requirePlainDirectory(parent, "Project private directory")
  const expectedManifestBytes = encodeProjectNativeStoreManifestV2(input.genesis.manifest)
  const existing = await lstatOrNull(target)
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink()) throw new TypeError("Collaboration store is not a plain directory")
    return verifyCompleteStore(target, expectedManifestBytes, input)
  }

  const staging = `${target}.staging`
  const staged = await lstatOrNull(staging)
  if (!staged) {
    await fs.mkdir(staging, { mode: 0o700 })
    await fsyncDirectory(parent)
    await writeNewManifest(path.join(staging, "manifest-v2.bin"), expectedManifestBytes)
    await input.faults?.afterManifestFsync?.()
  } else if (!staged.isDirectory() || staged.isSymbolicLink()) {
    throw new TypeError("Project collaboration staging is not a plain directory")
  } else {
    await requireExactManifest(staging, expectedManifestBytes)
  }

  const head = await initializeOrVerifyStagedStore(staging, input)
  await input.faults?.afterGenesisFsync?.()
  await fsyncDirectory(staging)
  await input.faults?.beforePublishRename?.()
  try {
    await fs.rename(staging, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" || (error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
      return verifyCompleteStore(target, expectedManifestBytes, input)
    }
    throw error
  }
  await fsyncDirectory(parent)
  return head
}

export async function resolveCurrentProjectIndexScopeV2(
  collaborationDirectory: string,
  authority: ProjectNativeStoreAuthorityV2,
): Promise<ProjectIndexDocumentScopeV2> {
  const manifest = await readProjectNativeStoreManifestV2(collaborationDirectory, authority)
  return manifest.projectIndexScope
}

export async function readProjectNativeStoreManifestV2(
  collaborationDirectory: string,
  authority: ProjectNativeStoreAuthorityV2,
): Promise<ProjectNativeStoreManifestV2> {
  if (!path.isAbsolute(collaborationDirectory) || path.resolve(collaborationDirectory) !== collaborationDirectory) {
    throw new TypeError("Collaboration directory must be canonical and absolute")
  }
  await requirePlainDirectory(collaborationDirectory, "Collaboration store")
  const bytes = await readPlainBoundedFile(path.join(collaborationDirectory, "manifest-v2.bin"))
  const manifest = decodeProjectNativeStoreManifestV2(bytes)
  if (manifest.protocolDigest !== parseDigestV2(authority.protocolDigest) ||
    manifest.schemaDigest !== parseDigestV2(authority.schemaDigest) ||
    manifest.uriProtocolDigest !== parseDigestV2(authority.uriProtocolDigest)) {
    throw new TypeError("Project native manifest authority is not current")
  }
  return manifest
}

export async function describeProjectIndexInstalledBaseV2(input: {
  readonly persistence: Pick<NodeCollaborationPersistenceV2, "loadInstalledBase">
  readonly scope: DocumentScopeV2
}): Promise<NodeAcceptedReplicaHeadV2> {
  const scope = requireProjectIndexScope(input.scope)
  const installed = await input.persistence.loadInstalledBase(scope)
  if (!sameScope(installed.scope, scope)) throw new TypeError("Installed ProjectIndex base crossed scope")
  return installed
}

function parseProjectNativeStoreManifestV2(value: unknown): ProjectNativeStoreManifestV2 {
  const keys = [
    "format", "storeIdentity", "projectIndexScope", "protocolDigest", "schemaDigest", "uriProtocolDigest",
    "initializationAuthorityDigest", "emptyProjectIndexCheckpointObjectDigest",
    "emptyProjectIndexFullUpdateDigest", "emptyProjectIndexStateVectorDigest",
    "emptyProjectIndexCanonicalStateDigest",
  ] as const
  if (!isPlainObject(value) || !hasExactKeys(value, keys) ||
    value.format !== "convax.project-native-store-manifest/2" || value.storeIdentity !== STORE_IDENTITY) {
    throw new TypeError("Project native manifest schema is invalid")
  }
  const scope = requireProjectIndexScope(value.projectIndexScope)
  const schemaDigest = parseDigestV2(value.schemaDigest)
  if (schemaDigest !== PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST_V2) {
    throw new TypeError("Project native manifest schema is unsupported")
  }
  return Object.freeze({
    format: value.format,
    storeIdentity: value.storeIdentity,
    projectIndexScope: scope,
    protocolDigest: parseDigestV2(value.protocolDigest),
    schemaDigest,
    uriProtocolDigest: parseDigestV2(value.uriProtocolDigest),
    initializationAuthorityDigest: parseDigestV2(value.initializationAuthorityDigest),
    emptyProjectIndexCheckpointObjectDigest: parseDigestV2(value.emptyProjectIndexCheckpointObjectDigest),
    emptyProjectIndexFullUpdateDigest: parseDigestV2(value.emptyProjectIndexFullUpdateDigest),
    emptyProjectIndexStateVectorDigest: parseDigestV2(value.emptyProjectIndexStateVectorDigest),
    emptyProjectIndexCanonicalStateDigest: parseDigestV2(value.emptyProjectIndexCanonicalStateDigest),
  })
}

function requireProjectIndexScope(value: unknown): ProjectIndexDocumentScopeV2 {
  const scope = parseDocumentScopeV2(value)
  if (scope.docKind !== "project-index" || scope.docId !== "project-index") {
    throw new TypeError("ProjectIndex scope is invalid")
  }
  return scope as ProjectIndexDocumentScopeV2
}

function decodeExactCheckpoint(exactBytes: Readonly<Uint8Array>): ReplicaCheckpointV2 {
  if (!(exactBytes instanceof Uint8Array)) throw new TypeError("ProjectIndex checkpoint must be bytes")
  const checkpoint = parseReplicaCheckpointV2(decodeRestrictedJcsV2(exactBytes))
  if (!sameBytes(exactBytes, encodeRestrictedJcsV2(checkpoint))) {
    throw new TypeError("ProjectIndex checkpoint bytes are not exact restricted JCS")
  }
  return checkpoint
}

async function initializeOrVerifyStagedStore(
  staging: string,
  input: Parameters<typeof initializeUnteamedProjectIndexNativeStoreV2>[0],
): Promise<NodeAcceptedReplicaHeadV2> {
  const store = await NodeCollaborationPersistenceV2.open({
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
      if (!(error instanceof NodeCollaborationPersistenceErrorV2) || error.code !== "document-not-found") throw error
    }
    return await store.initializeShard({
      scope: input.genesis.manifest.projectIndexScope,
      checkpointObjectDigest: input.genesis.manifest.emptyProjectIndexCheckpointObjectDigest,
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
  input: Parameters<typeof initializeUnteamedProjectIndexNativeStoreV2>[0],
): Promise<NodeAcceptedReplicaHeadV2> {
  await requireExactManifest(directory, expectedManifestBytes)
  const store = await NodeCollaborationPersistenceV2.open({
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

function assertInstalledMatchesGenesis(
  installed: NodeAcceptedReplicaHeadV2,
  genesis: VerifiedEmptyProjectIndexGenesisV2,
): void {
  const expected = genesis.acceptedBase
  if (!sameScope(installed.scope, expected.scope) || installed.frontierDigest !== expected.frontierDigest ||
    installed.canonicalStateDigest !== expected.canonicalStateDigest ||
    !sameBytes(installed.fullUpdate, expected.fullUpdate) || !sameBytes(installed.stateVector, expected.stateVector)) {
    throw new TypeError("Installed ProjectIndex base differs from the manifest-bound genesis")
  }
}

async function requireExactManifest(directory: string, expected: Uint8Array): Promise<void> {
  const actual = await readPlainBoundedFile(path.join(directory, "manifest-v2.bin"))
  decodeProjectNativeStoreManifestV2(actual)
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
  await fsyncDirectory(path.dirname(target))
}

async function readPlainBoundedFile(target: string): Promise<Uint8Array> {
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 ||
    stat.size > MANIFEST_HEADER_BYTES + MAX_MANIFEST_PAYLOAD_BYTES + MANIFEST_CHECKSUM_BYTES) {
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

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, "r")
  try { await handle.sync() } finally { await handle.close() }
}

function sameScope(left: DocumentScopeV2, right: DocumentScopeV2): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.docKind === right.docKind && left.docId === right.docId && left.shardEpoch === right.shardEpoch
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
