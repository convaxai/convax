# Convax P2P v10 Canvas owner-closure normative patch proposal

Status: **revision proposal; not a signed protocol artifact**.

This file is the only authority for the proposed correction. It is written so that
its clauses can be mechanically transplanted into the Canvas owner artifact and the
generic bundle declarations. It MUST NOT be treated as an implementation oracle,
MUST NOT change a pinned digest by implication, and MUST NOT make an existing
signature valid. The Canvas artifact, kernel bundle, main specification and all
detached review pins remain rejected until the complete regenerated artifact set is
reviewed and signed together.

This proposal deliberately makes a breaking protocol change. Existing
convax.canvas.v2 bytes are unsupported by the resulting schema and may be preserved
only for explicit user-confirmed reset. No implementation-dependent migration is
defined.

## 1. Closure boundary

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

## 2. Exact canonical state

### 2.1 Canonical collection codecs

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

### 2.2 Canonicalizer identity and genesis binding

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

## 3. Complete Canvas digest ledger

### 3.1 Common digest function and collection rules

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

### 3.2 Exact recipe inputs

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

### 3.3 Normative recipe table

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

### 3.4 Imported and opaque digests

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

### 3.5 Exact domain-registry delta and cardinality

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

## 4. Actual-write evidence closure

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

## 5. History identity, templates and transitions

### 5.1 Stable history handles

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

### 5.2 History-only templates

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

### 5.3 Materialized operation closure

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

### 5.4 Root and transition replacement

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

## 6. Total semantic-history algorithms

### 6.1 CaptureHistoryRootV2

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

### 6.2 MaterializeHistoryV2

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

### 6.3 Exact 14-intent capture table

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

## 7. Golden vectors

Vectors A through E use lowercase SHA-256 hex, UTF-8, one zero separator and the
exact JCS shown. Vector F is a non-hash scheduling golden over the same closed
history types and introduces no digest domain. All vectors MUST be reproduced by at
least two independent generators before the artifact can be signed. Every expected
hash and scheduled ordinal below is normative together with this file.

### Vector A: kernel owner-canonicalizer descriptor instance

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

### Vector B: effective data

~~~text
domain:
convax.canvas-effective-data/2

JCS:
{"data":{"format":"convax.canvas-node-data/2","instructions":null,"kind":"agent","title":"A"},"format":"convax.canvas-effective-data/2"}

SHA-256:
8175e6a7eede34bec6869d37ed6629135741bb7727eb97d2bd93f36000e2a42f
~~~

### Vector C: empty obstacle projection

~~~text
domain:
convax.canvas-obstacle-projection/2

JCS:
{"format":"convax.canvas-obstacle-projection/2","obstacles":[]}

SHA-256:
5317e3704fa88e76024939abdfabe5dea30ef67301dd37ab626bc8f5dfa72874
~~~

### Vector D: metadata present null

~~~text
domain:
convax.canvas-metadata-effective/2

JCS:
{"field":"description","format":"convax.canvas-metadata-effective/2","value":null}

SHA-256:
21d7c073cf0c363eb1d884bf7ad77f9fc087750679d00580c427c24154a91f9a
~~~

### Vector E: actual-write explicit null

~~~text
domain:
convax.canvas-actual-write-value/2

JCS:
{"entityId":"node/n_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/ni_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","entityKind":"node","field":"creationGroup","format":"convax.canvas-actual-write-value/2","path":"nodes/node/n_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/ni_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/creationGroup","value":{"presence":"present-null","value":null}}

SHA-256:
fffb72be980a00d8ed0acebf5768d73a0da53dfef751887b8a78bb7b8ae4dd52
~~~

### Vector F: nested creation-group dependency schedule

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

## 8. Required regeneration and acceptance

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

## 9. Red-team assessment

Strongest objections:

1. The generic descriptor does not enumerate Canvas root/map codecs, so it may look
   too weak to identify the Canvas canonicalizer. Duplicating those fields would be
   worse: the exact root/map/projection algorithm is already part of the selected
   Canvas artifact and is therefore bound by ownerSchemaDigest. The kernel descriptor
   independently binds only owner, owner schema, canonical-state format, exact byte
   codec and fail-closed policy, leaving one authority for each fact.
2. Full stored-state canonicalization is larger than effective projection. This is
   deliberate: losing claims, tombstones and history can affect future validation,
   retention or projection. Omitting them permits hidden writes outside the signed
   canonical state.
3. Transition bindings and hidden losing outputs add history complexity. Without
   them, redo-created identities cannot be targeted by the next undo, and concurrent
   redo produces multiple visible copies. Nested Plugin result chains additionally
   require a deterministic dependency schedule; ordinary pre-creation would discard
   their creationGroup authority. The simpler model is not closed.

Falsification criteria:

- two independent implementations disagree on any byte, digest, binding, ordinal,
  materialized template or effective transition;
- a visible-equivalent hidden-state mutation leaves canonical-state bytes unchanged;
- a repeated undo targets a tombstoned original identity after redo;
- same-root source/result deletion cannot restore a group against the newly rebound
  source handle;
- a valid acyclic nested creation-group chain requires ordinary node.create for a
  group result, loses the source's creationGroup, produces a different schedule under
  input permutation, or cannot restore every group against the exact new predecessor;
- a duplicate group/node/edge producer or source dependency cycle reaches ordinal
  allocation, provisional binding publication or candidate mutation;
- pending-generation redo requires the tombstoned original placeholder to be live;
- footprint digest changes when only pre-canonical enumeration order changes;
- concurrent redo leaves more than one visible binding for a logical handle;
- a stale affected remote edit is silently overwritten or deleted;
- null, empty and absent produce the same accepted preimage;
- the registry contains other than 123 domains after the exact Canvas and
  Owner/Project deltas merge, or admits `convax.canvas-canonicalizer/2`.

Architecture score for this proposal: **9.1/10 before independent review**.
Deductions are for the required atomic four-artifact regeneration, the need to
regenerate write-count caps after the transition expansion, and the absence of
generated machine validators in this proposal. The remaining work is nonfatal only
because this file remains a proposal and explicitly blocks signature/implementation
until those generated outputs and three independent reviews agree; none may be
waived at signature time.
