import { randomBytes } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseValidationArtifactSetV2,
  structuredDigestV2,
  type ActorIdV2,
  type DigestV2,
  type Ed25519VerifierPortV2,
  type Id128V2,
  type MemberIdV2,
  type ProjectIdV2,
  type PublicKeyV2,
  type ReplicaIdV2,
  type ReplicaSignerPortV2,
  type ValidationArtifactSetV2,
  type VerifiedProtocolAuthorityV2,
} from "@convax/collaboration"

import type { ElectronReplicaSigningVaultV2 } from "./electron-replica-signing-vault"

const CLAIM_FORMAT = "convax.desktop-local-project-owner-claim/2" as const
const BINDING_FORMAT = "convax.desktop-local-project-owner-binding/2" as const

interface LocalProjectOwnerClaimV2 {
  readonly format: typeof CLAIM_FORMAT
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly projectIndexShardEpoch: Id128V2
  readonly memberId: MemberIdV2
  readonly replicaId: ReplicaIdV2
  readonly localConfirmationKeyId: string
  readonly genesisOperationId: Id128V2
  readonly genesisCheckpointId: Id128V2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
}

export interface DurableLocalProjectOwnerBindingV2 extends Omit<LocalProjectOwnerClaimV2, "format"> {
  readonly format: typeof BINDING_FORMAT
  readonly actorId: ActorIdV2
  readonly publicKey: PublicKeyV2
  readonly bindingDigest: DigestV2
}

export interface ResolvedLocalProjectOwnerAuthorityV2 {
  readonly binding: DurableLocalProjectOwnerBindingV2
  readonly signer: ReplicaSignerPortV2
  readonly validationArtifacts: ValidationArtifactSetV2
}

export interface DurableLocalProjectOwnerAuthorityResolverV2 {
  ensureForDurableProject(input: {
    readonly projectId: ProjectIdV2
    readonly projectRoot: string
  }): Promise<ResolvedLocalProjectOwnerAuthorityV2>
  resolveExact(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly initializationAuthorityDigest: DigestV2
  }): Promise<ResolvedLocalProjectOwnerAuthorityV2 | "missing" | "rejected">
}

export interface LocalProjectOwnerAuthorityFaultsV2 {
  afterClaimFsync?(): Promise<void>
  afterVaultKey?(): Promise<void>
  afterBindingFsync?(): Promise<void>
}

/**
 * Main-private local owner authority. A claim makes random epoch/replica choices
 * retry-stable; the immutable binding is published before any Project bytes use
 * it. Project paths are deliberately absent because a Project may move/rebind.
 */
export class NodeDurableLocalProjectOwnerAuthorityV2
  implements DurableLocalProjectOwnerAuthorityResolverV2
{
  private readonly validationArtifacts: ValidationArtifactSetV2
  private readonly validationArtifactSetDigest: DigestV2

  constructor(private readonly options: {
    readonly rootDirectory: string
    readonly authority: VerifiedProtocolAuthorityV2
    readonly schemaDigest: DigestV2
    readonly projects: { resolveProjectRoot(input: { readonly projectId: string }): Promise<string> }
    readonly vault: Pick<ElectronReplicaSigningVaultV2, "createReplicaKey" | "openSigner">
    readonly verifier: Ed25519VerifierPortV2
    readonly createId?: () => Id128V2
    readonly createReplicaId?: () => ReplicaIdV2
    readonly faults?: LocalProjectOwnerAuthorityFaultsV2
  }) {
    if (!path.isAbsolute(options.rootDirectory)) throw new TypeError("Local Project owner root must be absolute")
    this.validationArtifacts = protocolValidationArtifacts(options.authority)
    this.validationArtifactSetDigest = structuredDigestV2(
      "convax.validation-artifact-set/2",
      this.validationArtifacts,
    )
  }

  async ensureForDurableProject(input: {
    readonly projectId: ProjectIdV2
    readonly projectRoot: string
  }): Promise<ResolvedLocalProjectOwnerAuthorityV2> {
    const projectId = parseProjectIdV2(input.projectId)
    const durableRoot = await fs.realpath(await this.options.projects.resolveProjectRoot({ projectId }))
    const requestedRoot = await fs.realpath(input.projectRoot)
    if (durableRoot !== requestedRoot) throw new Error("Local Project owner crossed the durable Project binding")
    await ensureLayout(this.options.rootDirectory)
    const selector = selectorDigest(projectId, this.options.authority.protocolDigest)
    const bindingTarget = path.join(this.options.rootDirectory, "bindings", `${selector}.jcs`)
    const existing = await readOptionalPlainFile(bindingTarget)
    if (existing) return this.openBinding(existing, projectId, bindingTarget)

    const claimTarget = path.join(this.options.rootDirectory, "claims", `${selector}.jcs`)
    let claimBytes = await readOptionalPlainFile(claimTarget)
    if (!claimBytes) {
      const claim = this.newClaim(projectId)
      claimBytes = encodeRestrictedJcsV2(claim)
      try { await writeImmutable(claimTarget, claimBytes) } catch (error) {
        if (!isAlreadyExists(error)) throw error
        claimBytes = requireBytes(await readOptionalPlainFile(claimTarget), "Local Project owner claim disappeared")
      }
      await this.options.faults?.afterClaimFsync?.()
    }
    const claim = parseClaimExact(claimBytes, this.expectedAuthority(projectId))
    const key = await this.options.vault.createReplicaKey({
      projectId: claim.projectId,
      projectEpoch: claim.projectEpoch,
      replicaId: claim.replicaId,
    })
    await this.options.faults?.afterVaultKey?.()
    const actorId = parseActorIdV2(key.publicKey)
    const bindingWithoutDigest = Object.freeze({
      ...claim,
      format: BINDING_FORMAT,
      actorId,
      publicKey: parsePublicKeyV2(key.publicKey),
    })
    const binding = Object.freeze({
      ...bindingWithoutDigest,
      bindingDigest: bindingDigest(bindingWithoutDigest),
    })
    const bindingBytes = encodeRestrictedJcsV2(binding)
    try { await writeImmutable(bindingTarget, bindingBytes) } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    await this.options.faults?.afterBindingFsync?.()
    return this.openBinding(
      requireBytes(await readOptionalPlainFile(bindingTarget), "Local Project owner binding disappeared"),
      projectId,
      bindingTarget,
    )
  }

  async resolveExact(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly initializationAuthorityDigest: DigestV2
  }): Promise<ResolvedLocalProjectOwnerAuthorityV2 | "missing" | "rejected"> {
    let projectId: ProjectIdV2
    try { projectId = parseProjectIdV2(input.projectId) } catch { return "rejected" }
    const selector = selectorDigest(projectId, this.options.authority.protocolDigest)
    const target = path.join(this.options.rootDirectory, "bindings", `${selector}.jcs`)
    try {
      const bytes = await readOptionalPlainFile(target)
      if (!bytes) return "missing"
      const opened = await this.openBinding(bytes, projectId, target)
      if (
        opened.binding.projectEpoch !== parseId128V2(input.projectEpoch) ||
        opened.binding.bindingDigest !== parseDigestV2(input.initializationAuthorityDigest)
      ) return "rejected"
      return opened
    } catch {
      return "rejected"
    }
  }

  async verifyCheckpointSignature(
    binding: DurableLocalProjectOwnerBindingV2,
    coreDigest: DigestV2,
    signature: string,
  ): Promise<boolean> {
    return this.verifySignature(binding, Buffer.from(parseDigestV2(coreDigest), "hex"), signature)
  }

  async verifySignature(
    binding: DurableLocalProjectOwnerBindingV2,
    message: Uint8Array,
    signature: string,
  ): Promise<boolean> {
    const current = await this.resolveExact({
      projectId: binding.projectId,
      projectEpoch: binding.projectEpoch,
      initializationAuthorityDigest: binding.bindingDigest,
    })
    if (current === "missing" || current === "rejected") return false
    return this.options.verifier.verify(
      Buffer.from(current.binding.publicKey, "base64url"),
      Buffer.from(signature, "base64url"),
      message,
    )
  }

  private async openBinding(
    bytes: Uint8Array,
    projectId: ProjectIdV2,
    _target: string,
  ): Promise<ResolvedLocalProjectOwnerAuthorityV2> {
    const binding = parseBindingExact(bytes, this.expectedAuthority(projectId))
    const signer = await this.options.vault.openSigner({
      projectId: binding.projectId,
      projectEpoch: binding.projectEpoch,
      replicaId: binding.replicaId,
      expectedPublicKey: binding.publicKey,
    })
    if (signer === "missing" || signer === "unavailable" || signer === "rejected") {
      throw new Error(`Local Project owner vault is ${signer}`)
    }
    return Object.freeze({ binding, signer, validationArtifacts: this.validationArtifacts })
  }

  private newClaim(projectId: ProjectIdV2): LocalProjectOwnerClaimV2 {
    const createId = this.options.createId ?? (() => parseId128V2(randomBytes(16).toString("base64url")))
    const createReplicaId = this.options.createReplicaId ?? (() => parseReplicaIdV2(`replica_${randomBytes(4).toString("hex")}`))
    return Object.freeze({
      format: CLAIM_FORMAT,
      projectId,
      projectEpoch: createId(),
      projectIndexShardEpoch: createId(),
      memberId: parseMemberIdV2(createId()),
      replicaId: createReplicaId(),
      localConfirmationKeyId: `local-owner-${projectId}`.slice(0, 128),
      genesisOperationId: createId(),
      genesisCheckpointId: createId(),
      protocolDigest: this.options.authority.protocolDigest,
      schemaDigest: parseDigestV2(this.options.schemaDigest),
      uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
      validationArtifactSetDigest: this.validationArtifactSetDigest,
    })
  }

  private expectedAuthority(projectId: ProjectIdV2) {
    return Object.freeze({
      projectId,
      protocolDigest: this.options.authority.protocolDigest,
      schemaDigest: parseDigestV2(this.options.schemaDigest),
      uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
      validationArtifactSetDigest: this.validationArtifactSetDigest,
    })
  }
}

type ExpectedAuthorityV2 = ReturnType<NodeDurableLocalProjectOwnerAuthorityV2["expectedAuthority"]>

function parseClaimExact(bytes: Uint8Array, expected: ExpectedAuthorityV2): LocalProjectOwnerClaimV2 {
  const value = decodeRestrictedJcsV2(bytes)
  const claim = parseClaim(value, CLAIM_FORMAT, expected)
  if (!sameBytes(bytes, encodeRestrictedJcsV2(claim))) throw new Error("Local Project owner claim is noncanonical")
  return claim
}

function parseBindingExact(bytes: Uint8Array, expected: ExpectedAuthorityV2): DurableLocalProjectOwnerBindingV2 {
  const value = decodeRestrictedJcsV2(bytes)
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Local Project owner binding is invalid")
  const record = value as Record<string, unknown>
  assertExactKeys(record, [...claimKeys(), "actorId", "publicKey", "bindingDigest"])
  const claim = parseClaim(record, BINDING_FORMAT, expected)
  const bindingWithoutDigest = Object.freeze({
    ...claim,
    format: BINDING_FORMAT,
    actorId: parseActorIdV2(record.actorId),
    publicKey: parsePublicKeyV2(record.publicKey),
  })
  if (String(bindingWithoutDigest.actorId) !== String(bindingWithoutDigest.publicKey)) {
    throw new Error("Local Project owner actor does not equal its signing public key")
  }
  const binding = Object.freeze({
    ...bindingWithoutDigest,
    bindingDigest: parseDigestV2(record.bindingDigest),
  })
  if (binding.bindingDigest !== bindingDigest(bindingWithoutDigest)) throw new Error("Local Project owner binding digest mismatches")
  if (!sameBytes(bytes, encodeRestrictedJcsV2(binding))) throw new Error("Local Project owner binding is noncanonical")
  return binding
}

function parseClaim(
  value: unknown,
  format: typeof CLAIM_FORMAT | typeof BINDING_FORMAT,
  expected: ExpectedAuthorityV2,
): LocalProjectOwnerClaimV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Local Project owner claim is invalid")
  const record = value as Record<string, unknown>
  if (format === CLAIM_FORMAT) assertExactKeys(record, claimKeys())
  if (record.format !== format) throw new Error("Local Project owner format is invalid")
  const claim = Object.freeze({
    format: CLAIM_FORMAT,
    projectId: parseProjectIdV2(record.projectId),
    projectEpoch: parseId128V2(record.projectEpoch),
    projectIndexShardEpoch: parseId128V2(record.projectIndexShardEpoch),
    memberId: parseMemberIdV2(record.memberId),
    replicaId: parseReplicaIdV2(record.replicaId),
    localConfirmationKeyId: requireKeyId(record.localConfirmationKeyId),
    genesisOperationId: parseId128V2(record.genesisOperationId),
    genesisCheckpointId: parseId128V2(record.genesisCheckpointId),
    protocolDigest: parseDigestV2(record.protocolDigest),
    schemaDigest: parseDigestV2(record.schemaDigest),
    uriProtocolDigest: parseDigestV2(record.uriProtocolDigest),
    validationArtifactSetDigest: parseDigestV2(record.validationArtifactSetDigest),
  })
  if (
    claim.projectId !== expected.projectId || claim.protocolDigest !== expected.protocolDigest ||
    claim.schemaDigest !== expected.schemaDigest || claim.uriProtocolDigest !== expected.uriProtocolDigest ||
    claim.validationArtifactSetDigest !== expected.validationArtifactSetDigest
  ) throw new Error("Local Project owner claim crossed authority")
  return claim
}

function protocolValidationArtifacts(authority: VerifiedProtocolAuthorityV2): ValidationArtifactSetV2 {
  const owners = ["canvas", "kernel", "control-plane", "project-index"] as const
  const artifacts = authority.protocolSchemaBundle.core.artifacts.map((artifact, index) => ({
    owner: owners[index],
    format: artifact.format,
    artifactDigest: artifact.artifactDigest,
  })).sort((left, right) => String(left.owner).localeCompare(String(right.owner)))
  return parseValidationArtifactSetV2({
    format: "convax.validation-artifact-set/2",
    artifacts,
  })
}

function bindingDigest(binding: Omit<DurableLocalProjectOwnerBindingV2, "bindingDigest">): DigestV2 {
  return ordinarySha256V2(encodeRestrictedJcsV2(binding))
}

function selectorDigest(projectId: ProjectIdV2, protocolDigest: DigestV2): DigestV2 {
  return structuredDigestV2("convax.desktop-local-project-owner-selector/2", {
    format: "convax.desktop-local-project-owner-selector/2",
    projectId,
    protocolDigest,
  })
}

function claimKeys(): string[] {
  return [
    "format", "projectId", "projectEpoch", "projectIndexShardEpoch", "memberId", "replicaId",
    "localConfirmationKeyId",
    "genesisOperationId", "genesisCheckpointId", "protocolDigest", "schemaDigest",
    "uriProtocolDigest", "validationArtifactSetDigest",
  ]
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    throw new Error("Local Project owner record has unsupported fields")
  }
}

function requireKeyId(value: unknown): string {
  if (typeof value !== "string" || value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") < 1 || Buffer.byteLength(value, "utf8") > 128) {
    throw new Error("Local Project owner confirmation key id is invalid")
  }
  return value
}

async function ensureLayout(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "claims"), { recursive: true, mode: 0o700 })
  await fs.mkdir(path.join(root, "bindings"), { recursive: true, mode: 0o700 })
  for (const directory of [root, path.join(root, "claims"), path.join(root, "bindings")]) {
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Local Project owner directory is untrusted")
  }
}

async function writeImmutable(target: string, bytes: Uint8Array): Promise<void> {
  const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  const directory = await fs.open(path.dirname(target), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { await directory.sync() } finally { await directory.close() }
}

async function readOptionalPlainFile(target: string): Promise<Uint8Array | null> {
  try {
    const stat = await fs.lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 64 * 1024) {
      throw new Error("Local Project owner record is not a bounded plain file")
    }
    return new Uint8Array(await fs.readFile(target))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

function requireBytes(value: Uint8Array | null, message: string): Uint8Array {
  if (!value) throw new Error(message)
  return value
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST"
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}
