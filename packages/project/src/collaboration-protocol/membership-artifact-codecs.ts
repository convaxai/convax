import {
  assertDenseArrayV2,
  assertExactKeysV2,
  compareDecodedBase64urlV2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint64V2,
  structuredDigestV2,
  type DigestV2,
} from "@convax/collaboration"
import type {
  MemberCredentialV2,
  MembershipMemberV2,
  MembershipReplicaV2,
  MembershipSnapshotV2,
  MutationChallengeV2,
  MutationReceiptV2,
  ProjectAdminCapabilityV2,
  ReplicaActorCredentialV2,
  ReplicaEditAuthorizationV2,
  ReplicaIdReservationReceiptV2,
} from "./membership-contracts"

export function parseMembershipSnapshotV2(value: unknown): MembershipSnapshotV2 {
  const source = signed(value, "convax.membership-snapshot/2", "membership snapshot")
  assertExactKeysV2(source.core, ["format", "projectId", "projectEpoch", "membershipEpoch", "membershipSequence", "registrySequence", "registryRootDigest", "members", "replicas", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "membership snapshot core")
  requireFormat(source.core.format, "convax.membership-snapshot-core/2", "Membership snapshot core")
  const membersSource = source.core.members
  const replicasSource = source.core.replicas
  assertDenseArrayV2(membersSource, "membership snapshot members")
  assertDenseArrayV2(replicasSource, "membership snapshot replicas")
  if (membersSource.length > 4_352 || replicasSource.length > 4_608) invalid("Membership snapshot exceeds frozen limits")
  const members = Object.freeze(membersSource.map(parseMembershipMember))
  const replicas = Object.freeze(replicasSource.map(parseMembershipReplica))
  assertMembershipOrderAndIdentity(members, replicas)
  const core = Object.freeze({
    format: "convax.membership-snapshot-core/2" as const,
    projectId: parseProjectIdV2(source.core.projectId),
    projectEpoch: parseId128V2(source.core.projectEpoch),
    membershipEpoch: parseId128V2(source.core.membershipEpoch),
    membershipSequence: parseUint64V2(source.core.membershipSequence),
    registrySequence: parseUint64V2(source.core.registrySequence),
    registryRootDigest: parseDigestV2(source.core.registryRootDigest),
    members,
    replicas,
    ...membershipServiceFields(source.core),
  })
  return close(source, "convax.membership-snapshot/2", "convax.membership-snapshot-core/2", core)
}

export function parseMemberCredentialV2(value: unknown): MemberCredentialV2 {
  const source = signed(value, "convax.member-credential/2", "member credential")
  assertExactKeysV2(source.core, ["format", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest", "memberId", "memberSigningPublicKey", "role", "memberAuthorizationEpoch", "adminCapabilityDigest", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "member credential core")
  requireFormat(source.core.format, "convax.member-credential-core/2", "Member credential core")
  const core = Object.freeze({ format: "convax.member-credential-core/2" as const, projectId: parseProjectIdV2(source.core.projectId), projectEpoch: parseId128V2(source.core.projectEpoch), membershipEpoch: parseId128V2(source.core.membershipEpoch), membershipSnapshotDigest: parseDigestV2(source.core.membershipSnapshotDigest), memberId: parseMemberIdV2(source.core.memberId), memberSigningPublicKey: parsePublicKeyV2(source.core.memberSigningPublicKey), role: collaborationRole(source.core.role), memberAuthorizationEpoch: parseId128V2(source.core.memberAuthorizationEpoch), adminCapabilityDigest: source.core.adminCapabilityDigest === null ? null : parseDigestV2(source.core.adminCapabilityDigest), ...membershipServiceFields(source.core) })
  return close(source, "convax.member-credential/2", "convax.member-credential-core/2", core)
}

export function parseProjectAdminCapabilityV2(value: unknown): ProjectAdminCapabilityV2 {
  const source = signed(value, "convax.project-admin-capability/2", "project admin capability")
  assertExactKeysV2(source.core, ["format", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest", "adminMemberId", "adminMemberAuthorizationEpoch", "grants", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "project admin capability core")
  requireFormat(source.core.format, "convax.project-admin-capability-core/2", "Project admin capability core")
  if (!Array.isArray(source.core.grants) || source.core.grants.length !== 1 || source.core.grants[0] !== "membership-admin") invalid("Project admin grants are invalid")
  const core = Object.freeze({ format: "convax.project-admin-capability-core/2" as const, projectId: parseProjectIdV2(source.core.projectId), projectEpoch: parseId128V2(source.core.projectEpoch), membershipEpoch: parseId128V2(source.core.membershipEpoch), membershipSnapshotDigest: parseDigestV2(source.core.membershipSnapshotDigest), adminMemberId: parseMemberIdV2(source.core.adminMemberId), adminMemberAuthorizationEpoch: parseId128V2(source.core.adminMemberAuthorizationEpoch), grants: ["membership-admin"] as const, ...membershipServiceFields(source.core) })
  return close(source, "convax.project-admin-capability/2", "convax.project-admin-capability-core/2", core)
}

export function parseReplicaIdReservationReceiptV2(value: unknown): ReplicaIdReservationReceiptV2 {
  const source = signed(value, "convax.replica-id-reservation-receipt/2", "replica reservation receipt")
  assertExactKeysV2(source.core, ["format", "allocationRequestId", "reservationRequestCoreDigest", "projectId", "projectEpoch", "membershipEpoch", "purpose", "expectedMembershipSequence", "targetMemberId", "expectedTargetMemberMutationCounter", "requesterCredentialDigest", "currentReplicaId", "assignedReplicaId", "newReplicaSigningPublicKey", "requestedEditState", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "replica reservation receipt core")
  requireFormat(source.core.format, "convax.replica-id-reservation-receipt-core/2", "Replica reservation receipt core")
  const purpose = reservationPurpose(source.core.purpose)
  const currentReplicaId = source.core.currentReplicaId === null ? null : parseReplicaIdV2(source.core.currentReplicaId)
  if ((purpose === "replica-enroll") !== (currentReplicaId === null)) invalid("Replica reservation current id does not match purpose")
  const core = Object.freeze({ format: "convax.replica-id-reservation-receipt-core/2" as const, allocationRequestId: parseId128V2(source.core.allocationRequestId), reservationRequestCoreDigest: parseDigestV2(source.core.reservationRequestCoreDigest), projectId: parseProjectIdV2(source.core.projectId), projectEpoch: parseId128V2(source.core.projectEpoch), membershipEpoch: parseId128V2(source.core.membershipEpoch), purpose, expectedMembershipSequence: parseUint64V2(source.core.expectedMembershipSequence), targetMemberId: parseMemberIdV2(source.core.targetMemberId), expectedTargetMemberMutationCounter: parseUint64V2(source.core.expectedTargetMemberMutationCounter), requesterCredentialDigest: parseDigestV2(source.core.requesterCredentialDigest), currentReplicaId, assignedReplicaId: parseReplicaIdV2(source.core.assignedReplicaId), newReplicaSigningPublicKey: parsePublicKeyV2(source.core.newReplicaSigningPublicKey), requestedEditState: pendingEditState(source.core.requestedEditState), issuedAtUnixMs: parseUint64V2(source.core.issuedAtUnixMs), expiresAtUnixMs: parseUint64V2(source.core.expiresAtUnixMs), ...membershipServiceFields(source.core) })
  return close(source, "convax.replica-id-reservation-receipt/2", "convax.replica-id-reservation-receipt-core/2", core)
}

export function parseMutationChallengeV2(value: unknown): MutationChallengeV2 {
  const source = signed(value, "convax.mutation-challenge/2", "mutation challenge")
  assertExactKeysV2(source.core, ["format", "purpose", "challengeId", "mutationId", "projectId", "projectEpoch", "membershipEpoch", "expectedMembershipSequence", "requesterMemberId", "targetMemberId", "expectedTargetMemberMutationCounter", "requesterCredentialDigest", "replicaIdReservationReceiptDigest", "requiredFloorSetDigest", "preparedAfterMembershipSnapshotCoreDigest", "preparedCutoffCoverageRootCoreDigest", "serverNonce", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "mutation challenge core")
  requireFormat(source.core.format, "convax.mutation-challenge-core/2", "Mutation challenge core")
  const core = Object.freeze({ format: "convax.mutation-challenge-core/2" as const, purpose: mutationPurpose(source.core.purpose), challengeId: parseId128V2(source.core.challengeId), mutationId: parseId128V2(source.core.mutationId), projectId: parseProjectIdV2(source.core.projectId), projectEpoch: parseId128V2(source.core.projectEpoch), membershipEpoch: parseId128V2(source.core.membershipEpoch), expectedMembershipSequence: parseUint64V2(source.core.expectedMembershipSequence), requesterMemberId: parseMemberIdV2(source.core.requesterMemberId), targetMemberId: parseMemberIdV2(source.core.targetMemberId), expectedTargetMemberMutationCounter: parseUint64V2(source.core.expectedTargetMemberMutationCounter), requesterCredentialDigest: parseDigestV2(source.core.requesterCredentialDigest), replicaIdReservationReceiptDigest: nullableDigest(source.core.replicaIdReservationReceiptDigest), requiredFloorSetDigest: nullableDigest(source.core.requiredFloorSetDigest), preparedAfterMembershipSnapshotCoreDigest: parseDigestV2(source.core.preparedAfterMembershipSnapshotCoreDigest), preparedCutoffCoverageRootCoreDigest: nullableDigest(source.core.preparedCutoffCoverageRootCoreDigest), serverNonce: parseId128V2(source.core.serverNonce), issuedAtUnixMs: parseUint64V2(source.core.issuedAtUnixMs), expiresAtUnixMs: parseUint64V2(source.core.expiresAtUnixMs), ...membershipServiceFields(source.core) })
  return close(source, "convax.mutation-challenge/2", "convax.mutation-challenge-core/2", core)
}

export function parseMutationReceiptV2(value: unknown): MutationReceiptV2 {
  const source = signed(value, "convax.mutation-receipt/2", "mutation receipt")
  assertExactKeysV2(source.core, ["format", "mutationId", "requestDigest", "purpose", "beforeMembershipSnapshotDigest", "afterMembershipSnapshotDigest", "consumedReplicaIdReservationReceiptDigest", "issuedReplicaActorCredentialDigest", "issuedReplicaEditAuthorizationDigest", "authorizationMutationDigest", "cutoffCoverageRootCoreDigest", "closedSessionCredentialDigests", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "mutation receipt core")
  requireFormat(source.core.format, "convax.mutation-receipt-core/2", "Mutation receipt core")
  assertDenseArrayV2(source.core.closedSessionCredentialDigests, "closed session credential digests")
  if (source.core.closedSessionCredentialDigests.length > 8) invalid("Mutation receipt closes more than eight sessions")
  const closedSessionCredentialDigests = Object.freeze(source.core.closedSessionCredentialDigests.map(parseDigestV2))
  assertSortedUnique(closedSessionCredentialDigests, "closed session credential digests")
  const core = Object.freeze({ format: "convax.mutation-receipt-core/2" as const, mutationId: parseId128V2(source.core.mutationId), requestDigest: parseDigestV2(source.core.requestDigest), purpose: mutationPurpose(source.core.purpose), beforeMembershipSnapshotDigest: parseDigestV2(source.core.beforeMembershipSnapshotDigest), afterMembershipSnapshotDigest: parseDigestV2(source.core.afterMembershipSnapshotDigest), consumedReplicaIdReservationReceiptDigest: nullableDigest(source.core.consumedReplicaIdReservationReceiptDigest), issuedReplicaActorCredentialDigest: nullableDigest(source.core.issuedReplicaActorCredentialDigest), issuedReplicaEditAuthorizationDigest: nullableDigest(source.core.issuedReplicaEditAuthorizationDigest), authorizationMutationDigest: nullableDigest(source.core.authorizationMutationDigest), cutoffCoverageRootCoreDigest: nullableDigest(source.core.cutoffCoverageRootCoreDigest), closedSessionCredentialDigests, ...membershipServiceFields(source.core) })
  return close(source, "convax.mutation-receipt/2", "convax.mutation-receipt-core/2", core)
}

export function parseReplicaActorCredentialV2(value: unknown): ReplicaActorCredentialV2 {
  const source = signed(value, "convax.replica-actor-credential/2", "replica actor credential")
  assertExactKeysV2(source.core, ["format", "projectId", "projectEpoch", "memberId", "replicaId", "replicaIdReservationReceiptDigest", "actorId", "replicaSigningPublicKey", "replicaAuthorizationEpoch", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "replica actor credential core")
  requireFormat(source.core.format, "convax.replica-actor-credential-core/2", "Replica actor credential core")
  const core = Object.freeze({ format: "convax.replica-actor-credential-core/2" as const, projectId: parseProjectIdV2(source.core.projectId), projectEpoch: parseId128V2(source.core.projectEpoch), memberId: parseMemberIdV2(source.core.memberId), replicaId: parseReplicaIdV2(source.core.replicaId), replicaIdReservationReceiptDigest: parseDigestV2(source.core.replicaIdReservationReceiptDigest), actorId: parseActorIdV2(source.core.actorId), replicaSigningPublicKey: parsePublicKeyV2(source.core.replicaSigningPublicKey), replicaAuthorizationEpoch: parseId128V2(source.core.replicaAuthorizationEpoch), ...membershipServiceFields(source.core) })
  return close(source, "convax.replica-actor-credential/2", "convax.replica-actor-credential-core/2", core)
}

export function parseReplicaEditAuthorizationV2(value: unknown): ReplicaEditAuthorizationV2 {
  const source = signed(value, "convax.replica-edit-authorization/2", "replica edit authorization")
  assertExactKeysV2(source.core, ["format", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest", "membershipSequence", "memberId", "memberAuthorizationEpoch", "replicaId", "replicaIdReservationReceiptDigest", "actorId", "replicaAuthorizationEpoch", "role", "editState", "installedFloorSetDigest", "protocolDigest", "schemaDigest", "validationArtifactSetDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "replica edit authorization core")
  requireFormat(source.core.format, "convax.replica-edit-authorization-core/2", "Replica edit authorization core")
  if (source.core.role !== "editor" || source.core.editState !== "active-editor") invalid("Replica edit authorization role/state is invalid")
  const core = Object.freeze({ format: "convax.replica-edit-authorization-core/2" as const, projectId: parseProjectIdV2(source.core.projectId), projectEpoch: parseId128V2(source.core.projectEpoch), membershipEpoch: parseId128V2(source.core.membershipEpoch), membershipSnapshotDigest: parseDigestV2(source.core.membershipSnapshotDigest), membershipSequence: parseUint64V2(source.core.membershipSequence), memberId: parseMemberIdV2(source.core.memberId), memberAuthorizationEpoch: parseId128V2(source.core.memberAuthorizationEpoch), replicaId: parseReplicaIdV2(source.core.replicaId), replicaIdReservationReceiptDigest: parseDigestV2(source.core.replicaIdReservationReceiptDigest), actorId: parseActorIdV2(source.core.actorId), replicaAuthorizationEpoch: parseId128V2(source.core.replicaAuthorizationEpoch), role: "editor" as const, editState: "active-editor" as const, installedFloorSetDigest: parseDigestV2(source.core.installedFloorSetDigest), protocolDigest: parseDigestV2(source.core.protocolDigest), schemaDigest: parseDigestV2(source.core.schemaDigest), validationArtifactSetDigest: parseDigestV2(source.core.validationArtifactSetDigest), trustBundleDigest: parseDigestV2(source.core.trustBundleDigest), serviceKeyPurpose: membershipPurpose(source.core.serviceKeyPurpose), serviceKeyId: serviceKeyId(source.core.serviceKeyId) })
  return close(source, "convax.replica-edit-authorization/2", "convax.replica-edit-authorization-core/2", core)
}

function parseMembershipMember(value: unknown): MembershipMemberV2 {
  assertExactKeysV2(value, ["memberId", "memberSigningPublicKey", "role", "state", "memberAuthorizationEpoch", "memberMutationCounter"], "membership member")
  if (value.state !== "active" && value.state !== "revoked") invalid("Membership member state is invalid")
  return Object.freeze({ memberId: parseMemberIdV2(value.memberId), memberSigningPublicKey: parsePublicKeyV2(value.memberSigningPublicKey), role: collaborationRole(value.role), state: value.state, memberAuthorizationEpoch: parseId128V2(value.memberAuthorizationEpoch), memberMutationCounter: parseUint64V2(value.memberMutationCounter) })
}

function parseMembershipReplica(value: unknown): MembershipReplicaV2 {
  assertExactKeysV2(value, ["replicaId", "replicaIdReservationReceiptDigest", "memberId", "actorId", "replicaSigningPublicKey", "state", "editState", "replicaAuthorizationEpoch", "enrolledAtMembershipSequence", "revokedAtMembershipSequence", "replacesReplicaId"], "membership replica")
  if (value.state !== "active" && value.state !== "revoked" && value.state !== "replaced") invalid("Membership replica state is invalid")
  if (value.editState !== "none" && value.editState !== "pending-editor" && value.editState !== "active-editor") invalid("Membership replica edit state is invalid")
  return Object.freeze({ replicaId: parseReplicaIdV2(value.replicaId), replicaIdReservationReceiptDigest: parseDigestV2(value.replicaIdReservationReceiptDigest), memberId: parseMemberIdV2(value.memberId), actorId: parseActorIdV2(value.actorId), replicaSigningPublicKey: parsePublicKeyV2(value.replicaSigningPublicKey), state: value.state, editState: value.editState, replicaAuthorizationEpoch: parseId128V2(value.replicaAuthorizationEpoch), enrolledAtMembershipSequence: parseUint64V2(value.enrolledAtMembershipSequence), revokedAtMembershipSequence: value.revokedAtMembershipSequence === null ? null : parseUint64V2(value.revokedAtMembershipSequence), replacesReplicaId: value.replacesReplicaId === null ? null : parseReplicaIdV2(value.replacesReplicaId) })
}

function assertMembershipOrderAndIdentity(members: readonly MembershipMemberV2[], replicas: readonly MembershipReplicaV2[]): void {
  const memberIds = new Set<string>(), memberKeys = new Set<string>(), replicaIds = new Set<string>(), replicaKeys = new Set<string>(), actorIds = new Set<string>()
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index]!
    if (memberIds.has(member.memberId) || memberKeys.has(member.memberSigningPublicKey)) invalid("Membership member identity is duplicated")
    if (index > 0 && compareDecodedBase64urlV2(members[index - 1]!.memberId, member.memberId) >= 0) invalid("Membership members are not sorted by decoded id")
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
  assertExactKeysV2(value, ["format", "core", "coreDigest", "serviceSignature"], label)
  requireFormat(value.format, format, label)
  if (typeof value.core !== "object" || value.core === null || Array.isArray(value.core)) invalid(`${label} core is invalid`)
  return value as never
}

function close<const Format extends string, const Domain extends `${string}/2`, const Core extends object>(source: { readonly coreDigest: unknown; readonly serviceSignature: unknown }, format: Format, domain: Domain, core: Core): Readonly<{ format: Format; core: Core; coreDigest: DigestV2; serviceSignature: ReturnType<typeof parseSignatureV2> }> {
  const coreDigest = parseDigestV2(source.coreDigest)
  if (structuredDigestV2(domain, core) !== coreDigest) invalid(`${format} core digest is invalid`)
  return Object.freeze({ format, core, coreDigest, serviceSignature: parseSignatureV2(source.serviceSignature) })
}

function membershipServiceFields(core: Record<string, unknown>) {
  return Object.freeze({ protocolDigest: parseDigestV2(core.protocolDigest), trustBundleDigest: parseDigestV2(core.trustBundleDigest), serviceKeyPurpose: membershipPurpose(core.serviceKeyPurpose), serviceKeyId: serviceKeyId(core.serviceKeyId) })
}
function membershipPurpose(value: unknown): "membership" { if (value !== "membership") invalid("Membership service purpose is invalid"); return value }
function serviceKeyId(value: unknown): string { if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(value)) invalid("Service key id is invalid"); return value }
function collaborationRole(value: unknown): "viewer" | "editor" { if (value !== "viewer" && value !== "editor") invalid("Collaboration role is invalid"); return value }
function pendingEditState(value: unknown): "none" | "pending-editor" { if (value !== "none" && value !== "pending-editor") invalid("Requested edit state is invalid"); return value }
function reservationPurpose(value: unknown): "replica-enroll" | "replica-rotate" { if (value !== "replica-enroll" && value !== "replica-rotate") invalid("Reservation purpose is invalid"); return value }
function mutationPurpose(value: unknown): MutationChallengeV2["core"]["purpose"] { if (!["member-add", "replica-enroll", "replica-activate-editor", "replica-rotate", "replica-revoke", "member-role-change", "member-revoke"].includes(value as string)) invalid("Mutation purpose is invalid"); return value as MutationChallengeV2["core"]["purpose"] }
function nullableDigest(value: unknown): DigestV2 | null { return value === null ? null : parseDigestV2(value) }
function assertSortedUnique(values: readonly string[], label: string): void { for (let index = 1; index < values.length; index += 1) if (values[index - 1]! >= values[index]!) invalid(`${label} are not strictly sorted`) }
function requireFormat(value: unknown, expected: string, label: string): void { if (value !== expected) invalid(`${label} format is invalid`) }
function invalid(message: string): never { throw new TypeError(message) }
