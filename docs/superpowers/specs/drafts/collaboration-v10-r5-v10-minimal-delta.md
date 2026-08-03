# Collaboration v10 R5.10 minimal unique delta

Status: architecture-owner-authored, non-authoritative correction input. This delta
replaces only the rejected R5.9 admission-publication, metadata-GC and terminal ACK
enqueue clauses. All other R5.9 G/H and approved R5.8 I clauses remain unchanged.

## 1. Admission publication

### Exact write boundary

Every non-idempotent admission command executes under the Project/node sole-writer
critical section:

```text
acquire sole-writer
-> reload sole epoch-head pointer
-> reload stable-key COW entry
-> reload member-quota COW entry
-> compare all three with command expected values
```

Any mismatch returns the corresponding stale result before creating, hashing,
staging or writing any native object:

```ts
export type RemoteIngressEvidenceAdmissionPrewriteRejectCodeV2 =
  | "epoch-head-stale"
  | "stable-key-state-stale"
  | "member-quota-state-stale"
```

After successful comparison:

```text
derive candidate bytes/digests in memory
-> write/fsync value records and changed COW pages
-> write/fsync roots
-> write/fsync transition
-> write/fsync checkpoint when required
-> write/fsync candidate epoch-head record
-> publish sole epoch-head pointer against the already-locked prior digest
```

Writer exclusivity makes an ordinary post-write CAS loser impossible.

### Ambiguous publication recovery

```ts
export interface RemoteIngressEvidenceAdmissionPublicationRecoveryRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-publication-recovery-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly transition: RemoteIngressEvidenceAdmissionTransitionV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly observedEpochHeadPointerDigest: DigestV2
  readonly candidateEpochHeadRecordDigest: DigestV2
  readonly transitionRecordDigest: DigestV2
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly checkpointRecordDigest: DigestV2
  readonly disposition: "pointer-publication-ambiguous"
}
```

If the final pointer operation reports a mismatch or ambiguous durability while the
sole-writer lock is held:

- it is never returned as a concurrency loser;
- Project/node writes the recovery record and enters
  `admission-head-publication-recovery-required`;
- no plain transition evidence or Kernel receipt is returned.

Recovery reloads the exact candidate closure:

```text
pointer == candidate head:
  complete idempotently and return fresh plain evidence.

pointer == expected prior head and candidate closure is exact:
  complete only the exact pointer publication.

any other pointer or candidate mismatch:
  retain/quarantine the candidate closure and return store-corrupt.
```

Recovery never replays the business command, recomputes counters or creates another
transition.

## 2. Metadata-GC durable authority

### Non-metadata root identity

```ts
export interface RemoteIngressEvidenceMetadataNonGcRootIdentityV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly currentEpochHeadRecordDigest: DigestV2
  readonly currentCheckpointRecordDigest: DigestV2
  readonly previousCheckpointRecordDigest: DigestV2 | null
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly durableIngressRootSetDigest: DigestV2
  readonly recoveryRootSetDigest: DigestV2
  readonly auditRootSetDigest: DigestV2
  readonly resetRetentionRootSetDigest: DigestV2
  readonly identityDigest: DigestV2
}
```

```text
identityDigest =
  ProjectLocalRecordDigest(
    restrictedJCS({
      format:
        "convax.remote-ingress-evidence-metadata-non-gc-root-identity/2",
      all preceding fields except identityDigest
    })
  )
```

Metadata-GC head identity and `metadataGeneration` are deliberately excluded. They
cannot trigger candidate retry.

### Phases and head

```ts
export type RemoteIngressEvidenceMetadataGcPhaseV2 =
  | "idle"
  | "first-scan-prepared"
  | "second-scan-durable"
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
  readonly retryGeneration: Uint64V2 | null
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2 | null
  readonly objectRecordDigest: DigestV2 | null

  readonly attemptedCandidateSetRootRecordDigest: DigestV2
  readonly preparationRecordDigest: DigestV2 | null
  readonly secondScanRecordDigest: DigestV2 | null
  readonly deletionCommitRecordDigest: DigestV2 | null
  readonly terminalRecordDigest: DigestV2 | null
}
```

### Candidate state

```ts
export interface RemoteIngressEvidenceMetadataGcCandidateStateRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-metadata-gc-candidate-state-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly operationId: Id128V2
  readonly retryGeneration: Uint64V2
  readonly state:
    | "first-scan-prepared"
    | "second-scan-durable"
    | "delete-committed"
    | "terminal-deleted"
    | "terminal-not-deleted"
  readonly lastNonMetadataRootIdentityDigest: DigestV2
  readonly lastHeadRecordDigest: DigestV2
}
```

One candidate has exactly one `operationId` for the Project epoch. Retry increments
only `retryGeneration`.

### Persisted second scan

```ts
export interface RemoteIngressEvidenceMetadataGcSecondScanRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-metadata-gc-second-scan-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly retryGeneration: Uint64V2

  readonly preparationRecordDigest: DigestV2
  readonly firstScanPreparedHeadRecordDigest: DigestV2
  readonly expectedSecondScanDurableHeadGeneration: Uint64V2

  readonly firstRootSet:
    RemoteIngressEvidenceMetadataGcRootSetV2
  readonly secondRootSet:
    RemoteIngressEvidenceMetadataGcRootSetV2

  readonly firstNonMetadataRootIdentityDigest: DigestV2
  readonly secondNonMetadataRootIdentityDigest: DigestV2

  readonly firstReferenceCount: "0"
  readonly secondReferenceCount: "0"
}
```

The second scan record never names its resulting head digest, avoiding a digest
cycle. The resulting `second-scan-durable` head names the second scan record and has:

```text
generation = expectedSecondScanDurableHeadGeneration
priorHeadIdentityDigest = firstScanPreparedHeadRecordDigest
operationId/retryGeneration/candidate equal second scan
```

### Plain evidence

```ts
export interface RemoteIngressEvidenceMetadataGcPreparedPortEvidenceV2 {
  readonly operationId: Id128V2
  readonly retryGeneration: Uint64V2
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly preparationRecordDigest: DigestV2
  readonly firstScanPreparedHeadRecordDigest: DigestV2
  readonly secondScanRecordDigest: DigestV2
  readonly secondScanDurableHeadRecordDigest: DigestV2
}
```

This evidence is unbranded and diagnostic. Execute never trusts its fields without
reloading all four native records.

### Prepare and recovery barriers

```text
reload current GC head and candidate state
-> derive current non-metadata root identity
-> validate retry rule
-> perform first zero-reference scan
-> write/fsync preparation record
-> update candidate state
-> write/fsync first-scan-prepared head
-> CAS/fsync metadata-GC head pointer

-> refold all current roots
-> perform second zero-reference scan
-> write/fsync second-scan record
-> update candidate state
-> write/fsync second-scan-durable head
-> CAS/fsync metadata-GC head pointer
-> return plain evidence
```

Crash recovery:

```text
first-scan-prepared:
  reload preparation and exact current roots;
  either publish the exact second scan or terminal-not-deleted.

second-scan-durable:
  reload the exact second scan and return fresh plain evidence.

unequal operationId, retryGeneration, candidate, preparation or head:
  delete zero objects and return store-corrupt.
```

### Execute and deletion commit

```ts
export interface ExecuteRemoteIngressEvidenceMetadataGcCommandV2 {
  readonly operationId: Id128V2
  readonly retryGeneration: Uint64V2
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly secondScanRecordDigest: DigestV2
  readonly expectedSecondScanDurableHeadRecordDigest: DigestV2
}

export interface RemoteIngressEvidenceMetadataGcDeletionCommitRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-metadata-gc-deletion-commit-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly retryGeneration: Uint64V2
  readonly objectKind: RemoteIngressEvidenceMetadataObjectKindV2
  readonly objectRecordDigest: DigestV2
  readonly secondScanRecordDigest: DigestV2
  readonly secondScanDurableHeadRecordDigest: DigestV2
  readonly authorizedNonMetadataRootIdentityDigest: DigestV2
}
```

Execute reloads the second-scan record and head, refolds every current root and
requires:

```text
current metadata-GC head == exact second-scan-durable head
current non-metadata root identity == second scan identity
current candidate referenceCount == "0"
candidate remains non-current and unreachable
```

It then writes/fsyncs the deletion commit and publishes `delete-committed`.

Before physical deletion—including every `delete-committed` recovery—Project/node
again refolds all current roots and reference count:

```text
unchanged identity, non-current, unreachable, referenceCount="0":
  publish terminal-deleted under the same sole-writer section
  -> physically delete only the exact candidate.

any changed root/head/reference count:
  publish terminal-not-deleted
  -> physically delete zero objects.
```

A `delete-committed` candidate is a temporary deletion tombstone: Project/node
rejects creation of a new native metadata reference to that candidate until
terminal-deleted or terminal-not-deleted is published.

### Retry after terminal-not-deleted

```text
terminal-not-deleted -> first-scan-prepared
```

is admitted only when:

```text
same Project/epoch/candidate/operationId
current nonMetadataRootIdentityDigest
  != terminal.lastNonMetadataRootIdentityDigest
retryGeneration = checkedSuccessor(prior retryGeneration)
```

Metadata-GC head changes, metadata retry records and `metadataGeneration` alone never
satisfy the retry condition. The attempted-candidate set entry is updated; no second
candidate entry or operationId is created.

## 3. Attempt-keyed ACK outbox

### Ownership

```text
@convax/collaboration
  owns RemoteTransferAttemptBindingV2 only.

@convax/project
  owns the semantic ACK request, attempt-key capability factory,
  branded outbox port contract, carrier gate and receipt state machine.

@convax/desktop
  owns the connection-local attempt-keyed ACK outbox, live registry,
  Peer message construction/authentication/sequencing, queue insertion and query.

No Plugin, renderer or caller owns ACK bytes or connection routing.
```

Desktop supplies a narrow adapter. Project's factory captures it and mints the
branded port; Desktop does not mint Project brands.

### Attempt key

```ts
declare const dependencyCarrierTransferAckAttemptKeyBrandV2: unique symbol
declare const dependencyCarrierTransferAckOutboxPortBrandV2: unique symbol

export interface DependencyCarrierTransferAckAttemptKeyV2<
  K extends RemoteDependencyCarrierKindV2,
> {
  readonly kind: K
  readonly exactManifestDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly [dependencyCarrierTransferAckAttemptKeyBrandV2]: true
}
```

The key's private registry entry binds:

```text
exact Project gate
exact Desktop outbox
exact live RemoteTransferAttemptBindingV2 object
exact Project/epoch/source member/stable key
exact manifest, kind and subject
exact live connection routing held only by Desktop
```

The key contains no `connectionId`, raw `transferId`, ACK bytes, Peer body or
signature.

### Outbox contract

```ts
export interface EnsureDependencyCarrierTransferAckRequestV2<
  K extends RemoteDependencyCarrierKindV2,
> {
  readonly attemptKey:
    DependencyCarrierTransferAckAttemptKeyV2<K>
  readonly kind: K
  readonly exactManifestDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly durabilityProofDigest: null
}

export type EnsureDependencyCarrierTransferAckResultV2 =
  | Readonly<{
      status: "enqueued" | "already-enqueued"
      outboundEnqueueId: Id128V2
    }>
  | Readonly<{
      status: "not-enqueued"
      code: "outbound-backpressure"
    }>
  | Readonly<{
      status: "indeterminate"
      code: "enqueue-outcome-indeterminate"
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "attempt-key-stale"
        | "connection-closed"
        | "manifest-mismatch"
        | "subject-mismatch"
    }>

export type QueryDependencyCarrierTransferAckResultV2 =
  | Readonly<{
      status: "enqueued"
      outboundEnqueueId: Id128V2
    }>
  | Readonly<{
      status: "not-enqueued"
    }>
  | Readonly<{
      status: "indeterminate"
    }>
  | Readonly<{
      status: "stale"
      code: "attempt-key-stale" | "connection-closed"
    }>

export interface DependencyCarrierTransferAckOutboxPortV2 {
  ensureEnqueuedOnce<K extends RemoteDependencyCarrierKindV2>(
    request: EnsureDependencyCarrierTransferAckRequestV2<K>,
  ): EnsureDependencyCarrierTransferAckResultV2

  queryAttempt(
    attemptKey: DependencyCarrierTransferAckAttemptKeyV2,
  ): QueryDependencyCarrierTransferAckResultV2

  readonly [dependencyCarrierTransferAckOutboxPortBrandV2]: true
}
```

Both methods are synchronous. Unexpected throws may cross the adapter boundary but
never imply `not-enqueued`.

### Desktop outbox invariants

The Desktop outbox uses the exact attempt-key registry entry as its unique key:

```text
absent/bound -> enqueued
absent/bound -> unchanged because backpressure
absent/bound -> indeterminate
enqueued -> enqueued with the same outboundEnqueueId
indeterminate -> enqueued | bound-not-enqueued | indeterminate
```

Before queue insertion, Desktop constructs and authenticates the complete Peer
control message privately. Queue insertion and the outbox entry's `enqueued` state
are one atomic in-process operation.

If control returns or throws after insertion, `queryAttempt` returns `enqueued` with
the original ID. A repeated ensure for the same key returns `already-enqueued` and
never inserts a second queue entry.

### Gate state

```ts
export type RemoteDependencyCarrierReceiptStateV2 =
  | "issued"
  | "loading"
  | "consuming"
  | "outbound-indeterminate"
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
        | "outbound-enqueue-indeterminate"
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
        | "store-corrupt"
    }>
```

Receipt private registry additionally binds its exact attempt key and captured
outbox port.

### Consume and reconciliation

```text
issued -> loading
loading pending -> issued
loading rejected -> abandoned
loading success -> consuming under Project sole-writer critical section
```

Inside the final critical section, Project repeats every currentness, owner, index,
closure, attempt and manifest check, then calls `ensureEnqueuedOnce`.

```text
enqueued | already-enqueued:
  consuming -> enqueued
  return exact outboundEnqueueId.

not-enqueued/backpressure:
  consuming -> issued
  return pending.

indeterminate or thrown call:
  consuming -> outbound-indeterminate
  return pending outbound-enqueue-indeterminate.

rejected before enqueue:
  consuming -> abandoned.
```

The gate never asserts that an indeterminate or thrown enqueue produced zero ACK.

For `outbound-indeterminate`, the next consume calls `queryAttempt` with the same
exact key before any enqueue retry:

```text
query enqueued:
  outbound-indeterminate -> enqueued.

query not-enqueued:
  outbound-indeterminate -> issued;
  the next consume repeats all live rechecks before ensure.

query indeterminate or query throw:
  remain outbound-indeterminate.

query stale:
  outbound-indeterminate -> abandoned.
```

No different attempt key may reconcile or retry an indeterminate enqueue.

### Restart semantics

Attempt keys, receipt brands, outbox entries and live connection bindings are
process-only.

After restart:

- every old receipt/key/attempt is stale;
- no old ACK is reconstructed or queried;
- reconnect creates a new authenticated `RemoteTransferAttemptBindingV2` and new
  attempt key;
- durable carrier state may authorize the new attempt only after the complete
  currentness and owner checks;
- an exact duplicate ACK for one still-live attempt is idempotent at the receiver.

## 4. Crash and fault barriers

### Admission

- Stale expected head or map entry: zero native objects.
- Failure before epoch-head pointer: exact candidate closure is recovery-only.
- Ambiguous final pointer: recovery-required, never concurrency loss.
- Recovery publishes only the exact candidate head or quarantines it.

### Metadata GC

- Crash after first-scan head: resume exact second scan.
- Crash after second-scan record: publish only its exact head.
- Crash after second-scan head: return fresh plain evidence.
- Crash after deletion commit: refold all roots and reference count again.
- Changed roots after deletion commit: terminal-not-deleted and zero physical
  deletion.
- Terminal-not-deleted retry retains operationId and increments retryGeneration only
  after a non-metadata root identity change.

### ACK outbox

- Throw before insertion: query reports not-enqueued.
- Throw after insertion: query reports enqueued with the original ID.
- Unknown outcome: receipt remains indeterminate and cannot assert zero ACK.
- Exact-key retry never creates a second queue entry.
- Restart invalidates the old attempt instead of reconstructing an ACK.

## 5. Owner and declaration counts

Exactly one declaration:

```text
Collaboration:
  RemoteTransferAttemptBindingV2
  admission command/plain-evidence contracts
  admission receipt brands

Project/node:
  admission publication recovery record/adapter
  metadata-GC preparation
  second-scan record
  candidate state
  deletion commit
  terminal records
  sole admission and metadata-GC head adapters

Project:
  ACK attempt-key brand/factory/private registry
  branded attempt-keyed outbox port
  carrier receipt state machine and reconciliation

Desktop:
  concrete attempt-keyed outbox
  outbox live registry
  Peer ACK construction/authentication/sequencing/queue insertion/query
```

Exactly zero declarations:

```text
ordinary post-write admission CAS loser
stale admission request writing any native object
plain metadata evidence accepted as delete authority
second scan existing only in process memory
delete-committed recovery deleting without a fresh full refold
second operationId for one metadata candidate
metadata-only generation triggering retry
non-queryable terminal ACK enqueue
outbound throw interpreted as zero ACK
duplicate queue entry for one exact attempt key
caller-supplied ACK bytes
caller-supplied Peer body
caller-supplied connectionId
caller-supplied transferId
old-attempt ACK reconstruction after restart
```

## 6. Mandatory falsifiers

1. Stale epoch head, stable-key entry or member entry leaves every native object
   count unchanged.
2. Under healthy sole-writer execution, no post-write concurrency-loser result is
   reachable.
3. Ambiguous pointer publication produces recovery-required and no Kernel receipt.
4. Crash after first-scan head reconstructs the exact second scan without trusting
   plain evidence.
5. Mutation of any second-scan field invalidates execute and deletes zero objects.
6. Delete-committed recovery with any changed root or nonzero reference count
   publishes terminal-not-deleted and performs zero physical deletion.
7. Terminal-not-deleted cannot retry after metadata-GC-only generation changes.
8. A non-metadata root identity change retries the same candidate with the same
   operationId and checked-successor retryGeneration.
9. Repeated retry creates no second attempted-candidate entry.
10. An enqueue that inserts and then throws is found by exact-key query and is not
    enqueued twice.
11. A throw before insertion is queried as not-enqueued; the next ensure repeats all
    live checks.
12. Indeterminate query never produces a zero-ACK assertion or terminal rejection.
13. Same-key repeated ensure returns the original outboundEnqueueId.
14. Different attempt key, reconstructed key, stale connection or replaced outbox
    invokes no enqueue.
15. Public and Plugin APIs expose no ACK bytes, Peer body, connectionId or
    transferId.
16. Restart invalidates the old attempt/key/receipt and reconstructs zero old ACKs.
17. All previously accepted charge-binding, wrapper-identity and R5.8 I falsifiers
    remain unchanged.

## Unconditional unique author vote

As collaboration Kernel/Control architecture owner, I unconditionally vote `ADOPT`
for this exact R5.10 minimal delta.
