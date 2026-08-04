# Collaboration v10 R5.8 G/H/I unique delta

Status: architecture-owner-authored, non-authoritative correction input. It grants
no implementation or promotion permission. It replaces only the rejected R5.7 G/H/I
reconciliation identified by SHA-256
`d96031b16af78efcb1537fef10814e38f5a02426d7633ded5b494a8d7fcdcc62`.

## G. Project-epoch evidence admission

### G.1 Ownership

```text
@convax/collaboration
  owns commands, plain port evidence, Kernel receipts and private receipt registries.

@convax/project/node
  owns all Project-native admission records, both COW maps, the sole epoch-head
  pointer, checkpoints, metadata-GC records and the persistence adapter.

The only mutable admission authority is:

<ProjectEpochNativeStore>/remote-ingress-evidence-admission/head
  -> RemoteIngressEvidenceAdmissionEpochHeadRecordV2 digest
```

Per-stable-key and per-member mutable head pointers remain declaration-count zero.

### G.2 Canonical shared COW page ABI

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
```

Canonical ordering is decoded 32-byte key digest followed by unsigned-byte ordering
of the restricted-JCS canonical key object. A digest collision with unequal canonical
key objects is `store-corrupt`; colliding entries never alias.

The sole empty representation is:

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

A zero-entry leaf page is invalid.

For a non-empty root:

```text
rootPageDigest != null
entryCount = rootPage.subtreeEntryCount
treeHeight = rootPage.height
mapCommitment = rootPageDigest
```

Every page digest is the Project-local record digest of the exact restricted-JCS
page. Project, epoch and map kind match through every page and boundary key.

Closed capacities remain:

```text
leaf maximum: 128
non-root leaf minimum: 64
root leaf occupancy: 1..128
leaf overflow 129 split: 64/65

internal maximum: 96
non-root internal minimum: 48
root internal occupancy: 2..96
internal overflow 97 split: 48/49

maximum height: 9
maximum exact page JCS: 65536 bytes
```

Insertion requiring height 10 rejects as `evidence-capacity-exceeded` before writing
any native object.

### G.3 Exact replacement charge

```ts
export type RemoteIngressEvidenceReplacementChargeKindV2 =
  | "remote-ingress-reservation"
  | "manifest-equivocation-high-water"
  | "installed-payload"
  | "owner-install"
  | "recovery"
  | "audit"
  | "dependency-carrier"

export interface RemoteIngressEvidenceReplacementChargeV2 {
  readonly kind: RemoteIngressEvidenceReplacementChargeKindV2
  readonly rootRecordDigest: DigestV2
  readonly rootHeadRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly chargedClosureCount: Uint32V2
  readonly accountedAdmissionByteLength: Uint64V2
}
```

`chargedClosureCount` is exactly `"1"`. `accountedAdmissionByteLength` exactly equals
the released admission charge. The root record and current root head must both be
fsynced, mutually linked and contain an exact durable reference to the signed closure
object before charge transfer.

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
        chargeTransferReplacement: null
      }
    >
  | Readonly<
      RemoteIngressEvidenceStableKeyStateBaseV2 & {
        state: "settled"
        signedOfferEvidenceClosureObjectDigest: DigestV2
        chargeTransferReplacement: null
      }
    >
  | Readonly<
      RemoteIngressEvidenceStableKeyStateBaseV2 & {
        state: "released"
        releaseKind: "abandoned"
        signedOfferEvidenceClosureObjectDigest: null
        chargeTransferReplacement: null
      }
    >
  | Readonly<
      RemoteIngressEvidenceStableKeyStateBaseV2 & {
        state: "released"
        releaseKind: "charge-transferred"
        signedOfferEvidenceClosureObjectDigest: DigestV2
        chargeTransferReplacement:
          RemoteIngressEvidenceReplacementChargeV2
      }
    >
```

Reserved and settled records have `chargedClosureCount:"1"`. Released records have
`chargedClosureCount:"0"`.

### G.5 Discriminated commands

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
  readonly releaseReason:
    | "abandoned-authorization-closed"
    | "abandoned-caller-cancelled"
    | "abandoned-evidence-capacity-exceeded"
}

export interface TransferRemoteIngressEvidenceAdmissionChargeCommandV2 {
  readonly transition: "transfer-release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly replacementCharge: RemoteIngressEvidenceReplacementChargeV2
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

Mismatch rejects before map lookup or native-object write.

Settle verifies the exact closure object is fsynced, its Project-local record digest
equals `prospectiveClosureRecordDigest`, and all stable-key, manifest and charge
mirrors equal the reserved state.

Abandon-release requires absence of reservation, payload, install, equivocation
high-water, recovery, audit and carrier roots.

Transfer-release is one sole-writer transaction:

```text
reload exact replacement root/head
-> prove replacement root references exact signed closure object
-> prove replacement count="1" and bytes equal admission charge
-> write resulting released stable-key record
-> update stable-key COW root
-> decrement member and Project admission charges
-> write transition
-> write checkpoint when required
-> write next epoch head
-> CAS/fsync sole epoch-head pointer
```

There is no state in which neither admission ledger nor replacement root owns the
charge. CAS failure publishes neither updated root nor charge release.

### G.6 Transition record

`RemoteIngressEvidenceAdmissionTransitionRecordV2.transition` becomes:

```ts
readonly transition:
  | "reserve"
  | "settle"
  | "abandon-release"
  | "transfer-release"
```

It additionally contains:

```ts
readonly signedOfferEvidenceClosureObjectDigest: DigestV2 | null
readonly replacementCharge:
  RemoteIngressEvidenceReplacementChargeV2 | null
```

Closed matrix:

```text
reserve:
  closure object = null
  replacement charge = null

settle:
  closure object != null
  replacement charge = null

abandon-release:
  closure object = null
  replacement charge = null

transfer-release:
  closure object != null
  replacement charge != null
```

All resulting stable-key/member/Project attempt, count and byte values remain
explicit transition fields.

### G.7 Recursive checkpoint history commitment

Replace the checkpoint record with:

```ts
export interface RemoteIngressEvidenceAdmissionCheckpointRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-checkpoint-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2

  readonly priorCheckpointRecordDigest: DigestV2 | null
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

Genesis checkpoint:

```text
prior checkpoint = null
prior recursive commitment = null
interval first/last generation = null
interval count = "0"
ordered interval digests = []
covered transition count = "0"
```

Non-genesis checkpoint:

```text
interval count = "256"
ordered digests contain exactly the 256 consecutive transition record digests
first generation = prior checkpoint generation + 1
last generation = checkpoint generation
covered transition count =
  prior covered transition count + interval transition count
```

Exact commitments:

```text
intervalHistoryCommitment =
  ProjectLocalRecordDigest(
    restrictedJCS({
      format:
        "convax.remote-ingress-evidence-admission-history-interval/2",
      projectId,
      projectEpoch,
      priorCheckpointRecordDigest,
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

A checkpoint with missing, duplicated, reordered or non-consecutive transition
digests is `store-corrupt`. Current and previous checkpoint retention remains
mandatory.

### G.8 Closed metadata GC

```ts
export type RemoteIngressEvidenceMetadataObjectKindV2 =
  | "epoch-head"
  | "transition"
  | "checkpoint"
  | "stable-key-state"
  | "member-quota"
  | "stable-key-map-page"
  | "member-quota-map-page"

export interface RemoteIngressEvidenceMetadataGcRootSetV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
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

export interface PrepareRemoteIngressEvidenceMetadataGcCommandV2 {
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly expectedRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
}

export interface RemoteIngressEvidenceMetadataGcPortEvidenceV2 {
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2

  readonly firstRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
  readonly preparationRecordDigest: DigestV2
  readonly secondRootSet: RemoteIngressEvidenceMetadataGcRootSetV2

  readonly firstReferenceCount: Uint64V2
  readonly secondReferenceCount: Uint64V2
}

export interface ExecuteRemoteIngressEvidenceMetadataGcCommandV2 {
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly preparationRecordDigest: DigestV2
  readonly expectedSecondRootSet: RemoteIngressEvidenceMetadataGcRootSetV2
}

export type RemoteIngressEvidenceMetadataGcResultV2 =
  | Readonly<{
      status: "deleted"
      deletionRecordDigest: DigestV2
    }>
  | Readonly<{
      status: "not-deleted"
      code:
        | "metadata-root-changed"
        | "metadata-reference-present"
        | "metadata-object-current"
        | "metadata-scan-invalidated"
        | "store-corrupt"
    }>

export interface RemoteIngressEvidenceMetadataGcPersistencePortV2 {
  prepareMetadataGc(
    command: PrepareRemoteIngressEvidenceMetadataGcCommandV2,
  ): Promise<
    | Readonly<{
        status: "prepared"
        evidence: RemoteIngressEvidenceMetadataGcPortEvidenceV2
      }>
    | Readonly<{
        status: "rejected"
        code:
          | "metadata-root-stale"
          | "metadata-reference-present"
          | "metadata-object-current"
          | "durability-failed"
          | "store-corrupt"
      }>
  >

  executeMetadataGc(
    command: ExecuteRemoteIngressEvidenceMetadataGcCommandV2,
  ): Promise<RemoteIngressEvidenceMetadataGcResultV2>
}
```

Preparation runs under the Project/node sole writer:

```text
refold exact first root set
-> require candidate unreachable and firstReferenceCount="0"
-> fsync metadata-GC preparation record
-> advance evidence metadataGeneration exactly once
-> refold exact second root set
-> require candidate unreachable and secondReferenceCount="0"
-> return plain evidence
```

`metadataGeneration` is distinct from durable-frame reference `storeGeneration`.
Evidence-ledger record/page/checkpoint/metadata-GC writes never advance the
frame-reference store generation.

Execution reloads the preparation record and both root sets, requires the current
root set to equal the second root set byte-for-byte, performs a third zero-reference/
currentness recheck in the same critical section as deletion, fsyncs one deletion
record and removes only the exact obsolete metadata object.

Plain metadata-GC evidence has no brand and cannot authorize any non-metadata
deletion.

## H. Project-owned RSA authority and terminal ACK

### H.1 Exact five-capability authority

```ts
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
```

`ProjectRsaOwnerAuthorityV2` adds:

```ts
readonly resetAuthorityVerifierArtifactDigest: DigestV2
```

The Project registry binds the authority wrapper to exactly five live capabilities:

```text
Control verifier bundle
Canvas runtime
DocumentShardResetAuthorityVerifierV2
wanted-root/currentness capability
owner-install persistence capability
```

It also binds Project id, epoch, ProjectIndex scope and all five artifact/policy
identities.

Before creating the RSA authority, Project verifies through its reset-verifier
registry that the exact `DocumentShardResetAuthorityVerifierV2` was created from the
same Control bundle and Canvas runtime.

The `ownerAuthorityIdentity` supplied to the generic owner-port factory and
selected-authorities set is the exact live `DocumentShardResetAuthorityVerifierV2`
object. It is not the Project wrapper and cannot be reconstructed from digests.

The Project wrapper remains the context capability used to create the RSA port and
bind wanted-root/currentness and persistence.

### H.2 RSA validation

Unique order:

```text
bounded CVXRSA02 structural validation
-> embedded CGP validation through exact Canvas runtime
-> acquire fresh branded Project base references
-> acquire fresh ProjectIndex route/head/current-authority facts
-> call exact DocumentShardResetAuthorityVerifierV2.verify
-> require verified
-> recheck live wanted root
-> recheck Project epoch/currentness
-> recheck editor authority and exact ProjectIndex scope
-> isolated RSA owner semantic validation
```

Project owns F13 orchestration. Control owns carrier authenticity and its narrow
predicate; Canvas owns CGP semantics. Neither Control nor Canvas directly performs
Project F13 composition.

Install repeats verifier identity, wanted-root, epoch/currentness, editor authority,
scope and owner-install head checks immediately before the bound persistence call.

### H.3 Async terminal ACK consumption

```ts
export type ConsumeTerminalCarrierAckResultV2<
  K extends RemoteDependencyCarrierKindV2,
> =
  | Readonly<{
      status: "consumed"
      ack: Readonly<{
        kind: K
        subjectDigest: DigestV2
        durabilityProofDigest: null
      }>
    }>
  | Readonly<{
      status: "pending"
      code:
        | "wanted-root-pending"
        | "owner-install-pending"
        | "dependency-index-pending"
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

  consumeTerminalCarrierAck<
    K extends RemoteDependencyCarrierKindV2,
  >(
    receipt: RemoteDependencyCarrierDurableReceiptV2<K>,
  ): Promise<ConsumeTerminalCarrierAckResultV2<K>>

  readonly [projectPrivateCarrierAckGateBrandV2]: true
}
```

Receipt state machine:

```text
issued -> consuming -> consumed
issued -> abandoned
consuming -> abandoned
```

Consume performs async loading first. It then enters one Project sole-writer critical
section and atomically rechecks:

```text
receipt live registry identity
Project id and epoch
exact subject and immutable object
exact owner identity
current wanted-root digest
current editor authority
owner-install record and owner head
dependency-index record and dependency-index head
carrier raw closure
```

A pending result leaves the receipt `issued`. A rejection moves it to `abandoned` and
emits zero ACK. After all rechecks succeed, Project moves the receipt to `consuming`,
creates the exact session ACK body, moves the receipt to `consumed` and returns
`status:"consumed"` without await, callback or lock release between those three
operations.

Only `status:"consumed"` contains ACK bytes. Generic owner-install receipt,
immutable-object receipt, plain evidence, stale receipt or structural clone yields
zero ACK.

## I. Durable scan fence and command recovery

### I.1 Fence preparation

Add the recovery phase:

```ts
export type DurableReferenceScanRecoveryPhaseV2 =
  | "first-proof-durable"
  | "fence-prepared"
  | "fence-durable"
  | "second-proof-durable"
  | "gc-command-issued"
  | "terminal-deleted"
  | "terminal-not-deleted"
```

```ts
export interface DurableReferenceScanFencePreparationRecordV2 {
  readonly format:
    "convax.durable-reference-scan-fence-preparation-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scanOperationId: Id128V2
  readonly priorRecoveryHeadRecordDigest: DigestV2
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
```

`PublishDurableReferenceScanFenceCommandV2` adds:

```ts
readonly scanOperationId: Id128V2
readonly expectedScanRecoveryHeadRecordDigest: DigestV2
```

Unique fence sequence:

```text
reload first-proof-durable recovery head
-> verify scan operation and exact first proof
-> write/fsync fence preparation record
-> write/fsync fence-prepared recovery head
-> write/fsync fence commit
-> advance logical frame-reference storeGeneration exactly once
-> publish reference-index head with generation advanced exactly once
-> write/fsync fence-durable recovery head
-> return plain fence evidence
```

Plain fence evidence adds:

```ts
readonly fencePreparationRecordDigest: DigestV2
readonly priorScanRecoveryHeadRecordDigest: DigestV2
readonly resultingScanRecoveryHeadRecordDigest: DigestV2
```

Idempotent recovery:

```text
first-proof-durable:
  create the one preparation.

fence-prepared with exact command:
  resume from the existing preparation; do not write a second preparation.

fence-durable with exact command:
  return fresh plain evidence for the already durable fence.

any unequal scanOperationId, proof, expected fact or preparation:
  reject and write zero objects.
```

Exactly one fence commit may exist for a first proof.

### I.2 Closed recovery-head matrix

Replace the recovery head with:

```ts
export interface DurableReferenceScanRecoveryHeadRecordV2 {
  readonly format:
    "convax.durable-reference-scan-recovery-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scanOperationId: Id128V2
  readonly priorRecoveryHeadRecordDigest: DigestV2 | null
  readonly phase: DurableReferenceScanRecoveryPhaseV2
  readonly targetRefDiagnostic: FrameObjectRefV2

  readonly firstProofRecordDigest: DigestV2
  readonly fencePreparationRecordDigest: DigestV2 | null
  readonly fenceCommitRecordDigest: DigestV2 | null
  readonly secondProofRecordDigest: DigestV2 | null
  readonly gcCommandRecordDigest: DigestV2 | null
  readonly terminalRecordDigest: DigestV2 | null
}
```

Closed matrix:

```text
first-proof-durable:
  prior = null
  first != null
  preparation = null
  fence = null
  second = null
  command = null
  terminal = null

fence-prepared:
  prior = first-proof-durable head
  first != null
  preparation != null
  fence = null
  second = null
  command = null
  terminal = null

fence-durable:
  prior = fence-prepared head
  first != null
  preparation != null
  fence != null
  second = null
  command = null
  terminal = null

second-proof-durable:
  prior = fence-durable head
  first != null
  preparation != null
  fence != null
  second != null
  command = null
  terminal = null

gc-command-issued:
  prior = second-proof-durable head
  first != null
  preparation != null
  fence != null
  second != null
  command != null
  terminal = null

terminal-deleted | terminal-not-deleted:
  prior = gc-command-issued head
  first != null
  preparation != null
  fence != null
  second != null
  command != null
  terminal != null
```

No other null/non-null combination is decodable.

### I.3 Durable GC command

```ts
export interface DurableReferenceFrameGcCommandRecordV2 {
  readonly format: "convax.frame-object-gc-command-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scanOperationId: Id128V2
  readonly priorSecondProofRecoveryHeadRecordDigest: DigestV2
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
}

export interface IssueGarbageCollectFrameObjectCommandPortEvidenceV2 {
  readonly scanOperationId: Id128V2
  readonly priorSecondProofRecoveryHeadRecordDigest: DigestV2
  readonly gcCommandRecordDigest: DigestV2
  readonly resultingGcCommandRecoveryHeadRecordDigest: DigestV2
}

export interface GarbageCollectFrameObjectPersistenceCommandV2 {
  readonly scanOperationId: Id128V2
  readonly priorSecondProofRecoveryHeadRecordDigest: DigestV2
  readonly gcCommandRecordDigest: DigestV2
  readonly resultingGcCommandRecoveryHeadRecordDigest: DigestV2

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
}
```

Command issue sequence:

```text
Kernel consumes both live proof brands, exact registered fence and one-shot internal
GC authorization
-> Project/node reloads exact second-proof-durable recovery head
-> write/fsync GC command record bound to that head
-> write/fsync next gc-command-issued recovery head naming command
-> return plain IssueGarbageCollectFrameObjectCommandPortEvidenceV2
```

Kernel compares every command/recovery mirror before sending the plain persistence
command.

Deletion sequence under one Project/node sole-writer critical section:

```text
reload GC command and gc-command-issued recovery head
-> reload both proofs and fence
-> recheck current accepted head
-> recheck current store generation
-> recheck index head/generation/root/page/count/commitment/coverage
-> recheck all eight source heads
-> recheck zero references and unreachability
-> write/fsync terminal deletion or not-deleted record
-> write/fsync matching terminal recovery head
-> delete only after terminal-deleted durability
-> clear recovery-head pointer after terminal reconciliation
```

Replay with a changed source head, generation, root, coverage or recovery head deletes
zero objects.

### I.4 Generation semantics

```text
reference storeGeneration is a logical frame/reference mutation generation.

Writing scan proofs, fence preparation, recovery heads, fence commit bytes and GC
command records does not itself advance reference storeGeneration.

The successful fence transition advances reference storeGeneration exactly once and
referenceIndexGeneration exactly once.

The later successful physical frame deletion is a distinct reference mutation and
may advance the next reference store/index generations only after all second-proof
rechecks and terminal-deleted durability.
```

Accepted head, index root/page/count/commitment and coverage remain unchanged across
the fence.

### I.5 Metadata reference semantics

These formats create zero durable-reference-index edges to the target frame:

```text
convax.durable-reference-scan-proof-record/2
convax.durable-reference-scan-fence-preparation-record/2
convax.durable-reference-scan-fence-commit-record/2
convax.durable-reference-scan-recovery-head-record/2
convax.frame-object-gc-command-record/2
```

The recovery head directly retains proof, preparation, fence, second-proof, command
and terminal metadata records through their digest fields. Those direct
metadata-retention edges are not frame-reference-index entries and never change
target `durableReferenceCount`.

Metadata becomes eligible for Project-private metadata GC only after terminal
reconciliation clears the recovery-head pointer.

## Owner and declaration counts

Exactly one:

```text
Collaboration:
  admission command and plain-evidence contracts
  admission receipt brands
  generic owner-install <K,A>
  scan proof brands
  fence command/plain evidence
  plain GC command

Project/node:
  epoch head
  transition
  recursive checkpoint
  stable-key/member records and roots
  shared evidence-map leaf/internal pages
  metadata-GC records and adapter
  fence preparation/commit/recovery records
  GC command/terminal records
  all native persistence adapters

Project:
  RSA authority wrapper/factory/private registry
  exact reset-verifier binding
  wanted-root/currentness policy
  Project-private carrier ACK gate and receipt registry
  F13 orchestration

Project collaboration-protocol:
  RSA DTOs
  Control verifier bundle

Canvas:
  Canvas runtime
  CGP verifier and owner

Desktop:
  composition only
```

Exactly zero:

```text
zero-entry evidence-map leaf
second empty-map representation
historical-head scan for current evidence state
per-stable-key mutable head
per-member mutable head
unbound settled closure object
charge release without exact replacement root
sourceMember caller override
nonrecursive checkpoint history
branded metadata-GC evidence
Project/node-minted Kernel receipt
RSA F13 through Control bundle alone
RSA authority identity omitting reset verifier
synchronous terminal carrier ACK consume
ACK before consume-time currentness recheck
second fence preparation for one first proof
GC command not bound to second-proof recovery head
scan metadata write advancing reference storeGeneration
store-only or index-only fence advance
scan metadata edge to target frame
branded GC authorization crossing persistence
```

## Mandatory falsifiers

1. Null empty root is accepted; zero-entry leaf is rejected.
2. Leaf/internal page digest changes after any key, boundary, value, count, map-kind,
   Project or epoch mutation.
3. A 97-child internal or height-10 insertion writes zero native objects.
4. Concurrent stable keys exceeding member or Project quota produce one epoch-head
   CAS winner and one zero-write loser.
5. Source member mismatch across command, stable key and signed evidence writes zero
   objects.
6. Settle persists the exact closure object digest; restart recovers the same digest.
7. Transfer-release crash injection at every replacement-root/map/transition/
   checkpoint/head barrier never creates an uncharged interval.
8. Replacement count other than `"1"` or replacement bytes unequal to admission
   charge releases zero charge.
9. Every 256-transition checkpoint has exact ordered consecutive digests and
   recursive commitment; mutation of any historical digest invalidates every
   descendant checkpoint.
10. Current evidence lookup after 100,000 historical transitions uses only current
    COW roots and bounded tree height.
11. Metadata GC rejects current/previous checkpoint, current COW page, any
    recovery-root object and any changed second root set.
12. Project/node admission or metadata-GC plain evidence mints no Kernel capability.
13. Swapping only the branded reset verifier changes RSA authority selection and
    invalidates the port.
14. RSA validation that calls Control bundle but skips
    `DocumentShardResetAuthorityVerifierV2.verify` fails.
15. Consume-time changes to wanted root, epoch, editor authority, install head or
    dependency-index head produce zero ACK.
16. A pending consume leaves receipt issued; rejection abandons it; successful
    receipt consumes exactly once.
17. Crash after first proof, fence preparation, fence commit, either generation
    advance, recovery head, second proof, GC command or terminal record resumes the
    exact operation or returns not-deleted.
18. A second unequal fence preparation for one first proof writes zero objects.
19. Fence advances both logical generations exactly once; proof/preparation/recovery/
    command metadata writes advance neither.
20. Scan metadata contributes zero target-frame reference entries while its recovery
    head still prevents premature metadata GC.
21. GC command replay after any source-head, generation, root, coverage or recovery-
    head change deletes zero objects.
22. Quiescent zero-reference unreachable frame completes first proof, one
    preparation, one fence, second proof, one GC command and deletion.

## Unconditional unique author vote

As Project/store/URI architecture owner, I unconditionally vote `ADOPT` for this
exact R5.8 G/H/I delta.
