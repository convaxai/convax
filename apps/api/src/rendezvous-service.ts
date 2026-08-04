import {
  assertExactKeysV2,
  encodeBase64urlV2,
  incrementUint64V2,
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
  uint64ToBigIntV2,
  type ActorIdV2,
  type DigestV2,
  type Id128V2,
  type MemberIdV2,
  type PeerIdV2,
  type ProjectIdV2,
  type PublicKeyV2,
  type ReplicaIdV2,
  type SignatureV2,
  type Uint64V2,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  type ActivePeerDirectoryCoreV2,
  type ActivePeerDirectoryV2,
  type CollaborationEditStateV2,
  type CollaborationRoleV2,
  type PeerFreshnessTicketCoreV2,
  type PeerFreshnessTicketV2,
  type PeerTicketRequestV2,
  type SessionChallengeCoreV2,
  type SessionChallengeV2,
  type SessionCredentialCoreV2,
  type SessionCredentialV2,
  type SessionProofV2,
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
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly replicaAuthorizationEpoch: Id128V2
  readonly replicaSigningPublicKey: PublicKeyV2
  readonly editState: CollaborationEditStateV2
  readonly sessionCounter: Uint64V2
  readonly active: boolean
}

export interface CollaborationMemberSeedV2 {
  readonly memberId: MemberIdV2
  readonly memberAuthorizationEpoch: Id128V2
  readonly role: CollaborationRoleV2
  readonly active: boolean
  readonly replicas: readonly CollaborationReplicaSeedV2[]
}

export interface CollaborationProjectSeedV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSequence: Uint64V2
  readonly membershipSnapshotDigest: DigestV2
  readonly registrySequence: Uint64V2
  readonly registryRootDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly members: readonly CollaborationMemberSeedV2[]
}

export interface ControlDigestSignaturePortV2 {
  serviceKeyId(purpose: "membership" | "rendezvous" | "registry-cutoff"): string
  signServiceDigest(purpose: "membership" | "rendezvous" | "registry-cutoff", digest: DigestV2): Promise<SignatureV2>
  verifyPublicKeyDigest(publicKey: PublicKeyV2, digest: DigestV2, signature: SignatureV2): Promise<boolean>
}

declare const sessionChallengeAuthorizationBrandV2: unique symbol

export interface SessionChallengeAuthorizationV2 {
  readonly [sessionChallengeAuthorizationBrandV2]: true
}

export interface SessionChallengeAuthorizationRequestV2 {
  readonly projectId: ProjectIdV2
  readonly memberId: MemberIdV2
  readonly replicaId: ReplicaIdV2
  readonly evidence: unknown
}

export interface SessionChallengeAuthorizationFactoryV2 {
  authorize(input: SessionChallengeAuthorizationRequestV2): Promise<SessionChallengeAuthorizationV2 | "rejected">
}

const liveSessionChallengeAuthorizations = new WeakMap<object, Readonly<{
  projectId: ProjectIdV2
  memberId: MemberIdV2
  replicaId: ReplicaIdV2
}>>()

declare const sessionDirectoryAuthorizationBrandV2: unique symbol

export interface SessionDirectoryAuthorizationV2 {
  readonly [sessionDirectoryAuthorizationBrandV2]: true
}

export interface SessionDirectoryAuthorizationRequestV2 {
  readonly projectId: ProjectIdV2
  readonly credentialDigest: DigestV2
  readonly evidence: unknown
}

export interface SessionDirectoryAuthorizationFactoryV2 {
  authorize(input: SessionDirectoryAuthorizationRequestV2): Promise<SessionDirectoryAuthorizationV2 | "rejected">
}

const liveSessionDirectoryAuthorizations = new WeakMap<object, Readonly<{
  projectId: ProjectIdV2
  credentialDigest: DigestV2
}>>()

/** Adapter-owned authentication is converted into one non-structural call capability. */
export function createSessionChallengeAuthorizationFactoryV2(verifier: {
  verify(input: SessionChallengeAuthorizationRequestV2): Promise<boolean>
}): SessionChallengeAuthorizationFactoryV2 {
  return Object.freeze({
    async authorize(input: SessionChallengeAuthorizationRequestV2) {
      const normalized = Object.freeze({
        projectId: parseProjectIdV2(input.projectId),
        memberId: parseMemberIdV2(input.memberId),
        replicaId: parseReplicaIdV2(input.replicaId),
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
        projectId: parseProjectIdV2(input.projectId),
        credentialDigest: parseDigestV2(input.credentialDigest),
      })
      if (!await verifier.verify({ ...normalized, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as SessionDirectoryAuthorizationV2
      liveSessionDirectoryAuthorizations.set(capability, normalized)
      return capability
    },
  })
}

interface SessionChallengeRecordV2 {
  readonly challenge: SessionChallengeV2
  readonly consumedProofDigest: DigestV2 | null
}

interface SessionRecordV2 {
  readonly credential: SessionCredentialV2
  readonly proofDigest: DigestV2
  readonly closed: boolean
}

interface TicketRecordV2 {
  readonly requestId: Id128V2
  readonly requestDigest: DigestV2
  readonly ticket: PeerFreshnessTicketV2
}

export interface CollaborationControlProjectStateV2 {
  readonly format: "convax.control-project-state/2"
  readonly seed: CollaborationProjectSeedV2
  readonly challenges: readonly SessionChallengeRecordV2[]
  readonly sessions: readonly SessionRecordV2[]
  readonly tickets: readonly TicketRecordV2[]
  readonly directorySequence: Uint64V2
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
        format: "convax.control-project-state/2",
        seed,
        challenges: [],
        sessions: [],
        tickets: [],
        directorySequence: parseUint64V2("0"),
        team: null,
        metadata: null,
      })
    })
  }

  async issueSessionChallenge(input: {
    readonly projectId: ProjectIdV2
    readonly memberId: MemberIdV2
    readonly replicaId: ReplicaIdV2
  }, authorization: SessionChallengeAuthorizationV2): Promise<SessionChallengeV2> {
    const projectId = parseProjectIdV2(input.projectId)
    const memberId = parseMemberIdV2(input.memberId)
    const replicaId = parseReplicaIdV2(input.replicaId)
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
        record.consumedProofDigest === null && uint64ToBigIntV2(record.challenge.core.expiresAtUnixMs) > uint64ToBigIntV2(now)
      )
      const sameReplica = liveChallenges.filter((record) => record.challenge.core.replicaId === replicaId)
      if (sameReplica.length >= MAX_PENDING_CHALLENGES) fail("capacity-exceeded", "Replica has four pending session challenges")
      const core: SessionChallengeCoreV2 = Object.freeze({
        format: "convax.session-challenge-core/2",
        challengeId: this.randomId128(),
        projectId: state.seed.projectId,
        projectEpoch: state.seed.projectEpoch,
        membershipEpoch: state.seed.membershipEpoch,
        membershipSnapshotDigest: state.seed.membershipSnapshotDigest,
        memberId: member.memberId,
        replicaId: replica.replicaId,
        actorId: replica.actorId,
        expectedReplicaSessionCounter: incrementUint64V2(replica.sessionCounter),
        serverNonce: this.randomId128(),
        sessionId: this.randomId128() as SessionChallengeCoreV2["sessionId"],
        leaseId: this.randomId128(),
        peerId: this.randomPeerId(),
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, SESSION_CHALLENGE_TTL_MS),
        protocolDigest: parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest),
        trustBundleDigest: state.seed.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: requireServiceKeyId(this.signatures.serviceKeyId("membership")),
      })
      const coreDigest = structuredDigestV2("convax.session-challenge-core/2", core)
      const challenge: SessionChallengeV2 = Object.freeze({
        format: "convax.session-challenge/2",
        core,
        coreDigest,
        serviceSignature: parseSignatureV2(await this.signatures.signServiceDigest("membership", coreDigest)),
      })
      transaction.write({
        ...state,
        challenges: [...liveChallenges, { challenge, consumedProofDigest: null }],
      })
      return challenge
    })
  }

  async issueSessionCredential(proofInput: SessionProofV2): Promise<SessionCredentialV2> {
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
      if (uint64ToBigIntV2(challenge.expiresAtUnixMs) <= uint64ToBigIntV2(now)) fail("expired", "Session challenge expired")
      assertProofBinding(proof, challenge, state.seed, member, replica)
      if (proof.core.replicaSessionCounter !== incrementUint64V2(replica.sessionCounter)) {
        fail("stale-counter", "Replica session counter is stale")
      }
      const maxExpiry = addU64(now, SESSION_CREDENTIAL_TTL_MS)
      if (
        uint64ToBigIntV2(proof.core.requestedExpiresAtUnixMs) <= uint64ToBigIntV2(now)
        || uint64ToBigIntV2(proof.core.requestedExpiresAtUnixMs) > uint64ToBigIntV2(maxExpiry)
      ) fail("expired", "Requested session expiry is outside the active lease window")
      if (!await this.signatures.verifyPublicKeyDigest(replica.replicaSigningPublicKey, proof.coreDigest, proof.replicaSignature)) {
        fail("invalid-proof", "Replica signature is invalid")
      }
      const core: SessionCredentialCoreV2 = Object.freeze({
        format: "convax.session-credential-core/2",
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
        protocolDigest: parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest),
        schemaDigest: state.seed.schemaDigest,
        validationArtifactSetDigest: state.seed.validationArtifactSetDigest,
        trustBundleDigest: state.seed.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: requireServiceKeyId(this.signatures.serviceKeyId("membership")),
      })
      const coreDigest = structuredDigestV2("convax.session-credential-core/2", core)
      const credential: SessionCredentialV2 = Object.freeze({
        format: "convax.session-credential/2",
        core,
        coreDigest,
        serviceSignature: parseSignatureV2(await this.signatures.signServiceDigest("membership", coreDigest)),
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
    projectIdInput: ProjectIdV2,
    authorization: SessionDirectoryAuthorizationV2,
  ): Promise<ActivePeerDirectoryV2> {
    const projectId = parseProjectIdV2(projectIdInput)
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
        !record.closed && uint64ToBigIntV2(record.credential.core.expiresAtUnixMs) > uint64ToBigIntV2(now)
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
      const directorySequence = incrementUint64V2(state.directorySequence)
      const core: ActivePeerDirectoryCoreV2 = Object.freeze({
        format: "convax.active-peer-directory-core/2",
        projectId: state.seed.projectId,
        projectEpoch: state.seed.projectEpoch,
        membershipEpoch: state.seed.membershipEpoch,
        membershipSnapshotDigest: state.seed.membershipSnapshotDigest,
        directorySequence,
        peers,
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, DIRECTORY_TTL_MS),
        protocolDigest: parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest),
        trustBundleDigest: state.seed.trustBundleDigest,
        serviceKeyPurpose: "rendezvous",
        serviceKeyId: requireServiceKeyId(this.signatures.serviceKeyId("rendezvous")),
      })
      const coreDigest = structuredDigestV2("convax.active-peer-directory-core/2", core)
      const directory: ActivePeerDirectoryV2 = Object.freeze({
        format: "convax.active-peer-directory/2",
        core,
        coreDigest,
        serviceSignature: parseSignatureV2(await this.signatures.signServiceDigest("rendezvous", coreDigest)),
      })
      transaction.write({ ...state, directorySequence })
      return directory
    })
  }

  async issuePeerFreshnessTicket(projectIdInput: ProjectIdV2, requestInput: PeerTicketRequestV2): Promise<PeerFreshnessTicketV2> {
    const projectId = parseProjectIdV2(projectIdInput)
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
      const core: PeerFreshnessTicketCoreV2 = Object.freeze({
        format: "convax.peer-freshness-ticket-core/2",
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
        channelContractDigest: parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.channelContractDigest),
        protocolDigest: parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest),
        trustBundleDigest: state.seed.trustBundleDigest,
        serviceKeyPurpose: "rendezvous",
        serviceKeyId: requireServiceKeyId(this.signatures.serviceKeyId("rendezvous")),
      })
      const coreDigest = structuredDigestV2("convax.peer-freshness-ticket-core/2", core)
      const ticket: PeerFreshnessTicketV2 = Object.freeze({
        format: "convax.peer-freshness-ticket/2",
        core,
        coreDigest,
        serviceSignature: parseSignatureV2(await this.signatures.signServiceDigest("rendezvous", coreDigest)),
      })
      transaction.write({ ...state, tickets: [...state.tickets, { requestId: request.core.requestId, requestDigest: request.coreDigest, ticket }] })
      return ticket
    })
  }

  private randomId128(): Id128V2 {
    const bytes = new Uint8Array(16)
    this.random.fill(bytes)
    return parseId128V2(encodeBase64urlV2(bytes))
  }

  private randomPeerId(): PeerIdV2 {
    const bytes = new Uint8Array(16)
    this.random.fill(bytes)
    return parsePeerIdV2(`peer_${encodeBase32(bytes)}`)
  }
}

function normalizeSeed(input: CollaborationProjectSeedV2): CollaborationProjectSeedV2 {
  const memberIds = new Set<string>()
  const replicaIds = new Set<string>()
  const members = input.members.map((member) => ({
    memberId: uniqueMemberId(parseMemberIdV2(member.memberId), memberIds),
    memberAuthorizationEpoch: parseId128V2(member.memberAuthorizationEpoch),
    role: requireRole(member.role),
    active: member.active === true,
    replicas: member.replicas.map((replica) => ({
      replicaId: uniqueReplicaId(parseReplicaIdV2(replica.replicaId), replicaIds),
      actorId: parseActorIdV2(replica.actorId),
      replicaAuthorizationEpoch: parseId128V2(replica.replicaAuthorizationEpoch),
      replicaSigningPublicKey: parsePublicKeyV2(replica.replicaSigningPublicKey),
      editState: requireEditState(replica.editState),
      sessionCounter: parseUint64V2(replica.sessionCounter),
      active: replica.active === true,
    })),
  }))
  return Object.freeze({
    projectId: parseProjectIdV2(input.projectId),
    projectEpoch: parseId128V2(input.projectEpoch),
    membershipEpoch: parseId128V2(input.membershipEpoch),
    membershipSequence: parseUint64V2(input.membershipSequence),
    membershipSnapshotDigest: parseDigestV2(input.membershipSnapshotDigest),
    registrySequence: parseUint64V2(input.registrySequence),
    registryRootDigest: parseDigestV2(input.registryRootDigest),
    schemaDigest: parseDigestV2(input.schemaDigest),
    validationArtifactSetDigest: parseDigestV2(input.validationArtifactSetDigest),
    trustBundleDigest: parseDigestV2(input.trustBundleDigest),
    members,
  })
}

function uniqueMemberId(value: MemberIdV2, seen: Set<string>): MemberIdV2 {
  if (seen.has(value)) fail("invalid-proof", "Project seed contains a duplicate member id")
  seen.add(value)
  return value
}

function uniqueReplicaId(value: ReplicaIdV2, seen: Set<string>): ReplicaIdV2 {
  if (seen.has(value)) fail("invalid-proof", "Project seed contains a duplicate replica id")
  seen.add(value)
  return value
}

function normalizeSessionProof(input: SessionProofV2): SessionProofV2 {
  assertExactKeysV2(input, ["format", "core", "coreDigest", "replicaSignature"], "session proof")
  assertExactKeysV2(input.core, [
    "format", "challengeDigest", "projectId", "projectEpoch", "membershipEpoch", "membershipSnapshotDigest",
    "memberId", "memberAuthorizationEpoch", "replicaId", "actorId", "replicaAuthorizationEpoch",
    "replicaSessionCounter", "serverNonce", "sessionId", "leaseId", "peerId", "sessionSigningPublicKey",
    "requestedExpiresAtUnixMs", "protocolDigest",
  ], "session proof core")
  if (input.format !== "convax.session-proof/2" || input.core.format !== "convax.session-proof-core/2") {
    fail("invalid-proof", "Session proof format is invalid")
  }
  const core = Object.freeze({
    ...input.core,
    challengeDigest: parseDigestV2(input.core.challengeDigest),
    projectId: parseProjectIdV2(input.core.projectId),
    projectEpoch: parseId128V2(input.core.projectEpoch),
    membershipEpoch: parseId128V2(input.core.membershipEpoch),
    membershipSnapshotDigest: parseDigestV2(input.core.membershipSnapshotDigest),
    memberId: parseMemberIdV2(input.core.memberId),
    memberAuthorizationEpoch: parseId128V2(input.core.memberAuthorizationEpoch),
    replicaId: parseReplicaIdV2(input.core.replicaId),
    actorId: parseActorIdV2(input.core.actorId),
    replicaAuthorizationEpoch: parseId128V2(input.core.replicaAuthorizationEpoch),
    replicaSessionCounter: parseUint64V2(input.core.replicaSessionCounter),
    serverNonce: parseId128V2(input.core.serverNonce),
    sessionId: parseSessionIdV2(input.core.sessionId),
    leaseId: parseId128V2(input.core.leaseId),
    peerId: parsePeerIdV2(input.core.peerId),
    sessionSigningPublicKey: parsePublicKeyV2(input.core.sessionSigningPublicKey),
    requestedExpiresAtUnixMs: parseUint64V2(input.core.requestedExpiresAtUnixMs),
    protocolDigest: parseDigestV2(input.core.protocolDigest),
  })
  const coreDigest = parseDigestV2(input.coreDigest)
  if (structuredDigestV2("convax.session-proof-core/2", core) !== coreDigest) fail("invalid-proof", "Session proof digest is invalid")
  return Object.freeze({ format: "convax.session-proof/2", core, coreDigest, replicaSignature: parseSignatureV2(input.replicaSignature) })
}

function normalizePeerTicketRequest(input: PeerTicketRequestV2): PeerTicketRequestV2 {
  assertExactKeysV2(input, ["format", "core", "coreDigest", "requesterSessionSignature"], "peer ticket request")
  assertExactKeysV2(input.core, [
    "format", "requestId", "connectionId", "requesterCredentialDigest", "responderCredentialDigest",
    "requesterPeerId", "responderPeerId", "requesterNonce", "protocolDigest",
  ], "peer ticket request core")
  if (input.format !== "convax.peer-ticket-request/2" || input.core.format !== "convax.peer-ticket-request-core/2") {
    fail("invalid-proof", "Peer ticket request format is invalid")
  }
  const core = Object.freeze({
    ...input.core,
    requestId: parseId128V2(input.core.requestId),
    connectionId: parseId128V2(input.core.connectionId),
    requesterCredentialDigest: parseDigestV2(input.core.requesterCredentialDigest),
    responderCredentialDigest: parseDigestV2(input.core.responderCredentialDigest),
    requesterPeerId: parsePeerIdV2(input.core.requesterPeerId),
    responderPeerId: parsePeerIdV2(input.core.responderPeerId),
    requesterNonce: parseId128V2(input.core.requesterNonce),
    protocolDigest: parseDigestV2(input.core.protocolDigest),
  })
  const coreDigest = parseDigestV2(input.coreDigest)
  if (structuredDigestV2("convax.peer-ticket-request-core/2", core) !== coreDigest) fail("invalid-proof", "Peer ticket request digest is invalid")
  return Object.freeze({
    format: "convax.peer-ticket-request/2",
    core,
    coreDigest,
    requesterSessionSignature: parseSignatureV2(input.requesterSessionSignature),
  })
}

function assertProofBinding(
  proof: SessionProofV2,
  challenge: SessionChallengeCoreV2,
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

function requireLiveSession(state: CollaborationControlProjectStateV2, digest: DigestV2, now: Uint64V2): SessionRecordV2 {
  const record = state.sessions.find((candidate) => candidate.credential.coreDigest === digest)
  if (!record || record.closed || uint64ToBigIntV2(record.credential.core.expiresAtUnixMs) <= uint64ToBigIntV2(now)) {
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

function requireActiveReplica(seed: CollaborationProjectSeedV2, memberId: MemberIdV2, replicaId: ReplicaIdV2) {
  const member = seed.members.find((candidate) => candidate.memberId === memberId)
  if (!member || !member.active) fail("not-active", "Project member is not active")
  const replica = member.replicas.find((candidate) => candidate.replicaId === replicaId)
  if (!replica || !replica.active) fail("not-active", "Project replica is not active")
  return { member, replica }
}

function requireState(value: CollaborationControlProjectStateV2 | null): CollaborationControlProjectStateV2 {
  if (value === null || value.format !== "convax.control-project-state/2") fail("not-found", "Collaboration Project is not provisioned")
  return value
}

function requireRole(value: CollaborationRoleV2): CollaborationRoleV2 {
  if (value !== "viewer" && value !== "editor") fail("invalid-proof", "Collaboration role is invalid")
  return value
}

function requireEditState(value: CollaborationEditStateV2): CollaborationEditStateV2 {
  if (value !== "none" && value !== "pending-editor" && value !== "active-editor") fail("invalid-proof", "Edit state is invalid")
  return value
}

function requireServiceKeyId(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(value)) fail("invalid-proof", "Service key id is invalid")
  return value
}

function nowU64(clock: ControlClock): Uint64V2 {
  const value = clock.nowEpochMilliseconds()
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid-proof", "Control clock is invalid")
  return parseUint64V2(String(value))
}

function addU64(value: Uint64V2, delta: bigint): Uint64V2 {
  return parseUint64V2((uint64ToBigIntV2(value) + delta).toString())
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
