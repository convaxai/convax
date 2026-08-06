import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  ordinarySha256,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseUint64,
  uint64ToBigInt,
  type Digest,
  type MemberId,
  type ProjectId,
  type PublicKey,
} from "@convax/collaboration"
import {
  parseMemberCredentialV2,
  parseMembershipSnapshotV2,
  parseProjectAdminCapabilityV2,
  parseReplicaActorCredentialV2,
  parseReplicaEditAuthorizationV2,
  type MemberCredentialV2,
  type MembershipSnapshotV2,
  type PinnedControlServiceVerifierV2,
  type ProjectAdminCapabilityV2,
  type ReplicaActorCredentialV2,
  type ReplicaEditAuthorizationV2,
} from "@convax/project/collaboration-protocol"

const RECORD_FORMAT = "convax.desktop-team-authority-record/1" as const
const POINTER_FORMAT = "convax.desktop-team-authority-pointer/1" as const

export interface DesktopTeamAuthorityRecordV1 {
  readonly format: typeof RECORD_FORMAT
  readonly projectId: ProjectId
  readonly memberId: MemberId
  readonly memberSigningPublicKey: PublicKey
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly memberCredential: MemberCredentialV2
  readonly adminCapability: ProjectAdminCapabilityV2 | null
  readonly replicaActorCredential: ReplicaActorCredentialV2 | null
  readonly replicaEditAuthorization: ReplicaEditAuthorizationV2 | null
}

export type DesktopTeamAuthorityCandidateV1 = Omit<DesktopTeamAuthorityRecordV1, "format" | "projectId" | "memberId" | "memberSigningPublicKey">

declare const verifiedTeamAuthorityBrandV1: unique symbol
export interface VerifiedDesktopTeamAuthorityV1 {
  readonly record: DesktopTeamAuthorityRecordV1
  readonly [verifiedTeamAuthorityBrandV1]: true
}

const liveAuthorities = new WeakSet<object>()

/** Re-verifies the exact portable graph before it can become the durable local selector. */
export function createDesktopTeamAuthorityAdmissionV1(input: {
  readonly verifier: PinnedControlServiceVerifierV2
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
}) {
  const protocolDigest = parseDigest(input.protocolDigest)
  const trustBundleDigest = parseDigest(input.trustBundleDigest)
  return Object.freeze({
    async admit(candidateInput: DesktopTeamAuthorityCandidateV1): Promise<VerifiedDesktopTeamAuthorityV1 | "rejected"> {
      let record: DesktopTeamAuthorityRecordV1
      try { record = parseCandidate(candidateInput) } catch { return "rejected" }
      const artifacts = [
        record.membershipSnapshot,
        record.memberCredential,
        ...(record.adminCapability ? [record.adminCapability] : []),
        ...(record.replicaActorCredential ? [record.replicaActorCredential] : []),
        ...(record.replicaEditAuthorization ? [record.replicaEditAuthorization] : []),
      ]
      for (const artifact of artifacts) {
        if (artifact.core.protocolDigest !== protocolDigest || artifact.core.trustBundleDigest !== trustBundleDigest ||
          !await input.verifier.verify({
            purpose: artifact.core.serviceKeyPurpose,
            serviceKeyId: artifact.core.serviceKeyId,
            coreDigest: artifact.coreDigest,
            serviceSignature: artifact.serviceSignature,
          })) return "rejected"
      }
      if (!validGraph(record)) return "rejected"
      const authority = Object.freeze({ record }) as VerifiedDesktopTeamAuthorityV1
      liveAuthorities.add(authority)
      return authority
    },
  })
}

/** Main-private immutable authority records with one anti-rollback per-Project pointer. */
export class NodeDurableTeamAuthorityStoreV1 {
  constructor(private readonly rootDirectory: string) {
    if (!path.isAbsolute(rootDirectory)) throw new TypeError("Team authority store root must be absolute")
  }

  async install(authority: VerifiedDesktopTeamAuthorityV1): Promise<void> {
    if (!liveAuthorities.has(authority)) throw new TypeError("Team authority was not verified in this process")
    liveAuthorities.delete(authority)
    const record = parseRecord(authority.record)
    await ensureLayout(this.rootDirectory)
    const selector = selectorDigest(record.projectId)
    const bytes = encodeRestrictedJcs(record)
    const recordDigest = ordinarySha256(bytes)
    const current = await this.readPointer(selector)
    if (current) {
      const sequence = uint64ToBigInt(record.membershipSnapshot.core.membershipSequence)
      const currentSequence = uint64ToBigInt(current.membershipSequence)
      if (sequence < currentSequence) throw new Error("Team authority store rejected membership rollback")
      if (sequence === currentSequence) {
        if (recordDigest !== current.recordDigest) throw new Error("Team authority store rejected same-sequence equivocation")
        await this.readRecord(recordDigest, record.projectId)
        return
      }
    }
    await writeImmutable(path.join(this.rootDirectory, "records", `${recordDigest}.jcs`), bytes)
    const pointer: TeamAuthorityPointerV1 = Object.freeze({
      format: POINTER_FORMAT,
      selector,
      projectId: record.projectId,
      projectEpoch: record.membershipSnapshot.core.projectEpoch,
      membershipSequence: record.membershipSnapshot.core.membershipSequence,
      membershipSnapshotDigest: record.membershipSnapshot.coreDigest,
      recordDigest,
    })
    await replaceDurably(path.join(this.rootDirectory, "current", `${selector}.jcs`), encodeRestrictedJcs(pointer))
  }

  async open(projectIdInput: ProjectId): Promise<DesktopTeamAuthorityRecordV1 | "missing" | "rejected"> {
    let projectId: ProjectId
    try { projectId = parseProjectId(projectIdInput) } catch { return "rejected" }
    const selector = selectorDigest(projectId)
    try {
      const pointer = await this.readPointer(selector)
      if (!pointer) return "missing"
      const record = await this.readRecord(pointer.recordDigest, projectId)
      if (record.membershipSnapshot.core.projectEpoch !== pointer.projectEpoch ||
        record.membershipSnapshot.core.membershipSequence !== pointer.membershipSequence ||
        record.membershipSnapshot.coreDigest !== pointer.membershipSnapshotDigest) return "rejected"
      return record
    } catch {
      return "rejected"
    }
  }

  private async readPointer(selector: Digest): Promise<TeamAuthorityPointerV1 | null> {
    try {
      const bytes = new Uint8Array(await fs.readFile(path.join(this.rootDirectory, "current", `${selector}.jcs`)))
      const pointer = parsePointer(decodeRestrictedJcs(bytes), selector)
      if (!sameBytes(bytes, encodeRestrictedJcs(pointer))) throw new Error("Team authority pointer is noncanonical")
      return pointer
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }

  private async readRecord(recordDigest: Digest, projectId: ProjectId): Promise<DesktopTeamAuthorityRecordV1> {
    const bytes = new Uint8Array(await fs.readFile(path.join(this.rootDirectory, "records", `${recordDigest}.jcs`)))
    if (ordinarySha256(bytes) !== recordDigest) throw new Error("Team authority record digest mismatches")
    const record = parseRecord(decodeRestrictedJcs(bytes))
    if (record.projectId !== projectId || !sameBytes(bytes, encodeRestrictedJcs(record))) throw new Error("Team authority record crossed identity")
    return record
  }
}

interface TeamAuthorityPointerV1 {
  readonly format: typeof POINTER_FORMAT
  readonly selector: Digest
  readonly projectId: ProjectId
  readonly projectEpoch: MembershipSnapshotV2["core"]["projectEpoch"]
  readonly membershipSequence: MembershipSnapshotV2["core"]["membershipSequence"]
  readonly membershipSnapshotDigest: Digest
  readonly recordDigest: Digest
}

function parseCandidate(value: DesktopTeamAuthorityCandidateV1): DesktopTeamAuthorityRecordV1 {
  const membershipSnapshot = parseMembershipSnapshotV2(value.membershipSnapshot)
  const memberCredential = parseMemberCredentialV2(value.memberCredential)
  return parseRecord({
    format: RECORD_FORMAT,
    projectId: membershipSnapshot.core.projectId,
    memberId: memberCredential.core.memberId,
    memberSigningPublicKey: memberCredential.core.memberSigningPublicKey,
    membershipSnapshot,
    memberCredential,
    adminCapability: value.adminCapability,
    replicaActorCredential: value.replicaActorCredential,
    replicaEditAuthorization: value.replicaEditAuthorization,
  })
}

function parseRecord(value: unknown): DesktopTeamAuthorityRecordV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Team authority record is invalid")
  const source = value as Record<string, unknown>
  const keys = ["adminCapability", "format", "memberCredential", "memberId", "memberSigningPublicKey", "membershipSnapshot", "projectId", "replicaActorCredential", "replicaEditAuthorization"]
  if (Object.keys(source).sort().join("\0") !== keys.sort().join("\0") || source.format !== RECORD_FORMAT) throw new TypeError("Team authority record has unsupported fields")
  const record: DesktopTeamAuthorityRecordV1 = Object.freeze({
    format: RECORD_FORMAT,
    projectId: parseProjectId(source.projectId),
    memberId: parseMemberId(source.memberId),
    memberSigningPublicKey: parsePublicKey(source.memberSigningPublicKey),
    membershipSnapshot: parseMembershipSnapshotV2(source.membershipSnapshot),
    memberCredential: parseMemberCredentialV2(source.memberCredential),
    adminCapability: source.adminCapability === null ? null : parseProjectAdminCapabilityV2(source.adminCapability),
    replicaActorCredential: source.replicaActorCredential === null ? null : parseReplicaActorCredentialV2(source.replicaActorCredential),
    replicaEditAuthorization: source.replicaEditAuthorization === null ? null : parseReplicaEditAuthorizationV2(source.replicaEditAuthorization),
  })
  if (!validGraph(record)) throw new TypeError("Team authority graph is invalid")
  return record
}

function validGraph(record: DesktopTeamAuthorityRecordV1): boolean {
  const snapshot = record.membershipSnapshot
  const credential = record.memberCredential
  const member = snapshot.core.members.find((candidate) => candidate.memberId === record.memberId)
  if (!member || member.state !== "active" || member.memberSigningPublicKey !== record.memberSigningPublicKey ||
    record.projectId !== snapshot.core.projectId || credential.core.projectId !== record.projectId ||
    credential.core.projectEpoch !== snapshot.core.projectEpoch || credential.core.membershipEpoch !== snapshot.core.membershipEpoch ||
    credential.core.membershipSnapshotDigest !== snapshot.coreDigest || credential.core.memberId !== record.memberId ||
    credential.core.memberSigningPublicKey !== record.memberSigningPublicKey || credential.core.role !== member.role ||
    credential.core.memberAuthorizationEpoch !== member.memberAuthorizationEpoch) return false
  const admin = record.adminCapability
  if ((admin === null) !== (credential.core.adminCapabilityDigest === null)) return false
  if (admin && (credential.core.adminCapabilityDigest !== admin.coreDigest || admin.core.projectId !== record.projectId ||
    admin.core.projectEpoch !== snapshot.core.projectEpoch || admin.core.membershipEpoch !== snapshot.core.membershipEpoch ||
    admin.core.membershipSnapshotDigest !== snapshot.coreDigest || admin.core.adminMemberId !== record.memberId ||
    admin.core.adminMemberAuthorizationEpoch !== member.memberAuthorizationEpoch)) return false
  const actor = record.replicaActorCredential
  const edit = record.replicaEditAuthorization
  if (!actor) return edit === null
  const replica = snapshot.core.replicas.find((candidate) => candidate.replicaId === actor.core.replicaId)
  if (!replica || replica.memberId !== record.memberId || replica.state !== "active" || actor.core.projectId !== record.projectId ||
    actor.core.projectEpoch !== snapshot.core.projectEpoch || actor.core.memberId !== record.memberId || actor.core.actorId !== replica.actorId ||
    actor.core.replicaSigningPublicKey !== replica.replicaSigningPublicKey || actor.core.replicaAuthorizationEpoch !== replica.replicaAuthorizationEpoch ||
    actor.core.replicaIdReservationReceiptDigest !== replica.replicaIdReservationReceiptDigest) return false
  if (!edit) return replica.editState !== "active-editor"
  return replica.editState === "active-editor" && member.role === "editor" && edit.core.projectId === record.projectId &&
    edit.core.projectEpoch === snapshot.core.projectEpoch && edit.core.membershipEpoch === snapshot.core.membershipEpoch &&
    edit.core.membershipSnapshotDigest === snapshot.coreDigest && edit.core.membershipSequence === snapshot.core.membershipSequence &&
    edit.core.memberId === record.memberId && edit.core.memberAuthorizationEpoch === member.memberAuthorizationEpoch &&
    edit.core.replicaId === replica.replicaId && edit.core.replicaIdReservationReceiptDigest === replica.replicaIdReservationReceiptDigest &&
    edit.core.actorId === replica.actorId && edit.core.replicaAuthorizationEpoch === replica.replicaAuthorizationEpoch
}

function selectorDigest(projectId: ProjectId): Digest {
  return ordinarySha256(encodeRestrictedJcs(Object.freeze({ projectId: parseProjectId(projectId) })))
}

function parsePointer(value: unknown, selector: Digest): TeamAuthorityPointerV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Team authority pointer is invalid")
  const source = value as Record<string, unknown>
  const keys = ["format", "membershipSequence", "membershipSnapshotDigest", "projectEpoch", "projectId", "recordDigest", "selector"]
  if (Object.keys(source).sort().join("\0") !== keys.sort().join("\0") || source.format !== POINTER_FORMAT || parseDigest(source.selector) !== selector) throw new TypeError("Team authority pointer has unsupported fields")
  const projectId = parseProjectId(source.projectId)
  if (selectorDigest(projectId) !== selector) throw new TypeError("Team authority pointer selector mismatches")
  return Object.freeze({
    format: POINTER_FORMAT, selector, projectId,
    projectEpoch: parseId128(source.projectEpoch),
    membershipSequence: parseUint64(source.membershipSequence),
    membershipSnapshotDigest: parseDigest(source.membershipSnapshotDigest),
    recordDigest: parseDigest(source.recordDigest),
  })
}

async function ensureLayout(root: string): Promise<void> {
  for (const directory of [root, path.join(root, "records"), path.join(root, "current")]) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Team authority store directory is untrusted")
  }
}

async function writeImmutable(target: string, bytes: Uint8Array): Promise<void> {
  try {
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    await syncDirectory(path.dirname(target))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const existing = new Uint8Array(await fs.readFile(target))
    if (!sameBytes(existing, bytes)) throw new Error("Team authority immutable record collided")
  }
}

async function replaceDurably(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try { await fs.rename(temporary, target); await syncDirectory(path.dirname(target)) } catch (error) {
    await fs.unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await handle.sync() } finally { await handle.close() }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}
