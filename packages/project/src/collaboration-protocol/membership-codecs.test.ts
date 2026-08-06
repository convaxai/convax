import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseSignature,
  parseUint64,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  membershipMutationProofCoreDigestV2,
  parseMembershipMutationProofCoreV2,
  parseMembershipMutationProofV2,
  parseReplicaIdReservationRequestV2,
  replicaIdReservationRequestCoreDigestV2,
} from "../collaboration-protocol"

const id = (byte: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(byte)))
const member = (byte: number) => parseMemberId(id(byte))
const key = (byte: number) => parsePublicKey(encodeBase64url(new Uint8Array(32).fill(byte)))
const digest = (digit: string) => parseDigest(digit.repeat(64))
const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(7)))
const protocolDigest = parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest)

describe("Membership codecs", () => {
  test("closes reservation and member-add proof over exact current fields", () => {
    const reservationCore = {
      format: "convax.replica-id-reservation-request-core/2" as const,
      allocationRequestId: id(1),
      projectId: parseProjectId("project-a"),
      projectEpoch: id(2),
      membershipEpoch: id(3),
      purpose: "replica-enroll" as const,
      expectedMembershipSequence: parseUint64("2"),
      requesterMemberId: member(4),
      targetMemberId: member(4),
      expectedTargetMemberMutationCounter: parseUint64("1"),
      requesterCredentialDigest: digest("1"),
      currentReplicaId: null,
      newReplicaSigningPublicKey: key(5),
      requestedEditState: "pending-editor" as const,
      protocolDigest,
    }
    const reservation = { format: "convax.replica-id-reservation-request/2" as const, core: reservationCore, coreDigest: replicaIdReservationRequestCoreDigestV2(reservationCore), memberSignature: signature }
    expect(parseReplicaIdReservationRequestV2(reservation)).toEqual(reservation)

    const proofCore = {
      format: "convax.mutation-proof-core/2" as const,
      mutationId: id(6),
      challengeDigest: digest("2"),
      projectId: reservationCore.projectId,
      projectEpoch: reservationCore.projectEpoch,
      membershipEpoch: reservationCore.membershipEpoch,
      expectedMembershipSequence: parseUint64("2"),
      requesterMemberId: member(7),
      targetMemberId: member(8),
      targetMemberMutationCounter: parseUint64("1"),
      serverNonce: id(9),
      purpose: "member-add" as const,
      targetMemberSigningPublicKey: key(8),
      initialRole: "editor" as const,
      adminCapabilityDigest: digest("3"),
    }
    const proof = { format: "convax.mutation-proof/2" as const, core: proofCore, requestDigest: membershipMutationProofCoreDigestV2(proofCore), signatures: { purpose: "member-add" as const, adminSignature: signature, targetMemberPossessionSignature: signature } }
    expect(parseMembershipMutationProofCoreV2(proofCore)).toEqual(proofCore)
    expect(parseMembershipMutationProofV2(proof)).toEqual(proof)
  })

  test("rejects digest tampering, unknown fields, and signature-branch substitution", () => {
    const core = {
      format: "convax.mutation-proof-core/2" as const,
      mutationId: id(1), challengeDigest: digest("1"), projectId: parseProjectId("project-a"), projectEpoch: id(2), membershipEpoch: id(3), expectedMembershipSequence: parseUint64("1"), requesterMemberId: member(4), targetMemberId: member(5), targetMemberMutationCounter: parseUint64("1"), serverNonce: id(6), purpose: "member-add" as const, targetMemberSigningPublicKey: key(5), initialRole: "viewer" as const, adminCapabilityDigest: digest("2"),
    }
    const proof = { format: "convax.mutation-proof/2" as const, core, requestDigest: membershipMutationProofCoreDigestV2(core), signatures: { purpose: "member-add" as const, adminSignature: signature, targetMemberPossessionSignature: signature } }
    expect(() => parseMembershipMutationProofV2({ ...proof, requestDigest: digest("f") })).toThrow()
    expect(() => parseMembershipMutationProofV2({ ...proof, extra: true })).toThrow()
    expect(() => parseMembershipMutationProofV2({ ...proof, signatures: { purpose: "replica-enroll", memberSignature: signature } })).toThrow()
    expect(() => parseMembershipMutationProofCoreV2({ ...core, extra: true })).toThrow()
  })
})
