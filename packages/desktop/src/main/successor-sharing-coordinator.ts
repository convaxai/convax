import {
  parseProjectSharingHandoffProposalV3,
  parseProjectSharingHandoffReceiptV3,
  type ProjectIdV2,
  type ProjectSharingHandoffProposalV3,
  type ProjectSharingHandoffReceiptV3,
} from "@convax/collaboration"
import type {
  MemberCredentialV2,
  MembershipSnapshotV2,
  ProjectAdminCapabilityV2,
  ReplicaActorCredentialV2,
  ReplicaEditAuthorizationV2,
} from "@convax/project/collaboration-protocol"

export interface SuccessorInitialTeamArtifactsV3 {
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly memberCredential: MemberCredentialV2
  readonly adminCapability: ProjectAdminCapabilityV2
  readonly replicaActorCredential: ReplicaActorCredentialV2
  readonly replicaEditAuthorization: ReplicaEditAuthorizationV2
}

export type SuccessorRemoteHandoffResultV3 =
  | Readonly<{ status: "committed"; receipt: ProjectSharingHandoffReceiptV3; teamArtifacts: SuccessorInitialTeamArtifactsV3 }>
  | Readonly<{ status: "pending" | "rejected" | "equivocation" }>

export interface SuccessorSharingTransitionStoreV3 {
  begin(input: ProjectSharingHandoffProposalV3): Promise<"recorded" | "recovery-required">
  loadPending(projectId: ProjectIdV2): Promise<ProjectSharingHandoffProposalV3 | null | "recovery-required">
  installCommitted(input: {
    readonly proposal: ProjectSharingHandoffProposalV3
    readonly receipt: ProjectSharingHandoffReceiptV3
    readonly teamArtifacts: SuccessorInitialTeamArtifactsV3
  }): Promise<"installed" | "recovery-required">
}

/**
 * Main-only one-way orchestration. Once begin() durably records the proposal,
 * every non-committed outcome is ambiguous and local-owner mutation stays closed.
 */
export class SuccessorProjectSharingCoordinatorV3 {
  constructor(private readonly ports: {
    readonly transition: SuccessorSharingTransitionStoreV3
    readonly mutationBarrier: {
      quiesce(projectId: ProjectIdV2): Promise<void>
      resumeLocal(projectId: ProjectIdV2): Promise<void>
      flushAndBuildProposal(projectId: ProjectIdV2, signal?: AbortSignal): Promise<ProjectSharingHandoffProposalV3>
    }
    readonly remote: {
      submit(proposal: ProjectSharingHandoffProposalV3, signal?: AbortSignal): Promise<SuccessorRemoteHandoffResultV3>
      recover(input: { readonly projectId: ProjectIdV2; readonly handoffId: ProjectSharingHandoffProposalV3["core"]["handoffId"] }): Promise<SuccessorRemoteHandoffResultV3>
    }
    verifyCommitted(input: {
      readonly proposal: ProjectSharingHandoffProposalV3
      readonly receipt: ProjectSharingHandoffReceiptV3
      readonly teamArtifacts: SuccessorInitialTeamArtifactsV3
    }): Promise<"verified" | "pending" | "rejected">
    startSharedRuntime(projectId: ProjectIdV2): Promise<void>
  }) {}

  async share(projectId: ProjectIdV2, signal?: AbortSignal): Promise<"shared" | "cancelled" | "handoff-recovery-required"> {
    await this.ports.mutationBarrier.quiesce(projectId)
    if (signal?.aborted) {
      await this.ports.mutationBarrier.resumeLocal(projectId)
      return "cancelled"
    }
    let proposal: ProjectSharingHandoffProposalV3
    try {
      proposal = parseProjectSharingHandoffProposalV3(
        await this.ports.mutationBarrier.flushAndBuildProposal(projectId, signal),
      )
    } catch (error) {
      await this.ports.mutationBarrier.resumeLocal(projectId)
      throw error
    }
    if (signal?.aborted) {
      await this.ports.mutationBarrier.resumeLocal(projectId)
      return "cancelled"
    }
    if (await this.ports.transition.begin(proposal) !== "recorded") return "handoff-recovery-required"
    try {
      return await this.accept(projectId, proposal, await this.ports.remote.submit(proposal, signal))
    } catch {
      return "handoff-recovery-required"
    }
  }

  async recover(projectId: ProjectIdV2): Promise<"shared" | "not-pending" | "handoff-recovery-required"> {
    await this.ports.mutationBarrier.quiesce(projectId)
    const pending = await this.ports.transition.loadPending(projectId)
    if (pending === null) return "not-pending"
    if (pending === "recovery-required") return "handoff-recovery-required"
    const proposal = parseProjectSharingHandoffProposalV3(pending)
    try {
      return await this.accept(projectId, proposal, await this.ports.remote.recover({
        projectId,
        handoffId: proposal.core.handoffId,
      }))
    } catch {
      return "handoff-recovery-required"
    }
  }

  private async accept(
    projectId: ProjectIdV2,
    proposal: ProjectSharingHandoffProposalV3,
    remote: SuccessorRemoteHandoffResultV3,
  ): Promise<"shared" | "handoff-recovery-required"> {
    if (remote.status !== "committed") return "handoff-recovery-required"
    const receipt = parseProjectSharingHandoffReceiptV3(remote.receipt)
    if (receipt.coreDigest !== proposal.coreDigest || receipt.ownerSignature !== proposal.ownerSignature) {
      return "handoff-recovery-required"
    }
    const verified = await this.ports.verifyCommitted({ proposal, receipt, teamArtifacts: remote.teamArtifacts })
    if (verified !== "verified") return "handoff-recovery-required"
    if (await this.ports.transition.installCommitted({ proposal, receipt, teamArtifacts: remote.teamArtifacts }) !== "installed") {
      return "handoff-recovery-required"
    }
    // Transport is deliberately after the durable authority CAS. Failure affects
    // synchronization only; it cannot restore local-owner signing.
    void this.ports.startSharedRuntime(projectId).catch(() => undefined)
    return "shared"
  }
}
