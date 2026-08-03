# Collaboration v10 R5.9 G/H unique delta

Status: architecture-owner-authored, non-authoritative correction input. It
replaces G and H of rejected candidate SHA-256
`f91a36bffa8cd8e60a124305bcc40f71fcb062f77c0b11726a645eec9de07b46`.
It grants no implementation or promotion permission. I remains the unchanged
three-party-approved R5.8 text.

## G. Project-epoch evidence admission

### G.1 Ownership and sole authorities

```text
@convax/collaboration
  owns admission commands, plain persistence evidence, Kernel receipt factories,
  process brands and private receipt registries.

@convax/project/node
  owns Project-native admission records, both COW maps, recursive checkpoints,
  replacement-charge binding records, metadata-GC records and persistence adapters.

The sole mutable admission authority is:

<ProjectEpochNativeStore>/remote-ingress-evidence-admission/head
  -> RemoteIngressEvidenceAdmissionEpochHeadRecordV2 digest

The sole mutable metadata-deletion authority is:

<ProjectEpochNativeStore>/remote-ingress-evidence-admission/metadata-gc-head
  -> RemoteIngressEvidenceMetadataGcHeadRecordV2 digest
```

The metadata-GC head grants no admission, quota, transfer, Canvas or frame-deletion
authority. Per-stable-key and per-member mutable head pointers have declaration
count zero.

### G.2 Monotonic attempt and quota authorities

```ts
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

The three monotonic authorities are:

```text
stable key:
  RemoteIngressEvidenceStableKeyStateRecordV2.monotonicAttemptCount

source member:
  RemoteIngressEvidenceMemberQuotaRecordV2.monotonicAttemptCount

Project epoch:
  RemoteIngressEvidenceAdmissionEpochHeadRecordV2.projectMonotonicAttemptCount
```

Exact rules:

```text
A successful non-idempotent reserve increments all three attempt counts by one.

Settle, abandon-release and transfer-release change no attempt count.

Release decrements charged closure counts and accounted bytes but never returns an
attempt slot.

Exact bounds:
  stable key <= 2
  source member per Project epoch <= 512
  Project epoch <= 8192

An exact idempotent reserve increments no count and writes no native object.

A third stable-key attempt, 513th member attempt or 8193rd Project attempt rejects
before writing a value record, page, root, transition, checkpoint or head.
```

Required result codes:

```ts
export type RemoteIngressEvidenceAdmissionRejectCodeV2 =
  | "epoch-head-stale"
  | "stable-key-state-stale"
  | "member-quota-state-stale"
  | "transfer-manifest-equivocation"
  | "stable-key-released-identical-manifest"
  | "stable-key-attempt-limit"
  | "member-attempt-limit"
  | "project-attempt-limit"
  | "member-quota-exceeded"
  | "project-quota-exceeded"
  | "source-member-mismatch"
  | "closure-object-mismatch"
  | "replacement-charge-mismatch"
  | "replacement-charge-already-transferred"
  | "invalid-transition"
  | "evidence-capacity-exceeded"
  | "durability-failed"
  | "store-corrupt"
```

### G.3 Canonical shared COW map

```ts
export type RemoteIngressEvidenceMapKindV2 =
  | "stable-key-state"
  | "member-quota"

export type RemoteIngressEvidenceMapLeafEntryV2 =
  | Readonly<{
      mapKind: "stable-key-state"
      keyDigest: RemoteIngressEvidenceStableKeyStateMapKeyV2
      stableKey: StableRemoteTransferKeyV2
      valueRecordDigest: DigestV2
    }>
  | Readonly<{
      mapKind: "member-quota"
      keyDigest: RemoteIngressEvidenceMemberQuotaMapKeyV2
      sourceMemberId: MemberIdV2
      valueRecordDigest: DigestV2
    }>

export interface RemoteIngressEvidenceMapLeafPageRecordV2 {
  readonly format: "convax.remote-ingress-evidence-map-leaf-page-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly height: "0"
  readonly entries: readonly RemoteIngressEvidenceMapLeafEntryV2[]
  readonly subtreeEntryCount: Uint64V2
}

export type RemoteIngressEvidenceMapBoundaryKeyV2 =
  | Readonly<{
      mapKind: "stable-key-state"
      keyDigest: RemoteIngressEvidenceStableKeyStateMapKeyV2
      stableKey: StableRemoteTransferKeyV2
    }>
  | Readonly<{
      mapKind: "member-quota"
      keyDigest: RemoteIngressEvidenceMemberQuotaMapKeyV2
      sourceMemberId: MemberIdV2
    }>

export interface RemoteIngressEvidenceMapChildV2 {
  readonly firstKey: RemoteIngressEvidenceMapBoundaryKeyV2
  readonly lastKey: RemoteIngressEvidenceMapBoundaryKeyV2
  readonly childPageRecordDigest: DigestV2
  readonly childSubtreeEntryCount: Uint64V2
}

export interface RemoteIngressEvidenceMapInternalPageRecordV2 {
  readonly format: "convax.remote-ingress-evidence-map-internal-page-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly height: Uint32V2
  readonly children: readonly RemoteIngressEvidenceMapChildV2[]
  readonly subtreeEntryCount: Uint64V2
}

export interface RemoteIngressEvidenceMapRootRecordV2 {
  readonly format: "convax.remote-ingress-evidence-map-root-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly mapKind: RemoteIngressEvidenceMapKindV2
  readonly generation: Uint64V2
  readonly rootPageDigest: DigestV2 | null
  readonly entryCount: Uint64V2
  readonly treeHeight: Uint32V2
  readonly mapCommitment: DigestV2
}
```

Canonical key ordering is decoded 32-byte `keyDigest`, then unsigned-byte order of
the restricted-JCS canonical key object. Equal digest with unequal canonical key
bytes is `store-corrupt`; entries never alias.

The sole empty form is:

```text
rootPageDigest = null
entryCount = "0"
treeHeight = "0"

mapCommitment = ProjectLocalRecordDigest(
  restrictedJCS({
    format: "convax.remote-ingress-evidence-empty-map/2",
    projectId,
    projectEpoch,
    mapKind
  })
)
```

A zero-entry leaf is invalid.

For a non-empty root:

```text
rootPageDigest != null
entryCount = rootPage.subtreeEntryCount
treeHeight = rootPage.height
mapCommitment = rootPageDigest
```

Closed geometry:

```text
leaf maximum: 128
non-root leaf minimum: 64
root leaf occupancy: 1..128
leaf overflow 129 split: 64/65

internal maximum: 74
non-root internal minimum: 37
root internal occupancy: 2..74
internal overflow 75 split: 37/38

maximum height: 9
maximum exact restricted-JCS page length: 65,536 bytes
```

The fixed maximum fixture uses a 96-byte ProjectId, maximum legal Id128 values,
maximum Uint64 values and the stable-key boundary variant:

```text
74-child internal page exact JCS = 64,847 bytes and is admitted
75-child internal page exact JCS = 65,719 bytes and is split before serialization
```

No 75-child page enters digesting or persistence. Pre-write and post-read page gates
independently enforce exact JCS length, geometry, ordering, boundaries, subtree
counts, Project, epoch and map kind.

Insertion requiring height 10 rejects before writing any object.

### G.4 Closed stable-key state

```ts
export interface RemoteIngressEvidenceStableKeyStateBaseV2 {
  readonly format:
    "convax.remote-ingress-evidence-stable-key-state-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly stableKeyStateMapKey:
    RemoteIngressEvidenceStableKeyStateMapKeyV2
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
  readonly lastTransitionRecordDigest: DigestV2
  readonly priorStableKeyStateRecordDigest: DigestV2 | null
}

export type RemoteIngressEvidenceStableKeyStateRecordV2 =
  | Readonly<
      RemoteIngressEvidenceStableKeyStateBaseV2 & {
        state: "reserved"
        signedOfferEvidenceClosureObjectDigest: null
        abandonmentReason: null
        chargeTransferBindingRecordDigest: null
      }
    >
  | Readonly<
      RemoteIngressEvidenceStableKeyStateBaseV2 & {
        state: "settled"
        signedOfferEvidenceClosureObjectDigest: DigestV2
        abandonmentReason: null
        chargeTransferBindingRecordDigest: null
      }
    >
  | Readonly<
      RemoteIngressEvidenceStableKeyStateBaseV2 & {
        state: "released"
        releaseKind: "abandoned"
        signedOfferEvidenceClosureObjectDigest: null
        abandonmentReason:
          | "authorization-closed"
          | "caller-cancelled"
          | "evidence-capacity-exceeded"
        chargeTransferBindingRecordDigest: null
      }
    >
  | Readonly<
      RemoteIngressEvidenceStableKeyStateBaseV2 & {
        state: "released"
        releaseKind: "charge-transferred"
        signedOfferEvidenceClosureObjectDigest: DigestV2
        abandonmentReason: null
        chargeTransferBindingRecordDigest: DigestV2
      }
    >
```

Reserved and settled states have `chargedClosureCount:"1"`. Released states have
`chargedClosureCount:"0"`.

`currentAttemptOrdinal` equals `monotonicAttemptCount` for the current or most
recently terminal attempt. It is `"1"|"2"`.

### G.5 Non-cyclic charge-transfer binding

The binding is two-level to avoid a digest cycle.

```ts
export type RemoteIngressEvidenceReplacementChargeKindV2 =
  | "remote-ingress-reservation"
  | "manifest-equivocation-high-water"
  | "installed-payload"
  | "owner-install"
  | "recovery"
  | "audit"
  | "dependency-carrier"

export interface RemoteIngressEvidenceChargeTransferBindingCoreV2 {
  readonly format:
    "convax.remote-ingress-evidence-charge-transfer-binding-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly currentAttemptOrdinal: Uint32V2
  readonly manifestCoreDigest: DigestV2
  readonly settledStableKeyStateRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly replacementKind:
    RemoteIngressEvidenceReplacementChargeKindV2
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64V2
}

export interface RemoteIngressEvidenceReplacementChargeV2 {
  readonly chargeTransferBindingDigest: DigestV2
  readonly kind: RemoteIngressEvidenceReplacementChargeKindV2
  readonly rootRecordDigest: DigestV2
  readonly rootHeadRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64V2
}

export interface RemoteIngressEvidenceChargeTransferBindingRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-charge-transfer-binding-record/2"
  readonly core:
    Readonly<RemoteIngressEvidenceChargeTransferBindingCoreV2>
  readonly coreDigest: DigestV2
  readonly replacement:
    Readonly<RemoteIngressEvidenceReplacementChargeV2>
}
```

Exact digest:

```text
chargeTransferBindingDigest =
  ProjectLocalRecordDigest(
    restrictedJCS(RemoteIngressEvidenceChargeTransferBindingCoreV2)
  )
```

`coreDigest` and `replacement.chargeTransferBindingDigest` both equal that value.

Every admitted replacement root record and its current head record contain:

```ts
readonly chargeTransferBindingDigest: DigestV2
```

Both values equal the core digest. The final binding record then binds those exact
root/head digests. Replacement root/head never reference the final binding-record
digest, so the graph has no digest cycle.

The replacement root/head must:

- be fsynced and mutually linked;
- bind the same Project, epoch, stableKey, source member, manifest and current
  attempt;
- directly retain the exact closure object;
- own exactly one charged closure and the exact admission byte charge;
- be current at transfer CAS time.

### G.6 Discriminated commands

```ts
export interface BeginRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "reserve"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2 | null
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2 | null
  readonly exactManifestCoreJcs: Readonly<Uint8Array>
  readonly prospectiveClosureRecordExactJcs: Readonly<Uint8Array>
  readonly admissionStartMissingObjects:
    readonly RemoteIngressEvidenceMissingObjectV2[]
}

export interface SettleRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "settle"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
}

export interface AbandonRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "abandon-release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
  readonly abandonmentReason:
    | "authorization-closed"
    | "caller-cancelled"
    | "evidence-capacity-exceeded"
}

export interface TransferRemoteIngressEvidenceAdmissionChargeCommandV2 {
  readonly transition: "transfer-release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly currentAttemptOrdinal: Uint32V2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly settledStableKeyStateRecordDigest: DigestV2
  readonly chargeTransferBindingRecordDigest: DigestV2
  readonly replacementCharge:
    RemoteIngressEvidenceReplacementChargeV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
}

export type AdvanceRemoteIngressEvidenceAdmissionCommandV2 =
  | SettleRemoteIngressEvidenceAdmissionCommandV2
  | AbandonRemoteIngressEvidenceAdmissionCommandV2
  | TransferRemoteIngressEvidenceAdmissionChargeCommandV2
```

For every command:

```text
sourceMemberId
= authenticatedSourceMemberId
= stableKey.sourceMemberId
= signed-offer evidence sourceMemberId
```

Mismatch rejects before map lookup or write.

Settle verifies that the closure object is fsynced, has the prospective record digest
and mirrors the exact reserved attempt.

Abandon-release requires absence of reservation, payload, install, equivocation
high-water, recovery, audit and carrier roots.

Transfer-release requires the exact settled state and exact binding record. The same
settled attempt may transfer once. A repeated byte-equal command is idempotent and
returns the already-published plain evidence. Any unequal repeat returns
`replacement-charge-already-transferred`.

### G.7 Transfer durability barriers

Under the sole Project/node writer:

```text
reload exact epoch head
-> reload exact settled stable-key state
-> reload exact member quota state
-> reload and validate charge-transfer binding core/record
-> reload exact replacement root and current replacement head
-> prove replacement root/head reference the binding core digest and exact closure
-> prove replacement charge count="1" and bytes equal admission charge

-> write/fsync released stable-key state record
-> write/fsync every changed stable-key COW leaf/internal page
-> write/fsync resulting stable-key COW root record

-> write/fsync resulting member quota record
-> write/fsync every changed member-quota COW leaf/internal page
-> write/fsync resulting member-quota COW root record

-> write/fsync transition record
-> write/fsync checkpoint record when transitionsSinceCheckpoint reaches 256
-> write/fsync next epoch-head record
-> CAS/fsync the sole epoch-head pointer
-> return plain transition evidence
```

The epoch-head pointer is the sole publication point.

Before the CAS, the prior admission state still owns the charge. The replacement
root may already own its retained charge, producing a safe temporary double charge.
No state has zero owners.

A CAS loser publishes no admission state change. Its immutable candidate records
remain unowned and GC-eligible. Recovery retries the exact binding and never creates
a second transfer.

### G.8 Transition and plain evidence

```ts
export type RemoteIngressEvidenceAdmissionTransitionV2 =
  | "reserve"
  | "settle"
  | "abandon-release"
  | "transfer-release"

export interface RemoteIngressEvidenceAdmissionTransitionRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-transition-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly transition: RemoteIngressEvidenceAdmissionTransitionV2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2 | null
  readonly chargeTransferBindingRecordDigest: DigestV2 | null

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
}

export interface RemoteIngressEvidenceAdmissionTransitionPortEvidenceV2 {
  readonly transition: RemoteIngressEvidenceAdmissionTransitionV2
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
  readonly chargeTransferBindingRecordDigest: DigestV2 | null
  readonly stableKeyMonotonicAttemptCount: Uint32V2
  readonly memberMonotonicAttemptCount: Uint32V2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly stableKeyChargedClosureCount: Uint32V2
  readonly memberChargedClosureCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly memberAccountedAdmissionByteLength: Uint64V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}
```

Project/node returns only plain evidence. Kernel reloads the current epoch head and
validates every mirror before minting a process receipt.

### G.9 Recursive checkpoint without prior-object retention

```ts
export interface RemoteIngressEvidenceAdmissionCheckpointRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-checkpoint-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2

  readonly priorCheckpointIdentityDigest: DigestV2 | null
  readonly priorRecursiveHistoryCommitment: DigestV2 | null

  readonly intervalFirstTransitionGeneration: Uint64V2 | null
  readonly intervalLastTransitionGeneration: Uint64V2 | null
  readonly intervalTransitionCount: Uint32V2
  readonly orderedIntervalTransitionRecordDigests: readonly DigestV2[]
  readonly intervalHistoryCommitment: DigestV2

  readonly coveredTransitionCount: Uint64V2
  readonly recursiveHistoryCommitment: DigestV2

  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}
```

Genesis:

```text
prior checkpoint identity = null
prior recursive commitment = null
interval first/last generation = null
interval count = "0"
ordered interval digests = []
covered transition count = "0"
```

Each non-genesis checkpoint covers exactly 256 consecutive transitions.

```text
intervalHistoryCommitment =
  ProjectLocalRecordDigest(
    restrictedJCS({
      format:
        "convax.remote-ingress-evidence-admission-history-interval/2",
      projectId,
      projectEpoch,
      priorCheckpointIdentityDigest,
      intervalFirstTransitionGeneration,
      intervalLastTransitionGeneration,
      intervalTransitionCount,
      orderedIntervalTransitionRecordDigests
    })
  )

recursiveHistoryCommitment =
  ProjectLocalRecordDigest(
    restrictedJCS({
      format:
        "convax.remote-ingress-evidence-admission-recursive-history/2",
      projectId,
      projectEpoch,
      priorRecursiveHistoryCommitment,
      intervalHistoryCommitment,
      coveredTransitionCount,
      stableKeyStateRootRecordDigest,
      memberQuotaRootRecordDigest
    })
  )
```

`priorCheckpointIdentityDigest` is a diagnostic commitment input and creates zero
Project-native metadata-retention edges.

Only the epoch head fields `currentCheckpointRecordDigest` and
`previousCheckpointRecordDigest` retain checkpoint objects.

Missing, duplicated, reordered or non-consecutive transition digests are
`store-corrupt`.

### G.10 Closed metadata GC authority

```ts
export type RemoteIngressEvidenceMetadataObjectKindV2 =
  | "epoch-head"
  | "transition"
  | "checkpoint"
  | "stable-key-state"
  | "member-quota"
  | "stable-key-map-page"
  | "member-quota-map-page"

export type RemoteIngressEvidenceMetadataGcPhaseV2 =
  | "idle"
  | "prepared"
  | "delete-committed"
  | "terminal-deleted"
  | "terminal-not-deleted"

export interface RemoteIngressEvidenceMetadataGcHeadRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-metadata-gc-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly priorHeadIdentityDigest: DigestV2 | null
  readonly phase: RemoteIngressEvidenceMetadataGcPhaseV2
  readonly operationId: Id128V2 | null
  readonly attemptedCandidateSetRootRecordDigest: DigestV2
  readonly preparationRecordDigest: DigestV2 | null
  readonly deletionCommitRecordDigest: DigestV2 | null
  readonly terminalRecordDigest: DigestV2 | null
}

export interface RemoteIngressEvidenceMetadataGcRootSetV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly metadataGcHeadRecordDigest: DigestV2
  readonly metadataGeneration: Uint64V2
  readonly currentEpochHeadRecordDigest: DigestV2
  readonly currentCheckpointRecordDigest: DigestV2
  readonly previousCheckpointRecordDigest: DigestV2 | null
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly durableIngressRootSetDigest: DigestV2
  readonly recoveryRootSetDigest: DigestV2
  readonly auditRootSetDigest: DigestV2
  readonly resetRetentionRootSetDigest: DigestV2
}

export interface RemoteIngressEvidenceMetadataGcPreparationRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-metadata-gc-preparation-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly priorMetadataGcHeadRecordDigest: DigestV2
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly firstRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
  readonly firstReferenceCount: "0"
}

export interface RemoteIngressEvidenceMetadataGcDeletionCommitRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-metadata-gc-deletion-commit-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly preparationRecordDigest: DigestV2
  readonly preparedMetadataGcHeadRecordDigest: DigestV2
  readonly secondRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
  readonly secondReferenceCount: "0"
}

export interface RemoteIngressEvidenceMetadataGcTerminalRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-metadata-gc-terminal-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly deletionCommitRecordDigest: DigestV2 | null
  readonly status: "deleted" | "not-deleted"
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly terminalRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
}
```

The attempted-candidate set is a Project-local COW set keyed by:

```text
ProjectLocalRecordDigest(
  restrictedJCS({
    format: "convax.remote-ingress-evidence-metadata-gc-candidate/2",
    projectId,
    projectEpoch,
    objectKind,
    objectRecordDigest
  })
)
```

One candidate enters the set once per Project epoch. Repeated preparation resumes
the same operation or returns its terminal result; it creates no second operation.

Prepare:

```text
reload exact current metadata-GC head and epoch retention roots
-> require phase idle or terminal
-> require candidate absent from attempted set
-> refold first root set
-> require candidate non-current, unreachable and referenceCount="0"
-> write/fsync preparation record
-> write/fsync updated attempted-candidate COW pages/root
-> write/fsync prepared metadata-GC head with generation + 1
-> CAS/fsync metadata-GC head pointer
-> refold exact second root set
-> return plain prepared evidence
```

Execute:

```text
reload exact prepared head and preparation
-> refold root set
-> require byte equality with prepared second root set
-> require candidate non-current, unreachable and referenceCount="0"
-> write/fsync deletion-commit record
-> write/fsync delete-committed metadata-GC head
-> CAS/fsync metadata-GC head pointer
-> physically remove only the exact candidate
-> write/fsync terminal-deleted record
-> write/fsync terminal-deleted metadata-GC head
-> CAS/fsync metadata-GC head pointer
-> return plain terminal evidence
```

If any execute-time recheck fails:

```text
write/fsync terminal-not-deleted record
-> write/fsync terminal-not-deleted metadata-GC head
-> CAS/fsync metadata-GC head pointer
-> delete zero objects
```

Recovery:

```text
prepared:
  repeat execute-time rechecks.

delete-committed:
  finish deletion of the exact candidate, then publish terminal-deleted.

terminal:
  return the existing terminal plain evidence.

unequal operationId, candidate, preparation, root set or head:
  reject and delete zero objects.
```

`priorHeadIdentityDigest` is diagnostic and creates no retention chain. Current
metadata-GC head and its current operation records are retained directly. All
metadata-GC infrastructure records and attempted-candidate set pages are bounded by
the finite Project-epoch admission metadata inventory and remain retained until
Project-epoch reset GC.

Project/node returns plain metadata-GC evidence only. No metadata-GC brand or public
deletion capability exists.

## H. Project RSA authority and exact terminal ACK enqueue

### H.1 Package ownership

```text
@convax/project/collaboration-protocol
  owns RSA DTOs and the branded Control verifier bundle.

@convax/canvas
  owns CanvasDocumentOwnerRuntimeV2 and CGP semantics.
  imports collaboration and uri, never Project.

@convax/project
  owns RSA semantic composition, F13, wanted-root/currentness, the exact RSA authority
  wrapper and terminal carrier ACK gate.

@convax/project/node
  implements owner-install and dependency-index persistence and returns plain evidence.

@convax/collaboration
  owns the generic selected owner-port factory, generic owner-install receipts,
  RemoteTransferAttemptBindingV2 and process brands.

@convax/desktop
  supplies the exact live capabilities and narrow outbound adapter.
```

### H.2 Exact branded wrapper identity

```ts
declare const projectRsaOwnerAuthorityBrandV2: unique symbol
declare const projectRsaOwnerAuthorityFactoryBrandV2: unique symbol

export interface ProjectRsaOwnerAuthorityFactoryInputV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: ProjectIndexScopeV2
  readonly controlVerifierBundle:
    DocumentShardResetControlVerifierBundleV2
  readonly canvasRuntime:
    CanvasDocumentOwnerRuntimeV2
  readonly resetAuthorityVerifier:
    DocumentShardResetAuthorityVerifierV2
  readonly wantedRootCurrentness:
    ProjectWantedRootCurrentnessCapabilityV2
  readonly ownerInstallPersistence:
    DocumentShardResetOwnerInstallPersistenceCapabilityV2
}

export interface ProjectRsaOwnerAuthorityV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: ProjectIndexScopeV2
  readonly controlVerifierBundleDigest: DigestV2
  readonly canvasRuntimeArtifactDigest: DigestV2
  readonly resetAuthorityVerifierArtifactDigest: DigestV2
  readonly wantedRootCurrentnessPolicyDigest: DigestV2
  readonly ownerInstallPersistenceArtifactDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  readonly [projectRsaOwnerAuthorityBrandV2]: true
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

The Project-private registry binds the exact wrapper object to all five captured
live capability objects and all five artifact/policy digests.

Before minting the wrapper, Project verifies that the reset verifier was created
from the same Control bundle and Canvas runtime.

The generic owner port definition uses:

```ts
readonly ownerAuthorityIdentity: ProjectRsaOwnerAuthorityV2
```

The selected-authorities set contains the exact same branded wrapper object. It does
not use `DocumentShardResetAuthorityVerifierV2` as the standalone generic identity.

The reset verifier remains one registry-bound component of the wrapper and is the
only component permitted to perform F13 verification.

Structural copies, digest-only reconstruction, cross-Project, cross-epoch, swapped
reset verifier, swapped currentness provider, swapped persistence capability,
disposed values and restarted values reject.

### H.3 RSA validation and install

```text
bounded CVXRSA02 structural validation through exact Control bundle
-> embedded CGP validation through exact Canvas runtime
-> acquire fresh branded Project base references
-> acquire fresh ProjectIndex route/head/current-authority facts
-> call exact bound DocumentShardResetAuthorityVerifierV2.verify
-> require verified
-> recheck live wanted root
-> recheck Project epoch/currentness
-> recheck editor authority and exact ProjectIndex scope
-> isolated RSA semantic validation
```

Install repeats wrapper identity, reset-verifier identity, wanted root,
epoch/currentness, editor authority, scope, owner-install record and owner-head checks
immediately before the persistence call.

Project/node returns plain install evidence. Kernel's exact `<K,A>` path validates
it and mints the generic owner-install receipt.

### H.4 Attempt-bound carrier receipt

```ts
declare const remoteDependencyCarrierDurableReceiptBrandV2: unique symbol

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
  readonly exactManifestDigest: DigestV2
  readonly transferAttempt: RemoteTransferAttemptBindingV2
  readonly [remoteDependencyCarrierDurableReceiptBrandV2]: true
}
```

The receipt registry binds the exact receipt object to:

```text
exact Project gate instance
exact Project id and epoch
exact generic owner-install receipt
exact dependency-index record/head
exact wanted root
exact editor authority
exact ProjectRsaOwnerAuthorityV2 or Canvas owner authority
exact manifest digest
exact live RemoteTransferAttemptBindingV2 object
```

`transferAttempt.manifestDigest` equals `exactManifestDigest`. Its stable key,
transferId, Project, epoch and source member equal the installed carrier and signed
offer. Cross-connection or reconstructed attempt bindings reject.

### H.5 Narrow outbound ACK capability

```ts
declare const dependencyCarrierTransferAckOutboundPortBrandV2: unique symbol

export interface EnqueueDependencyCarrierTransferAckRequestV2<
  K extends RemoteDependencyCarrierKindV2,
> {
  readonly kind: K
  readonly transferAttempt: RemoteTransferAttemptBindingV2
  readonly exactManifestDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly durabilityProofDigest: null
}

export type EnqueueDependencyCarrierTransferAckResultV2 =
  | Readonly<{
      status: "enqueued"
      outboundEnqueueId: Id128V2
    }>
  | Readonly<{
      status: "pending"
      code: "outbound-backpressure"
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "transfer-attempt-stale"
        | "connection-closed"
        | "manifest-mismatch"
        | "subject-mismatch"
    }>

export interface DependencyCarrierTransferAckOutboundPortV2 {
  tryEnqueueTerminalCarrierAck<
    K extends RemoteDependencyCarrierKindV2,
  >(
    request: EnqueueDependencyCarrierTransferAckRequestV2<K>,
  ): EnqueueDependencyCarrierTransferAckResultV2

  readonly [dependencyCarrierTransferAckOutboundPortBrandV2]: true
}
```

The method is synchronous. It accepts only the semantic ACK request above. The
outbound adapter alone constructs, authenticates, sequences and enqueues the exact
Peer control message for the bound live connection.

There is no API accepting caller-supplied ACK bytes, Peer body, connectionId,
transferId, signature or durability proof.

The Project gate factory captures one exact branded outbound port. Structural,
swapped, disposed or restarted outbound ports reject.

### H.6 Async loading and synchronous terminal enqueue

```ts
export type RemoteDependencyCarrierReceiptStateV2 =
  | "issued"
  | "loading"
  | "consuming"
  | "enqueued"
  | "abandoned"

export type ConsumeTerminalCarrierAckResultV2 =
  | Readonly<{
      status: "enqueued"
      outboundEnqueueId: Id128V2
    }>
  | Readonly<{
      status: "pending"
      code:
        | "consume-in-progress"
        | "wanted-root-pending"
        | "owner-install-pending"
        | "dependency-index-pending"
        | "outbound-backpressure"
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "receipt-not-live"
        | "wanted-root-stale"
        | "project-epoch-stale"
        | "editor-authority-closed"
        | "owner-identity-mismatch"
        | "install-head-stale"
        | "dependency-index-head-stale"
        | "carrier-evidence-mismatch"
        | "transfer-attempt-stale"
        | "connection-closed"
        | "outbound-rejected"
        | "outbound-threw"
        | "store-corrupt"
    }>

export interface ProjectPrivateCarrierAckGateV2 {
  authorizeTerminalCarrierAck<
    K extends RemoteDependencyCarrierKindV2,
  >(
    install: RemoteNonFrameIngressOwnerInstallReceiptV2<
      K,
      "project-private-carrier-ack"
    >,
    transferAttempt: RemoteTransferAttemptBindingV2,
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
          | "transfer-attempt-stale"
          | "store-corrupt"
      }>
  >

  consumeTerminalCarrierAck<
    K extends RemoteDependencyCarrierKindV2,
  >(
    receipt: RemoteDependencyCarrierDurableReceiptV2<K>,
  ): Promise<ConsumeTerminalCarrierAckResultV2>

  readonly [projectPrivateCarrierAckGateBrandV2]: true
}
```

State machine:

```text
authorize success:
  absent -> issued

consume start:
  issued -> loading

concurrent consume:
  loading -> pending consume-in-progress, state remains loading

async load pending:
  loading -> issued, return pending

async load rejection:
  loading -> abandoned, return rejected

async load success:
  loading -> consuming inside Project sole-writer critical section

outbound backpressure with zero enqueue:
  consuming -> issued, return pending

connection stale, outbound rejection or outbound throw:
  consuming -> abandoned, return rejected with zero ACK

exact outbound enqueue:
  consuming -> enqueued, return enqueued

enqueued:
  every later call returns receipt-not-live and invokes no outbound method

abandoned:
  every later call returns receipt-not-live and invokes no outbound method
```

Consume performs asynchronous loading before the final critical section. Inside one
Project sole-writer critical section it performs, without await, callback or lock
release:

```text
recheck receipt live registry and state
-> recheck Project id/epoch and scope
-> recheck exact subject, immutable object and manifest
-> recheck exact branded owner wrapper identity
-> recheck wanted root and editor authority
-> recheck owner-install record/head
-> recheck dependency-index record/head
-> recheck raw carrier closure
-> recheck exact live transferAttempt object and manifest digest
-> move loading to consuming
-> synchronously call captured outbound port with exact semantic request
-> handle result
-> perform the exact terminal or retryable state transition
-> return
```

Once the outbound port returns `enqueued`, the registry transition to `enqueued` is
infallible and performs no allocation or user callback.

Only the outbound port creates wire ACK bytes. `status:"enqueued"` returns no ACK
body. Generic owner-install receipt, immutable receipt, plain evidence,
caller-created object, stale attempt or structural clone produces zero ACK.

A process crash after outbound enqueue but before caller observation may cause the
sender to retry. The prior connection-bound attempt is stale after restart; no
old-attempt ACK is reconstructed. The transfer protocol treats an exact duplicate
ACK for the same live attempt as idempotent.

## Crash barriers

### Admission transfer

Crash injection points:

```text
replacement root
replacement root head
binding record
released stable-key record
stable-key pages
stable-key root
member record
member pages
member root
transition
checkpoint
epoch head
epoch-head pointer CAS
```

Recovery accepts only the exact byte-equal binding and candidate closure. Before
epoch-head CAS, admission retains the charge. After CAS, the exact replacement root
owns it. No crash produces an uncharged interval or second transfer.

### Metadata GC

Crash injection points:

```text
preparation
attempted-candidate pages/root
prepared GC head
GC-head CAS
deletion commit
delete-committed GC head
GC-head CAS
physical deletion
terminal record
terminal GC head
GC-head CAS
```

Recovery resumes the exact operationId and candidate. It either completes the exact
committed deletion or returns terminal-not-deleted. It never deletes another digest.

### Carrier ACK

All asynchronous failures occur before `consuming` or return the receipt to `issued`.
The final recheck/enqueue/terminal section contains no await. Connection-stale and
outbound throw paths move to abandoned and emit zero ACK.

## Exact owner and declaration counts

Exactly one:

```text
Collaboration:
  admission commands and plain-evidence contracts
  admission receipt brands
  generic owner-install <K,A>
  RemoteTransferAttemptBindingV2

Project/node:
  stable-key/member records and COW pages/roots
  epoch head and transition
  non-cyclic charge-transfer binding core/record
  recursive checkpoint
  metadata-GC head/preparation/deletion-commit/terminal records
  attempted-candidate set
  all Project-native persistence adapters

Project:
  ProjectRsaOwnerAuthorityV2 wrapper/factory/private registry
  exact five-capability binding
  Project F13 orchestration
  wanted-root/currentness
  Project-private carrier gate and receipt registry
  narrow outbound-port capture

Project collaboration-protocol:
  RSA DTOs
  Control verifier bundle

Canvas:
  Canvas runtime
  CGP verifier and owner

Desktop:
  concrete capability and outbound-adapter composition only
```

Exactly zero:

```text
stable-key mutable admission head
member mutable admission head
missing 2/512/8192 attempt authority
zero-entry evidence-map leaf
second empty-map representation
internal capacity 96
75-child persisted page
charge transfer without exact binding record
cyclic binding/root digest
second transfer of one settled attempt
native prior-checkpoint retention edge
undefined metadataGeneration
branded metadata-GC evidence
Project/node-minted Kernel receipt
RSA owner identity equal only to reset verifier
RSA wrapper omitting any of five capabilities
Canvas import of Project
synchronous pre-load ACK consumption
caller-supplied ACK body
caller-supplied connection or transfer id
ACK before consume-time currentness recheck
ACK for stale RemoteTransferAttemptBindingV2
ACK returned without outbound enqueue
```

## Mandatory falsifiers

1. Stable key attempt 3, member attempt 513 and Project attempt 8193 each write zero
   objects.
2. Releasing every earlier charge does not return any attempt slot.
3. Concurrent stable keys exceeding remaining member or Project quota have one
   epoch-head CAS winner and one zero-write loser.
4. Null empty roots round-trip; zero-entry leaves reject.
5. The maximum stable-key 74-child fixture is exactly 64,847 bytes and passes.
6. The corresponding 75-child fixture is exactly 65,719 bytes and splits before
   digest/write.
7. Random COW operations cover leaf 128/64, internal 74/37, split 37/38, borrow,
   merge and root collapse.
8. Mutation of key, boundary, value, count, map kind, Project or epoch changes the
   page digest.
9. Settle persists and recovers the exact closure-object digest.
10. Transfer-release with any changed stableKey, attempt ordinal, settled state,
    replacement root/head, binding digest, closure, count or byte charge releases
    zero charge.
11. An exact transfer replay is idempotent; a second unequal transfer writes zero
    objects.
12. Crash at every transfer barrier preserves at least one exact charge owner.
13. Every checkpoint contains exactly 256 ordered consecutive transition digests.
14. Mutation of any historical transition invalidates every descendant recursive
    commitment.
15. `priorCheckpointIdentityDigest` creates zero metadata-retention edges.
16. Current and previous checkpoints remain retained; older unreachable checkpoints
    may be deleted.
17. Two metadata-GC preparations from one generation have exactly one GC-head CAS
    winner.
18. Metadata GC rejects current/previous checkpoint, current COW page, every
    recovery-root object and every changed root set.
19. Crash at every metadata-GC barrier resumes the exact operation or reaches
    terminal-not-deleted.
20. The same metadata candidate creates at most one operationId in one Project epoch.
21. Plain admission and metadata-GC evidence mint no Kernel capability.
22. Swapping any one of the five RSA capabilities changes wrapper identity and
    invalidates the owner port.
23. Using the reset verifier object instead of the Project wrapper as generic owner
    identity fails selected-set creation.
24. Source and packed Canvas dependencies contain zero Project imports.
25. RSA validation that skips the exact bound reset verifier fails.
26. Carrier receipt authorization rejects a mismatched manifest or transfer-attempt
    binding.
27. Pending async load leaves the receipt retryable; rejection abandons it.
28. Outbound backpressure invokes zero enqueue and returns the receipt to issued.
29. Connection-stale, outbound rejection and outbound throw enqueue zero ACK and
    abandon the receipt.
30. Successful consumption calls the outbound port exactly once and returns only
    `status:"enqueued"`.
31. A consumed, abandoned, cloned, restarted or cross-gate receipt invokes the
    outbound port zero times.
32. No public or Plugin API accepts ACK bytes, Peer control bodies, connectionId or
    transferId.
33. Replacing the captured outbound port invalidates every receipt issued by the
    prior gate.
34. I retains all previously accepted prepared-recovery, dual-generation,
    no-self-reference and GC-command falsifiers unchanged.

## Unconditional unique author vote

As Canvas/intent/runtime architecture owner, I unconditionally vote `ADOPT` for this
exact R5.9 G/H delta and the unchanged three-party-approved R5.8 I delta.
