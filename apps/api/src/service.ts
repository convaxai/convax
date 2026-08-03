import { parseCheckpointContentCertificateV2, parseDigestV2, parseDocumentScopeV2, parseId128V2, parseMemberIdV2, parseProjectIdV2, parsePublicKeyV2, parseReplicaIdV2, parseSignatureV2, type MemberIdV2, type ProjectIdV2, type ReplicaIdV2 } from "@convax/collaboration"
import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2, parseAuthorizationMutationV2, parseDocumentShardResetApprovalV2, parseEmptyProjectIndexGenesisAttestationV2, parseMembershipMutationProofV2, parseRegistryCutoffCoveragePageV2, parseReplicaIdReservationRequestV2, parseReplicaProjectFloorPageV2, type PeerTicketRequestV2, type SessionProofV2 } from "@convax/project/collaboration-protocol"
import { PayloadPolicyErrorV2, readControlMetadataJsonV2 } from "./payload-policy"
import {
  CollaborationControlServiceErrorV2,
  type CollaborationRendezvousServiceV2,
  type SessionChallengeAuthorizationV2,
  type SessionDirectoryAuthorizationV2,
} from "./rendezvous-service"
import type {
  CollaborationMembershipServiceV2,
  CutoffMutationChallengeIntentV2,
  EmptyProjectIndexGenesisAttestationAdmissionV2,
  ProjectBootstrapAuthorizationV2,
  SupportedMutationChallengeIntentV2,
  TeamInvitationAuthorizationV1,
} from "./membership-service"
import type {
  CheckpointAttestationAdmissionV2,
  CollaborationMetadataControlServiceV2,
  ExactControlCommitAdmissionV2,
  ProjectFloorManifestAdmissionV2,
} from "./metadata-control-service"

const controlMutationSegments = new Set([
  "replica-reservations",
  "bootstrap",
  "mutation-challenges",
  "invitations",
  "membership-mutations",
  "member-add-signature-halves",
  "session-challenges",
  "sessions",
  "peer-directory",
  "peer-tickets",
  "checkpoint-certificates",
  "stable-checkpoint-sets",
  "project-floors",
  "replica-floor-acks",
  "registry-claims",
  "registry-abandonments",
  "cutoffs",
  "shard-reset-approvals",
  "project-reset-rollovers",
])

const explicitlyForbiddenSegments = new Set([
  "admissions",
  "actor-counter-abandonments",
  "edit-order",
  "edits",
  "frames",
  "mmr",
  "operation-lookup",
  "typed-intents",
  "yjs-updates",
])

function json(status: number, body: Readonly<Record<string, unknown>>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}

function route(url: URL): { projectId: string; segment: string } | null {
  const parts = url.pathname.split("/").filter(Boolean)
  if (parts.length !== 5 || parts[0] !== "api" || parts[1] !== "v2" || parts[2] !== "projects") return null
  if (!parts[3] || !parts[4]) return null
  return { projectId: parts[3], segment: parts[4] }
}

/** Web-standard R5 control router; payload-bearing edit paths stay absent. */
export function createCollaborationApiV2Handler(options?: {
  readonly rendezvous?: CollaborationRendezvousServiceV2
  readonly membership?: CollaborationMembershipServiceV2
  readonly metadataControl?: CollaborationMetadataControlServiceV2
  readonly authorizeProjectBootstrap?: (input: {
    readonly request: Request
    readonly projectId: ProjectIdV2
    readonly projectEpoch: ReturnType<typeof parseId128V2>
    readonly projectIndexShardEpoch: ReturnType<typeof parseId128V2>
    readonly initializationAuthorityDigest: ReturnType<typeof parseDigestV2>
    readonly initialProjectIndexCheckpointDigest: ReturnType<typeof parseDigestV2>
    readonly initialProjectIndexFullUpdateDigest: ReturnType<typeof parseDigestV2>
    readonly initialProjectIndexStateVectorDigest: ReturnType<typeof parseDigestV2>
    readonly initialProjectIndexCanonicalStateDigest: ReturnType<typeof parseDigestV2>
    readonly ownerMemberId: MemberIdV2
    readonly ownerMemberSigningPublicKey: ReturnType<typeof parsePublicKeyV2>
  }) => Promise<ProjectBootstrapAuthorizationV2 | "rejected">
  readonly authorizeTeamInvitation?: (input: {
    readonly request: Request
    readonly action: "create" | "revoke" | "list-member-add"
    readonly projectId: ProjectIdV2
    readonly requesterCredentialDigest: ReturnType<typeof parseDigestV2>
    readonly invitationToken: string | null
  }) => Promise<TeamInvitationAuthorizationV1 | "rejected">
  readonly authorizeSessionChallenge?: (input: {
    readonly request: Request
    readonly projectId: ProjectIdV2
    readonly memberId: MemberIdV2
    readonly replicaId: ReplicaIdV2
  }) => Promise<SessionChallengeAuthorizationV2 | "rejected">
  readonly authorizeSessionDirectory?: (input: {
    readonly request: Request
    readonly projectId: ProjectIdV2
    readonly credentialDigest: string
  }) => Promise<SessionDirectoryAuthorizationV2 | "rejected">
  readonly authorizeCheckpointAttestation?: (input: {
    readonly request: Request
    readonly projectId: ProjectIdV2
    readonly certificate: ReturnType<typeof parseCheckpointContentCertificateV2>
  }) => Promise<CheckpointAttestationAdmissionV2 | "rejected">
  readonly authorizeProjectFloorManifest?: (input: {
    readonly request: Request
    readonly projectId: ProjectIdV2
    readonly manifestDigest: ReturnType<typeof parseDigestV2>
    readonly requiredScopes: readonly ReturnType<typeof parseDocumentScopeV2>[]
  }) => Promise<ProjectFloorManifestAdmissionV2 | "rejected">
  readonly authorizeExactControlCommit?: (input: {
    readonly request: Request
    readonly projectId: ProjectIdV2
    readonly kind: "cutoff" | "shard-reset"
    readonly digest: ReturnType<typeof parseDigestV2>
  }) => Promise<ExactControlCommitAdmissionV2 | "rejected">
  readonly authorizeEmptyProjectIndexGenesisAttestation?: (input: {
    readonly request: Request
    readonly projectId: ProjectIdV2
    readonly attestation: ReturnType<typeof parseEmptyProjectIndexGenesisAttestationV2>
  }) => Promise<EmptyProjectIndexGenesisAttestationAdmissionV2 | "rejected">
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    const matched = route(url)
    if (!matched || explicitlyForbiddenSegments.has(matched.segment)) {
      return json(404, { format: "convax.api-error/2", code: "endpoint-not-found" })
    }
    if (!controlMutationSegments.has(matched.segment)) {
      return json(404, { format: "convax.api-error/2", code: "endpoint-not-found" })
    }
    if (request.method !== "POST") {
      return json(405, { format: "convax.api-error/2", code: "method-not-allowed" })
    }
    let metadata: unknown = null
    try {
      metadata = await readControlMetadataJsonV2(request)
    } catch (error) {
      if (error instanceof PayloadPolicyErrorV2) {
        const status = error.code === "body-too-large" ? 413 : error.code === "invalid-content-type" ? 415 : 400
        return json(status, { format: "convax.api-error/2", code: error.code })
      }
      throw error
    }
    if (options?.membership) {
      try {
        if (matched.segment === "bootstrap") {
          const value = requireBootstrapRecord(metadata)
          if (!options.authorizeProjectBootstrap) return json(503, { format: "convax.api-error/2", code: "bootstrap-auth-adapter-unavailable" })
          const bootstrapRequest = {
            projectId: parseProjectIdV2(matched.projectId),
            projectEpoch: parseId128V2(value.projectEpoch),
            projectIndexShardEpoch: parseId128V2(value.projectIndexShardEpoch),
            initializationAuthorityDigest: parseDigestV2(value.initializationAuthorityDigest),
            initialProjectIndexCheckpointDigest: parseDigestV2(value.initialProjectIndexCheckpointDigest),
            initialProjectIndexFullUpdateDigest: parseDigestV2(value.initialProjectIndexFullUpdateDigest),
            initialProjectIndexStateVectorDigest: parseDigestV2(value.initialProjectIndexStateVectorDigest),
            initialProjectIndexCanonicalStateDigest: parseDigestV2(value.initialProjectIndexCanonicalStateDigest),
            ownerMemberId: parseMemberIdV2(value.ownerMemberId),
            ownerMemberSigningPublicKey: parsePublicKeyV2(value.ownerMemberSigningPublicKey),
          }
          const authorization = await options.authorizeProjectBootstrap({ request, ...bootstrapRequest })
          if (authorization === "rejected") return json(403, { format: "convax.api-error/2", code: "not-active" })
          return json(200, await options.membership.bootstrapProject(bootstrapRequest, authorization) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "replica-reservations") {
          return json(200, await options.membership.reserveReplicaId(parseReplicaIdReservationRequestV2(metadata)) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "mutation-challenges") {
          const intent = parseMutationChallengeIntent(metadata)
          const challenge = intent.purpose === "member-add" || intent.purpose === "replica-enroll" || intent.purpose === "replica-activate-editor"
            ? await options.membership.issueMutationChallenge(parseProjectIdV2(matched.projectId), intent)
            : await options.membership.issueCutoffChallenge(parseProjectIdV2(matched.projectId), intent)
          return json(200, challenge as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "membership-mutations") {
          return json(200, await options.membership.commitMembershipMutation(parseMembershipMutationProofV2(metadata)) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "member-add-signature-halves") {
          const value = requireExactRecord(metadata, ["invitationToken", "requestDigest", "kind", "signature"])
          if (typeof value.invitationToken !== "string" || (value.kind !== "admin" && value.kind !== "target-possession")) throw new TypeError("Member-add signature half metadata is invalid")
          return json(200, await options.membership.submitMemberAddSignatureHalf({
            projectId: parseProjectIdV2(matched.projectId),
            invitationToken: value.invitationToken,
            requestDigest: parseDigestV2(value.requestDigest),
            kind: value.kind,
            signature: parseSignatureV2(value.signature),
          }) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "invitations") {
          const value = requireInvitationRecord(metadata)
          const projectId = parseProjectIdV2(matched.projectId)
          if (value.action === "prepare") {
            return json(200, await options.membership.prepareInvitation({
              projectId,
              invitationToken: value.invitationToken,
              mutationId: parseId128V2(value.mutationId),
              targetMemberId: parseMemberIdV2(value.targetMemberId),
              targetMemberSigningPublicKey: parsePublicKeyV2(value.targetMemberSigningPublicKey),
            }) as unknown as Readonly<Record<string, unknown>>)
          }
          if (!options.authorizeTeamInvitation) return json(503, { format: "convax.api-error/2", code: "invitation-auth-adapter-unavailable" })
          const requesterCredentialDigest = parseDigestV2(value.requesterCredentialDigest)
          const invitationToken = value.action === "revoke" ? value.invitationToken : null
          const authorization = await options.authorizeTeamInvitation({ request, action: value.action, projectId, requesterCredentialDigest, invitationToken })
          if (authorization === "rejected") return json(403, { format: "convax.api-error/2", code: "not-active" })
          if (value.action === "create") {
            if (value.initialRole !== "viewer" && value.initialRole !== "editor") throw new TypeError("Invitation role is invalid")
            return json(200, await options.membership.createInvitation({ projectId, requesterCredentialDigest, adminCapabilityDigest: parseDigestV2(value.adminCapabilityDigest), initialRole: value.initialRole }, authorization) as unknown as Readonly<Record<string, unknown>>)
          }
          if (value.action === "list-member-add") {
            return json(200, { invitations: await options.membership.listOwnerMemberAddInvitations({ projectId, requesterCredentialDigest, adminCapabilityDigest: parseDigestV2(value.adminCapabilityDigest) }, authorization) })
          }
          await options.membership.revokeInvitation({ projectId, requesterCredentialDigest, invitationToken: value.invitationToken }, authorization)
          return json(200, { status: "revoked" })
        }
        if (matched.segment === "project-reset-rollovers") {
          const value = requireRecord(metadata)
          if (value.action === "challenge") {
            exactKeys(value, ["action", "confirmation", "approval"])
            return json(200, await options.membership.issueTeamEpochRolloverChallenge({ projectId: parseProjectIdV2(matched.projectId), confirmation: value.confirmation, approval: value.approval }) as unknown as Readonly<Record<string, unknown>>)
          }
          if (value.action === "commit") {
            exactKeys(value, ["action", "proof", "attestation"])
            const projectId = parseProjectIdV2(matched.projectId)
            const attestation = parseEmptyProjectIndexGenesisAttestationV2(value.attestation)
            if (!options.authorizeEmptyProjectIndexGenesisAttestation) return json(503, { format: "convax.api-error/2", code: "empty-genesis-attestation-adapter-unavailable" })
            const admission = await options.authorizeEmptyProjectIndexGenesisAttestation({ request, projectId, attestation })
            if (admission === "rejected") return json(403, { format: "convax.api-error/2", code: "not-active" })
            return json(200, await options.membership.commitTeamEpochRollover(value.proof, attestation, admission) as unknown as Readonly<Record<string, unknown>>)
          }
          throw new TypeError("Project reset rollover action is invalid")
        }
      } catch (error) {
        const response = controlErrorResponse(error)
        if (response) return response
        throw error
      }
    }
    if (options?.rendezvous) {
      try {
        if (matched.segment === "session-challenges") {
          const value = requireSessionChallengeRecord(metadata)
          const challengeRequest = {
            projectId: matched.projectId as ProjectIdV2,
            memberId: value.memberId as MemberIdV2,
            replicaId: value.replicaId as ReplicaIdV2,
          }
          if (!options.authorizeSessionChallenge) {
            return json(503, { format: "convax.api-error/2", code: "challenge-auth-adapter-unavailable" })
          }
          const authorization = await options.authorizeSessionChallenge({ request, ...challengeRequest })
          if (authorization === "rejected") {
            return json(403, { format: "convax.api-error/2", code: "not-active" })
          }
          const challenge = await options.rendezvous.issueSessionChallenge(challengeRequest, authorization)
          return json(200, challenge as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "sessions") {
          const credential = await options.rendezvous.issueSessionCredential(metadata as SessionProofV2)
          return json(200, credential as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "peer-directory") {
          const value = requireCredentialDigestRecord(metadata)
          if (!options.authorizeSessionDirectory) {
            return json(503, { format: "convax.api-error/2", code: "directory-auth-adapter-unavailable" })
          }
          const authorization = await options.authorizeSessionDirectory({
            request,
            projectId: matched.projectId as ProjectIdV2,
            credentialDigest: value.credentialDigest,
          })
          if (authorization === "rejected") {
            return json(403, { format: "convax.api-error/2", code: "not-active" })
          }
          const directory = await options.rendezvous.getActivePeerDirectory(
            matched.projectId as ProjectIdV2,
            authorization,
          )
          return json(200, directory as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "peer-tickets") {
          const ticket = await options.rendezvous.issuePeerFreshnessTicket(
            matched.projectId as ProjectIdV2,
            metadata as PeerTicketRequestV2,
          )
          return json(200, ticket as unknown as Readonly<Record<string, unknown>>)
        }
      } catch (error) {
        const response = controlErrorResponse(error)
        if (response) return response
        throw error
      }
    }
    if (options?.metadataControl) {
      try {
        const projectId = parseProjectIdV2(matched.projectId)
        if (matched.segment === "checkpoint-certificates") {
          const certificate = parseCheckpointContentCertificateV2(metadata)
          if (!options.authorizeCheckpointAttestation) return json(503, { format: "convax.api-error/2", code: "attestation-auth-adapter-unavailable" })
          const admission = await options.authorizeCheckpointAttestation({ request, projectId, certificate })
          if (admission === "rejected") return json(403, { format: "convax.api-error/2", code: "not-active" })
          return json(200, await options.metadataControl.admitCheckpointCertificate(projectId, certificate, admission) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "stable-checkpoint-sets") {
          const value = requireExactRecord(metadata, ["stableSetCore", "floorAcks"])
          if (!Array.isArray(value.floorAcks)) throw new TypeError("Stable checkpoint floorAcks must be an array")
          return json(200, await options.metadataControl.publishStableCheckpointSet(projectId, value.stableSetCore, value.floorAcks) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "project-floors") {
          const value = requireExactRecord(metadata, ["targetMemberId", "targetReplicaId", "manifestDigest", "pages"])
          if (!Array.isArray(value.pages)) throw new TypeError("Project floor pages must be an array")
          const pages = value.pages.map(parseReplicaProjectFloorPageV2)
          const manifestDigest = parseDigestV2(value.manifestDigest)
          const requiredScopes = pages.flatMap((page) => page.core.entries.map((entry) => entry.scope))
          if (!options.authorizeProjectFloorManifest) return json(503, { format: "convax.api-error/2", code: "project-floor-auth-adapter-unavailable" })
          const admission = await options.authorizeProjectFloorManifest({ request, projectId, manifestDigest, requiredScopes })
          if (admission === "rejected") return json(403, { format: "convax.api-error/2", code: "not-active" })
          return json(200, await options.metadataControl.publishProjectFloor({ projectId, targetMemberId: parseMemberIdV2(value.targetMemberId), targetReplicaId: parseReplicaIdV2(value.targetReplicaId), manifestDigest, pages }, admission) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "replica-floor-acks") {
          return json(200, await options.metadataControl.admitReplicaFloorAck(projectId, metadata) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "registry-claims") {
          return json(200, await options.metadataControl.registerScope(projectId, metadata) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "registry-abandonments") {
          return json(200, await options.metadataControl.abandonScope(projectId, metadata) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "cutoffs") {
          const value = requireExactRecord(metadata, ["pages", "root", "authorizationMutation"])
          if (!Array.isArray(value.pages)) throw new TypeError("Cutoff pages must be an array")
          const authorizationMutation = parseAuthorizationMutationV2(value.authorizationMutation)
          if (!options.authorizeExactControlCommit) return json(503, { format: "convax.api-error/2", code: "cutoff-auth-adapter-unavailable" })
          const admission = await options.authorizeExactControlCommit({ request, projectId, kind: "cutoff", digest: authorizationMutation.coreDigest })
          if (admission === "rejected") return json(403, { format: "convax.api-error/2", code: "not-active" })
          return json(200, await options.metadataControl.admitCutoffCommit(projectId, { pages: value.pages, root: value.root, authorizationMutation }, admission) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "shard-reset-approvals") {
          const approval = parseDocumentShardResetApprovalV2(metadata)
          const digest = approval.coreDigest
          if (!options.authorizeExactControlCommit) return json(503, { format: "convax.api-error/2", code: "shard-reset-auth-adapter-unavailable" })
          const admission = await options.authorizeExactControlCommit({ request, projectId, kind: "shard-reset", digest })
          if (admission === "rejected") return json(403, { format: "convax.api-error/2", code: "not-active" })
          return json(200, await options.metadataControl.admitShardResetApproval(projectId, approval, admission) as unknown as Readonly<Record<string, unknown>>)
        }
      } catch (error) {
        const response = controlErrorResponse(error)
        if (response) return response
        throw error
      }
    }
    return json(503, {
      format: "convax.api-error/2",
      code: "control-adapters-unavailable",
      integrationStatus: PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2.status,
    })
  }
}

function requireExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = requireRecord(value)
  exactKeys(record, keys)
  return record
}

function controlErrorResponse(error: unknown): Response | null {
  if (!(error instanceof CollaborationControlServiceErrorV2) && !(error instanceof TypeError) && !(error instanceof Error && error.name === "CollaborationCodecErrorV2")) return null
  const code = error instanceof CollaborationControlServiceErrorV2 ? error.code : "invalid-proof"
  const status = code === "not-found" ? 404 : code === "capacity-exceeded" ? 429 : code === "not-active" ? 403 : 400
  return json(status, { format: "convax.api-error/2", code })
}

function requireBootstrapRecord(value: unknown): { readonly projectEpoch: unknown; readonly projectIndexShardEpoch: unknown; readonly initializationAuthorityDigest: unknown; readonly initialProjectIndexCheckpointDigest: unknown; readonly initialProjectIndexFullUpdateDigest: unknown; readonly initialProjectIndexStateVectorDigest: unknown; readonly initialProjectIndexCanonicalStateDigest: unknown; readonly ownerMemberId: unknown; readonly ownerMemberSigningPublicKey: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Bootstrap metadata must be an object")
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join(",") !== "initialProjectIndexCanonicalStateDigest,initialProjectIndexCheckpointDigest,initialProjectIndexFullUpdateDigest,initialProjectIndexStateVectorDigest,initializationAuthorityDigest,ownerMemberId,ownerMemberSigningPublicKey,projectEpoch,projectIndexShardEpoch") throw new TypeError("Bootstrap metadata has unknown or missing fields")
  return { projectEpoch: record.projectEpoch, projectIndexShardEpoch: record.projectIndexShardEpoch, initializationAuthorityDigest: record.initializationAuthorityDigest, initialProjectIndexCheckpointDigest: record.initialProjectIndexCheckpointDigest, initialProjectIndexFullUpdateDigest: record.initialProjectIndexFullUpdateDigest, initialProjectIndexStateVectorDigest: record.initialProjectIndexStateVectorDigest, initialProjectIndexCanonicalStateDigest: record.initialProjectIndexCanonicalStateDigest, ownerMemberId: record.ownerMemberId, ownerMemberSigningPublicKey: record.ownerMemberSigningPublicKey }
}

function parseMutationChallengeIntent(value: unknown): SupportedMutationChallengeIntentV2 | CutoffMutationChallengeIntentV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Mutation challenge metadata must be an object")
  const record = value as Record<string, unknown>
  if (record.purpose === "member-add") {
    exactKeys(record, ["purpose", "mutationId", "requesterCredentialDigest", "adminCapabilityDigest", "targetMemberId", "targetMemberSigningPublicKey", "initialRole"])
    if (record.initialRole !== "viewer" && record.initialRole !== "editor") throw new TypeError("Initial member role is invalid")
    return Object.freeze({ purpose: "member-add", mutationId: parseId128V2(record.mutationId), requesterCredentialDigest: parseDigestV2(record.requesterCredentialDigest), adminCapabilityDigest: parseDigestV2(record.adminCapabilityDigest), targetMemberId: parseMemberIdV2(record.targetMemberId), targetMemberSigningPublicKey: parsePublicKeyV2(record.targetMemberSigningPublicKey), initialRole: record.initialRole })
  }
  if (record.purpose === "replica-enroll") {
    exactKeys(record, ["purpose", "mutationId", "requesterCredentialDigest", "replicaIdReservationReceiptDigest"])
    return Object.freeze({ purpose: "replica-enroll", mutationId: parseId128V2(record.mutationId), requesterCredentialDigest: parseDigestV2(record.requesterCredentialDigest), replicaIdReservationReceiptDigest: parseDigestV2(record.replicaIdReservationReceiptDigest) })
  }
  if (record.purpose === "replica-activate-editor") {
    exactKeys(record, ["purpose", "mutationId", "requesterCredentialDigest", "currentReplicaId", "installedFloorSetDigest"])
    return Object.freeze({ purpose: "replica-activate-editor", mutationId: parseId128V2(record.mutationId), requesterCredentialDigest: parseDigestV2(record.requesterCredentialDigest), currentReplicaId: parseReplicaIdV2(record.currentReplicaId), installedFloorSetDigest: parseDigestV2(record.installedFloorSetDigest) })
  }
  if (record.purpose === "replica-rotate") {
    exactKeys(record, ["purpose", "mutationId", "cutoffId", "requesterCredentialDigest", "currentReplicaId", "replicaIdReservationReceiptDigest", "pages"])
    if (!Array.isArray(record.pages)) throw new TypeError("Replica rotation cutoff pages must be an array")
    return Object.freeze({ purpose: "replica-rotate", mutationId: parseId128V2(record.mutationId), cutoffId: parseId128V2(record.cutoffId), requesterCredentialDigest: parseDigestV2(record.requesterCredentialDigest), currentReplicaId: parseReplicaIdV2(record.currentReplicaId), replicaIdReservationReceiptDigest: parseDigestV2(record.replicaIdReservationReceiptDigest), pages: Object.freeze(record.pages.map(parseRegistryCutoffCoveragePageV2)) })
  }
  if (record.purpose === "replica-revoke") {
    exactKeys(record, ["purpose", "mutationId", "cutoffId", "requesterCredentialDigest", "currentReplicaId", "pages"])
    if (!Array.isArray(record.pages)) throw new TypeError("Replica revoke cutoff pages must be an array")
    return Object.freeze({ purpose: "replica-revoke", mutationId: parseId128V2(record.mutationId), cutoffId: parseId128V2(record.cutoffId), requesterCredentialDigest: parseDigestV2(record.requesterCredentialDigest), currentReplicaId: parseReplicaIdV2(record.currentReplicaId), pages: Object.freeze(record.pages.map(parseRegistryCutoffCoveragePageV2)) })
  }
  if (record.purpose === "member-role-change") {
    exactKeys(record, ["purpose", "mutationId", "cutoffId", "requesterCredentialDigest", "adminCapabilityDigest", "targetMemberId", "nextRole", "pages"])
    if (record.nextRole !== "viewer" || !Array.isArray(record.pages)) throw new TypeError("Member role cutoff metadata is invalid")
    return Object.freeze({ purpose: "member-role-change", mutationId: parseId128V2(record.mutationId), cutoffId: parseId128V2(record.cutoffId), requesterCredentialDigest: parseDigestV2(record.requesterCredentialDigest), adminCapabilityDigest: parseDigestV2(record.adminCapabilityDigest), targetMemberId: parseMemberIdV2(record.targetMemberId), nextRole: "viewer", pages: Object.freeze(record.pages.map(parseRegistryCutoffCoveragePageV2)) })
  }
  if (record.purpose === "member-revoke") {
    exactKeys(record, ["purpose", "mutationId", "cutoffId", "requesterCredentialDigest", "adminCapabilityDigest", "targetMemberId", "pages"])
    if (!Array.isArray(record.pages)) throw new TypeError("Member revoke cutoff pages must be an array")
    return Object.freeze({ purpose: "member-revoke", mutationId: parseId128V2(record.mutationId), cutoffId: parseId128V2(record.cutoffId), requesterCredentialDigest: parseDigestV2(record.requesterCredentialDigest), adminCapabilityDigest: parseDigestV2(record.adminCapabilityDigest), targetMemberId: parseMemberIdV2(record.targetMemberId), pages: Object.freeze(record.pages.map(parseRegistryCutoffCoveragePageV2)) })
  }
  throw new TypeError("Mutation challenge purpose is invalid")
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort()
  const sorted = [...expected].sort()
  if (actual.length !== sorted.length || actual.some((value, index) => value !== sorted[index])) throw new TypeError("Control metadata has unknown or missing fields")
}

type InvitationRouteRecord =
  | { readonly action: "create"; readonly requesterCredentialDigest: unknown; readonly adminCapabilityDigest: unknown; readonly initialRole: unknown }
  | { readonly action: "prepare"; readonly invitationToken: string; readonly mutationId: unknown; readonly targetMemberId: unknown; readonly targetMemberSigningPublicKey: unknown }
  | { readonly action: "list-member-add"; readonly requesterCredentialDigest: unknown; readonly adminCapabilityDigest: unknown }
  | { readonly action: "revoke"; readonly requesterCredentialDigest: unknown; readonly invitationToken: string }

function requireInvitationRecord(value: unknown): InvitationRouteRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Invitation metadata must be an object")
  const record = value as Record<string, unknown>
  if (record.action === "create") {
    exactKeys(record, ["action", "requesterCredentialDigest", "adminCapabilityDigest", "initialRole"])
    return { action: "create", requesterCredentialDigest: record.requesterCredentialDigest, adminCapabilityDigest: record.adminCapabilityDigest, initialRole: record.initialRole }
  }
  if (record.action === "prepare") {
    exactKeys(record, ["action", "invitationToken", "mutationId", "targetMemberId", "targetMemberSigningPublicKey"])
    if (typeof record.invitationToken !== "string") throw new TypeError("Invitation token is invalid")
    return { action: "prepare", invitationToken: record.invitationToken, mutationId: record.mutationId, targetMemberId: record.targetMemberId, targetMemberSigningPublicKey: record.targetMemberSigningPublicKey }
  }
  if (record.action === "list-member-add") {
    exactKeys(record, ["action", "requesterCredentialDigest", "adminCapabilityDigest"])
    return { action: "list-member-add", requesterCredentialDigest: record.requesterCredentialDigest, adminCapabilityDigest: record.adminCapabilityDigest }
  }
  if (record.action === "revoke") {
    exactKeys(record, ["action", "requesterCredentialDigest", "invitationToken"])
    if (typeof record.invitationToken !== "string") throw new TypeError("Invitation token is invalid")
    return { action: "revoke", requesterCredentialDigest: record.requesterCredentialDigest, invitationToken: record.invitationToken }
  }
  throw new TypeError("Invitation action is invalid")
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Control metadata must be an object")
  return value as Record<string, unknown>
}

function requireSessionChallengeRecord(value: unknown): Record<string, unknown> {
  const record = requireRecord(value)
  exactKeys(record, ["memberId", "replicaId"])
  return record
}

function requireCredentialDigestRecord(value: unknown): { readonly credentialDigest: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Peer directory metadata must be an object")
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || typeof record.credentialDigest !== "string") {
    throw new TypeError("Peer directory metadata has unknown or missing fields")
  }
  return { credentialDigest: record.credentialDigest }
}
