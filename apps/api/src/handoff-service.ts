import {
  encodeRestrictedJcsV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parseProjectSharingHandoffProposalV3,
  parseProjectSharingHandoffReceiptV3,
  parsePublicKeyV2,
  parseSignatureV2,
  projectSharingHandoffSignatureDigestV3,
  verifyProjectSharingHandoffProposalV3,
  type DigestV2,
  type Ed25519VerifierPortV2,
  type Id128V2,
  type ProjectIdV2,
  type ProjectSharingHandoffCoreV3,
  type ProjectSharingHandoffProposalV3,
  type ProjectSharingHandoffReceiptV3,
  type PublicKeyV2,
  type ReplicaSignerPortV2,
} from "@convax/collaboration"
import {
  parseMembershipSnapshotV2,
  parseMemberCredentialV2,
  parseProjectAdminCapabilityV2,
  parseReplicaActorCredentialV2,
  parseReplicaEditAuthorizationV2,
  type MembershipSnapshotV2,
  type MemberCredentialV2,
  type ProjectAdminCapabilityV2,
  type ReplicaActorCredentialV2,
  type ReplicaEditAuthorizationV2,
} from "@convax/project/collaboration-protocol"

export interface ProjectSharingInitialTeamArtifactsV3 {
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly memberCredential: MemberCredentialV2
  readonly adminCapability: ProjectAdminCapabilityV2
  readonly replicaActorCredential: ReplicaActorCredentialV2
  readonly replicaEditAuthorization: ReplicaEditAuthorizationV2
}

export interface CommittedProjectSharingHandoffV3 {
  readonly receipt: ProjectSharingHandoffReceiptV3
  readonly teamArtifacts: ProjectSharingInitialTeamArtifactsV3
  readonly exactReceiptBytes: Uint8Array
}

export type ProjectSharingHandoffStoreCommitResultV3 =
  | Readonly<{ status: "committed"; value: CommittedProjectSharingHandoffV3 }>
  | Readonly<{ status: "equivocation" }>

/** Storage adapter must serialize commit by handoff id and retain exact bytes. */
export interface ProjectSharingHandoffStoreV3 {
  load(handoffId: Id128V2): Promise<CommittedProjectSharingHandoffV3 | null>
  commitExact(input: CommittedProjectSharingHandoffV3): Promise<ProjectSharingHandoffStoreCommitResultV3>
}

export interface ProjectSharingOwnerAuthorityResolverV3 {
  resolve(core: ProjectSharingHandoffCoreV3): Promise<
    | Readonly<{ status: "verified"; ownerPublicKey: PublicKeyV2 }>
    | Readonly<{ status: "pending" | "rejected" }>
  >
}

export interface ProjectSharingCausalClosureVerifierV3 {
  verifyExact(core: ProjectSharingHandoffCoreV3): Promise<"verified" | "pending" | "rejected">
}

export interface ProjectSharingInitialTeamArtifactResolverV3 {
  resolveExact(core: ProjectSharingHandoffCoreV3): Promise<
    | Readonly<{ status: "resolved"; artifacts: ProjectSharingInitialTeamArtifactsV3 }>
    | Readonly<{ status: "pending" | "rejected" }>
  >
}

export type SubmitProjectSharingHandoffResultV3 =
  | Readonly<{ status: "committed"; receipt: ProjectSharingHandoffReceiptV3; teamArtifacts: ProjectSharingInitialTeamArtifactsV3 }>
  | Readonly<{ status: "pending" | "rejected" | "equivocation" }>

export type RecoverProjectSharingHandoffResultV3 =
  | Readonly<{ status: "committed"; receipt: ProjectSharingHandoffReceiptV3; teamArtifacts: ProjectSharingInitialTeamArtifactsV3 }>
  | Readonly<{ status: "pending" }>

/**
 * Web-standard V3 handoff authority. It never accepts document bytes; the injected
 * closure verifier attests exact durable heads and the injected Team resolver
 * supplies already-authoritative control artifacts.
 */
export class ProjectSharingHandoffServiceV3 {
  constructor(private readonly options: {
    readonly protocolDigest: DigestV2
    readonly trustBundleDigest: DigestV2
    readonly ownerAuthority: ProjectSharingOwnerAuthorityResolverV3
    readonly causalClosure: ProjectSharingCausalClosureVerifierV3
    readonly teamArtifacts: ProjectSharingInitialTeamArtifactResolverV3
    readonly verifier: Ed25519VerifierPortV2
    readonly serviceSigningPublicKey: PublicKeyV2
    readonly serviceSigningKeyId: DigestV2
    readonly signer: ReplicaSignerPortV2
    readonly store: ProjectSharingHandoffStoreV3
  }) {}

  async submit(input: ProjectSharingHandoffProposalV3): Promise<SubmitProjectSharingHandoffResultV3> {
    let proposal: ProjectSharingHandoffProposalV3
    try { proposal = parseProjectSharingHandoffProposalV3(input) } catch { return Object.freeze({ status: "rejected" }) }
    const existing = await this.options.store.load(proposal.core.handoffId)
    if (existing) return exactExisting(existing, proposal)
    if (
      proposal.core.successorProtocolDigest !== parseDigestV2(this.options.protocolDigest) ||
      proposal.core.serviceTrustBundleDigest !== parseDigestV2(this.options.trustBundleDigest)
    ) return Object.freeze({ status: "rejected" })
    const owner = await this.options.ownerAuthority.resolve(proposal.core)
    if (owner.status !== "verified") return Object.freeze({ status: owner.status })
    const verifiedProposal = await verifyProjectSharingHandoffProposalV3({
      proposal,
      ownerPublicKey: owner.ownerPublicKey,
      expectedOwnerKeyId: proposal.core.previousOwnerKeyId,
      verifier: this.options.verifier,
    })
    if (verifiedProposal === "rejected") return Object.freeze({ status: "rejected" })
    const closure = await this.options.causalClosure.verifyExact(proposal.core)
    if (closure !== "verified") return Object.freeze({ status: closure })
    const resolvedArtifacts = await this.options.teamArtifacts.resolveExact(proposal.core)
    if (resolvedArtifacts.status !== "resolved") return Object.freeze({ status: resolvedArtifacts.status })
    const teamArtifacts = parseTeamArtifacts(resolvedArtifacts.artifacts, proposal.core)
    if (teamArtifacts === "rejected") return Object.freeze({ status: "rejected" })
    const serviceSigningPublicKey = parsePublicKeyV2(this.options.serviceSigningPublicKey)
    const serviceSigningKeyId = parseDigestV2(this.options.serviceSigningKeyId)
    const receipt = parseProjectSharingHandoffReceiptV3({
      format: "convax.project-sharing-handoff-receipt/3",
      core: proposal.core,
      coreDigest: proposal.coreDigest,
      ownerSignature: proposal.ownerSignature,
      serviceSigningPublicKey,
      serviceSigningKeyId,
      serviceSignature: parseSignatureV2(await this.options.signer.sign(projectSharingHandoffSignatureDigestV3(proposal.coreDigest))),
    })
    const exactReceiptBytes = encodeRestrictedJcsV2(receipt)
    const committed = await this.options.store.commitExact({ receipt, teamArtifacts, exactReceiptBytes })
    if (committed.status === "equivocation") return Object.freeze({ status: "equivocation" })
    return response(committed.value)
  }

  async recover(input: { readonly projectId: ProjectIdV2; readonly handoffId: Id128V2 }): Promise<RecoverProjectSharingHandoffResultV3> {
    const projectId = parseProjectIdV2(input.projectId)
    const handoffId = parseId128V2(input.handoffId)
    const current = await this.options.store.load(handoffId)
    if (!current) return Object.freeze({ status: "pending" })
    if (current.receipt.core.projectId !== projectId || current.receipt.core.handoffId !== handoffId) return Object.freeze({ status: "pending" })
    return response(current)
  }
}

export class InMemoryProjectSharingHandoffStoreV3 implements ProjectSharingHandoffStoreV3 {
  private readonly values = new Map<Id128V2, CommittedProjectSharingHandoffV3>()
  async load(handoffId: Id128V2) { return this.values.get(parseId128V2(handoffId)) ?? null }
  async commitExact(input: CommittedProjectSharingHandoffV3): Promise<ProjectSharingHandoffStoreCommitResultV3> {
    const value = normalizeCommitted(input)
    const handoffId = value.receipt.core.handoffId
    const current = this.values.get(handoffId)
    if (current) return sameBytes(current.exactReceiptBytes, value.exactReceiptBytes)
      ? Object.freeze({ status: "committed", value: current })
      : Object.freeze({ status: "equivocation" })
    this.values.set(handoffId, value)
    return Object.freeze({ status: "committed", value })
  }
}

function exactExisting(existing: CommittedProjectSharingHandoffV3, proposal: ProjectSharingHandoffProposalV3): SubmitProjectSharingHandoffResultV3 {
  return existing.receipt.coreDigest === proposal.coreDigest && existing.receipt.ownerSignature === proposal.ownerSignature
    ? response(existing)
    : Object.freeze({ status: "equivocation" })
}

function response(value: CommittedProjectSharingHandoffV3) {
  return Object.freeze({ status: "committed" as const, receipt: value.receipt, teamArtifacts: value.teamArtifacts })
}

function normalizeCommitted(input: CommittedProjectSharingHandoffV3): CommittedProjectSharingHandoffV3 {
  const receipt = parseProjectSharingHandoffReceiptV3(input.receipt)
  const exactReceiptBytes = Uint8Array.from(input.exactReceiptBytes)
  if (!sameBytes(exactReceiptBytes, encodeRestrictedJcsV2(receipt))) throw new Error("Committed handoff receipt bytes are not exact")
  const teamArtifacts = parseTeamArtifacts(input.teamArtifacts, receipt.core)
  if (teamArtifacts === "rejected") throw new Error("Committed handoff Team artifact closure is invalid")
  return Object.freeze({ receipt, teamArtifacts, exactReceiptBytes })
}

function parseTeamArtifacts(input: ProjectSharingInitialTeamArtifactsV3, core: ProjectSharingHandoffCoreV3): ProjectSharingInitialTeamArtifactsV3 | "rejected" {
  try {
    const membershipSnapshot = parseMembershipSnapshotV2(input.membershipSnapshot)
    const memberCredential = parseMemberCredentialV2(input.memberCredential)
    const adminCapability = parseProjectAdminCapabilityV2(input.adminCapability)
    const replicaActorCredential = parseReplicaActorCredentialV2(input.replicaActorCredential)
    const replicaEditAuthorization = parseReplicaEditAuthorizationV2(input.replicaEditAuthorization)
    if (
      membershipSnapshot.coreDigest !== core.initialMembershipSnapshotDigest ||
      memberCredential.coreDigest !== core.initialMemberCredentialCoreDigest ||
      adminCapability.coreDigest !== core.initialAdminCapabilityCoreDigest ||
      replicaActorCredential.coreDigest !== core.initialReplicaActorCredentialCoreDigest ||
      replicaEditAuthorization.coreDigest !== core.initialReplicaEditAuthorizationCoreDigest ||
      membershipSnapshot.core.projectId !== core.projectId || membershipSnapshot.core.projectEpoch !== core.projectEpoch ||
      memberCredential.core.projectId !== core.projectId || memberCredential.core.projectEpoch !== core.projectEpoch ||
      adminCapability.core.projectId !== core.projectId || adminCapability.core.projectEpoch !== core.projectEpoch ||
      memberCredential.core.memberId !== core.initialOwnerMemberId || adminCapability.core.adminMemberId !== core.initialOwnerMemberId ||
      memberCredential.core.membershipSnapshotDigest !== membershipSnapshot.coreDigest || adminCapability.core.membershipSnapshotDigest !== membershipSnapshot.coreDigest ||
      memberCredential.core.adminCapabilityDigest !== adminCapability.coreDigest ||
      replicaActorCredential.core.projectId !== core.projectId || replicaActorCredential.core.projectEpoch !== core.projectEpoch ||
      replicaEditAuthorization.core.projectId !== core.projectId || replicaEditAuthorization.core.projectEpoch !== core.projectEpoch ||
      replicaActorCredential.core.replicaId !== core.initialOwnerReplicaId || replicaActorCredential.core.actorId !== core.initialOwnerActorId ||
      replicaEditAuthorization.core.replicaId !== core.initialOwnerReplicaId || replicaEditAuthorization.core.actorId !== core.initialOwnerActorId
    ) return "rejected"
    return Object.freeze({ membershipSnapshot, memberCredential, adminCapability, replicaActorCredential, replicaEditAuthorization })
  } catch { return "rejected" }
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}
