# Convax P2P v10 Canvas protocol schema artifact

Status: **revision-4 normative appendix candidate; implementation prohibited until
the complete renewed authority set is regenerated and signed** for
`2026-08-01-p2p-collaboration-v10.md`. This document is complete for Canvas-owned
portable schema, reducer and projection semantics and imports only the exact shared
wire primitives owned by the collaboration-kernel artifact. It is not the portable
bundle owner and has no implementation authority until the canonical specification
and complete exact artifact set are signed together. MUST, MUST NOT, SHOULD and MAY
are normative.

## 1. Scope, owner and dependency direction

`@convax/canvas` exclusively owns:

- the `convax.canvas.v2` Yjs topology and closed values;
- Canvas typed intents, guards, pure reducers and actual-write evidence;
- operation-derived Canvas identities and portable projection order;
- containment, generation, Plugin creation-group, tombstone and semantic-history
  invariants;
- the exact eleven-root canonical-state extractor, complete Canvas digest ledger,
  semantic-history capture/materialization functions and owner artifact constructor
  for the kernel-owned canonicalizer descriptor;
- host-neutral editor, React Flow projection adapter and Canvas view commands.

`@convax/collaboration` owns the generic `replicaDoc`/isolated `candidateDoc`
lifecycle, canonical JSON and binary helpers, transaction origins and transient
`SessionUndoCoordinatorV2`. It does not know this schema or materialize Canvas
inverse operations.

Project composition verifies resource, Plugin-artifact and generation-recovery
facts, then injects non-serializable permits through Canvas-owned headless ports.
Canvas does not import Project, membership, PeerJS, Electron, filesystem or native
persistence. Desktop Main composes those ports, the sole local commit mutex and IPC.
Desktop renderer composes the React shell and host view adapters; it does not own a
second Canvas reducer, gesture-to-intent mapping or React Flow document store.

This appendix does not specify ProjectIndex, membership/control-plane, PeerJS,
checkpoint, cutoff, blob-transfer, shard-reset or native persistence protocols.
Their verified facts enter only through the closed contexts below.

## 2. Canonical primitives and rejection rule

```ts
type Id128V2 = string      // unpadded base64url encoding of exactly 16 bytes
type ActorIdV2 = string    // unpadded base64url encoding of exactly 32 bytes
type DigestV2 = string     // exactly 64 lowercase SHA-256 hex
type Uint64V2 = string     // canonical decimal 0..2^64-1
type Uint32V2 = string     // canonical decimal 0..2^32-1
type ProjectIdV2 = import("@convax/collaboration").ProjectIdV2
type CanvasIdV2 = import("@convax/collaboration").CanvasIdV2
type DocumentScopeV2 = import("@convax/collaboration").DocumentScopeV2
type DocumentScopeDigestV2 = import("@convax/collaboration").DocumentScopeDigestV2
type PortableStampV2 = import("@convax/collaboration").PortableStampV2
type OwnerCanonicalizerDescriptorV2 =
  import("@convax/collaboration").OwnerCanonicalizerDescriptorV2
type DocumentOwnerProtocolPortV2 =
  import("@convax/collaboration").DocumentOwnerProtocolPortV2
type CanvasScopeIdV2 = DocumentScopeDigestV2
type CanvasOperationIdV2 = Id128V2
```

`ProjectIdV2` is owned by the global URI protocol. `CanvasIdV2` is allocated by
the Project owner and has one portable codec across Project routes, Canvas identity
and the shared document scope: the `cv_` prefix followed by exactly 64 lowercase
hexadecimal characters. The kernel descriptor imports that scalar and owns the one
shared `DocumentScopeV2`; for a Canvas scope its `docId` is a `CanvasIdV2` and is
byte-identical to `CanvasIdentityV2.canvasId`. Canvas generates a local scalar
validator from that descriptor import; this wire-codec reuse does not create a
runtime dependency from `@convax/canvas` to `@convax/project`.

The imported shared scope shape is exactly
`{projectId:ProjectIdV2,projectEpoch:Id128V2,docKind:"project-index"|"canvas",
docId:"project-index"|CanvasIdV2,shardEpoch:Id128V2}`. `docKind:"project-index"`
requires `docId:"project-index"`; `docKind:"canvas"` requires a `CanvasIdV2`.
No owner may widen `docId` back to `string` or `Id128V2`, omit `shardEpoch`, or add
a `docEpoch`.

The kernel-owned scope digest domain is exact:

```text
DocumentScopeDigestV2 = SHA-256(
  UTF8("convax.document-scope/2") || 0x00 || JCS(DocumentScopeV2)
)
```

`CanvasScopeIdV2` is only an alias for that digest, never an opaque independently
chosen id. Genesis validation requires the outer shared scope to have
`docKind:"canvas"`, its `docId` to equal `CanvasIdentityV2.canvasId` byte-for-byte,
and its computed digest to equal both the operation context and identity `scopeId`.

Canonical JSON uses RFC 8785 key order plus the collaboration-v2 restrictions:
strings are NFC Unicode scalar sequences; numbers are finite; objects are plain;
arrays are dense; accessors, symbols, `undefined`, sparse arrays, cycles, lone
surrogates, NaN and Infinity are rejected. A type described as exact or closed
rejects every unknown key, missing required key, extra array element, unknown enum,
noncanonical integer or noncanonical set order. It never ignores or preserves an
unknown field inside accepted state.

All persistent Canvas strings are UTF-8. Unless a field gives a smaller bound, one
string is <=64 KiB. Canonical set arrays are strictly sorted by the named byte codec
and duplicate-free. JSON values inside node or Plugin state may contain only null,
boolean, finite number, NFC string, dense array and plain object.

### 2.1 Exact Canvas descriptor artifact

The Canvas owner artifact has this exact identity:

```ts
const CanvasProtocolSchemaArtifactIdentityV2 = {
  name: "canvas-schema",
  format: "convax.canvas-protocol-schema/2",
} as const
```

Its canonical descriptor artifact bytes are this exact whole-file UTF-8 byte stream,
including the final LF. The kernel-owned `ProtocolSchemaBundleV2` includes the exact
artifact ref and computes its `artifactDigest` as:

```text
SHA-256(
  UTF8("convax.protocol-schema-artifact/2") || 0x00 ||
  exact whole-file UTF-8 bytes including final LF
)
```

This file deliberately does not embed that `artifactDigest` or the resulting
`protocolDigest`: either value would make the artifact self-referential. The kernel
artifact owns the sorted ref array, exact bundle-core JCS and published digest.

## 3. Operation context, derived identities and stamps

The outer collaboration validator supplies this exact, already verified context:

```ts
interface CanvasReplicaOperationContextV2 {
  format: "convax.canvas-operation-context/2"
  scopeId: CanvasScopeIdV2
  actorId: ActorIdV2
  actorSequence: Uint64V2
  operationId: CanvasOperationIdV2
  lamport: Uint64V2
  intentDigest: DigestV2
  baseFrontierDigest: DigestV2
}
```

Canvas MUST NOT accept this context from UI, Agent, Plugin or renderer IPC. The
actor sequence orders only one exact actor chain and is never compared across actors.

Derived ids use this fixed preimage:

```text
SHA-256(
  "convax.canvas-derived-id/2\0" ||
  kindCode:u8 ||
  decoded(scopeId):32 || decoded(actorId):32 ||
  decoded(operationId):16 || ordinal:u32be
)
```

The encoded id is the kind prefix plus unpadded base64url of those 32 digest bytes.
Kind codes and prefixes are closed:

| Code | Kind | Prefix |
| ---: | --- | --- |
| 1 | node id | `n_` |
| 2 | node incarnation | `ni_` |
| 3 | edge id | `e_` |
| 4 | edge incarnation | `ei_` |
| 5 | generation id | `g_` |
| 6 | containment relation id | `r_` |
| 7 | Plugin creation-group id | `cg_` |

One creation ordinal derives both an entity id and its matching incarnation by the
two corresponding kind codes. Ordinals are canonical uint32 decimal in typed intent
bytes and are processed ascending, unique and contiguous from `"0"`. A validator
rederives every supplied id; mismatch rejects. Undo/redo reconstruction always uses
new operation/ordinal-derived ids and incarnations.

```ts
interface CanvasEntityRefV2 {
  kind: "node" | "edge"
  id: string
  incarnation: string
}

interface StampedClaimV2<T> {
  format: "convax.canvas-stamped-claim/2"
  stamp: PortableStampV2
  value: T
}
```

The imported exact shape is `{format:"convax.portable-stamp/2",
lamport:Uint64V2,actorId:ActorIdV2,operationId:Id128V2,
writeOrdinal:Uint32V2}`. Both integers are canonical decimal strings. The kernel
descriptor is its sole owner; this sentence records the exact import contract and
does not create a second Canvas-owned declaration.

Stamps compare ascending, maximum winning, by decoded uint64 Lamport, decoded
actorId bytes, decoded operationId bytes and decoded uint32 write ordinal. Machine
clock, actor sequence across actors, Yjs client id, arrival order, React event order
and service sequence never participate.

Write ordinals are assigned by the reducer in exact UTF-8 logical-write-path order,
except future generation output stamps reserve the explicit slots in section 9.
The operation receipt is always final write ordinal `"65535"`; an intent requiring
more than 512 logical paths rejects before mutation.

## 4. External fact and resource-proof boundary

Canvas persists a host-neutral atomic resource envelope:

```ts
interface CanvasResourceRefV2 {
  format: "convax.canvas-resource-ref/2"
  uri: string                    // canonical Convax URI, fragment forbidden
  mediaClass: "text" | "image" | "video" | "audio" | "file"
  mime: string
  byteLength: Uint64V2
  contentDigest: DigestV2
  ownerProofDigest: DigestV2
}
```

The complete object is one immutable JSON value. URI, digest, length and media class
MUST NOT be split into independently writable Yjs keys.

Portable intent proof references are a closed union:

```ts
type CanvasResourceProofRefV2 =
  | {
      format: "convax.canvas-resource-proof-ref/2"
      mode: "current-owner-state"
      resource: CanvasResourceRefV2
      ownerProofDigest: DigestV2
      requireCurrentLiveVersion: true
    }
  | {
      format: "convax.canvas-resource-proof-ref/2"
      mode: "retained-canvas-history"
      sourceState:
        | "history-root-pre"
        | "history-root-post"
        | "current-applied-post"
        | "last-history-post"
      sourceOperationId: CanvasOperationIdV2
      sourceNode: CanvasEntityRefV2
      sourceDataDigest: DigestV2
      resource: CanvasResourceRefV2
      requireExactRetainedMaterial: true
    }
```

Normal create/update/generation/Plugin-group intents accept only
`current-owner-state`. Only semantic undo/redo accepts retained-history proofs. One
proof exactly covers each new or changed resource value; missing, extra, duplicate or
URI/content mismatch rejects. Missing retained bytes leaves the outer frame pending;
Canvas never resolves a current URI as a substitute.

```ts
interface CanvasExternalFactContextV2 {
  validateCurrentResource(proof: CanvasResourceProofRefV2):
    CanvasCurrentResourcePermitV2 | "pending" | "invalid"
  validatePluginArtifact(requirement: PluginRequirementV2):
    CanvasPluginArtifactPermitV2 | "pending" | "invalid"
  validateGenerationBegin(begin: GenerationBeginV2):
    CanvasGenerationBeginPermitV2 | "pending" | "invalid"
  validateEditorAction(kind: "canvas.generation.dismiss/2"):
    CanvasEditorActionPermitV2 | "pending" | "invalid"
  validateGenerationRecovery(proofDigest: DigestV2):
    CanvasGenerationRecoveryPermitV2 | "pending" | "invalid"
}

declare const canvasPermitBrandV2: unique symbol
interface CanvasCurrentResourcePermitV2 {
  readonly [canvasPermitBrandV2]: "current-resource"
}
interface CanvasPluginArtifactPermitV2 {
  readonly [canvasPermitBrandV2]: "plugin-artifact"
}
interface CanvasGenerationBeginPermitV2 {
  readonly [canvasPermitBrandV2]: "generation-begin"
}
interface CanvasEditorActionPermitV2 {
  readonly [canvasPermitBrandV2]: "editor-action"
}
interface CanvasGenerationRecoveryPermitV2 {
  readonly [canvasPermitBrandV2]: "generation-recovery"
}
```

The five permit types are opaque, non-serializable call-context values. They MUST
NOT appear in public Canvas intent types, structured clone, Y.Doc, causal frames or
actual-write evidence. Canvas stores only the closed portable facts and proof digests.

## 5. Exact Yjs topology

The Y.Doc has exactly one named root, `doc.getMap("convax.canvas.v2")`. Genesis
creates that root and all eleven child maps in one transaction. Any other named root,
missing child, wrong Yjs shared type or replacement of a child map rejects.

```ts
interface CanvasRootV2 {
  identity: Y.Map<unknown>
  meta: Y.Map<unknown>
  nodes: Y.Map<unknown>
  edges: Y.Map<unknown>
  containments: Y.Map<unknown>
  generationBegins: Y.Map<unknown>
  generationTerminals: Y.Map<unknown>
  generationDismissals: Y.Map<unknown>
  generationRecoveryFailures: Y.Map<unknown>
  semanticHistory: Y.Map<unknown>
  operations: Y.Map<unknown>
}
```

All eleven child maps are mandatory; the literal count in a validator is `11`.

`identity` contains exactly the immutable `CanvasIdentityV2` and genesis binding in
section 19.2.2. Its owner schema, protocol, canonicalizer and genesis digests are
independent mandatory identities. No ordinary whole-file review SHA,
Canvas-private descriptor or private canonicalizer digest domain may substitute for
any of them.

`meta` contains exactly `title`, `description` and `tags`. Genesis creates one
`Y.Map<StampedClaimV2<...>>` actor-slot map for each field. Actor-slot keys are exact
ActorIdV2 strings; embedded stamp actor must match the key. Title/description values
are string or null; tags are a strict UTF-8 sorted duplicate-free string array.

`nodes[entityKey]` and `edges[entityKey]` contain a Y.Map record. `entityKey` is
`node/<id>/<incarnation>` or `edge/<id>/<incarnation>`; id components use the closed
derived-id codec and cannot contain `/`. The operation-derived causal creator creates
the record and every required nested actor-slot map in one transaction. No other
operation may create or replace a record or nested map.

All values in `containments`, generation maps, `semanticHistory` and `operations` are
immutable canonical JSON, never nested Yjs shared types. This flat rule prevents
concurrent lazy map insertion from hiding a legal actor choice.

## 6. Node, edge and field records

```ts
interface CanvasPointV2 { x: number; y: number }
interface CanvasSizeV2 { width: number; height: number }

interface CanvasNodeIdentityV2 {
  format: "convax.canvas-node-identity/2"
  ref: CanvasEntityRefV2 & { kind: "node" }
  role: "file" | "agent"
  createdBy: CanvasOperationIdV2
}

interface CanvasEdgeIdentityV2 {
  format: "convax.canvas-edge-identity/2"
  ref: CanvasEntityRefV2 & { kind: "edge" }
  source: CanvasEntityRefV2 & { kind: "node" }
  target: CanvasEntityRefV2 & { kind: "node" }
  createdBy: CanvasOperationIdV2
}

interface TombstoneFactV2 {
  format: "convax.canvas-tombstone/2"
  entity: CanvasEntityRefV2
  stamp: PortableStampV2
}
```

A node record has exactly `identity`, `position`, `size`, `data`, `plugin`,
`tombstones`, and `creationGroup`. Identity and creationGroup are immutable canonical
JSON (`creationGroup` is null or the exact ref below). Position, size, data and plugin
are actor-slot Y.Maps of `StampedClaimV2<T>`. Tombstones is an actor-slot Y.Map of
`TombstoneFactV2`. Every slot key and embedded actor match. Containers are never
replaced.

An edge record has exactly `identity`, `data`, `tombstones`, and `creationGroup` with
the same immutable/actor-slot rules. One edge always means business connection from
the source card's fixed right output to the target card's fixed left input. A
structural group is not connectable.

Geometry is finite. Position components are within `[-10_000_000, 10_000_000]`.
Width and height are within `(0, 1_000_000]`. Negative zero canonicalizes to zero.

```ts
type NodeDataEnvelopeV2 =
  | {
      format: "convax.canvas-node-data/2"
      kind: "agent"
      title: string
      instructions: string | null
    }
  | {
      format: "convax.canvas-node-data/2"
      kind: "group"
      title: string
    }
  | {
      format: "convax.canvas-node-data/2"
      kind: "placeholder"
      owner: "manual-pending"
      title: string
      expectedClass: "text" | "image" | "video" | "audio" | "file"
      state:
        | { phase: "pending" }
        | { phase: "failed"; failureCode: string; publicMessage: string | null }
    }
  | {
      format: "convax.canvas-node-data/2"
      kind: "placeholder"
      owner: "generation"
      title: string
      expectedClass: "text" | "image" | "video" | "audio" | "file"
    }
  | {
      format: "convax.canvas-node-data/2"
      kind: "resource"
      title: string
      resource: CanvasResourceRefV2
    }

interface CanvasEdgeDataV2 {
  format: "convax.canvas-edge-data/2"
  kind: "business"
  label: string | null
}

interface PluginRequirementV2 {
  pluginId: string
  snapshotDigest: DigestV2
  pluginStateSchemaDigest: DigestV2
  validationArtifactDigest: DigestV2
}

interface PluginStateEnvelopeV2 extends PluginRequirementV2 {
  format: "convax.canvas-plugin-state/2"
  state: unknown
}
```

Node role is immutable. `role:"agent"` requires `data.kind:"agent"`; a group is a
`role:"file"` node with `data.kind:"group"`; all other data kinds require file role.
A generic data update cannot introduce agent/group role semantics. Plugin state is
null or one valid envelope. Missing/mismatched exact validation artifact makes the
outer frame pending/read-only; it never installs defaults, strips unknown fields or
down-migrates state.

Tombstones are grow-only actor facts. The presence of any valid tombstone makes the
exact incarnation deleted; no maximum timestamp can resurrect it.

## 7. Containment and creation groups

Containment keys are exactly:

```text
node/<nodeId>/<incarnation>/actor/<actorId>
```

```ts
interface ContainmentChoiceV2 {
  format: "convax.canvas-containment-choice/2"
  relationId: string
  child: CanvasEntityRefV2 & { kind: "node" }
  parent: (CanvasEntityRefV2 & { kind: "node" }) | null
  stamp: PortableStampV2
}
```

The key child/actor must equal the value child/stamp actor. One actor may update only
its own causal slot. Parent, when non-null, must be an effective-live group in the
authored base. Business edges never enter containment.

Projection chooses the maximum valid actor choice for each effective-live child.
Null makes it top-level. A selected missing/deleted/non-group parent projects the
child top-level. For every canonical child-to-parent cycle, remove the member with
maximum `(portableStamp, UTF8(relationId))`, repeat in UTF-8 cycle/key order until
acyclic, and never fall back to a losing actor choice. Original claims remain stored.

```ts
interface CreationGroupRefV2 {
  format: "convax.canvas-creation-group-ref/2"
  groupId: string
  source: CanvasEntityRefV2 & { kind: "node" }
  sourceDataDigest: DigestV2
  plugin: PluginRequirementV2
  memberSetDigest: DigestV2
}
```

A creation-group source is a causal-live predecessor. Every created node and edge
has the byte-identical ref and occurs in the creating operation receipt's complete
result set. A source cycle is schema-invalid. A group result is effectively live only
while its exact source incarnation is effective-live. Source deletion concurrent
with or after creation hides every group node/edge; no orphan result survives.

An ordinary edge is effective-live only when it has no tombstone, both exact endpoint
incarnations are effective-live, and its optional creation group is effective-live.
Node delete versus concurrent edge create therefore retains but hides the edge.

## 8. Generation records and deterministic projection

```ts
interface GenerationBeginV2 {
  format: "convax.canvas-generation-begin/2"
  generationId: string
  node: CanvasEntityRefV2 & { kind: "node" }
  beginActorId: ActorIdV2
  beginAuthorizationEpochDigest: DigestV2
  beginStamp: PortableStampV2
  outputClaimStamp: PortableStampV2
  toolRefDigest: DigestV2
  prompt: string
  targetEffectiveDataDigest: DigestV2
  targetPluginDigest: DigestV2 | null
}

type OwnerGenerationTerminalV2 =
  | {
      format: "convax.canvas-generation-terminal/2"
      phase: "succeeded"
      generationId: string
      node: CanvasEntityRefV2 & { kind: "node" }
      beginDigest: DigestV2
      beginActorId: ActorIdV2
      outputData: NodeDataEnvelopeV2 & { kind: "resource" }
      outputProofDigest: DigestV2
    }
  | {
      format: "convax.canvas-generation-terminal/2"
      phase: "failed"
      generationId: string
      node: CanvasEntityRefV2 & { kind: "node" }
      beginDigest: DigestV2
      beginActorId: ActorIdV2
      failureCode: string
      publicMessage: string | null
    }

interface GenerationDismissalV2 {
  format: "convax.canvas-generation-dismissal/2"
  generationId: string
  beginDigest: DigestV2
  marker: "dismissed"
}

interface GenerationRecoveryFailureV2 {
  format: "convax.canvas-generation-recovery-failure/2"
  generationId: string
  beginDigest: DigestV2
  proofDigest: DigestV2
  failureCode: "generation-owner-unavailable"
}
```

`beginAuthorizationEpochDigest` is not an implementation-selected epoch hash. It is
exactly:

```text
SHA-256(
  UTF8("convax.begin-authorization-epoch-core/2") || 0x00 ||
  JCS(BeginAuthorizationEpochCoreV2)
)
```

The control artifact solely owns the closed `BeginAuthorizationEpochCoreV2` with
`format:"convax.begin-authorization-epoch-core/2"` and, in exact key schema,
`projectId:ProjectIdV2`, `projectEpoch:Id128V2`,
`membershipEpoch:Id128V2`, `membershipSnapshotDigest:DigestV2`,
`memberId:MemberIdV2`, `memberAuthorizationEpoch:Id128V2`,
`replicaId:ReplicaIdV2`, `actorId:ActorIdV2`,
`replicaAuthorizationEpoch:Id128V2`,
`replicaEditAuthorizationCoreDigest:DigestV2`, and
`protocolDigest:DigestV2`. The `replicaEditAuthorizationCoreDigest` is exactly the
enclosing `ReplicaEditAuthorizationV2.coreDigest`; it is not its wrapper digest,
credential digest or a second epoch token.

Project composition may return `CanvasGenerationBeginPermitV2` only after its
composite verifier has reconstructed that exact control-owned core, checked the
digest equation above, matched Project/epoch/actor/scope facts to the Canvas begin,
and verified the referenced edit authorization and protocol bundle. Canvas compares
and stores only the resulting digest. The control-owned canonical first-loss
receipt binds the byte-identical field name and value
`beginAuthorizationEpochDigest`; raw authorization epoch ids and locally chosen hash
preimages are forbidden at this boundary.

Map keys are exact and flat:

```text
generationBegins:             <generationId>
generationTerminals:          <generationId>/owner/<beginActorId>
generationDismissals:         <generationId>
generationRecoveryFailures:   <generationId>
```

Begin is immutable. Owner terminal is immutable, observes exact begin/no owner
terminal in its causal base and is authored only by beginActorId. Same-actor double
terminal is outer equivocation, never arrival-order resolution. The output proof
reference is validation material; Canvas state stores only `outputProofDigest` and
the admitted atomic output data.

`canvas.generation.dismiss/2` requires an editor-authorized outer context and exact
observed begin, but all authors write the byte-identical dismissal marker. Dismissal
does not delete bytes, cancel/refund external work or claim failure.

`canvas.generation.fail-recovery/2` requires the unique canonical first-loss proof
validated through `CanvasExternalFactContextV2`. All valid writers produce the same
single-key marker. Missing proof is pending; noncanonical or second proof rejects.
The composite verifier requires the receipt's `projectId`, `projectEpoch`,
`beginActorId` and `beginAuthorizationEpochDigest` to equal the exact begin core and
Canvas begin under validation; authorization replacement cannot replay a receipt
across begins. Canvas never imports membership or serializes its non-serializable
permit.

Lifecycle precedence is:

```text
node tombstone > dismissal > surviving owner terminal > recovery failure > active begin
```

Effective node data is maximum portable claim over the node data actor slots plus
every non-dismissed successful generation output, where output uses the begin-time
`outputClaimStamp`, never terminal arrival/stamp. A manual data edit causally after a
begin may outrank its late output. Dismissal removes that begin lifecycle and every
matching terminal output claim from competition: an existing node recomputes over
remaining prior/manual claims; a pending-generation node retains its placeholder and
projects lifecycle dismissed. Suppressed outputs remain history/resource-retention
roots. Delete hides all generation projection and late output never revives a node.

Write slots for standalone begin are begin `"0"`, future output claim `"1"`. For
pending-generation create they are node identity `"0"`, incarnation `"1"`, position
`"2"`, size `"3"`, placeholder data `"4"`, begin `"5"`, future output claim `"6"`.
The terminal's own operation stamp never changes output priority.

## 9. Semantic history and operation receipts

The revision-3 receipt, ref-bearing semantic templates and incomplete transition
shape are removed. The exact acyclic `BoundedOperationReceiptV2`, stable history
handles, root/transition records, history-only templates, materialized operations,
footprints and total capture/materialization functions are defined only in sections
19.3 through 19.6. In particular, no receipt contains an
`actualWriteEvidenceDigest`, no history template contains a persisted Canvas entity
id/incarnation, and redo of pending generation is governed only by the retained
generation-lifecycle guard in section 19.5.

## 10. Closed typed-intent envelope and guards

```ts
interface CanvasTypedIntentV2<K extends CanvasIntentKindV2, G, B> {
  format: "convax.typed-intent/2"
  kind: K
  guard: G
  body: B
}

interface NodeLiveGuardV2 {
  node: CanvasEntityRefV2 & { kind: "node" }
  expectedLive: true
  expectedIdentityDigest: DigestV2
}

interface EdgeLiveGuardV2 {
  edge: CanvasEntityRefV2 & { kind: "edge" }
  expectedLive: true
  expectedIdentityDigest: DigestV2
}

interface NodeDataGuardV2 extends NodeLiveGuardV2 {
  expectedEffectiveDataDigest: DigestV2
  expectedDataRegisterDigest: DigestV2
}

interface PluginGuardV2 extends NodeLiveGuardV2 {
  expectedPluginDigest: DigestV2 | null
  requirement: PluginRequirementV2 | null
}

interface GenerationGuardV2 extends NodeLiveGuardV2 {
  generationId: string
  beginDigest: DigestV2
  expectedLifecycleDigest: DigestV2
}
```

The exact intent-kind union is:

```ts
type CanvasIntentKindV2 =
  | "canvas.nodes.create/2"
  | "canvas.resources.add/2"
  | "canvas.resources.pending.create/2"
  | "canvas.resources.pending-generation.create/2"
  | "canvas.elements.remove/2"
  | "canvas.nodes.set-geometry/2"
  | "canvas.nodes.update-data/2"
  | "canvas.nodes.set-plugin-state/2"
  | "canvas.nodes.set-structural-parent/2"
  | "canvas.nodes.group/2"
  | "canvas.nodes.ungroup/2"
  | "canvas.edges.connect/2"
  | "canvas.metadata.update/2"
  | "canvas.generation.begin/2"
  | "canvas.generation.complete/2"
  | "canvas.generation.fail/2"
  | "canvas.generations.fail-owned/2"
  | "canvas.generation.dismiss/2"
  | "canvas.generation.fail-recovery/2"
  | "canvas.plugin.creation-group.create/2"
  | "canvas.undo.semantic-inverse/2"
  | "canvas.redo.semantic-forward/2"
```

There is no generic save, patch, transaction VM, arbitrary command array,
`nodes.delete`, `edges.delete`, raw Yjs update, expected document version or caller-
selected actor/operation/entity identity.

```ts
interface NodeCreateTemplateV2 {
  ordinal: Uint32V2
  nodeId: string
  incarnation: string
  role: "file" | "agent"
  position: CanvasPointV2
  size: CanvasSizeV2
  data: NodeDataEnvelopeV2
  plugin: PluginStateEnvelopeV2 | null
}

interface EdgeCreateTemplateV2 {
  ordinal: Uint32V2
  edgeId: string
  incarnation: string
  source: CanvasEntityRefV2 | { createdNodeOrdinal: Uint32V2 }
  target: CanvasEntityRefV2 | { createdNodeOrdinal: Uint32V2 }
  data: CanvasEdgeDataV2
}

interface CanvasIntentApplyResultV2 {
  format: "convax.canvas-intent-result/2"
  receipt: BoundedOperationReceiptV2
  actualWriteEvidence: CanvasActualWriteEvidenceV2
  semanticHistoryRoot: SemanticHistoryRootV2 | null
  invalidatedEntities: readonly CanvasEntityRefV2[]
  invalidatedMetaFields: readonly ("title" | "description" | "tags")[]
}
```

Invalidation arrays are canonical sets and are projection hints only. They never
become a mutation authority.

The portable intent is the following explicit discriminated union. Every object and
array below is exact under section 2; these are protocol shapes, not extensible
application interfaces.

```ts
interface DerivedNodeAbsentGuardV2 {
  ordinal: Uint32V2
  node: CanvasEntityRefV2 & { kind: "node" }
  expectedAbsent: true
}
interface DerivedEdgeAbsentGuardV2 {
  ordinal: Uint32V2
  edge: CanvasEntityRefV2 & { kind: "edge" }
  expectedAbsent: true
}
interface ConnectableNodeGuardV2 extends NodeLiveGuardV2 {
  expectedConnectable: true
}
interface CreatedResourceProofBindingV2 {
  createdNodeOrdinal: Uint32V2
  proof: CanvasResourceProofRefV2 & { mode: "current-owner-state" }
}
interface CausalPlacementV2 {
  anchor: CanvasPointV2
  gap: 24
  obstacleProjectionDigest: DigestV2
}
interface ResourceNodeCreateSpecV2 {
  ordinal: Uint32V2
  nodeId: string
  incarnation: string
  size: CanvasSizeV2
  title: string
  resource: CanvasResourceRefV2
}
interface PendingNodeCreateSpecV2 {
  ordinal: Uint32V2
  nodeId: string
  incarnation: string
  size: CanvasSizeV2
  title: string
  expectedClass: "text" | "image" | "video" | "audio" | "file"
}
interface GeometryGuardV2 extends NodeLiveGuardV2 {
  expectedGeometryDigest: DigestV2
}
interface GeometryUpdateV2 {
  node: CanvasEntityRefV2 & { kind: "node" }
  position: CanvasPointV2
  size: CanvasSizeV2 | null
}
interface ContainmentGuardV2 extends NodeLiveGuardV2 {
  expectedOwnSlotDigest: DigestV2 | null
}
interface MetadataFieldGuardV2 {
  field: "title" | "description" | "tags"
  expectedEffectiveDigest: DigestV2
  expectedOwnSlotDigest: DigestV2 | null
}
interface MetadataFieldUpdateV2 {
  field: "title" | "description" | "tags"
  value: string | readonly string[] | null
}
interface GenerationBeginGuardV2 extends NodeDataGuardV2 {
  expectedPluginDigest: DigestV2 | null
  expectedProjectedGenerationDigest: DigestV2
}
interface GenerationFailureV2 {
  failureCode: string
  publicMessage: string | null
}
interface GenerationObservedGuardV2 extends GenerationGuardV2 {
  expectedTerminalDigest: DigestV2 | null
  expectedDismissalDigest: DigestV2 | null
  expectedRecoveryFailureDigest: DigestV2 | null
}
interface SemanticHistoryGuardV2 {
  rootOperationId: CanvasOperationIdV2
  expectedRootReceiptDigest: DigestV2
  expectedHistoryRootDigest: DigestV2
  expectedHistoryStateDigest: DigestV2
  expectedMode: "applied" | "undone"
}

interface CanvasIntentContractMapV2 {
  "canvas.nodes.create/2": CanvasTypedIntentV2<
    "canvas.nodes.create/2",
    DerivedNodeAbsentGuardV2,
    { node: NodeCreateTemplateV2 & { role: "agent"; data: NodeDataEnvelopeV2 & { kind: "agent" }; plugin: null } }
  >
  "canvas.resources.add/2": CanvasTypedIntentV2<
    "canvas.resources.add/2",
    { existingEndpoints: readonly ConnectableNodeGuardV2[]; derivedNodes: readonly DerivedNodeAbsentGuardV2[]; derivedEdges: readonly DerivedEdgeAbsentGuardV2[]; resourceProofs: readonly CreatedResourceProofBindingV2[] },
    { placement: CausalPlacementV2; nodes: readonly ResourceNodeCreateSpecV2[]; edges: readonly EdgeCreateTemplateV2[] }
  >
  "canvas.resources.pending.create/2": CanvasTypedIntentV2<
    "canvas.resources.pending.create/2",
    { existingEndpoints: readonly ConnectableNodeGuardV2[]; derivedNodes: readonly DerivedNodeAbsentGuardV2[]; derivedEdges: readonly DerivedEdgeAbsentGuardV2[] },
    { placement: CausalPlacementV2; nodes: readonly PendingNodeCreateSpecV2[]; edges: readonly EdgeCreateTemplateV2[] }
  >
  "canvas.resources.pending-generation.create/2": CanvasTypedIntentV2<
    "canvas.resources.pending-generation.create/2",
    { existingEndpoints: readonly ConnectableNodeGuardV2[]; derivedNode: DerivedNodeAbsentGuardV2; derivedEdges: readonly DerivedEdgeAbsentGuardV2[] },
    { placement: CausalPlacementV2; node: PendingNodeCreateSpecV2; edges: readonly EdgeCreateTemplateV2[]; begin: GenerationBeginV2 }
  >
  "canvas.elements.remove/2": CanvasTypedIntentV2<
    "canvas.elements.remove/2",
    { nodes: readonly NodeLiveGuardV2[]; edges: readonly EdgeLiveGuardV2[]; requireObservedIncidentEdgeClosure: true },
    { nodes: readonly (CanvasEntityRefV2 & { kind: "node" })[]; edges: readonly (CanvasEntityRefV2 & { kind: "edge" })[] }
  >
  "canvas.nodes.set-geometry/2": CanvasTypedIntentV2<
    "canvas.nodes.set-geometry/2",
    { nodes: readonly GeometryGuardV2[] },
    { updates: readonly GeometryUpdateV2[] }
  >
  "canvas.nodes.update-data/2": CanvasTypedIntentV2<
    "canvas.nodes.update-data/2",
    { node: NodeDataGuardV2; resourceProof: CanvasResourceProofRefV2 | null },
    { node: CanvasEntityRefV2 & { kind: "node" }; data: NodeDataEnvelopeV2 }
  >
  "canvas.nodes.set-plugin-state/2": CanvasTypedIntentV2<
    "canvas.nodes.set-plugin-state/2",
    { node: PluginGuardV2 },
    { node: CanvasEntityRefV2 & { kind: "node" }; plugin: PluginStateEnvelopeV2 | null }
  >
  "canvas.nodes.set-structural-parent/2": CanvasTypedIntentV2<
    "canvas.nodes.set-structural-parent/2",
    { child: ContainmentGuardV2; parent: NodeLiveGuardV2 | null },
    { child: CanvasEntityRefV2 & { kind: "node" }; parent: (CanvasEntityRefV2 & { kind: "node" }) | null; relationId: string }
  >
  "canvas.nodes.group/2": CanvasTypedIntentV2<
    "canvas.nodes.group/2",
    { group: DerivedNodeAbsentGuardV2; children: readonly ContainmentGuardV2[]; expectedGeometryPlanDigest: DigestV2 },
    { group: NodeCreateTemplateV2 & { role: "file"; data: NodeDataEnvelopeV2 & { kind: "group" }; plugin: null }; children: readonly (CanvasEntityRefV2 & { kind: "node" })[]; relationIds: readonly string[] }
  >
  "canvas.nodes.ungroup/2": CanvasTypedIntentV2<
    "canvas.nodes.ungroup/2",
    { group: NodeLiveGuardV2; children: readonly ContainmentGuardV2[]; expectedEffectiveChildSetDigest: DigestV2 },
    { group: CanvasEntityRefV2 & { kind: "node" }; children: readonly (CanvasEntityRefV2 & { kind: "node" })[]; nullRelationIds: readonly string[] }
  >
  "canvas.edges.connect/2": CanvasTypedIntentV2<
    "canvas.edges.connect/2",
    { edge: DerivedEdgeAbsentGuardV2; source: ConnectableNodeGuardV2; target: ConnectableNodeGuardV2 },
    { edge: EdgeCreateTemplateV2 }
  >
  "canvas.metadata.update/2": CanvasTypedIntentV2<
    "canvas.metadata.update/2",
    { fields: readonly MetadataFieldGuardV2[] },
    { fields: readonly MetadataFieldUpdateV2[] }
  >
  "canvas.generation.begin/2": CanvasTypedIntentV2<
    "canvas.generation.begin/2",
    GenerationBeginGuardV2,
    { begin: GenerationBeginV2 }
  >
  "canvas.generation.complete/2": CanvasTypedIntentV2<
    "canvas.generation.complete/2",
    GenerationObservedGuardV2 & { resourceProof: CanvasResourceProofRefV2 & { mode: "current-owner-state" } },
    { terminal: OwnerGenerationTerminalV2 & { phase: "succeeded" } }
  >
  "canvas.generation.fail/2": CanvasTypedIntentV2<
    "canvas.generation.fail/2",
    GenerationObservedGuardV2,
    { terminal: OwnerGenerationTerminalV2 & { phase: "failed" } }
  >
  "canvas.generations.fail-owned/2": CanvasTypedIntentV2<
    "canvas.generations.fail-owned/2",
    { generations: readonly GenerationObservedGuardV2[]; requireBeginActorEqualsOperationActor: true },
    { failures: readonly ({ generationId: string; beginDigest: DigestV2 } & GenerationFailureV2)[] }
  >
  "canvas.generation.dismiss/2": CanvasTypedIntentV2<
    "canvas.generation.dismiss/2",
    GenerationObservedGuardV2,
    { dismissal: GenerationDismissalV2 }
  >
  "canvas.generation.fail-recovery/2": CanvasTypedIntentV2<
    "canvas.generation.fail-recovery/2",
    GenerationObservedGuardV2,
    { recoveryFailure: GenerationRecoveryFailureV2 }
  >
  "canvas.plugin.creation-group.create/2": CanvasTypedIntentV2<
    "canvas.plugin.creation-group.create/2",
    { source: NodeDataGuardV2; pluginRequirement: PluginRequirementV2; derivedNodes: readonly DerivedNodeAbsentGuardV2[]; derivedEdges: readonly DerivedEdgeAbsentGuardV2[]; resourceProofs: readonly CreatedResourceProofBindingV2[] },
    { groupOrdinal: Uint32V2; source: CanvasEntityRefV2 & { kind: "node" }; nodes: readonly NodeCreateTemplateV2[]; edges: readonly EdgeCreateTemplateV2[] }
  >
  "canvas.undo.semantic-inverse/2": CanvasTypedIntentV2<
    "canvas.undo.semantic-inverse/2",
    SemanticHistoryGuardV2 & { expectedMode: "applied" },
    { operations: readonly CanvasSemanticOperationV2[] }
  >
  "canvas.redo.semantic-forward/2": CanvasTypedIntentV2<
    "canvas.redo.semantic-forward/2",
    SemanticHistoryGuardV2 & { expectedMode: "undone" },
    { operations: readonly CanvasSemanticOperationV2[] }
  >
}

type CanvasTypedIntentUnionV2 =
  CanvasIntentContractMapV2[keyof CanvasIntentContractMapV2]
```

`keyof CanvasIntentContractMapV2` MUST equal `CanvasIntentKindV2` in both directions.
The generated validator rejects if either set has a member absent from the other.
Every reducer entry has the total signature
`(context, exactBase, intent, externalFacts) -> CanvasIntentApplyResultV2 | pending |
rejected`; no variant-specific result or write-evidence bypass is permitted. The
tables below define the exact cardinality, cross-field relation, receipt result set,
semantic-root flag and allowed write families for each member. Actual evidence is
still the exact derived path/value set, never merely an allowed superset.

## 11. Exact ordinary intent contracts

The following table defines complete guard/body/result classes. A body field not
listed is forbidden. `result` means exact entity class in the operation receipt;
every operation also writes its receipt and, for an undoable root, its history root.

| Intent | Exact guard | Exact body | Result |
| --- | --- | --- | --- |
| `canvas.nodes.create/2` | derived node expected absent | one `NodeCreateTemplateV2` for `role:"agent"`, `data.kind:"agent"`, Plugin null | one node |
| `canvas.resources.add/2` | live existing endpoint guards; current proof exactly per resource node | causal placement, 1..85 resource node specs without position/Plugin, 0..168 edge templates; aggregate <=169 and `6*N+3*E+2<=512` | all nodes/edges |
| `canvas.resources.pending.create/2` | live existing endpoint guards | causal placement, 1..85 manual-pending nodes, 0..168 edges; aggregate <=169 and `6*N+3*E+2<=512` | all nodes/edges |
| `canvas.resources.pending-generation.create/2` | endpoint guards, current generation/tool fact and any resource proofs | causal placement, exactly one generation placeholder, 0..167 edges, exact begin; `3*E+9<=512` | node and edges; begin is a domain fact, not a `CanvasEntityRefV2` |
| `canvas.elements.remove/2` | canonical node/edge live guards and `requireObservedIncidentEdgeClosure:true` | same exact refs; edges equal selected edges union causal-base incident live edges; aggregate `T=1..510` | tombstoned refs |
| `canvas.nodes.set-geometry/2` | 1..256 node live guards with exact geometry digest | matching absolute position and optional size updates | updated nodes |
| `canvas.nodes.update-data/2` | one `NodeDataGuardV2`, plus exactly one current resource proof when reference changes | exact node ref and new `NodeDataEnvelopeV2` | node |
| `canvas.nodes.set-plugin-state/2` | one `PluginGuardV2` and validated exact artifact | exact node and Plugin envelope or null | node |
| `canvas.nodes.set-structural-parent/2` | child live, parent live group or null, exact prior actor-slot digest | child, parent, derived relation id | child |
| `canvas.nodes.group/2` | 1..256 live children and exact causal geometry-plan digest | one explicit Plugin-null group plus one relation per child; no business edge | group and children |
| `canvas.nodes.ungroup/2` | live group and exact canonical causal-base effective child set | group ref and matching children | group and children |
| `canvas.edges.connect/2` | exact derived edge absent; two causal-base live connectable endpoint guards | one edge template using existing endpoints only | edge |
| `canvas.metadata.update/2` | exact prior digest per changed field | non-empty subset of title/description/tags | no entity |

Rules not expressible as optional aliases:

- resource/pending creation positions are absent from typed-intent bytes and intent
  digest and are recomputed by the placement algorithm below; exact positions occur
  only in the certified candidate update and actual-write evidence;
- node create cannot create resource, placeholder, group, Plugin state or bundled
  edges; those use their one named business intent;
- data update cannot write Plugin state, generation terminal or generation-owned
  placeholder lifecycle;
- edge connect cannot target created endpoints or groups;
- group/ungroup affects structural containment only, never business edges;
- multi-command product behavior maps to one named bounded intent, not repeated
  ordinary intents.

### 11.1 Causal placement

Placement is exact and applies only to resource/pending business creation:

1. `gap=24`. Obstacles are effective-live top-level causal-base nodes using effective
   geometry, sorted by node entity-key UTF-8 bytes.
2. Process new nodes by decoded ordinal and add each chosen rectangle before the next.
3. Begin at the exact finite anchor. Collision is
   `x < ox+ow+gap && x+width+gap > ox && y < oy+oh+gap && y+height+gap > oy`.
4. With collisions, set `x=max(ox+ow+gap)` over all current collisions and repeat.
5. More than `obstacleCount+1` iterations, non-finite geometry or out-of-range
   position returns `placement-unavailable`; there is no overlap fallback or jitter.

Concurrent peers using the same base may choose overlapping final rectangles after
merge. Remote application never reflows durable geometry.

## 12. Generation and Plugin intent contracts

| Intent | Exact guard | Exact body/result |
| --- | --- | --- |
| `canvas.generation.begin/2` | live file node; exact effective-data, Plugin and projected-generation digests | one derived immutable begin for existing node; no entity result |
| `canvas.generation.complete/2` | exact `GenerationGuardV2`, same begin actor, no owner terminal, one current resource proof | succeeded owner terminal; stores resource output and proof digest only |
| `canvas.generation.fail/2` | exact `GenerationGuardV2`, same begin actor, no owner terminal | failed owner terminal with closed bounded failure code/message |
| `canvas.generations.fail-owned/2` | 1..256 current active begin guards, every begin actor equals frame actor, none terminal/deleted | one owner failure per exact begin; all-or-nothing |
| `canvas.generation.dismiss/2` | exact observed begin/lifecycle and current-editor external fact | byte-identical fixed dismissal marker |
| `canvas.generation.fail-recovery/2` | exact observed begin/lifecycle and canonical recovery proof fact | byte-identical fixed recovery marker |
| `canvas.plugin.creation-group.create/2` | live source, source data digest, exact `PluginRequirementV2`, current resource proof per resource node | 1..85 Plugin file nodes, 0..168 edges, aggregate <=169, `6*N+3*E+2<=512`, identical creation-group ref |

Generation begin/terminal/dismissal/recovery and `fail-owned` are not semantic Undo
roots. A Plugin group source must be a causal predecessor; every node has exact
Plugin state satisfying the requirement. Missing artifact makes validation pending,
not partial. One invalid node/edge/proof rejects the entire group. No separate Plugin
materialize alias exists.

## 13. Semantic undo/redo intent and coordinator

```ts
type CanvasUndoableIntentKindV2 =
  | "canvas.nodes.create/2"
  | "canvas.resources.add/2"
  | "canvas.resources.pending.create/2"
  | "canvas.resources.pending-generation.create/2"
  | "canvas.elements.remove/2"
  | "canvas.nodes.set-geometry/2"
  | "canvas.nodes.update-data/2"
  | "canvas.nodes.set-plugin-state/2"
  | "canvas.nodes.set-structural-parent/2"
  | "canvas.nodes.group/2"
  | "canvas.nodes.ungroup/2"
  | "canvas.edges.connect/2"
  | "canvas.metadata.update/2"
  | "canvas.plugin.creation-group.create/2"

```

The exact `CanvasSemanticOperationV2` is section 19.5's closed materialized
operation. It carries a sorted `retainedResourceProofs` array so one atomic
creation-group restore can prove every distinct resource it introduces. The removed
single `retainedResourceProof` field and `CanvasSemanticTemplateV2` alias are not
accepted revision-4 schema.

`canvas.undo.semantic-inverse/2` and `canvas.redo.semantic-forward/2` each bind exact
root receipt/history state plus `1..510` closed semantic operations. Expanded result
entities stay <=512 and logical writes <=512. There is no nested history operation,
generation operation, arbitrary patch or ordinary-caller semantic-operation array.

`SessionUndoCoordinatorV2` is transient session selection state owned by
`@convax/collaboration`:

```ts
interface SessionUndoCoordinatorV2 {
  recordDurableRoot(rootOperationId: CanvasOperationIdV2): void
  peekUndo(): { rootOperationId: CanvasOperationIdV2; cursorToken: Id128V2 } | null
  peekRedo(): { rootOperationId: CanvasOperationIdV2; cursorToken: Id128V2 } | null
  commitUndo(cursorToken: Id128V2, durableInverseOperationId: CanvasOperationIdV2): void
  commitRedo(cursorToken: Id128V2, durableForwardOperationId: CanvasOperationIdV2): void
  clear(reason: "restart" | "rebuild" | "scope-change" | "unmount" | "post-commit-cursor-failure"): void
}
```

- only a successfully durable local undoable root enters undo and clears redo;
- remote/recovery/bootstrap frames neither enter nor mutate either stack;
- undo/redo peeks without moving, Canvas materializes against latest replicaDoc, and
  the cursor moves only after the new semantic frame crosses durable head;
- stale guard, pending proof/artifact, cancellation or durability failure leaves both
  stacks unchanged;
- if domain commit succeeds but cursor commit fails, domain state remains committed,
  the coordinator clears and reports `history-reset-after-commit`;
- restart, full rebuild, unmount and Project/Canvas scope change clear both stacks;
- raw Y.UndoManager inverse bytes never touch candidate/replicaDoc, frame or journal.

Y.UndoManager may exist only as non-authoritative capture/grouping metadata behind
these public semantics. No private Yjs stack mutation is permitted.

## 14. Actual-write evidence and closed path families

```ts
interface CanvasActualWriteV2 {
  entityKind: "canvas" | "node" | "edge" | "containment" | "generation" | "history" | "operation"
  entityId: string
  field: string
  valueDigest: DigestV2
}

interface CanvasActualWriteEvidenceV2 {
  format: "convax.canvas-actual-write-evidence/2"
  changedPaths: readonly string[]
  writes: readonly CanvasActualWriteV2[]
}
```

This is the Canvas reducer's internal owner evidence. Before a causal frame is
signed, the kernel projects it into its sole shared `ActualWriteEvidenceV2` wrapper
with exact fields:

```ts
{
  format: "convax.actual-write-evidence/2",
  scope: outerDocumentScope,
  owner: "canvas",
  ownerSchemaDigest: canvasSchemaArtifactDigest,
  intentDigest: operationContext.intentDigest,
  changedPaths: canvasEvidence.changedPaths,
  writes: canvasEvidence.writes,
}
```

`outerDocumentScope` is the byte-identical shared `DocumentScopeV2` whose digest is
the Canvas `scopeId`; `canvasSchemaArtifactDigest` is exactly the
`canvas-schema.artifactDigest` in the kernel manifest. The two arrays are reused
byte-for-byte after generic closed-schema validation: projection may not filter,
coalesce, relabel or reorder owner writes, and it includes every operation/history
auxiliary path. The wrapper owner-schema digest is neither ordinary whole-file SHA
nor bundle `protocolDigest`.

Paths and writes are strict UTF-8 sorted duplicate-free sets and must equal the pure
reducer's derived expected set exactly. The only path families are:

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
containments/<flat-key>
generationBegins/<generationId>
generationTerminals/<generationId>/owner/<beginActorId>
generationDismissals/<generationId>
generationRecoveryFailures/<generationId>
semanticHistory/root/<rootOperationId>
semanticHistory/transition/<rootOperationId>/actor/<actorId>/operation/<operationId>
operations/operation/<actorId>/<operationId>
```

An unknown path, hidden Yjs write, missing expected path, value-digest mismatch or
write-count overflow rejects before a candidate or incoming frame reaches replicaDoc.
Initialization of a creator-owned empty actor-slot map is schema structure, not a
separate logical semantic path.

The domain-write closure per intent is exact. Every successful intent additionally
writes one `operations/...` receipt; each undoable root additionally writes one
`semanticHistory/root/...`, while undo/redo writes exactly one
`semanticHistory/transition/...`. A listed family is permitted only when the body
requires that concrete write; evidence cannot pad the set with unchanged claims.

| Intent | Only permitted domain path families |
| --- | --- |
| `canvas.nodes.create/2` | one node identity, position, size, data, plugin-null and creationGroup-null |
| `canvas.resources.add/2` | created node identity/position/size/data/plugin-null/creationGroup-null; created edge identity/data/creationGroup-null |
| `canvas.resources.pending.create/2` | same node/edge families as resource add, with placeholder data |
| `canvas.resources.pending-generation.create/2` | same created node/edge families plus one generation begin |
| `canvas.elements.remove/2` | one node or edge tombstone per exact body ref |
| `canvas.nodes.set-geometry/2` | position and, only when non-null, size per node |
| `canvas.nodes.update-data/2` | one node data actor slot |
| `canvas.nodes.set-plugin-state/2` | one node plugin actor slot |
| `canvas.nodes.set-structural-parent/2` | one flat containment actor choice |
| `canvas.nodes.group/2` | one group node's identity/position/size/data/plugin-null/creationGroup-null plus one containment choice per child |
| `canvas.nodes.ungroup/2` | one group tombstone plus one null containment choice per exact child |
| `canvas.edges.connect/2` | one edge identity/data/creationGroup-null |
| `canvas.metadata.update/2` | one metadata actor slot per exact changed field |
| `canvas.generation.begin/2` | one generation begin |
| `canvas.generation.complete/2` | one owner generation terminal |
| `canvas.generation.fail/2` | one owner generation terminal |
| `canvas.generations.fail-owned/2` | one owner generation terminal per exact guarded begin |
| `canvas.generation.dismiss/2` | one generation dismissal |
| `canvas.generation.fail-recovery/2` | one generation recovery-failure marker |
| `canvas.plugin.creation-group.create/2` | created node identity/position/size/data/plugin/creationGroup and created edge identity/data/creationGroup |
| `canvas.undo.semantic-inverse/2` | exact expansion of its closed semantic operations |
| `canvas.redo.semantic-forward/2` | exact expansion of its closed semantic operations |

The reducer counts every row above; immutable null initialization is a real logical
write when its path is listed. Let `N` be created nodes, `E` created edges, `T`
tombstones, `S` non-null size updates, `C` containment choices, `F` metadata fields,
`G` owned generation failures and `D` the fully expanded semantic-history domain
paths. The exact write-count closure is:

| Intent | Domain paths | Auxiliary paths | Total logical writes |
| --- | ---: | ---: | ---: |
| `canvas.nodes.create/2` | `6` | receipt + history root = `2` | `8` |
| `canvas.resources.add/2` | `6*N+3*E` | `2` | `6*N+3*E+2 <= 512` |
| `canvas.resources.pending.create/2` | `6*N+3*E` | `2` | `6*N+3*E+2 <= 512` |
| `canvas.resources.pending-generation.create/2` | `6+3*E+1` | `2` | `3*E+9 <= 512` |
| `canvas.elements.remove/2` | `T` | `2` | `T+2 <= 512` |
| `canvas.nodes.set-geometry/2` | `N+S` | `2` | `N+S+2 <= 512` |
| `canvas.nodes.update-data/2` | `1` | `2` | `3` |
| `canvas.nodes.set-plugin-state/2` | `1` | `2` | `3` |
| `canvas.nodes.set-structural-parent/2` | `1` | `2` | `3` |
| `canvas.nodes.group/2` | `6+C` | `2` | `C+8`, maximum `264` |
| `canvas.nodes.ungroup/2` | `1+C` | `2` | `C+3`, maximum `259` |
| `canvas.edges.connect/2` | `3` | `2` | `5` |
| `canvas.metadata.update/2` | `F` | `2` | `F+2`, maximum `5` |
| `canvas.generation.begin/2` | `1` | receipt = `1` | `2` |
| `canvas.generation.complete/2` | `1` | `1` | `2` |
| `canvas.generation.fail/2` | `1` | `1` | `2` |
| `canvas.generations.fail-owned/2` | `G` | `1` | `G+1`, maximum `257` |
| `canvas.generation.dismiss/2` | `1` | `1` | `2` |
| `canvas.generation.fail-recovery/2` | `1` | `1` | `2` |
| `canvas.plugin.creation-group.create/2` | `6*N+3*E` | `2` | `6*N+3*E+2 <= 512` |
| `canvas.undo.semantic-inverse/2` | `D` | receipt + transition = `2` | `D+2 <= 512` |
| `canvas.redo.semantic-forward/2` | `D` | `2` | `D+2 <= 512` |

For an ordinary undoable root, the auxiliary `2` is always its operation receipt
and new history root. For undo/redo it is the operation receipt and history
transition; undo/redo never creates another history root. Generation lifecycle
intents are non-undoable and therefore add only the receipt. These equations are
validation predicates, not estimates. Passing a body cardinality alone does not
waive the equation or encoded-evidence byte cap.

## 15. Projection and merge invariants

For each legal frame set, projection is a pure function of closed Yjs values:

1. Metadata, node geometry, ordinary node data, Plugin state and edge data choose the
   maximum valid actor claim by portable stamp.
2. A node is effective-live only without tombstone and with an effective-live
   creation-group source when present.
3. An edge is effective-live only without tombstone, with both exact live endpoints
   and with an effective-live creation-group source when present.
4. Containment chooses one actor claim per child then applies the deterministic cycle
   breaker; it never mutates stored claims.
5. Effective node data additionally folds valid non-dismissed generation success
   claims by their begin-time output stamp.
6. Project-owned route tombstone is an outer visibility fact and hides the whole
   Canvas; it is not stored or reimplemented in CanvasYDoc.
7. A verified concurrent frame is checked against its exact authored base. Applying
   it to a current superset does not rerun stale authored guards; merged closed-schema
   and I-confluence validation still run before durability.

Delete/edge-create, delete/generation-terminal, source-delete/Plugin-group,
reparent/cycle, generation/manual/dismiss/recovery and duplicate delivery therefore
have one result under every arrival order. No reducer may repair divergence with
arrival order, Yjs client id, service sequence, wall clock or React Flow state.

## 16. React Flow, editor and view ownership

`@convax/canvas` owns its host-neutral editor and React Flow projection adapter.
React Flow `nodes`/`edges` are regenerated from canonical Canvas projection and are
never another store. Canvas editor state may contain only selection projection,
hover, measured size, viewport/camera, connection/drag/resize preview, menus,
animation and mounted Plugin presentation state.

- `onNodesChange` and `onEdgesChange` never write CanvasYDoc.
- Drag/resize start captures exact entity incarnation and authoritative geometry.
  Preview is transient. Gesture end resolves the still-live incarnation and submits
  exactly one `canvas.nodes.set-geometry/2`; cancel, scope switch or remount discards.
- Automatic measured dimensions remain view state until an explicit resize intent.
- When an incarnation leaves projection through delete, semantic undo, Plugin source
  loss or route close, Canvas drops measured/drag/menu caches immediately; no ghost
  node can block undo.
- Workbench remains owner of active Input and input-scoped selection. Canvas owns the
  mounted editor's interpretation/projection of that selection.
- Canvas view layer owns select, reveal, fit, camera, animation and notification
  commands. Desktop injects safe viewport/inset, scheduling and platform adapters.
  View failure never reverses a durable domain mutation.

Desktop owns Electron, Main/preload IPC, React shell composition, user preferences
and product-specific chrome. It MUST NOT duplicate Canvas gesture reduction,
incarnation guards, projection reconciliation or view-command business rules.

## 17. Hard caps

All limits apply before large allocation, structured-clone traversal, Yjs mutation
or external-fact lookup. Inner limits never waive the complete intent/frame cap.

| Value | Limit |
| --- | ---: |
| complete typed-intent canonical JCS | 512 KiB |
| guard canonical JCS | 256 KiB |
| kernel shared `ActualWriteEvidenceV2` wrapper canonical JCS | 256 KiB |
| result entities per intent | 512 |
| semantic operations per history intent | 510 |
| logical changed paths/writes | 512 |
| node data | 64 KiB, depth 16, 2,048 values |
| Plugin state | 256 KiB, depth 32, 4,096 values |
| generation prompt | 64 KiB UTF-8 |
| public failure message | 4 KiB UTF-8 |
| title / edge label / failure code / Plugin id | 4 KiB UTF-8 each |
| description | 64 KiB UTF-8 |
| tags | 128 items, each 256 bytes UTF-8 |
| resource/placeholder nodes / edges per insertion | 85 / 168 |
| Plugin-group nodes / edges | 85 / 168 |
| geometry updates / owned generation failures | 256 / 256 |

The exact and first-invalid generated boundaries are mandatory:

- resource/pending: `(N=85,E=0)` and `(N=1,E=168)` each total `512`; the
  corresponding plus-one entity cases total `518` and `515` and reject;
- pending-generation: `E=167` totals `510`; `E=168` totals `513` and rejects;
- Plugin group: `(N=85,E=0)` and `(N=1,E=168)` each total `512`; either next
  node/edge rejects at `518`/`515`;
- mixed remove: `T=510` totals `512`; `T=511` totals `513` and rejects;
- geometry: `N=256,S=254` totals `512`; one additional non-null size totals `513`
  and rejects;
- semantic undo/redo: `D=510` totals `512`; `D=511` totals `513` and rejects.

Each accepted exact-count fixture must also encode to at most 256 KiB of canonical
evidence; the byte-exact 256 KiB fixture passes and the first 256 KiB plus one byte
fixture rejects before Yjs mutation. Evidence is never truncated, summarized or
made optional to admit a larger batch.

## 18. Mandatory conformance tests

Every fixture starts from one byte-identical base. Peers use different Yjs client ids
and actors. For every causally valid frame set, apply every delivery permutation with
duplicates before/after first delivery and require identical closed-state and
projection hashes. Missing dependencies/proofs/artifacts remain pending and unacked.

Required golden/model cases:

1. derived-id, stamp order, actor-slot key and all exact/over-one cap vectors;
2. unknown root/key/shared type, nested flat-map violation, sparse/non-NFC/accessor
   JSON and hidden-write rejection before replica mutation;
3. node delete versus concurrent edge create;
4. node delete versus generation completion;
5. Plugin group versus concurrent source delete, with no orphan result;
6. concurrent reparent plus every three-node containment-cycle order;
7. generation begins, manual edits, owner success/failure, dismissal, recovery and
   tombstone under every relevant order;
8. same-actor double terminal/equivocation with no arrival winner;
9. causal placement with concurrent overlap and causal successor avoidance;
10. current versus retained resource proof, including missing retained blob pending;
11. Plugin schema mismatch pending, then identical state after exact artifact fetch;
12. semantic undo/redo with intervening remote frame and every durability/cursor
    crash point; raw UndoManager origins never touch authoritative docs;
13. React Flow drag/delete/undo/plugin-source-loss/reset of exact-incarnation caches;
14. at least 10,000 generated two-/three-peer schedules spanning delete, connect,
    geometry, data, containment, generation and creation-group operations;
15. one Project-created `cv_<64 lowercase hex>` id round-trips byte-identically
    through Project route, shared Canvas `DocumentScopeV2`, Canvas genesis identity,
    Peer inventory and shard-reset claim; raw `Id128V2`, uppercase hex, 63/65-digit
    suffixes, wrong `convax.document-scope/2` digest and `docKind`/`docId` mismatches
    reject in every owner validator;
16. two begins by one actor across authorization replacement produce distinct
    `BeginAuthorizationEpochCoreV2` digests; each accepts only the first-loss receipt
    containing its byte-identical `beginAuthorizationEpochDigest`, while a changed
    membership snapshot, replica authorization or protocol digest rejects;
17. every section-14 equation has exact-boundary and first-invalid fixtures,
    including all `(N,E)` boundary pairs and canonical evidence at 256 KiB and
    256 KiB plus one byte; every rejection occurs before candidate mutation;
18. independent generators hash this exact artifact byte stream to the artifact ref
    selected by the kernel bundle and emit the same Canvas declarations/validators
    without consulting repository implementation code; swapping owner artifact,
    ordinary whole-file or protocol-bundle digests in identity/evidence rejects.

The bundle is falsified by any arrival-dependent canonical hash, accepted unknown
field, lost actor claim, ghost renderer node, remote-cleared undo cursor, late
terminal priority, orphan creation-group result, raw UndoManager update or Desktop-
local duplicate Canvas reducer, cross-owner Canvas id mismatch, authorization-core
receipt replay or a kernel bundle that references different Canvas artifact bytes.

## 19. Revision-4 owner-closure replacement clauses

Sections 19.1 through 19.8 are the mechanically transplanted normative content of
the independently approved Canvas owner-closure proposal whose exact review SHA-256
is `32a3c8f888137e5a1b0695e3fa68390a27a26f3fbd401943b1f968ceae8fafe4`.
Within those clauses, an unqualified reference to `section N` or `section N.M`
means section `19.N` or `19.N.M` of this artifact. References to the kernel,
Project/control artifacts or pre-existing base sections remain external as named.
These clauses replace, rather than supplement, every removed revision-3 receipt,
history-template, canonicalizer and undefined-digest rule.

### 19.1 Closure boundary

The resulting Canvas owner MUST provide one generated module containing all of:

1. the exact Y.Doc validator;
2. the CanvasCanonicalStateV2 extractor and restricted-JCS encoder;
3. the Canvas constructor for the kernel-owned OwnerCanonicalizerDescriptorV2 and
   its digest binding;
4. the complete CanvasDigestRecipeTableV2;
5. the pure typed-intent reducer and actual-write derivation;
6. the semantic-history capture and materialization total functions.

Those outputs MUST be generated from the signed Canvas artifact. Hand-written
copies, renderer projections, Yjs internal encodings, object-enumeration order and
repository implementation code are not protocol inputs.

The generic collaboration kernel owns OwnerCanonicalizerDescriptorV2, its only
digest domain and the descriptor-bearing DocumentOwnerProtocolPortV2. The Canvas
artifact MUST instantiate that kernel type rather than define a Canvas-private
descriptor. The Canvas port values MUST be constructed exactly as follows:

~~~ts
const canonicalizerDescriptor =
  canvasOwnerCanonicalizerDescriptorV2(selectedCanvasArtifactDigest)
const canonicalizerDigest = Digest(
  "convax.owner-canonicalizer-descriptor/2",
  canonicalizerDescriptor,
)

const canvasOwnerPort: DocumentOwnerProtocolPortV2 = {
  owner: "canvas",
  schemaDigest: selectedCanvasArtifactDigest,
  canonicalizerDescriptor,
  canonicalizerDigest,
  canonicalStateBytes: encodeCanvasCanonicalStateV2,
}
~~~

The kernel MUST verify descriptor owner/schema/digest equality and compare the port
values, Canvas genesis identity, causal-frame core, checkpoint carrier and selected
protocol artifact before accepting any update. The named root, eleven child maps,
map encodings and stored-fact projection rules remain closed Canvas artifact clauses
in section 2.1. They are bound by selectedCanvasArtifactDigest and MUST NOT be copied
into a second descriptor or digest authority.

### 19.2 Exact canonical state

#### 19.2.1 Canonical collection codecs

~~~ts
type CanvasCanonicalMapEntriesV2<K extends string, V> =
  readonly (readonly [K, V])[]

type CanvasActorSlotEntriesV2<V> =
  readonly (readonly [ActorIdV2, V])[]

interface CanvasCanonicalMetaV2 {
  title: CanvasActorSlotEntriesV2<StampedClaimV2<string | null>>
  description: CanvasActorSlotEntriesV2<StampedClaimV2<string | null>>
  tags: CanvasActorSlotEntriesV2<StampedClaimV2<readonly string[]>>
}

interface CanvasCanonicalNodeRecordV2 {
  identity: CanvasNodeIdentityV2
  position: CanvasActorSlotEntriesV2<StampedClaimV2<CanvasPointV2>>
  size: CanvasActorSlotEntriesV2<StampedClaimV2<CanvasSizeV2>>
  data: CanvasActorSlotEntriesV2<StampedClaimV2<NodeDataEnvelopeV2>>
  plugin: CanvasActorSlotEntriesV2<
    StampedClaimV2<PluginStateEnvelopeV2 | null>
  >
  tombstones: CanvasActorSlotEntriesV2<TombstoneFactV2>
  creationGroup: CreationGroupRefV2 | null
}

interface CanvasCanonicalEdgeRecordV2 {
  identity: CanvasEdgeIdentityV2
  data: CanvasActorSlotEntriesV2<StampedClaimV2<CanvasEdgeDataV2>>
  tombstones: CanvasActorSlotEntriesV2<TombstoneFactV2>
  creationGroup: CreationGroupRefV2 | null
}

type CanvasCanonicalSemanticHistoryValueV2 =
  | SemanticHistoryRootV2
  | SemanticHistoryTransitionV2

interface CanvasCanonicalStateV2 {
  format: "convax.canvas-canonical-state/2"
  identity: CanvasIdentityV2
  meta: CanvasCanonicalMetaV2
  nodes: CanvasCanonicalMapEntriesV2<string, CanvasCanonicalNodeRecordV2>
  edges: CanvasCanonicalMapEntriesV2<string, CanvasCanonicalEdgeRecordV2>
  containments: CanvasCanonicalMapEntriesV2<string, ContainmentChoiceV2>
  generationBegins: CanvasCanonicalMapEntriesV2<string, GenerationBeginV2>
  generationTerminals:
    CanvasCanonicalMapEntriesV2<string, OwnerGenerationTerminalV2>
  generationDismissals:
    CanvasCanonicalMapEntriesV2<string, GenerationDismissalV2>
  generationRecoveryFailures:
    CanvasCanonicalMapEntriesV2<string, GenerationRecoveryFailureV2>
  semanticHistory:
    CanvasCanonicalMapEntriesV2<string, CanvasCanonicalSemanticHistoryValueV2>
  operations:
    CanvasCanonicalMapEntriesV2<string, BoundedOperationReceiptV2>
}
~~~

CanvasCanonicalStateV2 represents the one named Yjs root and all eleven mandatory
child maps. The encoder applies these rules exactly:

1. Validate the complete Y.Doc before extracting any value. An unknown named root,
   unknown key, missing key, wrong shared type, noncanonical JSON value, invalid
   embedded key or invalid cross-record relation rejects.
2. The identity map is read by its exact declared keys into CanvasIdentityV2. It is
   never serialized by Y.Map iteration.
3. The meta map is read by the exact field names title, description and tags. Every
   field is a mandatory actor-slot Y.Map.
4. Every ordinary Y.Map is encoded as an entry array sorted by raw UTF-8 key bytes.
   Keys are unique because they came from a validated Y.Map.
5. Every actor-slot Y.Map is encoded as an entry array sorted by decoded 32-byte
   ActorIdV2. The key MUST equal the embedded stamp actor. Tombstone keys MUST equal
   both the embedded stamp actor and the tombstone entity record owner.
6. Empty maps encode as empty arrays. JSON null encodes as JSON null. A missing
   mandatory map, key or value rejects; it never canonicalizes to null or an empty
   array.
7. All stored facts are included, including losing actor claims, tombstones,
   suppressed generation outputs, losing containment claims, semantic-history
   transitions and operation receipts. Effective projection, React Flow state and
   Project visibility facts are excluded.
8. Yjs client ids, clocks, structs, delete sets, update bytes and insertion order are
   excluded.
9. Values are revalidated as exact closed Canvas DTOs and serialized using the
   collaboration-v2 restricted RFC 8785 rules. Negative zero becomes zero.

The exact owner bytes are:

~~~text
UTF8(JCS(CanvasCanonicalStateV2))
~~~

They contain no BOM, prefix, suffix, whitespace or final LF. The kernel computes the
outer state digest exactly as already specified:

~~~text
SHA-256(
  UTF8("convax.canonical-state/2") || 0x00 ||
  decoded(ownerSchemaDigest) || 0x00 ||
  UTF8(JCS(CanvasCanonicalStateV2))
)
~~~

#### 19.2.2 Canonicalizer identity and genesis binding

The Canvas identity is replaced by:

~~~ts
interface CanvasIdentityV2 {
  format: "convax.canvas.v2"
  scopeId: CanvasScopeIdV2
  canvasId: CanvasIdV2
  ownerSchemaDigest: DigestV2
  protocolDigest: DigestV2
  canonicalizerDigest: DigestV2
  genesisDigest: DigestV2
}

interface CanvasGenesisCoreV2 {
  format: "convax.canvas-genesis-core/2"
  scopeId: CanvasScopeIdV2
  canvasId: CanvasIdV2
  ownerSchemaDigest: DigestV2
  protocolDigest: DigestV2
  canonicalizerDigest: DigestV2
}
~~~

Genesis digest excludes only genesisDigest itself and is:

~~~text
Digest("convax.canvas-genesis-core/2", CanvasGenesisCoreV2)
~~~

The Canvas artifact defines only this constructor for the kernel-owned exact shape:

~~~ts
function canvasOwnerCanonicalizerDescriptorV2(
  schemaDigest: DigestV2,
): OwnerCanonicalizerDescriptorV2 {
  return {
    format: "convax.owner-canonicalizer-descriptor/2",
    owner: "canvas",
    ownerSchemaDigest: schemaDigest,
    canonicalStateFormat: "convax.canvas-canonical-state/2",
    canonicalStateCodec: "restricted-jcs-utf8",
    exactBytePolicy: "parse-reencode-byte-equal",
    unknownStatePolicy: "reject",
  }
}
~~~

The selected artifact digest is supplied only after artifact computation. The
artifact MUST NOT embed its own whole-file digest. The only canonicalizer digest is:

~~~text
Digest(
  "convax.owner-canonicalizer-descriptor/2",
  canvasOwnerCanonicalizerDescriptorV2(selectedCanvasArtifactDigest)
)
~~~

`convax.canvas-canonicalizer/2` is deleted and MUST NOT occur in the protocol domain
registry. canonicalizerDigest is not ownerSchemaDigest, a whole-file SHA, generated
code hash or function-source hash. ownerSchemaDigest binds the complete Canvas root,
map and projection algorithm; canonicalizerDigest binds the kernel-owned outer
canonical-state format/codec and fail-closed byte policy. Both are required and
their descriptor/port equality is verified before owner decoding or Yjs apply.

### 19.3 Complete Canvas digest ledger

#### 19.3.1 Common digest function and collection rules

For every structured recipe below:

~~~text
Digest(domain, value) =
  SHA-256(UTF8(domain) || 0x00 || JCS(exact closed value))
~~~

Digest fields and signature fields are excluded from their own preimage only where
the ledger explicitly says so. No other field is implicitly omitted. In particular,
the proposal removes the receipt-to-evidence back-reference instead of specifying a
fixed-point hash or an implementation-dependent two-pass placeholder.

Entity refs sort by UTF-8 bytes of their exact entity key. Resource refs sort by
decoded contentDigest, then URI UTF-8 bytes, then JCS bytes of the complete ref.
History handles sort by ASCII bytes. Generation ids, flat keys and operation keys
sort by UTF-8 bytes. Actor-slot entries sort by decoded actor id. Every array named
as a set below is strict, sorted and duplicate-free. Empty sets are empty arrays.

Nullable digest fields use one of two rules:

- **nullable-result**: null is the complete result when the semantic value is absent;
  no digest of null is computed.
- **present-null**: null is a legal value inside the exact preimage and is hashed.

Absent object members are never accepted. This distinction prevents null, empty and
absent from sharing a preimage.

#### 19.3.2 Exact recipe inputs

The following closed DTOs are digest preimages:

~~~ts
interface CanvasCreationGroupMemberSetCoreV2 {
  format: "convax.canvas-creation-group-member-set/2"
  groupId: string
  source: CanvasEntityRefV2 & { kind: "node" }
  members: readonly CanvasEntityRefV2[]
}

interface CanvasEffectiveDataCoreV2 {
  format: "convax.canvas-effective-data/2"
  data: NodeDataEnvelopeV2
}

interface CanvasDataRegisterCoreV2 {
  format: "convax.canvas-data-register/2"
  node: CanvasEntityRefV2 & { kind: "node" }
  actorSlots: CanvasActorSlotEntriesV2<StampedClaimV2<NodeDataEnvelopeV2>>
}

interface CanvasEffectivePluginCoreV2 {
  format: "convax.canvas-effective-plugin/2"
  plugin: PluginStateEnvelopeV2
}

interface CanvasGenerationLifecycleCoreV2 {
  format: "convax.canvas-generation-lifecycle/2"
  begin: GenerationBeginV2
  terminal: OwnerGenerationTerminalV2 | null
  dismissal: GenerationDismissalV2 | null
  recoveryFailure: GenerationRecoveryFailureV2 | null
}

interface CanvasObstacleProjectionCoreV2 {
  format: "convax.canvas-obstacle-projection/2"
  obstacles: readonly {
    node: CanvasEntityRefV2 & { kind: "node" }
    position: CanvasPointV2
    size: CanvasSizeV2
  }[]
}

interface CanvasGeometryCoreV2 {
  format: "convax.canvas-geometry/2"
  node: CanvasEntityRefV2 & { kind: "node" }
  position: CanvasPointV2
  size: CanvasSizeV2
}

interface CanvasContainmentSlotCoreV2 {
  format: "convax.canvas-containment-slot/2"
  choice: ContainmentChoiceV2
}

type CanvasMetadataEffectiveCoreV2 =
  | {
      format: "convax.canvas-metadata-effective/2"
      field: "title" | "description"
      value: string | null
    }
  | {
      format: "convax.canvas-metadata-effective/2"
      field: "tags"
      value: readonly string[]
    }

type CanvasMetadataSlotCoreV2 =
  | {
      format: "convax.canvas-metadata-slot/2"
      field: "title" | "description"
      claim: StampedClaimV2<string | null>
    }
  | {
      format: "convax.canvas-metadata-slot/2"
      field: "tags"
      claim: StampedClaimV2<readonly string[]>
    }

interface CanvasProjectedGenerationCoreV2 {
  format: "convax.canvas-projected-generation/2"
  node: CanvasEntityRefV2 & { kind: "node" }
  lifecycles: readonly CanvasGenerationLifecycleCoreV2[]
}

interface CanvasGroupGeometryPlanCoreV2 {
  format: "convax.canvas-group-geometry-plan/2"
  children: readonly CanvasGeometryCoreV2[]
  groupPosition: CanvasPointV2
  groupSize: CanvasSizeV2
}

interface CanvasEffectiveChildSetCoreV2 {
  format: "convax.canvas-effective-child-set/2"
  group: CanvasEntityRefV2 & { kind: "node" }
  children: readonly (CanvasEntityRefV2 & { kind: "node" })[]
}

interface CanvasHistoryMaterialCoreV2 {
  format: "convax.canvas-history-material/2"
  rootOperationId: CanvasOperationIdV2
  sourceIntentKind: CanvasUndoableIntentKindV2
  sourceIntentDigest: DigestV2
  initialBindings: readonly CanvasHistoryBindingV2[]
  inverseTemplate: readonly CanvasHistoryTemplateV2[]
  forwardTemplate: readonly CanvasHistoryTemplateV2[]
  retainedResources: readonly CanvasResourceRefV2[]
}

interface CanvasSemanticHistoryStateCoreV2 {
  format: "convax.canvas-semantic-history-state/2"
  rootReceiptDigest: DigestV2
  historyRootDigest: DigestV2
  transitions: readonly SemanticHistoryTransitionV2[]
  effectiveTransitionOperationId: CanvasOperationIdV2 | null
  effectiveMode: "applied" | "undone"
  effectiveBindings: readonly CanvasHistoryBindingV2[]
}

interface CanvasSemanticGuardCoreV2 {
  format: "convax.canvas-semantic-guard/2"
  rootOperationId: CanvasOperationIdV2
  direction: "inverse" | "forward"
  operationIndex: Uint32V2
  template: CanvasHistoryTemplateV2
  materializedGuard: CanvasMaterializedHistoryGuardV2 | null
}

interface CanvasHistoryMaterializationCoreV2 {
  format: "convax.canvas-history-materialization/2"
  rootOperationId: CanvasOperationIdV2
  direction: "inverse" | "forward"
  priorHistoryStateDigest: DigestV2
  operations: readonly CanvasSemanticOperationV2[]
  resultBindings: readonly CanvasHistoryBindingV2[]
}

interface CanvasHistoryFootprintCoreV2 {
  format: "convax.canvas-history-footprint/2"
  rootOperationId: CanvasOperationIdV2
  mode: "applied" | "undone"
  entities: readonly CanvasHistoryEntityFootprintV2[]
  metadata: readonly CanvasMetadataEffectiveCoreV2[]
  containments: readonly {
    child: CanvasHistoryNodeTargetV2
    parent: CanvasHistoryNodeTargetV2 | null
  }[]
}

interface CanvasActualWriteValueCoreV2 {
  format: "convax.canvas-actual-write-value/2"
  path: string
  entityKind:
    | "canvas" | "node" | "edge" | "containment"
    | "generation" | "history" | "operation"
  entityId: string
  field: string
  value: CanvasStoredLogicalValueV2
}
~~~

CanvasHistoryFootprintCoreV2 uses these exact collection codecs; none may use
object, Y.Map, reducer-write or caller iteration order:

1. `entities` sorts by `(kindRank, handle ASCII bytes)`, where `node=0` and
   `edge=1`. Duplicate `(kind, handle)` keys reject even when the remaining value
   differs. A node footprint's `incidentLiveEdges` sorts by handle ASCII bytes and
   is strict duplicate-free. Empty `entities` and empty `incidentLiveEdges` are
   valid.
2. `metadata` sorts by the fixed field rank `title=0`, `description=1`, `tags=2`.
   A duplicate field rejects even when its value differs. Empty `metadata` is valid.
3. A containment child target has sort key `(modeRank, targetKey)`, where
   `handle=0` with handle ASCII bytes and `external=1` with the exact entity-key
   UTF-8 bytes. `containments` sorts by that child key. A duplicate child target
   rejects even when its parent differs; the parent is not a tie-breaker. Empty
   `containments` is valid.
4. A valid history footprint has at least one entry across `entities`, `metadata`
   and `containments`; three empty arrays reject. Required empty arrays remain
   present JSON arrays and are never omitted or encoded as null.

The operation receipt is replaced by the following acyclic form:

~~~ts
interface BoundedOperationReceiptV2 {
  format: "convax.canvas-operation-receipt/2"
  operationId: CanvasOperationIdV2
  actorId: ActorIdV2
  intentKind: CanvasIntentKindV2
  intentDigest: DigestV2
  baseFrontierDigest: DigestV2
  resultEntities: readonly CanvasEntityRefV2[]
  semanticRoot: boolean
  historyMaterialDigest: DigestV2 | null
}
~~~

The prior actualWriteEvidenceDigest field is removed. Keeping it would form an
unhashable cycle: evidence hashes the receipt write value, while the receipt would
contain the evidence digest. The causal frame remains the sole portable binding of
actualWriteEvidenceDigest. resultEntities remain entity-key sorted and duplicate-free.

#### 19.3.3 Normative recipe table

| Stored or guard field | Domain and exact preimage | Sort/null/self rule |
| --- | --- | --- |
| CanvasIdentityV2.genesisDigest | convax.canvas-genesis-core/2 over CanvasGenesisCoreV2 | Excludes only genesisDigest |
| CreationGroupRefV2.memberSetDigest | convax.canvas-creation-group-member-set/2 over CanvasCreationGroupMemberSetCoreV2 | members entity-key sorted, non-empty; excludes memberSetDigest-bearing refs |
| CreationGroupRefV2.sourceDataDigest, retained proof sourceDataDigest, GenerationBeginV2.targetEffectiveDataDigest, NodeDataGuardV2.expectedEffectiveDataDigest | convax.canvas-effective-data/2 over CanvasEffectiveDataCoreV2 | Hashes exact effective data value; no stamp |
| NodeDataGuardV2.expectedDataRegisterDigest | convax.canvas-data-register/2 over CanvasDataRegisterCoreV2 | Includes every stored ordinary data actor slot, including losing claims; empty permitted only where node schema permits |
| GenerationBeginV2.targetPluginDigest, PluginGuardV2.expectedPluginDigest, GenerationBeginGuardV2.expectedPluginDigest | convax.canvas-effective-plugin/2 over CanvasEffectivePluginCoreV2 | nullable-result: null iff effective Plugin value is null; otherwise hash exact envelope |
| NodeLiveGuardV2.expectedIdentityDigest | convax.canvas-node-identity/2 over exact CanvasNodeIdentityV2 | No omitted field |
| EdgeLiveGuardV2.expectedIdentityDigest | convax.canvas-edge-identity/2 over exact CanvasEdgeIdentityV2 | No omitted field |
| Every beginDigest | convax.canvas-generation-begin/2 over exact GenerationBeginV2 | No omitted field |
| expectedTerminalDigest | convax.canvas-generation-terminal/2 over exact OwnerGenerationTerminalV2 | nullable-result |
| expectedDismissalDigest | convax.canvas-generation-dismissal/2 over exact GenerationDismissalV2 | nullable-result |
| expectedRecoveryFailureDigest | convax.canvas-generation-recovery-failure/2 over exact GenerationRecoveryFailureV2 | nullable-result |
| expectedLifecycleDigest | convax.canvas-generation-lifecycle/2 over CanvasGenerationLifecycleCoreV2 | Missing terminal/dismissal/recovery encode as present JSON null |
| CausalPlacementV2.obstacleProjectionDigest | convax.canvas-obstacle-projection/2 over CanvasObstacleProjectionCoreV2 | obstacles node-key sorted; empty array is valid |
| GeometryGuardV2.expectedGeometryDigest | convax.canvas-geometry/2 over CanvasGeometryCoreV2 | Includes node ref, effective position and size |
| ContainmentGuardV2.expectedOwnSlotDigest | convax.canvas-containment-slot/2 over CanvasContainmentSlotCoreV2 | nullable-result: null iff this actor has no slot |
| MetadataFieldGuardV2.expectedEffectiveDigest | convax.canvas-metadata-effective/2 over CanvasMetadataEffectiveCoreV2 | present-null for nullable title/description |
| MetadataFieldGuardV2.expectedOwnSlotDigest | convax.canvas-metadata-slot/2 over CanvasMetadataSlotCoreV2 | nullable-result; a present claim whose value is null is hashed |
| GenerationBeginGuardV2.expectedProjectedGenerationDigest | convax.canvas-projected-generation/2 over CanvasProjectedGenerationCoreV2 | lifecycles sorted by generation id UTF-8; empty valid |
| group expectedGeometryPlanDigest | convax.canvas-group-geometry-plan/2 over CanvasGroupGeometryPlanCoreV2 | children node-key sorted, non-empty |
| ungroup expectedEffectiveChildSetDigest | convax.canvas-effective-child-set/2 over CanvasEffectiveChildSetCoreV2 | children node-key sorted, duplicate-free |
| BoundedOperationReceiptV2.historyMaterialDigest | Byte-equal to SemanticHistoryRootV2.materialDigest | null iff semanticRoot is false |
| SemanticHistoryRootV2.materialDigest | convax.canvas-history-material/2 over CanvasHistoryMaterialCoreV2 | Excludes materialDigest; all arrays follow section 6 order |
| expectedRootReceiptDigest | convax.canvas-operation-receipt/2 over exact acyclic BoundedOperationReceiptV2 | No evidence-digest back-reference |
| expectedHistoryRootDigest | convax.canvas-semantic-history-root/2 over exact SemanticHistoryRootV2 | Includes materialDigest |
| priorHistoryDigest, expectedHistoryStateDigest | convax.canvas-semantic-history-state/2 over CanvasSemanticHistoryStateCoreV2 | transitions operation-key sorted; excludes the digest being computed |
| CanvasSemanticOperationV2.guardDigest | convax.canvas-semantic-guard/2 over CanvasSemanticGuardCoreV2 | Excludes guardDigest; null guard is present JSON null |
| SemanticHistoryTransitionV2.materializationDigest | convax.canvas-history-materialization/2 over CanvasHistoryMaterializationCoreV2 | Excludes transition and its digest |
| SemanticHistoryTransitionV2.resultFootprintDigest | convax.canvas-history-footprint/2 over CanvasHistoryFootprintCoreV2 | Exact resolved post-materialization footprint; all three arrays and nested incidentLiveEdges follow section 3.2 ranks, sorting, duplicate and empty rules |
| CanvasActualWriteV2.valueDigest | convax.canvas-actual-write-value/2 over CanvasActualWriteValueCoreV2 | Stored value is always present; JSON null uses tagged present-null value |

Every Canvas-owned domain in this table MUST be added to the sorted protocol domain
registry. There is no fallback rule that derives a domain from a TypeScript
interface name or format string.

#### 19.3.4 Imported and opaque digests

The following are not recomputed with a Canvas recipe:

- intentDigest, baseFrontierDigest, actualWriteEvidenceDigest, ownerSchemaDigest and
  protocolDigest are kernel-owned and MUST match the verified outer frame;
- canonicalizerDigest is the kernel-owned
  `convax.owner-canonicalizer-descriptor/2` digest of the exact descriptor instance
  from section 2.2. It is not a Canvas-owned recipe or Canvas registry delta;
- contentDigest is ordinary content SHA-256 from the Project/blob protocol;
- ownerProofDigest, outputProofDigest and recovery proofDigest are accepted only
  through the matching non-serializable Project fact permit;
- Plugin snapshotDigest, pluginStateSchemaDigest and validationArtifactDigest are
  accepted only through the exact Plugin artifact permit;
- beginAuthorizationEpochDigest is the control-owned
  convax.begin-authorization-epoch-core/2 digest;
- toolRefDigest is accepted only through the generation-begin permit and is never
  invented or normalized by Canvas.

If the external owner cannot identify the exact recipe and selected artifact for an
opaque digest, validation is pending or rejected. Canvas MUST NOT guess.

#### 19.3.5 Exact domain-registry delta and cardinality

Relative to the inspected 89-domain bundle, the Canvas closure adds exactly these
28 strict UTF-8-sorted, duplicate-free domains:

~~~text
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
~~~

Canvas retires no baseline domain because its former private canonicalizer domain
was never in the 89-domain bundle and is now forbidden rather than added. Merging
this exact delta with the independently reviewed Owner/Project delta of seven adds
(including `convax.owner-canonicalizer-descriptor/2`) and one retirement
(`convax.project-index-canonical-state/2`) produces exactly:

~~~text
89 + 28 + 7 - 1 = 123 domains
~~~

The final registry MUST be the strict sorted set union and MUST have cardinality
123. Presence of `convax.canvas-canonicalizer/2`, absence of any listed domain, a
duplicate, a different count or treating a canonical-state format as a digest domain
rejects bundle regeneration.

### 19.4 Actual-write evidence closure

CanvasStoredLogicalValueV2 is the closed union of exact values permitted at the path
families below. It is represented as:

~~~ts
type CanvasStoredLogicalValueV2 =
  | { presence: "present-null"; value: null }
  | {
      presence: "present-value"
      value:
        | StampedClaimV2<string | null>
        | StampedClaimV2<readonly string[]>
        | StampedClaimV2<CanvasPointV2>
        | StampedClaimV2<CanvasSizeV2>
        | StampedClaimV2<NodeDataEnvelopeV2>
        | StampedClaimV2<PluginStateEnvelopeV2 | null>
        | StampedClaimV2<CanvasEdgeDataV2>
        | CanvasNodeIdentityV2
        | CanvasEdgeIdentityV2
        | TombstoneFactV2
        | CreationGroupRefV2
        | ContainmentChoiceV2
        | GenerationBeginV2
        | OwnerGenerationTerminalV2
        | GenerationDismissalV2
        | GenerationRecoveryFailureV2
        | SemanticHistoryRootV2
        | SemanticHistoryTransitionV2
        | BoundedOperationReceiptV2
    }
~~~

The path validator selects exactly one specialization from this union. The union
does not authorize using a metadata claim at a geometry path or any other
cross-family substitution.

The path-to-write mapping is exact:

| changed path | entityKind | entityId | field | exact stored value |
| --- | --- | --- | --- | --- |
| meta/F/actor/A | canvas | CanvasIdentityV2.canvasId | meta/F/actor/A | typed metadata StampedClaim |
| nodes/K/identity | node | K | identity | CanvasNodeIdentityV2 |
| nodes/K/position/actor/A | node | K | position/actor/A | point StampedClaim |
| nodes/K/size/actor/A | node | K | size/actor/A | size StampedClaim |
| nodes/K/data/actor/A | node | K | data/actor/A | node-data StampedClaim |
| nodes/K/plugin/actor/A | node | K | plugin/actor/A | Plugin-or-null StampedClaim |
| nodes/K/tombstones/A | node | K | tombstones/A | TombstoneFactV2 |
| nodes/K/creationGroup | node | K | creationGroup | CreationGroupRefV2 or tagged present-null |
| edges/K/identity | edge | K | identity | CanvasEdgeIdentityV2 |
| edges/K/data/actor/A | edge | K | data/actor/A | edge-data StampedClaim |
| edges/K/tombstones/A | edge | K | tombstones/A | TombstoneFactV2 |
| edges/K/creationGroup | edge | K | creationGroup | CreationGroupRefV2 or tagged present-null |
| containments/K | containment | K | choice | ContainmentChoiceV2 |
| generationBegins/G | generation | G | begin | GenerationBeginV2 |
| generationTerminals/G/owner/A | generation | G | terminal/owner/A | OwnerGenerationTerminalV2 |
| generationDismissals/G | generation | G | dismissal | GenerationDismissalV2 |
| generationRecoveryFailures/G | generation | G | recoveryFailure | GenerationRecoveryFailureV2 |
| semanticHistory/root/O | history | O | root | SemanticHistoryRootV2 |
| semanticHistory/transition/O/actor/A/operation/T | history | O | transition/actor/A/operation/T | SemanticHistoryTransitionV2 |
| operations/operation/A/O | operation | operation/A/O | receipt | BoundedOperationReceiptV2 |

F, A, K, G, O and T are validated exact field/id/key codecs, not string wildcards.

For each reducer logical write there is exactly one changed path and one write tuple.
The two arrays are independently sorted: changedPaths by UTF-8 path bytes; writes by
entityKind ASCII, entityId UTF-8, field UTF-8. Both are duplicate-free and form a
bijection through the table. valueDigest hashes the exact post-write logical value
and the complete derived path/write tuple. An absent post-write path rejects.
Creator-owned empty nested Y.Maps remain schema construction and produce no value
entry; explicit creationGroup null is a present logical write and is hashed.

### 19.5 History identity, templates and transitions

#### 19.5.1 Stable history handles

~~~ts
type CanvasHistoryNodeHandleV2 = string // exact n/<canonical Uint32V2>
type CanvasHistoryEdgeHandleV2 = string // exact e/<canonical Uint32V2>
type CanvasHistoryCreationGroupHandleV2 = string // exact g/<canonical Uint32V2>
type CanvasHistoryHandleV2 =
  | CanvasHistoryNodeHandleV2
  | CanvasHistoryEdgeHandleV2

interface CanvasHistoryBindingV2 {
  handle: CanvasHistoryHandleV2
  ref: CanvasEntityRefV2 | null
}

type CanvasHistoryNodeTargetV2 =
  | { mode: "handle"; handle: CanvasHistoryNodeHandleV2 }
  | { mode: "external"; ref: CanvasEntityRefV2 & { kind: "node" } }

interface CanvasHistoryNodeSnapshotV2 {
  role: "file" | "agent"
  position: CanvasPointV2
  size: CanvasSizeV2
  data: NodeDataEnvelopeV2
  plugin: PluginStateEnvelopeV2 | null
  resource: CanvasResourceRefV2 | null
}

interface CanvasHistoryEdgeSnapshotV2 {
  source: CanvasHistoryNodeTargetV2
  target: CanvasHistoryNodeTargetV2
  data: CanvasEdgeDataV2
}

type CanvasHistoryEntityFootprintV2 =
  | {
      kind: "node"
      handle: CanvasHistoryNodeHandleV2
      ref: (CanvasEntityRefV2 & { kind: "node" }) | null
      snapshot: CanvasHistoryNodeSnapshotV2 | null
      effectiveParent: CanvasHistoryNodeTargetV2 | null
      incidentLiveEdges: readonly CanvasHistoryEdgeHandleV2[]
    }
  | {
      kind: "edge"
      handle: CanvasHistoryEdgeHandleV2
      ref: (CanvasEntityRefV2 & { kind: "edge" }) | null
      snapshot: CanvasHistoryEdgeSnapshotV2 | null
    }
~~~

For one root, affected node refs sort by entity key and receive n/0 through n/N-1.
Affected edge refs sort independently and receive e/0 through e/E-1.
initialBindings contains every handle exactly once in handle ASCII order. A null
binding means the logical entity is absent in that history phase.

Capture partitions affected Plugin-owned members by byte-identical original
CreationGroupRefV2. A repeated groupId with a non-byte-identical complete ref
rejects. The unique groups sort strictly by original groupId UTF-8 bytes and receive
g/0 through g/G-1. A CanvasHistoryCreationGroupHandleV2 is history-local scheduling
identity only: it is never a Canvas entity ref, binding, persisted CreationGroupRefV2
groupId or input to ordinary Canvas id allocation.

External targets are causal dependencies not owned by this history root. They are
never rebound. Their exact incarnation must remain effective-live when materialized.
For a null binding, snapshot and ref are both null. For a live binding, both are
non-null. incidentLiveEdges contains every live edge in the root footprint touching
that node; an additional current live incident edge makes a destructive inverse
conflict. A history node snapshot has resource byte-equal to data.resource when
data.kind is resource and null for every other data kind.

#### 19.5.2 History-only templates

History templates are replaced by this union; they do not reuse ordinary create
intent types and contain no node id, edge id, incarnation, relation id or group id:

~~~ts
type CanvasHistoryTemplateV2 =
  | {
      op: "node.create"
      handle: CanvasHistoryNodeHandleV2
      snapshot: CanvasHistoryNodeSnapshotV2
    }
  | {
      op: "node.tombstone"
      handle: CanvasHistoryNodeHandleV2
    }
  | {
      op: "node.geometry"
      handle: CanvasHistoryNodeHandleV2
      position: CanvasPointV2
      size: CanvasSizeV2
    }
  | {
      op: "node.data"
      handle: CanvasHistoryNodeHandleV2
      data: NodeDataEnvelopeV2
      resource: CanvasResourceRefV2 | null
    }
  | {
      op: "node.plugin"
      handle: CanvasHistoryNodeHandleV2
      plugin: PluginStateEnvelopeV2 | null
    }
  | {
      op: "edge.create"
      handle: CanvasHistoryEdgeHandleV2
      snapshot: CanvasHistoryEdgeSnapshotV2
    }
  | {
      op: "edge.tombstone"
      handle: CanvasHistoryEdgeHandleV2
    }
  | {
      op: "containment.set"
      child: CanvasHistoryNodeTargetV2
      parent: CanvasHistoryNodeTargetV2 | null
    }
  | {
      op: "metadata.set"
      field: "title" | "description" | "tags"
      value: string | readonly string[] | null
    }
  | {
      op: "creation-group.restore"
      groupHandle: CanvasHistoryCreationGroupHandleV2
      source: CanvasHistoryNodeTargetV2
      sourceDataDigest: DigestV2
      plugin: PluginRequirementV2
      nodes: readonly {
        handle: CanvasHistoryNodeHandleV2
        snapshot: CanvasHistoryNodeSnapshotV2
      }[]
      edges: readonly {
        handle: CanvasHistoryEdgeHandleV2
        snapshot: CanvasHistoryEdgeSnapshotV2
      }[]
    }
  | {
      op: "pending-generation.restore"
      node: CanvasHistoryNodeHandleV2
      edges: readonly {
        handle: CanvasHistoryEdgeHandleV2
        snapshot: CanvasHistoryEdgeSnapshotV2
      }[]
      generationId: string
      fallbackTitle: string
      expectedClass: "text" | "image" | "video" | "audio" | "file"
      position: CanvasPointV2
      size: CanvasSizeV2
    }
~~~

Within each direction, template arrays use this exact operation rank, then primary
handle/field UTF-8 bytes:

~~~text
node.create=10
creation-group.restore=11
pending-generation.restore=12
edge.create=20
node.geometry=30
node.data=31
node.plugin=32
containment.set=40
edge.tombstone=50
node.tombstone=60
metadata.set=70
~~~

Composite node and edge arrays sort by handle. Equal sort keys reject. This ordering
is a set canonicalization rule; reducers MUST NOT treat delivery or caller order as
semantic.

The rank list is the outer schedule. Rank 10 ordinary node.create templates sort by
node handle and run before rank 11. A node that belonged to an original creation
group MUST NOT also receive an ordinary node.create template. Rank 11
creation-group.restore templates use groupHandle as their primary key and are
ordered by the deterministic source-dependency scheduler below, not by caller or
array order. All remaining ranks resume after every rank 11 template completes.

For one selected direction, construct producerByNodeHandle from node.create,
pending-generation.restore.node and every creation-group.restore.nodes member;
construct producerByEdgeHandle from edge.create,
pending-generation.restore.edges and every creation-group.restore.edges member. A
node or edge handle has at most one producer across the complete direction. A
duplicate producer, duplicate groupHandle, duplicate member inside a group, or group
result also emitted by another creating template rejects before ordinal allocation.

After rank 10 has populated the transition-local bindings, construct one directed
graph whose vertices are creation-group.restore groupHandles. For a handle source
whose binding is null, its producer MUST exist. An ordinary node.create producer is
already ready. A creation-group producer adds an edge from that producer group to
the consumer group. Any other not-yet-run producer is invalid for rank 11. A non-null
handle binding and a valid external source add no edge. A missing/late producer,
self-edge or directed cycle rejects before ordinal allocation and leaves every
candidate and binding unchanged.

Run Kahn topological scheduling. At each step, the ready set contains exactly the
unprocessed groups whose source binding is already non-null or whose source-producing
predecessors have all completed. Select the minimum groupHandle by raw UTF-8 bytes;
the handles are ASCII, so this is also ASCII order. Remove it and repeat. If
unprocessed vertices remain with an empty ready set, reject as a dependency cycle.
This schedule depends only on stored handles and producer relations, never on newly
derived ids, Yjs order, arrival order or implementation traversal.

For `creation-group.restore`, CaptureHistoryRootV2 encodes `source` as a handle
target exactly when that source node is also an affected node of the same history
root; otherwise it encodes the original exact source incarnation as an external
target. A handle source MUST have one node snapshot and one initial binding in the
same root. Its producer may be an earlier ordinary node.create or an earlier
creation-group.restore in the dependency schedule. External sources are never
rebound. After either target form becomes ready, and before installing this group's
results, the materializer resolves the exact source ref from the provisional state
and recomputes its identity, effective-data and complete data-register guard. The
effective-data digest MUST equal sourceDataDigest. It then derives the new exact
CreationGroupRefV2 and installs every group result with that ref; it never creates a
group-owned source early as an ordinary node merely to satisfy another group. An
unresolved handle, absent external source, changed source data, invalid Plugin
permit or guard mismatch rejects the whole transition; no result is restored as an
orphan.

#### 19.5.3 Materialized operation closure

~~~ts
interface CanvasHistoryGenerationGuardV2 {
  rootOperationId: CanvasOperationIdV2
  nodeHandle: CanvasHistoryNodeHandleV2
  generationId: string
  retainedBeginDigest: DigestV2
  expectedLifecycleDigest: DigestV2
  expectedTerminalDigest: DigestV2 | null
  expectedDismissalDigest: DigestV2 | null
  expectedRecoveryFailureDigest: DigestV2 | null
}

type CanvasMaterializedHistoryGuardV2 =
  | { op: "node.create"; guard: null }
  | { op: "node.tombstone"; guard: NodeLiveGuardV2 }
  | { op: "node.geometry"; guard: GeometryGuardV2 }
  | { op: "node.data"; guard: NodeDataGuardV2 }
  | { op: "node.plugin"; guard: PluginGuardV2 }
  | {
      op: "edge.create"
      guard: {
        edge: DerivedEdgeAbsentGuardV2
        source: ConnectableNodeGuardV2
        target: ConnectableNodeGuardV2
      }
    }
  | { op: "edge.tombstone"; guard: EdgeLiveGuardV2 }
  | {
      op: "containment.set"
      guard: {
        child: ContainmentGuardV2
        parent: NodeLiveGuardV2 | null
      }
    }
  | { op: "metadata.set"; guard: MetadataFieldGuardV2 }
  | {
      op: "creation-group.restore"
      guard: {
        source: NodeDataGuardV2
        pluginRequirement: PluginRequirementV2
        derivedNodes: readonly DerivedNodeAbsentGuardV2[]
        derivedEdges: readonly DerivedEdgeAbsentGuardV2[]
      }
    }
  | {
      op: "pending-generation.restore"
      guard: {
        lifecycle: CanvasHistoryGenerationGuardV2
        derivedNode: DerivedNodeAbsentGuardV2
        derivedEdges: readonly DerivedEdgeAbsentGuardV2[]
      }
    }

type CanvasHistoryDerivedObjectV2 =
  | {
      kind: "node"
      handle: CanvasHistoryNodeHandleV2
      ordinal: Uint32V2
      ref: CanvasEntityRefV2 & { kind: "node" }
    }
  | {
      kind: "edge"
      handle: CanvasHistoryEdgeHandleV2
      ordinal: Uint32V2
      ref: CanvasEntityRefV2 & { kind: "edge" }
    }
  | {
      kind: "relation"
      ordinal: Uint32V2
      relationId: string
      child: CanvasHistoryNodeTargetV2
    }
  | {
      kind: "creation-group"
      handle: CanvasHistoryCreationGroupHandleV2
      ordinal: Uint32V2
      groupId: string
    }

interface CanvasSemanticOperationV2 {
  format: "convax.canvas-semantic-operation/2"
  template: CanvasHistoryTemplateV2
  materializedGuard: CanvasMaterializedHistoryGuardV2
  derived: readonly CanvasHistoryDerivedObjectV2[]
  guardDigest: DigestV2
  retainedResourceProofs: readonly Extract<
    CanvasResourceProofRefV2,
    { mode: "retained-canvas-history" }
  >[]
}
~~~

CanvasHistoryGenerationGuardV2 is history-only and MUST NOT extend or contain
NodeLiveGuardV2, GenerationGuardV2, GenerationObservedGuardV2, a current node ref,
`expectedLive` or `expectedIdentityDigest`. Capture binds retainedBeginDigest to the
exact GenerationBeginV2 whose node is the initial non-null ref for nodeHandle in the
same root. Materialization re-resolves that retained begin and the complete current
terminal/dismissal/recovery tuple from stored generation facts, verifies the
generation id and root handle binding, and recomputes every lifecycle digest in this
guard without requiring the tombstoned original node to be live. Active or dismissed
lifecycle returns history-redo-unavailable before any derived allocation; succeeded,
failed and recovery-failure lifecycle may materialize the closed retained/manual
result described by section 6.3. A concurrent lifecycle change after guard creation
rejects the candidate. Redo never restarts external work.

materializedGuard.op MUST equal template.op. derived is sorted by decoded ordinal,
unique and contains exactly the objects allocated by that template. Proofs sort by
their embedded resource ordering and contain exactly one proof for every distinct
resource introduced by the operation. An operation that introduces no resource has
an empty array. This replaces the prior single retainedResourceProof field, which
cannot represent a multi-resource group restore.

A creation-group.restore operation contains exactly one derived creation-group
object whose handle equals template.groupHandle. Its derived group ordinal precedes
all of its derived node/edge ordinals. No other operation in the transition may
carry that group handle or produce any of its node/edge handles.

#### 19.5.4 Root and transition replacement

~~~ts
interface SemanticHistoryRootV2 {
  format: "convax.canvas-semantic-history-root/2"
  rootOperationId: CanvasOperationIdV2
  sourceIntentKind: CanvasUndoableIntentKindV2
  sourceIntentDigest: DigestV2
  initialBindings: readonly CanvasHistoryBindingV2[]
  inverseTemplate: readonly CanvasHistoryTemplateV2[]
  forwardTemplate: readonly CanvasHistoryTemplateV2[]
  retainedResources: readonly CanvasResourceRefV2[]
  materialDigest: DigestV2
}

interface SemanticHistoryTransitionV2 {
  format: "convax.canvas-semantic-history-transition/2"
  rootOperationId: CanvasOperationIdV2
  mode: "undone" | "redone"
  priorHistoryDigest: DigestV2
  transitionOperationId: CanvasOperationIdV2
  stamp: PortableStampV2
  materializationDigest: DigestV2
  resultFootprintDigest: DigestV2
  resultBindings: readonly CanvasHistoryBindingV2[]
}
~~~

The effective transition is the maximum by PortableStampV2 and then transition key
UTF-8 bytes. Without a transition, mode is applied and bindings are initialBindings.
With a transition, effective mode is undone for mode undone and applied for mode
redone; effective bindings are that transition's resultBindings.

An entity created by a semantic undo/redo operation is effective-live only if:

1. its createdBy receipt identifies one semantic transition;
2. that transition is the effective transition of its root; and
3. its exact ref is the non-null effective binding for its handle.

This rule hides losing concurrent redo/undo creations without deleting their causal
facts. It also makes a second undo after redo target the recreated identity rather
than the original tombstoned identity.

### 19.6 Total semantic-history algorithms

#### 19.6.1 CaptureHistoryRootV2

The total function input is the validated authored base, exact root intent, committed
post state and pure reducer result. It performs:

1. Reject non-undoable intent kinds.
2. Compute affected entity handles from the exact table below.
3. Capture only closed effective semantic values from authored base and committed
   post; never capture React state, current guards, actor identity or Yjs structs.
4. Partition affected creation-group members, validate one byte-identical ref per
   original groupId and assign groupHandles by section 5.1. Build inverse and
   forward templates from the table. A group-owned node appears only inside its
   creation-group.restore producer, never in an ordinary node.create template.
5. Build producerByNodeHandle and producerByEdgeHandle, reject duplicate producers,
   missing/late handle-source producers and cycles, compute the exact rank-plus-
   topological schedule in section 5.2 and assign initialBindings. The same stored
   handles and dependency graph MUST produce the same schedule in every later
   materialization direction that contains those restore templates.
6. Collect every resource introduced by either direction, sort by the resource rule
   and deduplicate by complete JCS equality. A contentDigest collision with unequal
   complete resource refs rejects.
7. Compute CanvasHistoryMaterialCoreV2 and materialDigest.
8. Create the history root and operation receipt in the same candidate transaction.

#### 19.6.2 MaterializeHistoryV2

The total function input is the latest validated working state, exact history guard,
new CanvasReplicaOperationContextV2, direction and required external permits.

1. Recompute root receipt, root and history-state digests. Any mismatch rejects.
2. Require effective mode applied for inverse or undone for forward.
3. Validate every handle against effectiveBindings. Missing, duplicate, wrong-kind
   or stale non-null bindings reject. A null binding is legal only for a template
   that recreates that handle in the selected direction; otherwise it rejects.
4. Compare the latest affected semantic footprint with the expected footprint for
   the current phase. Remote changes outside that footprint are ignored. A changed
   affected value, endpoint, parent, source data, effective child set or new incident
   live edge returns history-conflict with no write.
5. Validate retained resource and Plugin permits. A fetchable missing artifact/blob
   is pending. A proved mismatch rejects. No current URI may replace retained bytes.
6. Rebuild both producer maps and the exact section 5.2 rank-plus-topological
   schedule from stored templates and current phase bindings. Any duplicate,
   missing/late producer, self-edge, cycle or schedule mismatch rejects before
   allocation.
7. Scan that schedule and allocate one contiguous ordinal sequence from zero for
   every newly derived object. node.create allocates one node id/incarnation ordinal;
   edge.create allocates one edge id/incarnation ordinal; containment.set allocates
   one relation-id ordinal; creation-group.restore allocates its group id first, then
   its nodes and edges in handle order; pending-generation.restore allocates its node
   then edges. Record the groupHandle on the creation-group derived object. Non-
   creating templates allocate none. The ordinal plan is fixed before any guard is
   evaluated and is unchanged by input enumeration or implementation traversal.
8. Initialize a transition-local binding table from effectiveBindings and walk the
   scheduled templates against one provisional ordered state. Resolve external
   targets exactly. For every creation-group.restore, require its source binding to
   be ready, resolve the exact effective-live source ref and recompute
   NodeDataGuardV2 from that provisional state before installing any result of that
   group. Then derive the planned group id, node/edge refs and one byte-identical
   CreationGroupRefV2, validate all absent/endpoint/Plugin/resource guards, install
   the complete group in the provisional state and atomically write every produced
   node/edge handle binding. Only after that binding write may a dependent ready
   group resolve the produced node as its source. Every other creating template
   likewise derives exact planned ids and updates bindings before a later template
   may resolve them. Build each current closed guard at its scheduled point and
   compute its guardDigest. pending-generation.restore uses
   CanvasHistoryGenerationGuardV2 over retained facts and never tests liveness of
   the old placeholder. A failure discards the provisional state and all local
   binding writes; replicaDoc, journal and coordinator remain unchanged.
9. Derive resultBindings for every root handle. A tombstoned logical entity binds
   null; unchanged entities retain their ref; creations bind their new ref.
10. Compute materializationDigest and apply the whole operation array to one isolated
    candidate. Compute resultFootprintDigest from the validated post state.
11. Write exactly one operation receipt and one transition. A failure at any step
    leaves candidate, replicaDoc, journal and coordinator unchanged.

The materialized intent is never exposed as an ordinary caller command array.

#### 19.6.3 Exact 14-intent capture table

In the table, snapshot means exact effective position, size, data, Plugin state and
resource at the stated state. Edge closure and child sets are taken from the authored
base, sorted by entity key.

| Root intent | Captured base/post material | Inverse templates | Forward templates | Remote-intervening and failure rule |
| --- | --- | --- | --- | --- |
| canvas.nodes.create/2 | Post node snapshot and its result handle | Tombstone the node handle | Create the node snapshot | Inverse requires the bound node unchanged and with no new live incident edge; forward requires null binding |
| canvas.resources.add/2 | Post snapshots for all result nodes/edges; external endpoints; resources | Tombstone result edges, then nodes | Create nodes, then edges using handles/external endpoints | Changed result entity or new incident edge conflicts; missing retained blob is pending |
| canvas.resources.pending.create/2 | Post placeholder node/edge snapshots | Tombstone edges, then nodes | Recreate placeholders, then edges | Same as resource add, without retained-resource lookup |
| canvas.resources.pending-generation.create/2 | Post placeholder, edges, generation id, exact retained begin resolvable through the root intent plus initial node handle/ref, title/class/geometry | Tombstone edges, then node | One pending-generation.restore guarded by CanvasHistoryGenerationGuardV2 | The tombstoned original placeholder is never required live. The guard binds root id, node handle, retained begin and current lifecycle facts. Succeeded terminal restores retained resource; failed terminal or recovery failure restores manual failed placeholder; active or dismissed lifecycle returns history-redo-unavailable; no external work restarts |
| canvas.elements.remove/2 | Base snapshots of all removed refs, incident-edge closure, removed-node parents and live children of removed groups; each Plugin-group source is a handle target iff the source is also removed by this root, otherwise its exact external ref; exact group handles and source-producer DAG | Restore only non-group ordinary nodes first; restore Plugin-group subsets with new group ids in deterministic source-dependency topological order, atomically publishing each completed group's bindings for dependents; then restore remaining edges and containments | Tombstone restored edges, then nodes | Old tombstones remain; recreate under new ids. A group-owned source is restored only by its producer group, never by ordinary node.create. Handle sources bind to the exact ordinary/group result recreated earlier in the schedule; external sources stay exact-live. Duplicate producer, missing producer or source cycle rejects before allocation. Recompute source identity/data-register/effective-data guard at the scheduled provisional state. Changed source/Plugin or new incident edge conflicts the whole transition |
| canvas.nodes.set-geometry/2 | Base and post effective geometry per node | Set base position/size | Set post position/size | Current geometry must equal the current phase value; unrelated data/Plugin changes are allowed |
| canvas.nodes.update-data/2 | Base/post effective data and exact resources | Set base data | Set post data | Current effective data must equal phase value. Missing retained resource is pending |
| canvas.nodes.set-plugin-state/2 | Base/post effective Plugin envelopes | Set base Plugin value | Set post Plugin value | Current effective Plugin value must equal phase value; missing exact artifact is pending |
| canvas.nodes.set-structural-parent/2 | Base/post effective parent for child | Set base parent | Set post parent | Child and non-null parent must be live; current effective parent must equal phase value; cycle validation reruns and may reject |
| canvas.nodes.group/2 | Created group snapshot, each child's base parent and post group parent | Restore child base parents, then tombstone group | Recreate group, then parent children to its handle | Group must be unchanged with no new incident edge; child containment changes conflict |
| canvas.nodes.ungroup/2 | Base group snapshot, group parent, exact effective children and post top-level state | Recreate group, restore its parent, then parent exact children to it | Set children top-level, then tombstone group | Effective child set and each child parent must equal phase value; new/removed child conflicts |
| canvas.edges.connect/2 | Post edge snapshot and endpoints | Tombstone edge | Recreate edge | Edge must be unchanged for inverse; both exact endpoint incarnations must remain live/connectable for forward |
| canvas.metadata.update/2 | Base/post value for each changed field | Set base values | Set post values | Only changed fields participate; each current effective value must equal phase value |
| canvas.plugin.creation-group.create/2 | Exact external source target/data digest/Plugin requirement, all result snapshots and resources | Tombstone result edges, then nodes | One creation-group.restore for the complete result set | This root does not own or rebind its source. The external source must remain exact-live with byte-identical effective-data digest and Plugin artifact; source delete makes all results absent and forward conflicts rather than creating orphans |

The remove table row groups deleted Plugin-owned members by byte-identical original
CreationGroupRefV2 and emits one restore template per group. It may restore a strict
deleted subset under a new group id, but memberSetDigest is recomputed over exactly
that subset. When the source is also removed, the source is a history node handle.
If it was ordinary, rank 10 restores it; if it belonged to another creation group,
that producer group restores it earlier in the deterministic dependency schedule.
The consumer group references that new exact source incarnation. Otherwise the
source stays an external exact incarnation. Deleting either resolved source later
hides the subset by the ordinary creation-group invariant. A source chain of any
bounded acyclic depth is valid; only a missing producer or directed source cycle is
invalid.

For every row, the expected phase footprint is the semantic result of its stored
direction template resolved through current bindings. Identical remote writes that
leave that footprint byte-identical do not conflict. A remote write to an unrelated
node or field never blocks the operation.

### 19.7 Golden vectors

Vectors A through E use lowercase SHA-256 hex, UTF-8, one zero separator and the
exact JCS shown. Vector F is a non-hash scheduling golden over the same closed
history types and introduces no digest domain. All vectors MUST be reproduced by at
least two independent generators before the artifact can be signed. Every expected
hash and scheduled ordinal below is normative together with this file.

#### Vector A: kernel owner-canonicalizer descriptor instance

The fixture ownerSchemaDigest is SHA-256 of empty bytes and is only a valid fixed
DigestV2 scalar for testing the Canvas constructor. It is not the selected Canvas
artifact digest.

~~~text
domain:
convax.owner-canonicalizer-descriptor/2

JCS:
{"canonicalStateCodec":"restricted-jcs-utf8","canonicalStateFormat":"convax.canvas-canonical-state/2","exactBytePolicy":"parse-reencode-byte-equal","format":"convax.owner-canonicalizer-descriptor/2","owner":"canvas","ownerSchemaDigest":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","unknownStatePolicy":"reject"}

SHA-256:
043f386edb26fd29d9eebffc5d5154dceb263df6451eb3b2228890ce455291cd
~~~

#### Vector B: effective data

~~~text
domain:
convax.canvas-effective-data/2

JCS:
{"data":{"format":"convax.canvas-node-data/2","instructions":null,"kind":"agent","title":"A"},"format":"convax.canvas-effective-data/2"}

SHA-256:
8175e6a7eede34bec6869d37ed6629135741bb7727eb97d2bd93f36000e2a42f
~~~

#### Vector C: empty obstacle projection

~~~text
domain:
convax.canvas-obstacle-projection/2

JCS:
{"format":"convax.canvas-obstacle-projection/2","obstacles":[]}

SHA-256:
5317e3704fa88e76024939abdfabe5dea30ef67301dd37ab626bc8f5dfa72874
~~~

#### Vector D: metadata present null

~~~text
domain:
convax.canvas-metadata-effective/2

JCS:
{"field":"description","format":"convax.canvas-metadata-effective/2","value":null}

SHA-256:
21d7c073cf0c363eb1d884bf7ad77f9fc087750679d00580c427c24154a91f9a
~~~

#### Vector E: actual-write explicit null

~~~text
domain:
convax.canvas-actual-write-value/2

JCS:
{"entityId":"node/n_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/ni_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","entityKind":"node","field":"creationGroup","format":"convax.canvas-actual-write-value/2","path":"nodes/node/n_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/ni_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/creationGroup","value":{"presence":"present-null","value":null}}

SHA-256:
fffb72be980a00d8ed0acebf5768d73a0da53dfef751887b8a78bb7b8ae4dd52
~~~

#### Vector F: nested creation-group dependency schedule

This fixture starts the rank-11 phase with null bindings for n/0, n/1 and n/2 and
these exact group vertices:

~~~text
g/0: external source; produces node n/0
g/1: handle source n/0; produces node n/1
g/2: external source; produces node n/2
~~~

The only dependency edge is g/0 -> g/1. The initial ready set is {g/0,g/2}; UTF-8
minimum chooses g/0. Publishing n/0 makes g/1 ready, and UTF-8 minimum then chooses
g/1 before g/2. The exact schedule and contiguous ordinal plan are:

~~~text
schedule: g/0,g/1,g/2
ordinal 0: creation-group g/0
ordinal 1: node n/0
ordinal 2: creation-group g/1
ordinal 3: node n/1
ordinal 4: creation-group g/2
ordinal 5: node n/2
~~~

After g/0, n/0 is bound to its newly derived ref carrying g/0's new
CreationGroupRefV2. g/1 recomputes its source guard from that exact provisional ref
before deriving g/1 and n/1. No ordinary node.create exists for n/0, n/1 or n/2.
Permuting the input vertex/member enumeration MUST reproduce these exact schedule
and ordinal lines. Replacing g/0's external source with handle n/1 creates
g/1 -> g/0 and MUST reject as a cycle before ordinal allocation.

The following negative vectors MUST reject before hashing:

- omission of value from Vector D;
- replacing the empty obstacles array from Vector C with null or omitting it;
- deleting ownerSchemaDigest from Vector A, adding a Canvas root/map field to its
  kernel descriptor or changing its owner to project-index;
- an actor-slot array sorted by base64url text instead of decoded actor bytes;
- duplicate member, resource, binding, transition or actual-write entry;
- a canonical-state object that omits an empty mandatory root;
- a history node-create template containing nodeId or incarnation;
- a creation-group source handle with no same-root node binding/snapshot, or an
  external source rewritten to a current ref;
- duplicate creation-group handles, duplicate node/edge producers, a group-owned
  result also emitted as ordinary node.create, a missing handle-source producer, or
  any self/dependency cycle;
- a nested creation-group schedule not produced by Kahn ready-set selection with
  minimum groupHandle UTF-8 tie-breaking, or an ordinal plan allocated before that
  complete schedule is fixed;
- a CanvasHistoryGenerationGuardV2 containing any NodeLiveGuardV2 liveness field;
- footprint entities, metadata, containments or incident edges out of their exact
  rank/key order, duplicated, omitted or null;
- a transition missing one root handle binding;
- a second concurrently created redo entity not selected by the effective transition.

### 19.8 Required regeneration and acceptance

This proposal is not incorporated by editing only Canvas prose. The transplant MUST:

1. update the Canvas artifact types, domains, reducers, write-count equations and
   conformance fixtures;
2. update the kernel descriptor-bearing owner port, exact domain registry and generic
   owner/genesis/checkpoint binding text without restoring a Canvas-private
   descriptor;
3. instantiate the same kernel-owned OwnerCanonicalizerDescriptorV2 for Project
   through its separately reviewed owner constructor;
4. regenerate all four artifact digests, bundle core/digest, main pins and detached
   whole-file review identities;
5. reject every pre-change Canvas identity as unsupported portable version;
6. run three independent architecture reviews against the same exact bytes.

Acceptance requires:

- two clean-room encoders emit byte-identical canonical state for every generated
  valid Y.Doc and reject the same invalid documents;
- every digest recipe has exact, empty, null and first-invalid vectors;
- all 14 history rows pass undo, redo, repeated undo/redo, concurrent transitions,
  remote unrelated edit, remote affected edit, crash-before-journal and duplicate
  delivery schedules;
- deleting a Plugin creation-group source and its results in one elements.remove
  root restores the source first, rebinds every group to the new source incarnation
  and never retains an old source ref or orphan;
- deleting the two-level chain G1(S -> A), G2(A -> B) in one elements.remove root
  restores G1 then G2, preserves A's G1 creationGroup, binds G2 to A's new exact
  incarnation, and never emits ordinary node.create for A or B;
- every permutation of an acyclic creation-group input graph produces the same
  minimum-groupHandle Kahn schedule, ordinal plan, derived refs, binding publication
  points and source guards; duplicate producers and cycles reject before allocation;
- pending-generation create, undo and redo with no intervening write succeeds or
  returns only the lifecycle-defined unavailable result; it never fails because the
  original placeholder is tombstoned;
- permuting input enumeration for footprint entities, metadata, containments or
  incident edges leaves the canonical arrays and resultFootprintDigest unchanged;
- losing concurrent transition outputs remain stored but never visible;
- one changed hidden actor slot changes canonical-state bytes;
- one changed actual-write value with unchanged path/count rejects before replicaDoc;
- the regenerated domain registry is the strict 123-domain union and contains no
  `convax.canvas-canonicalizer/2`.

Any implementation clarification, runtime-specific branch or test expectation not
derivable from the signed artifacts falsifies closure.

### 19.9 Revision-4 change log

Revision 4 makes these normative changes to revision 3:

1. instantiates the sole kernel-owned `OwnerCanonicalizerDescriptorV2`, adds
   `canonicalizerDigest` to Canvas identity/genesis and closes the exact eleven-root
   `CanvasCanonicalStateV2` restricted-JCS encoder;
2. replaces undefined or owner-private digest recipes with the complete acyclic
   Canvas ledger, adds exactly 28 Canvas domains and requires the atomic final
   123-domain registry with no `convax.canvas-canonicalizer/2`;
3. removes the receipt-to-actual-write-evidence back-reference and defines the
   exact path/value digest bijection for every stored Canvas write;
4. replaces ref-bearing history templates with stable handles, exact footprints,
   result bindings and total capture/materialization for all fourteen undoable
   roots, including a generation-lifecycle guard that never restarts external work;
5. restores nested Plugin creation groups only through the deterministic
   minimum-handle Kahn source-dependency schedule, rejecting duplicate producers,
   missing producers and cycles before ordinal allocation or candidate mutation;
6. freezes hash goldens A through E and the non-hash nested dependency schedule
   Vector F, and requires atomic artifact/bundle regeneration plus renewed exact-byte
   review before implementation.

Revision 3 wire bytes, identities, receipts and history values are unsupported by
the resulting artifact. They are preserved only for the explicit user-confirmed
breaking reset and are never silently migrated, hydrated or rewritten.

## 20. Revision 3 change log

Revision 3 makes these normative changes to revision 2:

1. replaces Canvas-local `Id128V2` Canvas identity with the Project-owned
   `cv_<64 lowercase hex>` codec and imports one kernel-owned document scope and
   portable stamp wire shape;
2. binds generation begin and first-loss recovery to the control-owned exact
   `BeginAuthorizationEpochCoreV2` digest domain and exact edit-authorization core;
3. preserves every creator/null/receipt/history evidence path, recalculates all 22
   intent closures, lowers the global logical-write cap from 2,048 to 512, adds the
   256 KiB evidence cap and freezes exact/first-invalid fixtures;
4. publishes exact Canvas artifact identity and bytes for the kernel-owned
   `ProtocolSchemaBundleV2` ref without introducing a self-referential digest;
5. separates immutable Canvas `ownerSchemaDigest` from bundle `protocolDigest` and
   closes the lossless Canvas-evidence projection into the kernel-owned generic
   `ActualWriteEvidenceV2` frame wrapper.

No Canvas state, intent or projection semantics outside those four changes is
weakened or migrated. This is a breaking v2 candidate; no revision-2 artifact,
Id128 Canvas id, stamp variant or unbound generation-epoch hash is accepted.

## 21. Strongest objections and falsification

1. The generic descriptor does not enumerate Canvas root/map codecs, so it may look
   too weak to identify the Canvas canonicalizer. Duplicating those fields would be
   worse: the exact root/map/projection algorithm is already part of the selected
   Canvas artifact and is therefore bound by `ownerSchemaDigest`. The kernel
   descriptor independently binds only owner, owner schema, canonical-state format,
   exact byte codec and fail-closed policy, leaving one authority for each fact.
2. Full stored-state canonicalization is larger than effective projection. This is
   deliberate: losing claims, tombstones and history can affect future validation,
   retention or projection. Omitting them permits hidden writes outside the signed
   canonical state. If full-equivalence encoding misses the accepted maximum-size
   p99 budget, this representation must be redesigned rather than weakened.
3. Transition bindings, hidden losing outputs and nested creation-group scheduling
   add history complexity. Without them, redo-created identities cannot be targeted
   by the next undo, concurrent redo produces multiple visible copies, and restoring
   a Plugin result chain can discard its creation-group authority. A simpler
   ref-bearing history model is not closed.

Flaw types are duplicate authority, hidden scaling assumption and complexity
transfer into semantic-history identity. Revision 4 is falsified if:

- two independent implementations disagree on any canonical byte, digest, binding,
  ordinal, materialized template or effective transition;
- a visible-equivalent hidden-state mutation leaves canonical-state bytes unchanged;
- repeated undo targets a tombstoned original identity after redo;
- same-root source/result deletion cannot restore a group against the newly rebound
  source handle;
- a valid acyclic nested group chain requires ordinary node creation for a group
  result, loses its creation-group authority or changes schedule under input
  permutation;
- a duplicate producer or source cycle reaches ordinal allocation, provisional
  binding publication or candidate mutation;
- pending-generation redo requires the tombstoned original placeholder to remain
  live or restarts external work;
- footprint digest changes when only pre-canonical enumeration order changes;
- concurrent redo leaves more than one visible binding for one logical handle;
- null, empty and absent share an accepted preimage;
- the final registry contains other than 123 domains or admits
  `convax.canvas-canonicalizer/2`.

## 22. Decision and digest rule

Decision: **REVISION-4 ANNEX CANDIDATE; DO NOT IMPLEMENT**, score **9.1/10 before
renewed exact-byte authority-set review**.

This candidate supersedes the revision-3 Canvas artifact only after the complete
kernel, Project/control, Canvas artifact refs, domain registry, bundle core,
`protocolDigest`, main pins and detached review identities are regenerated and
three independent reviewers approve the same exact bytes. Until then the currently
pinned authority set remains rejected for this revision and no implementation may
treat this appendix as an accepted protocol artifact.

The remaining deductions are full-state canonicalization cost, atomic authority-set
regeneration and the semantic-history/DAG review burden. They are nonfatal only
because all three are bounded, fail closed and have exact independent golden and
permutation tests. The score falls below 7 if the maximum-size canonical encoder
misses its accepted p99 budget, two clean-room reducers disagree, or the generic
descriptor cannot bind Canvas without a private second authority.

SHA rule: hash the exact UTF-8 bytes from the first byte through the newline after
this sentence; exclude the following `SHA-256:` line itself.
SHA-256: `1ff257f58ffe89e4b67a79bf9ce923905a78a39392f38e498e00b7fd8a5932af`

## 23. Revision 5.1 normative runtime-closure replacement

This section is normative Revision 5.1 authority and replaces every conflicting
Revision-4 statement in this appendix. The eleven Canvas roots, 28 Canvas digest
domains, 22 admitted intent kinds, fourteen undoable intent families, creation-group
DAG, actual-write ledger and canonical-state rules remain unchanged. Revision 5.1
changes the artifact-bound owner runtime closure used to construct and admit those
portable intents. It does not create another Canvas state authority.

### 23.1 Atomic owner runtime

The selected Canvas artifact factory MUST atomically construct one nonportable
runtime bundle:

```ts
interface DocumentOwnerRuntimeV2 {
  readonly protocolPort: DocumentOwnerProtocolPortV2
  readonly closurePort: OwnerIntentClosurePortV2
}

type InspectedOwnerIntentV2 =
  | { readonly kind: "ordinary" }
  | {
      readonly kind: "history"
      readonly direction: "undo" | "redo"
      readonly rootOperationId: Id128V2
    }

interface OwnerIntentClosurePortV2 {
  readonly protocolPort: DocumentOwnerProtocolPortV2

  inspectIntent(
    decodedIntent: unknown,
  ): InspectedOwnerIntentV2 | "rejected"

  discoverDependencies(
    base: OwnerValidatedStateV2,
    context: OwnerIntentDependencyContextV2,
    decodedIntent: unknown,
    facts: OwnerExternalFactPortV2,
  ): "verified" | "pending" | "rejected"

  readonly history: OwnerHistoryMaterializationPortV2
}

interface OwnerHistoryMaterializationPortV2 {
  materialize(
    base: OwnerValidatedStateV2,
    context: OwnerIntentConstructionContextV2,
    request: Readonly<{
      direction: "undo" | "redo"
      rootOperationId: Id128V2
    }>,
    facts: OwnerExternalFactPortV2,
  ): Readonly<{ typedIntent: unknown }> | "pending" | "rejected"
}

interface OwnerIntentConstructionContextV2 {
  readonly scope: DocumentScopeV2
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly operationId: Id128V2
  readonly lamport: Uint64V2
  readonly baseFrontierDigest: DigestV2
  readonly baseCanonicalStateDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
}

interface OwnerIntentDependencyContextV2
  extends OwnerIntentConstructionContextV2 {
  readonly intentDigest: DigestV2
}
```

The artifact loader MUST be the sole constructor of this aggregate. The
collaboration runtime registers the aggregate as a private live capability and
requires `runtime.closurePort.protocolPort === runtime.protocolPort` by object
identity. A structural clone, separately injected port or matching self-reported
digest is invalid. `inspectIntent`, dependency discovery, history materialization,
the reducer, canonicalizer and actual-write derivation MUST come from the same exact
selected Canvas artifact. The closure port carries no separate artifact or schema
identity and cannot become a second authority.

`inspectIntent` and dependency discovery are synchronous, pure and deterministic.
They MUST NOT access an ambient clock, filesystem, network, renderer state, another
Y.Doc or an untracked closure fact. All facts enter through the attempt-scoped
tracked `OwnerExternalFactPortV2` supplied by the kernel.

### 23.2 Ordinary and semantic-history entry separation

An ordinary local mutation accepts only an intent for which `inspectIntent`
returns `{kind:"ordinary"}`. A schema-valid `canvas.undo.semantic-inverse/2` or
`canvas.redo.semantic-forward/2` supplied through the ordinary entry MUST be
rejected before dependency resolution, authority allocation, candidate creation or
durable write.

The only public history request is:

```ts
interface SemanticHistoryCommitRequestV2 {
  readonly operationId: Id128V2
  readonly direction: "undo" | "redo"
  readonly signal?: AbortSignal
}
```

It contains no root, cursor, materialized operation, typed intent, Y.Doc, state
vector, raw update or document-wide version. Inside the shard-exclusive kernel
turn, the coordinator peeks the current root/cursor, obtains the latest validated
Canvas state from the private replica, and invokes `history.materialize`. The
returned intent MUST decode and inspect as history; its direction and
`rootOperationId` MUST be byte-equal to the queue-time peek. An ordinary result,
another direction/root, a mutation of the opaque validated base, a noncanonical
result or nondeterministic result is `invalid-owner-result`.

The kernel then computes the intent digest, discovers dependencies and applies the
normal isolated candidate/reducer/evidence/frame pipeline. The cursor moves only
after the durable head crosses. Pending, rejection, cancellation, stale base or any
pre-head failure leaves both stacks unchanged. A post-head cursor failure preserves
the committed Canvas mutation, clears session history and returns
`history-reset-after-commit`. Recovery reuses the original signed frame and never
materializes history again.

### 23.3 Exact owner dependency closure

Canvas owner dependency kinds are exactly:

```ts
type OwnerDependencyKindV2 =
  | "project-index-proof"
  | "project-resource-proof"
  | "plugin-validation-artifact"
  | "generation-external-fact"
  | "reset-authorization"
```

Discovery computes the required sorted unique owner set. It is not authority
consumption and cannot manufacture proofs. The kernel tracks materialization facts
for history, discovery facts and candidate-apply facts through restricted resolvers.
For an eager ordinary intent:

```text
discovered owner set == declared owner partition == apply-consumed set
```

For a history intent:

```text
materialize-consumed set == discovered owner set
== declared owner partition == apply-consumed set
```

Resolving an undeclared ref, leaving a declared ref unconsumed, returning an
unknown kind, duplicate, unsorted output or observing inconsistent bytes for one
digest rejects. A missing but fetchable exact ref is `dependency-pending`. Plugin
dependency digests MUST also equal, in both directions, the set of
`ValidationArtifactSetV2` refs whose owner is `plugin`; a loose Plugin superset is
invalid.

### 23.4 Revision 5.1 Canvas falsifiers

Revision 5.1 is falsified if an ordinary caller can submit a history intent; if
ports from two artifact instances can be mixed; if history observes a renderer
snapshot or second Y.Doc; if a queued remote mutation is not reflected in the base
used by the subsequent materializer; if direction/root differs from the queue-time
peek; or if materialization, discovery and apply accept different dependency sets.
All failures above MUST produce zero signer, durable-head, projection and ACK calls.

## 24. Revision 5.2 normative Canvas specialization

This section is the terminal Canvas authority for Revision 5.2 and replaces every
conflicting generic ABI declaration in section 23. Revision 5.1 was never signed and
has no compatibility or fallback authority. Canvas retains its eleven-root schema,
intent/reducer semantics, creation-group invariants and history policy; the generic
runtime and capability contracts move exclusively to the kernel owner.

### 24.1 Imported generic ABI and selected specialization

Canvas imports, but does not redeclare, these kernel types:

```text
DocumentOwnerRuntimeV2<K>
DocumentOwnerProtocolPortV2<K>
OwnerIntentClosurePortV2<K>
OwnerIntentConstructionContextV2
OwnerIntentDependencyContextV2
OwnerHistoryMaterializationPortV2
InspectedOwnerIntentV2
OwnerExternalFactPortV2
SelectedDocumentOwnerArtifactFactoryV2<K>
```

The selected Canvas artifact factory returns one
`DocumentOwnerRuntimeV2<"canvas">`. Its `closurePort.history` is non-null and its
`closurePort.protocolPort` is object-identical to `runtime.protocolPort`. Canvas
must not add a self-reported runtime owner/schema field; loader-selected artifact
identity, `protocolPort.owner/schemaDigest` and object identity are the complete
binding. React Flow, renderer/DOM state, clocks, network, filesystem, another Y.Doc
and Desktop services are forbidden dependencies of this headless closure.

`OwnerIntentConstructionContextV2` does not contain `intentDigest`.
`OwnerIntentDependencyContextV2` extends the construction context with the exact
computed `intentDigest`. The attempt-scoped synchronous fact port resolves only an
exact declared digest to a defensive immutable view and records consumption. It
does not fetch, execute a Plugin/generator, discover a new fact or perform I/O.
Missing exact bytes yields pending; after leaving the queue to fetch them, the
entire attempt restarts from the latest base.

### 24.2 Canvas inspection, history and dependency equality

`inspectIntent` accepts the closed Canvas union. Undo/redo semantic intents return
`{kind:"history", direction, rootOperationId}` with byte-exact values; every other
admitted mutation returns `{kind:"ordinary"}`; unknown or reclassified values
reject. The ordinary local entry requires `ordinary` before fact resolution,
authority, allocation or candidate creation. The public history entry accepts only
operation id, direction and optional signal.

Local history runs inside the document queue in this exact order:

```text
latest private replica -> current root peek -> history materialize
-> restricted-JCS encode -> protocol decode -> inspect direction/root equality
-> compute intent digest -> dependency discovery -> isolated apply
-> durable accepted-head barrier -> cursor advance
```

A pending retry retains no old root, cursor, base or materialized bytes. Local
ordinary operations require
`discovered == declared Owner == apply-consumed`. Local history additionally
requires `materialize-consumed` to equal that same set. Plugin refs equal exactly
the Plugin subset in the ValidationArtifactSet.

An incoming or recovery history frame is already a signed typed intent. It executes
decode, inspect, exact declared-dependency resolution and isolated apply, but never
calls `history.materialize`, a Plugin executable, generator, local constructor,
signer or allocator. Recovery may reread only the immutable fact bytes named by the
frame. Any ledger mismatch is the kernel-defined invalid-frame/owner-result failure.

### 24.3 Canvas falsifiers

Revision 5.2 Canvas conformance is falsified if collaboration imports Canvas to
obtain a generic type; if ProjectIndex can expose history; if an ordinary entry
accepts a history intent; if retry reuses a pre-pending root; if incoming/recovery
materializes history; if a fact port performs I/O or generates a fact; if ports from
different artifact instances can be mixed; or if renderer/transient state affects
canonical bytes.

### 24.4 Route-dependent Canvas genesis identity

The terminal Revision 5.2 schemas are:

```ts
interface CanvasGenesisCoreV2 {
  format: "convax.canvas-genesis-core/2"
  scopeId: CanvasScopeIdV2
  canvasId: CanvasIdV2
  ownerSchemaDigest: DigestV2
  protocolDigest: DigestV2
  canonicalizerDigest: DigestV2
  projectIndexRouteDependencyFrameDigest: DigestV2
}

interface CanvasIdentityV2 {
  format: "convax.canvas.v2"
  scopeId: CanvasScopeIdV2
  canvasId: CanvasIdV2
  ownerSchemaDigest: DigestV2
  protocolDigest: DigestV2
  canonicalizerDigest: DigestV2
  projectIndexRouteDependencyFrameDigest: DigestV2
  genesisDigest: DigestV2
}
```

`CanvasIdentityV2` is the durable canonical preimage: its frame digest must equal
the GenesisCore field, and `genesisDigest` must recompute from the complete exact
GenesisCore. `ReplicaCheckpointCoreV2` is unchanged. A `canvas-genesis-proof`
resolver must verify the complete checkpoint wrapper, full update, state vector and
canonical Canvas state, then return the identity's exact dependency frame digest;
checking wrapper fields alone is invalid.

The field is a predecessor witness, not current route authority. For initial
creation/activation, it names the accepted `project.canvas.route.stage/2` frame that
wrote the exact stage record. For reset genesis, it names the accepted
`project.canvas.route.activate/2` or `project.canvas.route.reset/2` frame that wrote
the current selected predecessor record. The appropriate Project exact-base/F13
path verifies the closed discriminator and actual-write evidence. The old
`projectIndexStageFrameDigest` spelling is an unknown key and has no alias.

## 25. Revision 5.3 normative Canvas genesis-proof carrier replacement

This terminal section replaces every conflicting Revision 5.2 statement about how
a `canvas-genesis-proof` external fact carries and validates G. Revision 5.2 was
rejected before signature and has no decoder or fallback. The Canvas roots,
canonical identity, typed-intent, history, generation, containment and renderer
rules remain unchanged.

### 25.1 Exact `CVXCGP02` carrier

`canvas-genesis-proof` has one self-contained deterministic proof carrier:

```text
8 bytes  ASCII "CVXCGP02"
8 bytes  unsigned big-endian uint64 indexLength
N bytes  exact restricted-JCS CanvasGenesisProofCarrierIndexV2
...      contiguous exact section bytes
```

```ts
interface CanvasGenesisProofCarrierSectionV2 {
  ordinal: Uint32V2
  kind:
    | "checkpoint-wrapper"
    | "checkpoint-full-update"
    | "checkpoint-state-vector"
    | "checkpoint-canonical-state"
    | "checkpoint-author-credential"
    | "checkpoint-author-reservation-receipt"
    | "checkpoint-author-membership-snapshot"
    | "service-trust-bundle"
    | "validation-artifact"
  subjectDigest: DigestV2
  byteOffset: Uint64V2
  byteLength: Uint64V2
  sha256: DigestV2
}

interface CanvasGenesisProofCarrierIndexV2 {
  format: "convax.canvas-genesis-proof-carrier/2"
  scope: DocumentScopeV2 & { docKind: "canvas"; docId: CanvasIdV2 }
  checkpointObjectDigest: DigestV2
  fullUpdateDigest: DigestV2
  stateVectorDigest: DigestV2
  canonicalStateDigest: DigestV2
  ownerSchemaDigest: DigestV2
  canonicalizerDigest: DigestV2
  validationArtifactSetDigest: DigestV2
  authorityDependencyCoreDigests: readonly DigestV2[]
  sections: readonly CanvasGenesisProofCarrierSectionV2[]
  totalSectionBytes: Uint64V2
  protocolDigest: DigestV2
}
```

There is exactly one wrapper, update, state-vector, canonical-state, author
credential, author reservation receipt, author membership snapshot and trust-bundle
section. There are zero through 64 validation-artifact sections in the exact
selected ValidationArtifactSet order. Sections sort by `(kind raw UTF-8 bytes,
ordinal numeric)`. A singleton has ordinal `"0"`; repeated validation artifacts use
the consecutive ordinals `"0".."n-1"`. Offsets begin immediately after the index
and are contiguous, with no gap, overlap or trailing byte. Each section ordinary
SHA-256, subject digest, length and index mirror must match before decoding.

The carrier is capped by the Control-owned
`canvasGenesisProofCarrierBytes:"83886080"` before allocation. It is dependency
proof input, not a second checkpoint object and not a digest domain. Its portable
Owner ref remains exactly:

```ts
{ kind: "canvas-genesis-proof", digest: checkpointObjectDigest }
```

where `checkpointObjectDigest` is G, the existing complete
`ReplicaCheckpointV2` wrapper object digest. `convax.canvas-genesis-proof-carrier/2`
is a format literal only and MUST NOT enter the domain registry. Making these bytes
an independently addressed object is a new architecture decision and would require
a new digest domain and review.

### 25.2 Self-contained validation

The resolver validates the exact checkpoint wrapper and its core/object identity,
historical author credential, replica reservation, membership snapshot, trust
bundle and selected validation-artifact closure entirely from the carrier. It then
applies the update-v1 bytes to a fresh Y.Doc and independently reproduces the full
update, state vector and canonical Canvas state byte-for-byte. It validates
signature, author principal, scope, schema, protocol, canonicalizer and artifact-set
equality before calling the public Canvas genesis verifier.

The canonical result contains one `CanvasIdentityV2`; its
`projectIndexRouteDependencyFrameDigest` is F. For an activation, G's author
principal and authorization digest equal the consuming activation frame's verified
signer. For reset, they equal the corresponding exact authority values inside the
reset-authorization carrier. Current authority is still revalidated by the
consuming frame/F13; historical carrier evidence does not become current membership
authority.

For one G there is one canonical carrier section set and order. Same G with unequal
carrier bytes is terminal dependency-subject equivocation/hash-collision quarantine;
arrival order never chooses a winner. Missing exact bytes is dependency pending.
Malformed, over-cap, unequal, noncanonical or semantically invalid bytes reject and
cannot enter a Canvas reducer.

### 25.3 Canvas falsifiers

Revision 5.3 is falsified if G can be verified by an ambient credential, registry,
artifact or filesystem lookup; if a carrier omits the author/trust/artifact closure;
if its complete size exceeds 80 MiB; if two unequal carriers for one G select a
winner; if the carrier format is registered as a digest domain; or if G identity F
is accepted without exact equality to the consuming Project base-reference proof.
