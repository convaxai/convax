import fs from "node:fs/promises"
import path from "node:path"
import {
  causalSignerAuthorityDigestV3,
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  localOwnerEditAuthorizationCoreDigestV3,
  ordinarySha256V2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseLocalOwnerEditAuthorizationV3,
  parseLocalProjectOwnerBindingV3,
  parseProjectIdV2,
  parseProtocolPromotionBridgeV3,
  protocolPromotionBridgeCoreDigestV3,
  type ActorIdV2,
  type DigestV2,
  type DocumentScopeV2,
  type Id128V2,
  type LocalOwnerEditAuthorizationCoreV3,
  type LocalOwnerEditAuthorizationV3,
  type LocalProjectOwnerBindingCoreV3,
  type LocalProjectOwnerBindingV3,
  type ProtocolPromotionBridgeCoreV3,
  type ProtocolPromotionBridgeV3,
  type PublicKeyV2,
  type ProjectIdV2,
  type ReplicaIdV2,
} from "@convax/collaboration"
import { fsyncProjectDirectoryV2 } from "./directory-durability"
import {
  type DurableSuccessorLocalOwnerAuthorityV3,
  NodeSuccessorLocalOwnerAuthorityStoreV3,
} from "./successor-local-owner-store"
import {
  NodeSuccessorProjectProtocolStateStoreV3,
  type OpenSuccessorProjectProtocolStateV3,
  type SuccessorLocalProtocolStateV3,
  type SuccessorPromotionOriginV3,
  type SuccessorScopedLocalAuthorizationV3,
} from "./successor-protocol-state-store"

const MAX_CLAIM_BYTES = 512 * 1024

export interface SuccessorOwnerKeyIdentityV3 {
  readonly ownerKeyId: DigestV2
  readonly ownerPublicKey: PublicKeyV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
}

/**
 * Native key capability supplied by Desktop. The claim digest is the idempotency
 * key: a retry must resolve the same key identity and the same signatures. Project
 * never receives a key path or private key bytes.
 */
export interface SuccessorOwnerSigningPortV3 {
  resolveIdentity(input: Readonly<{
    claimDigest: DigestV2
    projectId: ProjectIdV2
    projectEpoch: Id128V2
  }>): Promise<SuccessorOwnerKeyIdentityV3>
  signBinding(input: Readonly<{
    claimDigest: DigestV2
    projectId: ProjectIdV2
    projectEpoch: Id128V2
    identity: SuccessorOwnerKeyIdentityV3
    core: LocalProjectOwnerBindingCoreV3
  }>): Promise<LocalProjectOwnerBindingV3>
  signAuthorization(input: Readonly<{
    claimDigest: DigestV2
    projectId: ProjectIdV2
    projectEpoch: Id128V2
    identity: SuccessorOwnerKeyIdentityV3
    core: LocalOwnerEditAuthorizationCoreV3
  }>): Promise<LocalOwnerEditAuthorizationV3>
  signBridge(input: Readonly<{
    claimDigest: DigestV2
    projectId: ProjectIdV2
    projectEpoch: Id128V2
    identity: SuccessorOwnerKeyIdentityV3
    core: ProtocolPromotionBridgeCoreV3
  }>): Promise<ProtocolPromotionBridgeV3>
}

export interface SuccessorGenesisEvidenceV3 {
  /** Exact durable native genesis/checkpoint closure used by authorization. */
  readonly authorizationProofDigest: DigestV2
  readonly durableCheckpointDigest: DigestV2
  readonly acceptedHeadDigest: DigestV2
  readonly acceptedFrontierDigest: DigestV2
}

/** Owner-specific native publication stays behind this Project-owned port. */
export interface SuccessorNewProjectGenesisPortV3 {
  /** Publishes and fsyncs the exact empty ProjectIndex genesis/checkpoint. */
  publishProjectIndexGenesis(input: Readonly<{
    claimDigest: DigestV2
    binding: LocalProjectOwnerBindingV3
    authorization: LocalOwnerEditAuthorizationV3
  }>): Promise<SuccessorGenesisEvidenceV3>
  /**
   * Uses the accepted ProjectIndex genesis to durably commit the one default
   * route, then publishes and checkpoints that exact Canvas genesis. It returns
   * only after the route proof and Canvas accepted head/frontier agree.
   */
  stageDefaultCanvasRoute(input: Readonly<{
    claimDigest: DigestV2
    stageOperationId: Id128V2
    binding: LocalProjectOwnerBindingV3
    projectIndex: SuccessorGenesisEvidenceV3
    projectIndexAuthorization: LocalOwnerEditAuthorizationV3
    projectIndexBridge: ProtocolPromotionBridgeV3
    expectedCanvasScope: DocumentScopeV2 & { readonly docKind: "canvas" }
  }>): Promise<Readonly<{
    scope: DocumentScopeV2 & { readonly docKind: "canvas" }
    predecessorFrameDigest: DigestV2
    acceptedFrontierDigest: DigestV2
  }>>
  publishDefaultCanvasGenesis(input: Readonly<{
    claimDigest: DigestV2
    binding: LocalProjectOwnerBindingV3
    stagedRoute: Readonly<{
      scope: DocumentScopeV2 & { readonly docKind: "canvas" }
      predecessorFrameDigest: DigestV2
      acceptedFrontierDigest: DigestV2
    }>
    canvasAuthorization: LocalOwnerEditAuthorizationV3
  }>): Promise<SuccessorGenesisEvidenceV3>
  activateDefaultCanvasRoute(input: Readonly<{
    claimDigest: DigestV2
    stagedRoute: Readonly<{
      scope: DocumentScopeV2 & { readonly docKind: "canvas" }
      predecessorFrameDigest: DigestV2
      acceptedFrontierDigest: DigestV2
    }>
    canvasGenesis: SuccessorGenesisEvidenceV3
    canvasBridge: ProtocolPromotionBridgeV3
  }>): Promise<void>
}

export interface VerifiedV10DocumentPromotionSourceV3 {
  readonly scope: DocumentScopeV2
  readonly ownerSchemaDigest: DigestV2
  readonly sourceHeadDigest: DigestV2
  readonly sourceFrontierDigest: DigestV2
  readonly authorizationProofDigest: DigestV2
  readonly durableCheckpointDigest: DigestV2
}

export interface VerifiedV10EmptyProjectDefaultCanvasV3 {
  readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
  readonly ownerSchemaDigest: DigestV2
  /** Exact precommitted intent authorizing creation of this one default Canvas. */
  readonly creationClaimDigest: DigestV2
  readonly stageOperationId: Id128V2
}

export type VerifiedV10PromotionInspectionV3 =
  | Readonly<{
      status: "verified-unshared"
      r5AuthorityManifestSha256: DigestV2
      verifiedLegacyClosureDigest: DigestV2
      documents: readonly VerifiedV10DocumentPromotionSourceV3[]
      emptyProjectDefaultCanvas?: VerifiedV10EmptyProjectDefaultCanvasV3
    }>
  | Readonly<{ status: "shared" | "ambiguous" | "invalid" }>

/**
 * The implementation must verify the complete selected R5 closure and classify
 * Team evidence before returning `verified-unshared`. It exposes only immutable
 * V2 head/frontier digests: existing V10 frame bytes and suffixes remain owned by
 * the verified R5 decoder and must never be handed to a V3 decoder. Directory
 * presence and network reachability are not admissible evidence.
 */
export interface VerifiedV10PromotionInspectionPortV3 {
  inspect(input: Readonly<{
    projectId: ProjectIdV2
    projectEpoch: Id128V2
  }>): Promise<VerifiedV10PromotionInspectionV3>
}

export interface NewLocalProjectProvisionInputV3 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly protocolDigest: DigestV2
  readonly projectIndexSchemaDigest: DigestV2
  readonly canvasSchemaDigest: DigestV2
  readonly promotionId: Id128V2
  readonly projectIndexScope: DocumentScopeV2 & { readonly docKind: "project-index" }
  readonly defaultCanvasScope: DocumentScopeV2 & { readonly docKind: "canvas" }
  readonly defaultCanvasStageOperationId: Id128V2
}

export interface PromoteVerifiedV10ProjectInputV3 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly protocolDigest: DigestV2
  readonly promotionId: Id128V2
}

export type SuccessorLocalProjectProvisionResultV3 =
  | Readonly<{
      status: "ready"
      state: SuccessorLocalProtocolStateV3
      stateDigest: DigestV2
    }>
  | Readonly<{
      status: "rejected"
      reason: "shared" | "ambiguous" | "invalid-v10" | "promotion-recovery-required"
    }>

export type PreparedVerifiedV10PromotionV3 =
  | Readonly<{
      status: "prepared"
      claimDigest: DigestV2
    }>
  | SuccessorLocalProjectProvisionResultV3

type ProvisioningDocumentV3 = Readonly<{
  scope: DocumentScopeV2
  ownerSchemaDigest: DigestV2
  source: Readonly<
    | { kind: "new-project"; creationClaimDigest: DigestV2; stageOperationId: Id128V2 }
    | {
        kind: "v10-r5"
        sourceHeadDigest: DigestV2
        sourceFrontierDigest: DigestV2
        durableCheckpointDigest: DigestV2
      }
  >
  proofKind: "project-index-genesis" | "accepted-project-index-route-genesis"
  proofDigest?: DigestV2
}>

interface LocalProjectProvisioningClaimV3 {
  readonly format: "convax.local-project-provisioning-claim/3"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly protocolDigest: DigestV2
  readonly promotionId: Id128V2
  readonly origin: SuccessorPromotionOriginV3
  readonly documents: readonly ProvisioningDocumentV3[]
}

export class SuccessorLocalProjectProvisionerV3 {
  constructor(private readonly options: {
    readonly projectPrivateDirectory: string
    readonly ownerStore: NodeSuccessorLocalOwnerAuthorityStoreV3
    readonly protocolStore: NodeSuccessorProjectProtocolStateStoreV3
    readonly signers: SuccessorOwnerSigningPortV3
    readonly genesis: SuccessorNewProjectGenesisPortV3
    readonly v10: VerifiedV10PromotionInspectionPortV3
    readonly faults?: {
      afterCreationClaim?(): Promise<void>
      afterProvisioningClaim?(): Promise<void>
      afterOwnerBindingSigned?(): Promise<void>
      afterAuthorizationsSigned?(): Promise<void>
      afterOwnerAuthority?(): Promise<void>
      afterProjectIndexGenesis?(): Promise<void>
      afterProjectIndexBridgeJournal?(): Promise<void>
      afterDefaultCanvasRouteStage?(): Promise<void>
      afterCanvasAuthorizationSigned?(): Promise<void>
      afterDefaultCanvasGenesis?(): Promise<void>
      afterDefaultCanvasRouteActivation?(): Promise<void>
      beforeProtocolInstall?(): Promise<void>
    }
  }) {
    requireAbsolute(options.projectPrivateDirectory)
  }

  async provisionNewProject(input: NewLocalProjectProvisionInputV3): Promise<SuccessorLocalProjectProvisionResultV3> {
    const normalized = normalizeNewProjectInput(input)
    const prior = await this.resolveExisting(normalized.projectId, normalized.projectEpoch)
    if (prior) return prior
    const creationClaimDigest = await this.installCreationClaim(normalized)
    await this.options.faults?.afterCreationClaim?.()
    const claim = await this.installClaim({
      format: "convax.local-project-provisioning-claim/3",
      projectId: normalized.projectId,
      projectEpoch: normalized.projectEpoch,
      protocolDigest: normalized.protocolDigest,
      promotionId: normalized.promotionId,
      origin: Object.freeze({ kind: "new-project", creationClaimDigest }),
      documents: sortDocuments([
        { scope: normalized.projectIndexScope, ownerSchemaDigest: normalized.projectIndexSchemaDigest, source: { kind: "new-project", creationClaimDigest, stageOperationId: normalized.defaultCanvasStageOperationId }, proofKind: "project-index-genesis" },
        { scope: normalized.defaultCanvasScope, ownerSchemaDigest: normalized.canvasSchemaDigest, source: { kind: "new-project", creationClaimDigest, stageOperationId: normalized.defaultCanvasStageOperationId }, proofKind: "accepted-project-index-route-genesis" },
      ]),
    })
    await this.options.faults?.afterProvisioningClaim?.()
    return this.provisionClaim(claim)
  }

  async promoteVerifiedV10(input: PromoteVerifiedV10ProjectInputV3): Promise<SuccessorLocalProjectProvisionResultV3> {
    const prepared = await this.prepareVerifiedV10Promotion(input)
    if (prepared.status !== "prepared") return prepared
    const installed = await this.readInstalledClaim(prepared.claimDigest)
    return this.provisionClaim(installed)
  }

  /**
   * Installs the exact retry-stable V10 promotion claim before Desktop opens the
   * claim-bound V3 writer. Returning only its digest keeps claim encoding and
   * V10 inspection in Project/node; callers cannot provide or alter claim bytes.
   */
  async prepareVerifiedV10Promotion(input: PromoteVerifiedV10ProjectInputV3): Promise<PreparedVerifiedV10PromotionV3> {
    const projectId = parseProjectIdV2(input.projectId)
    const projectEpoch = parseId128V2(input.projectEpoch)
    const prior = await this.resolveExisting(projectId, projectEpoch)
    if (prior) return prior
    const retryBytes = await readOptional(this.claimPath())
    if (retryBytes) {
      const retryClaim = parseClaim(decodeRestrictedJcsV2(retryBytes))
      if (
        retryClaim.projectId !== projectId || retryClaim.projectEpoch !== projectEpoch ||
        retryClaim.protocolDigest !== parseDigestV2(input.protocolDigest) ||
        retryClaim.origin.kind !== "v10-r5-unshared"
      ) throw new Error("Prepared V10 promotion claim crossed its retry scope")
      return Object.freeze({ status: "prepared", claimDigest: ordinarySha256V2(retryBytes) })
    }
    const inspection = await this.options.v10.inspect({ projectId, projectEpoch })
    if (inspection.status !== "verified-unshared") {
      return Object.freeze({
        status: "rejected",
        reason: inspection.status === "shared" ? "shared" : inspection.status === "ambiguous" ? "ambiguous" : "invalid-v10",
      })
    }
    const documents: ProvisioningDocumentV3[] = [...sortDocuments(inspection.documents.map((entry) => {
      const scope = parseDocumentScopeV2(entry.scope)
      return Object.freeze({
        scope,
        ownerSchemaDigest: parseDigestV2(entry.ownerSchemaDigest),
        source: Object.freeze({
          kind: "v10-r5" as const,
          sourceHeadDigest: parseDigestV2(entry.sourceHeadDigest),
          sourceFrontierDigest: parseDigestV2(entry.sourceFrontierDigest),
          durableCheckpointDigest: parseDigestV2(entry.durableCheckpointDigest),
        }),
        proofKind: scope.docKind === "project-index" ? "project-index-genesis" as const : "accepted-project-index-route-genesis" as const,
        proofDigest: parseDigestV2(entry.authorizationProofDigest),
      })
    }))]
    requireOneProjectIndex(documents, projectId, projectEpoch)
    const existingCanvases = documents.filter((entry) => entry.scope.docKind === "canvas")
    if (existingCanvases.length === 0) {
      if (!inspection.emptyProjectDefaultCanvas) return Object.freeze({ status: "rejected", reason: "invalid-v10" })
      const defaultScope = parseDocumentScopeV2(inspection.emptyProjectDefaultCanvas.scope)
      if (defaultScope.docKind !== "canvas" || defaultScope.projectId !== projectId || defaultScope.projectEpoch !== projectEpoch) {
        return Object.freeze({ status: "rejected", reason: "invalid-v10" })
      }
      documents.push(Object.freeze({
        scope: defaultScope,
        ownerSchemaDigest: parseDigestV2(inspection.emptyProjectDefaultCanvas.ownerSchemaDigest),
        source: Object.freeze({ kind: "new-project" as const, creationClaimDigest: parseDigestV2(inspection.emptyProjectDefaultCanvas.creationClaimDigest), stageOperationId: parseId128V2(inspection.emptyProjectDefaultCanvas.stageOperationId) }),
        proofKind: "accepted-project-index-route-genesis" as const,
      }))
      documents.sort((left, right) => scopeKey(left.scope).localeCompare(scopeKey(right.scope)))
    } else if (inspection.emptyProjectDefaultCanvas) {
      return Object.freeze({ status: "rejected", reason: "invalid-v10" })
    }
    const claim = await this.installClaim({
      format: "convax.local-project-provisioning-claim/3",
      projectId,
      projectEpoch,
      protocolDigest: parseDigestV2(input.protocolDigest),
      promotionId: parseId128V2(input.promotionId),
      origin: Object.freeze({
        kind: "v10-r5-unshared",
        r5AuthorityManifestSha256: parseDigestV2(inspection.r5AuthorityManifestSha256),
        verifiedLegacyClosureDigest: parseDigestV2(inspection.verifiedLegacyClosureDigest),
      }),
      documents,
    })
    await this.options.faults?.afterProvisioningClaim?.()
    return Object.freeze({ status: "prepared", claimDigest: claim.claimDigest })
  }

  private async resolveExisting(projectId: ProjectIdV2, projectEpoch: Id128V2): Promise<SuccessorLocalProjectProvisionResultV3 | null> {
    const owner = await this.options.ownerStore.open(projectId, projectEpoch)
    if (owner.status === "shared") return Object.freeze({ status: "rejected", reason: "shared" })
    if (owner.status === "recovery-required") return Object.freeze({ status: "rejected", reason: "ambiguous" })
    const protocol = await this.options.protocolStore.open(projectId)
    if (protocol.status === "v3-local") {
      if (owner.status !== "unshared" || protocol.state.projectEpoch !== projectEpoch) return Object.freeze({ status: "rejected", reason: "ambiguous" })
      return ready(protocol)
    }
    if (protocol.status === "recovery-required") {
      return Object.freeze({ status: "rejected", reason: "promotion-recovery-required" })
    }
    if (protocol.status === "not-installed") {
      const highWater = await this.options.protocolStore.inspectDeviceHighWater(projectId, projectEpoch)
      if (highWater.status !== "absent") return Object.freeze({ status: "rejected", reason: "promotion-recovery-required" })
    }
    return null
  }

  private async installClaim(input: LocalProjectProvisioningClaimV3): Promise<Readonly<{
    claim: LocalProjectProvisioningClaimV3
    claimDigest: DigestV2
  }>> {
    const claim = parseClaim(input)
    const bytes = encodeRestrictedJcsV2(claim)
    const claimDigest = ordinarySha256V2(bytes)
    await ensurePlainDirectory(this.stateDirectory())
    await writeCreateOrExact(this.claimPath(), bytes, "Local Project provisioning claim equivocation")
    const persisted = parseClaim(decodeRestrictedJcsV2((await readOptional(this.claimPath()))!))
    return Object.freeze({ claim: persisted, claimDigest })
  }

  private async readInstalledClaim(expectedDigest: DigestV2): Promise<Readonly<{
    claim: LocalProjectProvisioningClaimV3
    claimDigest: DigestV2
  }>> {
    const bytes = await readOptional(this.claimPath())
    if (!bytes || ordinarySha256V2(bytes) !== parseDigestV2(expectedDigest)) {
      throw new Error("Prepared local Project provisioning claim is unavailable")
    }
    return Object.freeze({ claim: parseClaim(decodeRestrictedJcsV2(bytes)), claimDigest: parseDigestV2(expectedDigest) })
  }

  private async installCreationClaim(input: NewLocalProjectProvisionInputV3): Promise<DigestV2> {
    const bytes = encodeRestrictedJcsV2(newProjectClaimSeed(input))
    await ensurePlainDirectory(this.stateDirectory())
    await writeCreateOrExact(this.creationClaimPath(), bytes, "Local Project creation claim equivocation")
    return ordinarySha256V2(bytes)
  }

  private async provisionClaim(installed: Readonly<{ claim: LocalProjectProvisioningClaimV3; claimDigest: DigestV2 }>): Promise<SuccessorLocalProjectProvisionResultV3> {
    const { claim, claimDigest } = installed
    const signingContext = Object.freeze({ claimDigest, projectId: claim.projectId, projectEpoch: claim.projectEpoch })
    const identity = await this.options.signers.resolveIdentity(signingContext)
    const boundSigningContext = Object.freeze({ ...signingContext, identity })
    const projectIndex = claim.documents.find((entry) => entry.scope.docKind === "project-index")!
    const bindingCore: LocalProjectOwnerBindingCoreV3 = Object.freeze({
      format: "convax.local-project-owner-binding-core/3",
      projectId: claim.projectId,
      projectEpoch: claim.projectEpoch,
      ownerKeyId: parseDigestV2(identity.ownerKeyId),
      ownerPublicKey: identity.ownerPublicKey,
      initialReplicaId: identity.replicaId,
      initialActorId: identity.actorId,
      protocolDigest: claim.protocolDigest,
      genesisAuthorizationPolicy: Object.freeze({
        format: "convax.local-owner-genesis-authorization-policy/3",
        projectIndexScope: projectIndex.scope as DocumentScopeV2 & { readonly docKind: "project-index" },
        canvasAuthorization: "accepted-project-index-route-genesis-only",
      }),
      sharingGeneration: "0",
      creationNonce: claim.promotionId,
    })
    const binding = parseLocalProjectOwnerBindingV3(await this.options.signers.signBinding({ ...boundSigningContext, core: bindingCore }))
    requireBindingMatchesCore(binding, bindingCore)
    await this.options.faults?.afterOwnerBindingSigned?.()

    const signAuthorization = async (document: ProvisioningDocumentV3) => {
      const core: LocalOwnerEditAuthorizationCoreV3 = Object.freeze({
        format: "convax.local-owner-edit-authorization-core/3",
        ownerBindingCoreDigest: binding.coreDigest,
        projectId: claim.projectId,
        projectEpoch: claim.projectEpoch,
        scope: document.scope,
        replicaId: binding.core.initialReplicaId,
        actorId: binding.core.initialActorId,
        ownerSchemaDigest: document.ownerSchemaDigest,
        actorSequenceAllocationPolicy: Object.freeze({
          format: "convax.local-owner-actor-sequence-allocation-policy/3",
          kind: "strict-durable-head-successor",
          initialSequence: "1",
        }),
        protocolDigest: claim.protocolDigest,
        sharingGeneration: "0",
        expiryPolicy: "none",
      })
      const authorization = parseLocalOwnerEditAuthorizationV3(await this.options.signers.signAuthorization({ ...boundSigningContext, core }))
      if (authorization.coreDigest !== localOwnerEditAuthorizationCoreDigestV3(core) || authorization.core.ownerBindingCoreDigest !== binding.coreDigest) {
        throw new Error("Native signer returned a crossed local owner authorization")
      }
      return Object.freeze({ document, authorization })
    }
    const projectIndexDocument = claim.documents.find((entry) => entry.scope.docKind === "project-index")!
    const projectIndexAuthorization = await signAuthorization(projectIndexDocument)
    const authorizations: Array<Awaited<ReturnType<typeof signAuthorization>>> = [projectIndexAuthorization]
    if (claim.origin.kind === "v10-r5-unshared") {
      for (const document of claim.documents) if (document !== projectIndexDocument && document.source.kind === "v10-r5") authorizations.push(await signAuthorization(document))
      authorizations.sort((left, right) => scopeKey(left.document.scope).localeCompare(scopeKey(right.document.scope)))
    }
    await this.options.faults?.afterAuthorizationsSigned?.()
    await this.options.ownerStore.installUnshared({ binding, authorizations: authorizations.map((entry) => entry.authorization) })
    await this.options.faults?.afterOwnerAuthority?.()

    const evidence = new Map<string, SuccessorGenesisEvidenceV3>()
    const bridges = new Map<string, ProtocolPromotionBridgeV3>()
    const signBridge = async (
      entry: typeof authorizations[number],
      genesis?: SuccessorGenesisEvidenceV3,
    ): Promise<ProtocolPromotionBridgeV3> => {
      const signerAuthority = Object.freeze({
        kind: "local-project-owner" as const,
        ownerKeyId: binding.core.ownerKeyId,
        replicaId: binding.core.initialReplicaId,
        actorId: binding.core.initialActorId,
        ownerBindingCoreDigest: binding.coreDigest,
        ownerEditAuthorizationCoreDigest: entry.authorization.coreDigest,
      })
      const source = entry.document.source.kind === "new-project"
        ? Object.freeze({
            kind: "new-project" as const,
            creationClaimDigest: entry.document.source.creationClaimDigest,
            genesisHeadDigest: genesis!.acceptedHeadDigest,
            genesisFrontierDigest: genesis!.acceptedFrontierDigest,
          })
        : Object.freeze({
            kind: "v10-r5" as const,
            r5AuthorityManifestSha256: claim.origin.kind === "v10-r5-unshared" ? claim.origin.r5AuthorityManifestSha256 : (() => { throw new Error("V10 bridge lost its promotion origin") })(),
            sourceHeadDigest: parseDigestV2(entry.document.source.kind === "v10-r5" ? entry.document.source.sourceHeadDigest : null),
            sourceFrontierDigest: parseDigestV2(entry.document.source.kind === "v10-r5" ? entry.document.source.sourceFrontierDigest : null),
          })
      const core: ProtocolPromotionBridgeCoreV3 = Object.freeze({
        format: "convax.protocol-promotion-bridge-core/3",
        projectId: claim.projectId,
        projectEpoch: claim.projectEpoch,
        scope: entry.document.scope,
        source,
        successorProtocolDigest: claim.protocolDigest,
        signerAuthority,
        signerAuthorityDigest: causalSignerAuthorityDigestV3(signerAuthority),
        bridgeId: bridgeId(claim.promotionId, entry.document.scope),
      })
      const bridge = parseProtocolPromotionBridgeV3(await this.options.signers.signBridge({ ...boundSigningContext, core }))
      if (bridge.coreDigest !== protocolPromotionBridgeCoreDigestV3(core) || bridge.signerPublicKey !== binding.core.ownerPublicKey) {
        throw new Error("Native signer returned a crossed protocol promotion bridge")
      }
      return bridge
    }
    if (claim.origin.kind === "new-project") {
      const projectIndexGenesis = parseGenesisEvidence(await this.options.genesis.publishProjectIndexGenesis({
        claimDigest,
        binding,
        authorization: projectIndexAuthorization.authorization,
      }))
      evidence.set(scopeKey(projectIndex.scope), projectIndexGenesis)
      await this.options.faults?.afterProjectIndexGenesis?.()
      const projectIndexBridge = await signBridge(projectIndexAuthorization, projectIndexGenesis)
      bridges.set(scopeKey(projectIndex.scope), projectIndexBridge)
      await this.installProjectIndexBridgeJournal({
        claimDigest,
        binding,
        authorization: projectIndexAuthorization.authorization,
        genesis: projectIndexGenesis,
        bridge: projectIndexBridge,
      })
      await this.options.faults?.afterProjectIndexBridgeJournal?.()
      const defaultCanvasDocument = claim.documents.find((entry) => entry.scope.docKind === "canvas")!
      const stagedRoute = await this.options.genesis.stageDefaultCanvasRoute({
        claimDigest,
        stageOperationId: defaultCanvasDocument.source.kind === "new-project" ? defaultCanvasDocument.source.stageOperationId : (() => { throw new Error("Default Canvas stage identity is unavailable") })(),
        binding,
        projectIndex: projectIndexGenesis,
        projectIndexAuthorization: projectIndexAuthorization.authorization,
        projectIndexBridge,
        expectedCanvasScope: defaultCanvasDocument.scope as DocumentScopeV2 & { readonly docKind: "canvas" },
      })
      requireSameScope(stagedRoute.scope, defaultCanvasDocument.scope, "Default Canvas staged route")
      await this.options.faults?.afterDefaultCanvasRouteStage?.()
      const defaultCanvas = await signAuthorization(defaultCanvasDocument)
      authorizations.push(defaultCanvas)
      authorizations.sort((left, right) => scopeKey(left.document.scope).localeCompare(scopeKey(right.document.scope)))
      await this.options.ownerStore.installUnshared({ binding, authorizations: [defaultCanvas.authorization] })
      await this.options.faults?.afterCanvasAuthorizationSigned?.()
      const canvasGenesis = parseGenesisEvidence(await this.options.genesis.publishDefaultCanvasGenesis({
        claimDigest,
        binding,
        stagedRoute,
        canvasAuthorization: defaultCanvas.authorization,
      }))
      evidence.set(scopeKey(defaultCanvas.document.scope), canvasGenesis)
      await this.options.faults?.afterDefaultCanvasGenesis?.()
      const canvasBridge = await signBridge(defaultCanvas, canvasGenesis)
      bridges.set(scopeKey(defaultCanvas.document.scope), canvasBridge)
      await this.options.genesis.activateDefaultCanvasRoute({ claimDigest, stagedRoute, canvasGenesis, canvasBridge })
      await this.options.faults?.afterDefaultCanvasRouteActivation?.()
    } else {
      for (const entry of authorizations) bridges.set(scopeKey(entry.document.scope), await signBridge(entry))
      const defaultCanvasDocument = claim.documents.find((entry) => entry.scope.docKind === "canvas" && entry.source.kind === "new-project")
      if (defaultCanvasDocument) {
        if (projectIndexDocument.source.kind !== "v10-r5") throw new Error("V10 default Canvas promotion lost its verified ProjectIndex predecessor")
        const projectIndexEvidence = parseGenesisEvidence({
          authorizationProofDigest: parseDigestV2(projectIndexDocument.proofDigest),
          durableCheckpointDigest: projectIndexDocument.source.durableCheckpointDigest,
          acceptedHeadDigest: projectIndexDocument.source.sourceHeadDigest,
          acceptedFrontierDigest: projectIndexDocument.source.sourceFrontierDigest,
        })
        const projectIndexBridge = bridges.get(scopeKey(projectIndexDocument.scope))!
        await this.installProjectIndexBridgeJournal({ claimDigest, binding, authorization: projectIndexAuthorization.authorization, genesis: projectIndexEvidence, bridge: projectIndexBridge })
        await this.options.faults?.afterProjectIndexBridgeJournal?.()
        const stagedRoute = await this.options.genesis.stageDefaultCanvasRoute({
          claimDigest, stageOperationId: defaultCanvasDocument.source.kind === "new-project" ? defaultCanvasDocument.source.stageOperationId : (() => { throw new Error("Default Canvas stage identity is unavailable") })(), binding, projectIndex: projectIndexEvidence,
          projectIndexAuthorization: projectIndexAuthorization.authorization,
          projectIndexBridge,
          expectedCanvasScope: defaultCanvasDocument.scope as DocumentScopeV2 & { readonly docKind: "canvas" },
        })
        requireSameScope(stagedRoute.scope, defaultCanvasDocument.scope, "Promoted default Canvas staged route")
        await this.options.faults?.afterDefaultCanvasRouteStage?.()
        const defaultCanvas = await signAuthorization(defaultCanvasDocument)
        authorizations.push(defaultCanvas)
        authorizations.sort((left, right) => scopeKey(left.document.scope).localeCompare(scopeKey(right.document.scope)))
        await this.options.ownerStore.installUnshared({ binding, authorizations: [defaultCanvas.authorization] })
        await this.options.faults?.afterCanvasAuthorizationSigned?.()
        const canvasGenesis = parseGenesisEvidence(await this.options.genesis.publishDefaultCanvasGenesis({ claimDigest, binding, stagedRoute, canvasAuthorization: defaultCanvas.authorization }))
        evidence.set(scopeKey(defaultCanvas.document.scope), canvasGenesis)
        await this.options.faults?.afterDefaultCanvasGenesis?.()
        const canvasBridge = await signBridge(defaultCanvas, canvasGenesis)
        bridges.set(scopeKey(defaultCanvas.document.scope), canvasBridge)
        await this.options.genesis.activateDefaultCanvasRoute({ claimDigest, stagedRoute, canvasGenesis, canvasBridge })
        await this.options.faults?.afterDefaultCanvasRouteActivation?.()
      }
    }

    const scoped: SuccessorScopedLocalAuthorizationV3[] = []
    const orderedBridges: ProtocolPromotionBridgeV3[] = []
    for (const entry of authorizations) {
      const genesis = evidence.get(scopeKey(entry.document.scope))
      const proofDigest = entry.document.source.kind === "new-project"
        ? genesis!.authorizationProofDigest
        : parseDigestV2(entry.document.proofDigest)
      scoped.push(Object.freeze({
        authorization: entry.authorization,
        proof: Object.freeze({ kind: entry.document.proofKind, proofDigest }),
      }))
      const bridge = bridges.get(scopeKey(entry.document.scope))
      if (!bridge) throw new Error("Protocol promotion bridge closure is incomplete")
      orderedBridges.push(bridge)
    }
    const state: SuccessorLocalProtocolStateV3 = Object.freeze({
      format: "convax.project-protocol-state-local/3",
      projectId: claim.projectId,
      projectEpoch: claim.projectEpoch,
      protocolDigest: claim.protocolDigest,
      sharingGeneration: "0",
      origin: claim.origin,
      ownerBinding: binding,
      authorizations: Object.freeze(scoped),
      bridges: Object.freeze(orderedBridges),
    })
    await this.options.faults?.beforeProtocolInstall?.()
    const installedState = await this.options.protocolStore.installLocal({ state, promotionId: claim.promotionId })
    return Object.freeze({ status: "ready", ...installedState })
  }

  private stateDirectory() { return path.join(this.options.projectPrivateDirectory, "protocol-v3") }
  private creationClaimPath() { return path.join(this.stateDirectory(), "creation-claim.jcs") }
  private claimPath() { return path.join(this.stateDirectory(), "local-provisioning-claim.jcs") }
  private projectIndexBridgeJournalPath() { return path.join(this.stateDirectory(), "project-index-bridge-journal.jcs") }

  private async installProjectIndexBridgeJournal(input: Readonly<{
    claimDigest: DigestV2
    binding: LocalProjectOwnerBindingV3
    authorization: LocalOwnerEditAuthorizationV3
    genesis: SuccessorGenesisEvidenceV3
    bridge: ProtocolPromotionBridgeV3
  }>): Promise<void> {
    await writeCreateOrExact(this.projectIndexBridgeJournalPath(), encodeRestrictedJcsV2(Object.freeze({
      format: "convax.project-index-promotion-bridge-journal/3",
      claimDigest: parseDigestV2(input.claimDigest),
      ownerBindingCoreDigest: input.binding.coreDigest,
      authorization: parseLocalOwnerEditAuthorizationV3(input.authorization),
      genesis: parseGenesisEvidence(input.genesis),
      bridge: parseProtocolPromotionBridgeV3(input.bridge),
    })), "ProjectIndex promotion bridge journal equivocation")
  }
}

function normalizeNewProjectInput(input: NewLocalProjectProvisionInputV3): NewLocalProjectProvisionInputV3 {
  const projectId = parseProjectIdV2(input.projectId)
  const projectEpoch = parseId128V2(input.projectEpoch)
  const projectIndexScope = parseDocumentScopeV2(input.projectIndexScope)
  const defaultCanvasScope = parseDocumentScopeV2(input.defaultCanvasScope)
  if (projectIndexScope.docKind !== "project-index" || defaultCanvasScope.docKind !== "canvas" ||
    projectIndexScope.projectId !== projectId || defaultCanvasScope.projectId !== projectId ||
    projectIndexScope.projectEpoch !== projectEpoch || defaultCanvasScope.projectEpoch !== projectEpoch) {
    throw new Error("New Project scopes crossed their exact Project or epoch")
  }
  return Object.freeze({
    projectId,
    projectEpoch,
    protocolDigest: parseDigestV2(input.protocolDigest),
    projectIndexSchemaDigest: parseDigestV2(input.projectIndexSchemaDigest),
    canvasSchemaDigest: parseDigestV2(input.canvasSchemaDigest),
    promotionId: parseId128V2(input.promotionId),
    projectIndexScope: projectIndexScope as NewLocalProjectProvisionInputV3["projectIndexScope"],
    defaultCanvasScope: defaultCanvasScope as NewLocalProjectProvisionInputV3["defaultCanvasScope"],
    defaultCanvasStageOperationId: parseId128V2(input.defaultCanvasStageOperationId),
  })
}

function newProjectClaimSeed(input: NewLocalProjectProvisionInputV3) {
  return Object.freeze({
    format: "convax.local-project-creation-claim-seed/3",
    projectId: input.projectId,
    projectEpoch: input.projectEpoch,
    protocolDigest: input.protocolDigest,
    projectIndexSchemaDigest: input.projectIndexSchemaDigest,
    canvasSchemaDigest: input.canvasSchemaDigest,
    promotionId: input.promotionId,
    projectIndexScope: input.projectIndexScope,
    defaultCanvasScope: input.defaultCanvasScope,
    defaultCanvasStageOperationId: input.defaultCanvasStageOperationId,
  })
}

function parseClaim(value: unknown): LocalProjectProvisioningClaimV3 {
  exactObject(value, ["format", "projectId", "projectEpoch", "protocolDigest", "promotionId", "origin", "documents"], "Local Project provisioning claim")
  if (value.format !== "convax.local-project-provisioning-claim/3") throw new Error("Local Project provisioning claim format is invalid")
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const origin = parseOrigin(value.origin)
  if (!Array.isArray(value.documents) || value.documents.length < 1 || value.documents.length > 257) throw new Error("Local Project provisioning document closure is invalid")
  const documents = sortDocuments(value.documents.map((document) => parseDocument(document, projectId, projectEpoch, origin.kind)))
  requireOneProjectIndex(documents, projectId, projectEpoch)
  if (origin.kind === "new-project" && documents.filter((entry) => entry.scope.docKind === "canvas").length !== 1) throw new Error("New Project claim requires one default Canvas")
  return Object.freeze({
    format: value.format,
    projectId,
    projectEpoch,
    protocolDigest: parseDigestV2(value.protocolDigest),
    promotionId: parseId128V2(value.promotionId),
    origin,
    documents,
  })
}

function parseOrigin(value: unknown): SuccessorPromotionOriginV3 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Local Project provisioning origin is invalid")
  const source = value as Record<string, unknown>
  if (source.kind === "new-project") {
    exactObject(source, ["kind", "creationClaimDigest"], "New Project provisioning origin")
    return Object.freeze({ kind: source.kind, creationClaimDigest: parseDigestV2(source.creationClaimDigest) })
  }
  if (source.kind === "v10-r5-unshared") {
    exactObject(source, ["kind", "r5AuthorityManifestSha256", "verifiedLegacyClosureDigest"], "V10 promotion origin")
    return Object.freeze({ kind: source.kind, r5AuthorityManifestSha256: parseDigestV2(source.r5AuthorityManifestSha256), verifiedLegacyClosureDigest: parseDigestV2(source.verifiedLegacyClosureDigest) })
  }
  throw new Error("Local Project provisioning origin kind is invalid")
}

function parseDocument(value: unknown, projectId: ProjectIdV2, projectEpoch: Id128V2, origin: SuccessorPromotionOriginV3["kind"]): ProvisioningDocumentV3 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Provisioning document is invalid")
  const source = value as Record<string, unknown>
  const scope = parseDocumentScopeV2(source.scope)
  if (scope.projectId !== projectId || scope.projectEpoch !== projectEpoch) throw new Error("Provisioning document crossed its Project or epoch")
  const proofKind = scope.docKind === "project-index" ? "project-index-genesis" : "accepted-project-index-route-genesis"
  if (source.proofKind !== proofKind) throw new Error("Provisioning document proof kind mismatches scope")
  if (!source.source || typeof source.source !== "object" || Array.isArray(source.source)) throw new Error("Provisioning source is invalid")
  const sourceObject = source.source as Record<string, unknown>
  if (sourceObject.kind === "new-project") {
    exactObject(source, ["scope", "ownerSchemaDigest", "source", "proofKind"], "Provisioning document")
    exactObject(sourceObject, ["kind", "creationClaimDigest", "stageOperationId"], "New Project document source")
    return Object.freeze({ scope, ownerSchemaDigest: parseDigestV2(source.ownerSchemaDigest), source: Object.freeze({ kind: "new-project", creationClaimDigest: parseDigestV2(sourceObject.creationClaimDigest), stageOperationId: parseId128V2(sourceObject.stageOperationId) }), proofKind })
  }
  if (origin !== "v10-r5-unshared") throw new Error("New Project document source is invalid")
  exactObject(source, ["scope", "ownerSchemaDigest", "source", "proofKind", "proofDigest"], "Provisioning document")
  exactObject(sourceObject, ["kind", "sourceHeadDigest", "sourceFrontierDigest", "durableCheckpointDigest"], "V10 document source")
  if (sourceObject.kind !== "v10-r5") throw new Error("V10 document source is invalid")
  return Object.freeze({
    scope,
    ownerSchemaDigest: parseDigestV2(source.ownerSchemaDigest),
    source: Object.freeze({ kind: "v10-r5", sourceHeadDigest: parseDigestV2(sourceObject.sourceHeadDigest), sourceFrontierDigest: parseDigestV2(sourceObject.sourceFrontierDigest), durableCheckpointDigest: parseDigestV2(sourceObject.durableCheckpointDigest) }),
    proofKind,
    proofDigest: parseDigestV2(source.proofDigest),
  })
}

function requireOneProjectIndex(documents: readonly ProvisioningDocumentV3[], projectId: ProjectIdV2, projectEpoch: Id128V2) {
  const projectIndex = documents.filter((entry) => entry.scope.docKind === "project-index")
  if (projectIndex.length !== 1 || projectIndex[0]!.scope.projectId !== projectId || projectIndex[0]!.scope.projectEpoch !== projectEpoch) {
    throw new Error("Promotion requires one exact ProjectIndex scope")
  }
}

function sortDocuments<T extends ProvisioningDocumentV3>(documents: readonly T[]): readonly T[] {
  const sorted = [...documents].sort((left, right) => scopeKey(left.scope).localeCompare(scopeKey(right.scope)))
  for (let index = 1; index < sorted.length; index += 1) if (scopeKey(sorted[index - 1]!.scope) === scopeKey(sorted[index]!.scope)) throw new Error("Provisioning scopes must be duplicate-free")
  return Object.freeze(sorted)
}

function requireBindingMatchesCore(binding: LocalProjectOwnerBindingV3, core: LocalProjectOwnerBindingCoreV3) {
  if (new TextDecoder().decode(encodeRestrictedJcsV2(binding.core)) !== new TextDecoder().decode(encodeRestrictedJcsV2(core))) {
    throw new Error("Native signer returned a crossed local owner binding")
  }
}

function parseGenesisEvidence(value: SuccessorGenesisEvidenceV3): SuccessorGenesisEvidenceV3 {
  return Object.freeze({
    authorizationProofDigest: parseDigestV2(value.authorizationProofDigest),
    durableCheckpointDigest: parseDigestV2(value.durableCheckpointDigest),
    acceptedHeadDigest: parseDigestV2(value.acceptedHeadDigest),
    acceptedFrontierDigest: parseDigestV2(value.acceptedFrontierDigest),
  })
}

function ready(protocol: Extract<OpenSuccessorProjectProtocolStateV3, { status: "v3-local" }>): SuccessorLocalProjectProvisionResultV3 {
  return Object.freeze({ status: "ready", state: protocol.state, stateDigest: protocol.stateDigest })
}

function bridgeId(promotionId: Id128V2, scope: DocumentScopeV2): Id128V2 {
  const digest = ordinarySha256V2(encodeRestrictedJcsV2({ domain: "convax.protocol-promotion-bridge-id/3", promotionId, scope }))
  const bytes = Uint8Array.from(digest.slice(0, 32).match(/../gu)!, (pair) => Number.parseInt(pair, 16))
  return parseId128V2(toBase64url(bytes))
}

function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url")
}

function scopeKey(scope: DocumentScopeV2): string { return new TextDecoder().decode(encodeRestrictedJcsV2(scope)) }

function requireSameScope(left: DocumentScopeV2, right: DocumentScopeV2, label: string) {
  if (scopeKey(parseDocumentScopeV2(left)) !== scopeKey(parseDocumentScopeV2(right))) throw new Error(`${label} crossed its preclaimed scope`)
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
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_CLAIM_BYTES) throw new Error("Provisioning claim is not a bounded plain file")
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
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Provisioning directory is not a plain directory")
}

function sameBytes(left: Uint8Array, right: Uint8Array) { return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]) }
function requireAbsolute(value: string) { if (!path.isAbsolute(value) || path.resolve(value) !== value) throw new TypeError("Project private directory must be canonical and absolute") }
