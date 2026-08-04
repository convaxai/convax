# Convax P2P v10 control-plane and Peer protocol appendix

Status: **Revision-5 exact-byte authority candidate; inactive until the same
Main SHA, annex-set SHA and protocolDigest receive unconditional 3/3 SIGN and the
stable pointer is atomically promoted.**

The words MUST, MUST NOT, SHOULD and MAY are normative. Unknown, noncanonical or
unsupported values fail closed.

## 1. Ownership and dependency boundary

| Owner | Owns | MUST NOT own |
| --- | --- | --- |
| `@convax/collaboration` | Primitive codecs, JCS, binary envelopes, causal/checkpoint cores, state-vector validation ports, signature preimages | Membership policy, Project/Canvas schema, PeerJS, filesystem, service adapters |
| `@convax/project/collaboration-protocol` | Browser-safe Project-scoped DTO descriptors and composite pure verifier ports | Private Project/Canvas imports, network/storage adapters, executable Plugin code |
| `@convax/project` application service | Module-private ProjectIndex shard-reset coordinator, current-authority witness and one-shot reducer-entry permit | Control service policy, native persistence, exported permit/witness APIs |
| `@convax/project/node` | Replica keys through an OS-vault port, frame/checkpoint/floor/blob durability and sole native Project writer | Service policy, PeerJS, reusable reducers |
| `@convax/api` | Membership, replica enrollment, edit authorization, sessions, rendezvous, attestation orchestration, registry, cutoff and metadata transactions | Edit order, PeerJS transport, durable payload bytes, Project/Canvas state |
| isolated attester deployment | Transient streaming execution of the public deterministic composite verifier | Durable payload storage, route state, edit ordering, Plugin JavaScript/WASM |
| `@convax/desktop` | PeerJS lifecycle, four DataConnections, channel queues, reconnect and typed ports into Main | Membership truth, portable reducers, a second document state |

The API imports only `@convax/collaboration` and the browser-safe
`@convax/project/collaboration-protocol` export. PeerJS occurs only in Desktop.
Service adapters and deployment SDKs remain behind typed ports.

Control owns reset DTO validation, exact dependency ports and one pure composite
first-failure verifier. It MUST NOT construct, return, register, consume, inspect or
persist a Project reset permit, `WeakMap` record, nonce, candidate binding,
current-authority head witness or permit state. It MUST NOT define their fields,
lifecycle, state transitions, release behavior, reducer-entry gate or crash meaning;
those are exclusively Project application-service semantics.

## 2. Imported canonical primitives and control-plane descriptor

### 2.1 Primitive codecs

This appendix imports, by exact exported type identity, the kernel-owned primitive
codecs `Id128V2`, `PublicKeyV2`, `SignatureV2`, `ActorIdV2`, `DigestV2`,
`Uint32V2`, `Uint64V2`, `MemberIdV2`, `ReplicaIdV2`, `SessionIdV2`, `PeerIdV2`,
`CanvasIdV2`, `DocumentScopeV2`, `CausalHeadRefV2`, `CausalFrontierV2`,
`ReplicaActorHeadSetV2`, `StateVectorV2`, `CausalSignerAuthorityV2`,
`OwnerCanonicalizerDescriptorV2` and `DocumentOwnerProtocolPortV2`. It imports `ProjectIdV2`,
`ProjectFileIdV2`, `ProjectVersionIdV2` and
`ProjectIndexScopeV2`, `ProjectIndexLiveScopeManifestV2` and the Project-owned
shard-reset claim/route DTOs from the global URI/Project protocol.
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

The control-plane artifact contributes the following closed domains to the
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
convax.checkpoint-validation-carrier-index/2
convax.checkpoint-content-certificate-core/2
convax.stable-checkpoint-set-core/2
convax.replica-causal-floor-ack-core/2
convax.prunable-checkpoint-set-certificate-core/2
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
  validationArtifactsPerCarrier: "64"
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

The kernel bundle's `limitsDigest` is the `convax.protocol-limits/2` digest of the
exact `ProtocolLimitsV2`; its `channelContractDigest` is the
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
  | "incompatible-canvas-schema"
  | "document-lamport-exhaustion"
  | "unrecoverable-certified-history-corruption"

interface DocumentShardResetConfirmationCoreV2 {
  format: "convax.document-shard-reset-confirmation-core/2"
  confirmationId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  oldScope: DocumentScopeV2
  newScope: DocumentScopeV2
  reason: DocumentShardResetReasonV2
  routeCasCoreDigest: DigestV2
  predecessorActivationDigest: DigestV2
  stagedGenesisCheckpointDigest: DigestV2
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
  oldScope: DocumentScopeV2
  newScope: DocumentScopeV2
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

```ts
interface DocumentShardResetClaimCoreV2 {
  format: "convax.document-shard-reset-claim-core/2"
  projectIndexScope: ProjectIndexScopeV2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  reason: DocumentShardResetReasonV2
  oldProtocolDigest: DigestV2
  newProtocolDigest: DigestV2
  oldSchemaDigest: DigestV2
  newSchemaDigest: DigestV2
  stagedGenesisCheckpointDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  routeCasCoreDigest: DigestV2
  initiatorMemberId: MemberIdV2
  initiatorReplicaId: ReplicaIdV2
  initiatorActorId: ActorIdV2
  adminMemberId: MemberIdV2
  adminAuthorizationDigest: DigestV2
  explicitConfirmationReceiptDigest: DigestV2
}
```

No second credential digest, replica key, identity alias, reservation digest or
raw `Id128V2` compatibility branch is legal. Both scopes are exact Canvas scopes
with the same Project, Project epoch and `CanvasIdV2`; only `shardEpoch` differs.
The reason and every repeated route/genesis field are byte-equal to the Project-owned
reset claim and route-CAS core.

The confirmation core intentionally omits the claim digest. Project first computes
the claim core, which binds `confirmationCoreDigest`; the approval binds that exact
`resetClaimCoreDigest`; the claim wrapper finally carries the approval core digest.
This one-way construction has no digest cycle.

The composite verifier requires the claim, confirmation and active actor credential
tuples to be byte-equal after strict scalar decoding and canonical re-encoding:

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
  == current instantiated ProtocolSchemaBundleV2.coreDigest
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

The verifier resolves only the exact `ReplicaEditAuthorizationV2` named by the
candidate ProjectIndex causal context. Its wrapper, core digest and
membership-purpose service signature validate, and its core satisfies:

```text
editAuthorization.coreDigest
  == candidate.signerAuthority.replicaEditAuthorizationCoreDigest
editAuthorization.core.projectId/projectEpoch
  == credential.core.projectId/projectEpoch
editAuthorization.core.membershipEpoch
  == membershipSnapshot.core.membershipEpoch
editAuthorization.core.membershipSnapshotDigest
  == membershipSnapshot.coreDigest
editAuthorization.core.membershipSequence
  == membershipSnapshot.core.membershipSequence
editAuthorization.core.memberId
  == credential.core.memberId
editAuthorization.core.memberAuthorizationEpoch
  == membershipMember.memberAuthorizationEpoch
editAuthorization.core.replicaId
  == credential.core.replicaId
editAuthorization.core.replicaIdReservationReceiptDigest
  == credential.core.replicaIdReservationReceiptDigest
editAuthorization.core.actorId
  == credential.core.actorId
editAuthorization.core.replicaAuthorizationEpoch
  == credential.core.replicaAuthorizationEpoch
editAuthorization.core.role == "editor"
editAuthorization.core.editState == "active-editor"
editAuthorization.core.installedFloorSetDigest
  == candidate.installedFloorSetDigest
editAuthorization.core.protocolDigest
  == candidate.protocolDigest
editAuthorization.core.schemaDigest
  == candidate.ownerSchemaDigest
editAuthorization.core.validationArtifactSetDigest
  == candidate.validationArtifactSetDigest
editAuthorization.core.trustBundleDigest
  == membershipSnapshot.core.trustBundleDigest
editAuthorization.core.serviceKeyPurpose == "membership"

candidate.signerAuthority.memberId/replicaId/actorId
  == credential.core.memberId/replicaId/actorId
candidate.signerAuthority.memberAuthorizationEpoch
  == membershipMember.memberAuthorizationEpoch
candidate.signerAuthority.replicaAuthorizationEpoch
  == credential.core.replicaAuthorizationEpoch
candidate.signerAuthority.membershipSnapshotDigest
  == membershipSnapshot.coreDigest
candidate.signerAuthority.replicaActorCredentialCoreDigest
  == credential.coreDigest
candidate.signerAuthority.replicaEditAuthorizationCoreDigest
  == editAuthorization.coreDigest
```

The exact installed Project floor satisfies:

```text
floorRoot.coreDigest == candidate.installedFloorSetDigest
floorRoot.core.projectId/projectEpoch
  == credential.core.projectId/projectEpoch
floorRoot.core.membershipSnapshotDigest
  == membershipSnapshot.coreDigest
floorRoot.core.targetMemberId/targetReplicaId/targetActorId
  == credential.core.memberId/replicaId/actorId
floorRoot.core.targetReplicaAuthorizationEpoch
  == credential.core.replicaAuthorizationEpoch
floorRoot.core.projectIndexLiveScopeManifestDigest
  == Digest("convax.project-index-live-scope-manifest/2",
            exact projectIndexLiveScopeManifest)
floorRoot.core.protocolDigest == candidate.protocolDigest
floorRoot.core.trustBundleDigest
  == membershipSnapshot.core.trustBundleDigest
```

The floor is the complete activation floor named by the edit authorization and
derived from its exact content-certified ProjectIndex-plus-live-routes manifest.
Later route advancement does not silently rotate that immutable authorization/floor
binding. Current edit eligibility comes from the exact authorization epochs,
membership/edit state and cutoff rules; the verifier independently checks the
current route. A viewer or pending editor is a closed rejection even when every
reset signature and admin approval is otherwise valid.

The verifier resolves the credential-bound
`ReplicaIdReservationReceiptV2`; substituting the current reservation, another
receipt for the same member, an allocator row or a newly issued receipt is forbidden.
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

The immutable reservation state is `consumed`, and its consumed membership mutation
is the one that introduced the membership replica/credential chain. For rotation,
its predecessor chain also matches. Expiry after atomic consumption does not
invalidate retained provenance; `reserved`, `abandoned` or expired-at-consumption
receipts grant no reset authority.

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
  == currentProjectAdminCapability.core.adminMemberId
claim.core.adminAuthorizationDigest
  == approval.core.adminCapabilityCoreDigest
  == currentProjectAdminCapability.coreDigest
```

The existing approval authorization-epoch/current-capability checks remain
mandatory. Admin approval authorizes the destructive action but does not grant
ProjectIndex causal-frame signing authority or upgrade a viewer/pending editor.

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
MUST NOT be migrated, rewritten or accepted under Revision 4. Another credential is
also rejected even when it reuses the same public-key bytes, because its exact
credential/reservation identities are not the confirmation-bound chain.

In the claim, `explicitConfirmationReceiptDigest` equals
`confirmationCoreDigest`, `adminApprovalDigest` equals the approval core digest and
`adminAuthorizationDigest` equals `adminCapabilityCoreDigest`. Exact retry is
idempotent; reuse of an id with different core bytes is
`idempotency-equivocation`. No service sequence or registry entry participates in
the route decision. At most 64 uncommitted approvals exist per Project; exceeding
the cap refuses a new approval without evicting a referenced approval.

### 4.4.2 `F13-WITNESS-A+C/1`: sole composite reset verifier

The 3/3 cross-owner decision id is **`F13-WITNESS-A+C/1`**. Control's complete
responsibility is F13: the initial authority decision and the Project-owned final
gate each invoke the same sole complete thirteen-step verifier from step 1. Control
exposes no final-currentness-only verifier, phase flag, resume token or
steps-9-through-12 entry point. Witness, permit and A+C remain referenced Owner
requirements, not Control algorithms.

The browser-safe Project collaboration-protocol export exposes exactly one pure
composite verifier. The Project application-service module-private coordinator is
its sole reset-admission caller. Project Node, Desktop and control adapters use the
Project application-service operation or supply typed dependencies; they MUST NOT
call, restate, wrap with a weaker order or implement a second reset authority
algorithm. Its semantic contract is:

The exact callable option is **`F13-ABI-CLOSED-SNAPSHOT/1`**. Its public declaration
is byte-for-byte:

```ts
export type ExactJcsInputBytesV2 = Readonly<Uint8Array>
export type YjsUpdateV1InputBytesV2 = Readonly<Uint8Array>
export type YjsStateVectorInputBytesV2 = Readonly<Uint8Array>

export type DocumentShardResetClaimExactJcsV2 = ExactJcsInputBytesV2
export type DocumentShardResetConfirmationExactJcsV2 = ExactJcsInputBytesV2
export type DocumentShardResetApprovalExactJcsV2 = ExactJcsInputBytesV2
export type DocumentShardResetRouteCasCoreExactJcsV2 = ExactJcsInputBytesV2
export type CanvasRouteResetCommitExactJcsV2 = ExactJcsInputBytesV2
export type DocumentShardResetCandidateBindingExactJcsV2 = ExactJcsInputBytesV2

export interface DocumentShardResetCandidateBindingV2 {
  readonly scope: DocumentScopeV2 & { docKind: "project-index"; docId: "project-index" }
  readonly routeCasCoreDigest: DigestV2
  readonly typedIntentDigest: DigestV2
  readonly causalContextDigest: DigestV2
  readonly baseStateVectorDigest: DigestV2
  readonly baseCanonicalStateDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly installedFloorSetDigest: DigestV2
  readonly signerAuthority: CausalSignerAuthorityV2
}

export interface DocumentShardResetAuthorityDependencyBytesV2 {
  readonly credential: ExactJcsInputBytesV2 | null
  readonly editAuthorization: ExactJcsInputBytesV2 | null
  readonly reservationReceipt: ExactJcsInputBytesV2 | null
  readonly membershipSnapshot: ExactJcsInputBytesV2 | null
  readonly membershipReplica: ExactJcsInputBytesV2 | null
  readonly membershipMember: ExactJcsInputBytesV2 | null
  readonly floorRoot: ExactJcsInputBytesV2 | null
  readonly floorPages: readonly ExactJcsInputBytesV2[] | null
  readonly projectIndexLiveScopeManifest: ExactJcsInputBytesV2 | null
  readonly adminCapability: ExactJcsInputBytesV2 | null
  readonly trustBundle: ExactJcsInputBytesV2 | null
}

export interface DocumentShardResetCandidateFactsV2 {
  readonly typedIntentExactJcs: ExactJcsInputBytesV2
  readonly causalContextExactJcs: ExactJcsInputBytesV2
  readonly candidateFullUpdateBytes: YjsUpdateV1InputBytesV2
  readonly candidateStateVector: YjsStateVectorInputBytesV2
  readonly candidateCanonicalStateBytes: ExactJcsInputBytesV2
}

export interface DocumentShardResetCurrentReplicaDocHeadV2 {
  readonly currentFrontierExactJcs: ExactJcsInputBytesV2
  readonly currentFullUpdateBytes: YjsUpdateV1InputBytesV2
  readonly currentStateVector: YjsStateVectorInputBytesV2
  readonly currentCanonicalStateBytes: ExactJcsInputBytesV2
}

export interface DocumentShardResetCurrentRouteFactsV2 {
  readonly currentProjectIndexStateVectorDigest: DigestV2
  readonly currentProjectIndexCanonicalStateDigest: DigestV2
  readonly projectIndexScope: ProjectIndexScopeV2
  readonly predecessorActivationDigest: DigestV2
  readonly currentOldRouteActivationDigest: DigestV2
  readonly currentOldShardEpoch: Id128V2
  readonly currentNewRouteState: "absent"
  readonly currentStagedGenesisState: "inert"
  readonly currentStagedGenesisCheckpointDigest: DigestV2
  readonly currentStagedGenesisFullUpdateDigest: DigestV2
  readonly currentStagedGenesisStateVectorDigest: DigestV2
}

export interface VerifyDocumentShardResetAuthorityInputV2 {
  readonly claim: DocumentShardResetClaimExactJcsV2
  readonly confirmation: DocumentShardResetConfirmationExactJcsV2
  readonly approval: DocumentShardResetApprovalExactJcsV2
  readonly routeCas: DocumentShardResetRouteCasCoreExactJcsV2
  readonly resetCommit: CanvasRouteResetCommitExactJcsV2
  readonly dependencies: DocumentShardResetAuthorityDependencyBytesV2
  readonly candidateBinding: DocumentShardResetCandidateBindingExactJcsV2
  readonly candidateFacts: DocumentShardResetCandidateFactsV2
  readonly currentReplicaDocHead: DocumentShardResetCurrentReplicaDocHeadV2
  readonly currentRouteFacts: DocumentShardResetCurrentRouteFactsV2
}

export type VerifyDocumentShardResetAuthorityResultV2 =
  | { readonly status: "verified" }
  | { readonly status: "pending"; readonly code: "reset-authority-dependency-pending" }
  | { readonly status: "rejected"; readonly code: DocumentShardResetBindingFailureV2 }

export declare function verifyDocumentShardResetAuthorityV2(
  input: VerifyDocumentShardResetAuthorityInputV2,
): VerifyDocumentShardResetAuthorityResultV2
```

The ten-field input has no `format`: it is a nonportable, nondigestible process-call
value whose version is the unique v2 symbol and closed declaration above. Every
interface is a plain closed object; every field is required; missing, additional,
accessor or symbol keys reject. The function has no overload, generic, callback,
port, ambient lookup, phase, resume token or asynchronous return. Every byte field
is copied into a fresh implementation-owned `Uint8Array` before inspection because
TypeScript `Readonly` is not runtime immutability. No caller-mutable alias may remain
during one invocation.

The five top-level business byte fields decode respectively and only as
`DocumentShardResetClaimV2`, `DocumentShardResetConfirmationV2`,
`DocumentShardResetApprovalV2`, `DocumentShardResetRouteCasCoreV2` and
`CanvasRouteResetCommitV2`. The eleven dependency fields decode respectively as
`ReplicaActorCredentialV2`, `ReplicaEditAuthorizationV2`,
`ReplicaIdReservationReceiptV2`, `MembershipSnapshotV2`, `MembershipReplicaV2`,
`MembershipMemberV2`, `ReplicaProjectFloorRootV2`, a root-ordered array of
`ReplicaProjectFloorPageV2`, `ProjectIndexLiveScopeManifestV2`,
`ProjectAdminCapabilityV2` and `ServiceTrustBundleV2`. Only these dependency fields
may be `null`; a present malformed value is rejection, never pending.

`candidateBinding` decodes only as the exact eleven-field
`DocumentShardResetCandidateBindingV2`. `typedIntentExactJcs`,
`causalContextExactJcs`, `candidateCanonicalStateBytes`,
`currentFrontierExactJcs` and `currentCanonicalStateBytes` decode respectively as
the exact ProjectIndex typed intent, `CausalContextV2`, Project owner canonical
state, `CausalFrontierV2` and Project owner canonical state. Restricted-JCS
parse/re-encode MUST reproduce the supplied bytes. Both full updates are update-v1
bytes for `Y.applyUpdate`; a fresh document MUST re-encode byte-identically with
`Y.encodeStateAsUpdate`. Both state vectors MUST be byte-identical to
`Y.encodeStateVector` of their reconstructed document.

All existing owner/kernel caps apply before allocation or decode: complete typed
intent 512 KiB, causal context 64 KiB, each state vector 1..64 KiB, each ProjectIndex
full update and canonical state at most the 32 MiB ProjectIndex checkpoint ceiling,
the existing frontier-head cap, and each reset/control JCS object at most 64 KiB.
The two reconstructed documents together remain inside the existing 256 MiB
proposal-and-parent working ceiling. No truncation, lazy oversized view or
post-allocation limit check is legal.

`status="verified"` is diagnostic output, not an authority object. It cannot be
serialized, cached or replayed to authorize mutation. The pure verifier constructs
or returns no witness/permit and has no `WeakMap`, nonce, registry, state transition,
release, consume, reducer-entry or durability API.

The Project coordinator invokes this exact public verifier once before its private
issue boundary and again at its private final gate. Each invocation starts at step
1, runs every step through step 13 and returns only the closed result above. There
is one verifier implementation and one callable contract. Control MUST NOT add a
final-currentness verifier, a `phase="final"` or `resumeAtStep` input, staged
verifier, cached steps-1-through-8 result or any other final path that skips a step.

The following thirteen steps are the sole normative first-failure algorithm. The
first failing step selects the failure code. No step mutates a Y.Doc, route, journal,
head, outbox, native tree or control-plane state.

1. **Bound and decode.** Enforce object byte/depth caps; decode strict JCS and all
   closed DTO/scalar codecs. Decode both replica fields only as `ReplicaIdV2`.
   Failure: `reset-object-invalid`.
2. **Recompute wrapper identities.** Recompute confirmation, claim, approval,
   route-CAS and reset-commit core digests plus every wrapper/core equality. Failure:
   `reset-digest-binding-invalid`.
3. **Bind route and staged genesis.** Check Project, epoch, Canvas, old/new scope,
   reason, route-CAS/predecessor and all three genesis digest equalities. Failure:
   `reset-route-binding-invalid`.
4. **Bind the initiator triad.** Check the claim/confirmation member, replica and
   actor equalities before choosing a signature key. Failure:
   `reset-initiator-binding-invalid`.
5. **Resolve the exact credential.** Resolve only the confirmation-bound credential
   digest. Missing retrievable bytes: `reset-authority-dependency-pending`. Bad
   digest, wrapper, trust signature, purpose, Project/epoch/protocol or triad:
   `reset-actor-credential-invalid`.
6. **Resolve the exact reservation receipt.** Validate the credential-bound receipt,
   consumed state and membership introduction/rotation chain. Missing retrievable
   bytes: `reset-authority-dependency-pending`. Any mismatch:
   `reset-reservation-binding-invalid`.
7. **Recompute actor identity.** Recompute actor id from the credential-bound tuple.
   Failure: `reset-actor-derivation-invalid`.
8. **Verify both initiator signatures.** Use only the credential replica key and the
   exact messages in section 4.4.1. Failure:
   `reset-initiator-signature-invalid`.
9. **Validate current active-editor principal.** Resolve the exact immutable
   membership snapshot and current membership state. Require active member and
   replica, `membershipMember.role="editor"`,
   `membershipReplica.editState="active-editor"`, current credential and current
   authorization epochs/key/reservation relation. Viewer or pending editor:
   `reset-active-editor-required`; replaced, revoked or otherwise non-current
   authority: `reset-initiator-stale`. Missing retrievable membership bytes:
   `reset-authority-dependency-pending`.
10. **Resolve and validate exact edit authorization.** Resolve only the candidate
    signer authority's authorization digest; validate its wrapper, service signature
    and every Project/epoch/principal/reservation/floor/protocol/schema/artifact
    equality in section 4.4.1. Resolve the exact floor root, its root-ordered pages
    and content-certified ProjectIndex live-scope manifest; require complete,
    byte-exact ProjectIndex-plus-live-routes coverage. Missing retrievable bytes:
    `reset-authority-dependency-pending`; any structural, signature, floor, schema or
    artifact mismatch: `reset-editor-authorization-invalid`.
11. **Validate approval.** Validate claim/confirmation binding, admin member
    equality, current exact capability, member authorization epoch and admin
    signature. Missing retrievable bytes: `reset-authority-dependency-pending`;
    stale capability: `reset-approval-stale`; structural/signature mismatch:
    `reset-approval-invalid`.
12. **Validate candidate binding and current route.** First require every field of
    `DocumentShardResetCandidateBindingV2` to recompute from the exact unmutated
    candidate and causal context, and its base state-vector/canonical digests to
    equal the current durable ProjectIndex `replicaDoc` head; mismatch is
    `reset-candidate-binding-invalid`. Then require ProjectIndex to expose only the
    expected old live route and predecessor activation, the staged genesis to remain
    inert and the new route not to be live; failure is `reset-route-cas-stale`.
13. **Return verified diagnostic status.** Return `{status:"verified"}` to the
    directly invoking Project application-service coordinator for this exact
    invocation. No permit or authority value is returned, and Control retains no
    invocation state.

The exact input-consumption matrix closes the callable without changing the steps,
their order or their first-failure codes:

| Step | Exact input consumed after step-1 decoding |
| --- | --- |
| 1 | all ten top-level fields recursively, for bounds, closed keys, exact JCS/scalars and Yjs binary decoding only; a nullable dependency remains absent for its owning later step |
| 2 | only `claim`, `confirmation`, `approval`, `routeCas` and `resetCommit` |
| 3 | only those same five business objects, for Project/epoch/Canvas, old/new scope, reason, route-CAS/predecessor and the three staged-genesis equalities |
| 4 | `claim` and `confirmation` |
| 5 | `claim`, `confirmation`, `dependencies.credential`, `dependencies.trustBundle` and the generated pinned bundle constant |
| 6 | `dependencies.credential`, `dependencies.reservationReceipt`, `dependencies.membershipSnapshot`, `dependencies.membershipReplica`, `dependencies.membershipMember` and `dependencies.trustBundle` |
| 7 | `dependencies.credential`, `dependencies.membershipReplica`, `claim` and `confirmation` |
| 8 | `claim`, `confirmation` and `dependencies.credential` |
| 9 | `dependencies.credential`, `dependencies.reservationReceipt`, `dependencies.membershipSnapshot`, `dependencies.membershipMember`, `dependencies.membershipReplica` and `dependencies.trustBundle` |
| 10 | `candidateBinding`, `candidateFacts.causalContextExactJcs`, `dependencies.editAuthorization`, `dependencies.credential`, `dependencies.reservationReceipt`, `dependencies.membershipSnapshot`, `dependencies.membershipMember`, `dependencies.membershipReplica`, `dependencies.floorRoot`, `dependencies.floorPages`, `dependencies.projectIndexLiveScopeManifest` and `dependencies.trustBundle` |
| 11 | `claim`, `confirmation`, `approval`, `dependencies.adminCapability`, `dependencies.membershipSnapshot`, `dependencies.membershipMember` and `dependencies.trustBundle` |
| 12 | `claim`, `confirmation`, `approval`, `routeCas`, `resetCommit`, `candidateBinding`, all five `candidateFacts`, all four `currentReplicaDocHead` fields, all eleven `currentRouteFacts` fields and `dependencies.editAuthorization` |
| 13 | no new input; return only the closed diagnostic result |

In particular, `typedIntentExactJcs` is decoded and bounded in step 1 but first
participates semantically only in the step-12 candidate-binding recomputation. The
current candidate, current `replicaDoc` head, current route/predecessor and staged-
genesis facts first participate semantically only in step 12. Step 2 remains only
the five wrapper/core/record identity checks. The matrix neither moves a check to an
earlier failure code nor permits an implementation to defer a step-1 structural
decode failure.

Step 12 reconstructs candidate and current `replicaDoc` independently under the
pinned Yjs codec, re-encodes their full updates, state vectors and owner canonical
states, and requires the candidate to be the exact unmutated clone of the current
head. It recomputes every field of `DocumentShardResetCandidateBindingV2` from the
raw typed intent, causal context, reconstructed candidate, current head and exact
edit authorization before comparing the supplied binding. It then derives the
Project route projection from the reconstructed current head, requires the expected
old route to be `live` at `currentOldRouteActivationDigest` and
`currentOldShardEpoch`, requires the byte-equal predecessor, requires
`currentNewRouteState="absent"`, and requires the exact staged-genesis digests to
remain `currentStagedGenesisState="inert"`. A caller-supplied digest mirror cannot
substitute for either reconstructed document.

The initial and final calls construct fresh top-level and nested objects. The final
call copies and decodes the same five business and eleven dependency byte values
from the Project-private permit's exact input copies; it never reuses decoded
objects. It freshly canonicalizes the frozen eleven-field candidate binding and
freshly rebuilds all five candidate facts, all four current-head facts and all
eleven current-route facts while the Project writer lock and private witness are
held. A successful pair is byte-identical in content, but no object or byte-array
identity is reusable authority. A1 precedes the initial call, A2 follows its
verified result, A3 precedes the final call and A4 follows its verified result. The
Project artifact alone owns those assertions, the permit and the no-gap reducer
entry; this function neither receives nor returns any of them.

First-failure selection inside multi-object steps is fixed. Step 9 checks membership
snapshot signature/currentness, exact principal/credential relations, then role/edit
state. Stale/replaced/revoked identity, epoch, key or reservation is
`reset-initiator-stale`; a structurally current viewer/pending editor is
`reset-active-editor-required`. Step 10 checks edit authorization, then floor root,
root-ordered floor pages, then live-scope manifest and complete coverage. At each
object, absence is pending before any later object; present-invalid is
`reset-editor-authorization-invalid`. Step 11 checks availability, structural
digest/signature validity, then current capability/authorization epoch. Step 12
recomputes candidate binding before current route. Implementations MUST NOT race
checks or select results by Promise completion/lookup arrival.

The same complete algorithm is normative for initial and final invocation. Both
begin with step 1 and reach step 13 only after steps 1 through 12 pass. For a
multi-fault input, the lowest failing step and then its fixed sub-order independently
select each invocation's result. Control MUST NOT describe final invocation as
"currentness only", omit an earlier check because it passed initially or let a
Project-local comparison substitute for any verifier step.

Every invocation is pure and synchronous over already supplied bounded objects. It
performs no dependency fetch, authority lookup, callback, IPC, native write,
candidate mutation, route publication or control-plane mutation. Project's private
caller sequencing and reducer boundary are defined only by the Project-owner
artifact and are not a second Control first-failure algorithm.

The closed rejection union is:

```ts
type DocumentShardResetBindingFailureV2 =
  | "reset-object-invalid"
  | "reset-digest-binding-invalid"
  | "reset-route-binding-invalid"
  | "reset-initiator-binding-invalid"
  | "reset-actor-credential-invalid"
  | "reset-reservation-binding-invalid"
  | "reset-actor-derivation-invalid"
  | "reset-initiator-signature-invalid"
  | "reset-editor-authorization-invalid"
  | "reset-active-editor-required"
  | "reset-approval-invalid"
  | "reset-approval-stale"
  | "reset-initiator-stale"
  | "reset-candidate-binding-invalid"
  | "reset-route-cas-stale"
```

`reset-authority-dependency-pending` is bounded pending, not rejection. Every
rejection/pending/stale result leaves the old route sole live authority and publishes
or deletes nothing. The verifier never substitutes a current credential for the
exact digest, downgrades stale to approval success or continues with a locally
reconstructed identity.

`reset-active-editor-required` is closed rejection. If no exact active editor
exists, Canvas shard reset fails closed. Product recovery may offer the independently
specified destructive Project-reset/Project-epoch path; it MUST NOT grant a viewer
or pending editor reset authority, auto-promote a replica, synthesize edit
authorization or invent an implicit break-glass actor.

A Project-owned admission that independently accepts the verified bundle may
authorize only one Project-owned route transition. It creates no Canvas causal edit
or Canvas Yjs update, alters no Lamport/actor sequence/portable stamp/frontier/Yjs
client-id order, uses no membership/reservation/service/wall-clock/arrival sequence
as an edit winner, revives no old shard bytes and makes no control-plane state a
second Canvas/Project authority.

Control may retain the already-allowed immutable reset confirmation/approval,
credential, edit authorization, reservation receipt, membership snapshot, floor
root/pages, live-scope manifest and idempotency metadata. It MUST NOT persist or log
permit/nonce/candidate bindings, checkpoint payload, full update, state vector, Yjs,
Canvas/ProjectIndex state, causal frame, typed intent, Plugin state, blob/media bytes
or native paths. Reset objects carry only exact digests.

`@convax/project/node` remains the sole durable Project writer. A failed verifier
result creates no reset manifest, route frame, journal/head/outbox record or staged
tree publication marker. The Project-owner and kernel artifacts exclusively define
private gate terminal meaning, reducer entry, native barriers and crash recovery.
Control neither observes nor interprets witness/permit state and never treats such
process-local state as durability.

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

## 6. PeerJS connection and four channels

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
`DocumentOwnerProtocolPortV2` instantiated from the validation artifact set.

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

Revision 4 produces one strict sorted, duplicate-free registry of exactly 123
domains. Starting from the exact 89-domain registry in frozen
`ProtocolSchemaBundleV2.coreDigest`
`e37edd84c576d2ce8fbb983f29b34d5e78fe0d6578af30f93c7ffb91d41b43ad`,
add these seven Owner/Project domains:

```text
convax.owner-canonicalizer-descriptor/2
convax.project-conflict-projection/2
convax.project-content-family-projection/2
convax.project-entry-location-projection/2
convax.project-file-projection/2
convax.project-index-write-value/2
convax.project-route-projection/2
```

Add these 28 Canvas domains:

```text
convax.canvas-actual-write-value/2
convax.canvas-containment-slot/2
convax.canvas-creation-group-member-set/2
convax.canvas-data-register/2
convax.canvas-edge-identity/2
convax.canvas-effective-child-set/2
convax.canvas-effective-data/2
convax.canvas-effective-plugin/2
convax.canvas-generation-begin/2
convax.canvas-generation-dismissal/2
convax.canvas-generation-lifecycle/2
convax.canvas-generation-recovery-failure/2
convax.canvas-generation-terminal/2
convax.canvas-genesis-core/2
convax.canvas-geometry/2
convax.canvas-group-geometry-plan/2
convax.canvas-history-footprint/2
convax.canvas-history-material/2
convax.canvas-history-materialization/2
convax.canvas-metadata-effective/2
convax.canvas-metadata-slot/2
convax.canvas-node-identity/2
convax.canvas-obstacle-projection/2
convax.canvas-operation-receipt/2
convax.canvas-projected-generation/2
convax.canvas-semantic-guard/2
convax.canvas-semantic-history-root/2
convax.canvas-semantic-history-state/2
```

Remove `convax.project-index-canonical-state/2` as a digest domain. Its owner format
string may remain schema data. Do not add `convax.canvas-canonicalizer/2`. The exact
cardinality equation is `89 + 7 + 28 - 1 = 123`. Any other count, duplicate,
unsorted registry, missing addition or either private canonicalizer domain rejects
bundle regeneration before attestation or reset verification.

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
abandonment cannot undo promotion.

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

Promotion requires exact ProjectIndex dependency plus Canvas genesis content
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

Promotion/abandonment frees an outstanding registry slot, never a retained entry.
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
| `reset-authority-dependency-pending` | leave old route sole live; fetch only the exact bound dependency and rerun complete F13 |
| `reset-object-invalid` / `reset-digest-binding-invalid` / `reset-route-binding-invalid` | publish/delete nothing; correct the exact closed reset object set |
| `reset-initiator-binding-invalid` / `reset-actor-credential-invalid` / `reset-reservation-binding-invalid` / `reset-actor-derivation-invalid` / `reset-initiator-signature-invalid` | publish/delete nothing; reject identity/key substitution and obtain a new exact authority set |
| `reset-editor-authorization-invalid` / `reset-active-editor-required` / `reset-initiator-stale` | publish/delete nothing; use one exact current active-editor authority or the explicit Project-reset path |
| `reset-approval-invalid` / `reset-approval-stale` | publish/delete nothing; obtain a new exact current admin approval |
| `reset-candidate-binding-invalid` / `reset-route-cas-stale` | discard untouched candidate; retry from the latest Project-owned base with fresh private admission |
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
- Promote viewer replicas: none receives edit authorization before its exact floor;
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

### 15.4 Revision 4 reset and owner-closure tests

1. `replica_00000001` passes `ReplicaIdV2` and fails `Id128V2`; a canonical
   `Id128V2` spelling fails `ReplicaIdV2`. No scalar passes both.
2. One active-editor replica with exact current credential, edit authorization,
   installed floor and membership/reservation chains creates claim and confirmation;
   all equality and both initiator signature checks pass.
3. A-claim plus B-confirmation rejects as `reset-initiator-binding-invalid` for each
   independently changed member, replica and actor field, including two replicas of
   one member.
4. A confirmation-bound credential digest cannot be replaced by the current
   credential, another credential using the same public key or another retained
   credential for that replica.
5. Reserved, abandoned, wrong-member, wrong-replica, wrong-key, wrong-purpose,
   bad-service-signature or unconsumed receipts reject before Project candidate
   mutation. A correctly consumed expired receipt remains valid provenance.
6. Replacing only claim or confirmation signature with a session, member, admin or
   another replica signature rejects.
7. Viewer and `pending-editor` initiators reject as
   `reset-active-editor-required`, even with valid confirmation/admin approval.
   Missing/wrong/stale floor, Project schema, artifact set, protocol or edit
   authorization rejects before candidate mutation.
8. Invoke the exact same verifier for initial and final decisions over the same
   complete bytes. A spy proves both start at step 1 and execute the same F13
   implementation; no steps-9-through-12 entry point is callable.
9. Give both calls multi-fault inputs. Step 1 plus 12 returns step 1; steps 4, 8 and
   9 return step 4; steps 9, 11 and 12 return step 9; steps 10 and 11 return step
   10; steps 11 and 12 return step 11; candidate plus route mismatch inside step 12
   returns candidate-binding first.
10. Revoke/replace/downgrade the initiator, rotate edit authorization/floor or rotate
    admin authority between calls. Final complete F13 rejects through the ordinary
    earliest step and performs no route/candidate mutation.
11. Mutate a step-1-through-8 object after initial verification while retaining a
    current-looking membership/route set. Final invocation starts at step 1 and
    rejects the earliest changed object; no cached prefix is accepted.
12. Reflect every public Control, Project collaboration-protocol, Project Node,
    Desktop and IPC export. Control exposes only DTOs, pure validators and typed
    dependency ports; Project exposes one complete verifier. No public surface has
    an F9/final-currentness verifier, phase/resume input, cached prefix, permit,
    `WeakMap`, witness, nonce, issuer, transition or consume API.
13. Scan control DB, Project stores, object store, logs, traces, retries and crash
    recovery after pass/failure/cancel paths. Control contains no checkpoint,
    state-vector, full-update, Yjs, Canvas/ProjectIndex or typed-intent payload bytes,
    and no permit/witness/nonce/binding occurs in those durable or observable sinks.
    Owner tests separately cover the Project-private process-local record.
14. Give Bun, Chromium and isolated attester only the renewed authority set; require
    byte-identical claim/confirmation/approval digests, signature messages, failure
    codes and splice rejection.
15. Attest one Canvas and one ProjectIndex checkpoint. Swapping schema,
    canonicalizer, artifact-set digest or owner port rejects without copied
    owner-specific schema in Control.
16. Present a Canvas-private canonicalizer descriptor/domain or registry whose count
    is not exactly 123; bundle admission/attestation rejects before replay.
17. Changing service sequence, reservation allocation order, arrival order or wall
    clock does not change Canvas/ProjectIndex projection or ordinary edit acceptance.
18. Generate the public declaration twice from only this artifact. Both outputs have
    one callable, ten input fields, eleven dependency fields, eleven candidate-
    binding fields, five candidate facts, four current-head facts and eleven current-
    route facts. Missing/extra keys, accessor values, a `format` field, an overload,
    generic, callback, port, `Promise` return or mutable byte alias rejects.
19. Independently mutate every exact-JCS byte field, both full updates, both state
    vectors and both canonical-state byte arrays. Noncanonical or over-cap bytes
    reject in step 1. A different candidate or current head with caller-matched
    digest strings rejects in step 12 after raw Yjs reconstruction. A final call
    that reuses an initial decoded object or stale candidate/head/route snapshot is
    rejected by the Project coordinator conformance harness.

## 16. Strongest objections, decision and SHA

### Revision 4 control-plane change log

1. Adopted 3/3 decision `F13-WITNESS-A+C/1`: one complete thirteen-step Control
   verifier is called from step 1 for both initial and final admission; removed every
   final-currentness/F9/cached-prefix alternative.
2. Closed shard-reset initiator identity over exact nominal
   `{MemberIdV2,ReplicaIdV2,ActorIdV2}`, retained reservation provenance, both
   initiator signature preimages and A-claim/B-confirmation splice rejection.
3. Required one current active-editor credential, exact edit authorization,
   content-certified ProjectIndex-plus-live-routes floor, current admin capability,
   candidate binding and current Project-owned route.
4. Kept Control diagnostic-only. Witness, permit, `WeakMap`, nonce, A+C state,
   reducer entry and recovery remain exclusively in the Project application service;
   Project Node remains sole durable writer.
5. Bound attestation to the generic kernel owner canonicalizer descriptor and exact
   owner port, and adopted the atomic `89 + 7 + 28 - 1 = 123` registry rule.
6. Added exact multi-fault first-failure, initial/final TOCTOU, public-surface,
   payload-zero, owner-swap and registry conformance tests.

#### Revision 3 retained baseline

1. Moved `DocumentScopeV2` and all generic causal/frame/state-vector identities to
   the kernel owner and made this artifact a named, exact-byte bundle contribution.
2. Added the shared `BeginAuthorizationEpochCoreV2`; generation first-loss now
   binds its exact digest instead of a raw authorization epoch.
3. Added closed shard-reset confirmation/approval and Project-reset
   confirmation/approval DTOs, plus one replay-safe service transaction for team
   Project epoch rollover and empty ProjectIndex genesis attestation.
4. Replaced registry-derived pending-editor coverage with the exact
   content-certified ProjectIndex live-scope manifest. Registry is anti-rollback and
   advisory prefetch only.
5. Replaced the bounded inline reconnect hint with paged canonical holdings
   commitments, exact frontier/head/state-vector discovery and bounded blob-have
   queries.
6. Added limits, failure states, exact/+1 vectors, crash cuts and cross-claim replay
   tests for all new objects and transitions.
7. Made `ReplicaIdV2` a service-reserved Project-epoch identity: added signed
   reservation request/receipt DTOs, a monotonic durable allocator and terminal
   state records, atomic enrollment consumption, lifetime/pending caps, permanent
   no-reuse, and transitive snapshot/credential/checkpoint verification.

### Strongest objections

1. The attester and team epoch-rollover service are central content-validation and
   availability boundaries. If service-side transient ProjectIndex bytes are
   forbidden, team reset and pruning cannot use these certificates and must retain
   complete history; a metadata-only shortcut would be unsound.
2. Exact all-live-scope editor floors and shard-reset authority dependencies trade
   availability for offline authority. One unavailable live Canvas checkpoint, lost
   active editor or unavailable retained credential/receipt can block activation,
   compaction or shard reset until an explicit Project route/reset action resolves
   it; timeout, admin-only mutation or majority cannot be smuggled in without
   weakening the threat model.
3. Permanent replica-id burn trades collision freedom for a bounded denial-of-
   service surface. One compromised member can consume 64 ids and a sufficiently
   broad compromised team can consume the 16,384-id Project-epoch budget, after
   which only explicit destructive Project reset restores capacity. Reuse, random
   probing or eviction would avoid the reset but would make retained Yjs client ids
   ambiguous, so the design chooses a visible bounded failure instead.

Flaw types checked: duplicate authority, unbounded metadata, replay/idempotency,
signature-domain ambiguity, cross-target cutoff replay, partial-page absence,
payload persistence leakage, hash cycles, destructive-confirmation ambiguity,
registry-as-hidden-scope-authority, stale activation races, channel head-of-line
blocking, unauthenticated identity allocation, allocator crash cuts, permanent-id
reuse, credential-dependency pruning, initiator identity substitution,
approval-versus-edit-authority confusion, staged-verifier drift, TOCTOU/capability
replay, duplicate canonicalizer authority and hidden online edit ordering.

### Falsifiable rejection conditions

Reject this appendix if any implementation test can: activate an editor while a
current certified ProjectIndex live scope is absent from its floor; block activation
only because a tombstoned registry-only scope lacks bytes; accept one reset evidence
for another claim/scope/inventory; publish a team Project epoch without the exact
durable rollover receipt; accept an old credential after rollover commit; infer Peer
absence from an incomplete inventory; allocate a replica id without an authenticated
current member transaction; reuse any reserved, abandoned or retained replica id
inside a Project epoch; expose a snapshot/credential/checkpoint whose replica id is
not backed by the byte-identical consumed reservation receipt; call a final
shard-reset verifier after step 1; expose an F9/final-currentness entry point; admit
a viewer/pending editor; let Control own or persist a witness/permit; accept another
candidate/route after initial verification; produce a registry other than the exact
123-domain union; or find payload bytes in a durable service store after attester
cleanup.

### Decision

**SIGN** Revision 4 of this appendix as the control-plane/Peer protocol merge
candidate, conditional on exact artifact/bundle digest conformance with the Canvas,
kernel and Project artifacts. It deliberately leaves generic causal schemas, Canvas
semantics, Project-private witness/permit admission and ProjectIndex route/reset
persistence to their owning artifacts.

Score: **8.5/10**. Deductions are the attester/rollover common-mode dependency,
offline-editor/floor/reset-dependency availability, two bounded complete F13 calls,
operational cost of signed paged reconnect and the bounded permanent-id-burn
denial-of-service surface. They are nonfatal under the stated threat model because
service loss preserves offline local editing, shard reset is a low-frequency
destructive path whose verifier is synchronous and capped, one member cannot exceed
its 64-id lifetime cap, exhaustion is explicit rather than ambiguous reuse, every
unavailable prerequisite fails closed without corrupting canonical state, and
inventory/service metadata never becomes edit order or Project/Canvas authority.

### SHA-256 provenance

Primary semantic sources:

- approved Revision 4 reset/control closure proposal:
  `879547b9f437e28c9e9a78dc5fcbe0d94a150c96c6c920bd71853e9001fbf085`;
- Revision 3 control-plane appendix:
  `7df4f62a61495273960f5f640b8892d1480e09c617d1e3303931703e89f1b2ac`;

- service draft:
  `2e58e9c689ef0e1dc60bed9b5d49b95bf9c7da5e2cae955b13bb1e2d1b7ef2ea`;
- round-2 service review:
  `b0ef2bf02e0c5c84456fbd1dae0073c7506ec84de2f3fca2695ed9d078950920`;
- round-3 revision-4 candidate:
  `ca0a28fa5bc02c38f515f468a0d5b15440ea6763faafeb3feb37d652d0c3074b`;
- canonical service review:
  `438cde1243bc81ae8bfe8339bff75e866347d2d1bc2dc1998541e34be3b897b6`.
- prior control-plane appendix:
  `d884726daef51eacf3f2d4d9ea5e8448849b3995ab19b2ce9a72c64abd3d65a0`;
- canonical revision-2 service review:
  `c17b9a410cec815015244c40323e9478b303aba89af6493ac27a3d3235782a00`.

The whole-file SHA-256 is detached and reported in the reviewer handoff. Embedding
the file's own digest would be self-referential. Any normative byte change requires
a new detached digest and renewed architecture review.

## 17. Revision 5.1 normative authority and exact-object replacement

This section is normative Revision 5.1 authority and replaces every conflicting
Revision 4 statement in this appendix. Unchanged membership, reservation, epoch,
reset, inventory, channel and bounded service algorithms remain normative. Control
still owns authority metadata only: it does not own Y.Doc state, document order,
owner reducers, history materialization or Project-private admission state.

### 17.1 Four signed wrapper object identities

Revision 5.1 adds exactly four domains to the bundle registry:

```text
convax.checkpoint-content-certificate/2
convax.prunable-checkpoint-set-certificate/2
convax.replica-causal-floor-ack/2
convax.replica-checkpoint/2
```

For each wrapper kind `K`, `coreDigest` remains the signed statement identity and
the signature preimage continues to bind the exact core. The immutable wrapper
object identity is instead:

```text
objectDigest = SHA-256(UTF8(domain(K)) || 0x00 || exactCompleteWrapperJcs)
```

`exactCompleteWrapperJcs` is restricted JCS for the complete closed wrapper,
including `core`, `coreDigest`, signer/key identity and signature. Unknown or
missing fields, noncanonical bytes and a wrapper whose advertised `coreDigest` does
not recompute from its exact core reject before object admission.

The logical subject of each wrapper is:

| Wrapper | Logical subject |
| --- | --- |
| `ReplicaCheckpointV2` | `{scope, checkpointId}` |
| `CheckpointContentCertificateV2` | `{scope, checkpointObjectDigest}` |
| `ReplicaCausalFloorAckV2` | `{stableSetCoreDigest, replicaId}` |
| `PrunableCheckpointSetCertificateV2` | `{stableCheckpointSetCoreDigest}` |

The verifier enforces three independent uniqueness relations: exact wrapper object
digest, exact core digest and logical subject. Same kind plus same `coreDigest` with
two byte-distinct valid wrappers is terminal `signed-wrapper-equivocation`; both
objects are retained and quarantined and neither may be selected for currentness,
coverage, pruning or ACK. Different cores for the same kind and logical subject are
`wrapper-logical-subject-conflict` with the same fail-closed result. Arrival order,
wall clock and storage enumeration never select a winner.

Every native or portable reference to an exact signed wrapper uses the complete
object digest. Fields ending in `CoreDigest` refer only to a core statement. The
following Revision 4 field names are removed, not aliased:

| Removed Revision 4 field | Required Revision 5.1 field |
| --- | --- |
| `directParentCheckpointDigests` | `directParentCheckpointObjectDigests` |
| `proposalCheckpointDigest` | `proposalCheckpointObjectDigest` |
| `parentCheckpointDigests` | `parentCheckpointObjectDigests` |
| `checkpointDigest` | `checkpointObjectDigest` |
| `parentCertificateDigests` | `parentCertificateObjectDigests` |
| `contentCertificateDigests` | `contentCertificateObjectDigests` |
| `floorAckDigests` | `floorAckObjectDigests` |
| `prunableCheckpointSetCertificateDigest` | `prunableCheckpointSetCertificateObjectDigest` |
| `replicaCausalFloorAckDigest` | `replicaCausalFloorAckObjectDigest` |
| `frameOrCheckpointDigest` | `frameOrCheckpointObjectDigest` |

All mirrored inventory, transfer, registry-cutoff, active-peer, route, reset,
live-scope and floor DTO fields follow the same `ObjectDigest`/`ObjectDigests`
rule. An old name is an unknown key and a missing new name is a missing-key error;
there is no Revision 4 compatibility decoder.

### 17.2 Two-stage incoming authority

An incoming causal envelope is processed in this exact order:

1. parse only the bounded `CVXCOLL2` prelude, authenticated header and causal core;
2. call `verifyHeaderAuthority(prelude)`;
3. after success, enforce actor-sequence uniqueness/equivocation and parse the five
   bounded payload sections;
4. require signer/credential/membership/edit-authorization facts in the parsed
   context to equal the authenticated token byte-for-byte;
5. call `verifyDeclaredAuthorityDependencies(authenticated,
   declaredAuthorityRefs)` with strict missing/extra rejection;
6. verify exact-base dependencies, owner dependencies and owner semantics.

`verifyHeaderAuthority` verifies the three header/core authority digests, current
membership, replica credential, edit authorization, scope, actor, reservation and
signature. It returns a private, process-local, nonserializable capability bound to
the exact frame bytes:

```ts
declare const authenticatedIncomingFrameBrand: unique symbol

interface AuthenticatedIncomingFrameV2 {
  readonly [authenticatedIncomingFrameBrand]: true
  readonly frameDigest: DigestV2
  readonly exactEnvelopeBytes: Uint8Array
}
```

The capability is issued by the selected Control verifier, registered in a private
live set, consumed once and object-identity checked. It authorizes bounded parsing
only; it is not admission, persistence or commit authority. A bad signature paired
with a malformed payload must produce zero five-section parser, dependency resolver
and owner callback invocations.

### 17.3 Closed dependency partitions

Every declared dependency reference belongs to exactly one closed partition:

- **Authority:** `membership-snapshot`, `replica-actor-credential`,
  `replica-edit-authorization`, `authorization-mutation`,
  `cutoff-coverage-root`;
- **ExactBase:** `checkpoint-content-certificate`;
- **Owner:** `project-index-proof`, `project-resource-proof`,
  `plugin-validation-artifact`, `generation-external-fact`,
  `reset-authorization`.

Unknown, ambiguous or multiply classified references reject. Authority and
ExactBase resolvers independently require their declared sorted set to equal their
consumed sorted set. Owner discovery/materialization/application performs the same
equality check for the Owner partition. A fetchable absent object yields
`dependency-pending`; local resolver/owner drift yields `invalid-owner-result`;
authority changing the owner-required set yields `canonical-authority-conflict`;
an incoming mismatch yields `invalid-causal-frame`.

### 17.4 Registry, compatibility and mandatory negatives

The Revision 5.1 registry is the strict raw-UTF-8 sorted Revision 4 union plus the
four wrapper domains above: exactly **127** unique domains. Protocol major remains
`2`, but every artifact digest, bundle core/protocol digest, five-file authority
set, annex-set digest, detached manifest and review receipt is rotated. A Revision
4 bundle and a Revision 5.1 bundle reject one another before frame decoding. Old
portable projects may be preserved and explicitly reset; they are never silently
migrated, hydrated or rewritten.

Revision 5.1 is falsified if either arrival order chooses between conflicting
wrappers; if a core digest is accepted where an object digest is required; if any
old field name decodes; if a malformed-payload/bad-signature frame reaches the
section parser; if a dependency is missing, extra or classified twice without
rejection; if the registry is not exactly 127; or if Control persists document
payload, owner state, the authenticated-frame capability or a commit permit.

## 18. Revision 5.2 normative ingress and subject-identity replacement

This section is terminal Revision 5.2 Control authority and replaces every
conflicting Revision 5.1 ingress, capability, limit and wrapper-subject statement.
Revision 5.1 was not signed and provides no decoder or fallback. Protocol major
remains `2`.

### 18.1 Revision 5.2 protocol-limit value

The section-2 `ProtocolLimitsV2` object is replaced by the same closed 67 fields
plus exactly these four required string fields:

```ts
pendingRemoteIngressFramesPerProjectEpoch: "8192"
pendingRemoteIngressBytesPerProjectEpoch: "536870912"
pendingRemoteIngressFramesPerSourceMember: "512"
pendingRemoteIngressBytesPerSourceMember: "33554432"
```

The resulting object has exactly 71 fields including `format`. Its
`convax.protocol-limits/2` digest must be regenerated. Reservation, staging,
object-before-inbox and pending inbox bytes all count against the Project-epoch and
stable source-member totals until accepted/finalized, released, or atomically
transferred into existing bounded quarantine accounting. The existing document and
actor inbox caps apply additionally after header authority succeeds. Peer id,
session id, connection id, claimed scope and claimed actor never partition quota.

### 18.2 Stable transfer identity and attempt takeover

For causal-frame transfer, the durable stable uniqueness key and value are:

```ts
type StableRemoteTransferKeyV2 =
  import("@convax/collaboration").StableRemoteTransferKeyV2
type RemoteTransferAttemptBindingV2 =
  import("@convax/collaboration").RemoteTransferAttemptBindingV2
type StableRemoteTransferValueV2 = DigestV2 // exact manifestDigest
```

The Kernel is the sole owner of both generic identity shapes/codecs. Control imports
them, authenticates the signed offer and constrains their values; it does not
redeclare or structurally extend them. Kernel owns no membership policy merely by
owning these generic identities.

`connectionId` appears only in a non-authoritative attempt key. Same stable key and
same manifest digest is an idempotent reconnect; one CAS may rebind the existing
reservation/staging writer to the new attempt and invalidates the old attempt.
There is never a second quota charge, staging writer, object or inbox. Same stable
key with a different manifest digest is terminal
`transfer-manifest-equivocation`; both exact signed offers are retained within
bounded evidence, the second reservation rejects and the channel closes. A new
manifest requires a new transfer id.

The authenticated signed offer and closed `PeerTransferManifestV2` bind exact
`kind`, scope, subject/frame digest, envelope byte length, ordinary envelope
SHA-256, protocol digest and manifest digest. Every chunk binds the same transfer
id and manifest digest plus contiguous index, offset, length and chunk hash.

### 18.3 Normative remote ingress order

The exact order is:

```text
authenticated Project-bound PeerMessage transfer offer and editor credential
-> closed manifest and declared kind/scope/length/hash caps
-> durable Project/member quota reservation
-> transfer accept and reservation-bound bounded chunk staging
-> exact length and full ordinary SHA-256
-> bounded CVXCOLL2 prelude/header/core parse and envelope hash checks
-> manifest/frame/header exact equality
-> causal header authority and signature verification
-> bounded five-section structural parse
-> immutable frame object fsync
-> remote pending-inbox ref fsync
-> declared-authority/dependency/exact-base/owner semantic validation
-> inbox-sourced journal fsync -> expected-head CAS/fsync -> projection/ACK
```

Manifest equality includes `kind == causal-frame`, byte-identical scope in the
current Project epoch route, `subjectDigest` equal to the recomputed domain-separated
frame digest, exact envelope length, ordinary SHA-256, protocol digest and the
authenticated offer/chunk transfer bindings. Header verification consumes the same
immutable staged-byte handle later written as the object; rereading another buffer
is forbidden.

Bad signature, role/epoch/protocol failure or any manifest/header/body mismatch
releases the reservation and deletes staging, or atomically transfers both into
bounded quarantine accounting. It produces no immutable frame object or inbox.
Viewer/update-role mismatch rejects before durable reservation.

The structural parser checks only framing and per-section preallocation caps,
restricted-JCS syntax/canonical byte equality, length/digest/trailing bytes and
duplicate shared-field equality. The Yjs update remains opaque bytes. Dependency,
authority/cutoff resolver, owner decode/apply, external fact and Yjs decode/apply
call counts are all zero. Persistence writes the original complete-envelope bytes
held by the capability; it never re-encodes parsed objects.

### 18.4 Four-stage private capability chain

Control implements the kernel-owned port and types; it does not redeclare them. The
runtime chain is:

```text
HeaderAuthenticatedIncomingFrameV2
  -> PayloadParsedIncomingFrameV2
  -> ObjectAndInboxDurablePayloadParsedV2
  -> FullyValidatedIncomingFrameV2
```

Each is process-local, nonserializable, held in a private runtime registry and
consumed once. The first binds immutable staged bytes/hash and authenticated header
facts and authorizes only the structural parser. The parser consumes it and returns
the second, bound to the same complete-envelope handle and five exact section
handles. Kernel persistence consumes the second with the exact reservation receipt,
fsyncs object then inbox, verifies receipts and returns the third. The third proves
both exact object and pending-inbox durability and authorizes only semantic
declared-authority/exact-base/owner/candidate/evidence/post validation. Successful
semantic validation consumes it and returns the fourth, bound also to current
authority/cutoff, expected accepted head and resulting frontier/actor-head; only the
fourth authorizes `appendAcceptedJournalFromInbox`.

No capability directly authorizes head or ACK, crosses frame/scope, or survives
restart. Bad signature plus malformed payload invokes structural parsing zero
times. Valid signature plus malformed structural payload invokes object/inbox and
every semantic resolver/owner callback zero times. Semantic dependency-pending has
durable object/inbox but no journal; retry cannot reuse the spent durable token and
must reauthenticate/reparse exact durable bytes through a kernel-private one-shot
rehydration gate. Journal admission rechecks current authority/cutoff.

### 18.5 Closed wrapper logical-subject digest

Revision 5.2 adds one governed domain:

```text
convax.signed-wrapper-subject/2
```

Its closed union is:

```ts
type SignedWrapperSubjectV2 =
  | { format: "convax.signed-wrapper-subject/2"; kind: "replica-checkpoint";
      scope: DocumentScopeV2; checkpointId: Id128V2 }
  | { format: "convax.signed-wrapper-subject/2";
      kind: "checkpoint-content-certificate"; scope: DocumentScopeV2;
      checkpointObjectDigest: DigestV2 }
  | { format: "convax.signed-wrapper-subject/2";
      kind: "replica-causal-floor-ack"; stableSetCoreDigest: DigestV2;
      replicaId: ReplicaIdV2 }
  | { format: "convax.signed-wrapper-subject/2";
      kind: "prunable-checkpoint-set-certificate";
      stableCheckpointSetCoreDigest: DigestV2 }
```

```text
subjectDigest = SHA-256(
  UTF8("convax.signed-wrapper-subject/2") || 0x00 ||
  restrictedJCS(exactClosedSubject)
)
```

Unequal canonical subjects with the same digest are terminal hash-collision
quarantine. Revision 5.2 registry is the strict raw-UTF-8 sorted Revision 5.1 set
plus this domain: exactly **128** unique entries. All artifacts, limits, bundle,
five-file hashes, annex-set, manifest and review receipts rotate.

### 18.6 Control falsifiers

Revision 5.2 is falsified if reconnect creates a second charge/writer; if connection
id participates in stable uniqueness or quota; if an unauthenticated offer reserves
bytes; if header failure writes object/inbox; if manifest/body/header substitution
passes; if a capability is copied, replayed or crosses frame/scope; if the limits
object has other than 71 fields; or if the registry is not exactly 128.

### 18.7 Registration claim and reset boundary

The terminal registration core replaces the two ambiguous Revision 4 fields:

```ts
interface DocumentRegistrationClaimCoreV2 {
  format: "convax.document-registration-claim-core/2"
  scope: DocumentScopeV2
  registrarMemberId: MemberIdV2
  registrarReplicaId: ReplicaIdV2
  registrarActorId: ActorIdV2
  registrarAuthorizationDigest: DigestV2
  claimRevision: Uint64V2
  genesisCheckpointObjectDigest: DigestV2
  projectIndexRouteDependencyFrameDigest: DigestV2
  protocolDigest: DigestV2
}
```

`genesisCheckpointDigest` and `projectIndexRouteDependencyDigest` are removed
unknown keys, not aliases. A claim verifies the complete genesis checkpoint object,
extracts canonical `CanvasIdentityV2.projectIndexRouteDependencyFrameDigest` and
requires byte equality. For initial creation the named F is a verified route-stage
frame; for reset it is the verified selected predecessor activation/reset frame.

Registration is not an activation precondition. A fully authorized replica may
commit F, build and verify G, activate the route offline and durably queue this
claim. Registry absence cannot undo ProjectIndex route authority.

Reset has exactly one portable Owner dependency kind: `reset-authorization`. Its
approval-rooted closed F13 input transitively carries route-CAS, staged G and the F
extracted from G plus current locked route/head/authority bytes. No independent
`project-index-proof`, `canvas-genesis-proof` or live-manifest Owner gate may accept,
pending or reject reset before F13. Missing transitive bytes use the single F13
pending result; malformed bytes use the single F13 rejection result.

## 19. Revision 5.3 normative reset-carrier and dependency-transfer replacement

This terminal section replaces every conflicting Revision 5.2 reset-carrier, F13,
Peer dependency-transfer, ingress-limit and ACK statement. Revision 5.2 was rejected
before signature and has no fallback decoder. Protocol major remains `"2"` with a
new exact bundle identity.

### 19.1 Exact `CVXRSA02` authorization carrier

```text
8 bytes  ASCII "CVXRSA02"
8 bytes  unsigned big-endian uint64 indexLength
N bytes  exact restricted-JCS DocumentShardResetAuthorizationCarrierIndexV2
...      contiguous exact section bytes
```

```ts
interface DependencyCarrierSectionV2 {
  ordinal: Uint32V2
  kind:
    | "canvas-genesis-proof-carrier"
    | "replica-actor-credential"
    | "replica-edit-authorization"
    | "replica-id-reservation-receipt"
    | "membership-snapshot"
    | "membership-member"
    | "membership-replica"
    | "replica-project-floor-root"
    | "replica-project-floor-page"
    | "project-index-live-scope-manifest"
    | "project-admin-capability"
    | "service-trust-bundle"
  subjectDigest: DigestV2
  byteOffset: Uint64V2
  byteLength: Uint64V2
  sha256: DigestV2
}

interface DocumentShardResetAuthorizationCarrierIndexV2 {
  format: "convax.document-shard-reset-authorization-carrier/2"
  projectIndexScope: ProjectIndexScopeV2
  operationId: Id128V2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  reason: DocumentShardResetReasonV2
  predecessorRouteFrameDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  canvasGenesisProofCarrierSha256: DigestV2
  credentialCoreDigest: DigestV2
  editAuthorizationCoreDigest: DigestV2
  reservationReceiptCoreDigest: DigestV2
  membershipSnapshotCoreDigest: DigestV2
  membershipReplicaDigest: DigestV2
  membershipMemberDigest: DigestV2
  floorRootCoreDigest: DigestV2
  orderedFloorPageDigests: readonly DigestV2[]
  projectIndexLiveScopeManifestDigest: DigestV2
  adminCapabilityCoreDigest: DigestV2
  trustBundleDigest: DigestV2
  sections: readonly DependencyCarrierSectionV2[]
  totalSectionBytes: Uint64V2
  protocolDigest: DigestV2
}
```

There is exactly one section of every kind except floor page. Floor pages are
ordinal `"0".."n-1"`, `n <= 8`, in the root's exact page-digest order; every other
kind has ordinal `"0"`. The section array sorts by `(kind raw UTF-8 bytes, ordinal
numeric)`. Offsets are contiguous from the first byte after the index, with no gap,
overlap or trailing bytes. Every length, ordinary hash, subject digest and mirrored
index digest is checked before allocation/semantic decode.

The `predecessorRouteFrameDigest` is F and is an untrusted lookup hint only. The
nested `CVXCGP02` carrier must be completely validated first and its canonical
`CanvasIdentityV2.projectIndexRouteDependencyFrameDigest` must equal that hint
before any base-closure lookup. Exact F bytes are not carried in C; they come only
from the Kernel exact-base phase view.

C is:

```text
SHA-256(
  UTF8("convax.document-shard-reset-authorization-carrier/2") || 0x00 ||
  exact complete CVXRSA02 bytes
)
```

This is the only new Revision 5.3 digest domain. C's preimage MUST NOT contain the
route-CAS, claim, confirmation, approval or reset-commit bytes or any digest of
those five objects, and MUST NOT contain C itself. Those five DTOs instead mirror C
and G, so the graph has no C-to-DTO-to-C cycle. C's authority sections are immutable
claimed snapshots only; they never prove current membership, floor, trust or admin
authority.

### 19.2 Complete Control reset DTO replacement

```ts
interface DocumentShardResetConfirmationCoreV2 {
  format: "convax.document-shard-reset-confirmation-core/2"
  confirmationId: Id128V2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  oldScope: DocumentScopeV2
  newScope: DocumentScopeV2
  reason: DocumentShardResetReasonV2
  routeCasCoreDigest: DigestV2
  predecessorActivationDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  resetAuthorizationCarrierDigest: DigestV2
  initiatorMemberId: MemberIdV2
  initiatorReplicaId: ReplicaIdV2
  initiatorActorId: ActorIdV2
  initiatorActorCredentialCoreDigest: DigestV2
  confirmationStatement:
    "replace-one-canvas-shard-and-retain-old-recovery-bytes"
  protocolDigest: DigestV2
}

interface DocumentShardResetApprovalCoreV2 {
  format: "convax.document-shard-reset-approval-core/2"
  approvalId: Id128V2
  resetClaimCoreDigest: DigestV2
  confirmationCoreDigest: DigestV2
  projectId: ProjectIdV2
  projectEpoch: Id128V2
  oldScope: DocumentScopeV2
  newScope: DocumentScopeV2
  reason: DocumentShardResetReasonV2
  routeCasCoreDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  resetAuthorizationCarrierDigest: DigestV2
  adminMemberId: MemberIdV2
  adminMemberAuthorizationEpoch: Id128V2
  adminCapabilityCoreDigest: DigestV2
  approvalStatement: "approve-exact-canvas-shard-reset"
  protocolDigest: DigestV2
}
```

Every repeated C/G/update/state-vector, route, scope, operation, initiator and admin
value is byte-identical to the Project-owned DTOs. The old checkpoint field spelling
is an unknown key, not an alias.

### 19.3 Eleven-field process-input F13 ABI

F13 remains one implementation, one first-failure algorithm and one diagnostic
result. It is pure in the precise sense that it is synchronous and deterministic
over explicit process inputs and performs no I/O. It is no longer callable by an
arbitrary browser caller using only portable bytes; Kernel must validate each
branded phase object before the call. A diagnostic result alone never grants reset
mutation authority.

```ts
interface DocumentShardResetBaseReferencesV2<
  P extends
    | "reset-f13-initial"
    | "reset-f13-final"
    | "reset-f13-incoming",
> {
  readonly carrierDigest: DigestV2
  readonly phase: P
  readonly baseReferences:
    OwnerResolvedBaseReferencesV2<"project-index", P>
}

interface VerifyDocumentShardResetAuthorityInputV2 {
  readonly claim: DocumentShardResetClaimExactJcsV2
  readonly confirmation: DocumentShardResetConfirmationExactJcsV2
  readonly approval: DocumentShardResetApprovalExactJcsV2
  readonly routeCas: DocumentShardResetRouteCasCoreExactJcsV2
  readonly resetCommit: CanvasRouteResetCommitExactJcsV2
  readonly dependencies: Readonly<{
    resetAuthorizationCarrier: Readonly<Uint8Array>
  }>
  readonly baseReferences: DocumentShardResetBaseReferencesV2<
    | "reset-f13-initial"
    | "reset-f13-final"
    | "reset-f13-incoming"
  >
  readonly candidateBinding:
    DocumentShardResetCandidateBindingExactJcsV2
  readonly candidateFacts: DocumentShardResetCandidateFactsV2
  readonly currentReplicaDocHead:
    DocumentShardResetCurrentReplicaDocHeadV2
  readonly currentRouteFacts:
    DocumentShardResetCurrentRouteFactsV2
}

interface DocumentShardResetCurrentRouteFactsV2 {
  readonly currentProjectIndexStateVectorDigest: DigestV2
  readonly currentProjectIndexCanonicalStateDigest: DigestV2
  readonly projectIndexScope: ProjectIndexScopeV2
  readonly predecessorActivationDigest: DigestV2
  readonly currentOldRouteActivationDigest: DigestV2
  readonly currentOldShardEpoch: Id128V2
  readonly currentNewRouteState: "absent"
  readonly currentStagedGenesisState: "inert"
  readonly currentStagedGenesisCheckpointObjectDigest: DigestV2
  readonly currentStagedGenesisFullUpdateDigest: DigestV2
  readonly currentStagedGenesisStateVectorDigest: DigestV2
  readonly currentStagedResetAuthorizationCarrierDigest: DigestV2
}
```

Step 1 defensively copies, caps, hashes and structurally parses C. Step 2 recomputes
the five DTO identities. Step 3 requires every C/G/update/state-vector mirror equal,
validates the complete nested G carrier, extracts F, and synchronously reads only F
from the branded phase view. It requires hint F, G identity F and exact-base view F
to be byte-equal, then validates F's causal envelope, typed intent, write evidence,
post frontier and exact selected predecessor with no extra business write.

The remaining authority/admin/floor steps consume only C's exact claimed sections
but, on initial, final and incoming/recovery calls alike, independently revalidate
them against the current authority-head witness. C validity, cache presence or an
earlier F13 result skips zero currentness checks. Candidate/head/route
reconstruction remains at the existing final step. Initial and final local calls
use distinct fresh phase views and fresh current facts; incoming/recovery runs the
same complete F13 once. Apply separately consumes a fresh `apply` phase view. Every
phase consumption set is exactly `{F}` and all returned F envelope bytes match.

### 19.4 Closed dependency-carrier wire delta

```ts
type DependencyCarrierTransferKindV2 =
  | "canvas-genesis-proof-carrier"
  | "document-shard-reset-authorization-carrier"

interface RemoteDependencyCarrierRefV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly attempt: RemoteTransferAttemptBindingV2
  readonly manifestDigest: DigestV2
  readonly kind: DependencyCarrierTransferKindV2
  readonly scope: DocumentScopeV2
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: DigestV2
  readonly exactByteLength: Uint64V2
  readonly wantedRootDigest: DigestV2
}

interface RemoteDependencyCarrierDurableReceiptV2 {
  readonly ref: RemoteDependencyCarrierRefV2
  readonly carrierIndexDigest: DigestV2
  readonly orderedSectionReceiptDigests: readonly DigestV2[]
  readonly dependencyIndexRecordDigest: DigestV2
}
```

Both `PeerTransferManifestCoreV2.kind` and object-request `objectKind` add the two
closed literals. They are fixed to the `update` channel and require scope. For CGP,
scope is the Canvas scope and `subjectDigest == G`; for RSA, scope is ProjectIndex
and `subjectDigest == C`. The manifest still binds stable key/transfer id, exact
scope, protocol, byte length, ordinary complete-byte SHA-256, chunk geometry and
manifest digest. A mismatched kind/channel/scope/subject rejects before reservation.

Only an authenticated outstanding wanted root from a verified pending causal frame,
staged exact operation or retained recovery record may authorize reservation. An
explicit authenticated object request creates that exact wanted root. An unsolicited
offer without exact `{kind,subjectDigest,scope}` demand returns
`dependency-not-requested` with zero allocation and zero quota charge.

The dependency path is separate from the four causal-frame capabilities:

```text
signed offer/current editor -> wanted root -> quota reservation
-> chunk staging -> complete length/hash
-> carrier/domain/section/semantic validation
-> constituent immutable objects fsync
-> dependency index and wanted-root record fsync
-> session transfer-ack
```

It never creates a causal-frame object/inbox/journal/head and never issues
`ReplicaDurableAckV2` or `BlobDurableAckV2`. The existing session transfer ACK is
used with `durabilityProofDigest:null`; it means only that the exact carrier closure
and dependency index are currently fsynced. It does not mean accepted frame, live
route, team-replicated, blob-replicated or permanently retained.

Same stable key plus manifest digest reconnects to one reservation/writer/charge;
another manifest is terminal equivocation. ACK releases connection writer/inflight
credit only. Project/member object and byte quota atomically transfers to the
dependent pending/staged/recovery root, then to accepted causal/checkpoint/route/
reset/history retention when consumed; it is never released before reclassification.
Only a complete no-root GC scan may delete and release. Exact duplicate G/C is not
charged twice; ambiguity retains every candidate.

### 19.5 Terminal limits, registry and falsifiers

`ProtocolLimitsV2` has exactly 73 fields including `format`. Its terminal delta is:

```ts
pendingRemoteIngressObjectsPerProjectEpoch: "8192"
pendingRemoteIngressBytesPerProjectEpoch: "536870912"
pendingRemoteIngressObjectsPerSourceMember: "512"
pendingRemoteIngressBytesPerSourceMember: "134217728"
canvasGenesisProofCarrierBytes: "83886080"
documentShardResetAuthorizationCarrierBytes: "100663296"
```

The retired `pendingRemoteIngressFrames...` keys reject. Document/actor 4096/256
MiB and 512/32 MiB caps apply only to causal frames, not carriers. Carrier parsers
use section handles/streaming validation and destroy the temporary G document before
candidate/head reconstruction. Project/member aggregate quota is enforced across
reservation, staging, durable dependency cache and retained roots.

The registry is 129 and adds only
`convax.document-shard-reset-authorization-carrier/2`. Channel-policy constants are
unchanged. Revision 5.3 is falsified if a valid carrier cannot fit its aggregate
quota; if an unsolicited carrier allocates; if reconnect charges twice; if carrier
ACK creates causal/blob durability; if ACK releases retained bytes; if current
authority is trusted from C; if F comes from C bytes or a caller-built port; if any
phase omits `{F}`; if C hashes a mirrored DTO; if limits/registry counts differ from
73/129; or if any old reset/ingress field decodes.

## Revision-5 terminal carrier-section and reset-verifier replacement

This terminal section replaces every earlier conflicting carrier section, reset
dependency, F13 input/currentness and reset transfer statement. It imports the
exact Revision-5 Kernel types and no older structural substitute.

`CanvasGenesisProofCarrierIndexV2`, its section union, mirrors, order and public
verifier result are owned only by the Canvas artifact. Control consumes only the
validated Canvas verifier result through the Project composition boundary. It MUST
NOT redeclare, alias, shorten or structurally match any CGP index field or section
subject.

```ts
type OrdinarySha256V2 = DigestV2
// Same lowercase-hex codec as DigestV2, but ordinary SHA-256 semantics;
// it is never accepted where a registered domain digest is required.

interface ResetCarrierSectionLayoutV2 {
  readonly ordinal: Uint32V2
  readonly byteOffset: Uint64V2
  readonly byteLength: Uint64V2
  readonly ordinarySha256: OrdinarySha256V2
}

type ResetCarrierDomainSectionKindV2 =
  | "canvas-genesis-proof-carrier"
  | "replica-actor-credential"
  | "replica-edit-authorization"
  | "replica-id-reservation-receipt"
  | "membership-snapshot"
  | "replica-project-floor-root"
  | "replica-project-floor-page"
  | "project-index-live-scope-manifest"
  | "project-admin-capability"
  | "service-trust-bundle"

type ResetCarrierOrdinaryJcsSectionKindV2 =
  | "membership-member"
  | "membership-replica"

type DocumentShardResetAuthorizationCarrierSectionV2 =
  | ({
      [K in ResetCarrierDomainSectionKindV2]: Readonly<
        ResetCarrierSectionLayoutV2 & {
          kind: K
          subjectDigest: DigestV2
        }
      >
    }[ResetCarrierDomainSectionKindV2])
  | ({
      [K in ResetCarrierOrdinaryJcsSectionKindV2]: Readonly<
        ResetCarrierSectionLayoutV2 & {
          kind: K
          subjectSha256: OrdinarySha256V2
        }
      >
    }[ResetCarrierOrdinaryJcsSectionKindV2])
```

A domain-backed RSA section rejects `subjectSha256`; an ordinary-JCS RSA section
rejects `subjectDigest`. `membership-member` and `membership-replica` bytes are the
exact restricted-JCS encodings of the unique values selected by id from the named
membership snapshot. Their subject hashes and every section `ordinarySha256` are
ordinary SHA-256 and create no domain.

```ts
interface DocumentShardResetAuthorizationCarrierIndexV2 {
  format: "convax.document-shard-reset-authorization-carrier/2"
  projectIndexScope: ProjectIndexScopeV2
  operationId: Id128V2
  oldScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  newScope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  reason: DocumentShardResetReasonV2
  predecessorRouteFrameDigest: DigestV2
  stagedGenesisCheckpointObjectDigest: DigestV2
  canvasGenesisProofCarrierSha256: OrdinarySha256V2
  credentialCoreDigest: DigestV2
  editAuthorizationCoreDigest: DigestV2
  reservationReceiptCoreDigest: DigestV2
  membershipSnapshotCoreDigest: DigestV2
  membershipMemberSha256: OrdinarySha256V2
  membershipReplicaSha256: OrdinarySha256V2
  floorRootCoreDigest: DigestV2
  orderedFloorPageDigests: readonly DigestV2[]
  projectIndexLiveScopeManifestDigest: DigestV2
  adminCapabilityCoreDigest: DigestV2
  trustBundleDigest: DigestV2
  sections: readonly DocumentShardResetAuthorizationCarrierSectionV2[]
  totalSectionBytes: Uint64V2
  protocolDigest: DigestV2
}
```

RSA contains exactly one ordinal-0 section of every non-page RSA kind and 0 through
8 consecutive floor-page sections in floor-root order. Sections sort physically by
`(kind raw UTF-8, ordinal numeric)`; offsets are contiguous after the index with no
gap, overlap or trailer. Named fields, parent lists and section subjects mirror
exactly. C remains the existing domain hash of complete `CVXRSA02` bytes and
excludes the five reset DTOs and all five DTO digests.

```ts
interface DocumentShardResetCurrentAuthorityBytesV2 {
  readonly credential: ExactJcsInputBytesV2
  readonly editAuthorization: ExactJcsInputBytesV2
  readonly reservationReceipt: ExactJcsInputBytesV2
  readonly membershipSnapshot: ExactJcsInputBytesV2
  readonly membershipMember: ExactJcsInputBytesV2
  readonly membershipReplica: ExactJcsInputBytesV2
  readonly floorRoot: ExactJcsInputBytesV2
  readonly orderedFloorPages: readonly ExactJcsInputBytesV2[]
  readonly projectIndexLiveScopeManifest: ExactJcsInputBytesV2
  readonly adminCapability: ExactJcsInputBytesV2
  readonly trustBundle: ExactJcsInputBytesV2
}

interface DocumentShardResetCurrentRouteFactsV2 {
  readonly currentProjectIndexStateVectorDigest: DigestV2
  readonly currentProjectIndexCanonicalStateDigest: DigestV2
  readonly projectIndexScope: ProjectIndexScopeV2
  readonly predecessorActivationDigest: DigestV2
  readonly currentOldRouteActivationDigest: DigestV2
  readonly currentOldShardEpoch: Id128V2
  readonly currentNewRouteState: "absent"
  readonly currentStagedGenesisState: "inert"
  readonly currentStagedGenesisCheckpointObjectDigest: DigestV2
  readonly currentStagedGenesisFullUpdateDigest: DigestV2
  readonly currentStagedGenesisStateVectorDigest: DigestV2
  readonly currentStagedResetAuthorizationCarrierDigest: DigestV2
}

interface VerifyDocumentShardResetAuthorityInputV2 {
  readonly claim: DocumentShardResetClaimExactJcsV2
  readonly confirmation: DocumentShardResetConfirmationExactJcsV2
  readonly approval: DocumentShardResetApprovalExactJcsV2
  readonly routeCas: DocumentShardResetRouteCasCoreExactJcsV2
  readonly resetCommit: CanvasRouteResetCommitExactJcsV2
  readonly dependencies: Readonly<{
    resetAuthorizationCarrier: Readonly<Uint8Array>
  }>
  readonly baseReferences: DocumentShardResetBaseReferencesV2<
    "reset-f13-initial" | "reset-f13-final" | "reset-f13-incoming"
  >
  readonly candidateBinding: DocumentShardResetCandidateBindingExactJcsV2
  readonly candidateFacts: DocumentShardResetCandidateFactsV2
  readonly currentReplicaDocHead: DocumentShardResetCurrentReplicaDocHeadV2
  readonly currentRouteFacts: DocumentShardResetCurrentRouteFactsV2
  readonly currentAuthority: DocumentShardResetCurrentAuthorityBytesV2
}
```

This is exactly twelve top-level fields. Every byte collection is required, closed,
defensively copied and capped; none is nullable. The function remains synchronous,
deterministic and no-I/O, and returns diagnostic only. Project's private witness
never enters F13. Under one held witness:
`A1 -> fresh snapshotExactBytes() -> initial F13 -> A2`; the permit winner later
performs `A3 -> a different fresh snapshotExactBytes() -> final F13 -> A4`.
Incoming/recovery uses a fresh witness snapshot and one complete incoming F13.
Claimed C authority bytes are validated historically; `currentAuthority` is
separately decoded and validated as the current chain. The verifier applies the
existing exact identity, epoch, state, cutoff, floor, trust and admin predicates
between them; it MUST NOT require whole membership snapshots or trust bundles to be
byte-equal merely because an unrelated legal entry advanced. A forged
`currentAuthority` can at most obtain a public diagnostic and can never mint the
Project-private permit or admission gate.

Every initial, final and incoming call consumes all twelve route fields: fields 1-3
are recomputed from the current accepted ProjectIndex head and equal
`currentReplicaDocHead`; fields 4-8 prove the sole live old route, matching
predecessor, activation and epoch, absent new route and inert staged state; fields
9-12 prove exact G, update, state-vector and C equality against stage, carrier, all
five DTO mirrors and candidate binding. Local initial/final derive 9-12 from the
exact fsynced inert reset-stage manifest. Incoming/recovery first installs the
carrier closure into an attempt-private inert incoming stage and fsyncs it; it never
copies C declarations directly into current facts. No omitted, cached or
caller-selected subset is valid.

The sole mutation order is:

```text
reconstruct latest accepted base
-> freeze {F}
-> clone an unmutated candidate
-> discover F
-> A1 / fresh snapshot / initial F13
-> A2
-> issue permit carrying distinct unopened final/apply affine capabilities
-> claim permit
-> A3 / fresh snapshot / final F13
-> A4
-> consume permit
-> enter the sole reducer in the same call frame
-> apply cap independently consumes F
-> validate post state
-> durable barrier
```

The candidate MUST NOT be mutated before final F13 and the reset reducer runs
exactly once. Incoming has a distinct one-shot admission capability carrying
incoming/apply caps; diagnostic success alone never enters the reducer.

## Revision-5 terminal Peer manifest, wanted-root and dependency ACK replacement

```ts
type PeerTransferKindV2 =
  | "causal-frame"
  | "checkpoint"
  | "validation-suffix"
  | "registry-page"
  | "causal-frontier"
  | "actor-head-set"
  | "state-vector"
  | "project-blob"
  | "canvas-genesis-proof-carrier"
  | "document-shard-reset-authorization-carrier"

interface PeerTransferManifestCoreV2 {
  format: "convax.peer-transfer-manifest-core/2"
  transferId: Id128V2
  channel: "update" | "blob"
  kind: PeerTransferKindV2
  scope: DocumentScopeV2 | null
  subjectDigest: DigestV2
  byteLength: Uint64V2
  sha256: OrdinarySha256V2
  chunkBytes: Uint32V2
  chunkCount: Uint32V2
  compression: "none"
  protocolDigest: DigestV2
}
```

`connectionId` is an unknown forbidden manifest key. It remains only in the signed
handshake, channel and message cores and the Kernel-branded process attempt.
Removing it is a hard cut: no nullable field, alias, exclusion-from-hash rule or
old-manifest decoder exists.

The standard object request retains its existing exact digest array. Carrier
requests are a distinct closed branch so scope cannot be omitted:

```ts
type PeerObjectRequestBodyV2 =
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "object-request"
      requestId: Id128V2
      objectKind:
        | "frame"
        | "checkpoint"
        | "certificate"
        | "cutoff"
        | "registry-page"
        | "causal-frontier"
        | "actor-head-set"
        | "state-vector"
        | "blob"
      digests: readonly DigestV2[]
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "object-request"
      requestId: Id128V2
      objectKind: DependencyCarrierTransferKindV2
      scope: DocumentScopeV2
      subjectDigest: DigestV2
    }>
```

The first branch rejects `scope` and `subjectDigest`; the second rejects `digests`.
A carrier request is accepted only from the authenticated current editor session
and durably creates or reuses the exact Project-owned immutable wanted record. The
sender never chooses a wanted-record digest.

```ts
interface RemoteDependencyCarrierRefV2 {
  readonly attempt: RemoteTransferAttemptBindingV2
  readonly kind: DependencyCarrierTransferKindV2
  readonly scope: DocumentScopeV2
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
}

declare const remoteDependencyCarrierDurableReceiptBrandV2: unique symbol
interface RemoteDependencyCarrierDurableReceiptV2 {
  readonly ref: RemoteDependencyCarrierRefV2
  readonly wantedRootRecordDigest: DigestV2
  readonly carrierIndexRecordDigest: DigestV2
  readonly transactionRecordDigest: DigestV2
  readonly dependencyCacheHeadDigest: DigestV2
  readonly [remoteDependencyCarrierDurableReceiptBrandV2]: true
}
```

The receipt is a Project-private affine process capability with no public
constructor, serializer, clone, persistence or digest. Its four record digests are
exact existing `localProjectStoreRecordDigest` values. The live registry binds the
exact transfer, subject, current folded head and one consume winner. It may be
reminted after reconnect from the same durable closure for the new branded attempt
without another reservation, charge or install.

Before reservation or body allocation the receiver validates in this exact order:

1. exact Revision-5 handshake, channel and message protocol digest and signatures;
2. `ref.attempt.connectionId` equals the live authenticated connection and its
   live-registry object;
3. authenticated session `{projectId,projectEpoch,memberId}` equals
   `attempt.stableKey.{projectId,projectEpoch,sourceMemberId}`;
4. `attempt.manifestDigest == manifest.coreDigest` and
   `stableKey.transferId == manifest.core.transferId`;
5. manifest/ref kind, scope, subject, ordinary SHA and byte length are byte-equal;
   every chunk repeats transferId and manifestDigest;
6. kind/channel/scope rule: both carrier kinds use update; CGP has Canvas scope and
   subject G; RSA has ProjectIndex scope and subject C;
7. same stable key has no different retained manifest digest;
8. an exact authenticated outstanding wanted record exists;
9. all four aggregate quota caps admit the one reserve transition.

A failure performs zero body allocation and zero payload quota mutation.

The closed transfer errors add:

```ts
type PeerTransferErrorCodeV2 =
  | /* every unchanged Revision-4 literal */
  | "transfer-attempt-stale"
  | "transfer-manifest-equivocation"
  | "dependency-not-requested"
  | "dependency-subject-conflict"
```

Protocol mismatch closes before body decode and emits no transfer-shaped response.
A stale/non-live connection attempt is `transfer-attempt-stale`; same stable key
with a different manifest is `transfer-manifest-equivocation`; absent wanted root
is `dependency-not-requested`; same subject with unequal complete valid bytes is
`dependency-subject-conflict`; aggregate overflow remains `capacity-exceeded`. None
can produce transfer-ack.

Carrier install follows the exact Project-store state machine:

```text
wanted fsync
-> reserve transaction/head CAS and quota charge
-> bounded staging/chunk fsync
-> complete length and ordinary SHA
-> carrier/index/section/domain/semantic validation
-> constituent immutable objects and one candidate index fsync
-> latest folded-head scan including every live reserved candidate
-> install-exact or dependency-subject-conflict transaction/head CAS
-> re-read exact folded closure under the sole-writer queue
-> mint and consume one receipt
-> enqueue transfer-ack in the same synchronous queue frame
```

A same-subject unequal live reservation blocks install and ACK even before its body
completes; it may proceed only after that exact reservation legally releases or
after both candidate indices are durable and a conflict head commits. Same raw-key
candidates share physical bytes/index and payload charge, but every wanted root
receives its own install-exact binding. Same stable key/same manifest reconnects to
the original reservation, writer and charge. Different manifest never reaches
staging.

The current folded head is the sole subject, wanted and quota authority. Raw
`{ordinarySha256,exactByteLength}` keys locate candidate bytes only; filesystem and
index scans only rebuild a projection. Zero live candidates is missing, exactly one
eligible equal candidate is resolved, and two unequal candidates are terminal
conflict. Arrival order never selects a winner.

A carrier transfer ACK is exactly:

```ts
{
  format: "convax.peer-control/2",
  kind: "transfer-ack",
  transferId: ref.attempt.stableKey.transferId,
  manifestDigest: ref.attempt.manifestDigest,
  durabilityProofDigest: null
}
```

It may be enqueued only while the receipt's current head fold proves the exact
wanted, unique eligible index/raw closure, install transaction and retained quota,
with no unequal live reservation or later conflict. Receipt validation, consume
and outbound enqueue are queue-linearized with no await, callback or lock release.
Reserve, raw, index or transaction fsync without the installing head never ACKs.
Conflict commits a quarantine head and sends only NACK; it may place a previously
accepted dependent shard into recovery-required, but cannot revoke a historical
ACK. Null proves only that the dependency closure/index were durable at ACK time;
it is not Replica/Blob durability, current route, team replication or permanent
retention.

ACK releases only connection writer/inflight credit. Install/reclassify transfers
quota with zero release. Quarantine retains every candidate charge.
`release-reservation` is legal only after partial staging deletion plus directory
fsync and proof of no raw/index/install/quarantine/root. `gc-mark` releases nothing;
only the exact second no-root scan and `gc-release` may delete, fsync and apply the
matching negative quota delta.

Revision-5 retains registry 129, limits 73, four unchanged channel policies and
protocol major 2 subject to the Kernel early exact-protocol gate. The new
wanted/index/transaction/head/checkpoint-page formats use
`convax.local-project-store-record-digest/2`; their raw/file SHA values are ordinary
SHA-256. No new domain or limit field is introduced.

Control conformance is falsified if a manifest accepts `connectionId`; reconnect
changes manifestDigest or charge; session/stable identity differs; an unsolicited
offer allocates; an unequal live reservation permits install or ACK; ACK occurs
before the installing head or outside the queue frame; a structural receipt copy
works; null ACK is treated as Replica/Blob durability; or registry/limits differ
from 129/73.
