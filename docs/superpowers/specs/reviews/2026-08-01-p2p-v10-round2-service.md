# P2P v10 round-2 service reviewer decision

Status: **SIGN** for the exact R2-1..R2-9 clause set in this file. This is an
architecture vote, not permission to implement. A canonical semantic draft must
still be authored outside the primary task, hashed, and approved 3/3.

I fully reread the Canvas, causal-kernel and service first-round reviews plus the
round-2 matrix. I am withdrawing multiple first-round service positions. Agreement
is not the reason: the revised choices close proof gaps that my metadata-only design
left after causal history is pruned.

Normative terms MUST, MUST NOT, SHOULD and MAY use RFC 2119 meanings. All objects
below are closed and included in the final v2 protocol digest.

## R2-1 — Checkpoint trust

### Exact choice

Use a low-frequency, stateless **service content attester**. Only that attester may
issue `CheckpointContentCertificateV2` with
`contentStatus: "service-validated-causal-closure"`. The certificate binds exact
Project/document scope, project/shard/doc epochs, checkpoint digest, validated
parent certificate digests, computed maximal causal frontier and actor heads,
state-vector/canonical-state/full-update hashes, protocol/schema/canonicalizer/
validation-artifact digests, trust bundle and a purpose-separated service signature.

The attester receives one bounded binary `CheckpointValidationCarrierV2`, streams it
to ephemeral storage, and runs the same frozen portable validator used by peers. It
MUST verify:

1. proposer authorization and long-lived replica signature;
2. every parent certificate and exact parent payload;
3. the complete suffix causal DAG, actor chains and exact base reconstruction;
4. typed-intent materialization, closed Yjs diff/write evidence, ProjectIndex and
   Canvas schemas, resource proofs and cross-entity invariants;
5. the resulting state vector, canonical state, snapshot bytes and computed maximal
   frontier/actor heads.

Persistent service state contains only certificates, digests, computed bounded
inventory/frontier metadata, idempotency and audit counters. Snapshot, Yjs update,
frame, intent, Plugin state, Project file and blob bytes MUST NOT enter durable DB,
object storage, logs, traces, analytics, exception bodies or retry queues. Ephemeral
bytes are destroyed after success or failure.

This is a separate deployment capability reached through a typed Service Binding or
equivalent port; the ordinary Cloudflare routing worker does not buffer, parse or
validate a 320 MiB carrier. `apps/api` may call only the browser-safe public
`@convax/project/collaboration-protocol` verifier composition and generic
`@convax/collaboration` codecs. Plugin validation artifacts supplied in the carrier
must be bounded, content-addressed declarative schemas; arbitrary Plugin JavaScript
is never executed by the attester.

If the attester resource/determinism/privacy spike fails, content-authoritative
compaction is disabled and complete genesis history remains retained. The service
MUST NOT fall back to a metadata-only “valid” certificate.

### First-round clause withdrawn

I withdraw service-review C2/C9 and the signed summary clauses stating that service
never receives or validates checkpoint content, that publication receipts remain
`unverified-peer-content` for pruning, and that peers plus all-active signatures can
replace a content certificate after pruning. Metadata-only header publication may
exist as a non-pruning candidate stage, but it has no checkpoint acceptance,
frontier or GC authority.

### Strongest objection

The attester is a central semantic trust/privacy/availability boundary. A compromised
signing key or drifting verifier can certify bad team state, and the carrier is a
serious compute/ingress DoS surface. This design is invalid if end-to-end secrecy
from the service is a requirement. Under the current threat model, purpose-separated
keys, peer-replayable certificates, deterministic shared code, strict quotas and
payload-zero durable audit are stronger than turning historical editors into an
implicit snapshot authority.

### Falsifiable test

Run identical valid and malicious carriers in Bun, Chromium and the attester. Hidden
Y.Map writes, omitted causal dependencies, bad Plugin schema and forged frontier must
be rejected identically; a valid carrier must yield byte-identical computed hashes
and certificate input. After injected success/failure/crash, forensic scans of every
durable/log/trace adapter must find zero carrier payload bytes. A resource spike must
stream the C8 maximum without routing-worker buffering; failure disables compaction.

## R2-2 — Causal-stability coverage

### Exact choice

Every active replica whose current authorization can author offline edits for the
document—an **active editor replica**—must sign one persistent
`ReplicaCausalFloorAckV2`. Viewer replicas and transport-only sessions do not sign
causal floors because they cannot create old-base frames.

The ACK binds exact Project/document scope including `docEpoch`, content certificate
digest, certified frontier digest, signer replica/actor identity, signer actor
head/next sequence at ACK, exact membership snapshot digest and long-lived replica
signature. Before signing, the replica MUST:

- validate the certificate and checkpoint bytes;
- fsync checkpoint bytes and the new floor in native signer state;
- ensure every durable local frame is included in the certified closure;
- promise that every later frame base causally dominates this floor.

Service issues a `CausalStabilityCertificateV2` only when ACKs exactly cover all
active editor replicas in one still-current membership snapshot. A concurrent role,
replica or membership change invalidates an incomplete attempt. The service verifies
coverage and signatures, not checkpoint content again. A new/promoted editor cannot
receive edit authorization until it has bootstrapped the latest applicable certified
floor and signed an initial floor ACK.

History below the floor is prunable only after this certificate, at least one remote
durable checkpoint-holder ACK, and the absence of pending/outbox/recovery/
equivocation/audit references. An offline editor blocks compaction until it ACKs or
is explicitly revoked through the checkpoint cutoff. A timeout never silently
retires edit authority.

### First-round clause withdrawn

I withdraw service-review C4's inclusion of viewers and all generic active replicas.
Coverage is exactly replicas currently authorized to author offline frames. I retain
the signed monotonic floor requirement and the distinction between replication ACK
and causal stability.

### Strongest objection

One lost editor device can block compaction forever, and an administrator may revoke
it merely to reclaim storage, sending its unseen work to recovery. That is the
unavoidable conjunction of indefinite offline edit authority and exact-base
validation. Counting viewers would add cost without closing a causal risk; omitting
an editor would silently destroy its legal base.

### Falsifiable test

Keep editor C offline while A/B certify checkpoint Q and viewers V1/V2 remain
online. A/B plus viewers must not authorize pruning; C's editor floor is required.
After C merges and ACKs, pruning may proceed without viewer ACKs. In another run,
revoke C at an exact cutoff, certify A/B coverage, then submit C's old-base frame;
it must be recovery-only. Promotion of V1 to editor must fail until it installs and
ACKs the current floor.

## R2-3 — Actor sequence genesis

### Exact choice

The first frame in every actor/document/docEpoch chain has canonical decimal
`actorSequence: "1"` and `previousActorFrameDigest: null`. Every successor is exact
unsigned `+1` with the immediate predecessor digest. `"0"` is reserved for an
explicit no-frame/genesis boundary in codecs and diagnostics; an absent actor head
is still represented by a closed nullable field, never inferred from a missing key.
Leading zeroes, negative values, overflow and gaps fail closed.

### First-round clause withdrawn

None. I retain first-round service C6. The causal-kernel zero-origin clause must be
withdrawn.

### Strongest objection

Zero-based chains are mathematically clean and nullable absence already removes the
need for a sentinel. This is convention, not safety. Start-at-one is selected
because two protocols are worse than either convention and the explicit zero
genesis boundary makes logs/checkpoint boundary fixtures easier to audit.

### Falsifiable test

Cross-runtime golden vectors must accept `1/null`, then `2/exact-prior`; reject
`0/null`, `1/non-null`, `2/null`, gaps, duplicates, leading-zero strings and u64
overflow before candidate mutation.

## R2-4 — Document epoch

### Exact choice

Keep `docEpoch` as part of every `DocumentScopeV2`, frame, checkpoint, causal floor,
cutoff, holder claim and signature domain. It is a document collaboration-history
universe, distinct from route/storage incarnation `shardEpoch` and whole-Project
`projectEpoch`.

`docEpoch` changes only through an explicit, signed document-universe reset with one
closed reason:

- `user-confirmed-document-reset`;
- `incompatible-document-schema-reset`;
- `unrecoverable-document-corruption`;
- `logical-counter-exhaustion`.

The reset preserves old bytes/recovery references, publishes a new genesis and
starts actor sequences at 1. Checkpointing, compaction, member join, role change,
replica revoke/rotation and session renewal MUST NOT change docEpoch. A routine
revoke uses authorization epoch plus cutoff. Deleting/recreating a Canvas route uses
a new Canvas identity/shardEpoch rather than abusing docEpoch.

### First-round clause withdrawn

I withdraw service-review C7 and its claim that `shardEpoch` alone is the document
reset fence. I retain the rejection of docEpoch rollover for routine authorization.

### Strongest objection

Project, shard, document and authorization epochs create a replay-sensitive scope
matrix and invite operators to use reset as corruption recovery without evidence.
The mitigation is one canonical `DocumentScopeV2` codec, a closed reset reason,
explicit user confirmation where data is discarded, and signature golden vectors;
collapsing semantically distinct fences merely hides the complexity.

### Falsifiable test

Join, revoke, session rotate, checkpoint and compact a Canvas: docEpoch must remain
byte-identical. Reset one Canvas for each allowed reason and prove only that
document's docEpoch changes, old frames fail as wrong universe, old bytes remain,
new chains start at 1 and sibling Canvas/ProjectIndex editing continues.

## R2-5 — Frozen bounds

### Exact choice

Freeze these v2 limits from one generated constants source:

| Object | Hard limit |
| --- | ---: |
| frame JCS/binary header | 64 KiB |
| canonical typed intent, including guard | 512 KiB |
| semantic guard within the intent | 256 KiB |
| causal context | 64 KiB |
| base state vector | 64 KiB |
| Yjs delta | 1 MiB |
| actual write evidence | 256 KiB |
| complete causal frame | 2 MiB |
| one document checkpoint snapshot | 32 MiB |
| checkpoint direct parents | 8 |
| certified maximal checkpoint antichain | 8 |
| live causal frontier heads | 256 |
| attester validation carrier | 320 MiB |
| parent snapshot bytes within carrier | 256 MiB |
| suffix within carrier | 64 MiB and 4,096 frames |

Every independent section cap and the complete-object cap applies; an inner legal
value never waives the 2 MiB frame limit. Blob/media bytes are prohibited and travel
on the separate blob channel. If eight incomparable certified checkpoints already
exist, a ninth non-consolidating checkpoint fails
`checkpoint-consolidation-required`; ordinary edits continue. A proposer must merge
the current certified antichain, using at most eight parents, while including its
local causal closure.

### First-round clause withdrawn

I withdraw service-review C8's 256 KiB intent, 512 KiB write evidence and 32
checkpoint parents/tips. I adopt 512 KiB intent, 256 KiB evidence and certified
parent/antichain cap 8.

### Strongest objection

A 512 KiB intent and 320 MiB attestation carrier are large hostile inputs, while an
eight-way partition can stall new checkpoints. Length/depth/count checks must happen
before allocation or Yjs decode, attester ingress must be streamed/rate-limited, and
the caps are ceilings rather than expected payloads. Raising the antichain to 32
would multiply bootstrap and attestation cost without evidence that eight cannot be
consolidated.

### Falsifiable test

Generated fixtures at each exact boundary succeed and `+1` byte/item fails before
large allocation. A case where every section is legal but the complete frame exceeds
2 MiB must fail. Eight incomparable checkpoints certify; a ninth non-consolidating
proposal is rejected; a valid eight-parent merge collapses the antichain and permits
the next checkpoint. The max carrier is streamed without routing-worker buffering.

## R2-6 — Frontier authority and invalid children

### Exact choice

Only the R2-1 attester computes checkpoint causal closure, actor heads, dominance and
maximal frontier from validated carrier content. Proposer-declared direct parents are
bounded lookup/binding data, not proof of dominance. Service anchor is the
arrival-independent `Max` union of certified valid checkpoint frontiers and retains
every incomparable certified checkpoint up to R2-5.

An invalid child receives no content certificate and cannot enter the certified
anchor, remove parent certificates/holders/floors or trigger their GC. A valid child
replaces a parent in the maximal set only when the verifier proves causal dominance.
`anchorRevision` and publication time are metadata CAS/rollback controls only and
MUST NOT enter edits, Lamport clocks or business projection.

### First-round clause withdrawn

I withdraw service-review C9 and the declared-tip/content-unverified frontier model.
Unverified headers, if retained for diagnostics or pending publication, are kept in
a separate bounded candidate catalog and never affect the certified anchor.

### Strongest objection

The attester verifier and signing key become a high-impact single correctness
boundary: a dominance bug can authorize global pruning. Peers must be able to replay
the certificate while history exists, verifier artifacts are digest-pinned, and
cross-runtime model tests must prove `Max` is commutative, associative and
idempotent. Arrival order or declared parents cannot serve as a fallback.

### Falsifiable test

Submit valid incomparable A/B, invalid C claiming A/B, and valid D actually merging
A/B under every publication permutation. The certified anchor must be A+B before D
and D after it; C never changes it or hides A/B. Changing `anchorRevision` alone
must not change any Canvas/ProjectIndex hash.

## R2-7 — Document discovery

### Exact choice

Service stores a grow-only `CertifiedDocumentInventoryV2` as derived checkpoint
metadata, never as independently writable Project/route state.

ProjectIndex scope is created with Project collaboration genesis. A Canvas inventory
entry is inserted atomically only when the attester certifies a Canvas genesis whose
carrier proves an exact **already certified ProjectIndex staged route** for the same
`{canvasId, shardEpoch, docEpoch}`. The inventory entry binds:

- document scope;
- certified staged-route checkpoint and route digest;
- Canvas genesis content-certificate digest;
- registration sequence and prior inventory digest.

It stores no independently mutable title, URI, location or live/closed decision.
Entries remain through route tombstone until projectEpoch reset, providing bootstrap
and cutoff coverage. Peers reconstruct certified ProjectIndex to decide
`staged/live/closed`; inventory cannot activate, close, rename, resurrect or hide a
Canvas. Registry/inventory responses are service-signed, monotonic and checked
against the client's durable sequence/digest high-water.

The creation dependency is acyclic:

1. ProjectIndex typed intent creates staged route;
2. attester certifies a ProjectIndex checkpoint containing that route;
3. attester certifies Canvas genesis bound to that staged-route certificate and
   atomically inserts inventory scope;
4. ProjectIndex activation intent binds the Canvas genesis certificate.

Offline peers may create/sync staged route and uncertified genesis locally, but new
device/service discovery waits for certification. At revoke, a target actor's frames
in an unknown/unregistered document scope have no survival cutoff and are recovery
only. A later inventory entry is valid only if its certified route/genesis closure
does not depend on excluded target frames.

### First-round clause withdrawn

I withdraw service-review C10's current-editor-signed unverified scope registration.
There is no public arbitrary document-registration endpoint. The inventory is
derived from the joint certified ProjectIndex-route/Canvas-genesis proof above.

### Strongest objection

Attester outage delays registration and fresh-device discovery for a Canvas created
offline, and the four-step staged protocol is more operationally complex. Direct
editor registration is simpler but lets an authorized malicious editor exhaust the
registry and makes unverified metadata look like a Project fact. Existing seeded
peers remain able to edit/sync while certification is unavailable.

### Falsifiable test

Try unsigned/fake genesis, valid genesis without a certified staged route, scope
mismatch, duplicate exact registration and same Canvas with conflicting epochs.
Only the exact joint certified proof inserts once. Direct inventory mutation cannot
create or expose a Canvas. Tombstone the route: the inventory entry remains while
every client projection closes it. Roll back inventory sequence/digest and require
fail-closed discovery.

## R2-8 — Generation owner loss

### Exact choice

Retain flat containment, begin-time generation output priority, delete-wins and
owner-only success/failure. Replace singleton generation terminal storage with
actor-owned terminal slots and add one exact cross-device recovery variant:

```ts
type GenerationTerminalClaimV2 =
  | OwnerGenerationTerminalV2
  | {
      format: "convax.canvas-generation-terminal/2"
      phase: "failed-recovery"
      generationId: string
      beginDigest: string
      beginActorId: string
      claimantActorId: string
      cutoffProofDigest: string
      failureCode: "generation-owner-revoked"
    }
```

Normal `succeeded`/`failed` owner terminal is writable only in the begin actor's slot
and requires exact begin/no prior owner terminal. A non-owner current editor may
write only `failed-recovery` in its own slot after the outer verifier proves a
service-signed cutoff where:

- the begin actor is revoked or replaced;
- the cutoff closure contains the exact begin;
- the cutoff closure contains no valid owner terminal for that generation;
- the claim's Canvas/document epochs and proof digest match.

Canvas stores only the proof digest/claim and consumes an outer verified operation
context; it never calls membership service. A valid owner terminal in the surviving
cutoff closure has priority. Otherwise a valid recovery failure suppresses active
lifecycle/output; multiple recovery claims converge by maximum portable stamp but
have the same failure semantics. An old owner terminal outside cutoff is recovery
data and cannot override. No non-owner can claim success or fabricate output.

### First-round clause withdrawn

I withdraw service-review C14's “no cross-device termination in v2.” I do not adopt
an unrestricted concurrent dismissal: another editor must prove owner revocation by
the exact cutoff.

### Strongest objection

Owner loss cannot be resolved offline until an admin revokes the device and the
cutoff is certified; the schema and outer proof path are more complex. Allowing any
editor to dismiss immediately is available but lets one peer suppress an active
legitimate result without an authorization event. Waiting for cutoff is the safer
boundary; users may still delete/supersede the node through ordinary semantics.

### Falsifiable test

Lose a begin owner's device. A non-owner claim without cutoff, with a cutoff that
omits begin, or with a cutoff containing owner terminal must fail. After exact revoke
cutoff includes begin/no terminal, two editors may concurrently write recovery
claims; all orders project the same failed lifecycle. Deliver old-owner success
outside cutoff and prove it remains recovery-only; a surviving certified owner
success must defeat recovery creation.

## R2-9 — Undo coordinator

### Exact choice

`@convax/collaboration` owns an in-memory, window/session-scoped
`SessionUndoCoordinator` of durable local root operation ids. It is the sole
undo/redo selection cursor. It is not Project/Canvas domain state and is not restored
across process restart, full document rebuild, project/doc epoch reset or corruption
recovery.

After a normal local root frame crosses the durable head barrier, the coordinator
pushes its root id and clears redo. Remote/bootstrap/recovery frames neither enter
nor clear/reorder the cursors. Undo/redo peeks, but does not pop, one root; Canvas
materializes a closed semantic inverse/forward intent against the latest replicaDoc
with exact retained material and current guards. Only after that new semantic frame
is durable does the coordinator move the root between cursors. Validation failure
leaves both unchanged.

If the domain frame commits but the in-memory cursor transition fails, domain state
remains committed, the coordinator clears itself and reports
`history-reset-after-commit`; it never reverses the frame. Durable Canvas semantic
history guards prevent the same inverse from being accepted twice.

Raw `Y.UndoManager` updates never touch authoritative `replicaDoc`, journal or wire.
`Y.UndoManager` is optional local capture/metadata only and MUST NOT be used through
private stack mutation. If public APIs cannot preserve the above commit ordering, it
is omitted. React Flow/history stores never own undo.

### First-round clause withdrawn

No semantic withdrawal from service-review C15. I strengthen it by making the
dedicated coordinator mandatory and resolving the post-domain-commit cursor failure.
The kernel claim that UndoManager selects/materializes roots must be withdrawn unless
it is only optional metadata behind this coordinator.

### Strongest objection

This rejects the preference to delegate undo to Yjs and creates a second transient
stack. A generic Yjs inverse cannot enforce current Convax business guards or commit
its own stack movement after native durability. The coordinator is transient UI/
session selection, not a second durable document authority; semantic history remains
inside Y.Doc.

### Falsifiable test

Commit local L1, remote R1, local L2. A stale L2 inverse must fail without cursor
movement; after a legal semantic undo, exactly one durable frame commits before L2
moves to redo and R1 remains. Inject failure before frame durability, after frame
durability and during cursor move; verify no raw UndoManager update enters Y.Doc,
journal or wire, no duplicate inverse is accepted, and restart always clears cursors.

## Round-2 integrated threat model and package boundary

The signed clause set assumes:

- the service membership/checkpoint signing roots and stateless attester are trusted
  to run the digest-pinned verifier; compromise can certify invalid state;
- authorized replicas may be buggy or malicious, including equivocation, but a
  valid service content certificate is not derived from replica honesty alone;
- client wall clocks, PeerJS, peerId, Yjs client ids and network arrival are never
  identity, authorization or conflict-order inputs;
- no online holder means no new-device bootstrap; service certificates are not
  payload backup;
- end-to-end secrecy from the attester is not promised. Adding it requires a new
  proof/encryption architecture review.

Ownership remains:

- `@convax/collaboration`: generic binary/causal/checkpoint carrier codecs, exact-base
  kernel, floor/undo coordination and headless ports;
- `@convax/canvas`: Canvas schema, intents, generation/containment projection and
  portable validation;
- `@convax/project`: ProjectIndex, resource/route semantics and the browser-safe
  composite collaboration-protocol export;
- `@convax/project/node`: sole local native durable writer and ephemeral/native
  adapters;
- `@convax/desktop`: PeerJS, OS-vault/session composition and renderer projection;
- `apps/api`: membership, attestation orchestration, certified inventory/frontier
  metadata and signers through public browser-safe exports only.

No service route imports Desktop, native Project adapters, a concrete Plugin, or
private Canvas/Project source.

## Strongest overall objections and flaw types

1. **Central semantic signer:** despite P2P edit transport, checkpoint trust is
   centralized. A compromised attester can poison future bootstrap after history is
   pruned. This is the largest residual security risk and requires key isolation,
   verifier reproducibility and audit.
2. **Offline versus bounded retention:** one lost editor blocks compaction until
   explicit revoke, and revoke strands honest unseen work. No clause can remove this
   CAP-style tradeoff without online edit ordering or unlimited history.
3. **Protocol complexity:** exact-base replay, content attestation, floors, cutoff,
   generation recovery, semantic undo and separate blob ACK form a distributed
   database protocol. If product requirements later relax offline/P2P constraints,
   a server sequencer may be cheaper.

The first-round disagreements exposed direct contract conflicts (sequence/version),
invalid hidden assumptions (published checkpoint implies stable writers), logical
jumps (signed metadata implies valid content), omitted lifecycle (lost generation
owner) and authority leakage (local durable facts on wire, service registry as route
truth).

## Falsifiable integrated gate

Before implementation, three executable spikes MUST pass:

1. deterministic stateless attester across Bun/Chromium/service at C8 bounds,
   including malicious Yjs corpus, ephemeral cleanup and payload-zero durable audit;
2. three-editor floor/cutoff/compaction fixture with a long-offline actor, actor-key
   clone, new editor promotion and exact-base validation after prune;
3. Canvas fixture covering generation owner revoke/recovery claims and semantic undo
   crash points under all relevant two-/three-peer delivery permutations.

Any failed spike returns the canonical candidate to architecture review. It MUST NOT
be “fixed” by metadata-only certificates, service arrival order, silent actor timeout,
raw Yjs undo, document-wide version or hidden LWW.

## Score and signature

The first-round three-draft set remains **5.6/10** and blocked. This round-2 clause
set scores **8.4/10**. Deductions: 0.7 for central attester compromise/privacy risk,
0.5 for offline actors blocking compaction and revoke stranding work, and 0.4 for
implementation/protocol complexity. These are not fatal under the explicit threat
model because none becomes an arrival-dependent business winner, silent data loss
or duplicate document authority; each has a fail-closed state and falsifiable gate.

**Decision: SIGN.** I am willing to sign a canonical semantic draft only if it is
semantically identical to all R2 clauses above and carries the unanimous round-1
directions. Formatting/name normalization may not weaken the attester, active-editor
floor, exact cutoff/base, certified inventory, generation recovery or semantic undo
boundaries.
