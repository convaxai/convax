# P2P v10 round-3 service red-team review

Reviewed candidate:
`drafts/2026-08-01-p2p-v10-round3-consensus-candidate.md`

Declared SHA-256:
`4e97fff4045b1877434f7f3a94232ae4ddb264f62dc200dd484ba3455e95393f`

Independently computed SHA-256:
`4e97fff4045b1877434f7f3a94232ae4ddb264f62dc200dd484ba3455e95393f`

Digest verification passed before semantic review. This review addresses that exact
byte sequence. It does not modify the candidate, implementation or canonical spec.

## R3-1 — Dual checkpoint gates

### Decision on this clause

**ACCEPT.** The gates are not duplicates:

- `CheckpointContentCertificateV2` proves that one bounded checkpoint set is a legal
  deterministic result of the certified causal closure under frozen validators.
- all-active-editor `ReplicaCausalFloorAckV2` coverage proves that every replica
  still authorized to create offline work has durably advanced its future-base
  lower bound and has no omitted durable local head.

Content validity alone cannot authorize pruning while an editor may legally produce
an older-base frame. Floors alone cannot prove that the snapshot they advance to was
produced by legal intents. Requiring both also prevents one compromised attester
from authorizing prune while one honest editor rejects the content. The common
validator-defect limit is correctly disclosed.

### Authority and package boundary

The candidate keeps reusable causal/carrier mechanics in
`@convax/collaboration`, domain validators in `@convax/canvas` and
`@convax/project`, Project-scoped composition in the public browser-safe
`@convax/project/collaboration-protocol`, native floor/checkpoint durability in
`@convax/project/node`, and service orchestration/signing at the API edge. That
direction satisfies the dependency contract if the attester executes only
digest-pinned declarative Plugin validation artifacts and never private package
source or Plugin JavaScript.

The service has two distinct key purposes: content-certificate signing and
prunable-set/coverage signing. Implementations MUST NOT let possession of the latter
mint the former. Membership service compromise remains capable of falsifying the
active-editor set; that is inside the declared trusted control-plane boundary, not
an unmentioned third quorum.

### State machine, caps and failure states

`candidate -> content-certified -> prunable` is monotonic. A candidate has no
bootstrap/GC authority. A content certificate may bootstrap only while its exact
causal witness remains available and independently revalidated; post-prune bootstrap
requires the prunable-set certificate and checkpoint payload. If any editor has an
unmerged durable head it cannot sign the named set; the proposer must create a new
content-certified merge set.

The stable set `1..8`, active-editor ACK cap `256`, frontier cap `256`, snapshot
`32 MiB` and carrier `320 MiB` are mutually bounded. `priorSetDigest` may serialize
GC metadata CAS but MUST NOT select content winners. The listed
`attestation-*`, `awaiting-editor-floors`, retention, stale-membership and payload
unavailable states are fail-closed and cover the critical transitions.

### Strongest objection

Every editor must download, independently validate and fsync the same certified set,
so the second gate has high availability and resource cost. If all editors use one
buggy artifact, the apparent independent validation adds no protection. Removing the
gate would nevertheless make safe compaction impossible for offline writers; the
correct mitigation is cross-runtime differential validation and explicit revoke,
not attester-only pruning.

### Falsifiable tests

In addition to the candidate test:

1. give editor C one durable head absent from the certified set; C MUST refuse its
   floor and service MUST refuse prunable coverage;
2. mutate membership between the penultimate and final ACK; the old coverage attempt
   MUST become `floor-membership-stale` atomically;
3. compromise only the content signer and submit invalid content; one honest editor
   rejection MUST prevent pruning;
4. sign all floors for valid content, remove the last checkpoint payload holder, and
   prove post-prune bootstrap remains `checkpoint-payload-unavailable`, not empty.

### Required patch

None.

## R3-2 — Removal of `docEpoch`

### Decision on this clause

**ACCEPT.** No independent invariant remains for `docEpoch` once `shardEpoch` is
normatively defined as the sole Project-owned incarnation of one document's
collaboration history. The relevant independent scopes are:

- `projectEpoch`: complete Project collaboration universe;
- `{docKind,docId,shardEpoch}`: one routed document-history incarnation;
- member/replica authorization epoch: permission, not data identity;
- checkpoint/floor/catalog sequence: metadata high-water, not document identity.

Adding docEpoch would provide a second token capable of replacing history without
changing the Project route. That is exactly the duplicate reset authority the
candidate forbids. A Canvas-level reset is correctly modeled as a staged Project
route CAS to a new random shardEpoch; ProjectIndex reset necessarily changes the
projectEpoch because it owns the route graph.

### Authority and package boundary

`@convax/project` owns both route and shard incarnation. Generic collaboration code
consumes `DocumentScopeV2` opaquely and cannot roll it. Canvas can report corruption
or schema incompatibility but cannot select the new epoch or make it current.
`DocumentShardResetClaimV2` in the Project collaboration-protocol export is the
correct cross-layer contract.

### State machine, caps and failure states

The staged reset has one current route before CAS and one after CAS. New genesis,
old-byte preservation and ProjectIndex route CAS are separate crash boundaries;
failure never makes both shards live. The 64 KiB reset claim is adequate because it
contains only identities/digests/receipts, never Canvas bytes.

The failure states cover pre-CAS staging, route-CAS wait, recovery, unsupported old
shard and the broader ProjectIndex failure. `logical-counter-exhaustion` should be
normalized in the canonical draft into explicit actor-sequence versus Lamport
handling, but the safe shard-reset result is unambiguous and does not require a new
epoch kind.

### Strongest objection

A corrupted ProjectIndex can delay a Canvas reset that could otherwise be fenced by
a local docEpoch. Allowing that escape would also allow Canvas/collaboration to
replace a Project route outside the catalog owner, producing two current histories.
The recovery latency is the cost of retaining one route authority.

### Falsifiable tests

In addition to the candidate crash matrix:

1. attempt a Canvas-owned epoch mutation without a Project reset claim; every layer
   MUST reject it before persistence;
2. reuse old Canvas id/shardEpoch after tombstone and prove it cannot be revived by a
   new genesis;
3. feed a frame containing legacy `docEpoch`; v2 closed decoding MUST reject rather
   than ignore it;
4. exhaust one actor sequence and verify no adapter silently wraps or resets only a
   local chain outside the Project-owned recovery operation.

### Required patch

None. The “replaced round-2 clauses” provenance sentence appears inconsistent with
the first-round review labels, but that is editorial history, not a semantic epoch
defect; it must not be copied into the canonical contract.

## R3-3 — Candidate collaboration-scope registry

### Decision on this clause

**REJECT AS WRITTEN; accept after the minimal patch below.** The two-state registry
does **not** become a second Project route authority: candidate and dual-validated
entries cannot make a Canvas visible/current, and ProjectIndex alone decides route
state and shard selection. The registry is legitimately authoritative only for
membership-security scope discovery, cutoff coverage, quotas and rollback
high-water.

The blocking defect is that “cutoff exact-covers every registry entry” has no bounded
wire/state object. The candidate permits 4,096 grow-only entries and 512 KiB registry
pages, but neither defines the cutoff coverage vector/page/root nor reconciles it
with the previous 512 KiB cutoff-manifest limit. Implementations can therefore make
incompatible choices: one giant JSON manifest, omitted candidate entries, mutable
server-side lookup by current registry, or page-by-page non-atomic cutoffs. The last
three break exact revocation semantics; the first can exceed its cap.

### Authority and package boundary

Candidate registration is acceptable as a service-owned bounded security claim
because it carries no route fields and cannot be promoted without dual validation.
The opaque ProjectIndex dependency digest at candidate stage is not treated as route
proof. Promotion remains jointly bound to ProjectIndex and Canvas certificates.

API owns the registry transaction/high-water, while
`@convax/project/collaboration-protocol` must own the exact coverage DTO and digest
codec. Neither API nor collaboration may infer route state or inspect ProjectIndex
content outside the attester's public verifier path.

### State machine, caps and failure states

`registered-candidate -> dual-validated` is monotonic and safe. Promotion freeing an
outstanding candidate slot does not remove the grow-only entry. Candidate
`empty-target-frontier` is a per-revoked-target security default, not an empty
document checkpoint: it excludes only the target actor's frames and leaves
independent surviving actors eligible for later validation.

The candidate quotas bound authorized-editor metadata DoS, but
`scope-capacity-exceeded` is permanent until projectEpoch reset because entries are
grow-only. That is an explicit product limit. The missing cutoff-vector cap is not a
mere implementation detail because revocation must remain atomic at maximum
registry capacity.

### Strongest objection

Even after the patch, any editor can consume candidate slots and eventually the
grow-only Project cap. Requiring content certification before registration would
remove fake candidates but would omit offline scopes from revoke coverage. The
candidate state is the narrower authority: bounded abuse is visible, while it never
creates a Canvas or surviving target frontier.

### Falsifiable tests

Retain the candidate tests and add:

1. create exactly 4,096 mixed candidate/validated entries and revoke a target; the
   exact coverage object MUST stay within all page/root caps and commit atomically;
2. omit, duplicate, reorder or change one coverage leaf/page while retaining the
   registry digest; every peer MUST reject the cutoff;
3. mutate/promote the registry after a cutoff challenge is issued; the transaction
   MUST reject stale registry sequence/digest rather than silently cover the new set;
4. fetch pages in arbitrary order and prove one canonical coverage digest and the
   same per-target surviving projection;
5. prove candidate `empty-target-frontier` never erases an independent actor's frame
   or creates an empty Canvas route.

### Minimal semantic patch

Add the following normative paragraph and DTO family to R3-3:

> Revocation binds one immutable `RegistryCutoffCoverageV2` built from the exact
> current `{projectEpoch, registrySequence, entriesDigest}`. It contains a canonical
> UTF-8-sorted vector of exactly one `TargetCutoffLeafV2` per registry entry; each
> leaf is capped at 1 KiB and binds entry scope/state plus either one certified target
> frontier digest or the exact token `empty-target-frontier`. The vector is split
> deterministically into pages of at most 512 entries and 512 KiB. There are at most
> eight pages/4,096 leaves/4 MiB total. The root object binds ordered page digests,
> total leaf count and the registry digest and is capped at 64 KiB. Service validates
> exact coverage and atomically stores/signs the root plus immutable pages with the
> authorization mutation. Missing, duplicate, reordered, stale or mismatched leaves
> fail closed. Peers may fetch pages lazily but MUST verify the root before applying
> the cutoff; current mutable registry state never substitutes for the bound pages.

This patch adds no route authority and no edit order. It only makes the already
required exact security coverage bounded and reproducible.

## R3-4 — Dismissal and cutoff-backed generation recovery

### Decision on this clause

**REJECT AS WRITTEN; accept after the minimal projection patch below.** Dismissal and
`failed-recovery` are not contradictory facts:

- dismissal is an editor-authored, monotonic visibility decision that may occur
  while the owner is active and never claims execution outcome;
- failed-recovery is an authorization-backed lifecycle fact available only after
  the owner actor is cut off with no surviving terminal.

They may coexist. Dismissal precedence means the visible lifecycle remains
`dismissed`; the recovery fact remains retained/auditable and does not become a
failure message or output. Owner success in the surviving cutoff closure prevents
recovery creation, while owner success outside cutoff is recovery-only. The permit
port keeps membership knowledge outside Canvas.

The blocking ambiguity is “stop projecting this generation/output.” The candidate
does not specify how dismissal changes the generation terminal's begin-time output
claim in effective node-data projection. One implementation can keep successful
resource data visible while labeling lifecycle dismissed; another can remove the
claim and fall back to prior/manual/placeholder data. Those replicas can produce
different canonical projection hashes from the same Y.Doc.

### Authority and package boundary

Canvas correctly owns both monotonic marker schemas and projection. Project's
browser-safe collaboration protocol verifies cutoff/authorization and supplies a
non-serializable recovery permit; Canvas stores only the proof digest. Neither
Canvas nor a Plugin calls membership service. An editor's dismissal authority is no
greater than its existing ability to delete or supersede the node, but it is
explicitly non-cancellation/non-refund.

### State machine, caps and failure states

The precedence `tombstone > dismissal > surviving owner terminal > recovery failure
> active begin` is deterministic for lifecycle. Single logical dismissal marker and
single valid cutoff-proof marker are bounded under the existing intent/frame caps.
Multiple concurrent attempts at the same fixed marker are idempotent at logical
projection even if Yjs retains normal conflicting structs.

The listed command failures correctly distinguish observation, active owner, proof
availability, surviving terminal and stale scope. Recovery after dismissal MAY be
accepted as an auditable dormant fact; it MUST NOT change visible lifecycle or
effective data while dismissal is present.

### Strongest objection

Any editor can permanently suppress a legitimate success and dismissal is not a
semantic Undo root. This is strong product authority, not a CRDT necessity. The
candidate discloses it and the user already grants editors delete/supersede power;
if product policy does not allow it, dismissal must require another ACL—not be
silently reinterpreted as failure or cancellation.

### Falsifiable tests

Retain the candidate tests and add a node-data oracle:

1. begin on an existing resource, succeed with a new output, then dismiss in both
   orders; lifecycle and effective data hash must be identical;
2. create a pending-generation placeholder, succeed, dismiss and concurrently add a
   manual data claim; every delivery order must choose the same non-dismissed maximum
   claim;
3. combine dismissal, valid failed-recovery, owner terminal inside cutoff, owner
   terminal outside cutoff and node tombstone; exhaust valid permutations and
   require one lifecycle/effective-data/resource-retention hash;
4. prove suppressed successful output bytes remain a retained-history resource root
   even when absent from effective data.

### Minimal semantic patch

Add this normative projection rule to R3-4:

> A valid dismissal removes that generation's begin lifecycle and every terminal
> output claim from the node's **effective** data-claim competition; it does not
> delete the begin, terminal, resource reference or any manual/node-data claim.
> Effective node data is recomputed by the existing portable maximum rule over the
> remaining non-dismissed claims. Therefore an existing-node generation falls back
> to its prior/manual winner, and a pending-generation node falls back to its retained
> generation placeholder claim while exposing lifecycle `dismissed`. A coexisting
> valid failed-recovery marker remains an auditable dormant fact under dismissal and
> does not alter effective data. Resource scanning continues to retain every
> suppressed successful output required by history.

This resolves dismissal/recovery coexistence without letting either impersonate an
owner result.

## Exact-digest decision

**REJECT** exact candidate digest
`4e97fff4045b1877434f7f3a94232ae4ddb264f62dc200dd484ba3455e95393f`.

R3-1 and R3-2 are acceptable. R3-3 lacks a bounded immutable cutoff-coverage object
at maximum registry capacity. R3-4 leaves effective node data under dismissal
ambiguous. Both defects can cause different peers to accept/project different state;
they are semantic, so formatting normalization cannot repair this digest.

The minimum next candidate is the exact current text plus only the two boxed
normative patches above and their falsifiable tests. No change is requested to the
dual gate, no-docEpoch decision, candidate/validated state split, failure precedence
or package ownership.

## Strongest overall rebuttals, flaw types and score

The strongest reasons to reject even the patched architecture remain:

1. dual checkpoint trust still combines a central content/privacy boundary with an
   all-editor availability barrier;
2. Project-owned shard reset can be unavailable when ProjectIndex itself is damaged,
   and a Project-level reset has a large recovery blast radius;
3. candidate registration and editor dismissal deliberately retain bounded abuse
   surfaces that only stricter admin policy can remove.

The two blocking findings are a **bounded-state omission** (registry count and page
caps do not define atomic cutoff coverage) and a **semantic projection ambiguity**
(dismissal lifecycle does not define effective output-data behavior). The reviewed
candidate otherwise avoids duplicate route authority and correctly separates content
validity from causal stability.

Score for the exact digest: **7.6/10**. The direction remains strong, but an exact
consensus protocol cannot receive a signature while maximum-cap revocation and one
generation projection have multiple valid interpretations. With only the two
minimal patches and passing tests, my expected score is **8.7/10**; the remaining
risks are explicit threat-model/product costs rather than convergence defects.
