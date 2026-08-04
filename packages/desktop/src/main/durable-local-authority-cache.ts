import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  assertDenseArrayV2,
  assertExactKeysV2,
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseUint64V2,
  parseValidationArtifactSetV2,
  uint64ToBigIntV2,
  type ActorIdV2,
  type CausalDependencyKindV2,
  type CausalDependencyRefV2,
  type CausalSignerAuthorityV2,
  type DigestV2,
  type Id128V2,
  type ProjectIdV2,
  type PublicKeyV2,
  type ReplicaIdV2,
  type Uint64V2,
  type ValidationArtifactSetV2,
} from "@convax/collaboration"

import type {
  DurableVerifiedLocalAuthorityCacheEntryV2,
  DurableVerifiedLocalAuthorityCacheV2,
} from "./collaboration-production-runtime"
import type { ElectronReplicaSigningVaultV2 } from "./electron-replica-signing-vault"

const RECORD_FORMAT = "convax.desktop-local-authority-cache-record/1" as const
const POINTER_FORMAT = "convax.desktop-local-authority-cache-pointer/1" as const
const PROJECT_BINDING_FORMAT = "convax.desktop-local-replica-project-binding/1" as const
const dependencyKinds = new Set<CausalDependencyKindV2>([
  "membership-snapshot", "replica-actor-credential", "replica-edit-authorization",
  "authorization-mutation", "cutoff-coverage-root", "checkpoint-content-certificate",
  "project-index-proof", "project-resource-proof", "plugin-validation-artifact",
  "generation-external-fact", "reset-authorization",
])

export interface LocalReplicaAuthorityCacheRecordV2 {
  readonly format: typeof RECORD_FORMAT
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly actorId: ActorIdV2
  readonly membershipSequence: Uint64V2
  readonly controlEvidenceDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly role: "editor"
  readonly editState: "active-editor"
  readonly replicaSigningPublicKey: PublicKeyV2
  readonly signerAuthority: CausalSignerAuthorityV2
  readonly dependencies: readonly CausalDependencyRefV2[]
  readonly validationArtifacts: ValidationArtifactSetV2
}

export interface LocalReplicaEnrollmentCandidateV2
  extends Omit<LocalReplicaAuthorityCacheRecordV2, "format" | "role" | "editState"> {
  readonly authorizationEvidence: unknown
}

declare const verifiedLocalReplicaEnrollmentBrandV2: unique symbol
export interface VerifiedLocalReplicaEnrollmentV2 {
  readonly record: LocalReplicaAuthorityCacheRecordV2
  readonly [verifiedLocalReplicaEnrollmentBrandV2]: true
}

const liveEnrollments = new WeakSet<object>()

export interface LocalReplicaEnrollmentVerifierFactoryV2 {
  verify(candidate: LocalReplicaEnrollmentCandidateV2): Promise<VerifiedLocalReplicaEnrollmentV2 | "rejected">
}

/** Converts current control/local-owner proof into a one-use process capability. */
export function createLocalReplicaEnrollmentVerifierFactoryV2(input: {
  verifyCurrent(input: LocalReplicaEnrollmentCandidateV2): Promise<boolean>
}): LocalReplicaEnrollmentVerifierFactoryV2 {
  if (typeof input.verifyCurrent !== "function") throw new TypeError("Local replica enrollment verifier is required")
  return Object.freeze({
    async verify(candidate: LocalReplicaEnrollmentCandidateV2) {
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
      const enrollment = Object.freeze({ record }) as VerifiedLocalReplicaEnrollmentV2
      liveEnrollments.add(enrollment)
      return enrollment
    },
  })
}

export interface DurableLocalReplicaAuthorityCacheV2 extends DurableVerifiedLocalAuthorityCacheV2 {
  install(enrollment: VerifiedLocalReplicaEnrollmentV2): Promise<void>
  resolveLocalProjectActor(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
  }): Promise<Readonly<{ actorId: ActorIdV2; replicaId: ReplicaIdV2 }> | "pending" | "rejected">
}

/**
 * Desktop userData cache for already-verified long-lived edit authority. Records
 * are immutable; one atomic pointer selects the greatest verified membership
 * sequence. It contains no session credential, peer id, or private key.
 */
export class NodeDurableLocalReplicaAuthorityCacheV2 implements DurableLocalReplicaAuthorityCacheV2 {
  constructor(private readonly rootDirectory: string, private readonly protocolDigest: DigestV2) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Local authority cache root must be absolute")
    parseDigestV2(protocolDigest)
  }

  async install(enrollment: VerifiedLocalReplicaEnrollmentV2): Promise<void> {
    if (!liveEnrollments.has(enrollment)) throw new TypeError("Local authority enrollment was not verified in this process")
    const record = parseRecord(enrollment.record)
    if (record.protocolDigest !== this.protocolDigest) throw new Error("Local authority enrollment uses another protocol")
    await ensureLayout(this.rootDirectory)
    const recordBytes = encodeRestrictedJcsV2(record)
    const recordDigest = ordinarySha256V2(recordBytes)
    const selector = selectorDigest(record)
    const current = await this.readPointer(selector)
    if (current) {
      const currentSequence = uint64ToBigIntV2(current.membershipSequence)
      const nextSequence = uint64ToBigIntV2(record.membershipSequence)
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
    const binding: LocalReplicaProjectBindingV2 = Object.freeze({
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
      encodeRestrictedJcsV2(binding),
    )
    const pointer: LocalAuthorityPointerV2 = Object.freeze({
      format: POINTER_FORMAT,
      selector,
      membershipSequence: record.membershipSequence,
      controlEvidenceDigest: record.controlEvidenceDigest,
      recordDigest,
    })
    await replaceDurably(
      path.join(this.rootDirectory, "current", `${selector}.jcs`),
      encodeRestrictedJcsV2(pointer),
    )
  }

  async resolveLocalProjectActor(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
  }): Promise<Readonly<{ actorId: ActorIdV2; replicaId: ReplicaIdV2 }> | "pending" | "rejected"> {
    let projectId: ProjectIdV2
    let projectEpoch: Id128V2
    try {
      projectId = parseProjectIdV2(input.projectId)
      projectEpoch = parseId128V2(input.projectEpoch)
    } catch {
      return "rejected"
    }
    const selector = projectBindingSelectorDigest({ projectId, projectEpoch })
    try {
      const bytes = new Uint8Array(await fs.readFile(
        path.join(this.rootDirectory, "project-bindings", `${selector}.jcs`),
      ))
      const binding = parseProjectBinding(decodeRestrictedJcsV2(bytes), selector)
      if (!sameBytes(bytes, encodeRestrictedJcsV2(binding))) return "rejected"
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
    request: Parameters<DurableVerifiedLocalAuthorityCacheV2["resolveCurrent"]>[0],
  ): Promise<DurableVerifiedLocalAuthorityCacheEntryV2 | "pending" | "rejected"> {
    let scope: ReturnType<typeof parseDocumentScopeV2>
    try { scope = parseDocumentScopeV2(request.scope) } catch { return "rejected" }
    if (request.actorId !== parseActorIdV2(request.actorId)) return "rejected"
    if (request.ownerSchemaDigest !== parseDigestV2(request.ownerSchemaDigest)) return "rejected"
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
        operationId: parseId128V2(request.operationId),
        baseFrontierDigest: parseDigestV2(request.baseFrontierDigest),
        ownerSchemaDigest: parseDigestV2(request.ownerSchemaDigest),
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

  private async readPointer(selector: DigestV2): Promise<LocalAuthorityPointerV2 | null> {
    try {
      const bytes = new Uint8Array(await fs.readFile(path.join(this.rootDirectory, "current", `${selector}.jcs`)))
      return parsePointer(decodeRestrictedJcsV2(bytes), selector)
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  private async readRecord(recordDigest: DigestV2, selector: DigestV2): Promise<LocalReplicaAuthorityCacheRecordV2> {
    const bytes = new Uint8Array(await fs.readFile(path.join(this.rootDirectory, "records", `${recordDigest}.jcs`)))
    if (ordinarySha256V2(bytes) !== recordDigest) throw new Error("Local authority cache record digest mismatches")
    const record = parseRecord(decodeRestrictedJcsV2(bytes))
    if (selectorDigest(record) !== selector) throw new Error("Local authority cache record crossed identity")
    return record
  }
}

export interface LocalProjectIndexEnrollmentInstallPortV2 {
  installProjectIndexBase(input: {
    readonly enrollment: LocalReplicaAuthorityCacheRecordV2
    readonly replicaSigningPublicKey: PublicKeyV2
  }): Promise<void>
}

/**
 * Key-first, ProjectIndex-second, authority-pointer-last enrollment. Orphan vault
 * keys or an installed base without a current pointer grant no edit authority and
 * are safe to retry with the exact same enrollment.
 */
export async function enrollNewLocalProjectReplicaV2(input: {
  readonly identity: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly replicaId: ReplicaIdV2
  }
  readonly vault: Pick<ElectronReplicaSigningVaultV2, "createReplicaKey">
  prepareEnrollment(publicKey: PublicKeyV2): Promise<VerifiedLocalReplicaEnrollmentV2 | "rejected">
  readonly projectIndex: LocalProjectIndexEnrollmentInstallPortV2
  readonly cache: Pick<DurableLocalReplicaAuthorityCacheV2, "install">
}): Promise<Readonly<{ enrollment: LocalReplicaAuthorityCacheRecordV2; publicKey: PublicKeyV2 }> | "rejected"> {
  const identity = Object.freeze({
    projectId: parseProjectIdV2(input.identity.projectId),
    projectEpoch: parseId128V2(input.identity.projectEpoch),
    replicaId: parseReplicaIdV2(input.identity.replicaId),
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

interface LocalAuthorityPointerV2 {
  readonly format: typeof POINTER_FORMAT
  readonly selector: DigestV2
  readonly membershipSequence: Uint64V2
  readonly controlEvidenceDigest: DigestV2
  readonly recordDigest: DigestV2
}

interface LocalReplicaProjectBindingV2 {
  readonly format: typeof PROJECT_BINDING_FORMAT
  readonly selector: DigestV2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly actorId: ActorIdV2
  readonly replicaId: ReplicaIdV2
  readonly recordDigest: DigestV2
}

function parseRecord(value: unknown): LocalReplicaAuthorityCacheRecordV2 {
  assertExactKeysV2(value, [
    "format", "projectId", "projectEpoch", "actorId", "membershipSequence", "controlEvidenceDigest",
    "protocolDigest", "role", "editState", "replicaSigningPublicKey", "signerAuthority", "dependencies",
    "validationArtifacts",
  ], "local authority cache record")
  if (value.format !== RECORD_FORMAT || value.role !== "editor" || value.editState !== "active-editor") {
    throw new TypeError("Local authority cache record discriminator is invalid")
  }
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const actorId = parseActorIdV2(value.actorId)
  const signerAuthority = parseSignerAuthority(value.signerAuthority)
  if (signerAuthority.actorId !== actorId) throw new TypeError("Local authority cache actor binding mismatches")
  assertDenseArrayV2(value.dependencies, "local authority cache dependencies")
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
    membershipSequence: parseUint64V2(value.membershipSequence),
    controlEvidenceDigest: parseDigestV2(value.controlEvidenceDigest),
    protocolDigest: parseDigestV2(value.protocolDigest),
    role: "editor",
    editState: "active-editor",
    replicaSigningPublicKey: parsePublicKeyV2(value.replicaSigningPublicKey),
    signerAuthority,
    dependencies,
    validationArtifacts: parseValidationArtifactSetV2(value.validationArtifacts),
  })
}

function parseSignerAuthority(value: unknown): CausalSignerAuthorityV2 {
  assertExactKeysV2(value, [
    "memberId", "replicaId", "actorId", "memberAuthorizationEpoch", "replicaAuthorizationEpoch",
    "membershipSnapshotDigest", "replicaActorCredentialCoreDigest", "replicaEditAuthorizationCoreDigest",
  ], "local authority signer authority")
  return Object.freeze({
    memberId: parseMemberIdV2(value.memberId),
    replicaId: parseReplicaIdV2(value.replicaId),
    actorId: parseActorIdV2(value.actorId),
    memberAuthorizationEpoch: parseId128V2(value.memberAuthorizationEpoch),
    replicaAuthorizationEpoch: parseId128V2(value.replicaAuthorizationEpoch),
    membershipSnapshotDigest: parseDigestV2(value.membershipSnapshotDigest),
    replicaActorCredentialCoreDigest: parseDigestV2(value.replicaActorCredentialCoreDigest),
    replicaEditAuthorizationCoreDigest: parseDigestV2(value.replicaEditAuthorizationCoreDigest),
  })
}

function parseDependency(value: unknown): CausalDependencyRefV2 {
  assertExactKeysV2(value, ["kind", "digest"], "local authority dependency")
  if (typeof value.kind !== "string" || !dependencyKinds.has(value.kind as CausalDependencyKindV2)) {
    throw new TypeError("Local authority dependency kind is invalid")
  }
  return Object.freeze({ kind: value.kind as CausalDependencyKindV2, digest: parseDigestV2(value.digest) })
}

function requireDependency(dependencies: readonly CausalDependencyRefV2[], kind: CausalDependencyKindV2, digest: DigestV2): void {
  if (!dependencies.some((dependency) => dependency.kind === kind && dependency.digest === digest)) {
    throw new TypeError(`Local authority cache lacks mandatory ${kind}`)
  }
}

function selectorDigest(input: { readonly projectId: ProjectIdV2; readonly projectEpoch: Id128V2; readonly actorId: ActorIdV2 }): DigestV2 {
  return ordinarySha256V2(encodeRestrictedJcsV2(Object.freeze({
    projectId: parseProjectIdV2(input.projectId),
    projectEpoch: parseId128V2(input.projectEpoch),
    actorId: parseActorIdV2(input.actorId),
  })))
}

function projectBindingSelectorDigest(input: { readonly projectId: ProjectIdV2; readonly projectEpoch: Id128V2 }): DigestV2 {
  return ordinarySha256V2(encodeRestrictedJcsV2(Object.freeze({
    projectId: parseProjectIdV2(input.projectId),
    projectEpoch: parseId128V2(input.projectEpoch),
  })))
}

function parseProjectBinding(value: unknown, selector: DigestV2): LocalReplicaProjectBindingV2 {
  assertExactKeysV2(
    value,
    ["format", "selector", "projectId", "projectEpoch", "actorId", "replicaId", "recordDigest"],
    "local replica Project binding",
  )
  if (value.format !== PROJECT_BINDING_FORMAT || parseDigestV2(value.selector) !== selector) {
    throw new TypeError("Local replica Project binding crossed identity")
  }
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  if (projectBindingSelectorDigest({ projectId, projectEpoch }) !== selector) {
    throw new TypeError("Local replica Project binding selector mismatches")
  }
  return Object.freeze({
    format: PROJECT_BINDING_FORMAT,
    selector,
    projectId,
    projectEpoch,
    actorId: parseActorIdV2(value.actorId),
    replicaId: parseReplicaIdV2(value.replicaId),
    recordDigest: parseDigestV2(value.recordDigest),
  })
}

function parsePointer(value: unknown, selector: DigestV2): LocalAuthorityPointerV2 {
  assertExactKeysV2(value, ["format", "selector", "membershipSequence", "controlEvidenceDigest", "recordDigest"], "local authority pointer")
  if (value.format !== POINTER_FORMAT || parseDigestV2(value.selector) !== selector) {
    throw new TypeError("Local authority pointer crossed identity")
  }
  return Object.freeze({
    format: POINTER_FORMAT,
    selector,
    membershipSequence: parseUint64V2(value.membershipSequence),
    controlEvidenceDigest: parseDigestV2(value.controlEvidenceDigest),
    recordDigest: parseDigestV2(value.recordDigest),
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
    await fsyncDirectory(path.dirname(target))
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
    await fsyncDirectory(path.dirname(target))
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await handle.sync() } finally { await handle.close() }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false
  return true
}

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT" }
function isExists(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "EEXIST" }
