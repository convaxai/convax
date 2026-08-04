# Convax P2P v10 control-plane and Peer protocol appendix

Status: **Route B standalone final-candidate. It is non-authoritative until one
complete five-file candidate, its generated protocol bundle, and the same exact
whole-file identities receive unconditional 3/3 signoff and atomic pointer
publication.**

The words MUST, MUST NOT, SHOULD and MAY are normative. Unknown, noncanonical or
unsupported values fail closed.

## 1. Ownership and dependency boundary

This annex specifies portable Project-scoped control DTOs, service semantics and the
seams that connect them to the generic collaboration kernel. A document target does
not transfer package ownership.

| Owner | Sole authority | MUST NOT own |
| --- | --- | --- |
| `@convax/collaboration` | Imported primitive/frame codecs, generic selected owner-port factory, `<K,A>` install receipt, process-only `RemoteTransferAttemptBindingV2` | Project semantics, terminal ACK policy, membership, Peer transport, filesystem |
| `@convax/project/collaboration-protocol` | Browser-safe membership/reset/checkpoint/floor DTO descriptors plus the closed RSA carrier and pure structural verifier | Project currentness, native persistence, service or transport adapters |
| `@convax/project` | RSA semantic composition, Canvas validation, wanted-root/currentness, carrier receipt, attempt key and terminal ACK gate/outbox contract | Service policy, native records, transport routing |
| `@convax/project/node` | Project-private owner-install/dependency-index persistence and plain evidence | Kernel brands, ACK decisions, Peer transport |
| `@convax/api` | Membership, enrollment/edit authorization, sessions/rendezvous, attestation, registry, cutoff and metadata transactions | Project/Canvas payload bytes, ordinary edit order, terminal Peer enqueue |
| isolated attester | Transient bounded execution of public deterministic verifiers | Durable payload storage, Project currentness, ACK or routing |
| `@convax/desktop` | Concrete Peer transport, channel queues, live connection routing and attempt-keyed outbox adapter | Membership truth, Project semantic brands, document state |

The API imports only `@convax/collaboration` and the browser-safe
`@convax/project/collaboration-protocol` export. The protocol package may import
generic collaboration types but never Project/node, Desktop, Electron, PeerJS or
filesystem modules. Desktop may map the portable channel contract to PeerJS, but no
PeerJS object, connection id or callback appears in a portable DTO.

The structural Control verifier bundle proves exact DTO bytes and signatures only.
It does not mint a Project RSA authority, currentness witness, carrier receipt,
attempt key or ACK. Project creates those process identities through private
factories bound to the exact Control bundle and live Project capabilities. There is
no `@convax/collaboration/control` package and no second control owner.

## 2. Imported canonical primitives and control-plane descriptor

### 2.1 Primitive codecs

This appendix imports, by exact exported type identity, the kernel-owned primitive
codecs `Id128V2`, `PublicKeyV2`, `SignatureV2`, `ActorIdV2`, `DigestV2`,
`Uint32V2`, `Uint64V2`, `MemberIdV2`, `ReplicaIdV2`, `SessionIdV2`, `PeerIdV2`,
`CanvasIdV2`, `DocumentScopeV2`, `CausalHeadRefV2`, `CausalFrontierV2`,
`ReplicaActorHeadSetV2`, `StateVectorV2`, `CausalSignerAuthorityV2`,
`OwnerCanonicalizerDescriptorV2` and generic
`DocumentOwnerProtocolPortV2<K>`. It imports `ProjectIdV2`,
`ProjectFileIdV2`, `ProjectVersionIdV2` and
`ProjectIndexScopeV2`, `ProjectIndexLiveScopeManifestV2` and the Project-owned
shard-reset claim/wrapper/route-CAS/reset-commit DTOs from the global URI/Project
protocol.
It MUST NOT redeclare any imported shape.

`CanvasIdV2` is the exact global Project-owned `cv_` codec whose suffix is exactly
64 lowercase hexadecimal characters. `DocumentScopeV2` is the kernel's sole closed
scope schema: its `projectId` is the global `ProjectIdV2`, and a Canvas scope has
`docId: CanvasIdV2`. Control-plane validators consume that definition verbatim;
they do not substitute an `Id128V2` Canvas id or a locally reconstructed object.

Canonical JSON is the repository's restricted RFC 8785 JCS: UTF-8 NFC scalar
strings, finite numbers, dense arrays and plain objects only. Protocol counters and
lengths use canonical decimal strings, never JSON numbers. Arrays declared sorted
are accepted only in strict order and contain no duplicates.

### 2.2 Digest and signature rule

Every structured digest is:

```text
SHA-256(UTF8(exact-domain-ending-/2) || 0x00 || JCS(exact closed object))
```

Every domain-owned raw-byte digest is:

```text
SHA-256(UTF8(exact-domain-ending-/2) || 0x00 || exact bytes)
```

A signature covers the decoded 32-byte purpose-separated digest. A signature field
is absent from its own preimage. A service-signed object also binds
`trustBundleDigest`, `serviceKeyPurpose` and `serviceKeyId` inside its signed core.
Fields named exactly `sha256` or `blobSha256` are the ordinary SHA-256 of content
bytes because they are content addresses shared with Project URI/blob contracts;
they are the only non-domain-separated digest fields.

The control-plane artifact contributes the following exactly 62 closed domains to the
kernel-owned, globally UTF-8-sorted mandatory domain registry. This is a
contribution list, not a second registry and it MUST NOT repeat kernel-owned generic
causal/frame/state-vector domains:

```text
convax.protocol-limits/2
convax.peer-channel-contract/2
convax.service-trust-bundle-core/2
convax.membership-snapshot-core/2
convax.member-credential-core/2
convax.project-admin-capability-core/2
convax.replica-actor-credential-core/2
convax.replica-edit-authorization-core/2
convax.replica-id-reservation-receipt-core/2
convax.replica-id-reservation-request-core/2
convax.begin-authorization-epoch-core/2
convax.replica-actor-id/2
convax.mutation-challenge-core/2
convax.mutation-proof-core/2
convax.mutation-receipt-core/2
convax.session-challenge-core/2
convax.session-proof-core/2
convax.session-credential-core/2
convax.active-peer-directory-core/2
convax.peer-ticket-request-core/2
convax.peer-freshness-ticket-core/2
convax.peer-handshake-core/2
convax.peer-channel-open-core/2
convax.peer-message-core/2
convax.peer-message-body/2
convax.peer-inventory-page-core/2
convax.peer-inventory-root-core/2
convax.peer-transfer-manifest-core/2
convax.peer-transfer-chunk/2
convax.replica-checkpoint-core/2
convax.replica-checkpoint/2
convax.checkpoint-validation-carrier-index/2
convax.checkpoint-content-certificate-core/2
convax.checkpoint-content-certificate/2
convax.stable-checkpoint-set-core/2
convax.replica-causal-floor-ack-core/2
convax.replica-causal-floor-ack/2
convax.prunable-checkpoint-set-certificate-core/2
convax.prunable-checkpoint-set-certificate/2
convax.replica-project-floor-page-core/2
convax.replica-project-floor-root-core/2
convax.document-shard-reset-confirmation-core/2
convax.document-shard-reset-approval-core/2
convax.project-reset-confirmation-core/2
convax.project-reset-approval-core/2
convax.team-epoch-rollover-challenge-core/2
convax.team-epoch-rollover-proof-core/2
convax.empty-project-index-genesis-attestation-core/2
convax.team-epoch-rollover-receipt-core/2
convax.document-registration-claim-core/2
convax.document-registration-abandonment-core/2
convax.collaboration-scope-entry-core/2
convax.registry-entry-set/2
convax.registry-entry-identity/2
convax.registry-snapshot-core/2
convax.target-cutoff-leaf-core/2
convax.registry-cutoff-coverage-page-core/2
convax.registry-cutoff-coverage-root-core/2
convax.authorization-mutation-core/2
convax.replica-durable-ack-core/2
convax.blob-durable-ack-core/2
convax.generation-first-loss-receipt-core/2
```

The four complete-wrapper domains are independently mandatory in addition to their
four signed-core domains: `convax.replica-checkpoint/2`,
`convax.checkpoint-content-certificate/2`,
`convax.replica-causal-floor-ack/2` and
`convax.prunable-checkpoint-set-certificate/2`. The core digest remains the signed
statement identity; the wrapper digest covers exact restricted-JCS bytes of the
complete closed wrapper, including core, core digest, signer identity and signature.
Neither identity substitutes for the other.

### 2.3 Kernel bundle binding and control constants

`ProtocolSchemaBundleV2` and the global domain registry are owned and instantiated
only by the collaboration-kernel artifact. This artifact contributes exactly:

```text
name: control-plane
format: convax.control-plane-protocol-schema/2
artifactBytes: exact UTF-8 bytes of this whole file, including its final LF
artifactDigest: SHA-256("convax.protocol-schema-artifact/2\0" || artifactBytes)
```

This file MUST NOT embed its own artifact digest, whole-file SHA or a literal bundle
`protocolDigest`; doing so would create a self-reference. Every `protocolDigest`
field below is the exact imported `ProtocolSchemaBundleV2.coreDigest`. Generated
validators, declarations and golden vectors derive from the kernel bundle and this
artifact, never from a local reconstruction of their manifest.

The two descriptor digests in the bundle cover these exact closed constant objects:

```ts
interface ProtocolLimitsV2 {
  format: "convax.protocol-limits/2"
  serviceTrustKeys: "32"
  activeProjectMembers: "256"
  retainedRevokedMembersPerProjectEpoch: "4096"
  membershipSnapshotMembers: "4352"
  activeReplicasPerMember: "8"
  activeReplicasPerProject: "512"
  activeEditorReplicasPerProject: "256"
  retainedRevokedReplicasPerProjectEpoch: "4096"
  membershipSnapshotReplicas: "4608"
  replicaIdAllocationsPerProjectEpoch: "16384"
  replicaIdAllocationsPerMemberPerProjectEpoch: "64"
  pendingReplicaIdReservationsPerMember: "4"
  pendingReplicaIdReservationsPerProject: "512"
  replicaIdReservationTtlMs: "60000"
  activeSessionsPerReplica: "1"
  pendingSessionChallengesPerReplica: "4"
  pendingMutationChallengesPerMember: "4"
  pendingProjectResetChallengesPerProject: "2"
  pendingDocumentShardResetApprovalsPerProject: "64"
  closedProjectSessionCredentialDigests: "512"
  sessionCredentialTtlMs: "900000"
  challengeTtlMs: "60000"
  freshnessTicketTtlMs: "60000"
  activePeerDirectoryEntries: "512"
  closedSessionCredentialDigests: "8"
  normalServiceRequestJcsBytes: "65536"
  membershipSnapshotBytes: "2097152"
  registrationClaimBytes: "65536"
  outstandingRegistryCandidatesPerReplica: "4"
  retainedRegistryEntriesPerMember: "1024"
  retainedRegistryEntriesPerProject: "4096"
  retainedRegistryClaimPayloadBytesPerProject: "67108864"
  cutoffLeafBytes: "1024"
  cutoffPageBytes: "524288"
  cutoffRootBytes: "65536"
  cutoffPages: "8"
  cutoffLeaves: "4096"
  cutoffAggregatePageBytes: "4194304"
  projectFloorPages: "8"
  projectFloorEntries: "4096"
  projectFloorAggregatePageBytes: "4194304"
  peerInventoryPages: "128"
  peerInventoryDocumentsPerPage: "32"
  peerInventoryDocuments: "4096"
  pendingPeerInventoriesPerPeer: "2"
  blobHaveQueryEntries: "256"
  resetControlObjectBytes: "65536"
  checkpointSnapshotBytes: "33554432"
  checkpointParents: "8"
  stableSetCertificates: "8"
  checkpointFrontierHeads: "256"
  proposalAndParentSnapshotBytes: "268435456"
  validationSuffixFrames: "4096"
  validationSuffixBytes: "67108864"
  encodedAttesterCarrierBytes: "335544320"
  encodedAttesterCarrierSections: "4224"
  canvasGenesisProofCarrierBytes: "335544320"
  documentShardResetAuthorizationCarrierBytes: "402653184"
  validationArtifactsPerCarrier: "64"
  pendingRemoteIngressObjectsPerProjectEpoch: "8192"
  pendingRemoteIngressBytesPerProjectEpoch: "536870912"
  pendingRemoteIngressObjectsPerSourceMember: "512"
  pendingRemoteIngressBytesPerSourceMember: "134217728"
  pendingRemoteInboxFramesPerDocument: "4096"
  pendingRemoteInboxBytesPerDocument: "268435456"
  pendingRemoteInboxFramesPerActor: "512"
  pendingRemoteInboxBytesPerActor: "33554432"
  localReplicationOutboxFramesPerDocument: "4096"
  localReplicationOutboxBytesPerDocument: "536870912"
  retainedDurableAcksPerFrame: "32"
  quarantineObjectsPerProject: "1024"
  quarantineBytesPerProject: "134217728"
}

interface PeerChannelPolicyV2 {
  channel: PeerChannelV2
  reliability: "reliable-ordered" | "unordered-unreliable-or-coalesced"
  maxBodyBytes: Uint64V2
  maxRawChunkBytes: Uint64V2 | null
  maxInflightPerPeer: Uint32V2 | null
  queuePriority: "highest" | "normal" | "background" | "ephemeral"
}

interface PeerChannelContractV2 {
  format: "convax.peer-channel-contract/2"
  policies: readonly [
    {
      channel: "control"; reliability: "reliable-ordered"
      maxBodyBytes: "65536"; maxRawChunkBytes: null
      maxInflightPerPeer: null; queuePriority: "highest"
    },
    {
      channel: "update"; reliability: "reliable-ordered"
      maxBodyBytes: "266240"; maxRawChunkBytes: "262144"
      maxInflightPerPeer: "4"; queuePriority: "normal"
    },
    {
      channel: "blob"; reliability: "reliable-ordered"
      maxBodyBytes: "1052672"; maxRawChunkBytes: "1048576"
      maxInflightPerPeer: "4"; queuePriority: "background"
    },
    {
      channel: "awareness"; reliability: "unordered-unreliable-or-coalesced"
      maxBodyBytes: "16384"; maxRawChunkBytes: null
      maxInflightPerPeer: null; queuePriority: "ephemeral"
    }
  ]
  awarenessTtlMs: "30000"
  malformedStrikeCloseThreshold: "3"
}
```

The closed `ProtocolLimitsV2` object has exactly 73 fields including `format`.
The four `pendingRemoteIngress...` values are aggregate reservation and retained
charge limits across every generic remote-ingress kind; the document/actor inbox
limits remain additional causal-frame-only bounds. The kernel bundle's
`limitsDigest` is the `convax.protocol-limits/2` digest of the exact
`ProtocolLimitsV2`; its `channelContractDigest` is the
`convax.peer-channel-contract/2` digest of the exact `PeerChannelContractV2`.
`PeerChannelPolicyV2` is the reusable descriptor type; the tuple is the only v2
value. The numeric table in section 12 is explanatory projection of this object,
not a second source of constants. Service `keyId` and `rootKeyId` are NFC strings of
1..128 UTF-8 bytes. A trust bundle contains <=32 keys.

## 3. Service trust and membership state

### 3.1 Trust bundle

```ts
type ServiceKeyPurposeV2 =
  | "membership"
  | "rendezvous"
  | "content-attestation"
  | "checkpoint-stability"
  | "registry-cutoff"

interface ServiceTrustKeyV2 {
  keyId: string
  purpose: ServiceKeyPurposeV2
  publicKey: PublicKeyV2
  state: "active" | "retired"
}

interface ServiceTrustBundleCoreV2 {
  format: "convax.service-trust-bundle-core/2"
  trustSequence: Uint64V2
  priorTrustBundleDigest: DigestV2 | null
  keys: readonly ServiceTrustKeyV2[] // sorted by purpose then keyId bytes
  protocolDigest: DigestV2
}

interface ServiceTrustBundleV2 {
  format: "convax.service-trust-bundle/2"
  core: ServiceTrustBundleCoreV2
  coreDigest: DigestV2
  rootKeyId: string
  rootSignature: SignatureV2
}
```

Referenced retired keys remain retrievable while any unpruned credential,
certificate, cutoff or recovery receipt names them. Trust sequence is anti-rollback
metadata, never edit order.

`rootKeyId` MUST resolve from the client's immutable service-origin trust anchors;
the bundle cannot introduce or self-authorize a root key. Adding/replacing a root
anchor requires an authenticated application/configuration release outside this
protocol. Purpose keys rotate inside a root-signed bundle, and clients persist the
highest accepted trust sequence per service origin to reject rollback. There is no
trust-on-first-use path.

### 3.2 Epochs and counters

- `projectEpoch` changes only after explicit destructive Project reset.
- `membershipEpoch` is created once with a projectEpoch and MUST NOT rotate inside
  that Project lifetime in v2. Purpose-key rotation uses a trust bundle; member and
  replica authority changes use their scoped epochs and cutoffs. A recovery that
  cannot preserve those chains requires the explicit destructive Project reset and
  a new projectEpoch, because the closed v2 cutoff target has no unsafe implicit
  "all prior actors" branch.
- `membershipSequence` starts at `"1"` inside one membership epoch and increments
  exactly once per committed membership/replica authorization mutation.
- `memberAuthorizationEpoch` is random and changes when that member's role, state or
  member signing authority changes.
- `replicaAuthorizationEpoch` is random and changes when that replica is revoked or
  replaced. A new replica always receives new replicaId, actorId and epoch.
- `memberMutationCounter` and `replicaSessionCounter` start at `"1"`, increment
  exactly, and are challenge-bound anti-replay counters. They never enter edit
  ordering or Canvas projection.

An unrelated membership mutation may advance `membershipSequence` without
invalidating another active replica's earlier frame authorization. Exact member and
replica authorization epochs plus cutoff decide that history.

### 3.3 Service-reserved replica identity

`ReplicaIdV2` is not client-selected identity. Before requesting either
`replica-enroll` or `replica-rotate`, the member obtains one service reservation:

```ts
type ReplicaIdReservationPurposeV2 = "replica-enroll" | "replica-rotate"

interface ReplicaIdReservationRequestCoreV2 {
  format: "convax.replica-id-reservation-request-core/2"
  allocationRequestId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  purpose: ReplicaIdReservationPurposeV2
  expectedMembershipSequence: Uint64V2
  requesterMemberId: MemberIdV2
  targetMemberId: MemberIdV2
  expectedTargetMemberMutationCounter: Uint64V2
  requesterCredentialDigest: DigestV2
  currentReplicaId: ReplicaIdV2 | null
  newReplicaSigningPublicKey: PublicKeyV2
  requestedEditState: "none" | "pending-editor"
  protocolDigest: DigestV2
}

interface ReplicaIdReservationRequestV2 {
  format: "convax.replica-id-reservation-request/2"
  core: ReplicaIdReservationRequestCoreV2
  coreDigest: DigestV2
  memberSignature: SignatureV2
}

interface ReplicaIdReservationReceiptCoreV2 {
  format: "convax.replica-id-reservation-receipt-core/2"
  allocationRequestId: Id128V2
  reservationRequestCoreDigest: DigestV2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  purpose: ReplicaIdReservationPurposeV2
  expectedMembershipSequence: Uint64V2
  targetMemberId: MemberIdV2
  expectedTargetMemberMutationCounter: Uint64V2
  requesterCredentialDigest: DigestV2
  currentReplicaId: ReplicaIdV2 | null
  assignedReplicaId: ReplicaIdV2
  newReplicaSigningPublicKey: PublicKeyV2
  requestedEditState: "none" | "pending-editor"
  issuedAtUnixMs: Uint64V2
  expiresAtUnixMs: Uint64V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface ReplicaIdReservationReceiptV2 {
  format: "convax.replica-id-reservation-receipt/2"
  core: ReplicaIdReservationReceiptCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

The request `coreDigest` is the
`convax.replica-id-reservation-request-core/2` digest of the exact closed core and
is the member-signature preimage. `requesterMemberId` MUST equal `targetMemberId`.
`requesterCredentialDigest` resolves to the exact current
`MemberCredentialV2.coreDigest`; the service revalidates its signature, active
member, key, Project/epochs, authorization epoch, role and counter. Enroll requires
`currentReplicaId: null`. Rotate requires the exact active current replica owned by
that member. The new key MUST NOT already identify an active or retained replica in
the Project epoch. A reservation grants no session, actor or edit authority.

The service owns these closed durable state records; they are not signed wire
objects and are never Project/Canvas state:

```ts
interface ProjectReplicaIdAllocatorStateV2 {
  format: "convax.project-replica-id-allocator-state/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  lastAllocatedReplicaId: ReplicaIdV2 | null
  allocatedReplicaCount: Uint32V2
  pendingReservationCount: Uint32V2
}

interface ReplicaIdReservationStateRecordV2 {
  format: "convax.replica-id-reservation-state/2"
  allocationRequestId: Id128V2
  reservationRequestCoreDigest: DigestV2
  reservationReceiptCoreDigest: DigestV2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  targetMemberId: MemberIdV2
  assignedReplicaId: ReplicaIdV2
  state: "reserved" | "consumed" | "abandoned"
  consumedMutationId: Id128V2 | null
  consumedMutationReceiptCoreDigest: DigestV2 | null
  abandonmentReason:
    | "expired"
    | "membership-stale"
    | "explicit-cancel"
    | "project-reset"
    | null
}
```

`reserved` has all three terminal-detail fields null. `consumed` has both consumed
fields non-null and `abandonmentReason: null`. `abandoned` has both consumed fields
null and a non-null abandonment reason. State transitions are one-way. Expiry or
abandonment releases pending capacity but never identity capacity.

`allocatedReplicaCount` equals the number of reservation state records in that
Project epoch; `pendingReservationCount` equals the `reserved` subset.
`lastAllocatedReplicaId` is null exactly when the allocation count is zero and
otherwise equals the greatest decoded assigned id. Per-member lifetime and pending
counts are derived from the same records inside the allocator transaction; a
separate eventually consistent quota counter cannot authorize allocation.

For a new Project epoch, `lastAllocatedReplicaId` is null and both counts are zero.
Allocation decodes `ReplicaIdV2` as its kernel-defined nonzero unsigned 32-bit
integer. The first value is `replica_00000001`; every later committed reservation
uses exactly the prior high-water plus one, re-encoded as eight lowercase
big-endian hexadecimal digits. Hashing, probing, random allocation, machine time
and Yjs state MUST NOT select the value. This counter allocates identity only and
never orders edits.

One membership-store transaction first resolves `allocationRequestId`. An exact
stored request core digest returns the byte-identical stored receipt without
changing reservation state, even after consumption or expiry; another digest is
equivocation. For an unseen id, the same transaction validates the exact request
and member signature, checks the current sequence/counter/replica/key plus all caps,
computes the next id, advances the allocator high-water/count, stores the immutable
request and signed receipt, and stores the `reserved` state. Only then may it return
the receipt. Signer/store failure rolls back every effect. Two concurrent
transactions against one Project epoch therefore receive distinct increasing ids
regardless of arrival completion; no caller-selected value or local probe
participates.

`allocationRequestId + coreDigest` is idempotent and returns the byte-identical
stored receipt. Reusing the id with another core digest is
`idempotency-equivocation`. The receipt TTL is at most 60 seconds. At most four
pending reservations exist per member, 512 per Project, 64 total allocations by one
member in one Project epoch, and 16,384 total allocations in one Project epoch.
Reserved, consumed and abandoned records all count toward the lifetime allocation
caps. Reaching a cap or the uint32 high-water fails closed; it never evicts a record
or reuses an id. Only explicit destructive Project reset creates a new Project
epoch whose independent allocator may begin again at `replica_00000001`.

Every assigned id remains globally unique within its Project epoch across the
allocator ledger and all active, revoked, replaced or otherwise retained replica
records. A snapshot, credential, checkpoint dependency or mutation that names an id
not backed by the exact service-signed reservation receipt fails closed.

### 3.4 Member, replica and snapshot

```ts
type CollaborationRoleV2 = "viewer" | "editor"

interface MembershipMemberV2 {
  memberId: MemberIdV2
  memberSigningPublicKey: PublicKeyV2
  role: CollaborationRoleV2
  state: "active" | "revoked"
  memberAuthorizationEpoch: Id128V2
  memberMutationCounter: Uint64V2
}

interface MembershipReplicaV2 {
  replicaId: ReplicaIdV2
  replicaIdReservationReceiptDigest: DigestV2
  memberId: MemberIdV2
  actorId: ActorIdV2
  replicaSigningPublicKey: PublicKeyV2
  state: "active" | "revoked" | "replaced"
  editState: "none" | "pending-editor" | "active-editor"
  replicaAuthorizationEpoch: Id128V2
  enrolledAtMembershipSequence: Uint64V2
  revokedAtMembershipSequence: Uint64V2 | null
  replacesReplicaId: ReplicaIdV2 | null
}

interface MembershipSnapshotCoreV2 {
  format: "convax.membership-snapshot-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSequence: Uint64V2
  registrySequence: Uint64V2
  registryRootDigest: DigestV2
  members: readonly MembershipMemberV2[] // sorted by decoded memberId
  replicas: readonly MembershipReplicaV2[] // sorted by decoded replicaId
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface MembershipSnapshotV2 {
  format: "convax.membership-snapshot/2"
  core: MembershipSnapshotCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

MemberId, replicaId, actorId and public keys are unique in a snapshot. Replica id
uniqueness is additionally checked against the Project-epoch allocator ledger,
including every reserved, abandoned and retained id, so snapshot eviction cannot
make an id reusable. Each replica record's
`replicaIdReservationReceiptDigest` resolves to the exact membership-signed
reservation receipt whose Project/epochs/member/assigned id/key and purpose match
that record and its enrollment or rotation mutation. An active replica's member is
active. `active-editor` requires an active editor member and a durably installed
current floor. Viewer replicas and pending editors cannot sign an edit. Snapshot
lookup by digest returns exact immutable bytes, never the current snapshot
substituted for an older digest.

The registry sequence/root in a membership snapshot is the exact registry
observation committed with that immutable snapshot; it is not a claim that the
grow-only registry can no longer advance. Registry advancement does not rewrite a
membership snapshot or reuse its membership sequence. Current session and cutoff
transactions bind their own later registry high-water independently.

Actor id is derived and reverified by service and peers:

```text
actorId = base64url(SHA-256(
  "convax.replica-actor-id/2\0" ||
  JCS({projectId,projectEpoch,memberId,replicaId,replicaSigningPublicKey})
))
```

Key rotation creates a new replicaId/actorId chain; it never continues the old
actor predecessor.

### 3.5 Credentials and offline edit authorization

```ts
interface MemberCredentialCoreV2 {
  format: "convax.member-credential-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  memberId: MemberIdV2
  memberSigningPublicKey: PublicKeyV2
  role: CollaborationRoleV2
  memberAuthorizationEpoch: Id128V2
  adminCapabilityDigest: DigestV2 | null
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface MemberCredentialV2 {
  format: "convax.member-credential/2"
  core: MemberCredentialCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}

interface ProjectAdminCapabilityCoreV2 {
  format: "convax.project-admin-capability-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  adminMemberId: MemberIdV2
  adminMemberAuthorizationEpoch: Id128V2
  grants: readonly ["membership-admin"]
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface ProjectAdminCapabilityV2 {
  format: "convax.project-admin-capability/2"
  core: ProjectAdminCapabilityCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}

interface ReplicaActorCredentialCoreV2 {
  format: "convax.replica-actor-credential-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  memberId: MemberIdV2
  replicaId: ReplicaIdV2
  replicaIdReservationReceiptDigest: DigestV2
  actorId: ActorIdV2
  replicaSigningPublicKey: PublicKeyV2
  replicaAuthorizationEpoch: Id128V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface ReplicaActorCredentialV2 {
  format: "convax.replica-actor-credential/2"
  core: ReplicaActorCredentialCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}

interface ReplicaEditAuthorizationCoreV2 {
  format: "convax.replica-edit-authorization-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  membershipSequence: Uint64V2
  memberId: MemberIdV2
  memberAuthorizationEpoch: Id128V2
  replicaId: ReplicaIdV2
  replicaIdReservationReceiptDigest: DigestV2
  actorId: ActorIdV2
  replicaAuthorizationEpoch: Id128V2
  role: "editor"
  editState: "active-editor"
  installedFloorSetDigest: DigestV2
  protocolDigest: DigestV2
  schemaDigest: DigestV2
  validationArtifactSetDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface ReplicaEditAuthorizationV2 {
  format: "convax.replica-edit-authorization/2"
  core: ReplicaEditAuthorizationCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}

interface BeginAuthorizationEpochCoreV2 {
  format: "convax.begin-authorization-epoch-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  memberId: MemberIdV2
  memberAuthorizationEpoch: Id128V2
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
  replicaAuthorizationEpoch: Id128V2
  replicaEditAuthorizationCoreDigest: DigestV2
  protocolDigest: DigestV2
}

interface BeginAuthorizationEpochV2 {
  format: "convax.begin-authorization-epoch/2"
  core: BeginAuthorizationEpochCoreV2
  coreDigest: DigestV2
}
```

`adminCapabilityDigest` in a member credential is either null or the exact current
`ProjectAdminCapabilityV2` digest for that same member authorization instance. It
does not survive member epoch rotation and grants no Canvas/Project payload access.
The service resolves the complete capability object by digest and revalidates its
signature, Project epochs, membership snapshot, admin member/authorization epoch,
grant and trust bundle inside the same membership-store transaction that commits a
mutation. Possessing a stale digest or a formerly valid admin key grants nothing.
This appendix does not define delegable or dynamically scoped admin capabilities;
Project bootstrap/admin policy may issue the closed capability above, but cannot
weaken its per-mutation current-state checks.

The edit authorization is the signed offline authority dependency carried by a
frame. It has no wall-clock expiry. Session expiry does not invalidate it. A later
authorization shrink evaluates it through the exact immutable cutoff; service
sequence alone cannot invalidate or select a frame. A pending/new editor receives
this object only after its current floor is fsynced and acknowledged.

The actor credential and every derived edit authorization carry the exact
`replicaIdReservationReceiptDigest` from the immutable membership replica record.
Credential verification resolves that receipt by digest and checks its service
signature, Project epoch, member, assigned replica id and signing key. For rotate,
its purpose and prior replica also match the consumed mutation. The receipt's
`expiresAtUnixMs` is only the deadline to consume a still-reserved allocation; once
consumed atomically into a membership snapshot and actor credential, wall clock and
later expiry do not invalidate either authority or the retained receipt. The
receipt remains retrievable while any unpruned snapshot, credential, frame,
checkpoint or certificate transitively references it.

`BeginAuthorizationEpochV2.coreDigest` uses
`convax.begin-authorization-epoch-core/2` and is the only authorization-instance
identity a Canvas generation begin may bind. Its
`replicaEditAuthorizationCoreDigest` is exactly the referenced
`ReplicaEditAuthorizationV2.coreDigest`; every other identity/epoch/digest field
must equal that authorization and its immutable membership/actor credentials. The
object is deterministic and unsigned because authority remains the referenced
service signature. A raw `replicaAuthorizationEpoch`, membership sequence or
caller-created shorthand MUST NOT substitute for this digest.

## 4. Replay-safe membership mutations

### 4.1 Challenges

```ts
type MutationPurposeV2 =
  | "member-add"
  | "replica-enroll"
  | "replica-activate-editor"
  | "replica-rotate"
  | "replica-revoke"
  | "member-role-change"
  | "member-revoke"

interface MutationChallengeCoreV2 {
  format: "convax.mutation-challenge-core/2"
  purpose: MutationPurposeV2
  challengeId: Id128V2
  mutationId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  expectedMembershipSequence: Uint64V2
  requesterMemberId: MemberIdV2
  targetMemberId: MemberIdV2
  expectedTargetMemberMutationCounter: Uint64V2
  requesterCredentialDigest: DigestV2
  replicaIdReservationReceiptDigest: DigestV2 | null
  requiredFloorSetDigest: DigestV2 | null
  preparedAfterMembershipSnapshotCoreDigest: DigestV2
  preparedCutoffCoverageRootCoreDigest: DigestV2 | null
  serverNonce: Id128V2
  issuedAtUnixMs: Uint64V2
  expiresAtUnixMs: Uint64V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface MutationChallengeV2 {
  format: "convax.mutation-challenge/2"
  core: MutationChallengeCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

TTL is at most 60 seconds. A challenge is exact-project/member/purpose/counter
single-use state. At most four unconsumed mutation challenges exist per member.

### 4.2 Closed proof union

```ts
interface MutationProofBaseCoreV2 {
  format: "convax.mutation-proof-core/2"
  mutationId: Id128V2
  challengeDigest: DigestV2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  expectedMembershipSequence: Uint64V2
  requesterMemberId: MemberIdV2
  targetMemberId: MemberIdV2
  targetMemberMutationCounter: Uint64V2
  serverNonce: Id128V2
}

type MembershipMutationProofCoreV2 =
  | (MutationProofBaseCoreV2 & {
      purpose: "member-add"
      targetMemberSigningPublicKey: PublicKeyV2
      initialRole: CollaborationRoleV2
      adminCapabilityDigest: DigestV2
    })
  | (MutationProofBaseCoreV2 & {
      purpose: "replica-enroll"
      currentReplicaId: null
      newReplicaId: ReplicaIdV2
      replicaIdReservationReceiptDigest: DigestV2
      newReplicaSigningPublicKey: PublicKeyV2
      requestedEditState: "none" | "pending-editor"
      cutoffCoverageRootCoreDigest: null
    })
  | (MutationProofBaseCoreV2 & {
      purpose: "replica-activate-editor"
      currentReplicaId: ReplicaIdV2
      installedFloorSetDigest: DigestV2
      cutoffCoverageRootCoreDigest: null
    })
  | (MutationProofBaseCoreV2 & {
      purpose: "replica-rotate"
      currentReplicaId: ReplicaIdV2
      newReplicaId: ReplicaIdV2
      replicaIdReservationReceiptDigest: DigestV2
      newReplicaSigningPublicKey: PublicKeyV2
      requestedEditState: "none" | "pending-editor"
      cutoffCoverageRootCoreDigest: DigestV2
    })
  | (MutationProofBaseCoreV2 & {
      purpose: "replica-revoke"
      currentReplicaId: ReplicaIdV2
      newReplicaId: null
      newReplicaSigningPublicKey: null
      requestedEditState: null
      cutoffCoverageRootCoreDigest: DigestV2
    })
  | (MutationProofBaseCoreV2 & {
      purpose: "member-role-change"
      nextRole: "viewer" | "editor"
      cutoffCoverageRootCoreDigest: DigestV2 | null
      adminCapabilityDigest: DigestV2
    })
  | (MutationProofBaseCoreV2 & {
      purpose: "member-revoke"
      cutoffCoverageRootCoreDigest: DigestV2
      adminCapabilityDigest: DigestV2
    })

type MutationProofSignaturesV2 =
  | {
      purpose: "member-add"
      adminSignature: SignatureV2
      targetMemberPossessionSignature: SignatureV2
    }
  | {
      purpose: "replica-enroll" | "replica-activate-editor" |
        "replica-rotate" | "replica-revoke"
      memberSignature: SignatureV2
    }
  | {
      purpose: "member-role-change" | "member-revoke"
      adminSignature: SignatureV2
    }

interface MembershipMutationProofV2 {
  format: "convax.mutation-proof/2"
  core: MembershipMutationProofCoreV2
  requestDigest: DigestV2
  signatures: MutationProofSignaturesV2
}
```

`signatures.purpose` MUST equal `core.purpose`; mismatch fails before signature
verification. `requestDigest` MUST equal the `convax.mutation-proof-core/2` digest
of `core`, so neither signatures nor their wrapper participate in the preimage.

Editor-to-viewer requires cutoff. Viewer-to-editor requires no cutoff, but every
replica starts `pending-editor` and becomes `active-editor` only after floor install.
Replica rotate is old replica revoke plus new enrollment in one mutation; its cutoff
target action remains replica `revoke` for the old actor.

For `replica-activate-editor`, the challenge's `requiredFloorSetDigest` and proof's
`installedFloorSetDigest` MUST identify the same exact
`ReplicaProjectFloorRootV2.coreDigest`; the target replica must be active, owned by
an active editor member and currently `pending-editor`. The service revalidates the
root, all pages, current content-certified ProjectIndex live-scope manifest and
membership inside the transaction. Registry is checked only for anti-rollback;
registry-only scope presence or absence cannot grant or block activation. Every
other mutation has `requiredFloorSetDigest: null`.

For `replica-enroll` and `replica-rotate`, challenge issuance additionally resolves
one exact `reserved`, unexpired `ReplicaIdReservationReceiptV2`. Its request and
receipt signatures, Project/epochs, purpose, member credential, expected sequence,
member counter, current replica, assigned id, new key and requested edit state MUST
match the challenge and proposed proof byte-for-byte. The challenge and proof carry
that exact receipt core digest; `newReplicaId` is only a signed repetition of
`assignedReplicaId`, never a caller selection. All other challenge purposes require
`replicaIdReservationReceiptDigest: null`, and no other proof branch contains the
field.

### 4.3 Atomic mutation and idempotency

```ts
interface MutationReceiptCoreV2 {
  format: "convax.mutation-receipt-core/2"
  mutationId: Id128V2
  requestDigest: DigestV2
  purpose: MutationPurposeV2
  beforeMembershipSnapshotDigest: DigestV2
  afterMembershipSnapshotDigest: DigestV2
  consumedReplicaIdReservationReceiptDigest: DigestV2 | null
  issuedReplicaActorCredentialDigest: DigestV2 | null
  issuedReplicaEditAuthorizationDigest: DigestV2 | null
  authorizationMutationDigest: DigestV2 | null
  cutoffCoverageRootCoreDigest: DigestV2 | null
  closedSessionCredentialDigests: readonly DigestV2[] // sorted
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface MutationReceiptV2 {
  format: "convax.mutation-receipt/2"
  core: MutationReceiptCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

One membership-store transaction verifies challenge, nonce, unexpired exact
credential, proof signature, next counter, expected membership sequence, ids/keys,
floor prerequisites and cutoff root when authority shrinks. Enroll and rotate also
revalidate the exact reservation request/receipt signatures and byte-equal fields,
require its state still `reserved` and unexpired, and prove its assigned id is in no
other reservation or replica record. The transaction then consumes the challenge,
advances counters/sequence, stores the immutable before/after snapshots, rotates
authorization epochs, closes affected sessions, stores the cutoff transaction,
signs the new actor credential where applicable, changes the reservation state to
`consumed` with this mutation id/receipt digest, and publishes the exact mutation
receipt. The reservation state change, snapshot, actor credential, mutation receipt
and allocator ledger are one durable Project-epoch commit. Signer/store failure
rolls back every effect; it never exposes an enrolled replica backed by a still
reserved, abandoned or missing allocation.

Only `replica-enroll` and `replica-rotate` set both
`consumedReplicaIdReservationReceiptDigest` and
`issuedReplicaActorCredentialDigest` to the exact consumed reservation receipt and
newly signed `ReplicaActorCredentialV2.coreDigest`. The new snapshot replica record
and actor credential repeat the same reservation digest. Every other purpose sets
both fields null.

Only `replica-activate-editor` sets
`issuedReplicaEditAuthorizationDigest` to the newly signed exact
`ReplicaEditAuthorizationV2.coreDigest`; all other purposes use null. The edit
authorization, after snapshot and mutation receipt are signed/stored in the same
transaction, is published with them so no snapshot can expose active edit state
without its portable authority object.

`mutationId + requestDigest` is idempotent and returns the exact stored receipt.
Same mutationId with another digest is `idempotency-equivocation`. A consumed nonce,
counter gap, stale sequence or mismatched purpose fails without mutation.
`requestDigest` is the `convax.mutation-proof-core/2` digest of the exact closed
`core`. Thus a member-add admin and target member sign the identical digest; a
replica mutation carries one `memberSignature`; and an admin mutation carries one
`adminSignature`. Replica mutation requires requesterMemberId equal targetMemberId;
member role/revoke requires the requester credential plus exact current
ProjectAdminCapabilityV2.

Viewer-to-editor changes each active replica from `none` to `pending-editor` and
issues no edit authorization. Editor-to-viewer changes every replica to `none`,
closes their sessions and cuts off exactly the pre-mutation active-editor actors;
pending replicas carry no edit authority and are not cutoff targets. Member revoke
revokes every active replica, and replica revoke/rotate affects only its exact actor.

For `member-add`, targetMemberId and signing key must be globally unused in the
projectEpoch, target counter is exactly `"0"`, the current admin and proposed member
both sign the same request digest, and commit creates the member at counter `"1"`
with a new authorization epoch. It issues no replica or edit authority; the new
member subsequently enrolls a replica. This is the v2 invite/join primitive; an
asynchronous invitation UI may retain only a bounded opaque invitation to obtain
this fresh challenge and cannot bypass either proof.

For an authority-shrinking mutation, the challenge is issued only after service has
validated the proposed immutable coverage page/root cores and deterministically
constructed the unsigned after-membership snapshot core. The challenge binds both
core digests. They have no authority before the member/admin proof and committed
authorization mutation. At commit, service rechecks current before-state, signs and
stores the exact prepared snapshot/root/pages with the mutation. This removes any
signature/digest cycle and prevents a client from changing cutoff coverage after
signing. Non-shrinking mutation uses null cutoff core digest.

### 4.4 Destructive reset evidence and team epoch rollover

Reset confirmation, admin approval and service epoch rollover are distinct closed
authorities. A UI boolean, unsigned IPC result, generic admin capability or ordinary
membership mutation receipt cannot substitute for any of them.

```ts
type DocumentShardResetReasonV2 =
  import("@convax/project/collaboration-protocol").DocumentShardResetReasonV2

interface DocumentShardResetConfirmationCoreV2 {
  format: "convax.document-shard-reset-confirmation-core/2"
  confirmationId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  reason: DocumentShardResetReasonV2
  routeCasCoreDigest: DigestV2
  predecessorActivationDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  initiatorMemberId: MemberIdV2
  initiatorReplicaId: ReplicaIdV2
  initiatorActorId: ActorIdV2
  initiatorActorCredentialCoreDigest: DigestV2
  confirmationStatement: "replace-one-canvas-shard-and-retain-old-recovery-bytes"
  protocolDigest: DigestV2
}

interface DocumentShardResetConfirmationV2 {
  format: "convax.document-shard-reset-confirmation/2"
  core: DocumentShardResetConfirmationCoreV2
  coreDigest: DigestV2
  initiatorReplicaSignature: SignatureV2
}

interface DocumentShardResetApprovalCoreV2 {
  format: "convax.document-shard-reset-approval-core/2"
  approvalId: Id128V2
  resetClaimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  reason: DocumentShardResetReasonV2
  routeCasCoreDigest: DigestV2
  adminMemberId: MemberIdV2
  adminMemberAuthorizationEpoch: Id128V2
  adminCapabilityCoreDigest: DigestV2
  approvalStatement: "approve-exact-canvas-shard-reset"
  protocolDigest: DigestV2
}

interface DocumentShardResetApprovalV2 {
  format: "convax.document-shard-reset-approval/2"
  core: DocumentShardResetApprovalCoreV2
  coreDigest: DigestV2
  adminMemberSignature: SignatureV2
}
```

### 4.4.1 Exact shard-reset principal and signature closure

The Project artifact's imported claim core MUST use the kernel-owned nominal
`MemberIdV2` and `ReplicaIdV2` identities exactly:

The exact `DocumentShardResetClaimCoreV2`, its wrapper,
`DocumentShardResetRouteCasCoreV2` and `CanvasRouteResetCommitV2` are imported from
`@convax/project/collaboration-protocol`. Control does not redeclare a reduced
shape, add a staged-genesis alias or add an enclosing-carrier digest.

No second credential digest, replica key, identity alias, reservation digest or
raw `Id128V2` compatibility branch is legal. Both scopes are exact Canvas scopes
with the same Project, Project epoch and `CanvasIdV2`; only `shardEpoch` differs.
The reason and every repeated route/genesis field are byte-equal to the Project-owned
reset claim and route-CAS core.

The confirmation core intentionally omits the claim digest. Project first computes
the claim core, which binds `confirmationCoreDigest`; the approval binds that exact
`resetClaimCoreDigest`; the claim wrapper finally carries the approval core digest.
This one-way construction has no digest cycle.

The structural verifier requires the claim, confirmation and carrier-bound actor
credential tuples to be byte-equal after strict scalar decoding and canonical
re-encoding:

```text
claim.core.{initiatorMemberId,initiatorReplicaId,initiatorActorId}
  == confirmation.core.{initiatorMemberId,initiatorReplicaId,initiatorActorId}
  == credential.core.{memberId,replicaId,actorId}
```

The credential additionally satisfies:

```text
credential.coreDigest
  == confirmation.core.initiatorActorCredentialCoreDigest
credential.core.projectId
  == confirmation.core.projectId
  == claim.core.oldScope.projectId
  == claim.core.newScope.projectId
  == claim.core.projectIndexScope.projectId
credential.core.projectEpoch
  == confirmation.core.projectEpoch
  == claim.core.oldScope.projectEpoch
  == claim.core.newScope.projectEpoch
  == claim.core.projectIndexScope.projectEpoch
credential.core.protocolDigest
  == confirmation.core.protocolDigest
  == exact ProtocolSchemaBundleV2.coreDigest captured by the generated verifier
```

The exact immutable membership records satisfy:

```text
membershipReplica.memberId == credential.core.memberId
membershipReplica.replicaId == credential.core.replicaId
membershipReplica.actorId == credential.core.actorId
membershipReplica.replicaSigningPublicKey
  == credential.core.replicaSigningPublicKey
membershipReplica.replicaAuthorizationEpoch
  == credential.core.replicaAuthorizationEpoch
membershipReplica.replicaIdReservationReceiptDigest
  == credential.core.replicaIdReservationReceiptDigest
membershipReplica.state == "active"
membershipMember.memberId == credential.core.memberId
membershipMember.state == "active"
membershipMember.role == "editor"
membershipReplica.editState == "active-editor"
```

`active` and `active-editor` above are claims inside the exact signed carrier
snapshot, not statements about current Project membership. F13 validates their
internal binding only; Project independently proves currentness.

Edit authorization, installed floors, causal signer authority and live route state
are deliberately absent from the carrier. Their currentness is a Project-owned
semantic gate and cannot be inferred from a structurally valid credential or
membership snapshot. F13 neither resolves nor names those process inputs.

The carrier contains the credential-bound `ReplicaIdReservationReceiptV2`;
substituting another receipt for the same member or a newly issued receipt is
forbidden.
Its wrapper/core digest and membership-purpose service signature validate, and:

```text
reservation.coreDigest
  == credential.core.replicaIdReservationReceiptDigest
reservation.core.projectId/projectEpoch
  == credential.core.projectId/projectEpoch
reservation.core.targetMemberId == credential.core.memberId
reservation.core.assignedReplicaId == credential.core.replicaId
reservation.core.newReplicaSigningPublicKey
  == credential.core.replicaSigningPublicKey
reservation.core.protocolDigest == credential.core.protocolDigest
reservation.core.serviceKeyPurpose == "membership"
reservation.core.purpose == "replica-enroll" | "replica-rotate"
```

The receipt bytes do not prove that the private reservation state is `consumed`,
that its mutation introduced the current membership replica or that it remains
current. Project must establish those facts separately before minting its private
RSA authority; F13 performs no reservation-state lookup.

The verifier independently recomputes:

```text
initiatorActorId = base64url(SHA-256(
  "convax.replica-actor-id/2\0" ||
  JCS({
    projectId: credential.core.projectId,
    projectEpoch: credential.core.projectEpoch,
    memberId: credential.core.memberId,
    replicaId: credential.core.replicaId,
    replicaSigningPublicKey: credential.core.replicaSigningPublicKey,
  })
))
```

That result is byte-equal to the credential, membership replica, confirmation and
claim actor ids. Stored actor ids are not accepted without derivation.

The exact admin chain is:

```text
claim.core.adminMemberId
  == approval.core.adminMemberId
  == adminCapability.core.adminMemberId
claim.core.adminAuthorizationDigest
  == approval.core.adminCapabilityCoreDigest
  == adminCapability.coreDigest
```

The approval's member authorization epoch equals the carrier capability's bound
epoch. F13 validates the exact capability bytes and signatures but does not decide
that the capability remains current. Admin approval does not grant ProjectIndex
causal-frame signing authority or upgrade a viewer/pending editor.

Signature preimages remain exactly:

```text
confirmationCoreDigest = SHA-256(
  UTF8("convax.document-shard-reset-confirmation-core/2") || 0x00 ||
  JCS(confirmation.core)
)
confirmationSignatureMessage = decoded(confirmationCoreDigest)

claimCoreDigest = SHA-256(
  UTF8("convax.document-shard-reset-claim-core-digest/2") || 0x00 ||
  JCS(claim.core)
)
claimSignatureMessage = SHA-256(
  UTF8("convax.document-shard-reset-claim-signature/2") || 0x00 ||
  decoded(claimCoreDigest)
)
```

`initiatorReplicaSignature` is pure Ed25519 over
`confirmationSignatureMessage`; `initiatorSignature` is pure Ed25519 over
`claimSignatureMessage`. Both use only the byte-identical credential replica key.
Member/session/admin keys, current-replica fallback and caller-selected keys are
forbidden.

Changing the Project field codec and artifact bytes rotates the Project artifact
digest, exact protocol bundle core/protocol digest and every reset object that binds
that protocol digest. A confirmation, claim or approval from the superseded bundle
MUST NOT be migrated, rewritten or accepted under this protocol major. Another credential is
also rejected even when it reuses the same public-key bytes, because its exact
credential/reservation identities are not the confirmation-bound chain.

In the claim, `explicitConfirmationReceiptDigest` equals
`confirmationCoreDigest`, `adminApprovalDigest` equals the approval core digest and
`adminAuthorizationDigest` equals `adminCapabilityCoreDigest`. Exact retry is
idempotent; reuse of an id with different core bytes is
`idempotency-equivocation`. No service sequence or registry entry participates in
the route decision. At most 64 uncommitted approvals exist per Project; exceeding
the cap refuses a new approval without evicting a referenced approval.

### 4.4.2 F13 structural verification only

Control's F13 responsibility is a pure structural and cryptographic verification of
one exact `CVXRSA02` carrier. It never evaluates Project currentness, wanted roots,
routes, candidates, Y.Doc state, Canvas semantics, persistence, owner installation or
ACK eligibility. Project may invoke the same pure verifier at more than one private
semantic gate, but those gates and their ordering are Project-owned and are not F13
steps.

The sole structural first-failure order is:

1. enforce the complete-carrier and index caps before allocation;
2. validate magic, unsigned-big-endian index length and exact total length;
3. parse the index as restricted JCS and require byte-identical re-encoding;
4. validate the closed index keys, scalar codecs and protocol digest;
5. validate every named section's contiguous offset, length and ordinary SHA-256;
6. decode the three Project-owned claim/route-CAS/reset-commit sections through
   their exact imported validators and the two Control-owned confirmation/approval
   sections through their exact local validators; reject every unknown field;
7. decode the five Control-owned credential, reservation, membership,
   admin-capability and trust sections with their exact validators;
8. recompute every wrapper/core digest and require all named index mirrors;
9. require byte-equal Project, Project epoch, old/new scope, reason, route-CAS and
   staged-genesis values repeated by the signed objects;
10. require the claim, confirmation and credential initiator member/replica/actor
    triads to be byte-equal;
11. verify the credential/reservation/trust closure and both initiator signatures
    against the exact structurally bound keys;
12. verify the approval/admin/trust signature closure;
13. return the plain closed structural result from section 16.

A missing, malformed, noncanonical, over-cap, hash-mismatched, digest-mismatched or
signature-invalid carrier rejects. There is no pending result because all structural
dependencies are sections of the carrier. A structurally verified result is
diagnostic data only: it is not a witness, permit, currentness proof, owner-install
receipt, attempt key or ACK authority.

The following have declaration count zero in Control: candidate/current Y.Doc bytes,
state vectors, typed intents, causal signer authority, Project route-currentness
facts, active-editor/wanted-root decisions, Project RSA owner/factory, owner-install
capability, attempt key, outbox, `queryAttempt`, F13 phase/resume token and any
Project mutation callable.

```ts
type ProjectResetReasonV2 =
  | "unsupported-portable-version"
  | "incompatible-project-index-schema"
  | "unrecoverable-project-index-corruption"
  | "explicit-empty-project-reset"

interface ProjectResetConfirmationCoreV2 {
  format: "convax.project-reset-confirmation-core/2"
  resetId: Id128V2
  confirmationId: Id128V2
  projectId: ProjectIdV2
  oldProjectEpoch: Id128V2 | null
  reason: ProjectResetReasonV2
  observedOldPrivateTreeDigest: DigestV2
  unsupportedInventoryDigest: DigestV2
  privateDeletionSetDigest: DigestV2
  stableProjectIdPreserved: true
  ordinaryProjectFilesPreserved: true
  deletionStatement: "delete-exact-displayed-private-project-state"
  requestedProtocolDigest: DigestV2
  requestedSchemaDigest: DigestV2
  requestedUriProtocolDigest: DigestV2
  confirmationPrincipal:
    | {
        kind: "team-replica"
        memberId: MemberIdV2
        replicaId: ReplicaIdV2
        actorId: ActorIdV2
        actorCredentialCoreDigest: DigestV2
      }
    | {
        kind: "local-project-owner"
        localProjectBindingDigest: DigestV2
        localConfirmationKeyId: string
      }
  protocolDigest: DigestV2
}

interface ProjectResetConfirmationV2 {
  format: "convax.project-reset-confirmation/2"
  core: ProjectResetConfirmationCoreV2
  coreDigest: DigestV2
  confirmationSignature: SignatureV2
}

interface ProjectResetApprovalCoreV2 {
  format: "convax.project-reset-approval-core/2"
  resetId: Id128V2
  approvalId: Id128V2
  confirmationCoreDigest: DigestV2
  projectId: ProjectIdV2
  oldProjectEpoch: Id128V2
  reason: ProjectResetReasonV2
  observedOldPrivateTreeDigest: DigestV2
  unsupportedInventoryDigest: DigestV2
  privateDeletionSetDigest: DigestV2
  requestedProtocolDigest: DigestV2
  requestedSchemaDigest: DigestV2
  requestedUriProtocolDigest: DigestV2
  adminMemberId: MemberIdV2
  adminMemberAuthorizationEpoch: Id128V2
  adminCapabilityCoreDigest: DigestV2
  approvalStatement: "approve-exact-team-project-reset"
  protocolDigest: DigestV2
}

interface ProjectResetApprovalV2 {
  format: "convax.project-reset-approval/2"
  core: ProjectResetApprovalCoreV2
  coreDigest: DigestV2
  adminMemberSignature: SignatureV2
}
```

An unteamed legacy Project with no service identity uses the
`local-project-owner` branch; its key is resolved from the pre-existing durable
local Project binding named by digest/key id, never introduced by the reset object.
A team Project uses `team-replica` and also requires the admin approval. Repeated
inventory/deletion/protocol fields are byte-equal. Only the
exact displayed private deletion set is authorized: stable `projectId` and ordinary
Project files remain. Confirmation/approval JCS is each <=64 KiB. An approval is
valid only while its old Project epoch, current admin epoch/capability and bound
confirmation remain current. `localConfirmationKeyId` is NFC and 1..128 UTF-8
bytes.

```ts
interface TeamEpochRolloverChallengeCoreV2 {
  format: "convax.team-epoch-rollover-challenge-core/2"
  challengeId: Id128V2
  resetId: Id128V2
  projectId: ProjectIdV2
  oldProjectEpoch: Id128V2
  expectedProjectResetCounter: Uint64V2
  projectResetConfirmationCoreDigest: DigestV2
  projectResetApprovalCoreDigest: DigestV2
  observedOldMembershipSnapshotDigest: DigestV2
  observedOldRegistryRootDigest: DigestV2
  observedOldPrivateTreeDigest: DigestV2
  newProjectEpoch: Id128V2
  newMembershipEpoch: Id128V2
  newProjectIndexShardEpoch: Id128V2
  preparedNewMembershipSnapshotCoreDigest: DigestV2
  serverNonce: Id128V2
  issuedAtUnixMs: Uint64V2
  expiresAtUnixMs: Uint64V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface TeamEpochRolloverChallengeV2 {
  format: "convax.team-epoch-rollover-challenge/2"
  core: TeamEpochRolloverChallengeCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}

interface TeamEpochRolloverProofCoreV2 {
  format: "convax.team-epoch-rollover-proof-core/2"
  challengeDigest: DigestV2
  resetId: Id128V2
  projectId: ProjectIdV2
  oldProjectEpoch: Id128V2
  newProjectEpoch: Id128V2
  newMembershipEpoch: Id128V2
  newProjectIndexShardEpoch: Id128V2
  expectedProjectResetCounter: Uint64V2
  projectResetConfirmationCoreDigest: DigestV2
  projectResetApprovalCoreDigest: DigestV2
  serverNonce: Id128V2
  requesterMemberId: MemberIdV2
  requesterMemberAuthorizationEpoch: Id128V2
  requesterAdminCapabilityCoreDigest: DigestV2
  stagedEmptyProjectIndexCheckpointDigest: DigestV2
  stagedEmptyProjectIndexFullUpdateDigest: DigestV2
  stagedEmptyProjectIndexStateVectorDigest: DigestV2
  stagedEmptyProjectIndexCanonicalStateDigest: DigestV2
  protocolDigest: DigestV2
  schemaDigest: DigestV2
  uriProtocolDigest: DigestV2
}

interface TeamEpochRolloverProofV2 {
  format: "convax.team-epoch-rollover-proof/2"
  core: TeamEpochRolloverProofCoreV2
  requestDigest: DigestV2
  requesterAdminMemberSignature: SignatureV2
}

interface EmptyProjectIndexGenesisAttestationCoreV2 {
  format: "convax.empty-project-index-genesis-attestation-core/2"
  projectId: ProjectIdV2
  newProjectEpoch: Id128V2
  newMembershipEpoch: Id128V2
  newProjectIndexScope: DocumentScopeV2
  teamEpochRolloverProofCoreDigest: DigestV2
  checkpointDigest: DigestV2
  fullUpdateDigest: DigestV2
  stateVectorDigest: DigestV2
  canonicalStateDigest: DigestV2
  emptyCatalog: true
  protocolDigest: DigestV2
  schemaDigest: DigestV2
  uriProtocolDigest: DigestV2
  validationArtifactSetDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "content-attestation"
  serviceKeyId: string
}

interface EmptyProjectIndexGenesisAttestationV2 {
  format: "convax.empty-project-index-genesis-attestation/2"
  core: EmptyProjectIndexGenesisAttestationCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}

interface TeamEpochRolloverReceiptCoreV2 {
  format: "convax.team-epoch-rollover-receipt-core/2"
  resetId: Id128V2
  requestDigest: DigestV2
  projectId: ProjectIdV2
  oldProjectEpoch: Id128V2
  newProjectEpoch: Id128V2
  newMembershipEpoch: Id128V2
  newProjectIndexShardEpoch: Id128V2
  projectResetConfirmationCoreDigest: DigestV2
  projectResetApprovalCoreDigest: DigestV2
  newMembershipSnapshotDigest: DigestV2
  newRequesterMemberCredentialCoreDigest: DigestV2
  newRequesterAdminCapabilityCoreDigest: DigestV2
  newProjectIndexScope: DocumentScopeV2
  emptyProjectIndexGenesisAttestationCoreDigest: DigestV2
  emptyProjectIndexCheckpointDigest: DigestV2
  emptyProjectIndexFullUpdateDigest: DigestV2
  emptyProjectIndexStateVectorDigest: DigestV2
  emptyProjectIndexCanonicalStateDigest: DigestV2
  closedSessionCredentialDigests: readonly DigestV2[] // sorted, <=512
  retiredOldEpochState: "permanently-fenced-recovery-only"
  committedProjectResetCounter: Uint64V2
  protocolDigest: DigestV2
  schemaDigest: DigestV2
  uriProtocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface TeamEpochRolloverReceiptV2 {
  format: "convax.team-epoch-rollover-receipt/2"
  core: TeamEpochRolloverReceiptCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

The challenge TTL is <=60 seconds and at most two unconsumed rollover challenges
exist per Project. Issuance verifies the exact current Project/admin credentials,
the two reset evidences, old membership/registry high-water, reset counter and all
repeated deletion/protocol digests, then preallocates fresh random epochs and an
unsigned next membership snapshot. The next snapshot preserves active members and
roles, rotates every member authorization epoch, contains no replicas, uses
membership sequence `"1"` and registry sequence `"0"`, and therefore grants no old
actor edit authority.

After issuance, Project stages the exact empty ProjectIndex genesis and submits the
proof plus the bounded streaming attester carrier. `requestDigest` is the
`convax.team-epoch-rollover-proof-core/2` digest of `core`; the requester admin
signature covers that digest. The attester validates that the new scope uses the
challenge's exact Project/epoch/shard values, that all four staged digests describe
one deterministic empty ProjectIndex, and that its protocol/schema/URI digests are
exact. It stores no payload.

One service transaction then revalidates challenge, nonce, expiry, counter, old
roots, current admin, proof, attestation and every repeated field; consumes the
challenge; increments the Project reset counter exactly once; permanently retires
the old Project epoch; closes all old sessions/tickets/challenges; stores the new
membership snapshot and credential/capability objects; resets the registry; and
stores/signs the exact receipt. Signer/store failure rolls back all effects. Exact
`resetId + requestDigest` retry returns the byte-identical receipt. Same resetId
with another digest is `idempotency-equivocation`; expired/replayed challenge or
stale old root has no effect. Old credentials are rejected immediately after
commit. The local Project may publish the staged tree only after durably persisting
this receipt, and publishes the receipt's exact ids/digests; a receipt never proves
that local deletion has completed.


## 5. Session credential and rendezvous

### 5.1 Session challenge and proof

```ts
interface SessionChallengeCoreV2 {
  format: "convax.session-challenge-core/2"
  challengeId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  memberId: MemberIdV2
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
  expectedReplicaSessionCounter: Uint64V2
  serverNonce: Id128V2
  sessionId: SessionIdV2
  leaseId: Id128V2
  peerId: PeerIdV2
  issuedAtUnixMs: Uint64V2
  expiresAtUnixMs: Uint64V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface SessionChallengeV2 {
  format: "convax.session-challenge/2"
  core: SessionChallengeCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}

interface SessionProofCoreV2 {
  format: "convax.session-proof-core/2"
  challengeDigest: DigestV2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  memberId: MemberIdV2
  memberAuthorizationEpoch: Id128V2
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
  replicaAuthorizationEpoch: Id128V2
  replicaSessionCounter: Uint64V2
  serverNonce: Id128V2
  sessionId: SessionIdV2
  leaseId: Id128V2
  peerId: PeerIdV2
  sessionSigningPublicKey: PublicKeyV2
  requestedExpiresAtUnixMs: Uint64V2
  protocolDigest: DigestV2
}

interface SessionProofV2 {
  format: "convax.session-proof/2"
  core: SessionProofCoreV2
  coreDigest: DigestV2
  replicaSignature: SignatureV2
}
```

Session challenge TTL is at most 60 seconds; at most four unconsumed challenges
exist per replica. The session private key is memory-only and distinct from the
long-lived replica key.

### 5.2 Session credential

```ts
interface SessionCredentialCoreV2 {
  format: "convax.session-credential-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSequence: Uint64V2
  membershipSnapshotDigest: DigestV2
  registrySequence: Uint64V2
  registryRootDigest: DigestV2
  memberId: MemberIdV2
  memberAuthorizationEpoch: Id128V2
  role: CollaborationRoleV2
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
  replicaAuthorizationEpoch: Id128V2
  replicaSigningPublicKey: PublicKeyV2
  editState: "none" | "pending-editor" | "active-editor"
  sessionId: SessionIdV2
  leaseId: Id128V2
  peerId: PeerIdV2
  sessionSigningPublicKey: PublicKeyV2
  sessionChallengeDigest: DigestV2
  sessionProofDigest: DigestV2
  issuedAtUnixMs: Uint64V2
  expiresAtUnixMs: Uint64V2
  protocolDigest: DigestV2
  schemaDigest: DigestV2
  validationArtifactSetDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "membership"
  serviceKeyId: string
}

interface SessionCredentialV2 {
  format: "convax.session-credential/2"
  core: SessionCredentialCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

Credential TTL is at most 15 minutes. Issuance atomically consumes the challenge,
increments the exact replica session counter, closes the prior lease, writes the
new session and signs the credential. Each active replica has at most one current
session. Credential-authorized service calls re-read current project/member/
replica/session state and compare every epoch/key/lease field in the same
transaction; signature and TTL alone are insufficient.

`sessionId + sessionProofDigest` is idempotent and returns the exact stored
credential. Same sessionId with another proof digest is equivocation and cannot
close or replace the current lease.

Session replacement closes transport only. It does not change actor chain or
invalidate history. Revocation, replacement and role downgrade close affected
sessions immediately; destructive Project reset closes every session.

### 5.3 Active-peer directory

```ts
interface ActivePeerDirectoryCoreV2 {
  format: "convax.active-peer-directory-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  directorySequence: Uint64V2
  peers: readonly {
    credentialDigest: DigestV2
    memberId: MemberIdV2
    replicaId: ReplicaIdV2
    actorId: ActorIdV2
    role: CollaborationRoleV2
    editState: "none" | "pending-editor" | "active-editor"
    peerId: PeerIdV2
    leaseId: Id128V2
  }[]
  issuedAtUnixMs: Uint64V2
  expiresAtUnixMs: Uint64V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "rendezvous"
  serviceKeyId: string
}

interface ActivePeerDirectoryV2 {
  format: "convax.active-peer-directory/2"
  core: ActivePeerDirectoryCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

The directory contains at most 512 entries, exactly one current unexpired entry per
active replica, sorted by decoded replicaId. A service response above the cap or
with duplicate replica/session/peer identity fails closed rather than truncating.
The directory excludes expired/replaced/closed leases. Its sequence and expiry are
discovery freshness only, never edit order or holder proof.

### 5.4 Freshness-ticket request and ticket

```ts
interface PeerTicketRequestCoreV2 {
  format: "convax.peer-ticket-request-core/2"
  requestId: Id128V2
  connectionId: Id128V2
  requesterCredentialDigest: DigestV2
  responderCredentialDigest: DigestV2
  requesterPeerId: PeerIdV2
  responderPeerId: PeerIdV2
  requesterNonce: Id128V2
  protocolDigest: DigestV2
}

interface PeerTicketRequestV2 {
  format: "convax.peer-ticket-request/2"
  core: PeerTicketRequestCoreV2
  coreDigest: DigestV2
  requesterSessionSignature: SignatureV2
}
```

```ts
interface PeerFreshnessTicketCoreV2 {
  format: "convax.peer-freshness-ticket-core/2"
  ticketId: Id128V2
  requestDigest: DigestV2
  connectionId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  requesterCredentialDigest: DigestV2
  responderCredentialDigest: DigestV2
  requesterPeerId: PeerIdV2
  responderPeerId: PeerIdV2
  issuedAtUnixMs: Uint64V2
  expiresAtUnixMs: Uint64V2
  channelContractDigest: DigestV2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "rendezvous"
  serviceKeyId: string
}

interface PeerFreshnessTicketV2 {
  format: "convax.peer-freshness-ticket/2"
  core: PeerFreshnessTicketCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

Ticket TTL is at most 60 seconds. Service issues it only after transactionally
rechecking both exact current sessions and the requester signature. Same requestId
and digest returns the exact ticket; same id/different digest fails. A ticket binds
one connectionId. Each peer caches ticketDigest-to-connectionId until expiry and
rejects another live handshake for the same ticket. It is connection bootstrap, not
edit or payload authority.

## 6. Transport-independent Peer connection and four channels

### 6.1 Connection handshake

```ts
interface PeerHandshakeCoreV2 {
  format: "convax.peer-handshake-core/2"
  connectionId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  freshnessTicketDigest: DigestV2
  initiatorCredentialDigest: DigestV2
  responderCredentialDigest: DigestV2
  initiatorPeerId: PeerIdV2
  responderPeerId: PeerIdV2
  initiatorNonce: Id128V2
  responderNonce: Id128V2
  channelContractDigest: DigestV2
  protocolDigest: DigestV2
}

interface PeerHandshakeV2 {
  format: "convax.peer-handshake/2"
  core: PeerHandshakeCoreV2
  coreDigest: DigestV2
  initiatorSessionSignature: SignatureV2
  responderSessionSignature: SignatureV2
}
```

Each peer verifies ticket/service signature, exact role-bound credential positions,
credential signatures, expiry, project/epoch/protocol, both nonces and both session
signatures. Handshake connectionId MUST equal the ticket connectionId. PeerJS
metadata, peerId and WebRTC DTLS never replace this handshake.
DTLS supplies transport confidentiality; v2 adds application signatures for
portable authentication and replay evidence, not a second encryption scheme.

### 6.2 Independently bound channel opens

```ts
type PeerChannelV2 = "control" | "update" | "blob" | "awareness"

interface PeerChannelOpenCoreV2 {
  format: "convax.peer-channel-open-core/2"
  connectionId: Id128V2
  handshakeDigest: DigestV2
  channel: PeerChannelV2
  channelOpenId: Id128V2
  initiatorCredentialDigest: DigestV2
  responderCredentialDigest: DigestV2
  initiatorChannelNonce: Id128V2
  responderChannelNonce: Id128V2
  channelContractDigest: DigestV2
  protocolDigest: DigestV2
}

interface PeerChannelOpenV2 {
  format: "convax.peer-channel-open/2"
  core: PeerChannelOpenCoreV2
  coreDigest: DigestV2
  initiatorSessionSignature: SignatureV2
  responderSessionSignature: SignatureV2
}
```

Exactly one live channel-open per channel exists under a connection. Reopen uses a
new channelOpenId/nonces and resets only that channel's message sequence. A channel
object presented on another DataConnection, connection or credential pair fails.

Channel contracts are:

| Channel | Delivery | Maximum body | Queue rule |
| --- | --- | ---: | --- |
| `control` | reliable ordered | 64 KiB | highest priority; never waits behind update/blob |
| `update` | reliable ordered binary | raw chunk <=256 KiB; complete body <=260 KiB | <=4 inflight transfers per Peer |
| `blob` | reliable ordered binary | raw chunk <=1 MiB; complete body <=1,028 KiB | <=4 inflight chunks per Peer |
| `awareness` | unordered/unreliable or coalesced | 16 KiB | newest per awareness subject; TTL <=30 s |

Each channel owns a separate queue, cancellation controller and bounded strike
counter. Blob backpressure cannot consume control/update queue credit. Session
close, credential/scope/epoch drift, failed handshake, control-channel failure or
three malformed-message strikes on any channel closes all four; one ordinary
update/blob cancellation closes only that transfer.

### 6.3 Signed message envelope and sequence

```ts
type PeerBodyKindV2 =
  | "control.inventory-root"
  | "control.inventory-page"
  | "control.object-request"
  | "control.blob-have-query"
  | "control.blob-have-response"
  | "control.transfer-offer"
  | "control.transfer-accept"
  | "control.transfer-ack"
  | "control.transfer-nack"
  | "control.transfer-cancel"
  | "control.authorization-notice"
  | "update.transfer-chunk"
  | "blob.transfer-chunk"
  | "awareness.presence"
  | "awareness.cursor"
  | "awareness.selection"
  | "awareness.gesture-hint"
  | "awareness.clear"

interface PeerMessageCoreV2 {
  format: "convax.peer-message-core/2"
  connectionId: Id128V2
  channelOpenDigest: DigestV2
  channel: PeerChannelV2
  senderCredentialDigest: DigestV2
  receiverCredentialDigest: DigestV2
  messageSequence: Uint64V2
  bodyKind: PeerBodyKindV2
  bodyLength: Uint64V2
  bodyDigest: DigestV2
  protocolDigest: DigestV2
}

interface PeerMessageEnvelopeV2 {
  format: "convax.peer-message/2"
  core: PeerMessageCoreV2
  coreDigest: DigestV2
  senderSessionSignature: SignatureV2
  body: Uint8Array
}
```

Body digest uses domain `convax.peer-message-body/2`. Sequence starts at `"1"` per
sender/channel-open. Control/update/blob require exact +1; a gap closes that channel
as desynchronized. Awareness accepts a gap but requires strict greater-than its
high-water and drops replay/older values. Sequence and signature are transport
replay protection only and never business order. Message body is parsed only after
scope, length, digest, signature, queue and sequence checks.

The wire form is not JSON with an embedded typed array:

```text
offset 0   8 bytes  ASCII "CVXPEER2"
offset 8   1 byte   channel code: control=1, update=2, blob=3, awareness=4
offset 9   1 byte   flags, exactly 0
offset 10  4 bytes  u32be core JCS length
offset 14  8 bytes  u64be body length
offset 22  N bytes  exact PeerMessageCoreV2 JCS
             64 bytes raw Ed25519 session signature
             M bytes exact body
```

Core channel/bodyLength/bodyDigest must equal framing. Unknown code/flag, overflow,
noncanonical core, wrong signature or trailing bytes fails before body parse.
`bodyKind` prefix must match channel. A control kind must match the decoded control
body discriminator; update/blob accept only their transfer-chunk kind; awareness
kind must match its body discriminator.

### 6.4 Control body union

Control bodies are canonical JCS and exactly one of:

```ts
interface PeerInventoryDocumentSummaryV2 {
  scope: DocumentScopeV2
  prunableCheckpointSetCertificateDigest: DigestV2 | null
  bootstrapCheckpointDigests: readonly DigestV2[]
  causalFrontierDigest: DigestV2
  replicaActorHeadSetDigest: DigestV2
  stateVectorDigest: DigestV2
}

interface PeerInventoryPageCoreV2 {
  format: "convax.peer-inventory-page-core/2"
  inventoryId: Id128V2
  senderReplicaId: ReplicaIdV2
  pageIndex: Uint32V2
  firstScopeKey: string
  lastScopeKey: string
  documents: readonly PeerInventoryDocumentSummaryV2[]
}

interface PeerInventoryPageV2 {
  format: "convax.peer-inventory-page/2"
  core: PeerInventoryPageCoreV2
  coreDigest: DigestV2
}

interface PeerInventoryRootCoreV2 {
  format: "convax.peer-inventory-root-core/2"
  inventoryId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  senderMemberId: MemberIdV2
  senderReplicaId: ReplicaIdV2
  senderActorId: ActorIdV2
  senderReplicaActorCredentialCoreDigest: DigestV2
  membershipSnapshotDigest: DigestV2
  registrySequence: Uint64V2
  registryRootDigest: DigestV2
  cutoffHighWaterDigest: DigestV2 | null
  holderEnumeration: "complete-for-local-durable-document-holdings"
  pageDigests: readonly DigestV2[]
  documentCount: Uint32V2
  protocolDigest: DigestV2
}

interface PeerInventoryRootV2 {
  format: "convax.peer-inventory-root/2"
  core: PeerInventoryRootCoreV2
  coreDigest: DigestV2
}

type PeerControlBodyV2 =
  | {
      format: "convax.peer-control/2"; kind: "inventory-root"
      root: PeerInventoryRootV2
    }
  | {
      format: "convax.peer-control/2"; kind: "inventory-page"
      page: PeerInventoryPageV2
    }
  | {
      format: "convax.peer-control/2"; kind: "object-request"
      requestId: Id128V2
      objectKind: "frame" | "checkpoint" | "certificate" | "cutoff" |
        "registry-page" | "causal-frontier" | "actor-head-set" |
        "state-vector" | "blob"
      digests: readonly DigestV2[]
    }
  | {
      format: "convax.peer-control/2"; kind: "blob-have-query"
      queryId: Id128V2
      blobs: readonly { blobSha256: DigestV2; byteLength: Uint64V2 }[]
    }
  | {
      format: "convax.peer-control/2"; kind: "blob-have-response"
      queryId: Id128V2
      have: readonly { blobSha256: DigestV2; byteLength: Uint64V2 }[]
    }
  | {
      format: "convax.peer-control/2"; kind: "transfer-offer"
      manifest: PeerTransferManifestV2
    }
  | {
      format: "convax.peer-control/2"; kind: "transfer-accept"
      transferId: Id128V2; manifestDigest: DigestV2
    }
  | {
      format: "convax.peer-control/2"; kind: "transfer-ack"
      transferId: Id128V2; manifestDigest: DigestV2
      durabilityProofDigest: DigestV2 | null
    }
  | {
      format: "convax.peer-control/2"; kind: "transfer-nack"
      transferId: Id128V2; manifestDigest: DigestV2
      code: PeerTransferErrorCodeV2
    }
  | {
      format: "convax.peer-control/2"; kind: "transfer-cancel"
      transferId: Id128V2; manifestDigest: DigestV2
      reason: "caller-cancelled" | "scope-closed" | "superseded" | "capacity"
    }
  | {
      format: "convax.peer-control/2"; kind: "authorization-notice"
      membershipSnapshotDigest: DigestV2
      authorizationMutationDigest: DigestV2
      cutoffCoverageRootCoreDigest: DigestV2 | null
    }
```

Inventory pages contain 1..32 documents, pages are ordered by `pageIndex` from zero,
and all documents are strictly sorted and duplicate-free by exact JCS scope. A root
contains <=128 page digests and commits exactly <=4,096 local durable document
holdings. Page first/last keys are range checks. The receiver verifies every page,
page digest, range, count, sender and unique scope before accepting any absence or
starting causal reconciliation; a missing/replaced page is
`peer-inventory-incomplete`. At most two incomplete inventories are retained per
Peer. A new root supersedes an older incomplete root only after its own signed
message envelope verifies.

Each summary is a canonical commitment, not an opaque freshness hint. Its frontier,
actor-head set and state vector are exact kernel-owned canonical object digests.
`bootstrapCheckpointDigests` is UTF-8 sorted, duplicate-free and <=8; after pruning
it equals the exact underlying checkpoint set transitively authorized by the named
prunable certificate. When that certificate digest is null, the array is empty and
exact actor heads permit reverse causal traversal to genesis. A requester fetches
and verifies the committed actor-head set/frontier,
walks missing frame dependencies, and uses the raw state-vector object only for Yjs
diff calculation and post-apply verification, never as edit authority.

Inventory enumerates the sender's holdings, not all Project routes. It never makes a
route, checkpoint, frame or blob authoritative. ProjectIndex remains the only live
route/blob-reference authority; registry values are anti-rollback/discovery only.
Object-request digests are sorted, duplicate-free and <=256. Blob-have entries are
sorted by `(decoded blobSha256, unsigned byteLength)`, duplicate-free and <=256;
the response must be an exact subset of its query. Requesters query only exact
ProjectIndex-proved blob hashes. A missing response/offer is ordinary holder
absence, so v2 has no unactionable whole-store blob inventory digest.

```ts
type PeerTransferErrorCodeV2 =
  | "manifest-invalid"
  | "scope-mismatch"
  | "unsupported-kind"
  | "dependency-missing"
  | "capacity-exceeded"
  | "chunk-invalid"
  | "hash-mismatch"
  | "validation-rejected"
  | "durability-failed"
  | "authorization-closed"
```

### 6.5 Transfer manifest, chunks and cancellation

```ts
interface PeerTransferManifestCoreV2 {
  format: "convax.peer-transfer-manifest-core/2"
  connectionId: Id128V2
  transferId: Id128V2
  channel: "update" | "blob"
  kind: "causal-frame" | "checkpoint" | "validation-suffix" | "registry-page" |
    "causal-frontier" | "actor-head-set" | "state-vector" | "project-blob"
  scope: DocumentScopeV2 | null
  subjectDigest: DigestV2
  byteLength: Uint64V2
  sha256: DigestV2
  chunkBytes: Uint32V2
  chunkCount: Uint32V2
  compression: "none"
  protocolDigest: DigestV2
}

interface PeerTransferManifestV2 {
  format: "convax.peer-transfer-manifest/2"
  core: PeerTransferManifestCoreV2
  coreDigest: DigestV2
}

interface PeerTransferChunkHeaderV2 {
  format: "convax.peer-transfer-chunk/2"
  transferId: Id128V2
  manifestDigest: DigestV2
  chunkIndex: Uint32V2
  byteOffset: Uint64V2
  byteLength: Uint32V2
  chunkSha256: DigestV2
}
```

Chunk body is exact raw bytes after the canonical JCS chunk header in the signed
peer-message body, encoded as `u32be headerLength || headerJCS || rawChunk`; header
is <=4 KiB. Index starts at 0 and is contiguous; offset is the exact sum of
prior lengths; only the final chunk may be short. Receiver validates manifest and
capacity before allocation/staging, verifies each chunk, then exact full length and
SHA-256 before parsing or durable admission.

Update transfers are ACKed only after protocol validation and local object/journal/
head fsync. Blob transfer is ACKed only after hash/length validation, blob fsync and
local blob-index fsync. Cancel stops remaining I/O but never rolls back an already
durable object or domain commit. Duplicate exact offer/chunk/ACK is idempotent;
same transferId with another manifest digest closes the sender channel as
equivocation.

For causal-frame/checkpoint/suffix/frontier/actor-head-set/state-vector manifests
`scope` is required and exact. For a Project blob or registry page it is null;
authority comes from the exact Project resource proof or signed coverage root named
by subjectDigest. `chunkCount` equals `ceil(byteLength/chunkBytes)` with zero-byte
transfer forbidden.

Channel/kind mapping is closed: `project-blob` uses `blob`; every other manifest
kind uses `update`. A successful control `transfer-ack.durabilityProofDigest` is the
exact `BlobDurableAckV2.coreDigest` for `project-blob`, the exact
`ReplicaDurableAckV2.coreDigest` for admitted causal-frame/checkpoint objects, and
null only for immutable validation-suffix, registry-page, causal-frontier,
actor-head-set or state-vector cache bytes whose authority and durable status are
independently proved. Any other combination is a manifest error.

### 6.6 Awareness

```ts
interface PeerAwarenessBaseV2 {
  format: "convax.peer-awareness/2"
  scope: DocumentScopeV2
  awarenessSubjectId: Id128V2
  issuedAtUnixMs: Uint64V2
  expiresAtUnixMs: Uint64V2
}

type PeerAwarenessBodyV2 =
  | (PeerAwarenessBaseV2 & {
      kind: "presence"
      value: { state: "active" | "idle" }
    })
  | (PeerAwarenessBaseV2 & {
      kind: "cursor"
      value: { x: number; y: number }
    })
  | (PeerAwarenessBaseV2 & {
      kind: "selection"
      value: { nodeIds: readonly string[]; edgeIds: readonly string[] }
    })
  | (PeerAwarenessBaseV2 & {
      kind: "gesture-hint"
      value: {
        gesture: "drag" | "resize" | "connect"
        entityIds: readonly string[]
        x: number | null
        y: number | null
      }
    })
  | (PeerAwarenessBaseV2 & { kind: "clear"; value: null })
```

Coordinates are finite and in `[-10_000_000, 10_000_000]`. Identity arrays are
UTF-8 sorted, duplicate-free and contain <=64 entries each; gesture ids contain
1..64. Complete value is <=12 KiB and body <=16 KiB. Expiry is at most 30 seconds.
Awareness may use wall clock because it is never persisted, ACKed, replayed into
state, used for authorization or used as a business winner.

## 7. Durable replication ACKs

```ts
interface ReplicaDurableAckCoreV2 {
  format: "convax.replica-durable-ack-core/2"
  scope: DocumentScopeV2
  frameOrCheckpointDigest: DigestV2
  receiverMemberId: MemberIdV2
  receiverReplicaId: ReplicaIdV2
  receiverActorId: ActorIdV2
  receiverAuthorizationDigest: DigestV2
  receiverDurableHeadDigest: DigestV2
  receiverFrontierDigest: DigestV2
  protocolDigest: DigestV2
}

interface ReplicaDurableAckV2 {
  format: "convax.replica-durable-ack/2"
  core: ReplicaDurableAckCoreV2
  coreDigest: DigestV2
  replicaSignature: SignatureV2
}

interface BlobDurableAckCoreV2 {
  format: "convax.blob-durable-ack-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  fileId: ProjectFileIdV2
  versionId: ProjectVersionIdV2
  blobSha256: DigestV2
  byteLength: Uint64V2
  receiverMemberId: MemberIdV2
  receiverReplicaId: ReplicaIdV2
  receiverActorId: ActorIdV2
  receiverAuthorizationDigest: DigestV2
  protocolDigest: DigestV2
}

interface BlobDurableAckV2 {
  format: "convax.blob-durable-ack/2"
  core: BlobDurableAckCoreV2
  coreDigest: DigestV2
  replicaSignature: SignatureV2
}
```

These are long-lived replica signatures, not session ACKs. Frame ACK does not prove
blob durability. Blob ACK contains no path, inode, local index digest or machine
time. A stale/revoked receiver ACK may remain audit history but cannot newly satisfy
current replication status. In both ACKs `receiverAuthorizationDigest` is the exact
current `ReplicaActorCredentialV2.coreDigest`; it authenticates the durable holder
and grants no edit authority, so an active viewer may provide replication durability.

## 8. Checkpoint carrier and content certificate

### 8.1 Checkpoint candidate

```ts
interface ReplicaCheckpointCoreV2 {
  format: "convax.replica-checkpoint-core/2"
  scope: DocumentScopeV2
  checkpointId: Id128V2
  authorMemberId: MemberIdV2
  authorReplicaId: ReplicaIdV2
  authorActorId: ActorIdV2
  authorAuthorizationDigest: DigestV2
  directParentCheckpointDigests: readonly DigestV2[] // sorted, 0..8
  baseFrontierDigest: DigestV2
  computedFrontierDigest: DigestV2
  actorHeadBoundaryDigest: DigestV2
  stateVectorDigest: DigestV2
  canonicalStateDigest: DigestV2
  fullUpdateDigest: DigestV2
  fullUpdateByteLength: Uint64V2
  protocolDigest: DigestV2
  schemaDigest: DigestV2
  canonicalizerDigest: DigestV2
  validationArtifactSetDigest: DigestV2
}

interface ReplicaCheckpointV2 {
  format: "convax.replica-checkpoint/2"
  core: ReplicaCheckpointCoreV2
  coreDigest: DigestV2
  replicaSignature: SignatureV2
}
```

An actor-signed checkpoint is only `checkpoint-candidate`. Parent declarations are
lookup bindings, not proof of dominance or pruning authority.

`authorAuthorizationDigest` resolves the exact
`ReplicaActorCredentialV2.coreDigest`. Before accepting the candidate or certifying
its content, the verifier also resolves that credential's
`replicaIdReservationReceiptDigest` as a retained credential dependency and checks
the service signature plus exact Project epoch/member/replica/key binding against
the immutable membership snapshot used by the checkpoint closure. It then derives
the Yjs client id only through the kernel's imported `ReplicaIdV2` mapping and
rejects any state-vector/update client id not backed by that credential chain.
Pruning a checkpoint's causal payload MUST retain the membership snapshot, actor
credential and reservation receipt needed for this verification; a current snapshot
or newly allocated id cannot substitute for any exact digest.

### 8.2 Streaming carrier

The transient carrier byte layout is:

```text
8 bytes  ASCII "CVXCAR02"
8 bytes  u64be indexLength
N bytes  exact JCS CheckpointValidationCarrierIndexV2
...      exact concatenated section bytes in index order
```

```ts
interface CheckpointCarrierSectionV2 {
  ordinal: Uint32V2
  kind: "proposal-checkpoint" | "proposal-snapshot" | "parent-checkpoint" |
    "parent-snapshot" | "content-certificate" | "causal-frame" |
    "validation-artifact"
  subjectDigest: DigestV2
  byteOffset: Uint64V2 // from first byte after index
  byteLength: Uint64V2
  sha256: DigestV2
}

interface CheckpointValidationCarrierIndexV2 {
  format: "convax.checkpoint-validation-carrier-index/2"
  scope: DocumentScopeV2
  proposalCheckpointDigest: DigestV2
  parentCheckpointDigests: readonly DigestV2[]
  suffixFrameDigests: readonly DigestV2[]
  validationArtifactSetDigest: DigestV2
  sections: readonly CheckpointCarrierSectionV2[]
  totalSectionBytes: Uint64V2
  protocolDigest: DigestV2
}
```

Sections are contiguous, ordinal starts 0, offsets have no gap/overlap and each
subject occurs in its allowed cardinality. Index is <=4 MiB; proposal snapshot is
<=32 MiB; proposal plus all parent snapshots <=256 MiB; suffix <=4,096 frames and
64 MiB; validation-artifact sections are <=64; total sections are <=4,224; whole
encoded carrier including magic/index/sections <=320 MiB. Independent section
ceilings need not be jointly attainable. Reject length/count/hash before allocation;
compression is forbidden in v2 carrier.

The isolated attester streams sections, uses ephemeral process-scoped storage,
validates exact parents/suffix/bases/frames/intents/closed writes/schema/artifacts/
invariants/hashes and destroys all section bytes on success, rejection, cancellation
or crash recovery. Executable-only Plugin artifacts make attestation unavailable;
the attester never executes Plugin JavaScript/WASM.

### 8.3 Content certificate

```ts
interface CheckpointContentCertificateCoreV2 {
  format: "convax.checkpoint-content-certificate-core/2"
  scope: DocumentScopeV2
  checkpointDigest: DigestV2
  parentCertificateDigests: readonly DigestV2[] // sorted, 0..8
  computedFrontierDigest: DigestV2
  actorHeadBoundaryDigest: DigestV2
  stateVectorDigest: DigestV2
  canonicalStateDigest: DigestV2
  fullUpdateDigest: DigestV2
  protocolDigest: DigestV2
  schemaDigest: DigestV2
  canonicalizerDigest: DigestV2
  validationArtifactSetDigest: DigestV2
  trustBundleDigest: DigestV2
  contentStatus: "service-validated-causal-closure"
  serviceKeyPurpose: "content-attestation"
  serviceKeyId: string
}

interface CheckpointContentCertificateV2 {
  format: "convax.checkpoint-content-certificate/2"
  core: CheckpointContentCertificateCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

Certificate has no payload bytes. Failure or unavailable attestation leaves normal
edits/Peer sync active and full genesis history retained; there is no metadata-only
pruning fallback.

### 8.4 Owner canonicalizer and atomic registry audit

Control and the isolated attester MUST NOT define a Canvas or ProjectIndex
canonicalizer or copy either owner's root topology, record schema, reducer,
canonical-state encoder or digest-material registry. The ordinary control API handles
only metadata and digests. The isolated attester receives bounded carrier bytes
ephemerally and selects the owner exclusively through the exact kernel
`DocumentOwnerProtocolPortV2<K>` instantiated from the validation artifact set.

The selected port exposes the kernel-owned exact
`OwnerCanonicalizerDescriptorV2`, whose format and sole digest domain are both
`convax.owner-canonicalizer-descriptor/2`. Its `owner`, `ownerSchemaDigest`,
`canonicalStateFormat`, codec and fail-closed policies validate exactly, and its
digest recomputes over that exact descriptor. Canvas-specific descriptors,
`convax.canvas-canonicalizer/2`, copied root topology or alternate owner-local
canonicalizer preimages are `attestation-rejected`. Owner encoding/topology remains
normative only inside the selected owner artifact transitively bound by
`ownerSchemaDigest`.

The attester verifies this chain without redeclaring owner schema:

1. carrier `protocolDigest` equals the exact parsed
   `ProtocolSchemaBundleV2.coreDigest`;
2. validation artifact-set digest recomputes, includes the exact four protocol owner
   artifacts and every declarative Plugin artifact required by the reconstructed
   closure;
3. selected owner artifact digest equals the checkpoint/frame `schemaDigest` or
   `ownerSchemaDigest` named by that DTO;
4. instantiated port's `owner` equals `scope.docKind`, its `schemaDigest` equals both
   selected artifact digest and descriptor `ownerSchemaDigest`, descriptor
   format/domain equal the kernel values, and recomputed `canonicalizerDigest` equals
   the checkpoint, every replayed frame and every parent certificate value;
5. every frame base/post canonical-state digest recomputes with the kernel
   `convax.canonical-state/2` formula over exact bytes returned by that owner port's
   `canonicalStateBytes`;
6. after exact parent/suffix replay, proposal snapshot state-vector, full-update and
   canonical-state digests, frontier and actor-head boundary all recompute and equal
   the checkpoint candidate;
7. emitted content certificate copies the byte-identical `protocolDigest`,
   `schemaDigest`, `canonicalizerDigest`, `validationArtifactSetDigest`, state-vector,
   full-update and canonical-state digests from the verified result.

An unknown/missing owner artifact or descriptor is `attestation-unavailable`; a
digest mismatch or owner-port output mismatch is `attestation-rejected`. The
attester MUST NOT fall back to repository code, a newer current owner, artifact
name, React projection, JavaScript object enumeration or Yjs internal struct
hashing. The owner port is executable validation authority only through the exact
artifact-set binding. Control may persist the resulting certificate and section
digests, but destroys all carrier/state bytes on success, rejection, cancellation
and crash cleanup.

The final bundle registry is generated mechanically as the strict UTF-8 sorted,
duplicate-free union of the four standalone artifact contribution lists. This
annex does not inherit a prior registry count and does not restate Canvas or Project
domain contributions. A duplicate, unsorted value, missing owner contribution or
owner-private canonicalizer domain rejects bundle generation before attestation or
reset verification.

## 9. Causal floors and prunable checkpoint sets

```ts
interface StableCheckpointSetCoreV2 {
  format: "convax.stable-checkpoint-set-core/2"
  scope: DocumentScopeV2
  priorSetDigest: DigestV2 | null
  contentCertificateDigests: readonly DigestV2[] // sorted unique, 1..8
  mergedFrontierDigest: DigestV2
  actorHeadBoundaryDigest: DigestV2
  membershipSnapshotDigest: DigestV2
  protocolDigest: DigestV2
  validationArtifactSetDigest: DigestV2
}

interface ReplicaCausalFloorAckCoreV2 {
  format: "convax.replica-causal-floor-ack-core/2"
  stableSetCoreDigest: DigestV2
  replicaId: ReplicaIdV2
  actorId: ActorIdV2
  replicaActorCredentialDigest: DigestV2
  actorHeadAtAck: CausalHeadRefV2 | null
  durableCheckpoint: true
  validatedExactClosure: true
  installedMonotonicFloor: true
}

interface ReplicaCausalFloorAckV2 {
  format: "convax.replica-causal-floor-ack/2"
  core: ReplicaCausalFloorAckCoreV2
  coreDigest: DigestV2
  replicaSignature: SignatureV2
}

interface PrunableCheckpointSetCertificateCoreV2 {
  format: "convax.prunable-checkpoint-set-certificate-core/2"
  stableSetCore: StableCheckpointSetCoreV2
  floorAckDigests: readonly DigestV2[] // sorted, exact active-editor set, <=256
  contentStatus: "service-validated-and-all-editors-acknowledged"
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "checkpoint-stability"
  serviceKeyId: string
}

interface PrunableCheckpointSetCertificateV2 {
  format: "convax.prunable-checkpoint-set-certificate/2"
  core: PrunableCheckpointSetCertificateCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

Before signing an ACK, an active or pending editor independently validates and
fsyncs every certified checkpoint in the exact set, proves all its durable local
heads are included and persists the monotonic floor. Service issues the prunable
certificate only when ACKs exactly cover the active-editor replicas of the bound
membership snapshot. A pending-editor ACK is valid installation evidence for its
later Project-floor root but is not counted toward pruning; viewer ACK is neither
valid nor counted. Membership change makes incomplete collection stale. Only the
final certificate authorizes causal-payload pruning and post-prune bootstrap.

### 9.1 Project-wide installed floor for editor activation

Global edit authorization cannot be inferred from one Canvas ACK. A pending editor
therefore obtains a service-certified, replica-specific paging root over the exact
current content-certified ProjectIndex route projection:

```ts
interface ReplicaProjectFloorEntryV2 {
  scope: DocumentScopeV2
  basis: "project-index" | "project-index-live-route"
  prunableCheckpointSetCertificateDigest: DigestV2
  replicaCausalFloorAckDigest: DigestV2
}

interface ReplicaProjectFloorPageCoreV2 {
  format: "convax.replica-project-floor-page-core/2"
  floorSetId: Id128V2
  targetReplicaId: ReplicaIdV2
  pageIndex: Uint32V2
  firstScopeKey: string
  lastScopeKey: string
  entries: readonly ReplicaProjectFloorEntryV2[]
}

interface ReplicaProjectFloorPageV2 {
  format: "convax.replica-project-floor-page/2"
  core: ReplicaProjectFloorPageCoreV2
  coreDigest: DigestV2
}

interface ReplicaProjectFloorRootCoreV2 {
  format: "convax.replica-project-floor-root-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  floorSetId: Id128V2
  targetMemberId: MemberIdV2
  targetReplicaId: ReplicaIdV2
  targetActorId: ActorIdV2
  targetReplicaAuthorizationEpoch: Id128V2
  membershipSnapshotDigest: DigestV2
  projectIndexLiveScopeManifestDigest: DigestV2
  registrySequence: Uint64V2
  registryRootDigest: DigestV2
  requiredScopeSetPolicy: "project-index-plus-certified-live-routes"
  unlistedScopePolicy: "registry-only-is-advisory-and-never-blocks-or-grants"
  pageDigests: readonly DigestV2[]
  entryCount: Uint32V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "checkpoint-stability"
  serviceKeyId: string
}

interface ReplicaProjectFloorRootV2 {
  format: "convax.replica-project-floor-root/2"
  core: ReplicaProjectFloorRootCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

`RequiredProjectFloorScopeSetV2` is exactly the ProjectIndex scope union every scope
in the bound `ProjectIndexLiveScopeManifestV2.entries`. The manifest is produced by
the public Project verifier from one exact content-certified ProjectIndex
checkpoint's current live, non-tombstoned Canvas routes and binds that checkpoint,
content certificate, canonical state and frontier. It contains <=4,095 Canvas
scopes; with ProjectIndex the required set contains <=4,096 scopes. Entries sort by
exact JCS `DocumentScopeV2`, are duplicate-free and cover that set exactly. Basis is
`project-index` for the one ProjectIndex entry and
`project-index-live-route` for every manifest entry. Each binds a current prunable
certificate and exact floor ACK signed by the target replica for that certificate's
stable set. Pages contain <=512 entries and <=512 KiB; page count <=8 and aggregate
pages <=4 MiB. Page digests are ordered; first/last scope keys are range checks only.
The service verifies every page before signing the root and stores pages/root as
metadata.

`registrySequence` and `registryRootDigest` are anti-rollback observations only.
Registry absence, candidate, abandoned or dual-validated presence MUST NOT add or
remove a required scope, grant scope, or block activation. Registry-only scopes MAY
be advisory prefetch hints outside these pages; they do not count toward
`entryCount`, require no floor and missing bytes do not deny activation. The
activation transaction revalidates that the manifest is still the current exact
content-certified ProjectIndex projection and that membership is current; any live
route or membership change makes the root stale. Missing page, stale manifest/root
or omitted required scope keeps the replica pending. There is no partial Project
editor authorization and no registry-derived Project scope authority.

## 10. Registered-scope state machine

### 10.1 Registration and abandonment

```ts
interface DocumentRegistrationClaimCoreV2 {
  format: "convax.document-registration-claim-core/2"
  scope: DocumentScopeV2
  registrarMemberId: MemberIdV2
  registrarReplicaId: ReplicaIdV2
  registrarActorId: ActorIdV2
  registrarAuthorizationDigest: DigestV2
  claimRevision: Uint64V2
  genesisCheckpointDigest: DigestV2
  projectIndexRouteDependencyDigest: DigestV2
  protocolDigest: DigestV2
}

interface DocumentRegistrationClaimV2 {
  format: "convax.document-registration-claim/2"
  core: DocumentRegistrationClaimCoreV2
  coreDigest: DigestV2
  replicaSignature: SignatureV2
}

interface DocumentRegistrationAbandonmentCoreV2 {
  format: "convax.document-registration-abandonment-core/2"
  registrationClaimDigest: DigestV2
  scope: DocumentScopeV2
  claimRevision: Uint64V2
  actor: { kind: "registrar"; replicaId: ReplicaIdV2 } |
    { kind: "project-admin"; memberId: MemberIdV2; adminCapabilityDigest: DigestV2 }
  reason: "cancelled" | "invalid-genesis" | "superseded-staging"
  protocolDigest: DigestV2
}

interface DocumentRegistrationAbandonmentV2 {
  format: "convax.document-registration-abandonment/2"
  core: DocumentRegistrationAbandonmentCoreV2
  coreDigest: DigestV2
  actorSignature: SignatureV2
}
```

Claim is <=64 KiB. Entry identity is exact canonical
`{scopeKey,registrarReplicaId,claimRevision}`. Revision starts at `"1"` and advances
exactly +1 only after terminal abandonment. Duplicate exact claim is idempotent;
gap/conflict fails. Original registrar or Project admin may abandon a candidate;
abandonment cannot undo a completed registration.

```ts
interface CollaborationScopeEntryCoreV2 {
  format: "convax.collaboration-scope-entry-core/2"
  scopeKey: string // exact JCS DocumentScopeV2
  registrarReplicaId: ReplicaIdV2
  claimRevision: Uint64V2
  registrationClaimDigest: DigestV2
  state: "registered-candidate" | "dual-validated" | "abandoned"
  projectIndexContentCertificateDigest: DigestV2 | null
  canvasGenesisContentCertificateDigest: DigestV2 | null
  genesisPrunableSetDigest: DigestV2 | null
  abandonmentDigest: DigestV2 | null
}

interface CollaborationScopeEntryV2 {
  format: "convax.collaboration-scope-entry/2"
  core: CollaborationScopeEntryCoreV2
  coreDigest: DigestV2
}
```

`coreDigest` is the `convax.collaboration-scope-entry-core/2` digest. Registry
snapshots and cutoff leaves bind that digest; there is no separately mutable entry
payload behind the digest. A state transition publishes a new content-addressed
entry object for the same claim revision while retaining the authenticated earlier
bytes; only a terminal abandonment followed by a new claim advances
`claimRevision`.

Registry finalization requires exact ProjectIndex dependency plus Canvas genesis content
certificate and all-editor floor proof. Registry is discovery/security metadata,
not route/edit/bootstrap authority. Absence never denies a scope proved from
ProjectIndex and causal evidence. It stores no title, URI, location, active Canvas
or staged/live/closed field.

### 10.2 Registry snapshot and fold

```ts
interface RegistryEntrySetV2 {
  format: "convax.registry-entry-set/2"
  entries: readonly CollaborationScopeEntryV2[]
}

interface RegistrySnapshotCoreV2 {
  format: "convax.registry-snapshot-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  registrySequence: Uint64V2
  priorRegistryDigest: DigestV2 | null
  entriesDigest: DigestV2
  entryCount: Uint32V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "registry-cutoff"
  serviceKeyId: string
}

interface RegistrySnapshotV2 {
  format: "convax.registry-snapshot/2"
  core: RegistrySnapshotCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

`entries` are sorted by the leaf order below and contain exactly one current entry
object for each retained identity; duplicate identity fails. `entriesDigest` is the
`convax.registry-entry-set/2` digest of that exact closed set. `registryRootDigest`
elsewhere means the exact `RegistrySnapshotV2.coreDigest`; `priorRegistryDigest`
means its immediate predecessor core digest. The signature wrapper remains
retrievable by either digest. Thus an implementation cannot substitute a mutable
database query for the signed registry root or invent a different entry-list hash.

Leaves order by `(UTF8(scopeKey), decoded registrarReplicaId, unsigned revision)`.
For a scope/registrar only its highest authenticated contiguous legal revision
participates. Per scope, any participating dual-validated leaf dominates candidate/
abandoned empty leaves; multiple certified target frontiers combine by deterministic
`Max`; no dual leaf means empty. All retained revisions still count toward caps.

## 11. Cutoff target, coverage and authorization mutation

### 11.1 Closed target

```ts
type RegistryCutoffTargetV2 =
  | {
      kind: "replica"
      action: "revoke"
      memberId: MemberIdV2
      priorMemberAuthorizationEpoch: Id128V2
      replicaId: ReplicaIdV2
      actorId: ActorIdV2
      priorReplicaAuthorizationEpoch: Id128V2
    }
  | {
      kind: "member"
      action: "revoke" | "downgrade-to-viewer"
      memberId: MemberIdV2
      priorMemberAuthorizationEpoch: Id128V2
      targetedReplicaActorSet: readonly {
        replicaId: ReplicaIdV2
        actorId: ActorIdV2
        priorReplicaAuthorizationEpoch: Id128V2
      }[]
    }
```

Member target set is exact pre-mutation active-editor replicas for that member,
sorted by decoded replicaId, unique and <=8. Service compares it to the immutable
before snapshot. Wrong kind/action, omission, duplicate or epoch mismatch fails.

### 11.2 Coverage leaves, pages and root

```ts
interface RegistryEntryIdentityV2 {
  format: "convax.registry-entry-identity/2"
  scopeKey: string
  registrarReplicaId: ReplicaIdV2
  claimRevision: Uint64V2
}

interface TargetCutoffLeafCoreV2 {
  format: "convax.target-cutoff-leaf-core/2"
  entryIdentity: RegistryEntryIdentityV2
  entryDigest: DigestV2
  entryState: "registered-candidate" | "dual-validated" | "abandoned"
  targetFrontier: { kind: "certified"; frontierDigest: DigestV2 } |
    { kind: "empty-target-frontier" }
}

interface RegistryCutoffCoveragePageCoreV2 {
  format: "convax.registry-cutoff-coverage-page-core/2"
  cutoffId: Id128V2
  pageIndex: Uint32V2
  firstLeafIdentityDigest: DigestV2
  lastLeafIdentityDigest: DigestV2
  leaves: readonly TargetCutoffLeafCoreV2[]
}

interface RegistryCutoffCoveragePageV2 {
  format: "convax.registry-cutoff-coverage-page/2"
  core: RegistryCutoffCoveragePageCoreV2
  coreDigest: DigestV2
}

interface RegistryCutoffCoverageRootCoreV2 {
  format: "convax.registry-cutoff-coverage-root-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  cutoffId: Id128V2
  target: RegistryCutoffTargetV2
  beforeMembershipSnapshotDigest: DigestV2
  afterMembershipSnapshotDigest: DigestV2
  registrySequence: Uint64V2
  registryRootDigest: DigestV2
  unlistedScopePolicy: "empty-target-frontier"
  pageDigests: readonly DigestV2[]
  leafCount: Uint32V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "registry-cutoff"
  serviceKeyId: string
}

interface RegistryCutoffCoverageRootV2 {
  format: "convax.registry-cutoff-coverage-root/2"
  core: RegistryCutoffCoverageRootCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

`RegistryCutoffCoveragePageV2.coreDigest` is the exact page digest stored in the
ordered root `pageDigests`. Pages carry no independent signature: the signed root
authenticates their complete ordered digest set, and a page with any non-matching
core digest is rejected before a leaf is interpreted.

`firstLeafIdentityDigest` and `lastLeafIdentityDigest` are
`convax.registry-entry-identity/2` digests of the first and last leaf identities.
They are range commitments, not standalone non-membership proofs.

One <=1 KiB leaf exists for every retained entry. Pages contain <=512 leaves and
<=512 KiB; page count <=8, leaf count <=4,096 and aggregate pages <=4 MiB. Page
order and ranges are deterministic. Root is <=64 KiB. A member certified frontier
covers the union of every listed actor; empty excludes all listed actors.

A scope is unlisted only after every ordered page verifies. There is no v2 compact
non-membership proof. Missing page yields `cutoff-coverage-incomplete`; until
complete, no target frame is accepted/excluded and no team-ready rebuild is claimed.
Current mutable registry never substitutes for immutable coverage.

### 11.3 Authorization mutation

```ts
interface AuthorizationMutationCoreV2 {
  format: "convax.authorization-mutation-core/2"
  mutationId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  membershipEpoch: Id128V2
  target: RegistryCutoffTargetV2
  beforeMembershipSnapshotDigest: DigestV2
  afterMembershipSnapshotDigest: DigestV2
  registryCutoffCoverageRootCoreDigest: DigestV2
  closedSessionCredentialDigests: readonly DigestV2[]
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "registry-cutoff"
  serviceKeyId: string
}

interface AuthorizationMutationV2 {
  format: "convax.authorization-mutation/2"
  core: AuthorizationMutationCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

Membership snapshot, mutation, coverage root and every page commit atomically. The
same closed target/action is byte-identical in mutation and root. Authorization may
close before peers fetch material; state is then `cutoff-material-unavailable` or
`cutoff-coverage-incomplete`, never team-ready. Target frames in explicit certified
closure survive; outside frames and their dependent descendants are recovery-only;
independent actors remain eligible.

### 11.4 Canonical generation first-loss receipt

```ts
interface GenerationFirstLossReceiptCoreV2 {
  format: "convax.generation-first-loss-receipt-core/2"
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  beginActorId: ActorIdV2
  beginAuthorizationEpochDigest: DigestV2
  authorizationMutationDigest: DigestV2
  cutoffCoverageRootCoreDigest: DigestV2
  firstLossSequence: Uint64V2
  protocolDigest: DigestV2
  trustBundleDigest: DigestV2
  serviceKeyPurpose: "registry-cutoff"
  serviceKeyId: string
}

interface GenerationFirstLossReceiptV2 {
  format: "convax.generation-first-loss-receipt/2"
  core: GenerationFirstLossReceiptCoreV2
  coreDigest: DigestV2
  serviceSignature: SignatureV2
}
```

Exactly one canonical receipt exists for an exact actor authorization instance. It
binds the exact `BeginAuthorizationEpochV2.coreDigest` that the Canvas begin binds;
raw authorization epochs are not interchangeable. It does not assert Canvas
begin/terminal state; Project's pure verifier combines it with exact cutoff and
Canvas facts before producing a non-serializable recovery permit.

## 12. Quotas and hard limits

All count and byte limits apply together before allocation, parsing or mutation.

| Scope/object | Limit |
| --- | ---: |
| service trust keys | 32 |
| active Project members | 256 |
| retained revoked members/projectEpoch | 4,096 |
| members in one membership snapshot | 4,352 |
| active replicas/member | 8 |
| active replicas/Project including viewers | 512 |
| active editor replicas/Project | 256 |
| retained revoked/replaced replicas/projectEpoch | 4,096 |
| replicas in one membership snapshot | 4,608 |
| replica-id allocations/Project epoch | 16,384 |
| replica-id allocations/member/Project epoch | 64 |
| pending replica-id reservations/member | 4 |
| pending replica-id reservations/Project | 512 |
| replica-id reservation consumption TTL | 60 seconds |
| active session/replica | 1 |
| active peer directory entries | 512 |
| closed session digests/mutation | 8 |
| closed session digests/Project epoch rollover | 512 |
| pending session challenges/replica | 4 |
| pending mutation challenges/member | 4 |
| pending Project reset challenges/Project | 2 |
| pending Canvas shard-reset approvals/Project | 64 |
| session credential TTL | 15 minutes |
| mutation/session challenge TTL | 60 seconds |
| freshness ticket TTL | 60 seconds |
| normal service request JCS | 64 KiB |
| membership snapshot | 2 MiB |
| registration claim | 64 KiB |
| outstanding registry candidates/active replica | 4 |
| retained registry entries/member | 1,024 |
| retained registry entries/Project | 4,096 |
| retained registry claim payload/Project | 64 MiB |
| cutoff leaf/page/root | 1 KiB / 512 KiB / 64 KiB |
| cutoff pages/leaves/aggregate | 8 / 4,096 / 4 MiB |
| Project floor pages/entries/aggregate | 8 / 4,096 / 4 MiB |
| Peer inventory pages/documents per page/documents | 128 / 32 / 4,096 |
| pending incomplete inventories/Peer | 2 |
| blob-have entries/query | 256 |
| reset confirmation/approval/challenge/proof/receipt JCS | 64 KiB each |
| checkpoint snapshot | 32 MiB |
| checkpoint parents/stable-set certificates | 8 / 8 |
| checkpoint frontier heads | 256 |
| proposal plus parent snapshots | 256 MiB |
| validation suffix | 4,096 frames and 64 MiB |
| encoded attester carrier | 320 MiB |
| carrier sections / validation artifacts | 4,224 / 64 |
| control/awareness message | 64 KiB / 16 KiB |
| update/blob chunk | 256 KiB / 1 MiB |
| inflight update transfers/Peer | 4 |
| inflight blob chunks/Peer | 4 |
| pending remote inbox/document | 4,096 frames and 256 MiB |
| pending remote inbox/actor | 512 frames and 32 MiB |
| local replication outbox/document | 4,096 frames and 512 MiB |
| retained durable ACKs/frame | 32 |
| quarantine/Project | 1,024 objects and 128 MiB |

Finalization/abandonment frees an outstanding registry slot, never a retained entry.
Capacity never authorizes eviction of referenced snapshot/certificate/cutoff/trust
metadata. Trusted local outbox exhaustion blocks new mutation; untrusted Peer queue
exhaustion rejects the sender without damaging durable state.

## 13. Service durable store and payload-zero boundary

The durable control-plane store may contain only:

- trust bundles and referenced retired keys;
- current Project/membership epochs, members, replicas, counters and immutable
  membership snapshots;
- per-Project-epoch replica-id allocator high-water/counts, immutable reservation
  requests/receipts, idempotency indexes and reserved/consumed/abandoned records;
- mutation/session challenges, consumed nonce high-water, exact idempotency receipts,
  current sessions and signed credentials;
- active peer directory projections, freshness-ticket replay records and bounded
  audit counters;
- checkpoint candidate headers, content certificates, stable-set cores, causal-floor
  ACK digests, prunable certificates and replica Project-floor pages/roots;
- shard-reset confirmations/approvals and their idempotency identities;
- Project-reset confirmations/approvals, epoch-rollover challenges, empty-genesis
  attestations, exact rollover receipts and Project reset-counter high-water;
- registration claims/entries/abandonments, registry snapshots, cutoff roots/pages,
  authorization mutations and first-loss receipts.

It MUST NOT durably store any Yjs update/state vector/snapshot bytes, causal-frame or
typed-intent payload, Plugin state, Canvas/ProjectIndex state, validation carrier,
Project file/blob bytes, media chunk, awareness value or native path. These bytes
MUST NOT enter logs, traces, analytics, exception bodies, dead-letter queues, retry
bodies, database query text or crash dumps under application control.

The ordinary API/router rejects payload carriers. Only the isolated attester accepts
the carrier through a streaming port. Attester durable adapters expose no payload
write method. A bounded audit records request id, byte count, section digests,
certificate/rejection code and cleanup result, never content. Crash startup removes
unrecoverable ephemeral storage before serving another request and cannot resume an
old carrier from durable payload.

Service CAS may order membership, registry, cutoff and checkpoint-GC metadata. None
of those sequences enter Lamport, portable stamps, Project/Canvas projection or
ordinary edit acceptance.

## 14. Failure-state contract

| State/error | Required result |
| --- | --- |
| `service-unavailable` | existing replica edits locally; no new session/ticket/certificate/mutation |
| `challenge-expired` / `challenge-replayed` | no state change; request a new challenge |
| `idempotency-equivocation` | retain first receipt, reject conflicting digest, audit principal |
| `membership-stale` | reject transaction; fetch exact current snapshot |
| `replica-id-reservation-invalid` / `replica-id-reservation-stale` | allocate or consume nothing; obtain a reservation from exact current member state |
| `replica-id-reservation-expired` / `replica-id-reservation-consumed` | consume no mutation; exact retry may return a committed mutation receipt, otherwise request a fresh id |
| `replica-id-reservation-capacity-exceeded` | allocate nothing; free pending capacity or require explicit Project reset at a lifetime cap |
| `replica-id-space-exhausted` | allocate nothing; only explicit Project reset creates another allocator epoch |
| `pending-editor` | structure bootstrap/floor install allowed; edit signing forbidden |
| `session-replaced` / `session-expired` | close transport; historical frames unchanged |
| `peer-handshake-rejected` | open no channels and allocate no transfer state |
| `channel-desynchronized` | close only channel first, then connection if control or repeated strike |
| `peer-inventory-incomplete` | infer no absence and begin no reconciliation; request exact missing pages or replace root |
| `transfer-capacity-exceeded` | NACK before allocation; other channels continue |
| `dependency-pending` | store bounded reference/bytes at peer only; do not project or durable-ACK |
| `checkpoint-candidate` | discovery only; no prune/bootstrap authority |
| `attestation-unavailable` / `attestation-rejected` | edits continue; retain genesis history |
| `awaiting-editor-floors` | checkpoint content valid but unprunable |
| `floor-membership-stale` | discard incomplete ACK collection and retry on new snapshot |
| `floor-project-index-stale` | keep replica pending; rebuild from current certified live-scope manifest |
| `checkpoint-payload-unavailable` | fresh bootstrap waits; seeded replica remains editable |
| `scope-candidate` / `scope-awaiting-dual-validation` | registry metadata only, no route authority |
| `scope-abandoned` | terminal audit entry; retry needs next contiguous revision |
| `scope-capacity-exceeded` | reject registration; seeded Peer sync remains available |
| `registry-rollback-quarantine` | reject lower/same-sequence-different-root response |
| `cutoff-material-unavailable` | authorization closed; exact rebuild waits |
| `cutoff-coverage-incomplete` | accept/exclude no target frame; no team-ready claim |
| `recovery-available` | excluded exact bytes are read-only; export or new explicit intent only |
| `rsa-envelope-invalid` / `rsa-limit-exceeded` / `rsa-index-invalid` | publish/delete nothing; reject the exact carrier bytes before semantic processing |
| `rsa-section-invalid` / `rsa-digest-binding-invalid` / `rsa-signature-invalid` | publish/delete nothing; reject the exact carrier and obtain a newly constructed structural carrier |
| `reset-confirmation-invalid` | delete/publish nothing; obtain a new exact confirmation |
| `team-epoch-rollover-pending` | staged empty bytes remain inert; old Project epoch stays sole authority |
| `old-project-epoch-retired` | reject old credentials/frames from live admission; retain only explicit recovery bytes |
| `reset-recovery-required` | keep Project closed and resume the exact reset id/receipt; never synthesize mixed trees |

Session/channel cancellation is not domain rollback. A durable frame/blob/checkpoint
remains durable even if its transfer ACK response is lost.

## 15. Golden, model and security tests

### 15.1 Byte and cross-runtime goldens

Bun, Chromium and service/attester codecs MUST produce byte-identical JCS, digest
and signature preimages for:

1. every primitive boundary, malformed base64url/hex/uint and closed-object unknown
   key;
2. trust bundle, membership snapshot, member/actor/edit/session credentials and the
   exact reservation-receipt binding in each replica authority;
3. replica-id reservation request/receipt/allocator/state boundaries, every
   mutation/session challenge, proof, receipt and idempotent retry;
4. begin-authorization-epoch, shard/Project reset confirmation and approval,
   team rollover challenge/proof/empty-genesis attestation/receipt;
5. ticket, handshake, four channel opens and first/successor/replayed messages;
6. inventory root/pages, canonical frontier/head/state-vector requests, blob-have
   query/response and transfer offer/chunks/ACK/NACK/cancel at bounds;
7. frame and blob durable ACKs;
8. checkpoint candidate/carrier index/content certificate/stable core/floor ACK/
   prunable certificate/replica Project-floor page and root;
9. registration retry/abandon/fold and cutoff leaf/page/root/mutation;
10. replica and multi-replica member target signatures under revoke/downgrade.

The imported kernel `ProtocolSchemaBundleV2.coreDigest`, this artifact's exact-byte
digest and both control constant digests are identical in all three runtimes. Any
locally copied constant or schema with another digest fails pack and startup
conformance.

### 15.2 State-machine tests

- Replay, expire and reorder challenges; exact retry returns the same receipt and
  conflicting retry never consumes a second sequence.
- Concurrently reserve from the same Project-epoch high-water and prove every
  committed request gets a distinct ascending `ReplicaIdV2`; lose each response and
  prove exact `allocationRequestId + coreDigest` retry returns byte-identical
  receipt while same id/different digest is equivocation.
- Verify `replica_00010203` decodes to Yjs client id `66051`; reject zero, uppercase,
  short, long and overflow ids before reservation or checkpoint validation.
- Expire, explicitly abandon and membership-stale each reservation, then prove the
  burned id is never allocated again. Exercise pending/member/Project allocation
  caps at exact maximum and plus one. Inject a synthetically valid near-uint32-
  high-water allocator state and prove wrap/zero fails even though the normal
  lifetime cap is reached first; only a new Project epoch may restart at
  `replica_00000001`.
- Swap a reservation receipt between members, Project epochs, keys, assigned ids,
  snapshot records, actor credentials, edit authorizations and checkpoints; every
  mismatch fails before authority or payload admission. After checkpoint pruning,
  prove the exact retained receipt/credential chain still validates its Yjs client
  ids without consulting current membership.
- Replace a session and race old/new ticket requests; only the current lease appears
  in directory or obtains a ticket.
- Activate viewer replicas: none receives edit authorization before its exact floor;
  withhold one Project-floor page or race a certified ProjectIndex live-route change
  and prove activation remains pending; a registry-only stale/tombstoned scope never
  blocks activation and viewer absence never blocks pruning.
- Revoke one replica among three and prove siblings survive; revoke/downgrade the
  member and prove one closed target covers exactly all pre-mutation editor actors.
- Register/abandon/retry claims in every order; only contiguous highest legal
  revision participates and registry never changes ProjectIndex visibility.
- Withhold one of eight cutoff pages; no target frame is accepted/excluded until the
  last page verifies.
- Run two, three and nine Peer reconnect permutations with duplicate inventory,
  offers, chunks, cancellations and ACK-response loss; object identity and durable
  status remain invariant.
- Omit/reorder/replace an inventory page and prove no absence is inferred; exchange
  exact actor-head/frontier/state-vector commitments and prove dependency traversal
  converges independent of reconnect order.
- Replay shard-reset confirmation against another claim/scope and Project-reset
  approval against another inventory/epoch; reject both. Crash each rollover
  transaction boundary and expose only the complete old or complete new epoch.

### 15.3 Security and durability tests

- Attempt peerId impersonation, cross-project ticket use, credential-position swap,
  channel-open replay, message-sequence rollback and same transferId/new manifest.
- Clone a replica key and double-sign one actor sequence; quarantine both forks and
  tainted descendants independent of arrival order.
- Saturate blob channel and prove control cutoff messages, updates and awareness are
  not head-of-line blocked.
- Crash after every membership/cutoff/root/page/signature transaction boundary;
  expose either the complete before or complete after state, never partial auth.
- Crash before and after allocator high-water, reservation receipt/state,
  membership snapshot, actor credential and mutation-receipt writes; expose either
  no allocation or one permanently unique reservation, and never a credential whose
  reservation remains unconsumed.
- Fail service signing/storage and local fsync/swap at every Project-reset boundary;
  never publish a new Project epoch without the exact durable rollover receipt and
  never accept an old credential after its receipt commits.
- Inject attester success/rejection/cancel/crash at every carrier section. Forensic
  scans of DB/object store/log/trace/retry/crash-recovery find zero payload bytes.
- Submit hidden Y.Map, bad Plugin declarative artifact, invalid exact base and forged
  frontier; attester and honest editor reject consistently.
- Remove one active editor floor ACK or change membership mid-collection; pruning
  remains forbidden.
- Exercise every count/byte cap at exact maximum and plus one before allocation.

### 15.4 Reset-carrier structural tests

1. Generate the public declaration twice from only this artifact. Both outputs
   contain one closed `DocumentShardResetAuthorizationCarrierV2`, one exact-bytes
   alias, one result union, one callable verifier type and one function declaration.
2. Exercise complete-carrier and index sizes at exact maximum and plus one before
   allocation; truncated, trailing and integer-overflow envelopes reject.
3. Permute, overlap, gap, duplicate or extend any of the eleven named section
   locations; all reject before a semantic decoder is called.
4. Mutate every section byte and independently update or retain its `sha256`; stale
   hashes reject, while updated hashes still fail the owning DTO/signature checks.
5. A-claim plus B-confirmation rejects the initiator member, replica and actor
   equality independently, including two replicas of one member.
6. Replace a credential, reservation, trust bundle, admin capability or signature
   with another structurally valid object; exact digest/key binding rejects.
7. Embed an unknown Project reset/route field, old staged-genesis alias, raw
   `Id128V2` replica id or enclosing carrier digest; the imported Project validator
   rejects without a Control fallback shape.
8. Change Project/epoch/old-new scope/reason/route-CAS/staged-genesis repetitions;
   the earliest structural binding step rejects identically in Bun and Chromium.
9. Call the verifier twice over byte-identical input; results and complete
   `sha256` are byte-identical but neither result object is an authority.
10. Reflect every Control export and require zero Project RSA authority/factory,
    currentness, candidate/Y.Doc, owner-install, attempt-key, outbox or
    `queryAttempt` declaration.
11. Scan service storage, logs, traces and crash recovery after pass/failure; no
    carrier bytes, decoded Project/Canvas payload, verifier result or process binding
    is persisted.
12. Give an isolated consumer only the generated Control and declared Project
    protocol imports; every type resolves with no ambient declaration or duplicate
    owner type.

## 16. Closed reset-authorization carrier and structural verifier

### 16.1 Exact wire DTO

Control owns one closed binary carrier and no semantic wrapper:

```text
8 bytes  ASCII "CVXRSA02"
8 bytes  unsigned big-endian uint64 indexLength
N bytes  exact restricted-JCS DocumentShardResetAuthorizationCarrierV2
...      eleven contiguous exact section byte strings
```

```ts
type DocumentShardResetAuthorizationCarrierExactBytesV2 =
  Readonly<Uint8Array>

interface DocumentShardResetAuthorizationCarrierSectionLocationV2 {
  readonly byteOffset: Uint64V2
  readonly byteLength: Uint64V2
  readonly sha256: DigestV2
}

interface DocumentShardResetAuthorizationCarrierV2 {
  readonly format: "convax.document-shard-reset-authorization-carrier/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly oldScope: DocumentScopeV2 & {
    readonly docKind: "canvas"
    readonly docId: CanvasIdV2
  }
  readonly newScope: DocumentScopeV2 & {
    readonly docKind: "canvas"
    readonly docId: CanvasIdV2
  }
  readonly claim: DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
    readonly claimCoreDigest: DigestV2
  }
  readonly confirmation:
    DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
      readonly confirmationCoreDigest: DigestV2
    }
  readonly approval: DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
    readonly approvalCoreDigest: DigestV2
  }
  readonly routeCas: DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
    readonly routeCasCoreDigest: DigestV2
  }
  readonly resetCommit:
    DocumentShardResetAuthorizationCarrierSectionLocationV2
  readonly initiatorCredential:
    DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
      readonly credentialCoreDigest: DigestV2
    }
  readonly reservationReceipt:
    DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
      readonly reservationReceiptCoreDigest: DigestV2
    }
  readonly membershipSnapshot:
    DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
      readonly membershipSnapshotCoreDigest: DigestV2
    }
  readonly adminCapability:
    DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
      readonly adminCapabilityCoreDigest: DigestV2
    }
  readonly serviceTrustBundle:
    DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
      readonly serviceTrustBundleCoreDigest: DigestV2
    }
  readonly canvasGenesisProofCarrier:
    DocumentShardResetAuthorizationCarrierSectionLocationV2 & {
      readonly exactByteLength: Uint64V2
    }
  readonly totalSectionBytes: Uint64V2
  readonly protocolDigest: DigestV2
}
```

The eleven locations are strictly increasing, contiguous from byte offset zero
relative to the section area and cover `totalSectionBytes` exactly. Every `sha256`
is ordinary SHA-256 of its exact section bytes. The first ten sections decode,
respectively, as the Project-owned `DocumentShardResetClaimV2`,
Control-owned `DocumentShardResetConfirmationV2`,
Control-owned `DocumentShardResetApprovalV2`, Project-owned
`DocumentShardResetRouteCasCoreV2`, Project-owned
`CanvasRouteResetCommitV2`, and the Control-owned credential, reservation,
membership, admin-capability and trust wrappers. The final section is the exact
Canvas-owned `CVXCGP02` carrier bytes and is not decoded as a Control DTO.

The complete `CVXRSA02` bytes are at most
`documentShardResetAuthorizationCarrierBytes`; the final Canvas section is at most
`canvasGenesisProofCarrierBytes`; every other reset/control JCS section is at most
`resetControlObjectBytes`. All unsigned length arithmetic and the exact eleven
locations are validated before allocating the index or a section view.

The carrier index contains no digest of the enclosing `CVXRSA02` bytes. Project
claim, route-CAS and reset-commit DTOs likewise contain no enclosing-carrier digest;
this prevents a carrier-to-claim-to-carrier hash cycle. Project's process-local gate
binds the exact carrier byte object and plain verifier result to its live authority.

### 16.2 Sole synchronous verifier

```ts
type VerifyDocumentShardResetAuthorizationCarrierResultV2 =
  | Readonly<{
      status: "verified"
      carrier: DocumentShardResetAuthorizationCarrierV2
      sha256: DigestV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "rsa-envelope-invalid"
        | "rsa-limit-exceeded"
        | "rsa-index-invalid"
        | "rsa-section-invalid"
        | "rsa-digest-binding-invalid"
        | "rsa-signature-invalid"
    }>

type DocumentShardResetAuthorizationCarrierVerifierV2 = (
  exactBytes: DocumentShardResetAuthorizationCarrierExactBytesV2,
) => VerifyDocumentShardResetAuthorizationCarrierResultV2

declare const verifyDocumentShardResetAuthorizationCarrierV2:
  DocumentShardResetAuthorizationCarrierVerifierV2
```

The verifier makes one defensive copy, executes section 4.4.2 steps 1 through 13
synchronously and returns a fresh immutable result. It has no overload, callback,
port, Promise, phase, resume token, ambient lookup or private registry. The returned
`sha256` is ordinary SHA-256 of the complete exact carrier bytes and is diagnostic;
it is not a registered structured digest or portable authorization field.

### 16.3 Project semantic and ACK import seam

Project exclusively owns these process contracts and their brands:
`ProjectRsaOwnerAuthorityV2`, `ProjectRsaOwnerAuthorityFactoryInputV2`,
`ProjectDependencyCarrierOwnerAuthorityFactoryV2`,
`RemoteDependencyCarrierKindV2`,
`RemoteDependencyCarrierDurableReceiptV2<K>`,
`DependencyCarrierTransferAckAttemptKeyV2<K>`,
`EnsureDependencyCarrierTransferAckRequestV2<K>`,
`EnsureDependencyCarrierTransferAckResultV2`,
`QueryDependencyCarrierTransferAckResultV2` and
`DependencyCarrierTransferAckOutboxPortV2`. Control declares none of their fields,
brands, factories, currentness transitions, F13 semantic steps or `queryAttempt`.

The Project factory captures the exact
`DocumentShardResetAuthorizationCarrierVerifierV2` callable and its Control
artifact digest. Project invokes it over exact bytes and then independently performs
Canvas validation, current route/wanted-root/currentness, owner installation and
attempt-bound ACK policy. Desktop implements routing and wire transmission only.
No structural Control result, carrier hash or transport event mints Project
authority.

## 18. Isolation, counts and mandatory falsifiers

### 18.1 Native and transport isolation

Admission-publication heads, metadata-GC records, native kind-to-location maps,
trusted root handles, descriptor-relative traversal, no-follow validation,
conditional deletion and directory durability stay in `@convax/project/node`.
They are not portable control DTOs, evidence, carrier receipts or ACKs. Native record
formats do not add protocol domains solely by existing.

PeerJS lifecycle, concrete connections, message queues and routing remain Desktop
adapters. Portable Peer DTOs contain stable protocol identities only. Service durable
storage contains no Yjs update, state vector, causal frame payload, checkpoint
payload, Canvas/Project state, file/blob bytes, native paths or PeerJS objects.

### 18.2 Closed owner counts

| Declaration family | Sole owner | Count |
| --- | --- | ---: |
| closed RSA carrier DTO and structural verifier | control protocol | 1 |
| RSA semantic authority/currentness gate | project | 1 |
| generic selected owner port/install receipt | collaboration | 1 |
| transfer-attempt binding | collaboration | 1 |
| carrier receipt, attempt key and ACK gate/outbox contract | project | 1 |
| native owner-install/dependency-index adapter | project/node | 1 |
| connection-local ACK queue and Peer message construction | desktop | 1 |
| membership/rendezvous/registry/cutoff service state | api | 1 |
| Control protocol domain contribution | control protocol | 62 |
| closed `ProtocolLimitsV2` fields including `format` | control protocol | 73 |

Declaration count is zero for `@convax/collaboration/control`, a Control-owned
Project currentness witness, Project/node-minted Kernel/Project brands, caller ACK
bytes, connection-selected semantic authority, document-wide versions and service
ordinary-edit ordering.

### 18.3 Mandatory falsifiers

A candidate fails closure if any test can:

1. create a Project RSA authority, currentness result, owner-install receipt,
   attempt key or ACK from structural Control DTOs, verifier output or digest equality;
2. bypass, reorder or omit one of the thirteen structural carrier steps;
3. accept an overlap, gap, trailing byte, stale section hash, old Project DTO alias
   or enclosing carrier-digest cycle;
4. expose a Project semantic F13 step, candidate/current Y.Doc, wanted-root lookup,
   carrier receipt, attempt key, outbox or `queryAttempt` declaration from Control;
5. preserve caller-owned byte aliases or return the same mutable decoded object on
   two verifier calls;
6. supply ACK bytes, Peer body, connection id, transfer id or durability proof
   through the structural verifier;
7. persist carrier/Project/Canvas payload bytes or verifier results in service state;
8. import Project/node, Desktop, Electron, PeerJS or filesystem modules from the
   browser-safe protocol entry;
9. compile the generated Control declarations only with ambient unpublished types;
10. omit or duplicate one of the 62 Control domains, accept a limits object with a
    field count other than 73, or accept any Project/source-member aggregate quota
    at its exact limit plus one;
11. retain ancestry metadata, approval prose, a placeholder digest, duplicate
    declaration or unresolved marker in this standalone annex.
