import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseLocalOwnerEditAuthorizationV3,
  parseLocalProjectOwnerBindingV3,
  parseProjectSharingHandoffReceiptV3,
  parseProjectIdV2,
  type DigestV2,
  type Id128V2,
  type LocalOwnerEditAuthorizationV3,
  type LocalOwnerSharingStatePortV3,
  type LocalProjectOwnerBindingV3,
  type LocalProjectOwnerSignerAuthorityV3,
  type DocumentScopeV2,
  type ProjectIdV2,
  type ProjectSharingHandoffReceiptV3,
} from "@convax/collaboration"
import { fsyncProjectDirectoryV2 } from "./directory-durability"

const MAX_RECORD_BYTES = 128 * 1024

export interface DurableSuccessorLocalOwnerAuthorityV3 {
  readonly binding: LocalProjectOwnerBindingV3
  readonly authorizations: readonly LocalOwnerEditAuthorizationV3[]
}

export interface DurableProjectSharingHandoffV3 {
  readonly receipt: ProjectSharingHandoffReceiptV3
  readonly receiptDigest: DigestV2
  readonly teamArtifacts: Readonly<{
    readonly membershipSnapshotDigest: DigestV2
    readonly memberCredentialCoreDigest: DigestV2
    readonly adminCapabilityCoreDigest: DigestV2
    readonly replicaActorCredentialCoreDigest: DigestV2
    readonly replicaEditAuthorizationCoreDigest: DigestV2
  }>
}

export type OpenSuccessorLocalOwnerAuthorityResultV3 =
  | Readonly<{ status: "unshared"; authority: DurableSuccessorLocalOwnerAuthorityV3 }>
  | Readonly<{ status: "shared"; sharingGeneration: string; receiptDigest: DigestV2 }>
  | Readonly<{ status: "missing" | "recovery-required" }>

/**
 * Non-activating Project/native storage for already-closed successor DTOs.
 * Production selection remains gated by a selected successor authority.
 */
export class NodeSuccessorLocalOwnerAuthorityStoreV3 implements LocalOwnerSharingStatePortV3 {
  constructor(private readonly roots: {
    readonly projectPrivateDirectory: string
    readonly deviceAuthorityDirectory: string
    readonly faults?: { beforeTombstoneRename?(): Promise<void> }
  }) {
    requireAbsolute(roots.projectPrivateDirectory)
    requireAbsolute(roots.deviceAuthorityDirectory)
  }

  async installUnshared(input: DurableSuccessorLocalOwnerAuthorityV3): Promise<void> {
    const parsed = parseAuthority(input)
    const sharing = await this.resolve(parsed.binding.core.projectId, parsed.binding.core.projectEpoch)
    if (sharing === "shared") throw new Error("Shared Project cannot reinstall local-owner authority")
    if (sharing === "ambiguous") {
      const existing = await readOptional(this.projectRecordPath())
      if (existing) {
        const current = parseRecord(existing)
        if (sameBytes(encodeRestrictedJcsV2(current), encodeRestrictedJcsV2(parsed))) return
      }
    }
    await requirePlainDirectory(this.roots.projectPrivateDirectory)
    const target = this.projectRecordPath()
    const existingBytes = await readOptional(target)
    const merged = existingBytes ? mergeAuthorities(parseRecord(existingBytes), parsed) : parsed
    const bytes = encodeRestrictedJcsV2({
      format: "convax.project-local-owner-authority-record/3",
      binding: merged.binding,
      authorizations: merged.authorizations,
    })
    if (existingBytes && sameBytes(existingBytes, bytes)) return
    await writeReplaceExact(target, bytes)
  }

  async resolveExact(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly scope: DocumentScopeV2
    readonly ownerSchemaDigest: DigestV2
    readonly protocolDigest: DigestV2
  }): Promise<Readonly<{
    readonly authority: LocalProjectOwnerSignerAuthorityV3
    readonly binding: LocalProjectOwnerBindingV3
    readonly authorization: LocalOwnerEditAuthorizationV3
  }> | "missing" | "rejected"> {
    const opened = await this.open(input.projectId, input.projectEpoch)
    if (opened.status === "missing") return "missing"
    if (opened.status !== "unshared") return "rejected"
    try {
      const scope = parseDocumentScopeV2(input.scope)
      const schema = parseDigestV2(input.ownerSchemaDigest)
      const protocol = parseDigestV2(input.protocolDigest)
      const authorization = opened.authority.authorizations.find((candidate) =>
        sameBytes(encodeRestrictedJcsV2(candidate.core.scope), encodeRestrictedJcsV2(scope)))
      if (!authorization || authorization.core.ownerSchemaDigest !== schema ||
        authorization.core.protocolDigest !== protocol || opened.authority.binding.core.protocolDigest !== protocol) return "rejected"
      return Object.freeze({
        binding: opened.authority.binding,
        authorization,
        authority: Object.freeze({
          kind: "local-project-owner",
          ownerKeyId: opened.authority.binding.core.ownerKeyId,
          replicaId: opened.authority.binding.core.initialReplicaId,
          actorId: opened.authority.binding.core.initialActorId,
          ownerBindingCoreDigest: opened.authority.binding.coreDigest,
          ownerEditAuthorizationCoreDigest: authorization.coreDigest,
        }),
      })
    } catch { return "rejected" }
  }

  async recordSharingTombstone(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly sharingGeneration: string
    readonly receiptDigest: DigestV2
  }): Promise<void> {
    const projectId = parseProjectIdV2(input.projectId)
    const projectEpoch = parseId128V2(input.projectEpoch)
    const generation = parsePositiveGeneration(input.sharingGeneration)
    const receiptDigest = parseDigestV2(input.receiptDigest)
    await ensurePlainDirectory(this.roots.deviceAuthorityDirectory)
    const target = this.tombstonePath(projectId, projectEpoch)
    const current = await readOptional(target)
    if (current) {
      const parsed = parseTombstone(current)
      const comparison = compareDecimal(parsed.sharingGeneration, generation)
      if (comparison > 0 || (comparison === 0 && parsed.receiptDigest !== receiptDigest)) {
        throw new Error("Project sharing tombstone rollback or equivocation")
      }
      if (comparison === 0) return
    }
    await writeReplace(target, encodeRestrictedJcsV2({
      format: "convax.device-project-sharing-tombstone/3",
      projectId,
      projectEpoch,
      sharingGeneration: generation,
      receiptDigest,
    }), this.roots.faults?.beforeTombstoneRename)
  }

  /**
   * Non-activating one-way native handoff. The Project record is the authority CAS:
   * once it lands, owner signing is closed even if the device tombstone publication
   * crashes. Retry accepts only the byte-identical receipt/artifact closure.
   */
  async installSharingHandoff(input: DurableProjectSharingHandoffV3): Promise<void> {
    const parsed = parseSharingHandoff(input)
    await requirePlainDirectory(this.roots.projectPrivateDirectory)
    const localBytes = await readOptional(this.projectRecordPath())
    if (!localBytes) throw new Error("Project sharing handoff requires the durable local-owner predecessor")
    const local = parseRecord(localBytes)
    if (local.binding.core.projectId !== parsed.receipt.core.projectId || local.binding.core.projectEpoch !== parsed.receipt.core.projectEpoch ||
      local.binding.coreDigest !== parsed.receipt.core.previousOwnerBindingCoreDigest || local.binding.core.ownerKeyId !== parsed.receipt.core.previousOwnerKeyId) {
      throw new Error("Project sharing handoff predecessor closure mismatches")
    }
    await writeCreateOrExact(this.sharingRecordPath(), encodeRestrictedJcsV2({
      format: "convax.project-sharing-handoff-record/3", sharingGeneration: "1", ...parsed,
    }))
    await this.recordSharingTombstone({ projectId: parsed.receipt.core.projectId, projectEpoch: parsed.receipt.core.projectEpoch, sharingGeneration: "1", receiptDigest: parsed.receiptDigest })
  }

  async recoverSharingHandoff(projectIdInput: ProjectIdV2, projectEpochInput: Id128V2): Promise<"not-committed" | "recovered" | "recovery-required"> {
    const projectId = parseProjectIdV2(projectIdInput); const projectEpoch = parseId128V2(projectEpochInput)
    try {
      const bytes = await readOptional(this.sharingRecordPath())
      if (!bytes) return "not-committed"
      const record = parseSharingRecord(bytes)
      if (record.receipt.core.projectId !== projectId || record.receipt.core.projectEpoch !== projectEpoch) return "recovery-required"
      await this.recordSharingTombstone({ projectId, projectEpoch, sharingGeneration: "1", receiptDigest: record.receiptDigest })
      return "recovered"
    } catch { return "recovery-required" }
  }

  async open(projectIdInput: ProjectIdV2, projectEpochInput: Id128V2): Promise<OpenSuccessorLocalOwnerAuthorityResultV3> {
    const projectId = parseProjectIdV2(projectIdInput)
    const projectEpoch = parseId128V2(projectEpochInput)
    try {
      const sharingRecordBytes = await readOptional(this.sharingRecordPath())
      const sharingRecord = sharingRecordBytes ? parseSharingRecord(sharingRecordBytes) : null
      if (sharingRecord && (sharingRecord.receipt.core.projectId !== projectId || sharingRecord.receipt.core.projectEpoch !== projectEpoch)) return Object.freeze({ status: "recovery-required" })
      const tombstoneBytes = await readOptional(this.tombstonePath(projectId, projectEpoch))
      if (tombstoneBytes) {
        const tombstone = parseTombstone(tombstoneBytes)
        if (tombstone.projectId !== projectId || tombstone.projectEpoch !== projectEpoch) {
          return Object.freeze({ status: "recovery-required" })
        }
        if (sharingRecord && sharingRecord.receiptDigest !== tombstone.receiptDigest) return Object.freeze({ status: "recovery-required" })
        return Object.freeze({
          status: "shared",
          sharingGeneration: tombstone.sharingGeneration,
          receiptDigest: tombstone.receiptDigest,
        })
      }
      if (sharingRecord) return Object.freeze({ status: "shared", sharingGeneration: "1", receiptDigest: sharingRecord.receiptDigest })
      const recordBytes = await readOptional(this.projectRecordPath())
      if (!recordBytes) return Object.freeze({ status: "missing" })
      const authority = parseRecord(recordBytes)
      if (authority.binding.core.projectId !== projectId || authority.binding.core.projectEpoch !== projectEpoch) {
        return Object.freeze({ status: "recovery-required" })
      }
      return Object.freeze({ status: "unshared", authority })
    } catch {
      return Object.freeze({ status: "recovery-required" })
    }
  }

  async resolve(projectId: ProjectIdV2, projectEpoch: Id128V2): Promise<"unshared" | "shared" | "ambiguous"> {
    const opened = await this.open(projectId, projectEpoch)
    return opened.status === "unshared" ? "unshared" : opened.status === "shared" ? "shared" : "ambiguous"
  }

  private projectRecordPath() {
    return path.join(this.roots.projectPrivateDirectory, "local-owner-authority-v3.jcs")
  }

  private sharingRecordPath() { return path.join(this.roots.projectPrivateDirectory, "sharing-handoff-v3.jcs") }

  private tombstonePath(projectId: ProjectIdV2, projectEpoch: Id128V2) {
    const key = createHash("sha256").update(`${projectId}\0${projectEpoch}`).digest("hex")
    return path.join(this.roots.deviceAuthorityDirectory, `${key}.jcs`)
  }
}

function parseSharingHandoff(input: DurableProjectSharingHandoffV3): DurableProjectSharingHandoffV3 {
  const receipt = parseProjectSharingHandoffReceiptV3(input.receipt)
  const receiptDigest = parseDigestV2(input.receiptDigest)
  if (receiptDigest !== ordinarySha256V2(encodeRestrictedJcsV2(receipt))) throw new Error("Project sharing handoff receipt digest mismatches exact bytes")
  const teamArtifacts = Object.freeze({
    membershipSnapshotDigest: parseDigestV2(input.teamArtifacts.membershipSnapshotDigest),
    memberCredentialCoreDigest: parseDigestV2(input.teamArtifacts.memberCredentialCoreDigest),
    adminCapabilityCoreDigest: parseDigestV2(input.teamArtifacts.adminCapabilityCoreDigest),
    replicaActorCredentialCoreDigest: parseDigestV2(input.teamArtifacts.replicaActorCredentialCoreDigest),
    replicaEditAuthorizationCoreDigest: parseDigestV2(input.teamArtifacts.replicaEditAuthorizationCoreDigest),
  })
  if (teamArtifacts.membershipSnapshotDigest !== receipt.core.initialMembershipSnapshotDigest ||
    teamArtifacts.memberCredentialCoreDigest !== receipt.core.initialMemberCredentialCoreDigest ||
    teamArtifacts.adminCapabilityCoreDigest !== receipt.core.initialAdminCapabilityCoreDigest ||
    teamArtifacts.replicaActorCredentialCoreDigest !== receipt.core.initialReplicaActorCredentialCoreDigest ||
    teamArtifacts.replicaEditAuthorizationCoreDigest !== receipt.core.initialReplicaEditAuthorizationCoreDigest) throw new Error("Project sharing Team artifact closure mismatches receipt")
  return Object.freeze({ receipt, receiptDigest, teamArtifacts })
}

function parseSharingRecord(bytes: Uint8Array): DurableProjectSharingHandoffV3 {
  const value = decodeRestrictedJcsV2(bytes) as Record<string, unknown>
  if (!value || Object.keys(value).sort().join(",") !== "format,receipt,receiptDigest,sharingGeneration,teamArtifacts" ||
    value.format !== "convax.project-sharing-handoff-record/3" || value.sharingGeneration !== "1") throw new Error("Project sharing handoff record is invalid")
  return parseSharingHandoff({ receipt: value.receipt as ProjectSharingHandoffReceiptV3, receiptDigest: value.receiptDigest as DigestV2, teamArtifacts: value.teamArtifacts as DurableProjectSharingHandoffV3["teamArtifacts"] })
}

function parseAuthority(input: DurableSuccessorLocalOwnerAuthorityV3): DurableSuccessorLocalOwnerAuthorityV3 {
  const binding = parseLocalProjectOwnerBindingV3(input.binding)
  if (!Array.isArray(input.authorizations) || input.authorizations.length < 1 || input.authorizations.length > 257) throw new Error("Local owner authority authorization closure is invalid")
  const authorizations = Object.freeze(input.authorizations.map(parseLocalOwnerEditAuthorizationV3).sort((left, right) =>
    scopeKey(left.core.scope).localeCompare(scopeKey(right.core.scope))))
  for (let index = 0; index < authorizations.length; index += 1) {
    const authorization = authorizations[index]!
    if (index > 0 && scopeKey(authorizations[index - 1]!.core.scope) === scopeKey(authorization.core.scope)) throw new Error("Local owner authority scope is duplicated")
    if (authorization.core.ownerBindingCoreDigest !== binding.coreDigest || authorization.core.projectId !== binding.core.projectId ||
      authorization.core.projectEpoch !== binding.core.projectEpoch || authorization.core.scope.projectId !== binding.core.projectId ||
      authorization.core.scope.projectEpoch !== binding.core.projectEpoch || authorization.core.replicaId !== binding.core.initialReplicaId ||
      authorization.core.actorId !== binding.core.initialActorId || authorization.core.protocolDigest !== binding.core.protocolDigest) {
      throw new Error("Local owner authority record crossed its binding")
    }
  }
  return Object.freeze({ binding, authorizations })
}

function parseRecord(bytes: Uint8Array): DurableSuccessorLocalOwnerAuthorityV3 {
  const value = decodeRestrictedJcsV2(bytes) as Record<string, unknown>
  if (!value || Object.keys(value).sort().join(",") !== "authorizations,binding,format" ||
    value.format !== "convax.project-local-owner-authority-record/3") throw new Error("Local owner authority record is invalid")
  return parseAuthority({ binding: value.binding as LocalProjectOwnerBindingV3, authorizations: value.authorizations as LocalOwnerEditAuthorizationV3[] })
}

function mergeAuthorities(current: DurableSuccessorLocalOwnerAuthorityV3, candidate: DurableSuccessorLocalOwnerAuthorityV3) {
  if (!sameBytes(encodeRestrictedJcsV2(current.binding), encodeRestrictedJcsV2(candidate.binding))) throw new Error("Local owner authority installation equivocation")
  const byScope = new Map(current.authorizations.map((authorization) => [scopeKey(authorization.core.scope), authorization]))
  for (const authorization of candidate.authorizations) {
    const key = scopeKey(authorization.core.scope); const prior = byScope.get(key)
    if (prior && !sameBytes(encodeRestrictedJcsV2(prior), encodeRestrictedJcsV2(authorization))) throw new Error("Local owner authority installation equivocation")
    byScope.set(key, authorization)
  }
  return parseAuthority({ binding: current.binding, authorizations: [...byScope.values()] })
}

function scopeKey(scope: DocumentScopeV2) { return new TextDecoder().decode(encodeRestrictedJcsV2(scope)) }

function parseTombstone(bytes: Uint8Array) {
  const value = decodeRestrictedJcsV2(bytes) as Record<string, unknown>
  if (!value || Object.keys(value).sort().join(",") !== "format,projectEpoch,projectId,receiptDigest,sharingGeneration" ||
    value.format !== "convax.device-project-sharing-tombstone/3") throw new Error("Project sharing tombstone is invalid")
  return Object.freeze({
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    sharingGeneration: parsePositiveGeneration(value.sharingGeneration),
    receiptDigest: parseDigestV2(value.receiptDigest),
  })
}

async function readOptional(target: string): Promise<Uint8Array | null> {
  try {
    const stat = await fs.lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_RECORD_BYTES) throw new Error("Authority record is not a bounded plain file")
    return new Uint8Array(await fs.readFile(target))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function writeCreateOrExact(target: string, bytes: Uint8Array) {
  const existing = await readOptional(target)
  if (existing) {
    if (!sameBytes(existing, bytes)) throw new Error("Local owner authority installation equivocation")
    return
  }
  const handle = await fs.open(target, "wx", 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await fsyncProjectDirectoryV2(path.dirname(target))
}

async function writeReplaceExact(target: string, bytes: Uint8Array) {
  const temporary = `${target}.staging`
  const staged = await readOptional(temporary)
  if (staged) {
    if (!sameBytes(staged, bytes)) throw new Error("Local owner authority staging equivocation")
  } else {
    const handle = await fs.open(temporary, "wx", 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  }
  await fs.rename(temporary, target)
  await fsyncProjectDirectoryV2(path.dirname(target))
}

async function writeReplace(target: string, bytes: Uint8Array, beforeRename?: () => Promise<void>) {
  const temporary = `${target}.staging`
  const staged = await readOptional(temporary)
  if (staged) {
    if (!sameBytes(staged, bytes)) throw new Error("Project sharing tombstone staging equivocation")
  } else {
    const handle = await fs.open(temporary, "wx", 0o600)
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  }
  await beforeRename?.()
  await fs.rename(temporary, target)
  await fsyncProjectDirectoryV2(path.dirname(target))
}

async function ensurePlainDirectory(target: string) {
  try { await fs.mkdir(target, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
  await requirePlainDirectory(target)
}

async function requirePlainDirectory(target: string) {
  const stat = await fs.lstat(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Authority directory is not a plain directory")
}

function requireAbsolute(value: string) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new TypeError("Authority directory must be canonical and absolute")
}

function parsePositiveGeneration(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) throw new TypeError("Sharing generation must be a positive canonical integer")
  return value
}

function compareDecimal(left: string, right: string) {
  return left.length === right.length ? left.localeCompare(right) : left.length - right.length
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}
