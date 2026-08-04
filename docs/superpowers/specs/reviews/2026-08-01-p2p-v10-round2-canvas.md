# P2P v10 round-2 Canvas architecture decision

Status: **SIGN** for the exact R2-1 through R2-9 clause set in this file; this is
not a signature on any first-round draft and does not authorize implementation.

Reviewer: `/root/canvas_intent_runtime`

Inputs read in full:

- `reviews/2026-08-01-p2p-v10-canvas-review.md`
- `reviews/2026-08-01-p2p-v10-kernel-review.md`
- `reviews/2026-08-01-p2p-v10-service-review.md`
- `2026-08-01-p2p-collaboration-round2.md`

The second reading changes two material first-round positions. A service content
attester violates the intended API/data-plane boundary and is not necessary if
safe pruning requires unanimous validation by every still-authorized editor
replica. Also, `docEpoch` has no invariant distinct from the already Project-owned
`shardEpoch`; retaining both would create two document-reset authorities.

The threat model selected below is explicit: the protocol detects and rejects a
malicious replica while at least one active editor replica at the stability witness
is honest. It does **not** protect a future bootstrap from a checkpoint on which the
complete then-active editor set colluded. It also does not provide progress when one
active editor remains offline forever. A stronger Byzantine threat model requires
a separately approved attester/proof system and is not silently claimed here.

## R2-1. Checkpoint trust

### Frozen choice

The service never receives, parses, validates, logs, or stores Yjs updates,
snapshots, typed intents, causal-frame payloads, Plugin state, or Project blobs.
Checkpoint headers are initially `unverified-peer-content` discovery claims.

A checkpoint becomes `peer-validated-all-active-editors` only when every active
editor replica in one exact membership snapshot has independently:

1. reconstructed the checkpoint's causal closure from an already stable checkpoint
   or genesis plus exact suffix frames;
2. verified every frame signature, exact causal base, typed intent, closed Yjs diff,
   owner schema, Plugin validation artifact, ProjectIndex dependency, and
   cross-entity invariant;
3. recomputed identical frontier, actor-head, state-vector, canonical-state, and
   full-update digests;
4. fsynced the exact checkpoint bytes and a local compaction fence; and
5. signed one `ReplicaCheckpointValidationAckV2` over those values with its
   long-lived replica key.

The service verifies only signature, authorization, exact active-editor coverage,
canonical equality of all signed values, bounds, and membership-snapshot currency.
It then signs a `CausalStabilityWitnessV2` whose content status is exactly
`peer-validated-all-active-editors`. The witness is a statement about unanimous
historical editor attestation, not service content validation. A membership change
invalidates an incomplete witness attempt.

Before such a witness, checkpoint bytes are candidates and cannot authorize
history pruning. After legal pruning, a new device validates the checkpoint's
closed snapshot/schema and trusts the historical editor witness for the deleted
causal derivation under the threat model above.

### Withdrawn first-round clause

Withdraw Canvas-review C2 in full, including “use a low-frequency stateless content
attester,” and withdraw C9's dependency on service-computed causal closure. Also
withdraw blocking objection 1 insofar as it selects service content attestation;
the unresolved checkpoint conflict is closed by this peer witness instead.

### Strongest rebuttal

Replica signatures prove that keys attested, not that validators actually ran. If
every active editor key is malicious or copied, they can bless invalid history and
mislead a later honest member after pruning. This is the strongest reason to retain
a service attester. The round-2 choice accepts that limit because an attester would
cross the API/Canvas ownership boundary and create a central content/privacy/DoS
surface; it does not describe peer signatures as cryptographic proof of execution.

### Falsifiable test

Use three active editor replicas. Give one an invalid hidden-Y.Map checkpoint and
make two honest replicas reject it: the service must be unable to create a witness,
even if the proposer published a valid header. For a valid checkpoint, all three
must sign byte-identical computed values and service may create one idempotent
witness without ever receiving payload bytes. Store/log/trace probes finding one
payload byte, or a witness created with one editor ACK missing, falsify this choice.

## R2-2. Stability coverage

### Frozen choice

Coverage is **every active editor replica**, not every member, session, online peer,
or viewer. “Active” is taken from the exact service-signed membership snapshot and
means authorized to create portable edit frames, regardless of whether the device
currently has a session. Every such replica's R2-1 ACK simultaneously installs a
monotonic per-document base floor: all its later frames must causally dominate that
checkpoint frontier.

Viewers do not sign a required floor because they cannot create old-base work and
are not required to persist every document. They may independently validate for
diagnostics, but their absence cannot block compaction.

A new replica or viewer-to-editor promotion enters `writer-joining`, not `editor`
frame authority. It must bootstrap each document it will edit from the current
stable witness, fsync it, and sign an `EditorActivationFloorAckV2`. Only then may the
service issue active editor frame authority. A newly created document similarly
requires that editor's first per-document floor before it writes that shard.

An indefinitely offline active editor blocks pruning. The only escape is explicit
replica revoke/replace plus the agreed checkpoint-set cutoff and recovery semantics;
there is no timeout, session-expiry inference, or majority override.

### Withdrawn first-round clause

Retain Canvas-review C4's “authorized offline-capable actor” coverage but withdraw
its requirement that the floor point to a service content certificate. Replace it
with the R2-1 all-active-editor peer-validation witness. Clarify that viewers were
never included by “offline-capable actor.”

### Strongest rebuttal

One forgotten editor laptop can retain causal history forever, while excluding
viewers weakens content attestation compared with an all-replica set. Including
viewers would make ordinary read-only devices a permanent storage/availability
lease. The selected invariant follows write authority: only actors able to create
old-base frames can block causal stability. The threat model therefore requires at
least one honest active editor, not merely an honest viewer.

### Falsifiable test

With editors A/B and viewer V, let A ACK and take B offline. V may remain offline,
but pruning must still fail because B is missing. After B validates/ACKs, pruning
may proceed without V. Promote V to editor: V must be unable to sign an edit until
its activation floor is durable. Revoke B instead of obtaining its ACK and verify
B's below-cutoff work becomes recovery-only.

## R2-3. Actor sequence genesis

### Frozen choice

The first frame for an exact
`{projectId, projectEpoch, docKind, docId, shardEpoch, actorId}` chain has
`actorSequence="1"` and `previousActorFrameDigest=null`. Every successor is exact
unsigned `+1` and cites the immediately previous digest. Decimal strings are
canonical, have no leading zeroes, and are bounded by uint64. Value `"0"` is
reserved for empty/genesis boundary encodings and never identifies a real frame.
Overflow freezes that actor/shard chain until an explicit shard replacement or
Project reset.

### Withdrawn first-round clause

None. This retains Canvas-review C6 and rejects kernel-review C6's zero-based chain.

### Strongest rebuttal

Zero-based chains are mathematically clean and nullable heads already represent
absence, so reserving zero is not required for correctness. The benefit is
operational: zero remains an unambiguous empty boundary across stores, vectors, and
diagnostics. Either choice works; carrying both does not.

### Falsifiable test

Cross-runtime golden vectors must accept exactly `1/null`, then
`2/digest(frame1)`. They must reject first sequence 0, first sequence 2, a non-null
predecessor at 1, leading-zero encodings, gaps, duplicates with another digest, and
overflow.

## R2-4. Document epoch scope

### Frozen choice

There is no independent `docEpoch`. The complete document-chain scope is:

```text
{projectId, projectEpoch, docKind, docId, shardEpoch, actorId}
```

`projectEpoch` is the explicit destructive reset fence for the complete Project
collaboration universe. `shardEpoch` is the sole Project-owned identity for one
ProjectIndex or Canvas collaboration-history universe. Checkpoint, compaction,
membership mutation, revoke, session renewal, and Plugin update never change it.

Replacing one Canvas history because of an incompatible schema, unrecoverable
corruption/equivocation, or clock/sequence exhaustion is an explicit Project route
operation that creates a new `shardEpoch`, new genesis, and preserved old recovery
bytes. ProjectIndex history replacement requires `projectEpoch` reset because it is
the owner of every Canvas route. A deleted Canvas is not revived by changing an
epoch; recreation uses a new Canvas identity and shard.

### Withdrawn first-round clause

Withdraw Canvas-review C7 and every N7 statement that retains `docEpoch`. The
failure-containment goal is retained but assigned exclusively to Project-owned
`shardEpoch`, eliminating overlapping reset authorities.

### Strongest rebuttal

A collaboration-owned `docEpoch` could isolate a Canvas repair without mutating
Project route metadata. That convenience is exactly the ownership problem: a
document universe cannot change while ProjectIndex still routes peers to the old
universe. An explicit Project route transition is required anyway, so a second
token adds scope and replay risk without a separate invariant.

### Falsifiable test

Revoke a replica, rotate sessions, and compact; every frame scope remains unchanged.
Then explicitly replace one Canvas shard: only that Canvas obtains a new
`shardEpoch`, old frames fail as wrong-scope/recovery, sibling Canvases remain
writable, and ProjectIndex records the route transition. Any hidden inner epoch or
ordinary revoke changing shard scope falsifies this choice.

## R2-5. Protocol bounds

### Frozen choice

Freeze these v2 limits from one generated constants source:

| Object | Hard limit |
| --- | ---: |
| canonical typed intent, including guard | 512 KiB |
| semantic guard subset | 256 KiB |
| causal context | 64 KiB |
| exact base state vector | 64 KiB |
| one Yjs delta | 1 MiB |
| actual write evidence | 256 KiB |
| binary/JCS frame header | 64 KiB |
| complete causal edit envelope | 2 MiB |
| full checkpoint Yjs update | 32 MiB |
| checkpoint direct parents | 8 |
| peer-validated stable checkpoint tips | 8 |
| unverified candidate catalog tips | 32 total, 4 per replica |
| maximal causal frontier heads | 256 |
| result entities / logical writes | 512 / 2,048 |

Every inner cap is subordinate to the complete-envelope cap. Lengths are checked
before allocation/Yjs parsing. A ninth stable incomparable checkpoint cannot be
promoted; an all-editor-validated merge must first dominate one or more current
stable tips. Unverified candidate pressure cannot remove stable tips or fallback
headers. Candidate tips use the separate 32/4 availability quota and are not
pruning authority.

### Withdrawn first-round clause

Retain Canvas-review C8's 512 KiB intent, 2 MiB frame, 32 MiB snapshot, and stable
8/8 limits. Withdraw only its implication that every catalog tip class shares the
same limit; unverified discovery candidates use the separate 32-total/4-per-replica
quota above.

### Strongest rebuttal

512 KiB JSON remains a substantial parser/validator DoS surface, while eight stable
tips can stall checkpoint progress after many partitions. The total frame cap,
preallocation checks, per-peer queues, and required merge bound the first risk. The
second is deliberate: bootstrapping or validating 32 independent 32 MiB stable
snapshots is not an acceptable hidden cost. Ordinary edit replication continues
while checkpoint consolidation is pending.

### Falsifiable test

Generate exact-boundary and plus-one fixtures for every row, including a frame whose
sections are individually legal but total 2 MiB + 1. Fill candidate tips from one
replica and reject its fifth; allow 32 across replicas without changing stable tips.
Promote eight incomparable valid tips, reject a ninth promotion, then accept a
validated merge and resume checkpoint progress.

## R2-6. Frontier authority and invalid children

### Frozen choice

The service maintains two disjoint projections:

1. `declaredCandidateTips`, derived from bounded author-declared parent metadata,
   used only to find unverified bytes and always returning retained parent fallback;
2. `stableTipDigests`, updated only by an R2-1 all-active-editor stability witness.

Each `ReplicaCheckpointValidationAckV2` signs the validator-computed maximal
frontier/actor heads and a sorted `dominatedStableTipDigests` list. Every ACK in the
witness must contain identical values. The service does not compute reachability;
it verifies coverage and signed-value equality, then applies deterministic set
algebra: remove only stable tips unanimously attested as causally dominated, add the
new stable checkpoint, canonical-sort, and enforce the R2-5 limit of eight.

An invalid child remains only an unverified candidate. It never changes
`stableTipDigests`, never deletes parent/header/holder/witness metadata, and cannot
hide stable parents from bootstrap. Publication order and catalog sequence are
anti-rollback metadata only, never conflict winners.

### Withdrawn first-round clause

Withdraw Canvas-review C9's service-attester computation of causal closure and
frontier. Retain its invalid-child rule, but make unanimous editor validation ACKs
the content/dominance authority and the service only the coverage/set-algebra
authority.

### Strongest rebuttal

The service trusts all editor signatures about dominance and cannot detect a fully
colluding set. It also carries more catalog states than a single computed anchor.
That is the explicit R2-1 threat model. Keeping stable and candidate tips disjoint
prevents one malicious editor from converting an unverified declaration into
pruning or bootstrap authority.

### Falsifiable test

Publish valid stable A/B and invalid C declaring both as parents. C may appear in
candidate discovery, but A/B remain stable and retrievable. Withhold one honest
editor ACK and prove C cannot promote. Then submit valid D whose complete ACK set
identically attests dominance of A/B; stable tips become only D in every ACK and
publication ordering. A same-set witness with differing frontier bytes must fail.

## R2-7. Service document discovery

### Frozen choice

The service owns no Project route catalog. It stores a bounded, grow-only
`CollaborationScopeRegistryV2` with two explicit states:

1. `registered-candidate`: a discovery/security-superset entry created
   idempotently by a current editor's signed `DocumentRegistrationClaimV2` binding
   `{projectId, projectEpoch, docKind, docId, shardEpoch}`, registration id,
   ProjectIndex route-proof digest, and genesis-checkpoint-header digest. The
   service validates identity, signature, scope, quota, and idempotency only; it
   does not read ProjectIndex or call the route live.
2. `peer-validated`: the same scope after an all-active-editor witness validates
   its genesis and exact staged ProjectIndex dependency. This transition is
   monotonic and does not imply the route is currently live.

ProjectIndex scope is registered at Project creation. Entries remain until
`projectEpoch` reset. **Outstanding** candidate entries are bounded at 4 per active
replica; all retained entries are bounded at 1,024 per member and 4,096 per Project.
Promotion frees an outstanding-candidate slot but does not delete the entry.
Registry sequence/digest are service-signed and clients retain a durable
anti-rollback high-water.

Revocation cutoff exact-covers the `peer-validated` scope inventory. Target frames
in candidate/unknown scopes are recovery-only by default; they cannot make revoke
unavailable. Candidate scopes may be returned for discovery, but only reconstructed
ProjectIndex decides whether a Canvas is `staged/live/closed` and visible. A
registry entry can never create, activate, tombstone, rename, or revive a Canvas.

### Withdrawn first-round clause

Withdraw Canvas-review C10's requirement that only a certified Canvas genesis may
create the first registry entry. Registration is an explicitly unverified bounded
candidate claim; only promotion and cutoff coverage require the all-editor witness.
Also withdraw the phrase “append-only service document registry” where it could be
read as route authority; the exact owner is the two-state collaboration-scope
security/discovery index above.

### Strongest rebuttal

An authorized editor can consume candidate quotas with fake scopes, and the service
temporarily stores metadata not present in ProjectIndex. Treating it as a bounded
unverified superset prevents semantic divergence but not availability DoS. Per-
replica/member quotas, rate limits, signed evidence, and revoke contain the damage;
preventing it completely would require service content validation or admin-only
Canvas creation.

### Falsifiable test

Register a fake scope and a real staged Canvas concurrently. Neither appears in UI
without ProjectIndex. The fake scope stays candidate and does not enter cutoff
coverage; the real scope becomes peer-validated only after unanimous genesis/route-
dependency ACKs. Deleting/tombstoning the real route leaves the registry entry but
hides the Canvas. Registry rollback, fifth candidate from one replica, and cutoff
omitting a peer-validated scope must all fail closed.

## R2-8. Generation owner loss

### Frozen choice

Withdraw arbitrary editor dismissal. Replace singleton terminal storage with flat
actor claims:

```text
generationTerminals/<generationId>/actor/<replicaActorId>
```

The begin actor alone may write the normal immutable `succeeded` or `failed`
terminal. Another active editor may write only an immutable
`failed-recovery` claim when the outer Project/collaboration verifier supplies a
`VerifiedGenerationRecoveryPermitV2` proving all of the following:

1. the exact begin is inside the target actor's signed revocation/replacement
   cutoff closure;
2. no owner terminal is inside that closure;
3. the begin actor is revoked/replaced in the current authorization snapshot; and
4. the recovery writer is a current editor and the cutoff/witness/artifact digests
   match the frame's exact causal dependency.

The portable claim stores the cutoff-proof digest and the fixed failure code
`generation-owner-unavailable`, with no actor-authored public message, not the
native permit. Canvas consumes the verified permit through a typed composition port;
it never reads membership/service state.

Projection chooses the legal owner terminal if one survived the cutoff. Otherwise
all legal `failed-recovery` claims project the same fixed failed state; the maximum
portable-order claim supplies provenance only. A target-owner terminal outside the
cutoff remains recovery bytes and cannot defeat the recovery claim. Non-owner claims
can never produce output or claim success. Begin-time output priority, delete-wins,
retained result history, and “redo does not restart generation” remain unchanged.

### Withdrawn first-round clause

Withdraw Canvas-review C14/N14's unrestricted
`generationDismissals[generationId][actorId]` and `canvas.generation.dismiss` rule,
including “concurrent dismissal wins.” Replace it with cutoff-proof-backed
`failed-recovery` actor claims. Retain the flat containment approval unchanged.

### Strongest rebuttal

A lost but not formally revoked device can still leave a generation active
indefinitely, and recovery requires service/cutoff material. That is intentional:
another editor may suppress a foreign execution result only after authority has
formally removed its owner. An ordinary cross-device cancel operation would need a
separate product contract and external-task cancellation semantics, not an implicit
recovery backdoor.

### Falsifiable test

Start generation G on A, then revoke A with a cutoff containing G but no terminal.
B's permit-backed `failed-recovery` must converge with a concurrent claim from C.
A's later success outside cutoff remains recovery-only. A non-owner success,
recovery without cutoff proof, proof for another actor/generation, or recovery when
an owner terminal is inside cutoff must all fail before mutating the candidate.

## R2-9. Undo coordinator

### Frozen choice

`@convax/collaboration` owns one Main/session-transient
`SessionUndoCoordinatorV2` per mounted Canvas. Its stacks contain only durable local
root operation ids plus retained receipt/material digests. The coordinator is the
sole selection/cursor authority:

- a successful durable local root appends to undo and clears redo;
- a remote frame enters neither stack and clears neither stack;
- semantic undo/redo frames are not new roots;
- preflight or candidate failure moves neither stack;
- only the durable-commit callback moves exactly one selected root between stacks;
- process restart, full replica rebuild, Project/Canvas scope replacement, or
  unmount clears both stacks.

Undo and redo always materialize new closed semantic intents against the latest
`replicaDoc`, use the ordinary candidate/frame/durability barrier, and replicate as
normal causal frames. Raw `Y.UndoManager` inverse bytes are never applied to the
authoritative doc, persisted, signed, or transmitted.

For v2, `Y.UndoManager` is not a normative dependency of selection or stack state.
It may be used only as non-authoritative diagnostics/capture metadata behind public
APIs; removing it must not change behavior or protocol bytes. No implementation may
mutate undocumented Yjs stack internals.

### Withdrawn first-round clause

Retain Canvas-review C15's dedicated semantic cursor. Withdraw only the permissive
wording that could let UndoManager “choose” roots; in v2 the coordinator is
unambiguously the sole cursor authority. This rejects kernel-review C15's unresolved
“UndoManager materializes but stack moves later” mechanism.

### Strongest rebuttal

This no longer gives undo/redo to Yjs and creates a custom transient stack. That is
not a second document truth: it selects local session intent receipts, while Y.Doc
remains the only durable Canvas state. Yjs raw inverse cannot enforce Convax resource,
Plugin, generation, creation-group, and delete-wins guards or defer stack movement
until after fsync through a supported public transaction.

### Falsifiable test

A commits roots A1/A2, B changes an unrelated field, and A undoes A2: B's change
survives, exactly one semantic frame is committed, and A2 moves only after fsync.
Repeat with B invalidating A2's inverse guard: failure leaves both stacks byte-for-
byte unchanged. Instrument Y.Doc transactions to prove no raw UndoManager inverse
origin reaches authoritative state or wire.

## Complete round-2 clause set decision

**SIGN.** I sign R2-1 through R2-9 only as the indivisible semantic set written in
this file. I do not sign the first-round drafts, and G2 remains closed until the
other two reviewers independently sign the same semantics and the resulting
canonical draft digest returns for final 3/3 approval.

The set respects the current package boundaries:

- `@convax/canvas` owns containment, generation claims, semantic inverse plans, and
  Canvas validation;
- `@convax/collaboration` owns generic frame/checkpoint validation-ACK cores,
  causal floors, exact-base kernel, and the session undo coordinator, but no
  membership coverage policy;
- `@convax/project` owns ProjectIndex routes, shard epochs, resource proofs, and the
  generation-recovery verification port; its browser-safe collaboration-protocol
  export owns Project-scoped membership/cutoff/registry/stability-witness DTOs and
  exact active-editor coverage rules;
- `@convax/project/node` owns local journal/blob durability and vault adapters;
- Desktop composes peer validation and PeerJS without owning a second document;
- API owns membership, registry metadata, signature/coverage checks, anti-rollback,
  and rendezvous, but never receives domain payload content.

## Strongest three objections to the signed set

1. **Peer unanimity is not proof of execution.** A fully colluding then-active
   editor set can certify invalid history for a future member. This is accepted only
   under the explicit at-least-one-honest-active-editor threat model; changing that
   threat model invalidates the SIGN decision.
2. **One offline editor blocks pruning and checkpoint stability indefinitely.** The
   only progress mechanism is explicit revoke/cutoff, which can strand honest local
   work. A timeout or session TTL cannot replace authorization.
3. **Candidate registry/tip metadata remains an authorized-editor DoS surface.**
   Quotas make it bounded but do not make it impossible. Eliminating it requires a
   content-aware service or stricter admin-only creation policy.

## Flaw classification and score

The first-round disagreement exposed a **hidden threat-model assumption** (who may
be malicious after pruning), an **ownership violation** (server-side Canvas/Plugin
semantic validation), a **duplicate reset authority** (`docEpoch` plus
`shardEpoch`), a **logical jump** (declared checkpoint parent means dominance), and
an **omitted lifecycle** (lost generation owner).

This exact round-2 clause set scores **8.3/10**. The remaining deductions are for
the explicit complete-editor-collusion gap, offline-editor compaction blocking, and
bounded metadata DoS. They are not immediately fatal because each produces a
deterministic fail-closed state or an explicit admin/product decision rather than
arrival-dependent state, silent overwrite, or package-boundary leakage. The score
falls below 7 and this signature is withdrawn if the product requires Byzantine
safety against the complete active editor set, timeout-based compaction, or
always-available no-holder bootstrap.

The whole-file SHA-256 is reported as a detached handoff value because embedding it
would change the hashed bytes.
