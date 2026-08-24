import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  assertDenseArray,
  assertExactKeys,
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  ordinarySha256,
  parseActorId,
  parseCausalSignerAuthority,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseUint64,
  parseValidationArtifactSet,
  uint64ToBigInt,
  type ActorId,
  type CausalDependencyKind,
  type CausalDependencyRef,
  type TeamReplicaSignerAuthority,
  type Digest,
  type Id128,
  type ProjectId,
  type PublicKey,
  type ReplicaId,
  type Uint64,
  type ValidationArtifactSet,
} from "@convax/collaboration"

import type {
  DurableVerifiedLocalAuthorityCacheEntry,
  DurableVerifiedLocalAuthorityCache,
} from "./collaboration-production-runtime"
import type { ElectronReplicaSigningVault } from "./electron-replica-signing-vault"
import { syncDirectoryEntry } from "./filesystem-durability"

const RECORD_FORMAT = "convax.desktop-local-authority-cache-record/1" as const
const POINTER_FORMAT = "convax.desktop-local-authority-cache-pointer/1" as const
const PROJECT_BINDING_FORMAT = "convax.desktop-local-replica-project-binding/1" as const
const dependencyKinds = new Set<CausalDependencyKind>([
  "membership-snapshot", "replica-actor-credential", "replica-edit-authorization",
  "authorization-mutation", "cutoff-coverage-root", "checkpoint-content-certificate",
  "project-index-proof", "project-resource-proof", "plugin-validation-artifact",
  "generation-external-fact", "reset-authorization",
])

export interface LocalReplicaAuthorityCacheRecord {
  readonly format: typeof RECORD_FORMAT
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly actorId: ActorId
  readonly membershipSequence: Uint64
  readonly controlEvidenceDigest: Digest
  readonly protocolDigest: Digest
  readonly role: "editor"
  readonly editState: "active-editor"
  readonly replicaSigningPublicKey: PublicKey
  readonly signerAuthority: TeamReplicaSignerAuthority
  readonly dependencies: readonly CausalDependencyRef[]
  readonly validationArtifacts: ValidationArtifactSet
}

export interface LocalReplicaEnrollmentCandidate
  extends Omit<LocalReplicaAuthorityCacheRecord, "format" | "role" | "editState"> {
  readonly authorizationEvidence: unknown
}

declare const verifiedLocalReplicaEnrollmentBrand: unique symbol
export interface VerifiedLocalReplicaEnrollment {
  readonly record: LocalReplicaAuthorityCacheRecord
  readonly [verifiedLocalReplicaEnrollmentBrand]: true
}

const liveEnrollments = new WeakSet<object>()

export interface LocalReplicaEnrollmentVerifierFactory {
  verify(candidate: LocalReplicaEnrollmentCandidate): Promise<VerifiedLocalReplicaEnrollment | "rejected">
}

/** Converts current control/local-owner proof into a one-use process capability. */
export function createLocalReplicaEnrollmentVerifierFactory(input: {
  verifyCurrent(input: LocalReplicaEnrollmentCandidate): Promise<boolean>
}): LocalReplicaEnrollmentVerifierFactory {
  if (typeof input.verifyCurrent !== "function") throw new TypeError("Local replica enrollment verifier is required")
  return Object.freeze({
    async verify(candidate: LocalReplicaEnrollmentCandidate) {
      const { authorizationEvidence: _authorizationEvidence, ...candidateRecord } = candidate
      const record = parseRecord({
        ...candidateRecord,
        format: RECORD_FORMAT,
        role: "editor",
        editState: "active-editor",
      })
      if (!await input.verifyCurrent(Object.freeze({ ...record, authorizationEvidence: candidate.authorizationEvidence }))) {
        return "rejected"
      }
      const enrollment = Object.freeze({ record }) as VerifiedLocalReplicaEnrollment
      liveEnrollments.add(enrollment)
      return enrollment
    },
  })
}

export interface DurableLocalReplicaAuthorityCache extends DurableVerifiedLocalAuthorityCache {
  install(enrollment: VerifiedLocalReplicaEnrollment): Promise<void>
  resolveLocalProjectActor(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
  }): Promise<Readonly<{ actorId: ActorId; replicaId: ReplicaId }> | "pending" | "rejected">
}

/**
 * Desktop userData cache for already-verified long-lived edit authority. Records
 * are immutable; one atomic pointer selects the greatest verified membership
 * sequence. It contains no session credential, peer id, or private key.
 */
export class NodeDurableLocalReplicaAuthorityCache implements DurableLocalReplicaAuthorityCache {
  constructor(private readonly rootDirectory: string, private readonly protocolDigest: Digest) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Local authority cache root must be absolute")
    parseDigest(protocolDigest)
  }

  async install(enrollment: VerifiedLocalReplicaEnrollment): Promise<void> {
    if (!liveEnrollments.has(enrollment)) throw new TypeError("Local authority enrollment was not verified in this process")
    const record = parseRecord(enrollment.record)
    if (record.protocolDigest !== this.protocolDigest) throw new Error("Local authority enrollment uses another protocol")
    await ensureLayout(this.rootDirectory)
    const recordBytes = encodeRestrictedJcs(record)
    const recordDigest = ordinarySha256(recordBytes)
    const selector = selectorDigest(record)
    const current = await this.readPointer(selector)
    if (current) {
      const currentSequence = uint64ToBigInt(current.membershipSequence)
      const nextSequence = uint64ToBigInt(record.membershipSequence)
      if (nextSequence < currentSequence) throw new Error("Local authority cache rejected membership rollback")
      if (nextSequence === currentSequence) {
        if (current.recordDigest !== recordDigest || current.controlEvidenceDigest !== record.controlEvidenceDigest) {
          throw new Error("Local authority cache rejected same-sequence equivocation")
        }
        await this.readRecord(current.recordDigest, selector)
        return
      }
    }
    await writeImmutable(path.join(this.rootDirectory, "records", `${recordDigest}.jcs`), recordBytes)
    const projectSelector = projectBindingSelectorDigest(record)
    const binding: LocalReplicaProjectBinding = Object.freeze({
      format: PROJECT_BINDING_FORMAT,
      selector: projectSelector,
      projectId: record.projectId,
      projectEpoch: record.projectEpoch,
      actorId: record.actorId,
      replicaId: record.signerAuthority.replicaId,
      recordDigest,
    })
    await writeImmutable(
      path.join(this.rootDirectory, "project-bindings", `${projectSelector}.jcs`),
      encodeRestrictedJcs(binding),
    )
    const pointer: LocalAuthorityPointer = Object.freeze({
      format: POINTER_FORMAT,
      selector,
      membershipSequence: record.membershipSequence,
      controlEvidenceDigest: record.controlEvidenceDigest,
      recordDigest,
    })
    await replaceDurably(
      path.join(this.rootDirectory, "current", `${selector}.jcs`),
      encodeRestrictedJcs(pointer),
    )
  }

  async resolveLocalProjectActor(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
  }): Promise<Readonly<{ actorId: ActorId; replicaId: ReplicaId }> | "pending" | "rejected"> {
    let projectId: ProjectId
    let projectEpoch: Id128
    try {
      projectId = parseProjectId(input.projectId)
      projectEpoch = parseId128(input.projectEpoch)
    } catch {
      return "rejected"
    }
    const selector = projectBindingSelectorDigest({ projectId, projectEpoch })
    try {
      const bytes = new Uint8Array(await fs.readFile(
        path.join(this.rootDirectory, "project-bindings", `${selector}.jcs`),
      ))
      const binding = parseProjectBinding(decodeRestrictedJcs(bytes), selector)
      if (!sameBytes(bytes, encodeRestrictedJcs(binding))) return "rejected"
      const record = await this.readRecord(binding.recordDigest, selectorDigest(binding))
      if (
        record.projectId !== projectId || record.projectEpoch !== projectEpoch ||
        record.actorId !== binding.actorId || record.signerAuthority.replicaId !== binding.replicaId
      ) return "rejected"
      return Object.freeze({ actorId: binding.actorId, replicaId: binding.replicaId })
    } catch (error) {
      if (isMissing(error)) return "pending"
      return "rejected"
    }
  }

  async resolveCurrent(
    request: Parameters<DurableVerifiedLocalAuthorityCache["resolveCurrent"]>[0],
  ): Promise<DurableVerifiedLocalAuthorityCacheEntry | "pending" | "rejected"> {
    let scope: ReturnType<typeof parseDocumentScope>
    try { scope = parseDocumentScope(request.scope) } catch { return "rejected" }
    if (request.actorId !== parseActorId(request.actorId)) return "rejected"
    if (request.ownerSchemaDigest !== parseDigest(request.ownerSchemaDigest)) return "rejected"
    const selector = selectorDigest({
      projectId: scope.projectId,
      projectEpoch: scope.projectEpoch,
      actorId: request.actorId,
    })
    try {
      const pointer = await this.readPointer(selector)
      if (!pointer) return "pending"
      const record = await this.readRecord(pointer.recordDigest, selector)
      if (
        record.protocolDigest !== this.protocolDigest
        || record.membershipSequence !== pointer.membershipSequence
        || record.controlEvidenceDigest !== pointer.controlEvidenceDigest
        || record.role !== "editor"
        || record.editState !== "active-editor"
        || record.signerAuthority.actorId !== request.actorId
        || !record.validationArtifacts.artifacts.some((artifact) => artifact.artifactDigest === request.ownerSchemaDigest)
      ) return "rejected"
      return Object.freeze({
        scope,
        operationId: parseId128(request.operationId),
        baseFrontierDigest: parseDigest(request.baseFrontierDigest),
        ownerSchemaDigest: parseDigest(request.ownerSchemaDigest),
        signerAuthority: record.signerAuthority,
        dependencies: record.dependencies,
        validationArtifacts: record.validationArtifacts,
        replicaSigningPublicKey: record.replicaSigningPublicKey,
      })
    } catch (error) {
      if (isMissing(error)) return "pending"
      return "rejected"
    }
  }

  private async readPointer(selector: Digest): Promise<LocalAuthorityPointer | null> {
    try {
      const bytes = new Uint8Array(await fs.readFile(path.join(this.rootDirectory, "current", `${selector}.jcs`)))
      return parsePointer(decodeRestrictedJcs(bytes), selector)
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  private async readRecord(recordDigest: Digest, selector: Digest): Promise<LocalReplicaAuthorityCacheRecord> {
    const bytes = new Uint8Array(await fs.readFile(path.join(this.rootDirectory, "records", `${recordDigest}.jcs`)))
    if (ordinarySha256(bytes) !== recordDigest) throw new Error("Local authority cache record digest mismatches")
    const record = parseRecord(decodeRestrictedJcs(bytes))
    if (selectorDigest(record) !== selector) throw new Error("Local authority cache record crossed identity")
    return record
  }
}

export interface LocalProjectIndexEnrollmentInstallPort {
  installProjectIndexBase(input: {
    readonly enrollment: LocalReplicaAuthorityCacheRecord
    readonly replicaSigningPublicKey: PublicKey
  }): Promise<void>
}

/**
 * Key-first, ProjectIndex-second, authority-pointer-last enrollment. Orphan vault
 * keys or an installed base without a current pointer grant no edit authority and
 * are safe to retry with the exact same enrollment.
 */
export async function enrollNewLocalProjectReplica(input: {
  readonly identity: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly replicaId: ReplicaId
  }
  readonly vault: Pick<ElectronReplicaSigningVault, "createReplicaKey">
  prepareEnrollment(publicKey: PublicKey): Promise<VerifiedLocalReplicaEnrollment | "rejected">
  readonly projectIndex: LocalProjectIndexEnrollmentInstallPort
  readonly cache: Pick<DurableLocalReplicaAuthorityCache, "install">
}): Promise<Readonly<{ enrollment: LocalReplicaAuthorityCacheRecord; publicKey: PublicKey }> | "rejected"> {
  const identity = Object.freeze({
    projectId: parseProjectId(input.identity.projectId),
    projectEpoch: parseId128(input.identity.projectEpoch),
    replicaId: parseReplicaId(input.identity.replicaId),
  })
  const key = await input.vault.createReplicaKey(identity)
  const verified = await input.prepareEnrollment(key.publicKey)
  if (verified === "rejected" || !liveEnrollments.has(verified)) return "rejected"
  const record = parseRecord(verified.record)
  if (
    record.projectId !== identity.projectId
    || record.projectEpoch !== identity.projectEpoch
    || record.signerAuthority.replicaId !== identity.replicaId
    || record.replicaSigningPublicKey !== key.publicKey
  ) throw new Error("Verified local enrollment crossed vault identity")
  await input.projectIndex.installProjectIndexBase({ enrollment: record, replicaSigningPublicKey: key.publicKey })
  await input.cache.install(verified)
  return Object.freeze({ enrollment: record, publicKey: key.publicKey })
}

interface LocalAuthorityPointer {
  readonly format: typeof POINTER_FORMAT
  readonly selector: Digest
  readonly membershipSequence: Uint64
  readonly controlEvidenceDigest: Digest
  readonly recordDigest: Digest
}

interface LocalReplicaProjectBinding {
  readonly format: typeof PROJECT_BINDING_FORMAT
  readonly selector: Digest
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly actorId: ActorId
  readonly replicaId: ReplicaId
  readonly recordDigest: Digest
}

function parseRecord(value: unknown): LocalReplicaAuthorityCacheRecord {
  assertExactKeys(value, [
    "format", "projectId", "projectEpoch", "actorId", "membershipSequence", "controlEvidenceDigest",
    "protocolDigest", "role", "editState", "replicaSigningPublicKey", "signerAuthority", "dependencies",
    "validationArtifacts",
  ], "local authority cache record")
  if (value.format !== RECORD_FORMAT || value.role !== "editor" || value.editState !== "active-editor") {
    throw new TypeError("Local authority cache record discriminator is invalid")
  }
  const projectId = parseProjectId(value.projectId)
  const projectEpoch = parseId128(value.projectEpoch)
  const actorId = parseActorId(value.actorId)
  const signerAuthority = parseSignerAuthority(value.signerAuthority)
  if (signerAuthority.actorId !== actorId) throw new TypeError("Local authority cache actor binding mismatches")
  assertDenseArray(value.dependencies, "local authority cache dependencies")
  const dependencies = Object.freeze(value.dependencies.map(parseDependency))
  for (let index = 1; index < dependencies.length; index += 1) {
    const previous = `${dependencies[index - 1]!.kind}\u0000${dependencies[index - 1]!.digest}`
    const current = `${dependencies[index]!.kind}\u0000${dependencies[index]!.digest}`
    if (previous >= current) throw new TypeError("Local authority cache dependencies are not strictly sorted")
  }
  requireDependency(dependencies, "membership-snapshot", signerAuthority.membershipSnapshotDigest)
  requireDependency(dependencies, "replica-actor-credential", signerAuthority.replicaActorCredentialCoreDigest)
  requireDependency(dependencies, "replica-edit-authorization", signerAuthority.replicaEditAuthorizationCoreDigest)
  return Object.freeze({
    format: RECORD_FORMAT,
    projectId,
    projectEpoch,
    actorId,
    membershipSequence: parseUint64(value.membershipSequence),
    controlEvidenceDigest: parseDigest(value.controlEvidenceDigest),
    protocolDigest: parseDigest(value.protocolDigest),
    role: "editor",
    editState: "active-editor",
    replicaSigningPublicKey: parsePublicKey(value.replicaSigningPublicKey),
    signerAuthority,
    dependencies,
    validationArtifacts: parseValidationArtifactSet(value.validationArtifacts),
  })
}

function parseSignerAuthority(value: unknown): TeamReplicaSignerAuthority {
  const parsed = parseCausalSignerAuthority(value)
  if (parsed.kind !== "team-replica") {
    throw new TypeError("Local authority cache accepts only Team replica authority")
  }
  return parsed
}

function parseDependency(value: unknown): CausalDependencyRef {
  assertExactKeys(value, ["kind", "digest"], "local authority dependency")
  if (typeof value.kind !== "string" || !dependencyKinds.has(value.kind as CausalDependencyKind)) {
    throw new TypeError("Local authority dependency kind is invalid")
  }
  return Object.freeze({ kind: value.kind as CausalDependencyKind, digest: parseDigest(value.digest) })
}

function requireDependency(dependencies: readonly CausalDependencyRef[], kind: CausalDependencyKind, digest: Digest): void {
  if (!dependencies.some((dependency) => dependency.kind === kind && dependency.digest === digest)) {
    throw new TypeError(`Local authority cache lacks mandatory ${kind}`)
  }
}

function selectorDigest(input: { readonly projectId: ProjectId; readonly projectEpoch: Id128; readonly actorId: ActorId }): Digest {
  return ordinarySha256(encodeRestrictedJcs(Object.freeze({
    projectId: parseProjectId(input.projectId),
    projectEpoch: parseId128(input.projectEpoch),
    actorId: parseActorId(input.actorId),
  })))
}

function projectBindingSelectorDigest(input: { readonly projectId: ProjectId; readonly projectEpoch: Id128 }): Digest {
  return ordinarySha256(encodeRestrictedJcs(Object.freeze({
    projectId: parseProjectId(input.projectId),
    projectEpoch: parseId128(input.projectEpoch),
  })))
}

function parseProjectBinding(value: unknown, selector: Digest): LocalReplicaProjectBinding {
  assertExactKeys(
    value,
    ["format", "selector", "projectId", "projectEpoch", "actorId", "replicaId", "recordDigest"],
    "local replica Project binding",
  )
  if (value.format !== PROJECT_BINDING_FORMAT || parseDigest(value.selector) !== selector) {
    throw new TypeError("Local replica Project binding crossed identity")
  }
  const projectId = parseProjectId(value.projectId)
  const projectEpoch = parseId128(value.projectEpoch)
  if (projectBindingSelectorDigest({ projectId, projectEpoch }) !== selector) {
    throw new TypeError("Local replica Project binding selector mismatches")
  }
  return Object.freeze({
    format: PROJECT_BINDING_FORMAT,
    selector,
    projectId,
    projectEpoch,
    actorId: parseActorId(value.actorId),
    replicaId: parseReplicaId(value.replicaId),
    recordDigest: parseDigest(value.recordDigest),
  })
}

function parsePointer(value: unknown, selector: Digest): LocalAuthorityPointer {
  assertExactKeys(value, ["format", "selector", "membershipSequence", "controlEvidenceDigest", "recordDigest"], "local authority pointer")
  if (value.format !== POINTER_FORMAT || parseDigest(value.selector) !== selector) {
    throw new TypeError("Local authority pointer crossed identity")
  }
  return Object.freeze({
    format: POINTER_FORMAT,
    selector,
    membershipSequence: parseUint64(value.membershipSequence),
    controlEvidenceDigest: parseDigest(value.controlEvidenceDigest),
    recordDigest: parseDigest(value.recordDigest),
  })
}

async function ensureLayout(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  await ensureDirectory(root)
  for (const name of ["records", "current", "project-bindings"]) {
    const directory = path.join(root, name)
    await fs.mkdir(directory, { mode: 0o700 }).catch((error) => { if (!isExists(error)) throw error })
    await ensureDirectory(directory)
  }
}

async function ensureDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Local authority cache directory is untrusted")
}

async function writeImmutable(target: string, bytes: Uint8Array): Promise<void> {
  try {
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await syncDirectoryEntry(path.dirname(target))
  } catch (error) {
    if (!isExists(error)) throw error
    const existing = new Uint8Array(await fs.readFile(target))
    if (!sameBytes(existing, bytes)) throw new Error("Local authority immutable record equivocated")
  }
}

async function replaceDurably(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try {
    await fs.rename(temporary, target)
    await syncDirectoryEntry(path.dirname(target))
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined)
    throw error
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false
  return true
}

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT" }
function isExists(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "EEXIST" }
