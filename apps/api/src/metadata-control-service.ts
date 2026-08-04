import {
  assertExactPruningCoverageV2,
  encodeRestrictedJcsTextV2,
  incrementUint64V2,
  parseCheckpointContentCertificateV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseMemberIdV2,
  parsePrunableCheckpointSetCertificateV2,
  parseReplicaCausalFloorAckV2,
  parseReplicaIdV2,
  parseStableCheckpointSetCoreV2,
  parseUint32V2,
  stableCheckpointSetCoreDigestV2,
  structuredDigestV2,
  type CheckpointContentCertificateV2,
  type DigestV2,
  type DocumentScopeV2,
  type MemberIdV2,
  type PrunableCheckpointSetCertificateCoreV2,
  type PrunableCheckpointSetCertificateV2,
  type ProjectIdV2,
  type PublicKeyV2,
  type ReplicaCausalFloorAckV2,
  type ReplicaIdV2,
  type SignatureV2,
  type StableCheckpointSetCoreV2,
} from "@convax/collaboration"
import {
  authorizationMutationCoreDigestV2,
  collaborationScopeEntryCoreDigestV2,
  parseAuthorizationMutationV2,
  parseDocumentRegistrationAbandonmentV2,
  parseDocumentRegistrationClaimV2,
  parseDocumentShardResetApprovalV2,
  parseRegistryCutoffCoveragePageV2,
  parseRegistryCutoffCoverageRootV2,
  parseReplicaProjectFloorPageV2,
  registryEntrySetDigestV2,
  registrySnapshotCoreDigestV2,
  replicaProjectFloorRootCoreDigestV2,
  type AuthorizationMutationV2,
  type CollaborationScopeEntryV2,
  type DocumentRegistrationAbandonmentV2,
  type DocumentRegistrationClaimV2,
  type DocumentShardResetApprovalV2,
  type RegistryCutoffCoveragePageV2,
  type RegistryCutoffCoverageRootV2,
  type RegistryEntrySetV2,
  type RegistrySnapshotCoreV2,
  type RegistrySnapshotV2,
  type ReplicaProjectFloorPageV2,
  type ReplicaProjectFloorRootCoreV2,
  type ReplicaProjectFloorRootV2,
  type TeamEpochRolloverReceiptV2,
} from "@convax/project/collaboration-protocol"
import type { AtomicControlStateStore } from "./contracts"
import {
  CollaborationControlServiceErrorV2,
  type CollaborationControlProjectStateV2,
} from "./rendezvous-service"
import type { EditorFloorAuthorizationPortV2 } from "./membership-service"

const MAX_ACTIVE_EDITORS = 256
const MAX_REGISTRY_ENTRIES = 4_096

export interface CollaborationMetadataControlStateV2 {
  readonly format: "convax.metadata-control-state/2"
  readonly contentCertificates: readonly CheckpointContentCertificateV2[]
  readonly stableSets: readonly Readonly<{
    stableSetCore: StableCheckpointSetCoreV2
    floorAcks: readonly ReplicaCausalFloorAckV2[]
    certificate: PrunableCheckpointSetCertificateV2
  }>[]
  readonly projectFloors: readonly Readonly<{
    pages: readonly ReplicaProjectFloorPageV2[]
    root: ReplicaProjectFloorRootV2
  }>[]
  readonly replicaFloorAcks: readonly ReplicaCausalFloorAckV2[]
  readonly registrationClaims: readonly DocumentRegistrationClaimV2[]
  readonly registrationAbandonments: readonly DocumentRegistrationAbandonmentV2[]
  readonly registryEntries: readonly CollaborationScopeEntryV2[]
  readonly registrySnapshots: readonly RegistrySnapshotV2[]
  readonly cutoffCommits: readonly Readonly<{
    pages: readonly RegistryCutoffCoveragePageV2[]
    root: RegistryCutoffCoverageRootV2
    authorizationMutation: AuthorizationMutationV2
  }>[]
  readonly shardResetApprovals: readonly DocumentShardResetApprovalV2[]
  readonly projectResetRolloverReceipts: readonly TeamEpochRolloverReceiptV2[]
}

export interface MetadataControlSignaturePortV2 {
  serviceKeyId(purpose: "checkpoint-stability" | "registry-cutoff"): string
  signServiceDigest(purpose: "checkpoint-stability" | "registry-cutoff", digest: DigestV2): Promise<SignatureV2>
  verifyPublicKeyDigest(publicKey: PublicKeyV2, digest: DigestV2, signature: SignatureV2): Promise<boolean>
}

declare const attestationAdmissionBrand: unique symbol
export interface CheckpointAttestationAdmissionV2 { readonly [attestationAdmissionBrand]: true }
const liveAttestationAdmissions = new WeakMap<object, DigestV2>()

export function createCheckpointAttestationAdmissionFactoryV2(verifier: {
  verify(input: { readonly certificate: CheckpointContentCertificateV2; readonly evidence: unknown }): Promise<boolean>
}): { authorize(input: { readonly certificate: CheckpointContentCertificateV2; readonly evidence: unknown }): Promise<CheckpointAttestationAdmissionV2 | "rejected"> } {
  return Object.freeze({
    async authorize(input) {
      const certificate = parseCheckpointContentCertificateV2(input.certificate)
      if (!await verifier.verify({ certificate, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as CheckpointAttestationAdmissionV2
      liveAttestationAdmissions.set(capability, certificate.coreDigest)
      return capability
    },
  })
}

declare const projectFloorManifestAdmissionBrand: unique symbol
export interface ProjectFloorManifestAdmissionV2 { readonly [projectFloorManifestAdmissionBrand]: true }
const liveFloorManifestAdmissions = new WeakMap<object, Readonly<{ digest: DigestV2; scopeKeys: readonly string[] }>>()

export function createProjectFloorManifestAdmissionFactoryV2(verifier: {
  verify(input: { readonly manifestDigest: DigestV2; readonly requiredScopes: readonly DocumentScopeV2[]; readonly evidence: unknown }): Promise<boolean>
}): { authorize(input: { readonly manifestDigest: DigestV2; readonly requiredScopes: readonly DocumentScopeV2[]; readonly evidence: unknown }): Promise<ProjectFloorManifestAdmissionV2 | "rejected"> } {
  return Object.freeze({
    async authorize(input) {
      const digest = parseDigestV2(input.manifestDigest)
      const requiredScopes = Object.freeze(input.requiredScopes.map(parseDocumentScopeV2))
      if (!await verifier.verify({ manifestDigest: digest, requiredScopes, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as ProjectFloorManifestAdmissionV2
      liveFloorManifestAdmissions.set(capability, Object.freeze({ digest, scopeKeys: Object.freeze(requiredScopes.map(scopeKey)) }))
      return capability
    },
  })
}

declare const exactControlCommitAdmissionBrand: unique symbol
export interface ExactControlCommitAdmissionV2 { readonly [exactControlCommitAdmissionBrand]: true }
const liveExactControlCommitAdmissions = new WeakMap<object, Readonly<{ kind: "cutoff" | "shard-reset"; digest: DigestV2 }>>()

/** Converts an isolated exact verifier/transaction receipt into a one-shot metadata admission. */
export function createExactControlCommitAdmissionFactoryV2(verifier: {
  verify(input: { readonly kind: "cutoff" | "shard-reset"; readonly digest: DigestV2; readonly evidence: unknown }): Promise<boolean>
}): { authorize(input: { readonly kind: "cutoff" | "shard-reset"; readonly digest: DigestV2; readonly evidence: unknown }): Promise<ExactControlCommitAdmissionV2 | "rejected"> } {
  return Object.freeze({
    async authorize(input) {
      const normalized = Object.freeze({ kind: input.kind, digest: parseDigestV2(input.digest) })
      if (!await verifier.verify({ ...normalized, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as ExactControlCommitAdmissionV2
      liveExactControlCommitAdmissions.set(capability, normalized)
      return capability
    },
  })
}

export class CollaborationMetadataControlServiceV2 implements EditorFloorAuthorizationPortV2 {
  constructor(
    private readonly store: AtomicControlStateStore<CollaborationControlProjectStateV2>,
    private readonly signatures: MetadataControlSignaturePortV2,
  ) {}

  async admitCheckpointCertificate(projectId: ProjectIdV2, input: unknown, admission: CheckpointAttestationAdmissionV2): Promise<CheckpointContentCertificateV2> {
    const certificate = parseCheckpointContentCertificateV2(input)
    const admittedDigest = liveAttestationAdmissions.get(admission)
    if (admittedDigest !== certificate.coreDigest) fail("invalid-proof", "A live exact attestation admission is required")
    liveAttestationAdmissions.delete(admission)
    return this.store.transact(projectId, (transaction) => {
      const state = requireProject(transaction.read(), projectId)
      requireScopeProject(certificate.core.scope, state)
      if (certificate.core.trustBundleDigest !== state.seed.trustBundleDigest) fail("invalid-proof", "Checkpoint certificate trust bundle is stale")
      const metadata = metadataState(state)
      const existing = metadata.contentCertificates.find((item) => item.coreDigest === certificate.coreDigest)
      if (existing) return existing
      writeMetadata(transaction, state, { ...metadata, contentCertificates: Object.freeze([...metadata.contentCertificates, certificate]) })
      return certificate
    })
  }

  async publishStableCheckpointSet(projectId: ProjectIdV2, stableInput: unknown, floorAckInputs: readonly unknown[]): Promise<PrunableCheckpointSetCertificateV2> {
    const stableSetCore = parseStableCheckpointSetCoreV2(stableInput)
    const floorAcks = Object.freeze(floorAckInputs.map(parseReplicaCausalFloorAckV2))
    return this.store.transact(projectId, async (transaction) => {
      const state = requireProject(transaction.read(), projectId)
      const team = requireTeam(state)
      requireScopeProject(stableSetCore.scope, state)
      if (stableSetCore.membershipSnapshotDigest !== team.currentSnapshot.coreDigest) fail("stale-counter", "Stable set membership snapshot is stale")
      if (stableSetCore.validationArtifactSetDigest !== state.seed.validationArtifactSetDigest) fail("invalid-proof", "Stable set validation artifacts mismatch")
      const metadata = metadataState(state)
      const stableDigest = stableCheckpointSetCoreDigestV2(stableSetCore)
      const existing = metadata.stableSets.find((item) => stableCheckpointSetCoreDigestV2(item.stableSetCore) === stableDigest)
      if (existing) return existing.certificate
      const contentCertificates = stableSetCore.contentCertificateDigests.map((digest) => {
        const certificate = metadata.contentCertificates.find((item) => item.coreDigest === digest)
        if (!certificate || scopeKey(certificate.core.scope) !== scopeKey(stableSetCore.scope)) fail("not-found", "Stable set content certificate is unavailable")
        return Object.freeze({ certificateDigest: digest, certificate })
      })
      const activeEditorReplicas = team.currentSnapshot.core.replicas.filter((replica) => replica.state === "active" && replica.editState === "active-editor")
      if (activeEditorReplicas.length > MAX_ACTIVE_EDITORS) fail("capacity-exceeded", "Active editor set exceeds protocol capacity")
      if (floorAcks.length !== activeEditorReplicas.length) fail("invalid-proof", "Floor ACKs do not exactly cover active editors")
      for (const ack of floorAcks) await verifyFloorAck(ack, stableDigest, state, this.signatures)
      const serviceKeyId = this.signatures.serviceKeyId("checkpoint-stability")
      const core: PrunableCheckpointSetCertificateCoreV2 = Object.freeze({ format: "convax.prunable-checkpoint-set-certificate-core/2", stableSetCore, floorAckDigests: Object.freeze(floorAcks.map((ack) => ack.coreDigest).sort()), contentStatus: "service-validated-and-all-editors-acknowledged", trustBundleDigest: state.seed.trustBundleDigest, serviceKeyPurpose: "checkpoint-stability", serviceKeyId })
      const coreDigest = structuredDigestV2("convax.prunable-checkpoint-set-certificate-core/2", core)
      const certificate = parsePrunableCheckpointSetCertificateV2(Object.freeze({ format: "convax.prunable-checkpoint-set-certificate/2", core, coreDigest, serviceSignature: await this.signatures.signServiceDigest("checkpoint-stability", coreDigest) }))
      assertExactPruningCoverageV2({ certificate, contentCertificates, floorAcks: floorAcks.map((ack) => Object.freeze({ ackDigest: ack.coreDigest, ack })), activeEditorReplicaIds: activeEditorReplicas.map((replica) => replica.replicaId) })
      const acceptedAcks = Object.freeze([...metadata.replicaFloorAcks, ...floorAcks.filter((ack) => !metadata.replicaFloorAcks.some((existingAck) => existingAck.coreDigest === ack.coreDigest))])
      writeMetadata(transaction, state, { ...metadata, stableSets: Object.freeze([...metadata.stableSets, Object.freeze({ stableSetCore, floorAcks, certificate })]), replicaFloorAcks: acceptedAcks })
      return certificate
    })
  }

  async admitReplicaFloorAck(projectId: ProjectIdV2, input: unknown): Promise<ReplicaCausalFloorAckV2> {
    const ack = parseReplicaCausalFloorAckV2(input)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireProject(transaction.read(), projectId)
      const metadata = metadataState(state)
      const existing = metadata.replicaFloorAcks.find((value) => value.coreDigest === ack.coreDigest)
      if (existing) return existing
      const stable = metadata.stableSets.find((value) => stableCheckpointSetCoreDigestV2(value.stableSetCore) === ack.core.stableSetCoreDigest)
      if (!stable) fail("not-found", "Replica floor ACK stable set is unavailable")
      if (stable.stableSetCore.membershipSnapshotDigest !== requireTeam(state).currentSnapshot.coreDigest) fail("stale-counter", "Replica floor ACK stable set membership is stale")
      await verifyFloorAck(ack, ack.core.stableSetCoreDigest, state, this.signatures, true)
      writeMetadata(transaction, state, { ...metadata, replicaFloorAcks: Object.freeze([...metadata.replicaFloorAcks, ack]) })
      return ack
    })
  }

  async publishProjectFloor(input: {
    readonly projectId: ProjectIdV2
    readonly targetMemberId: MemberIdV2
    readonly targetReplicaId: ReplicaIdV2
    readonly manifestDigest: DigestV2
    readonly pages: readonly unknown[]
  }, admission: ProjectFloorManifestAdmissionV2): Promise<ReplicaProjectFloorRootV2> {
    const projectId = input.projectId
    const targetMemberId = parseMemberIdV2(input.targetMemberId)
    const targetReplicaId = parseReplicaIdV2(input.targetReplicaId)
    const manifestDigest = parseDigestV2(input.manifestDigest)
    const pages = Object.freeze(input.pages.map(parseReplicaProjectFloorPageV2))
    const authority = liveFloorManifestAdmissions.get(admission)
    if (!authority || authority.digest !== manifestDigest) fail("invalid-proof", "A live exact ProjectIndex manifest admission is required")
    liveFloorManifestAdmissions.delete(admission)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireProject(transaction.read(), projectId)
      const team = requireTeam(state)
      const member = team.currentSnapshot.core.members.find((item) => item.memberId === targetMemberId && item.state === "active")
      const replica = team.currentSnapshot.core.replicas.find((item) => item.replicaId === targetReplicaId && item.memberId === targetMemberId && item.state === "active")
      if (!member || !replica || member.role !== "editor" || replica.editState !== "pending-editor") fail("not-active", "Project floor target must be a pending editor")
      const entries = pages.flatMap((page, pageIndex) => {
        if (page.core.pageIndex !== String(pageIndex) || page.core.targetReplicaId !== targetReplicaId) fail("invalid-proof", "Project floor page sequence/target mismatches")
        return page.core.entries
      })
      const scopeKeys = entries.map((entry) => scopeKey(entry.scope))
      if (!same(scopeKeys, authority.scopeKeys)) fail("invalid-proof", "Project floor pages do not exactly cover the certified live route projection")
      const metadata = metadataState(state)
      for (const entry of entries) {
        const stable = metadata.stableSets.find((item) => item.certificate.coreDigest === entry.prunableCheckpointSetCertificateDigest)
        const ack = metadata.replicaFloorAcks.find((item) => item.coreDigest === entry.replicaCausalFloorAckDigest)
        if (!stable || !ack || ack.core.replicaId !== targetReplicaId) fail("invalid-proof", "Project floor entry lacks the exact target replica ACK")
      }
      const floorSetId = pages[0]?.core.floorSetId ?? fail("invalid-proof", "Project floor requires at least one page")
      if (pages.some((page) => page.core.floorSetId !== floorSetId)) fail("invalid-proof", "Project floor pages mix floor set ids")
      const serviceKeyId = this.signatures.serviceKeyId("checkpoint-stability")
      const registry = currentRegistry(state)
      const core: ReplicaProjectFloorRootCoreV2 = Object.freeze({ format: "convax.replica-project-floor-root-core/2", projectId, projectEpoch: state.seed.projectEpoch, membershipEpoch: state.seed.membershipEpoch, floorSetId, targetMemberId, targetReplicaId, targetActorId: replica.actorId, targetReplicaAuthorizationEpoch: replica.replicaAuthorizationEpoch, membershipSnapshotDigest: team.currentSnapshot.coreDigest, projectIndexLiveScopeManifestDigest: manifestDigest, registrySequence: registry.sequence, registryRootDigest: registry.digest, requiredScopeSetPolicy: "project-index-plus-certified-live-routes", unlistedScopePolicy: "registry-only-is-advisory-and-never-blocks-or-grants", pageDigests: Object.freeze(pages.map((page) => page.coreDigest)), entryCount: parseUint32V2(String(entries.length)), protocolDigest: state.seed.membershipSnapshotDigest === team.currentSnapshot.coreDigest ? team.currentSnapshot.core.protocolDigest : fail("stale-counter", "Seed membership projection is stale"), trustBundleDigest: state.seed.trustBundleDigest, serviceKeyPurpose: "checkpoint-stability", serviceKeyId })
      const coreDigest = replicaProjectFloorRootCoreDigestV2(core)
      const root = Object.freeze({ format: "convax.replica-project-floor-root/2" as const, core, coreDigest, serviceSignature: await this.signatures.signServiceDigest("checkpoint-stability", coreDigest) })
      writeMetadata(transaction, state, { ...metadata, projectFloors: Object.freeze([...metadata.projectFloors, Object.freeze({ pages, root })]) })
      return root
    })
  }

  async registerScope(projectId: ProjectIdV2, input: unknown): Promise<{ readonly entry: CollaborationScopeEntryV2; readonly registrySnapshot: RegistrySnapshotV2 }> {
    const claim = parseDocumentRegistrationClaimV2(input)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireProject(transaction.read(), projectId)
      requireScopeProject(claim.core.scope, state)
      await verifyRegistrationClaim(claim, state, this.signatures)
      const metadata = metadataState(state)
      const exact = metadata.registrationClaims.find((item) => item.coreDigest === claim.coreDigest)
      if (exact) {
        const entry = metadata.registryEntries.find((item) => item.core.registrationClaimDigest === claim.coreDigest) ?? fail("not-found", "Idempotent registry entry is missing")
        return { entry, registrySnapshot: metadata.registrySnapshots.at(-1) ?? fail("not-found", "Registry snapshot is missing") }
      }
      const identityEntries = metadata.registryEntries.filter((entry) => entry.core.scopeKey === scopeKey(claim.core.scope) && entry.core.registrarReplicaId === claim.core.registrarReplicaId)
      const prior = identityEntries.at(-1)
      const expectedRevision = prior ? String(BigInt(prior.core.claimRevision) + 1n) : "1"
      if (claim.core.claimRevision !== expectedRevision || (prior && prior.core.state !== "abandoned")) fail("stale-counter", "Registration revision is not the next legal revision")
      if (metadata.registryEntries.length >= MAX_REGISTRY_ENTRIES) fail("capacity-exceeded", "Registry entry capacity exceeded")
      const core = Object.freeze({ format: "convax.collaboration-scope-entry-core/2" as const, scopeKey: scopeKey(claim.core.scope), registrarReplicaId: claim.core.registrarReplicaId, claimRevision: claim.core.claimRevision, registrationClaimDigest: claim.coreDigest, state: "registered-candidate" as const, projectIndexContentCertificateDigest: null, canvasGenesisContentCertificateDigest: null, genesisPrunableSetDigest: null, abandonmentDigest: null })
      const entry = Object.freeze({ format: "convax.collaboration-scope-entry/2" as const, core, coreDigest: collaborationScopeEntryCoreDigestV2(core) })
      const nextEntries = Object.freeze([...metadata.registryEntries, entry].sort(compareEntry))
      const registrySnapshot = await this.signRegistrySnapshot(state, nextEntries)
      const nextMetadata = { ...metadata, registrationClaims: Object.freeze([...metadata.registrationClaims, claim]), registryEntries: nextEntries, registrySnapshots: Object.freeze([...metadata.registrySnapshots, registrySnapshot]) }
      writeMetadata(transaction, state, nextMetadata, registrySnapshot)
      return { entry, registrySnapshot }
    })
  }

  async abandonScope(projectId: ProjectIdV2, input: unknown): Promise<{ readonly entry: CollaborationScopeEntryV2; readonly registrySnapshot: RegistrySnapshotV2 }> {
    const abandonment = parseDocumentRegistrationAbandonmentV2(input)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireProject(transaction.read(), projectId)
      requireScopeProject(abandonment.core.scope, state)
      const metadata = metadataState(state)
      const exact = metadata.registrationAbandonments.find((item) => item.coreDigest === abandonment.coreDigest)
      if (exact) {
        const entry = metadata.registryEntries.find((item) => item.core.abandonmentDigest === abandonment.coreDigest) ?? fail("not-found", "Idempotent abandonment entry is missing")
        return { entry, registrySnapshot: metadata.registrySnapshots.at(-1) ?? fail("not-found", "Registry snapshot is missing") }
      }
      const index = metadata.registryEntries.findIndex((entry) => entry.core.registrationClaimDigest === abandonment.core.registrationClaimDigest)
      const current = metadata.registryEntries[index]
      if (!current || current.core.state !== "registered-candidate" || current.core.claimRevision !== abandonment.core.claimRevision || current.core.scopeKey !== scopeKey(abandonment.core.scope)) fail("not-active", "Only the exact current candidate may be abandoned")
      await verifyAbandonment(abandonment, current, state, this.signatures)
      const core = Object.freeze({ ...current.core, state: "abandoned" as const, abandonmentDigest: abandonment.coreDigest })
      const entry = Object.freeze({ format: "convax.collaboration-scope-entry/2" as const, core, coreDigest: collaborationScopeEntryCoreDigestV2(core) })
      const nextEntries = Object.freeze(metadata.registryEntries.map((item, itemIndex) => itemIndex === index ? entry : item).sort(compareEntry))
      const registrySnapshot = await this.signRegistrySnapshot(state, nextEntries)
      const nextMetadata = { ...metadata, registrationAbandonments: Object.freeze([...metadata.registrationAbandonments, abandonment]), registryEntries: nextEntries, registrySnapshots: Object.freeze([...metadata.registrySnapshots, registrySnapshot]) }
      writeMetadata(transaction, state, nextMetadata, registrySnapshot)
      return { entry, registrySnapshot }
    })
  }

  async admitCutoffCommit(projectId: ProjectIdV2, input: { readonly pages: readonly unknown[]; readonly root: unknown; readonly authorizationMutation: unknown }, admission: ExactControlCommitAdmissionV2): Promise<AuthorizationMutationV2> {
    const pages = Object.freeze(input.pages.map(parseRegistryCutoffCoveragePageV2))
    const root = parseRegistryCutoffCoverageRootV2(input.root)
    const authorizationMutation = parseAuthorizationMutationV2(input.authorizationMutation)
    const authority = liveExactControlCommitAdmissions.get(admission)
    if (!authority || authority.kind !== "cutoff" || authority.digest !== authorizationMutation.coreDigest) fail("invalid-proof", "A live exact cutoff transaction admission is required")
    liveExactControlCommitAdmissions.delete(admission)
    return this.store.transact(projectId, (transaction) => {
      const state = requireProject(transaction.read(), projectId)
      const metadata = metadataState(state)
      const existing = metadata.cutoffCommits.find((item) => item.authorizationMutation.coreDigest === authorizationMutation.coreDigest)
      if (existing) return existing.authorizationMutation
      if (root.core.projectId !== projectId || root.core.projectEpoch !== state.seed.projectEpoch || root.core.registryRootDigest !== currentRegistry(state).digest || root.core.registrySequence !== currentRegistry(state).sequence) fail("stale-counter", "Cutoff registry binding is stale")
      if (root.core.beforeMembershipSnapshotDigest !== authorizationMutation.core.beforeMembershipSnapshotDigest || root.core.afterMembershipSnapshotDigest !== authorizationMutation.core.afterMembershipSnapshotDigest || root.coreDigest !== authorizationMutation.core.registryCutoffCoverageRootCoreDigest || encodeRestrictedJcsTextV2(root.core.target) !== encodeRestrictedJcsTextV2(authorizationMutation.core.target)) fail("invalid-proof", "Cutoff root and authorization mutation bindings differ")
      if (!same(root.core.pageDigests, pages.map((page) => page.coreDigest)) || pages.reduce((sum, page) => sum + page.core.leaves.length, 0) !== Number(root.core.leafCount)) fail("invalid-proof", "Cutoff pages do not exactly close the signed root")
      if (authorizationMutationCoreDigestV2(authorizationMutation.core) !== authorizationMutation.coreDigest) fail("invalid-proof", "Authorization mutation digest mismatch")
      writeMetadata(transaction, state, { ...metadata, cutoffCommits: Object.freeze([...metadata.cutoffCommits, Object.freeze({ pages, root, authorizationMutation })]) })
      return authorizationMutation
    })
  }

  async admitShardResetApproval(projectId: ProjectIdV2, input: unknown, admission: ExactControlCommitAdmissionV2): Promise<DocumentShardResetApprovalV2> {
    const approval = parseDocumentShardResetApprovalV2(input)
    const authority = consumeExactAdmission(admission, "shard-reset", approval.coreDigest)
    void authority
    return this.store.transact(projectId, (transaction) => {
      const state = requireProject(transaction.read(), projectId)
      if (approval.core.projectId !== projectId || approval.core.projectEpoch !== state.seed.projectEpoch) fail("stale-counter", "Shard reset approval is outside the current Project epoch")
      const metadata = metadataState(state)
      const existing = metadata.shardResetApprovals.find((item) => item.coreDigest === approval.coreDigest)
      if (existing) return existing
      writeMetadata(transaction, state, { ...metadata, shardResetApprovals: Object.freeze([...metadata.shardResetApprovals, approval]) })
      return approval
    })
  }

  async verifyInstalledCurrentFloor(input: Parameters<EditorFloorAuthorizationPortV2["verifyInstalledCurrentFloor"]>[0]): Promise<boolean> {
    return this.store.transact(input.projectId, (transaction) => {
      const state = transaction.read()
      if (!state?.team || state.team.currentSnapshot.coreDigest !== input.membershipSnapshot.coreDigest) return false
      return metadataState(state).projectFloors.some((item) => item.root.coreDigest === input.installedFloorSetDigest && item.root.core.targetMemberId === input.member.memberId && item.root.core.targetReplicaId === input.replica.replicaId && item.root.core.membershipSnapshotDigest === input.membershipSnapshot.coreDigest)
    })
  }

  private async signRegistrySnapshot(state: CollaborationControlProjectStateV2, entries: readonly CollaborationScopeEntryV2[]): Promise<RegistrySnapshotV2> {
    const current = currentRegistry(state)
    const entrySet: RegistryEntrySetV2 = Object.freeze({ format: "convax.registry-entry-set/2", entries })
    const core: RegistrySnapshotCoreV2 = Object.freeze({ format: "convax.registry-snapshot-core/2", projectId: state.seed.projectId, projectEpoch: state.seed.projectEpoch, registrySequence: incrementUint64V2(current.sequence), priorRegistryDigest: current.sequence === "0" ? null : current.digest, entriesDigest: registryEntrySetDigestV2(entrySet), entryCount: parseUint32V2(String(entries.length)), protocolDigest: requireTeam(state).currentSnapshot.core.protocolDigest, trustBundleDigest: state.seed.trustBundleDigest, serviceKeyPurpose: "registry-cutoff", serviceKeyId: this.signatures.serviceKeyId("registry-cutoff") })
    const coreDigest = registrySnapshotCoreDigestV2(core)
    return Object.freeze({ format: "convax.registry-snapshot/2", core, coreDigest, serviceSignature: await this.signatures.signServiceDigest("registry-cutoff", coreDigest) })
  }

}

async function verifyFloorAck(ack: ReplicaCausalFloorAckV2, stableDigest: DigestV2, state: CollaborationControlProjectStateV2, signatures: MetadataControlSignaturePortV2, allowPending = false): Promise<void> {
  if (ack.core.stableSetCoreDigest !== stableDigest) fail("invalid-proof", "Floor ACK is bound to another stable set")
  const team = requireTeam(state)
  const replica = team.currentSnapshot.core.replicas.find((item) => item.replicaId === ack.core.replicaId && item.actorId === ack.core.actorId && item.state === "active" && (item.editState === "active-editor" || (allowPending && item.editState === "pending-editor")))
  const credential = team.actorCredentials.find((item) => item.coreDigest === ack.core.replicaActorCredentialDigest && item.core.replicaId === ack.core.replicaId && item.core.actorId === ack.core.actorId)
  if (!replica || !credential || !await signatures.verifyPublicKeyDigest(credential.core.replicaSigningPublicKey, ack.coreDigest, ack.replicaSignature)) fail("invalid-proof", "Floor ACK actor authority is invalid")
}

async function verifyRegistrationClaim(claim: DocumentRegistrationClaimV2, state: CollaborationControlProjectStateV2, signatures: MetadataControlSignaturePortV2): Promise<void> {
  const team = requireTeam(state)
  const replica = team.currentSnapshot.core.replicas.find((item) => item.replicaId === claim.core.registrarReplicaId && item.memberId === claim.core.registrarMemberId && item.actorId === claim.core.registrarActorId && item.state === "active" && item.editState === "active-editor")
  const credential = team.actorCredentials.find((item) => item.coreDigest === claim.core.registrarAuthorizationDigest && item.core.replicaId === claim.core.registrarReplicaId && item.core.actorId === claim.core.registrarActorId)
  if (!replica || !credential || !await signatures.verifyPublicKeyDigest(credential.core.replicaSigningPublicKey, claim.coreDigest, claim.replicaSignature)) fail("invalid-proof", "Registration claim actor authority is invalid")
}

async function verifyAbandonment(abandonment: DocumentRegistrationAbandonmentV2, entry: CollaborationScopeEntryV2, state: CollaborationControlProjectStateV2, signatures: MetadataControlSignaturePortV2): Promise<void> {
  const team = requireTeam(state)
  if (abandonment.core.actor.kind === "registrar") {
    if (abandonment.core.actor.replicaId !== entry.core.registrarReplicaId) fail("invalid-proof", "Only the original registrar may abandon this candidate")
    const replica = team.currentSnapshot.core.replicas.find((item) => item.replicaId === entry.core.registrarReplicaId && item.state === "active")
    if (!replica || !await signatures.verifyPublicKeyDigest(replica.replicaSigningPublicKey, abandonment.coreDigest, abandonment.actorSignature)) fail("invalid-proof", "Registrar abandonment signature is invalid")
    return
  }
  const actor = abandonment.core.actor
  const capability = team.adminCapabilities.find((item) => item.coreDigest === actor.adminCapabilityDigest && item.core.adminMemberId === actor.memberId && item.core.membershipSnapshotDigest === team.currentSnapshot.coreDigest)
  const member = team.currentSnapshot.core.members.find((item) => item.memberId === actor.memberId && item.state === "active")
  if (!capability || !member || !await signatures.verifyPublicKeyDigest(member.memberSigningPublicKey, abandonment.coreDigest, abandonment.actorSignature)) fail("invalid-proof", "Admin abandonment authority is invalid")
}

function emptyMetadata(): CollaborationMetadataControlStateV2 {
  return Object.freeze({ format: "convax.metadata-control-state/2", contentCertificates: [], stableSets: [], projectFloors: [], replicaFloorAcks: [], registrationClaims: [], registrationAbandonments: [], registryEntries: [], registrySnapshots: [], cutoffCommits: [], shardResetApprovals: [], projectResetRolloverReceipts: [] })
}

function metadataState(state: CollaborationControlProjectStateV2): CollaborationMetadataControlStateV2 {
  return state.metadata ?? emptyMetadata()
}

function writeMetadata(transaction: { write(next: CollaborationControlProjectStateV2): void }, state: CollaborationControlProjectStateV2, metadata: CollaborationMetadataControlStateV2, registry?: RegistrySnapshotV2): void {
  const seed = registry ? Object.freeze({ ...state.seed, registrySequence: registry.core.registrySequence, registryRootDigest: registry.coreDigest }) : state.seed
  transaction.write(Object.freeze({ ...state, seed, metadata: Object.freeze(metadata) }))
}

function currentRegistry(state: CollaborationControlProjectStateV2): Readonly<{ sequence: CollaborationControlProjectStateV2["seed"]["registrySequence"]; digest: DigestV2 }> {
  const snapshot = metadataState(state).registrySnapshots.at(-1)
  return snapshot ? Object.freeze({ sequence: snapshot.core.registrySequence, digest: snapshot.coreDigest }) : Object.freeze({ sequence: state.seed.registrySequence, digest: state.seed.registryRootDigest })
}

function requireProject(state: CollaborationControlProjectStateV2 | null, projectId: ProjectIdV2): CollaborationControlProjectStateV2 {
  if (!state || state.seed.projectId !== projectId) fail("not-found", "Control Project is not provisioned")
  return state
}

function requireTeam(state: CollaborationControlProjectStateV2) {
  return state.team ?? fail("not-active", "Team authority is not provisioned")
}

function requireScopeProject(scope: DocumentScopeV2, state: CollaborationControlProjectStateV2): void {
  if (scope.projectId !== state.seed.projectId || scope.projectEpoch !== state.seed.projectEpoch) fail("invalid-proof", "Document scope is outside the current Project epoch")
}

function scopeKey(scope: DocumentScopeV2): string {
  return encodeRestrictedJcsTextV2(scope)
}

function compareEntry(left: CollaborationScopeEntryV2, right: CollaborationScopeEntryV2): number {
  const prefix = scopeKeyOrder(left.core.scopeKey, right.core.scopeKey) || scopeKeyOrder(left.core.registrarReplicaId, right.core.registrarReplicaId)
  if (prefix !== 0) return prefix
  return BigInt(left.core.claimRevision) < BigInt(right.core.claimRevision) ? -1 : BigInt(left.core.claimRevision) > BigInt(right.core.claimRevision) ? 1 : 0
}

function scopeKeyOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function consumeExactAdmission(admission: ExactControlCommitAdmissionV2, kind: "cutoff" | "shard-reset", digest: DigestV2): Readonly<{ kind: "cutoff" | "shard-reset"; digest: DigestV2 }> {
  const authority = liveExactControlCommitAdmissions.get(admission)
  if (!authority || authority.kind !== kind || authority.digest !== digest) fail("invalid-proof", `A live exact ${kind} transaction admission is required`)
  liveExactControlCommitAdmissions.delete(admission)
  return authority
}

function fail(code: ConstructorParameters<typeof CollaborationControlServiceErrorV2>[0], message: string): never {
  throw new CollaborationControlServiceErrorV2(code, message)
}
