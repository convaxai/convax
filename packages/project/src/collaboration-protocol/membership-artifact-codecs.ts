import {
  assertDenseArray,
  assertExactKeys,
  compareDecodedBase64url,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSignature,
  parseUint64,
  structuredDigest,
  type Digest,
} from "@convax/collaboration"
import type {
  MemberCredential,
  MembershipMember,
  MembershipReplica,
  MembershipSnapshot,
  MutationChallenge,
  MutationReceipt,
  ProjectAdminCapability,
  ReplicaActorCredential,
  ReplicaEditAuthorization,
  ReplicaIdReservationReceipt,
} from "./membership-contracts"

export function parseMembershipSnapshot(value: unknown): MembershipSnapshot {
  const source = signed(value, "convax.membership-snapshot", "membership snapshot")
  assertExactKeys(source.core, ["format", "projectId", "projectEpoch", "membershipEpoch", "membershipSequence", "registrySequence", "registryRootDigest", "members", "replicas", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "membership snapshot core")
  requireFormat(source.core.format, "convax.membership-snapshot-core", "Membership snapshot core")
  const membersSource = source.core.members
  const replicasSource = source.core.replicas
  assertDenseArray(membersSource, "membership snapshot members")
  assertDenseArray(replicasSource, "membership snapshot replicas")
  if (membersSource.length > 4_352 || replicasSource.length > 4_608) invalid("Membership snapshot exceeds frozen limits")
  const members = Object.freeze(membersSource.map(parseMembershipMember))
  const replicas = Object.freeze(replicasSource.map(parseMembershipReplica))
  assertMembershipOrderAndIdentity(members, replicas)
  const core = Object.freeze({
    format: "convax.membership-snapshot-core" as const,
    projectId: parseProjectId(source.core.projectId),
    projectEpoch: parseId128(source.core.projectEpoch),
    membershipEpoch: parseId128(source.core.membershipEpoch),
    membershipSequence: parseUint64(source.core.membershipSequence),
    registrySequence: parseUint64(source.core.registrySequence),
    registryRootDigest: parseDigest(source.core.registryRootDigest),
    members,
    replicas,
    ...membershipServiceFields(source.core),
  })
  return close(source, "convax.membership-snapshot", "convax.membership-snapshot-core", core)
}

export function parseMemberCredential(value: unknown): MemberCredential {
  const source = signed(value, "convax.member-credential", "member credential")
  assertExactKeys(source.core, ["format", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest", "memberId", "memberSigningPublicKey", "role", "memberAuthorizationEpoch", "adminCapabilityDigest", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "member credential core")
  requireFormat(source.core.format, "convax.member-credential-core", "Member credential core")
  const core = Object.freeze({ format: "convax.member-credential-core" as const, projectId: parseProjectId(source.core.projectId), projectEpoch: parseId128(source.core.projectEpoch), membershipEpoch: parseId128(source.core.membershipEpoch), membershipSnapshotDigest: parseDigest(source.core.membershipSnapshotDigest), memberId: parseMemberId(source.core.memberId), memberSigningPublicKey: parsePublicKey(source.core.memberSigningPublicKey), role: collaborationRole(source.core.role), memberAuthorizationEpoch: parseId128(source.core.memberAuthorizationEpoch), adminCapabilityDigest: source.core.adminCapabilityDigest === null ? null : parseDigest(source.core.adminCapabilityDigest), ...membershipServiceFields(source.core) })
  return close(source, "convax.member-credential", "convax.member-credential-core", core)
}

export function parseProjectAdminCapability(value: unknown): ProjectAdminCapability {
  const source = signed(value, "convax.project-admin-capability", "project admin capability")
  assertExactKeys(source.core, ["format", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest", "adminMemberId", "adminMemberAuthorizationEpoch", "grants", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "project admin capability core")
  requireFormat(source.core.format, "convax.project-admin-capability-core", "Project admin capability core")
  if (!Array.isArray(source.core.grants) || source.core.grants.length !== 1 || source.core.grants[0] !== "membership-admin") invalid("Project admin grants are invalid")
  const core = Object.freeze({ format: "convax.project-admin-capability-core" as const, projectId: parseProjectId(source.core.projectId), projectEpoch: parseId128(source.core.projectEpoch), membershipEpoch: parseId128(source.core.membershipEpoch), membershipSnapshotDigest: parseDigest(source.core.membershipSnapshotDigest), adminMemberId: parseMemberId(source.core.adminMemberId), adminMemberAuthorizationEpoch: parseId128(source.core.adminMemberAuthorizationEpoch), grants: ["membership-admin"] as const, ...membershipServiceFields(source.core) })
  return close(source, "convax.project-admin-capability", "convax.project-admin-capability-core", core)
}

export function parseReplicaIdReservationReceipt(value: unknown): ReplicaIdReservationReceipt {
  const source = signed(value, "convax.replica-id-reservation-receipt", "replica reservation receipt")
  assertExactKeys(source.core, ["format", "allocationRequestId", "reservationRequestCoreDigest", "projectId", "projectEpoch", "membershipEpoch", "purpose", "expectedMembershipSequence", "targetMemberId", "expectedTargetMemberMutationCounter", "requesterCredentialDigest", "currentReplicaId", "assignedReplicaId", "newReplicaSigningPublicKey", "requestedEditState", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "replica reservation receipt core")
  requireFormat(source.core.format, "convax.replica-id-reservation-receipt-core", "Replica reservation receipt core")
  const purpose = reservationPurpose(source.core.purpose)
  const currentReplicaId = source.core.currentReplicaId === null ? null : parseReplicaId(source.core.currentReplicaId)
  if ((purpose === "replica-enroll") !== (currentReplicaId === null)) invalid("Replica reservation current id does not match purpose")
  const core = Object.freeze({ format: "convax.replica-id-reservation-receipt-core" as const, allocationRequestId: parseId128(source.core.allocationRequestId), reservationRequestCoreDigest: parseDigest(source.core.reservationRequestCoreDigest), projectId: parseProjectId(source.core.projectId), projectEpoch: parseId128(source.core.projectEpoch), membershipEpoch: parseId128(source.core.membershipEpoch), purpose, expectedMembershipSequence: parseUint64(source.core.expectedMembershipSequence), targetMemberId: parseMemberId(source.core.targetMemberId), expectedTargetMemberMutationCounter: parseUint64(source.core.expectedTargetMemberMutationCounter), requesterCredentialDigest: parseDigest(source.core.requesterCredentialDigest), currentReplicaId, assignedReplicaId: parseReplicaId(source.core.assignedReplicaId), newReplicaSigningPublicKey: parsePublicKey(source.core.newReplicaSigningPublicKey), requestedEditState: pendingEditState(source.core.requestedEditState), issuedAtUnixMs: parseUint64(source.core.issuedAtUnixMs), expiresAtUnixMs: parseUint64(source.core.expiresAtUnixMs), ...membershipServiceFields(source.core) })
  return close(source, "convax.replica-id-reservation-receipt", "convax.replica-id-reservation-receipt-core", core)
}

export function parseMutationChallenge(value: unknown): MutationChallenge {
  const source = signed(value, "convax.mutation-challenge", "mutation challenge")
  assertExactKeys(source.core, ["format", "purpose", "challengeId", "mutationId", "projectId", "projectEpoch", "membershipEpoch", "expectedMembershipSequence", "requesterMemberId", "targetMemberId", "expectedTargetMemberMutationCounter", "requesterCredentialDigest", "replicaIdReservationReceiptDigest", "requiredFloorSetDigest", "preparedAfterMembershipSnapshotCoreDigest", "preparedCutoffCoverageRootCoreDigest", "serverNonce", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "mutation challenge core")
  requireFormat(source.core.format, "convax.mutation-challenge-core", "Mutation challenge core")
  const core = Object.freeze({ format: "convax.mutation-challenge-core" as const, purpose: mutationPurpose(source.core.purpose), challengeId: parseId128(source.core.challengeId), mutationId: parseId128(source.core.mutationId), projectId: parseProjectId(source.core.projectId), projectEpoch: parseId128(source.core.projectEpoch), membershipEpoch: parseId128(source.core.membershipEpoch), expectedMembershipSequence: parseUint64(source.core.expectedMembershipSequence), requesterMemberId: parseMemberId(source.core.requesterMemberId), targetMemberId: parseMemberId(source.core.targetMemberId), expectedTargetMemberMutationCounter: parseUint64(source.core.expectedTargetMemberMutationCounter), requesterCredentialDigest: parseDigest(source.core.requesterCredentialDigest), replicaIdReservationReceiptDigest: nullableDigest(source.core.replicaIdReservationReceiptDigest), requiredFloorSetDigest: nullableDigest(source.core.requiredFloorSetDigest), preparedAfterMembershipSnapshotCoreDigest: parseDigest(source.core.preparedAfterMembershipSnapshotCoreDigest), preparedCutoffCoverageRootCoreDigest: nullableDigest(source.core.preparedCutoffCoverageRootCoreDigest), serverNonce: parseId128(source.core.serverNonce), issuedAtUnixMs: parseUint64(source.core.issuedAtUnixMs), expiresAtUnixMs: parseUint64(source.core.expiresAtUnixMs), ...membershipServiceFields(source.core) })
  return close(source, "convax.mutation-challenge", "convax.mutation-challenge-core", core)
}

export function parseMutationReceipt(value: unknown): MutationReceipt {
  const source = signed(value, "convax.mutation-receipt", "mutation receipt")
  assertExactKeys(source.core, ["format", "mutationId", "requestDigest", "purpose", "beforeMembershipSnapshotDigest", "afterMembershipSnapshotDigest", "consumedReplicaIdReservationReceiptDigest", "issuedReplicaActorCredentialDigest", "issuedReplicaEditAuthorizationDigest", "authorizationMutationDigest", "cutoffCoverageRootCoreDigest", "closedSessionCredentialDigests", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "mutation receipt core")
  requireFormat(source.core.format, "convax.mutation-receipt-core", "Mutation receipt core")
  assertDenseArray(source.core.closedSessionCredentialDigests, "closed session credential digests")
  if (source.core.closedSessionCredentialDigests.length > 8) invalid("Mutation receipt closes more than eight sessions")
  const closedSessionCredentialDigests = Object.freeze(source.core.closedSessionCredentialDigests.map(parseDigest))
  assertSortedUnique(closedSessionCredentialDigests, "closed session credential digests")
  const core = Object.freeze({ format: "convax.mutation-receipt-core" as const, mutationId: parseId128(source.core.mutationId), requestDigest: parseDigest(source.core.requestDigest), purpose: mutationPurpose(source.core.purpose), beforeMembershipSnapshotDigest: parseDigest(source.core.beforeMembershipSnapshotDigest), afterMembershipSnapshotDigest: parseDigest(source.core.afterMembershipSnapshotDigest), consumedReplicaIdReservationReceiptDigest: nullableDigest(source.core.consumedReplicaIdReservationReceiptDigest), issuedReplicaActorCredentialDigest: nullableDigest(source.core.issuedReplicaActorCredentialDigest), issuedReplicaEditAuthorizationDigest: nullableDigest(source.core.issuedReplicaEditAuthorizationDigest), authorizationMutationDigest: nullableDigest(source.core.authorizationMutationDigest), cutoffCoverageRootCoreDigest: nullableDigest(source.core.cutoffCoverageRootCoreDigest), closedSessionCredentialDigests, ...membershipServiceFields(source.core) })
  return close(source, "convax.mutation-receipt", "convax.mutation-receipt-core", core)
}

export function parseReplicaActorCredential(value: unknown): ReplicaActorCredential {
  const source = signed(value, "convax.replica-actor-credential", "replica actor credential")
  assertExactKeys(source.core, ["format", "projectId", "projectEpoch", "memberId", "replicaId", "replicaIdReservationReceiptDigest", "actorId", "replicaSigningPublicKey", "replicaAuthorizationEpoch", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "replica actor credential core")
  requireFormat(source.core.format, "convax.replica-actor-credential-core", "Replica actor credential core")
  const core = Object.freeze({ format: "convax.replica-actor-credential-core" as const, projectId: parseProjectId(source.core.projectId), projectEpoch: parseId128(source.core.projectEpoch), memberId: parseMemberId(source.core.memberId), replicaId: parseReplicaId(source.core.replicaId), replicaIdReservationReceiptDigest: parseDigest(source.core.replicaIdReservationReceiptDigest), actorId: parseActorId(source.core.actorId), replicaSigningPublicKey: parsePublicKey(source.core.replicaSigningPublicKey), replicaAuthorizationEpoch: parseId128(source.core.replicaAuthorizationEpoch), ...membershipServiceFields(source.core) })
  return close(source, "convax.replica-actor-credential", "convax.replica-actor-credential-core", core)
}

export function parseReplicaEditAuthorization(value: unknown): ReplicaEditAuthorization {
  const source = signed(value, "convax.replica-edit-authorization", "replica edit authorization")
  assertExactKeys(source.core, ["format", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest", "membershipSequence", "memberId", "memberAuthorizationEpoch", "replicaId", "replicaIdReservationReceiptDigest", "actorId", "replicaAuthorizationEpoch", "role", "editState", "installedFloorSetDigest", "protocolDigest", "schemaDigest", "validationArtifactSetDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "replica edit authorization core")
  requireFormat(source.core.format, "convax.replica-edit-authorization-core", "Replica edit authorization core")
  if (source.core.role !== "editor" || source.core.editState !== "active-editor") invalid("Replica edit authorization role/state is invalid")
  const core = Object.freeze({ format: "convax.replica-edit-authorization-core" as const, projectId: parseProjectId(source.core.projectId), projectEpoch: parseId128(source.core.projectEpoch), membershipEpoch: parseId128(source.core.membershipEpoch), membershipSnapshotDigest: parseDigest(source.core.membershipSnapshotDigest), membershipSequence: parseUint64(source.core.membershipSequence), memberId: parseMemberId(source.core.memberId), memberAuthorizationEpoch: parseId128(source.core.memberAuthorizationEpoch), replicaId: parseReplicaId(source.core.replicaId), replicaIdReservationReceiptDigest: parseDigest(source.core.replicaIdReservationReceiptDigest), actorId: parseActorId(source.core.actorId), replicaAuthorizationEpoch: parseId128(source.core.replicaAuthorizationEpoch), role: "editor" as const, editState: "active-editor" as const, installedFloorSetDigest: parseDigest(source.core.installedFloorSetDigest), protocolDigest: parseDigest(source.core.protocolDigest), schemaDigest: parseDigest(source.core.schemaDigest), validationArtifactSetDigest: parseDigest(source.core.validationArtifactSetDigest), trustBundleDigest: parseDigest(source.core.trustBundleDigest), serviceKeyPurpose: membershipPurpose(source.core.serviceKeyPurpose), serviceKeyId: serviceKeyId(source.core.serviceKeyId) })
  return close(source, "convax.replica-edit-authorization", "convax.replica-edit-authorization-core", core)
}

function parseMembershipMember(value: unknown): MembershipMember {
  assertExactKeys(value, ["memberId", "memberSigningPublicKey", "role", "state", "memberAuthorizationEpoch", "memberMutationCounter"], "membership member")
  if (value.state !== "active" && value.state !== "revoked") invalid("Membership member state is invalid")
  return Object.freeze({ memberId: parseMemberId(value.memberId), memberSigningPublicKey: parsePublicKey(value.memberSigningPublicKey), role: collaborationRole(value.role), state: value.state, memberAuthorizationEpoch: parseId128(value.memberAuthorizationEpoch), memberMutationCounter: parseUint64(value.memberMutationCounter) })
}

function parseMembershipReplica(value: unknown): MembershipReplica {
  assertExactKeys(value, ["replicaId", "replicaIdReservationReceiptDigest", "memberId", "actorId", "replicaSigningPublicKey", "state", "editState", "replicaAuthorizationEpoch", "enrolledAtMembershipSequence", "revokedAtMembershipSequence", "replacesReplicaId"], "membership replica")
  if (value.state !== "active" && value.state !== "revoked" && value.state !== "replaced") invalid("Membership replica state is invalid")
  if (value.editState !== "none" && value.editState !== "pending-editor" && value.editState !== "active-editor") invalid("Membership replica edit state is invalid")
  return Object.freeze({ replicaId: parseReplicaId(value.replicaId), replicaIdReservationReceiptDigest: parseDigest(value.replicaIdReservationReceiptDigest), memberId: parseMemberId(value.memberId), actorId: parseActorId(value.actorId), replicaSigningPublicKey: parsePublicKey(value.replicaSigningPublicKey), state: value.state, editState: value.editState, replicaAuthorizationEpoch: parseId128(value.replicaAuthorizationEpoch), enrolledAtMembershipSequence: parseUint64(value.enrolledAtMembershipSequence), revokedAtMembershipSequence: value.revokedAtMembershipSequence === null ? null : parseUint64(value.revokedAtMembershipSequence), replacesReplicaId: value.replacesReplicaId === null ? null : parseReplicaId(value.replacesReplicaId) })
}

function assertMembershipOrderAndIdentity(members: readonly MembershipMember[], replicas: readonly MembershipReplica[]): void {
  const memberIds = new Set<string>(), memberKeys = new Set<string>(), replicaIds = new Set<string>(), replicaKeys = new Set<string>(), actorIds = new Set<string>()
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index]!
    if (memberIds.has(member.memberId) || memberKeys.has(member.memberSigningPublicKey)) invalid("Membership member identity is duplicated")
    if (index > 0 && compareDecodedBase64url(members[index - 1]!.memberId, member.memberId) >= 0) invalid("Membership members are not sorted by decoded id")
    memberIds.add(member.memberId); memberKeys.add(member.memberSigningPublicKey)
  }
  for (let index = 0; index < replicas.length; index += 1) {
    const replica = replicas[index]!
    if (replicaIds.has(replica.replicaId) || replicaKeys.has(replica.replicaSigningPublicKey) || actorIds.has(replica.actorId)) invalid("Membership replica identity is duplicated")
    if (index > 0 && replicas[index - 1]!.replicaId >= replica.replicaId) invalid("Membership replicas are not sorted by decoded id")
    if (!memberIds.has(replica.memberId)) invalid("Membership replica member is absent")
    replicaIds.add(replica.replicaId); replicaKeys.add(replica.replicaSigningPublicKey); actorIds.add(replica.actorId)
  }
}

function signed(value: unknown, format: string, label: string): { readonly format: string; readonly core: Record<string, unknown>; readonly coreDigest: unknown; readonly serviceSignature: unknown } {
  assertExactKeys(value, ["format", "core", "coreDigest", "serviceSignature"], label)
  requireFormat(value.format, format, label)
  if (typeof value.core !== "object" || value.core === null || Array.isArray(value.core)) invalid(`${label} core is invalid`)
  return value as never
}

function close<const Format extends string, const Domain extends string, const Core extends object>(source: { readonly coreDigest: unknown; readonly serviceSignature: unknown }, format: Format, domain: Domain, core: Core): Readonly<{ format: Format; core: Core; coreDigest: Digest; serviceSignature: ReturnType<typeof parseSignature> }> {
  const coreDigest = parseDigest(source.coreDigest)
  if (structuredDigest(domain, core) !== coreDigest) invalid(`${format} core digest is invalid`)
  return Object.freeze({ format, core, coreDigest, serviceSignature: parseSignature(source.serviceSignature) })
}

function membershipServiceFields(core: Record<string, unknown>) {
  return Object.freeze({ protocolDigest: parseDigest(core.protocolDigest), trustBundleDigest: parseDigest(core.trustBundleDigest), serviceKeyPurpose: membershipPurpose(core.serviceKeyPurpose), serviceKeyId: serviceKeyId(core.serviceKeyId) })
}
function membershipPurpose(value: unknown): "membership" { if (value !== "membership") invalid("Membership service purpose is invalid"); return value }
function serviceKeyId(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(value)) invalid("Service key id is invalid"); return value }
function collaborationRole(value: unknown): "viewer" | "editor" { if (value !== "viewer" && value !== "editor") invalid("Collaboration role is invalid"); return value }
function pendingEditState(value: unknown): "none" | "pending-editor" { if (value !== "none" && value !== "pending-editor") invalid("Requested edit state is invalid"); return value }
function reservationPurpose(value: unknown): "replica-enroll" | "replica-rotate" { if (value !== "replica-enroll" && value !== "replica-rotate") invalid("Reservation purpose is invalid"); return value }
function mutationPurpose(value: unknown): MutationChallenge["core"]["purpose"] { if (!["member-add", "replica-enroll", "replica-activate-editor", "replica-rotate", "replica-revoke", "member-role-change", "member-revoke"].includes(value as string)) invalid("Mutation purpose is invalid"); return value as MutationChallenge["core"]["purpose"] }
function nullableDigest(value: unknown): Digest | null { return value === null ? null : parseDigest(value) }
function assertSortedUnique(values: readonly string[], label: string): void { for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) invalid(`${label} are not strictly sorted`) }
function requireFormat(value: unknown, expected: string, label: string): void { if (value !== expected) invalid(`${label} format is invalid`) }
function invalid(message: string): never { throw new TypeError(message) }
