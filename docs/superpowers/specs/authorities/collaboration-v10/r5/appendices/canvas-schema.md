# Convax P2P v10 Canvas protocol schema artifact

Status: **Route-B standalone final-candidate Canvas annex; inactive until the
complete five-file candidate, its regenerated manifest/bundle identities and the
same exact bytes receive unconditional 3/3 SIGN and atomic pointer promotion.**

This artifact is the sole owner of Canvas portable schema, reducer, projection and
`CVXCGP02` Canvas-validation semantics. It imports only exact shared Kernel, URI and
Control protocol shapes selected by the same candidate bundle, through declared
ports rather than a runtime package edge. This annex is complete in itself. The
words MUST, MUST NOT, SHOULD and MAY are normative.

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

For one Canvas scope, the exact CanvasYDoc represented by this schema is the sole
portable logical authority. JSON documents, React Flow state, renderer caches,
UndoManager bytes and document-wide version counters are never parallel authorities.

`@convax/collaboration` owns the generic `replicaDoc`/isolated `candidateDoc`
lifecycle, canonical JSON and binary helpers, transaction origins and transient
`SessionUndoCoordinatorV2`. It does not know this schema or materialize Canvas
inverse operations.

Project composition resolves resource, authorization and generation-recovery facts
through the Canvas-owned public request/result codec and an unbranded generic
resolver definition. Canvas validates those untrusted results and alone mints its
non-serializable permits behind the branded attempt port. Plugin validation bytes
use the generic validation-artifact channel. Canvas does not import Project,
membership, PeerJS, Electron, filesystem or native persistence. Desktop Main
composes those ports, the sole local commit mutex and IPC.
Desktop renderer composes the React shell and host view adapters; it does not own a
second Canvas reducer, gesture-to-intent mapping or React Flow document store.

This appendix does not specify ProjectIndex, membership/control-plane, PeerJS,
checkpoint, cutoff, blob-transfer, shard-reset or native persistence protocols.
Their verified facts enter only through the closed contexts below.

## 2. Canonical primitives and rejection rule

```ts
import type {
  ActorIdV2,
  ActualWriteEvidenceV2,
  CanvasIdV2,
  CreateOwnerExternalFactAttemptPortResultV2,
  DigestV2,
  DocumentOwnerProtocolDefinitionV2,
  DocumentOwnerProtocolPortV2,
  DocumentOwnerRuntimeV2,
  DocumentScopeDigestV2,
  DocumentScopeV2,
  Id128V2,
  InspectedOwnerIntentV2,
  OwnerApplyResultV2,
  OwnerCanonicalizerDescriptorV2,
  OwnerExternalFactPortFactoryV2,
  OwnerExternalFactPortV2,
  OwnerExternalFactRequirementV2,
  OwnerExternalFactResolveResultV2,
  OwnerExternalFactResolverDefinitionV2,
  OwnerHistoryMaterializationDefinitionV2,
  OwnerHistoryMaterializationPortV2,
  OwnerIntentClosureDefinitionV2,
  OwnerIntentClosurePortV2,
  OwnerIntentConstructionContextV2,
  OwnerIntentDependenciesV2,
  OwnerIntentDependencyContextV2,
  OwnerIntentValidationContextV2,
  OwnerProcessValueFactoryV2,
  OwnerValidatedStateV2,
  OwnerValidationArtifactResolveResultV2,
  PortableStampV2,
  ProjectIdV2,
  ProtocolSchemaBundleV2,
  SelectedDocumentOwnerArtifactDefinitionV2,
  SelectedDocumentOwnerArtifactFactoryV2,
  SessionUndoCoordinatorV2,
  Uint32V2,
  Uint64V2,
  ValidationArtifactRefV2,
  ValidationArtifactSetV2,
} from "@convax/collaboration"

type CanvasScopeIdV2 = DocumentScopeDigestV2
type CanvasOperationIdV2 = Id128V2
```

`ProjectIdV2` and its canonical URI occurrence use the global `@convax/uri` codec;
the scalar itself is supplied by the shared document scope. `CanvasIdV2` is allocated
outside Canvas by the Project owner and has one portable codec across Project routes,
Canvas identity and the shared document scope: the `cv_` prefix followed by exactly
64 lowercase hexadecimal characters. The kernel descriptor imports that scalar and
owns the one shared `DocumentScopeV2`; for a Canvas scope its `docId` is a
`CanvasIdV2` and is byte-identical to `CanvasIdentityV2.canvasId`. Canvas validates
the imported scalar without importing `@convax/project` or allocating an identity.

Canvas neither redeclares nor computes the shared document scope or its digest.
After the kernel has validated those exact imported values, the Canvas boundary
requires that the scope selects the Canvas owner, that its document identity equals
`CanvasIdentityV2.canvasId` byte-for-byte and that its verified digest equals both
the kernel-selected replica scope and identity `scopeId`. `CanvasScopeIdV2` is only
a Canvas name for that imported verified digest, never an independently chosen id.

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

Canvas consumes the exact imported `OwnerIntentDependencyContextV2`; it neither
redeclares a Canvas operation-context DTO nor constructs the generic process value.
The kernel constructs it from verified outer state only after computing the exact
intent digest. Canvas requires the imported scope to select the Canvas owner and
uses the already validated base identity's bound `CanvasScopeIdV2` for derived
identities. UI, Agent, Plugin and renderer IPC MUST NOT supply or amend this
context. The actor sequence orders only one exact actor chain and is never compared
across actors.

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

Canvas admits only the exact imported `PortableStampV2` and uses only the kernel's
verified total-order operation. It neither redeclares the stamp fields nor
reimplements that comparison. Machine clock, Yjs client id, arrival order, React
event order and service sequence never participate in Canvas conflict selection.

Write ordinals are assigned by the reducer in exact UTF-8 logical-write-path order,
except future generation output stamps reserve the explicit slots in section 8.
The operation receipt is always final write ordinal `"65535"`; an intent requiring
more than 512 logical paths rejects before mutation.

## 4. External fact and resource-proof boundary

Canvas persists a host-neutral atomic resource envelope:

```ts
interface CanvasResourceRefV2 {
  format: "convax.canvas-resource-ref/2"
  uri: string                    // exact @convax/uri canonical string; fragment forbidden
  mediaClass: "text" | "image" | "video" | "audio" | "file"
  mime: string
  byteLength: Uint64V2
  contentDigest: DigestV2
  ownerProofDigest: DigestV2
}
```

The complete object is one immutable JSON value. URI, digest, length and media class
MUST NOT be split into independently writable Yjs keys.

Canvas validates `uri` only through the stateless, closed `@convax/uri` codec. The
stored bytes MUST already be canonical, MUST be at most 16 KiB and MUST have an empty
fragment. Canvas does not resolve the URI, perform I/O, authorize it, consult a
dynamic scheme registry or treat a path/query component as identity. The external
resource owner revalidates scheme-specific semantics through the request/result seam
below. URI equality used by Canvas proof matching is exact canonical-string equality;
Project entry or entry-revision comparison remains an owner operation.

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

Canvas owns the public request/result codec used by the host's unbranded
`OwnerExternalFactResolverDefinitionV2<"canvas">`:

```ts
type CanvasExternalFactKindV2 =
  | "current-resources"
  | "retained-resources"
  | "generation-begin"
  | "generation-recovery"

type CanvasExternalFactRequestV2 =
  | {
      format: "convax.canvas-external-fact-request/2"
      kind: "current-resources"
      proofs: readonly (CanvasResourceProofRefV2 & {
        mode: "current-owner-state"
      })[]
    }
  | {
      format: "convax.canvas-external-fact-request/2"
      kind: "retained-resources"
      proofs: readonly (CanvasResourceProofRefV2 & {
        mode: "retained-canvas-history"
      })[]
    }
  | {
      format: "convax.canvas-external-fact-request/2"
      kind: "generation-begin"
      scope: DocumentScopeV2
      beginDigest: DigestV2
      beginActorId: ActorIdV2
      beginAuthorizationEpochDigest: DigestV2
      toolRefDigest: DigestV2
      protocolDigest: DigestV2
    }
  | {
      format: "convax.canvas-external-fact-request/2"
      kind: "generation-recovery"
      proofDigest: DigestV2
    }

interface CanvasExternalFactResultV2 {
  format: "convax.canvas-external-fact-result/2"
  kind: CanvasExternalFactKindV2
  requestSha256: DigestV2
  factDigest: DigestV2
  decision: "verified"
}

declare const canvasExternalFactPermitBrandV2: unique symbol
interface CanvasExternalFactPermitV2 {
  readonly kind: CanvasExternalFactKindV2
  readonly requestSha256: DigestV2
  readonly factDigest: DigestV2
  readonly [canvasExternalFactPermitBrandV2]: true
}

declare const canvasValidationArtifactPermitBrandV2: unique symbol
interface CanvasValidationArtifactPermitV2 {
  readonly artifact: ValidationArtifactRefV2
  readonly [canvasValidationArtifactPermitBrandV2]: true
}

function encodeCanvasExternalFactRequestV2(
  request: CanvasExternalFactRequestV2,
): Readonly<Uint8Array> | "rejected"

function decodeCanvasExternalFactRequestV2(
  exactJcs: Readonly<Uint8Array>,
): CanvasExternalFactRequestV2 | "rejected"

function validateCanvasExternalFactResultV2(
  value: unknown,
): CanvasExternalFactResultV2 | "rejected"
```

The Canvas closure encodes each request as exact restricted JCS and constructs the
exact imported `OwnerExternalFactRequirementV2<"canvas">` with owner `"canvas"`, the same
kind, the ordinary SHA-256 of those request bytes and this fact-digest mapping:

| Request kind | Exact `factDigest` source |
| --- | --- |
| `current-resources` | the requirement's ordinary request `sha256` |
| `retained-resources` | the requirement's ordinary request `sha256` |
| `generation-begin` | `beginAuthorizationEpochDigest` |
| `generation-recovery` | `proofDigest` |

The result codec is process-local response data, not portable authority. Canvas
accepts a resolved value only after its exact validator proves the result kind,
request hash and fact digest byte-identical to the declared requirement; it then
mints `CanvasExternalFactPermitV2` internally. Plugin validators travel only through
the imported validation-artifact half of `OwnerIntentDependenciesV2<"canvas">`; after exact
artifact validation Canvas internally mints `CanvasValidationArtifactPermitV2`.
Neither permit can be constructed by Project/Desktop or appear in structured clone,
Y.Doc, causal frames, journals or actual-write evidence. The attempt-scoped generic
port performs no I/O; asynchronous resolution occurs outside the document queue and
retry starts again from the latest `replicaDoc` with a fresh preloaded resolver.

Resource proofs are strict sorted duplicate-free arrays by the restricted-JCS bytes
of the complete proof. Canvas partitions each mode independently and deterministically:
walk that order, append while the exact encoded request remains within the imported
per-request cap, otherwise close the current non-empty chunk and start the next.
Every chunk contains at least one proof. The complete discovered dependency set must
also remain within the imported count and aggregate-request-byte caps; the first
single proof, chunk or aggregate that cannot fit rejects before fact resolution or
candidate mutation. The resolver verifies every proof in a chunk atomically; it
cannot return a partial batch permit. Equality and consumption compare the exact
chunk requirements, not merely the flattened proof set.

Batching is an attempt-local dependency projection only. It never adds a proof that
is absent from the exact typed intent/history material and never widens the imported
512 KiB complete typed-intent cap; an over-cap intent rejects before dependency
batch construction.

The `generation-begin` request is constructed from the exact begin plus the imported
operation context: its `beginDigest` is the Canvas-owned digest of the complete
`GenerationBeginV2`; all other request fields equal the corresponding begin/context
values. This bounded authorization request deliberately excludes prompt bytes and
does not redeclare the imported scope.

The outer Kernel authorization already proves that every admitted mutation is
editor-authorized. `canvas.generation.dismiss/2` therefore has no second Canvas
editor-action fact or independently chosen authorization digest.

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
section 20.4. Its owner schema, protocol, canonicalizer and genesis digests are
independent mandatory identities. No detached whole-file digest,
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
  validationArtifact: ValidationArtifactRefV2
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

`PluginRequirementV2.validationArtifact.owner` is exactly `"plugin"`; its complete
imported ref, not a digest plus an inferred format, is the validation-artifact
dependency. The validated artifact must bind the byte-identical Plugin id, snapshot
digest and Plugin-state schema digest. Missing or mismatched bindings reject before
state decode or candidate mutation.

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
with or after creation logically deletes the complete group result from effective
projection: every member node and edge is hidden together and no orphan result
survives. Retained causal facts never authorize partial projection or resurrection.

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

`beginAuthorizationEpochDigest` is an opaque exact digest produced by the selected
Control verifier. Canvas neither decodes its preimage, redeclares the Control DTO,
nor recomputes its domain. The host resolver may return a `generation-begin` fact
result only after exact Control verification has bound the authorization instance to
this Canvas begin and the selected protocol. Canvas validates that result through
the generic attempt port, mints its internal permit and then compares and stores only
the verified digest. The Control-owned canonical
first-loss receipt binds the byte-identical field name and value
`beginAuthorizationEpochDigest`; raw authorization epoch ids and locally chosen
hash preimages are forbidden at this boundary.

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
validated by its declared `generation-recovery` requirement through the generic
attempt port. All valid writers produce the same single-key marker. Missing proof is
pending; noncanonical or second proof rejects.
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

The exact acyclic `BoundedOperationReceiptV2`, stable history handles,
root/transition records, history-only templates, materialized operations, footprints
and total capture/materialization functions are defined in sections 19.3 through
19.6. No receipt contains an `actualWriteEvidenceDigest`; no history template
contains a persisted Canvas entity id/incarnation; redo of pending generation is
governed only by the retained-generation lifecycle guard in section 19.5.

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
context is the exact imported `OwnerIntentValidationContextV2`; this shorthand does
not define a Canvas DTO. The
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
| `canvas.generation.dismiss/2` | exact observed begin/lifecycle; outer Kernel-verified editor authorization | byte-identical fixed dismissal marker |
| `canvas.generation.fail-recovery/2` | exact observed begin/lifecycle and canonical recovery proof fact | byte-identical fixed recovery marker |
| `canvas.plugin.creation-group.create/2` | live source, source data digest, exact `PluginRequirementV2`, current resource proof per resource node | 1..85 Plugin file nodes, 0..168 edges, aggregate <=169, `6*N+3*E+2<=512`, identical creation-group ref |

Generation begin/terminal/dismissal/recovery and `fail-owned` are not semantic Undo
roots. A Plugin group source must be a causal predecessor; every node has exact
Plugin state satisfying the requirement. Missing artifact makes validation pending,
not partial. One invalid node/edge/proof rejects the entire group. No separate Plugin
materialize alias exists.

For `canvas.generation.complete/2`, the terminal output resource is byte-identical to
`guard.resourceProof.resource`, and `terminal.outputProofDigest` is byte-identical to
`guard.resourceProof.ownerProofDigest`. Any mixed resource/proof pair rejects before
the external fact requirement is resolved.

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
creation-group restore can prove every distinct resource it introduces. A singular
proof field or a structurally open semantic-template alias is not accepted.

`canvas.undo.semantic-inverse/2` and `canvas.redo.semantic-forward/2` each bind exact
root receipt/history state plus `1..510` closed semantic operations. Expanded result
entities stay <=512 and logical writes <=512. There is no nested history operation,
generation operation, arbitrary patch or ordinary-caller semantic-operation array.

Canvas consumes the exact imported `SessionUndoCoordinatorV2`. It does not
redeclare or structurally alias the coordinator.

- only a successfully durable local undoable root enters undo and clears redo;
- remote/recovery/bootstrap frames neither enter nor mutate either stack;
- undo/redo peeks without moving, Canvas materializes against the latest
  `replicaDoc`, and the cursor moves only after the exact final replica-signed
  semantic frame crosses the durable-head barrier;
- stale guard, pending proof/artifact, cancellation or durability failure leaves both
  stacks unchanged;
- if domain commit succeeds but cursor commit fails, domain state remains committed,
  the Kernel-owned coordinator clears and reports `history-reset-after-commit`;
- restart, full rebuild, unmount and Project/Canvas scope change clear both stacks;
- raw Y.UndoManager inverse bytes never touch `candidateDoc`, `replicaDoc`, a frame
  or the causal-frame journal.

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

This is the Canvas reducer's internal owner evidence. The generated Canvas
`DocumentOwnerProtocolPortV2<"canvas">.deriveActualWriteEvidence` derives the exact
imported `ActualWriteEvidenceV2` from its branded `OwnerApplyResultV2<"canvas">`.
Canvas does not restate that shared wrapper or its digest domain. The kernel verifies
that the returned wrapper binds the verified scope, selected Canvas artifact and
exact intent digest. The two Canvas arrays are reused byte-for-byte after generic
closed-schema validation: derivation may not filter, coalesce, relabel or reorder
owner writes, and it includes every operation/history auxiliary path.

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
write-count overflow rejects before a `candidateDoc` or incoming frame reaches
`replicaDoc`.
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
   JSON and hidden-write rejection before `replicaDoc` mutation;
3. node delete versus concurrent edge create;
4. node delete versus generation completion;
5. Plugin group versus concurrent source delete, with no orphan result;
6. concurrent reparent plus every three-node containment-cycle order;
7. generation begins, manual edits, owner success/failure, dismissal, recovery and
   tombstone under every relevant order;
8. same-actor double terminal/equivocation with no arrival winner;
9. causal placement with concurrent overlap and causal successor avoidance;
10. current versus retained resource proof, including missing retained blob pending;
11. Plugin schema/snapshot/full-artifact-ref mismatch pending or rejected as
    specified, then identical state after the exact artifact fetch;
12. semantic undo/redo with intervening remote frame and every durability/cursor
    crash point; raw UndoManager origins never touch authoritative docs;
13. React Flow drag/delete/undo/plugin-source-loss/reset of exact-incarnation caches;
14. at least 10,000 generated two-/three-peer schedules spanning delete, connect,
    geometry, data, containment, generation and creation-group operations;
15. one externally allocated Canvas id round-trips byte-identically through the
    imported shared scope and Canvas genesis identity; any value rejected by the
    exact kernel scope validator, a wrong verified scope digest or a Canvas
    scope/identity mismatch rejects at the Canvas boundary;
16. two begins by one actor across authorization replacement produce distinct
    verified Control authorization-instance digests; each accepts only the
    first-loss receipt containing its byte-identical
    `beginAuthorizationEpochDigest`, while a changed authorization proof or protocol
    binding rejects;
17. every section-14 equation has exact-boundary and first-invalid fixtures,
    including all `(N,E)` boundary pairs and canonical evidence at 256 KiB and
    256 KiB plus one byte; every rejection occurs before `candidateDoc` mutation;
18. independent generators hash this exact artifact byte stream to the artifact ref
    selected by the kernel bundle and emit the same Canvas declarations/validators
    without consulting repository implementation code; swapping owner artifact,
    ordinary whole-file or protocol-bundle digests in identity/evidence rejects;
19. the unbranded Canvas definition admits only through the matching loader factory;
    owner-minted brands, cross-artifact definitions and a protocol/closure owner or
    object-identity mismatch reject before a runtime is exposed;
20. every external-fact kind covers exact request/result byte equality, wrong kind,
    request hash, fact digest, undeclared/extra consumption, missing-result pending,
    host-minted permit rejection and asynchronous retry from a changed latest
    `replicaDoc`; resource batches cover exact/first-over per-request, dependency
    count and aggregate-byte boundaries and reproduce identical greedy chunks after
    input permutation;
21. history pre-discovery and materialization receive the same branded base object,
    and materialization consumption, materialized-intent discovery and apply
    consumption are byte-identical under success; changing the base identity or any
    one set, capturing a mutable document, or reusing a resolver/permit across retry
    rejects before `candidateDoc` mutation;
22. a clean TypeScript consumer instantiates the exact Canvas specialization of the
    owner external-fact factory; a compile-negative fixture cannot provide a
    ProjectIndex resolver or dependency set, and every `rejected` factory code stops
    before fact resolution, candidate construction or mutation;
23. the privately constructed `CVXCGP02` verifier factory admits only the exact
    selected Canvas runtime object and artifact digest; cross-artifact, structural,
    disposed and restarted runtimes reject, while the callable covers the closed
    `validated | pending | rejected` result union without leaking partial identity;
24. the generated Canvas contribution contains exactly 29 sorted, unique domains,
    including `convax.canvas-derived-id/2`, and neither the carrier format literal
    nor a Canvas-private canonicalizer domain is admitted.

The bundle is falsified by any arrival-dependent canonical hash, accepted unknown
field, lost actor claim, ghost renderer node, remote-cleared undo cursor, late
terminal priority, orphan creation-group result, raw UndoManager update or Desktop-
local duplicate Canvas reducer, cross-owner Canvas id mismatch, authorization-core
receipt replay or a kernel bundle that references different Canvas artifact bytes.

## 19. Canonical state, digest and semantic-history closure

Sections 19.1 through 19.8 are the complete Canvas-owned closure for canonical
state extraction, digest recipes, actual-write evidence and semantic history. Each
reference is to this standalone annex unless it explicitly names an imported owner
artifact. No repository implementation or external prose may
supply an omitted field, recipe, transition or fallback.

### 19.1 Closure boundary

The resulting Canvas owner MUST provide one generated module containing all of:

1. the exact Y.Doc validator;
2. the CanvasCanonicalStateV2 extractor and restricted-JCS encoder;
3. the Canvas constructor for the kernel-owned OwnerCanonicalizerDescriptorV2 and
   its digest binding;
4. the complete Canvas digest-recipe table in section 19.3.3;
5. the pure typed-intent reducer and actual-write derivation;
6. the semantic-history capture and materialization total functions;
7. the section-4 external-fact request encoder/decoder and result validator;
8. the sole unbranded `SelectedDocumentOwnerArtifactDefinitionV2<"canvas">` runtime
   entry;
9. the unbranded `CVXCGP02` exact-byte parser and Canvas validation implementation
   consumed only by the selected-artifact-bound verifier factory in section 21.4.

Those outputs MUST be generated from the signed Canvas artifact. Hand-written
copies, renderer projections, Yjs internal encodings, object-enumeration order and
repository implementation code are not protocol inputs.

The generic collaboration kernel owns `OwnerCanonicalizerDescriptorV2`, its only
digest domain and the descriptor-bearing `DocumentOwnerProtocolPortV2<K>`. The
Canvas artifact MUST instantiate `DocumentOwnerProtocolPortV2<"canvas">` rather
than define a Canvas-private descriptor or protocol port. Canvas constructs only
its owner descriptor and the descriptor digest:

~~~ts
const canonicalizerDescriptor =
  canvasOwnerCanonicalizerDescriptorV2(selectedCanvasArtifactDigest)
const canonicalizerDigest = Digest(
  "convax.owner-canonicalizer-descriptor/2",
  canonicalizerDescriptor,
)
~~~

The selected artifact factory supplies these values and the generated Canvas
functions to the exact imported protocol port. This annex does not restate that
generic port's fields or mint its branded process values.

The kernel MUST verify descriptor owner/schema/digest equality and compare the port
values, Canvas genesis identity, causal-frame core, checkpoint carrier and selected
protocol artifact before accepting any update. The named root, eleven child maps,
map encodings and stored-fact projection rules are the closed Canvas clauses in
sections 5 and 19.2.1. They are bound by selectedCanvasArtifactDigest and MUST NOT
be copied into a second descriptor or digest authority.

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

The Canvas identity and genesis-core shapes are declared exactly once in section
20.4. No other section provides a structural alias or fallback.

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
  this annex removes the receipt-to-evidence back-reference instead of specifying a
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

The operation receipt has the following acyclic form:

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

`BoundedOperationReceiptV2` has no `actualWriteEvidenceDigest` field. Adding one
would form an unhashable cycle: evidence hashes the receipt write value while the
receipt would contain the evidence digest. The causal frame is the sole portable
binding of `actualWriteEvidenceDigest`. `resultEntities` remain entity-key sorted
and duplicate-free.

#### 19.3.3 Normative recipe table

The `convax.canvas-derived-id/2` byte-preimage recipe is closed by section 3. It is
the sole Canvas contribution that does not use the structured `Digest(domain,
value)` function in section 19.3.1; it remains part of the complete registry in
section 19.3.5 and has no second JCS recipe here.

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
| SemanticHistoryRootV2.materialDigest | convax.canvas-history-material/2 over CanvasHistoryMaterialCoreV2 | Excludes materialDigest; all arrays follow the section 19.5 schedule and section 19.6 algorithms |
| expectedRootReceiptDigest | convax.canvas-operation-receipt/2 over exact acyclic BoundedOperationReceiptV2 | No evidence-digest back-reference |
| expectedHistoryRootDigest | convax.canvas-semantic-history-root/2 over exact SemanticHistoryRootV2 | Includes materialDigest |
| priorHistoryDigest, expectedHistoryStateDigest | convax.canvas-semantic-history-state/2 over CanvasSemanticHistoryStateCoreV2 | transitions operation-key sorted; excludes the digest being computed |
| CanvasSemanticOperationV2.guardDigest | convax.canvas-semantic-guard/2 over CanvasSemanticGuardCoreV2 | Excludes guardDigest; null guard is present JSON null |
| SemanticHistoryTransitionV2.materializationDigest | convax.canvas-history-materialization/2 over CanvasHistoryMaterializationCoreV2 | Excludes transition and its digest |
| SemanticHistoryTransitionV2.resultFootprintDigest | convax.canvas-history-footprint/2 over CanvasHistoryFootprintCoreV2 | Exact resolved post-materialization footprint; all three arrays and nested incidentLiveEdges follow section 19.3.2 ranks, sorting, duplicate and empty rules |
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
  from section 19.2.2. It is not a Canvas-owned recipe or Canvas registry delta;
- contentDigest is ordinary content SHA-256 from the Project/blob protocol;
- ownerProofDigest, outputProofDigest and recovery proofDigest are accepted only
  through the matching declared owner-fact requirement and Canvas-internal permit;
- Plugin snapshotDigest, pluginStateSchemaDigest and the complete validationArtifact
  ref are accepted only through the exact Plugin artifact permit;
- beginAuthorizationEpochDigest is an opaque exact authorization-instance digest
  accepted only through the selected Control verifier;
- toolRefDigest is accepted only through the generation-begin permit and is never
  invented or normalized by Canvas.

If the external owner cannot identify the exact recipe and selected artifact for an
opaque digest, validation is pending or rejected. Canvas MUST NOT guess.

#### 19.3.5 Exact Canvas domain-registry contribution

The Canvas owner contributes exactly these 29 strict UTF-8-sorted, duplicate-free
domains to the kernel-owned protocol registry:

~~~text
convax.canvas-actual-write-value/2
convax.canvas-containment-slot/2
convax.canvas-creation-group-member-set/2
convax.canvas-data-register/2
convax.canvas-derived-id/2
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

`convax.canvas-canonicalizer/2` is not a Canvas contribution. The kernel owner merges
this exact set with other owner contributions and owns final registry cardinality.
Canvas generation rejects if its contribution has other than 29 members, omits a
listed domain, contains a duplicate, includes the forbidden private canonicalizer
domain or treats a canonical-state format as a digest domain.

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

History templates use this closed union; they do not reuse ordinary create intent
types and contain no node id, edge id, incarnation, relation id or group id:

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

For `creation-group.restore`, capture-history encodes `source` as a handle
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
result described by section 19.6.3. A concurrent lifecycle change after guard creation
rejects the candidate. Redo never restarts external work.

materializedGuard.op MUST equal template.op. derived is sorted by decoded ordinal,
unique and contains exactly the objects allocated by that template. Proofs sort by
their embedded resource ordering and contain exactly one proof for every distinct
resource introduced by the operation. An operation that introduces no resource has
an empty array. A singular retained-resource proof field is invalid because it
cannot represent a multi-resource group restore.

A creation-group.restore operation contains exactly one derived creation-group
object whose handle equals template.groupHandle. Its derived group ordinal precedes
all of its derived node/edge ordinals. No other operation in the transition may
carry that group handle or produce any of its node/edge handles.

#### 19.5.4 Root and transitions

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

#### 19.6.1 Capture history root

The total function input is the validated authored base, exact root intent, committed
post state and pure reducer result. It performs:

1. Reject non-undoable intent kinds.
2. Compute affected entity handles from the exact table below.
3. Capture only closed effective semantic values from authored base and committed
   post; never capture React state, current guards, actor identity or Yjs structs.
4. Partition affected creation-group members, validate one byte-identical ref per
   original groupId and assign groupHandles by section 19.5.1. Build inverse and
   forward templates from the table. A group-owned node appears only inside its
   creation-group.restore producer, never in an ordinary node.create template.
5. Build producerByNodeHandle and producerByEdgeHandle, reject duplicate producers,
   missing/late handle-source producers and cycles, compute the exact rank-plus-
   topological schedule in section 19.5.2 and assign initialBindings. The same stored
   handles and dependency graph MUST produce the same schedule in every later
   materialization direction that contains those restore templates.
6. Collect every resource introduced by either direction, sort by the resource rule
   and deduplicate by complete JCS equality. A contentDigest collision with unequal
   complete resource refs rejects.
7. Compute CanvasHistoryMaterialCoreV2 and materialDigest.
8. Create the history root and operation receipt in the same candidate transaction.

#### 19.6.2 Materialize history

The total function input is one exact `OwnerValidatedStateV2<"canvas">` produced by
validating the latest `replicaDoc`, exact history guard, one exact imported
`OwnerIntentConstructionContextV2`, direction and one fresh
`OwnerExternalFactPortV2<"canvas">` bound to the history-discovered dependencies.

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
6. Rebuild both producer maps and the exact section 19.5.2 rank-plus-topological
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
   the original placeholder. A failure discards the provisional state and all local
   binding writes; `replicaDoc`, the causal-frame journal and coordinator remain
   unchanged.
9. Derive resultBindings for every root handle. A tombstoned logical entity binds
   null; unchanged entities retain their ref; creations bind their new ref.
10. Compute materializationDigest and apply the whole operation array to one isolated
    candidate. Compute resultFootprintDigest from the validated post state.
11. Write exactly one operation receipt and one transition. A failure at any step
    leaves `candidateDoc`, `replicaDoc`, the causal-frame journal and coordinator
    unchanged.

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

Canvas artifact generation MUST emit the types, domains, validators, reducers,
write-count equations, canonicalizer constructor and conformance fixtures defined by
this annex from one selected source. The kernel integration is an external seam: it
must select this exact artifact, merge its 29-domain contribution and bind the
resulting descriptor without copying Canvas schema. Final bundle identities and
signatures are generated only after all five candidate files are frozen.

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
- one changed actual-write value with unchanged path/count rejects before
  `replicaDoc`;
- the generated owner-runtime entry is only
  `SelectedDocumentOwnerArtifactDefinitionV2<"canvas">`; it contains no copied
  Kernel brand and admits only through the matching loader factory;
- all four Canvas external-fact request/result codecs round-trip byte-identically,
  reject a changed kind/request hash/fact digest, and produce only Canvas-internal
  permits after exact attempt-port binding;
- ordinary and history dependency discovery/consumption ledgers satisfy section
  20.2 with one branded base identity per attempt under missing-result retry,
  changed latest `replicaDoc` and cross-artifact rejection;
- the generated Canvas domain contribution has exactly the 29 listed members and
  contains no `convax.canvas-canonicalizer/2`.

Any runtime-specific branch or test expectation not derivable from this annex
falsifies closure.

## 20. Selected Canvas owner runtime

This section specializes the kernel-owned generic runtime for the Canvas owner. The
generic runtime and capability types remain exclusively kernel-owned; this annex
defines only Canvas inspection, dependency use, history materialization and genesis
identity behavior. No structurally similar private ABI is accepted.

### 20.1 Imported generic ABI and selected specialization

Canvas uses only the exact imports in section 2. The owner-runtime subset is:

```text
SelectedDocumentOwnerArtifactDefinitionV2<K>
SelectedDocumentOwnerArtifactFactoryV2<K>
DocumentOwnerRuntimeV2<K>
DocumentOwnerProtocolDefinitionV2<K>
DocumentOwnerProtocolPortV2<K>
OwnerIntentClosureDefinitionV2<K>
OwnerIntentClosurePortV2<K>
OwnerHistoryMaterializationDefinitionV2<K>
OwnerHistoryMaterializationPortV2<K>
OwnerIntentConstructionContextV2
OwnerIntentDependencyContextV2
OwnerIntentValidationContextV2
OwnerIntentDependenciesV2<K>
OwnerExternalFactRequirementV2<K>
OwnerValidationArtifactResolveResultV2
OwnerExternalFactResolveResultV2<K>
OwnerExternalFactResolverDefinitionV2<K>
OwnerExternalFactPortV2<K>
CreateOwnerExternalFactAttemptPortResultV2<K>
OwnerExternalFactPortFactoryV2<K>
OwnerValidatedStateV2<K>
OwnerApplyResultV2<K>
InspectedOwnerIntentV2
OwnerProcessValueFactoryV2<K>
```

The Canvas artifact's only owner-runtime entry is one unbranded
`SelectedDocumentOwnerArtifactDefinitionV2<"canvas">`. Its `createDefinitions`
uses the exact loader-supplied `OwnerProcessValueFactoryV2<"canvas">` and returns
only `DocumentOwnerProtocolDefinitionV2<"canvas">` plus
`OwnerIntentClosureDefinitionV2<"canvas">`. Canvas never mints, casts or
structurally imitates a Kernel-branded factory, runtime, port or process value.

The bundle loader alone constructs
`SelectedDocumentOwnerArtifactFactoryV2<"canvas">` and calls `createRuntime` with
the unbranded Canvas definition. A non-rejected result is exactly
`DocumentOwnerRuntimeV2<"canvas">`; its artifact digest equals the loader-selected
Canvas artifact, `closurePort.history` is non-null,
`closurePort.protocolPort` is object-identical to `runtime.protocolPort`, and the
latter is `DocumentOwnerProtocolPortV2<"canvas">`. The runtime's
`externalFactPortFactory` is the exact loader-created
`OwnerExternalFactPortFactoryV2<"canvas">`. Canvas must not add a self-reported runtime
owner/schema field; selected artifact identity, the exact port objects and loader
registry are the complete binding. React Flow, renderer/DOM state, clocks, network,
filesystem, another Y.Doc and Desktop services are forbidden dependencies of this
headless closure.

Base validation and reducer application expose only
`OwnerValidatedStateV2<"canvas">` and `OwnerApplyResultV2<"canvas">` created by that
captured process-value factory. Cross-owner, cross-artifact, structural, disposed or
restarted values reject; Canvas has no public constructor, cast escape hatch or
serializable representation for either value.

`OwnerIntentConstructionContextV2` is the imported pre-intent-digest context.
`OwnerIntentDependencyContextV2` is its imported exact-intent-digest extension, and
`OwnerIntentValidationContextV2` is the kernel alias consumed by the protocol port.
Canvas does not restate any of those fields. The Canvas closure discovers exact
`OwnerIntentDependenciesV2<"canvas">`; the host implements one unbranded, Canvas-scoped
`OwnerExternalFactResolverDefinitionV2<"canvas">` using the section-4 public
request/result codec. The runtime's exact external-fact factory receives only the
declared `OwnerIntentDependenciesV2<"canvas">` and that resolver. Its exact
`CreateOwnerExternalFactAttemptPortResultV2<"canvas">` must be `created` before the
attempt may continue; `rejected` terminates before fact resolution, candidate
construction or mutation. The created branch alone contains one fresh synchronous
`OwnerExternalFactPortV2<"canvas">`. There is no caller-selected owner parameter and
no Canvas runtime can create a ProjectIndex fact port.
Validation artifacts return defensive immutable bytes. Owner facts return untrusted
values that Canvas must validate into its own internal permit. The attempt port
records both consumption sets and performs no I/O, Plugin/generator execution or
fact discovery. Pending resolution discards the attempt; asynchronous work occurs
outside the queue, and retry starts from the latest `replicaDoc`.

### 20.2 Canvas inspection, history and dependency equality

`inspectIntent` accepts the closed Canvas union. Undo/redo semantic intents return
`{kind:"history", direction, rootOperationId}` with byte-exact values; every other
admitted mutation returns `{kind:"ordinary"}`; unknown or reclassified values
reject. The ordinary local entry requires `ordinary` before fact resolution,
authority, allocation or candidate creation. The public history entry accepts only
operation id, direction and optional signal.

Canvas supplies the unbranded
`OwnerHistoryMaterializationDefinitionV2<"canvas">`; the loader wraps it as
`OwnerHistoryMaterializationPortV2<"canvas">`. History dependency discovery first
receives direction, root operation id, `OwnerIntentConstructionContextV2` and the
exact branded base produced by validating the latest `replicaDoc`. After every
dependency is preloaded, the `materialize` call receives the same values, the same
base object identity and a fresh
`OwnerExternalFactPortV2<"canvas">` and returns only an untrusted intent value,
`pending` or `rejected`. The returned value gains no authority until restricted-JCS
encoding, protocol-port decoding and inspection succeed. Only then may the kernel
compute its intent digest and construct `OwnerIntentDependencyContextV2` for
ordinary dependency discovery and validation.

Local history runs inside the document queue in this exact order:

```text
latest `replicaDoc` -> validate branded base -> current root peek
-> history dependency discovery with that base
-> preload outside queue if needed -> discard base and restart from latest `replicaDoc`
-> validate new base and re-peek -> fresh declared attempt port
-> history materialize with the same new base object and construction context
-> restricted-JCS encode -> protocol decode -> inspect direction/root equality
-> compute intent digest -> dependency context -> ordinary dependency discovery
-> exact history/ordinary/consumed equality -> isolated `candidateDoc` apply and post validation
-> final replica-signed frame
-> immutable object -> replication outbox -> causal-frame journal -> sole durable head
-> apply the exact frame to `replicaDoc` -> projection invalidation -> cursor advance
```

A pending retry retains no old root, cursor, branded base, resolver, permit,
consumption set or materialized bytes. The history discovery and materialization
calls in one non-pending attempt receive the same branded base object; a captured or
later-observed mutable document rejects. Local ordinary operations require byte-identical
`discovered == attempt-declared == apply-consumed` across both validation artifacts
and external fact requirements. Local history additionally requires
`history-discovered == materialize-consumed == materialized-intent-discovered ==
apply-consumed`. Plugin refs equal exactly the Plugin subset in the selected
`ValidationArtifactSetV2`. No second long-lived document or provisional
business-command journal exists between `replicaDoc` and `candidateDoc`.

An incoming or recovery history frame is already a signed typed intent. It executes
decode, inspect, exact dependency discovery/resolution and isolated apply, but never
calls history discovery/materialization, a Plugin executable, generator, local
constructor, signer or allocator. Recovery may reuse only exactly named immutable
artifacts and freshly verified owner-fact results. Any dependency or consumption
ledger mismatch is the kernel-defined invalid-frame/owner-result failure.

### 20.3 Runtime falsifiers

Canvas runtime conformance is falsified if collaboration imports Canvas to obtain a
generic type; if Canvas exports or stamps a Kernel brand instead of its unbranded
definition; if an ordinary entry accepts a history intent; if retry reuses a
pre-pending root/resolver/permit; if incoming/recovery materializes history; if a
fact port performs I/O or returns a host-minted Canvas permit; if the factory
returns a port for a non-Canvas dependency owner or any `rejected` result reaches
fact resolution; if history and final
intent dependency sets differ; if ports from different artifact instances can be
mixed; or if renderer/transient state affects canonical bytes.

### 20.4 Canvas genesis identity

The Canvas genesis schemas are:

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
GenesisCore. Canvas does not redeclare or decode the Control-owned checkpoint core.
A `canvas-genesis-proof` resolver must verify the complete checkpoint wrapper, full update, state vector and
canonical Canvas state, then return the identity's exact dependency frame digest;
checking wrapper fields alone is invalid.

`projectIndexRouteDependencyFrameDigest` is an opaque predecessor witness, not
current route authority. External Project composition selects and proves the exact
accepted predecessor frame before constructing or admitting genesis. Canvas only
stores the supplied digest, binds it into `genesisDigest` and later returns it from
complete genesis validation; it does not decode Project route intents, inspect
Project exact-base state or execute a Project reducer.

## 21. Canvas genesis-proof carrier

This section is the sole Canvas owner of the `CVXCGP02` carrier grammar and
Canvas-owned genesis-state verification. The carrier supplies bounded validation
material; it is not a Project reset command, native-admission capability, resolver
or durable store. No implementation-specific fallback decoder is accepted.

### 21.1 Exact binary envelope

```text
8 bytes  ASCII "CVXCGP02"
8 bytes  unsigned big-endian uint64 indexLength
N bytes  exact restricted-JCS CanvasGenesisProofCarrierIndexV2
...      contiguous exact section bytes
```

The carrier is proof input addressed by the existing checkpoint object identity G.
It is not an independently addressed portable object and
`convax.canvas-genesis-proof-carrier/2` is a format literal, not a digest domain.

The complete carrier, including magic, index length, index and all sections, is at
most the Control-owned `canvasGenesisProofCarrierBytes` limit. The receiver checks
the outer limit and `indexLength` arithmetic before allocation.

### 21.2 Closed section identities

Every section carries an ordinary SHA-256 of its exact bytes and one closed,
kind-specific semantic subject. There is no generic `subjectDigest` whose digest
domain is selected by an implementation.

```ts
interface CanvasGenesisProofCarrierSectionLocationV2 {
  byteOffset: Uint64V2
  byteLength: Uint64V2
  sha256: DigestV2
}

type CanvasGenesisProofCarrierSectionV2 =
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "checkpoint-author-credential"
      ordinal: "0"
      subject: {
        kind: "replica-actor-credential-core"
        coreDigest: DigestV2
      }
    })
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "checkpoint-author-membership-snapshot"
      ordinal: "0"
      subject: {
        kind: "membership-snapshot-core"
        coreDigest: DigestV2
      }
    })
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "checkpoint-author-reservation-receipt"
      ordinal: "0"
      subject: {
        kind: "replica-id-reservation-receipt-core"
        coreDigest: DigestV2
      }
    })
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "checkpoint-canonical-state"
      ordinal: "0"
      subject: {
        kind: "canonical-state"
        canonicalStateDigest: DigestV2
      }
    })
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "checkpoint-full-update"
      ordinal: "0"
      subject: {
        kind: "yjs-update"
        fullUpdateDigest: DigestV2
      }
    })
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "checkpoint-state-vector"
      ordinal: "0"
      subject: {
        kind: "state-vector"
        stateVectorDigest: DigestV2
      }
    })
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "checkpoint-wrapper"
      ordinal: "0"
      subject: {
        kind: "replica-checkpoint-object"
        checkpointObjectDigest: DigestV2
      }
    })
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "service-trust-bundle"
      ordinal: "0"
      subject: {
        kind: "service-trust-bundle-core"
        coreDigest: DigestV2
      }
    })
  | (CanvasGenesisProofCarrierSectionLocationV2 & {
      kind: "validation-artifact"
      ordinal: Uint32V2
      subject: {
        kind: "validation-artifact"
        artifact: ValidationArtifactRefV2
      }
    })
```

`sha256` is always:

```text
SHA-256(exact section bytes)
```

It is an ordinary byte hash, not a registered structured digest. Each semantic
subject is independently recomputed with the subject type's existing registered
digest formula.

### 21.3 Closed carrier index

```ts
interface CanvasGenesisProofCarrierIndexV2 {
  format: "convax.canvas-genesis-proof-carrier/2"

  scope: DocumentScopeV2

  checkpointObjectDigest: DigestV2
  fullUpdateDigest: DigestV2
  stateVectorDigest: DigestV2
  canonicalStateDigest: DigestV2

  checkpointAuthorCredentialCoreDigest: DigestV2
  checkpointAuthorReservationReceiptCoreDigest: DigestV2
  checkpointAuthorMembershipSnapshotCoreDigest: DigestV2
  serviceTrustBundleCoreDigest: DigestV2

  ownerSchemaDigest: DigestV2
  canonicalizerDigest: DigestV2

  validationArtifactSetDigest: DigestV2
  validationArtifacts: readonly ValidationArtifactRefV2[]

  sections: readonly CanvasGenesisProofCarrierSectionV2[]
  totalSectionBytes: Uint64V2
  protocolDigest: DigestV2
}
```

`authorityDependencyCoreDigests` and the short aliases
`credentialCoreDigest`, `reservationReceiptCoreDigest`,
`membershipSnapshotCoreDigest` and `trustBundleDigest` are unknown and reject.
Authority dependencies use only the four named fields above.

`validationArtifacts` is strict sorted and duplicate-free by:

```text
(owner raw UTF-8, format raw UTF-8, artifactDigest decoded bytes)
```

It contains exactly the refs in the selected `ValidationArtifactSetV2`, in the same
order, and has cardinality 4 through 64. Its exact set digest recomputes as:

```text
SHA-256(
  UTF8("convax.validation-artifact-set/2") || 0x00 ||
  JCS({
    format: "convax.validation-artifact-set/2",
    artifacts: validationArtifacts
  })
)
```

and must equal `validationArtifactSetDigest`.

There are exactly eight singleton sections and exactly
`validationArtifacts.length` validation-artifact sections. Section order is:

```text
checkpoint-author-credential/0
checkpoint-author-membership-snapshot/0
checkpoint-author-reservation-receipt/0
checkpoint-canonical-state/0
checkpoint-full-update/0
checkpoint-state-vector/0
checkpoint-wrapper/0
service-trust-bundle/0
validation-artifact/0
...
validation-artifact/n-1
```

This is raw-UTF-8 kind order followed by numeric ordinal order. Validation-artifact
ordinal `i` has a byte-identical `subject.artifact` to `validationArtifacts[i]`.

Offsets start at zero relative to the first byte following the index. They are
contiguous and satisfy:

```text
sections[0].byteOffset == 0

sections[i].byteOffset
  == sections[i - 1].byteOffset + sections[i - 1].byteLength

totalSectionBytes
  == sum(section.byteLength for every section)
```

Unsigned arithmetic overflow, gaps, overlaps, a trailing byte, a missing singleton,
an additional singleton, a skipped/repeated ordinal or a subject/index mismatch
rejects before semantic decoding.

Exact subject mirrors are:

```text
checkpoint-wrapper.subject.checkpointObjectDigest
  == index.checkpointObjectDigest

checkpoint-full-update.subject.fullUpdateDigest
  == index.fullUpdateDigest

checkpoint-state-vector.subject.stateVectorDigest
  == index.stateVectorDigest

checkpoint-canonical-state.subject.canonicalStateDigest
  == index.canonicalStateDigest

checkpoint-author-credential.subject.coreDigest
  == index.checkpointAuthorCredentialCoreDigest

checkpoint-author-reservation-receipt.subject.coreDigest
  == index.checkpointAuthorReservationReceiptCoreDigest

checkpoint-author-membership-snapshot.subject.coreDigest
  == index.checkpointAuthorMembershipSnapshotCoreDigest

service-trust-bundle.subject.coreDigest
  == index.serviceTrustBundleCoreDigest
```

### 21.4 Selected-artifact-bound Canvas validation callable

Canvas owns one exact-byte verifier capability. Project captures this callable; it
does not capture a generic Canvas runtime or reconstruct the carrier algorithm.

```ts
type CanvasGenesisProofCarrierExactBytesV2 = Readonly<Uint8Array>

interface ValidatedCanvasGenesisIdentityV2 {
  readonly checkpointObjectDigest: DigestV2
  readonly scope: DocumentScopeV2
  readonly identity: CanvasIdentityV2
  readonly authorActorId: ActorIdV2
  readonly authorCredentialCoreDigest: DigestV2
}

type ValidateCanvasGenesisProofCarrierResultV2 =
  | Readonly<{
      status: "validated"
      exactBytesSha256: DigestV2
      canvasArtifactDigest: DigestV2
      identity: ValidatedCanvasGenesisIdentityV2
    }>
  | Readonly<{
      status: "pending"
      exactBytesSha256: DigestV2
      canvasArtifactDigest: DigestV2
      code: "canvas-genesis-proof-dependency-pending"
    }>
  | Readonly<{
      status: "rejected"
      exactBytesSha256: DigestV2
      canvasArtifactDigest: DigestV2
      code:
        | "canvas-genesis-proof-envelope-invalid"
        | "canvas-genesis-proof-limit-exceeded"
        | "canvas-genesis-proof-section-invalid"
        | "canvas-genesis-proof-authority-invalid"
        | "canvas-genesis-proof-artifact-mismatch"
        | "canvas-genesis-proof-state-invalid"
    }>

declare const canvasGenesisProofCarrierVerifierBrandV2: unique symbol
declare const canvasGenesisProofCarrierVerifierFactoryBrandV2: unique symbol

interface CanvasGenesisProofCarrierVerifierV2 {
  (
    exactBytes: CanvasGenesisProofCarrierExactBytesV2,
  ): ValidateCanvasGenesisProofCarrierResultV2
  readonly canvasArtifactDigest: DigestV2
  readonly [canvasGenesisProofCarrierVerifierBrandV2]: true
}

type CreateCanvasGenesisProofCarrierVerifierResultV2 =
  | Readonly<{
      status: "created"
      verifier: CanvasGenesisProofCarrierVerifierV2
    }>
  | Readonly<{
      status: "rejected"
      code: "canvas-runtime-artifact-mismatch" | "canvas-runtime-invalid"
    }>

interface CanvasGenesisProofCarrierVerifierFactoryV2 {
  readonly canvasArtifactDigest: DigestV2
  createVerifier(
    runtime: DocumentOwnerRuntimeV2<"canvas">,
  ): CreateCanvasGenesisProofCarrierVerifierResultV2
  readonly [canvasGenesisProofCarrierVerifierFactoryBrandV2]: true
}
```

After the four-artifact bundle loader selects the exact Canvas artifact and obtains
its Kernel-created `DocumentOwnerRuntimeV2<"canvas">`, the Canvas package's private
constructor creates one `CanvasGenesisProofCarrierVerifierFactoryV2` bound to that
selected artifact digest. There is no public structural factory constructor. The
factory accepts only a runtime whose `artifactDigest` is byte-equal to its captured
`canvasArtifactDigest`; it registers the exact runtime object identity and returns a
callable only through `created`. A structural, cross-artifact, disposed or restarted
runtime returns `rejected`. The callable and factory are Canvas-owned process
capabilities, not Kernel brands, a second owner runtime or serializable authority.

The callable defensively copies the exact `CVXCGP02` bytes, computes
`exactBytesSha256` as ordinary SHA-256 and first validates section structure,
ordinary hashes and the historical author closure using the exact selected protocol
artifacts. It then passes the Canvas-owned checkpoint/update/state material through
the privately bound exact runtime. It is synchronous and performs no I/O, discovery,
network access or persistence. A missing already-selected immutable dependency is
`pending`; retry uses a fresh invocation and retains no decoded view or temporary
document.

Canvas validation performs all of the following:

1. Decode the exact checkpoint wrapper and recompute its complete object identity G.
2. Require its scope, protocol, schema, canonicalizer, artifact-set, update,
   state-vector and canonical-state fields to equal the carrier index.
3. Apply the exact update-v1 bytes to a fresh empty Y.Doc.
4. Require byte-identical re-encoding by `Y.encodeStateAsUpdate`.
5. Require byte-identical `Y.encodeStateVector`.
6. Invoke the selected Canvas canonicalizer and require its exact canonical JCS
   bytes and canonical-state digest.
7. Validate the closed Canvas roots and require exactly one `CanvasIdentityV2`.
8. Require the identity's scope, Canvas id, owner schema, protocol and canonicalizer
   to equal the checkpoint and carrier.
9. Destroy the temporary Y.Doc and every unretained decoded view on success,
   rejection or exception.

React Flow state, renderer measurements, active selection, viewport, clocks,
filesystem state, network state, another Y.Doc and current Project route state are
forbidden Canvas-verifier inputs.

Every returned object is fresh and deeply immutable. Its `canvasArtifactDigest`
equals the callable property and the privately bound runtime artifact digest.
Project may bind the exact callable invocation, result object and input byte object
inside one private attempt registry, but the result itself is not serializable
authority, a causal dependency, a Project mutation permit or a replacement for
exact checkpoint bytes. Only `validated` exposes
`ValidatedCanvasGenesisIdentityV2`; neither `pending` nor `rejected` carries a
partial identity.

### 21.5 Predecessor-witness boundary

Complete carrier and Canvas validation returns the exact
`CanvasIdentityV2.projectIndexRouteDependencyFrameDigest`. This is an
authenticated Canvas genesis observation, not a Project mutation permit, route
lookup hint or sufficient frame proof. Canvas neither reads an external hint nor
opens a Project base-reference phase. External composition owns comparison to and
resolution of the accepted predecessor frame.

The portable Canvas owner dependency remains exactly:

```ts
{
  kind: "canvas-genesis-proof"
  digest: checkpointObjectDigest
}
```

No Project route frame, reset carrier, native path or current-route DTO enters this
owner dependency. The temporary Y.Doc is destroyed on every exit and is never
installed as a live replica.

### 21.6 Carrier falsifiers

Canvas carrier conformance is falsified if:

- a section uses an untyped generic subject digest;
- `authorityDependencyCoreDigests` is accepted;
- a validation-artifact ref or ordinal differs from the selected artifact set;
- Canvas reads a Project reset carrier, current route facts or a native store;
- the identity predecessor digest is treated as sufficient Project frame evidence;
- Canvas opens a Project base-reference phase or executes a Project reducer;
- Project captures a generic Canvas runtime instead of the exact registered
  `CanvasGenesisProofCarrierVerifierV2` callable;
- the verifier is structurally constructed, or its runtime object identity and
  artifact digest do not both match the privately selected Canvas artifact;
- `pending` or `rejected` exposes a partial identity, or any result's byte hash or
  artifact digest differs from its exact invocation and callable binding;
- a Canvas verifier uses React Flow or another ambient store;
- a malformed section reaches the selected Canvas runtime;
- the temporary validation Y.Doc survives success, rejection or exception;
- the carrier format is added as a digest domain.
