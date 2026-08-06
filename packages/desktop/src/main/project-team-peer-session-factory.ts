import {
  incrementUint64,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  type Digest,
  type Id128,
  type MemberId,
  type ProjectId,
  type ReplicaSignerPort,
  type ValidationArtifactSet,
} from "@convax/collaboration"
import {
  membershipMutationProofCoreDigestV2,
  replicaIdReservationRequestCoreDigestV2,
  type MembershipMutationProofV2,
  type ReplicaIdReservationRequestV2,
} from "@convax/project/collaboration-protocol"

import type { ProjectTeamInvitationCarrierV2 } from "../project-team-collaboration-contracts"
import type {
  DesktopCollaborationControlHttpClientV2,
  DesktopMembershipMutationResultV2,
  DesktopProjectBootstrapInitializationV2,
} from "./collaboration-control-http-client"
import type {
  DurableLocalReplicaAuthorityCacheV2,
  LocalReplicaEnrollmentVerifierFactoryV2,
} from "./durable-local-authority-cache"
import {
  type DesktopTeamAuthorityCandidateV1,
  type DesktopTeamAuthorityRecordV1,
  type NodeDurableTeamAuthorityStoreV1,
  type VerifiedDesktopTeamAuthorityV1,
} from "./durable-team-authority-store"
import type { ElectronReplicaSigningVaultV2 } from "./electron-replica-signing-vault"
import type { ElectronTeamIdentityVaultV1 } from "./electron-team-identity-vault"
import type {
  ProjectTeamPeerBootstrapOpenResultV2,
  ProjectTeamPeerSessionFactoryV2,
  ProjectTeamPeerSessionOpenResultV2,
  ProjectTeamPeerSessionV2,
} from "./project-team-collaboration-manager"

export interface ProjectTeamMemberIdentityPortV2 {
  resolve(projectId: ProjectId): Promise<MemberId>
}

export interface ProjectTeamNativeBootstrapFactsPortV2 {
  resolve(projectId: ProjectId): Promise<DesktopProjectBootstrapInitializationV2>
}

export interface ProjectTeamActiveSessionPortV2 {
  open(input: { readonly record: DesktopTeamAuthorityRecordV1; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionV2>
}

export interface ProjectTeamFloorActivationPortV2 {
  activate(input: {
    readonly record: DesktopTeamAuthorityRecordV1
    readonly memberSigner: ReplicaSignerPort
    readonly replicaSigner: ReplicaSignerPort
    readonly signal: AbortSignal
  }): Promise<DesktopMembershipMutationResultV2 | "pending">
}

export interface ProjectTeamAuthorityAdmissionPortV2 {
  admit(candidate: DesktopTeamAuthorityCandidateV1): Promise<VerifiedDesktopTeamAuthorityV1 | "rejected">
}

export interface ProjectTeamReplicaProvisioningResultV2 {
  readonly record: DesktopTeamAuthorityRecordV1
  readonly state: "active-editor" | "pending-floor"
}

/**
 * Main-only exact replica enrollment. A request-bound OS-vault key exists before
 * reservation, but the assigned replicaId is published only after the signed
 * receipt is verified. Team and offline-authority pointers are always last.
 */
export class DesktopProjectTeamReplicaProvisionerV2 {
  constructor(private readonly options: {
    readonly control: DesktopCollaborationControlHttpClientV2
    readonly teamAdmission: ProjectTeamAuthorityAdmissionPortV2
    readonly teamStore: Pick<NodeDurableTeamAuthorityStoreV1, "install">
    readonly memberVault: Pick<ElectronTeamIdentityVaultV1, "openMemberSigner">
    readonly replicaVault: Pick<ElectronReplicaSigningVaultV2, "prepareReplicaKey" | "bindPreparedReplicaKey" | "openSigner">
    readonly floor: ProjectTeamFloorActivationPortV2
    readonly localEnrollment: LocalReplicaEnrollmentVerifierFactoryV2
    readonly localAuthority: Pick<DurableLocalReplicaAuthorityCacheV2, "install">
    readonly validationArtifacts: ValidationArtifactSet
    readonly createId: () => Id128
  }) {}

  async provision(recordInput: DesktopTeamAuthorityRecordV1, signal: AbortSignal): Promise<ProjectTeamReplicaProvisioningResultV2> {
    let record = recordInput
    if (record.replicaEditAuthorization) return Object.freeze({ record, state: "active-editor" })
    const memberSigner = await this.openMemberSigner(record)
    if (!record.replicaActorCredential) record = await this.enrollReplica(record, memberSigner, signal)
    const actor = record.replicaActorCredential
    if (!actor) throw new Error("Replica enrollment committed without actor authority")
    const replicaSigner = await this.options.replicaVault.openSigner({
      projectId: record.projectId,
      projectEpoch: record.membershipSnapshot.core.projectEpoch,
      replicaId: actor.core.replicaId,
      expectedPublicKey: actor.core.replicaSigningPublicKey,
    })
    if (typeof replicaSigner === "string") throw new Error(`Assigned replica signer is ${replicaSigner}`)
    const activation = await this.options.floor.activate({ record, memberSigner, replicaSigner, signal })
    if (activation === "pending") return Object.freeze({ record, state: "pending-floor" })
    record = await this.installMutationForLocalMember(activation, record.memberId, record)
    if (!record.replicaActorCredential || !record.replicaEditAuthorization) throw new Error("Floor activation omitted edit authority")
    await this.publishOfflineAuthority(record, activation)
    return Object.freeze({ record, state: "active-editor" })
  }

  private async enrollReplica(
    record: DesktopTeamAuthorityRecordV1,
    memberSigner: ReplicaSignerPort,
    signal: AbortSignal,
  ): Promise<DesktopTeamAuthorityRecordV1> {
    const allocationRequestId = parseId128(this.options.createId())
    const projectEpoch = record.membershipSnapshot.core.projectEpoch
    const prepared = await this.options.replicaVault.prepareReplicaKey({ projectId: record.projectId, projectEpoch, allocationRequestId })
    const member = record.membershipSnapshot.core.members.find((candidate) => candidate.memberId === record.memberId)
    if (!member || member.state !== "active") throw new Error("Local member is not active")
    const core = Object.freeze({
      format: "convax.replica-id-reservation-request-core/2" as const,
      allocationRequestId,
      projectId: record.projectId,
      projectEpoch,
      membershipEpoch: record.membershipSnapshot.core.membershipEpoch,
      purpose: "replica-enroll" as const,
      expectedMembershipSequence: record.membershipSnapshot.core.membershipSequence,
      requesterMemberId: record.memberId,
      targetMemberId: record.memberId,
      expectedTargetMemberMutationCounter: member.memberMutationCounter,
      requesterCredentialDigest: record.memberCredential.coreDigest,
      currentReplicaId: null,
      newReplicaSigningPublicKey: prepared.publicKey,
      requestedEditState: "pending-editor" as const,
      protocolDigest: record.membershipSnapshot.core.protocolDigest,
    })
    const coreDigest = replicaIdReservationRequestCoreDigestV2(core)
    const request: ReplicaIdReservationRequestV2 = Object.freeze({
      format: "convax.replica-id-reservation-request/2",
      core,
      coreDigest,
      memberSignature: await memberSigner.sign(Buffer.from(coreDigest, "hex")),
    })
    const reserved = requireOk(await this.options.control.reserveReplicaId({ request, signal }), "Replica reservation")
    await this.options.replicaVault.bindPreparedReplicaKey({
      projectId: record.projectId,
      projectEpoch,
      allocationRequestId,
      replicaId: reserved.core.assignedReplicaId,
      expectedPublicKey: prepared.publicKey,
    })
    const challenge = requireOk(await this.options.control.requestMutationChallenge({
      projectId: record.projectId,
      intent: {
        purpose: "replica-enroll",
        mutationId: parseId128(this.options.createId()),
        requesterCredentialDigest: record.memberCredential.coreDigest,
        replicaIdReservationReceiptDigest: reserved.coreDigest,
      },
      signal,
    }), "Replica enrollment challenge")
    const proofCore = Object.freeze({
      format: "convax.mutation-proof-core/2" as const,
      mutationId: challenge.core.mutationId,
      challengeDigest: challenge.coreDigest,
      projectId: record.projectId,
      projectEpoch: challenge.core.projectEpoch,
      membershipEpoch: challenge.core.membershipEpoch,
      expectedMembershipSequence: challenge.core.expectedMembershipSequence,
      requesterMemberId: record.memberId,
      targetMemberId: record.memberId,
      targetMemberMutationCounter: incrementUint64(challenge.core.expectedTargetMemberMutationCounter),
      serverNonce: challenge.core.serverNonce,
      purpose: "replica-enroll" as const,
      currentReplicaId: null,
      newReplicaId: reserved.core.assignedReplicaId,
      replicaIdReservationReceiptDigest: reserved.coreDigest,
      newReplicaSigningPublicKey: prepared.publicKey,
      requestedEditState: "pending-editor" as const,
      cutoffCoverageRootCoreDigest: null,
    })
    const requestDigest = membershipMutationProofCoreDigestV2(proofCore)
    const proof: MembershipMutationProofV2 = Object.freeze({
      format: "convax.mutation-proof/2",
      core: proofCore,
      requestDigest,
      signatures: Object.freeze({ purpose: "replica-enroll", memberSignature: await memberSigner.sign(Buffer.from(requestDigest, "hex")) }),
    })
    return this.installMutationForLocalMember(
      requireOk(await this.options.control.commitMembershipMutation({ proof, signal }), "Replica enrollment"),
      record.memberId,
    )
  }

  private async installMutationForLocalMember(
    result: DesktopMembershipMutationResultV2,
    memberId: MemberId,
    previous?: DesktopTeamAuthorityRecordV1,
  ) {
    const credential = result.targetMemberCredential.core.memberId === memberId
      ? result.targetMemberCredential
      : result.requesterCredential.core.memberId === memberId
        ? result.requesterCredential
        : null
    if (!credential) throw new Error("Membership mutation omitted local member credential")
    const candidate: DesktopTeamAuthorityCandidateV1 = Object.freeze({
      membershipSnapshot: result.membershipSnapshot,
      memberCredential: credential,
      adminCapability: result.requesterAdminCapability?.core.adminMemberId === memberId ? result.requesterAdminCapability : null,
      // Floor activation changes the membership snapshot and edit
      // authorization, but the admitted replica actor identity is stable.
      // The control result intentionally need not repeat that credential.
      replicaActorCredential: result.replicaActorCredential ?? previous?.replicaActorCredential ?? null,
      replicaEditAuthorization: result.replicaEditAuthorization,
    })
    const admitted = await this.options.teamAdmission.admit(candidate)
    if (admitted === "rejected") throw new Error("Membership mutation authority graph was rejected")
    await this.options.teamStore.install(admitted)
    return admitted.record
  }

  private async publishOfflineAuthority(record: DesktopTeamAuthorityRecordV1, evidence: unknown): Promise<void> {
    const actor = record.replicaActorCredential!
    const edit = record.replicaEditAuthorization!
    const enrollment = await this.options.localEnrollment.verify({
      projectId: record.projectId,
      projectEpoch: record.membershipSnapshot.core.projectEpoch,
      actorId: actor.core.actorId,
      membershipSequence: record.membershipSnapshot.core.membershipSequence,
      controlEvidenceDigest: edit.coreDigest,
      protocolDigest: record.membershipSnapshot.core.protocolDigest,
      replicaSigningPublicKey: actor.core.replicaSigningPublicKey,
      signerAuthority: Object.freeze({
        memberId: record.memberId,
        replicaId: actor.core.replicaId,
        actorId: actor.core.actorId,
        memberAuthorizationEpoch: record.memberCredential.core.memberAuthorizationEpoch,
        replicaAuthorizationEpoch: actor.core.replicaAuthorizationEpoch,
        membershipSnapshotDigest: record.membershipSnapshot.coreDigest,
        replicaActorCredentialCoreDigest: actor.coreDigest,
        replicaEditAuthorizationCoreDigest: edit.coreDigest,
      }),
      dependencies: Object.freeze([
        { kind: "membership-snapshot" as const, digest: record.membershipSnapshot.coreDigest },
        { kind: "replica-actor-credential" as const, digest: actor.coreDigest },
        { kind: "replica-edit-authorization" as const, digest: edit.coreDigest },
      ]),
      validationArtifacts: this.options.validationArtifacts,
      authorizationEvidence: evidence,
    })
    if (enrollment === "rejected") throw new Error("Offline replica authority publication was rejected")
    await this.options.localAuthority.install(enrollment)
  }

  private async openMemberSigner(record: DesktopTeamAuthorityRecordV1): Promise<ReplicaSignerPort> {
    const signer = await this.options.memberVault.openMemberSigner({
      projectId: record.projectId,
      memberId: record.memberId,
      expectedPublicKey: record.memberSigningPublicKey,
    })
    if (typeof signer === "string") throw new Error(`Member signer is ${signer}`)
    return signer
  }
}

/** Production lifecycle facade. It never upgrades an unsigned or partial graph. */
export class ProductionProjectTeamPeerSessionFactoryV2 implements ProjectTeamPeerSessionFactoryV2 {
  constructor(private readonly options: {
    readonly control: DesktopCollaborationControlHttpClientV2
    readonly teamAdmission: ProjectTeamAuthorityAdmissionPortV2
    readonly teamStore: Pick<NodeDurableTeamAuthorityStoreV1, "open" | "install">
    readonly memberIdentity: ProjectTeamMemberIdentityPortV2
    readonly memberVault: Pick<ElectronTeamIdentityVaultV1, "ensureMemberKey">
    readonly nativeFacts: ProjectTeamNativeBootstrapFactsPortV2
    readonly provisioner: Pick<DesktopProjectTeamReplicaProvisionerV2, "provision">
    readonly sessions: ProjectTeamActiveSessionPortV2
    readonly protocolDigest: Digest
    readonly trustBundleDigest: Digest
    readonly createId: () => Id128
    readonly afterAuthorityChange: (projectId: ProjectId) => Promise<void>
    readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
    readonly nowUnixMs?: () => bigint
  }) {}

  async openExisting(input: { readonly projectId: string; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionOpenResultV2> {
    const projectId = parseProjectId(input.projectId)
    const current = await this.options.teamStore.open(projectId)
    if (current === "missing") return Object.freeze({ status: "local-only" })
    if (current === "rejected") return attention("protocol-rejected")
    const readmitted = await this.options.teamAdmission.admit({
      membershipSnapshot: current.membershipSnapshot,
      memberCredential: current.memberCredential,
      adminCapability: current.adminCapability,
      replicaActorCredential: current.replicaActorCredential,
      replicaEditAuthorization: current.replicaEditAuthorization,
    })
    if (readmitted === "rejected") return attention("protocol-rejected")
    return this.finishProvisioning(readmitted.record, input.signal)
  }

  async bootstrapTeam(input: { readonly projectId: string; readonly signal: AbortSignal }): Promise<ProjectTeamPeerBootstrapOpenResultV2> {
    const projectId = parseProjectId(input.projectId)
    const existing = await this.options.teamStore.open(projectId)
    if (existing !== "missing") {
      return Object.freeze({
        invitation: null,
        session: existing === "rejected"
          ? attention("protocol-rejected")
          : await this.openExisting({ projectId, signal: input.signal }),
      })
    }
    const initialization = await this.options.nativeFacts.resolve(projectId)
    if (initialization.projectId !== projectId) throw new Error("Project bootstrap facts crossed Project identity")
    const memberId = parseMemberId(await this.options.memberIdentity.resolve(projectId))
    const memberKey = await this.options.memberVault.ensureMemberKey({ projectId, memberId })
    const bootstrap = await this.options.control.bootstrapTeam({
      ...initialization,
      ownerMemberId: memberId,
      ownerMemberSigningPublicKey: memberKey.publicKey,
      expectedProtocolDigest: parseDigest(this.options.protocolDigest),
      expectedTrustBundleDigest: parseDigest(this.options.trustBundleDigest),
      signal: input.signal,
    })
    if (bootstrap.status !== "ok") return Object.freeze({ invitation: null, session: controlAttention(bootstrap) })
    const admitted = await this.options.teamAdmission.admit({
      membershipSnapshot: bootstrap.value.membershipSnapshot,
      memberCredential: bootstrap.value.ownerCredential,
      adminCapability: bootstrap.value.ownerAdminCapability,
      replicaActorCredential: null,
      replicaEditAuthorization: null,
    })
    if (admitted === "rejected") return Object.freeze({ invitation: null, session: attention("protocol-rejected") })
    await this.options.teamStore.install(admitted)
    const session = await this.finishProvisioning(admitted.record, input.signal)
    return Object.freeze({ invitation: bootstrap.value.invitation, session })
  }

  async joinTeam(input: { readonly projectId: string; readonly invitation: ProjectTeamInvitationCarrierV2; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionOpenResultV2> {
    const projectId = parseProjectId(input.projectId)
    const memberId = parseMemberId(await this.options.memberIdentity.resolve(projectId))
    const memberKey = await this.options.memberVault.ensureMemberKey({ projectId, memberId })
    const prepared = await this.options.control.prepareInvitation({
      invitation: input.invitation,
      mutationId: parseId128(this.options.createId()),
      targetMemberId: memberId,
      targetMemberSigningPublicKey: memberKey.publicKey,
      signal: input.signal,
    })
    if (prepared.status !== "ok") return controlAttention(prepared)
    const signature = await memberKey.signer.sign(Buffer.from(prepared.value.requestDigest, "hex"))
    const wait = this.options.wait ?? waitForTeamRetryV2
    const nowUnixMs = this.options.nowUnixMs ?? (() => BigInt(Date.now()))
    while (nowUnixMs() < BigInt(input.invitation.expiresAtUnixMs)) {
      const submitted = await this.options.control.submitMemberAddSignatureHalf({
        projectId,
        invitationToken: input.invitation.invitationToken,
        requestDigest: prepared.value.requestDigest,
        kind: "target-possession",
        signature,
        signal: input.signal,
      })
      if (submitted.status !== "ok") return controlAttention(submitted)
      if (submitted.value.status === "committed") {
        const result = submitted.value.result
        if (result.targetMemberCredential.core.adminCapabilityDigest !== null) {
          // Member-add v2 does not delegate admin authority. Reusing the
          // requester's capability here would cross principal identity.
          return attention("protocol-rejected")
        }
        const admitted = await this.options.teamAdmission.admit({
          membershipSnapshot: result.membershipSnapshot,
          memberCredential: result.targetMemberCredential,
          adminCapability: null,
          replicaActorCredential: null,
          replicaEditAuthorization: null,
        })
        if (admitted === "rejected") return attention("protocol-rejected")
        await this.options.teamStore.install(admitted)
        return this.finishProvisioning(admitted.record, input.signal)
      }
      await wait(1_000, input.signal)
    }
    return attention("credential-expired")
  }

  private async finishProvisioning(record: DesktopTeamAuthorityRecordV1, signal: AbortSignal): Promise<ProjectTeamPeerSessionOpenResultV2> {
    const provisioned = await this.options.provisioner.provision(record, signal)
    if (provisioned.state === "pending-floor") return attention("floor-installation-pending")
    await this.options.afterAuthorityChange(provisioned.record.projectId)
    return Object.freeze({ status: "ready", session: await this.options.sessions.open({ record: provisioned.record, signal }) })
  }
}

function requireOk<T>(result: { readonly status: string; readonly value?: T }, label: string): T {
  if (result.status !== "ok") throw new Error(`${label} failed: ${result.status}`)
  return result.value as T
}

function attention(reason: "protocol-rejected" | "floor-installation-pending" | "credential-expired" | "service-unavailable" | "service-unconfigured") {
  return Object.freeze({ status: "attention" as const, reason })
}

function controlAttention(result: { readonly status: string }): ProjectTeamPeerSessionOpenResultV2 {
  return result.status === "online-disabled" ? attention("service-unconfigured") :
    result.status === "unavailable" ? attention("service-unavailable") : attention("protocol-rejected")
}

export function waitForTeamRetryV2(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      signal.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    if (signal.aborted) return onAbort()
    signal.addEventListener("abort", onAbort, { once: true })
    timer = setTimeout(() => {
      cleanup()
      resolve()
    }, milliseconds)
  })
}
