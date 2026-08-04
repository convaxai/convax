import {
  assertBoundedNfcStringV2,
  assertDenseArrayV2,
  assertExactKeysV2,
  decodeBase64urlV2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parsePeerIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSessionIdV2,
  parseSignatureV2,
  parseUint64V2,
  structuredDigestV2,
  type DigestV2,
  type PublicKeyV2,
  type SignatureV2,
} from "@convax/collaboration"
import type { Ed25519VerifierV2 } from "./ed25519-verifier"
import type {
  ActivePeerDirectoryEntryV2,
  ActivePeerDirectoryV2,
  CollaborationEditStateV2,
  CollaborationRoleV2,
  CollaborationServiceKeyPurposeV2,
  PeerFreshnessTicketV2,
  PeerTicketRequestCoreV2,
  SessionChallengeV2,
  SessionCredentialV2,
  SessionProofCoreV2,
} from "./control-contracts"

const MAX_ACTIVE_PEERS = 512
const MAX_SERVICE_TRUST_KEYS = 32

/** One immutable service key selected from the configured, digest-bound trust bundle. */
export interface PinnedControlServiceKeyV2 {
  readonly purpose: CollaborationServiceKeyPurposeV2
  readonly serviceKeyId: string
  readonly publicKey: PublicKeyV2
}

export interface PinnedControlServiceVerifierV2 {
  verify(input: {
    readonly purpose: CollaborationServiceKeyPurposeV2
    readonly serviceKeyId: string
    readonly coreDigest: DigestV2
    readonly serviceSignature: SignatureV2
  }): Promise<boolean>
}

/**
 * Closes service verification over exact purpose/key-id pins. A peer id is never
 * accepted as a key selector or principal.
 */
export function createPinnedControlServiceVerifierV2(input: {
  readonly keys: readonly PinnedControlServiceKeyV2[]
  readonly verifier: Ed25519VerifierV2
}): PinnedControlServiceVerifierV2 {
  assertDenseArrayV2(input.keys, "control service trust keys")
  if (input.keys.length === 0 || input.keys.length > MAX_SERVICE_TRUST_KEYS) {
    throw new TypeError("Control service trust keys must contain 1..32 entries")
  }
  const keys = new Map<string, PublicKeyV2>()
  for (const value of input.keys) {
    assertExactKeysV2(value, ["purpose", "serviceKeyId", "publicKey"], "control service trust key")
    const purpose = parsePurpose(value.purpose)
    assertBoundedNfcStringV2(value.serviceKeyId, 1, 128, "control service key id")
    const publicKey = parsePublicKeyV2(value.publicKey)
    const selector = `${purpose}\u0000${value.serviceKeyId}`
    if (keys.has(selector)) throw new TypeError("Control service trust keys contain a duplicate purpose/key id")
    keys.set(selector, publicKey)
  }
  return Object.freeze({
    async verify(value: {
      readonly purpose: CollaborationServiceKeyPurposeV2
      readonly serviceKeyId: string
      readonly coreDigest: DigestV2
      readonly serviceSignature: SignatureV2
    }) {
      const purpose = parsePurpose(value.purpose)
      assertBoundedNfcStringV2(value.serviceKeyId, 1, 128, "control service key id")
      const publicKey = keys.get(`${purpose}\u0000${value.serviceKeyId}`)
      if (!publicKey) return false
      const result = await input.verifier.verifyDigest({
        publicKeyBytes: decodeBase64urlV2(publicKey),
        signatureBytes: decodeBase64urlV2(parseSignatureV2(value.serviceSignature)),
        purposeDigestBytes: digestBytes(parseDigestV2(value.coreDigest)),
      })
      return result.ok
    },
  })
}

export function parseSessionChallengeV2(value: unknown): SessionChallengeV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "serviceSignature"], "session challenge")
  if (value.format !== "convax.session-challenge/2") invalid("Session challenge format is invalid")
  assertExactKeysV2(value.core, [
    "format", "challengeId", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest",
    "memberId", "replicaId", "actorId", "expectedReplicaSessionCounter", "serverNonce", "sessionId", "leaseId",
    "peerId", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose",
    "serviceKeyId",
  ], "session challenge core")
  if (value.core.format !== "convax.session-challenge-core/2") invalid("Session challenge core format is invalid")
  if (value.core.serviceKeyPurpose !== "membership") invalid("Session challenge service key purpose is invalid")
  assertBoundedNfcStringV2(value.core.serviceKeyId, 1, 128, "session challenge service key id")
  const core = Object.freeze({
    format: "convax.session-challenge-core/2" as const,
    challengeId: parseId128V2(value.core.challengeId),
    projectId: parseProjectIdV2(value.core.projectId),
    projectEpoch: parseId128V2(value.core.projectEpoch),
    membershipEpoch: parseId128V2(value.core.membershipEpoch),
    membershipSnapshotDigest: parseDigestV2(value.core.membershipSnapshotDigest),
    memberId: parseMemberIdV2(value.core.memberId),
    replicaId: parseReplicaIdV2(value.core.replicaId),
    actorId: parseActorIdV2(value.core.actorId),
    expectedReplicaSessionCounter: parseUint64V2(value.core.expectedReplicaSessionCounter),
    serverNonce: parseId128V2(value.core.serverNonce),
    sessionId: parseSessionIdV2(value.core.sessionId),
    leaseId: parseId128V2(value.core.leaseId),
    peerId: parsePeerIdV2(value.core.peerId),
    issuedAtUnixMs: parseUint64V2(value.core.issuedAtUnixMs),
    expiresAtUnixMs: parseUint64V2(value.core.expiresAtUnixMs),
    protocolDigest: parseDigestV2(value.core.protocolDigest),
    trustBundleDigest: parseDigestV2(value.core.trustBundleDigest),
    serviceKeyPurpose: "membership" as const,
    serviceKeyId: value.core.serviceKeyId,
  })
  return closeServiceArtifact(
    value,
    "convax.session-challenge/2",
    "convax.session-challenge-core/2",
    core,
  )
}

export function parseSessionCredentialV2(value: unknown): SessionCredentialV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "serviceSignature"], "session credential")
  if (value.format !== "convax.session-credential/2") invalid("Session credential format is invalid")
  assertExactKeysV2(value.core, [
    "format", "projectId", "projectEpoch", "membershipEpoch", "membershipSequence", "membershipSnapshotDigest",
    "registrySequence", "registryRootDigest", "memberId", "memberAuthorizationEpoch", "role", "replicaId", "actorId",
    "replicaAuthorizationEpoch", "replicaSigningPublicKey", "editState", "sessionId", "leaseId", "peerId",
    "sessionSigningPublicKey", "sessionChallengeDigest", "sessionProofDigest", "issuedAtUnixMs", "expiresAtUnixMs",
    "protocolDigest", "schemaDigest", "validationArtifactSetDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId",
  ], "session credential core")
  if (value.core.format !== "convax.session-credential-core/2") invalid("Session credential core format is invalid")
  if (value.core.serviceKeyPurpose !== "membership") invalid("Session credential service key purpose is invalid")
  assertBoundedNfcStringV2(value.core.serviceKeyId, 1, 128, "session credential service key id")
  const core = Object.freeze({
    format: "convax.session-credential-core/2" as const,
    projectId: parseProjectIdV2(value.core.projectId),
    projectEpoch: parseId128V2(value.core.projectEpoch),
    membershipEpoch: parseId128V2(value.core.membershipEpoch),
    membershipSequence: parseUint64V2(value.core.membershipSequence),
    membershipSnapshotDigest: parseDigestV2(value.core.membershipSnapshotDigest),
    registrySequence: parseUint64V2(value.core.registrySequence),
    registryRootDigest: parseDigestV2(value.core.registryRootDigest),
    memberId: parseMemberIdV2(value.core.memberId),
    memberAuthorizationEpoch: parseId128V2(value.core.memberAuthorizationEpoch),
    role: parseRole(value.core.role),
    replicaId: parseReplicaIdV2(value.core.replicaId),
    actorId: parseActorIdV2(value.core.actorId),
    replicaAuthorizationEpoch: parseId128V2(value.core.replicaAuthorizationEpoch),
    replicaSigningPublicKey: parsePublicKeyV2(value.core.replicaSigningPublicKey),
    editState: parseEditState(value.core.editState),
    sessionId: parseSessionIdV2(value.core.sessionId),
    leaseId: parseId128V2(value.core.leaseId),
    peerId: parsePeerIdV2(value.core.peerId),
    sessionSigningPublicKey: parsePublicKeyV2(value.core.sessionSigningPublicKey),
    sessionChallengeDigest: parseDigestV2(value.core.sessionChallengeDigest),
    sessionProofDigest: parseDigestV2(value.core.sessionProofDigest),
    issuedAtUnixMs: parseUint64V2(value.core.issuedAtUnixMs),
    expiresAtUnixMs: parseUint64V2(value.core.expiresAtUnixMs),
    protocolDigest: parseDigestV2(value.core.protocolDigest),
    schemaDigest: parseDigestV2(value.core.schemaDigest),
    validationArtifactSetDigest: parseDigestV2(value.core.validationArtifactSetDigest),
    trustBundleDigest: parseDigestV2(value.core.trustBundleDigest),
    serviceKeyPurpose: "membership" as const,
    serviceKeyId: value.core.serviceKeyId,
  })
  return closeServiceArtifact(
    value,
    "convax.session-credential/2",
    "convax.session-credential-core/2",
    core,
  )
}

export function parseActivePeerDirectoryV2(value: unknown): ActivePeerDirectoryV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "serviceSignature"], "active peer directory")
  if (value.format !== "convax.active-peer-directory/2") invalid("Active peer directory format is invalid")
  assertExactKeysV2(value.core, [
    "format", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest", "directorySequence",
    "peers", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId",
  ], "active peer directory core")
  if (value.core.format !== "convax.active-peer-directory-core/2") invalid("Active peer directory core format is invalid")
  if (value.core.serviceKeyPurpose !== "rendezvous") invalid("Active peer directory service key purpose is invalid")
  assertBoundedNfcStringV2(value.core.serviceKeyId, 1, 128, "active peer directory service key id")
  assertDenseArrayV2(value.core.peers, "active peer directory peers")
  if (value.core.peers.length > MAX_ACTIVE_PEERS) invalid("Active peer directory exceeds 512 entries")
  const peers = Object.freeze(value.core.peers.map(parseDirectoryEntry))
  assertDirectoryIdentityAndOrder(peers)
  const core = Object.freeze({
    format: "convax.active-peer-directory-core/2" as const,
    projectId: parseProjectIdV2(value.core.projectId),
    projectEpoch: parseId128V2(value.core.projectEpoch),
    membershipEpoch: parseId128V2(value.core.membershipEpoch),
    membershipSnapshotDigest: parseDigestV2(value.core.membershipSnapshotDigest),
    directorySequence: parseUint64V2(value.core.directorySequence),
    peers,
    issuedAtUnixMs: parseUint64V2(value.core.issuedAtUnixMs),
    expiresAtUnixMs: parseUint64V2(value.core.expiresAtUnixMs),
    protocolDigest: parseDigestV2(value.core.protocolDigest),
    trustBundleDigest: parseDigestV2(value.core.trustBundleDigest),
    serviceKeyPurpose: "rendezvous" as const,
    serviceKeyId: value.core.serviceKeyId,
  })
  return closeServiceArtifact(
    value,
    "convax.active-peer-directory/2",
    "convax.active-peer-directory-core/2",
    core,
  )
}

export function parsePeerFreshnessTicketV2(value: unknown): PeerFreshnessTicketV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "serviceSignature"], "peer freshness ticket")
  if (value.format !== "convax.peer-freshness-ticket/2") invalid("Peer freshness ticket format is invalid")
  assertExactKeysV2(value.core, [
    "format", "ticketId", "requestDigest", "connectionId", "projectId", "projectEpoch", "membershipEpoch",
    "membershipSnapshotDigest", "requesterCredentialDigest", "responderCredentialDigest", "requesterPeerId",
    "responderPeerId", "issuedAtUnixMs", "expiresAtUnixMs", "channelContractDigest", "protocolDigest",
    "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId",
  ], "peer freshness ticket core")
  if (value.core.format !== "convax.peer-freshness-ticket-core/2") invalid("Peer freshness ticket core format is invalid")
  if (value.core.serviceKeyPurpose !== "rendezvous") invalid("Peer freshness ticket service key purpose is invalid")
  assertBoundedNfcStringV2(value.core.serviceKeyId, 1, 128, "peer freshness ticket service key id")
  const core = Object.freeze({
    format: "convax.peer-freshness-ticket-core/2" as const,
    ticketId: parseId128V2(value.core.ticketId),
    requestDigest: parseDigestV2(value.core.requestDigest),
    connectionId: parseId128V2(value.core.connectionId),
    projectId: parseProjectIdV2(value.core.projectId),
    projectEpoch: parseId128V2(value.core.projectEpoch),
    membershipEpoch: parseId128V2(value.core.membershipEpoch),
    membershipSnapshotDigest: parseDigestV2(value.core.membershipSnapshotDigest),
    requesterCredentialDigest: parseDigestV2(value.core.requesterCredentialDigest),
    responderCredentialDigest: parseDigestV2(value.core.responderCredentialDigest),
    requesterPeerId: parsePeerIdV2(value.core.requesterPeerId),
    responderPeerId: parsePeerIdV2(value.core.responderPeerId),
    issuedAtUnixMs: parseUint64V2(value.core.issuedAtUnixMs),
    expiresAtUnixMs: parseUint64V2(value.core.expiresAtUnixMs),
    channelContractDigest: parseDigestV2(value.core.channelContractDigest),
    protocolDigest: parseDigestV2(value.core.protocolDigest),
    trustBundleDigest: parseDigestV2(value.core.trustBundleDigest),
    serviceKeyPurpose: "rendezvous" as const,
    serviceKeyId: value.core.serviceKeyId,
  })
  return closeServiceArtifact(
    value,
    "convax.peer-freshness-ticket/2",
    "convax.peer-freshness-ticket-core/2",
    core,
  )
}

export function sessionProofCoreDigestV2(core: SessionProofCoreV2): DigestV2 {
  return structuredDigestV2("convax.session-proof-core/2", core)
}

export function peerTicketRequestCoreDigestV2(core: PeerTicketRequestCoreV2): DigestV2 {
  return structuredDigestV2("convax.peer-ticket-request-core/2", core)
}

function parseDirectoryEntry(value: unknown): ActivePeerDirectoryEntryV2 {
  assertExactKeysV2(value, [
    "credentialDigest", "memberId", "replicaId", "actorId", "role", "editState", "peerId", "leaseId",
  ], "active peer directory entry")
  return Object.freeze({
    credentialDigest: parseDigestV2(value.credentialDigest),
    memberId: parseMemberIdV2(value.memberId),
    replicaId: parseReplicaIdV2(value.replicaId),
    actorId: parseActorIdV2(value.actorId),
    role: parseRole(value.role),
    editState: parseEditState(value.editState),
    peerId: parsePeerIdV2(value.peerId),
    leaseId: parseId128V2(value.leaseId),
  })
}

function assertDirectoryIdentityAndOrder(peers: readonly ActivePeerDirectoryEntryV2[]): void {
  const credentials = new Set<string>()
  const replicas = new Set<string>()
  const peerIds = new Set<string>()
  const leases = new Set<string>()
  for (let index = 0; index < peers.length; index += 1) {
    const peer = peers[index]!
    if (
      credentials.has(peer.credentialDigest)
      || replicas.has(peer.replicaId)
      || peerIds.has(peer.peerId)
      || leases.has(peer.leaseId)
    ) invalid("Active peer directory contains duplicate credential, replica, peer, or lease identity")
    credentials.add(peer.credentialDigest)
    replicas.add(peer.replicaId)
    peerIds.add(peer.peerId)
    leases.add(peer.leaseId)
    if (index > 0 && peers[index - 1]!.replicaId >= peer.replicaId) {
      invalid("Active peer directory entries are not sorted by decoded replica id")
    }
  }
}

function closeServiceArtifact<
  const Format extends string,
  const CoreFormat extends `${string}/2`,
  const Core extends Readonly<Record<string, unknown>>,
>(
  value: Readonly<Record<string, unknown>>,
  format: Format,
  coreFormat: CoreFormat,
  core: Core,
): Readonly<{ format: Format; core: Core; coreDigest: DigestV2; serviceSignature: SignatureV2 }> {
  const coreDigest = parseDigestV2(value.coreDigest)
  if (structuredDigestV2(coreFormat, core) !== coreDigest) invalid(`${format} core digest is invalid`)
  return Object.freeze({
    format,
    core,
    coreDigest,
    serviceSignature: parseSignatureV2(value.serviceSignature),
  })
}

function parseRole(value: unknown): CollaborationRoleV2 {
  if (value !== "viewer" && value !== "editor") invalid("Collaboration role is invalid")
  return value
}

function parseEditState(value: unknown): CollaborationEditStateV2 {
  if (value !== "none" && value !== "pending-editor" && value !== "active-editor") {
    invalid("Collaboration edit state is invalid")
  }
  return value
}

function parsePurpose(value: unknown): CollaborationServiceKeyPurposeV2 {
  if (value !== "membership" && value !== "rendezvous") invalid("Control service key purpose is invalid")
  return value
}

function digestBytes(value: DigestV2): Uint8Array {
  const result = new Uint8Array(32)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

function invalid(message: string): never {
  throw new TypeError(message)
}
