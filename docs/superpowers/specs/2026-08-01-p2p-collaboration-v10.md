# Convax P2P Collaboration v10 Canonical Semantic Specification

Revision: **5.3**.

Status: **complete canonical semantic candidate with pinned normative schema
bundle**. Normative authority is the indivisible set consisting of this main
specification and the four whole-file-digest-pinned annexes in section 1. It is not
implementation authority until three independent architecture reviewers sign the
same detached main-file SHA-256, the same annex-set digest and the same exact
`ProtocolSchemaBundleV2.coreDigest`. An implementation that has only the main file,
only a subset of the annexes, or any mismatched annex MUST fail closed as
`protocol-schema-bundle-unavailable`.

Older drafts, review reports, live code and prior architecture prose remain evidence
only. They are not parallel normative specifications and MUST NOT fill a field,
state transition, cap or owner omitted from the authority set.
The words MUST, MUST NOT, SHOULD and MAY are normative.

## 1. Normative inputs and precedence

### 1.1 Indivisible authority set

The v10 Revision 5.3 authority set contains exactly five files:

1. this main specification;
2. Canvas schema/reducer/editor annex:
   `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md`,
   whole-file SHA-256
   `2220095c67d74884565db17b34b8bece7f7427c8a06ae78d341a06fcbd798fa5`;
3. collaboration-kernel/frame/bundle annex:
   `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-collaboration-kernel-appendix.md`,
   whole-file SHA-256
   `863aaafece50d5c201e79034baf6fd89a0377513f5e6dd7132d9c486850a90a3`;
4. control-plane/Peer/wire annex:
   `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md`,
   whole-file SHA-256
   `07b15d4df2273e8dcd89ba4e10b52b661298cb16f0f43bb013e3159017416226`;
5. ProjectIndex/native-persistence/reset annex:
   `docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md`,
   whole-file SHA-256
   `cbfe749e337a5b6db08db7b4c7bef9762422f2c7abd7e168cfe1eeeb68183aed`.

Every value above is the SHA-256 of the complete file including its final LF. The
kernel whole-file value is review identity; its portable artifact span and
no-self-reference sentinel are defined only by kernel appendix section 4. The four
annexes are the normative source material for the one instantiated
`ProtocolSchemaBundleV2` in kernel appendix section 21. Generated validators and
declarations MUST consume that exact instance and all four pinned annex bytes; no
implementer may reconstruct a descriptor from this main-file summary, an abstract
bundle shape or an older `/1` schema.

The four-annex review-set digest is computed as follows:

1. create exactly four closed `{path,sha256}` objects using the path and lowercase
   whole-file digest strings above;
2. sort objects ascending by raw UTF-8 `path` bytes;
3. encode the array with restricted RFC 8785 JCS, with no whitespace or newline;
4. compute ordinary SHA-256 over those exact UTF-8 JCS bytes.

The exact ordered restricted-JCS preimage is:

```json
[{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-canvas-schema-appendix.md","sha256":"2220095c67d74884565db17b34b8bece7f7427c8a06ae78d341a06fcbd798fa5"},{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-collaboration-kernel-appendix.md","sha256":"863aaafece50d5c201e79034baf6fd89a0377513f5e6dd7132d9c486850a90a3"},{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-control-plane-appendix.md","sha256":"07b15d4df2273e8dcd89ba4e10b52b661298cb16f0f43bb013e3159017416226"},{"path":"docs/superpowers/specs/drafts/appendices/2026-08-01-p2p-v10-project-persistence-appendix.md","sha256":"cbfe749e337a5b6db08db7b4c7bef9762422f2c7abd7e168cfe1eeeb68183aed"}]
```

The resulting Revision 5.3 annex-set digest is:

```text
6907964865c69b99d0a3cf2f89d6f92d2f8d8b1d221f98b567693f03d4832075
```

This annex-set digest is review identity, not the portable bundle's
`coreDigest`, a credential `protocolDigest` or a new signature domain. The main file
is deliberately excluded to avoid self-reference. The exact instantiated bundle has:

```text
ProtocolSchemaBundleV2.coreDigest = ce60112affb9dddb88e6e22dd86d71cfad3a6cbe39bdd6582969dedae7a6c838
protocolDigest = ce60112affb9dddb88e6e22dd86d71cfad3a6cbe39bdd6582969dedae7a6c838
uriProtocolDigest = 298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949
```

A review receipt binds the detached whole-file SHA-256 of this main file together
with the annex-set digest and exact protocol/core digest above; any main or annex
byte change requires a new receipt and 3/3 review.

### 1.2 Incorporated sources and precedence

This authority set integrates these reviewed inputs:

- global URI governance:
  `2026-07-31-global-uri-protocol.md`, SHA-256
  `298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949`;
- the independent P2P drafts and their review evidence, only as historical inputs
  already resolved into this Revision 5.3 authority set.

Precedence is strict and has no fallback decoder:

1. this main file and all four pinned annexes after exact-digest 3/3 approval;
2. the independently versioned global URI specification for URI semantics only;
3. nothing else.

Within the authority set, each annex is final for its declared owner surface and the
main file is final for cross-owner composition and product policy. A main-file
summary MUST NOT narrow, extend or reinterpret an annex's closed DTO, root topology,
intent union, cap, state transition or owner. A genuine contradiction is
`canonical-authority-conflict`: implementation stops and the five-file set returns
to review. The revision-3/4 authorities, unsigned Revision 5.1/5.2 proposal reviews,
round-2 clauses,
drafts, reject reviews, current
code and persisted formats have no normative fallback status.

Annex-local `candidate` status, prior-source precedence, reviewer handoff, score,
signature and SHA-provenance paragraphs are editorial provenance, not protocol
semantics, and are superseded by this section's five-file authority rule. The pinned
annex technical contracts remain normative in full. This carve-out prevents the
Project annex's pre-merge precedence list or an appendix prefix-hash note from
reviving a rejected draft as a fallback decoder.

Within each annex, the terminal Revision 5.3 replacement is controlling: Canvas
section 25, Kernel section 20, Control section 19 and Project section 19. Kernel
section 21 is the generated bundle instance outside the artifact span. Earlier
sections remain normative only where the Revision 5.3 replacement explicitly
retains them. Unsigned Revisions 5.1 and 5.2 provide no decoder or fallback.

The global URI grammar is independently versioned and remains normative. Its older
reset prose is overridden only where it mentions a collaboration `docEpoch`,
per-edit admission, or an admission fence: collaboration v10 has no `docEpoch` and
no central per-edit admission. Nothing in this override weakens global URI parsing,
scheme allocation, comparison, ProjectFileId, path-hint, or blob-hash rules.

## 2. Product and threat model

Convax collaboration is P2P on the data plane and service-backed on the identity,
membership, rendezvous, checkpoint-attestation, registry and revocation control
plane. It has no online authoritative edit order.

- An existing durable replica MUST edit while service and every Peer are offline.
- A fresh device with no reachable data holder MUST wait; it MUST NOT fabricate an
  empty synchronized Project or Canvas.
- A local commit immediately creates one final, long-lived-replica-signed causal
  frame. Reconnect MUST NOT replay the business command, renumber it, or re-sign it.
- PeerJS, peerId, arrival order, Yjs client id, service receipt order and machine
  wall clock are not business authority.
- The service is trusted for membership, authorization, attestation key custody,
  registry anti-rollback and cutoff coverage. It may deny service, but it MUST NOT
  order ordinary edits or retain collaboration payloads.
- A single Peer, editor, checkpoint author, Plugin, renderer and transport session
  is untrusted. Checkpoint pruning requires the independent dual gate in section 15.
- A deterministic validator defect common to attester and all editors can certify
  invalid state. End-to-end content secrecy from the attester is not promised.
- A long-offline editor blocks compaction until it installs the floor or is
  explicitly revoked. Revocation may send honest unreplicated work to recovery.

The protocol intentionally distinguishes:

- `saved-locally`;
- `structure-replicated`;
- `blob-replicated`;
- `fully-offline`;
- `waiting-for-holder`;
- `recovery-available`.

No UI may collapse these into a false “team saved” promise.

## 3. Package ownership and dependency direction

| Owner | Owns | MUST NOT own |
| --- | --- | --- |
| `@convax/uri` | Stateless URI components, codecs, canonicalization, comparison and closed static scheme grammar | Resolution, I/O, authorization, current Project state, mutable scheme registry |
| `@convax/collaboration` | Generic v2 envelopes, JCS, causal frames/frontiers, replica/candidate kernel, checkpoints, floor ACKs, journals and session undo coordination | Project/Canvas schemas, membership policy, PeerJS, Electron, filesystem |
| `@convax/project-files` | Project entry opaque ids, file/tree contracts and Project file operations | Project registry, Canvas schema, collaboration transport |
| `@convax/canvas` | Canvas v2 schema, reducers, typed intents, guards, semantic history, generation, containment, I-confluent projection, host-neutral editor/view contracts, React Flow projection adapter and transient gesture-to-intent semantics | Project routes/files, membership, PeerJS, native persistence, Electron shell |
| `@convax/project` | Project identity, ProjectIndexYDoc, Canvas route/catalog, Project resources and composition of Project/Canvas validators | Workbench selection, PeerJS, native private-store I/O |
| `@convax/project/collaboration-protocol` | Browser-safe Project-scoped membership/checkpoint/cutoff/registry DTOs and composite verifier export | Service adapters, private package imports, executable Plugin code |
| `@convax/project/node` | Sole native Project collaboration writer, journal/object/head/outbox/checkpoint/blob durability and OS-path materialization | Reusable domain rules or renderer state |
| `@convax/workbench` | Window-scoped active Input/Canvas, selection, surface and layout state | Canvas/Project durable data, React/DOM, filesystem |
| `@convax/plugin-api` and `@convax/plugin-sdk` | Closed Host API and Plugin ABI/schema/artifact contracts | Active Plugin selection, collaboration state, concrete Plugin behavior |
| `@convax/agent-runtime` | Generic Agent sessions and tool bridge | Project/Canvas policy, direct `.convax` access |
| `@convax/desktop` | Electron composition, PeerJS adapter, IPC/preload, OS vault, React shell/product chrome and native safe-viewport/platform adapters | Reusable collaboration, Project/Canvas/editor/view semantics or a React Flow document store |
| `@convax/api` | Membership, session, rendezvous, attester, registry and cutoff HTTP composition | Edit order, Yjs/file/blob persistence, Canvas reducer copies |

Runtime dependency direction is:

```text
desktop -> agent-runtime, canvas, collaboration, project, project-files, uri,
           plugin-api, plugin-sdk, ui, workbench
project -> canvas, collaboration, project-files, uri, ui
canvas -> collaboration, uri, ui
project-files -> uri
collaboration -> yjs only; no Convax package
uri -> no Convax package
api -> collaboration + browser-safe project/collaboration-protocol
```

`@convax/project/collaboration-protocol` MAY compose public pure Canvas validators
through its owning `@convax/project` package. The API MUST import only that public
browser-safe composition; it MUST NOT import private Canvas or Project source.
Main owns the single local durable writer. Renderer, Agent and Plugin callers never
receive an actor private key, raw Y.Doc mutation authority, native path, journal or
service credential capable of choosing identity.

## 4. Global Convax URI governance

### 4.1 Global scope

URI is a Convax-wide protocol, not a Canvas feature. Every Convax-owned URI uses the
five VS Code-compatible components:

```ts
interface UriComponents {
  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string
}
```

`@convax/uri` owns pure `parse`, `from`, `with`, `toString`, `canonicalize` and
`equals`. It has a closed static scheme allocation table. Plugin code cannot add a
scheme or handler. Each scheme owner validates authority, authorization and I/O at
its package edge; a URI string is never a grant.

Canonical rules are inherited from the global URI specification:

- scheme is ASCII lowercase;
- owner-declared opaque authority case rules apply before generic normalization;
- path is a URI path, never an OS path; backslash, NUL and `.`/`..` are rejected;
- percent encoding is UTF-8, uppercase hex, with unreserved aliases normalized;
- query is a sorted repeated-key list by UTF-8 key/value bytes;
- fragment never participates in persistent identity or authorization, and is
  forbidden in persistent Project references;
- total URI is at most 16 KiB, each component 8 KiB, query at most 64 items.

There is no global `resolve(uri)`, dynamic handler registry or service locator.

### 4.2 Project URI and identity separation

The canonical Project entry form is:

```text
convax-project://<project-id>/epochs/<project-epoch>/entries/<entry-id>
  [?path=<project-relative-display-hint>]
  [&blob=sha256:<64-lowercase-hex>]
```

The physical line break above is illustrative; canonical serialization is one
string with query fields sorted by the URI codec.

The authority is an opaque case-sensitive canonical ProjectId, not a DNS host.
Uppercase, Unicode fold and percent-encoded aliases MUST be rejected rather than
normalized into a valid ProjectId.

`ProjectFileId`, URI and blob hash have different jobs:

| Value | Meaning | Mutable |
| --- | --- | --- |
| `ProjectFileId` | Stable logical Project file identity within projectId/projectEpoch | no |
| canonical URI | Global portable expression containing identity, optional path hint and optional content pin | regenerated as projection |
| query `path` | Display/relink hint from canonical Project path projection | yes; never identity |
| query `blob` | Exact immutable byte revision | no for that revision |

`ProjectFileId` uses `pf_<64 lowercase hex>`; directories use
`pd_<64 lowercase hex>`. Allocation is owner-derived from document scope, actorId,
operationId and schema ordinal. UI, Agent and Plugin cannot provide ids.
Comparison MUST name one mode:

- `entry`: projectId/projectEpoch/entryId;
- `entry-revision`: entry identity plus blob hash;
- `canonical-string`: all canonical components including path hint.

Plain string equality MUST NOT silently choose business identity.

### 4.3 Atomic resource references

A Canvas or ProjectIndex resource reference stores one complete canonical URI or
one immutable component object in one Yjs value. It MUST NOT store entryId, path and
blob in independently writable keys; that would permit a mixed reference that no
writer authored.

Portable `ProjectResourceCausalProofV2` is the exact closed record in Project annex
section 3.3. It binds ProjectIndex scope/frontier/state-vector, one atomic
`ProjectResourceReferenceV2`, its digest and exactly one proof mode: `current` or
`retained-history`. Retained-history mode additionally requires the exact
owner-verified history root from frame validation context; it never resolves a
newer current version as a substitute.

`localDurableIndexDigest`, native path, inode, filesystem generation and fsync
receipt MUST NOT enter URI, typed intent, frame or Y.Doc. Local admission is a
non-serializable Main-only permit from `@convax/project/node`; remote durability is
proved separately by `BlobDurableAckV2`.

## 5. V2 canonical wire protocol

### 5.1 Closed major and codecs

The collaboration family is breaking major 2. It rejects all `/1` collaboration,
typed-intent, Canvas root and ProjectIndex root tokens; there is no alias, dual-read
or field-shape inference. Exact format strings, object fields, optionality, domain
registry, shared-type topology, intent unions and limits are closed by the four
pinned annexes. The kernel appendix alone owns shared primitives, causal frame,
state-vector/update codec, candidate/replica ports, exact artifact manifest and the
instantiated bundle. The Canvas appendix is final for Canvas records/intents, the
Project appendix is final for ProjectIndex/reset/native records, and the control
appendix is final for membership/session/Peer/checkpoint/registry/cutoff/ACK wire
objects. A format list in generated documentation is a projection of those exact
artifacts, never another registry or duplicate descriptor definition.

JCS is UTF-8 canonical JSON with RFC 8785 key ordering and the shared
`@convax/collaboration` restrictions: NFC scalar strings; finite JSON numbers;
plain objects and dense arrays only; no accessor, symbol, undefined, cycles, lone
surrogates, NaN or Infinity. Canonical arrays explicitly named as sets are sorted
by their stated byte codec and duplicate-free.

The exact primitive types, lengths and validators are owned only by kernel appendix
section 2. This summary does not redeclare them. In particular, ids/signatures use
their exact unpadded base64url codecs, counters use canonical bounded decimal
strings and digests use exactly 64 lowercase SHA-256 hex characters.

`ReplicaIdV2` is the service-reserved, Project-epoch-unique nonzero uint32 wire
identity whose decoded value is directly the replica's Yjs client id. Kernel never
hashes, probes or chooses a fallback id; control atomically allocates and permanently
burns it, then binds its exact signed reservation receipt into membership and actor
credentials. `StateVectorV2` remains raw update-v1 bytes with the kernel's strict
64 KiB admission boundary. These are cross-owner consequences, not alternate
scalar or control DTO definitions.

`CanvasIdV2` is the one shared kernel codec `cv_<64 lowercase SHA-256 hex>`.
Project derives it, and ProjectIndex routes, Canvas identity and Canvas-kind
`DocumentScopeV2.docId` carry byte-identical values. It is never `Id128V2`, an
owner-local alias or a caller-selected string. The complete shared primitive and
scope definitions remain solely in kernel appendix section 2.

Uint64 JSON numbers, leading zero, plus sign, whitespace and overflow are rejected.
Every digest uses a fixed ASCII domain ending `/2`, a NUL separator and exact
preimage bytes. For structured data the preimage is canonical JCS; for state vector,
Yjs delta, snapshot and blob it is raw bytes. Signatures cover a purpose-separated
digest, never a reserialized object selected by the receiver.

### 5.2 Exact wire ownership

Kernel appendix sections 3 through 15 are the sole definition of restricted JCS,
causal context/frontier, `ActualWriteEvidenceV2`, `CausalEditCoreV2`, header,
signature, five-section payload, `CVXCOLL2` envelope, frame digest,
state-vector/update codec and their exact caps. This main file intentionally does
not reproduce offsets, kinds, DTO fields or preimages. Peer messages and attester
carriers use the distinct exact `CVXPEER2` and `CVXCAR02` contracts in the control
appendix. Project-native records use the Project appendix's exact local schema and
MUST NOT be inferred from causal-frame kind codes.

Cross-owner consequences only: the long-lived replica actor signs the final causal
edit; every duplicated core/context/payload digest and length must be byte-equal;
the owner reducer must reproduce the exact semantic write evidence and Yjs delta;
and `{scope,actorId,actorSequence}` plus `{scope,actorId,operationId}` each identify
one frame. Any alternate bytes are equivocation rather than an arrival winner.

## 6. Identity, sequence, Lamport and frontier

### 6.1 Replica identity and authorization

`memberId` identifies a person/team member. `replicaId` identifies one enrolled
device replica. `actorId` is the long-lived Project-scoped Ed25519 edit signer held
by the native OS-vault adapter. A member may have at most 8 active replicas; a
Project at most 256 active editor replicas.

`ReplicaActorCredentialV2` binds projectId/projectEpoch, memberId, replicaId,
actorId and public key. The exact `ReplicaEditAuthorizationV2` binds membership
snapshot, member/replica authorization epochs, role, installed Project floor and
protocol/schema/artifact digests and has no wall-clock expiry. Transport session
keys do not sign frames. Session replacement or expiry does not invalidate already
valid history.

Actor chain scope is exactly:

```text
{projectId, projectEpoch, docKind, docId, shardEpoch, actorId}
```

There is no `docEpoch`, document-wide revision or membership epoch in chain
identity. Membership and authorization artifacts are nevertheless signed frame
dependencies and are evaluated by cutoff.

### 6.2 Sequence

The first frame in one actor chain is `actorSequence="1"` with null predecessor.
Every successor is exact uint64 +1 and cites the immediately preceding frame
digest. `"0"` is invalid as a frame sequence and is not an absence sentinel; an
absent head is JSON null.

Sequence overflow freezes that actor chain and enrolls/rotates a new actorId. It
does not reset the Canvas shard.

### 6.3 Lamport and portable order

For a frame:

```text
lamport = 1 + max(baseFrontier[*].lamport), with max(empty)=0
```

Document-wide Lamport overflow requires the Project-owned shard reset protocol.
Portable Canvas/Project stamps compare ascending and select maximum by:

```text
(lamport uint64, actorId decoded bytes, operationId decoded bytes,
 writeOrdinal uint32)
```

Machine time, arrival order, Yjs clientId, service catalog sequence and React event
order never select business state.

### 6.4 Causal frontier

`CausalHeadRefV2` contains actorId, actorSequence, frameDigest and lamport. A
frontier is sorted by actorId bytes, duplicate-free and a maximal antichain: no head
may causally dominate another. It has at most 256 heads.

`F <= G` means every head in F is in the causal closure of G. `Max(F)` removes
dominated heads deterministically. A frame predecessor must be in its declared base
closure. Its base state-vector bytes and owner canonical base hash bind the exact
authored state.

Remote validation MUST reconstruct that exact base from a content-certified
checkpoint whose closure is a subset plus the exact suffix DAG. It then requires
byte-equal state vector, reruns the typed intent/guards, checks closed schema and
actual write evidence, and compares reducer-equivalent post-state. A newer arbitrary
snapshot is not a substitute.

## 7. Hard caps and backpressure

All caps apply before large allocation, decompression, JSON/Yjs parsing or media
decode. Inner caps never waive an outer cap.

| Object | Limit |
| --- | ---: |
| URI total/component/query items | 16 KiB / 8 KiB / 64 |
| causal frame/checkpoint JCS header | 64 KiB |
| complete typed intent including guard | 512 KiB |
| guard within intent | 256 KiB |
| causal context | 64 KiB |
| base state vector | 64 KiB |
| one Yjs delta | 1 MiB |
| actual write evidence | 256 KiB |
| Canvas/Project semantic changed paths / logical writes | 512 / 512 per intent |
| complete causal edit envelope | 2 MiB |
| full checkpoint snapshot | 32 MiB |
| checkpoint direct parents / stable set | 8 / 8 |
| causal frontier heads | 256 |
| validation suffix | 4096 frames and 64 MiB |
| proposal plus all parent snapshots | 256 MiB |
| encoded attester carrier | 320 MiB |
| pending inbox per document | 4096 frames and 256 MiB |
| pending inbox per remote actor | 512 frames and 32 MiB |
| local replication outbox per document | 4096 frames and 512 MiB |
| retained durable ACKs per frame | 32 |
| quarantine per Project | 1024 objects and 128 MiB |
| local recovery branch | 1 GiB, then mutation freezes until export/action |
| active Project members / retained revoked members | 256 / 4096 |
| active replicas per member / Project | 8 / 512 |
| active editor replicas / retained revoked or replaced replicas | 256 / 4096 |
| registration claim JCS | 64 KiB |
| outstanding registry candidates per active replica | 4 |
| retained registry entries per member / Project | 1024 / 4096 |
| retained registry claim payload per Project | 64 MiB |
| registry cutoff pages / bytes | 8 / 4 MiB |

Proposal+parent snapshot pool and suffix are section ceilings; the encoded carrier,
including framing, certificates, indexes and artifacts, must still be at most
320 MiB. Section maxima need not be simultaneously attainable.

Trusted local outbox/recovery exhaustion blocks new durable mutations rather than
dropping user work. Untrusted remote pending/quarantine exhaustion rejects bytes and
may close that Peer without damaging accepted state.

## 8. Authoritative document runtime

### 8.1 `replicaDoc`

For each document shard, Main owns one `replicaDoc`: the local durable logical
authority reconstructed from a prunable checkpoint set or retained certified base,
plus every locally accepted causal frame closure. “Accepted” means verified and
durable on this replica, not global consensus.

There is no `certifiedTeamDoc`, provisional `workingDoc`, local-fork Y.Doc or online
replay authority. Replication status is outbox/ACK metadata, not a second document.

### 8.2 `candidateDoc`

Every UI/Agent/Plugin command enters one per-shard Main commit mutex, clones the
latest `replicaDoc` into an isolated `candidateDoc`, applies exactly one bounded
typed intent in one Yjs transaction and validates:

- exact semantic guards and resource dependencies;
- closed root/type/key schema;
- domain invariants and I-confluent projection;
- changed paths/write-set equality;
- state-vector and canonical post-state;
- protocol/schema/Plugin validation artifact digests.

Candidate failure has no durable Canvas effect. Candidate never replaces
`replicaDoc`; only the exact signed and durably committed frame may be applied.

### 8.3 Local commit barrier

The success order is fixed:

1. validate candidate and derive exact ids/stamps/delta/evidence;
2. sign the final frame with the long-lived actor key;
3. write the immutable frame object;
4. append outbox reference and journal record;
5. atomically advance durable head and fsync every required file/directory barrier;
6. apply the exact accepted delta to in-memory `replicaDoc`;
7. commit session undo selection, publish projections, return `saved-locally`.

A crash before step 5 cannot be reported successful. A failure after the durable
head but before memory projection enters recovery-required and rebuilds from durable
objects; it MUST NOT sign a replacement frame.

Remote frames undergo bounded structural validation, membership/cutoff validation,
exact-base reconstruction, reducer/closed-diff validation and durable object/journal/
head commit before they enter `replicaDoc` or receive a durable ACK.

The complete native barrier and reopen matrix is normative in the Project appendix
section 9. In particular, pre-head states are not unspecified staging:

- a durable frame object with no durable reference is never transmitted. It may be
  collected only after a complete durable-reference proof; if it is a valid local
  next-chain signature, reopening prefers finishing that same frame. Abandonment
  requires quarantine plus actor rotation before the sequence can be reused;
- a durable outbox reference or journal record below the accepted durable head is
  never transmitted or projected. Reopen MUST fully validate and finish accepting
  that exact already signed frame, or put the shard in read-only quarantine;
- reopen MUST NOT rerun the intent, allocate another operation/entity/sequence,
  advance from a different base or sign replacement bytes in either state;
- an incomplete/mismatched object-ref-journal closure is corruption and preserves
  all surviving evidence. It is not resolved by mtime, directory order or deletion;
- response-loss lookup by exact local `{actorId,operationId}` returns the original
  accepted frame/result, first completes same-frame recovery when a durable ref is
  below head, or returns recovery/not-saved for object-only evidence. The same
  identity with another request, intent or frame digest is equivocation.

### 8.4 Persistence and ACKs

Only `@convax/project/node` accesses the exact private tree and hashed native-key
layout in Project appendix section 10. This main file intentionally carries no
abbreviated second directory schema.

Native keys are domain-separated hashes, never raw Project/Canvas/user ids.
Journal ordinal, filesystem mtime and durable-head generation are recovery metadata,
not business order.

`ReplicaDurableAckV2` proves an exact frame/checkpoint was verified and fsynced by
another replica. It does not prove blob bytes or permanent availability.
`BlobDurableAckV2` is separate and is issued only after byte-length/hash verification,
blob fsync and local blob-index fsync. A resource-bearing operation becomes
`blob-replicated` only after a current remote replica durably ACKs every newly
referenced blob.

## 9. Semantic undo and redo

`@convax/collaboration` owns a transient per-session `SessionUndoCoordinatorV2` whose
stacks contain only successfully durable local root operation ids. It is selection
state, not Y.Doc or business authority.

- A local root enters undo only after its frame crosses the durable barrier.
- A new local root clears redo.
- Remote frames neither enter nor clear/reorder local stacks.
- Undo selects the latest local root and asks `@convax/canvas` to materialize one
  closed semantic inverse intent against the latest `replicaDoc`.
- Redo materializes one closed forward intent; recreated entities use new identities
  when required.
- The resulting intent goes through a new candidate/frame/durable commit.
- Only after success does the coordinator move one root between stacks.
- Stale guard, missing blob/artifact, cancellation, crash or fsync failure leaves
  both stacks unchanged.
- Process restart, full rebuild, unmount, Project/Canvas scope change and
  project/shard reset clear session stacks. If the domain frame commits but the
  transient cursor move fails, domain state stays committed, the coordinator clears
  and reports `history-reset-after-commit`. There is no cross-restart undo.

Raw `Y.UndoManager` inverse updates MUST NOT enter replicaDoc, journal or wire.
Y.UndoManager MAY be a non-authoritative capture/grouping implementation only if
public APIs preserve candidate validation and commit-after-fsync; otherwise it is
not instantiated.

Undo/redo frames are semantic intents but are not new business roots. Generation
begin/terminal and dismissal/recovery markers are not independently undoable.

## 10. ProjectIndexYDoc schema

The exact nine-root topology, flat key codecs, closed immutable record unions,
projection rules, intent guards/bodies/write ordinals, resource proofs, caps and
native persistence are Project appendix sections 2 through 15. This section states
cross-owner consequences only and MUST NOT be used as a substitute schema.

ProjectIndex root token and exact nine-root topology are defined only by the Project
appendix. Genesis precreates every declared root shared type; validators reject
unknown roots, nested shared types and lazy competing root/container insertion.
This main file intentionally does not duplicate the root interface.

ProjectIndex is the sole Project catalog, file identity/location/content-version
state and Canvas route/tombstone authority. JSON catalogs and service registry are
not parallel stores. It MUST NOT contain Workbench `activeCanvasId`.

### 10.1 Project entries

`entries[ProjectEntryId]` contains immutable identity, kind and content policy.
Locations are flat actor-owned claims containing exact parentDirectoryId, basename,
state and portable stamp. Full paths are derived; rename/move preserves entry id and
updates one location claim. Copy allocates a new id. External watcher events never
infer identity from path, hash, inode or enumeration order; missing entries require
explicit relink.

Same-parent same-basename concurrent creates preserve both ids. Canonical Project
path projection selects one winner by portable order and places
losers under `.convax-conflicts/path-claims/<entry-id>/content`. Missing/non-directory
parents and directory cycles project under deterministic `orphans/` and
`directory-cycles/`. Native case/Unicode alias collisions that cannot be represented
losslessly put the Project in `unsupported-native-path/read-only`; adapters cannot
invent `(1)` names.

`contentFamilies` is the only content-version fact map. Its exact flat key is
`v:<primaryFileId>:<versionId>` as defined by the Project appendix; nested Yjs maps
or a second current-version register are forbidden.
Entry records MUST NOT duplicate a current path or blob. Ordinary text/code writes
preallocate a conflict-copy ProjectFileId and reservation in the same typed intent;
concurrent writes retain both blobs and stable ids. Sequential versus concurrent
writes are determined from exact superseded-version causal edges, never LWW time.

### 10.2 Canvas routes

A Canvas route binds CanvasId, current shardEpoch, staged/live/tombstoned state and
genesis dependency digest. Creation is a cross-shard protocol:

1. ProjectIndex intent creates one staged route and stable CanvasId/shardEpoch;
2. Canvas genesis checkpoint binds the exact staged ProjectIndex frontier;
3. ProjectIndex activation intent binds that genesis digest and makes the route live.

Before activation no fresh client exposes the Canvas. Tombstone hides the entire
Canvas shard; late Canvas frames remain recovery bytes and never recreate a route.
Canvas reset uses a Project-owned staged transition to a new random shardEpoch.
There is no docEpoch. Canvas delete/recreate uses a new CanvasId and never revives a
tombstone.

### 10.3 Project-owned Canvas shard reset

The exact `DocumentShardResetClaimV2`, `DocumentShardResetRouteCasCoreV2`, route
fact, manifest and native transitions are closed by Project appendix section 8.
The reset intent also carries the complete control-owned
`DocumentShardResetConfirmationV2` and `DocumentShardResetApprovalV2`; Project
recomputes their core digests/signatures and enforces every claim/route/confirmation/
approval equality from the two annexes. A digest-only receipt name or locally
invented reset DTO is not accepted.
The claim is at most 64 KiB and binds all of:

- exact old/new Canvas scopes with the same projectId, projectEpoch and Canvas id,
  and a fresh new shardEpoch;
- one closed reason: `incompatible-canvas-schema`,
  `document-lamport-exhaustion` or
  `unrecoverable-certified-history-corruption`;
- old/new protocol and schema digests;
- exact staged genesis checkpoint, full-update and state-vector digests;
- exact ProjectIndex route-CAS core and operation;
- initiating member/replica/actor, Project-admin authorization and the exact
  confirmation/approval core digests.

The durable states are exactly:

```text
shard-reset-staged
shard-reset-awaiting-route-cas
shard-reset-recovery-required
unsupported-old-shard
project-reset-required
```

`abandoned-pre-cas` is only the terminal local manifest result for a pure
`shard-reset-staged` claim that has no durable route-frame reference anywhere; it is
not a sixth live/reset authority state. Before ProjectIndex route CAS the old shard
is the sole live route. After accepted CAS the new shard is the sole current route,
even when its local install needs recovery, and the old shard is recovery-only.
Every retry after the first durable route-frame reference resumes the same claim,
operation id, signed frame, new shard epoch and staged genesis. It MUST NOT abandon,
invent a replacement claim or expose the old route.

Actor-sequence exhaustion rotates actorId. Ordinary equivocation quarantines/revokes
the actor fork. Neither permits shard reset. Corruption reset requires proof that no
trusted retained checkpoint can rebuild the Canvas. If ProjectIndex cannot be
validated, the only legal state is `project-reset-required`; Canvas-local reset
cannot bypass the catalog authority.

## 11. CanvasYDoc schema and projection

The exact eleven-root topology, key/value codecs, actor slots, closed record and
intent unions, write evidence, semantic history, projection, caps and React Flow
gesture semantics are Canvas appendix sections 2 through 18. This section states
cross-owner consequences only and MUST NOT be used as a substitute schema.

Canvas root token and exact eleven-root topology are defined only by the Canvas
appendix. Genesis precreates every declared root and fixed metadata actor-slot
container. This main file intentionally does not duplicate the root interface.

Entity ids/incarnations are operation-derived. One creator transaction creates the
record and fixed actor-slot containers. Field registers are actor-keyed immutable
stamped claims; containers are never replaced. Tombstones are grow-only facts.

Every connectable card has exactly one left input and one right output. Business
edges run source-output to target-input. Structural containment is separate and
MUST NOT be called a business edge parent.

### 11.1 Flat containment

Containment uses one flat key per child/actor:

```text
node/<nodeId>/<incarnation>/actor/<actorId>
```

Each value binds key, child, structural-group parent or null, relationId and
portable stamp. Projection first chooses the maximum valid actor claim per live
child. Missing/deleted/non-group parent projects the child top-level.

Cycles are broken without mutation: inspect canonical cycles, remove the cycle
member with maximum `(portableStamp, UTF8(relationId))`, repeat until acyclic, and
never fall back to a losing choice. All choices remain retained. Business-edge
cycles are allowed and are unrelated to containment.

### 11.2 Generation

Generation begins are immutable. `beginStamp` selects lifecycle; a future
`outputClaimStamp` is allocated at begin time, so terminal arrival time cannot raise
output priority. Owner success/failure terminal is immutable, references the exact
begin and is authored only by the same long-lived actor.

Flat logical keys are:

```text
generationTerminals/<generationId>/owner/<beginActorId>
generationDismissals/<generationId>
generationRecoveryFailures/<generationId>
```

`canvas.generation.dismiss/2` is an explicit current-editor action after observing
the exact begin. Every actor writes the same fixed marker. Dismissal removes that
generation lifecycle and terminal output claim from effective competition without
deleting begin, terminal, resource, manual claim, cancelling work or implying
failure/refund.

`canvas.generation.fail-recovery/2` requires the unique canonical first-loss receipt
for `{projectId,projectEpoch,beginActorId,beginAuthorizationEpochDigest}`, exact cutoff
retention of begin, no surviving owner terminal and a current-editor claimant. It
writes one fixed `generation-owner-unavailable` marker and no output/message.

Canvas owns the headless `CanvasExternalFactContextV2` port. Project verifies
authorization/cutoff and injects the fact in Project-local call context. The
non-serializable permit never enters Canvas public types, intent, Y.Doc or frame;
wire state stores only proofDigest. Missing proof leaves the frame pending.

Projection precedence is:

```text
node tombstone > dismissal > surviving owner terminal > recovery failure > active begin
```

Effective data chooses maximum portable claim among node data and non-dismissed
successful outputs using the output stamp allocated at begin. After dismissal, an
existing node recomputes over remaining prior/manual claims; a pending-generation
node uses its retained placeholder and lifecycle `dismissed`. Suppressed outputs
remain resource-retention roots. A manual edit causally after begin may outrank a
late result. Delete always hides generation and output.

### 11.3 Plugin creation groups and liveness

A Plugin creation group contains exact source incarnation, Plugin snapshot/schema
identity and every created node/edge. Its source must be a causal predecessor.
Source delete concurrent with or after group creation makes the entire group
effectively unreachable; no orphan node or edge survives. Source cycles are schema
invalid.

An ordinary edge is effectively live only when it and both exact endpoint
incarnations are live. Therefore delete-node versus concurrent create-edge leaves
the edge stored but unreachable. A node/edge tombstone is never undone by late
creation or generation output.

## 12. Closed typed intents and caller unification

UI, Agent and Plugin use the same Main application services and the same exact
`convax.typed-intent/2` closed unions. No caller submits whole nodes/edges arrays,
raw Yjs updates, patches, arbitrary command arrays, actor id, Lamport, frontier,
operation-derived identity or expected document version.

The exact Canvas union is `CanvasIntentContractMapV2` in Canvas appendix section 10,
including every literal `/2` kind, closed guard/body and unique command mapping.
The exact ProjectIndex union is `ProjectIndexIntentV2` in Project appendix section
7. Their generated `keyof`/discriminator sets MUST be equal in both directions.
Unversioned aliases, generic save/replace-document, path-only file identity and an
implementation-selected command-to-intent mapping do not exist.

An owner-annex-defined multi-command business operation is one bounded typed intent,
one candidate Yjs transaction and one durable frame. Callers cannot emulate
atomicity with repeated saves. This rule does not invent a Project bulk-file intent;
Project multi-file import has the independent partial-success semantics in section
21 and the Project appendix. Independent intents use exact
entity/field/resource/Plugin guards, not a shared document version, so unrelated
concurrent mutations do not conflict.

Plugin state writes bind exact:

```text
{pluginId, snapshotDigest, pluginStateSchemaDigest, validationArtifactDigest}
```

Missing or mismatched artifacts make the intent pending/read-only. An older Plugin
MUST NOT apply defaults, down-migrate or overwrite newer state. Attestation accepts
only digest-pinned declarative validation artifacts; executable-only Plugin
validation disables pruning for that checkpoint.

## 13. React Flow as a transient renderer

React Flow is a projection layer, never a document owner. `@convax/canvas` owns the
host-neutral editor/view contracts, React Flow projection adapter, projection-cache
reconciliation, incarnation guards and gesture-to-intent materialization. Renderer
state may contain viewport, zoom, selection, hover, drag preview, resize preview,
connection preview, measured dimensions, animation and mounted Plugin UI state only.

- `nodes` and `edges` are regenerated from canonical Canvas projection.
- Selection/dimensions/position events do not directly mutate Y.Doc.
- Drag/resize commits at gesture end as one `canvas.nodes.set-geometry/2` intent with
  exact causal guards; pointer cancel, scope switch and remount discard previews.
- Auto-measured adaptive width/height is view state unless an explicit resize
  command commits size. Deleted, undone or Plugin-extracted nodes must drop cached
  measurements and drag state when their exact incarnation leaves projection.
- A semantic undo that hides/removes Plugin-created nodes causes React Flow to
  reconcile to the new projection; renderer caches cannot keep ghost nodes or
  prevent undo.
- `@convax/canvas` owns select, reveal, fit-view, camera, animation and notification
  command semantics. Workbench owns active Input and input-scoped selection;
  Desktop injects safe viewport/inset, scheduling and platform adapters. View
  failure never rolls back a committed domain mutation.

Renderer IPC submits closed intent requests and receives immutable projections plus
status. It never receives mutable Y.Doc, actor credential, journal path or native
resource path. Desktop owns React shell composition, product chrome, IPC and native
host adapters only; it MUST NOT own a second React Flow document store, gesture
reducer, incarnation resolver or Canvas view-command policy.

## 14. PeerJS identity, sessions and channels

The complete closed trust-bundle, membership snapshot, member/admin/replica/edit
credential, challenge/proof/receipt, session, directory, ticket, handshake,
channel-open, message, transfer and ACK wire is control appendix sections 2 through
7. This section is only its cross-owner transport policy; it creates no alternate
DTO or token alias.

### 14.1 Identity and session

Service-issued peerId is rendezvous routing only. A session credential binds
projectId/projectEpoch, membership snapshot/sequence, memberId/role/member auth
epoch, replicaId/actorId/replica auth epoch, protocol/schema/artifact digests,
peerId, lease, issued/expiry and session public keys. TTL is at most 15 minutes.

Each active replica has at most one current service session and one native
Project-scoped writer lock. Replacing a session closes the old transport lease but
does not change the actor chain. Copied actor keys can still double-sign; writer
lock is not a cryptographic defense.

Membership/session mutation is replay-safe state, not bearer-token issuance:

- `membershipEpoch` is stable for one projectEpoch; `membershipSequence` begins at
  1 and increments exactly once per committed membership mutation;
- member mutation and replica session counters begin at 1 and advance exactly under
  a purpose-bound, single-use service challenge containing a fresh server nonce;
- service issuance transactionally verifies current epochs, key possession,
  expected sequence/counter, challenge TTL and request digest, then atomically
  consumes the challenge, advances state, stores the immutable receipt/credential
  and closes the replaced lease. Signer/store failure rolls back all effects;
- exact retry by `{mutationId,requestDigest}` or
  `{sessionId,sessionProofDigest}` returns the byte-identical stored result; same id
  with a different digest is `idempotency-equivocation` and changes no state;
- actorId is derived from Project/member/replica/public-key identity. Replica key
  rotation allocates a new replicaId, actorId and authorization epoch; it never
  continues the old chain.

Bounds are <=256 active members, <=8 active replicas per member, <=512 active
replicas per Project including viewers, <=256 active editor replicas, <=4096
retained revoked members and <=4096 retained revoked/replaced replicas per
projectEpoch. A membership snapshot contains at most the exact active-plus-retained
totals in the control annex and never truncates to fit.

Rendezvous uses a service freshness ticket of at most 60 seconds binding both exact
credential digests, project/membership snapshot and peerIds. Peers mutually sign a
handshake transcript containing project/epoch, ticket, both credentials, nonces,
connectionId and channel-contract digest. WebRTC DTLS and PeerJS metadata do not
replace this application handshake.

### 14.2 Four independent channels

One authenticated connectionId opens four independently signed/bound PeerJS
DataConnections. Exact channel values are `control`, `update`, `blob` and
`awareness`; labels such as `convax-control/2` are not protocol aliases:

| Channel | Data | Contract |
| --- | --- | --- |
| `control` | inventory, manifests, requests, ACK/NACK, membership/cutoff notices | reliable ordered; message <=64 KiB; highest priority |
| `update` | causal frames, checkpoint bytes, validation suffix | reliable binary; chunk <=256 KiB; <=4 inflight transfers/Peer |
| `blob` | Project blobs and chunk proofs | reliable binary; chunk <=1 MiB; <=4 inflight chunks/Peer |
| `awareness` | cursor, selection, presence, ephemeral gesture hints | lossy/coalesced; message <=16 KiB; TTL 30 s; never durable |

Every update/blob transfer first sends a control manifest binding connectionId,
transferId, channel, kind, exact byteLength, SHA-256, chunk size/count and subject
digest. Receiver verifies session/scope/epoch, queue capacity and manifest before
allocating. Chunk index/count/size and final hash must match exactly.

Each channel has separate queue, cancellation and strike budget. Blob saturation
MUST NOT block control, update or awareness. Control/revocation cannot wait behind
video. Session close, epoch/scope mismatch, failed transcript or repeated malformed
input closes all four channels.

Every connection uses a fresh service ticket, connectionId and two signed handshake
nonces. Each channel-open then binds that handshake, its channel, fresh
channelOpenId/nonces, both credentials and the exact channel-contract digest.
Exactly one live open exists per channel. Reopen allocates a new channelOpenId and
nonces; it cannot transplant another connection or credential pair.

Signed message sequence begins at 1 per sender/channel-open. Control, update and blob
accept exact +1 only; awareness accepts strictly increasing high-water and drops
older/replayed values. Message core binds connection, channel-open digest, sender,
receiver, channel, body kind, byte length, body digest and protocol digest. A gap,
rollback, cross-channel body, signature mismatch or same transferId with a different
manifest never becomes business ordering; it is a channel/replay failure under the
closed control-annex state machine.

### 14.3 Offline, reconnect and bootstrap

Offline commits use the same final frames and durable outbox. Reconnect exchanges
membership/cutoff high-water, prunable checkpoint-set digest, actor heads, causal
frontier and state-vector summaries; it then requests exact missing objects and
revalidates them idempotently. It never re-executes local intents.

A current seeded replica may edit without service/Peers, but cannot publish a new
checkpoint certificate, refresh membership or claim remote replication. A new
device with no online holder is `waiting-for-holder` and read-only. If structure is
available but current blobs are missing, state is `structure-ready-media-missing`;
editing unrelated metadata remains allowed after structural bootstrap.

A viewer has no frame-signing authority. Viewer-to-editor transition first creates
`pending-editor`, bootstraps and installs the current stable floor, then atomically
issues active editor authorization. Viewer absence never blocks compaction.

The pending editor's required document set is derived only from one
content-certified current `ProjectIndexLiveScopeManifestV2`: the ProjectIndex scope
plus every current live, non-tombstoned Canvas route in that exact ProjectIndex
projection. Service registry presence, absence or state is anti-rollback/discovery
evidence only; it cannot grant, deny, add, remove or block a required scope. The
authorization transaction revalidates the same current certified manifest and all
route activation digests immediately before activation. Any ProjectIndex route
change makes the attempt `pending-editor-floor-stale` and requires a fresh manifest
and floor, never a registry-derived patch.

## 15. Checkpoint dual gate and compaction

### 15.1 Candidate and content certificate

An actor-signed checkpoint candidate is discovery metadata only. A purpose-separated
stateless attester transiently streams exact checkpoint, certified parents, suffix
DAG, signatures, exact bases, typed intents, closed Yjs writes, Project/Canvas/
declarative Plugin schema artifacts, invariants and final hashes.

`CheckpointContentCertificateV2` binds exact scope/checkpoint/parents, computed
frontier/actor heads, state-vector/canonical/full-update hashes and protocol/schema/
artifact/trust digests. Payload bytes MUST NOT enter durable store, log, trace,
analytics, retry queue or crash recovery. If attestation is disabled, unavailable,
over cap or nondeterministic, normal edits/checkpoint candidates continue but full
genesis history is retained. There is no metadata-only pruning fallback.

### 15.2 Active-editor causal floors

`StableCheckpointSetCoreV2` binds document scope, prior set digest, 1..8 sorted
content certificate digests, merged frontier, actor-head boundaries, exact
membership snapshot and protocol/artifact digests.

Every active editor replica independently validates and fsyncs the exact set,
ensures all of its durable local heads are included, installs a monotonic floor and
signs `ReplicaCausalFloorAckV2`. ACK collection is invalid if membership changes.
Viewer ACKs do not count and are not required.

Only exact all-active-editor coverage allows service to sign
`PrunableCheckpointSetCertificateV2`. Service CAS serializes this GC metadata only.
It does not select edit winners. One offline editor blocks the certificate until it
ACKs or is explicitly revoked.

### 15.3 Pruning

A replica may prune a causal-past payload only when:

- a valid prunable-set certificate covers it;
- exact checkpoint bytes/certificates/floor ACKs/heads are fsynced locally;
- no pending base, outbox, recovery, equivocation, semantic-history, resource-root
  or audit retention reference requires it.

It retains checkpoint payload, actor sequence/digest boundaries, operation/identity
receipts, semantic history and resource-retention roots. A signer that later emits
a below-floor successor creates invalid/fork evidence. An actor omitted from a
legally pruned floor indicates illegal compaction. A revoked actor's below-cutoff
work is recovery-only. Digest-only witnesses and validation on a newer snapshot are
forbidden.

## 16. Revocation, cutoff and recovery

Routine replica revoke, member revoke or editor-to-viewer downgrade rotates only
the target authorization; it does not change projectEpoch or shardEpoch and does not
reset unrelated actor chains.

There is no trusted client time. For a target actor:

- frames inside the explicit certified cutoff closure survive;
- target frames outside it become read-only recovery;
- descendants that causally depend on excluded target frames are blocked/recovery;
- independent frames from other authorized actors remain valid.

Authorization can close immediately while cutoff payload is unavailable. A replica
then reports `cutoff-material-unavailable`, rejects new target frames and does not
claim team-ready rebuild. Target cooperation is never required.

### 16.1 Registered-scope discovery index

Service owns a grow-only registered-scope discovery/security index that may lag
ProjectIndex. It is not a complete scope set or route catalog. Absence never denies
a scope proved by exact ProjectIndex and causal evidence. States are:

```text
registered-candidate -> dual-validated | abandoned
```

A current editor registration binds exact scope, genesis checkpoint digest and
ProjectIndex route-dependency digest. Service checks identity/signature/caps only.
Promotion
caches immutable dual-gated genesis proof but is not route/edit/bootstrap authority
or a current pointer. Registrar/admin abandonment is retained, releases one
outstanding slot and cannot undo promotion. Retry uses a new contiguous revision.

Entry identity is `{scopeKey,registrarReplicaId,claimRevision}`. Revisions start at
`"1"`, advance exactly after abandonment, and are strictly ordered with scope and
registrar bytes. Per registrar only its highest contiguous legal revision
participates. Per scope, dual-validated leaves dominate candidate/abandoned empty
leaves; certified target frontiers combine by deterministic `Max`. All revisions
remain retained and count toward caps.

The exact `DocumentRegistrationClaimV2`, abandonment, entry, signed snapshot and
fold are control appendix section 10. A registration claim is <=64 KiB. Capacity is
checked before claim allocation, signing or state mutation under all limits at once:

```text
outstanding candidates <= 4 per active registrar replica
retained entries <= 1024 per member
retained entries <= 4096 per Project
retained claim payload <= 64 MiB per Project
```

Every retained revision counts toward the member/Project/byte limits. Promotion or
abandonment releases only the outstanding-candidate slot; it never reduces retained
entry or claim-byte accounting and never erases audit bytes.

The registry failure contract is closed:

- `scope-capacity-exceeded` rejects service registration before allocation but MUST
  NOT invalidate a ProjectIndex route or prevent exact seeded-Peer sync outside
  service discovery;
- `scope-reset-claim-required` rejects registration of a replacement shard scope
  unless it is bound to the exact ProjectIndex-proven `DocumentShardResetClaimV2`
  and route transition. It never fabricates reset authority;
- `registry-rollback-quarantine` rejects a lower sequence or same-sequence/
  different-root response and preserves the highest verified root;
- `cutoff-coverage-incomplete` means one or more immutable cutoff pages are absent;
  no target frame may be accepted or excluded and no team-ready rebuild is claimed.

### 16.2 Closed cutoff target

`RegistryCutoffTargetV2` is the exact closed union in control appendix section 10;
this main file does not provide a structurally similar substitute.

Member actor set is the exact pre-mutation active-editor set, unique and sorted by
replicaId bytes, max 8. Service verifies equality with the before snapshot. A member
leaf frontier is the causal union for all listed actors; empty excludes all. Wrong
kind/action, missing/duplicate actor, epoch mismatch and cross-target replay fail.

### 16.3 Immutable cutoff coverage

There is one identity-sorted `TargetCutoffLeafCoreV2` per retained registry entry. Each
<=1 KiB leaf binds entry identity/state and a certified target frontier or exact
`empty-target-frontier`. Leaves split deterministically into <=8 immutable pages,
each <=512 leaves/512 KiB; total <=4096 leaves/4 MiB.

The <=64 KiB service-signed root binds projectId/projectEpoch, cutoffId, closed
target/action, before/after membership snapshots, registry sequence/root, fixed
unlisted-empty policy, ordered page digests and leaf count. Authorization mutation
binds the same target/action and coverage-root digest. Mutation, root and pages are
stored atomically.

V2 proves unlisted scope only after every ordered page verifies. Any missing page is
`cutoff-coverage-incomplete`; until complete, no target frame is accepted/excluded
and no team-ready rebuild is claimed. Current mutable registry and ad-hoc
non-membership proofs are forbidden.

Registered candidate/abandoned and never-registered scopes default to empty target
frontier. Only an explicit certified leaf preserves target frames. This target-global
default prevents offline unregistered scope from bypassing revoke while leaving
independent surviving actors eligible for later validation.

## 17. Project files, blobs and resource replication

### 17.1 Stable identity and content families

ProjectFileId is logical identity, canonical URI is portable location/reference,
versionId identifies one content-family version, and SHA-256 identifies exact bytes.
None substitutes for another. Version ids are operation-derived opaque ids; caller,
path, wall clock and filesystem inode cannot allocate them.

ProjectIndex is the sole current-version authority. Each immutable content-version
record binds primary file id, versionId, write class, canonical revision URI, blob
hash/length/MIME, creator operation/stamp and exact superseded version ids; the
owning entry's content policy is validated separately. Canvas
stores only one atomic URI/resource envelope plus proof digest, never a native path
or duplicate current-version field.

Policies are closed:

- generated results and managed-asset admission are immutable; every new result
  allocates a new ProjectFileId and version;
- an explicitly overwritable binary entry chooses current by deterministic
  `(binaryLogicalCounter, creatorActorId decoded bytes, versionId ASCII)` maximum,
  never wall clock; losing blobs do not enter file history and are GC-eligible after
  all references disappear;
- Markdown, code and other ordinary human-edited files never use silent binary
  LWW. A write intent preallocates a conflict-copy ProjectFileId/reservation. Causal
  sequential writes advance one family; concurrent writes activate both stable
  entries/blobs and deterministic `.convax-conflicts/<entry-id>/content`;
- concurrent same-path create preserves every entry id; path projection alone
  chooses materialization winner and conflict location.

Project file move/rename changes stable parentDirectoryId/basename claims and URI
path hint, not ProjectFileId. Canvas references are not rewritten. A missing file
remains visible and requires explicit relink. External filesystem watcher events are
invalidation hints only; they cannot infer identity.

### 17.2 File/Canvas commit boundary

File-backed content and Canvas metadata are not one transaction. The owner first
publishes/fsyncs the user-visible file or admits the managed blob, then constructs a
Main-only `LocalBlobAdmissionTokenV2`, then commits the ProjectIndex version/reference,
and finally commits a Canvas reference intent. If the Canvas commit fails, the file
and ProjectIndex version remain and the UI reports partial success. No cross-file
WAL or inverse Canvas update rolls bytes back; unreferenced managed blobs enter
delayed GC.

### 17.3 Transfer, ACK and availability

Blob discovery uses ProjectIndex resource proofs and holder inventories. Bytes move
only on the exact `blob` channel under a manifest, exact chunk indices, bounded
inflight window, per-chunk SHA-256 and final full SHA-256/length.
Receiver writes staging, verifies bytes, atomically publishes the local
content-addressed object and index, fsyncs, then signs `BlobDurableAckV2`.

Frame ACK and blob ACK are independent:

- `saved-locally`: local frame/head durable;
- `structure-replicated`: at least one current remote replica durably ACKed frame;
- `blob-replicated`: structure plus every newly referenced blob has one current
  remote durable ACK;
- `fully-offline`: every currently referenced blob is durable on this device.

A device may edit structurally while a video is missing, but cannot play it offline.
Blob transfer never blocks control/update channels. “Replicated” for a
resource-bearing mutation requires both structure and blob barriers.

### 17.4 Retention and GC

GC traces exact roots from current ProjectIndex versions, live Canvas references,
suppressed generation history, semantic undo material, checkpoints, pending/outbox,
recovery/quarantine, conflict reservations, staged publication and active transfers.
Managed content-addressed bytes with no roots enter a rebuildable delayed-GC set and
are deleted only after a subsequent root rescan. A stale remote ACK is not a root.

GC never deletes an ordinary user-visible Project file merely because Canvas no
longer references it. User file deletion is a typed Project operation. A device may
evict an unreferenced local cache replica, but cannot claim `fully-offline` until all
current roots are present again.

## 18. Plugin and Canvas convergence contract

### 18.1 Plugin schema compatibility

Every durable Plugin state envelope binds exact
`{pluginId,snapshotDigest,pluginStateSchemaDigest,validationArtifactDigest}` and
bounded canonical state. The Host validates using the immutable Plugin closure and
declarative artifact named by those digests.

- Missing/mismatched artifacts put the frame or node in pending/read-only state.
- An older Plugin cannot write defaults, strip unknown fields, down-migrate or
  overwrite a newer schema.
- Plugin install/ActiveSet selection is not Canvas state and never changes a node by
  itself. A state change is an explicit guarded typed intent.
- Executable-only validation may run locally under normal Plugin authority but is
  ineligible for service checkpoint attestation; history remains unpruned.
- Runtime behavior derives from validated contributions and never branches on a
  concrete Plugin id.

### 18.2 Creation group, containment, generation and delete matrix

`canvas.plugin.creation-group.create/2` is the only Plugin node-plus-edge atomic
materialization intent. It binds one causal-live source incarnation, exact Plugin
schema tuple, exact resource proofs and one immutable creation-group reference on
every result. Its body cardinalities and weighted logical-write equation are owned
only by Canvas appendix sections 10 and 14; this summary supplies no independent
node, edge or result cap.

The following projection rules are mandatory under every message order:

| Concurrent facts | Canonical result |
| --- | --- |
| source delete vs Plugin group create | entire group nodes and edges unreachable; no orphan result |
| node delete vs edge create | edge retained but unreachable because endpoint is not live |
| node delete vs generation terminal | node/output hidden; terminal retained as history |
| route tombstone vs Canvas frames | complete Canvas hidden; frames recovery-only |
| concurrent reparent choices | retain each actor choice, choose portable max, then deterministic cycle break |
| containment cycle | drop maximum cycle relation without fallback; business edges unaffected |
| concurrent generation/manual claim | begin-time output stamp competes with manual stamp; arrival time ignored |
| dismissal vs success | lifecycle dismissed, output removed from effective competition, bytes retained |
| valid owner-loss recovery vs late excluded owner terminal | failed-recovery unless dismissal/tombstone wins; late terminal recovery-only |

Business edges are never called parent and may contain graph cycles. Only structural
containment must be acyclic in projection. Delete facts are grow-only and cannot be
reversed by a late Plugin, Agent or generation result.

## 19. Breaking cutover and removal of legacy authorities

All v1 collaboration bytes, path-only Project metadata and legacy JSON Canvas
catalog/documents are unsupported portable bytes. Project open may detect and show
their exact location/size, but before user confirmation it MUST NOT hydrate,
rewrite, migrate, compact, garbage-collect or partially reset them.

The reset UI offers cancel or explicit destructive reset with the exact deletion
set and second confirmation. After confirmation it may delete all old `.convax`
Canvas, ProjectIndex, collaboration journals/checkpoints/outboxes/recovery,
unsupported managed assets and private metadata. It preserves ordinary Project
files and stable `projectId`; a separate explicitly named filesystem deletion is
required to delete ordinary files. Reset creates a new random `projectEpoch`, empty
ProjectIndexYDoc and empty Canvas catalog. There is no docEpoch.

Reset fences every old session/writer, stages a complete new tree, fsyncs it and
publishes with same-filesystem atomic rename/swap. Crash recovery chooses one whole
tree; ambiguity keeps Project closed as `reset-recovery-required`. A team Project
uses the exact control-owned `ProjectResetConfirmationV2`,
`ProjectResetApprovalV2` and `TeamEpochRolloverReceiptV2` chain plus transient
attestation of the exact empty ProjectIndex genesis. Project persists and verifies
the complete objects and exact core-digest equalities defined by the control and
Project annexes, including protocol, Project schema and URI protocol digests. An
unteamed Project accepts only the control-defined `local-project-owner`
confirmation whose key resolves from a pre-existing durable Project binding; reset
bytes cannot introduce or authorize that key. Service stores no snapshot. Service
unavailability may permit staging but not authorization/completion. No old
credential or frame can cross projectEpoch.

For a team reset, the initiator is the exact current active-editor `ReplicaIdV2`
bound byte-for-byte across the claim, confirmation, credential, reservation receipt
and current edit authorization. Control owns one complete thirteen-step pure
verifier and its portable first-failure order. The Project application service owns
the process-local accepted-authority-head witness and one-shot permit: it runs that
same complete verifier before permit issue and again for the sole consume winner,
with the four Project-owned currentness assertions and no async or callback gap
between the final assertion, `consumed` transition and synchronous reducer entry.
Neither witness nor permit is serializable, persistent, IPC-visible or recoverable;
durability and crash recovery remain solely the kernel journal/head barrier.

The following paths and concepts are deleted, not adapted:

- document-wide `version`/`revision`, `expectedVersion`, whole-document save and
  compare-and-swap conflict UI;
- central per-edit admission, AdmissionCertificate, server edit sequence/high-water,
  MMR, leaf reservation and abandonment protocol;
- `certifiedTeamDoc`, provisional `workingDoc`, `localForkJournal`, local-fork Y.Doc,
  admission/abandonment outboxes and reconnect replay;
- JSON Canvas catalog/document as a parallel authority;
- renderer/localStorage Canvas persistence, raw Agent/Plugin Yjs writes and generic
  patch/transaction APIs;
- metadata-only checkpoint certificate, declared-parent frontier authority and
  first-arrival/LWW conflict winners.

Legacy bytes are never silently interpreted as v2 and old Project reset is the only
supported cutover. Architecture contracts, boundary policy and generated protocol
docs must change atomically with the implementation; code cannot retain a hidden
legacy fallback.

## 20. Product failure-state contract

| State | Meaning and permitted action |
| --- | --- |
| `saved-locally` | local frame durable; continue offline, do not promise team copy |
| `replicating-structure` / `replicating-blobs` | bounded background transfer; edits continue subject to outbox cap |
| `structure-ready-media-missing` | Yjs/ProjectIndex ready, named blobs unavailable; editing allowed, playback blocked |
| `fully-offline` | all current structural state and referenced blobs local |
| `waiting-for-holder` | fresh replica lacks certified payload/witness; no empty doc or edits against unknown state |
| `dependency-pending` | predecessor/base/ProjectIndex/schema/proof absent; request it, do not ACK |
| `base-witness-unavailable` | exact authored base unavailable; read-only/pending, never validate on newer snapshot |
| `checkpoint-candidate` / `attestation-unavailable` | edits continue; history retention required |
| `awaiting-editor-floors` | checkpoint content valid but not prunable; offline editor or local head outstanding |
| `checkpoint-payload-unavailable` | post-prune/bootstrap bytes lack holder; no team-ready claim |
| `floor-membership-stale` | membership changed during ACK collection; discard attempt and restart coverage |
| `pending-editor-floor-stale` | certified ProjectIndex live-route manifest changed before editor activation; discard it and derive a fresh exact required set |
| `cutoff-material-unavailable` | authorization closed, exact team rebuild waiting for payload |
| `cutoff-coverage-incomplete` | not all immutable pages verified; accept/exclude no target frame |
| `scope-capacity-exceeded` | service registration rejected before allocation; ProjectIndex/seeded-Peer authority unchanged |
| `scope-reset-claim-required` | replacement shard registration lacks the exact ProjectIndex-bound reset claim; no scope mutation |
| `registry-rollback-quarantine` | lower or equivocal registry root rejected; retain highest verified root |
| `shard-reset-staged` | old route sole live; pure pre-CAS staging may continue or be explicitly abandoned |
| `shard-reset-awaiting-route-cas` | retry only the exact claim/frame; no abandon, reallocation or re-signing |
| `shard-reset-recovery-required` | accepted CAS makes new route current; old shard remains recovery-only |
| `unsupported-old-shard` | preserve old shard bytes but never route them live |
| `project-reset-required` | ProjectIndex is untrusted; no Canvas-local reset bypass |
| `recovery-available` | exact excluded bytes retained read-only; export or explicit new semantic intent only |
| `equivocation-quarantine` | same chain sequence/operation maps to different digest; freeze fork and descendants |
| `plugin-artifact-unavailable` | retain opaque state, disable mutation/defaulting and request exact artifact |
| `protocol-schema-bundle-unavailable` | any pinned annex/digest/descriptor missing or mismatched; fail closed before decode/sign |
| `canonical-authority-conflict` | main and pinned owner annex genuinely disagree; stop implementation and re-review the set |
| `outbox-backpressure` | local durable user work at cap; block new mutations, never delete old work |
| `unsupported-portable-version` | preserve bytes until explicit reset confirmation |
| `reset-recovery-required` | crash left ambiguous tree publication; keep Project closed |

Errors and states are scope-bound to exact projectEpoch/shardEpoch. Project switch,
Workbench remount and session replacement cancel stale async/view effects, but never
cancel an already durable domain commit.

## 21. Unified UI, Agent and Plugin authority

All three callers enter the same typed application services. Adapters translate
surface input only; validation, placement, identity, conflicts, resource proof,
Plugin schema, persistence and concurrency remain in Project/Canvas owners.

- UI gestures commit one closed intent at gesture end; React Flow is projection.
- Agent document tools may name any live Canvas in the current Project and call Main
  directly; view tools remain bound to the mounted active Canvas. Agent cannot edit
  `.convax`, choose another Project or depend on renderer availability.
- Plugin calls pass through validated Host API/contributions and immutable Plugin
  principal. Plugin cannot submit raw frames, identities, frontiers, paths or a
  whole document, and cannot call another Plugin except through the typed broker.
- Host assigns operation/entity/file/generation ids and portable stamps.
- Canvas multi-node/edge outcomes that require atomic visibility are one bounded
  Canvas business intent. Project v2 has no bulk file intent: multi-file import
  publishes and commits independent `project.file.create/2` operations and reports
  the exact committed subset on interruption/failure. Repeated saves are not
  atomicity, and a future atomic Project bulk operation requires a new reviewed
  closed intent rather than a summary-level promise.
- File publish precedes Canvas reference; partial success preserves the file and
  reports the Canvas failure.
- Cancellation before durable head aborts; cancellation after durable head cannot
  roll back domain state and only suppresses stale view effects.

Revision 5.3 closes the cross-owner seams without creating a fifth domain owner:

- Kernel owns the generic accepted/working/candidate runtime, selected owner
  runtime/protocol/intent-closure/history/external-fact/base-causal-closure ABIs,
  stable remote-transfer identity and the four affine ingress capabilities. Canvas
  and ProjectIndex only specialize those closed generic ports.
- A remote causal frame reserves Project-epoch and stable source-member quota,
  stages and hashes exact bytes, authenticates its bounded header, structurally
  parses its five sections, durably publishes object then inbox, and only then runs
  semantic authority, exact-base, owner and Yjs validation. Recovery resumes from
  durable receipts; it does not reconstruct process-only capabilities or re-encode
  an envelope.
- Same `{projectId,projectEpoch,sourceMemberId,transferId}` plus the same manifest
  digest is one reconnectable transfer. A different manifest digest for that stable
  key is terminal equivocation. Connection and Peer identity never partition quota
  or create a second durable transfer.
- ProjectIndex activation binds an accepted route dependency frame `F` to a complete
  Canvas genesis `ReplicaCheckpointV2` wrapper `G`. Canvas identity carries the
  exact `projectIndexRouteDependencyFrameDigest`; activation validates full
  checkpoint bytes and equality with `F`. Registration claim may queue after an
  offline activation and is not an activation precondition.
- Document-shard reset declares one Owner dependency C. C self-contains the staged
  G proof and claimed authority sections but not F bytes or any mirrored reset DTO.
  G identity supplies the untrusted F hint; branded Kernel phase views prove and
  supply the exact accepted-base F to the one F13 implementation and apply. Every
  phase independently consumes `{F}` and the route CAS does not repeat F.
- G and C transfer only on the update channel through the separate durable
  dependency cache. Their session ACK has null durability proof and is not a frame
  or blob durable ACK. Retained bytes continue to count against Project/member
  quota until atomically reclassified to a live root or released by no-root GC.
- Signed wrapper lookup succeeds only when the durable subject index selects one
  core and the durable core index selects one object. Same-core equivocation also
  terminally conflicts the subject. Both indexes change through one sole-writer
  journal/head transition.

## 22. Executable conformance gates

### 22.1 Golden and cross-runtime

The same fixtures MUST produce byte-identical results in Bun, Chromium and attester:

- all four annex whole-file digests, exact ordered path+SHA JCS preimage and
  `6907964865c69b99d0a3cf2f89d6f92d2f8d8b1d221f98b567693f03d4832075`
  annex-set digest;
- exact four-ref artifact manifest, 129-domain registry, namespace/import graph,
  73 named control limits, four channel policies, their exact digests and
  `ce60112affb9dddb88e6e22dd86d71cfad3a6cbe39bdd6582969dedae7a6c838`
  bundle core/protocol digest;
- URI parse/canonicalize/comparison and malformed percent/path rejection;
- JCS, shared `cv_<64hex>` Canvas ids/scopes, uint64, every digest domain, Ed25519
  preimage and binary envelope;
- sequence `1/null`, successor, Lamport, portable stamps and frontier `Max`;
- causal frame/checkpoint/content certificate/floor/prunable-set signatures;
- closed replica/member cutoff target, registry pages/root/fold and replay rejection;
- ProjectFileId/version/URI/blob proof, frame ACK and blob ACK;
- ProjectIndex/Canvas canonical hashes, their 512 logical-write limits and all
  exact/over-one cap fixtures;
- exact shard/Project reset confirmation, approval and team-rollover receipt core
  equalities, signatures, stale-principal rejection and local-binding resolution.

Two independent implementations receive only the approved five-file authority set,
not repository source or older drafts. They MUST generate byte-identical descriptor,
node-create, Plugin-group, Project text-conflict, membership credential,
channel-open, cutoff, checkpoint and blob-ACK fixtures and accept/reject the same
hostile values. Asking the author to choose a field, alias, optional key or cap
falsifies protocol closure.

### 22.2 Model, property and fuzz

Two/three/nine-Peer message permutations, duplicate delivery, disconnect/reconnect
and randomized DAG topology MUST converge for:

- node delete/edge create, generation terminal/delete/manual/dismiss/recovery;
- Plugin creation group/source delete and Plugin schema mismatch;
- concurrent containment/reparent and three-node cycles;
- file same-path create, sequential/concurrent text write, binary overwrite and
  rename/relink;
- concurrent checkpoints, invalid child, 8-parent merge tree and late old-base frame;
- registry retry/abandon/fold, page permutations and member/replica cutoff.
- pending-editor bootstrap where a live ProjectIndex Canvas is absent from registry,
  a registry-only tombstoned scope exists, and the route changes before activation;
- multi-file Project import interruption with an exact independently committed
  subset and no encodable atomic bulk variant.

The fifth outstanding registry candidate for one active replica and retained member
entry 1025 MUST fail before allocation while another under-cap member can still
register. Promotion/abandonment frees only the outstanding slot. Every membership,
replica, session, retained-identity and claim-byte cap is tested at exact maximum and
plus one without truncation or partial mutation.

Fuzzers cover envelope lengths, JCS depth/types, URI aliases, Yjs unknown roots/
shared types/keys, hidden writes, signatures, Peer manifests/chunks, compression
expansion, Plugin envelopes and Project path aliases. Any arrival-order canonical
hash difference is a protocol defect, never a PeerJS retry bug.

### 22.3 Crash and durability

Fault injection stops after every object/outbox/journal/head fsync, remote ACK,
blob staging/hash/index publish, checkpoint/floor install, registry root/page/
membership transaction and reset staging/CAS/swap boundary. Reopen must return the
last acknowledged durable state, never duplicate identity, re-sign, partial reset or
ACK bytes not durable.

The matrix MUST separately cover frame-object-only, outbox-ref-below-head,
journal-below-head and head-visible/memory-absent states. Transport sends none before
head. Reopen completes the exact signed frame or quarantines read-only and
`lookupLocalOperation({actorId,operationId})` returns that same identity/result. The
matrix also crashes shard reset before staged genesis, before first route-frame ref,
before route CAS and after CAS; it proves one live route, old-byte retention,
same-claim recovery and pre-CAS-only abandonment.

### 22.4 Security and package gates

Tests include peerId impersonation, expired/replayed ticket, cross-project/epoch
frame, cloned-key equivocation, cutoff target/page swap, malicious attester, one
honest editor floor refusal, payload leakage into service logs/retries, resource
path traversal/symlink, oversized queues and blob HOL isolation.

Replay mutation/session challenges and channel opens across credential, lease and
trust-key rotation. Exact retry MUST return one receipt/credential; stale nonce,
counter, ticket, channel-open or sequence MUST NOT issue a second session or alter
membership. Cross-connection channel transplant and same transferId/new manifest
must fail before body allocation or durable state change.

Every affected package runs `bun typecheck` and `bun test`; public boundary, IPC,
persistence or composition changes also run `bun check`. Publishable packages run
build/clean/prepack/prepublish and pack a real tarball into a clean external consumer
that imports every public entry. Import scans enforce the dependency graph and prove
API does not import private Canvas source, Canvas does not import Project/membership,
and renderer/Agent do not access native collaboration stores.

## 23. Implementation lanes and owners

Implementation remains blocked until three reviewers sign the same detached main
digest, pinned annex-set digest and exact `ProtocolSchemaBundleV2.coreDigest`. After approval, work
may run in parallel only along these ownership lanes:

1. **URI lane — `@convax/uri`, `@convax/project-files`:** global codecs, comparison,
   opaque ids, URI golden tests; no resolver.
2. **Kernel lane — `@convax/collaboration`:** JCS/envelopes, causal DAG, exact-base
   validation ports, candidate/replica, journals, floor and undo coordinator.
3. **Canvas lane — `@convax/canvas`:** v2 root/reducers/intents, containment,
   generation, creation groups, semantic inverse and property fixtures.
4. **Project lane — `@convax/project`:** ProjectIndex, file/version/path projection,
   resource proofs, routes/reset composition and public protocol verifier.
5. **Native lane — `@convax/project/node`:** object/journal/head/outbox/checkpoint,
   blob admission/materialization/GC and crash recovery adapters.
6. **Control-plane lane — `@convax/api`:** membership/session/rendezvous, stateless
   attester, registry/cutoff transactions and payload-zero audits.
7. **Transport lane — `@convax/desktop`:** PeerJS handshake/four channels,
   backpressure, OS-vault/writer lock and Main IPC clients.
8. **Renderer lane — `@convax/canvas`:** React Flow projection adapter, gesture
   lifecycle, transient reset, view commands and incarnation reconciliation;
   Desktop composes shell/status UX, safe-viewport and stale-effect adapters.
9. **Caller lane — Desktop/Agent/Plugin adapters:** one typed service surface,
   capability scoping and removal of version/save/raw-update paths.
10. **Cutover lane — Project/Desktop composition:** unsupported detection, explicit
    reset, legacy deletion and end-to-end recovery fixtures.

No lane may edit another package's private files, add a service locator, duplicate a
reducer, or temporarily retain a document-wide version fallback. Cross-lane contract
changes return to architecture review before implementation continues.

## 24. Red-team conclusion

### Strongest three rebuttals

1. The dual checkpoint gate combines a central content/privacy boundary with an
   all-editor availability barrier and still shares common validator bugs.
2. Offline-first, immediate revocation and bounded history cannot all be lossless:
   a lost editor either blocks compaction or its unreplicated work becomes recovery.
3. The protocol is a distributed database: URI/JCS/Yjs/Plugin/file/cutoff drift in
   one runtime partitions history despite having no edit sequencer.

### Flaw types explicitly eliminated

- **duplicate authority:** no JSON catalog, renderer store, service registry,
  local-fork doc or path becomes Project/Canvas truth;
- **hidden online assumption:** existing replicas edit offline; fresh no-holder
  bootstrap explicitly waits;
- **logical jump:** checkpoint hash/header is not content validity, remote ACK is not
  blob durability, and published checkpoint is not causal stability;
- **fact/protocol conflict:** v2 has one sequence genesis, epoch scope, intent token,
  cap set and signed cutoff target;
- **locality leak:** native paths/index digests never enter portable bytes;
- **lifecycle omission:** generation owner loss, candidate abandonment, stale floors,
  incomplete cutoff pages and reset crashes have explicit states.

### Falsifiable release gates

This architecture is false and implementation MUST stop if any of these occurs:

1. unrelated concurrent entity intents conflict because a document version changed;
2. offline reconnect changes a committed frame digest/identity;
3. invalid checkpoint prunes with either content certificate or editor floors absent;
4. one missing cutoff page accepts/excludes a target frame;
5. registry state creates/revives/hides a Canvas independently of ProjectIndex;
6. Plugin schema mismatch writes defaults or down-migrates state;
7. delete/creation/generation/containment message order changes canonical projection;
8. resource proof depends on a sender's local path/index, or UI says blob replicated
   before a remote blob fsync ACK;
9. raw UndoManager/renderer/Agent/Plugin update reaches authoritative Y.Doc;
10. unsupported bytes change before reset confirmation, or reset deletes ordinary
    Project files without a separate explicit deletion action;
11. any package fails clean-consumer pack/boundary tests;
12. service durable/log/trace storage contains checkpoint, frame, Yjs or blob payload.
13. a missing/mismatched pinned annex is replaced by a main-file summary, old draft
    or locally copied schema;
14. shard reset exposes two live routes, revives the old route after CAS, abandons
    after a durable route-frame reference or resumes with a new claim;
15. frame object/outbox/journal below head is transmitted, re-executed, reallocated,
    re-signed or silently deleted rather than exact-frame recovery/quarantine;
16. registry admission exceeds any replica/member/Project/byte cap, frees retained
    accounting on abandonment, or lets service capacity invalidate seeded-Peer sync;
17. Desktop owns a Canvas gesture reducer, React Flow document store or view-command
    policy that can disagree with `@convax/canvas`.

### Revision 3 historical change log

- replaced the prior main-plus-three set with one indivisible main plus four
  whole-file-pinned annex authority set and the exact four-entry ordered JCS review
  digest;
- added the collaboration-kernel owner for shared scope/stamp, causal frame,
  Yjs 13.6.31 codec, replica/candidate/journal ports and the only instantiated
  `ProtocolSchemaBundleV2`;
- pinned the exact bundle core/protocol digest, 89-domain registry, control
  limits/channel digests and independently versioned global URI digest;
- made the kernel the sole owner of public-key/member/replica/session/Peer/state-
  vector codecs, mapped service-reserved `ReplicaIdV2` directly to Yjs client id,
  and added the control reservation receipt/allocator boundary without an edit
  sequencer;
- unified Canvas identity as `cv_<64 lowercase hex>` and made the stricter Canvas
  and Project logical write cap 512 rather than copying the kernel outer maximum;
- made pending-editor required coverage derive only from one content-certified
  current ProjectIndex live-scope manifest; registry state is never floor authority;
- bound shard and Project reset to the exact control-owned confirmation, approval
  and rollover DTOs, including pre-existing local-owner key resolution;
- removed the undefined Project bulk-file promise: multi-file import commits
  independently and reports its exact partial subset;
- replaced duplicated envelope/bundle shorthand with explicit owner-annex references
  so this main file cannot become a second schema or fallback decoder.

### Revision 4 change log

- revoked the prior revision-3 signatures after implementation exposed incompatible
  reset initiator codecs and an undefined owner canonical-state/history contract;
- made the kernel's single `OwnerCanonicalizerDescriptorV2` the only owner
  canonicalization interface, with owner-supplied canonical state bytes, digest
  ledgers and deterministic history materialization;
- closed the Canvas eleven-root schema, 28-domain delta, actual-write ledger,
  fourteen undoable intent families and nested Plugin creation-group DAG;
- closed the Project nine-root schema, total file/location/conflict projections,
  counterfactual write evidence and seven-domain delta while retiring the old
  Project-private canonical-state digest domain;
- bound reset initiation to the exact active-editor `ReplicaIdV2` triad and adopted
  `F13-WITNESS-A+C/1`: one Control-owned complete verifier, Project-private
  accepted-head witness and one-shot permit, two complete validations and a
  no-gap reducer entry;
- closed that verifier's single browser-safe callable as
  `F13-ABI-CLOSED-SNAPSHOT/1`: exact canonical business/dependency bytes plus
  bounded raw candidate, current-head and route facts, with no ambient lookup,
  callback, async path, second verifier or digest domain;
- regenerated the exact four-artifact, 123-domain portable bundle and all four
  whole-file annex pins.

### Revision 5.1 change log

- replaced separately supplied owner protocol/history surfaces with one selected
  artifact factory returning an object-identical `DocumentOwnerRuntimeV2` closure;
- made ordinary and semantic-history entry points disjoint, materialized history
  against the latest queue-private replica and prohibited materialization during
  exact-frame recovery;
- closed declared, discovered, materialized and consumed dependencies across the
  Authority, ExactBase and Owner partitions with exact missing/extra rejection;
- split incoming authority into bounded header/signature authentication followed by
  one-time-token-gated five-section parsing and declared-authority validation;
- gave checkpoint, content-certificate, floor-ACK and prunable-certificate wrappers
  complete-object digest domains and terminal equivocation/logical-subject conflict;
- separated remote pending-inbox admission from local authoring outbox durability,
  bound duplicate success to exact frame/request identity and made lifecycle
  disposal queue-linearized;
- closed 65,536/65,537-byte state-vector behavior and raw-versus-internal 256/257
  frontier admission, retaining over-cap accepted state as readable/reset-required;
- regenerated the exact four-artifact, 127-domain portable bundle and all four
  whole-file annex pins. Revision 4 portable bytes now fail closed and require the
  existing explicit destructive-reset path.

Revision 5.1 was rejected during exact-byte review and was never implementation
authority. It is retained above only as historical change provenance.

### Revision 5.2 change log

- moved all generic owner runtime, protocol, intent-closure, history,
  external-fact and exact-base causal-closure contracts into Kernel; Canvas and
  ProjectIndex now only provide closed specializations selected by one artifact
  factory;
- replaced pre-validation durable ingress ambiguity with the four affine
  header-authenticated, structurally-parsed, object-and-inbox-durable and
  fully-validated capabilities, plus exact-byte recovery receipts and a fixed
  object/inbox/journal/head order;
- added stable reconnect identity and manifest-digest equivocation, with cumulative
  Project-epoch and stable source-member quota covering reservations, staging,
  object-before-inbox and pending inbox bytes;
- made ProjectIndex activation validate the exact accepted route dependency frame
  `F` and complete Canvas genesis checkpoint wrapper `G`, carried the exact `F`
  digest in Canvas genesis identity, and kept offline registration claim out of the
  activation precondition;
- kept reset dependency closure exclusively in F13, with locked current route facts,
  staged genesis checkpoint `G`, and its selected predecessor `F` validated as one
  closure rather than a parallel dependency gate;
- added the signed-wrapper subject digest domain and atomic subject/core indexes so
  both same-core equivocation and multi-core logical-subject conflict are terminal;
- regenerated the exact four-artifact, 128-domain, 71-limit portable bundle and all
  four whole-file annex pins. Unsigned Revision 5.1 portable bytes fail closed.

Revision 5.2 was rejected during exact-byte review and was never implementation
authority. It is retained above only as historical change provenance.

### Revision 5.3 change log

- corrected stable remote-transfer `projectEpoch` to the canonical `Id128V2` codec
  and replaced the duplicated portable dependency union with one generated
  Authority/ExactBase/Owner union containing `canvas-genesis-proof`;
- added affine resolved-dependency and per-phase base-reference capabilities so
  discovery, initial/incoming/final F13 and apply each consume the same exact
  accepted-base F without ambient lookup or a portable F dependency;
- defined self-contained `CVXCGP02` genesis proof bytes addressed by G and one
  `CVXRSA02` reset-authorization carrier addressed by C; reset declares exactly
  singleton C, while all five reset DTOs mirror C/G without a hash cycle;
- fully replaced every reset checkpoint field with the `ObjectDigest` spelling and
  made the single F13 a synchronous deterministic eleven-field process-input
  diagnostic over C and a branded exact-base phase view;
- added the two dependency-carrier Peer kinds, wanted-root admission, independent
  dependency-cache fsync/recovery, null-proof transfer ACK and root-accounted GC;
- renamed aggregate ingress counts from frames to objects, raised stable-member
  pending bytes to 128 MiB and added 80/96 MiB carrier caps;
- regenerated the exact four-artifact, 129-domain, 73-limit portable bundle and all
  four whole-file annex pins. Unsigned Revision 5.2 portable bytes fail closed.

### Score and author signature

The primary task formatter does not cast an architecture score or vote. Detached
review receipts record each of the three architecture reviewers' independent score,
strongest objections, falsifiers and exact-byte decision.

Formatter: `/root` (non-voting task coordinator)

Decision: **SUBMITTED FOR EXACT-BYTE 3/3 SIGN, Revision 5.3**

Pinned Revision 5.3 annex-set digest:
`6907964865c69b99d0a3cf2f89d6f92d2f8d8b1d221f98b567693f03d4832075`

Pinned `ProtocolSchemaBundleV2.coreDigest` and `protocolDigest`:
`ce60112affb9dddb88e6e22dd86d71cfad3a6cbe39bdd6582969dedae7a6c838`

Pinned global URI digest:
`298af436960f71beceeb3dac4c7ea8669fb1872b73323ddfe55c57c9d7b28949`

The whole-file SHA-256 is detached because a file cannot contain its own stable hash
without an exclusion rule. Any semantic change requires a new digest and 3/3 review.
