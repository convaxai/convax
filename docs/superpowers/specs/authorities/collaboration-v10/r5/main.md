# Convax P2P Collaboration v10 Canonical Semantic Specification

Status: **standalone inactive revision directory. Its authorityId is
`collaboration-v10`; `r5` is only its immutable directory revision. It becomes
active only through the exact global pointer after its protocol bundle, manifest,
three fresh full-review report/receipt pairs and review evidence all validate.**

This Main file and its four annexes are one indivisible authority. Main owns only
cross-owner composition and product policy. It does not inherit a field, state,
limit, path, transition or compatibility decoder from another authority generation.
Unknown, omitted or contradictory authority fails closed.

The words MUST, MUST NOT, SHOULD and MAY are normative.

## 1. Normative authority selection

### 1.1 Standalone authority set

This file is the Main member of the fixed inactive revision directory:

`docs/superpowers/specs/authorities/collaboration-v10/r5/`

The authority id is `collaboration-v10`; `r5` is only the immutable revision.
The complete release identity chain uses these fixed paths:

- `docs/superpowers/specs/authorities/collaboration-v10/r5/main.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256`;
- `docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json`;
- the three report/receipt pairs under
  `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/` declared in
  section 24;
- `docs/superpowers/specs/2026-07-31-global-uri-protocol.md`;
- `docs/superpowers/specs/collaboration-v10-active-authority.json`.

Every JSON file in this identity chain is exact restricted-JCS UTF-8 followed by
one LF. The seven-line manifest uses the exact non-JSON byte grammar in section 24.
Markdown members are complete UTF-8 files with one final LF.

There is no repository candidate pointer or staging pointer. Final-path bytes that
are not selected by the global active pointer remain inactive. After activation,
the seven manifest members, manifest, three fresh reports, three receipts, review
evidence and bound global URI bytes are create-only. Any future semantic or release
change uses `r6`, a fresh unconditional 3/3 review and one pointer compare-and-swap.

The repository selects the release only through:

`docs/superpowers/specs/collaboration-v10-active-authority.json`

A missing, mismatched or inactive identity-chain member is
`protocol-schema-bundle-unavailable`; prose never reconstructs a pin and no older
manifest, source constant, draft, review input or persisted byte is a fallback.

### 1.2 Owner precedence and no fallback

The manifest-bound Main and all four annexes are one authority. Each annex is final
for its declared owner surface; Main is final only for cross-owner composition and
product policy. Main MUST NOT narrow, extend or reinterpret an annex's closed DTO,
root topology, intent union, cap, state transition or owner. A contradiction is
`canonical-authority-conflict` and returns the complete set to review.

The sole global URI semantic authority is
`docs/superpowers/specs/2026-07-31-global-uri-protocol.md`, bound by its exact
generated digest. Main and owner annexes may state composition consequences but
MUST NOT copy its grammar, canonical forms, normalization or comparison algorithms.

All earlier collaboration authorities, drafts, reviews, source code and persisted
formats have no decoder or fallback status. Portable identifiers have one
controlling declaration in their sole owner annex; historical schema variants
belong outside these five authority files.

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
| `@convax/collaboration` | Generic v2 envelopes/JCS, causal frames/frontiers, the sole `replicaDoc`/isolated `candidateDoc` lifecycle, generic ingress capabilities and brands, typed persistence-evidence ports, checkpoint/floor primitives and session undo coordination | Project/Canvas schema, PeerJS, membership/auth policy, Electron, filesystem or native I/O |
| `@convax/project-files` | Project entry opaque ids, file/tree contracts and Project file operations | Project registry, Canvas schema, collaboration transport |
| `@convax/canvas` | The complete Canvas-owned portable state and behavior selected exclusively by the manifest-bound Canvas owner annex, plus host-neutral editor/view contracts | Project routes/resources, membership, PeerJS, native persistence, Electron composition |
| `@convax/project` | Project identity, ProjectIndexYDoc, Canvas route/catalog, Project resources and composition of Project/Canvas validators | Workbench selection, PeerJS, native private-store I/O |
| `@convax/project/collaboration-protocol` | Browser-safe Project-scoped control DTO descriptors, structural RSA decoder and branded Control verifier bundle | Project semantic currentness, native persistence, service/transport adapters or executable Plugin code |
| `@convax/project/node` | Sole Project-private persistence adapter; owner records and durability barriers; plain evidence returned through collaboration/Project ports | Kernel or Project process brands, terminal ACK decisions, reusable domain rules or renderer state |
| `@convax/workbench` | Window-scoped active Input/Canvas, selection, surface and layout state | Canvas/Project durable data, React/DOM, filesystem |
| `@convax/plugin-api` and `@convax/plugin-sdk` | Closed Host API and Plugin ABI/schema/artifact contracts | Active Plugin selection, collaboration state, concrete Plugin behavior |
| `@convax/agent-runtime` | Generic Agent sessions and tool bridge | Project/Canvas policy, direct `.convax` access |
| `@convax/desktop` | Electron composition, concrete PeerJS channel adapter, IPC/preload, live connection routing and attempt-keyed ACK outbox adapter | Collaboration/Project semantic brands, membership truth, reusable Canvas/editor semantics or a document store |
| `@convax/api` | Membership, session, rendezvous, attester, registry and cutoff HTTP composition | Edit order, Yjs/file/blob persistence, Canvas reducer copies |

Runtime dependency direction is:

```text
desktop -> agent-runtime, canvas, collaboration, project, project-files, uri,
           plugin-api, plugin-sdk, ui, workbench
project -> canvas, collaboration, project-files, uri, ui
canvas -> collaboration, uri, ui
project-files -> uri
plugin-sdk -> plugin-api
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

## 4. Global Convax URI composition

### 4.1 Sole URI authority

The sole URI component model, static scheme allocation, grammar, normalization,
four canonical `convax-project` forms and comparison algorithms are defined by
`docs/superpowers/specs/2026-07-31-global-uri-protocol.md` and implemented by
`@convax/uri`.

Main defines no URI grammar, query-order table, resolver or dynamic scheme registry.

### 4.2 Project identity and resource composition

`@convax/project-files` owns opaque Project entry id codecs.
`@convax/project` owns Project entry allocation, ProjectIndex currentness, content
families and resource-reference validation. `@convax/project/node` owns native
materialization and byte durability.

A stable ProjectFileId, canonical URI, versionId and blob digest have distinct jobs.
Path is presentation/relink information, never identity or native-path authority.
The exact Project-owned records and validation rules are defined only by the Project
persistence annex sections 2 through 7 and 12.

### 4.3 Atomic reference seam

Canvas and ProjectIndex store one complete canonical URI or immutable resource
reference in one Yjs value. Entry identity, path hint and blob pin MUST NOT be split
into independently writable keys.

Native path, inode, fsync evidence and local presence indexes never enter URI, Y.Doc,
typed intent or causal frame. Local byte admission and remote blob durability use
the Project persistence ports and `BlobDurableAckV2`, not URI authority.

## 5. V2 canonical wire protocol

### 5.1 Closed major and owner composition

The collaboration family is breaking major 2. It rejects every earlier
collaboration, typed-intent, Canvas-root and ProjectIndex-root format; there is no
alias, dual read or field-shape inference.

Each manifest-selected owner annex is final for its declared surface. Kernel owns
the generic wire, artifact assembly and exact bundle contract; Canvas, Control and
Project own only their selected artifacts. Main composes those owners but does not
repeat their DTOs, scalar codecs, roots, intent unions, algorithms, limits or
validators.

All runtimes consume only the generated artifact manifest and bundle selected by
the active authority. A documentation projection is never a decoder or registry.

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

### 6.1 Replica identity and authorization composition

Control is the sole authority for member, replica, actor credential, authorization,
capacity and actor-chain scope contracts. Kernel consumes only the verified
authorization and owns the generic causal identity primitives.

A member denotes the team person, a replica denotes an enrolled device, and the
long-lived Project-scoped actor signs final causal frames. Transport session keys do
not sign edits, and transport replacement does not invalidate already valid
history. No document-wide version or service-selected edit order enters identity.
Exact fields, codecs, caps and chain structure remain only in the Control and Kernel
annexes.

### 6.2 Causal identity composition

Kernel alone defines actor-chain sequence, Lamport, portable-order and frontier
algorithms, including exact-base reconstruction. Control binds the authorized
replica/actor identity to the current Project epoch. Canvas and Project consume the
Kernel-provided causal context and interpret only their owner-local intent,
write-evidence and projection semantics.

Every owner and carrier must agree on the same exact document scope, actor,
operation, protocol bundle and authored base. Machine time, arrival order, PeerJS
identity, service receipt order and renderer event order never become business
authority. Main defines no second sequence, order, frontier or exact-base algorithm.

## 7. Limits and backpressure composition

Kernel owns the generated `ProtocolLimitsV2` object and aggregate admission
accounting. Each owner annex contributes only its own closed limits; Control,
Project, Project/node and Desktop apply those selected values at their respective
decode, persistence and transport boundaries. Main contains no numeric limit table.

Limits apply before large allocation, decompression, JSON/Yjs parsing or media
decode. Untrusted remote exhaustion rejects or quarantines the bounded input without
changing replica state. Trusted local outbox or recovery exhaustion blocks new
durable mutation instead of dropping acknowledged user work. UI exposes the
owner-selected failure state and never silently truncates data.

## 8. Authoritative document runtime

### 8.1 `replicaDoc`

For each document shard, Main owns one `replicaDoc`: the local durable logical
authority reconstructed from a prunable checkpoint set or retained certified base,
plus every locally accepted causal frame closure. “Accepted” means verified and
durable on this replica, not global consensus.

There is no provisional second authority, local-fork Y.Doc or online replay
authority. Replication status is outbox/ACK metadata, not a second document.

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

The Project annex solely defines the native durability and reopen decision matrix.
Reopen either completes the same exact already signed durable frame or quarantines
the shard; it never transmits a pre-head object, reruns an intent, reallocates an
identity or signs replacement bytes. Main defines no native pre-head states,
lookup branches or deletion algorithm.

### 8.4 Persistence and ACKs

Only `@convax/project/node` accesses the private Project tree and returns plain
durability evidence through public ports. Kernel validates that evidence and mints
generic receipts; Project owns carrier currentness and product status; Desktop owns
transport routing. Native paths, keys and recovery metadata never become business
order.

Frame/checkpoint replication and blob replication remain separate owner ACK paths.
A resource-bearing operation cannot claim team replication until both selected
owner barriers succeed. Exact evidence, fsync, codec and status-transition rules
remain only in the Kernel, Control and Project annexes.

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

## 10. ProjectIndex and Canvas-shard composition

The Project persistence annex is the sole authority for ProjectIndex schema, keys,
intents, currentness, resources, paths, content families, routes, tombstones and
reset records. ProjectIndex is the sole Project catalog and Canvas-route authority;
JSON catalogs, service discovery and Workbench selection are not parallel stores.

### 10.1 Canvas creation and route activation

Canvas creation composes three owner boundaries in this order:

1. Project commits a staged route in ProjectIndex.
2. Canvas produces and validates the artifact-bound genesis proof through the
   selected `CanvasGenesisProofCarrierVerifierV2` callable.
3. Project validates current ProjectIndex facts and commits route activation.

A Canvas is visible only through the current live ProjectIndex route. A ProjectIndex
tombstone wins over late Canvas frames; retained shard bytes remain recovery data and
cannot recreate the route. Exact records, equality checks and caps remain only in
the Project and Canvas annexes.

### 10.2 Project-owned Canvas shard reset

Control owns reset authorization and RSA structural/cryptographic verification.
Canvas owns the selected-artifact genesis verifier callable. Kernel supplies the
exact authored-base closure and K-bound dependency attempt. Project alone owns the
semantic/currentness coordinator and applies the one ProjectIndex route intent.

After authenticated genesis/dependency binding, Project consumes its currentness
facts and the ProjectIndex authored-base closure at apply. Control F13 never performs
Project semantic validation, and Main defines no second semantic F13. Project/node
persists the selected Project transition through its owner port; Desktop cannot
manufacture a reset receipt or bypass Project currentness.

## 11. Canvas owner composition

The Canvas annex is the sole authority for Canvas roots, records, typed intents,
guards, write evidence, semantic history, projection, containment, generation,
Plugin creation groups, limits and React Flow gesture semantics. Main defines no
Canvas field, flat key, stamp comparison, cycle algorithm or result-precedence
table.

Cross-owner product consequences are closed:

- business edges and structural containment are separate concepts; business edges
  are never called parent relations;
- an edge with a deleted endpoint is unreachable;
- source deletion makes the complete Plugin creation group ineffective;
- node deletion wins over a late generation result;
- Plugin state is mutable only with the exact selected validation artifact;
- Canvas external facts use the Canvas-owned request/result codec and internal
  `CanvasExternalFactPermitV2`; Host supplies an unbranded
  `OwnerExternalFactResolverDefinitionV2<"canvas">`, and Kernel alone creates the
  K-bound, created-only owner attempt port.

The exact deterministic algorithms and failure states for those consequences remain
only in the Canvas and Kernel annexes.

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

## 14. PeerJS, offline and channel composition

PeerJS is a transport adapter, not identity, authorization, edit order or state
authority. Control owns signed Project/member/replica/session credentials,
rendezvous and the complete handshake/channel protocol. Desktop owns the concrete
PeerJS connections and routes only Control-validated messages to public owner ports.

The Control-annex-selected channels have independent queues and failure domains.
Large blob traffic must not block control, structural updates or ephemeral
awareness. Awareness is never durable and never mutates a document. Connection,
ticket or channel replacement cannot change a durable frame identity.

Offline local commits use the same final signed frames and durable outbox as online
commits. Reconnect requests exact missing objects and never replays business
commands. Every editor durably persists the complete ProjectIndex shard and every
Canvas shard required by the certified current ProjectIndex route manifest. Current
referenced blobs replicate in the background.

An existing durable replica may edit with the service and every Peer offline. A
fresh device or missing blob waits for a reachable holder and MUST NOT fabricate
empty synchronized state. Service registry data is discovery/anti-rollback evidence,
not a ProjectIndex route authority. Exact credentials, message fields, state
machines, limits and retry rules remain only in the Control annex.

## 15. Checkpoint and compaction composition

Kernel owns generic checkpoint, causal-floor and pruning primitives. The selected
Canvas or Project owner validates exact content through its artifact-bound reducer
and canonicalizer. Control owns attestation, membership coverage and signed
prunable-set artifacts. Project/node persists checkpoint bytes, certificates and
installed floors.

Pruning requires both independently verified content validity and coverage by every
current active editor. A missing gate retains history; service availability or a
checkpoint header alone never authorizes deletion. One offline editor therefore
blocks pruning until it installs the floor or is explicitly revoked. Exact DTOs,
algorithms, limits and persistence records remain only in their owner annexes.

## 16. Revocation, cutoff and recovery composition

Control owns membership mutation, registered-scope discovery, immutable cutoff
coverage and anti-rollback verification. Kernel applies only a fully verified cutoff
result to generic causal eligibility. Project derives the required live document set
from the certified current ProjectIndex route manifest; service discovery cannot add
or remove Project routes.

Authorization may close before all payload bytes are available. Until complete
cutoff material is installed, the affected scope is recovery-required and cannot
claim a team-ready rebuild. Independent authorized work remains eligible; excluded
work is retained read-only for recovery. Exact targets, pages, folds, caps and
failure transitions remain only in the Control annex.

## 17. Project files, blobs and resource replication

### 17.1 Project-owned identity and content

The global URI protocol owns URI syntax and comparison only. Project Files owns
opaque Project entry id codecs. Project owns allocation, ProjectIndex currentness,
content families, conflict semantics and resource-reference validation.
Project/node owns native materialization and byte durability.

Managed assets and generation results create immutable new file identities.
Overwritable binary and human-edited text policies are different; exact selection,
conflict-copy and path-projection algorithms remain only in the Project annex.
Paths, wall clocks, inodes and watcher order never become portable identity or
current-version authority.

### 17.2 File and Canvas commit boundary

File-backed content and Canvas metadata are not one transaction. Project/node first
publishes durable user bytes or admits the managed blob; Project then commits the
ProjectIndex version/reference; Canvas finally commits its resource reference.

If the Canvas commit fails, the file and ProjectIndex result remain and the caller
reports partial success. Cross-file rollback, a renderer transaction or an inverse
Canvas update cannot erase the independently committed file.

### 17.3 Blob transfer and replication status

Project owns portable blob references and holder semantics. Project/node owns byte
staging, digest verification, publication and plain durability evidence. Kernel
owns generic install receipts; Desktop owns the isolated blob transport and routes
the selected owner ACK only after owner currentness succeeds.

The product distinguishes local structural durability, remote structural
replication, remote blob replication and complete local availability. A device may
edit structural metadata while media bytes are missing, but cannot promise offline
playback or team replication. Exact transfer DTOs, chunking, ACK codecs, limits and
retry state remain only in the Control and Project annexes.

### 17.4 Retention and GC composition

Project owns the complete portable reference-root policy. Kernel exposes generic
durable frame/checkpoint/recovery roots, while Project/node performs the sole native
root scan, delayed collection and conditional deletion. No owner infers reachability
from a stale ACK or renderer projection.

GC never deletes an ordinary user-visible Project file merely because Canvas no
longer references it. Exact roots, native records, deletion fencing and failure
states remain only in the Project persistence annex.

### 17.5 Project-private carrier currentness and ACK

Project owns two and only two independent carrier authorities and owner ports:
Canvas-genesis and RSA. The Canvas-genesis authority captures the exact selected
`CanvasGenesisProofCarrierVerifierV2` callable and artifact digest. The RSA authority
captures the Control structural verifier and digest plus that same exact
selected-artifact Canvas callable and digest.

Both authorities use Project-owned semantic/currentness coordination and the
owner-install persistence capability. Neither captures a generic Canvas runtime,
shares a union owner port, reconstructs authority from digests or accepts a
structural copy.

Project/node persists carrier/admission state and returns plain evidence. Kernel
validates that evidence and alone mints generic install receipts. Desktop owns one
connection-local attempt-keyed ACK outbox; callers cannot provide ACK bytes,
connectionId, transferId, signature or routing. Indeterminate enqueue retries query
the same exact attempt key; restart invalidates the process-local binding and
requires complete currentness validation on a new attempt. Exact contracts remain
only in Project persistence annex sections 16 and 17.

## 18. Plugin and Canvas convergence composition

Plugin API/SDK own the immutable Plugin identity, contribution and validation
artifact contracts. Canvas alone owns Plugin state envelopes, creation-group
intents, concurrent projection and semantic history. Desktop binds the selected
immutable Plugin principal to the public Canvas application service; it does not
branch on a concrete Plugin id or mutate Canvas state during installation.

A missing or mismatched exact validation artifact makes the affected state
pending/read-only. An older Plugin cannot default, strip, down-migrate or overwrite
newer state. Source deletion makes a complete Plugin creation group ineffective;
node deletion makes incident edges and late generation output unreachable. Exact
schemas, intent fields, cardinalities and convergence algorithms remain only in the
Plugin and Canvas owner authorities.

## 19. Breaking cutover and removal of legacy authorities

Earlier collaboration bytes, path-only Project metadata and legacy JSON Canvas
catalog/documents are unsupported portable data. Before explicit confirmation,
Project open may report them but MUST NOT hydrate, rewrite, migrate, compact,
garbage-collect or partially reset them.

The product offers cancel or a twice-confirmed destructive reset with the exact
private collaboration deletion set. Reset preserves stable `projectId` and every
ordinary Project file, including user-visible generated output and conflict copies.
It creates a fresh Project epoch with an empty ProjectIndex and no live Canvas route.

All old sessions and writers are fenced. Authorization, currentness, owner permits,
native staging/publication and crash recovery are implemented only by the complete
Control and Project annex contracts. If authorization, durability or tree selection
is ambiguous, the Project remains closed and reports reset recovery; Main defines no
reset DTO, verifier steps, currentness count or native swap algorithm.

The following authorities are removed rather than adapted:

- document-wide version/revision, expected-version save and whole-document CAS;
- central per-edit admission or service edit order;
- provisional/certified second documents, local-fork Y.Doc/journal and reconnect
  command replay;
- JSON Canvas catalog/document authority and renderer/localStorage persistence;
- raw Agent/Plugin Yjs updates, generic patches and whole-state replacement.

Earlier bytes are never interpreted as the current protocol and no hidden fallback
may survive implementation.

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

Cross-owner composition does not create another domain owner:

- Kernel owns one Main-owned `replicaDoc` per open shard, one isolated
  `candidateDoc` per command, selected owner
  runtime/protocol/intent-closure/history/external-fact/base-causal-closure ABIs,
  stable remote-transfer identity and the affine ingress capabilities. Canvas and
  ProjectIndex only specialize those closed generic ports. There is one
  authoritative replica document and isolated candidates only.
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
  C supplies the untrusted F lookup hint; the completely validated G identity
  independently supplies the authenticated F identity; branded Kernel phase views
  supply the exact accepted-base F bytes. Control F13 performs only RSA structural
  and cryptographic verification. Project's semantic/currentness coordinator then
  consumes authenticated G/F binding and the ProjectIndex authored-base closure at
  apply. There is no second semantic F13, and route CAS does not repeat F.
- G and C transfer only on the update channel through the separate durable
  dependency cache. Their session ACK has null durability proof and is not a frame
  or blob durable ACK. Retained bytes continue to count against Project/member
  quota until atomically reclassified to a live root or released by no-root GC.
- Signed wrapper lookup succeeds only when the durable subject index selects one
  core and the durable core index selects one object. Same-core equivocation also
  terminally conflicts the subject. Both indexes change through one sole-writer
  journal/head transition.

## 22. Executable conformance gates

### 22.1 Generated golden and cross-runtime fixtures

The generator consumes only the exact selected Main, URI and owner annex bytes. It
emits the artifact manifest, namespace/import graph, complete domain registry,
limits object, channel policies, protocol bundle and every owner-declared golden
fixture. Main does not restate their fields, scalar patterns, cardinalities or
exact-max values.

Bun, Chromium and the isolated attester must produce byte-identical results for the
generated bundle, URI fixtures and every owner-exported codec, signature, reducer,
canonicalizer, intent, checkpoint, reset, file/blob and ACK fixture. A missing or
hand-authored fixture is a generation failure.

### 22.2 Model, property and fuzz composition

Canvas, Project, Kernel and Control each export their selected convergence,
permutation, exact-max/plus-one and hostile-input fixture families. The integrated
suite composes those generated families across duplicate delivery, reorder,
disconnect/reconnect, causal DAG variation, Plugin artifact mismatch, deletion,
generation, containment, file conflict, checkpoint and cutoff scenarios.

Any arrival-order canonical-state difference, silent user-data loss, truncated
admission or owner-selected failure-state disagreement is a protocol defect, never
a transport retry outcome.

### 22.3 Crash and durability composition

Kernel and Project/node export the complete generated durability cut-point matrix.
Fault injection at every declared persistence boundary must reopen to the last
acknowledged durable authority, resume or quarantine the same exact signed object,
and never rerun an intent, reallocate identity, re-sign bytes, publish a partial
reset or ACK non-durable content.

### 22.4 Security, package and dependency gates

Generated security fixtures cover identity impersonation, replay, cross-scope
binding, equivocation, cutoff incompleteness, malicious attestation, path traversal,
resource proof substitution, queue exhaustion and blob head-of-line isolation.

Every affected package runs its package-local typecheck and tests. Public boundary,
persistence, IPC or Desktop composition changes also run the workspace architecture
check. Publishable packages build, pack and typecheck every public entry from a
clean external consumer. Import scans enforce the selected dependency graph and
private-path exclusions.

## 23. Eight implementation tasks and owner subtask graph

Implementation remains blocked until three reviewers sign the same detached Main,
global URI, annex set and generated `ProtocolSchemaBundleV2`. The eight product
tasks below are scheduling groups, not cross-package write authority. Every table
row is a separately dispatched owner subtask with one allowed write scope.

| Task | Owner subtask | Allowed writes | Required input | Required output | `dependsOn` |
| --- | --- | --- | --- | --- | --- |
| 1. Architecture documents, protocol and Yjs schema | `1.release` — root formatter and mechanical generator, non-voting | the exact seven R5 release paths: `main.md`, four annexes, `protocol-schema-bundle-v2.json`, `authority.sha256`; `scripts/collaboration-authority/**`; removal of `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-canvas-disposition.md`, `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-kernel-control-disposition.md` and `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-project-persistence-disposition.md`; and byte-identical creation of `docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-canvas-disposition.md`, `docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-kernel-control-disposition.md` and `docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-project-persistence-disposition.md` | exact accepted Route F/L1 formatter delta plus the unchanged global URI, Canvas, Control and Project owner bytes | final inactive seven-member release, byte-identical independent-generator result, exact promotion contract and byte-preserved Route-B audit files outside the authority directory; no fresh report, receipt, evidence or active pointer | none |
| 1. Architecture documents, protocol and Yjs schema | `1.canvas-review` — `/root/canvas_intent_runtime` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md` and `receipt.json` only | exact `1.release` seven members, bundle, manifest and promotion contract | fresh full-review report and restricted-JCS receipt with unconditional decision, or an explicit rejection with no receipt | `1.release` |
| 1. Architecture documents, protocol and Yjs schema | `1.control-review` — `/root/collaboration_api` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md` and `receipt.json` only | exact `1.release` seven members, bundle, manifest and promotion contract | fresh full-review report and restricted-JCS receipt with unconditional decision, or an explicit rejection with no receipt | `1.release` |
| 1. Architecture documents, protocol and Yjs schema | `1.project-review` — `/root/project_store_reviewer` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md` and `receipt.json` only | exact `1.release` seven members, bundle, manifest and promotion contract | fresh full-review report and restricted-JCS receipt with unconditional decision, or an explicit rejection with no receipt | `1.release` |
| 1. Architecture documents, protocol and Yjs schema | `1.evidence` — root mechanical evidence assembler, non-voting | `docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json` only | exact `1.release` bytes and three fresh unconditional report/receipt pairs | exact restricted-JCS 3/3 evidence bound to the same manifest and protocol bundle | `1.canvas-review`, `1.control-review`, `1.project-review` |
| 1. Architecture documents, protocol and Yjs schema | `1.kernel-loader` — `@convax/collaboration` | `packages/collaboration/src/authority-selector.ts`, `packages/collaboration/src/authority-selector.test.ts`, `packages/collaboration/src/index.ts`, `packages/collaboration/scripts/pack-check.ts`; plus import-declaration-only changes in `packages/collaboration/src/checkpoint-undo.test.ts`, `packages/collaboration/src/kernel.test.ts` and `packages/collaboration/src/protocol.test.ts` | exact release and `1.evidence`; no active pointer yet | headless copy-owning authority packaging validator, exact public export closure and a runtime selection entry that remains unavailable until Task 3 installs the exact implementation | `1.evidence` |
| 1. Architecture documents, protocol and Yjs schema | `1.main-governance` — root formatter and mechanical verifier, non-voting | `AGENTS.md`, `docs/architecture.md`, `scripts/package-boundary-check.ts`, `scripts/collaboration-authority-release.ts`, `scripts/collaboration-authority-release.test.ts` and governance-check tests only | exact release, `1.evidence` and the frozen L1 selector contract; no active pointer yet | checker and governance bytes that recognize only Route F, verify T0/descendant Git trees and reject every legacy fallback; no authority-member modification | `1.evidence` |
| 1. Architecture documents, protocol and Yjs schema | `1.promotion` — root mechanical promoter, non-voting | `docs/superpowers/specs/collaboration-v10-active-authority.json` only | exact release, `1.evidence`, verified `1.kernel-loader` and verified `1.main-governance` | one validated sequence-1 active-pointer create CAS; no fallback | `1.evidence`, `1.kernel-loader`, `1.main-governance` |
| 2. React Flow transient-state cleanup | `@convax/canvas` | `packages/canvas/**` | task 1 Canvas artifact and implemented public collaboration ports | headless projection/gesture/cache/view contracts and tests | 1.promotion, 3.collaboration |
| 2. React Flow transient-state cleanup | `@convax/desktop` | `packages/desktop/**` renderer composition only | published Canvas editor/view API | shell, safe-viewport and stale-effect adapters with no document store | 2.canvas |
| 3. Local replica/candidate and undo | `@convax/collaboration` | `packages/collaboration/**` | task 1 Kernel artifact | generic `replicaDoc`/isolated `candidateDoc`, durability evidence ports and session undo coordinator | 1.promotion |
| 3. Local replica/candidate and undo | `@convax/project/node` | `packages/project/src/node/collaboration/**` | published collaboration persistence ports | native journal/object/outbox/head adapter and crash fixtures returning plain evidence | 3.collaboration |
| 4. ProjectFileId, URI and breaking reset | `@convax/uri` | `packages/uri/**` | task 1 global URI digest/specification | zero-Convax-dependency codec/canonicalization/comparison package and golden fixtures | 1.promotion |
| 4. ProjectFileId, URI and breaking reset | `@convax/project-files` | `packages/project-files/**` | published URI components API | opaque entry-id codecs and file-facing URI contracts | 4.uri |
| 4. ProjectFileId, URI and breaking reset | `@convax/project` | `packages/project/**` excluding `src/node/**` | URI and Project Files public APIs plus Project artifact | allocation/resource/reset application ports and rejection semantics | 4.project-files |
| 4. ProjectFileId, URI and breaking reset | `@convax/project/node` | `packages/project/src/node/**` | Project reset/native ports | private-tree unsupported detection, explicit reset/swap/recovery adapter | 3.project-node, 4.project |
| 4. ProjectFileId, URI and breaking reset | `@convax/desktop` | `packages/desktop/**` | Project reset public API | exact deletion-set confirmation UI and composition, no reset semantics | 2.desktop, 4.project-node |
| 5. ProjectIndex/per-Canvas sharding | `@convax/project` | `packages/project/**` excluding `src/node/**` | tasks 1, 3 and 4 public contracts plus the Canvas genesis callable | ProjectIndex owner, routes/tombstones/currentness and Canvas-shard application ports | 3.collaboration, 4.project, 5.canvas |
| 5. ProjectIndex/per-Canvas sharding | `@convax/canvas` | `packages/canvas/**` | tasks 1 and 3 public contracts | Canvas owner artifact runtime, genesis callable and shard-local intent services | 2.canvas, 3.collaboration |
| 5. ProjectIndex/per-Canvas sharding | `@convax/project/node` | `packages/project/src/node/**` | Project and collaboration public persistence ports | physically separate ProjectIndex/Canvas stores and owner evidence | 4.project-node, 5.project |
| 5. ProjectIndex/per-Canvas sharding | `@convax/desktop` | `packages/desktop/**` | Project/Canvas public clients | Main-process lifecycle wiring and renderer projection IPC only | 4.desktop, 5.project, 5.canvas, 5.project-node |
| 6. PeerJS, offline reconnect and blob channels | `@convax/api` | `apps/api/**` | implemented browser-safe Kernel/Control/Project protocol exports | identity, membership, rendezvous, registry/cutoff and attestation service adapters | 3.collaboration, 5.project |
| 6. PeerJS, offline reconnect and blob channels | `@convax/project` | `packages/project/**` excluding `src/node/**` | task 5 ProjectIndex/resource ports | holder inventory, blob-reference and replication-status application contracts | 5.project |
| 6. PeerJS, offline reconnect and blob channels | `@convax/project/node` | `packages/project/src/node/**` | Project blob/native ports | blob staging, hash verification, durable index/ACK evidence and GC adapter | 5.project-node, 6.project |
| 6. PeerJS, offline reconnect and blob channels | `@convax/desktop` | `packages/desktop/**` | Control DTOs plus Kernel/Project public ports | PeerJS four-channel adapter, reconnect routing, backpressure and attempt-keyed ACK outbox | 5.desktop, 6.api, 6.project-node |
| 7. Plugin schema, creation groups and concurrent invariants | `@convax/plugin-api` | `packages/plugin-api/**` | task 1 Plugin/Canvas seam | exact Host call catalog and validation-artifact descriptor contracts | 1.promotion |
| 7. Plugin schema, creation groups and concurrent invariants | `@convax/plugin-sdk` | `packages/plugin-sdk/**` | published Plugin API catalog | immutable contribution/schema identity contracts | 7.plugin-api |
| 7. Plugin schema, creation groups and concurrent invariants | `@convax/canvas` | `packages/canvas/**` | Canvas artifact and Plugin public contracts | owner intents/projection for creation groups, deletion, generation and containment plus permutation tests | 5.canvas, 7.plugin-sdk |
| 7. Plugin schema, creation groups and concurrent invariants | `@convax/desktop` | `packages/desktop/**` | Canvas and Plugin public APIs | immutable-principal adapter with pending/read-only product state | 6.desktop, 7.canvas |
| 8. Remove document-wide version and unify callers | `@convax/canvas` | `packages/canvas/**` | completed owner-local tasks 2, 5 and 7 | removal of version/save/raw-update compatibility surface from Canvas public API | 2.canvas, 5.canvas, 7.canvas |
| 8. Remove document-wide version and unify callers | `@convax/project` | `packages/project/**` excluding `src/node/**` | completed Project owner rows 4–6 plus the version-free Canvas public API | removal of JSON catalog/revision application authority and one typed Project/Canvas client surface | 4.project, 5.project, 6.project, 8.canvas |
| 8. Remove document-wide version and unify callers | `@convax/project/node` | `packages/project/src/node/**` | completed Project/node rows 4–6 plus version-free Project ports | removal of legacy JSON/global-revision native persistence and rejection fixtures | 4.project-node, 5.project-node, 6.project-node, 8.project |
| 8. Remove document-wide version and unify callers | `@convax/agent-runtime` | `packages/agent-runtime/**` | published typed Project/Canvas capabilities | thin Agent adapters with no renderer/native/raw-Yjs dependency | 8.canvas, 8.project |
| 8. Remove document-wide version and unify callers | `@convax/plugin-api` | `packages/plugin-api/**` | published typed Canvas capability | version-free narrow Host call catalog | 7.plugin-api, 8.canvas |
| 8. Remove document-wide version and unify callers | `@convax/plugin-sdk` | `packages/plugin-sdk/**` | published Plugin API catalog | version-free Plugin contribution/client contracts | 7.plugin-sdk, 8.plugin-api |
| 8. Remove document-wide version and unify callers | `@convax/desktop` | `packages/desktop/**` | every owner-local task 2–7 output plus version-free native, Agent and Plugin contracts | unified UI/Agent/Plugin composition and removal of legacy conflict/reset paths | 2.desktop, 4.desktop, 5.desktop, 6.desktop, 7.desktop, 8.agent-runtime, 8.plugin-sdk, 8.project-node |

Before the three fresh reviews, `1.release` relocates these three provisional files
byte-for-byte:

```text
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-canvas-disposition.md
-> docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-canvas-disposition.md

docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-kernel-control-disposition.md
-> docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-kernel-control-disposition.md

docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/route-b-project-persistence-disposition.md
-> docs/superpowers/specs/reviews/2026-08-02-p2p-v10-route-b-project-persistence-disposition.md
```

The source hashes are exactly:

```text
22a4864bcf78aa4bff715393886277bc46772c7cc9fff4d60c1b7d244798359b
4ff64ced10095784966d9069d98c9955664f0546bf8c4aa5a154d7942b3ef4f0
66a9594546c7c1a9c299809d3b749a36bd66d7934d82c2d3ed65bf9b141950f0
```

The relocation requires: active pointer absent; the fixed legacy manifest present
as a regular non-symlink file with its exact fixed hash; all three sources present
as regular non-symlink files with the hashes above; and all three targets absent.
Any failed precondition writes or removes nothing. After relocation the three old
R5 paths are absent. The audit targets are not release members, selector inputs or
fresh signoff, and no report, receipt, evidence, bundle, manifest or pointer may
reference their path or hash.

The owner graph has exactly 36 rows, no missing dependency, no cycle and no
unordered pair of overlapping write scopes. Every Task 2 through Task 8 row that
formerly depended on the architecture gate depends on `1.promotion`; no such row
may begin before `1.promotion`.

Root may dispatch independent owner rows concurrently, but two rows with overlapping
write scopes run serially or in isolated worktrees and merge only through public
ports. No subtask may edit another owner's private files, duplicate a reducer, add a
service locator or temporarily retain a document-wide version fallback. A required
cross-owner contract change returns to exact-byte 3/3 architecture review.

## 24. Bundle, review and promotion gate

Every annex artifact is the complete UTF-8 file including its single final LF. No
sentinel, prefix span or self-exclusion rule exists. The generator runs outside
`docs/`, writes temporary bytes outside the release directory, and promotes only
the fixed final files named below after byte-for-byte revalidation.

Generation performs exactly this ordered procedure:

1. Read the four complete annexes and global URI file from their fixed paths;
   require regular non-symlink files, valid UTF-8 and exactly one final LF.
2. Compute each annex `artifactDigest` with the Kernel-owned domain-separated
   complete-file formula.
3. Build the four-element artifact tuple in exact order `canvas-schema`,
   `collaboration-kernel`, `control-plane`, `project-persistence`.
4. Use the exact closed namespace/import tuple declared by the Kernel annex.
5. Extract the exact owner domain sets from the four annexes.
6. Build their duplicate-free strict raw-UTF-8 sorted union and verify the declared
   owner counts and total count.
7. Extract the exact Kernel `YjsWireCodecV2` value.
8. Set `uriProtocolDigest` to ordinary SHA-256 of the complete global URI file.
9. Extract the exact Control `ProtocolLimitsV2` and compute its declared digest.
10. Extract the exact Control `PeerChannelContractV2` and compute its declared
    digest.
11. Restricted-JCS encode the exact `ProtocolSchemaBundleCoreV2` and compute
    `coreDigest` with the Kernel-owned domain-separated formula.
12. Set `protocolDigest = coreDigest`; restricted-JCS encode
    `ProtocolSchemaBundleV2`, append one LF, reopen it, and require parse plus
    re-encode to reproduce the exact same bytes. Its `protocolBundleSha256` is
    ordinary SHA-256 of that complete JSON file.

The bundle path is:

`docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json`

The manifest path is:

`docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256`

The manifest is exactly seven lines. Each line is:

```text
<64 lowercase hexadecimal SHA-256><two ASCII spaces><full repository-relative path><LF>
```

Its paths are duplicate-free and strict raw-UTF-8 sorted, and are exactly:

```text
docs/superpowers/specs/2026-07-31-global-uri-protocol.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md
docs/superpowers/specs/authorities/collaboration-v10/r5/main.md
docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json
```

`manifestSha256` is ordinary SHA-256 of the exact manifest bytes.

The three fresh full-review identities are exactly:

| `reviewerRole` | `reviewerTaskPath` | report | receipt |
| --- | --- | --- | --- |
| `canvas-intent-runtime` | `/root/canvas_intent_runtime` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/receipt.json` |
| `collaboration-control-protocol` | `/root/collaboration_api` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/receipt.json` |
| `project-native-store` | `/root/project_store_reviewer` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md` | `docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/receipt.json` |

Each report is a fresh full review of the exact seven manifest members, generated
bundle and promotion contract. It states role, task path, all seven member hashes,
`manifestSha256`, `protocolBundleSha256`, `protocolDigest`, the unconditional
decision, strongest three objections, flaw types, falsifiers and
`ScoreBasisPoints`. A qualified, partial or inherited disposition is not a sign.

Every decoder uses these exact runtime codecs before comparing a value:

```ts
type LowercaseSha256HexV1 = string
// Exact runtime codec: /^[0-9a-f]{64}$/.

type CanonicalPositiveUint64V1 = string
// Exact runtime codec: canonical decimal 1..18446744073709551615,
// with no sign, whitespace or leading zero.

type DirectoryRevisionV1 = `r${CanonicalPositiveUint64V1}`
// Exact runtime codec: ASCII "r" followed by CanonicalPositiveUint64V1.

type AuthorityDirectoryV1<R extends DirectoryRevisionV1> =
  `docs/superpowers/specs/authorities/collaboration-v10/${R}`
type AuthorityManifestPathV1<R extends DirectoryRevisionV1> =
  `${AuthorityDirectoryV1<R>}/authority.sha256`
type AuthorityEvidencePathV1<R extends DirectoryRevisionV1> =
  `${AuthorityDirectoryV1<R>}/review-evidence.json`
```

These aliases do not replace runtime validation. Non-ASCII characters, uppercase
hexadecimal, `-0`, signed, fractional, exponent, leading-zero or out-of-range
representations reject before any equality or path lookup.

Each receipt is exact restricted-JCS UTF-8 followed by one LF and has exactly:

```ts
interface CollaborationAuthorityReviewReceiptV1 {
  readonly format: "convax.collaboration-authority-review-receipt/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly reviewerRole:
    | "canvas-intent-runtime"
    | "collaboration-control-protocol"
    | "project-native-store"
  readonly reviewerTaskPath:
    | "/root/canvas_intent_runtime"
    | "/root/collaboration_api"
    | "/root/project_store_reviewer"
  readonly decision: "UNCONDITIONAL SIGN"
  readonly scoreBasisPoints: number
  readonly reportPath: string
  readonly reportSha256: LowercaseSha256HexV1
  readonly manifestPath: "docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256"
  readonly manifestSha256: LowercaseSha256HexV1
  readonly protocolBundlePath: "docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json"
  readonly protocolBundleSha256: LowercaseSha256HexV1
  readonly protocolDigest: LowercaseSha256HexV1
}
```

`scoreBasisPoints` is a finite JSON integer from 0 through 1000; `-0`, fraction,
NaN and infinity reject. Path, role and task must match the fixed row;
caller-selected reviewer identity is rejected.

The evidence path is:

`docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json`

It is exact restricted-JCS UTF-8 followed by one LF and has exactly:

```ts
interface CollaborationAuthorityReviewEvidenceV1 {
  readonly format: "convax.collaboration-authority-review-evidence/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly decision: "UNCONDITIONAL 3/3 SIGN"
  readonly manifestPath: "docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256"
  readonly manifestSha256: LowercaseSha256HexV1
  readonly protocolBundleSha256: LowercaseSha256HexV1
  readonly protocolDigest: LowercaseSha256HexV1
  readonly reviews: readonly [
    CollaborationAuthorityReviewEvidenceEntryV1 & {
      readonly reviewerRole: "canvas-intent-runtime"
      readonly reviewerTaskPath: "/root/canvas_intent_runtime"
    },
    CollaborationAuthorityReviewEvidenceEntryV1 & {
      readonly reviewerRole: "collaboration-control-protocol"
      readonly reviewerTaskPath: "/root/collaboration_api"
    },
    CollaborationAuthorityReviewEvidenceEntryV1 & {
      readonly reviewerRole: "project-native-store"
      readonly reviewerTaskPath: "/root/project_store_reviewer"
    },
  ]
}

interface CollaborationAuthorityReviewEvidenceEntryV1 {
  readonly reviewerRole: string
  readonly reviewerTaskPath: string
  readonly decision: "UNCONDITIONAL SIGN"
  readonly scoreBasisPoints: number
  readonly reportPath: string
  readonly reportSha256: LowercaseSha256HexV1
  readonly receiptPath: string
  readonly receiptSha256: LowercaseSha256HexV1
}
```

The global active pointer is exact restricted-JCS UTF-8 followed by one LF at:

`docs/superpowers/specs/collaboration-v10-active-authority.json`

It has exactly:

```ts
interface CollaborationActiveAuthorityPointerV1<
  R extends DirectoryRevisionV1,
> {
  readonly format: "convax.collaboration-active-authority-pointer/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: R
  readonly sequence: CanonicalPositiveUint64V1
  readonly previousSelection:
    | {
        readonly kind: "legacy-manifest"
        readonly manifestPath: "docs/superpowers/specs/2026-08-01-p2p-v10-authority.sha256"
        readonly manifestSha256: "68a78f5ffdf3222667aaa213a492c3b79db6133f2206da1067a4976138edbcde"
      }
    | {
        readonly kind: "active-pointer"
        readonly sequence: CanonicalPositiveUint64V1
        readonly revision: DirectoryRevisionV1
        readonly pointerSha256: LowercaseSha256HexV1
      }
  readonly manifestPath: AuthorityManifestPathV1<R>
  readonly manifestSha256: LowercaseSha256HexV1
  readonly evidencePath: AuthorityEvidencePathV1<R>
  readonly evidenceSha256: LowercaseSha256HexV1
}
```

Pointer decoding parses `revision`, `manifestPath` and `evidencePath` independently,
then requires the two path revision segments to be byte-equal to `revision`. It
rejects `.`, `..`, percent aliases, backslashes, repeated slashes, normalization or
caller-selected paths. The first promotion is exactly revision `r5`, sequence `"1"`
and the fixed `legacy-manifest` selection above. A future promotion requires both
canonical positive-uint64 values to increase by exactly one and the exact prior
pointer SHA in `previousSelection`. The loader validates the structure of
`previousSelection` but never opens it and never falls back to it.

The initial R5 promotion is one create CAS under the repository promoter's exclusive
publication lock. Its writer precondition is the conjunction of:

1. the global active-pointer path is absent in the parent Git tree and at the write
   target;
2. the fixed legacy manifest exists as a regular non-symlink file and Git blob with
   mode `100644`;
3. ordinary SHA-256 of its exact bytes is
   `68a78f5ffdf3222667aaa213a492c3b79db6133f2206da1067a4976138edbcde`;
4. the new pointer has revision `r5`, sequence `"1"` and the exact
   `legacy-manifest` previous selection;
5. the complete inactive fifteen-file R5 snapshot has been reopened, the candidate
   pointer bytes have been defensively copied, and both have been verified; and
6. the selector and static checker accept the same complete golden and hostile
   corpus.

Failure of any term writes no pointer. The active loader never opens
`previousSelection`; only the promoter reads the legacy manifest as initial CAS
evidence.

`T0` is the first Git tree containing a valid sequence-1 pointer selecting R5. At
T0, the pointer and every member of the exact fifteen-file authority snapshot are
regular non-symlink Git blobs with mode exactly `100644`. The R5 directory contains
exactly its fourteen members of that snapshot and no extra authority file.

For every descendant Git tree of T0, all fifteen sealed authority paths, blob bytes,
regular-file kinds and `100644` modes remain exact, even after a later valid pointer
selects R6. Adding, deleting, renaming or modifying a sealed path, changing its mode,
or replacing it with a symlink, submodule or other file kind is
`activated-authority-mutation`. The active pointer is not one of the fifteen sealed
files because a valid later-revision CAS must replace its bytes, but every pointer
version is itself a regular non-symlink `100644` Git blob. If a tree still selects
R5, its active-pointer bytes also remain exact.

The first-parent Git-tree checker owns T0, descendant, file-kind and mode validation.
It fails closed when the required parent/T0 evidence is unavailable. The headless
selector receives no filesystem or Git metadata and validates only copy-owned exact
paths and bytes.

Protocol major 2 is valid only if the exact generated `protocolDigest` is checked
after bounded message-core framing and signature verification but before any body,
manifest, carrier or owner decoder is constructed. There is no compatibility
negotiation, dual decode, legacy manifest fallback or source-code pin fallback.

Root formats, dispatches and mechanically verifies. Only the three fixed reviewers
have architecture votes, and promotion requires their unconditional 3/3 sign of
the same exact bytes.
### 24.1 L1 authority selector boundary

This section is a Task 1 packaging gate only. It does not install a collaboration
runtime and does not authorize mutation, decode, sign, persistence or ACK before
Task 3.

The exact ordering is:

```text
1.release
-> {1.canvas-review, 1.control-review, 1.project-review}
-> 1.evidence
-> {1.kernel-loader, 1.main-governance}
-> 1.promotion
-> Task 3 runtime installation
```

The sole Task 1 collaboration write scope is:

```text
packages/collaboration/src/authority-selector.ts
packages/collaboration/src/authority-selector.test.ts
packages/collaboration/src/index.ts
packages/collaboration/scripts/pack-check.ts
packages/collaboration/src/checkpoint-undo.test.ts
packages/collaboration/src/kernel.test.ts
packages/collaboration/src/protocol.test.ts
```

`packages/collaboration/src/errors.ts` remains unchanged and private. Task 1 must
not modify any Kernel, frame, causal, checkpoint, canonicalizer, undo, Yjs codec,
port, contract or constant implementation and must not add a registry, installer,
Y.Doc, decoder, reducer or transport adapter. In the three listed pre-existing test
files, Task 1 may change only the import declarations from `"./index"` to the exact
private owner modules. Every test body, assertion, fixture, golden and other byte
remains unchanged.

`@convax/collaboration` performs no filesystem or Git I/O. The Host supplies one
complete snapshot, and the validator defensively copies every path and byte before
validation:

```ts
export interface AuthorityReleaseFileV1 {
  readonly path: string
  readonly bytes: Readonly<Uint8Array>
}

export interface AuthorityReleaseSnapshotV1 {
  readonly activePointerBytes: Readonly<Uint8Array>
  readonly files: readonly AuthorityReleaseFileV1[]
}

export interface ValidatedAuthorityReleaseV1 {
  readonly format: "convax.validated-authority-release/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly sequence: "1"
  readonly activePointerSha256: LowercaseSha256HexV1
  readonly manifestSha256: LowercaseSha256HexV1
  readonly evidenceSha256: LowercaseSha256HexV1
  readonly protocolBundleSha256: LowercaseSha256HexV1
  readonly protocolDigest: LowercaseSha256HexV1
}
```

`activePointerBytes` contains only the active pointer and is not an entry in
`files`. `files` contains exactly these fifteen duplicate-free paths in strict raw
UTF-8 order:

```text
docs/superpowers/specs/2026-07-31-global-uri-protocol.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md
docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md
docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256
docs/superpowers/specs/authorities/collaboration-v10/r5/main.md
docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json
docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/receipt.json
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/receipt.json
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/receipt.json
docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md
```

The seven manifest members, manifest, evidence, three reports and three receipts are
the complete cardinality. A fourteen-entry or sixteen-entry snapshot, duplicate, missing,
unsorted or alias path, pointer duplicated into `files`, old manifest, Route-B
disposition, draft/audit file or unrelated repository file rejects before bundle or
review decode.

The validator verifies the exact pointer, path grammar, manifest, payload hashes,
evidence, reports, receipts, bundle, artifact digests, core digest and protocol
digest. Invalid input throws the existing private `ProtocolAuthorityErrorV2`; the
only public failure identity is a readable
`code === "protocol-schema-bundle-unavailable"`. The error class and error types are
not package exports.

Task 1 runtime named exports are exactly:

```ts
validateAuthorityReleaseSnapshotV1(
  snapshot: AuthorityReleaseSnapshotV1,
): ValidatedAuthorityReleaseV1

selectInstalledProtocolAuthorityV2(
  validated: ValidatedAuthorityReleaseV1,
): never
```

Task 1 type-only exports are exactly:

```text
AuthorityReleaseFileV1
AuthorityReleaseSnapshotV1
ValidatedAuthorityReleaseV1
```

`src/index.ts` has no default or `export *`. Its runtime namespace keys are exactly
the two functions above, and its type surface has exactly the three types above.
`ProtocolAuthorityErrorV2`, `CollaborationFailureCodeV2` and every other error,
authority, Kernel, frame, causal, checkpoint, codec, Yjs and undo symbol are not
package-root exports. The package export map contains only `"."`; every deep
subpath, including `/authority`, `/authority-selector`, `/kernel`, `/frame`,
`/yjs-codec`, `/undo` and `/dist/index.js`, fails external resolution.

`ValidatedAuthorityReleaseV1` is frozen, copy-owned and unbranded. It proves only
packaging consistency. Other than the selection function receiving it as packaging
evidence, no Task 1 or Task 3 Kernel, frame, checkpoint, Yjs, owner, mutation,
decode, sign, persistence, ACK or live-runtime API may accept it as a live authority
or as sole authorization. During Task 1, `selectInstalledProtocolAuthorityV2` always throws
`protocol-schema-bundle-unavailable`. Task 3 alone may create a module-private,
non-structurally-forgeable live implementation identity and enable selection after
exact protocol and artifact digest equality.

The real packed-tarball check installs the tarball in a clean external consumer and
proves:

1. JavaScript `Object.keys()` is exactly the two selector functions;
2. the declaration surface has exactly those values and the three type-only names,
   with no `export *`;
3. old authority symbols and every mutation/decode/sign/ACK symbol fail positive
   import compilation;
4. no Kernel/frame/Yjs/undo runtime is importable;
5. all package deep subpaths fail resolution; and
6. borrowed input bytes cannot affect a completed validation result.

The exact Task 1 collaboration gates are:

```text
bun --cwd packages/collaboration typecheck
bun --cwd packages/collaboration test src/authority-selector.test.ts
bun --cwd packages/collaboration pack:check
```

The complete `bun --cwd packages/collaboration test` gate is mandatory in Task 3
and again at final integration, with zero failures required. Task 1 does not waive,
weaken or redefine that final gate. The import-only exceptions above exist to keep
Task 1 typecheck valid; they do not make the legacy R4 runtime tests authoritative
or green.

The selector and static checker consume the same complete golden and hostile
fifteen-file corpus. Any accept/reject difference blocks pointer promotion.

Before Task 3:

```text
authority packaging = valid
selected protocol implementation = unavailable
collaboration mutation/decode/sign/ACK = unavailable
legacy public runtime fallback = impossible
```

The Task 1-only public-API break must not be independently published or merged as a
product release. Final product integration waits for Task 3 to install and expose
the complete selected-authority runtime.

### 24.2 Mandatory release falsifiers

The R5 release and pointer promotion are rejected if any of the following is true:

1. Any artifact digest excludes bytes from an annex, uses a sentinel or omits the
   final LF.
2. `typeNamespaces` differs from the exact five-element tuple in the
   collaboration-kernel annex section 4, is unsorted or is treated as a runtime
   dependency graph.
3. The manifest has anything other than the exact seven members, grammar or order.
4. A report/receipt is reused from an older route, names a different role/task, is
   conditional, or is not bound to the exact current manifest and bundle.
5. The active pointer accepts a caller-selected path, opens `previousSelection`,
   falls back, skips sequence/revision monotonicity or activates before all gates.
6. The initial promoter creates a pointer while the old manifest is missing, a
   symlink, non-regular, non-`100644` or has any hash other than the fixed legacy
   digest.
7. At T0, the pointer or any exact snapshot member is not a regular non-symlink Git
   blob with mode `100644`; or any descendant changes a sealed path, byte, file
   kind or mode without `activated-authority-mutation`.
8. A Route-B disposition remains under R5, changes bytes during relocation, enters
   the exact-fifteen snapshot, or has its path or hash referenced by a fresh report,
   receipt, `review-evidence.json`, `protocol-schema-bundle-v2.json`,
   `authority.sha256` or active pointer.
9. The snapshot has anything other than the exact fifteen ordered paths, or the
   pointer is duplicated into `files`.
10. Before Task 3, the package root exposes anything other than the exact two
    runtime functions and three type-only names, any deep subpath resolves, or a
    public API can instantiate a Kernel, decode/admit a frame, mutate Yjs state,
    sign, ACK or import an R4 verifier/pin.
11. The selector reads the filesystem, uses ambient state, trusts borrowed input
   bytes or treats packaging validation as a live runtime authority.
12. The selector and static checker disagree on any shared hostile corpus case.
13. Task 1 changes a forbidden Kernel/frame/causal/checkpoint/canonicalizer/undo/
    Yjs-codec/port/contract/constant implementation, changes `errors.ts`, changes
    any of the three import-only test exceptions beyond their import declarations,
    or expands into a runtime registry, installer, owner runtime or transport.
14. The Task 1 graph is not exactly 36 rows, has a missing provider/cycle/unordered
    overlapping scope, or any Task 2 through Task 8 row starts before
    `1.promotion`.
15. Root supplies an architecture vote or promotion proceeds with fewer than three
    unconditional decisions over the same exact release bytes.
16. Task 1 fails any of its exact package typecheck, targeted selector-test or real
    packed-tarball gates; or Task 3/final integration fails the complete
    `bun --cwd packages/collaboration test` gate with zero failures required.
