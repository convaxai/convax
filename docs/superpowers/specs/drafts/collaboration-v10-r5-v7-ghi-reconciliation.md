# Collaboration v10 R5.7 G/H/I reconciliation candidate

Status: root-formatted, non-authoritative architecture review input.

This candidate contains the unique G/H/I reconciliation authored by the
collaboration Kernel/Control architecture owner after cross-review of the rejected
R5.6 docket. It grants no implementation or promotion permission. Any byte edit
changes its identity and invalidates prior votes.

## G. Project-epoch admission ledger

### Ownership

- `@convax/collaboration` owns admission commands, plain port evidence, Kernel
  capabilities, receipts and brands.
- `@convax/project/node` owns immutable ledger/head/checkpoint records, both COW
  maps and the persistence adapter.
- The sole mutable authority is one Project-epoch head pointer. Per-stable-key or
  per-member mutable head pointers have declaration count zero.

### Deterministic map keys

```ts
export type RemoteIngressEvidenceStableKeyStateMapKeyV2 = DigestV2
export type RemoteIngressEvidenceMemberQuotaMapKeyV2 = DigestV2
```

```text
stableKeyStateMapKey =
  SHA-256(
    UTF8("convax.project-local.remote-ingress-evidence-stable-key-map-key/2")
    || 0x00
    || restrictedJCS({
         projectId,
         projectEpoch,
         stableKey
       })
  )

memberQuotaMapKey =
  SHA-256(
    UTF8("convax.project-local.remote-ingress-evidence-member-quota-map-key/2")
    || 0x00
    || restrictedJCS({
         projectId,
         projectEpoch,
         sourceMemberId
       })
  )
```

These are Project-local deterministic record keys, not wire digest domains and not
`ProtocolSchemaBundleV2` registry entries. A matching key digest with unequal
canonical key bytes is `store-corrupt`; entries are never aliased.

### Native records

```ts
export type RemoteIngressEvidenceAdmissionStateV2 =
  | "reserved"
  | "settled"
  | "released"

export interface RemoteIngressEvidenceStableKeyStateRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-stable-key-state-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly stableKeyStateMapKey: RemoteIngressEvidenceStableKeyStateMapKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly prospectiveClosureExactByteLength: Uint64V2
  readonly admissionStartMissingObjects:
    readonly RemoteIngressEvidenceMissingObjectV2[]
  readonly accountedAdmissionByteLength: Uint64V2
  readonly monotonicAttemptCount: Uint32V2
  readonly currentAttemptOrdinal: Uint32V2
  readonly chargedClosureCount: Uint32V2
  readonly state: RemoteIngressEvidenceAdmissionStateV2
  readonly lastTransitionRecordDigest: DigestV2
  readonly priorStableKeyStateRecordDigest: DigestV2 | null
}

export interface RemoteIngressEvidenceMemberQuotaRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-member-quota-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly memberQuotaMapKey: RemoteIngressEvidenceMemberQuotaMapKeyV2
  readonly monotonicAttemptCount: Uint32V2
  readonly chargedClosureCount: Uint32V2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly lastTransitionRecordDigest: DigestV2
  readonly priorMemberQuotaRecordDigest: DigestV2 | null
}

export interface RemoteIngressEvidenceStableKeyStateRootRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-stable-key-state-root-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly rootPageDigest: DigestV2 | null
  readonly entryCount: Uint64V2
  readonly treeHeight: Uint32V2
  readonly mapCommitment: DigestV2
}

export interface RemoteIngressEvidenceMemberQuotaRootRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-member-quota-root-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly rootPageDigest: DigestV2 | null
  readonly entryCount: Uint64V2
  readonly treeHeight: Uint32V2
  readonly mapCommitment: DigestV2
}

export interface RemoteIngressEvidenceAdmissionTransitionRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-transition-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly transition: "reserve" | "settle" | "release"

  readonly stableKey: StableRemoteTransferKeyV2
  readonly stableKeyStateMapKey:
    RemoteIngressEvidenceStableKeyStateMapKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly memberQuotaMapKey: RemoteIngressEvidenceMemberQuotaMapKeyV2

  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly accountedAdmissionByteLength: Uint64V2

  readonly priorEpochHeadRecordDigest: DigestV2
  readonly priorStableKeyStateRecordDigest: DigestV2 | null
  readonly resultingStableKeyStateRecordDigest: DigestV2
  readonly priorMemberQuotaRecordDigest: DigestV2 | null
  readonly resultingMemberQuotaRecordDigest: DigestV2

  readonly priorStableKeyStateRootRecordDigest: DigestV2
  readonly resultingStableKeyStateRootRecordDigest: DigestV2
  readonly priorMemberQuotaRootRecordDigest: DigestV2
  readonly resultingMemberQuotaRootRecordDigest: DigestV2

  readonly resultingStableKeyMonotonicAttemptCount: Uint32V2
  readonly resultingMemberMonotonicAttemptCount: Uint32V2
  readonly resultingProjectMonotonicAttemptCount: Uint32V2

  readonly resultingStableKeyChargedClosureCount: Uint32V2
  readonly resultingMemberChargedClosureCount: Uint32V2
  readonly resultingProjectChargedClosureCount: Uint32V2

  readonly resultingMemberAccountedAdmissionByteLength: Uint64V2
  readonly resultingProjectAccountedAdmissionByteLength: Uint64V2

  readonly releaseReason:
    | "abandoned-authorization-closed"
    | "abandoned-caller-cancelled"
    | "abandoned-evidence-capacity-exceeded"
    | "charge-transferred-to-ingress-root"
    | null
}

export interface RemoteIngressEvidenceAdmissionCheckpointRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-checkpoint-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly coveredHistoryCommitment: DigestV2
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}

export interface RemoteIngressEvidenceAdmissionEpochHeadRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-epoch-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly currentTransitionRecordDigest: DigestV2 | null
  readonly currentCheckpointRecordDigest: DigestV2
  readonly previousCheckpointRecordDigest: DigestV2 | null
  readonly priorHeadRecordDigestSinceCheckpoint: DigestV2 | null
  readonly transitionsSinceCheckpoint: Uint32V2
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}
```

The sole mutable pointer is:

```text
<ProjectEpochNativeStore>/remote-ingress-evidence-admission/head
  -> RemoteIngressEvidenceAdmissionEpochHeadRecordV2 digest
```

### COW invariants

Both maps use the same closed page policy:

```text
leaf maximum: 128
non-root leaf minimum: 64
root leaf occupancy: 0..128
leaf overflow 129 split: 64/65

internal maximum: 96
non-root internal minimum: 48
root internal occupancy: 2..96
internal overflow 97 split: 48/49

maximum tree height: 9
maximum restricted-JCS page length: 65,536 bytes
```

Keys sort by decoded 32-byte digest, then canonical key bytes for collision
detection. Insertion requiring height 10 is `evidence-capacity-exceeded`; it writes
zero objects.

### Commands and plain evidence

```ts
export interface BeginRemoteIngressEvidenceAdmissionCommandV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2 | null
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2 | null
  readonly exactManifestCoreJcs: Readonly<Uint8Array>
  readonly prospectiveClosureRecordExactJcs: Readonly<Uint8Array>
  readonly admissionStartMissingObjects:
    readonly RemoteIngressEvidenceMissingObjectV2[]
}

export interface AdvanceRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "settle" | "release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2 | null
  readonly releaseReason:
    | "abandoned-authorization-closed"
    | "abandoned-caller-cancelled"
    | "abandoned-evidence-capacity-exceeded"
    | "charge-transferred-to-ingress-root"
    | null
}

export interface RemoteIngressEvidenceAdmissionTransitionPortEvidenceV2 {
  readonly transition: "reserve" | "settle" | "release"
  readonly idempotent: boolean
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly transitionRecordDigest: DigestV2
  readonly epochHeadRecordDigest: DigestV2
  readonly stableKeyStateRecordDigest: DigestV2
  readonly memberQuotaRecordDigest: DigestV2
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly checkpointRecordDigest: DigestV2
  readonly stableKeyMonotonicAttemptCount: Uint32V2
  readonly memberMonotonicAttemptCount: Uint32V2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly stableKeyChargedClosureCount: Uint32V2
  readonly memberChargedClosureCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly memberAccountedAdmissionByteLength: Uint64V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}

export type RemoteIngressEvidenceAdmissionPersistenceResultV2 =
  | Readonly<{
      status: "committed" | "idempotent"
      evidence: RemoteIngressEvidenceAdmissionTransitionPortEvidenceV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "epoch-head-stale"
        | "stable-key-state-stale"
        | "member-quota-state-stale"
        | "transfer-manifest-equivocation"
        | "stable-key-released"
        | "stable-key-attempt-limit"
        | "member-attempt-limit"
        | "project-attempt-limit"
        | "member-quota-exceeded"
        | "project-quota-exceeded"
        | "invalid-transition"
        | "evidence-capacity-exceeded"
        | "durability-failed"
        | "store-corrupt"
    }>

export interface RemoteIngressEvidenceAdmissionPersistencePortV2 {
  reserve(
    command: BeginRemoteIngressEvidenceAdmissionCommandV2,
  ): Promise<RemoteIngressEvidenceAdmissionPersistenceResultV2>

  advance(
    command: AdvanceRemoteIngressEvidenceAdmissionCommandV2,
  ): Promise<RemoteIngressEvidenceAdmissionPersistenceResultV2>
}
```

Project/node returns only the plain evidence above. Kernel reloads the sole current
head and compares every prior/resulting root, state record, counter, manifest and
closure mirror before minting:

```ts
export interface RemoteIngressEvidenceAdmissionStartedReceiptV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly stableKeyStateRecordDigest: DigestV2
  readonly epochHeadRecordDigest: DigestV2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly [remoteIngressEvidenceAdmissionStartedReceiptBrandV2]: true
}

export interface RemoteIngressEvidenceAdmissionCompletedReceiptV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly stableKeyStateRecordDigest: DigestV2
  readonly epochHeadRecordDigest: DigestV2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly [remoteIngressEvidenceAdmissionCompletedReceiptBrandV2]: true
}
```

Plain evidence is never accepted as a capability.

### Transitions and limits

```text
absent/released --reserve fresh manifest--> reserved
reserved        --settle exact closure--> settled
reserved        --release abandonment--> released
settled         --release atomic charge transfer--> released
```

Reserve for a new attempt atomically:

- increments stable-key, member and Project monotonic attempt counts by exactly one;
- increments stable-key, member and Project charged closure counts by exactly one;
- adds `accountedAdmissionByteLength` to member and Project charged bytes.

Settle changes no counter.

Release decrements charged counts and bytes but never any monotonic attempt count. A
settled release is permitted only in the same sole-writer critical section that
installs the replacement reservation/retained-root charge. There is no uncharged
interval.

Exact monotonic bounds are:

```text
stable key: <= 2
source member per Project epoch: <= 512
Project epoch: <= 8192
```

Same stable key, manifest, closure, missing set and state is idempotent and performs
no transition or increment. A different manifest while charged is equivocation.
After release, a fresh manifest is the only possible second attempt. A released
identical manifest cannot allocate again.

Project/node acquires its sole-writer critical section, compares the expected head
and both expected map entries before writing any immutable object. A mismatch
releases the section and writes zero transition, page, root, checkpoint or head
objects. Once comparison succeeds, it writes/fsyncs records and publishes the new
sole head last.

### Checkpoint, retention and GC

- Generation zero has one empty checkpoint and one initial head.
- Every 256th successful non-idempotent transition publishes a new checkpoint.
  `transitionsSinceCheckpoint` is therefore `"0".."255"`.
- A checkpoint head has `priorHeadRecordDigestSinceCheckpoint:null`; other heads
  link only within the current checkpoint interval.
- The current head names exactly the current and immediately previous checkpoints.
  Checkpoint records contain a history commitment, not a native object reference to
  older checkpoints.
- Stable-key entries are retained for the complete Project epoch because their
  monotonic attempt counts must never reset.
- The current and previous checkpoints, their reachable COW pages, every current
  stable-key/member record, and every durable reservation/staging/install/recovery/
  audit/carrier head are retention roots.
- An older head, checkpoint, obsolete state version or obsolete COW page is
  GC-eligible only after a newer checkpoint is current, it is unreachable from both
  retained checkpoints and every recovery root, and a complete Project-private
  metadata reference scan reports zero references twice.
- Brand values are never persistence roots. Restart reconstructs state exclusively
  from the sole epoch head and durable recovery heads, then Kernel may mint fresh
  capabilities after full revalidation.
- Project-epoch reset creates a new empty ledger. Old-epoch records remain under
  reset retention until old-epoch GC authority permits deletion; counters never
  migrate into the new epoch.

## H. RSA owner and terminal carrier authority

### Ownership and dependency direction

Runtime dependencies remain unchanged:

```text
canvas -> collaboration
project -> canvas, collaboration, project-files, uri, ui
project/collaboration-protocol -> collaboration
collaboration -> external yjs only
desktop -> project, canvas, collaboration
```

- `@convax/project/collaboration-protocol` owns RSA DTOs and the branded Control
  verifier bundle.
- `@convax/canvas` owns the selected Canvas runtime and CGP owner.
- `@convax/project` owns RSA semantic composition, wanted-root/currentness policy
  and terminal carrier ACK gate.
- `@convax/project/node` implements owner-install and carrier-index persistence and
  returns plain evidence.
- `@convax/collaboration` owns the generic owner factory and owner-install receipts.
- Desktop only supplies exact process capabilities.

### Exact Project-owned authority

```ts
declare const projectRsaOwnerAuthorityBrandV2: unique symbol
declare const projectRsaOwnerAuthorityFactoryBrandV2: unique symbol
declare const projectPrivateCarrierAckGateBrandV2: unique symbol
declare const remoteDependencyCarrierDurableReceiptBrandV2: unique symbol

export interface ProjectRsaOwnerAuthorityV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: ProjectIndexScopeV2
  readonly controlVerifierBundleDigest: DigestV2
  readonly canvasRuntimeArtifactDigest: DigestV2
  readonly wantedRootCurrentnessPolicyDigest: DigestV2
  readonly ownerInstallPersistenceArtifactDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  readonly [projectRsaOwnerAuthorityBrandV2]: true
}

export interface ProjectRsaOwnerAuthorityFactoryInputV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: ProjectIndexScopeV2
  readonly controlVerifierBundle:
    DocumentShardResetControlVerifierBundleV2
  readonly canvasRuntime: CanvasDocumentOwnerRuntimeV2
  readonly wantedRootCurrentness:
    ProjectWantedRootCurrentnessCapabilityV2
  readonly ownerInstallPersistence:
    DocumentShardResetOwnerInstallPersistenceCapabilityV2
}

export interface ProjectRsaOwnerAuthorityFactoryV2 {
  createAuthority(
    input: ProjectRsaOwnerAuthorityFactoryInputV2,
  ): ProjectRsaOwnerAuthorityV2

  createOwnerPort(
    authority: ProjectRsaOwnerAuthorityV2,
    genericFactory: RemoteNonFrameIngressOwnerPortFactoryV2,
  ): RemoteNonFrameIngressOwnerPortV2<
    "document-shard-reset-authorization-carrier",
    "project-private-carrier-ack"
  >

  readonly [projectRsaOwnerAuthorityFactoryBrandV2]: true
}
```

The factory's private live registry binds the authority object by exact object
identity to all four captured capabilities, all four artifact/policy digests,
`projectId`, `projectEpoch` and exact ProjectIndex scope. Structural copies,
digest-only reconstruction, cross-Project values, swapped currentness providers,
swapped persistence capabilities, disposed bundles or restarted values reject.

The `ownerAuthorityIdentity` passed into the generic Kernel factory is this exact
branded `ProjectRsaOwnerAuthorityV2`. The selected-authorities object must contain
the same object identity.

RSA validation performs, in order:

```text
bounded CVXRSA02 structural validation
-> exact embedded CGP validation through the bound Canvas runtime
-> closure and F13/reset binding validation through the bound Control bundle
-> live wanted-root and Project epoch/currentness check
-> editor authority and exact scope check
-> isolated owner semantic validation
```

Install repeats live wanted-root, epoch/currentness, editor authority and owner
identity checks immediately before invoking the bound persistence capability.
Project/node returns plain owner-install evidence; A's `<K,A>` Kernel path validates
it and alone mints:

```ts
RemoteNonFrameIngressOwnerInstallReceiptV2<
  "document-shard-reset-authorization-carrier",
  "project-private-carrier-ack"
>
```

### CGP/RSA terminal receipt

```ts
export type RemoteDependencyCarrierKindV2 =
  | "canvas-genesis-proof-carrier"
  | "document-shard-reset-authorization-carrier"

export interface RemoteDependencyCarrierDurablePortEvidenceV2<
  K extends RemoteDependencyCarrierKindV2,
> {
  readonly kind: K
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2
  readonly subjectDigest: DigestV2
  readonly immutableObjectDigest: DigestV2
  readonly ownerInstallRecordDigest: DigestV2
  readonly ownerHeadRecordDigest: DigestV2
  readonly dependencyIndexRecordDigest: DigestV2
  readonly dependencyIndexHeadRecordDigest: DigestV2
  readonly wantedRootDigest: DigestV2
  readonly editorAuthorityCoreDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
}

export interface RemoteDependencyCarrierDurableReceiptV2<
  K extends RemoteDependencyCarrierKindV2,
> {
  readonly kind: K
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2
  readonly subjectDigest: DigestV2
  readonly immutableObjectDigest: DigestV2
  readonly ownerInstallRecordDigest: DigestV2
  readonly dependencyIndexHeadRecordDigest: DigestV2
  readonly wantedRootDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  readonly [remoteDependencyCarrierDurableReceiptBrandV2]: true
}

export interface ProjectPrivateCarrierAckGateV2 {
  authorizeTerminalCarrierAck<
    K extends RemoteDependencyCarrierKindV2,
  >(
    install: RemoteNonFrameIngressOwnerInstallReceiptV2<
      K,
      "project-private-carrier-ack"
    >,
  ): Promise<
    | Readonly<{
        status: "authorized"
        receipt: RemoteDependencyCarrierDurableReceiptV2<K>
      }>
    | Readonly<{
        status: "pending"
        code: "wanted-root-pending" | "owner-install-pending"
      }>
    | Readonly<{
        status: "rejected"
        code:
          | "wanted-root-stale"
          | "project-epoch-stale"
          | "editor-authority-closed"
          | "owner-identity-mismatch"
          | "install-head-stale"
          | "carrier-evidence-mismatch"
          | "store-corrupt"
      }>
  >

  consumeTerminalCarrierAck<K extends RemoteDependencyCarrierKindV2>(
    receipt: RemoteDependencyCarrierDurableReceiptV2<K>,
  ): Readonly<{
    kind: K
    subjectDigest: DigestV2
    durabilityProofDigest: null
  }>

  readonly [projectPrivateCarrierAckGateBrandV2]: true
}
```

Project/node returns only `RemoteDependencyCarrierDurablePortEvidenceV2<K>`.
Project compares every mirror against the live wanted root, exact generic
owner-install receipt, current editor authority, exact registered owner identity and
reloaded install/index heads before minting its private receipt.

Only the same Project gate may consume that receipt. Receipt mint and consume are
distinct one-shot registry states. The generic owner-install receipt,
immutable-object receipt or plain evidence cannot directly produce ACK. CGP and RSA
both terminate only after this private receipt is consumed; the resulting session
ACK always has `durabilityProofDigest:null`.

## I. Durable reference scan fence

### Fence port

```ts
export interface PublishDurableReferenceScanFenceCommandV2 {
  readonly ref: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly expectedAcceptedHeadRecordDigest: DigestV2
  readonly expectedStoreGeneration: Uint64V2
  readonly expectedReferenceIndexHeadRecordDigest: DigestV2
  readonly expectedReferenceIndexGeneration: Uint64V2
  readonly expectedReferenceIndexRootRecordDigest: DigestV2
  readonly expectedReferenceIndexRootPageDigest: DigestV2 | null
  readonly expectedReferenceEntryCount: Uint64V2
  readonly expectedIndexCommitment: DigestV2
  readonly expectedCoverageRecordDigest: DigestV2
}

export interface DurableReferenceScanFencePortEvidenceV2 {
  readonly ref: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly fenceCommitRecordDigest: DigestV2

  readonly priorAcceptedHeadRecordDigest: DigestV2
  readonly resultingAcceptedHeadRecordDigest: DigestV2

  readonly priorStoreGeneration: Uint64V2
  readonly resultingStoreGeneration: Uint64V2

  readonly priorReferenceIndexHeadRecordDigest: DigestV2
  readonly resultingReferenceIndexHeadRecordDigest: DigestV2
  readonly priorReferenceIndexGeneration: Uint64V2
  readonly resultingReferenceIndexGeneration: Uint64V2

  readonly priorReferenceIndexRootRecordDigest: DigestV2
  readonly resultingReferenceIndexRootRecordDigest: DigestV2
  readonly priorReferenceIndexRootPageDigest: DigestV2 | null
  readonly resultingReferenceIndexRootPageDigest: DigestV2 | null
  readonly priorReferenceEntryCount: Uint64V2
  readonly resultingReferenceEntryCount: Uint64V2
  readonly priorIndexCommitment: DigestV2
  readonly resultingIndexCommitment: DigestV2
  readonly priorCoverageRecordDigest: DigestV2
  readonly resultingCoverageRecordDigest: DigestV2

  readonly scanRecoveryHeadRecordDigest: DigestV2
}

export type PublishDurableReferenceScanFencePortResultV2 =
  | Readonly<{
      status: "published"
      evidence: DurableReferenceScanFencePortEvidenceV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "first-proof-stale"
        | "scan-fence-already-published"
        | "accepted-head-stale"
        | "store-generation-stale"
        | "reference-index-head-stale"
        | "reference-index-generation-stale"
        | "reference-index-state-changed"
        | "generation-exhausted"
        | "durability-failed"
        | "store-corrupt"
    }>

export interface DurableReferencePersistencePortV2 {
  scanDurableReferences(
    ref: FrameObjectRefV2,
    proofKind: "first-scan" | "second-scan",
    priorProofRecordDigest: DigestV2 | null,
    precedingScanFenceCommitRecordDigest: DigestV2 | null,
  ): Promise<DurableReferenceScanPortResultV2>

  publishDurableReferenceScanFence(
    command: PublishDurableReferenceScanFenceCommandV2,
  ): Promise<PublishDurableReferenceScanFencePortResultV2>

  garbageCollectFrameObject(
    command: GarbageCollectFrameObjectPersistenceCommandV2,
  ): Promise<GarbageCollectFrameObjectResultV2>
}
```

Project/node executes the fence under the sole-writer critical section. It reloads
the first proof and all expected facts, rejects an existing fence for that proof,
then atomically:

```text
fsync fence commit
-> advance storeGeneration by exactly one
-> publish reference-index head with generation advanced by exactly one
-> fsync/update scan recovery head
-> return plain fence evidence
```

The accepted head, root record, root page, entry count, index commitment and coverage
record must be byte-identical before and after the fence.

Kernel accepts fence evidence only while the exact first branded proof is live. It
compares every field with the first proof's private full evidence, registers exactly
one fence against that proof and permits the second scan only through that registry
entry. There is no public or serializable fence capability and no fence brand.

`DurableReferenceScanPortEvidenceV2` adds:

```ts
readonly precedingScanFenceCommitRecordDigest: DigestV2 | null
```

Rules:

- First scan: `priorProofRecordDigest:null` and
  `precedingScanFenceCommitRecordDigest:null`.
- Second scan: prior equals the exact first proof and fence equals its exact
  registered fence.
- Second `storeGeneration` and `referenceIndexGeneration` are both strictly greater
  than the first scan values.
- The second accepted head, root/page, entry count, commitment and coverage equal
  the fence's resulting values.
- A missing, replaced, repeated or cross-proof fence mints no second proof.

### Recovery metadata and reference semantics

```ts
export interface DurableReferenceScanRecoveryHeadRecordV2 {
  readonly format:
    "convax.durable-reference-scan-recovery-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scanOperationId: Id128V2
  readonly phase:
    | "first-proof-durable"
    | "fence-durable"
    | "second-proof-durable"
    | "gc-command-issued"
  readonly targetRefDiagnostic: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly fenceCommitRecordDigest: DigestV2 | null
  readonly secondProofRecordDigest: DigestV2 | null
}
```

The following closed record formats are metadata-only for target reachability:

```text
convax.durable-reference-scan-proof-record/2
convax.durable-reference-scan-fence-commit-record/2
convax.durable-reference-scan-recovery-head-record/2
convax.frame-object-gc-command-record/2
```

Their embedded `FrameObjectRefV2`, `targetRefDigest` and diagnostic fields produce
zero durable-reference-index edges to the target frame. Otherwise the scan would
self-reference and GC could never complete.

The recovery head creates durable edges only to proof, fence and command metadata
records. It protects crash recovery of the scan sequence without protecting the
target frame. On restart, Kernel may mint fresh proof capabilities only after
reloading and fully validating the metadata closure; brands are never deserialized.

After deleted/not-deleted terminal persistence and recovery reconciliation, the
recovery head is cleared. Proof/fence/command metadata becomes eligible for
Project-private metadata GC only after no recovery head references it.

### GC command extension

F's plain command is extended, not replaced:

```ts
export interface GarbageCollectFrameObjectPersistenceCommandV2 {
  readonly ref: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly fenceCommitRecordDigest: DigestV2
  readonly secondProofRecordDigest: DigestV2
  readonly secondAcceptedHeadRecordDigest: DigestV2
  readonly secondStoreGeneration: Uint64V2
  readonly secondReferenceIndexHeadRecordDigest: DigestV2
  readonly secondReferenceIndexGeneration: Uint64V2
  readonly secondReferenceIndexRootRecordDigest: DigestV2
  readonly secondReferenceIndexRootPageDigest: DigestV2 | null
  readonly secondReferenceEntryCount: Uint64V2
  readonly secondIndexCommitment: DigestV2
  readonly secondCoverageRecordDigest: DigestV2
  readonly scanRecoveryHeadRecordDigest: DigestV2
}
```

Kernel consumes both live proof brands, their registered fence and its internal
one-shot GC authorization before sending this plain command. Project/node reloads
both proofs, the fence and recovery head, then rechecks the current accepted head,
store generation, index head/generation, root/page/count/commitment/coverage, all
eight source heads, zero references and unreachability in the same critical section
as deletion.

## Mandatory falsifiers

1. Two stable keys from one member concurrently exceed remaining quota: at most one
   epoch-head CAS succeeds; loser writes zero native objects.
2. After 8,192 Project attempts, reserve is permanently rejected in that epoch even
   when every prior attempt was abandoned and released.
3. A stable key's third fresh attempt, a member's 513th attempt and a Project's
   8,193rd attempt each write zero objects.
4. After more than 256 transitions, current stable-key/member lookup uses the current
   COW roots and never scans historical heads.
5. Random COW operations cover 128/64 leaves, 96/48 internals,
   split/borrow/merge/root-collapse; no page exceeds 65,536 bytes or height 9.
6. A CAS loser leaves transition/page/root/checkpoint/head object counts unchanged.
7. Project/node plain admission evidence cannot invoke any Kernel authority or mint
   either admission receipt.
8. Swapping only the RSA currentness resolver or owner-install persistence capability
   changes authority identity and invalidates the port.
9. Cross-Project, cross-epoch, structural, restarted or disposed RSA authority values
   invoke zero owner callbacks.
10. CGP/RSA immutable or generic owner-install receipts produce zero ACK without a
    freshly minted and consumed Project-private carrier receipt.
11. A quiescent unreachable frame completes first scan, exactly one fence, second
    scan and deletion with both generations strictly increasing.
12. A second fence for the same first proof writes zero objects.
13. Any root/page/count/commitment/coverage change across the fence mints no second
    proof.
14. Scan proof, fence, recovery-head and GC-command metadata add zero reference-index
    entries for the target frame.
15. Crash after every fence/recovery/GC barrier either resumes the exact sequence or
    returns not-deleted; it never deletes without two revalidated proofs.
16. Replaying the plain GC command after any source-head change deletes zero objects.

## Exact declaration counts

Exactly one source, built and packed declaration:

- Collaboration: two admission receipt brands, admission command/evidence port,
  generic owner-install `<K,A>`, scan proof brand, scan fence command/evidence port
  and plain GC command.
- Project/node: epoch head, transition, checkpoint, stable-key state/root, member
  quota/root, COW page formats, fence commit, recovery head and their adapters.
- Project: RSA authority brand/factory/private registry, wanted-root/currentness
  capability, Project-private carrier ACK gate and carrier durable receipt brand.
- Project collaboration-protocol: RSA DTO and Control verifier bundle only.
- Canvas: selected Canvas runtime, CGP validator and CGP owner only.
- Desktop: composition only.

Zero declarations:

```text
per-stable-key mutable ledger head
per-member mutable quota head
historical-head lookup for current stable-key state
Project/node-minted Kernel receipt
serializable admission/fence/authority brand
public RSA authority constructor
RSA authority identity omitting any captured capability
public scan-fence capability
scan metadata reference edge to target FrameObjectRef
branded GC authorization crossing persistence
CGP/RSA ACK before Project-private receipt consumption
store-only or index-only scan-fence generation advance
```

## Unconditional author vote

The collaboration Kernel/Control architecture owner unconditionally votes `ADOPT`
for this exact G/H/I reconciliation.
