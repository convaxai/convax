# Collaboration v10 R5.4 freeze candidate

Status: root-formatted architecture review input. This file is not active authority,
is not an implementation plan, and grants no execution permission. Architecture
content is owned by the three architecture reviewers. Root only composes their
decisions, distributes the exact bytes, and performs mechanical checks.

Promotion requires all three reviewers to sign the same ordinary SHA-256 of this
file without condition. A rejection invalidates this candidate identity. The next
candidate must be a new file and hash.

## 1. Closed ownership and scalar rules

- `@convax/canvas` solely owns `CVXCGP02`, Canvas genesis proof semantics,
  `ValidatedCanvasGenesisIdentityV2`, the Canvas verifier, branded Canvas runtime,
  and selected Canvas artifact factory.
- `@convax/collaboration/control` solely owns `CVXRSA02`, Peer wire DTOs, signed
  offer evidence, the reset carrier authenticity view and pure Control predicate.
- `@convax/collaboration` solely owns the accepted/working/candidate Kernel,
  update-ingress contract, accepted object/inbox/journal/head barriers, session
  undo coordination, reference proof capability and GC request/result contract.
- `@convax/project` solely owns ProjectIndex route/candidate/currentness
  composition. `@convax/project/node` is the sole native writer and owns private
  Project records, Blob persistence, evidence-admission ledger and dependency
  carrier durable receipt.
- `@convax/desktop` only selects exact artifacts and wires explicit ports. It owns
  no schema, mutation, reset, evidence, receipt or persistence authority.
- Portable `Uint32V2` and `Uint64V2` are canonical unsigned decimal strings.
  Leading zeroes other than `"0"`, signs, overflow and JSON numbers reject before
  digesting or allocation. Bounded conversion to a machine number is local-only.

Runtime, verifier, bundle, validated view, phase, permit, witness and receipt values
are frozen process identities. They have no JCS, JSON, IPC, structured-clone,
persistence or public-constructor form. TypeScript `readonly` and structural shape
are never sufficient authority.

## 2. Canvas genesis proof and reset composition

### 2.1 Closed capacities

| Value | Closed limit |
| --- | ---: |
| complete `CVXCGP02` | `1..83886080` bytes |
| complete `CVXRSA02` | `1..100663296` bytes |
| each reset/control exact JCS object | `1..65536` bytes |
| typed intent exact JCS | `1..524288` bytes |
| causal context exact JCS | `1..65536` bytes |
| state vector | `1..65536` bytes |
| ProjectIndex candidate full update | `1..33554432` bytes |
| ProjectIndex candidate canonical state | `1..33554432` bytes |
| current replica full update | `1..33554432` bytes |
| current replica canonical state | `1..33554432` bytes |
| proposal plus parent snapshot live working set | at most `268435456` bytes |
| CGP validation-artifact sections | `4..64` |
| CGP total sections | `12..72` |
| RSA floor-page sections | `0..8` |
| RSA total sections | `12..20` |

Outer length, index, count, offsets, checked sums, sorting, non-overlap and caps are
validated before section allocation, Y.Doc creation or JCS parsing. Unknown section
kinds, duplicates, gaps, overflow and trailing bytes reject. Missing exact selected
validation artifacts return pending; no older artifact or fallback validator runs.

`convax.canvas-genesis-proof-carrier/2` is a carrier format literal, not a digest
domain. Complete CGP bytes use ordinary SHA-256. The complete RSA carrier uses the
registered `convax.document-shard-reset-authorization-carrier/2` domain. Every
section SHA is ordinary SHA-256 over exact bytes.

### 2.2 Canvas-owned runtime ABI

```ts
declare const canvasDocumentOwnerRuntimeBrandV2: unique symbol

export interface CanvasGenesisProofCarrierVerifierV2 {
  readonly protocolDigest: DigestV2
  readonly protocolPort: DocumentOwnerProtocolPortV2<"canvas">

  verifyCanvasGenesisProofCarrierV2(
    exactCarrierBytes: Readonly<Uint8Array>,
  ): CanvasGenesisProofCarrierVerificationResultV2
}

export type CanvasGenesisProofCarrierVerificationResultV2 =
  | {
      readonly status: "validated"
      readonly value: ValidatedCanvasGenesisIdentityV2
    }
  | {
      readonly status: "pending"
      readonly code: "canvas-genesis-validation-artifact-pending"
    }
  | {
      readonly status: "rejected"
      readonly code: "canvas-genesis-proof-invalid"
    }

export interface CanvasDocumentOwnerRuntimeV2
  extends DocumentOwnerRuntimeV2<"canvas"> {
  readonly protocolDigest: DigestV2
  readonly genesisProofVerifier: CanvasGenesisProofCarrierVerifierV2
  readonly [canvasDocumentOwnerRuntimeBrandV2]: true
}

export interface SelectedCanvasDocumentOwnerArtifactFactoryV2
  extends SelectedDocumentOwnerArtifactFactoryV2<"canvas"> {
  createRuntime(): CanvasDocumentOwnerRuntimeV2
}
```

One selected Canvas artifact creates exactly one recursively frozen live runtime.
Composition requires exact identity:

```ts
runtime.closurePort.protocolPort === runtime.protocolPort
runtime.genesisProofVerifier.protocolPort === runtime.protocolPort
runtime.genesisProofVerifier.protocolDigest === runtime.protocolDigest
runtime.protocolPort.owner === "canvas"
```

The verifier copies input bytes, validates the complete carrier/index/sections and
exact artifact identities, validates checkpoint object/update/state-vector and
canonical Canvas state bindings, applies the checkpoint update to an isolated
temporary Y.Doc, verifies resulting state/vector/schema/scope and Canvas genesis
invariants, then mints the sole process-only validated identity. The temporary
Y.Doc is destroyed on validated, pending, rejected, thrown and cancelled exits.

### 2.3 Control-owned reset ABI

```ts
declare const validatedResetAuthorizationCarrierViewBrandV2: unique symbol
declare const documentShardResetControlVerifierBundleBrandV2: unique symbol

export interface DocumentShardResetCurrentAuthorityBytesV2 {
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

export type DocumentShardResetBindingFailureV2 =
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

export interface ValidatedDocumentShardResetAuthorizationCarrierViewV2 {
  readonly carrierDigest: DigestV2
  readonly index: Readonly<DocumentShardResetAuthorizationCarrierIndexV2>
  copyExactCanvasGenesisProofCarrierBytesV2(): Readonly<Uint8Array>
  readonly [validatedResetAuthorizationCarrierViewBrandV2]: true
}

export type ValidateDocumentShardResetAuthorizationCarrierResultV2 =
  | {
      readonly status: "validated"
      readonly value: ValidatedDocumentShardResetAuthorizationCarrierViewV2
    }
  | {
      readonly status: "rejected"
      readonly code: "reset-authorization-carrier-invalid"
    }

export interface VerifyDocumentShardResetControlPredicateInputV2 {
  readonly claim: DocumentShardResetClaimExactJcsV2
  readonly confirmation: DocumentShardResetConfirmationExactJcsV2
  readonly approval: DocumentShardResetApprovalExactJcsV2
  readonly routeCas: DocumentShardResetRouteCasCoreExactJcsV2
  readonly resetCommit: CanvasRouteResetCommitExactJcsV2
  readonly carrier: ValidatedDocumentShardResetAuthorizationCarrierViewV2
  readonly currentAuthority: DocumentShardResetCurrentAuthorityBytesV2
}

export type VerifyDocumentShardResetControlPredicateResultV2 =
  | { readonly status: "verified" }
  | {
      readonly status: "rejected"
      readonly code: DocumentShardResetBindingFailureV2
    }

export interface DocumentShardResetControlVerifierBundleV2 {
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2

  validateDocumentShardResetAuthorizationCarrierV2(
    exactCarrierBytes: Readonly<Uint8Array>,
  ): ValidateDocumentShardResetAuthorizationCarrierResultV2

  verifyDocumentShardResetAuthorityPredicateV2(
    input: VerifyDocumentShardResetControlPredicateInputV2,
  ): VerifyDocumentShardResetControlPredicateResultV2

  readonly [documentShardResetControlVerifierBundleBrandV2]: true
}

export interface SelectedDocumentShardResetControlArtifactFactoryV2 {
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  createVerifierBundle(): DocumentShardResetControlVerifierBundleV2
}
```

The selected Control factory creates exactly one recursively frozen bundle and
requires factory-to-bundle equality for all three identities. Canvas and Control
compare only `protocolDigest`; their owner schema and artifact-set digests are not
cross-compared. Short methods `validateCarrier`, `verifyAuthorityPredicate`,
`createBundle`, ambient bundle lookup and independently injected validator
functions have declaration count zero.

The validated view is repeatable authenticity evidence, not an affine permit. Each
CGP copy returns a fresh backing buffer. Claimed credential, authorization,
reservation, membership, floor, live-scope, admin and trust bytes stay in
bundle-private immutable backing. The same bundle alone may evaluate its view.
Cross-bundle views, structural clones, disposed views and unregistered views reject.

### 2.4 Project-owned composition ABI

```ts
export type DocumentShardResetCandidateBindingExactJcsV2 = ExactJcsInputBytesV2

export interface DocumentShardResetCandidateBindingV2 {
  readonly scope: DocumentScopeV2 & {
    readonly docKind: "project-index"
    readonly docId: "project-index"
  }
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

export interface DocumentShardResetBaseReferencesV2<
  P extends "reset-f13-initial" | "reset-f13-final" | "reset-f13-incoming",
> {
  readonly carrierDigest: DigestV2
  readonly phase: P
  readonly baseReferences: OwnerResolvedBaseReferencesV2<"project-index", P>
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
  readonly currentStagedGenesisCheckpointObjectDigest: DigestV2
  readonly currentStagedGenesisFullUpdateDigest: DigestV2
  readonly currentStagedGenesisStateVectorDigest: DigestV2
  readonly currentStagedResetAuthorizationCarrierDigest: DigestV2
}

export interface VerifyDocumentShardResetAuthorityInputV2 {
  readonly claim: DocumentShardResetClaimExactJcsV2
  readonly confirmation: DocumentShardResetConfirmationExactJcsV2
  readonly approval: DocumentShardResetApprovalExactJcsV2
  readonly routeCas: DocumentShardResetRouteCasCoreExactJcsV2
  readonly resetCommit: CanvasRouteResetCommitExactJcsV2
  readonly dependencies: Readonly<{
    readonly resetAuthorizationCarrier: Readonly<Uint8Array>
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

export type VerifyDocumentShardResetAuthorityResultV2 =
  | { readonly status: "verified" }
  | {
      readonly status: "pending"
      readonly code: "reset-authority-dependency-pending"
    }
  | {
      readonly status: "rejected"
      readonly code: DocumentShardResetBindingFailureV2
    }

export interface DocumentShardResetCompositePortsV2 {
  readonly control: DocumentShardResetControlVerifierBundleV2
  readonly canvasRuntime: CanvasDocumentOwnerRuntimeV2
}

export interface DocumentShardResetAuthorityVerifierV2 {
  verify(
    input: VerifyDocumentShardResetAuthorityInputV2,
  ): VerifyDocumentShardResetAuthorityResultV2
}

export declare function createDocumentShardResetAuthorityVerifierV2(
  ports: DocumentShardResetCompositePortsV2,
): DocumentShardResetAuthorityVerifierV2
```

The input has exactly twelve required top-level fields. `dependencies` has exactly
one key. `currentAuthority` has exactly eleven groups. `currentRouteFacts` has
exactly twelve fields. Composition captures only the explicit Control bundle and
Canvas runtime. It has no resolver, loader, registry callback, ambient default or
single-argument free verifier.

### 2.5 F13 and reset order

One synchronous deterministic F13 call performs this first-failure sequence:

1. Validate the closed 12-field input, copy bytes, enforce caps and canonical JCS.
2. Call `validateDocumentShardResetAuthorizationCarrierV2` exactly once.
3. Copy CGP bytes once and call `verifyCanvasGenesisProofCarrierV2` exactly once.
4. Before reading F, compare C index, Canvas identity, five reset DTOs, scope,
   project/canvas/shard identities, G, checkpoint digests, protocol and predecessor
   F hint. Any mismatch reads F zero times.
5. Validate the fresh phase and consume exactly the required set `{F}` once.
6. Validate exact F frame bytes, causal/write/post evidence, selected predecessor,
   owner schema, protocol, installed artifacts/floors and signer authority.
7. Validate candidate binding/facts and current replica head against the same
   unmodified clone and recompute every update/vector/canonical digest.
8. Consume all twelve current-route facts and require the staged carrier digest to
   equal both the reset commit digest and validated carrier digest.
9. Call `verifyDocumentShardResetAuthorityPredicateV2` exactly once with the same
   view and fresh current authority.
10. Reassert consumed set `{F}`, destroy scratch values, and only then return
    `verified`.

The result is diagnostic and cannot enter a reducer. Local reset order is:

```text
latest accepted ProjectIndex replicaDoc
-> freeze exact base {F}
-> clone one isolated unmodified candidateDoc
-> discovery consumes exactly {F}
-> acquire Project-private current-authority witness lease
-> A1
-> fresh initial authority/head/12 route facts
-> initial F13 consumes exactly {F}
-> A2
-> issue and move one affine reset permit to consuming
-> A3
-> distinct fresh final authority/head/12 route facts
-> final F13 consumes exactly {F}
-> A4
-> consume permit and synchronously enter one ProjectIndex reducer
-> apply phase consumes exactly {F}
-> one typed reset intent in one Yjs transaction
-> compare all four F ledgers and bytes
-> validate post state/evidence
-> object, outbox or inbox, journal and accepted-head durability barriers
```

No mutation occurs before final verification. There is no await, callback or lock
release between A4, permit consume and reducer entry. Pending, rejection,
cancellation and exception discard candidate and phases and restart from the latest
accepted base. Incoming/recovery uses an fsynced inert carrier stage, one fresh
incoming F13 phase and a distinct apply phase. Below-head recovery never replays a
business command.

## 3. Kernel update ingress and accepted durability

### 3.1 Closed geometry and identities

```ts
export type OrdinarySha256V2 = DigestV2

export const UPDATE_INGRESS_BYTE_LENGTH_MAX_V2: Uint64V2 = "1073741824"
export const UPDATE_INGRESS_CHUNK_COUNT_MAX_V2: Uint32V2 = "4096"

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

export type UpdateIngressChunkBytesV2 =
  | "4096"
  | "8192"
  | "16384"
  | "32768"
  | "65536"
  | "131072"
  | "262144"

export interface StableRemoteTransferKeyV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly transferId: Id128V2
}

export interface FrameObjectRefV2 {
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly operationId: Id128V2
}

export interface AcceptedHeadViewV2 {
  readonly scope: DocumentScopeV2
  readonly headRecordDigest: DigestV2
  readonly frontier: CausalFrontierV2
  readonly frontierDigest: DigestV2
  readonly actorHeads: ReplicaActorHeadSetV2
  readonly actorHeadsDigest: DigestV2
  readonly fullUpdate: Readonly<Uint8Array>
  readonly fullUpdateDigest: DigestV2
  readonly stateVector: StateVectorV2
  readonly stateVectorDigest: DigestV2
  readonly canonicalStateDigest: DigestV2
}
```

Update byte length is `"1".."1073741824"`. Chunk count is
`ceil(byteLength/chunkBytes)` and `"1".."4096"`. Each non-final chunk exactly
equals the selected chunk size; the final chunk is the positive remainder.
`registry-page` alone has null scope. The other eight kinds require non-null scope;
CGP uses Canvas scope and RSA uses ProjectIndex scope. `project-blob` never calls
this ingress path.

### 3.2 Validation capabilities and durable receipts

```ts
declare const fullyValidatedLocalFrameBrandV2: unique symbol
declare const fullyValidatedIncomingFrameBrandV2: unique symbol
declare const collaborationPersistenceReceiptBrandV2: unique symbol

export interface FullyValidatedLocalFrameV2 {
  readonly ref: FrameObjectRefV2
  readonly expectedAcceptedHeadRecordDigest: DigestV2
  readonly resultingFrontierDigest: DigestV2
  readonly resultingActorHeadsDigest: DigestV2
  readonly resultingFullUpdateDigest: DigestV2
  readonly resultingStateVectorDigest: DigestV2
  readonly resultingCanonicalStateDigest: DigestV2
  readonly exactEnvelopeSha256: OrdinarySha256V2
  readonly exactEnvelopeByteLength: Uint64V2
  readonly [fullyValidatedLocalFrameBrandV2]: true
}

export interface LocalFrameObjectReceiptV2 {
  readonly ref: FrameObjectRefV2
  readonly frameObjectDigest: DigestV2
  readonly exactEnvelopeSha256: OrdinarySha256V2
  readonly exactEnvelopeByteLength: Uint64V2
  readonly expectedAcceptedHeadRecordDigest: DigestV2
  readonly resultingFrontierDigest: DigestV2
  readonly resultingActorHeadsDigest: DigestV2
  readonly resultingFullUpdateDigest: DigestV2
  readonly resultingStateVectorDigest: DigestV2
  readonly resultingCanonicalStateDigest: DigestV2
  readonly [collaborationPersistenceReceiptBrandV2]: "local-frame-object"
}

export interface LocalAuthoringOutboxReceiptV2 {
  readonly ref: FrameObjectRefV2
  readonly frameObjectDigest: DigestV2
  readonly outboxRecordDigest: DigestV2
  readonly expectedAcceptedHeadRecordDigest: DigestV2
  readonly resultingFrontierDigest: DigestV2
  readonly resultingActorHeadsDigest: DigestV2
  readonly resultingFullUpdateDigest: DigestV2
  readonly resultingStateVectorDigest: DigestV2
  readonly resultingCanonicalStateDigest: DigestV2
  readonly [collaborationPersistenceReceiptBrandV2]: "local-authoring-outbox"
}

export interface RemoteIngressReservationRequestV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly exactManifestCoreJcs: Readonly<Uint8Array>
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly kind: RemoteUpdateIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly declaredByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
}

export interface RemoteIngressReservationRecordV2 {
  readonly format: "convax.remote-ingress-reservation-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly exactManifestObjectDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly kind: RemoteUpdateIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly declaredByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
}

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
  readonly [collaborationPersistenceReceiptBrandV2]: "remote-update-reservation"
}

export interface RemoteIngressStagingChunkV2 {
  readonly chunkIndex: Uint32V2
  readonly byteOffset: Uint64V2
  readonly exactChunkSha256: OrdinarySha256V2
  readonly exactChunkBytes: Readonly<Uint8Array>
}

export interface RemoteIngressChunkObjectRecordV2 {
  readonly format: "convax.remote-ingress-chunk-object-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly reservationRecordDigest: DigestV2
  readonly priorStagingChunkRecordDigest: DigestV2 | null
  readonly chunkIndex: Uint32V2
  readonly byteOffset: Uint64V2
  readonly exactByteLength: Uint32V2
  readonly exactChunkSha256: OrdinarySha256V2
  readonly rawChunkObjectDigest: DigestV2
}

export interface RemoteIngressChunkSetHeadRecordV2 {
  readonly format: "convax.remote-ingress-chunk-set-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly reservationRecordDigest: DigestV2
  readonly generation: Uint32V2
  readonly priorChunkSetHeadRecordDigest: DigestV2 | null
  readonly lastStagingChunkRecordDigest: DigestV2 | null
  readonly durableChunkCount: Uint32V2
  readonly durableStagedByteLength: Uint64V2
  readonly durableChunkSetDigest: DigestV2
}

export interface RemoteFrameObjectReceiptV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly durableChunkSetDigest: DigestV2
  readonly ref: FrameObjectRefV2
  readonly frameObjectDigest: DigestV2
  readonly exactEnvelopeSha256: OrdinarySha256V2
  readonly exactEnvelopeByteLength: Uint64V2
  readonly [collaborationPersistenceReceiptBrandV2]: "remote-frame-object"
}

export interface RemotePendingInboxRefV2 extends FrameObjectRefV2 {
  readonly reservationRecordDigest: DigestV2
  readonly frameObjectDigest: DigestV2
  readonly exactEnvelopeByteLength: Uint64V2
  readonly sourceMemberId: MemberIdV2
}

export interface RemotePendingInboxReceiptV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly ref: RemotePendingInboxRefV2
  readonly pendingInboxRecordDigest: DigestV2
  readonly [collaborationPersistenceReceiptBrandV2]: "remote-pending-inbox"
}

export interface FullyValidatedIncomingFrameV2 {
  readonly ref: FrameObjectRefV2
  readonly reservationRecordDigest: DigestV2
  readonly pendingInboxRecordDigest: DigestV2
  readonly frameObjectDigest: DigestV2
  readonly expectedAcceptedHeadRecordDigest: DigestV2
  readonly resultingFrontierDigest: DigestV2
  readonly resultingActorHeadsDigest: DigestV2
  readonly resultingFullUpdateDigest: DigestV2
  readonly resultingStateVectorDigest: DigestV2
  readonly resultingCanonicalStateDigest: DigestV2
  readonly exactEnvelopeSha256: OrdinarySha256V2
  readonly exactEnvelopeByteLength: Uint64V2
  readonly [fullyValidatedIncomingFrameBrandV2]: true
}

export type JournalAdmissionSourceV2 =
  | Readonly<{
      kind: "local-authoring-outbox"
      outboxRecordDigest: DigestV2
    }>
  | Readonly<{
      kind: "remote-pending-inbox"
      pendingInboxRecordDigest: DigestV2
      reservationRecordDigest: DigestV2
    }>

export interface AcceptedJournalReceiptV2 {
  readonly ref: FrameObjectRefV2
  readonly admissionSource: JournalAdmissionSourceV2
  readonly journalRecordDigest: DigestV2
  readonly expectedAcceptedHeadRecordDigest: DigestV2
  readonly resultingFrontierDigest: DigestV2
  readonly resultingActorHeadsDigest: DigestV2
  readonly resultingFullUpdateDigest: DigestV2
  readonly resultingStateVectorDigest: DigestV2
  readonly resultingCanonicalStateDigest: DigestV2
  readonly [collaborationPersistenceReceiptBrandV2]: "accepted-journal"
}

export interface HeadCommitReceiptV2 {
  readonly ref: FrameObjectRefV2
  readonly admissionSource: JournalAdmissionSourceV2
  readonly priorHeadRecordDigest: DigestV2
  readonly journalRecordDigest: DigestV2
  readonly acceptedHeadRecordDigest: DigestV2
  readonly resultingFrontierDigest: DigestV2
  readonly resultingActorHeadsDigest: DigestV2
  readonly resultingFullUpdateDigest: DigestV2
  readonly resultingStateVectorDigest: DigestV2
  readonly resultingCanonicalStateDigest: DigestV2
  readonly [collaborationPersistenceReceiptBrandV2]: "head-commit"
}
```

`exactManifestDigest` is exactly the manifest core digest.
`exactManifestObjectDigest` is exactly the Project-local immutable object digest of
the complete signed manifest wrapper. Request, manifest core, record and receipt
mirrors must be byte-equal. Receipts contain fixed-size head/root/set digests and
counts; they never inline chunk headers, chunk digests or bytes.

### 3.3 Results and port

```ts
export type RemoteIngressReserveResultV2 =
  | Readonly<{
      status: "reserved" | "exact-existing"
      receipt: RemoteIngressReservationReceiptV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "manifest-invalid"
        | "quota-exceeded"
        | "evidence-capacity-exceeded"
        | "transfer-manifest-equivocation"
        | "authorization-closed"
        | "store-corrupt"
    }>

export type RemoteUpdateChunkWriteResultV2 =
  | Readonly<{
      status: "advanced" | "exact-duplicate"
      receipt: RemoteIngressReservationReceiptV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-receipt"
        | "chunk-gap"
        | "chunk-overlap"
        | "chunk-geometry-invalid"
        | "chunk-hash-mismatch"
        | "capacity-exceeded"
        | "durability-failed"
        | "store-corrupt"
    }>

export type RemoteFrameObjectWriteResultV2 =
  | Readonly<{ status: "durable"; receipt: RemoteFrameObjectReceiptV2 }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-receipt"
        | "transfer-incomplete"
        | "length-mismatch"
        | "hash-mismatch"
        | "validation-rejected"
        | "durability-failed"
        | "store-corrupt"
    }>

export type RemotePendingInboxWriteResultV2 =
  | Readonly<{ status: "durable"; receipt: RemotePendingInboxReceiptV2 }>
  | Readonly<{
      status: "rejected"
      code: "stale-receipt" | "durability-failed" | "store-corrupt"
    }>

export type OperationLookupV2 =
  | Readonly<{ status: "absent" }>
  | Readonly<{
      status: "accepted"
      ref: FrameObjectRefV2
      admissionSource: JournalAdmissionSourceV2
      acceptedHeadRecordDigest: DigestV2
      exactEnvelopeBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "local-object-recovery"
      object: LocalFrameObjectReceiptV2
      exactEnvelopeBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "local-outbox-recovery"
      outbox: LocalAuthoringOutboxReceiptV2
      exactEnvelopeBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "local-journal-recovery"
      journal: AcceptedJournalReceiptV2
      exactEnvelopeBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "remote-object-recovery"
      object: RemoteFrameObjectReceiptV2
      exactEnvelopeBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "remote-inbox-recovery"
      inbox: RemotePendingInboxReceiptV2
      exactEnvelopeBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "remote-journal-recovery"
      journal: AcceptedJournalReceiptV2
      exactEnvelopeBytes: Readonly<Uint8Array>
    }>
  | Readonly<{
      status: "equivocation"
      lowerFrameDigest: DigestV2
      upperFrameDigest: DigestV2
    }>

export type AcceptedHeadReachabilityV2 =
  | Readonly<{ status: "reachable"; acceptedHeadRecordDigest: DigestV2 }>
  | Readonly<{ status: "unreachable"; acceptedHeadRecordDigest: DigestV2 }>
  | Readonly<{
      status: "incomplete"
      code: "missing-durable-object" | "unsupported-record" | "store-corrupt"
    }>

export type KernelQuarantineTargetV2 =
  | Readonly<{
      kind: "frame"
      ref: FrameObjectRefV2 | null
      frameObjectDigest: DigestV2
    }>
  | Readonly<{
      kind: "remote-ingress-reservation"
      reservationRecordDigest: DigestV2
    }>
  | Readonly<{
      kind: "remote-pending-inbox"
      pendingInboxRecordDigest: DigestV2
    }>
  | Readonly<{ kind: "accepted-journal"; journalRecordDigest: DigestV2 }>
  | Readonly<{ kind: "accepted-head"; headRecordDigest: DigestV2 }>

export type KernelQuarantineReasonV2 =
  | "equivocation"
  | "invalid-object"
  | "incomplete-durable-closure"
  | "below-head-unrecoverable"
  | "stale-head-corruption"

export interface KernelQuarantineReceiptV2 {
  readonly target: KernelQuarantineTargetV2
  readonly reason: KernelQuarantineReasonV2
  readonly quarantineRecordDigest: DigestV2
  readonly [collaborationPersistenceReceiptBrandV2]: "quarantine"
}

export interface CollaborationPersistencePortV2 {
  loadAcceptedHead(scope: DocumentScopeV2): Promise<AcceptedHeadViewV2>
  putImmutableLocalFrame(
    validated: FullyValidatedLocalFrameV2,
    exactEnvelopeBytes: Readonly<Uint8Array>,
  ): Promise<LocalFrameObjectReceiptV2>
  putReplicationOutboxRef(
    object: LocalFrameObjectReceiptV2,
  ): Promise<LocalAuthoringOutboxReceiptV2>
  appendAcceptedJournalFromOutbox(
    outbox: LocalAuthoringOutboxReceiptV2,
  ): Promise<AcceptedJournalReceiptV2>
  reserveRemoteIngress(
    request: RemoteIngressReservationRequestV2,
  ): Promise<RemoteIngressReserveResultV2>
  putRemoteStagingChunk(
    reservation: RemoteIngressReservationReceiptV2,
    chunk: RemoteIngressStagingChunkV2,
  ): Promise<RemoteUpdateChunkWriteResultV2>
  putImmutableRemoteFrame(
    reservation: RemoteIngressReservationReceiptV2,
    ref: FrameObjectRefV2,
    exactEnvelopeBytes: Readonly<Uint8Array>,
  ): Promise<RemoteFrameObjectWriteResultV2>
  putRemotePendingInboxRef(
    object: RemoteFrameObjectReceiptV2,
    ref: RemotePendingInboxRefV2,
  ): Promise<RemotePendingInboxWriteResultV2>
  appendAcceptedJournalFromInbox(
    validated: FullyValidatedIncomingFrameV2,
  ): Promise<AcceptedJournalReceiptV2>
  compareAndCommitHead(
    journal: AcceptedJournalReceiptV2,
  ): Promise<HeadCommitReceiptV2 | "stale-head">
  reachabilityFromAcceptedHead(
    ref: FrameObjectRefV2,
  ): Promise<AcceptedHeadReachabilityV2>
  lookupOperation(
    scope: DocumentScopeV2,
    actorId: ActorIdV2,
    operationId: Id128V2,
  ): Promise<OperationLookupV2>
  scanDurableReferences(
    ref: FrameObjectRefV2,
    proofKind: "first-scan" | "second-scan",
    priorProofRecordDigest: DigestV2 | null,
  ): Promise<DurableReferenceScanResultV2>
  garbageCollectFrameObject(
    request: GarbageCollectFrameObjectRequestV2,
  ): Promise<GarbageCollectFrameObjectResultV2>
  quarantineDurableTarget(
    target: KernelQuarantineTargetV2,
    reason: KernelQuarantineReasonV2,
  ): Promise<KernelQuarantineReceiptV2>
}
```

### 3.4 Chunk commitments and barriers

```text
chunkLeafDigest = SHA-256(
  UTF8("convax.remote-ingress-chunk-leaf/2") || 0x00 ||
  decoded(reservationRecordDigest) || u32be(chunkIndex) ||
  u64be(byteOffset) || u32be(exactByteLength) ||
  decoded(exactChunkSha256) || decoded(rawChunkObjectDigest))

chunkSetDigest_0 = SHA-256(
  UTF8("convax.remote-ingress-chunk-set/2") || 0x00 ||
  decoded(reservationRecordDigest) || u32be(0) || u64be(0))

chunkSetDigest_n_plus_1 = SHA-256(
  UTF8("convax.remote-ingress-chunk-set/2") || 0x00 ||
  decoded(chunkSetDigest_n) || decoded(chunkLeafDigest_n) ||
  u32be(n + 1) || u64be(cumulativeBytes_n_plus_1))
```

The two domains are registered. Each u32/u64 input is parsed from its canonical
decimal string first. Native JCS records use the Project-local record digest; raw
chunks are separate immutable objects.

Reservation order is exact manifest copy/digest/closure/quota validation, manifest
object fsync, reservation record fsync, genesis chunk-set head fsync, sole pointer
CAS/fsync, then fresh receipt. Append order is raw object fsync, chunk record fsync,
new head fsync, pointer CAS/fsync, consume old receipt, then mint replacement.
Exact duplicate is allowed only after reopening a fresh receipt and proving exact
header/hash/raw equality; it writes nothing. Gaps, overlap, unequal duplicate and
stale receipt cannot advance. Final object requires exact count, length, set digest
and streamed whole SHA.

Local admission is immutable frame, outbox, accepted journal, head CAS. Remote
admission is reservation/chunks, immutable exact envelope, pending inbox, fresh
full semantic validation, accepted journal, head CAS. Reopen remints only the exact
durable stage and never reruns an intent, changes operation identity or re-signs
bytes. A stale accepted-head CAS durably quarantines the inconsistent closure and
makes that shard read-only; it never rebases.

## 4. Independent Project Blob persistence

Blob transport is exclusively `channel="blob"`, `kind="project-blob"`, null scope.
It never calls update staging, never enters a causal journal, and never accepts or
returns an update receipt.

```ts
export type BlobChunkBytesV2 = "262144" | "524288" | "1048576"

export const PROJECT_BLOB_BYTE_LENGTH_MAX_V2: Uint64V2 = "17179869184"
export const BLOB_TRANSFER_CHUNK_COUNT_MAX_V2: Uint32V2 = "65536"
export const BLOB_CHUNK_INDEX_PAGE_ENTRIES_MAX_V2: Uint32V2 = "256"
export const BLOB_CHUNK_INDEX_PAGES_MAX_V2: Uint32V2 = "256"

export interface BlobTransferReservationRequestV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly exactManifestCoreJcs: Readonly<Uint8Array>
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly blobSha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly chunkBytes: BlobChunkBytesV2
  readonly chunkCount: Uint32V2
}

export interface BlobTransferReservationRecordV2 {
  readonly format: "convax.blob-transfer-reservation-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly exactManifestObjectDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly blobSha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly chunkBytes: BlobChunkBytesV2
  readonly chunkCount: Uint32V2
  readonly stagingObjectDigest: DigestV2
}

export interface BlobTransferChunkIndexEntryV2 {
  readonly chunkIndex: Uint32V2
  readonly byteOffset: Uint64V2
  readonly exactByteLength: Uint32V2
  readonly exactChunkSha256: OrdinarySha256V2
}

export interface BlobTransferChunkIndexPageRecordV2 {
  readonly format: "convax.blob-transfer-chunk-index-page-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly reservationRecordDigest: DigestV2
  readonly pageOrdinal: Uint32V2
  readonly entries: readonly BlobTransferChunkIndexEntryV2[]
}

export interface BlobTransferChunkIndexRootRecordV2 {
  readonly format: "convax.blob-transfer-chunk-index-root-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly reservationRecordDigest: DigestV2
  readonly orderedPageRecordDigests: readonly DigestV2[]
  readonly pageCount: Uint32V2
  readonly durableChunkCount: Uint32V2
  readonly durableByteLength: Uint64V2
}

export interface BlobTransferStagingHeadRecordV2 {
  readonly format: "convax.blob-transfer-staging-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly reservationRecordDigest: DigestV2
  readonly generation: Uint64V2
  readonly priorHeadRecordDigest: DigestV2 | null
  readonly chunkIndexRootRecordDigest: DigestV2
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
}

export interface BlobTransferPublishedIndexRecordV2 {
  readonly format: "convax.blob-transfer-published-index-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly blobSha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly contentAddressedBlobObjectDigest: DigestV2
}

export type BlobTransferFinalizationStageV2 =
  | "prepared"
  | "blob-published"
  | "index-published"
  | "complete"

export interface BlobTransferFinalizationRecordV2 {
  readonly format: "convax.blob-transfer-finalization-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly reservationRecordDigest: DigestV2
  readonly priorFinalizationRecordDigest: DigestV2 | null
  readonly stage: BlobTransferFinalizationStageV2
  readonly finalStagingHeadRecordDigest: DigestV2
  readonly chunkIndexRootRecordDigest: DigestV2
  readonly blobSha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly contentAddressedBlobObjectDigest: DigestV2 | null
  readonly blobIndexRecordDigest: DigestV2 | null
}

export interface BlobTransferFinalizationReceiptV2 {
  readonly reservationRecordDigest: DigestV2
  readonly completeFinalizationRecordDigest: DigestV2
  readonly contentAddressedBlobObjectDigest: DigestV2
  readonly blobIndexRecordDigest: DigestV2
  readonly blobSha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
}
```

Blob length is `"1".."17179869184"`; chunk count is exact ceiling and
`"1".."65536"`. Unknown chunk size is `manifest-invalid`. Resume requires the
same stable key, manifest, chunk size and count. A page contains `1..256` contiguous
entries; every non-final page has 256. The root contains `1..256` ordered page
digests. No JCS record embeds 65,536 entries or exceeds 65,536 bytes.

Each append verifies geometry and chunk SHA, writes at the preallocated exact
offset, fsyncs the staging file, COW-writes the page and root, CASes a next-generation
head, consumes the prior receipt and returns a fresh receipt. Duplicate semantics
match update ingress.

Finalization constraints are exact:

```text
prepared:       prior=null, contentAddressedBlobObjectDigest=null, blobIndexRecordDigest=null
blob-published: prior=digest(prepared), contentAddressedBlobObjectDigest!=null, blobIndexRecordDigest=null
index-published:prior=digest(blob-published), contentAddressedBlobObjectDigest!=null, blobIndexRecordDigest!=null
complete:       prior=digest(index-published), contentAddressedBlobObjectDigest!=null, blobIndexRecordDigest!=null
```

The writer validates all pages/root/count/length, streams full SHA from the staging
file, fsyncs `prepared`, publishes and fsyncs the same-filesystem content-addressed
blob and directory, fsyncs `blob-published`, writes/fsyncs the published index and
directory, fsyncs `index-published`, then fsyncs `complete`. Crash recovery resumes
the exact next phase. Only a complete receipt can authorize Blob durable ACK.

```ts
export type BlobTransferReserveResultV2 =
  | Readonly<{
      status: "reserved" | "exact-existing"
      receipt: BlobTransferReservationReceiptV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "manifest-invalid"
        | "quota-exceeded"
        | "evidence-capacity-exceeded"
        | "transfer-manifest-equivocation"
        | "authorization-closed"
        | "store-corrupt"
    }>

export type BlobChunkWriteResultV2 =
  | Readonly<{
      status: "advanced" | "exact-duplicate"
      receipt: BlobTransferReservationReceiptV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-receipt"
        | "chunk-gap"
        | "chunk-overlap"
        | "chunk-geometry-invalid"
        | "chunk-hash-mismatch"
        | "capacity-exceeded"
        | "durability-failed"
        | "store-corrupt"
    }>

export type BlobFinalizeResultV2 =
  | Readonly<{
      status: "complete"
      receipt: BlobTransferFinalizationReceiptV2
    }>
  | Readonly<{
      status: "rejected"
      code:
        | "stale-receipt"
        | "transfer-incomplete"
        | "length-mismatch"
        | "hash-mismatch"
        | "blob-index-failed"
        | "durability-failed"
        | "store-corrupt"
    }>

export type BlobTransferLookupV2 =
  | Readonly<{ status: "absent" }>
  | Readonly<{
      status: "staging"
      receipt: BlobTransferReservationReceiptV2
    }>
  | Readonly<{
      status: "finalizing"
      record: BlobTransferFinalizationRecordV2
      receipt: BlobTransferReservationReceiptV2
    }>
  | Readonly<{
      status: "complete"
      receipt: BlobTransferFinalizationReceiptV2
    }>
  | Readonly<{
      status: "equivocation"
      lowerManifestDigest: DigestV2
      upperManifestDigest: DigestV2
    }>

export interface BlobTransferPersistencePortV2 {
  reserveBlobTransfer(
    request: BlobTransferReservationRequestV2,
  ): Promise<BlobTransferReserveResultV2>
  putBlobStagingChunk(
    receipt: BlobTransferReservationReceiptV2,
    chunk: RemoteIngressStagingChunkV2,
  ): Promise<BlobChunkWriteResultV2>
  finalizeBlobTransfer(
    receipt: BlobTransferReservationReceiptV2,
  ): Promise<BlobFinalizeResultV2>
  lookupBlobTransfer(
    stableKey: StableRemoteTransferKeyV2,
    manifestDigest: DigestV2,
  ): Promise<BlobTransferLookupV2>
}
```

Partial staging may be cancelled only before `prepared`, with parent-directory fsync
and exact charge release. A published content-addressed blob never rolls back. An
incomplete finalization remains a recovery root. Blob staging and ProjectIndex blob
reference publication are deliberately separate transactions.

## 5. Project-native durable-reference COW B+tree

This index is a rebuildable deletion-safety projection, never Canvas or Project
semantic authority. A gap, corrupt page or incomplete source fold disables proof,
prune and deletion. It does not block ordinary edit, offline commit, replication or
recovery.

```ts
export type DurableReferenceKindV2 =
  | "accepted-head"
  | "accepted-journal"
  | "authoring-outbox"
  | "remote-pending-inbox"
  | "recovery"
  | "quarantine"
  | "checkpoint"
  | "resource-proof"

export interface DurableReferenceIndexKeyV2 {
  readonly targetRefDigest: DigestV2
  readonly referenceKind: DurableReferenceKindV2
  readonly sourceRecordDigest: DigestV2
}

export interface DurableReferenceIndexCoverageRecordV2 {
  readonly format: "convax.durable-reference-index-coverage-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly acceptedHeadDirectoryDigest: DigestV2
  readonly acceptedJournalLedgerHeadDigest: DigestV2
  readonly authoringOutboxLedgerHeadDigest: DigestV2
  readonly remotePendingInboxLedgerHeadDigest: DigestV2
  readonly recoveryLedgerHeadDigest: DigestV2
  readonly quarantineLedgerHeadDigest: DigestV2
  readonly checkpointLedgerHeadDigest: DigestV2
  readonly resourceProofLedgerHeadDigest: DigestV2
}

export interface DurableReferenceIndexLeafPageV2 {
  readonly format: "convax.durable-reference-index-leaf-page/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly height: "0"
  readonly entries: readonly DurableReferenceIndexKeyV2[]
  readonly subtreeEntryCount: Uint64V2
  readonly subtreeCommitment: DigestV2
}

export interface DurableReferenceIndexChildV2 {
  readonly firstKey: DurableReferenceIndexKeyV2
  readonly lastKey: DurableReferenceIndexKeyV2
  readonly childPageDigest: DigestV2
  readonly childSubtreeEntryCount: Uint64V2
  readonly childSubtreeCommitment: DigestV2
}

export interface DurableReferenceIndexInternalPageV2 {
  readonly format: "convax.durable-reference-index-internal-page/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly height: Uint32V2
  readonly children: readonly DurableReferenceIndexChildV2[]
  readonly subtreeEntryCount: Uint64V2
  readonly subtreeCommitment: DigestV2
}

export type DurableReferenceIndexPageV2 =
  | DurableReferenceIndexLeafPageV2
  | DurableReferenceIndexInternalPageV2

export interface DurableReferenceIndexRootRecordV2 {
  readonly format: "convax.durable-reference-index-root-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly rootPageDigest: DigestV2 | null
  readonly height: Uint32V2
  readonly entryCount: Uint64V2
  readonly indexCommitment: DigestV2
  readonly coverageRecordDigest: DigestV2
}

export type DurableReferenceIndexCommitOperationV2 =
  | Readonly<{ kind: "add"; key: DurableReferenceIndexKeyV2 }>
  | Readonly<{ kind: "remove"; key: DurableReferenceIndexKeyV2 }>
  | Readonly<{
      kind: "advance-coverage"
      expectedPriorCoverageRecordDigest: DigestV2
      resultingCoverageRecordDigest: DigestV2
      sourceInventoryDigest: DigestV2
    }>
  | Readonly<{
      kind: "complete-rebuild"
      sourceInventoryDigest: DigestV2
    }>
  | Readonly<{
      kind: "scan-fence"
      firstProofRecordDigest: DigestV2
    }>

export interface DurableReferenceIndexCommitRecordV2 {
  readonly format: "convax.durable-reference-index-commit-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly expectedPriorIndexHeadRecordDigest: DigestV2 | null
  readonly priorRootRecordDigest: DigestV2 | null
  readonly operation: DurableReferenceIndexCommitOperationV2
  readonly resultingRootRecordDigest: DigestV2
}

export interface DurableReferenceIndexHeadRecordV2 {
  readonly format: "convax.durable-reference-index-head-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly priorIndexHeadRecordDigest: DigestV2 | null
  readonly commitRecordDigest: DigestV2
  readonly rootRecordDigest: DigestV2
  readonly entryCount: Uint64V2
}
```

Kind byte codes are `00..07` in the declaration order. The sole key order is
unsigned-byte order of:

```text
keyBytes = decoded(targetRefDigest) || oneByteKindCode || decoded(sourceRecordDigest)
```

It is exactly 65 bytes. Digests are exact:

```text
targetRefDigest = SHA-256(
  UTF8("convax.frame-object-reference/2") || 0x00 ||
  UTF8(restrictedJCS(FrameObjectRefV2)))

referenceLeafDigest = SHA-256(
  UTF8("convax.durable-reference-leaf/2") || 0x00 || keyBytes)

targetReferenceSetDigest = SHA-256(
  UTF8("convax.target-reference-set/2") || 0x00 || u64be(count) ||
  concat(decoded(referenceLeafDigest) in unsigned-byte digest order))

sourceInventoryDigest = SHA-256(
  UTF8("convax.durable-reference-source-inventory/2") || 0x00 ||
  concat(decoded(the eight coverage digests in interface field order)))

leafCommitment = SHA-256(
  UTF8("convax.durable-reference-index-leaf-subtree/2") || 0x00 ||
  u64be(entryCount) || concat(keyBytes in tree order))

childBytes = keyBytes(firstKey) || keyBytes(lastKey) || decoded(childPageDigest) ||
  u64be(childSubtreeEntryCount) || decoded(childSubtreeCommitment)

internalCommitment = SHA-256(
  UTF8("convax.durable-reference-index-internal-subtree/2") || 0x00 ||
  u32be(height) || u64be(totalEntryCount) || concat(childBytes in child order))

emptyCommitment = SHA-256(
  UTF8("convax.durable-reference-index-empty/2") || 0x00 || u64be(0))
```

Every page/coverage/root/commit/head JCS is at most 65,536 bytes and uses the
Project-local record digest. Leaf capacity is 128. Internal height is canonical
`"1".."9"`; internal capacity is 128. Every non-root occupancy is 64..128. Root
leaf occupancy is 1..128; root internal occupancy is 2..128. Child height is parent
height minus one; child bounds and commitments must match actual children. The
non-empty root mirrors exact page height/count/commitment. The empty root is exactly:

```text
{rootPageDigest:null,height:"0",entryCount:"0",indexCommitment:emptyCommitment}
```

There is no live-entry cap below Uint64. Insertion overflow 129 splits 64/65.
Deletion underflow borrows left if possible, else right, then merges left if present,
else right. A one-child root collapses. Duplicate add and absent remove reject.

Head is the sole publication point. Add/remove updates pages/root. Coverage advance
changes no page/count/commitment. Scan fence changes neither root nor coverage and
binds exactly one first proof. Complete rebuild canonical-sorts and deduplicates the
authoritative eight-ledger fold; directory enumeration is not an input. Every source
has a non-null empty genesis head. Normal publication commits source state first,
all needed index deltas second, and one coverage advance last.

### 5.1 Proof and deletion authority

```ts
export interface DurableReferenceScanProofRecordV2 {
  readonly format: "convax.durable-reference-scan-proof-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly proofKind: "first-scan" | "second-scan"
  readonly priorProofRecordDigest: DigestV2 | null
  readonly ref: FrameObjectRefV2
  readonly targetRefDigest: DigestV2
  readonly scanAcceptedHeadRecordDigest: DigestV2
  readonly scanReferenceIndexHeadRecordDigest: DigestV2
  readonly scanReferenceIndexGeneration: Uint64V2
  readonly scanReferenceIndexRootRecordDigest: DigestV2
  readonly scanReferenceIndexRootPageDigest: DigestV2 | null
  readonly scanIndexCommitment: DigestV2
  readonly scanCoverageRecordDigest: DigestV2
  readonly targetReferenceSetDigest: DigestV2
  readonly durableReferenceCount: Uint64V2
  readonly reachableFromAcceptedHead: boolean
  readonly scanStoreGeneration: Uint64V2
}

declare const durableReferenceScanProofBrandV2: unique symbol

export interface DurableReferenceScanProofV2 {
  readonly record: Readonly<DurableReferenceScanProofRecordV2>
  readonly proofRecordDigest: DigestV2
  readonly [durableReferenceScanProofBrandV2]: true
}

export type DurableReferenceScanResultV2 =
  | Readonly<{ status: "complete"; proof: DurableReferenceScanProofV2 }>
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

export type GarbageCollectFrameObjectResultV2 =
  | Readonly<{ status: "deleted"; deletionRecordDigest: DigestV2 }>
  | Readonly<{
      status: "not-deleted"
      code:
        | "reference-proof-stale"
        | "reference-proof-mismatch"
        | "reference-present"
        | "accepted-head-reachable"
        | "store-corrupt"
    }>
```

First proof has null prior. The sole writer snapshots accepted head H, index
head/root/coverage R and all eight source heads, proves coverage, performs exact
target traversal and accepted-head reachability, writes/fsyncs the proof, then
rereads exact H/R/eight heads. Any mismatch mints no proof. Before the second scan,
one scan-fence bound to the first proof is published. The second proof names the
first, uses the same project/epoch/ref/target and has strictly greater store and
index generations.

Project/node alone mints registered process proofs. Durable proof bytes or a
structural clone cannot authorize deletion. GC consumes both proofs atomically,
rereads current H/index/root/coverage, requires exact equality with the second,
requires exact linkage, zero references and unreachable in both scans, writes and
fsyncs one logical deletion record, then removes the physical orphan. No wall clock
participates.

## 6. Signed offer evidence and crash-stable admission accounting

```ts
export interface PeerTransferOfferEvidenceCoreV2 {
  readonly format: "convax.peer-transfer-offer-evidence-core/2"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceReplicaId: ReplicaIdV2
  readonly sourceActorId: ActorIdV2
  readonly replicaActorCredentialCoreDigest: DigestV2
  readonly manifestCoreDigest: DigestV2
  readonly protocolDigest: DigestV2
}

export interface PeerTransferOfferEvidenceV2 {
  readonly format: "convax.peer-transfer-offer-evidence/2"
  readonly core: PeerTransferOfferEvidenceCoreV2
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}

export interface RemoteIngressSignedOfferEvidenceClosureRecordV2 {
  readonly format: "convax.remote-ingress-signed-offer-evidence-closure-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly manifestCoreDigest: DigestV2
  readonly manifestObjectDigest: DigestV2
  readonly offerEvidenceCoreDigest: DigestV2
  readonly offerEvidenceObjectDigest: DigestV2
  readonly memberCredentialObjectDigest: DigestV2
  readonly replicaActorCredentialObjectDigest: DigestV2
  readonly membershipSnapshotObjectDigest: DigestV2
  readonly cutoffEvidenceObjectDigest: DigestV2 | null
  readonly trustBundleObjectDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly authorityObjectCount: Uint32V2
  readonly newlyStoredEvidenceByteLength: Uint64V2
}

export interface RemoteIngressManifestEquivocationHighWaterRecordV2 {
  readonly format: "convax.remote-ingress-manifest-equivocation-high-water-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly lowerManifestCoreDigest: DigestV2
  readonly lowerSignedOfferEvidenceClosureRecordDigest: DigestV2
  readonly upperManifestCoreDigest: DigestV2
  readonly upperSignedOfferEvidenceClosureRecordDigest: DigestV2
}

export type RemoteIngressEvidenceAdmissionLedgerStateV2 =
  | "started"
  | "completed"
  | "abandoned"

export interface RemoteIngressEvidenceAdmissionLedgerRecordV2 {
  readonly format: "convax.remote-ingress-evidence-admission-ledger-record/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly manifestCoreDigest: DigestV2
  readonly priorLedgerRecordDigest: DigestV2 | null
  readonly state: RemoteIngressEvidenceAdmissionLedgerStateV2
  readonly admissionStartMissingObjectDigests: readonly DigestV2[]
  readonly accountedNewEvidenceByteLength: Uint64V2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2 | null
}
```

Evidence core digest and signature preimage are exact:

```text
coreDigest = SHA-256(
  UTF8("convax.peer-transfer-offer-evidence-core/2") || 0x00 ||
  UTF8(restrictedJCS(core)))

signaturePreimage =
  UTF8("convax.peer-transfer-offer-evidence-signature/2") || 0x00 ||
  decoded(coreDigest)
```

Both domains are registered. Evidence contains no connection/session/channel-open
identity, message sequence, wall clock, admission class or relay edit authorization.
The current signed session message separately proves connection freshness.

`authorityObjectCount` is the content-digest-deduplicated count of all immutable
authority objects reached by Control's bounded traversal from exactly these roots:
member credential, replica actor credential, membership snapshot, optional cutoff
evidence and trust bundle. Roots count; shared descendants count once. The canonical
count is `"4".."64"`. Manifest/evidence objects, payload, receiver-local validation
artifacts and closure record do not count.

At admission start, `newlyStoredEvidenceByteLength` freezes the deduplicated byte
sum of objects missing on this receiver from this exact set:

1. manifest core object;
2. signed manifest wrapper object named by `manifestObjectDigest`;
3. offer-evidence core object;
4. signed offer-evidence wrapper object;
5. all authority objects reached by the five-root traversal.

Existing digest-equal objects contribute zero. Payload, validation artifacts and
the closure record contribute zero. The per-closure byte gate is exact:

```text
parse(newlyStoredEvidenceByteLength) + JCSByteLength(closureRecord) <= 65536
```

Before writing any object, Project fsyncs and publishes a `started` ledger record.
Its missing digests are decoded-byte sorted, unique and at most 68. It freezes the
accounted byte length. A crash before closure fsync resumes the same ledger and the
same charge even if earlier writes have made some objects present. `completed` must
name an fsynced exact closure. `abandoned` must have null closure and is allowed only
when reservation, high-water, installed payload, recovery and audit roots are all
absent. The ledger is a Project-local record and adds no digest domain.

Closed evidence limits are:

```text
manifest wrapper JCS                         <= 16384 bytes
offer evidence core JCS                     <= 16384 bytes
offer evidence wrapper JCS                  <= 20480 bytes
evidence closure JCS                        <= 16384 bytes
new evidence plus closure                   <= 65536 bytes
closures per stable key                     <= 2
closures per source member / Project epoch  <= 512
closures per Project epoch                  <= 8192
evidence bytes per source member / epoch    <= 8388608
evidence bytes per Project epoch            <= 67108864
authority objects per closure               <= 64
validation artifacts                        4..64
```

Normal offer order is live handshake/message authentication, current membership and
cutoff/trust validation, stable evidence signature/mirror validation, missing-set
calculation, quota reservation plus `started` ledger fsync, immutable object fsync,
closure fsync, `completed` ledger fsync, reservation/head CAS, then transfer accept.

Same stable key and manifest reuses the exact ledger/closure/reservation/charge and
returns a fresh process receipt. A different manifest may reserve evidence-only
quota, persist a second fully verified ledger/closure, sort manifest digests by
decoded bytes, persist permanent high-water and emit equivocation NACK. It allocates
zero second payload. A third closure rejects before allocation. If evidence quota
cannot be reserved, capacity failure is returned and durable equivocation is not
claimed.

All ten kinds use authenticated current-member transport. Viewer and editor may
relay immutable bytes. Relay membership is never object authorship or edit
authorization. Causal frames validate embedded author authority; checkpoints,
caches and blobs validate their owner closures. CGP/RSA additionally require a
receiver-local exact current-editor-owned wanted root at offer, install and ACK.
A viewer cannot create wanted state, advance an operation, install unsolicited
carrier bytes, mint a permit or ACK.

## 7. Terminal Peer wire and ACK authority

```ts
export type DependencyCarrierTransferKindV2 =
  | "canvas-genesis-proof-carrier"
  | "document-shard-reset-authorization-carrier"

export type PeerTransferKindV2 =
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

export interface PeerTransferManifestCoreV2 {
  readonly format: "convax.peer-transfer-manifest-core/2"
  readonly transferId: Id128V2
  readonly channel: "update" | "blob"
  readonly kind: PeerTransferKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly byteLength: Uint64V2
  readonly sha256: OrdinarySha256V2
  readonly chunkBytes: Uint32V2
  readonly chunkCount: Uint32V2
  readonly compression: "none"
  readonly protocolDigest: DigestV2
}

export interface PeerTransferManifestV2 {
  readonly format: "convax.peer-transfer-manifest/2"
  readonly core: PeerTransferManifestCoreV2
  readonly coreDigest: DigestV2
}

export interface PeerTransferChunkHeaderV2 {
  readonly format: "convax.peer-transfer-chunk/2"
  readonly transferId: Id128V2
  readonly manifestDigest: DigestV2
  readonly chunkIndex: Uint32V2
  readonly byteOffset: Uint64V2
  readonly byteLength: Uint32V2
  readonly chunkSha256: OrdinarySha256V2
}

declare const remoteTransferAttemptBindingBrandV2: unique symbol

export interface RemoteTransferAttemptBindingV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly connectionId: Id128V2
  readonly manifestDigest: DigestV2
  readonly [remoteTransferAttemptBindingBrandV2]: true
}

export type PeerTransferErrorCodeV2 =
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
  | "transfer-attempt-stale"
  | "transfer-manifest-equivocation"
  | "dependency-not-requested"
  | "dependency-subject-conflict"

export type PeerObjectRequestBodyV2 =
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

export type PeerControlBodyV2 =
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "inventory-root"
      root: PeerInventoryRootV2
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "inventory-page"
      page: PeerInventoryPageV2
    }>
  | PeerObjectRequestBodyV2
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "blob-have-query"
      queryId: Id128V2
      blobs: readonly { blobSha256: DigestV2; byteLength: Uint64V2 }[]
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "blob-have-response"
      queryId: Id128V2
      have: readonly { blobSha256: DigestV2; byteLength: Uint64V2 }[]
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-offer"
      manifest: PeerTransferManifestV2
      evidence: PeerTransferOfferEvidenceV2
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-accept"
      transferId: Id128V2
      manifestDigest: DigestV2
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-ack"
      transferId: Id128V2
      manifestDigest: DigestV2
      durabilityProofDigest: DigestV2 | null
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-nack"
      transferId: Id128V2
      manifestDigest: DigestV2
      code: PeerTransferErrorCodeV2
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-cancel"
      transferId: Id128V2
      manifestDigest: DigestV2
      reason: "caller-cancelled" | "scope-closed" | "superseded" | "capacity"
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "authorization-notice"
      membershipSnapshotDigest: DigestV2
      authorizationMutationDigest: DigestV2
      cutoffCoverageRootCoreDigest: DigestV2 | null
    }>
```

The manifest core digest is the registered restricted-JCS digest. `connectionId`
is forbidden in manifest, evidence and durable records; it exists only in the live
signed message and process attempt. Chunk wire is
`u32be(headerJcsByteLength)||headerJcs||rawChunkBytes`; header JCS is at most 4096
bytes and repeats the live transfer/manifest identity.

Kind mapping is closed: Project Blob uses blob channel/null scope and the dedicated
Blob port; registry page uses update/null scope; the other update kinds use exact
non-null scopes. Control maps the nine non-blob wire kinds one-to-one to the Kernel
union. Kernel imports no Control type. Ordinary object requests have `1..256`
decoded-byte-sorted unique digests and no scope/subject. Carrier requests have no
digests and require an editor-owned wanted root on the receiver.

### 7.1 ACK contracts

```ts
export interface ReplicaDurableAckCoreV2 {
  readonly format: "convax.replica-durable-ack-core/2"
  readonly scope: DocumentScopeV2
  readonly frameOrCheckpointDigest: DigestV2
  readonly receiverMemberId: MemberIdV2
  readonly receiverReplicaId: ReplicaIdV2
  readonly receiverActorId: ActorIdV2
  readonly receiverAuthorizationDigest: DigestV2
  readonly receiverDurableHeadDigest: DigestV2
  readonly receiverFrontierDigest: DigestV2
  readonly protocolDigest: DigestV2
}

export interface ReplicaDurableAckV2 {
  readonly format: "convax.replica-durable-ack/2"
  readonly core: ReplicaDurableAckCoreV2
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}

export interface BlobDurableAckCoreV2 {
  readonly format: "convax.blob-durable-ack-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly fileId: ProjectFileIdV2
  readonly versionId: ProjectVersionIdV2
  readonly blobSha256: DigestV2
  readonly byteLength: Uint64V2
  readonly receiverMemberId: MemberIdV2
  readonly receiverReplicaId: ReplicaIdV2
  readonly receiverActorId: ActorIdV2
  readonly receiverAuthorizationDigest: DigestV2
  readonly protocolDigest: DigestV2
}

export interface BlobDurableAckV2 {
  readonly format: "convax.blob-durable-ack/2"
  readonly core: BlobDurableAckCoreV2
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}

// Control-owned transport reference and outbound port.
export interface RemoteDependencyCarrierRefV2 {
  readonly attempt: RemoteTransferAttemptBindingV2
  readonly kind: DependencyCarrierTransferKindV2
  readonly scope: DocumentScopeV2
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
}

export interface DependencyCarrierTransferAckOutboundPortV2 {
  enqueueDependencyCarrierTransferAck(
    input: Readonly<{
      attempt: RemoteTransferAttemptBindingV2
      durabilityProofDigest: null
    }>,
  ): "enqueued" | "connection-stale"
}

// Project/node-private. Control declaration count is zero.
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

ACK authority is exact:

- causal frame and checkpoint use `ReplicaDurableAckV2.coreDigest` only after
  semantic validation and object/journal/head durability;
- Project Blob uses `BlobDurableAckV2.coreDigest` only after complete Blob
  finalization and current binding recheck;
- validation suffix, registry page, causal frontier, actor-head set and state vector
  use null only after exact immutable bytes and their owner authority/index are
  durable;
- CGP/RSA use null only after Project consumes its private carrier receipt.

The Project receipt states are `issued -> consuming -> consumed|abandoned`. Under
the sole-writer queue, Project refolds the exact dependency-cache head, proves the
wanted root/install transaction/index/raw closure/quota/no conflict, moves the
receipt to consuming and synchronously invokes the outbound port without await,
callback or lock release. `enqueued` consumes it. Throw or `connection-stale`
abandons it and emits no ACK. Retry reauthenticates, refolds and mints a new receipt.

The wire ACK for a dependency carrier is exactly:

```ts
Readonly<{
  format: "convax.peer-control/2"
  kind: "transfer-ack"
  transferId: Id128V2
  manifestDigest: DigestV2
  durabilityProofDigest: null
}>
```

Null proves only that the dependency closure and index were durable at enqueue.
It does not prove current route or team replication.

The fourteen wire errors are closed. Native mapping is:

| Native result | Peer error |
| --- | --- |
| manifest or geometry invalid | `manifest-invalid` |
| Project/scope mirror mismatch | `scope-mismatch` |
| unsupported channel/kind | `unsupported-kind` |
| missing declared dependency | `dependency-missing` |
| quota/evidence/capacity exceeded | `capacity-exceeded` |
| chunk gap/overlap/geometry/hash | `chunk-invalid` |
| complete object hash mismatch | `hash-mismatch` |
| owner semantic rejection | `validation-rejected` |
| store/blob-index/durability failure | `durability-failed` |
| closed authorization | `authorization-closed` |
| stale live attempt | `transfer-attempt-stale` |
| stable-key manifest equivocation | `transfer-manifest-equivocation` |
| no exact wanted root | `dependency-not-requested` |
| committed unequal carrier | `dependency-subject-conflict` |

`stale-receipt` is internal: if the live attempt is current it maps to durability
failure; otherwise attempt stale. `connection-stale` is process-only and is never a
fifteenth wire code. Protocol digest mismatch closes before body decode and emits no
transfer-shaped response.

## 8. Global URI, Project identity and breaking reset non-regression

URI is a Convax-wide protocol, not a Canvas-private convention. `@convax/uri`
solely owns stateless five-component parsing, canonicalization and comparison:

```ts
export interface UriComponents {
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string
}
```

It owns no resolver, I/O, authorization, Project state, service locator or dynamic
scheme registry. Business owners resolve parsed identities through typed ports.
Plugins cannot register or override schemes.

The Project entry canonical form remains:

```text
convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>[?path=<display-hint>][&blob=sha256:<digest>]
```

`projectId + projectEpoch + entryId` is logical identity. `path` is a mutable display
and relink hint. `blob` pins an immutable content revision. Comparison requires an
explicit mode: `entry`, `entry-revision` or `canonical-string`. A plain path and a
plain URI string are never Project entry identity or authorization.

`ProjectFileId` is stable; rename/move does not change it. Managed assets and each
generation result are immutable and allocate a new file identity. Human-authored
Markdown/code conflicts preserve both results through a deterministic conflict copy;
they are not silently LWW-overwritten. ProjectIndex stores the current canonical
entry/blob projection. Canvas Yjs values hold one complete canonical URI/string or
immutable component value; id/path/blob are never independently writable fields.

Old path-only Project and old JSON Canvas bytes are not migrated or dual-read.
Open returns `UnsupportedPortableProjectVersion`; UI offers cancel or explicit
twice-confirmed Project reset. Reset fences old sessions/writers, publishes one
complete new `.convax` tree by same-filesystem swap, deletes the old private tree,
preserves every ordinary Project file and stable `projectId`, rotates
`projectEpoch`, and creates an empty ProjectIndexYDoc and Canvas catalog. Any old
epoch UI, Agent, Plugin or collaboration request rejects. Ambiguous crash recovery
keeps the Project closed as `recovery-required`.

## 9. Hard cut, owner counts and forbidden paths

The frozen authority must mechanically satisfy these ownership facts:

- Kernel declares once: `OrdinarySha256V2`, `StableRemoteTransferKeyV2`,
  `RemoteUpdateIngressKindV2`, update request/record/receipt, accepted durability
  types, `CollaborationPersistencePortV2`, proof capability/result, GC request/result
  and `SessionUndoCoordinatorV2`.
- Project declares once: Blob contract, private evidence ledger, COW native records,
  reset 12-field composite/factory and private dependency receipt.
- Control declares once: Peer manifest/evidence/body/error union, reset carrier
  authenticity view/bundle/factory, dependency carrier ref and ACK outbound port.
- Canvas declares once: CGP carrier/identity/verifier/result/runtime/factory.

The following declaration counts are exactly zero:

```text
document-wide version/revision CAS mutation inputs
renderer whole-document replacement
raw Yjs update public mutation input
JSON Canvas/catalog parallel authority
reconnect intent replay, renumber or re-sign
UpdateTransferKindV2 Project shadow union
Project shadow update request/record/receipt wire DTO
shared update/blob receipt or persistence union
Blob path through CollaborationPersistencePortV2
flat durable reference index/checkpoint authority
resultingIndexSetDigest
scanReferenceIndexSetDigest
Uint32 durableReferenceCount
Control RemoteDependencyCarrierDurableReceiptV2
public or serializable dependency carrier receipt
newlyStoredManifestAndEvidenceObjectCount
newlyStoredManifestAndEvidenceByteLength
relay editAuthorizationObjectDigest
admission-class union in transfer evidence
durable connectionId/sessionId/attempt
public claimedAuthority bytes
validateCarrier
verifyAuthorityPredicate
createBundle
free verifyDocumentShardResetAuthorityV2(input)
Project reset base-reference resolver
ambient runtime/bundle/service locator/fallback verifier
Canvas-local SessionUndoCoordinatorV2
numeric protocol height/count/generation/chunk literal
```

UI, Agent and Plugin use one closed typed-intent application surface, semantic or
field guards, one isolated candidateDoc and one durable causal-frame barrier. React
Flow is a rendering/projection layer only. Selection, drag preview, connection
preview, viewport and other transient React Flow state never become Yjs or Project
authority. Undo/redo is session-local `Y.UndoManager` coordination over accepted and
working state; no cross-restart undo contract exists.

Plugin creation is one bounded typed intent. Plugin schema compatibility is checked
before candidate mutation against the exact selected Plugin schema/artifact identity.
Creation group node/edge effects are one atomic candidate transaction. If the source
node was deleted concurrently, the entire Plugin creation group is invalid. Delete
wins over late generation result. Node deletion removes now-unreachable incident
edges. Business edges are not called parent links. Any containment relation that can
form a cycle has a Canvas-owned deterministic verifier and rejection result; neither
arrival order nor renderer traversal chooses the winner.

## 10. Protocol registry and authority packaging

Add exactly these eleven duplicate-free raw-UTF-8-sorted digest domains:

```text
convax.durable-reference-index-empty/2
convax.durable-reference-index-internal-subtree/2
convax.durable-reference-index-leaf-subtree/2
convax.durable-reference-leaf/2
convax.durable-reference-source-inventory/2
convax.frame-object-reference/2
convax.peer-transfer-offer-evidence-core/2
convax.peer-transfer-offer-evidence-signature/2
convax.remote-ingress-chunk-leaf/2
convax.remote-ingress-chunk-set/2
convax.target-reference-set/2
```

Native record `format` strings, including the evidence ledger, use the Project-local
record digest and are not registered domains. Regeneration must compute fresh Canvas,
Kernel, Control and Project artifact digests, URI protocol digest, closed limit and
channel-contract digests, bundle core/protocol digest, five authority hashes and all
three receipts. Protocol major remains `"2"` only because `protocolDigest` is checked
before body decode; no mixed digest can instantiate a decoder or runtime.

The immutable authority manifest has exactly seven restricted-JCS keys:

```text
annexSetSha256
annexes
authorityId
format
main
protocolCoreDigest
protocolDigest
```

Main contains no copied annex/core/protocol literal pins; the manifest is the sole
machine-readable pin. The stable active pointer has exactly six keys:

```text
format
authorityId
manifestPath
manifestSha256
evidencePath
evidenceSha256
```

Promotion replaces the pointer only after the exact five authority files, manifest,
evidence and three signoffs are immutable and mutually verified. Prior R4 and every
rejected/unsigned R5 candidate remain readable evidence and can never decode as the
new authority.

## 11. Mandatory falsifiers

1. AST owner/declaration counts must match section 9 in package-local and packed
   external-consumer builds. Source imports, pseudo module names and cycles fail.
2. Numeric Uint, `height:0`, leading zero, sign and overflow fixtures reject before
   digest. Canonical `"0"` and `"1"` round-trip to frozen vector digests.
3. Exercise all seven update chunk sizes at count 1 and 4096 and byte lengths 1 and
   1 GiB. Reject count 4097 and length 1 GiB + 1 before allocation.
4. Exercise all three Blob chunk sizes through 16 GiB. Reject any other size, count
   65537 and length 16 GiB + 1 before allocation.
5. Inject crash after every update raw/object/head/CAS barrier. Reopen mints one fresh
   receipt; old process objects reject. Equal response-loss duplicate writes zero
   bytes; unequal duplicate quarantines.
6. Inject crash after every Blob file/page/root/head/finalizer barrier. Only complete
   finalization can produce Blob ACK. No record contains 65,536 chunk entries.
7. Persist evidence `started`, crash after every subsequent object write and before
   closure. Retry retains the exact original missing set and charge; it cannot drop
   from N to zero. Same stable key concurrent admission has one CAS winner.
8. Adding 1000 bytes to the signed manifest wrapper increases
   `newlyStoredEvidenceByteLength` by 1000. Shared authority descendants count once;
   preexisting authority bytes add zero without lowering `authorityObjectCount`;
   validation artifacts affect neither metric.
9. Same stable key/same manifest is idempotent with one charge. Different manifest
   stores at most two evidence closures and zero second payload; third rejects. Full
   quota cannot claim durable equivocation.
10. Random B+tree operations match a sorted reference model after every split,
    borrow, merge, root collapse and rebuild. Any source/coverage mismatch prevents
    proof and GC while typed edit still commits.
11. Swap first/second proof, prior digest, ref, target, H/R/root/coverage, generation
    or structural proof identity. Every case deletes nothing.
12. Viewer relays each of ten kinds. Without an editor-owned wanted root, CGP/RSA
    cannot reserve, install or ACK. Revocation at offer/install/ACK/permit closes.
13. Cross-use Blob/update receipts, structural-clone any receipt, replay a spent
    receipt or use a stale attempt. No operation commits or ACKs.
14. Build two Control bundles. Bundle B rejects bundle A's view. Two CGP copies have
    distinct buffers and equal bytes. Project cannot read claimed authority.
15. Mutate candidate or relevant membership/floor/route/stage/head between every
    A1/A4 step. Any stale change yields zero reducer calls and preserves sole old
    route. Reentrant callback and second permit use reject.
16. Validate maximum CGP/RSA carrier on minimum supported hardware. A temporary
    Y.Doc leak, event-loop/cancellation budget breach or excessive RSS blocks
    implementation promotion and requires an explicit worker/isolate execution port.
17. Project URI canonical fixtures match across macOS, Windows and Linux. A path
    cannot select bytes without owner lookup; id/path/blob cannot be independently
    torn by Yjs writes.
18. Unsupported old Project open performs no write. Explicit reset preserves ordinary
    file hashes and stable projectId, rotates epoch, creates empty YDocs, rejects old
    epoch calls, and never yields a partially opened tree.
19. Generated domain registry has exactly the eleven additions and no duplicate. A
    stale artifact/hash/limit/channel/bundle digest stops before decoder/runtime.
20. A React Flow transient event, Plugin/UI/Agent mutation or undo/redo path cannot
    submit a document version, whole document, raw update or renderer-selected
    identity. Every durable mutation passes the same typed-intent candidate barrier.

## 12. Red-team disposition carried into review

The strongest objections are:

1. The COW index and scan fence may cause write amplification and GC starvation
   under sustained edits. This is a performance-capacity assumption, not solved by
   fail-closed correctness.
2. Evidence quota, crash ledger, equivocation, wanted root, install and ACK produce
   a large interleaving state space. Unit examples alone are sample bias; systematic
   crash/property tests are mandatory.
3. All-member relay expands disk and bandwidth denial-of-service surface, while
   large synchronous reset carriers can stall low-memory clients. Membership is not
   sufficient resource admission.

The architecture is falsified by premature ACK, double charge, lost high-water,
stale reset apply, structural receipt admission, noncanonical scalar hashing,
ordinary edit becoming read-only because the GC index is dirty, or an upper-bound
load test exceeding the product's published resource budget.

This candidate is eligible only for exact-byte 3/3 architecture review. It is not
eligible for implementation or active-authority promotion before those three votes.
