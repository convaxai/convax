import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parsePeerId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSessionId,
  parseSignature,
  parseUint64,
  structuredDigest,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES,
  createPinnedControlServiceVerifier,
  parseActivePeerDirectory,
  parsePeerFreshnessTicket,
  parseSessionChallenge,
  parseSessionCredential,
  type ActivePeerDirectoryEntry,
} from "../collaboration-protocol"

const id = (byte: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(byte)))
const digest = (digit: string) => parseDigest(digit.repeat(64))
const actor = parseActorId(encodeBase64url(new Uint8Array(32).fill(2)))
const publicKey = parsePublicKey(encodeBase64url(new Uint8Array(32).fill(3)))
const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(4)))
const projectId = parseProjectId("project-a")
const memberId = parseMemberId(id(5))
const replicaId = parseReplicaId("replica_00000001")
const peerId = parsePeerId("peer_aaaaaaaaaaaaaaaaaaaaaaaaaa")

function challenge() {
  const core = {
    format: "convax.session-challenge-core" as const,
    challengeId: id(1),
    projectId,
    projectEpoch: id(2),
    membershipEpoch: id(3),
    membershipSnapshotDigest: digest("1"),
    memberId,
    replicaId,
    actorId: actor,
    expectedReplicaSessionCounter: parseUint64("1"),
    serverNonce: id(6),
    sessionId: parseSessionId(id(7)),
    leaseId: id(8),
    peerId,
    issuedAtUnixMs: parseUint64("1000"),
    expiresAtUnixMs: parseUint64("61000"),
    protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest),
    trustBundleDigest: digest("2"),
    serviceKeyPurpose: "membership" as const,
    serviceKeyId: "membership-1",
  }
  return {
    format: "convax.session-challenge" as const,
    core,
    coreDigest: structuredDigest("convax.session-challenge-core", core),
    serviceSignature: signature,
  }
}

function credential() {
  const source = challenge()
  const core = {
    format: "convax.session-credential-core" as const,
    projectId,
    projectEpoch: source.core.projectEpoch,
    membershipEpoch: source.core.membershipEpoch,
    membershipSequence: parseUint64("1"),
    membershipSnapshotDigest: source.core.membershipSnapshotDigest,
    registrySequence: parseUint64("1"),
    registryRootDigest: digest("3"),
    memberId,
    memberAuthorizationEpoch: id(9),
    role: "editor" as const,
    replicaId,
    actorId: actor,
    replicaAuthorizationEpoch: id(10),
    replicaSigningPublicKey: publicKey,
    editState: "active-editor" as const,
    sessionId: source.core.sessionId,
    leaseId: source.core.leaseId,
    peerId,
    sessionSigningPublicKey: publicKey,
    sessionChallengeDigest: source.coreDigest,
    sessionProofDigest: digest("4"),
    issuedAtUnixMs: parseUint64("2000"),
    expiresAtUnixMs: parseUint64("902000"),
    protocolDigest: source.core.protocolDigest,
    schemaDigest: digest("5"),
    validationArtifactSetDigest: digest("6"),
    trustBundleDigest: source.core.trustBundleDigest,
    serviceKeyPurpose: "membership" as const,
    serviceKeyId: "membership-1",
  }
  return {
    format: "convax.session-credential" as const,
    core,
    coreDigest: structuredDigest("convax.session-credential-core", core),
    serviceSignature: signature,
  }
}

function directory(peers: readonly ActivePeerDirectoryEntry[]) {
  const source = credential()
  const core = {
    format: "convax.active-peer-directory-core" as const,
    projectId,
    projectEpoch: source.core.projectEpoch,
    membershipEpoch: source.core.membershipEpoch,
    membershipSnapshotDigest: source.core.membershipSnapshotDigest,
    directorySequence: parseUint64("1"),
    peers,
    issuedAtUnixMs: parseUint64("3000"),
    expiresAtUnixMs: parseUint64("33000"),
    protocolDigest: source.core.protocolDigest,
    trustBundleDigest: source.core.trustBundleDigest,
    serviceKeyPurpose: "rendezvous" as const,
    serviceKeyId: "rendezvous-1",
  }
  return {
    format: "convax.active-peer-directory" as const,
    core,
    coreDigest: structuredDigest("convax.active-peer-directory-core", core),
    serviceSignature: signature,
  }
}

const directoryEntry: ActivePeerDirectoryEntry = {
  credentialDigest: credential().coreDigest,
  memberId,
  replicaId,
  actorId: actor,
  role: "editor",
  editState: "active-editor",
  peerId,
  leaseId: id(8),
}

describe("Control artifact codecs", () => {
  test("closes challenge, credential, directory, and ticket core digests", () => {
    expect(parseSessionChallenge(challenge())).toEqual(challenge())
    expect(parseSessionCredential(credential())).toEqual(credential())
    expect(parseActivePeerDirectory(directory([directoryEntry]))).toEqual(directory([directoryEntry]))

    const requestDigest = digest("7")
    const core = {
      format: "convax.peer-freshness-ticket-core" as const,
      ticketId: id(11),
      requestDigest,
      connectionId: id(12),
      projectId,
      projectEpoch: id(2),
      membershipEpoch: id(3),
      membershipSnapshotDigest: digest("1"),
      requesterCredentialDigest: credential().coreDigest,
      responderCredentialDigest: digest("8"),
      requesterPeerId: peerId,
      responderPeerId: parsePeerId("peer_aeaqcaibaeaqcaibaeaqcaibae"),
      issuedAtUnixMs: parseUint64("4000"),
      expiresAtUnixMs: parseUint64("64000"),
      channelContractDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.channelContractDigest),
      protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest),
      trustBundleDigest: digest("2"),
      serviceKeyPurpose: "rendezvous" as const,
      serviceKeyId: "rendezvous-1",
    }
    const ticket = {
      format: "convax.peer-freshness-ticket" as const,
      core,
      coreDigest: structuredDigest("convax.peer-freshness-ticket-core", core),
      serviceSignature: signature,
    }
    expect(parsePeerFreshnessTicket(ticket)).toEqual(ticket)
  })

  test("rejects a tampered core, unknown field, and duplicate directory identity", () => {
    const source = challenge()
    expect(() => parseSessionChallenge({ ...source, core: { ...source.core, peerId: parsePeerId("peer_aeaqcaibaeaqcaibaeaqcaibae") } })).toThrow("core digest")
    expect(() => parseSessionCredential({ ...credential(), injected: true })).toThrow("unknown or missing")
    expect(() => parseActivePeerDirectory(directory([directoryEntry, directoryEntry]))).toThrow("duplicate")
  })

  test("selects the pinned service key by purpose and key id and verifies exact digest bytes", async () => {
    let verifiedDigest: Uint8Array | null = null
    const verifier = createPinnedControlServiceVerifier({
      keys: [
        { purpose: "membership", serviceKeyId: "membership-1", publicKey },
        { purpose: "rendezvous", serviceKeyId: "rendezvous-1", publicKey },
      ],
      verifier: {
        async verifyDigest(input) {
          verifiedDigest = input.purposeDigestBytes
          return { ok: true }
        },
      },
    })
    const source = parseSessionChallenge(challenge())
    expect(await verifier.verify({
      purpose: source.core.serviceKeyPurpose,
      serviceKeyId: source.core.serviceKeyId,
      coreDigest: source.coreDigest,
      serviceSignature: source.serviceSignature,
    })).toBe(true)
    expect(verifiedDigest).toHaveLength(32)
    expect(await verifier.verify({
      purpose: "rendezvous",
      serviceKeyId: source.core.serviceKeyId,
      coreDigest: source.coreDigest,
      serviceSignature: source.serviceSignature,
    })).toBe(false)
  })
})
