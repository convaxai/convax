import {
  assertExactKeys,
  encodeBase64url,
  incrementUint64,
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
  uint64ToBigInt,
  type ActorId,
  type Digest,
  type Id128,
  type MemberId,
  type PeerId,
  type ProjectId,
  type PublicKey,
  type ReplicaId,
  type Signature,
  type Uint64,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES,
  type ActivePeerDirectoryCore,
  type ActivePeerDirectory,
  type CollaborationEditState,
  type CollaborationRole,
  type PeerFreshnessTicketCore,
  type PeerFreshnessTicket,
  type PeerTicketRequest,
  type SessionChallengeCore,
  type SessionChallenge,
  type SessionCredentialCore,
  type SessionCredential,
  type SessionProof,
} from "@convax/project/collaboration-protocol"
import type { AtomicControlStateStore, ControlClock, ControlRandomSource } from "./contracts"
import type { CollaborationTeamAuthorityStateV2 } from "./membership-service"
import type { CollaborationMetadataControlStateV2 } from "./metadata-control-service"

const SESSION_CHALLENGE_TTL_MS = 60_000n
const SESSION_CREDENTIAL_TTL_MS = 15n * 60_000n
const DIRECTORY_TTL_MS = 30_000n
const TICKET_TTL_MS = 60_000n
const MAX_PENDING_CHALLENGES = 4
const MAX_DIRECTORY_PEERS = 512

export interface CollaborationReplicaSeedV2 {
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly replicaAuthorizationEpoch: Id128
  readonly replicaSigningPublicKey: PublicKey
  readonly editState: CollaborationEditState
  readonly sessionCounter: Uint64
  readonly active: boolean
}

export interface CollaborationMemberSeedV2 {
  readonly memberId: MemberId
  readonly memberAuthorizationEpoch: Id128
  readonly role: CollaborationRole
  readonly active: boolean
  readonly replicas: readonly CollaborationReplicaSeedV2[]
}

export interface CollaborationProjectSeedV2 {
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSequence: Uint64
  readonly membershipSnapshotDigest: Digest
  readonly registrySequence: Uint64
  readonly registryRootDigest: Digest
  readonly schemaDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly trustBundleDigest: Digest
  readonly members: readonly CollaborationMemberSeedV2[]
}

export interface ControlDigestSignaturePortV2 {
  serviceKeyId(purpose: "membership" | "rendezvous" | "registry-cutoff"): string
  signServiceDigest(purpose: "membership" | "rendezvous" | "registry-cutoff", digest: Digest): Promise<Signature>
  verifyPublicKeyDigest(publicKey: PublicKey, digest: Digest, signature: Signature): Promise<boolean>
}

declare const sessionChallengeAuthorizationBrandV2: unique symbol

export interface SessionChallengeAuthorizationV2 {
  readonly [sessionChallengeAuthorizationBrandV2]: true
}

export interface SessionChallengeAuthorizationRequestV2 {
  readonly projectId: ProjectId
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly evidence: unknown
}

export interface SessionChallengeAuthorizationFactoryV2 {
  authorize(input: SessionChallengeAuthorizationRequestV2): Promise<SessionChallengeAuthorizationV2 | "rejected">
}

const liveSessionChallengeAuthorizations = new WeakMap<object, Readonly<{
  projectId: ProjectId
  memberId: MemberId
  replicaId: ReplicaId
}>>()

declare const sessionDirectoryAuthorizationBrandV2: unique symbol

export interface SessionDirectoryAuthorizationV2 {
  readonly [sessionDirectoryAuthorizationBrandV2]: true
}

export interface SessionDirectoryAuthorizationRequestV2 {
  readonly projectId: ProjectId
  readonly credentialDigest: Digest
  readonly evidence: unknown
}

export interface SessionDirectoryAuthorizationFactoryV2 {
  authorize(input: SessionDirectoryAuthorizationRequestV2): Promise<SessionDirectoryAuthorizationV2 | "rejected">
}

const liveSessionDirectoryAuthorizations = new WeakMap<object, Readonly<{
  projectId: ProjectId
  credentialDigest: Digest
}>>()

/** Adapter-owned authentication is converted into one non-structural call capability. */
export function createSessionChallengeAuthorizationFactoryV2(verifier: {
  verify(input: SessionChallengeAuthorizationRequestV2): Promise<boolean>
}): SessionChallengeAuthorizationFactoryV2 {
  return Object.freeze({
    async authorize(input: SessionChallengeAuthorizationRequestV2) {
      const normalized = Object.freeze({
        projectId: parseProjectId(input.projectId),
        memberId: parseMemberId(input.memberId),
        replicaId: parseReplicaId(input.replicaId),
      })
      if (!await verifier.verify({ ...normalized, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as SessionChallengeAuthorizationV2
      liveSessionChallengeAuthorizations.set(capability, normalized)
      return capability
    },
  })
}

export function createSessionDirectoryAuthorizationFactoryV2(verifier: {
  verify(input: SessionDirectoryAuthorizationRequestV2): Promise<boolean>
}): SessionDirectoryAuthorizationFactoryV2 {
  return Object.freeze({
    async authorize(input: SessionDirectoryAuthorizationRequestV2) {
      const normalized = Object.freeze({
        projectId: parseProjectId(input.projectId),
        credentialDigest: parseDigest(input.credentialDigest),
      })
      if (!await verifier.verify({ ...normalized, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as SessionDirectoryAuthorizationV2
      liveSessionDirectoryAuthorizations.set(capability, normalized)
      return capability
    },
  })
}

interface SessionChallengeRecordV2 {
  readonly challenge: SessionChallenge
  readonly consumedProofDigest: Digest | null
}

interface SessionRecordV2 {
  readonly credential: SessionCredential
  readonly proofDigest: Digest
  readonly closed: boolean
}

interface TicketRecordV2 {
  readonly requestId: Id128
  readonly requestDigest: Digest
  readonly ticket: PeerFreshnessTicket
}

export interface CollaborationControlProjectStateV2 {
  readonly format: "convax.control-project-state"
  readonly seed: CollaborationProjectSeedV2
  readonly challenges: readonly SessionChallengeRecordV2[]
  readonly sessions: readonly SessionRecordV2[]
  readonly tickets: readonly TicketRecordV2[]
  readonly directorySequence: Uint64
  readonly team: CollaborationTeamAuthorityStateV2 | null
  readonly metadata: CollaborationMetadataControlStateV2 | null
}

export class CollaborationControlServiceErrorV2 extends Error {
  constructor(
    readonly code:
      | "capacity-exceeded"
      | "equivocation"
      | "expired"
      | "invalid-proof"
      | "not-active"
      | "not-found"
      | "project-exists"
      | "stale-counter",
    message: string,
  ) {
    super(message)
    this.name = "CollaborationControlServiceErrorV2"
  }
}

export class CollaborationRendezvousServiceV2 {
  constructor(
    private readonly store: AtomicControlStateStore<CollaborationControlProjectStateV2>,
    private readonly clock: ControlClock,
    private readonly random: ControlRandomSource,
    private readonly signatures: ControlDigestSignaturePortV2,
  ) {}

  async provisionProject(seedInput: CollaborationProjectSeedV2): Promise<void> {
    const seed = normalizeSeed(seedInput)
    await this.store.transact(seed.projectId, (transaction) => {
      if (transaction.read() !== null) fail("project-exists", "Collaboration Project is already provisioned")
      transaction.write({
        format: "convax.control-project-state",
        seed,
        challenges: [],
        sessions: [],
        tickets: [],
        directorySequence: parseUint64("0"),
        team: null,
        metadata: null,
      })
    })
  }

  async issueSessionChallenge(input: {
    readonly projectId: ProjectId
    readonly memberId: MemberId
    readonly replicaId: ReplicaId
  }, authorization: SessionChallengeAuthorizationV2): Promise<SessionChallenge> {
    const projectId = parseProjectId(input.projectId)
    const memberId = parseMemberId(input.memberId)
    const replicaId = parseReplicaId(input.replicaId)
    const authority = liveSessionChallengeAuthorizations.get(authorization)
    if (
      !authority
      || authority.projectId !== projectId
      || authority.memberId !== memberId
      || authority.replicaId !== replicaId
    ) fail("invalid-proof", "A live exact replica pre-proof capability is required")
    liveSessionChallengeAuthorizations.delete(authorization)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireState(transaction.read())
      const { member, replica } = requireActiveReplica(state.seed, memberId, replicaId)
      const now = nowU64(this.clock)
      const liveChallenges = state.challenges.filter((record) =>
        record.consumedProofDigest === null && uint64ToBigInt(record.challenge.core.expiresAtUnixMs) > uint64ToBigInt(now)
      )
      const sameReplica = liveChallenges.filter((record) => record.challenge.core.replicaId === replicaId)
      if (sameReplica.length >= MAX_PENDING_CHALLENGES) fail("capacity-exceeded", "Replica has four pending session challenges")
      const core: SessionChallengeCore = Object.freeze({
        format: "convax.session-challenge-core",
        challengeId: this.randomId128(),
        projectId: state.seed.projectId,
        projectEpoch: state.seed.projectEpoch,
        membershipEpoch: state.seed.membershipEpoch,
        membershipSnapshotDigest: state.seed.membershipSnapshotDigest,
        memberId: member.memberId,
        replicaId: replica.replicaId,
        actorId: replica.actorId,
        expectedReplicaSessionCounter: incrementUint64(replica.sessionCounter),
        serverNonce: this.randomId128(),
        sessionId: this.randomId128() as SessionChallengeCore["sessionId"],
        leaseId: this.randomId128(),
        peerId: this.randomPeerId(),
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, SESSION_CHALLENGE_TTL_MS),
        protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest),
        trustBundleDigest: state.seed.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: requireServiceKeyId(this.signatures.serviceKeyId("membership")),
      })
      const coreDigest = structuredDigest("convax.session-challenge-core", core)
      const challenge: SessionChallenge = Object.freeze({
        format: "convax.session-challenge",
        core,
        coreDigest,
        serviceSignature: parseSignature(await this.signatures.signServiceDigest("membership", coreDigest)),
      })
      transaction.write({
        ...state,
        challenges: [...liveChallenges, { challenge, consumedProofDigest: null }],
      })
      return challenge
    })
  }

  async issueSessionCredential(proofInput: SessionProof): Promise<SessionCredential> {
    const proof = normalizeSessionProof(proofInput)
    return this.store.transact(proof.core.projectId, async (transaction) => {
      const state = requireState(transaction.read())
      const { member, replica } = requireActiveReplica(state.seed, proof.core.memberId, proof.core.replicaId)
      const now = nowU64(this.clock)
      const prior = state.sessions.find((record) => record.credential.core.sessionId === proof.core.sessionId)
      if (prior) {
        if (prior.proofDigest !== proof.coreDigest) fail("equivocation", "Session id was reused with another proof")
        return prior.credential
      }
      const challengeIndex = state.challenges.findIndex((record) => record.challenge.coreDigest === proof.core.challengeDigest)
      if (challengeIndex < 0) fail("not-found", "Session challenge was not found")
      const challengeRecord = state.challenges[challengeIndex]!
      if (challengeRecord.consumedProofDigest !== null) fail("equivocation", "Session challenge was already consumed")
      const challenge = challengeRecord.challenge.core
      if (uint64ToBigInt(challenge.expiresAtUnixMs) <= uint64ToBigInt(now)) fail("expired", "Session challenge expired")
      assertProofBinding(proof, challenge, state.seed, member, replica)
      if (proof.core.replicaSessionCounter !== incrementUint64(replica.sessionCounter)) {
        fail("stale-counter", "Replica session counter is stale")
      }
      const maxExpiry = addU64(now, SESSION_CREDENTIAL_TTL_MS)
      if (
        uint64ToBigInt(proof.core.requestedExpiresAtUnixMs) <= uint64ToBigInt(now)
        || uint64ToBigInt(proof.core.requestedExpiresAtUnixMs) > uint64ToBigInt(maxExpiry)
      ) fail("expired", "Requested session expiry is outside the active lease window")
      if (!await this.signatures.verifyPublicKeyDigest(replica.replicaSigningPublicKey, proof.coreDigest, proof.replicaSignature)) {
        fail("invalid-proof", "Replica signature is invalid")
      }
      const core: SessionCredentialCore = Object.freeze({
        format: "convax.session-credential-core",
        projectId: state.seed.projectId,
        projectEpoch: state.seed.projectEpoch,
        membershipEpoch: state.seed.membershipEpoch,
        membershipSequence: state.seed.membershipSequence,
        membershipSnapshotDigest: state.seed.membershipSnapshotDigest,
        registrySequence: state.seed.registrySequence,
        registryRootDigest: state.seed.registryRootDigest,
        memberId: member.memberId,
        memberAuthorizationEpoch: member.memberAuthorizationEpoch,
        role: member.role,
        replicaId: replica.replicaId,
        actorId: replica.actorId,
        replicaAuthorizationEpoch: replica.replicaAuthorizationEpoch,
        replicaSigningPublicKey: replica.replicaSigningPublicKey,
        editState: replica.editState,
        sessionId: proof.core.sessionId,
        leaseId: proof.core.leaseId,
        peerId: proof.core.peerId,
        sessionSigningPublicKey: proof.core.sessionSigningPublicKey,
        sessionChallengeDigest: proof.core.challengeDigest,
        sessionProofDigest: proof.coreDigest,
        issuedAtUnixMs: now,
        expiresAtUnixMs: proof.core.requestedExpiresAtUnixMs,
        protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest),
        schemaDigest: state.seed.schemaDigest,
        validationArtifactSetDigest: state.seed.validationArtifactSetDigest,
        trustBundleDigest: state.seed.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: requireServiceKeyId(this.signatures.serviceKeyId("membership")),
      })
      const coreDigest = structuredDigest("convax.session-credential-core", core)
      const credential: SessionCredential = Object.freeze({
        format: "convax.session-credential",
        core,
        coreDigest,
        serviceSignature: parseSignature(await this.signatures.signServiceDigest("membership", coreDigest)),
      })
      const nextMembers = state.seed.members.map((candidate) => candidate.memberId !== member.memberId ? candidate : {
        ...candidate,
        replicas: candidate.replicas.map((value) => value.replicaId !== replica.replicaId ? value : {
          ...value,
          sessionCounter: proof.core.replicaSessionCounter,
        }),
      })
      const challenges = state.challenges.map((record, index) => index !== challengeIndex ? record : {
        ...record,
        consumedProofDigest: proof.coreDigest,
      })
      const sessions = state.sessions.map((record) => record.credential.core.replicaId === replica.replicaId
        ? { ...record, closed: true }
        : record)
      transaction.write({
        ...state,
        seed: { ...state.seed, members: nextMembers },
        challenges,
        sessions: [...sessions, { credential, proofDigest: proof.coreDigest, closed: false }],
      })
      return credential
    })
  }

  async getActivePeerDirectory(
    projectIdInput: ProjectId,
    authorization: SessionDirectoryAuthorizationV2,
  ): Promise<ActivePeerDirectory> {
    const projectId = parseProjectId(projectIdInput)
    const authority = liveSessionDirectoryAuthorizations.get(authorization)
    if (!authority || authority.projectId !== projectId) {
      fail("invalid-proof", "A live current-session directory capability is required")
    }
    liveSessionDirectoryAuthorizations.delete(authorization)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireState(transaction.read())
      const now = nowU64(this.clock)
      requireLiveSession(state, authority.credentialDigest, now)
      const sessions = state.sessions.filter((record) =>
        !record.closed && uint64ToBigInt(record.credential.core.expiresAtUnixMs) > uint64ToBigInt(now)
      )
      if (sessions.length > MAX_DIRECTORY_PEERS) fail("capacity-exceeded", "Active peer directory exceeds 512 entries")
      const peers = sessions.map(({ credential }) => ({
        credentialDigest: credential.coreDigest,
        memberId: credential.core.memberId,
        replicaId: credential.core.replicaId,
        actorId: credential.core.actorId,
        role: credential.core.role,
        editState: credential.core.editState,
        peerId: credential.core.peerId,
        leaseId: credential.core.leaseId,
      })).sort((left, right) => left.replicaId.localeCompare(right.replicaId))
      const directorySequence = incrementUint64(state.directorySequence)
      const core: ActivePeerDirectoryCore = Object.freeze({
        format: "convax.active-peer-directory-core",
        projectId: state.seed.projectId,
        projectEpoch: state.seed.projectEpoch,
        membershipEpoch: state.seed.membershipEpoch,
        membershipSnapshotDigest: state.seed.membershipSnapshotDigest,
        directorySequence,
        peers,
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, DIRECTORY_TTL_MS),
        protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest),
        trustBundleDigest: state.seed.trustBundleDigest,
        serviceKeyPurpose: "rendezvous",
        serviceKeyId: requireServiceKeyId(this.signatures.serviceKeyId("rendezvous")),
      })
      const coreDigest = structuredDigest("convax.active-peer-directory-core", core)
      const directory: ActivePeerDirectory = Object.freeze({
        format: "convax.active-peer-directory",
        core,
        coreDigest,
        serviceSignature: parseSignature(await this.signatures.signServiceDigest("rendezvous", coreDigest)),
      })
      transaction.write({ ...state, directorySequence })
      return directory
    })
  }

  async issuePeerFreshnessTicket(projectIdInput: ProjectId, requestInput: PeerTicketRequest): Promise<PeerFreshnessTicket> {
    const projectId = parseProjectId(projectIdInput)
    const request = normalizePeerTicketRequest(requestInput)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireState(transaction.read())
      const existing = state.tickets.find((record) => record.requestId === request.core.requestId)
      if (existing) {
        if (existing.requestDigest !== request.coreDigest) fail("equivocation", "Peer ticket request id was reused")
        return existing.ticket
      }
      const now = nowU64(this.clock)
      const requester = requireLiveSession(state, request.core.requesterCredentialDigest, now)
      const responder = requireLiveSession(state, request.core.responderCredentialDigest, now)
      if (
        requester.credential.core.peerId !== request.core.requesterPeerId
        || responder.credential.core.peerId !== request.core.responderPeerId
      ) fail("invalid-proof", "Peer ticket route does not match the current sessions")
      if (!await this.signatures.verifyPublicKeyDigest(
        requester.credential.core.sessionSigningPublicKey,
        request.coreDigest,
        request.requesterSessionSignature,
      )) fail("invalid-proof", "Requester session signature is invalid")
      const core: PeerFreshnessTicketCore = Object.freeze({
        format: "convax.peer-freshness-ticket-core",
        ticketId: this.randomId128(),
        requestDigest: request.coreDigest,
        connectionId: request.core.connectionId,
        projectId: state.seed.projectId,
        projectEpoch: state.seed.projectEpoch,
        membershipEpoch: state.seed.membershipEpoch,
        membershipSnapshotDigest: state.seed.membershipSnapshotDigest,
        requesterCredentialDigest: request.core.requesterCredentialDigest,
        responderCredentialDigest: request.core.responderCredentialDigest,
        requesterPeerId: request.core.requesterPeerId,
        responderPeerId: request.core.responderPeerId,
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, TICKET_TTL_MS),
        channelContractDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.channelContractDigest),
        protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest),
        trustBundleDigest: state.seed.trustBundleDigest,
        serviceKeyPurpose: "rendezvous",
        serviceKeyId: requireServiceKeyId(this.signatures.serviceKeyId("rendezvous")),
      })
      const coreDigest = structuredDigest("convax.peer-freshness-ticket-core", core)
      const ticket: PeerFreshnessTicket = Object.freeze({
        format: "convax.peer-freshness-ticket",
        core,
        coreDigest,
        serviceSignature: parseSignature(await this.signatures.signServiceDigest("rendezvous", coreDigest)),
      })
      transaction.write({ ...state, tickets: [...state.tickets, { requestId: request.core.requestId, requestDigest: request.coreDigest, ticket }] })
      return ticket
    })
  }

  private randomId128(): Id128 {
    const bytes = new Uint8Array(16)
    this.random.fill(bytes)
    return parseId128(encodeBase64url(bytes))
  }

  private randomPeerId(): PeerId {
    const bytes = new Uint8Array(16)
    this.random.fill(bytes)
    return parsePeerId(`peer_${encodeBase32(bytes)}`)
  }
}

function normalizeSeed(input: CollaborationProjectSeedV2): CollaborationProjectSeedV2 {
  const memberIds = new Set<string>()
  const replicaIds = new Set<string>()
  const members = input.members.map((member) => ({
    memberId: uniqueMemberId(parseMemberId(member.memberId), memberIds),
    memberAuthorizationEpoch: parseId128(member.memberAuthorizationEpoch),
    role: requireRole(member.role),
    active: member.active === true,
    replicas: member.replicas.map((replica) => ({
      replicaId: uniqueReplicaId(parseReplicaId(replica.replicaId), replicaIds),
      actorId: parseActorId(replica.actorId),
      replicaAuthorizationEpoch: parseId128(replica.replicaAuthorizationEpoch),
      replicaSigningPublicKey: parsePublicKey(replica.replicaSigningPublicKey),
      editState: requireEditState(replica.editState),
      sessionCounter: parseUint64(replica.sessionCounter),
      active: replica.active === true,
    })),
  }))
  return Object.freeze({
    projectId: parseProjectId(input.projectId),
    projectEpoch: parseId128(input.projectEpoch),
    membershipEpoch: parseId128(input.membershipEpoch),
    membershipSequence: parseUint64(input.membershipSequence),
    membershipSnapshotDigest: parseDigest(input.membershipSnapshotDigest),
    registrySequence: parseUint64(input.registrySequence),
    registryRootDigest: parseDigest(input.registryRootDigest),
    schemaDigest: parseDigest(input.schemaDigest),
    validationArtifactSetDigest: parseDigest(input.validationArtifactSetDigest),
    trustBundleDigest: parseDigest(input.trustBundleDigest),
    members,
  })
}

function uniqueMemberId(value: MemberId, seen: Set<string>): MemberId {
  if (seen.has(value)) fail("invalid-proof", "Project seed contains a duplicate member id")
  seen.add(value)
  return value
}

function uniqueReplicaId(value: ReplicaId, seen: Set<string>): ReplicaId {
  if (seen.has(value)) fail("invalid-proof", "Project seed contains a duplicate replica id")
  seen.add(value)
  return value
}

function normalizeSessionProof(input: SessionProof): SessionProof {
  assertExactKeys(input, ["format", "core", "coreDigest", "replicaSignature"], "session proof")
  assertExactKeys(input.core, [
    "format", "challengeDigest", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest",
    "memberId", "memberAuthorizationEpoch", "replicaId", "actorId", "replicaAuthorizationEpoch",
    "replicaSessionCounter", "serverNonce", "sessionId", "leaseId", "peerId", "sessionSigningPublicKey",
    "requestedExpiresAtUnixMs", "protocolDigest",
  ], "session proof core")
  if (input.format !== "convax.session-proof" || input.core.format !== "convax.session-proof-core") {
    fail("invalid-proof", "Session proof format is invalid")
  }
  const core = Object.freeze({
    ...input.core,
    challengeDigest: parseDigest(input.core.challengeDigest),
    projectId: parseProjectId(input.core.projectId),
    projectEpoch: parseId128(input.core.projectEpoch),
    membershipEpoch: parseId128(input.core.membershipEpoch),
    membershipSnapshotDigest: parseDigest(input.core.membershipSnapshotDigest),
    memberId: parseMemberId(input.core.memberId),
    memberAuthorizationEpoch: parseId128(input.core.memberAuthorizationEpoch),
    replicaId: parseReplicaId(input.core.replicaId),
    actorId: parseActorId(input.core.actorId),
    replicaAuthorizationEpoch: parseId128(input.core.replicaAuthorizationEpoch),
    replicaSessionCounter: parseUint64(input.core.replicaSessionCounter),
    serverNonce: parseId128(input.core.serverNonce),
    sessionId: parseSessionId(input.core.sessionId),
    leaseId: parseId128(input.core.leaseId),
    peerId: parsePeerId(input.core.peerId),
    sessionSigningPublicKey: parsePublicKey(input.core.sessionSigningPublicKey),
    requestedExpiresAtUnixMs: parseUint64(input.core.requestedExpiresAtUnixMs),
    protocolDigest: parseDigest(input.core.protocolDigest),
  })
  const coreDigest = parseDigest(input.coreDigest)
  if (structuredDigest("convax.session-proof-core", core) !== coreDigest) fail("invalid-proof", "Session proof digest is invalid")
  return Object.freeze({ format: "convax.session-proof", core, coreDigest, replicaSignature: parseSignature(input.replicaSignature) })
}

function normalizePeerTicketRequest(input: PeerTicketRequest): PeerTicketRequest {
  assertExactKeys(input, ["format", "core", "coreDigest", "requesterSessionSignature"], "peer ticket request")
  assertExactKeys(input.core, [
    "format", "requestId", "connectionId", "requesterCredentialDigest", "responderCredentialDigest",
    "requesterPeerId", "responderPeerId", "requesterNonce", "protocolDigest",
  ], "peer ticket request core")
  if (input.format !== "convax.peer-ticket-request" || input.core.format !== "convax.peer-ticket-request-core") {
    fail("invalid-proof", "Peer ticket request format is invalid")
  }
  const core = Object.freeze({
    ...input.core,
    requestId: parseId128(input.core.requestId),
    connectionId: parseId128(input.core.connectionId),
    requesterCredentialDigest: parseDigest(input.core.requesterCredentialDigest),
    responderCredentialDigest: parseDigest(input.core.responderCredentialDigest),
    requesterPeerId: parsePeerId(input.core.requesterPeerId),
    responderPeerId: parsePeerId(input.core.responderPeerId),
    requesterNonce: parseId128(input.core.requesterNonce),
    protocolDigest: parseDigest(input.core.protocolDigest),
  })
  const coreDigest = parseDigest(input.coreDigest)
  if (structuredDigest("convax.peer-ticket-request-core", core) !== coreDigest) fail("invalid-proof", "Peer ticket request digest is invalid")
  return Object.freeze({
    format: "convax.peer-ticket-request",
    core,
    coreDigest,
    requesterSessionSignature: parseSignature(input.requesterSessionSignature),
  })
}

function assertProofBinding(
  proof: SessionProof,
  challenge: SessionChallengeCore,
  seed: CollaborationProjectSeedV2,
  member: CollaborationMemberSeedV2,
  replica: CollaborationReplicaSeedV2,
): void {
  const core = proof.core
  if (
    core.projectId !== seed.projectId
    || core.projectEpoch !== seed.projectEpoch
    || core.membershipEpoch !== seed.membershipEpoch
    || core.membershipSnapshotDigest !== seed.membershipSnapshotDigest
    || core.memberId !== member.memberId
    || core.memberAuthorizationEpoch !== member.memberAuthorizationEpoch
    || core.replicaId !== replica.replicaId
    || core.actorId !== replica.actorId
    || core.replicaAuthorizationEpoch !== replica.replicaAuthorizationEpoch
    || core.serverNonce !== challenge.serverNonce
    || core.sessionId !== challenge.sessionId
    || core.leaseId !== challenge.leaseId
    || core.peerId !== challenge.peerId
    || core.protocolDigest !== challenge.protocolDigest
  ) fail("invalid-proof", "Session proof does not bind the current challenge and authority")
}

function requireLiveSession(state: CollaborationControlProjectStateV2, digest: Digest, now: Uint64): SessionRecordV2 {
  const record = state.sessions.find((candidate) => candidate.credential.coreDigest === digest)
  if (!record || record.closed || uint64ToBigInt(record.credential.core.expiresAtUnixMs) <= uint64ToBigInt(now)) {
    fail("not-active", "Session credential is not current")
  }
  const { member, replica } = requireActiveReplica(state.seed, record.credential.core.memberId, record.credential.core.replicaId)
  if (
    member.memberAuthorizationEpoch !== record.credential.core.memberAuthorizationEpoch
    || replica.replicaAuthorizationEpoch !== record.credential.core.replicaAuthorizationEpoch
    || replica.actorId !== record.credential.core.actorId
    || member.role !== record.credential.core.role
  ) fail("not-active", "Session credential no longer matches current membership")
  return record
}

function requireActiveReplica(seed: CollaborationProjectSeedV2, memberId: MemberId, replicaId: ReplicaId) {
  const member = seed.members.find((candidate) => candidate.memberId === memberId)
  if (!member || !member.active) fail("not-active", "Project member is not active")
  const replica = member.replicas.find((candidate) => candidate.replicaId === replicaId)
  if (!replica || !replica.active) fail("not-active", "Project replica is not active")
  return { member, replica }
}

function requireState(value: CollaborationControlProjectStateV2 | null): CollaborationControlProjectStateV2 {
  if (value === null || value.format !== "convax.control-project-state") fail("not-found", "Collaboration Project is not provisioned")
  return value
}

function requireRole(value: CollaborationRole): CollaborationRole {
  if (value !== "viewer" && value !== "editor") fail("invalid-proof", "Collaboration role is invalid")
  return value
}

function requireEditState(value: CollaborationEditState): CollaborationEditState {
  if (value !== "none" && value !== "pending-editor" && value !== "active-editor") fail("invalid-proof", "Edit state is invalid")
  return value
}

function requireServiceKeyId(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(value)) fail("invalid-proof", "Service key id is invalid")
  return value
}

function nowU64(clock: ControlClock): Uint64 {
  const value = clock.nowEpochMilliseconds()
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid-proof", "Control clock is invalid")
  return parseUint64(String(value))
}

function addU64(value: Uint64, delta: bigint): Uint64 {
  return parseUint64((uint64ToBigInt(value) + delta).toString())
}

function encodeBase32(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567"
  let accumulator = 0
  let bits = 0
  let output = ""
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += alphabet[(accumulator >>> bits) & 31]
    }
  }
  if (bits > 0) output += alphabet[(accumulator << (5 - bits)) & 31]
  return output
}

function fail(code: CollaborationControlServiceErrorV2["code"], message: string): never {
  throw new CollaborationControlServiceErrorV2(code, message)
}
