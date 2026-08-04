import {
  assertExactKeysV2,
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

export function replicaIdReservationRequestCoreDigestV2(core: ReplicaIdReservationRequestCoreV2): DigestV2 {
  return structuredDigestV2("convax.replica-id-reservation-request-core/2", core)
}

export function membershipMutationProofCoreDigestV2(core: MembershipMutationProofCoreV2): DigestV2 {
  return structuredDigestV2("convax.mutation-proof-core/2", core)
}

export function parseReplicaIdReservationRequestV2(value: unknown): ReplicaIdReservationRequestV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "memberSignature"], "replica id reservation request")
  if (value.format !== "convax.replica-id-reservation-request/2") invalid("Replica reservation request format is invalid")
  assertExactKeysV2(value.core, [
    "format", "allocationRequestId", "projectId", "projectEpoch", "membershipEpoch", "purpose",
    "expectedMembershipSequence", "requesterMemberId", "targetMemberId", "expectedTargetMemberMutationCounter",
    "requesterCredentialDigest", "currentReplicaId", "newReplicaSigningPublicKey", "requestedEditState", "protocolDigest",
  ], "replica id reservation request core")
  if (value.core.format !== "convax.replica-id-reservation-request-core/2") invalid("Replica reservation request core format is invalid")
  if (value.core.purpose !== "replica-enroll" && value.core.purpose !== "replica-rotate") invalid("Replica reservation purpose is invalid")
  if (value.core.requestedEditState !== "none" && value.core.requestedEditState !== "pending-editor") invalid("Requested edit state is invalid")
  const currentReplicaId = value.core.currentReplicaId === null ? null : parseReplicaIdV2(value.core.currentReplicaId)
  const core: ReplicaIdReservationRequestCoreV2 = Object.freeze({
    format: "convax.replica-id-reservation-request-core/2",
    allocationRequestId: parseId128V2(value.core.allocationRequestId),
    projectId: parseProjectIdV2(value.core.projectId),
    projectEpoch: parseId128V2(value.core.projectEpoch),
    membershipEpoch: parseId128V2(value.core.membershipEpoch),
    purpose: value.core.purpose,
    expectedMembershipSequence: parseUint64V2(value.core.expectedMembershipSequence),
    requesterMemberId: parseMemberIdV2(value.core.requesterMemberId),
    targetMemberId: parseMemberIdV2(value.core.targetMemberId),
    expectedTargetMemberMutationCounter: parseUint64V2(value.core.expectedTargetMemberMutationCounter),
    requesterCredentialDigest: parseDigestV2(value.core.requesterCredentialDigest),
    currentReplicaId,
    newReplicaSigningPublicKey: parsePublicKeyV2(value.core.newReplicaSigningPublicKey),
    requestedEditState: value.core.requestedEditState,
    protocolDigest: parseDigestV2(value.core.protocolDigest),
  })
  const coreDigest = parseDigestV2(value.coreDigest)
  if (replicaIdReservationRequestCoreDigestV2(core) !== coreDigest) invalid("Replica reservation request digest is invalid")
  return Object.freeze({
    format: "convax.replica-id-reservation-request/2",
    core,
    coreDigest,
    memberSignature: parseSignatureV2(value.memberSignature),
  })
}

export function parseMembershipMutationProofV2(value: unknown): MembershipMutationProofV2 {
  assertExactKeysV2(value, ["format", "core", "requestDigest", "signatures"], "membership mutation proof")
  if (value.format !== "convax.mutation-proof/2") invalid("Membership mutation proof format is invalid")
  const core = parseMembershipMutationProofCoreV2(value.core)
  const requestDigest = parseDigestV2(value.requestDigest)
  if (membershipMutationProofCoreDigestV2(core) !== requestDigest) invalid("Membership mutation request digest is invalid")
  const signatures = parseProofSignatures(value.signatures, core.purpose)
  return Object.freeze({ format: "convax.mutation-proof/2", core, requestDigest, signatures })
}

/** Parses the exact server-prepared core before either required signer attaches proof. */
export function parseMembershipMutationProofCoreV2(value: unknown): MembershipMutationProofCoreV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Membership mutation proof core is invalid")
  assertExactKeysV2(value, proofKeys((value as Record<string, unknown>).purpose), "membership mutation proof core")
  if (value.format !== "convax.mutation-proof-core/2") invalid("Membership mutation proof core format is invalid")
  const base = {
    format: "convax.mutation-proof-core/2" as const,
    mutationId: parseId128V2(value.mutationId),
    challengeDigest: parseDigestV2(value.challengeDigest),
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    membershipEpoch: parseId128V2(value.membershipEpoch),
    expectedMembershipSequence: parseUint64V2(value.expectedMembershipSequence),
    requesterMemberId: parseMemberIdV2(value.requesterMemberId),
    targetMemberId: parseMemberIdV2(value.targetMemberId),
    targetMemberMutationCounter: parseUint64V2(value.targetMemberMutationCounter),
    serverNonce: parseId128V2(value.serverNonce),
  }
  let core: MembershipMutationProofCoreV2
  switch (value.purpose) {
    case "member-add":
      core = Object.freeze({ ...base, purpose: "member-add", targetMemberSigningPublicKey: parsePublicKeyV2(value.targetMemberSigningPublicKey), initialRole: role(value.initialRole), adminCapabilityDigest: parseDigestV2(value.adminCapabilityDigest) })
      break
    case "replica-enroll":
      if (value.currentReplicaId !== null || value.cutoffCoverageRootCoreDigest !== null) invalid("Replica enroll null fields are invalid")
      core = Object.freeze({ ...base, purpose: "replica-enroll", currentReplicaId: null, newReplicaId: parseReplicaIdV2(value.newReplicaId), replicaIdReservationReceiptDigest: parseDigestV2(value.replicaIdReservationReceiptDigest), newReplicaSigningPublicKey: parsePublicKeyV2(value.newReplicaSigningPublicKey), requestedEditState: editState(value.requestedEditState), cutoffCoverageRootCoreDigest: null })
      break
    case "replica-activate-editor":
      if (value.cutoffCoverageRootCoreDigest !== null) invalid("Replica activation cutoff must be null")
      core = Object.freeze({ ...base, purpose: "replica-activate-editor", currentReplicaId: parseReplicaIdV2(value.currentReplicaId), installedFloorSetDigest: parseDigestV2(value.installedFloorSetDigest), cutoffCoverageRootCoreDigest: null })
      break
    case "replica-rotate":
      core = Object.freeze({ ...base, purpose: "replica-rotate", currentReplicaId: parseReplicaIdV2(value.currentReplicaId), newReplicaId: parseReplicaIdV2(value.newReplicaId), replicaIdReservationReceiptDigest: parseDigestV2(value.replicaIdReservationReceiptDigest), newReplicaSigningPublicKey: parsePublicKeyV2(value.newReplicaSigningPublicKey), requestedEditState: editState(value.requestedEditState), cutoffCoverageRootCoreDigest: parseDigestV2(value.cutoffCoverageRootCoreDigest) })
      break
    case "replica-revoke":
      if (value.newReplicaId !== null || value.newReplicaSigningPublicKey !== null || value.requestedEditState !== null) invalid("Replica revoke null fields are invalid")
      core = Object.freeze({ ...base, purpose: "replica-revoke", currentReplicaId: parseReplicaIdV2(value.currentReplicaId), newReplicaId: null, newReplicaSigningPublicKey: null, requestedEditState: null, cutoffCoverageRootCoreDigest: parseDigestV2(value.cutoffCoverageRootCoreDigest) })
      break
    case "member-role-change":
      core = Object.freeze({ ...base, purpose: "member-role-change", nextRole: role(value.nextRole), cutoffCoverageRootCoreDigest: value.cutoffCoverageRootCoreDigest === null ? null : parseDigestV2(value.cutoffCoverageRootCoreDigest), adminCapabilityDigest: parseDigestV2(value.adminCapabilityDigest) })
      break
    case "member-revoke":
      core = Object.freeze({ ...base, purpose: "member-revoke", cutoffCoverageRootCoreDigest: parseDigestV2(value.cutoffCoverageRootCoreDigest), adminCapabilityDigest: parseDigestV2(value.adminCapabilityDigest) })
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
    assertExactKeysV2(value, ["purpose", "adminSignature", "targetMemberPossessionSignature"], "member add signatures")
    if (value.purpose !== purpose) invalid("Membership proof signature purpose is invalid")
    return Object.freeze({ purpose, adminSignature: parseSignatureV2(value.adminSignature), targetMemberPossessionSignature: parseSignatureV2(value.targetMemberPossessionSignature) })
  }
  if (purpose === "member-role-change" || purpose === "member-revoke") {
    assertExactKeysV2(value, ["purpose", "adminSignature"], "admin mutation signatures")
    if (value.purpose !== purpose) invalid("Membership proof signature purpose is invalid")
    return Object.freeze({ purpose, adminSignature: parseSignatureV2(value.adminSignature) })
  }
  assertExactKeysV2(value, ["purpose", "memberSignature"], "replica mutation signatures")
  if (value.purpose !== purpose) invalid("Membership proof signature purpose is invalid")
  return Object.freeze({ purpose, memberSignature: parseSignatureV2(value.memberSignature) })
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
