import { randomBytes } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcs,
  encodeBase64url,
  encodeRestrictedJcs,
  ordinarySha256,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSignature,
  parseValidationArtifactSet,
  structuredDigest,
  type ActorId,
  type Digest,
  type Ed25519VerifierPort,
  type Id128,
  type MemberId,
  type ProjectId,
  type PublicKey,
  type ReplicaId,
  type ReplicaSignerPort,
  type ValidationArtifactSet,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import {
  IMMEDIATE_PREDECESSOR_PROTOCOL,
  immediatePredecessorLocalOwnerEditAuthorizationCoreDigest,
  type ImmediatePredecessorCheckpointSignatureVerifier,
  type ImmediatePredecessorSignatureVerifier,
} from "@convax/collaboration/migration"

import type { ElectronReplicaSigningVault } from "./electron-replica-signing-vault"
import { syncDirectoryEntry, syncFileBytes } from "./filesystem-durability"

const CLAIM_FORMAT = "convax.desktop-local-project-owner-claim" as const
const BINDING_FORMAT = "convax.desktop-local-project-owner-binding" as const

interface LocalProjectOwnerClaim {
  readonly format: typeof CLAIM_FORMAT
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly projectIndexShardEpoch: Id128
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly localConfirmationKeyId: string
  readonly genesisOperationId: Id128
  readonly genesisCheckpointId: Id128
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly uriProtocolDigest: Digest
  readonly validationArtifactSetDigest: Digest
}

export interface DurableLocalProjectOwnerBinding extends Omit<LocalProjectOwnerClaim, "format"> {
  readonly format: typeof BINDING_FORMAT
  readonly actorId: ActorId
  readonly publicKey: PublicKey
  readonly bindingDigest: Digest
}

export interface ResolvedLocalProjectOwnerAuthority {
  readonly binding: DurableLocalProjectOwnerBinding
  readonly bindingExactBytes: Readonly<Uint8Array>
  readonly signer: ReplicaSignerPort
  readonly validationArtifacts: ValidationArtifactSet
}

export interface ResolvedLocalProjectOwnerBinding {
  readonly binding: DurableLocalProjectOwnerBinding
  readonly bindingExactBytes: Readonly<Uint8Array>
  readonly validationArtifacts: ValidationArtifactSet
}

export interface PreparedLocalProjectOwnerReset {
  readonly owner: ResolvedLocalProjectOwnerAuthority
  readonly previousBindingDigest: Digest | null
  readonly resetId: string
  readonly resetSelector: Digest
}

export interface PreparedImmediatePredecessorLocalOwnerMigrationAuthority {
  readonly predecessor: ResolvedLocalProjectOwnerBinding
  readonly predecessorSignatures:
    ImmediatePredecessorSignatureVerifier & ImmediatePredecessorCheckpointSignatureVerifier
  /** Existing current owner, if one was already durably activated by an earlier retry. */
  readonly currentOwner: ResolvedLocalProjectOwnerAuthority | null
}

export interface ActivatedImmediatePredecessorLocalOwnerMigrationAuthority {
  readonly currentOwner: ResolvedLocalProjectOwnerAuthority
  readonly migrationOperationId: Id128
}

export interface DurableLocalProjectOwnerAuthorityResolver {
  ensureForDurableProject(input: {
    readonly projectId: ProjectId
    readonly projectRoot: string
  }): Promise<ResolvedLocalProjectOwnerAuthority>
  resolveCurrent(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
  }): Promise<ResolvedLocalProjectOwnerAuthority | "missing" | "rejected">
  resolveBindingExact(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly ownerBindingDigest: Digest
  }): Promise<ResolvedLocalProjectOwnerBinding | "missing" | "rejected">
}

export interface LocalProjectOwnerAuthorityFaults {
  afterClaimFsync?(): Promise<void>
  afterVaultKey?(): Promise<void>
  afterBindingFsync?(): Promise<void>
  afterRetiredBindingFsync?(): Promise<void>
  afterCurrentBindingFsync?(): Promise<void>
}

export interface LocalProjectOwnerAuthorityChange {
  readonly projectId: ProjectId
  readonly bindingDigest: Digest
}

/**
 * Main-private local owner authority. A claim makes random epoch/replica choices
 * retry-stable; the immutable binding is published before any Project bytes use
 * it. Project paths are deliberately absent because a Project may move/rebind.
 */
export class NodeDurableLocalProjectOwnerAuthority implements DurableLocalProjectOwnerAuthorityResolver {
  private readonly validationArtifacts: ValidationArtifactSet
  private readonly validationArtifactSetDigest: Digest
  private readonly currentChangeListeners = new Set<(change: LocalProjectOwnerAuthorityChange) => void>()
  private readonly predecessorMigrationPreparations = new WeakSet<object>()

  constructor(
    private readonly options: {
      readonly rootDirectory: string
      readonly authority: CurrentProtocolAuthority
      readonly schemaDigest: Digest
      readonly projects: { resolveProjectRoot(input: { readonly projectId: string }): Promise<string> }
      readonly vault: Pick<ElectronReplicaSigningVault, "createReplicaKey" | "openSigner">
      readonly verifier: Ed25519VerifierPort
      readonly createId?: () => Id128
      readonly createReplicaId?: () => ReplicaId
      readonly faults?: LocalProjectOwnerAuthorityFaults
    },
  ) {
    if (!path.isAbsolute(options.rootDirectory)) throw new TypeError("Local Project owner root must be absolute")
    this.validationArtifacts = protocolValidationArtifacts(options.authority)
    this.validationArtifactSetDigest = structuredDigest("convax.validation-artifact-set", this.validationArtifacts)
  }

  /** Main runtime caches subscribe only to explicit durable current-binding publication. */
  subscribeCurrentChange(listener: (change: LocalProjectOwnerAuthorityChange) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("Local Project owner change listener is required")
    this.currentChangeListeners.add(listener)
    return () => this.currentChangeListeners.delete(listener)
  }

  async ensureForDurableProject(input: {
    readonly projectId: ProjectId
    readonly projectRoot: string
  }): Promise<ResolvedLocalProjectOwnerAuthority> {
    const projectId = parseProjectId(input.projectId)
    const durableRoot = await fs.realpath(await this.options.projects.resolveProjectRoot({ projectId }))
    const requestedRoot = await fs.realpath(input.projectRoot)
    if (durableRoot !== requestedRoot) throw new Error("Local Project owner crossed the durable Project binding")
    await ensureLayout(this.options.rootDirectory)
    const selector = selectorDigest(projectId, this.options.authority.protocolDigest)
    const bindingTarget = path.join(this.options.rootDirectory, "bindings", `${selector}.jcs`)
    const existing = await readOptionalPlainFile(bindingTarget)
    if (existing) return this.openOrRotateCurrentBinding(existing, projectId, bindingTarget)

    const claimTarget = path.join(this.options.rootDirectory, "claims", `${selector}.jcs`)
    let claimBytes = await readOptionalPlainFile(claimTarget)
    if (!claimBytes) {
      const claim = this.newClaim(projectId)
      claimBytes = encodeRestrictedJcs(claim)
      try {
        await writeImmutable(claimTarget, claimBytes)
      } catch (error) {
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
    const actorId = parseActorId(key.publicKey)
    const bindingWithoutDigest = Object.freeze({
      ...claim,
      format: BINDING_FORMAT,
      actorId,
      publicKey: parsePublicKey(key.publicKey),
    })
    const binding = Object.freeze({
      ...bindingWithoutDigest,
      bindingDigest: bindingDigest(bindingWithoutDigest),
    })
    const bindingBytes = encodeRestrictedJcs(binding)
    try {
      await writeImmutable(bindingTarget, bindingBytes)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    await this.options.faults?.afterBindingFsync?.()
    return this.openBinding(
      requireBytes(await readOptionalPlainFile(bindingTarget), "Local Project owner binding disappeared"),
      projectId,
      bindingTarget,
    )
  }

  /**
   * One-shot exact predecessor authority bridge. It preserves Project/shard
   * identity and rebinds the existing durable owner key to the current protocol;
   * it never allocates a replacement Project epoch or falls back from Team.
   * The caller must classify Team authority before invoking this method.
   */
  async inspectImmediatePredecessorMigrationAuthority(input: {
    readonly projectId: ProjectId
    readonly projectRoot: string
    readonly projectEpoch: Id128
    readonly projectIndexShardEpoch: Id128
    readonly initializationAuthorityDigest: Digest
  }): Promise<PreparedImmediatePredecessorLocalOwnerMigrationAuthority | "missing" | "rejected"> {
    let projectId: ProjectId
    let projectEpoch: Id128
    let projectIndexShardEpoch: Id128
    let initializationAuthorityDigest: Digest
    try {
      projectId = parseProjectId(input.projectId)
      projectEpoch = parseId128(input.projectEpoch)
      projectIndexShardEpoch = parseId128(input.projectIndexShardEpoch)
      initializationAuthorityDigest = parseDigest(input.initializationAuthorityDigest)
      await this.assertDurableProjectRoot(projectId, input.projectRoot)
    } catch {
      return "rejected"
    }
    const predecessorTarget = path.join(
      this.options.rootDirectory,
      "bindings",
      `${selectorDigest(projectId, IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest)}.jcs`,
    )
    const predecessorBytes = await readOptionalPlainFile(predecessorTarget)
    if (!predecessorBytes) return "missing"
    let predecessorBinding: DurableLocalProjectOwnerBinding
    try {
      predecessorBinding = parseDurableLocalProjectOwnerBindingExact(predecessorBytes, {
        projectId,
        projectEpoch,
        protocolDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest,
        schemaDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest,
        uriProtocolDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.uriProtocolDigest,
        validationArtifactSetDigest: immediatePredecessorValidationArtifactSetDigest(),
      })
      if (
        predecessorBinding.projectIndexShardEpoch !== projectIndexShardEpoch ||
        predecessorBinding.bindingDigest !== initializationAuthorityDigest
      ) return "rejected"
    } catch {
      return "rejected"
    }
    const currentTarget = path.join(
      this.options.rootDirectory,
      "bindings",
      `${selectorDigest(projectId, this.options.authority.protocolDigest)}.jcs`,
    )
    const existingCurrent = await readOptionalPlainFile(currentTarget)
    let currentOwner: ResolvedLocalProjectOwnerAuthority | null = null
    try {
      if (existingCurrent) {
        currentOwner = await this.openBinding(existingCurrent, projectId, currentTarget)
      }
      if (
        currentOwner &&
        (currentOwner.binding.projectEpoch !== projectEpoch ||
          currentOwner.binding.projectIndexShardEpoch !== projectIndexShardEpoch ||
          currentOwner.binding.memberId !== predecessorBinding.memberId)
      ) return "rejected"
    } catch {
      return "rejected"
    }

    const predecessor = Object.freeze({
      binding: predecessorBinding,
      bindingExactBytes: new Uint8Array(predecessorBytes),
      validationArtifacts: immediatePredecessorValidationArtifacts(),
    })
    const predecessorSignatures = this.immediatePredecessorSignatureVerifier(predecessorBinding)
    const prepared = Object.freeze({
      predecessor,
      predecessorSignatures,
      currentOwner,
    })
    this.predecessorMigrationPreparations.add(prepared)
    return prepared
  }

  /** Issues and publishes a retry-stable fresh current binding only after closure A. */
  async activateImmediatePredecessorMigrationAuthority(
    prepared: PreparedImmediatePredecessorLocalOwnerMigrationAuthority,
    sourceClosureDigestInput: Digest,
  ): Promise<ActivatedImmediatePredecessorLocalOwnerMigrationAuthority> {
    if (!this.predecessorMigrationPreparations.has(prepared as object)) {
      throw new TypeError("Immediate-predecessor authority preparation is not owned by this resolver")
    }
    const sourceClosureDigest = parseDigest(sourceClosureDigestInput)
    await ensureLayout(this.options.rootDirectory)
    const predecessorBinding = prepared.predecessor.binding
    const currentTarget = path.join(
      this.options.rootDirectory,
      "bindings",
      `${selectorDigest(predecessorBinding.projectId, this.options.authority.protocolDigest)}.jcs`,
    )
    let currentOwner = prepared.currentOwner
    if (currentOwner === null) {
      const existing = await readOptionalPlainFile(currentTarget)
      currentOwner = existing
        ? await this.openBinding(existing, predecessorBinding.projectId, currentTarget)
        : await this.prepareImmediatePredecessorCurrentOwner(prepared.predecessor)
    }
    if (
      currentOwner.binding.projectEpoch !== predecessorBinding.projectEpoch ||
      currentOwner.binding.projectIndexShardEpoch !== predecessorBinding.projectIndexShardEpoch ||
      currentOwner.binding.memberId !== predecessorBinding.memberId
    ) {
      throw new Error("Current local Project owner crossed its predecessor identity")
    }
    const retiredTarget = path.join(
      this.options.rootDirectory,
      "retired-bindings",
      `${predecessorBinding.bindingDigest}.jcs`,
    )
    await writeCreateOrExact(retiredTarget, prepared.predecessor.bindingExactBytes)
    await this.options.faults?.afterRetiredBindingFsync?.()
    const activatedOwner = currentOwner
    const existing = await readOptionalPlainFile(currentTarget)
    if (existing) {
      if (!sameBytes(existing, activatedOwner.bindingExactBytes)) {
        throw new Error("Current local Project owner changed after predecessor inspection")
      }
    } else {
      await writeImmutable(currentTarget, activatedOwner.bindingExactBytes).catch(async (error) => {
        if (!isAlreadyExists(error)) throw error
        const raced = requireBytes(
          await readOptionalPlainFile(currentTarget),
          "Migrated local Project owner binding disappeared",
        )
        if (!sameBytes(raced, activatedOwner.bindingExactBytes)) {
          throw new Error("Current local Project owner changed during predecessor activation")
        }
      })
    }
    currentOwner = await this.openBinding(
      requireBytes(await readOptionalPlainFile(currentTarget), "Migrated local Project owner binding disappeared"),
      predecessorBinding.projectId,
      currentTarget,
    )
    this.notifyCurrentChange(currentOwner.binding)
    return Object.freeze({
      currentOwner,
      migrationOperationId: migrationOperationId(
        prepared.predecessor.binding.bindingDigest,
        currentOwner.binding.bindingDigest,
        sourceClosureDigest,
      ),
    })
  }

  private async prepareImmediatePredecessorCurrentOwner(
    predecessor: ResolvedLocalProjectOwnerBinding,
  ): Promise<ResolvedLocalProjectOwnerAuthority> {
    const selector = predecessor.binding.bindingDigest
    const claimTarget = path.join(this.options.rootDirectory, "rotation-claims", `${selector}.jcs`)
    const bindingTarget = path.join(this.options.rootDirectory, "rotation-bindings", `${selector}.jcs`)
    const existingBinding = await readOptionalPlainFile(bindingTarget)
    if (existingBinding) return this.openBinding(existingBinding, predecessor.binding.projectId, bindingTarget)

    let claimBytes = await readOptionalPlainFile(claimTarget)
    if (!claimBytes) {
      claimBytes = encodeRestrictedJcs(this.newImmediatePredecessorMigrationClaim(predecessor.binding))
      try {
        await writeImmutable(claimTarget, claimBytes)
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
        claimBytes = requireBytes(
          await readOptionalPlainFile(claimTarget),
          "Local Project owner migration claim disappeared",
        )
      }
      await this.options.faults?.afterClaimFsync?.()
    }
    const claim = parseClaimExact(claimBytes, this.expectedAuthority(predecessor.binding.projectId))
    if (
      claim.projectEpoch !== predecessor.binding.projectEpoch ||
      claim.projectIndexShardEpoch !== predecessor.binding.projectIndexShardEpoch ||
      claim.memberId !== predecessor.binding.memberId ||
      claim.replicaId === predecessor.binding.replicaId
    ) throw new Error("Local Project owner migration claim crossed its predecessor binding")
    const key = await this.options.vault.createReplicaKey({
      projectId: claim.projectId,
      projectEpoch: claim.projectEpoch,
      replicaId: claim.replicaId,
    })
    await this.options.faults?.afterVaultKey?.()
    const bindingWithoutDigest = Object.freeze({
      ...claim,
      format: BINDING_FORMAT,
      actorId: parseActorId(key.publicKey),
      publicKey: parsePublicKey(key.publicKey),
    })
    const binding = Object.freeze({
      ...bindingWithoutDigest,
      bindingDigest: bindingDigest(bindingWithoutDigest),
    })
    await writeCreateOrExact(bindingTarget, encodeRestrictedJcs(binding))
    await this.options.faults?.afterBindingFsync?.()
    return this.openBinding(
      requireBytes(await readOptionalPlainFile(bindingTarget), "Local Project owner migration binding disappeared"),
      binding.projectId,
      bindingTarget,
    )
  }

  /** Prepare a retry-stable fresh binding without making it current. */
  async prepareResetForDurableProject(input: {
    readonly projectId: ProjectId
    readonly projectRoot: string
    readonly resetId: string
  }): Promise<PreparedLocalProjectOwnerReset> {
    const projectId = parseProjectId(input.projectId)
    await this.assertDurableProjectRoot(projectId, input.projectRoot)
    const resetId = requireResetId(input.resetId)
    await ensureLayout(this.options.rootDirectory)
    const selector = selectorDigest(projectId, this.options.authority.protocolDigest)
    const currentTarget = path.join(this.options.rootDirectory, "bindings", `${selector}.jcs`)
    const currentBytes = await readOptionalPlainFile(currentTarget)
    const previousBindingDigest = currentBytes
      ? parseBindingExact(currentBytes, this.expectedAuthority(projectId)).bindingDigest
      : null
    const resetSelector = resetSelectorDigest(projectId, this.options.authority.protocolDigest, resetId)
    const owner = await this.ensureBindingAt(
      projectId,
      path.join(this.options.rootDirectory, "reset-claims", `${resetSelector}.jcs`),
      path.join(this.options.rootDirectory, "reset-bindings", `${resetSelector}.jcs`),
    )
    if (owner.binding.bindingDigest === previousBindingDigest) {
      throw new Error("Project reset owner did not allocate a fresh binding")
    }
    return Object.freeze({ owner, previousBindingDigest, resetId, resetSelector })
  }

  /** Activate only after Project/node has verified the published tree and archive. */
  async activatePreparedReset(prepared: PreparedLocalProjectOwnerReset): Promise<void> {
    const opened = await this.openPreparedReset(prepared)
    const selector = selectorDigest(opened.owner.binding.projectId, this.options.authority.protocolDigest)
    const currentTarget = path.join(this.options.rootDirectory, "bindings", `${selector}.jcs`)
    const currentBytes = await readOptionalPlainFile(currentTarget)
    if (currentBytes) {
      const current = parseBindingExact(currentBytes, this.expectedAuthority(opened.owner.binding.projectId))
      if (current.bindingDigest === opened.owner.binding.bindingDigest) return
      if (opened.previousBindingDigest === null || current.bindingDigest !== opened.previousBindingDigest) {
        throw new Error("Local Project owner changed after reset preparation")
      }
      await writeCreateOrExact(
        path.join(this.options.rootDirectory, "retired-bindings", `${current.bindingDigest}.jcs`),
        currentBytes,
      )
    } else if (opened.previousBindingDigest !== null) {
      throw new Error("Local Project owner disappeared after reset preparation")
    }
    await replaceDurably(currentTarget, encodeRestrictedJcs(opened.owner.binding))
    this.notifyCurrentChange(opened.owner.binding)
  }

  async verifyPreparedCheckpointSignature(
    prepared: PreparedLocalProjectOwnerReset,
    coreDigest: Digest,
    signature: string,
  ): Promise<boolean> {
    return this.verifyPreparedSignature(prepared, Buffer.from(parseDigest(coreDigest), "hex"), signature)
  }

  async verifyPreparedSignature(
    prepared: PreparedLocalProjectOwnerReset,
    message: Uint8Array,
    signature: string,
  ): Promise<boolean> {
    try {
      const opened = await this.openPreparedReset(prepared)
      return this.options.verifier.verify(
        Buffer.from(opened.owner.binding.publicKey, "base64url"),
        Buffer.from(signature, "base64url"),
        message,
      )
    } catch {
      return false
    }
  }

  async resolveCurrent(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
  }): Promise<ResolvedLocalProjectOwnerAuthority | "missing" | "rejected"> {
    let projectId: ProjectId
    try {
      projectId = parseProjectId(input.projectId)
    } catch {
      return "rejected"
    }
    await ensureLayout(this.options.rootDirectory)
    const selector = selectorDigest(projectId, this.options.authority.protocolDigest)
    const target = path.join(this.options.rootDirectory, "bindings", `${selector}.jcs`)
    try {
      const bytes = await readOptionalPlainFile(target)
      if (!bytes) return "missing"
      const opened = await this.openOrRotateCurrentBinding(bytes, projectId, target)
      if (opened.binding.projectEpoch !== parseId128(input.projectEpoch)) return "rejected"
      return opened
    } catch {
      return "rejected"
    }
  }

  async resolveBindingExact(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly ownerBindingDigest: Digest
  }): Promise<ResolvedLocalProjectOwnerBinding | "missing" | "rejected"> {
    let projectId: ProjectId
    let projectEpoch: Id128
    let ownerBindingDigest: Digest
    try {
      projectId = parseProjectId(input.projectId)
      projectEpoch = parseId128(input.projectEpoch)
      ownerBindingDigest = parseDigest(input.ownerBindingDigest)
    } catch {
      return "rejected"
    }
    await ensureLayout(this.options.rootDirectory)
    const selector = selectorDigest(projectId, this.options.authority.protocolDigest)
    const currentTarget = path.join(this.options.rootDirectory, "bindings", `${selector}.jcs`)
    try {
      const currentBytes = await readOptionalPlainFile(currentTarget)
      if (currentBytes) {
        const current = this.parseResolvedBinding(currentBytes, projectId)
        if (current.binding.bindingDigest === ownerBindingDigest) {
          return current.binding.projectEpoch === projectEpoch ? current : "rejected"
        }
      }
      const retiredTarget = path.join(this.options.rootDirectory, "retired-bindings", `${ownerBindingDigest}.jcs`)
      const retiredBytes = await readOptionalPlainFile(retiredTarget)
      if (!retiredBytes) return "missing"
      const retired = this.parseResolvedBinding(retiredBytes, projectId)
      return retired.binding.projectEpoch === projectEpoch && retired.binding.bindingDigest === ownerBindingDigest
        ? retired
        : "rejected"
    } catch {
      return "rejected"
    }
  }

  async verifyCheckpointSignature(
    binding: DurableLocalProjectOwnerBinding,
    coreDigest: Digest,
    signature: string,
  ): Promise<boolean> {
    return this.verifySignature(binding, Buffer.from(parseDigest(coreDigest), "hex"), signature)
  }

  async verifySignature(
    binding: DurableLocalProjectOwnerBinding,
    message: Uint8Array,
    signature: string,
  ): Promise<boolean> {
    const current = await this.resolveBindingExact({
      projectId: binding.projectId,
      projectEpoch: binding.projectEpoch,
      ownerBindingDigest: binding.bindingDigest,
    })
    if (current === "missing" || current === "rejected") return false
    return this.options.verifier.verify(
      Buffer.from(current.binding.publicKey, "base64url"),
      Buffer.from(signature, "base64url"),
      message,
    )
  }

  private immediatePredecessorSignatureVerifier(
    binding: DurableLocalProjectOwnerBinding,
  ): ImmediatePredecessorSignatureVerifier & ImmediatePredecessorCheckpointSignatureVerifier {
    const verifyPurpose = (signature: string, purposeDigest: Uint8Array) => this.options.verifier.verify(
      Buffer.from(binding.publicKey, "base64url"),
      Buffer.from(parseSignature(signature), "base64url"),
      purposeDigest,
    )
    return Object.freeze({
      verify: async (input: Parameters<ImmediatePredecessorSignatureVerifier["verify"]>[0]) => {
        const signer = input.signerAuthority
        if (
          input.scope.projectId !== binding.projectId ||
          input.scope.projectEpoch !== binding.projectEpoch ||
          signer.kind !== "local-project-owner" ||
          signer.replicaId !== binding.replicaId ||
          signer.actorId !== binding.actorId ||
          signer.ownerBindingDigest !== binding.bindingDigest
        ) return false
        const ownerSchemaDigest = input.scope.docKind === "canvas"
          ? IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest
          : IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest
        const authorizationDigest = immediatePredecessorLocalOwnerEditAuthorizationCoreDigest(Object.freeze({
          format: "convax.local-owner-edit-authorization-core",
          scope: input.scope,
          replicaId: binding.replicaId,
          actorId: binding.actorId,
          ownerBindingDigest: binding.bindingDigest,
          protocolDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest,
          ownerSchemaDigest,
          expiryPolicy: "none",
        }))
        return authorizationDigest === signer.ownerEditAuthorizationCoreDigest &&
          verifyPurpose(input.signature, input.purposeDigest)
      },
      verifyCheckpoint: (
        input: Parameters<ImmediatePredecessorCheckpointSignatureVerifier["verifyCheckpoint"]>[0],
      ) => {
        if (
          input.scope.projectId !== binding.projectId ||
          input.scope.projectEpoch !== binding.projectEpoch ||
          input.authorReplicaId !== binding.replicaId ||
          input.authorActorId !== binding.actorId ||
          input.authorAuthorizationDigest !== binding.bindingDigest
        ) return Promise.resolve(false)
        return verifyPurpose(input.signature, input.purposeDigest)
      },
    })
  }

  private async openBinding(
    bytes: Uint8Array,
    projectId: ProjectId,
    _target: string,
  ): Promise<ResolvedLocalProjectOwnerAuthority> {
    const binding = parseBindingExact(bytes, this.expectedAuthority(projectId))
    const signer = await this.options.vault.openSigner({
      projectId: binding.projectId,
      projectEpoch: binding.projectEpoch,
      replicaId: binding.replicaId,
      expectedPublicKey: binding.publicKey,
    })
    if (signer === "missing" || signer === "rejected") {
      throw new Error(`Local Project owner key is ${signer}`)
    }
    return Object.freeze({
      binding,
      bindingExactBytes: new Uint8Array(bytes),
      signer,
      validationArtifacts: this.validationArtifacts,
    })
  }

  private parseResolvedBinding(bytes: Uint8Array, projectId: ProjectId): ResolvedLocalProjectOwnerBinding {
    return Object.freeze({
      binding: parseBindingExact(bytes, this.expectedAuthority(projectId)),
      bindingExactBytes: new Uint8Array(bytes),
      validationArtifacts: this.validationArtifacts,
    })
  }

  private async openOrRotateCurrentBinding(
    bytes: Uint8Array,
    projectId: ProjectId,
    target: string,
  ): Promise<ResolvedLocalProjectOwnerAuthority> {
    const binding = parseBindingExact(bytes, this.expectedAuthority(projectId))
    const signer = await this.options.vault.openSigner({
      projectId: binding.projectId,
      projectEpoch: binding.projectEpoch,
      replicaId: binding.replicaId,
      expectedPublicKey: binding.publicKey,
    })
    if (signer === "missing") return this.rotateMissingSigner(bytes, binding, target)
    if (signer === "rejected") {
      throw new Error(`Local Project owner key is ${signer}`)
    }
    return Object.freeze({
      binding,
      bindingExactBytes: new Uint8Array(bytes),
      signer,
      validationArtifacts: this.validationArtifacts,
    })
  }

  private async rotateMissingSigner(
    previousBytes: Uint8Array,
    previous: DurableLocalProjectOwnerBinding,
    currentTarget: string,
  ): Promise<ResolvedLocalProjectOwnerAuthority> {
    const rotationSelector = previous.bindingDigest
    const claimTarget = path.join(this.options.rootDirectory, "rotation-claims", `${rotationSelector}.jcs`)
    const bindingTarget = path.join(this.options.rootDirectory, "rotation-bindings", `${rotationSelector}.jcs`)
    let claimBytes = await readOptionalPlainFile(claimTarget)
    if (!claimBytes) {
      claimBytes = encodeRestrictedJcs(this.newRotationClaim(previous))
      try {
        await writeImmutable(claimTarget, claimBytes)
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
        claimBytes = requireBytes(
          await readOptionalPlainFile(claimTarget),
          "Local Project owner rotation claim disappeared",
        )
      }
      await this.options.faults?.afterClaimFsync?.()
    }
    const claim = parseClaimExact(claimBytes, this.expectedAuthority(previous.projectId))
    if (
      claim.projectEpoch !== previous.projectEpoch ||
      claim.projectIndexShardEpoch !== previous.projectIndexShardEpoch ||
      claim.memberId !== previous.memberId ||
      claim.replicaId === previous.replicaId
    )
      throw new Error("Local Project owner rotation claim crossed the prior binding")
    const key = await this.options.vault.createReplicaKey({
      projectId: claim.projectId,
      projectEpoch: claim.projectEpoch,
      replicaId: claim.replicaId,
    })
    await this.options.faults?.afterVaultKey?.()
    const bindingWithoutDigest = Object.freeze({
      ...claim,
      format: BINDING_FORMAT,
      actorId: parseActorId(key.publicKey),
      publicKey: parsePublicKey(key.publicKey),
    })
    const binding = Object.freeze({
      ...bindingWithoutDigest,
      bindingDigest: bindingDigest(bindingWithoutDigest),
    })
    const bindingBytes = encodeRestrictedJcs(binding)
    await writeCreateOrExact(bindingTarget, bindingBytes)
    await this.options.faults?.afterBindingFsync?.()

    const currentBytes = requireBytes(
      await readOptionalPlainFile(currentTarget),
      "Local Project owner disappeared during rotation",
    )
    const current = parseBindingExact(currentBytes, this.expectedAuthority(previous.projectId))
    if (current.bindingDigest === binding.bindingDigest) {
      this.notifyCurrentChange(current)
      return this.openBinding(currentBytes, previous.projectId, currentTarget)
    }
    if (current.bindingDigest !== previous.bindingDigest || !sameBytes(currentBytes, previousBytes)) {
      this.notifyCurrentChange(current)
      return this.openOrRotateCurrentBinding(currentBytes, previous.projectId, currentTarget)
    }
    await writeCreateOrExact(
      path.join(this.options.rootDirectory, "retired-bindings", `${previous.bindingDigest}.jcs`),
      previousBytes,
    )
    await this.options.faults?.afterRetiredBindingFsync?.()
    await replaceDurably(currentTarget, bindingBytes)
    this.notifyCurrentChange(binding)
    await this.options.faults?.afterCurrentBindingFsync?.()
    return this.openBinding(bindingBytes, previous.projectId, currentTarget)
  }

  private notifyCurrentChange(binding: DurableLocalProjectOwnerBinding): void {
    const change = Object.freeze({ projectId: binding.projectId, bindingDigest: binding.bindingDigest })
    for (const listener of this.currentChangeListeners) {
      try {
        listener(change)
      } catch {
        // Authority publication is already durable; observers may only revoke caches.
      }
    }
  }

  private async assertDurableProjectRoot(projectId: ProjectId, projectRoot: string): Promise<void> {
    const durableRoot = await fs.realpath(await this.options.projects.resolveProjectRoot({ projectId }))
    const requestedRoot = await fs.realpath(projectRoot)
    if (durableRoot !== requestedRoot) throw new Error("Local Project owner crossed the durable Project binding")
  }

  private async ensureBindingAt(
    projectId: ProjectId,
    claimTarget: string,
    bindingTarget: string,
  ): Promise<ResolvedLocalProjectOwnerAuthority> {
    const existing = await readOptionalPlainFile(bindingTarget)
    if (existing) return this.openBinding(existing, projectId, bindingTarget)
    let claimBytes = await readOptionalPlainFile(claimTarget)
    if (!claimBytes) {
      claimBytes = encodeRestrictedJcs(this.newClaim(projectId))
      try {
        await writeImmutable(claimTarget, claimBytes)
      } catch (error) {
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
    const bindingWithoutDigest = Object.freeze({
      ...claim,
      format: BINDING_FORMAT,
      actorId: parseActorId(key.publicKey),
      publicKey: parsePublicKey(key.publicKey),
    })
    const binding = Object.freeze({
      ...bindingWithoutDigest,
      bindingDigest: bindingDigest(bindingWithoutDigest),
    })
    const bindingBytes = encodeRestrictedJcs(binding)
    try {
      await writeImmutable(bindingTarget, bindingBytes)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
    await this.options.faults?.afterBindingFsync?.()
    return this.openBinding(
      requireBytes(await readOptionalPlainFile(bindingTarget), "Local Project owner binding disappeared"),
      projectId,
      bindingTarget,
    )
  }

  private async openPreparedReset(prepared: PreparedLocalProjectOwnerReset): Promise<PreparedLocalProjectOwnerReset> {
    const projectId = parseProjectId(prepared.owner.binding.projectId)
    const resetId = requireResetId(prepared.resetId)
    const resetSelector = resetSelectorDigest(projectId, this.options.authority.protocolDigest, resetId)
    if (resetSelector !== parseDigest(prepared.resetSelector)) throw new Error("Prepared reset selector mismatches")
    const target = path.join(this.options.rootDirectory, "reset-bindings", `${resetSelector}.jcs`)
    const owner = await this.openBinding(
      requireBytes(await readOptionalPlainFile(target), "Prepared reset binding disappeared"),
      projectId,
      target,
    )
    if (owner.binding.bindingDigest !== prepared.owner.binding.bindingDigest) {
      throw new Error("Prepared reset binding changed")
    }
    return Object.freeze({
      owner,
      previousBindingDigest:
        prepared.previousBindingDigest === null ? null : parseDigest(prepared.previousBindingDigest),
      resetId,
      resetSelector,
    })
  }

  private newClaim(projectId: ProjectId): LocalProjectOwnerClaim {
    const createId = this.options.createId ?? (() => parseId128(randomBytes(16).toString("base64url")))
    const createReplicaId =
      this.options.createReplicaId ?? (() => parseReplicaId(`replica_${randomBytes(4).toString("hex")}`))
    return Object.freeze({
      format: CLAIM_FORMAT,
      projectId,
      projectEpoch: createId(),
      projectIndexShardEpoch: createId(),
      memberId: parseMemberId(createId()),
      replicaId: createReplicaId(),
      localConfirmationKeyId: `local-owner-${projectId}`.slice(0, 128),
      genesisOperationId: createId(),
      genesisCheckpointId: createId(),
      protocolDigest: this.options.authority.protocolDigest,
      schemaDigest: parseDigest(this.options.schemaDigest),
      uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
      validationArtifactSetDigest: this.validationArtifactSetDigest,
    })
  }

  private newRotationClaim(previous: DurableLocalProjectOwnerBinding): LocalProjectOwnerClaim {
    const createReplicaId =
      this.options.createReplicaId ?? (() => parseReplicaId(`replica_${randomBytes(4).toString("hex")}`))
    return Object.freeze({
      format: CLAIM_FORMAT,
      projectId: previous.projectId,
      projectEpoch: previous.projectEpoch,
      projectIndexShardEpoch: previous.projectIndexShardEpoch,
      memberId: previous.memberId,
      replicaId: createReplicaId(),
      localConfirmationKeyId: previous.localConfirmationKeyId,
      genesisOperationId: previous.genesisOperationId,
      genesisCheckpointId: previous.genesisCheckpointId,
      protocolDigest: previous.protocolDigest,
      schemaDigest: previous.schemaDigest,
      uriProtocolDigest: previous.uriProtocolDigest,
      validationArtifactSetDigest: previous.validationArtifactSetDigest,
    })
  }

  private newImmediatePredecessorMigrationClaim(
    predecessor: DurableLocalProjectOwnerBinding,
  ): LocalProjectOwnerClaim {
    const createReplicaId =
      this.options.createReplicaId ?? (() => parseReplicaId(`replica_${randomBytes(4).toString("hex")}`))
    return Object.freeze({
      format: CLAIM_FORMAT,
      projectId: predecessor.projectId,
      projectEpoch: predecessor.projectEpoch,
      projectIndexShardEpoch: predecessor.projectIndexShardEpoch,
      memberId: predecessor.memberId,
      replicaId: createReplicaId(),
      localConfirmationKeyId: predecessor.localConfirmationKeyId,
      genesisOperationId: predecessor.genesisOperationId,
      genesisCheckpointId: predecessor.genesisCheckpointId,
      protocolDigest: this.options.authority.protocolDigest,
      schemaDigest: parseDigest(this.options.schemaDigest),
      uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
      validationArtifactSetDigest: this.validationArtifactSetDigest,
    })
  }

  private expectedAuthority(projectId: ProjectId) {
    return Object.freeze({
      projectId,
      protocolDigest: this.options.authority.protocolDigest,
      schemaDigest: parseDigest(this.options.schemaDigest),
      uriProtocolDigest: this.options.authority.protocolSchemaBundle.core.uriProtocolDigest,
      validationArtifactSetDigest: this.validationArtifactSetDigest,
    })
  }
}

type ExpectedAuthority = ReturnType<NodeDurableLocalProjectOwnerAuthority["expectedAuthority"]>

export function parseDurableLocalProjectOwnerBindingExact(
  bytes: Uint8Array,
  expected: Readonly<{
    projectId: ProjectId
    projectEpoch: Id128
    protocolDigest: Digest
    schemaDigest: Digest
    uriProtocolDigest: Digest
    validationArtifactSetDigest: Digest
  }>,
): DurableLocalProjectOwnerBinding {
  const binding = parseBindingExact(bytes, {
    projectId: parseProjectId(expected.projectId),
    protocolDigest: parseDigest(expected.protocolDigest),
    schemaDigest: parseDigest(expected.schemaDigest),
    uriProtocolDigest: parseDigest(expected.uriProtocolDigest),
    validationArtifactSetDigest: parseDigest(expected.validationArtifactSetDigest),
  })
  if (binding.projectEpoch !== parseId128(expected.projectEpoch)) {
    throw new Error("Local Project owner binding crossed Project epoch")
  }
  return binding
}

function parseClaimExact(bytes: Uint8Array, expected: ExpectedAuthority): LocalProjectOwnerClaim {
  const value = decodeRestrictedJcs(bytes)
  const claim = parseClaim(value, CLAIM_FORMAT, expected)
  if (!sameBytes(bytes, encodeRestrictedJcs(claim))) throw new Error("Local Project owner claim is noncanonical")
  return claim
}

function parseBindingExact(bytes: Uint8Array, expected: ExpectedAuthority): DurableLocalProjectOwnerBinding {
  const value = decodeRestrictedJcs(bytes)
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Local Project owner binding is invalid")
  const record = value as Record<string, unknown>
  assertExactKeys(record, [...claimKeys(), "actorId", "publicKey", "bindingDigest"])
  const claim = parseClaim(record, BINDING_FORMAT, expected)
  const bindingWithoutDigest = Object.freeze({
    ...claim,
    format: BINDING_FORMAT,
    actorId: parseActorId(record.actorId),
    publicKey: parsePublicKey(record.publicKey),
  })
  if (String(bindingWithoutDigest.actorId) !== String(bindingWithoutDigest.publicKey)) {
    throw new Error("Local Project owner actor does not equal its signing public key")
  }
  const binding = Object.freeze({
    ...bindingWithoutDigest,
    bindingDigest: parseDigest(record.bindingDigest),
  })
  if (binding.bindingDigest !== bindingDigest(bindingWithoutDigest))
    throw new Error("Local Project owner binding digest mismatches")
  if (!sameBytes(bytes, encodeRestrictedJcs(binding))) throw new Error("Local Project owner binding is noncanonical")
  return binding
}

function parseClaim(
  value: unknown,
  format: typeof CLAIM_FORMAT | typeof BINDING_FORMAT,
  expected: ExpectedAuthority,
): LocalProjectOwnerClaim {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Local Project owner claim is invalid")
  const record = value as Record<string, unknown>
  if (format === CLAIM_FORMAT) assertExactKeys(record, claimKeys())
  if (record.format !== format) throw new Error("Local Project owner format is invalid")
  const claim = Object.freeze({
    format: CLAIM_FORMAT,
    projectId: parseProjectId(record.projectId),
    projectEpoch: parseId128(record.projectEpoch),
    projectIndexShardEpoch: parseId128(record.projectIndexShardEpoch),
    memberId: parseMemberId(record.memberId),
    replicaId: parseReplicaId(record.replicaId),
    localConfirmationKeyId: requireKeyId(record.localConfirmationKeyId),
    genesisOperationId: parseId128(record.genesisOperationId),
    genesisCheckpointId: parseId128(record.genesisCheckpointId),
    protocolDigest: parseDigest(record.protocolDigest),
    schemaDigest: parseDigest(record.schemaDigest),
    uriProtocolDigest: parseDigest(record.uriProtocolDigest),
    validationArtifactSetDigest: parseDigest(record.validationArtifactSetDigest),
  })
  if (
    claim.projectId !== expected.projectId ||
    claim.protocolDigest !== expected.protocolDigest ||
    claim.schemaDigest !== expected.schemaDigest ||
    claim.uriProtocolDigest !== expected.uriProtocolDigest ||
    claim.validationArtifactSetDigest !== expected.validationArtifactSetDigest
  )
    throw new Error("Local Project owner claim crossed authority")
  return claim
}

function protocolValidationArtifacts(authority: CurrentProtocolAuthority): ValidationArtifactSet {
  const owners = ["canvas", "kernel", "control-plane", "project-index"] as const
  const artifacts = authority.protocolSchemaBundle.core.artifacts
    .map((artifact, index) => ({
      owner: owners[index],
      format: artifact.format,
      artifactDigest: artifact.artifactDigest,
    }))
    .sort((left, right) => String(left.owner).localeCompare(String(right.owner)))
  return parseValidationArtifactSet({
    format: "convax.validation-artifact-set",
    artifacts,
  })
}

function immediatePredecessorValidationArtifacts(): ValidationArtifactSet {
  return parseValidationArtifactSet({
    format: "convax.validation-artifact-set",
    artifacts: [
      {
        owner: "canvas",
        format: "convax.canvas-protocol-schema",
        artifactDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest,
      },
      {
        owner: "control-plane",
        format: "convax.control-plane-protocol-schema",
        artifactDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.controlPlaneSchemaDigest,
      },
      {
        owner: "kernel",
        format: "convax.collaboration-kernel-protocol-schema",
        artifactDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.collaborationKernelSchemaDigest,
      },
      {
        owner: "project-index",
        format: "convax.project-persistence-protocol-schema",
        artifactDigest: IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest,
      },
    ],
  })
}

function immediatePredecessorValidationArtifactSetDigest(): Digest {
  return structuredDigest("convax.validation-artifact-set", immediatePredecessorValidationArtifacts())
}

function migrationOperationId(
  predecessorBindingDigest: Digest,
  currentBindingDigest: Digest,
  sourceClosureDigest: Digest,
): Id128 {
  const digest = structuredDigest("convax.immediate-predecessor-owner-migration-operation/1", {
    format: "convax.immediate-predecessor-owner-migration-operation/1",
    predecessorBindingDigest,
    currentBindingDigest,
    sourceClosureDigest,
  })
  return parseId128(encodeBase64url(new Uint8Array(Buffer.from(digest, "hex").subarray(0, 16))))
}

function bindingDigest(binding: Omit<DurableLocalProjectOwnerBinding, "bindingDigest">): Digest {
  return ordinarySha256(encodeRestrictedJcs(binding))
}

function selectorDigest(projectId: ProjectId, protocolDigest: Digest): Digest {
  return structuredDigest("convax.desktop-local-project-owner-selector", {
    format: "convax.desktop-local-project-owner-selector",
    projectId,
    protocolDigest,
  })
}

function resetSelectorDigest(projectId: ProjectId, protocolDigest: Digest, resetId: string): Digest {
  return structuredDigest("convax.desktop-local-project-owner-reset-selector/1", {
    format: "convax.desktop-local-project-owner-reset-selector/1",
    projectId,
    protocolDigest,
    resetId: requireResetId(resetId),
  })
}

function claimKeys(): string[] {
  return [
    "format",
    "projectId",
    "projectEpoch",
    "projectIndexShardEpoch",
    "memberId",
    "replicaId",
    "localConfirmationKeyId",
    "genesisOperationId",
    "genesisCheckpointId",
    "protocolDigest",
    "schemaDigest",
    "uriProtocolDigest",
    "validationArtifactSetDigest",
  ]
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    throw new Error("Local Project owner record has unsupported fields")
  }
}

function requireKeyId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.normalize("NFC") !== value ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > 128
  ) {
    throw new Error("Local Project owner confirmation key id is invalid")
  }
  return value
}

function requireResetId(value: unknown): string {
  if (typeof value !== "string" || !/^reset-host-[0-9a-f]{64}$/u.test(value)) {
    throw new Error("Local Project owner reset id is invalid")
  }
  return value
}

async function ensureLayout(root: string): Promise<void> {
  const directories = [
    "claims",
    "bindings",
    "reset-claims",
    "reset-bindings",
    "retired-bindings",
    "rotation-claims",
    "rotation-bindings",
  ]
  for (const directory of directories) {
    await fs.mkdir(path.join(root, directory), { recursive: true, mode: 0o700 })
  }
  for (const directory of [root, ...directories.map((entry) => path.join(root, entry))]) {
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Local Project owner directory is untrusted")
  }
}

async function writeImmutable(target: string, bytes: Uint8Array): Promise<void> {
  const handle = await fs.open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await handle.writeFile(bytes)
    await syncFileBytes(handle)
  } finally {
    await handle.close()
  }
  await syncDirectoryEntry(path.dirname(target))
}

async function writeCreateOrExact(target: string, bytes: Uint8Array): Promise<void> {
  try {
    await writeImmutable(target, bytes)
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    const existing = requireBytes(await readOptionalPlainFile(target), "Local Project owner archive disappeared")
    if (!sameBytes(existing, bytes)) {
      throw new Error("Local Project owner archive equivocation", { cause: error })
    }
  }
}

async function replaceDurably(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${target}.${randomBytes(8).toString("hex")}.staging`
  await writeImmutable(temporary, bytes)
  await fs.rename(temporary, target)
  await syncDirectoryEntry(path.dirname(target))
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
