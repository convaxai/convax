# Collaboration v10 R5.11 minimal unique delta

Status: architecture-owner-authored, non-authoritative correction input. This delta
replaces only the rejected clauses of R5.10 candidate SHA-256
`1707fcc34c103d6fb8483f7f2fca89c1d2c21dabfb2a6d937b60eb36a8ce24ae`
identified below. Every other R5.10 clause, R5.9 G/H clause and approved R5.8 I
clause remains byte-semantically unchanged.

## 1. Durable admission-publication recovery authority

### 1.1 Sole Project-epoch pointer

The sole mutable admission-publication recovery authority is:

```text
<ProjectEpochNativeStore>/
  remote-ingress-evidence-admission/publication-recovery-head

  -> RemoteIngressEvidenceAdmissionPublicationRecoveryHeadRecordV2 digest
```

There is exactly one such pointer per `{projectId, projectEpoch}`. Admission startup
and every non-idempotent admission command must load and reconcile this pointer
directly. Directory enumeration, orphan scanning, filename inference and
process-memory recovery state are prohibited.

```ts
export type RemoteIngressEvidenceAdmissionPublicationRecoveryPhaseV2 =
  | "idle"
  | "publication-pending"
  | "reconciled-published"
  | "quarantined"

export interface RemoteIngressEvidenceAdmissionPublicationOperationRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-publication-operation-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly transition: RemoteIngressEvidenceAdmissionTransitionV2

  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly candidateEpochHeadRecordDigest: DigestV2
  readonly transitionRecordDigest: DigestV2
  readonly stableKeyStateRootRecordDigest: DigestV2
  readonly memberQuotaRootRecordDigest: DigestV2
  readonly checkpointRecordDigest: DigestV2
}

export interface RemoteIngressEvidenceAdmissionPublicationTerminalRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-publication-terminal-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly operationRecordDigest: DigestV2
  readonly status: "published" | "quarantined"
  readonly observedEpochHeadPointerDigest: DigestV2
  readonly quarantineReason:
    | null
    | "unexpected-epoch-head"
    | "candidate-closure-mismatch"
    | "pointer-store-corrupt"
}

export interface RemoteIngressEvidenceAdmissionPublicationRecoveryHeadRecordV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-publication-recovery-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2

  readonly priorHeadIdentityDigest: DigestV2 | null
  readonly phase:
    RemoteIngressEvidenceAdmissionPublicationRecoveryPhaseV2

  readonly operationId: Id128V2 | null
  readonly operationRecordDigest: DigestV2 | null
  readonly terminalRecordDigest: DigestV2 | null
}
```

Closed phase matrix:

```text
idle:
  operationId = null
  operationRecordDigest = null
  terminalRecordDigest = null

publication-pending:
  operationId != null
  operationRecordDigest != null
  terminalRecordDigest = null

reconciled-published | quarantined:
  operationId != null
  operationRecordDigest != null
  terminalRecordDigest != null
```

No other combination is decodable.

`priorHeadIdentityDigest` is diagnostic and non-retaining. It creates no native
retention chain. The current recovery head directly retains only its current
operation and terminal records.

### 1.2 Publication barriers

After the ordinary admission prewrite checks and immutable candidate closure have
been written and fsynced:

```text
write/fsync exact publication operation record
-> write/fsync publication-pending recovery head
-> CAS/fsync sole publication-recovery-head pointer
-> reload pointer and prove exact pending head is current

-> attempt exact sole epoch-head pointer publication
-> reload sole epoch-head pointer
```

The epoch-head pointer must not be invoked before the exact `publication-pending`
recovery head is durably current.

An ambiguous recovery-head-pointer CAS is resolved only by reloading that pointer:

```text
pointer == candidate recovery head:
  continue.

pointer == expected prior recovery head:
  retry only the exact recovery-head-pointer CAS.

any other pointer:
  enter store-corrupt; publish no epoch head and return no receipt.
```

### 1.3 Reconciliation

While the publication recovery head remains `publication-pending`:

```text
epoch-head pointer == candidate head:
  validate the exact candidate closure
  -> write/fsync terminal status="published"
  -> write/fsync reconciled-published recovery head
  -> CAS/fsync publication-recovery-head pointer.

epoch-head pointer == expected prior head:
  validate the exact candidate closure
  -> perform only the exact epoch-head pointer publication
  -> reload and require pointer == candidate head
  -> publish reconciled-published as above.

any other epoch-head pointer or candidate mismatch:
  write/fsync terminal status="quarantined"
  -> write/fsync quarantined recovery head
  -> CAS/fsync publication-recovery-head pointer
  -> block further admission for this Project epoch.
```

Recovery never replays the business command, recomputes counters, reconstructs a
candidate, creates another transition or scans orphan objects.

Plain transition evidence and Kernel receipts may be returned only after
`reconciled-published` is durably current.

### 1.4 Clear semantics

A `reconciled-published` head may be cleared by:

```text
reload exact reconciled head
-> reload epoch-head pointer and require exact candidate head
-> write/fsync checked-successor idle recovery head
-> CAS/fsync publication-recovery-head pointer
```

The new idle head has all operation fields null. Clearing drops the current recovery
retention edges; it does not delete immutable records synchronously. Those records
become ordinary metadata-GC candidates.

A crash before clear leaves `reconciled-published`, which startup clears
idempotently. A crash after clear observes the candidate through the sole epoch head.
`quarantined` cannot be cleared except by explicit Project-epoch reset.

Startup must reconcile `publication-pending` or clear `reconciled-published` before
accepting any admission command. It must reject all admission while `quarantined`.

## 2. Acyclic metadata-GC candidate state

Replace
`RemoteIngressEvidenceMetadataGcCandidateStateRecordV2.lastHeadRecordDigest` with:

```ts
readonly expectedPriorMetadataGcHeadRecordDigest: DigestV2
```

Its exact meaning is:

```text
expectedPriorMetadataGcHeadRecordDigest
  = the exact metadata-GC head pointer value validated immediately before
    writing this candidate-state record.
```

For every candidate-state transition:

```text
reload exact expected prior metadata-GC head
-> derive candidate-state bytes in memory
-> write/fsync candidate-state record
-> write/fsync changed attempted-candidate COW pages/root
-> write/fsync resulting metadata-GC head that names the resulting COW root
-> CAS/fsync metadata-GC head pointer against
   expectedPriorMetadataGcHeadRecordDigest
```

The candidate-state record never names its resulting head. The resulting head
references the candidate state only through the resulting attempted-candidate COW
root, so the graph is acyclic.

`expectedPriorMetadataGcHeadRecordDigest` is an identity/check diagnostic. It is not
a Project-native retention edge and does not retain the prior head. Only the current
metadata-GC head, its current operation records and its current attempted-candidate
root create retention edges.

Mutation of this field changes the candidate-state digest and invalidates the
resulting head transition.

## 3. Delete-committed tombstone and physical deletion

`delete-committed` remains the durable tombstone. While it is current, Project/node
rejects every new native metadata reference to the exact candidate.

Startup must reconcile a current `delete-committed` head before permitting any
Project/node operation that can mutate a non-metadata root identity.

### 3.1 Candidate still exists

Under the Project/node sole-writer critical section:

```text
reload exact delete-committed head and deletion-commit record
-> reload exact candidate state
-> refold every current non-metadata root
-> reload exact current reference count
```

If the authorized non-metadata root identity changed, the candidate became
current/reachable, or its reference count is nonzero:

```text
write/fsync terminal-not-deleted record
-> write/fsync terminal-not-deleted candidate state
-> write/fsync changed attempted-candidate COW pages/root
-> write/fsync terminal-not-deleted metadata-GC head
-> CAS/fsync metadata-GC head pointer
-> physically delete zero objects.
```

If identity is unchanged and the candidate remains non-current, unreachable and
zero-reference:

```text
keep delete-committed head current
-> resolve only the exact native object path from object kind and digest
-> idempotently unlink only that exact candidate
-> fsync the containing directory
-> verify exact candidate absence
-> write/fsync terminal-deleted record
-> write/fsync terminal-deleted candidate state
-> write/fsync changed attempted-candidate COW pages/root
-> write/fsync terminal-deleted metadata-GC head
-> CAS/fsync metadata-GC head pointer.
```

`ENOENT` is successful only when the exact delete-committed operation and exact native
object identity are current. Alias, wrong kind, digest mismatch or path mismatch is
`store-corrupt`.

### 3.2 Crash after physical deletion

If restart observes `delete-committed` and the exact candidate is absent:

```text
reload exact delete-committed head/commit/candidate state
-> require the tombstone remained continuously current
-> verify exact candidate absence
-> verify zero current native references to the candidate
-> fsync the containing directory
-> publish the exact terminal-deleted record/state/root/head
```

It does not recreate the candidate and does not publish `terminal-not-deleted`.

If the candidate still exists, recovery repeats the full fresh-root/refcount decision
from section 3.1. Root change before physical deletion always produces
`terminal-not-deleted` and zero deletion.

An ambiguous terminal-head CAS is resolved by reloading the metadata-GC head:

```text
pointer == exact terminal head:
  complete idempotently.

pointer == delete-committed head:
  retry only the exact terminal-head CAS.

any other pointer:
  return store-corrupt and delete no additional object.
```

## 4. Exact generic ACK query

Replace the R5.10 `queryAttempt` signature with:

```ts
queryAttempt<K extends RemoteDependencyCarrierKindV2>(
  attemptKey: DependencyCarrierTransferAckAttemptKeyV2<K>,
): QueryDependencyCarrierTransferAckResultV2
```

No other ACK outbox, attempt-key, indeterminate-result or restart semantic changes.

## 5. Exact owner and declaration counts

Exactly one per Project epoch:

```text
admission publication recovery-head pointer
current admission publication recovery-head record
metadata-GC head pointer
current delete-committed tombstone, when that phase is active
```

Exactly one owner:

```text
@convax/project/node:
  admission publication operation/terminal/head records
  admission publication recovery-head adapter
  metadata-GC candidate-state native records
  delete-committed physical deletion and directory-fsync adapter

@convax/project:
  generic ACK outbox port contract with kind-preserving queryAttempt

@convax/desktop:
  concrete attempt-keyed ACK outbox implementation
```

Exactly zero:

```text
orphan scan used for admission recovery
process-memory admission recovery authority
epoch-head publication before durable publication-pending head
second admission transition created by publication recovery
retaining expectedPriorMetadataGcHeadRecordDigest edge
candidate-state/resulting-head digest cycle
physical deletion before delete-committed durability
terminal-deleted publication before physical deletion and directory fsync
delete-committed recovery without fresh root/refcount checks
terminal-not-deleted after confirmed physical deletion
unparameterized ACK queryAttempt
```

## 6. Mandatory falsifiers

1. Crash after candidate epoch-head fsync but before publication-pending head CAS
   leaves the epoch-head pointer unchanged and requires no orphan scan.
2. Crash after publication-pending head CAS but before epoch-head publication resumes
   the exact operation from the sole recovery-head pointer.
3. Ambiguous epoch-head publication returns no evidence or Kernel receipt until
   `reconciled-published` is durable.
4. Startup with `reconciled-published` clears idempotently; startup with `quarantined`
   admits zero new commands.
5. Mutation of operation, prior head, candidate head, transition, either COW root or
   checkpoint invalidates publication recovery.
6. Every candidate-state record names exactly the head current before that state was
   written; no candidate-state digest depends on its resulting head.
7. Traversing native retention edges from the current metadata-GC head never follows
   `expectedPriorMetadataGcHeadRecordDigest`.
8. Root identity or reference-count change before unlink publishes
   terminal-not-deleted and leaves the candidate present.
9. Crash before unlink retries the fresh-root decision.
10. Crash after unlink but before directory fsync idempotently resolves candidate
    presence, fsyncs the directory and then publishes terminal-deleted.
11. Crash after directory fsync but before terminal head observes exact absence and
    publishes terminal-deleted without recreating the candidate.
12. No execution publishes terminal-deleted while the candidate still exists.
13. No execution physically removes the candidate while a changed root or nonzero
    reference is observed.
14. `queryAttempt` preserves the exact carrier kind through
    `DependencyCarrierTransferAckAttemptKeyV2<K>`.
15. All unchanged R5.10, R5.9 G/H and approved R5.8 I falsifiers continue to pass.

## Red-team closure

The strongest rejection attempts were:

1. Recovery still depends on finding an orphan. Rejected by the mandatory pending
   head published before the epoch-head pointer.
2. Candidate state still retains or hashes its resulting head. Rejected by the exact
   prior-head diagnostic field and one-way resulting-head edge.
3. Crash after unlink leaves a false terminal state. Rejected by keeping
   delete-committed authoritative through unlink/directory fsync and publishing
   terminal-deleted only after verified absence.

Flaw classes checked: hidden process-state authority, digest cycle, retention-chain
leak, ambiguous CAS, deletion-before-authority, post-unlink crash and generic type
erasure.

Score: 9/10. The remaining point is implementation complexity around two independent
head pointers; it is not fatal because neither pointer substitutes for the other,
startup ordering is closed, and crash-injection falsifiers cover every cross-pointer
boundary.

## Unconditional unique author vote

As Project/store/URI architecture owner, I unconditionally vote `ADOPT` for this
exact R5.11 minimal delta and no broader change.
