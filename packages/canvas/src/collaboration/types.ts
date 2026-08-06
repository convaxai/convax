import type {
  ActorId,
  CanvasId,
  Digest,
  DocumentScopeDigest,
  DocumentScope,
  Id128,
  OwnerCanonicalizerDescriptor,
  PortableStamp,
  Uint32,
  Uint64,
  ValidationArtifactRef,
} from "@convax/collaboration"

export type {
  ActorId,
  CanvasId,
  Digest,
  DocumentScopeDigest,
  DocumentScope,
  Id128,
  OwnerCanonicalizerDescriptor,
  PortableStamp,
  Uint32,
  Uint64,
  ValidationArtifactRef,
}

export type CanvasScopeIdV2 = DocumentScopeDigest
export type CanvasOperationIdV2 = Id128

export interface CanvasEntityRefV2 {
  readonly kind: "node" | "edge"
  readonly id: string
  readonly incarnation: string
}

export interface StampedClaimV2<T> {
  readonly format: "convax.canvas-stamped-claim/2"
  readonly stamp: PortableStamp
  readonly value: T
}

export interface CanvasPointV2 {
  readonly x: number
  readonly y: number
}

export interface CanvasSizeV2 {
  readonly width: number
  readonly height: number
}

export interface CanvasResourceRefV2 {
  readonly format: "convax.canvas-resource-ref/2"
  readonly uri: string
  readonly mediaClass: "text" | "image" | "video" | "audio" | "file"
  readonly mime: string
  readonly byteLength: Uint64
  readonly contentDigest: Digest
  readonly ownerProofDigest: Digest
}

export type CanvasResourceProofRefV2 =
  | {
      readonly format: "convax.canvas-resource-proof-ref/2"
      readonly mode: "current-owner-state"
      readonly resource: CanvasResourceRefV2
      readonly ownerProofDigest: Digest
      readonly requireCurrentLiveVersion: true
    }
  | {
      readonly format: "convax.canvas-resource-proof-ref/2"
      readonly mode: "retained-canvas-history"
      readonly sourceState: "history-root-pre" | "history-root-post" | "current-applied-post" | "last-history-post"
      readonly sourceOperationId: CanvasOperationIdV2
      readonly sourceNode: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly sourceDataDigest: Digest
      readonly resource: CanvasResourceRefV2
      readonly requireExactRetainedMaterial: true
    }

export interface PluginRequirementV2 {
  readonly pluginId: string
  readonly snapshotDigest: Digest
  readonly pluginStateSchemaDigest: Digest
  readonly validationArtifact: ValidationArtifactRef
}

export interface PluginStateEnvelopeV2 extends PluginRequirementV2 {
  readonly format: "convax.canvas-plugin-state/2"
  readonly state: unknown
}

export type NodeDataEnvelopeV2 =
  | {
      readonly format: "convax.canvas-node-data/2"
      readonly kind: "agent"
      readonly title: string
      readonly instructions: string | null
    }
  | {
      readonly format: "convax.canvas-node-data/2"
      readonly kind: "group"
      readonly title: string
    }
  | {
      readonly format: "convax.canvas-node-data/2"
      readonly kind: "placeholder"
      readonly owner: "manual-pending"
      readonly title: string
      readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
      readonly state:
        | { readonly phase: "pending" }
        | { readonly phase: "failed"; readonly failureCode: string; readonly publicMessage: string | null }
    }
  | {
      readonly format: "convax.canvas-node-data/2"
      readonly kind: "placeholder"
      readonly owner: "generation"
      readonly title: string
      readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
    }
  | {
      readonly format: "convax.canvas-node-data/2"
      readonly kind: "resource"
      readonly title: string
      readonly resource: CanvasResourceRefV2
    }
  /**
   * Host-neutral generic Plugin surface. The concrete Plugin lives only in the
   * node's validated `PluginStateEnvelopeV2`; Canvas never learns a Plugin id.
   */
  | {
      readonly format: "convax.canvas-node-data/2"
      readonly kind: "plugin-surface"
      readonly title: string
    }

export interface CanvasEdgeDataV2 {
  readonly format: "convax.canvas-edge-data/2"
  readonly kind: "business"
  readonly label: string | null
}

export interface CanvasNodeIdentityV2 {
  readonly format: "convax.canvas-node-identity/2"
  readonly ref: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly role: "file" | "agent"
  readonly createdBy: CanvasOperationIdV2
}

export interface CanvasEdgeIdentityV2 {
  readonly format: "convax.canvas-edge-identity/2"
  readonly ref: CanvasEntityRefV2 & { readonly kind: "edge" }
  readonly source: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly target: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly createdBy: CanvasOperationIdV2
}

export interface TombstoneFactV2 {
  readonly format: "convax.canvas-tombstone/2"
  readonly entity: CanvasEntityRefV2
  readonly stamp: PortableStamp
}

export interface ContainmentChoiceV2 {
  readonly format: "convax.canvas-containment-choice/2"
  readonly relationId: string
  readonly child: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly parent: (CanvasEntityRefV2 & { readonly kind: "node" }) | null
  readonly stamp: PortableStamp
}

export interface CreationGroupRefV2 {
  readonly format: "convax.canvas-creation-group-ref/2"
  readonly groupId: string
  readonly source: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly sourceDataDigest: Digest
  readonly plugin: PluginRequirementV2
  readonly memberSetDigest: Digest
}

export interface GenerationBeginV2 {
  readonly format: "convax.canvas-generation-begin/2"
  readonly generationId: string
  readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly beginActorId: ActorId
  readonly beginAuthorizationEpochDigest: Digest
  readonly beginStamp: PortableStamp
  readonly outputClaimStamp: PortableStamp
  readonly toolRefDigest: Digest
  readonly prompt: string
  readonly targetEffectiveDataDigest: Digest
  readonly targetPluginDigest: Digest | null
}

export type OwnerGenerationTerminalV2 =
  | {
      readonly format: "convax.canvas-generation-terminal/2"
      readonly phase: "succeeded"
      readonly generationId: string
      readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly beginDigest: Digest
      readonly beginActorId: ActorId
      readonly outputData: NodeDataEnvelopeV2 & { readonly kind: "resource" }
      readonly outputProofDigest: Digest
    }
  | {
      readonly format: "convax.canvas-generation-terminal/2"
      readonly phase: "failed"
      readonly generationId: string
      readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly beginDigest: Digest
      readonly beginActorId: ActorId
      readonly failureCode: string
      readonly publicMessage: string | null
    }

export interface GenerationDismissalV2 {
  readonly format: "convax.canvas-generation-dismissal/2"
  readonly generationId: string
  readonly beginDigest: Digest
  readonly marker: "dismissed"
}

export interface GenerationRecoveryFailureV2 {
  readonly format: "convax.canvas-generation-recovery-failure/2"
  readonly generationId: string
  readonly beginDigest: Digest
  readonly proofDigest: Digest
  readonly failureCode: "generation-owner-unavailable"
}

export interface CanvasIdentityV2 {
  readonly format: "convax.canvas.v2"
  readonly scopeId: CanvasScopeIdV2
  readonly canvasId: CanvasId
  readonly ownerSchemaDigest: Digest
  readonly protocolDigest: Digest
  readonly canonicalizerDigest: Digest
  readonly projectIndexRouteDependencyFrameDigest: Digest
  readonly genesisDigest: Digest
}

export interface CanvasGenesisCoreV2 {
  readonly format: "convax.canvas-genesis-core/2"
  readonly scopeId: CanvasScopeIdV2
  readonly canvasId: CanvasId
  readonly ownerSchemaDigest: Digest
  readonly protocolDigest: Digest
  readonly canonicalizerDigest: Digest
  readonly projectIndexRouteDependencyFrameDigest: Digest
}

export type CanvasExternalFactKindV2 =
  | "current-resources"
  | "retained-resources"
  | "generation-begin"
  | "generation-recovery"

export type CanvasExternalFactRequestV2 =
  | {
      readonly format: "convax.canvas-external-fact-request/2"
      readonly kind: "current-resources"
      readonly proofs: readonly Extract<CanvasResourceProofRefV2, { readonly mode: "current-owner-state" }>[]
    }
  | {
      readonly format: "convax.canvas-external-fact-request/2"
      readonly kind: "retained-resources"
      readonly proofs: readonly Extract<CanvasResourceProofRefV2, { readonly mode: "retained-canvas-history" }>[]
    }
  | {
      readonly format: "convax.canvas-external-fact-request/2"
      readonly kind: "generation-begin"
      readonly scope: DocumentScope
      readonly beginDigest: Digest
      readonly beginActorId: ActorId
      readonly beginAuthorizationEpochDigest: Digest
      readonly toolRefDigest: Digest
      readonly protocolDigest: Digest
    }
  | {
      readonly format: "convax.canvas-external-fact-request/2"
      readonly kind: "generation-recovery"
      readonly proofDigest: Digest
    }

export interface CanvasExternalFactResultV2 {
  readonly format: "convax.canvas-external-fact-result/2"
  readonly kind: CanvasExternalFactKindV2
  readonly requestSha256: Digest
  readonly factDigest: Digest
  readonly decision: "verified"
}

export type CanvasCanonicalMapEntriesV2<K extends string, V> = readonly (readonly [K, V])[]
export type CanvasActorSlotEntriesV2<V> = readonly (readonly [ActorId, V])[]

export interface CanvasCanonicalMetaV2 {
  readonly title: CanvasActorSlotEntriesV2<StampedClaimV2<string | null>>
  readonly description: CanvasActorSlotEntriesV2<StampedClaimV2<string | null>>
  readonly tags: CanvasActorSlotEntriesV2<StampedClaimV2<readonly string[]>>
}

export interface CanvasCanonicalNodeRecordV2 {
  readonly identity: CanvasNodeIdentityV2
  readonly position: CanvasActorSlotEntriesV2<StampedClaimV2<CanvasPointV2>>
  readonly size: CanvasActorSlotEntriesV2<StampedClaimV2<CanvasSizeV2>>
  readonly data: CanvasActorSlotEntriesV2<StampedClaimV2<NodeDataEnvelopeV2>>
  readonly plugin: CanvasActorSlotEntriesV2<StampedClaimV2<PluginStateEnvelopeV2 | null>>
  readonly tombstones: CanvasActorSlotEntriesV2<TombstoneFactV2>
  readonly creationGroup: CreationGroupRefV2 | null
}

export interface CanvasCanonicalEdgeRecordV2 {
  readonly identity: CanvasEdgeIdentityV2
  readonly data: CanvasActorSlotEntriesV2<StampedClaimV2<CanvasEdgeDataV2>>
  readonly tombstones: CanvasActorSlotEntriesV2<TombstoneFactV2>
  readonly creationGroup: CreationGroupRefV2 | null
}

export type CanvasCanonicalSemanticHistoryValueV2 = SemanticHistoryRootV2 | SemanticHistoryTransitionV2

export interface CanvasCanonicalStateV2 {
  readonly format: "convax.canvas-canonical-state/2"
  readonly identity: CanvasIdentityV2
  readonly meta: CanvasCanonicalMetaV2
  readonly nodes: CanvasCanonicalMapEntriesV2<string, CanvasCanonicalNodeRecordV2>
  readonly edges: CanvasCanonicalMapEntriesV2<string, CanvasCanonicalEdgeRecordV2>
  readonly containments: CanvasCanonicalMapEntriesV2<string, ContainmentChoiceV2>
  readonly generationBegins: CanvasCanonicalMapEntriesV2<string, GenerationBeginV2>
  readonly generationTerminals: CanvasCanonicalMapEntriesV2<string, OwnerGenerationTerminalV2>
  readonly generationDismissals: CanvasCanonicalMapEntriesV2<string, GenerationDismissalV2>
  readonly generationRecoveryFailures: CanvasCanonicalMapEntriesV2<string, GenerationRecoveryFailureV2>
  readonly semanticHistory: CanvasCanonicalMapEntriesV2<string, CanvasCanonicalSemanticHistoryValueV2>
  readonly operations: CanvasCanonicalMapEntriesV2<string, BoundedOperationReceiptV2>
}

export interface NodeLiveGuardV2 {
  readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly expectedLive: true
  readonly expectedIdentityDigest: Digest
}

export interface EdgeLiveGuardV2 {
  readonly edge: CanvasEntityRefV2 & { readonly kind: "edge" }
  readonly expectedLive: true
  readonly expectedIdentityDigest: Digest
}

export interface NodeDataGuardV2 extends NodeLiveGuardV2 {
  readonly expectedEffectiveDataDigest: Digest
  readonly expectedDataRegisterDigest: Digest
}

export interface PluginGuardV2 extends NodeLiveGuardV2 {
  readonly expectedPluginDigest: Digest | null
  readonly requirement: PluginRequirementV2 | null
}

export interface GenerationGuardV2 extends NodeLiveGuardV2 {
  readonly generationId: string
  readonly beginDigest: Digest
  readonly expectedLifecycleDigest: Digest
}

export interface DerivedNodeAbsentGuardV2 {
  readonly ordinal: Uint32
  readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly expectedAbsent: true
}

export interface DerivedEdgeAbsentGuardV2 {
  readonly ordinal: Uint32
  readonly edge: CanvasEntityRefV2 & { readonly kind: "edge" }
  readonly expectedAbsent: true
}

export interface ConnectableNodeGuardV2 extends NodeLiveGuardV2 {
  readonly expectedConnectable: true
}

export interface CreatedResourceProofBindingV2 {
  readonly createdNodeOrdinal: Uint32
  readonly proof: Extract<CanvasResourceProofRefV2, { readonly mode: "current-owner-state" }>
}

export interface CausalPlacementV2 {
  readonly anchor: CanvasPointV2
  readonly gap: 24
  readonly obstacleProjectionDigest: Digest
}

export interface NodeCreateTemplateV2 {
  readonly ordinal: Uint32
  readonly nodeId: string
  readonly incarnation: string
  readonly role: "file" | "agent"
  readonly position: CanvasPointV2
  readonly size: CanvasSizeV2
  readonly data: NodeDataEnvelopeV2
  readonly plugin: PluginStateEnvelopeV2 | null
}

export interface EdgeCreateTemplateV2 {
  readonly ordinal: Uint32
  readonly edgeId: string
  readonly incarnation: string
  readonly source: CanvasEntityRefV2 | { readonly createdNodeOrdinal: Uint32 }
  readonly target: CanvasEntityRefV2 | { readonly createdNodeOrdinal: Uint32 }
  readonly data: CanvasEdgeDataV2
}

export interface ResourceNodeCreateSpecV2 {
  readonly ordinal: Uint32
  readonly nodeId: string
  readonly incarnation: string
  readonly size: CanvasSizeV2
  readonly title: string
  readonly resource: CanvasResourceRefV2
}

export interface PendingNodeCreateSpecV2 {
  readonly ordinal: Uint32
  readonly nodeId: string
  readonly incarnation: string
  readonly size: CanvasSizeV2
  readonly title: string
  readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
}

/**
 * The one Canvas-owned specification for a generic Plugin surface node. It
 * carries no source, edge, parent, creation group, caller-selected id, actor,
 * or digest; position is Canvas-computed from the bound causal placement.
 */
export interface PluginSurfaceCreateSpecV2 {
  readonly ordinal: Uint32
  readonly nodeId: string
  readonly incarnation: string
  readonly size: CanvasSizeV2
  readonly title: string
  readonly plugin: PluginStateEnvelopeV2
}

export interface GeometryGuardV2 extends NodeLiveGuardV2 {
  readonly expectedGeometryDigest: Digest
}

export interface GeometryUpdateV2 {
  readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly position: CanvasPointV2
  readonly size: CanvasSizeV2 | null
}

export interface ContainmentGuardV2 extends NodeLiveGuardV2 {
  readonly expectedOwnSlotDigest: Digest | null
}

export interface MetadataFieldGuardV2 {
  readonly field: "title" | "description" | "tags"
  readonly expectedEffectiveDigest: Digest
  readonly expectedOwnSlotDigest: Digest | null
}

export interface MetadataFieldUpdateV2 {
  readonly field: "title" | "description" | "tags"
  readonly value: string | readonly string[] | null
}

export interface GenerationBeginGuardV2 extends NodeDataGuardV2 {
  readonly expectedPluginDigest: Digest | null
  readonly expectedProjectedGenerationDigest: Digest
}

export interface GenerationObservedGuardV2 extends GenerationGuardV2 {
  readonly expectedTerminalDigest: Digest | null
  readonly expectedDismissalDigest: Digest | null
  readonly expectedRecoveryFailureDigest: Digest | null
}

export interface SemanticHistoryGuardV2 {
  readonly rootOperationId: CanvasOperationIdV2
  readonly expectedRootReceiptDigest: Digest
  readonly expectedHistoryRootDigest: Digest
  readonly expectedHistoryStateDigest: Digest
  readonly expectedMode: "applied" | "undone"
}

export type CanvasIntentKindV2 =
  | "canvas.agent.create"
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
  | "canvas.plugin.surface.create"
  | "canvas.undo.semantic-inverse/2"
  | "canvas.redo.semantic-forward/2"

export type CanvasUndoableIntentKindV2 = Exclude<
  CanvasIntentKindV2,
  | "canvas.generation.begin/2"
  | "canvas.generation.complete/2"
  | "canvas.generation.fail/2"
  | "canvas.generations.fail-owned/2"
  | "canvas.generation.dismiss/2"
  | "canvas.generation.fail-recovery/2"
  | "canvas.undo.semantic-inverse/2"
  | "canvas.redo.semantic-forward/2"
>

export interface CanvasTypedIntentV2<K extends CanvasIntentKindV2, G, B> {
  readonly format: "convax.typed-intent/2"
  readonly kind: K
  readonly guard: G
  readonly body: B
}

export interface CanvasHistoryBindingV2 {
  readonly handle: CanvasHistoryHandleV2
  readonly ref: CanvasEntityRefV2 | null
}

export type CanvasHistoryNodeHandleV2 = string
export type CanvasHistoryEdgeHandleV2 = string
export type CanvasHistoryCreationGroupHandleV2 = string
export type CanvasHistoryHandleV2 = CanvasHistoryNodeHandleV2 | CanvasHistoryEdgeHandleV2

export type CanvasHistoryNodeTargetV2 =
  | { readonly mode: "handle"; readonly handle: CanvasHistoryNodeHandleV2 }
  | { readonly mode: "external"; readonly ref: CanvasEntityRefV2 & { readonly kind: "node" } }

export interface CanvasHistoryNodeSnapshotV2 {
  readonly role: "file" | "agent"
  readonly position: CanvasPointV2
  readonly size: CanvasSizeV2
  readonly data: NodeDataEnvelopeV2
  readonly plugin: PluginStateEnvelopeV2 | null
  readonly resource: CanvasResourceRefV2 | null
}

export interface CanvasHistoryEdgeSnapshotV2 {
  readonly source: CanvasHistoryNodeTargetV2
  readonly target: CanvasHistoryNodeTargetV2
  readonly data: CanvasEdgeDataV2
}

export type CanvasHistoryEntityFootprintV2 =
  | {
      readonly kind: "node"
      readonly handle: CanvasHistoryNodeHandleV2
      readonly ref: (CanvasEntityRefV2 & { readonly kind: "node" }) | null
      readonly snapshot: CanvasHistoryNodeSnapshotV2 | null
      readonly effectiveParent: CanvasHistoryNodeTargetV2 | null
      readonly incidentLiveEdges: readonly CanvasHistoryEdgeHandleV2[]
    }
  | {
      readonly kind: "edge"
      readonly handle: CanvasHistoryEdgeHandleV2
      readonly ref: (CanvasEntityRefV2 & { readonly kind: "edge" }) | null
      readonly snapshot: CanvasHistoryEdgeSnapshotV2 | null
    }

export interface CanvasHistoryFootprintCoreV2 {
  readonly format: "convax.canvas-history-footprint/2"
  readonly rootOperationId: CanvasOperationIdV2
  readonly mode: "applied" | "undone"
  readonly entities: readonly CanvasHistoryEntityFootprintV2[]
  readonly metadata: readonly {
    readonly format: "convax.canvas-metadata-effective/2"
    readonly field: "title" | "description" | "tags"
    readonly value: string | readonly string[] | null
  }[]
  readonly containments: readonly {
    readonly child: CanvasHistoryNodeTargetV2
    readonly parent: CanvasHistoryNodeTargetV2 | null
  }[]
}

export type CanvasHistoryTemplateV2 =
  | {
      readonly op: "node.create"
      readonly handle: CanvasHistoryNodeHandleV2
      readonly snapshot: CanvasHistoryNodeSnapshotV2
    }
  | { readonly op: "node.tombstone"; readonly handle: CanvasHistoryNodeHandleV2 }
  | {
      readonly op: "node.geometry"
      readonly handle: CanvasHistoryNodeHandleV2
      readonly position: CanvasPointV2
      readonly size: CanvasSizeV2
    }
  | {
      readonly op: "node.data"
      readonly handle: CanvasHistoryNodeHandleV2
      readonly data: NodeDataEnvelopeV2
      readonly resource: CanvasResourceRefV2 | null
    }
  | {
      readonly op: "node.plugin"
      readonly handle: CanvasHistoryNodeHandleV2
      readonly plugin: PluginStateEnvelopeV2 | null
    }
  | {
      readonly op: "edge.create"
      readonly handle: CanvasHistoryEdgeHandleV2
      readonly snapshot: CanvasHistoryEdgeSnapshotV2
    }
  | { readonly op: "edge.tombstone"; readonly handle: CanvasHistoryEdgeHandleV2 }
  | {
      readonly op: "containment.set"
      readonly child: CanvasHistoryNodeTargetV2
      readonly parent: CanvasHistoryNodeTargetV2 | null
    }
  | {
      readonly op: "metadata.set"
      readonly field: "title" | "description" | "tags"
      readonly value: string | readonly string[] | null
    }
  | {
      readonly op: "creation-group.restore"
      readonly groupHandle: CanvasHistoryCreationGroupHandleV2
      readonly source: CanvasHistoryNodeTargetV2
      readonly sourceDataDigest: Digest
      readonly plugin: PluginRequirementV2
      readonly nodes: readonly {
        readonly handle: CanvasHistoryNodeHandleV2
        readonly snapshot: CanvasHistoryNodeSnapshotV2
      }[]
      readonly edges: readonly {
        readonly handle: CanvasHistoryEdgeHandleV2
        readonly snapshot: CanvasHistoryEdgeSnapshotV2
      }[]
    }
  | {
      readonly op: "pending-generation.restore"
      readonly node: CanvasHistoryNodeHandleV2
      readonly edges: readonly {
        readonly handle: CanvasHistoryEdgeHandleV2
        readonly snapshot: CanvasHistoryEdgeSnapshotV2
      }[]
      readonly generationId: string
      readonly fallbackTitle: string
      readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
      readonly position: CanvasPointV2
      readonly size: CanvasSizeV2
    }

export interface CanvasHistoryGenerationGuardV2 {
  readonly rootOperationId: CanvasOperationIdV2
  readonly nodeHandle: CanvasHistoryNodeHandleV2
  readonly generationId: string
  readonly retainedBeginDigest: Digest
  readonly expectedLifecycleDigest: Digest
  readonly expectedTerminalDigest: Digest | null
  readonly expectedDismissalDigest: Digest | null
  readonly expectedRecoveryFailureDigest: Digest | null
}

export type CanvasMaterializedHistoryGuardV2 =
  | { readonly op: "node.create"; readonly guard: null }
  | { readonly op: "node.tombstone"; readonly guard: NodeLiveGuardV2 }
  | { readonly op: "node.geometry"; readonly guard: GeometryGuardV2 }
  | { readonly op: "node.data"; readonly guard: NodeDataGuardV2 }
  | { readonly op: "node.plugin"; readonly guard: PluginGuardV2 }
  | {
      readonly op: "edge.create"
      readonly guard: {
        readonly edge: DerivedEdgeAbsentGuardV2
        readonly source: ConnectableNodeGuardV2
        readonly target: ConnectableNodeGuardV2
      }
    }
  | { readonly op: "edge.tombstone"; readonly guard: EdgeLiveGuardV2 }
  | {
      readonly op: "containment.set"
      readonly guard: { readonly child: ContainmentGuardV2; readonly parent: NodeLiveGuardV2 | null }
    }
  | { readonly op: "metadata.set"; readonly guard: MetadataFieldGuardV2 }
  | {
      readonly op: "creation-group.restore"
      readonly guard: {
        readonly source: NodeDataGuardV2
        readonly pluginRequirement: PluginRequirementV2
        readonly derivedNodes: readonly DerivedNodeAbsentGuardV2[]
        readonly derivedEdges: readonly DerivedEdgeAbsentGuardV2[]
      }
    }
  | {
      readonly op: "pending-generation.restore"
      readonly guard: {
        readonly lifecycle: CanvasHistoryGenerationGuardV2
        readonly derivedNode: DerivedNodeAbsentGuardV2
        readonly derivedEdges: readonly DerivedEdgeAbsentGuardV2[]
      }
    }

export type CanvasHistoryDerivedObjectV2 =
  | {
      readonly kind: "node"
      readonly handle: CanvasHistoryNodeHandleV2
      readonly ordinal: Uint32
      readonly ref: CanvasEntityRefV2 & { readonly kind: "node" }
    }
  | {
      readonly kind: "edge"
      readonly handle: CanvasHistoryEdgeHandleV2
      readonly ordinal: Uint32
      readonly ref: CanvasEntityRefV2 & { readonly kind: "edge" }
    }
  | {
      readonly kind: "relation"
      readonly ordinal: Uint32
      readonly relationId: string
      readonly child: CanvasHistoryNodeTargetV2
    }
  | {
      readonly kind: "creation-group"
      readonly handle: CanvasHistoryCreationGroupHandleV2
      readonly ordinal: Uint32
      readonly groupId: string
    }

export interface CanvasSemanticOperationV2 {
  readonly format: "convax.canvas-semantic-operation/2"
  readonly template: CanvasHistoryTemplateV2
  readonly materializedGuard: CanvasMaterializedHistoryGuardV2
  readonly derived: readonly CanvasHistoryDerivedObjectV2[]
  readonly guardDigest: Digest
  readonly retainedResourceProofs: readonly Extract<
    CanvasResourceProofRefV2,
    { readonly mode: "retained-canvas-history" }
  >[]
}

export interface SemanticHistoryRootV2 {
  readonly format: "convax.canvas-semantic-history-root/2"
  readonly rootOperationId: CanvasOperationIdV2
  readonly sourceIntentKind: CanvasUndoableIntentKindV2
  readonly sourceIntentDigest: Digest
  readonly initialBindings: readonly CanvasHistoryBindingV2[]
  readonly inverseTemplate: readonly CanvasHistoryTemplateV2[]
  readonly forwardTemplate: readonly CanvasHistoryTemplateV2[]
  readonly retainedResources: readonly CanvasResourceRefV2[]
  readonly materialDigest: Digest
}

export interface SemanticHistoryTransitionV2 {
  readonly format: "convax.canvas-semantic-history-transition/2"
  readonly rootOperationId: CanvasOperationIdV2
  readonly mode: "undone" | "redone"
  readonly priorHistoryDigest: Digest
  readonly transitionOperationId: CanvasOperationIdV2
  readonly stamp: PortableStamp
  readonly materializationDigest: Digest
  readonly resultFootprintDigest: Digest
  readonly resultBindings: readonly CanvasHistoryBindingV2[]
}

export interface BoundedOperationReceiptV2 {
  readonly format: "convax.canvas-operation-receipt/2"
  readonly operationId: CanvasOperationIdV2
  readonly actorId: ActorId
  readonly intentKind: CanvasIntentKindV2
  readonly intentDigest: Digest
  readonly baseFrontierDigest: Digest
  readonly resultEntities: readonly CanvasEntityRefV2[]
  readonly semanticRoot: boolean
  readonly historyMaterialDigest: Digest | null
}

export interface CanvasActualWriteV2 {
  readonly entityKind: "canvas" | "node" | "edge" | "containment" | "generation" | "history" | "operation"
  readonly entityId: string
  readonly field: string
  readonly valueDigest: Digest
}

export interface CanvasActualWriteEvidenceV2 {
  readonly format: "convax.canvas-actual-write-evidence/2"
  readonly changedPaths: readonly string[]
  readonly writes: readonly CanvasActualWriteV2[]
}

export interface CanvasIntentApplyResultV2 {
  readonly format: "convax.canvas-intent-result/2"
  readonly receipt: BoundedOperationReceiptV2
  readonly actualWriteEvidence: CanvasActualWriteEvidenceV2
  readonly semanticHistoryRoot: SemanticHistoryRootV2 | null
  readonly invalidatedEntities: readonly CanvasEntityRefV2[]
  readonly invalidatedMetaFields: readonly ("title" | "description" | "tags")[]
}

export type CanvasIntentContractMapV2 = {
  readonly "canvas.agent.create": CanvasTypedIntentV2<
    "canvas.agent.create",
    DerivedNodeAbsentGuardV2,
    { readonly node: NodeCreateTemplateV2 }
  >
  readonly "canvas.resources.add/2": CanvasTypedIntentV2<
    "canvas.resources.add/2",
    {
      readonly existingEndpoints: readonly ConnectableNodeGuardV2[]
      readonly derivedNodes: readonly DerivedNodeAbsentGuardV2[]
      readonly derivedEdges: readonly DerivedEdgeAbsentGuardV2[]
      readonly resourceProofs: readonly CreatedResourceProofBindingV2[]
    },
    {
      readonly placement: CausalPlacementV2
      readonly nodes: readonly ResourceNodeCreateSpecV2[]
      readonly edges: readonly EdgeCreateTemplateV2[]
    }
  >
  readonly "canvas.resources.pending.create/2": CanvasTypedIntentV2<
    "canvas.resources.pending.create/2",
    {
      readonly existingEndpoints: readonly ConnectableNodeGuardV2[]
      readonly derivedNodes: readonly DerivedNodeAbsentGuardV2[]
      readonly derivedEdges: readonly DerivedEdgeAbsentGuardV2[]
    },
    {
      readonly placement: CausalPlacementV2
      readonly nodes: readonly PendingNodeCreateSpecV2[]
      readonly edges: readonly EdgeCreateTemplateV2[]
    }
  >
  readonly "canvas.resources.pending-generation.create/2": CanvasTypedIntentV2<
    "canvas.resources.pending-generation.create/2",
    {
      readonly existingEndpoints: readonly ConnectableNodeGuardV2[]
      readonly derivedNode: DerivedNodeAbsentGuardV2
      readonly derivedEdges: readonly DerivedEdgeAbsentGuardV2[]
    },
    {
      readonly placement: CausalPlacementV2
      readonly node: PendingNodeCreateSpecV2
      readonly edges: readonly EdgeCreateTemplateV2[]
      readonly begin: GenerationBeginV2
    }
  >
  readonly "canvas.elements.remove/2": CanvasTypedIntentV2<
    "canvas.elements.remove/2",
    {
      readonly nodes: readonly NodeLiveGuardV2[]
      readonly edges: readonly EdgeLiveGuardV2[]
      readonly requireObservedIncidentEdgeClosure: true
    },
    {
      readonly nodes: readonly (CanvasEntityRefV2 & { readonly kind: "node" })[]
      readonly edges: readonly (CanvasEntityRefV2 & { readonly kind: "edge" })[]
    }
  >
  readonly "canvas.nodes.set-geometry/2": CanvasTypedIntentV2<
    "canvas.nodes.set-geometry/2",
    { readonly nodes: readonly GeometryGuardV2[] },
    { readonly updates: readonly GeometryUpdateV2[] }
  >
  readonly "canvas.nodes.update-data/2": CanvasTypedIntentV2<
    "canvas.nodes.update-data/2",
    { readonly node: NodeDataGuardV2; readonly resourceProof: CanvasResourceProofRefV2 | null },
    { readonly node: CanvasEntityRefV2 & { readonly kind: "node" }; readonly data: NodeDataEnvelopeV2 }
  >
  readonly "canvas.nodes.set-plugin-state/2": CanvasTypedIntentV2<
    "canvas.nodes.set-plugin-state/2",
    { readonly node: PluginGuardV2 },
    { readonly node: CanvasEntityRefV2 & { readonly kind: "node" }; readonly plugin: PluginStateEnvelopeV2 | null }
  >
  readonly "canvas.nodes.set-structural-parent/2": CanvasTypedIntentV2<
    "canvas.nodes.set-structural-parent/2",
    { readonly child: ContainmentGuardV2; readonly parent: NodeLiveGuardV2 | null },
    {
      readonly child: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly parent: (CanvasEntityRefV2 & { readonly kind: "node" }) | null
      readonly relationId: string
    }
  >
  readonly "canvas.nodes.group/2": CanvasTypedIntentV2<
    "canvas.nodes.group/2",
    {
      readonly group: DerivedNodeAbsentGuardV2
      readonly children: readonly ContainmentGuardV2[]
      readonly expectedGeometryPlanDigest: Digest
    },
    {
      readonly group: NodeCreateTemplateV2
      readonly children: readonly (CanvasEntityRefV2 & { readonly kind: "node" })[]
      readonly relationIds: readonly string[]
    }
  >
  readonly "canvas.nodes.ungroup/2": CanvasTypedIntentV2<
    "canvas.nodes.ungroup/2",
    {
      readonly group: NodeLiveGuardV2
      readonly children: readonly ContainmentGuardV2[]
      readonly expectedEffectiveChildSetDigest: Digest
    },
    {
      readonly group: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly children: readonly (CanvasEntityRefV2 & { readonly kind: "node" })[]
      readonly nullRelationIds: readonly string[]
    }
  >
  readonly "canvas.edges.connect/2": CanvasTypedIntentV2<
    "canvas.edges.connect/2",
    {
      readonly edge: DerivedEdgeAbsentGuardV2
      readonly source: ConnectableNodeGuardV2
      readonly target: ConnectableNodeGuardV2
    },
    { readonly edge: EdgeCreateTemplateV2 }
  >
  readonly "canvas.metadata.update/2": CanvasTypedIntentV2<
    "canvas.metadata.update/2",
    { readonly fields: readonly MetadataFieldGuardV2[] },
    { readonly fields: readonly MetadataFieldUpdateV2[] }
  >
  readonly "canvas.generation.begin/2": CanvasTypedIntentV2<
    "canvas.generation.begin/2",
    GenerationBeginGuardV2,
    { readonly begin: GenerationBeginV2 }
  >
  readonly "canvas.generation.complete/2": CanvasTypedIntentV2<
    "canvas.generation.complete/2",
    GenerationObservedGuardV2 & {
      readonly resourceProof: Extract<CanvasResourceProofRefV2, { readonly mode: "current-owner-state" }>
    },
    { readonly terminal: Extract<OwnerGenerationTerminalV2, { readonly phase: "succeeded" }> }
  >
  readonly "canvas.generation.fail/2": CanvasTypedIntentV2<
    "canvas.generation.fail/2",
    GenerationObservedGuardV2,
    { readonly terminal: Extract<OwnerGenerationTerminalV2, { readonly phase: "failed" }> }
  >
  readonly "canvas.generations.fail-owned/2": CanvasTypedIntentV2<
    "canvas.generations.fail-owned/2",
    {
      readonly generations: readonly GenerationObservedGuardV2[]
      readonly requireBeginActorEqualsOperationActor: true
    },
    {
      readonly failures: readonly {
        readonly generationId: string
        readonly beginDigest: Digest
        readonly failureCode: string
        readonly publicMessage: string | null
      }[]
    }
  >
  readonly "canvas.generation.dismiss/2": CanvasTypedIntentV2<
    "canvas.generation.dismiss/2",
    GenerationObservedGuardV2,
    { readonly dismissal: GenerationDismissalV2 }
  >
  readonly "canvas.generation.fail-recovery/2": CanvasTypedIntentV2<
    "canvas.generation.fail-recovery/2",
    GenerationObservedGuardV2,
    { readonly recoveryFailure: GenerationRecoveryFailureV2 }
  >
  readonly "canvas.plugin.creation-group.create/2": CanvasTypedIntentV2<
    "canvas.plugin.creation-group.create/2",
    {
      readonly source: NodeDataGuardV2
      readonly pluginRequirement: PluginRequirementV2
      readonly derivedNodes: readonly DerivedNodeAbsentGuardV2[]
      readonly derivedEdges: readonly DerivedEdgeAbsentGuardV2[]
      readonly resourceProofs: readonly CreatedResourceProofBindingV2[]
    },
    {
      readonly groupOrdinal: Uint32
      readonly source: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly nodes: readonly NodeCreateTemplateV2[]
      readonly edges: readonly EdgeCreateTemplateV2[]
    }
  >
  /**
   * Creates exactly one independent top-level Plugin surface node. There is no
   * source, edge, parent, or creation group; the single derived-node guard and
   * the causal placement are the whole contract.
   */
  readonly "canvas.plugin.surface.create": CanvasTypedIntentV2<
    "canvas.plugin.surface.create",
    { readonly derivedNode: DerivedNodeAbsentGuardV2 },
    { readonly placement: CausalPlacementV2; readonly node: PluginSurfaceCreateSpecV2 }
  >
  readonly "canvas.undo.semantic-inverse/2": CanvasTypedIntentV2<
    "canvas.undo.semantic-inverse/2",
    SemanticHistoryGuardV2 & { readonly expectedMode: "applied" },
    { readonly operations: readonly CanvasSemanticOperationV2[] }
  >
  readonly "canvas.redo.semantic-forward/2": CanvasTypedIntentV2<
    "canvas.redo.semantic-forward/2",
    SemanticHistoryGuardV2 & { readonly expectedMode: "undone" },
    { readonly operations: readonly CanvasSemanticOperationV2[] }
  >
}

export type CanvasTypedIntentUnionV2 = CanvasIntentContractMapV2[keyof CanvasIntentContractMapV2]

export interface CanvasNodeSnapshotV2 extends CanvasCanonicalNodeRecordV2 {
  readonly key: string
}

export interface CanvasEdgeSnapshotV2 extends CanvasCanonicalEdgeRecordV2 {
  readonly key: string
}

export interface CanvasSnapshotV2 {
  readonly identity: CanvasIdentityV2
  readonly meta: CanvasCanonicalMetaV2
  readonly nodes: ReadonlyMap<string, CanvasNodeSnapshotV2>
  readonly edges: ReadonlyMap<string, CanvasEdgeSnapshotV2>
  readonly containments: ReadonlyMap<string, ContainmentChoiceV2>
  readonly generationBegins: ReadonlyMap<string, GenerationBeginV2>
  readonly generationTerminals: ReadonlyMap<string, OwnerGenerationTerminalV2>
  readonly generationDismissals: ReadonlyMap<string, GenerationDismissalV2>
  readonly generationRecoveryFailures: ReadonlyMap<string, GenerationRecoveryFailureV2>
  readonly semanticHistory: ReadonlyMap<string, CanvasCanonicalSemanticHistoryValueV2>
  readonly operations: ReadonlyMap<string, BoundedOperationReceiptV2>
}

export interface CanvasProjectedNodeV2 {
  readonly ref: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly role: "file" | "agent"
  readonly position: CanvasPointV2
  readonly size: CanvasSizeV2
  readonly data: NodeDataEnvelopeV2
  readonly plugin: PluginStateEnvelopeV2 | null
  readonly parent: (CanvasEntityRefV2 & { readonly kind: "node" }) | null
  readonly generationLifecycle: "none" | "active" | "succeeded" | "failed" | "dismissed" | "recovery-failed"
}

export interface CanvasProjectedEdgeV2 {
  readonly ref: CanvasEntityRefV2 & { readonly kind: "edge" }
  readonly source: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly target: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly data: CanvasEdgeDataV2
}

export interface CanvasProjectionV2 {
  readonly identity: CanvasIdentityV2
  readonly title: string | null
  readonly description: string | null
  readonly tags: readonly string[]
  readonly nodes: readonly CanvasProjectedNodeV2[]
  readonly edges: readonly CanvasProjectedEdgeV2[]
}

export type CanvasFactResultV2 = "valid" | "pending" | "invalid"

export interface CanvasExternalFactContextV2 {
  validateCurrentResource(proof: CanvasResourceProofRefV2): CanvasFactResultV2
  validatePluginArtifact(requirement: PluginRequirementV2): CanvasFactResultV2
  validatePluginState(envelope: PluginStateEnvelopeV2): CanvasFactResultV2
  validateGenerationBegin(begin: GenerationBeginV2): CanvasFactResultV2
  validateGenerationRecovery(proofDigest: Digest): CanvasFactResultV2
}
