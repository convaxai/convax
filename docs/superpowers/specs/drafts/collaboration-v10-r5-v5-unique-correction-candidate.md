# Collaboration v10 R5.5 unique correction candidate

Status: root-formatted, non-authoritative architecture review input. It corrects the
permanently rejected 83,849-byte candidate with ordinary SHA-256
`72d624fa3df95411fc33eae1bdafb8b7c34861f991db3501a24b45dd12bd1f90`.
It grants no implementation or promotion permission. Any edit changes this
candidate identity and invalidates every prior vote.

This candidate selects a two-stage non-frame durability model: an immutable-object
receipt proves only durable bytes; a separate owner-install receipt proves durable
owner semantics. An immutable-object receipt can never authorize ACK.

## 1. Owners and dependency direction

```text
@convax/collaboration
  owns generic ingress kinds, reservation/completion capabilities, sequential
  cursors, validation capabilities, immutable-object receipts, selected owner-port
  factory/registry, causal-frame admission, scan-proof capabilities and GC
  authorization.
  imports no Convax package and may depend only on external yjs.

@convax/project/collaboration-protocol
  owns CVXRSA02, Peer wire DTOs, signed offer evidence, reset Control
  views/bundles/factories, registry-page validation and browser-safe Project
  protocol contracts that use ProjectFileIdV2 or ProjectVersionIdV2.

@convax/canvas
  owns CVXCGP02, Canvas genesis validation, Canvas runtime and its CGP owner-port
  implementation.

@convax/project
  owns ProjectIndex/reset composition and current wanted-root/currentness policy.

@convax/project/node
  is the sole native writer and owns update/blob staging, immutable-object
  promotion, evidence ledgers, COW index records, proof records, owner indexes,
  quarantine commits and private dependency-carrier receipts.

@convax/desktop
  selects exact artifacts and wires process capabilities. It owns no schema,
  validator, receipt, ACK rule or persistence transition.
```

`@convax/collaboration/control` does not exist; its export, import and declaration
counts are zero. The runtime graph is:

```text
canvas -> collaboration
project -> canvas, collaboration, project-files, uri, ui
api -> collaboration, project/collaboration-protocol
desktop -> canvas, collaboration, project, project-files, uri
collaboration -> external yjs only
```

The portable schema namespace `control-plane` does not create a runtime package or
dependency.

## 2. Completed staging and sequential cursor

```ts
export type RemoteUpdateIngressKindV2 =
  | "causal-frame"
  | "checkpoint"
  | "validation-suffix"
  | "registry-page"
  | "causal-frontier"
  | "actor-head-set"
  | "state-vector"
  | "canvas-genesis-proof-carrier"
  | "document-shard-reset-authorization-carrier"

export type RemoteNonFrameIngressKindV2 =
  | "checkpoint"
  | "validation-suffix"
  | "registry-page"
  | "causal-frontier"
  | "actor-head-set"
  | "state-vector"
  | "canvas-genesis-proof-carrier"
  | "document-shard-reset-authorization-carrier"

export type UpdateIngressChunkBytesV2 =
  | "4096"
  | "8192"
  | "16384"
  | "32768"
  | "65536"
  | "131072"
  | "262144"

export interface RemoteIngressReservationReceiptV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly currentChunkSetHeadRecordDigest: DigestV2
  readonly kind: RemoteUpdateIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly declaredByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
  readonly durableChunkCount: Uint32V2
  readonly durableStagedByteLength: Uint64V2
  readonly durableChunkSetDigest: DigestV2
  readonly [remoteIngressReservationReceiptBrandV2]: true
}

export interface RemoteIngressCompletedStagingEvidenceV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly finalChunkSetHeadRecordDigest: DigestV2
  readonly durableChunkSetDigest: DigestV2
  readonly kind: RemoteUpdateIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
}

export type CompleteRemoteIngressStagingPortResultV2 =
  | Readonly<{
      status: "complete"
      evidence: RemoteIngressCompletedStagingEvidenceV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-receipt"
        | "transfer-incomplete"
        | "length-mismatch"
        | "hash-mismatch"
        | "durability-failed"
        | "store-corrupt"
    }>

export type RemoteIngressByteCursorReadV2 =
  | Readonly<{
      status: "chunk"
      chunkIndex: Uint32V2
      byteOffset: Uint64V2
      exactByteLength: Uint32V2
      exactChunkSha256: OrdinarySha256V2
      exactChunkBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "complete"
      exactByteLength: Uint64V2
      ordinarySha256: OrdinarySha256V2
    }>

export interface RemoteIngressByteCursorV2 {
  next(): Promise<RemoteIngressByteCursorReadV2>
  close(): void
  readonly [remoteIngressByteCursorBrandV2]: true
}

export interface CompletedRemoteUpdateIngressV2<
  K extends RemoteUpdateIngressKindV2 = RemoteUpdateIngressKindV2,
> {
  readonly evidence: Readonly<
    RemoteIngressCompletedStagingEvidenceV2 & { readonly kind: K }
  >
  openSequentialCursor(): Promise<RemoteIngressByteCursorV2>
  readonly [completedRemoteUpdateIngressBrandV2]: true
}

export type CompleteRemoteIngressStagingResultV2 =
  | Readonly<{
      status: "complete"
      completed: CompletedRemoteUpdateIngressV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-receipt"
        | "transfer-incomplete"
        | "length-mismatch"
        | "hash-mismatch"
        | "durability-failed"
        | "store-corrupt"
    }>

export interface RemoteIngressStagingPersistencePortV2 {
  completeRemoteIngressStaging(
    reservation: RemoteIngressReservationReceiptV2,
  ): Promise<CompleteRemoteIngressStagingPortResultV2>
}
```

Project/node streams final count, length, chunk-set digest and whole SHA validation,
then returns plain evidence. Kernel compares every receipt/evidence mirror and alone
registers the completed capability. Project/node cannot mint a Kernel brand.

Cursor rules are closed:

- start at offset `"0"` and advance by exact contiguous chunk index/offset;
- return one persisted chunk per call;
- non-final chunk length equals manifest `chunkBytes`; final is a positive remainder;
- allow at most one live cursor per completed capability;
- complete, close, throw, pending, reject and cancel permanently invalidate a cursor;
- a second pass first closes the prior cursor, then opens a new sequential cursor;
- `readAll`, random offset, Project path, native fd and complete-transfer `Uint8Array`
  APIs have declaration count zero.

## 3. Validation, immutable promotion and selected owner ports

### 3.1 Validation capability

```ts
export interface RemoteIngressOwnerValidationEvidenceV2<
  K extends RemoteUpdateIngressKindV2,
> {
  readonly kind: K
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly protocolDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
}

export type RemoteIngressOwnerValidationResultV2<
  K extends RemoteUpdateIngressKindV2,
> =
  | Readonly<{
      status: "validated"
      evidence: RemoteIngressOwnerValidationEvidenceV2<K>
    }>
  | Readonly<{
      status: "pending"
      code: "owner-dependency-pending"
    }>
  | Readonly<{
      status: "rejected"
      code: "owner-validation-rejected" | "authorization-closed"
    }>

export interface FullyValidatedRemoteIngressStagingV2<
  K extends RemoteUpdateIngressKindV2,
> {
  readonly completed: CompletedRemoteUpdateIngressV2<K>
  readonly ownerArtifactDigest: DigestV2
  readonly [fullyValidatedRemoteIngressStagingBrandV2]: true
}
```

Kernel mints a validation capability only after either its exact causal-frame
validator or the exact selected non-frame owner port succeeds and every mirror is
checked. Plain validation evidence is never accepted as a public input.

### 3.2 Immutable promotion

```ts
export interface RemoteImmutableIngressObjectReceiptV2<
  K extends RemoteUpdateIngressKindV2,
> {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly finalChunkSetHeadRecordDigest: DigestV2
  readonly durableChunkSetDigest: DigestV2
  readonly kind: K
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly immutableObjectDigest: DigestV2
  readonly [remoteImmutableIngressObjectReceiptBrandV2]: true
}

export type PutImmutableCompletedRemoteIngressResultV2<
  K extends RemoteUpdateIngressKindV2,
> =
  | Readonly<{
      status: "durable"
      receipt: RemoteImmutableIngressObjectReceiptV2<K>
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-completed-staging"
        | "mirror-mismatch"
        | "durability-failed"
        | "store-corrupt"
    }>

export interface RemoteIngressImmutableObjectPersistencePortV2 {
  putImmutableCompletedRemoteIngress<K extends RemoteUpdateIngressKindV2>(
    validated: FullyValidatedRemoteIngressStagingV2<K>,
  ): Promise<PutImmutableCompletedRemoteIngressResultV2<K>>
}
```

Project/node promotes staged bytes through same-filesystem rename, reflink or bounded
sequential copy. Callers never supply a second complete byte copy. This receipt
proves durable immutable bytes only. It cannot authorize ACK, journal, head,
dependency install or owner currentness.

### 3.3 Owner install and selected port registry

```ts
export type RemoteIngressAckAuthorityV2 =
  | "replica-durable-ack"
  | "null-durable-ack"
  | "project-private-carrier-ack"

export type RemoteIngressOwnerAckBindingV2 =
  | Readonly<{
      kind: "replica-durable-ack"
      replicaDurableAckCoreDigest: DigestV2
    }>
  | Readonly<{
      kind: "null-durable-ack"
      durabilityProofDigest: null
    }>
  | Readonly<{
      kind: "project-private-carrier-ack"
      durabilityProofDigest: null
    }>

export interface RemoteIngressOwnerInstallEvidenceV2<
  K extends RemoteNonFrameIngressKindV2,
> {
  readonly kind: K
  readonly immutableObjectDigest: DigestV2
  readonly ownerInstallRecordDigest: DigestV2
  readonly ownerHeadRecordDigest: DigestV2
  readonly ackBinding: RemoteIngressOwnerAckBindingV2
}

export type RemoteIngressOwnerInstallResultV2<
  K extends RemoteNonFrameIngressKindV2,
> =
  | Readonly<{
      status: "installed"
      evidence: RemoteIngressOwnerInstallEvidenceV2<K>
    }>
  | Readonly<{
      status: "pending"
      code: "owner-install-pending"
    }>
  | Readonly<{
      status: "rejected"
      code: "authorization-closed" | "durability-failed" | "store-corrupt"
    }>

export interface RemoteNonFrameIngressOwnerInstallReceiptV2<
  K extends RemoteNonFrameIngressKindV2,
> {
  readonly kind: K
  readonly immutableObjectDigest: DigestV2
  readonly ownerInstallRecordDigest: DigestV2
  readonly ownerHeadRecordDigest: DigestV2
  readonly ackBinding: RemoteIngressOwnerAckBindingV2
  readonly [remoteNonFrameIngressOwnerInstallReceiptBrandV2]: true
}

export interface RemoteNonFrameIngressOwnerPortDefinitionV2<
  K extends RemoteNonFrameIngressKindV2,
  A extends RemoteIngressAckAuthorityV2,
> {
  readonly kind: K
  readonly ackAuthority: A
  readonly protocolDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  readonly ownerAuthorityIdentity: object
  validate(
    completed: CompletedRemoteUpdateIngressV2<K>,
  ): Promise<RemoteIngressOwnerValidationResultV2<K>>
  install(
    validated: FullyValidatedRemoteIngressStagingV2<K>,
    object: RemoteImmutableIngressObjectReceiptV2<K>,
  ): Promise<RemoteIngressOwnerInstallResultV2<K>>
}

export interface RemoteNonFrameIngressOwnerPortV2<
  K extends RemoteNonFrameIngressKindV2,
  A extends RemoteIngressAckAuthorityV2,
> {
  readonly kind: K
  readonly ackAuthority: A
  readonly protocolDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
  validate(
    completed: CompletedRemoteUpdateIngressV2<K>,
  ): Promise<RemoteIngressOwnerValidationResultV2<K>>
  install(
    validated: FullyValidatedRemoteIngressStagingV2<K>,
    object: RemoteImmutableIngressObjectReceiptV2<K>,
  ): Promise<RemoteIngressOwnerInstallResultV2<K>>
  readonly [remoteNonFrameIngressOwnerPortBrandV2]: true
}

export interface SelectedRemoteNonFrameIngressOwnerAuthoritiesV2 {
  readonly checkpoint: object
  readonly validationSuffix: object
  readonly registryPage: object
  readonly causalFrontier: object
  readonly actorHeadSet: object
  readonly stateVector: object
  readonly canvasGenesisProofCarrier: object
  readonly documentShardResetAuthorizationCarrier: object
}

export interface SelectedRemoteNonFrameIngressOwnerPortsV2 {
  readonly checkpoint: RemoteNonFrameIngressOwnerPortV2<
    "checkpoint",
    "replica-durable-ack"
  >
  readonly validationSuffix: RemoteNonFrameIngressOwnerPortV2<
    "validation-suffix",
    "null-durable-ack"
  >
  readonly registryPage: RemoteNonFrameIngressOwnerPortV2<
    "registry-page",
    "null-durable-ack"
  >
  readonly causalFrontier: RemoteNonFrameIngressOwnerPortV2<
    "causal-frontier",
    "null-durable-ack"
  >
  readonly actorHeadSet: RemoteNonFrameIngressOwnerPortV2<
    "actor-head-set",
    "null-durable-ack"
  >
  readonly stateVector: RemoteNonFrameIngressOwnerPortV2<
    "state-vector",
    "null-durable-ack"
  >
  readonly canvasGenesisProofCarrier: RemoteNonFrameIngressOwnerPortV2<
    "canvas-genesis-proof-carrier",
    "project-private-carrier-ack"
  >
  readonly documentShardResetAuthorizationCarrier:
    RemoteNonFrameIngressOwnerPortV2<
      "document-shard-reset-authorization-carrier",
      "project-private-carrier-ack"
    >
  readonly [selectedRemoteNonFrameIngressOwnerPortsBrandV2]: true
}

export interface RemoteNonFrameIngressOwnerPortFactoryV2 {
  readonly protocolDigest: DigestV2
  createOwnerPort<
    K extends RemoteNonFrameIngressKindV2,
    A extends RemoteIngressAckAuthorityV2,
  >(
    definition: RemoteNonFrameIngressOwnerPortDefinitionV2<K, A>,
  ): RemoteNonFrameIngressOwnerPortV2<K, A>
  selectOwnerPorts(
    ports: Readonly<{
      checkpoint: RemoteNonFrameIngressOwnerPortV2<
        "checkpoint",
        "replica-durable-ack"
      >
      validationSuffix: RemoteNonFrameIngressOwnerPortV2<
        "validation-suffix",
        "null-durable-ack"
      >
      registryPage: RemoteNonFrameIngressOwnerPortV2<
        "registry-page",
        "null-durable-ack"
      >
      causalFrontier: RemoteNonFrameIngressOwnerPortV2<
        "causal-frontier",
        "null-durable-ack"
      >
      actorHeadSet: RemoteNonFrameIngressOwnerPortV2<
        "actor-head-set",
        "null-durable-ack"
      >
      stateVector: RemoteNonFrameIngressOwnerPortV2<
        "state-vector",
        "null-durable-ack"
      >
      canvasGenesisProofCarrier: RemoteNonFrameIngressOwnerPortV2<
        "canvas-genesis-proof-carrier",
        "project-private-carrier-ack"
      >
      documentShardResetAuthorizationCarrier:
        RemoteNonFrameIngressOwnerPortV2<
          "document-shard-reset-authorization-carrier",
          "project-private-carrier-ack"
        >
    }>,
    authorities: SelectedRemoteNonFrameIngressOwnerAuthoritiesV2,
  ): SelectedRemoteNonFrameIngressOwnerPortsV2
  readonly [remoteNonFrameIngressOwnerPortFactoryBrandV2]: true
}
```

One exact selected Kernel runtime creates the factory. Its private live registry
binds each port to definition, kind, ACK class, protocol digest, owner artifact,
owner authority object and existing owner-limit identity. All eight ports must come
from the same factory; each authority identity must equal the corresponding selected
authority object. Structural, cross-factory, cross-runtime and disposed values
reject. There is no ambient lookup, global singleton, serializer or public top-level
constructor.

Canvas uses the generic factory and its selected Canvas runtime to create the CGP
port without importing Project. Project collaboration-protocol uses the same factory
and selected Control bundle to create registry/RSA ports. Kernel creates the other
five ports. Desktop only composes and selects the exact set.

### 3.4 Terminal routes

| Kind | Terminal authority | ACK |
| --- | --- | --- |
| causal-frame | committed journal/head | Replica durable digest |
| checkpoint | owner-install receipt | Replica durable digest |
| validation-suffix | owner-install receipt | null |
| registry-page | owner-install receipt | null |
| causal-frontier | owner-install receipt | null |
| actor-head-set | owner-install receipt | null |
| state-vector | owner-install receipt | null |
| CGP | consumed Project-private carrier receipt | null |
| RSA | consumed Project-private carrier receipt | null |

Causal frame route is completed staging, Kernel frame validation, validated staging,
immutable receipt, pending inbox, full semantic validation, accepted journal,
committed head, Replica ACK.

Every non-frame route is completed staging, exact selected owner validation, Kernel
validated staging, immutable receipt, the exact same selected owner install, Kernel
owner-install receipt, then its kind-specific ACK gate.

Carrier owner-install receipt cannot ACK. Project rechecks wanted root, dependency
cache head, install transaction, raw closure and editor authority, then mints and
consumes its private carrier receipt. Immutable receipt alone never ACKs.

## 4. Full scan evidence, minimal proof and GC

```ts
export interface DurableReferenceScanPortEvidenceV2 {
  readonly proofKind: "first-scan" | "second-scan"
  readonly priorProofRecordDigest: DigestV2 | null
  readonly ref: FrameObjectRefV2
  readonly proofRecordDigest: DigestV2
  readonly targetRefDigest: DigestV2
  readonly acceptedHeadRecordDigest: DigestV2
  readonly referenceIndexHeadRecordDigest: DigestV2
  readonly referenceIndexGeneration: Uint64V2
  readonly referenceIndexRootRecordDigest: DigestV2
  readonly referenceIndexRootPageDigest: DigestV2 | null
  readonly indexCommitment: DigestV2
  readonly coverageRecordDigest: DigestV2
  readonly targetReferenceSetDigest: DigestV2
  readonly durableReferenceCount: Uint64V2
  readonly reachableFromAcceptedHead: boolean
  readonly storeGeneration: Uint64V2
}

export type DurableReferenceScanPortResultV2 =
  | Readonly<{
      status: "complete"
      evidence: DurableReferenceScanPortEvidenceV2
    }>
  | Readonly<{
      status: "incomplete"
      code:
        | "coverage-gap"
        | "scan-invalidated"
        | "unsupported-record"
        | "store-corrupt"
    }>

export interface DurableReferenceScanProofV2 {
  readonly proofKind: "first-scan" | "second-scan"
  readonly ref: FrameObjectRefV2
  readonly proofRecordDigest: DigestV2
  readonly [durableReferenceScanProofBrandV2]: true
}

export type DurableReferenceScanResultV2 =
  | Readonly<{
      status: "complete"
      proof: DurableReferenceScanProofV2
    }>
  | Readonly<{
      status: "incomplete"
      code:
        | "coverage-gap"
        | "scan-invalidated"
        | "unsupported-record"
        | "store-corrupt"
    }>

export interface GarbageCollectFrameObjectRequestV2 {
  readonly first: DurableReferenceScanProofV2
  readonly second: DurableReferenceScanProofV2
}

export interface GarbageCollectFrameObjectAuthorizationV2 {
  readonly ref: FrameObjectRefV2
  readonly firstProofRecordDigest: DigestV2
  readonly secondProofRecordDigest: DigestV2
  readonly secondAcceptedHeadRecordDigest: DigestV2
  readonly secondReferenceIndexHeadRecordDigest: DigestV2
  readonly secondReferenceIndexRootRecordDigest: DigestV2
  readonly secondCoverageRecordDigest: DigestV2
  readonly [garbageCollectFrameObjectAuthorizationBrandV2]: true
}

export type GarbageCollectFrameObjectResultV2 =
  | Readonly<{
      status: "deleted"
      deletionRecordDigest: DigestV2
    }>
  | Readonly<{
      status: "not-deleted"
      code:
        | "reference-proof-stale"
        | "reference-proof-mismatch"
        | "reference-present"
        | "accepted-head-reachable"
        | "store-corrupt"
    }>

export interface DurableReferencePersistencePortV2 {
  scanDurableReferences(
    ref: FrameObjectRefV2,
    proofKind: "first-scan" | "second-scan",
    priorProofRecordDigest: DigestV2 | null,
  ): Promise<DurableReferenceScanPortResultV2>

  garbageCollectFrameObject(
    authorization: GarbageCollectFrameObjectAuthorizationV2,
  ): Promise<GarbageCollectFrameObjectResultV2>
}
```

Project/node writes and fsyncs the Project-native proof record and returns full
plain evidence. Kernel validates the request, proof kind, prior, ref, target,
accepted head, reference index, root, coverage, count and generations. The first
proof requires a null prior. The second requires the first proof digest, the same
ref and target, and strictly greater store and index generations. Both require a
durable reference count of `"0"` and no reachability from accepted head.

Kernel's private registry retains the full evidence while the public proof exposes
only the three diagnostic fields and brand. Kernel consumes two live proofs to mint
a one-shot GC authorization. Project/node reloads both native proof records by
digest, then rechecks the current accepted head, index head, root, coverage, all
eight source heads, zero references and unreachability before deletion. Structural
proofs, swapped order, cross-Kernel or post-restart proofs, repeated consumption or
any changed full-evidence field delete zero objects.

## 5. Three-record prospective-closure ledger and sole head

```ts
export interface RemoteIngressEvidenceMissingObjectV2 {
  readonly objectDigest: DigestV2
  readonly exactByteLength: Uint64V2
}

export type RemoteIngressEvidenceAdmissionLedgerStateV2 =
  | "started"
  | "completed"
  | "abandoned"

export interface RemoteIngressEvidenceAdmissionStartedRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-ledger-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveSignedOfferEvidenceClosureRecordDigest: DigestV2
  readonly prospectiveClosureExactByteLength: Uint64V2
  readonly priorLedgerRecordDigest: DigestV2 | null
  readonly state: "started"
  readonly admissionStartMissingObjects:
    readonly RemoteIngressEvidenceMissingObjectV2[]
  readonly newlyStoredEvidenceByteLength: Uint64V2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly signedOfferEvidenceClosureRecordDigest: null
}

export interface RemoteIngressEvidenceAdmissionCompletedRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-ledger-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveSignedOfferEvidenceClosureRecordDigest: DigestV2
  readonly prospectiveClosureExactByteLength: Uint64V2
  readonly priorLedgerRecordDigest: DigestV2
  readonly state: "completed"
  readonly admissionStartMissingObjects:
    readonly RemoteIngressEvidenceMissingObjectV2[]
  readonly newlyStoredEvidenceByteLength: Uint64V2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
}

export interface RemoteIngressEvidenceAdmissionAbandonedRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-ledger-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveSignedOfferEvidenceClosureRecordDigest: DigestV2
  readonly prospectiveClosureExactByteLength: Uint64V2
  readonly priorLedgerRecordDigest: DigestV2
  readonly state: "abandoned"
  readonly admissionStartMissingObjects:
    readonly RemoteIngressEvidenceMissingObjectV2[]
  readonly newlyStoredEvidenceByteLength: Uint64V2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly signedOfferEvidenceClosureRecordDigest: null
  readonly abandonmentReason:
    | "authorization-closed"
    | "caller-cancelled"
    | "evidence-capacity-exceeded"
}

export type RemoteIngressEvidenceAdmissionLedgerRecordV2 =
  | RemoteIngressEvidenceAdmissionStartedRecordV2
  | RemoteIngressEvidenceAdmissionCompletedRecordV2
  | RemoteIngressEvidenceAdmissionAbandonedRecordV2

export interface RemoteIngressEvidenceAdmissionLedgerHeadRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-ledger-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly generation: Uint32V2
  readonly priorLedgerHeadRecordDigest: DigestV2 | null
  readonly currentLedgerRecordDigest: DigestV2
  readonly currentManifestCoreDigest: DigestV2
  readonly currentProspectiveClosureRecordDigest: DigestV2
  readonly currentState: RemoteIngressEvidenceAdmissionLedgerStateV2
}

export interface BeginRemoteIngressEvidenceAdmissionRequestV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly expectedPriorLedgerHeadRecordDigest: DigestV2 | null
  readonly exactManifestCoreJcs: Readonly<Uint8Array>
  readonly prospectiveClosureRecordExactJcs: Readonly<Uint8Array>
  readonly admissionStartMissingObjects:
    readonly RemoteIngressEvidenceMissingObjectV2[]
}

export interface RemoteIngressEvidenceAdmissionStartedReceiptV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly startedLedgerRecordDigest: DigestV2
  readonly ledgerHeadRecordDigest: DigestV2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly [remoteIngressEvidenceAdmissionStartedReceiptBrandV2]: true
}

export interface SignedOfferEvidenceClosureObjectReceiptV2 {
  readonly closureRecordDigest: DigestV2
  readonly exactByteLength: Uint64V2
  readonly immutableObjectDigest: DigestV2
  readonly [signedOfferEvidenceClosureObjectReceiptBrandV2]: true
}

export interface RemoteIngressEvidenceAdmissionCompletedReceiptV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly manifestCoreDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly completedLedgerRecordDigest: DigestV2
  readonly ledgerHeadRecordDigest: DigestV2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly [remoteIngressEvidenceAdmissionCompletedReceiptBrandV2]: true
}
```

The exact accounting formulas are:

```text
newlyStoredEvidenceByteLength =
  sum(admissionStartMissingObjects[*].exactByteLength)

prospectiveClosureExactByteLength =
  JCSByteLength(prospectiveClosureRecordExactJcs)

accountedAdmissionByteLength =
  newlyStoredEvidenceByteLength +
  prospectiveClosureExactByteLength
```

Missing objects are unique, sorted by decoded digest bytes and have cardinality
`"0".."68"`. The prospective closure's `newlyStoredEvidenceByteLength` must equal
the formula. The started record and new sole head are fsynced and published by
stable-key CAS before any evidence-object write. A CAS loser rereads and writes no
object. The same manifest, prospective digest, closure length and missing set return
a fresh started or completed receipt; any difference forbids charge reuse.

A completed record's prior is the exact started record and its closure digest equals
the prospective digest. An abandoned record's prior is the exact started record and
requires the absence of reservation, payload, install, high-water, recovery, audit
and carrier roots. The only edges are `started -> completed` and
`started -> abandoned`; a different second manifest starts only after the prior
terminal head. Member and Project evidence quotas charge
`accountedAdmissionByteLength`. Ledger records and heads use Project-local record
digests and add no protocol digest domain.

## 6. Dedicated stale-head quarantine receipt

```ts
export interface HeadCommitQuarantineReceiptV2 {
  readonly ref: FrameObjectRefV2
  readonly journalRecordDigest: DigestV2
  readonly expectedAcceptedHeadRecordDigest: DigestV2
  readonly observedAcceptedHeadRecordDigest: DigestV2
  readonly quarantineCommitRecordDigest: DigestV2
  readonly shardDispositionHeadRecordDigest: DigestV2
  readonly [headCommitQuarantineReceiptBrandV2]: true
}

export type CompareAndCommitHeadResultV2 =
  | Readonly<{
      status: "committed"
      receipt: HeadCommitReceiptV2
    }>
  | Readonly<{
      status: "quarantined"
      receipt: HeadCommitQuarantineReceiptV2
    }>

export interface AcceptedHeadCommitPersistencePortV2 {
  compareAndCommitHead(
    journal: AcceptedJournalReceiptV2,
  ): Promise<CompareAndCommitHeadResultV2>
}
```

A CAS mismatch executes in one sole-writer critical section:

```text
accepted head remains unchanged
-> stale-head quarantine commit fsync
-> shard read-only disposition fsync
-> sole disposition-head CAS/fsync
-> mint HeadCommitQuarantineReceiptV2
```

Bare `"stale-head"` results, returning before quarantine and stale rebase all have
declaration count zero.

## 7. Reset, Blob and complete process-brand closure

```ts
export interface DocumentShardResetBaseReferencesV2<
  P extends
    | "reset-f13-initial"
    | "reset-f13-final"
    | "reset-f13-incoming",
> {
  readonly carrierDigest: DigestV2
  readonly phase: P
  readonly baseReferences: OwnerResolvedBaseReferencesV2<
    "project-index",
    P
  >
  readonly [documentShardResetBaseReferencesBrandV2]: true
}

export interface BlobTransferReservationReceiptV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly currentStagingHeadRecordDigest: DigestV2
  readonly chunkIndexRootRecordDigest: DigestV2
  readonly blobSha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly durableChunkCount: Uint32V2
  readonly durableByteLength: Uint64V2
  readonly [blobTransferReservationReceiptBrandV2]: true
}

export interface BlobTransferFinalizationReceiptV2 {
  readonly reservationRecordDigest: DigestV2
  readonly completeFinalizationRecordDigest: DigestV2
  readonly contentAddressedBlobObjectDigest: DigestV2
  readonly blobIndexRecordDigest: DigestV2
  readonly blobSha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly [blobTransferFinalizationReceiptBrandV2]: true
}
```

The complete process-only brand declaration set for this correction ABI is:

```ts
declare const canvasGenesisProofCarrierVerifierBrandV2: unique symbol
declare const canvasDocumentOwnerRuntimeBrandV2: unique symbol
declare const selectedCanvasDocumentOwnerArtifactFactoryBrandV2: unique symbol
declare const validatedResetAuthorizationCarrierViewBrandV2: unique symbol
declare const documentShardResetControlVerifierBundleBrandV2: unique symbol
declare const selectedDocumentShardResetControlArtifactFactoryBrandV2: unique symbol
declare const documentShardResetAuthorityVerifierBrandV2: unique symbol
declare const documentShardResetBaseReferencesBrandV2: unique symbol
declare const remoteIngressReservationReceiptBrandV2: unique symbol
declare const remoteIngressByteCursorBrandV2: unique symbol
declare const completedRemoteUpdateIngressBrandV2: unique symbol
declare const fullyValidatedRemoteIngressStagingBrandV2: unique symbol
declare const remoteImmutableIngressObjectReceiptBrandV2: unique symbol
declare const remoteNonFrameIngressOwnerInstallReceiptBrandV2: unique symbol
declare const remoteNonFrameIngressOwnerPortBrandV2: unique symbol
declare const selectedRemoteNonFrameIngressOwnerPortsBrandV2: unique symbol
declare const remoteNonFrameIngressOwnerPortFactoryBrandV2: unique symbol
declare const fullyValidatedLocalFrameBrandV2: unique symbol
declare const fullyValidatedIncomingFrameBrandV2: unique symbol
declare const localFrameObjectReceiptBrandV2: unique symbol
declare const localAuthoringOutboxReceiptBrandV2: unique symbol
declare const remotePendingInboxReceiptBrandV2: unique symbol
declare const acceptedJournalReceiptBrandV2: unique symbol
declare const headCommitReceiptBrandV2: unique symbol
declare const headCommitQuarantineReceiptBrandV2: unique symbol
declare const blobTransferReservationReceiptBrandV2: unique symbol
declare const blobTransferFinalizationReceiptBrandV2: unique symbol
declare const remoteIngressEvidenceAdmissionStartedReceiptBrandV2: unique symbol
declare const remoteIngressEvidenceAdmissionCompletedReceiptBrandV2: unique symbol
declare const signedOfferEvidenceClosureObjectReceiptBrandV2: unique symbol
declare const durableReferenceScanProofBrandV2: unique symbol
declare const garbageCollectFrameObjectAuthorizationBrandV2: unique symbol
declare const remoteDependencyCarrierDurableReceiptBrandV2: unique symbol
```

Each brand is created only by its owning module, and each capability enters that
module's private live registry. Receipts, cursors, proofs and authorizations have a
fresh, consumed, disposed or abandoned state. Brand values have no JSON, JCS,
structured-clone, IPC, persistence, serializer or public constructor. Plain records
and plain port evidence are unbranded and no authority entry accepts them as a
capability.

## 8. COW B+tree internal capacity 96

```text
leaf maximum: 128
non-root leaf minimum: 64
root leaf occupancy: 1..128
leaf overflow 129 split: 64/65

internal maximum: 96
non-root internal minimum: 48
root internal occupancy: 2..96
internal overflow 97 split: 48/49
```

Deletion borrows left when the left sibling exceeds its kind-specific minimum,
otherwise borrows right when the right sibling exceeds that minimum, otherwise
merges into the left sibling when one exists, otherwise merges with the right
sibling, and collapses a one-child root. Internal capacity 128 and non-root internal
minimum 64 have declaration count zero. The maximum 96-child internal restricted
JCS is at most 65,536 bytes.

## 9. URI four-form canonical grammar

Only these four forms are canonical:

```text
convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>

convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>?path=<canonical-display-hint>

convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>?blob=sha256%3A<64-lowercase-hex-digest>

convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>?blob=sha256%3A<64-lowercase-hex-digest>&path=<canonical-display-hint>
```

When both are present, `blob` precedes `path`. The colon is always uppercase `%3A`.
Path-before-blob, lowercase `%3a`, raw colon, duplicate keys, unknown keys, empty
keys and inputs beginning with `&blob` are rejected. Entry comparison ignores blob
and path; entry-revision comparison includes blob and ignores path; canonical-string
comparison compares all canonical bytes. A URI is not a ProjectFileId,
authorization or resolution capability.

## 10. Existing per-kind limits and bounded owner validation

The factory's private binding references the exact selected authority's existing
limit identity. Public definitions and ports contain no caller-selected maximum.

| Kind | Exact existing limit source |
| --- | --- |
| causal-frame | Kernel complete causal-envelope limit and section limits |
| checkpoint | Control `checkpointSnapshotBytes` |
| validation-suffix | Control `validationSuffixBytes`; every frame also uses Kernel causal-frame limits |
| registry-page | restricted-JCS/control-object limit |
| causal-frontier | causal-frontier head-count and restricted-JCS limit |
| actor-head-set | actor-head count and restricted-JCS limit |
| state-vector | Kernel state-vector byte limit |
| CGP | `canvasGenesisProofCarrierBytes`, CGP section-count and section limits |
| RSA | `documentShardResetAuthorizationCarrierBytes`, RSA section-count and section limits |

The factory wrapper checks manifest length before creating a cursor or owner scratch.
The generic ingress maximum bounds disk staging only and never authorizes a
contiguous owner allocation. Validation suffixes are processed and released one
frame at a time. Registry, frontier and actor-head-set use bounded restricted-JCS
parsers. State vectors use a bounded state-vector codec. A checkpoint materializes
only the snapshot permitted by the existing checkpoint limit; isolated Y.Doc and
parent working sets use existing working-set limits. CGP/RSA first parse a bounded
prelude/index and then read one section at a time while retaining only that section
and existing-limit scratch. Causal frames retain Kernel envelope/section limits.
Every owner callback closes the cursor and destroys scratch/Y.Doc on return, throw,
pending, reject or cancel. This correction ABI introduces no causal-frame,
non-frame or generic-owner numeric limit field.

## 11. Exact owner/count and falsifiers

Exactly one declaration:

- Kernel: nine-kind ingress, completed capability, cursor, validated capability,
  immutable receipt, owner factory, selected ports, owner-install receipt, full
  scan evidence, minimal proof, GC authorization and stale-head result.
- Project collaboration-protocol: Peer/Control DTOs, signed evidence, Control reset
  bundle/factory and registry/RSA owner implementations.
- Canvas: CGP verifier/runtime/factory and CGP owner implementation.
- Project/node: staging records, immutable promotion, three ledger records and sole
  head, Blob records, COW records, native proof records, quarantine records and
  private carrier receipt.
- Desktop: composition only; all related declaration counts are zero.

Zero declarations:

```text
@convax/collaboration/control
unbranded selected owner-port composition
public owner-port constructor
ambient owner-port factory
Project-native scan record in Kernel public proof
plain evidence accepted as capability
raw full-transfer bytes promotion
putImmutableRemoteFrame exact-bytes overload
readAll ingress API
immutable-object receipt ACK
carrier owner-install receipt direct ACK
naked stale-head result
single nullable evidence-ledger record
internal capacity 128
optional-bracket URI canonical grammar
caller-selected owner memory limit
new causal-frame or non-frame numeric limit
```

Mandatory falsifiers:

1. A clean external pack of collaboration resolves only external `yjs`; any Canvas
   or Project import fails.
2. Replacing one port, factory, authority identity, protocol digest or artifact
   digest makes selected owner-set creation fail.
3. For each of the nine kinds, reserve, chunk, crash, complete, validate, immutable
   promotion and terminal path perform no complete-transfer allocation.
4. Each non-frame kind calls only its selected owner validate/install once and the
   other seven owners zero times.
5. An immutable receipt cannot produce any ACK.
6. A causal frame cannot produce a Replica ACK before journal/head commit.
7. A checkpoint cannot produce a Replica ACK before its owner-install receipt.
8. A cache kind cannot produce null ACK before its owner-install receipt.
9. A carrier cannot produce null ACK before consuming the Project-private receipt.
10. Swapped, cloned, restarted, disposed or replayed brand capabilities invoke no
    authority.
11. Removing any full-scan evidence field, swapping or reusing proofs, not
    increasing a generation, or changing accepted head, index, root or coverage
    deletes zero objects.
12. Crash injection after ledger start at every object, closure and head barrier
    preserves missing set, prospective digest, closure length and charge.
13. The same manifest with a changed prospective closure or missing length loses
    CAS and writes zero objects.
14. A crash at every stale-head quarantine barrier restores only the same read-only
    quarantine and returns no bare stale result.
15. Random B+tree operations cover the 96/48 boundary, 97 split, borrow, merge and
    root collapse; every page remains at most 65,536 bytes.
16. Only four URI canonical byte forms round-trip; all other key orders and encodings
    reject.
17. Per-kind instrumentation shows peak cursor bytes, live cursor count and owner
    live allocation within the selected existing limit and at most one live cursor.
18. Source, built and packed declaration owner/count are identical.

## Unconditional architecture-owner vote

The collaboration Kernel/Control owner unconditionally votes `APPROVE` for the
R5.5 unique correction ABI above.
