# Document shard-reset initiator binding normative patch proposal

Status: **normative patch proposal only**. This file has no authority to amend the
pinned collaboration v2 authority set by itself. The exact clauses below are intended
to be transplanted mechanically into the control-plane, Project persistence and main
specification artifacts, followed by bundle regeneration and renewed review. No
runtime implementation may treat this proposal as an accepted protocol artifact.

## 1. Decision, defect and owner boundary

The current authority set has a `canonical-authority-conflict`:

- the kernel-owned `ReplicaIdV2` codec is exactly `replica_` plus eight lowercase
  hexadecimal digits;
- the control-owned `DocumentShardResetConfirmationCoreV2.initiatorReplicaId` is a
  `ReplicaIdV2` and is authenticated through one active
  `ReplicaActorCredentialV2`;
- the Project-owned `DocumentShardResetClaimCoreV2.initiatorReplicaId` is incorrectly
  declared as `Id128V2`, whose exact 22-character base64url codec has an empty
  intersection with `ReplicaIdV2`.

This is not a request-id versus replica-id naming issue. The confirmation and claim
each name the same destructive-reset initiator. V2 has exactly one initiator member,
one initiator replica, one initiator actor and one replica signing key for one shard
reset. It MUST NOT introduce a claim-local replica identity, confirmation-local
replica identity, alias, fallback codec or second key-resolution path.

The 3/3 architecture ruling for destructive shard reset is **A**: the initiator at
final admission MUST be one exact current active-editor replica with exact current
`ReplicaEditAuthorizationV2`, and the same reset MUST separately carry exact current
admin approval. Alternative B—any active replica, including viewer or pending
editor—is rejected. If no active editor exists, shard reset fails closed and only the
separately specified destructive Project-reset/Project-epoch recovery flow may be
offered; this proposal defines no implicit break-glass path.

Ownership remains:

| Concern | Sole owner |
| --- | --- |
| `MemberIdV2`, `ReplicaIdV2`, `ActorIdV2`, JCS and Ed25519 rejection rules | collaboration kernel |
| replica reservation, membership, actor credential and reset confirmation/approval DTO | control plane |
| reset claim, route-CAS core, ProjectIndex reducer and route publication | Project |
| cross-owner pure verification | `@convax/project/collaboration-protocol` |
| one-shot reset permit lifecycle and reducer-entry gate | Project application-service module-private coordinator |
| native writer/CAS composition | `@convax/project/node` |

The control plane MUST NOT own the ProjectIndex route decision. Project MUST NOT
reimplement membership, reservation, trust-bundle or credential validation. Control
provides only its closed reset DTOs, pure validators and typed dependency ports to
the cross-owner verifier. Control MUST NOT construct, return, register, consume,
inspect or persist a Project reset permit, WeakMap record, nonce, candidate binding,
current-authority head witness or permit state. It also MUST NOT define their fields,
lifecycle, state transitions, release behavior, reducer-entry gate or crash meaning;
those are exclusively Project-owner semantics.

The 3/3 cross-owner decision id is **`F13-WITNESS-A+C/1`**. Control's complete part
of that decision is **F13**: the initial authority decision and the Project-owned
final gate each invoke the same sole complete thirteen-step verifier from step 1.
Control exposes no final-currentness-only verifier, phase flag, resume token or
steps-9-through-12 entry point. Witness, permit and A+C remain referenced owner
requirements, not Control algorithms.

## 2. Exact Project type replacement

The Project artifact MUST import the kernel-owned nominal scalar types:

```ts
type MemberIdV2 = import("@convax/collaboration").MemberIdV2
type ReplicaIdV2 = import("@convax/collaboration").ReplicaIdV2
```

The exact claim core declaration MUST become:

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

No other claim field is added. In particular, the claim MUST NOT add a second
credential digest, replica key, identity alias or reservation digest. The exact
control confirmation already names the credential core digest; the claim binds the
confirmation core digest, and the composite equalities below make that one
credential the only key-resolution authority for both initiator signatures.

The control declaration remains:

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
  stagedGenesisCheckpointDigest: DigestV2
  stagedGenesisFullUpdateDigest: DigestV2
  stagedGenesisStateVectorDigest: DigestV2
  initiatorMemberId: MemberIdV2
  initiatorReplicaId: ReplicaIdV2
  initiatorActorId: ActorIdV2
  initiatorActorCredentialCoreDigest: DigestV2
  confirmationStatement:
    "replace-one-canvas-shard-and-retain-old-recovery-bytes"
  protocolDigest: DigestV2
}
```

## 3. Exact principal equality closure

The Project reset composite verifier MUST require all existing digest, route, scope,
reason, staged-genesis and approval equalities plus these additional byte equalities:

```text
claim.core.initiatorMemberId
  == confirmation.core.initiatorMemberId

claim.core.initiatorReplicaId
  == confirmation.core.initiatorReplicaId

claim.core.initiatorActorId
  == confirmation.core.initiatorActorId
```

The resolved active `ReplicaActorCredentialV2` MUST satisfy:

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

credential.core.memberId
  == confirmation.core.initiatorMemberId
  == claim.core.initiatorMemberId

credential.core.replicaId
  == confirmation.core.initiatorReplicaId
  == claim.core.initiatorReplicaId

credential.core.actorId
  == confirmation.core.initiatorActorId
  == claim.core.initiatorActorId

credential.core.protocolDigest
  == confirmation.core.protocolDigest
  == current instantiated ProtocolSchemaBundleV2.coreDigest
```

The credential's exact immutable membership replica record MUST be active at the
route-CAS authority gate and MUST satisfy:

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

The verifier MUST also resolve the exact `ReplicaEditAuthorizationV2` named by the
candidate ProjectIndex causal context. Its wrapper, core digest and membership-purpose
service signature MUST validate, and its core MUST satisfy:

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

The final causal-frame signer authority, claim, confirmation, credential, membership
records and edit authorization MUST identify the same exact
`{memberId,replicaId,actorId}`. The installed floor MUST be the complete activation
floor named by the edit authorization and derived from its exact content-certified
ProjectIndex live-scope manifest. Later route advancement does not silently rotate
that immutable authorization/floor binding; current edit eligibility is determined
by the exact authorization epochs, membership/edit state and cutoff rules, while
step 12 independently checks the current route. A viewer (`role="viewer"` or
`editState="none"`) and a pending editor
(`editState="pending-editor"`) are closed rejection cases even when every reset
signature and admin approval is otherwise valid.

This patch does not grant reset authority merely because the member or replica is
active. Active-editor mutation authority, exact destructive confirmation, exact
admin approval and Project-owned route-CAS predicates are four conjunctive gates.
Admin approval is not a delegation of ProjectIndex frame-signing authority and does
not upgrade a viewer or pending editor.

## 4. Reservation receipt closure and key derivation

The verifier MUST resolve
`credential.core.replicaIdReservationReceiptDigest` to the exact retained
`ReplicaIdReservationReceiptV2`. Substituting the current reservation, another
receipt for the same member, an allocator row without the signed receipt, or a newly
issued reservation is forbidden.

The wrapper core digest and membership-purpose service signature MUST verify under
the exact retained trust bundle. The receipt MUST satisfy:

```text
reservation.coreDigest
  == credential.core.replicaIdReservationReceiptDigest
reservation.core.projectId == credential.core.projectId
reservation.core.projectEpoch == credential.core.projectEpoch
reservation.core.targetMemberId == credential.core.memberId
reservation.core.assignedReplicaId == credential.core.replicaId
reservation.core.newReplicaSigningPublicKey
  == credential.core.replicaSigningPublicKey
reservation.core.protocolDigest == credential.core.protocolDigest
reservation.core.serviceKeyPurpose == "membership"
reservation.core.purpose == "replica-enroll" | "replica-rotate"
```

The immutable reservation state MUST be `consumed`, and its consumed membership
mutation MUST be the one that introduced the membership replica/credential chain.
For `replica-rotate`, the receipt's `currentReplicaId`, purpose and consumed mutation
MUST match the replaced predecessor chain. Receipt expiry after atomic consumption
does not invalidate the credential; a still-`reserved` or `abandoned` receipt grants
no reset authority.

The verifier MUST independently recompute:

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

The result MUST be byte-equal to the credential, membership replica, confirmation
and claim actor ids. A stored actor id is not accepted without this derivation.

## 5. Digest and signature preimages

No new reset identity or digest wrapper is introduced. Existing purpose separation
is made explicit and remains the only signing construction.

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

`initiatorReplicaSignature` MUST verify as pure Ed25519 over
`confirmationSignatureMessage`. `initiatorSignature` MUST verify as pure Ed25519
over `claimSignatureMessage`. Both signatures MUST verify under the byte-identical
`credential.core.replicaSigningPublicKey`; no member key, session key, admin key,
current-replica lookup fallback or caller-selected key is permitted.

The confirmation core digest is already purpose-separated by its closed core domain;
the control-plane signature convention signs its decoded 32-byte core digest. The
claim retains its additional dedicated signature domain. Implementations MUST NOT
double-hash the confirmation signature, omit the claim signature hash, or use a
generic `reset-signature` domain.

Changing the Project field codec and artifact bytes rotates the Project artifact
digest, the exact protocol bundle core/protocol digest and every reset object that
binds that protocol digest. A confirmation, claim or approval from the superseded
bundle MUST NOT be migrated, rewritten or accepted under the corrected bundle.

## 6. A-claim plus B-confirmation splice rejection

Let A and B be distinct exact active-editor replica principals, even when they belong
to the same member. The following construction MUST reject:

1. B creates and signs a valid confirmation naming B's credential;
2. A creates a claim naming A but places B's confirmation core digest in
   `explicitConfirmationReceiptDigest`;
3. A signs that claim and an admin signs an approval binding both core digests.

All individual signatures may be cryptographically valid. The composite MUST return
`reset-initiator-binding-invalid` before claim-signature key resolution because at
least one of member, replica or actor differs. Admin approval cannot legalize this
splice: it approves one exact claim/confirmation pair, not a transfer of initiator
authority between principals.

The same rejection applies when A and B share a signing key, when a revoked/replaced
replica's key bytes equal another retained key, or when a malicious caller supplies a
credential object whose digest is not the confirmation-bound digest. Identity is the
closed Project-epoch/member/replica/actor/credential/reservation relation, not public
key equality alone.

## 7. Composite verifier input and result

The browser-safe Project collaboration-protocol export MUST expose exactly one pure
composite verifier. The Project application-service module-private coordinator is
its sole reset-admission caller. Project Node, Desktop and control adapters MUST use
the Project application-service operation or supply typed dependencies; they MUST
NOT call, restate, wrap with a weaker order or implement a second reset authority
algorithm. The exact concrete generated names may differ, but the semantic contract
MUST be equivalent to:

```ts
interface DocumentShardResetAuthorityDependenciesV2 {
  credential: ReplicaActorCredentialV2 | null
  editAuthorization: ReplicaEditAuthorizationV2 | null
  reservationReceipt: ReplicaIdReservationReceiptV2 | null
  membershipSnapshot: MembershipSnapshotV2 | null
  membershipReplica: MembershipReplicaV2 | null
  membershipMember: MembershipMemberV2 | null
  floorRoot: ReplicaProjectFloorRootV2 | null
  floorPages: readonly ReplicaProjectFloorPageV2[] | null
  projectIndexLiveScopeManifest: ProjectIndexLiveScopeManifestV2 | null
  adminCapability: ProjectAdminCapabilityV2 | null
  trustBundle: ServiceTrustBundleV2 | null
}

interface DocumentShardResetCandidateBindingV2 {
  scope: DocumentScopeV2 & { docKind: "project-index"; docId: "project-index" }
  routeCasCoreDigest: DigestV2
  typedIntentDigest: DigestV2
  causalContextDigest: DigestV2
  baseStateVectorDigest: DigestV2
  baseCanonicalStateDigest: DigestV2
  protocolDigest: DigestV2
  ownerSchemaDigest: DigestV2
  validationArtifactSetDigest: DigestV2
  installedFloorSetDigest: DigestV2
  signerAuthority: CausalSignerAuthorityV2
}

type VerifyDocumentShardResetAuthorityResultV2 =
  | { status: "verified" }
  | { status: "pending"; code: "reset-authority-dependency-pending" }
  | { status: "rejected"; code: DocumentShardResetBindingFailureV2 }
```

`status="verified"` is diagnostic output, not an authority object. A caller cannot
serialize, cache or replay it to authorize mutation. The pure verifier stops at this
result. It does not construct or return a witness or permit and has no WeakMap,
nonce, registry, state transition, release, consume, reducer-entry or durability
API.

The Project application-service module-private coordinator is the only reset
admission caller. Project Node and Desktop call one Project application-service
operation; they do not call the verifier or receive its diagnostic as authority.
The coordinator invokes this exact public verifier once before its private issue
boundary and invokes the same exact public verifier again at its private final gate.
Each invocation starts at step 1, runs every step through step 13 and returns only
the closed result above. The second invocation is not a steps-9-through-12 shortcut.

There is exactly one verifier implementation and one callable verifier contract.
Control MUST NOT add `revalidateDocumentShardResetCurrentAuthorityV2`, a
`phase="final"` or `resumeAtStep` input, a staged-verifier export, a cached
steps-1-through-8 result or any other path that lets final admission skip a step.
The separately reviewed Project-owner artifact exclusively defines witness,
PermitRecord, concurrency, reducer-entry and A+C behavior; this Control artifact
references that owner and does not reproduce its private sequence.

## 8. Deterministic verification order

The following thirteen steps are the sole normative first-failure algorithm for the
composite verifier. Owner/Project prose may reference this section only; it MUST NOT
publish a shortened sequence, macro-order or independent first-failure rule. The
first failing step selects the failure code. No step may mutate a Y.Doc, route,
journal, head, outbox, native tree or control-plane state.

1. **Bound and decode.** Enforce object byte/depth caps; decode strict JCS and all
   closed DTO/scalar codecs. In particular, decode both replica fields only as
   `ReplicaIdV2`. Failure: `reset-object-invalid`.
2. **Recompute wrapper identities.** Recompute confirmation, claim, approval,
   route-CAS and reset-commit core digests plus every wrapper/core equality. Failure:
   `reset-digest-binding-invalid`.
3. **Bind route and staged genesis.** Check Project, epoch, Canvas, old/new scope,
   reason, route-CAS/predecessor and all three genesis digest equalities. Failure:
   `reset-route-binding-invalid`.
4. **Bind the initiator triad.** Check the three claim/confirmation equalities from
   section 3 before choosing a signature key. Failure:
   `reset-initiator-binding-invalid`.
5. **Resolve the exact credential.** Resolve only the confirmation-bound credential
   digest. Missing retrievable bytes: `reset-authority-dependency-pending`. Bad
   digest, wrapper, trust signature, purpose, Project/epoch/protocol or triad:
   `reset-actor-credential-invalid`.
6. **Resolve the exact reservation receipt.** Validate section 4, consumed state and
   membership introduction/rotation chain. Missing retrievable bytes:
   `reset-authority-dependency-pending`. Any mismatch:
   `reset-reservation-binding-invalid`.
7. **Recompute actor identity.** Recompute actor id from the credential-bound tuple.
   Failure: `reset-actor-derivation-invalid`.
8. **Verify both initiator signatures.** Use only the credential replica key and the
   exact messages in section 5. Failure: `reset-initiator-signature-invalid`.
9. **Validate current active-editor principal.** Resolve the exact immutable
   membership snapshot and current membership state. Require active member and
   replica, `membershipMember.role="editor"`,
   `membershipReplica.editState="active-editor"`, current credential and current
   authorization epochs/key/reservation relation. Viewer or pending-editor:
   `reset-active-editor-required`; replaced,
   revoked or otherwise non-current authority: `reset-initiator-stale`. Missing
   retrievable membership bytes: `reset-authority-dependency-pending`.
10. **Resolve and validate exact edit authorization.** Resolve only the
    `candidate.signerAuthority.replicaEditAuthorizationCoreDigest`; validate its
    wrapper, service signature and every Project/epoch/principal/reservation/floor/
    protocol/schema/artifact equality from section 3. Resolve the exact
    `ReplicaProjectFloorRootV2` named by `installedFloorSetDigest`, all required
   pages, and its content-certified `ProjectIndexLiveScopeManifestV2`; require its
   activation-time ProjectIndex-plus-live-routes set to be complete and byte-exact.
   Missing
    retrievable bytes: `reset-authority-dependency-pending`; any structural,
    signature, floor, schema or artifact mismatch:
    `reset-editor-authorization-invalid`.
11. **Validate approval.** Validate claim/confirmation binding, admin member
    equality, current exact capability, member authorization epoch and admin
    signature. Missing retrievable bytes: `reset-authority-dependency-pending`;
    stale capability: `reset-approval-stale`; structural/signature mismatch:
    `reset-approval-invalid`.
12. **Validate candidate binding and current route.** First require every field of
    `DocumentShardResetCandidateBindingV2` to recompute from the exact unmutated
    candidate and causal context, and its base state-vector/canonical digests to
    equal the current durable ProjectIndex `replicaDoc` head; mismatch is
    `reset-candidate-binding-invalid`.
    Then require ProjectIndex to expose only the expected old live route and
    predecessor activation, the staged genesis to remain inert and the new route not
    to be live; failure is `reset-route-cas-stale`.
13. **Return verified diagnostic status.** Return `{status:"verified"}` to the
    directly invoking Project application-service coordinator for this exact
    invocation. No permit or authority value is returned, and Control retains no
    invocation state.

First-failure selection inside the multi-object steps is also fixed. Step 9 checks
membership snapshot signature/currentness, exact principal/credential relations,
then role/edit state. Stale/replaced/revoked identity, epoch, key or reservation
relation is `reset-initiator-stale`; a structurally current viewer/pending editor is
`reset-active-editor-required`. Step 10 checks edit authorization, then floor root,
root-ordered floor pages, then live-scope manifest and complete coverage. At each
object, absence is pending before any later object is inspected; present-invalid is
`reset-editor-authorization-invalid`. Step 11 checks availability, structural
digest/signature validity, then current capability/authorization epoch, in that
order. Step 12 recomputes candidate binding first and checks current route second.
Implementations MUST NOT race these checks in parallel or choose the result by
Promise completion/lookup arrival.

The same complete algorithm is normative for both the initial and final invocation.
Both begin with step 1, execute the within-step orders above and reach step 13 only
after steps 1 through 12 pass. For a multi-fault input, the lowest failing step and
then that step's fixed sub-order select the result independently in each invocation.
Control MUST NOT describe the final invocation as "currentness only", omit an
earlier immutable-object check because it passed initially or let a Project-local
comparison substitute for any verifier step.

Every verifier invocation is pure and synchronous over already supplied bounded
objects. It performs no dependency fetch, authority lookup, callback, IPC, native
write, candidate mutation, route publication or control-plane mutation. Project's
private caller sequencing and reducer boundary are defined only by the Project-owner
artifact and are not a second Control first-failure algorithm.

## 9. Closed failure codes

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

`reset-authority-dependency-pending` is a bounded pending state, not a rejection.
Every rejection/pending/stale result leaves the old route the sole live authority and
publishes/deletes nothing. It MUST NOT silently fetch the current credential as a
substitute for the exact digest, downgrade a stale result to approval success or
continue with a locally reconstructed identity.

`reset-active-editor-required` is a closed rejection, not dependency-pending. If no
exact active editor exists, Canvas shard reset fails closed. The product may offer
the independently specified destructive Project-reset/Project-epoch recovery path;
it MUST NOT silently grant a viewer or pending editor reset authority, auto-promote
a replica, synthesize an edit authorization or invent an implicit break-glass actor.

Reusing an existing `confirmationId`, approval id or operation id with different
core bytes remains `idempotency-equivocation`; this list does not replace the
existing idempotency contract.

## 10. CAS, persistence, payload and edit-order boundaries

A Project-owned admission that independently accepts the verified bundle may
authorize only one Project-owned route transition. It MUST NOT:

- create a Canvas causal edit or Canvas Yjs update; the only admitted mutation is
  the exact active-editor-signed ProjectIndex route-reset causal frame/Yjs delta;
- alter Lamport, actor sequence, portable stamp, frontier or Yjs client-id order;
- use membership sequence, reservation allocation order, service sequence, wall
  clock or confirmation arrival order as an edit or route winner;
- revive old shard bytes or discard their recovery copy;
- make control-plane state a second Canvas/Project authority.

The durable control-plane store may retain the already-allowed immutable reset
confirmation/approval, credential, edit authorization, reservation receipt,
membership snapshot, floor root/pages, live-scope manifest and idempotency metadata.
It MUST NOT persist or log permit/nonce/candidate bindings, checkpoint payload,
full-update, state-vector, Yjs, Canvas/ProjectIndex state, causal frame, typed intent,
Plugin state, blob/media bytes or native paths. Reset objects carry only their exact
digests.

`@convax/project/node` remains the sole durable Project writer. It persists the exact
authorized metadata at the existing native reset barriers; a failed verifier result
does not create a reset manifest, route frame, journal/head/outbox record or staged
tree publication marker. No-active-editor rejection leaves the old route sole live
and may only hand the user to the independently specified full Project-reset path.

The Project-owner and kernel artifacts exclusively define private gate terminal
meaning, reducer entry, native barriers and crash recovery. Control neither observes
nor interprets witness/permit state and never uses such process-local state as a
durability result. This section deliberately does not restate the Owner A+C state
machine or recovery matrix.

## 11. Owner canonicalizer descriptor audit at control/attester

This reset patch does not define a Canvas or ProjectIndex canonicalizer and MUST NOT
copy either owner's root topology, record schema, reducer, canonical-state encoder or
digest-material registry into control code.

For checkpoint/content attestation, the ordinary control API handles only metadata
and digests. The isolated attester receives bounded carrier bytes ephemerally and
selects the owner exclusively through the exact kernel
`DocumentOwnerProtocolPortV2` instantiated from the validation artifact set.

The selected port MUST expose the kernel-owned exact
`OwnerCanonicalizerDescriptorV2` whose format and sole digest domain are both
`convax.owner-canonicalizer-descriptor/2`. Its descriptor `owner`,
`ownerSchemaDigest`, `canonicalStateFormat`, codec and fail-closed policies MUST
validate exactly, and its digest MUST recompute over that exact descriptor. A
Canvas-specific descriptor, `convax.canvas-canonicalizer/2` digest domain, copied
root-topology descriptor or alternate owner-local canonicalizer preimage is
`attestation-rejected`. Canvas encoding/topology remains normative only inside the
selected Canvas owner artifact transitively bound by `ownerSchemaDigest`.

The attester MUST verify this digest chain without re-declaring owner schema:

1. the carrier `protocolDigest` equals the exact parsed
   `ProtocolSchemaBundleV2.coreDigest`;
2. the validation artifact set digest recomputes, includes the exact four protocol
   owner artifacts and includes every declarative Plugin artifact required by the
   reconstructed closure;
3. the selected owner artifact digest equals the checkpoint/frame `schemaDigest` or
   `ownerSchemaDigest` as named by that DTO;
4. the instantiated owner port's `owner` equals `scope.docKind`, its `schemaDigest`
   equals both the selected artifact digest and descriptor `ownerSchemaDigest`, its
   descriptor format/domain are exactly the kernel values above, and its recomputed
   `canonicalizerDigest` equals the checkpoint, every replayed frame and any parent
   certificate canonicalizer digest;
5. every frame's base/post canonical-state digest is recomputed using the kernel
   `convax.canonical-state/2` formula over the exact bytes returned by that owner
   port's `canonicalStateBytes`;
6. after exact parent/suffix replay, the proposal snapshot's state-vector digest,
   full-update digest, canonical-state digest, frontier and actor-head boundary all
   recompute and equal the checkpoint candidate;
7. the emitted content certificate copies the byte-identical `protocolDigest`,
   `schemaDigest`, `canonicalizerDigest`, `validationArtifactSetDigest`, state-vector,
   full-update and canonical-state digests from the verified result.

An unknown/missing owner artifact or canonicalizer descriptor is
`attestation-unavailable`; a digest mismatch or owner-port output mismatch is
`attestation-rejected`. The attester MUST NOT fall back to repository code, a newer
current owner, an artifact name, React projection, JavaScript object enumeration or
Yjs internal struct hashing.

The descriptor/owner port is executable validation authority only through the exact
artifact-set binding. Control may persist the resulting signed certificate and
section digests, but all carrier/state bytes are destroyed on success, rejection,
cancellation and crash cleanup. No canonical-state or reset payload bytes enter the
durable control store.

### 11.1 Atomic final domain registry

The atomic Owner/Project plus Canvas closure MUST produce one strict sorted,
duplicate-free registry of exactly **123** domains. The base is the exact 89-domain
registry in frozen `ProtocolSchemaBundleV2.coreDigest`
`e37edd84c576d2ce8fbb983f29b34d5e78fe0d6578af30f93c7ffb91d41b43ad`.
Starting from those exact bytes, add the seven Owner/Project domains:

```text
convax.owner-canonicalizer-descriptor/2
convax.project-conflict-projection/2
convax.project-content-family-projection/2
convax.project-entry-location-projection/2
convax.project-file-projection/2
convax.project-index-write-value/2
convax.project-route-projection/2
```

Add exactly these 28 Canvas domains:

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

Remove `convax.project-index-canonical-state/2` as a digest domain. The format string
may remain owner schema data. Do not add `convax.canvas-canonicalizer/2`; the sole
canonicalizer descriptor domain is the kernel-owned domain above. Therefore the
cardinality equation is exactly `89 + 7 + 28 - 1 = 123`. A 122-, 124- or
otherwise-sized registry, either private canonicalizer domain, duplicate entry or
unsorted registry is `protocol-schema-bundle-unavailable` before attestation or
reset verification.

## 12. Mechanical transplant and digest rotation

Adoption requires one indivisible authority update:

1. transplant section 2's nominal scalar changes and only the Project-owned
   DTO/equality portions of sections 3 through 7, 9 and 10 into the Project artifact;
   do not copy section 8's verification order;
2. transplant the credential/edit-authorization/reservation/signature and failure
   clauses into the control artifact without changing the confirmation DTO;
3. transplant the cross-owner equalities, splice rejection and attester audit into
   the main specification;
4. ensure Control exports only its closed DTOs, pure validators and typed dependency
   ports, and the browser-safe Project collaboration-protocol export contains only
   imported kernel/control types and the sole pure verifier contract. Neither
   surface exports or owns a permit, WeakMap, issuer, registry, nonce, record, state
   transition or consume function;
5. transplant the separately reviewed Project-owner witness, PermitRecord and A+C
   clauses only into the Project artifact; Control and its public verifier retain no
   field, type, lifecycle or state-machine copy;
6. delete every Owner/Project-local reset verification order and first-failure
   algorithm. Owner/Project references section 8's sole F13 verifier for both its
   initial and final calls and defines only its own private admission/reducer effects;
7. replace both owners' canonicalizer bindings with the sole kernel
   `OwnerCanonicalizerDescriptorV2`, install the exact 123-domain registry from
   section 11.1 and reject the Canvas-private descriptor/domain;
8. regenerate the exact Project/control/Canvas/kernel artifact refs, kernel bundle
   core, `protocolDigest`, registry validation and all dependent golden vectors;
9. obtain fresh independent architecture reviews and exact-byte SIGN for the whole
   authority set.

Editing generated TypeScript only, aliasing `ReplicaIdV2` to `Id128V2`, retaining the
old protocol digest or accepting old reset receipts under the new bundle is a failed
transplant.

## 13. Mandatory conformance and security tests

1. `replica_00000001` passes `ReplicaIdV2` and fails `Id128V2`; a canonical 22-byte
   spelling of `Id128V2` fails `ReplicaIdV2`. No scalar passes both.
2. One active-editor replica with exact current credential, edit authorization,
   installed floor and membership/reservation chains creates claim and confirmation;
   all equality and both initiator signature verifications pass.
3. A-claim plus B-confirmation rejects as `reset-initiator-binding-invalid` for each
   independently changed member, replica and actor field, including two replicas of
   one member.
4. A confirmation-bound credential digest cannot be replaced with the current
   credential, another credential using the same public key or another retained
   credential for the same replica.
5. A reserved, abandoned, wrong-member, wrong-replica, wrong-key, wrong-purpose,
   bad-service-signature or unconsumed receipt rejects before Project candidate
   mutation. A correctly consumed expired receipt remains valid.
6. Replacing only claim or confirmation signature with a session, member, admin or
   other replica signature rejects.
7. Viewer and `pending-editor` initiators reject as
   `reset-active-editor-required`, even with valid confirmation and admin approval.
   Missing/wrong/stale floor, Project schema, validation artifact set, protocol or
   edit authorization rejects before candidate mutation.
8. Invoke the exact same verifier for an initial and a final decision over the same
   complete bytes. A spy proves both calls start at step 1 and execute the same F13
   implementation; no steps-9-through-12 entry point is callable.
9. Give both calls multi-fault inputs. Step 1 plus 12 returns step 1; steps 4, 8 and 9
   return step 4; steps 9, 11 and 12 return step 9; steps 10 and 11 return step 10;
   steps 11 and 12 return step 11; candidate plus route mismatch inside step 12
   returns the candidate-binding failure first.
10. Revoke/replace/downgrade the initiator, rotate its edit authorization/floor or
    rotate admin authority between the two calls. The final complete F13 invocation
    rejects through its ordinary earliest step and performs no route/candidate
    mutation.
11. Mutate a step-1-through-8 object after the initial call while retaining a
    current-looking membership/route set. The final invocation starts at step 1 and
    rejects the earliest changed object; it does not trust or accept a cached prefix.
12. Reflect every public Control, Project collaboration-protocol, Project Node,
    Desktop and IPC export. Control exposes only DTOs, pure validators and typed
    dependency ports; the browser-safe Project surface exposes only the one complete
    verifier. No surface contains an F9/final-currentness verifier, phase/resume
    input, cached prefix, permit, WeakMap, witness, nonce, issuer, transition or
    consume API.
13. Scan control DB, Project stores, object store, logs, traces, retries and crash
    recovery after every pass/failure/cancel path; find no checkpoint, state-vector,
    full-update, Yjs, Canvas/ProjectIndex or typed-intent payload bytes in Control,
    and no permit state, authority-head witness, nonce or permit binding in any of
    those durable or observable sinks. The Owner tests separately cover the
    Project-private process-local record; this Control persistence test does not
    prohibit it.
14. Give Bun, Chromium and isolated attester only the renewed authority set; require
   byte-identical claim/confirmation/approval digests, signature messages, failure
   codes and splice rejection.
15. Attest one Canvas and one ProjectIndex checkpoint. Swapping schema digest,
    canonicalizer digest, validation artifact set or owner port rejects without any
    copied owner-specific schema in control.
16. Present a Canvas-private canonicalizer descriptor/domain or a registry whose
    count is not exactly 123; bundle admission/attestation rejects before replay.
17. Verify that changing service sequence, reservation allocation order, arrival
    order or wall clock does not change Canvas/ProjectIndex projection or ordinary
    edit acceptance.

## 14. Strongest objections

1. **Exact admin approval should be enough; requiring active-editor authority is
   redundant and can block recovery.** Admin approval authorizes the destructive
   policy decision, but it does not delegate ProjectIndex causal-frame authority.
   A viewer/pending editor has no complete-floor edit authorization. Conflating the
   two grants a read principal a write path. If no active editor exists, the safe
   result is closed failure plus the separately specified Project-reset path, not an
   implicit break-glass mutation.
2. **The final gate needs only currentness steps 9 through 12; rerunning all F13 is
   redundant.** A second entry point carries hidden assumptions that steps 1 through
   8 remain valid and creates a separately evolvable error-order surface. Reset is a
   low-frequency destructive operation, both invocations consume already-resolved
   bounded bytes, and the complete verifier performs no I/O. One full entry point is
   therefore the smaller authority. If two bounded F13 calls cannot meet the accepted
   synchronous cost budget, the exact option must be reviewed again rather than
   silently adding an F9 path.
3. **Canvas needs its detailed canonicalizer descriptor so the generic kernel
   descriptor is too weak.** Two descriptor domains make one frame field have two
   legal preimages. The exact Canvas encoder/topology remains bound by the selected
   Canvas artifact's `ownerSchemaDigest`; the kernel descriptor binds that artifact,
   owner, output format and byte/failure policy. A second Canvas descriptor is a
   duplicate authority, not additional safety.

Flaw types addressed are a factual wire-codec contradiction, an unstated
cross-object principal equality, confused approval-versus-mutation delegation,
TOCTOU/capability replay, staged-verifier drift, duplicate canonicalizer authority
and a registry cardinality contradiction. The proposal deliberately does not solve
these with a new identity, F9 verifier, server edit order, durable permit/payload or
viewer break-glass path.

## 15. Falsification and score

This proposal is wrong if any of the following is demonstrated:

- one exact scalar value passes both the kernel `Id128V2` and `ReplicaIdV2` codecs;
- claim and confirmation are intended to have distinct authorized initiators and a
  separately reviewed rule defines both identities, both signatures and their
  delegation relation;
- a conforming verifier accepts A-claim plus B-confirmation while still proving that
  both signatures resolve to one byte-identical active credential/reservation chain;
- a viewer or pending editor can satisfy the existing causal-frame signer contract
  without a new reset-only authority model, or ProjectIndex route reset is proved not
  to be a ProjectIndex mutation;
- an exact active-editor authorization can omit its complete activation-time
  ProjectIndex-plus-live-routes floor, selected Project schema or validation artifact set without
  weakening ordinary frame validation;
- Control, the pure verifier, Project Node, Desktop or IPC constructs, returns,
  receives, consumes, persists or recovers a permit, nonce, WeakMap record or
  current-authority head witness;
- initial and final admission call different verifier implementations, either call
  begins after step 1, or an F9/final-currentness/phase/resume/cached-prefix entry
  point exists;
- changing only an object checked by steps 1 through 8 after the initial call can
  pass the final F13 invocation;
- the corrected verifier requires storing Canvas/ProjectIndex/checkpoint payload in
  the control plane or requires control to copy an owner schema;
- the verification order permits any candidate, journal, route or native publication
  effect before a failed principal, reservation, approval or current-route check;
- two implementations following section 8 return different first failure codes for
  one multi-fault input;
- the atomic registry recomputes to a cardinality other than 123 from the stated
  base/add/remove sets, or the kernel descriptor cannot bind Canvas without the
  private `convax.canvas-canonicalizer/2` domain;
- reservation/service ordering changes an ordinary Canvas/ProjectIndex edit winner.

Score: **9.2/10 for the proposed patch; the pinned authority set remains REJECT**.
The deductions are the deliberate no-active-editor availability failure, two bounded
complete verifier calls for one reset attempt and the cost of rotating the complete
exact bundle. These are nonfatal because reset is a low-frequency destructive path,
both verifier invocations are synchronous and I/O-free over capped bytes, ordinary
offline editing does not depend on this gate, Project reset remains the explicit
recovery fallback and Control stays pure, witness-free and permit-free. The score
falls below 7 if maximum-cap F13 cannot meet the accepted synchronous budget or if a
second final-currentness entry point is required.
