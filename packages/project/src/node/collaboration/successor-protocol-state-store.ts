import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseDigestV2,
  parseId128V2,
  parseLocalOwnerEditAuthorizationV3,
  parseLocalProjectOwnerBindingV3,
  parseProjectIdV2,
  parseProtocolPromotionBridgeV3,
  type DigestV2,
  type Id128V2,
  type LocalOwnerEditAuthorizationV3,
  type LocalProjectOwnerBindingV3,
  type ProjectIdV2,
  type ProtocolPromotionBridgeV3,
} from "@convax/collaboration"
import { fsyncProjectDirectoryV2 } from "./directory-durability"

const MAX_RECORD_BYTES = 512 * 1024

export type SuccessorPromotionOriginV3 =
  | Readonly<{ kind: "new-project"; creationClaimDigest: DigestV2 }>
  | Readonly<{
      kind: "v10-r5-unshared"
      r5AuthorityManifestSha256: DigestV2
      verifiedLegacyClosureDigest: DigestV2
    }>

export type SuccessorAuthorizationProofV3 =
  | Readonly<{ kind: "project-index-genesis"; proofDigest: DigestV2 }>
  | Readonly<{ kind: "accepted-project-index-route-genesis"; proofDigest: DigestV2 }>

export interface SuccessorScopedLocalAuthorizationV3 {
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly proof: SuccessorAuthorizationProofV3
}

export interface SuccessorLocalProtocolStateV3 {
  readonly format: "convax.project-protocol-state-local/3"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly protocolDigest: DigestV2
  readonly sharingGeneration: "0"
  readonly origin: SuccessorPromotionOriginV3
  readonly ownerBinding: LocalProjectOwnerBindingV3
  readonly authorizations: readonly SuccessorScopedLocalAuthorizationV3[]
  readonly bridges: readonly ProtocolPromotionBridgeV3[]
}

export interface SuccessorPromotionClaimV3 {
  readonly format: "convax.project-protocol-promotion-claim/3"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly protocolDigest: DigestV2
  readonly activeStateDigest: DigestV2
  readonly promotionId: Id128V2
}

export type OpenSuccessorProjectProtocolStateV3 =
  | Readonly<{ status: "v3-local"; state: SuccessorLocalProtocolStateV3; stateDigest: DigestV2 }>
  | Readonly<{ status: "not-installed" }>
  | Readonly<{ status: "promotion-recovery-required"; claim: SuccessorPromotionClaimV3 }>
  | Readonly<{ status: "recovery-required" }>

export type SuccessorDeviceProtocolHighWaterV3 =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "v3-observed"; stateDigest: DigestV2 }>
  | Readonly<{ status: "recovery-required" }>

/**
 * Project/node owner for the one persisted protocol selection. Candidate V3 bytes
 * become usable only after the immutable closure, device high-water mark and
 * create-only active pointer are all durable. Directory presence alone is inert.
 */
export class NodeSuccessorProjectProtocolStateStoreV3 {
  constructor(private readonly roots: {
    readonly projectPrivateDirectory: string
    readonly deviceProtocolDirectory: string
    readonly faults?: {
      afterClaim?(): Promise<void>
      afterClosure?(): Promise<void>
      afterDeviceRecord?(): Promise<void>
      beforeActivePointer?(): Promise<void>
    }
  }) {
    requireAbsolute(roots.projectPrivateDirectory)
    requireAbsolute(roots.deviceProtocolDirectory)
  }

  async installLocal(input: {
    readonly state: SuccessorLocalProtocolStateV3
    readonly promotionId: Id128V2
  }): Promise<Readonly<{ state: SuccessorLocalProtocolStateV3; stateDigest: DigestV2 }>> {
    const state = parseLocalState(input.state)
    const stateBytes = encodeRestrictedJcsV2(state)
    const stateDigest = ordinarySha256V2(stateBytes)
    const claim = parseClaim({
      format: "convax.project-protocol-promotion-claim/3",
      projectId: state.projectId,
      projectEpoch: state.projectEpoch,
      protocolDigest: state.protocolDigest,
      activeStateDigest: stateDigest,
      promotionId: parseId128V2(input.promotionId),
    })
    await ensurePlainDirectory(this.stateDirectory())
    await writeCreateOrExact(this.claimPath(), encodeRestrictedJcsV2(claim), "Protocol promotion claim equivocation")
    await this.roots.faults?.afterClaim?.()
    await writeCreateOrExact(this.closurePath(stateDigest), stateBytes, "Protocol promotion closure equivocation")
    await this.roots.faults?.afterClosure?.()
    await ensurePlainDirectory(this.roots.deviceProtocolDirectory)
    await writeCreateOrExact(
      this.deviceRecordPath(state.projectId, state.projectEpoch),
      encodeRestrictedJcsV2(deviceRecord(state, stateDigest)),
      "Device protocol high-water equivocation",
    )
    await this.roots.faults?.afterDeviceRecord?.()
    await this.roots.faults?.beforeActivePointer?.()
    await writeCreateOrExact(this.activePath(), encodeRestrictedJcsV2(activePointer(state, stateDigest)), "Protocol active pointer equivocation")
    return Object.freeze({ state, stateDigest })
  }

  async recoverPromotion(): Promise<OpenSuccessorProjectProtocolStateV3> {
    try {
      const claimBytes = await readOptional(this.claimPath())
      if (!claimBytes) return Object.freeze({ status: "not-installed" })
      const claim = parseClaim(decodeRestrictedJcsV2(claimBytes))
      const closureBytes = await readOptional(this.closurePath(claim.activeStateDigest))
      if (!closureBytes || ordinarySha256V2(closureBytes) !== claim.activeStateDigest) return Object.freeze({ status: "recovery-required" })
      const state = parseLocalState(decodeRestrictedJcsV2(closureBytes))
      if (state.projectId !== claim.projectId || state.projectEpoch !== claim.projectEpoch || state.protocolDigest !== claim.protocolDigest) {
        return Object.freeze({ status: "recovery-required" })
      }
      const device = await readOptional(this.deviceRecordPath(state.projectId, state.projectEpoch))
      if (!device) return Object.freeze({ status: "promotion-recovery-required", claim })
      requireDeviceRecord(device, state, claim.activeStateDigest)
      await writeCreateOrExact(this.activePath(), encodeRestrictedJcsV2(activePointer(state, claim.activeStateDigest)), "Protocol active pointer equivocation")
      return this.open(state.projectId)
    } catch {
      return Object.freeze({ status: "recovery-required" })
    }
  }

  async open(projectIdInput: ProjectIdV2): Promise<OpenSuccessorProjectProtocolStateV3> {
    const projectId = parseProjectIdV2(projectIdInput)
    try {
      const activeBytes = await readOptional(this.activePath())
      if (!activeBytes) {
        const claimBytes = await readOptional(this.claimPath())
        return claimBytes
          ? Object.freeze({ status: "promotion-recovery-required", claim: parseClaim(decodeRestrictedJcsV2(claimBytes)) })
          : Object.freeze({ status: "not-installed" })
      }
      const active = parseActivePointer(decodeRestrictedJcsV2(activeBytes))
      if (active.projectId !== projectId) return Object.freeze({ status: "recovery-required" })
      const closureBytes = await readOptional(this.closurePath(active.stateDigest))
      if (!closureBytes || ordinarySha256V2(closureBytes) !== active.stateDigest) return Object.freeze({ status: "recovery-required" })
      const state = parseLocalState(decodeRestrictedJcsV2(closureBytes))
      if (state.projectId !== active.projectId || state.projectEpoch !== active.projectEpoch || state.protocolDigest !== active.protocolDigest) {
        return Object.freeze({ status: "recovery-required" })
      }
      const device = await readOptional(this.deviceRecordPath(state.projectId, state.projectEpoch))
      if (!device) return Object.freeze({ status: "recovery-required" })
      requireDeviceRecord(device, state, active.stateDigest)
      return Object.freeze({ status: "v3-local", state, stateDigest: active.stateDigest })
    } catch {
      return Object.freeze({ status: "recovery-required" })
    }
  }

  /**
   * Project-external anti-rollback evidence must be consulted before rebuilding an
   * absent Project directory. A present V3 record cannot be interpreted as a fresh
   * V10/new Project merely because its matching active pointer is missing.
   */
  async inspectDeviceHighWater(projectIdInput: ProjectIdV2, projectEpochInput: Id128V2): Promise<SuccessorDeviceProtocolHighWaterV3> {
    const projectId = parseProjectIdV2(projectIdInput)
    const projectEpoch = parseId128V2(projectEpochInput)
    try {
      const bytes = await readOptional(this.deviceRecordPath(projectId, projectEpoch))
      if (!bytes) return Object.freeze({ status: "absent" })
      const record = parseDeviceRecord(bytes)
      if (record.projectId !== projectId || record.projectEpoch !== projectEpoch) return Object.freeze({ status: "recovery-required" })
      return Object.freeze({ status: "v3-observed", stateDigest: record.stateDigest })
    } catch {
      return Object.freeze({ status: "recovery-required" })
    }
  }

  private stateDirectory() { return path.join(this.roots.projectPrivateDirectory, "protocol-v3") }
  private claimPath() { return path.join(this.stateDirectory(), "promotion-claim.jcs") }
  private activePath() { return path.join(this.stateDirectory(), "active.jcs") }
  private closurePath(digest: DigestV2) { return path.join(this.stateDirectory(), `state-${digest}.jcs`) }
  private deviceRecordPath(projectId: ProjectIdV2, projectEpoch: Id128V2) {
    return path.join(this.roots.deviceProtocolDirectory, `${ordinarySha256V2(new TextEncoder().encode(`${projectId}\0${projectEpoch}`))}.jcs`)
  }
}

function parseLocalState(value: unknown): SuccessorLocalProtocolStateV3 {
  exactObject(value, [
    "format", "projectId", "projectEpoch", "protocolDigest", "sharingGeneration",
    "origin", "ownerBinding", "authorizations", "bridges",
  ], "Successor local protocol state")
  if (value.format !== "convax.project-protocol-state-local/3" || value.sharingGeneration !== "0") throw new Error("Successor local protocol state discriminator is invalid")
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const protocolDigest = parseDigestV2(value.protocolDigest)
  const ownerBinding = parseLocalProjectOwnerBindingV3(value.ownerBinding)
  if (ownerBinding.core.projectId !== projectId || ownerBinding.core.projectEpoch !== projectEpoch || ownerBinding.core.protocolDigest !== protocolDigest) {
    throw new Error("Successor local protocol state crossed its owner binding")
  }
  const origin = parseOrigin(value.origin)
  if (!Array.isArray(value.authorizations) || value.authorizations.length < 1 || value.authorizations.length > 257) throw new Error("Successor local authorization closure is invalid")
  const authorizations = value.authorizations.map((item) => parseScopedAuthorization(item, ownerBinding))
  const scopeKeys = authorizations.map((item) => scopeKey(item.authorization.core.scope))
  requireStrictlySorted(scopeKeys, "Successor local authorization scopes")
  const projectIndex = authorizations.filter((item) => item.authorization.core.scope.docKind === "project-index")
  if (projectIndex.length !== 1 || projectIndex[0]!.proof.kind !== "project-index-genesis") throw new Error("Successor local state requires one exact ProjectIndex genesis authorization")
  if (origin.kind === "new-project" && authorizations.filter((item) => item.authorization.core.scope.docKind === "canvas").length !== 1) {
    throw new Error("New Project successor state requires one default Canvas route authorization")
  }
  if (!Array.isArray(value.bridges) || value.bridges.length !== authorizations.length) throw new Error("Successor promotion bridge closure is incomplete")
  const bridges = value.bridges.map(parseProtocolPromotionBridgeV3)
  const bridgeScopeKeys = bridges.map((bridge) => scopeKey(bridge.core.scope))
  requireStrictlySorted(bridgeScopeKeys, "Successor promotion bridge scopes")
  let promotedDefaultCanvasCount = 0
  for (let index = 0; index < authorizations.length; index += 1) {
    const authorization = authorizations[index]!
    const bridge = bridges[index]!
    if (
      scopeKey(authorization.authorization.core.scope) !== scopeKey(bridge.core.scope) ||
      bridge.core.projectId !== projectId || bridge.core.projectEpoch !== projectEpoch ||
      bridge.core.successorProtocolDigest !== protocolDigest ||
      bridge.core.signerAuthority.kind !== "local-project-owner" ||
      bridge.core.signerAuthority.ownerBindingCoreDigest !== ownerBinding.coreDigest
    ) throw new Error("Successor promotion bridge closure crossed its authorization")
    if (origin.kind === "new-project" && bridge.core.source.kind !== "new-project") throw new Error("New Project promotion source mismatches")
    if (origin.kind === "v10-r5-unshared" && bridge.core.source.kind !== "v10-r5") {
      if (bridge.core.source.kind !== "new-project" || authorization.authorization.core.scope.docKind !== "canvas" ||
        authorization.proof.kind !== "accepted-project-index-route-genesis") throw new Error("R5 promotion source mismatches")
      promotedDefaultCanvasCount += 1
    }
  }
  if (promotedDefaultCanvasCount > 1 || (promotedDefaultCanvasCount === 1 && authorizations.filter((item) => item.authorization.core.scope.docKind === "canvas").length !== 1)) {
    throw new Error("R5 empty Project promotion may create only one default Canvas")
  }
  return Object.freeze({
    format: value.format,
    projectId,
    projectEpoch,
    protocolDigest,
    sharingGeneration: value.sharingGeneration,
    origin,
    ownerBinding,
    authorizations: Object.freeze(authorizations),
    bridges: Object.freeze(bridges),
  })
}

function parseOrigin(value: unknown): SuccessorPromotionOriginV3 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Successor promotion origin is invalid")
  const source = value as Record<string, unknown>
  if (source.kind === "new-project") {
    exactObject(source, ["kind", "creationClaimDigest"], "New Project promotion origin")
    return Object.freeze({ kind: source.kind, creationClaimDigest: parseDigestV2(source.creationClaimDigest) })
  }
  if (source.kind === "v10-r5-unshared") {
    exactObject(source, ["kind", "r5AuthorityManifestSha256", "verifiedLegacyClosureDigest"], "R5 promotion origin")
    return Object.freeze({
      kind: source.kind,
      r5AuthorityManifestSha256: parseDigestV2(source.r5AuthorityManifestSha256),
      verifiedLegacyClosureDigest: parseDigestV2(source.verifiedLegacyClosureDigest),
    })
  }
  throw new Error("Successor promotion origin kind is invalid")
}

function parseScopedAuthorization(value: unknown, binding: LocalProjectOwnerBindingV3): SuccessorScopedLocalAuthorizationV3 {
  exactObject(value, ["authorization", "proof"], "Scoped local owner authorization")
  const authorization = parseLocalOwnerEditAuthorizationV3(value.authorization)
  if (
    authorization.core.ownerBindingCoreDigest !== binding.coreDigest ||
    authorization.core.projectId !== binding.core.projectId ||
    authorization.core.projectEpoch !== binding.core.projectEpoch ||
    authorization.core.protocolDigest !== binding.core.protocolDigest ||
    authorization.core.replicaId !== binding.core.initialReplicaId ||
    authorization.core.actorId !== binding.core.initialActorId
  ) throw new Error("Scoped local owner authorization crossed its binding")
  const proof = parseAuthorizationProof(value.proof)
  if (authorization.core.scope.docKind === "project-index" && proof.kind !== "project-index-genesis") throw new Error("ProjectIndex authorization requires genesis proof")
  if (authorization.core.scope.docKind === "canvas" && proof.kind !== "accepted-project-index-route-genesis") throw new Error("Canvas authorization requires accepted ProjectIndex route proof")
  return Object.freeze({ authorization, proof })
}

function parseAuthorizationProof(value: unknown): SuccessorAuthorizationProofV3 {
  exactObject(value, ["kind", "proofDigest"], "Successor authorization proof")
  if (value.kind !== "project-index-genesis" && value.kind !== "accepted-project-index-route-genesis") throw new Error("Successor authorization proof kind is invalid")
  return Object.freeze({ kind: value.kind, proofDigest: parseDigestV2(value.proofDigest) })
}

function parseClaim(value: unknown): SuccessorPromotionClaimV3 {
  exactObject(value, ["format", "projectId", "projectEpoch", "protocolDigest", "activeStateDigest", "promotionId"], "Protocol promotion claim")
  if (value.format !== "convax.project-protocol-promotion-claim/3") throw new Error("Protocol promotion claim format is invalid")
  return Object.freeze({
    format: value.format,
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    protocolDigest: parseDigestV2(value.protocolDigest),
    activeStateDigest: parseDigestV2(value.activeStateDigest),
    promotionId: parseId128V2(value.promotionId),
  })
}

function activePointer(state: SuccessorLocalProtocolStateV3, stateDigest: DigestV2) {
  return Object.freeze({
    format: "convax.project-protocol-active/3",
    projectId: state.projectId,
    projectEpoch: state.projectEpoch,
    protocolDigest: state.protocolDigest,
    stateDigest,
    writerKind: "local-project-owner",
    sharingGeneration: "0",
  })
}

function parseActivePointer(value: unknown) {
  exactObject(value, ["format", "projectId", "projectEpoch", "protocolDigest", "stateDigest", "writerKind", "sharingGeneration"], "Protocol active pointer")
  if (value.format !== "convax.project-protocol-active/3" || value.writerKind !== "local-project-owner" || value.sharingGeneration !== "0") throw new Error("Protocol active pointer is invalid")
  return Object.freeze({
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    protocolDigest: parseDigestV2(value.protocolDigest),
    stateDigest: parseDigestV2(value.stateDigest),
  })
}

function deviceRecord(state: SuccessorLocalProtocolStateV3, stateDigest: DigestV2) {
  return Object.freeze({
    format: "convax.device-project-protocol-high-water/3",
    projectId: state.projectId,
    projectEpoch: state.projectEpoch,
    protocolMajor: "3",
    sharingGeneration: "0",
    stateDigest,
  })
}

function requireDeviceRecord(bytes: Uint8Array, state: SuccessorLocalProtocolStateV3, stateDigest: DigestV2) {
  const value = parseDeviceRecord(bytes)
  if (
    value.projectId !== state.projectId || value.projectEpoch !== state.projectEpoch ||
    value.stateDigest !== stateDigest
  ) throw new Error("Device protocol high-water mismatches active Project state")
}

function parseDeviceRecord(bytes: Uint8Array) {
  const value = decodeRestrictedJcsV2(bytes)
  exactObject(value, ["format", "projectId", "projectEpoch", "protocolMajor", "sharingGeneration", "stateDigest"], "Device protocol high-water")
  if (
    value.format !== "convax.device-project-protocol-high-water/3" ||
    value.protocolMajor !== "3" || value.sharingGeneration !== "0"
  ) throw new Error("Device protocol high-water is invalid")
  return Object.freeze({
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    stateDigest: parseDigestV2(value.stateDigest),
  })
}

function scopeKey(scope: LocalOwnerEditAuthorizationV3["core"]["scope"]): string {
  return new TextDecoder().decode(encodeRestrictedJcsV2(scope))
}

function requireStrictlySorted(values: readonly string[], label: string) {
  for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) throw new Error(`${label} must be strictly sorted and duplicate-free`)
}

function exactObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} keys differ`)
}

async function readOptional(target: string): Promise<Uint8Array | null> {
  try {
    const stat = await fs.lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_RECORD_BYTES) throw new Error("Protocol record is not a bounded plain file")
    return new Uint8Array(await fs.readFile(target))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

async function writeCreateOrExact(target: string, bytes: Uint8Array, equivocation: string) {
  const existing = await readOptional(target)
  if (existing) {
    if (!sameBytes(existing, bytes)) throw new Error(equivocation)
    return
  }
  const handle = await fs.open(target, "wx", 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await fsyncProjectDirectoryV2(path.dirname(target))
}

async function ensurePlainDirectory(target: string) {
  try { await fs.mkdir(target, { recursive: false, mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
  const stat = await fs.lstat(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Protocol directory is not a plain directory")
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

function requireAbsolute(value: string) {
  if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new TypeError("Protocol directory must be canonical and absolute")
}
