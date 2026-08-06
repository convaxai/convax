import { parseCheckpointContentCertificate, parseDigest, parseDocumentScope, parseId128, parseMemberId, parseProjectId, parsePublicKey, parseReplicaId, parseSignature, type MemberId, type ProjectId, type ReplicaId } from "@convax/collaboration"
import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION, parseAuthorizationMutation, parseDocumentShardResetApproval, parseEmptyProjectIndexGenesisAttestation, parseMembershipMutationProof, parseRegistryCutoffCoveragePage, parseReplicaIdReservationRequest, parseReplicaProjectFloorPage, type PeerTicketRequest, type SessionProof } from "@convax/project/collaboration-protocol"
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

/** Web-standard current control router; payload-bearing edit paths stay absent. */
export function createCollaborationApiV2Handler(options?: {
  readonly rendezvous?: CollaborationRendezvousServiceV2
  readonly membership?: CollaborationMembershipServiceV2
  readonly metadataControl?: CollaborationMetadataControlServiceV2
  readonly authorizeProjectBootstrap?: (input: {
    readonly request: Request
    readonly projectId: ProjectId
    readonly projectEpoch: ReturnType<typeof parseId128>
    readonly projectIndexShardEpoch: ReturnType<typeof parseId128>
    readonly initializationAuthorityDigest: ReturnType<typeof parseDigest>
    readonly initialProjectIndexCheckpointDigest: ReturnType<typeof parseDigest>
    readonly initialProjectIndexFullUpdateDigest: ReturnType<typeof parseDigest>
    readonly initialProjectIndexStateVectorDigest: ReturnType<typeof parseDigest>
    readonly initialProjectIndexCanonicalStateDigest: ReturnType<typeof parseDigest>
    readonly ownerMemberId: MemberId
    readonly ownerMemberSigningPublicKey: ReturnType<typeof parsePublicKey>
  }) => Promise<ProjectBootstrapAuthorizationV2 | "rejected">
  readonly authorizeTeamInvitation?: (input: {
    readonly request: Request
    readonly action: "create" | "revoke" | "list-member-add"
    readonly projectId: ProjectId
    readonly requesterCredentialDigest: ReturnType<typeof parseDigest>
    readonly invitationToken: string | null
  }) => Promise<TeamInvitationAuthorizationV1 | "rejected">
  readonly authorizeSessionChallenge?: (input: {
    readonly request: Request
    readonly projectId: ProjectId
    readonly memberId: MemberId
    readonly replicaId: ReplicaId
  }) => Promise<SessionChallengeAuthorizationV2 | "rejected">
  readonly authorizeSessionDirectory?: (input: {
    readonly request: Request
    readonly projectId: ProjectId
    readonly credentialDigest: string
  }) => Promise<SessionDirectoryAuthorizationV2 | "rejected">
  readonly authorizeCheckpointAttestation?: (input: {
    readonly request: Request
    readonly projectId: ProjectId
    readonly certificate: ReturnType<typeof parseCheckpointContentCertificate>
  }) => Promise<CheckpointAttestationAdmissionV2 | "rejected">
  readonly authorizeProjectFloorManifest?: (input: {
    readonly request: Request
    readonly projectId: ProjectId
    readonly manifestDigest: ReturnType<typeof parseDigest>
    readonly requiredScopes: readonly ReturnType<typeof parseDocumentScope>[]
  }) => Promise<ProjectFloorManifestAdmissionV2 | "rejected">
  readonly authorizeExactControlCommit?: (input: {
    readonly request: Request
    readonly projectId: ProjectId
    readonly kind: "cutoff" | "shard-reset"
    readonly digest: ReturnType<typeof parseDigest>
  }) => Promise<ExactControlCommitAdmissionV2 | "rejected">
  readonly authorizeEmptyProjectIndexGenesisAttestation?: (input: {
    readonly request: Request
    readonly projectId: ProjectId
    readonly attestation: ReturnType<typeof parseEmptyProjectIndexGenesisAttestation>
  }) => Promise<EmptyProjectIndexGenesisAttestationAdmissionV2 | "rejected">
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url)
    const matched = route(url)
    if (!matched || explicitlyForbiddenSegments.has(matched.segment)) {
      return json(404, { format: "convax.api-error", code: "endpoint-not-found" })
    }
    if (!controlMutationSegments.has(matched.segment)) {
      return json(404, { format: "convax.api-error", code: "endpoint-not-found" })
    }
    if (request.method !== "POST") {
      return json(405, { format: "convax.api-error", code: "method-not-allowed" })
    }
    let metadata: unknown = null
    try {
      metadata = await readControlMetadataJsonV2(request)
    } catch (error) {
      if (error instanceof PayloadPolicyErrorV2) {
        const status = error.code === "body-too-large" ? 413 : error.code === "invalid-content-type" ? 415 : 400
        return json(status, { format: "convax.api-error", code: error.code })
      }
      throw error
    }
    if (options?.membership) {
      try {
        if (matched.segment === "bootstrap") {
          const value = requireBootstrapRecord(metadata)
          if (!options.authorizeProjectBootstrap) return json(503, { format: "convax.api-error", code: "bootstrap-auth-adapter-unavailable" })
          const bootstrapRequest = {
            projectId: parseProjectId(matched.projectId),
            projectEpoch: parseId128(value.projectEpoch),
            projectIndexShardEpoch: parseId128(value.projectIndexShardEpoch),
            initializationAuthorityDigest: parseDigest(value.initializationAuthorityDigest),
            initialProjectIndexCheckpointDigest: parseDigest(value.initialProjectIndexCheckpointDigest),
            initialProjectIndexFullUpdateDigest: parseDigest(value.initialProjectIndexFullUpdateDigest),
            initialProjectIndexStateVectorDigest: parseDigest(value.initialProjectIndexStateVectorDigest),
            initialProjectIndexCanonicalStateDigest: parseDigest(value.initialProjectIndexCanonicalStateDigest),
            ownerMemberId: parseMemberId(value.ownerMemberId),
            ownerMemberSigningPublicKey: parsePublicKey(value.ownerMemberSigningPublicKey),
          }
          const authorization = await options.authorizeProjectBootstrap({ request, ...bootstrapRequest })
          if (authorization === "rejected") return json(403, { format: "convax.api-error", code: "not-active" })
          return json(200, await options.membership.bootstrapProject(bootstrapRequest, authorization) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "replica-reservations") {
          return json(200, await options.membership.reserveReplicaId(parseReplicaIdReservationRequest(metadata)) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "mutation-challenges") {
          const intent = parseMutationChallengeIntent(metadata)
          const challenge = intent.purpose === "member-add" || intent.purpose === "replica-enroll" || intent.purpose === "replica-activate-editor"
            ? await options.membership.issueMutationChallenge(parseProjectId(matched.projectId), intent)
            : await options.membership.issueCutoffChallenge(parseProjectId(matched.projectId), intent)
          return json(200, challenge as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "membership-mutations") {
          return json(200, await options.membership.commitMembershipMutation(parseMembershipMutationProof(metadata)) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "member-add-signature-halves") {
          const value = requireExactRecord(metadata, ["invitationToken", "requestDigest", "kind", "signature"])
          if (typeof value.invitationToken !== "string" || (value.kind !== "admin" && value.kind !== "target-possession")) throw new TypeError("Member-add signature half metadata is invalid")
          return json(200, await options.membership.submitMemberAddSignatureHalf({
            projectId: parseProjectId(matched.projectId),
            invitationToken: value.invitationToken,
            requestDigest: parseDigest(value.requestDigest),
            kind: value.kind,
            signature: parseSignature(value.signature),
          }) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "invitations") {
          const value = requireInvitationRecord(metadata)
          const projectId = parseProjectId(matched.projectId)
          if (value.action === "prepare") {
            return json(200, await options.membership.prepareInvitation({
              projectId,
              invitationToken: value.invitationToken,
              mutationId: parseId128(value.mutationId),
              targetMemberId: parseMemberId(value.targetMemberId),
              targetMemberSigningPublicKey: parsePublicKey(value.targetMemberSigningPublicKey),
            }) as unknown as Readonly<Record<string, unknown>>)
          }
          if (!options.authorizeTeamInvitation) return json(503, { format: "convax.api-error", code: "invitation-auth-adapter-unavailable" })
          const requesterCredentialDigest = parseDigest(value.requesterCredentialDigest)
          const invitationToken = value.action === "revoke" ? value.invitationToken : null
          const authorization = await options.authorizeTeamInvitation({ request, action: value.action, projectId, requesterCredentialDigest, invitationToken })
          if (authorization === "rejected") return json(403, { format: "convax.api-error", code: "not-active" })
          if (value.action === "create") {
            if (value.initialRole !== "viewer" && value.initialRole !== "editor") throw new TypeError("Invitation role is invalid")
            return json(200, await options.membership.createInvitation({ projectId, requesterCredentialDigest, adminCapabilityDigest: parseDigest(value.adminCapabilityDigest), initialRole: value.initialRole }, authorization) as unknown as Readonly<Record<string, unknown>>)
          }
          if (value.action === "list-member-add") {
            return json(200, { invitations: await options.membership.listOwnerMemberAddInvitations({ projectId, requesterCredentialDigest, adminCapabilityDigest: parseDigest(value.adminCapabilityDigest) }, authorization) })
          }
          await options.membership.revokeInvitation({ projectId, requesterCredentialDigest, invitationToken: value.invitationToken }, authorization)
          return json(200, { status: "revoked" })
        }
        if (matched.segment === "project-reset-rollovers") {
          const value = requireRecord(metadata)
          if (value.action === "challenge") {
            exactKeys(value, ["action", "confirmation", "approval"])
            return json(200, await options.membership.issueTeamEpochRolloverChallenge({ projectId: parseProjectId(matched.projectId), confirmation: value.confirmation, approval: value.approval }) as unknown as Readonly<Record<string, unknown>>)
          }
          if (value.action === "commit") {
            exactKeys(value, ["action", "proof", "attestation"])
            const projectId = parseProjectId(matched.projectId)
            const attestation = parseEmptyProjectIndexGenesisAttestation(value.attestation)
            if (!options.authorizeEmptyProjectIndexGenesisAttestation) return json(503, { format: "convax.api-error", code: "empty-genesis-attestation-adapter-unavailable" })
            const admission = await options.authorizeEmptyProjectIndexGenesisAttestation({ request, projectId, attestation })
            if (admission === "rejected") return json(403, { format: "convax.api-error", code: "not-active" })
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
            projectId: matched.projectId as ProjectId,
            memberId: value.memberId as MemberId,
            replicaId: value.replicaId as ReplicaId,
          }
          if (!options.authorizeSessionChallenge) {
            return json(503, { format: "convax.api-error", code: "challenge-auth-adapter-unavailable" })
          }
          const authorization = await options.authorizeSessionChallenge({ request, ...challengeRequest })
          if (authorization === "rejected") {
            return json(403, { format: "convax.api-error", code: "not-active" })
          }
          const challenge = await options.rendezvous.issueSessionChallenge(challengeRequest, authorization)
          return json(200, challenge as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "sessions") {
          const credential = await options.rendezvous.issueSessionCredential(metadata as SessionProof)
          return json(200, credential as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "peer-directory") {
          const value = requireCredentialDigestRecord(metadata)
          if (!options.authorizeSessionDirectory) {
            return json(503, { format: "convax.api-error", code: "directory-auth-adapter-unavailable" })
          }
          const authorization = await options.authorizeSessionDirectory({
            request,
            projectId: matched.projectId as ProjectId,
            credentialDigest: value.credentialDigest,
          })
          if (authorization === "rejected") {
            return json(403, { format: "convax.api-error", code: "not-active" })
          }
          const directory = await options.rendezvous.getActivePeerDirectory(
            matched.projectId as ProjectId,
            authorization,
          )
          return json(200, directory as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "peer-tickets") {
          const ticket = await options.rendezvous.issuePeerFreshnessTicket(
            matched.projectId as ProjectId,
            metadata as PeerTicketRequest,
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
        const projectId = parseProjectId(matched.projectId)
        if (matched.segment === "checkpoint-certificates") {
          const certificate = parseCheckpointContentCertificate(metadata)
          if (!options.authorizeCheckpointAttestation) return json(503, { format: "convax.api-error", code: "attestation-auth-adapter-unavailable" })
          const admission = await options.authorizeCheckpointAttestation({ request, projectId, certificate })
          if (admission === "rejected") return json(403, { format: "convax.api-error", code: "not-active" })
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
          const pages = value.pages.map(parseReplicaProjectFloorPage)
          const manifestDigest = parseDigest(value.manifestDigest)
          const requiredScopes = pages.flatMap((page) => page.core.entries.map((entry) => entry.scope))
          if (!options.authorizeProjectFloorManifest) return json(503, { format: "convax.api-error", code: "project-floor-auth-adapter-unavailable" })
          const admission = await options.authorizeProjectFloorManifest({ request, projectId, manifestDigest, requiredScopes })
          if (admission === "rejected") return json(403, { format: "convax.api-error", code: "not-active" })
          return json(200, await options.metadataControl.publishProjectFloor({ projectId, targetMemberId: parseMemberId(value.targetMemberId), targetReplicaId: parseReplicaId(value.targetReplicaId), manifestDigest, pages }, admission) as unknown as Readonly<Record<string, unknown>>)
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
          const authorizationMutation = parseAuthorizationMutation(value.authorizationMutation)
          if (!options.authorizeExactControlCommit) return json(503, { format: "convax.api-error", code: "cutoff-auth-adapter-unavailable" })
          const admission = await options.authorizeExactControlCommit({ request, projectId, kind: "cutoff", digest: authorizationMutation.coreDigest })
          if (admission === "rejected") return json(403, { format: "convax.api-error", code: "not-active" })
          return json(200, await options.metadataControl.admitCutoffCommit(projectId, { pages: value.pages, root: value.root, authorizationMutation }, admission) as unknown as Readonly<Record<string, unknown>>)
        }
        if (matched.segment === "shard-reset-approvals") {
          const approval = parseDocumentShardResetApproval(metadata)
          const digest = approval.coreDigest
          if (!options.authorizeExactControlCommit) return json(503, { format: "convax.api-error", code: "shard-reset-auth-adapter-unavailable" })
          const admission = await options.authorizeExactControlCommit({ request, projectId, kind: "shard-reset", digest })
          if (admission === "rejected") return json(403, { format: "convax.api-error", code: "not-active" })
          return json(200, await options.metadataControl.admitShardResetApproval(projectId, approval, admission) as unknown as Readonly<Record<string, unknown>>)
        }
      } catch (error) {
        const response = controlErrorResponse(error)
        if (response) return response
        throw error
      }
    }
    return json(503, {
      format: "convax.api-error",
      code: "control-adapters-unavailable",
      integrationStatus: PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION.status,
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
  return json(status, { format: "convax.api-error", code })
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
    return Object.freeze({ purpose: "member-add", mutationId: parseId128(record.mutationId), requesterCredentialDigest: parseDigest(record.requesterCredentialDigest), adminCapabilityDigest: parseDigest(record.adminCapabilityDigest), targetMemberId: parseMemberId(record.targetMemberId), targetMemberSigningPublicKey: parsePublicKey(record.targetMemberSigningPublicKey), initialRole: record.initialRole })
  }
  if (record.purpose === "replica-enroll") {
    exactKeys(record, ["purpose", "mutationId", "requesterCredentialDigest", "replicaIdReservationReceiptDigest"])
    return Object.freeze({ purpose: "replica-enroll", mutationId: parseId128(record.mutationId), requesterCredentialDigest: parseDigest(record.requesterCredentialDigest), replicaIdReservationReceiptDigest: parseDigest(record.replicaIdReservationReceiptDigest) })
  }
  if (record.purpose === "replica-activate-editor") {
    exactKeys(record, ["purpose", "mutationId", "requesterCredentialDigest", "currentReplicaId", "installedFloorSetDigest"])
    return Object.freeze({ purpose: "replica-activate-editor", mutationId: parseId128(record.mutationId), requesterCredentialDigest: parseDigest(record.requesterCredentialDigest), currentReplicaId: parseReplicaId(record.currentReplicaId), installedFloorSetDigest: parseDigest(record.installedFloorSetDigest) })
  }
  if (record.purpose === "replica-rotate") {
    exactKeys(record, ["purpose", "mutationId", "cutoffId", "requesterCredentialDigest", "currentReplicaId", "replicaIdReservationReceiptDigest", "pages"])
    if (!Array.isArray(record.pages)) throw new TypeError("Replica rotation cutoff pages must be an array")
    return Object.freeze({ purpose: "replica-rotate", mutationId: parseId128(record.mutationId), cutoffId: parseId128(record.cutoffId), requesterCredentialDigest: parseDigest(record.requesterCredentialDigest), currentReplicaId: parseReplicaId(record.currentReplicaId), replicaIdReservationReceiptDigest: parseDigest(record.replicaIdReservationReceiptDigest), pages: Object.freeze(record.pages.map(parseRegistryCutoffCoveragePage)) })
  }
  if (record.purpose === "replica-revoke") {
    exactKeys(record, ["purpose", "mutationId", "cutoffId", "requesterCredentialDigest", "currentReplicaId", "pages"])
    if (!Array.isArray(record.pages)) throw new TypeError("Replica revoke cutoff pages must be an array")
    return Object.freeze({ purpose: "replica-revoke", mutationId: parseId128(record.mutationId), cutoffId: parseId128(record.cutoffId), requesterCredentialDigest: parseDigest(record.requesterCredentialDigest), currentReplicaId: parseReplicaId(record.currentReplicaId), pages: Object.freeze(record.pages.map(parseRegistryCutoffCoveragePage)) })
  }
  if (record.purpose === "member-role-change") {
    exactKeys(record, ["purpose", "mutationId", "cutoffId", "requesterCredentialDigest", "adminCapabilityDigest", "targetMemberId", "nextRole", "pages"])
    if (record.nextRole !== "viewer" || !Array.isArray(record.pages)) throw new TypeError("Member role cutoff metadata is invalid")
    return Object.freeze({ purpose: "member-role-change", mutationId: parseId128(record.mutationId), cutoffId: parseId128(record.cutoffId), requesterCredentialDigest: parseDigest(record.requesterCredentialDigest), adminCapabilityDigest: parseDigest(record.adminCapabilityDigest), targetMemberId: parseMemberId(record.targetMemberId), nextRole: "viewer", pages: Object.freeze(record.pages.map(parseRegistryCutoffCoveragePage)) })
  }
  if (record.purpose === "member-revoke") {
    exactKeys(record, ["purpose", "mutationId", "cutoffId", "requesterCredentialDigest", "adminCapabilityDigest", "targetMemberId", "pages"])
    if (!Array.isArray(record.pages)) throw new TypeError("Member revoke cutoff pages must be an array")
    return Object.freeze({ purpose: "member-revoke", mutationId: parseId128(record.mutationId), cutoffId: parseId128(record.cutoffId), requesterCredentialDigest: parseDigest(record.requesterCredentialDigest), adminCapabilityDigest: parseDigest(record.adminCapabilityDigest), targetMemberId: parseMemberId(record.targetMemberId), pages: Object.freeze(record.pages.map(parseRegistryCutoffCoveragePage)) })
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
