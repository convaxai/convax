import {
  assertExactKeys,
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
  MembershipMutationProofCoreV2,
  MembershipMutationProofV2,
  ReplicaIdReservationRequestCoreV2,
  ReplicaIdReservationRequestV2,
} from "./membership-contracts"

const proofBaseKeys = [
  "format", "mutationId", "challengeDigest", "projectId", "projectEpoch", "membershipEpoch",
  "expectedMembershipSequence", "requesterMemberId", "targetMemberId", "targetMemberMutationCounter",
  "serverNonce", "purpose",
] as const

export function replicaIdReservationRequestCoreDigestV2(core: ReplicaIdReservationRequestCoreV2): Digest {
  return structuredDigest("convax.replica-id-reservation-request-core/2", core)
}

export function membershipMutationProofCoreDigestV2(core: MembershipMutationProofCoreV2): Digest {
  return structuredDigest("convax.mutation-proof-core/2", core)
}

export function parseReplicaIdReservationRequestV2(value: unknown): ReplicaIdReservationRequestV2 {
  assertExactKeys(value, ["format", "core", "coreDigest", "memberSignature"], "replica id reservation request")
  if (value.format !== "convax.replica-id-reservation-request/2") invalid("Replica reservation request format is invalid")
  assertExactKeys(value.core, [
    "format", "allocationRequestId", "projectId", "projectEpoch", "membershipEpoch", "purpose",
    "expectedMembershipSequence", "requesterMemberId", "targetMemberId", "expectedTargetMemberMutationCounter",
    "requesterCredentialDigest", "currentReplicaId", "newReplicaSigningPublicKey", "requestedEditState", "protocolDigest",
  ], "replica id reservation request core")
  if (value.core.format !== "convax.replica-id-reservation-request-core/2") invalid("Replica reservation request core format is invalid")
  if (value.core.purpose !== "replica-enroll" && value.core.purpose !== "replica-rotate") invalid("Replica reservation purpose is invalid")
  if (value.core.requestedEditState !== "none" && value.core.requestedEditState !== "pending-editor") invalid("Requested edit state is invalid")
  const currentReplicaId = value.core.currentReplicaId === null ? null : parseReplicaId(value.core.currentReplicaId)
  const core: ReplicaIdReservationRequestCoreV2 = Object.freeze({
    format: "convax.replica-id-reservation-request-core/2",
    allocationRequestId: parseId128(value.core.allocationRequestId),
    projectId: parseProjectId(value.core.projectId),
    projectEpoch: parseId128(value.core.projectEpoch),
    membershipEpoch: parseId128(value.core.membershipEpoch),
    purpose: value.core.purpose,
    expectedMembershipSequence: parseUint64(value.core.expectedMembershipSequence),
    requesterMemberId: parseMemberId(value.core.requesterMemberId),
    targetMemberId: parseMemberId(value.core.targetMemberId),
    expectedTargetMemberMutationCounter: parseUint64(value.core.expectedTargetMemberMutationCounter),
    requesterCredentialDigest: parseDigest(value.core.requesterCredentialDigest),
    currentReplicaId,
    newReplicaSigningPublicKey: parsePublicKey(value.core.newReplicaSigningPublicKey),
    requestedEditState: value.core.requestedEditState,
    protocolDigest: parseDigest(value.core.protocolDigest),
  })
  const coreDigest = parseDigest(value.coreDigest)
  if (replicaIdReservationRequestCoreDigestV2(core) !== coreDigest) invalid("Replica reservation request digest is invalid")
  return Object.freeze({
    format: "convax.replica-id-reservation-request/2",
    core,
    coreDigest,
    memberSignature: parseSignature(value.memberSignature),
  })
}

export function parseMembershipMutationProofV2(value: unknown): MembershipMutationProofV2 {
  assertExactKeys(value, ["format", "core", "requestDigest", "signatures"], "membership mutation proof")
  if (value.format !== "convax.mutation-proof/2") invalid("Membership mutation proof format is invalid")
  const core = parseMembershipMutationProofCoreV2(value.core)
  const requestDigest = parseDigest(value.requestDigest)
  if (membershipMutationProofCoreDigestV2(core) !== requestDigest) invalid("Membership mutation request digest is invalid")
  const signatures = parseProofSignatures(value.signatures, core.purpose)
  return Object.freeze({ format: "convax.mutation-proof/2", core, requestDigest, signatures })
}

/** Parses the exact server-prepared core before either required signer attaches proof. */
export function parseMembershipMutationProofCoreV2(value: unknown): MembershipMutationProofCoreV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Membership mutation proof core is invalid")
  assertExactKeys(value, proofKeys((value as Record<string, unknown>).purpose), "membership mutation proof core")
  if (value.format !== "convax.mutation-proof-core/2") invalid("Membership mutation proof core format is invalid")
  const base = {
    format: "convax.mutation-proof-core/2" as const,
    mutationId: parseId128(value.mutationId),
    challengeDigest: parseDigest(value.challengeDigest),
    projectId: parseProjectId(value.projectId),
    projectEpoch: parseId128(value.projectEpoch),
    membershipEpoch: parseId128(value.membershipEpoch),
    expectedMembershipSequence: parseUint64(value.expectedMembershipSequence),
    requesterMemberId: parseMemberId(value.requesterMemberId),
    targetMemberId: parseMemberId(value.targetMemberId),
    targetMemberMutationCounter: parseUint64(value.targetMemberMutationCounter),
    serverNonce: parseId128(value.serverNonce),
  }
  let core: MembershipMutationProofCoreV2
  switch (value.purpose) {
    case "member-add":
      core = Object.freeze({ ...base, purpose: "member-add", targetMemberSigningPublicKey: parsePublicKey(value.targetMemberSigningPublicKey), initialRole: role(value.initialRole), adminCapabilityDigest: parseDigest(value.adminCapabilityDigest) })
      break
    case "replica-enroll":
      if (value.currentReplicaId !== null || value.cutoffCoverageRootCoreDigest !== null) invalid("Replica enroll null fields are invalid")
      core = Object.freeze({ ...base, purpose: "replica-enroll", currentReplicaId: null, newReplicaId: parseReplicaId(value.newReplicaId), replicaIdReservationReceiptDigest: parseDigest(value.replicaIdReservationReceiptDigest), newReplicaSigningPublicKey: parsePublicKey(value.newReplicaSigningPublicKey), requestedEditState: editState(value.requestedEditState), cutoffCoverageRootCoreDigest: null })
      break
    case "replica-activate-editor":
      if (value.cutoffCoverageRootCoreDigest !== null) invalid("Replica activation cutoff must be null")
      core = Object.freeze({ ...base, purpose: "replica-activate-editor", currentReplicaId: parseReplicaId(value.currentReplicaId), installedFloorSetDigest: parseDigest(value.installedFloorSetDigest), cutoffCoverageRootCoreDigest: null })
      break
    case "replica-rotate":
      core = Object.freeze({ ...base, purpose: "replica-rotate", currentReplicaId: parseReplicaId(value.currentReplicaId), newReplicaId: parseReplicaId(value.newReplicaId), replicaIdReservationReceiptDigest: parseDigest(value.replicaIdReservationReceiptDigest), newReplicaSigningPublicKey: parsePublicKey(value.newReplicaSigningPublicKey), requestedEditState: editState(value.requestedEditState), cutoffCoverageRootCoreDigest: parseDigest(value.cutoffCoverageRootCoreDigest) })
      break
    case "replica-revoke":
      if (value.newReplicaId !== null || value.newReplicaSigningPublicKey !== null || value.requestedEditState !== null) invalid("Replica revoke null fields are invalid")
      core = Object.freeze({ ...base, purpose: "replica-revoke", currentReplicaId: parseReplicaId(value.currentReplicaId), newReplicaId: null, newReplicaSigningPublicKey: null, requestedEditState: null, cutoffCoverageRootCoreDigest: parseDigest(value.cutoffCoverageRootCoreDigest) })
      break
    case "member-role-change":
      core = Object.freeze({ ...base, purpose: "member-role-change", nextRole: role(value.nextRole), cutoffCoverageRootCoreDigest: value.cutoffCoverageRootCoreDigest === null ? null : parseDigest(value.cutoffCoverageRootCoreDigest), adminCapabilityDigest: parseDigest(value.adminCapabilityDigest) })
      break
    case "member-revoke":
      core = Object.freeze({ ...base, purpose: "member-revoke", cutoffCoverageRootCoreDigest: parseDigest(value.cutoffCoverageRootCoreDigest), adminCapabilityDigest: parseDigest(value.adminCapabilityDigest) })
      break
    default: invalid("Membership mutation purpose is invalid")
  }
  return core
}

function proofKeys(purpose: unknown): readonly string[] {
  switch (purpose) {
    case "member-add": return [...proofBaseKeys, "targetMemberSigningPublicKey", "initialRole", "adminCapabilityDigest"]
    case "replica-enroll": return [...proofBaseKeys, "currentReplicaId", "newReplicaId", "replicaIdReservationReceiptDigest", "newReplicaSigningPublicKey", "requestedEditState", "cutoffCoverageRootCoreDigest"]
    case "replica-activate-editor": return [...proofBaseKeys, "currentReplicaId", "installedFloorSetDigest", "cutoffCoverageRootCoreDigest"]
    case "replica-rotate": return [...proofBaseKeys, "currentReplicaId", "newReplicaId", "replicaIdReservationReceiptDigest", "newReplicaSigningPublicKey", "requestedEditState", "cutoffCoverageRootCoreDigest"]
    case "replica-revoke": return [...proofBaseKeys, "currentReplicaId", "newReplicaId", "newReplicaSigningPublicKey", "requestedEditState", "cutoffCoverageRootCoreDigest"]
    case "member-role-change": return [...proofBaseKeys, "nextRole", "cutoffCoverageRootCoreDigest", "adminCapabilityDigest"]
    case "member-revoke": return [...proofBaseKeys, "cutoffCoverageRootCoreDigest", "adminCapabilityDigest"]
    default: invalid("Membership mutation purpose is invalid")
  }
}

function parseProofSignatures(value: unknown, purpose: MembershipMutationProofCoreV2["purpose"]): MembershipMutationProofV2["signatures"] {
  if (purpose === "member-add") {
    assertExactKeys(value, ["purpose", "adminSignature", "targetMemberPossessionSignature"], "member add signatures")
    if (value.purpose !== purpose) invalid("Membership proof signature purpose is invalid")
    return Object.freeze({ purpose, adminSignature: parseSignature(value.adminSignature), targetMemberPossessionSignature: parseSignature(value.targetMemberPossessionSignature) })
  }
  if (purpose === "member-role-change" || purpose === "member-revoke") {
    assertExactKeys(value, ["purpose", "adminSignature"], "admin mutation signatures")
    if (value.purpose !== purpose) invalid("Membership proof signature purpose is invalid")
    return Object.freeze({ purpose, adminSignature: parseSignature(value.adminSignature) })
  }
  assertExactKeys(value, ["purpose", "memberSignature"], "replica mutation signatures")
  if (value.purpose !== purpose) invalid("Membership proof signature purpose is invalid")
  return Object.freeze({ purpose, memberSignature: parseSignature(value.memberSignature) })
}

function role(value: unknown): "viewer" | "editor" {
  if (value !== "viewer" && value !== "editor") invalid("Collaboration role is invalid")
  return value
}

function editState(value: unknown): "none" | "pending-editor" {
  if (value !== "none" && value !== "pending-editor") invalid("Requested edit state is invalid")
  return value
}

function invalid(message: string): never {
  throw new TypeError(message)
}
