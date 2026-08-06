import {
  assertBoundedNfcString,
  assertDenseArray,
  assertExactKeys,
  decodeBase64url,
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
  type Digest,
  type PublicKey,
  type Signature,
} from "@convax/collaboration"
import type { Ed25519Verifier } from "./ed25519-verifier"
import type {
  ActivePeerDirectoryEntry,
  ActivePeerDirectory,
  CollaborationEditState,
  CollaborationRole,
  CollaborationServiceKeyPurpose,
  PeerFreshnessTicket,
  PeerTicketRequestCore,
  SessionChallenge,
  SessionCredential,
  SessionProofCore,
} from "./control-contracts"

const MAX_ACTIVE_PEERS = 512
const MAX_SERVICE_TRUST_KEYS = 32

/** One immutable service key selected from the configured, digest-bound trust bundle. */
export interface PinnedControlServiceKey {
  readonly purpose: CollaborationServiceKeyPurpose
  readonly serviceKeyId: string
  readonly publicKey: PublicKey
}

export interface PinnedControlServiceVerifier {
  verify(input: {
    readonly purpose: CollaborationServiceKeyPurpose
    readonly serviceKeyId: string
    readonly coreDigest: Digest
    readonly serviceSignature: Signature
  }): Promise<boolean>
}

/**
 * Closes service verification over exact purpose/key-id pins. A peer id is never
 * accepted as a key selector or principal.
 */
export function createPinnedControlServiceVerifier(input: {
  readonly keys: readonly PinnedControlServiceKey[]
  readonly verifier: Ed25519Verifier
}): PinnedControlServiceVerifier {
  assertDenseArray(input.keys, "control service trust keys")
  if (input.keys.length === 0 || input.keys.length > MAX_SERVICE_TRUST_KEYS) {
    throw new TypeError("Control service trust keys must contain 1..32 entries")
  }
  const keys = new Map<string, PublicKey>()
  for (const value of input.keys) {
    assertExactKeys(value, ["purpose", "serviceKeyId", "publicKey"], "control service trust key")
    const purpose = parsePurpose(value.purpose)
    assertBoundedNfcString(value.serviceKeyId, 1, 128, "control service key id")
    const publicKey = parsePublicKey(value.publicKey)
    const selector = `${purpose}\u0000${value.serviceKeyId}`
    if (keys.has(selector)) throw new TypeError("Control service trust keys contain a duplicate purpose/key id")
    keys.set(selector, publicKey)
  }
  return Object.freeze({
    async verify(value: {
      readonly purpose: CollaborationServiceKeyPurpose
      readonly serviceKeyId: string
      readonly coreDigest: Digest
      readonly serviceSignature: Signature
    }) {
      const purpose = parsePurpose(value.purpose)
      assertBoundedNfcString(value.serviceKeyId, 1, 128, "control service key id")
      const publicKey = keys.get(`${purpose}\u0000${value.serviceKeyId}`)
      if (!publicKey) return false
      const result = await input.verifier.verifyDigest({
        publicKeyBytes: decodeBase64url(publicKey),
        signatureBytes: decodeBase64url(parseSignature(value.serviceSignature)),
        purposeDigestBytes: digestBytes(parseDigest(value.coreDigest)),
      })
      return result.ok
    },
  })
}

export function parseSessionChallenge(value: unknown): SessionChallenge {
  assertExactKeys(value, ["format", "core", "coreDigest", "serviceSignature"], "session challenge")
  if (value.format !== "convax.session-challenge") invalid("Session challenge format is invalid")
  assertExactKeys(value.core, [
    "format", "challengeId", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest",
    "memberId", "replicaId", "actorId", "expectedReplicaSessionCounter", "serverNonce", "sessionId", "leaseId",
    "peerId", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose",
    "serviceKeyId",
  ], "session challenge core")
  if (value.core.format !== "convax.session-challenge-core") invalid("Session challenge core format is invalid")
  if (value.core.serviceKeyPurpose !== "membership") invalid("Session challenge service key purpose is invalid")
  assertBoundedNfcString(value.core.serviceKeyId, 1, 128, "session challenge service key id")
  const core = Object.freeze({
    format: "convax.session-challenge-core" as const,
    challengeId: parseId128(value.core.challengeId),
    projectId: parseProjectId(value.core.projectId),
    projectEpoch: parseId128(value.core.projectEpoch),
    membershipEpoch: parseId128(value.core.membershipEpoch),
    membershipSnapshotDigest: parseDigest(value.core.membershipSnapshotDigest),
    memberId: parseMemberId(value.core.memberId),
    replicaId: parseReplicaId(value.core.replicaId),
    actorId: parseActorId(value.core.actorId),
    expectedReplicaSessionCounter: parseUint64(value.core.expectedReplicaSessionCounter),
    serverNonce: parseId128(value.core.serverNonce),
    sessionId: parseSessionId(value.core.sessionId),
    leaseId: parseId128(value.core.leaseId),
    peerId: parsePeerId(value.core.peerId),
    issuedAtUnixMs: parseUint64(value.core.issuedAtUnixMs),
    expiresAtUnixMs: parseUint64(value.core.expiresAtUnixMs),
    protocolDigest: parseDigest(value.core.protocolDigest),
    trustBundleDigest: parseDigest(value.core.trustBundleDigest),
    serviceKeyPurpose: "membership" as const,
    serviceKeyId: value.core.serviceKeyId,
  })
  return closeServiceArtifact(
    value,
    "convax.session-challenge",
    "convax.session-challenge-core",
    core,
  )
}

export function parseSessionCredential(value: unknown): SessionCredential {
  assertExactKeys(value, ["format", "core", "coreDigest", "serviceSignature"], "session credential")
  if (value.format !== "convax.session-credential") invalid("Session credential format is invalid")
  assertExactKeys(value.core, [
    "format", "projectId", "projectEpoch", "membershipEpoch", "membershipSequence", "membershipSnapshotDigest",
    "registrySequence", "registryRootDigest", "memberId", "memberAuthorizationEpoch", "role", "replicaId", "actorId",
    "replicaAuthorizationEpoch", "replicaSigningPublicKey", "editState", "sessionId", "leaseId", "peerId",
    "sessionSigningPublicKey", "sessionChallengeDigest", "sessionProofDigest", "issuedAtUnixMs", "expiresAtUnixMs",
    "protocolDigest", "schemaDigest", "validationArtifactSetDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId",
  ], "session credential core")
  if (value.core.format !== "convax.session-credential-core") invalid("Session credential core format is invalid")
  if (value.core.serviceKeyPurpose !== "membership") invalid("Session credential service key purpose is invalid")
  assertBoundedNfcString(value.core.serviceKeyId, 1, 128, "session credential service key id")
  const core = Object.freeze({
    format: "convax.session-credential-core" as const,
    projectId: parseProjectId(value.core.projectId),
    projectEpoch: parseId128(value.core.projectEpoch),
    membershipEpoch: parseId128(value.core.membershipEpoch),
    membershipSequence: parseUint64(value.core.membershipSequence),
    membershipSnapshotDigest: parseDigest(value.core.membershipSnapshotDigest),
    registrySequence: parseUint64(value.core.registrySequence),
    registryRootDigest: parseDigest(value.core.registryRootDigest),
    memberId: parseMemberId(value.core.memberId),
    memberAuthorizationEpoch: parseId128(value.core.memberAuthorizationEpoch),
    role: parseRole(value.core.role),
    replicaId: parseReplicaId(value.core.replicaId),
    actorId: parseActorId(value.core.actorId),
    replicaAuthorizationEpoch: parseId128(value.core.replicaAuthorizationEpoch),
    replicaSigningPublicKey: parsePublicKey(value.core.replicaSigningPublicKey),
    editState: parseEditState(value.core.editState),
    sessionId: parseSessionId(value.core.sessionId),
    leaseId: parseId128(value.core.leaseId),
    peerId: parsePeerId(value.core.peerId),
    sessionSigningPublicKey: parsePublicKey(value.core.sessionSigningPublicKey),
    sessionChallengeDigest: parseDigest(value.core.sessionChallengeDigest),
    sessionProofDigest: parseDigest(value.core.sessionProofDigest),
    issuedAtUnixMs: parseUint64(value.core.issuedAtUnixMs),
    expiresAtUnixMs: parseUint64(value.core.expiresAtUnixMs),
    protocolDigest: parseDigest(value.core.protocolDigest),
    schemaDigest: parseDigest(value.core.schemaDigest),
    validationArtifactSetDigest: parseDigest(value.core.validationArtifactSetDigest),
    trustBundleDigest: parseDigest(value.core.trustBundleDigest),
    serviceKeyPurpose: "membership" as const,
    serviceKeyId: value.core.serviceKeyId,
  })
  return closeServiceArtifact(
    value,
    "convax.session-credential",
    "convax.session-credential-core",
    core,
  )
}

export function parseActivePeerDirectory(value: unknown): ActivePeerDirectory {
  assertExactKeys(value, ["format", "core", "coreDigest", "serviceSignature"], "active peer directory")
  if (value.format !== "convax.active-peer-directory") invalid("Active peer directory format is invalid")
  assertExactKeys(value.core, [
    "format", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest", "directorySequence",
    "peers", "issuedAtUnixMs", "expiresAtUnixMs", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId",
  ], "active peer directory core")
  if (value.core.format !== "convax.active-peer-directory-core") invalid("Active peer directory core format is invalid")
  if (value.core.serviceKeyPurpose !== "rendezvous") invalid("Active peer directory service key purpose is invalid")
  assertBoundedNfcString(value.core.serviceKeyId, 1, 128, "active peer directory service key id")
  assertDenseArray(value.core.peers, "active peer directory peers")
  if (value.core.peers.length > MAX_ACTIVE_PEERS) invalid("Active peer directory exceeds 512 entries")
  const peers = Object.freeze(value.core.peers.map(parseDirectoryEntry))
  assertDirectoryIdentityAndOrder(peers)
  const core = Object.freeze({
    format: "convax.active-peer-directory-core" as const,
    projectId: parseProjectId(value.core.projectId),
    projectEpoch: parseId128(value.core.projectEpoch),
    membershipEpoch: parseId128(value.core.membershipEpoch),
    membershipSnapshotDigest: parseDigest(value.core.membershipSnapshotDigest),
    directorySequence: parseUint64(value.core.directorySequence),
    peers,
    issuedAtUnixMs: parseUint64(value.core.issuedAtUnixMs),
    expiresAtUnixMs: parseUint64(value.core.expiresAtUnixMs),
    protocolDigest: parseDigest(value.core.protocolDigest),
    trustBundleDigest: parseDigest(value.core.trustBundleDigest),
    serviceKeyPurpose: "rendezvous" as const,
    serviceKeyId: value.core.serviceKeyId,
  })
  return closeServiceArtifact(
    value,
    "convax.active-peer-directory",
    "convax.active-peer-directory-core",
    core,
  )
}

export function parsePeerFreshnessTicket(value: unknown): PeerFreshnessTicket {
  assertExactKeys(value, ["format", "core", "coreDigest", "serviceSignature"], "peer freshness ticket")
  if (value.format !== "convax.peer-freshness-ticket") invalid("Peer freshness ticket format is invalid")
  assertExactKeys(value.core, [
    "format", "ticketId", "requestDigest", "connectionId", "projectId", "projectEpoch", "membershipEpoch",
    "membershipSnapshotDigest", "requesterCredentialDigest", "responderCredentialDigest", "requesterPeerId",
    "responderPeerId", "issuedAtUnixMs", "expiresAtUnixMs", "channelContractDigest", "protocolDigest",
    "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId",
  ], "peer freshness ticket core")
  if (value.core.format !== "convax.peer-freshness-ticket-core") invalid("Peer freshness ticket core format is invalid")
  if (value.core.serviceKeyPurpose !== "rendezvous") invalid("Peer freshness ticket service key purpose is invalid")
  assertBoundedNfcString(value.core.serviceKeyId, 1, 128, "peer freshness ticket service key id")
  const core = Object.freeze({
    format: "convax.peer-freshness-ticket-core" as const,
    ticketId: parseId128(value.core.ticketId),
    requestDigest: parseDigest(value.core.requestDigest),
    connectionId: parseId128(value.core.connectionId),
    projectId: parseProjectId(value.core.projectId),
    projectEpoch: parseId128(value.core.projectEpoch),
    membershipEpoch: parseId128(value.core.membershipEpoch),
    membershipSnapshotDigest: parseDigest(value.core.membershipSnapshotDigest),
    requesterCredentialDigest: parseDigest(value.core.requesterCredentialDigest),
    responderCredentialDigest: parseDigest(value.core.responderCredentialDigest),
    requesterPeerId: parsePeerId(value.core.requesterPeerId),
    responderPeerId: parsePeerId(value.core.responderPeerId),
    issuedAtUnixMs: parseUint64(value.core.issuedAtUnixMs),
    expiresAtUnixMs: parseUint64(value.core.expiresAtUnixMs),
    channelContractDigest: parseDigest(value.core.channelContractDigest),
    protocolDigest: parseDigest(value.core.protocolDigest),
    trustBundleDigest: parseDigest(value.core.trustBundleDigest),
    serviceKeyPurpose: "rendezvous" as const,
    serviceKeyId: value.core.serviceKeyId,
  })
  return closeServiceArtifact(
    value,
    "convax.peer-freshness-ticket",
    "convax.peer-freshness-ticket-core",
    core,
  )
}

export function sessionProofCoreDigest(core: SessionProofCore): Digest {
  return structuredDigest("convax.session-proof-core", core)
}

export function peerTicketRequestCoreDigest(core: PeerTicketRequestCore): Digest {
  return structuredDigest("convax.peer-ticket-request-core", core)
}

function parseDirectoryEntry(value: unknown): ActivePeerDirectoryEntry {
  assertExactKeys(value, [
    "credentialDigest", "memberId", "replicaId", "actorId", "role", "editState", "peerId", "leaseId",
  ], "active peer directory entry")
  return Object.freeze({
    credentialDigest: parseDigest(value.credentialDigest),
    memberId: parseMemberId(value.memberId),
    replicaId: parseReplicaId(value.replicaId),
    actorId: parseActorId(value.actorId),
    role: parseRole(value.role),
    editState: parseEditState(value.editState),
    peerId: parsePeerId(value.peerId),
    leaseId: parseId128(value.leaseId),
  })
}

function assertDirectoryIdentityAndOrder(peers: readonly ActivePeerDirectoryEntry[]): void {
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
  const CoreFormat extends string,
  const Core extends Readonly<Record<string, unknown>>,
>(
  value: Readonly<Record<string, unknown>>,
  format: Format,
  coreFormat: CoreFormat,
  core: Core,
): Readonly<{ format: Format; core: Core; coreDigest: Digest; serviceSignature: Signature }> {
  const coreDigest = parseDigest(value.coreDigest)
  if (structuredDigest(coreFormat, core) !== coreDigest) invalid(`${format} core digest is invalid`)
  return Object.freeze({
    format,
    core,
    coreDigest,
    serviceSignature: parseSignature(value.serviceSignature),
  })
}

function parseRole(value: unknown): CollaborationRole {
  if (value !== "viewer" && value !== "editor") invalid("Collaboration role is invalid")
  return value
}

function parseEditState(value: unknown): CollaborationEditState {
  if (value !== "none" && value !== "pending-editor" && value !== "active-editor") {
    invalid("Collaboration edit state is invalid")
  }
  return value
}

function parsePurpose(value: unknown): CollaborationServiceKeyPurpose {
  if (value !== "membership" && value !== "rendezvous") invalid("Control service key purpose is invalid")
  return value
}

function digestBytes(value: Digest): Uint8Array {
  const result = new Uint8Array(32)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

function invalid(message: string): never {
  throw new TypeError(message)
}
