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
  membershipMutationProofCoreDigest,
  replicaIdReservationRequestCoreDigest,
  type MembershipMutationProof,
  type ReplicaIdReservationRequest,
} from "@convax/project/collaboration-protocol"

import type { ProjectTeamInvitationCarrier } from "../project-team-collaboration-contracts"
import type {
  DesktopCollaborationControlHttpClient,
  DesktopMembershipMutationResult,
  DesktopProjectBootstrapInitialization,
} from "./collaboration-control-http-client"
import type {
  DurableLocalReplicaAuthorityCache,
  LocalReplicaEnrollmentVerifierFactory,
} from "./durable-local-authority-cache"
import {
  type DesktopTeamAuthorityCandidate,
  type DesktopTeamAuthorityRecord,
  type NodeDurableTeamAuthorityStore,
  type VerifiedDesktopTeamAuthority,
} from "./durable-team-authority-store"
import type { ElectronReplicaSigningVault } from "./electron-replica-signing-vault"
import type { ElectronTeamIdentityVault } from "./electron-team-identity-vault"
import type {
  ProjectTeamPeerBootstrapOpenResult,
  ProjectTeamPeerSessionFactory,
  ProjectTeamPeerSessionOpenResult,
  ProjectTeamPeerSession,
} from "./project-team-collaboration-manager"

export interface ProjectTeamMemberIdentityPort {
  resolve(projectId: ProjectId): Promise<MemberId>
}

export interface ProjectTeamNativeBootstrapFactsPort {
  resolve(projectId: ProjectId): Promise<DesktopProjectBootstrapInitialization>
}

export interface ProjectTeamActiveSessionPort {
  open(input: { readonly record: DesktopTeamAuthorityRecord; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSession>
}

export interface ProjectTeamFloorActivationPort {
  activate(input: {
    readonly record: DesktopTeamAuthorityRecord
    readonly memberSigner: ReplicaSignerPort
    readonly replicaSigner: ReplicaSignerPort
    readonly signal: AbortSignal
  }): Promise<DesktopMembershipMutationResult | "pending">
}

export interface ProjectTeamAuthorityAdmissionPort {
  admit(candidate: DesktopTeamAuthorityCandidate): Promise<VerifiedDesktopTeamAuthority | "rejected">
}

export interface ProjectTeamReplicaProvisioningResult {
  readonly record: DesktopTeamAuthorityRecord
  readonly state: "active-editor" | "pending-floor"
}

/**
 * Main-only exact replica enrollment. A request-bound OS-vault key exists before
 * reservation, but the assigned replicaId is published only after the signed
 * receipt is verified. Team and offline-authority pointers are always last.
 */
export class DesktopProjectTeamReplicaProvisioner {
  constructor(private readonly options: {
    readonly control: DesktopCollaborationControlHttpClient
    readonly teamAdmission: ProjectTeamAuthorityAdmissionPort
    readonly teamStore: Pick<NodeDurableTeamAuthorityStore, "install">
    readonly memberVault: Pick<ElectronTeamIdentityVault, "openMemberSigner">
    readonly replicaVault: Pick<ElectronReplicaSigningVault, "prepareReplicaKey" | "bindPreparedReplicaKey" | "openSigner">
    readonly floor: ProjectTeamFloorActivationPort
    readonly localEnrollment: LocalReplicaEnrollmentVerifierFactory
    readonly localAuthority: Pick<DurableLocalReplicaAuthorityCache, "install">
    readonly validationArtifacts: ValidationArtifactSet
    readonly createId: () => Id128
  }) {}

  async provision(recordInput: DesktopTeamAuthorityRecord, signal: AbortSignal): Promise<ProjectTeamReplicaProvisioningResult> {
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
    record: DesktopTeamAuthorityRecord,
    memberSigner: ReplicaSignerPort,
    signal: AbortSignal,
  ): Promise<DesktopTeamAuthorityRecord> {
    const allocationRequestId = parseId128(this.options.createId())
    const projectEpoch = record.membershipSnapshot.core.projectEpoch
    const prepared = await this.options.replicaVault.prepareReplicaKey({ projectId: record.projectId, projectEpoch, allocationRequestId })
    const member = record.membershipSnapshot.core.members.find((candidate) => candidate.memberId === record.memberId)
    if (!member || member.state !== "active") throw new Error("Local member is not active")
    const core = Object.freeze({
      format: "convax.replica-id-reservation-request-core" as const,
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
    const coreDigest = replicaIdReservationRequestCoreDigest(core)
    const request: ReplicaIdReservationRequest = Object.freeze({
      format: "convax.replica-id-reservation-request",
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
      format: "convax.mutation-proof-core" as const,
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
    const requestDigest = membershipMutationProofCoreDigest(proofCore)
    const proof: MembershipMutationProof = Object.freeze({
      format: "convax.mutation-proof",
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
    result: DesktopMembershipMutationResult,
    memberId: MemberId,
    previous?: DesktopTeamAuthorityRecord,
  ) {
    const credential = result.targetMemberCredential.core.memberId === memberId
      ? result.targetMemberCredential
      : result.requesterCredential.core.memberId === memberId
        ? result.requesterCredential
        : null
    if (!credential) throw new Error("Membership mutation omitted local member credential")
    const candidate: DesktopTeamAuthorityCandidate = Object.freeze({
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

  private async publishOfflineAuthority(record: DesktopTeamAuthorityRecord, evidence: unknown): Promise<void> {
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

  private async openMemberSigner(record: DesktopTeamAuthorityRecord): Promise<ReplicaSignerPort> {
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
export class ProductionProjectTeamPeerSessionFactory implements ProjectTeamPeerSessionFactory {
  constructor(private readonly options: {
    readonly control: DesktopCollaborationControlHttpClient
    readonly teamAdmission: ProjectTeamAuthorityAdmissionPort
    readonly teamStore: Pick<NodeDurableTeamAuthorityStore, "open" | "install">
    readonly memberIdentity: ProjectTeamMemberIdentityPort
    readonly memberVault: Pick<ElectronTeamIdentityVault, "ensureMemberKey">
    readonly nativeFacts: ProjectTeamNativeBootstrapFactsPort
    readonly provisioner: Pick<DesktopProjectTeamReplicaProvisioner, "provision">
    readonly sessions: ProjectTeamActiveSessionPort
    readonly protocolDigest: Digest
    readonly trustBundleDigest: Digest
    readonly createId: () => Id128
    readonly afterAuthorityChange: (projectId: ProjectId) => Promise<void>
    readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
    readonly nowUnixMs?: () => bigint
  }) {}

  async openExisting(input: { readonly projectId: string; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionOpenResult> {
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

  async bootstrapTeam(input: { readonly projectId: string; readonly signal: AbortSignal }): Promise<ProjectTeamPeerBootstrapOpenResult> {
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

  async joinTeam(input: { readonly projectId: string; readonly invitation: ProjectTeamInvitationCarrier; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionOpenResult> {
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
    const wait = this.options.wait ?? waitForTeamRetry
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

  private async finishProvisioning(record: DesktopTeamAuthorityRecord, signal: AbortSignal): Promise<ProjectTeamPeerSessionOpenResult> {
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

function controlAttention(result: { readonly status: string }): ProjectTeamPeerSessionOpenResult {
  return result.status === "online-disabled" ? attention("service-unconfigured") :
    result.status === "unavailable" ? attention("service-unavailable") : attention("protocol-rejected")
}

export function waitForTeamRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
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
