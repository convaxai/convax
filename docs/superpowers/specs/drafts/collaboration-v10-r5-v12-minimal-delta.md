# Collaboration v10 R5.12 minimal unique delta

Status: architecture-owner-authored, non-authoritative correction input. This delta
replaces only the rejected clauses of R5.11 candidate SHA-256
`1fa16f31ab2acc719a873e9277814fb41f3c5620b3a7674ee2d2cba41c285b8a`.
Every other R5.11 clause, unchanged R5.10 clause, R5.9 G/H clause and approved R5.8
I clause remains byte-semantically unchanged.

## 1. Closed admission-publication recovery-head state machine

### 1.1 Exact record types

Replace the R5.11 admission-publication terminal and recovery-head declarations
with:

```ts
interface RemoteIngressEvidenceAdmissionPublicationTerminalBaseV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-publication-terminal-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly operationId: Id128V2
  readonly operationRecordDigest: DigestV2
}

export interface RemoteIngressEvidenceAdmissionPublicationPublishedTerminalRecordV2
  extends RemoteIngressEvidenceAdmissionPublicationTerminalBaseV2 {
  readonly status: "published"
  readonly observedEpochHeadPointerDigest: DigestV2
  readonly quarantineReason: null
}

export type RemoteIngressEvidenceAdmissionPublicationQuarantinedTerminalRecordV2 =
  RemoteIngressEvidenceAdmissionPublicationTerminalBaseV2 &
    (
      | {
          readonly status: "quarantined"
          readonly observedEpochHeadPointerDigest: DigestV2
          readonly quarantineReason:
            | "unexpected-epoch-head"
            | "candidate-closure-mismatch"
        }
      | {
          readonly status: "quarantined"
          readonly observedEpochHeadPointerDigest: DigestV2 | null
          readonly quarantineReason: "pointer-store-corrupt"
        }
    )

export type RemoteIngressEvidenceAdmissionPublicationTerminalRecordV2 =
  | RemoteIngressEvidenceAdmissionPublicationPublishedTerminalRecordV2
  | RemoteIngressEvidenceAdmissionPublicationQuarantinedTerminalRecordV2

interface RemoteIngressEvidenceAdmissionPublicationRecoveryHeadBaseV2 {
  readonly format:
    "convax.remote-ingress-evidence-admission-publication-recovery-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly priorHeadIdentityDigest: DigestV2 | null
}

export type RemoteIngressEvidenceAdmissionPublicationRecoveryHeadRecordV2 =
  RemoteIngressEvidenceAdmissionPublicationRecoveryHeadBaseV2 &
    (
      | {
          readonly phase: "idle"
          readonly operationId: null
          readonly operationRecordDigest: null
          readonly terminalRecordDigest: null
        }
      | {
          readonly phase: "publication-pending"
          readonly operationId: Id128V2
          readonly operationRecordDigest: DigestV2
          readonly terminalRecordDigest: null
        }
      | {
          readonly phase: "reconciled-published"
          readonly operationId: Id128V2
          readonly operationRecordDigest: DigestV2
          readonly terminalRecordDigest: DigestV2
        }
      | {
          readonly phase: "quarantined"
          readonly operationId: Id128V2
          readonly operationRecordDigest: DigestV2
          readonly terminalRecordDigest: DigestV2
        }
    )
```

No wider nullable interface is decodable.

`observedEpochHeadPointerDigest` is diagnostic and non-retaining. For
`status="published"` it must equal the exact `candidateEpochHeadRecordDigest` loaded
from the named operation record. For `status="quarantined"` it may be null only when
`quarantineReason="pointer-store-corrupt"`.

### 1.2 Genesis

Every `{projectId, projectEpoch}` has exactly one valid admission-publication
recovery genesis record:

```text
generation = 0
priorHeadIdentityDigest = null
phase = idle
operationId = null
operationRecordDigest = null
terminalRecordDigest = null
```

Before the first admission command, Project/node must:

```text
write/fsync the exact genesis idle record
-> CAS/fsync an absent publication-recovery-head pointer to the genesis digest
-> reload and require the exact genesis digest.
```

Ambiguous genesis CAS is resolved only by pointer reload:

```text
pointer == exact genesis digest:
  complete idempotently.

pointer absent:
  retry only the exact absent -> genesis CAS.

any other pointer:
  validate it as the already-current exact genesis or a legal checked successor;
  otherwise return store-corrupt and perform zero admission writes.
```

A record with `generation=0` is valid only when it is the exact genesis idle record.
Every non-genesis recovery head has `generation>0` and a non-null
`priorHeadIdentityDigest`.

### 1.3 Checked successor

For a current recovery head record and a proposed successor, `checkedSuccessor`
means all of:

```text
same projectId and projectEpoch
successor.generation = checkedUint64Add(current.generation, 1)
successor.priorHeadIdentityDigest = current recovery-head record digest
one legal phase edge
edge-specific operation/terminal identity equality
closed phase matrix satisfied
all referenced immutable records load, hash and validate exactly
```

Uint64 overflow, identity mismatch, unknown records, phase mismatch or an illegal
edge fails before writing any operation, terminal, recovery-head or pointer byte.

Every successful publication-recovery-head pointer CAS must publish one exact
`checkedSuccessor`. Retrying an ambiguous CAS retries only the same successor bytes;
it never generates another operation, terminal or recovery head.

`priorHeadIdentityDigest` proves the checked predecessor only. It is diagnostic and
non-retaining and creates zero metadata-retention edges.

### 1.4 Only legal phase edges

The complete legal graph is:

```text
idle
  -> publication-pending

publication-pending
  -> reconciled-published
  -> quarantined

reconciled-published
  -> idle

quarantined
  -> no successor inside the same Project epoch
```

Project-epoch reset creates a new epoch and is not a recovery-head edge.

Edge rules:

```text
idle -> publication-pending:
  successor names one newly written exact operation record.

publication-pending -> reconciled-published:
  operationId and operationRecordDigest equal the pending head;
  terminal status = published;
  terminal operation identity equals the pending operation;
  terminal observedEpochHeadPointerDigest equals the operation's exact candidate;
  successor names that exact terminal.

publication-pending -> quarantined:
  operationId and operationRecordDigest equal the pending head;
  terminal status = quarantined;
  terminal operation identity equals the pending operation;
  successor names that exact terminal.

reconciled-published -> idle:
  epoch-head pointer still equals the operation's exact candidate;
  successor operation and terminal fields are all null.
```

For every non-idle recovery head, the named operation record must match the head's
`projectId`, `projectEpoch`, `operationId` and `operationRecordDigest`.

For `reconciled-published`, the named terminal must have `status="published"`. For
`quarantined`, the named terminal must have `status="quarantined"`. The terminal's
Project, epoch, operation id and operation-record digest must equal both the recovery
head and operation record.

Any phase/status/reason/operation mismatch is non-decodable `store-corrupt`. It
returns no evidence or Kernel receipt and produces zero additional writes.

An attempted edge outside the graph is rejected before its first immutable write.
In particular:

```text
idle -> idle
idle -> reconciled-published
idle -> quarantined
pending -> idle
pending -> pending
reconciled-published -> pending
reconciled-published -> quarantined
quarantined -> any same-epoch phase
```

all write zero operation records, zero terminal records, zero recovery-head records
and zero pointer bytes.

## 2. Closed metadata-GC admission-publication closure

### 2.1 Object-kind extension

Replace the inherited `RemoteIngressEvidenceMetadataObjectKindV2` declaration with:

```ts
export type RemoteIngressEvidenceMetadataObjectKindV2 =
  | "epoch-head"
  | "transition"
  | "checkpoint"
  | "stable-key-state"
  | "member-quota"
  | "stable-key-map-page"
  | "member-quota-map-page"
  | "admission-publication-operation"
  | "admission-publication-terminal"
  | "admission-publication-recovery-head"
```

The mutable `publication-recovery-head` pointer is never a metadata-GC object. Only
immutable operation, terminal and recovery-head records are candidates.

### 2.2 Exact native path resolution

For the three added kinds, the closed Project/node resolver is:

```text
base =
  <ProjectEpochNativeStore>/
    remote-ingress-evidence-admission/publication

"admission-publication-operation":
  <base>/operations/<digest-native-key>.bin

"admission-publication-terminal":
  <base>/terminals/<digest-native-key>.bin

"admission-publication-recovery-head":
  <base>/recovery-head-records/<digest-native-key>.bin
```

`<digest-native-key>` is derived only through the existing canonical Project-local
record-digest native-key codec. Raw path input, filename inference, directory scan,
kind fallback and cross-kind aliasing are prohibited.

Resolution must prove:

```text
canonical contained path
no symbolic-link traversal or final symbolic link
record format exactly matches objectKind
record projectId/projectEpoch exactly match the store
ProjectLocalRecordDigest(record bytes) exactly equals objectRecordDigest
```

Unknown kind, wrong directory, wrong record format, wrong digest, alias or
containment failure is `store-corrupt` and physically deletes zero objects.

### 2.3 Exact recovery-root commitment

For each metadata root fold, define the non-stored commitment value:

```ts
export interface RemoteIngressEvidenceMetadataRecoveryRootCommitmentV2 {
  readonly format:
    "convax.remote-ingress-evidence-metadata-recovery-root-commitment/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2

  readonly unchangedRecoveryRootsDigest: DigestV2

  readonly currentAdmissionPublicationRecoveryHeadRecordDigest: DigestV2
  readonly currentAdmissionPublicationOperationRecordDigest: DigestV2 | null
  readonly currentAdmissionPublicationTerminalRecordDigest: DigestV2 | null
}
```

`unchangedRecoveryRootsDigest` is the exact digest that the unchanged inherited
R5.10 recovery-root fold produces over every recovery root other than the
admission-publication recovery authority. It is not a second mutable pointer or a
new native record.

The existing `recoveryRootSetDigest` field is now exactly:

```text
ProjectLocalRecordDigest(
  restrictedJCS(
    RemoteIngressEvidenceMetadataRecoveryRootCommitmentV2
  )
)
```

The three admission-publication fields are derived from one atomic root-fold
snapshot:

```text
reload exact current publication-recovery-head pointer
-> load and validate its exact recovery-head record
-> copy its operationRecordDigest
-> copy its terminalRecordDigest
-> require the closed phase matrix
-> require exact operation/terminal identity and phase/status consistency
-> construct the commitment.
```

The commitment fields must equal the current recovery-head record byte-for-byte:

```text
idle:
  operation digest = null
  terminal digest = null

publication-pending:
  operation digest != null
  terminal digest = null

reconciled-published | quarantined:
  operation digest != null
  terminal digest != null
```

`recoveryRootSetDigest` directly retains the current admission-publication
recovery-head record and its current non-null operation and terminal records. The
operation record continues to retain its exact candidate admission closure under the
unchanged R5.11 rules.

Neither the commitment nor reference traversal includes `priorHeadIdentityDigest`.
A prior recovery head is retained only if some independent current root names it.

Because `recoveryRootSetDigest` is part of
`RemoteIngressEvidenceMetadataNonGcRootIdentityV2`, every successful
publication-recovery-head CAS changes the non-metadata root identity. Metadata GC
must restart its root/refcount decision when that identity changes.

### 2.4 GC eligibility

While the current recovery head is `publication-pending`, `reconciled-published` or
`quarantined`:

```text
current recovery-head referenceCount > 0
current operation referenceCount > 0
current terminal referenceCount > 0 when present
```

Therefore none of those current records is eligible for metadata GC.

After a checked `reconciled-published -> idle` clear:

```text
the new idle head remains retained;
the former reconciled head, operation and terminal lose these recovery-root edges;
priorHeadIdentityDigest retains none of them;
each becomes an ordinary metadata-GC candidate when no independent root references it.
```

A `quarantined` closure remains retained until explicit Project-epoch reset. Ordinary
same-epoch metadata GC cannot clear or delete it.

The existing two-scan, delete-committed tombstone, exact unlink, directory-fsync and
terminal publication rules apply unchanged to all three added object kinds.

## 3. Exact owner and declaration counts

Exactly one per `{projectId, projectEpoch}`:

```text
publication-recovery-head mutable pointer
current publication-recovery-head immutable record
genesis idle recovery-head identity
admission-publication contribution to each recoveryRootSetDigest fold
metadata-GC head pointer
```

Exactly one canonical declaration:

```text
RemoteIngressEvidenceAdmissionPublicationTerminalRecordV2 closed union
RemoteIngressEvidenceAdmissionPublicationRecoveryHeadRecordV2 closed union
RemoteIngressEvidenceMetadataObjectKindV2 closed union
RemoteIngressEvidenceMetadataRecoveryRootCommitmentV2 digest formula
three-kind native path switch
```

Exactly one owner:

```text
@convax/project:
  admission-publication phase, checked-successor, terminal and retention rules

@convax/project/node:
  genesis publication
  immutable operation/terminal/recovery-head records
  sole publication-recovery-head pointer adapter
  recovery-root folding
  exact native path resolution
  metadata-GC unlink and directory fsync
```

Exactly zero:

```text
second admission-publication recovery pointer
recovery-head transition outside the closed graph
write caused by an illegal recovery-head edge
non-genesis generation zero
non-genesis null priorHeadIdentityDigest
published terminal with null or non-candidate observed digest
published terminal with non-null quarantineReason
quarantined terminal with null reason
null observed digest for a non-pointer-store-corrupt quarantine
phase/terminal-status mismatch
operation identity drift across pending, terminal and successor head
directory scan or filename inference used for recovery or GC resolution
cross-kind native path alias
mutable recovery pointer admitted as a metadata-GC candidate
retaining priorHeadIdentityDigest edge
current pending or quarantined closure eligible for metadata GC
same-epoch clearing of a quarantined closure
new package, package dependency or parallel durability authority
```

## 4. Mandatory falsifiers

1. An empty Project-epoch store publishes exactly one generation-zero idle genesis
   before the first admission command.
2. A generation-zero non-idle record, or a generation-zero record with a prior
   digest, is rejected with zero additional writes.
3. Every successful recovery-head CAS increments generation by exactly one and names
   the exact prior current record digest.
4. Every legal normal sequence is exactly
   `idle -> pending -> reconciled -> idle`.
5. Every legal quarantine sequence is exactly
   `idle -> pending -> quarantined`.
6. Attempting any other edge changes zero immutable objects and zero pointer bytes.
7. An ambiguous checked-successor CAS either observes the exact candidate, retries
   only that candidate against the exact prior head, or fails `store-corrupt`.
8. A published terminal whose observed digest differs from the operation candidate,
   or whose reason is non-null, is rejected.
9. A quarantined terminal with a null reason is rejected; a null observed digest is
   accepted only with `pointer-store-corrupt`.
10. A recovery-head phase whose terminal status, operation id or operation digest
    differs from the referenced records is rejected before receipt publication.
11. Each added metadata object kind resolves to exactly one contained native path;
    kind, format, digest or path alias mismatch deletes zero objects.
12. With `publication-pending` current, metadata GC observes nonzero references to
    the current recovery head and operation.
13. With `quarantined` current, metadata GC observes nonzero references to the current
    recovery head, operation and terminal.
14. With `reconciled-published` current, metadata GC observes nonzero references to
    the current recovery head, operation and terminal.
15. After checked clear to idle, the old reconciled head, operation and terminal are
    collectable when no independent root references them.
16. Traversing recovery retention never follows `priorHeadIdentityDigest`.
17. A concurrent publication-recovery-head change changes `recoveryRootSetDigest`
    and the non-metadata root identity, forcing an in-flight metadata-GC deletion
    decision to restart or publish terminal-not-deleted.
18. Metadata GC can physically unlink an unreachable old operation, terminal or
    recovery-head record only through its exact new kind/path and the unchanged
    delete-committed/directory-fsync barrier.
19. A quarantined closure remains noncollectable until Project-epoch reset.
20. Every unchanged R5.11 physical-deletion and generic
    `queryAttempt<K extends RemoteDependencyCarrierKindV2>` falsifier continues to
    pass.
21. Every unchanged R5.10, R5.9 G/H and approved R5.8 I falsifier continues to pass.

## 5. Red-team closure

The strongest rejection attempts were:

1. A recovery head can skip phases or roll back generation. Rejected by the unique
   genesis, four-edge graph and mandatory checked successor on every successful
   pointer CAS.
2. Terminal bytes can encode a phase/status/reason contradiction. Rejected by the
   closed terminal and recovery-head unions plus exact cross-record identity checks.
3. Pending or quarantined recovery records can be deleted because metadata GC does
   not know their kinds or roots. Rejected by the three-kind extension, closed native
   resolver and direct recovery-root commitment over the current closure.

Flaw classes checked: incomplete state machine, hidden rollback, nullable-union
ambiguity, cross-record identity drift, missing metadata-object admission,
under-retention, prior-chain leak, GC/path aliasing, concurrent root change and
duplicate authority.

No major defect remains under the conditions that the exact path switch and
recovery-root commitment are implemented as written and all inherited deletion
barriers remain unchanged. This conclusion fails if any implementation treats
`priorHeadIdentityDigest` as retaining, omits the current recovery head from a root
fold, or permits a non-checked-successor pointer write.

Score: 9/10. The remaining deduction is implementation complexity across recovery
publication and metadata-GC root folding; it is not fatal because ownership remains
single, the authorities remain separate, and crash/concurrency falsifiers cover the
join.

## 6. Unconditional unique author vote

As Project/store/URI architecture owner, I unconditionally votes `ADOPT` for this
exact R5.12 minimal delta and no broader change.
