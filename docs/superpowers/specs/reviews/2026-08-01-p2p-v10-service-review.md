# P2P v10 service reviewer conflict decisions

Status: independent architecture vote by the service/API reviewer. This is not a
normative protocol and MUST NOT be implemented until the Canvas and causal-kernel
reviewers independently reach the same decisions and one canonical specification
digest replaces all three drafts.

Reviewed in full:

- `drafts/2026-08-01-p2p-canvas-schema.md`
- `drafts/2026-08-01-p2p-causal-kernel.md`
- `drafts/2026-08-01-p2p-service-peer-api.md`
- `2026-08-01-p2p-collaboration-conflict-matrix.md`

The current three-draft set is **not implementable**. It defines mutually exclusive
wire authorities, not harmless terminology variants. The decisions below are my
vote even where they invalidate my own service draft.

## C1 — Offline local edit durability

**Normative choice:** an offline edit is immediately materialized as one final,
long-lived-replica-signed causal frame. After candidate validation, the exact frame,
outbox reference, journal record and durable head MUST be fsynced before the same
delta enters `replicaDoc` and before the caller receives `saved-locally`. It does not
wait for a service session or peer. There is no provisional collaboration Y.Doc,
online replay, re-signing or `workingDoc` overlay. Reconnect changes only replication
status unless a later authorization cutoff excludes the frame under C3.

The frame uses the last locally verified current project/membership authorization
known to the replica. “Accepted” means accepted by this durable replica, not team
consensus. Bounded outbox exhaustion blocks additional durable edits rather than
dropping work.

**Reason:** provisional replay creates two semantic authorities and can produce a
different intent result, identity or placement after reconnect. It also makes
ordinary personal offline editing depend on an unavailable service even though the
chosen conflict model is causal P2P.

**Strongest objection:** a member can edit while actually revoked and will see a
successful local state that later cannot enter team history. That is unavoidable
without an online per-edit authority; the product must expose recovery rather than
mislabel `saved-locally` as replicated.

**Falsifiable test:** disconnect service and every peer, commit 100 edits, crash at
each object/outbox/journal/head fsync boundary, reopen, then reconnect. Every returned
success must reproduce the same frame digest and identities; no intent may be
re-executed. A cutoff before those frames must move exact bytes to recovery without
silently deleting or auto-re-signing them.

**Clause to delete from my service draft:** delete “offline provisional intent does
not allocate actor sequence or sign a team frame; online rebase signs it.” Replace it
with the immediate durable-frame rule above.

## C2 — Checkpoint verifier and service receipt

**Normative choice:** the service MUST NOT receive or transiently parse Yjs,
typed-intent, frame, snapshot or blob payloads. It stores bounded signed checkpoint
headers, declared parent metadata, holder assertions and catalog anti-rollback state.
Its publication receipt is fixed to `contentStatus:
"unverified-peer-content"`; it proves only current publication authority and catalog
inclusion.

Checkpoint content is verified by replicas using the same portable validator as edit
admission. Compaction additionally requires the all-active-replica stability witness
defined in C4. The service may verify signatures and exact membership coverage of
that witness, but its receipt MUST say `peer-validation-coverage` and MUST NOT say
that the content is service-validated. Before C4 stability exists, a holder-provided
checkpoint is only a candidate and its causal witness must be replayed by the
receiver.

**Reason:** a 320 MiB validation carrier, Yjs parser and arbitrary Plugin validation
artifact in `@convax/api` would turn the Cloudflare edge into a high-cost semantic
authority, duplicate domain reducers outside their owners and create a payload DoS
surface. A checkpoint attester does not order edits, but it still becomes the final
content root; that is more authority than the requested peer-id/membership service
needs.

**Strongest objection:** after globally stable compaction, a new device cannot replay
deleted history and must trust signed replica validation coverage. If every active
replica at the stability snapshot is malicious, an invalid snapshot can be
certified. This proposal explicitly does not tolerate a malicious complete active
set. If that threat model is unacceptable, the honest alternatives are a separately
operated content attester or retaining complete causal history—not pretending a
metadata receipt validates content.

**Falsifiable test:** submit a well-formed header whose referenced snapshot contains
an illegal hidden Y.Map. The service must publish only an unverified receipt without
receiving/parsing payload bytes; a peer with history rejects it. A fake store/log
probe must find no Yjs, intent, frame, snapshot or blob bytes. A new peer may use a
C4 stability witness only after validating every replica signature and exact active
set coverage.

**Clause to delete from my service draft:** none for the base service-content
boundary. It must be extended with C4 stability-witness metadata; holder assertions
alone are insufficient for compaction.

## C3 — Revocation and stranded work

**Normative choice:** revoke, key replacement and editor-to-viewer downgrade rotate
only the target member/replica authorization epoch and close its sessions. They MUST
NOT roll every membership epoch or document epoch. The same authorization
transaction binds an exact, service-signed cutoff manifest that covers the complete
grow-only service document registry and names one already published checkpoint per
document.

For a revoked target, only target frames reachable from the validated cutoff
checkpoint closure survive. Target frames outside it and every descendant depending
on an excluded frame are removed from team projection by rebuild, never by inverse
Yjs update. Exact excluded bytes remain in a read-only recovery branch. Other actors'
independent frames remain valid. The authorization mutation may complete while
cutoff payload holders are offline; peers then enter
`cutoff-material-unavailable`, reject further target frames and do not claim a
team-ready rebuild.

Honest target work that was not included in the selected checkpoint is deliberately
excluded. It may be exported or explicitly re-applied as new intents by a currently
authorized editor; it is never automatically reused with old operation/entity ids.

**Reason:** whole-project membership/doc-epoch rollover makes one member revocation
invalidate unrelated actors, requires every Canvas plus an online holder in one
transaction, and converts routine authorization into a global availability barrier.
The targeted cutoff admits the unavoidable lack of trusted client time while
preserving unaffected causal components.

**Strongest objection:** the cutoff can discard honest offline work and can block
team projection if its material is invalid or unavailable. A precise real-time
“signed before revoke” distinction is unobservable without per-edit trusted time or
online admission. The design chooses immediate authorization safety plus explicit
recovery over an invented timestamp.

**Falsifiable test:** construct target frame T1 included by cutoff, target T2 not
included, actor B frame B1 dependent on T2, and actor C frame C1 independent. After
revoke, every arrival order must keep T1/C1, exclude T2, block B1 and preserve exact
recovery bytes. No unrelated actor credential or chain may be reissued.

**Clause to delete from my service draft:** replace any wording that calls a
holder-less cutoff “safe team rebuild”; only the authorization mutation is complete
until cutoff material validates.

## C4 — Causal stability and compaction

**Normative choice:** one remote durable ACK is replication status, never causal
stability. A checkpoint becomes prune-stable only after a
`CausalStabilityWitnessV2` covers **every active replica** in one exact current
membership snapshot (viewer and editor replicas included):

```ts
interface ReplicaCheckpointValidationAckV2 {
  format: "convax.replica-checkpoint-validation-ack/2"
  projectId: string
  projectEpoch: string
  document: DocumentScopeV2
  checkpointDigest: string
  membershipSnapshotDigest: string
  replicaId: string
  actorId: string
  actorHeadAtAck: CausalHeadRefV2 | null
  checkpointFrontierDigest: string
  durableCheckpoint: true
  validatedCausalClosure: true
  replicaSignature: string
}

interface CausalStabilityWitnessV2 {
  format: "convax.causal-stability-witness/2"
  projectId: string
  projectEpoch: string
  document: DocumentScopeV2
  checkpointDigest: string
  membershipSnapshotDigest: string
  checkpointFrontierDigest: string
  checkpointActorHeadsDigest: string
  validationAckDigests: string[]
  coverage: "all-active-replicas"
  contentStatus: "peer-validation-coverage"
  catalogSequence: string
  serviceSignature: string
}
```

Each ACK is signed with the long-lived replica key only after that replica has fully
validated the checkpoint causal closure, fsynced the exact checkpoint and installed
a local compaction fence. Service verifies signatures, exact active-set coverage,
scope, membership snapshot currency and idempotency; it does not validate content.
Any concurrent membership mutation invalidates an incomplete witness attempt.

After the witness is durable, a replica may prune frame payloads inside the
checkpoint closure, but MUST retain the checkpoint bytes, witness, actor head
`{sequence,digest}` boundaries, operation/identity receipts, semantic-history and
resource-retention roots. Every future frame from a covered actor must causally
dominate its acknowledged checkpoint fence. A frame at/below the preserved actor
boundary with a different digest is equivocation; a later sequence based below the
fence is invalid/fork evidence.

An indefinitely offline active replica blocks compaction. An admin may revoke that
replica using C3, accepting recovery semantics, then retry stability against the new
active set. There is no timeout that silently treats an active replica as stable.

**Reason:** this is the only bounded P2P rule that prevents history pruning while an
honest active actor can still legally produce an old-base frame. It makes the
tradeoff explicit: unlimited offline membership and unblocked compaction cannot both
be promised.

**Strongest objection:** one forgotten device can block compaction indefinitely,
and all-active coverage may be operationally expensive. Replacing unanimity with
“one other peer” silently strands a valid offline actor; replacing it with a timeout
uses availability as authorization. Device retirement is the explicit operator
choice.

**Falsifiable test:** keep replica C offline before checkpoint Q while A/B ACK Q.
Compaction must remain forbidden. After C returns, its old-base frame validates and
can be included. In a second run, revoke C at an exact cutoff, produce an all-active
A/B witness, compact, then submit C's frame; it must enter recovery. Restore an old
copy of A from before A's ACK and sign a below-fence successor; peers must reject it.

**Clause to delete from my service draft:** delete any implication that holder
assertion or a single durable remote copy permits causal-history GC. Add bounded
validation-ACK and stability-witness endpoints/stores; they contain only signed
digests/coverage metadata.

## C5 — Edit-frame signing key

**Normative choice:** portable edit frames and durable checkpoint-validation ACKs
are signed by a long-lived Project-scoped device replica key stored behind the native
OS-vault adapter. Short-lived session keys sign PeerJS handshakes, channel/transfer
transcripts, holder availability and online service mutation requests only. A
session expiry or normal session replacement cannot invalidate historical frames.

Replica key rotation allocates a new replica id and actor id and uses C3 cutoff for
the old actor. It never continues the old actor chain. One current service session
plus a native per-replica writer lock prevents normal duplicate writers; copied-key
double-signing remains detectable equivocation, not a solved impossibility.

**Strongest objection:** a stolen long-lived key can sign apparently historical
offline frames until revoked, and peers cannot prove signing time. Session keys
would reduce exposure but would make offline editing and cross-session actor chains
impossible. Cutoff plus fork quarantine is the honest limit.

**Falsifiable test:** create frames before, during and after three session rotations
while offline; all must verify under one replica chain. Rotate the replica key and
prove the new actor cannot cite the old predecessor. Produce two valid signatures at
one sequence with a cloned key; both branches must quarantine independent of arrival.

**Clause to delete from my service draft:** none after its latest correction; the
canonical spec must retain the explicit key-purpose separation.

## C6 — Actor sequence genesis

**Normative choice:** first frame sequence is decimal string `"1"`; `"0"` is
reserved for “no frame/head” in indexes, checkpoint actor boundaries and diagnostics.
Every successor is exact unsigned `+1` and cites the immediately preceding same
actor/document-chain digest. Overflow freezes that actor/document chain until an
explicit shard/project reset; no wrap or abandonment exists.

**Strongest objection:** zero-based sequence is conventional and already appears in
the kernel draft. Neither choice changes correctness, but carrying both creates an
actual wire incompatibility. Reserving zero removes nullable/sentinel ambiguity.

**Falsifiable test:** sequences 0, 2, duplicate 1, skipped 3 and uint64 overflow all
fail from genesis; 1 then 2 with exact predecessor succeeds. Encoders in Bun,
Chromium and service metadata validation must produce identical bytes.

**Clause to delete from my service draft:** none; delete the zero-genesis rule from
the causal-kernel draft.

## C7 — Document epochs

**Normative choice:** there is no independent `docEpoch`. A document scope is
`{projectId, projectEpoch, docKind, docId, shardEpoch}`. Routine checkpoint,
compaction, membership mutation and revoke never change it.

`projectEpoch` changes only on explicit breaking reset of the whole Project
collaboration universe. `shardEpoch` changes only when the owning Project operation
explicitly replaces/resets that document shard; a Canvas delete/recreate should
normally allocate a new Canvas identity rather than reuse an old one. Reset creates
new genesis and leaves old bytes unsupported/recovery until explicit deletion.

**Reason:** the kernel's `docEpoch` exists mainly to support its rejected global
revocation rollover. Keeping both shard and doc epoch yields two reset identities
with overlapping authority and makes every revoke a cross-document transaction.

**Strongest objection:** a small per-document epoch can fence corruption without a
Project reset. `shardEpoch` already provides that fence at the Project-owned route;
a second token has no independent invariant.

**Falsifiable test:** revoke one replica and publish/compact checkpoints; every
unrelated frame retains exact scope. Explicitly reset one Canvas shard and show old
frames fail only that new shardEpoch while ProjectIndex and other Canvas scopes stay
valid.

**Clause to delete from my service draft:** none. Delete all `docEpoch`, next-doc
epoch genesis and membership-cutoff rollover fields from the kernel draft.

## C8 — Protocol bounds

**Normative choice:** freeze these aggregate hard limits for v2:

| Item | Limit |
| --- | ---: |
| binary/JCS frame header | 64 KiB |
| complete typed-intent JCS, including guard | 256 KiB |
| causal-context JCS | 64 KiB |
| base Yjs state vector | 64 KiB |
| one Yjs delta | 1 MiB |
| actual write evidence | 512 KiB |
| complete edit envelope | 2 MiB |
| checkpoint full Yjs update | 32 MiB |
| checkpoint direct parents | 32 |
| service declared tips per document | 32 |
| checkpoint maximal causal heads | 256 |
| result entities / logical writes | 512 / 2,048 |

All inner limits are subordinate to the aggregate envelope limit. A Plugin state
field may have a larger per-field theoretical cap only when the complete intent and
frame still fit; callers cannot split an otherwise atomic creation group into
multiple intents. When accepting a new header would create tip 33, service fails
closed with `checkpoint-consolidation-required`; a proposer can publish one merge
checkpoint that references up to the current 32 tips and also contains its local
causal closure.

**Reason:** 512 KiB intent plus the other independently maximal sections cannot fit
the promised 2 MiB envelope. A 256 KiB intent leaves bounded framing overhead. A
parent/tip limit of 8 is unnecessarily fragile under ordinary concurrent devices;
32 remains small within a 64 KiB header and matches the service discovery bound.

**Strongest objection:** 32 parents and a 32 MiB checkpoint increase validation and
memory DoS cost; 256 KiB may still be too large for interactive edits. Receivers must
check lengths/queue budgets before allocation, stream checkpoint hashing, and keep
the caps as ceilings rather than targets.

**Falsifiable test:** boundary-value binary fixtures at exact limit succeed; one
byte/item over fails before Yjs decode or large allocation. Maximal legal section
combination must fit the 2 MiB envelope. Publish 32 incomparable tips, reject a 33rd
non-consolidating header, then accept one 32-parent merge and preserve fallback
metadata.

**Clause to delete from my service draft:** none for parent/tip 32. Add the frame,
intent and checkpoint payload caps to the shared protocol; delete Canvas's 512 KiB
intent limit and kernel's 8-parent/8-anchor limit.

## C9 — Checkpoint frontier and invalid children

**Normative choice:** a checkpoint author declares exact maximal causal frame heads
and parent checkpoint digests. The service validates identity, signature, scope,
canonical order, bounds, parent existence and catalog transaction only. It MUST NOT
compute causal reachability or a content frontier.

Service maintains `declaredTipDigests` from the parent DAG solely for discovery.
Actual checkpoint dominance is proven by replicas from validated causal closure;
publication sequence, parent declaration and timestamps are not substitutes. Valid
incomparable checkpoints are merged, not selected.

Publishing a child never deletes parent header, holder or stability metadata. The
catalog returns every tip plus bounded direct-parent fallback; exact header lookup
by digest supports recursive fallback. An invalid child is quarantined by peers and
cannot mask or garbage-collect a valid parent. Only a C4 stable descendant plus
retention/reference checks permits ancestor payload GC.

**Strongest objection:** malicious editors can fill declared tips with invalid
headers and force fallback/rate-limit pressure. Bounded per-replica quotas, signed
evidence, tip cap and membership revoke mitigate availability; letting the service
decide validity would reintroduce the rejected semantic authority.

**Falsifiable test:** publish valid A/B and invalid C claiming both as parents. The
service catalogs C as unverified and retains A/B. Every peer rejects C and retrieves
A/B through fallback regardless of publication order. No service trace may contain
Yjs or a computed causal-valid flag.

**Clause to delete from my service draft:** none; delete checkpoint attester,
certificate and service-computed maximum frontier from the kernel draft.

## C10 — Service document registry without ProjectIndex parsing

**Normative choice:** service owns a grow-only **collaboration scope registry**, not
a Project route catalog. In a projectEpoch it contains ProjectIndex plus every
Canvas `{docKind,docId,shardEpoch}` ever registered. It stores no title, URI,
live/staged/closed route state or ProjectIndex proof.

ProjectIndex genesis is registered at Project collaboration creation. First Canvas
genesis-header publication atomically creates its registry entry under a current
editor's signed `DocumentRegistrationClaimV2`; same scope/digest is idempotent and
same identity/different shard epoch requires an explicit Project-owned reset claim.
Entries are never removed before projectEpoch reset. The membership snapshot binds
the registry sequence/digest; cutoff exact-covers that set.

The service registry tells bootstrap which checkpoint catalogs may exist. It does
not tell the client which Canvas is live. After fetching and validating ProjectIndex,
the client filters routes and verifies each route's exact shard scope. A registry
entry absent from ProjectIndex remains harmless retained metadata, not a visible
Canvas. A service response below the client's durable registry high-water is
rollback and fails closed.

**Reason:** asking service to discover live routes requires it to parse ProjectIndex
or trust a second mutable catalog. A grow-only security/discovery superset has a
different invariant and makes revoke coverage possible without becoming route truth.

**Strongest objection:** a malicious editor can exhaust the 4096-document cap with
fake genesis registrations. Current-editor quotas, per-member rate limits and admin
revoke are required; preventing all authorized-editor DoS would require ProjectIndex
content validation or admin-only Canvas creation, both larger product changes.

**Falsifiable test:** concurrently register a Canvas and mutate ProjectIndex route,
then deliver in both orders. Registry bytes/digest must converge while visibility is
derived only from validated ProjectIndex. Delete the route; registry entry remains
but no UI/agent query exposes the Canvas. A cutoff omitting it must fail exact
coverage.

**Clause to delete from my service draft:** replace “first accepted genesis header
registers document” with “first current-editor-signed, service-published unverified
genesis header atomically registers scope”; `accepted` must not imply content
validation.

## C11 — Resource proof and blob durability layers

**Normative choice:** remove `localDurableIndexDigest` from every portable typed
intent, frame and resource proof. It is a machine-local persistence fact that a
remote peer cannot reproduce. The portable current-resource proof contains only
stable Project semantics: Project/projectEpoch, fileId, versionId, canonical Convax
URI, blob hash, byte length and exact ProjectIndex causal frontier/proof digest.

Before Main creates a resource-bearing candidate, `@convax/project/node` MUST fsync
the blob and local native index and return a non-serializable, single-process
`LocalBlobAdmissionToken`. The application service consumes that token while
materializing the portable proof; the token never enters Yjs, JCS, frame bytes or a
public caller API. If Canvas commit fails, the unreferenced blob remains for delayed
GC.

Remote frame durable ACK and blob durable ACK are separate signed claims. A receiver
may validate and ACK structural state using the portable ProjectIndex proof even if
the blob is not downloaded; media availability remains missing. An operation is
shown as `replicated` only after at least one current remote replica has durably
ACKed the frame **and** every newly referenced blob hash/length. Blob ACK carries no
path or local index digest.

**Strongest objection:** structural ACK before blob ACK allows a team-visible node
that some peers cannot play. Blocking structure on large video transfer would stall
editing and conflate two transactions; the UI must expose `structure-replicated`
versus `blob-replicated` rather than hiding the gap.

**Falsifiable test:** two machines with different native paths/index generations
must produce byte-identical portable proof and frame. Crash before local blob fsync
must prevent frame creation. ACK frame but not blob and verify operation is not
“fully replicated”; then ACK exact hash/length on blob channel and transition without
changing Canvas Y.Doc.

**Clause to delete from my service draft:** none explicit. The canonical spec must
delete `localDurableIndexDigest` inherited from current Project/Canvas v1 types and
must not include it in PeerJS transfer or durable ACK DTOs.

## C12 — Typed-intent protocol major

**Normative choice:** the cutover token is exact
`format: "convax.typed-intent/2"`; corresponding frame, Canvas root/record and
ProjectIndex schema formats use their frozen v2 tokens. No v1 parser accepts them,
and v2 does not dual-read v1. Old collaboration/JSON bytes are preserved until the
user confirms the explicit breaking reset; reset may delete all old Canvas content
as already approved.

**Strongest objection:** many individual intent names resemble v1 and a major bump
forces mechanical changes across packages. Reusing `/1` for a different authority,
identity allocation, proof and closed union makes old bytes appear valid and is a
more dangerous compatibility lie.

**Falsifiable test:** every v1 body presented to a v2 endpoint/decoder returns
`unsupported-protocol` without hydration, rewrite or deletion; every v2 golden
fixture is rejected by v1. Explicit reset preserves bytes until confirmation and
never partially migrates.

**Clause to delete from my service draft:** replace its remaining
`convax.replica-edit-core/1`, checkpoint `/1` and related protocol tokens with the
single canonical v2 family after the final schema is frozen. Delete
`convax.typed-intent/1` from the Canvas proposal.

## C13 — Exact causal base and prune witness

**Normative choice:** before compaction, exact-base validation reconstructs the
frame's complete causal base from a validated checkpoint whose closure is a subset
of the declared base plus every missing frame in the difference. It verifies
frontier closure, actor chains, base state-vector bytes, owner canonical base hash,
semantic guards, received-delta closed diff and reducer-equivalent canonical
post-state. It does not require the reducer to emit byte-identical Yjs update bytes.

After compaction, the only substitute for deleted history is a C4
`CausalStabilityWitnessV2` plus its exact checkpoint, actor-head boundaries and
retained owner receipts. It is a prune witness, not a claim that arbitrary older
frames can still be validated. A frame whose base predates the witness is handled as
follows:

1. if its actor was active but had not ACKed the witness, compaction was illegal;
2. if its actor signed the ACK, boundary/fence validation yields duplicate,
   equivocation or below-fence fork—not normal admission;
3. if its actor was revoked/retired before stability, C3 recovery applies;
4. if required witness/checkpoint bytes are unavailable, state is
   `base-witness-unavailable`, never “invalid” or team-ready.

**Strongest objection:** the all-active signed witness converts old semantic replay
into trust in a historical validator set. Without service content validation or
zero-knowledge proof, there is no third way after deleting the causal history. The
threat model and UI must state this explicitly.

**Falsifiable test:** validate a frame on an exact old base, compact only after C4,
then run duplicate/fork/below-fence cases against retained boundaries. Delete one
required witness object and verify read-only `base-witness-unavailable`; applying on
a newer checkpoint or merely matching post-state must fail.

**Clause to delete from my service draft:** its current “peer always validates full
causal closure” must be qualified: before stability, replay full closure; after
legal prune, validate the all-active stability witness and retained boundaries. The
service still does not certify content.

## C14 — Canvas containment and generation schema

**Normative choice:** accept the proposed flat per-child/per-actor containment
choices and immutable generation begin/terminal claims as the v2 semantic model,
subject to C11 resource-proof removal and v2 token renaming.

Containment selection is maximum portable stamp per live child. Missing/deleted/
non-group selected parent projects top-level. For a child-to-parent cycle, remove
the maximum `(stamp, relationId)` member and do not fall back to a losing actor
choice. Business edges never participate.

Generation begin allocates both begin stamp and future output-claim stamp. A
terminal is immutable, references the exact begin and is authored by the same
long-lived replica actor; session restart is allowed, device failover is not a v2
generation promise. Terminal arrival time never changes output priority. A manual
data claim competes with the begin-time output claim, and node tombstone always
hides begin, terminal and output. Plugin creation-group node/edge liveness remains
recursively tied to the exact source incarnation, so source deletion hides the
whole group.

**Reason:** flat actor-owned keys avoid concurrent nested-Y.Map attachment loss;
the cycle projection is arrival-independent. Begin-time output priority solves late
generation completion without a trusted wall clock, while immutable terminal and
source-tied creation group implement the required delete-wins/whole-group invalid
rules.

**Strongest objection:** same-replica terminal authority means a result delivered
only to another device cannot complete the original generation. Allowing arbitrary
replicas would require a separately authenticated generation-result capability and
concurrent terminal rule. That is a future explicit protocol, not an implicit LWW
fallback.

**Falsifiable test:** run every permutation/duplicate delivery for three-actor
containment cycle, concurrent reparent, delete versus terminal, manual edit versus
late terminal, and Plugin source delete versus creation-group create. Canonical
state/projection hashes must match; another replica's unproven terminal must fail
without changing the node.

**Clause to delete from my service draft:** none; it correctly leaves these domain
rules to Canvas. The canonical Canvas spec must replace `/1` formats and local
durable proof fields per C11/C12.

## C15 — Semantic undo/redo under remote edits

**Normative choice:** undo/redo is a new closed semantic inverse/forward intent
validated against the latest `replicaDoc`; a raw `Y.UndoManager` inverse update is
never applied to authoritative Canvas state, persisted or transmitted. A
window/session `SessionUndoCoordinator` tracks only successfully durable local root
operation ids. It is cleared on restart, full rebuild and epoch/shard reset, but an
incoming remote frame neither enters nor clears its undo/redo stacks.

Undo preflights the selected root's retained material and current semantic guards.
Only after the semantic frame commits does the coordinator atomically move the root
from undo to redo. Failure leaves both stacks unchanged and returns an exact stale,
missing-blob or missing-artifact reason. A successful new local root clears redo;
remote frames do not. Redo similarly materializes a new forward intent with new
identities where recreation requires them.

`Y.UndoManager` MAY be used as a non-authoritative capture/selection implementation
detail only if it can satisfy those transitions without applying raw inverse bytes.
The protocol MUST NOT depend on undocumented stack mutation. If the current Yjs API
cannot do that, the coordinator owns transient root-id stacks directly. Unique
document truth remains Y.Doc; a session history cursor is not domain state.

**Reason:** raw Yjs inverse can resurrect deleted entities, restore obsolete Plugin
schema or remove concurrent remote work without executing current business guards.
Attaching UndoManager to the live doc and then forbidding its update leaves no sound
atomic stack transition; the draft must not hand-wave this gap.

**Strongest objection:** this weakens the preference to “give undo/redo to Yjs” and
adds a custom transient coordinator. Yjs can group local origins, but it cannot own
Convax semantic validity. Architecture correctness takes precedence over delegating
business inverse semantics to a generic CRDT undo implementation.

**Falsifiable test:** A commits roots A1/A2, B changes A2's guarded field, A requests
undo. B's frame does not clear the stack; stale inverse fails and A2 remains selected.
For a non-conflicting remote edit, undo commits one semantic frame, moves exactly one
root to redo and converges on B. Instrument the live Y.Doc to prove no raw
UndoManager transaction occurs.

**Clause to delete from my service draft:** none. In the Canvas draft, delete the
unqualified statement that the live `Y.UndoManager` is the stack authority unless a
public-API-only spike proves the exact non-mutating transition; retain semantic
intent and untracked remote-origin rules.

## C16 — Checkpoint, old work and no-holder bootstrap states

**Normative choice:** a normal checkpoint does not obsolete or reject old work. A
late frame from an active actor remains admissible when its exact base can be
reconstructed and it does not violate a C4 fence. Checkpoint publication sequence
never wins. After legal stability/compaction, C13 rules apply. After C3 cutoff,
excluded honest work is a read-only `recovery-available` branch and is not team
visible until explicit semantic re-application.

A new device with membership but no active holder for required checkpoint/witness
enters `waiting-for-holder`. It MUST NOT create an empty Project/Canvas, accept an
arbitrary seed snapshot, or allow edits against unknown team state. Existing devices
with a durable replica continue offline editing and show `saved-locally`. Structural
bootstrap can finish before blobs; missing current blobs show
`structure-ready-media-missing`. `fully-offline` requires every current referenced
blob durable locally.

Required product states are distinct:

- `saved-locally`
- `replicating-structure`
- `replicating-blobs`
- `replicated`
- `waiting-for-holder`
- `cutoff-material-unavailable`
- `base-witness-unavailable`
- `recovery-available`
- `structure-ready-media-missing`
- `fully-offline`

**Strongest objection:** pure P2P cannot guarantee onboarding or disaster recovery
when every holder is offline/lost. If the product later requires always-available
bootstrap, it needs a service blob/replica seed with a new storage/privacy contract;
renaming metadata catalog as backup is false.

**Falsifiable test:** bootstrap a fresh device while all holders are offline and
verify it remains non-editable `waiting-for-holder`; bring one valid holder online
and complete structure, then blobs. Deliver a valid old-base frame before C4 prune
and accept it; deliver it after actor fence/revoke and verify deterministic
fork/recovery state without empty reset or LWW overwrite.

**Clause to delete from my service draft:** none for no-holder behavior. Qualify its
“existing device local fork” wording to mean the single durable `replicaDoc` from C1,
not a second provisional document.

## Blocking objections before implementation

1. **Checkpoint trust/compaction is not yet one protocol.** The kernel requires a
   transient service attester; the service draft forbids content parsing but lacks
   the all-active stability/prune witness required to make compaction safe. This is
   a blocking architecture gap, not a missing endpoint.
2. **The wire major and causal identity are contradictory.** `/1` versus `/2`, frame
   sequence 0 versus 1, `docEpoch` presence, offline provisional versus final frame
   and session versus replica signing cannot coexist behind adapters. One frozen
   schema and golden digest must replace every draft before code.
3. **Undo ownership is underspecified.** The Canvas draft says live Y.UndoManager
   selects history while forbidding raw undo mutation. There is no proven public
   atomic operation that moves its stacks only after semantic-frame commit. The C15
   spike is a release gate.
4. **Portable resource proofs currently contain local-machine evidence.** Keeping
   `localDurableIndexDigest` on wire would make honest peers produce different proof
   bytes and break exact reducer verification.
5. **Registry and stability metadata are missing public contracts.** The grow-only
   scope registration, peer validation ACK, compaction fence and stability witness
   need exact DTO, store, signing domain, bounds, GC and crash-idempotency tests.

## Strongest overall rebuttal and flaw classification

The strongest expert rejection has three parts:

1. **“All-active peer signatures are merely a distributed content attester.”** This
   is true after pruning: new devices trust the historical active replica set rather
   than replay deleted history. The proposal is valid only under the explicit
   no-malicious-complete-active-set threat model. This is an unavoidable trust-model
   tradeoff, not proof that a Cloudflare semantic validator is free.
2. **“One offline device can stop compaction forever.”** Also true. Silent timeout
   retirement would violate offline authority. Explicit replica revoke is the only
   honest bounded-storage escape and necessarily sends that device's uncheckpointed
   work to recovery.
3. **“P2P without a seed is not team backup.”** Correct. It provides collaboration
   and offline editing on existing replicas, not guaranteed fresh-device bootstrap.
   The UI and service contract must never promise cloud durability.

The current draft set contains:

- **fact/contract conflict:** incompatible wire majors, sequence genesis and epoch
  fields are simultaneously claimed;
- **invalid hidden assumption:** compaction assumes a long-offline active actor no
  longer needs its old base;
- **logic jump:** a signed checkpoint header or holder assertion is treated as if it
  implied valid content;
- **ignored alternative:** semantic intent undo is conflated with raw CRDT inverse;
- **authority leakage:** local durable-index evidence and service semantic parsing
  cross their owning package boundaries.

## Score

The current combined three-draft architecture scores **5.6/10** and is blocked from
implementation. Deductions: 1.5 for mutually exclusive wire authorities, 1.2 for the
missing causal-stability/prune witness, 0.8 for unresolved UndoManager semantics,
0.5 for local resource proof leakage, and 0.4 for registry/reset inconsistencies.

The C1–C16 target selected in this review would score **8.2/10** after executable
spikes. The remaining deductions are not hidden: all-active stability can block on
an offline device; revoke discards honest uncheckpointed work from team projection;
and a new device cannot bootstrap without a holder. Those are not immediately fatal
because each maps to an explicit operator/product state rather than an
arrival-dependent winner, silent overwrite or false service certificate. The score
falls below 7 if any one of the C4, C13 or C15 spikes fails.

## Normative clauses I am willing to sign

I will approve a canonical spec digest only if it states all of the following:

1. Offline local edits immediately become fsynced long-lived-replica-signed v2
   frames in the one `replicaDoc`; there is no provisional collaboration Y.Doc.
2. Service never receives or validates Yjs/intent/frame/snapshot/blob content and
   never publishes a content-valid certificate.
3. Checkpoint headers are unverified peer claims; actual content acceptance is peer
   validation, and pruning additionally requires exact all-active-replica signed
   stability coverage.
4. One remote frame/blob ACK affects replication status only; it is not causal
   stability.
5. An active offline replica blocks compaction until it ACKs the validated checkpoint
   or is explicitly revoked under recovery semantics.
6. Revocation rotates only target authorization and uses an exact all-document
   checkpoint cutoff; unrelated actors and shards do not epoch-roll.
7. Portable frame signatures use long-lived replica keys; session keys never define
   edit history.
8. Actor sequence begins at 1, there is no `docEpoch`, and v2 uses one closed
   `convax.typed-intent/2` family.
9. Service document registry is a grow-only discovery/security superset, while
   validated ProjectIndex remains the only route truth.
10. Checkpoint parents/tips are bounded at 32; service tips are declared metadata,
    invalid children cannot delete or hide fallback parents, and publication order
    is never a conflict winner.
11. `localDurableIndexDigest` and every native path/index fact are absent from wire;
    local blob admission, structure ACK and blob ACK are separate barriers.
12. Exact-base validation uses causal closure and owner semantic equivalence; after
    prune it uses only the frozen stability witness/boundaries and never validates an
    old guard on a newer arbitrary snapshot.
13. Flat containment, cycle projection, begin-time generation output claims,
    delete-wins and Plugin creation-group whole invalidation are owner-defined
    deterministic rules.
14. Undo/redo commits semantic intents; remote frames do not clear local session
    history, and raw Yjs inverse bytes never become authoritative collaboration
    updates.
15. No-holder bootstrap waits; existing replicas may edit offline; missing blobs do
    not masquerade as fully offline availability.
16. Old formats are rejected and preserved until an explicit user-confirmed reset;
    there is no dual-read, silent migration or document-wide version fallback.
