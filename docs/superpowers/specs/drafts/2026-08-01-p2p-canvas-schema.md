# P2P Canvas Yjs schema proposal

Status: architecture-gate draft; not an implementation contract. This proposal
replaces the per-edit central-admission interpretation for Canvas shards. It does
not change membership, peer transport, checkpoint, or ProjectIndex protocols.

The normative words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** have their RFC
2119 meanings. Types below are closed: an unknown key, variant, enum value, or
non-canonical ordering is invalid rather than ignored.

## 1. Ownership and authority

- `@convax/canvas` owns this logical schema, canonical projection, typed intents,
  pure reducers, semantic history materialization, and Canvas-specific invariants.
- `@convax/collaboration` owns the generic `replicaDoc`/`candidateDoc` lifecycle,
  bounded Yjs update helpers, transaction origins, and session `Y.UndoManager`.
- `@convax/project` owns ProjectIndex resource truth, Canvas routing/tombstones,
  and the browser-safe P2P collaboration protocol.
- `@convax/project/node` is the sole local durable writer for Project collaboration
  journals, snapshots, heads, outboxes, and native resource validation.
- Desktop Main composes PeerJS, member/replica credentials, Project resource ports,
  Plugin validation artifacts, and the one local per-shard commit mutex.
- Renderer, Agent, and Plugin callers submit domain commands only. They MUST NOT
  submit actor/replica ids, operation ids, ordinals, derived entity ids, raw Yjs
  updates, document versions, or whole-document patches.

The outer P2P protocol authenticates a durable device-replica actor, its signed
per-replica hash chain, causal heads, membership epoch, schema digests, and exact
Yjs update. Canvas receives only a verified operation context:

```ts
interface CanvasReplicaOperationContextV1 {
  replicaActorId: string
  replicaSequence: string       // uint64 decimal; chain order, not a conflict clock
  operationId: string           // canonical 16-byte base64url, Main allocated
  lamport: string               // uint64 decimal, derived as 1 + max causal Lamport
  requestDigest: string         // digest of exact canonical typed intent
  causalHeadsDigest: string     // digest of the closed per-replica causal frontier
}
```

`replicaSequence` MUST NOT be compared across actors. Cross-actor conflict choices
use the portable Lamport stamp below; service sequence, PeerJS arrival order, Yjs
client id, and wall clock are forbidden inputs.

## 2. Runtime document model and UndoManager

### 2.1 Authoritative runtime documents

Each open Canvas shard has exactly these mutable runtime documents:

| State | Meaning | Durable input | May project to callers |
| --- | --- | --- | --- |
| `replicaDoc` | All locally durable, causally validated local and remote frames in the current Project/shard epoch and its admitted membership history | content-addressed snapshot plus validated frame journal | yes |
| `candidateDoc` | One isolated clone used for a local command or incoming-frame validation | none | no |
| `pendingCausal` | Bounded bytes whose causal dependency or exact validation artifact is absent | quarantine/pending store, never a Y.Doc | no |
| `outbox` | Exact locally durable signed frames not yet durably ACKed by another peer | frame journal plus replication state | already in `replicaDoc` |

Normal P2P edits have no central-promotion `workingDoc` and no second provisional
Y.Doc. Once a local frame and durable head are fsynced and self-validated, its exact
update is a local replica fact; remote durable ACK changes only replication status.
`outbox` MUST NOT be replayed as a second mutation overlay.

`candidateDoc` is single-use and single-writer:

1. Main enters the per-shard commit mutex.
2. It clones the exact current `replicaDoc` and allocates operation identity,
   Lamport, ordinals, entity identities, and a closed intent.
3. Canvas reduces the intent once, validates the complete candidate, and derives
   the exact semantic write set and Yjs delta.
4. Main durably appends the signed frame and head.
5. Only after durability, Main applies that exact delta to the live `replicaDoc`
   using the tracked local origin.
6. If step 5 fails, the shard enters recovery-required; restart/rebuild from the
   durable journal is required and no second delta is synthesized.

An incoming frame has two isolated checks. The receiver MUST reconstruct the
frame's exact causal base and prove intent-to-update equivalence there. It then
applies the already verified update to a clone of the current `replicaDoc` and
validates the merged closed schema and I-confluent projection. Only then may it
persist the frame/head and apply the same bytes to the live document. Missing
causal dependencies or validation artifacts keep the frame in `pendingCausal`.
They never enter `replicaDoc`, projection, ACK, or Undo.

### 2.2 Transaction origins and session history

The live `Y.UndoManager` is attached to `replicaDoc`. Its tracked-origin set
contains only the current device replica's successfully durable local Canvas frame
origin object. These origins are distinct objects, not caller strings:

```ts
localCanvasFrameOrigin       // tracked; one captured item per durable local intent
remoteCanvasFrameOrigin      // untracked
bootstrapOrigin              // untracked
hydrationOrigin              // untracked
candidateOrigin              // candidateDoc only; never attached to live UndoManager
recoveryReplayOrigin         // untracked
semanticHistoryOrigin        // untracked as a new root
awarenessOrigin              // never touches replicaDoc
```

- Applying a remote frame to the same live `replicaDoc` MUST NOT clear or enter the
  local Undo stack.
- Every local root intent calls `stopCapturing()` before and after its one live
  transaction; `captureTimeout` is zero.
- UndoManager chooses a local root operation only. Its raw undo/redo update is never
  durable or transmitted. Canvas materializes a new closed
  `canvas.undo.semantic-inverse` or `canvas.redo.semantic-forward` intent, persists
  it, and applies it with `semanticHistoryOrigin`.
- Full bootstrap replacement, epoch rollover, corruption recovery, process restart,
  or any complete `replicaDoc` rebuild clears session Undo. Cross-restart Undo is
  explicitly unsupported.
- A remote edit may make a selected inverse guard stale. The history request then
  fails without moving either UndoManager stack.

## 3. Canonical CanvasYDoc layout

The named root is exactly `convax.canvas.v1`. It contains exactly these keys:

```ts
interface CanvasRootV1 {
  identity: Y.Map<unknown>
  meta: Y.Map<Y.Map<StampedValueV1<string | readonly string[] | null>>>
  nodes: Y.Map<Y.Map<unknown>>
  edges: Y.Map<Y.Map<unknown>>
  containments: Y.Map<ContainmentChoiceV1>       // flat; never nested actor maps
  generationBegins: Y.Map<GenerationBeginV1>    // immutable value per generation id
  generationTerminals: Y.Map<GenerationTerminalV1> // immutable value per generation id
  semanticHistory: Y.Map<Y.Map<SemanticHistoryStateV1>>
  operations: Y.Map<BoundedOperationReceiptV1>
}
```

The root and `identity`, `meta`, and all metadata field actor-slot maps are created
at document genesis. A node or edge identity is operation-derived and therefore has
one causal creator. Its record and all actor-slot containers are created in that
same transaction before another frame can causally edit the entity.

### 3.1 Portable ordering and stamps

```ts
interface PortableStampV1 {
  lamport: string
  replicaActorId: string
  operationId: string
  writeOrdinal: string
}
```

Stamp comparison is ascending by decoded uint64 `lamport`, then UTF-8 byte order of
`replicaActorId`, `operationId`, and decoded uint32 `writeOrdinal`. Maximum wins.
All strings are NFC. Arrays described as canonical are strictly UTF-8 sorted,
duplicate-free, and accepted only in that order.

Entity map keys continue to use the canonical `entityKeyV1(kind, EntityRefV1)`
codec. The flat containment slot key is exactly:

```text
node/<nodeId>/<incarnation>/actor/<replicaActorId>
```

All components use closed codecs that exclude `/`; parsing and re-encoding MUST
produce identical bytes. The value's child and actor MUST match the key. One actor
may overwrite only its own child slot with a later causally chained choice. Two
actors never assign the same containment key.

### 3.2 Node and edge records

A node record has exactly the following keys; `creationGroup` is the only optional
key. Every register value is keyed by `replicaActorId`, and its embedded stamp actor
must match that slot.

```ts
interface CanvasNodeRecordV1 {
  identity: CanvasNodeIdentityV1
  position: Y.Map<StampedValueV1<CanvasPointV1>>
  size: Y.Map<StampedValueV1<CanvasSizeV1>>
  data: Y.Map<StampedValueV1<NodeDataEnvelopeV1>>
  plugin: Y.Map<StampedValueV1<PluginStateEnvelopeV1 | null>>
  tombstones: Y.Map<PortableStampV1>
  creationGroup?: CreationGroupRefV1
}

interface CanvasEdgeRecordV1 {
  identity: CanvasEdgeIdentityV1
  data: Y.Map<StampedValueV1<CanvasEdgeDataV1>>
  tombstones: Y.Map<PortableStampV1>
  creationGroup?: CreationGroupRefV1
}
```

Creation writes the initial position, size, and data claims and, when applicable,
the initial Plugin claim. Registers are never replaced by another `Y.Map`.
Tombstones are grow-only actor facts; a live projection never chooses a winning
tombstone by timestamp.

This proposal makes placeholder ownership explicit:

```ts
type PlaceholderNodeDataV1 =
  | {
      format: "convax.canvas-node-data/1"
      kind: "placeholder"
      owner: "manual-pending"
      title: string
      expectedClass: "text" | "image" | "video" | "audio" | "file"
      state:
        | { phase: "pending" }
        | { phase: "failed"; failureCode: string; publicMessage?: string }
    }
  | {
      format: "convax.canvas-node-data/1"
      kind: "placeholder"
      owner: "generation"
      title: string
      expectedClass: "text" | "image" | "video" | "audio" | "file"
    }
```

A generation-owned placeholder has no independent pending/failed register.
Generation begin/terminal projection is its sole lifecycle authority.

## 4. Flat containment and deterministic cycle projection

```ts
interface ContainmentChoiceV1 {
  format: "convax.canvas-containment-choice/1"
  relationId: string
  origin: PortableIdentityOriginV1
  child: EntityRefV1
  parent: EntityRefV1 | null
  stamp: PortableStampV1
}
```

For each effective-live child, projection selects the maximum stamped flat choice
among all actor slots. A null parent makes the child top-level. A missing, deleted,
or non-group parent rejects that selected relation and leaves the child top-level.
Business edges are never containment candidates.

Cycle breaking is a projection rule, not a mutating repair:

1. Select at most one valid relation per child as above.
2. Find a directed child-to-parent cycle.
3. Remove the cycle member with maximum tuple
   `(choice.stamp, UTF8(relationId))`; that child becomes top-level.
4. Repeat until acyclic.

The algorithm MUST inspect cycles and keys in UTF-8 canonical order. It MUST NOT
fall back to a losing actor choice after dropping a cycle member. All original
choices remain in Yjs for later diagnosis or explicit reparenting.

The flat key is mandatory. Lazily creating `root.containments[child]` as a nested
`Y.Map` is forbidden because two actors can concurrently attach different child
maps to the same parent key and make one legal actor choice unreachable.

## 5. Immutable generation records and effective node data

### 5.1 Records

Generation begins and terminals are immutable, operation-derived records. They are
not actor-slot LWW registers.

```ts
interface GenerationBeginV1 {
  format: "convax.canvas-generation-begin/1"
  identity: GenerationIdentityV1
  node: EntityRefV1
  beginStamp: PortableStampV1
  outputClaimStamp: PortableStampV1
  tool: GenerationToolRefV1
  prompt: string
  targetEffectiveDataDigest: string
  targetPluginDigest: string | null
}

type GenerationTerminalV1 =
  | {
      format: "convax.canvas-generation-terminal/1"
      phase: "succeeded"
      generationId: string
      node: EntityRefV1
      beginDigest: string
      terminalOperation: OperationIdentityV1
      outputData: ResourceNodeDataV1
      outputProofDigest: string
    }
  | {
      format: "convax.canvas-generation-terminal/1"
      phase: "failed"
      generationId: string
      node: EntityRefV1
      beginDigest: string
      terminalOperation: OperationIdentityV1
      failureCode: string
      publicMessage?: string
    }
```

- `generationBegins[generationId]` is written exactly once by the begin operation.
- `generationTerminals[generationId]` is written at most once and only by the same
  replica actor that owns the begin. The terminal frame's causal base MUST contain
  the exact begin and no terminal for that id.
- A same-actor double terminal implies a broken per-replica chain or equivocation
  and is quarantined by the outer protocol; it is never resolved by arrival order.
- Terminal time/stamp does not choose the generation or its output. This prevents a
  late completion for a losing concurrent begin from becoming current merely
  because it arrived later.
- `outputProofDigest` binds the exact current ProjectIndex proof carried by the
  terminal intent. The Project frontier/proof object is frame validation material;
  it MUST NOT be copied into durable Canvas node/generation state.

### 5.2 Effective data projection

The data shown for a live node is the maximum portable data claim:

1. Every value in the node's `data` actor register is a claim using its own stamp.
2. Every valid `succeeded` terminal for that node is a claim whose value is
   `terminal.outputData` and whose stamp is the matching begin's
   `outputClaimStamp`.
3. Maximum portable stamp wins. The terminal operation's later stamp is ignored.

`outputClaimStamp` is allocated in the begin transaction. For a
`pending-generation.create`, it has a greater write ordinal than the placeholder's
initial data claim so success replaces that placeholder. For generation on an
existing node, the begin Lamport is later than the target claim. A manual data edit
causally after the begin therefore outranks a late result; a concurrent edit is
resolved only by the portable tie-break. No wall clock or arrival order participates.

The projected lifecycle is the maximum `beginStamp` for the node and that begin's
optional terminal. A succeeded terminal additionally exposes
`effective: boolean`, determined by whether its output claim wins effective data.
A failed or superseded generation never rewrites node data. Resource scanning MUST
retain successful terminal outputs required by retained history even when they are
not currently effective.

Delete still wins: if the target node is effectively deleted, no generation or
output is projected. A terminal concurrent with deletion may remain as retained
history bytes, but it cannot revive the node.

The generation stamp slots are fixed. A standalone `generation.begin` uses begin
slot `"0"` and future output-claim slot `"1"`. A
`pending-generation.create` uses node created-by/position/size/data slots
`"0"/"1"/"2"/"3"`, begin slot `"4"`, and future output-claim slot `"5"`.
The operation receipt remains slot `"65535"`. These values are derived by the
owner and re-derived by every validator; no caller supplies them.

## 6. Resource proof modes

The Canvas reducer never resolves a Project resource. It consumes one of two closed
proofs supplied and revalidated by the Project composition edge.

```ts
interface CurrentResourceAdmissionProofV1 {
  mode: "current-project-index"
  durable: ProjectResourceDurableGuardV1
  requireCurrentLiveVersion: true
}

interface RetainedCanvasHistoryResourceProofV1 {
  mode: "retained-canvas-history"
  sourceState:
    | "history-root-pre"
    | "history-root-post"
    | "current-applied-post"
    | "last-history-post"
  sourceOperation: OperationIdentityV1
  sourceNode: EntityRefV1
  sourceDataDigest: string
  sourceResourceUri: string
  sourceBlobHash: string
  requireExactRetainedMaterial: true
}
```

Current proof rules:

- The canonical URI, Project id/epoch, file id, version id, blob hash, length, and
  bound ProjectIndex causal frontier MUST match the exact current live ProjectIndex
  version.
- Every new or changed resource reference in a normal intent has exactly one proof.
  Extra, missing, duplicated, or URI-mismatched proofs reject the intent.
- `canvas.resources.add`, normal `canvas.nodes.update-data`, generation success,
  and resource-bearing Plugin creation groups accept only current proofs.

Retained proof rules:

- Only semantic undo/redo materialization may use retained proof.
- The URI/data/blob must be byte-identical to retained root pre/post material named
  by the proof. It is not silently rebound to a newer current Project version.
- A missing retained blob makes the frame causally/resource pending; it does not
  authorize current-path lookup and does not corrupt the replica.
- A normal edit MUST NOT cite history to bypass current ProjectIndex validation;
  semantic history MUST NOT substitute a current proof for missing retained bytes.

## 7. Creation specs and placement

```ts
interface ExplicitNodeCreateSpecV1 {
  identityOrdinal: string
  nodeId: string
  role: "file" | "agent"
  position: CanvasPointV1
  size: CanvasSizeV1
  data: NodeDataEnvelopeV1
  plugin?: PluginStateEnvelopeV1
}

interface CanvasPlacedResourceNodeCreateSpecV1 {
  identityOrdinal: string
  nodeId: string
  role: "file"
  size: CanvasSizeV1
  data: ResourceNodeDataV1
  // position and plugin are deliberately forbidden
}

interface CanvasPlacedPendingNodeCreateSpecV1 {
  identityOrdinal: string
  nodeId: string
  role: "file"
  size: CanvasSizeV1
  data: PlaceholderNodeDataV1
  // position and plugin are deliberately forbidden
}

interface CanvasCreateEdgeSpecV1 {
  identityOrdinal: string
  edgeId: string
  source: EntityRefV1 | { createdNodeOrdinal: string }
  target: EntityRefV1 | { createdNodeOrdinal: string }
  data: CanvasEdgeDataV1
}

interface CreationGroupNodeSpecV1 extends ExplicitNodeCreateSpecV1 {
  role: "file"
  plugin: PluginStateEnvelopeV1
}
```

Resource and pending business insertion bodies carry only:

```ts
interface CausalPlacementV1 {
  anchor: CanvasPointV1
  strategy: "avoid-overlap-cascade"
}
```

Despite the retained wire token, the normative meaning is **avoid overlap against
the frame's causal-base projection only**. It is not a global no-overlap invariant.
Two peers creating from the same base and anchor may overlap after merge, and that
is a legal convergent state. Receiving a remote frame MUST NOT reposition an
already durable node; explicit `canvas.nodes.set-geometry` or whole-Canvas tidy is
the repair.

The portable placement algorithm is exact:

1. Let `gap = 24`. Obstacles are effective-live top-level nodes in the exact causal
   base, represented by their effective position and size. Invalid geometry rejects
   the base. Sort obstacles by node entity key in UTF-8 order.
2. Process created specs by decoded `identityOrdinal`; add each derived rectangle to
   the obstacle set before processing the next spec.
3. Start `(x, y)` at the exact anchor. A rectangle collides when
   `x < ox + ow + gap && x + width + gap > ox &&
   y < oy + oh + gap && y + height + gap > oy`.
4. If no obstacle collides, choose `(x, y)`. Otherwise set
   `x = max(ox + ow + gap)` over all currently colliding obstacles and repeat.
5. At most `obstacleCount + 1` iterations are legal. A non-finite result or x/y
   outside `[-10_000_000, 10_000_000]` rejects with `placement-unavailable`; there
   is no overlapping fallback, random jitter, `Math.hypot`, renderer measurement,
   or iteration-order tie-break.

Position is absent from request bytes/request digest. It is present in the derived
write set and signed Yjs update. Every validator recomputes it from the exact causal
base. A durable P2P frame is immutable; it is not regenerated merely because a
concurrent frame later arrives.

## 8. Closed typed intent union

All variants have the exact envelope:

```ts
interface CanvasIntentV1<K extends CanvasIntentKindV1, G, B> {
  format: "convax.typed-intent/1"
  kind: K
  guard: G
  body: B
}
```

`CanvasTypedIntentP2PV1` is the following closed union. There is no generic
transaction, patch, save, arbitrary operation array, `nodes.delete`, or
`edges.delete` wire variant.

```ts
type CanvasIntentKindV1 =
  | "canvas.nodes.create"
  | "canvas.resources.add"
  | "canvas.resources.pending.create"
  | "canvas.resources.pending-generation.create"
  | "canvas.elements.remove"
  | "canvas.nodes.set-geometry"
  | "canvas.nodes.update-data"
  | "canvas.nodes.set-plugin-state"
  | "canvas.nodes.set-structural-parent"
  | "canvas.nodes.group"
  | "canvas.nodes.ungroup"
  | "canvas.edges.connect"
  | "canvas.metadata.update"
  | "canvas.generation.begin"
  | "canvas.generation.complete"
  | "canvas.generation.fail"
  | "canvas.generations.fail-owned"
  | "canvas.plugin.creation-group.create"
  | "canvas.undo.semantic-inverse"
  | "canvas.redo.semantic-forward"
```

### 8.1 Creation and removal

`canvas.nodes.create`

- Creates exactly one explicit top-level `role:"agent"`, `data.kind:"agent"`
  node.
- Resource, placeholder, group, Plugin state, and bundled edge creation are
  forbidden.
- Guard contains only the exact derived absent `EntityRefV1`.

`canvas.resources.add`

```ts
guard: {
  existingEndpoints: readonly NodeLiveGuardV1[]
  resourceProofs: readonly {
    createdNodeOrdinal: string
    proof: CurrentResourceAdmissionProofV1
  }[]
}
body: {
  placement: CausalPlacementV1
  nodes: readonly CanvasPlacedResourceNodeCreateSpecV1[]
  edges: readonly CanvasCreateEdgeSpecV1[]
}
```

- `nodes` has `1..256` entries; `nodes.length + edges.length <= 512`.
- Proofs exactly cover every node once. No node carries Plugin state.
- Existing endpoints must be causal-live connectable cards. Created endpoints are
  addressed only by ordinal. Structural groups are invalid endpoints.

`canvas.resources.pending.create`

- Has the same placement/edge shape and aggregate bounds as resource add.
- Every node is `owner:"manual-pending"`; no generation or resource proof exists.
- Failure of one such placeholder is `canvas.nodes.update-data` from manual pending
  to manual failed under an exact data guard.

`canvas.resources.pending-generation.create`

- Creates exactly one `owner:"generation"` placeholder, zero to 256 associated
  edges, and exactly one immutable generation begin in the same transaction.
- The begin's node and identity ordinal are owner-derived from this intent. It has
  no independent placeholder failure state.
- Undo may remove the node. Redo MUST NOT recreate an active/billable generation.
  Redo is available only after retained terminal material exists: succeeded restores
  the retained resource with a new node incarnation; failed restores a manual failed
  placeholder; a still-active/no-terminal root reports `history-redo-unavailable`.

`canvas.elements.remove`

```ts
guard: {
  nodes: readonly NodeLiveGuardV1[]
  edges: readonly EdgeLiveGuardV1[]
  requireObservedIncidentEdgeClosure: true
}
body: {
  nodes: readonly EntityRefV1[]
  edges: readonly EntityRefV1[]
}
```

- Both arrays are canonical; their aggregate is `1..512`.
- Body and guard refs match exactly. `edges` is the canonical union of explicitly
  selected edges and every causal-base live edge incident to a removed node.
- The reducer writes one grow-only tombstone for every listed entity. An edge
  created concurrently and absent from the causal closure remains stored but is
  unreachable because an endpoint is deleted.

### 8.2 Field, relation, and structure intents

`canvas.nodes.set-geometry` carries `1..256` exact node updates. Each guard binds
the live incarnation and its causal-base geometry digest. Position and optional
size are absolute finite values. Drag, align, distribute, primitive layout, and
whole-Canvas layout all materialize this one kind; there is no layout-specific
writer.

`canvas.nodes.update-data` updates exactly one live node under both
`expectedEffectiveDataDigest` and `expectedDataRegisterDigest`. A new or changed
resource reference requires exactly one current resource proof. It may update a
manual pending lifecycle. It MUST NOT write Plugin state or a generation terminal.
Updating generation-owned placeholder lifecycle fields is forbidden; an ordinary
data edit may supersede a generation output through the effective-claim rule.
The immutable node role constrains transitions: an Agent stays `data.kind:"agent"`;
a structural group stays `data.kind:"group"`; generic update cannot introduce
either kind. Other file nodes may move from manual/generation placeholder to
resource or replace resource with resource, subject to the proof and lifecycle
rules. Thus a concurrent data edit cannot silently turn a containment parent into a
connectable resource card.

`canvas.nodes.set-plugin-state` updates exactly one live node's Plugin actor slot.
The guard binds current Plugin digest plus exact
`{pluginId,snapshotDigest,pluginStateSchemaDigest,validationArtifactDigest}`.
Unknown/missing exact validation artifacts are pending, never defaulted or
down-migrated.

`canvas.nodes.set-structural-parent` writes exactly one flat containment choice for
one live child and a live structural group or null. Its guard binds the actor's
prior slot digest. It may create a candidate cycle; deterministic projection breaks
the cycle. Business edges are unaffected.

`canvas.nodes.group` atomically creates one explicit `role:"file"`,
`data.kind:"group"`, Plugin-free structural node and writes one containment choice
for each of `1..256` guarded live children. Its explicit position/size is bound to
the causal geometry plan. It MUST NOT create business edges.

`canvas.nodes.ungroup` requires one live structural group and the exact canonical
set of its causal-base effective children. It writes null containment choices for
those children and tombstones the group. A concurrent reparent remains a separate
actor choice and is resolved by the portable stamp; a child whose winning relation
still names the deleted group projects top-level.

`canvas.edges.connect` creates exactly one ordinary business edge between two
causal-live connectable cards. Both endpoints must already exist in the causal base;
node-plus-edge creation belongs to resource/pending/Plugin creation intents.

`canvas.metadata.update` writes a non-empty subset of `title`, `description`, and
`tags`; each field has an exact prior field digest guard. Tags are UTF-8 sorted and
duplicate-free.

### 8.3 Generation intents

`canvas.generation.begin` writes exactly one immutable begin for an existing live
file node. The guard binds effective data digest, Plugin digest, and current
projected generation digest. Main assigns `generationId`, `beginStamp`, and
`outputClaimStamp`.

`canvas.generation.complete` writes exactly one previously absent terminal for the
exact causal begin. It accepts only `phase:"succeeded"`, resource output data, and
one current ProjectIndex proof. The durable terminal stores only that proof's
digest, not its Project frontier. It does not write the node data register.

`canvas.generation.fail` writes exactly one failed terminal for the exact causal
begin. It accepts only bounded host-authored `failureCode` and optional safe public
message.

`canvas.generations.fail-owned` writes failed terminals for `1..256` exact current
active begins whose begin actor equals the frame actor. It is for restart/service
reconciliation. The wire carries no claim about an in-memory task being live or
inactive. Any non-owned, already terminal, non-current, missing, or deleted target
in the authored causal base rejects the complete intent.

Generation begin/complete/fail/fail-owned are not new semantic Undo roots. The
pending-generation creation root follows the restricted redo rule above.

### 8.4 Plugin creation group

`canvas.plugin.creation-group.create` is the only node-plus-edge materialization
path carrying Plugin state.

```ts
guard: {
  source: NodeLiveGuardV1
  sourceDataDigest: string
  pluginRequirement: {
    pluginId: string
    snapshotDigest: string
    pluginStateSchemaDigest: string
    validationArtifactDigest: string
  }
  resourceProofs: readonly {
    createdNodeOrdinal: string
    proof: CurrentResourceAdmissionProofV1
  }[]
}
body: {
  groupOrdinal: string
  source: EntityRefV1
  nodes: readonly CreationGroupNodeSpecV1[]
  edges: readonly CanvasCreateEdgeSpecV1[]
}
```

- Nodes are `1..128`, edges are `0..256`, and aggregate result entities are at
  most 512. Every node carries exact Plugin state satisfying the requirement.
- Resource proofs exactly cover resource-bearing created nodes and no others.
- Every created node and edge receives the same immutable `CreationGroupRefV1`,
  including exact source incarnation and Plugin identity.
- Desktop's Plugin materialization of one node plus its source edge maps to this
  intent with one node and one edge. There is no separate materialize intent and no
  Plugin-specific Host branch.
- The source must be causal-live. If source deletion is concurrent or later, the
  entire group becomes effectively deleted; orphaned group output is forbidden.

### 8.5 Semantic undo and redo

`canvas.undo.semantic-inverse` and `canvas.redo.semantic-forward` bind one retained
local root receipt, its current semantic-history state, and one closed
`SemanticHistoryPlanV1`:

```ts
interface SemanticHistoryPlanV1 {
  mode: "inverse" | "forward"
  sourceIntentKind: CanvasUndoableIntentKindV1
  operations: readonly CanvasSemanticOperationV1[]
}
```

The undoable root-kind union is exact:

```ts
type CanvasUndoableIntentKindV1 =
  | "canvas.nodes.create"
  | "canvas.resources.add"
  | "canvas.resources.pending.create"
  | "canvas.resources.pending-generation.create"
  | "canvas.elements.remove"
  | "canvas.nodes.set-geometry"
  | "canvas.nodes.update-data"
  | "canvas.nodes.set-plugin-state"
  | "canvas.nodes.set-structural-parent"
  | "canvas.nodes.group"
  | "canvas.nodes.ungroup"
  | "canvas.edges.connect"
  | "canvas.metadata.update"
  | "canvas.plugin.creation-group.create"
```

The semantic operation union is also closed:

```ts
type CanvasSemanticOperationV1 =
  | {
      op: "node.create-explicit"
      guard: { expectedAbsent: EntityRefV1 }
      value: ExplicitNodeCreateSpecV1
      resourceProof?: RetainedCanvasHistoryResourceProofV1
    }
  | {
      op: "resource-nodes.create-placed"
      guard: {
        expectedAbsent: readonly EntityRefV1[]
        resourceProofs: readonly {
          createdNodeOrdinal: string
          proof: RetainedCanvasHistoryResourceProofV1
        }[]
      }
      value: {
        placement: CausalPlacementV1
        nodes: readonly CanvasPlacedResourceNodeCreateSpecV1[]
        edges: readonly CanvasCreateEdgeSpecV1[]
      }
    }
  | { op: "node.tombstone"; guard: NodeLiveGuardV1; node: EntityRefV1 }
  | {
      op: "node.set-geometry"
      guard: NodeLiveGuardV1 & { expectedGeometryDigest: string }
      node: EntityRefV1
      position: CanvasPointV1
      size?: CanvasSizeV1
    }
  | {
      op: "node.set-data"
      guard: NodeLiveGuardV1 & {
        expectedEffectiveDataDigest: string
        expectedDataRegisterDigest: string
      }
      node: EntityRefV1
      data: NodeDataEnvelopeV1
      resourceProof?: RetainedCanvasHistoryResourceProofV1
    }
  | {
      op: "node.set-plugin"
      guard: NodeLiveGuardV1 & { expectedPluginDigest: string | null }
      node: EntityRefV1
      plugin: PluginStateEnvelopeV1 | null
    }
  | {
      op: "edge.create"
      guard: {
        expectedAbsent: EntityRefV1
        source: NodeLiveGuardV1
        target: NodeLiveGuardV1
      }
      value: CanvasCreateEdgeSpecV1
    }
  | { op: "edge.tombstone"; guard: EdgeLiveGuardV1; edge: EntityRefV1 }
  | {
      op: "containment.set"
      guard: {
        child: NodeLiveGuardV1
        parent?: NodeLiveGuardV1
        expectedActorSlotDigest: string | null
      }
      child: EntityRefV1
      parent: EntityRefV1 | null
      relationOrdinal: string
    }
  | {
      op: "metadata.set"
      guard: { expectedFieldDigest: string | null }
      field: "title" | "description" | "tags"
      value: string | readonly string[] | null
    }
  | {
      op: "creation-group.create"
      guard: {
        source: NodeLiveGuardV1
        sourceDataDigest: string
        pluginRequirementDigest: string
        resourceProofs: readonly {
          createdNodeOrdinal: string
          proof: RetainedCanvasHistoryResourceProofV1
        }[]
      }
      value: {
        groupOrdinal: string
        source: EntityRefV1
        nodes: readonly CreationGroupNodeSpecV1[]
        edges: readonly CanvasCreateEdgeSpecV1[]
      }
    }
```

It cannot contain history, generation begin/terminal, a generic patch, or another
operation array. Resource create/set operations in semantic history require exact
retained-history proofs. Restored entities always receive new incarnations and new
derived relation/group identities. Old edges or generations targeting a deleted
incarnation never revive.

The plan has `1..512` semantic operations, at most 512 result entities, and at most
2048 expected logical writes. A materializer that cannot satisfy all root material,
blob, Plugin artifact, and current semantic guards fails without moving the
UndoManager selection.

## 9. Unique command-to-intent matrix

| Domain command | Sole wire intent | Explicitly forbidden aliases |
| --- | --- | --- |
| Create primitive Agent card | `canvas.nodes.create` | resource/pending/group/plugin node through generic create |
| Import, paste, drop, picker, Agent resource insertion | `canvas.resources.add` | repeated node create + edge connect |
| Create host-neutral non-generation placeholder | `canvas.resources.pending.create` | generic create or resource add |
| Create placeholder and submitting generation | `canvas.resources.pending-generation.create` | pending create followed by generation begin |
| Delete any mixed node/edge selection | `canvas.elements.remove` | `nodes.delete`, `edges.delete`, repeated deletes |
| Drag, resize, align, distribute, tidy/layout plan | `canvas.nodes.set-geometry` | renderer React Flow changes or layout-specific save |
| Replace/relink resource, edit node data, fail manual pending | `canvas.nodes.update-data` | generic document patch |
| Write Plugin-owned node state | `canvas.nodes.set-plugin-state` | node data metadata or iframe persistence |
| Reparent one child | `canvas.nodes.set-structural-parent` | business edge mutation |
| Create/remove structural group | `canvas.nodes.group` / `canvas.nodes.ungroup` | generic node create/delete transaction |
| Connect existing cards | `canvas.edges.connect` | created endpoint or structural parent semantics |
| Update Canvas title/description/tags | `canvas.metadata.update` | whole-document save |
| Start generation on existing node | `canvas.generation.begin` | node data lifecycle patch |
| Commit output / fail one run | `canvas.generation.complete` / `.fail` | node data + generation in separate intents |
| Reconcile owned active runs | `canvas.generations.fail-owned` | caller-selected arbitrary batch transaction |
| Plugin materializes node(s)+edge(s) | `canvas.plugin.creation-group.create` | separate Plugin materialize or resource add with Plugin state |
| Undo/redo local session root | semantic inverse/forward | raw `Y.UndoManager` update |

Any command absent from this table fails closed until the Canvas owner adds one
unique business mapping. A caller MUST NOT emulate atomicity with repeated intents.

## 10. I-confluent projection rules

An entity is **effectively live** only when all relevant rules hold:

- A node has no tombstone and either has no creation group or its creation group's
  exact source node is effectively live.
- An edge has no tombstone, both exact endpoint incarnations are effectively live,
  and any creation-group source is effectively live.
- Creation-group liveness is recursively source-based. A group's source must be a
  causal predecessor, so creation-group source cycles are invalid schema rather
  than a projection tie.
- A deleted ProjectIndex Canvas route hides the complete Canvas shard. Late Canvas
  frames may remain recoverable bytes but never recreate the route.

Consequences are independent of frame arrival order:

1. Delete node versus concurrent edge create: the edge is unreachable.
2. Delete node versus concurrent/late generation terminal: the node stays hidden.
3. Delete Plugin source versus creation-group create: every group node and edge is
   hidden; no orphan survives.
4. Concurrent reparent: every actor choice is retained; one portable winner is
   selected, then cycles are deterministically broken.
5. Concurrent generation begin/terminal: begin stamp selects lifecycle and output
   claim priority; terminal arrival never changes priority.
6. Concurrent field writes: actor claims remain in registers and the portable
   stamp selects one value. Text/Markdown file-content conflicts are handled by the
   Project file protocol, not by silently storing text in this Canvas register.

The reducer validates an authored intent against its declared causal base. Applying
an already verified concurrent update to a superset MUST NOT rerun stale live guards
against that superset; instead the merged candidate is checked against the closed
schema and these I-confluent projection rules.

## 11. Bounds and logical write-set accounting

Global limits:

```text
typed intent canonical JCS         <= 512 KiB
guard canonical JCS                <= 256 KiB
result entities per intent         <= 512
semantic operations                <= 512
logical changed paths/write set    <= 2048
node data                           <= 64 KiB, depth 16, values 2048
Plugin state                        <= 256 KiB, depth 32, values 4096
generation prompt                   <= 64 KiB UTF-8
safe public message                 <= 4 KiB UTF-8
```

Logical paths, not Yjs internal structs, are counted. The closed path families are:

```text
meta/<field>/actor/<actorId>
nodes/<entity>/identity
nodes/<entity>/position/actor/<actorId>
nodes/<entity>/size/actor/<actorId>
nodes/<entity>/data/actor/<actorId>
nodes/<entity>/plugin/actor/<actorId>
nodes/<entity>/tombstones/<actorId>
nodes/<entity>/creationGroup
edges/<entity>/identity
edges/<entity>/data/actor/<actorId>
edges/<entity>/tombstones/<actorId>
edges/<entity>/creationGroup
containments/<flatContainmentKey>
generationBegins/<generationId>
generationTerminals/<generationId>
semanticHistory/<rootOperation>/<actorId>
operations/<operationKey>
```

Paths are unique and UTF-8 sorted. The operation receipt is always one path and has
at most 512 sorted `resultEntities`. Empty Yjs register-container initialization is
schema structure and does not create an additional semantic leaf path.

The maximum admitted high-volume writes are intentionally below 2048:

- Resource add: `4*N + 2*E + 1`, `N<=256`, `N+E<=512`; maximum 1537.
- Plugin creation group: `6*N + 3*E + 1`, `N<=128`, `E<=256`; maximum 1537.
- Mixed remove: one tombstone per entity plus receipt; maximum 513.
- Semantic history: plan operations may number 512, but their expanded logical
  writes plus receipt/history state MUST remain <=2048. Operation count alone does
  not waive the write cap.

Any expected/actual path mismatch, extra Yjs shared type, unknown record key, or
limit overflow rejects before the update reaches `replicaDoc`.

## 12. Mandatory two-peer and three-peer fixtures

Every fixture starts from one byte-identical base snapshot. Peers use different
Yjs client ids and replica actors. For a frame set `F`, the test creates a fresh
base for every permutation of `F`, applies each frame with duplicates before and
after its first occurrence, and requires identical canonical projection and closed
state hash. A missing causal predecessor must remain pending until present.

### 12.1 Exact deterministic fixtures

1. **Two-peer node delete / edge create**: A removes node X and its observed edges;
   B connects X to Y from the same base. Both apply orders hide X and B's edge.
2. **Two-peer delete / generation complete**: A deletes generation target X; B
   completes the exact causal generation. Both orders hide X and never expose output.
3. **Two-peer Plugin group / source delete**: A creates one Plugin node and edge as
   a creation group from S; B deletes S. Both orders hide S and the complete group.
4. **Two-peer concurrent reparent**: A parents C to G1; B parents C to G2. Both flat
   keys and values remain present. The portable maximum wins in every order.
5. **Three-peer containment cycle**: A writes A->B, B writes B->C, C writes C->A.
   Every one of six orders rejects the same maximum relation and projects the same
   two remaining relations. Business edges with the same topology are unaffected.
6. **Two-peer generation begins and terminals**: A and B concurrently begin on X
   and later complete their own generations. All terminal arrival permutations keep
   begin-stamp selection; the last-arriving terminal cannot steal current lifecycle
   or effective data.
7. **Three-peer generation/manual/delete**: A begins generation on X, B edits X data
   concurrently, C deletes X, then A completes. All orders hide X. Repeating without
   C chooses effective data solely by begin output-claim versus B's portable stamp,
   never terminal arrival.
8. **Two-peer causal placement**: A and B add equal-size resources at the same anchor
   from an empty base. Both derive the same local position and may overlap after
   merge. Every order preserves each durable position; no remote merge reflows them.
9. **Three-peer placement with causal successor**: A adds at anchor, B causally sees
   A and adds at the same anchor, C is concurrent with both. B must avoid A; C may
   overlap. All six merges converge.
10. **Two-peer manual pending / replacement**: A creates manual pending; B causally
    replaces it using current resource proof while a duplicate A frame arrives.
    Exactly one node incarnation and one resource claim result.
11. **Two-peer current versus retained proof**: a normal edit with a stale current
    Project version is rejected; semantic redo with exact retained bytes succeeds.
    Missing retained blob remains pending and never falls back to current URI bytes.
12. **Two-peer Plugin schema mismatch**: the peer without the exact validation
    artifact keeps the frame pending. After fetching the digest-matched artifact it
    produces the same state hash; its older Plugin never writes defaults.
13. **Two-peer Undo origins**: A commits two local roots, B sends a remote frame,
    then A undoes. B's frame neither enters nor clears A's stack; the semantic
    inverse targets A's second root and converges on B.
14. **Three-peer out-of-order causal delivery**: C receives A2 before A1 and B1,
    keeps A2 pending, then receives dependencies in either order. A2 enters exactly
    once and the final hash equals continuously connected peers.
15. **Same-actor terminal/fork attack**: two signed different terminals at the same
    replica sequence are equivocation evidence. Neither arrival order may choose a
    terminal; the actor is quarantined by the outer protocol.
16. **Bounds/unknown-key attack**: 513 entities, 2049 logical writes, an unknown
    nested key, sparse array, non-NFC string, or accessor-bearing structured clone
    is rejected before Yjs mutation.

### 12.2 Property gate

In addition to golden fixtures, the owner MUST run at least 10,000 generated
two-/three-peer schedules spanning duplicate delivery, causal gaps, concurrent
delete, connect, reparent, generation, Plugin creation group, geometry, and data
edits. For each causally valid frame set:

```text
all delivery permutations/redundant deliveries
  => identical closed Canvas state hash
  => identical canonical projection hash
  => no unreachable entity projected
  => no unverified/pending frame acknowledged
```

Any counterexample is a schema defect. It MUST NOT be patched with PeerJS arrival
ordering, a service sequence, a document-wide version, or renderer repair.

## 13. Rejected alternatives and unresolved protocol dependencies

Rejected:

- Per-edit service admission/MMR as a hidden global Canvas order.
- A generic transaction VM or arbitrary semantic operation list for ordinary callers.
- Raw Yjs updates from renderer, Agent, or Plugin.
- Nested containment actor maps created on first reparent.
- Generation terminal LWW by terminal timestamp.
- Global no-overlap claims for concurrent P2P insertion.
- Resource path/LWW replacement without current or retained proof.

This Canvas schema still depends on separate architecture decisions that MUST be
frozen before implementation:

1. The outer per-replica signed frame, causal-head, equivocation, membership-epoch,
   bootstrap, and checkpoint/anti-rollback protocol.
2. Exact canonical state-hash and intent-to-Yjs-update equivalence artifacts shared
   by Desktop and any portable validator.
3. Resource/blob availability and retained-history compaction fences.
4. Product UX for a locally durable old-epoch frame rejected after membership
   rollover, and for concurrent causal-placement overlap.

These dependencies do not permit Canvas to reintroduce a central edit order or a
second canonical document.

## 14. Red-team decision

Score: **8.4/10** as a Canvas schema proposal. The remaining deductions are for the
unfrozen outer checkpoint/anti-rollback protocol, retained-history compaction, and
the product decision around concurrent placement overlap; they are not reasons to
weaken Canvas I-confluence.

Strongest objections:

1. Reconstructing an exact causal base may require retained frame/checkpoint history;
   without that outer guarantee, receiver-side semantic verification is impossible.
2. Effective generation data is more complex than one LWW register and needs golden
   proof that manual edits, concurrent begins, terminal arrival, and delete compose.
3. P2P causal placement cannot promise a globally tidy Canvas; accepting overlap may
   fail product expectations even though the CRDT is correct.

The proposal is falsified if any mandatory interleaving produces different hashes,
if a remote frame clears local session Undo, if a late terminal overrides a newer
data claim, if one concurrent containment choice disappears, or if Plugin/source
deletion leaves a projected orphan.
