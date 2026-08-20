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
import type { CanvasNodeGenerationRun } from "../generation-run"

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

export type CanvasScopeId = DocumentScopeDigest
export type CanvasOperationId = Id128

export interface CanvasEntityRef {
  readonly kind: "node" | "edge"
  readonly id: string
  readonly incarnation: string
}

export interface StampedClaim<T> {
  readonly format: "convax.canvas-stamped-claim"
  readonly stamp: PortableStamp
  readonly value: T
}

export interface CanvasPoint {
  readonly x: number
  readonly y: number
}

export interface CanvasSize {
  readonly width: number
  readonly height: number
}

export interface CanvasCanonicalGroupAppearance {
  readonly color: "default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red"
  readonly emoji: "folder" | "briefcase" | "inbox" | "paperclip" | "bookmark" | "books" | "notebook" | "idea" | "sparkles" | "star" | "fire" | "bolt" | "target" | "rocket" | "compass" | "globe" | "map" | "camera" | "film" | "music" | "palette" | "image" | "chart" | "calendar" | "clock" | "check" | "warning" | "heart" | "gem" | "trophy" | "plant" | "leaf" | "coffee" | "game" | "robot" | "brain" | "team" | "package" | "tools" | "puzzle" | "index" | "memo" | "pencil" | "pin" | "link" | "archive" | "card-file" | "laptop" | "desktop" | "phone" | "microphone" | "headphones" | "key" | "lock" | "search" | "bell" | "megaphone" | "gift" | "party" | "flag" | "hourglass" | "sun" | "moon" | "cloud" | "rainbow" | "blossom" | "sunflower" | "tree" | "clover" | "cactus" | "mountain" | "wave" | "butterfly" | "cat" | "dog" | "fox" | "unicorn" | "whale" | "apple" | "pizza" | "cake" | "football" | "basketball" | "focus" | "peace"
}

export interface CanvasResourceRef {
  readonly format: "convax.canvas-resource-ref"
  readonly uri: string
  readonly mediaClass: "text" | "image" | "video" | "audio" | "file"
  readonly mime: string
  readonly byteLength: Uint64
  readonly contentDigest: Digest
  readonly ownerProofDigest: Digest
}

export type CanvasResourceProofRef =
  | {
      readonly format: "convax.canvas-resource-proof-ref"
      readonly mode: "current-owner-state"
      readonly resource: CanvasResourceRef
      readonly ownerProofDigest: Digest
      readonly requireCurrentLiveVersion: true
    }
  | {
      readonly format: "convax.canvas-resource-proof-ref"
      readonly mode: "retained-canvas-history"
      readonly sourceState: "history-root-pre" | "history-root-post" | "current-applied-post" | "last-history-post"
      readonly sourceOperationId: CanvasOperationId
      readonly sourceNode: CanvasEntityRef & { readonly kind: "node" }
      readonly sourceDataDigest: Digest
      readonly resource: CanvasResourceRef
      readonly requireExactRetainedMaterial: true
    }

export interface PluginRequirement {
  readonly pluginId: string
  readonly snapshotDigest: Digest
  readonly pluginStateSchemaDigest: Digest
  readonly validationArtifact: ValidationArtifactRef
}

export interface PluginStateEnvelope extends PluginRequirement {
  readonly format: "convax.canvas-plugin-state"
  readonly state: unknown
}

export type NodeDataEnvelope =
  | {
      readonly format: "convax.canvas-node-data"
      readonly kind: "agent"
      readonly title: string
      readonly instructions: string | null
    }
  | {
      readonly format: "convax.canvas-node-data"
      readonly kind: "group"
      readonly title: string
      readonly folded?: true
      readonly appearance?: CanvasCanonicalGroupAppearance
    }
  | {
      readonly format: "convax.canvas-node-data"
      readonly kind: "placeholder"
      readonly owner: "manual-pending"
      readonly title: string
      readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
      readonly state:
        | { readonly phase: "pending" }
        | { readonly phase: "failed"; readonly failureCode: string; readonly publicMessage: string | null }
      readonly generationToolId?: string
      readonly generationRun?: CanvasNodeGenerationRun
    }
  | {
      readonly format: "convax.canvas-node-data"
      readonly kind: "placeholder"
      readonly owner: "generation"
      readonly title: string
      readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
      readonly generationToolId?: string
      readonly generationRun?: CanvasNodeGenerationRun
    }
  | {
      readonly format: "convax.canvas-node-data"
      readonly kind: "resource"
      readonly title: string
      readonly resource: CanvasResourceRef
      readonly generationToolId?: string
      readonly generationRun?: CanvasNodeGenerationRun
    }
  /**
   * Host-neutral generic Plugin surface. The concrete Plugin lives only in the
   * node's validated `PluginStateEnvelope`; Canvas never learns a Plugin id.
   */
  | {
      readonly format: "convax.canvas-node-data"
      readonly kind: "plugin-surface"
      readonly title: string
    }

export interface CanvasEdgeData {
  readonly format: "convax.canvas-edge-data"
  readonly kind: "business"
  readonly label: string | null
}

export interface CanvasNodeIdentity {
  readonly format: "convax.canvas-node-identity"
  readonly ref: CanvasEntityRef & { readonly kind: "node" }
  readonly role: "file" | "agent"
  readonly createdBy: CanvasOperationId
}

export interface CanvasEdgeIdentity {
  readonly format: "convax.canvas-edge-identity"
  readonly ref: CanvasEntityRef & { readonly kind: "edge" }
  readonly source: CanvasEntityRef & { readonly kind: "node" }
  readonly target: CanvasEntityRef & { readonly kind: "node" }
  readonly createdBy: CanvasOperationId
}

export interface TombstoneFact {
  readonly format: "convax.canvas-tombstone"
  readonly entity: CanvasEntityRef
  readonly stamp: PortableStamp
}

export interface ContainmentChoice {
  readonly format: "convax.canvas-containment-choice"
  readonly relationId: string
  readonly child: CanvasEntityRef & { readonly kind: "node" }
  readonly parent: (CanvasEntityRef & { readonly kind: "node" }) | null
  readonly stamp: PortableStamp
}

export interface CreationGroupRef {
  readonly format: "convax.canvas-creation-group-ref"
  readonly groupId: string
  readonly source: CanvasEntityRef & { readonly kind: "node" }
  readonly sourceDataDigest: Digest
  readonly plugin: PluginRequirement
  readonly memberSetDigest: Digest
}

export interface GenerationBeginV2 {
  readonly format: "convax.canvas-generation-begin/2"
  readonly generationId: string
  readonly node: CanvasEntityRef & { readonly kind: "node" }
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
      readonly node: CanvasEntityRef & { readonly kind: "node" }
      readonly beginDigest: Digest
      readonly beginActorId: ActorId
      readonly outputData: NodeDataEnvelope & { readonly kind: "resource" }
      readonly outputProofDigest: Digest
    }
  | {
      readonly format: "convax.canvas-generation-terminal/2"
      readonly phase: "failed"
      readonly generationId: string
      readonly node: CanvasEntityRef & { readonly kind: "node" }
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

export interface CanvasIdentity {
  readonly format: "convax.canvas"
  readonly scopeId: CanvasScopeId
  readonly canvasId: CanvasId
  readonly ownerSchemaDigest: Digest
  readonly protocolDigest: Digest
  readonly canonicalizerDigest: Digest
  readonly projectIndexRouteDependency: Readonly<{
    readonly kind: "frame" | "migration-import-base"
    readonly digest: Digest
  }>
  readonly genesisDigest: Digest
}

export interface CanvasGenesisCore {
  readonly format: "convax.canvas-genesis-core"
  readonly scopeId: CanvasScopeId
  readonly canvasId: CanvasId
  readonly ownerSchemaDigest: Digest
  readonly protocolDigest: Digest
  readonly canonicalizerDigest: Digest
  readonly projectIndexRouteDependency: Readonly<{
    readonly kind: "frame" | "migration-import-base"
    readonly digest: Digest
  }>
}

export type CanvasExternalFactKind =
  | "current-resources"
  | "retained-resources"
  | "generation-begin"
  | "generation-recovery"

export type CanvasExternalFactRequest =
  | {
      readonly format: "convax.canvas-external-fact-request"
      readonly kind: "current-resources"
      readonly proofs: readonly Extract<CanvasResourceProofRef, { readonly mode: "current-owner-state" }>[]
    }
  | {
      readonly format: "convax.canvas-external-fact-request"
      readonly kind: "retained-resources"
      readonly proofs: readonly Extract<CanvasResourceProofRef, { readonly mode: "retained-canvas-history" }>[]
    }
  | {
      readonly format: "convax.canvas-external-fact-request"
      readonly kind: "generation-begin"
      readonly scope: DocumentScope
      readonly beginDigest: Digest
      readonly beginActorId: ActorId
      readonly beginAuthorizationEpochDigest: Digest
      readonly toolRefDigest: Digest
      readonly protocolDigest: Digest
    }
  | {
      readonly format: "convax.canvas-external-fact-request"
      readonly kind: "generation-recovery"
      readonly proofDigest: Digest
    }

export interface CanvasExternalFactResult {
  readonly format: "convax.canvas-external-fact-result"
  readonly kind: CanvasExternalFactKind
  readonly requestSha256: Digest
  readonly factDigest: Digest
  readonly decision: "verified"
}

export type CanvasCanonicalMapEntries<K extends string, V> = readonly (readonly [K, V])[]
export type CanvasActorSlotEntries<V> = readonly (readonly [ActorId, V])[]

export interface CanvasCanonicalMeta {
  readonly title: CanvasActorSlotEntries<StampedClaim<string | null>>
  readonly description: CanvasActorSlotEntries<StampedClaim<string | null>>
  readonly tags: CanvasActorSlotEntries<StampedClaim<readonly string[]>>
}

export interface CanvasCanonicalNodeRecord {
  readonly identity: CanvasNodeIdentity
  readonly position: CanvasActorSlotEntries<StampedClaim<CanvasPoint>>
  readonly size: CanvasActorSlotEntries<StampedClaim<CanvasSize>>
  readonly data: CanvasActorSlotEntries<StampedClaim<NodeDataEnvelope>>
  readonly plugin: CanvasActorSlotEntries<StampedClaim<PluginStateEnvelope | null>>
  readonly tombstones: CanvasActorSlotEntries<TombstoneFact>
  readonly creationGroup: CreationGroupRef | null
}

export interface CanvasCanonicalEdgeRecord {
  readonly identity: CanvasEdgeIdentity
  readonly data: CanvasActorSlotEntries<StampedClaim<CanvasEdgeData>>
  readonly tombstones: CanvasActorSlotEntries<TombstoneFact>
  readonly creationGroup: CreationGroupRef | null
}

export type CanvasCanonicalSemanticHistoryValue = SemanticHistoryRoot | SemanticHistoryTransition

export interface CanvasCanonicalState {
  readonly format: "convax.canvas-canonical-state"
  readonly identity: CanvasIdentity
  readonly meta: CanvasCanonicalMeta
  readonly nodes: CanvasCanonicalMapEntries<string, CanvasCanonicalNodeRecord>
  readonly edges: CanvasCanonicalMapEntries<string, CanvasCanonicalEdgeRecord>
  readonly containments: CanvasCanonicalMapEntries<string, ContainmentChoice>
  readonly generationBegins: CanvasCanonicalMapEntries<string, GenerationBeginV2>
  readonly generationTerminals: CanvasCanonicalMapEntries<string, OwnerGenerationTerminalV2>
  readonly generationDismissals: CanvasCanonicalMapEntries<string, GenerationDismissalV2>
  readonly generationRecoveryFailures: CanvasCanonicalMapEntries<string, GenerationRecoveryFailureV2>
  readonly semanticHistory: CanvasCanonicalMapEntries<string, CanvasCanonicalSemanticHistoryValue>
  readonly operations: CanvasCanonicalMapEntries<string, BoundedOperationReceipt>
}

export interface NodeLiveGuard {
  readonly node: CanvasEntityRef & { readonly kind: "node" }
  readonly expectedLive: true
  readonly expectedIdentityDigest: Digest
}

export interface EdgeLiveGuard {
  readonly edge: CanvasEntityRef & { readonly kind: "edge" }
  readonly expectedLive: true
  readonly expectedIdentityDigest: Digest
}

export interface NodeDataGuard extends NodeLiveGuard {
  readonly expectedEffectiveDataDigest: Digest
  readonly expectedDataRegisterDigest: Digest
}

export interface PluginGuard extends NodeLiveGuard {
  readonly expectedPluginDigest: Digest | null
  readonly requirement: PluginRequirement | null
}

export interface GenerationGuardV2 extends NodeLiveGuard {
  readonly generationId: string
  readonly beginDigest: Digest
  readonly expectedLifecycleDigest: Digest
}

export interface DerivedNodeAbsentGuard {
  readonly ordinal: Uint32
  readonly node: CanvasEntityRef & { readonly kind: "node" }
  readonly expectedAbsent: true
}

export interface DerivedEdgeAbsentGuard {
  readonly ordinal: Uint32
  readonly edge: CanvasEntityRef & { readonly kind: "edge" }
  readonly expectedAbsent: true
}

export interface ConnectableNodeGuard extends NodeLiveGuard {
  readonly expectedConnectable: true
}

export interface CreatedResourceProofBinding {
  readonly createdNodeOrdinal: Uint32
  readonly proof: Extract<CanvasResourceProofRef, { readonly mode: "current-owner-state" }>
}

export interface CausalPlacement {
  readonly anchor: CanvasPoint
  readonly gap: 24
}

export interface NodeCreateTemplate {
  readonly ordinal: Uint32
  readonly nodeId: string
  readonly incarnation: string
  readonly role: "file" | "agent"
  readonly position: CanvasPoint
  readonly size: CanvasSize
  readonly data: NodeDataEnvelope
  readonly plugin: PluginStateEnvelope | null
}

export interface EdgeCreateTemplate {
  readonly ordinal: Uint32
  readonly edgeId: string
  readonly incarnation: string
  readonly source: CanvasEntityRef | { readonly createdNodeOrdinal: Uint32 }
  readonly target: CanvasEntityRef | { readonly createdNodeOrdinal: Uint32 }
  readonly data: CanvasEdgeData
}

export interface DuplicateContainmentSpec {
  readonly childCreatedNodeOrdinal: Uint32
  readonly parent: CanvasEntityRef & { readonly kind: "node" } | { readonly createdNodeOrdinal: Uint32 }
  readonly relationId: string
}

export interface ResourceNodeCreateSpec {
  readonly ordinal: Uint32
  readonly nodeId: string
  readonly incarnation: string
  readonly size: CanvasSize
  readonly title: string
  readonly resource: CanvasResourceRef
}

export interface PendingNodeCreateSpec {
  readonly ordinal: Uint32
  readonly nodeId: string
  readonly incarnation: string
  readonly size: CanvasSize
  readonly title: string
  readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
  readonly generationRun?: CanvasNodeGenerationRun
}

/**
 * The one Canvas-owned specification for a generic Plugin surface node. It
 * carries no source, edge, parent, creation group, caller-selected id, actor,
 * or digest; position is Canvas-computed from the bound causal placement.
 */
export interface PluginSurfaceCreateSpec {
  readonly ordinal: Uint32
  readonly nodeId: string
  readonly incarnation: string
  readonly size: CanvasSize
  readonly title: string
  readonly plugin: PluginStateEnvelope
}

export interface GeometryGuard extends NodeLiveGuard {
  readonly expectedGeometryDigest: Digest
}

export interface GeometryUpdate {
  readonly node: CanvasEntityRef & { readonly kind: "node" }
  readonly position: CanvasPoint
  readonly size: CanvasSize | null
}

export interface ContainmentGuard extends NodeLiveGuard {
  readonly expectedOwnSlotDigest: Digest | null
}

export interface MetadataFieldGuard {
  readonly field: "title" | "description" | "tags"
  readonly expectedEffectiveDigest: Digest
  readonly expectedOwnSlotDigest: Digest | null
}

export interface MetadataFieldUpdate {
  readonly field: "title" | "description" | "tags"
  readonly value: string | readonly string[] | null
}

export interface GenerationBeginGuardV2 extends NodeDataGuard {
  readonly expectedPluginDigest: Digest | null
  readonly expectedProjectedGenerationDigest: Digest
}

export interface GenerationObservedGuardV2 extends GenerationGuardV2 {
  readonly expectedTerminalDigest: Digest | null
  readonly expectedDismissalDigest: Digest | null
  readonly expectedRecoveryFailureDigest: Digest | null
}

export interface SemanticHistoryGuard {
  readonly rootOperationId: CanvasOperationId
  readonly expectedRootReceiptDigest: Digest
  readonly expectedHistoryRootDigest: Digest
  readonly expectedHistoryStateDigest: Digest
  readonly expectedMode: "applied" | "undone"
}

export type CanvasIntentKind =
  | "canvas.agent.create"
  | "canvas.resources.add"
  | "canvas.resources.pending.create"
  | "canvas.resources.pending-generation.create"
  | "canvas.elements.remove"
  | "canvas.nodes.set-geometry"
  | "canvas.nodes.duplicate"
  | "canvas.nodes.update-data"
  | "canvas.nodes.set-plugin-state"
  | "canvas.nodes.set-structural-parent"
  | "canvas.nodes.group"
  | "canvas.nodes.ungroup"
  | "canvas.edges.connect"
  | "canvas.metadata.update"
  | "canvas.generation.begin"
  | "canvas.generation.runs.update"
  | "canvas.generation.complete"
  | "canvas.generation.fail"
  | "canvas.generations.fail-owned"
  | "canvas.generation.dismiss"
  | "canvas.generation.fail-recovery"
  | "canvas.plugin.creation-group.create"
  | "canvas.plugin.surface.create"
  | "canvas.undo.semantic-inverse"
  | "canvas.redo.semantic-forward"

export type CanvasUndoableIntentKind = Exclude<
  CanvasIntentKind,
  | "canvas.generation.begin"
  | "canvas.generation.runs.update"
  | "canvas.generation.complete"
  | "canvas.generation.fail"
  | "canvas.generations.fail-owned"
  | "canvas.generation.dismiss"
  | "canvas.generation.fail-recovery"
  | "canvas.undo.semantic-inverse"
  | "canvas.redo.semantic-forward"
>

export interface CanvasTypedIntent<K extends CanvasIntentKind, G, B> {
  readonly format: "convax.typed-intent"
  readonly kind: K
  readonly guard: G
  readonly body: B
}

export interface CanvasHistoryBinding {
  readonly handle: CanvasHistoryHandle
  readonly ref: CanvasEntityRef | null
}

export type CanvasHistoryNodeHandle = string
export type CanvasHistoryEdgeHandle = string
export type CanvasHistoryCreationGroupHandle = string
export type CanvasHistoryHandle = CanvasHistoryNodeHandle | CanvasHistoryEdgeHandle

export type CanvasHistoryNodeTarget =
  | { readonly mode: "handle"; readonly handle: CanvasHistoryNodeHandle }
  | { readonly mode: "external"; readonly ref: CanvasEntityRef & { readonly kind: "node" } }

export interface CanvasHistoryNodeSnapshot {
  readonly role: "file" | "agent"
  readonly position: CanvasPoint
  readonly size: CanvasSize
  readonly data: NodeDataEnvelope
  readonly plugin: PluginStateEnvelope | null
  readonly resource: CanvasResourceRef | null
}

export interface CanvasHistoryEdgeSnapshot {
  readonly source: CanvasHistoryNodeTarget
  readonly target: CanvasHistoryNodeTarget
  readonly data: CanvasEdgeData
}

export type CanvasHistoryEntityFootprint =
  | {
      readonly kind: "node"
      readonly handle: CanvasHistoryNodeHandle
      readonly ref: (CanvasEntityRef & { readonly kind: "node" }) | null
      readonly snapshot: CanvasHistoryNodeSnapshot | null
      readonly effectiveParent: CanvasHistoryNodeTarget | null
      readonly incidentLiveEdges: readonly CanvasHistoryEdgeHandle[]
    }
  | {
      readonly kind: "edge"
      readonly handle: CanvasHistoryEdgeHandle
      readonly ref: (CanvasEntityRef & { readonly kind: "edge" }) | null
      readonly snapshot: CanvasHistoryEdgeSnapshot | null
    }

export interface CanvasHistoryFootprintCore {
  readonly format: "convax.canvas-history-footprint"
  readonly rootOperationId: CanvasOperationId
  readonly mode: "applied" | "undone"
  readonly entities: readonly CanvasHistoryEntityFootprint[]
  readonly metadata: readonly {
    readonly format: "convax.canvas-metadata-effective"
    readonly field: "title" | "description" | "tags"
    readonly value: string | readonly string[] | null
  }[]
  readonly containments: readonly {
    readonly child: CanvasHistoryNodeTarget
    readonly parent: CanvasHistoryNodeTarget | null
  }[]
}

export type CanvasHistoryTemplate =
  | {
      readonly op: "node.create"
      readonly handle: CanvasHistoryNodeHandle
      readonly snapshot: CanvasHistoryNodeSnapshot
    }
  | { readonly op: "node.tombstone"; readonly handle: CanvasHistoryNodeHandle }
  | {
      readonly op: "node.geometry"
      readonly handle: CanvasHistoryNodeHandle
      readonly position: CanvasPoint
      readonly size: CanvasSize
    }
  | {
      readonly op: "node.data"
      readonly handle: CanvasHistoryNodeHandle
      readonly data: NodeDataEnvelope
      readonly resource: CanvasResourceRef | null
    }
  | {
      readonly op: "node.plugin"
      readonly handle: CanvasHistoryNodeHandle
      readonly plugin: PluginStateEnvelope | null
    }
  | {
      readonly op: "edge.create"
      readonly handle: CanvasHistoryEdgeHandle
      readonly snapshot: CanvasHistoryEdgeSnapshot
    }
  | { readonly op: "edge.tombstone"; readonly handle: CanvasHistoryEdgeHandle }
  | {
      readonly op: "containment.set"
      readonly child: CanvasHistoryNodeTarget
      readonly parent: CanvasHistoryNodeTarget | null
    }
  | {
      readonly op: "metadata.set"
      readonly field: "title" | "description" | "tags"
      readonly value: string | readonly string[] | null
    }
  | {
      readonly op: "creation-group.restore"
      readonly groupHandle: CanvasHistoryCreationGroupHandle
      readonly source: CanvasHistoryNodeTarget
      readonly sourceDataDigest: Digest
      readonly plugin: PluginRequirement
      readonly nodes: readonly {
        readonly handle: CanvasHistoryNodeHandle
        readonly snapshot: CanvasHistoryNodeSnapshot
      }[]
      readonly edges: readonly {
        readonly handle: CanvasHistoryEdgeHandle
        readonly snapshot: CanvasHistoryEdgeSnapshot
      }[]
    }
  | {
      readonly op: "pending-generation.restore"
      readonly node: CanvasHistoryNodeHandle
      readonly edges: readonly {
        readonly handle: CanvasHistoryEdgeHandle
        readonly snapshot: CanvasHistoryEdgeSnapshot
      }[]
      readonly generationId: string
      readonly fallbackTitle: string
      readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
      readonly position: CanvasPoint
      readonly size: CanvasSize
    }

export interface CanvasHistoryGenerationGuardV2 {
  readonly rootOperationId: CanvasOperationId
  readonly nodeHandle: CanvasHistoryNodeHandle
  readonly generationId: string
  readonly retainedBeginDigest: Digest
  readonly expectedLifecycleDigest: Digest
  readonly expectedTerminalDigest: Digest | null
  readonly expectedDismissalDigest: Digest | null
  readonly expectedRecoveryFailureDigest: Digest | null
}

export type CanvasMaterializedHistoryGuard =
  | { readonly op: "node.create"; readonly guard: null }
  | { readonly op: "node.tombstone"; readonly guard: NodeLiveGuard }
  | { readonly op: "node.geometry"; readonly guard: GeometryGuard }
  | { readonly op: "node.data"; readonly guard: NodeDataGuard }
  | { readonly op: "node.plugin"; readonly guard: PluginGuard }
  | {
      readonly op: "edge.create"
      readonly guard: {
        readonly edge: DerivedEdgeAbsentGuard
        readonly source: ConnectableNodeGuard
        readonly target: ConnectableNodeGuard
      }
    }
  | { readonly op: "edge.tombstone"; readonly guard: EdgeLiveGuard }
  | {
      readonly op: "containment.set"
      readonly guard: { readonly child: ContainmentGuard; readonly parent: NodeLiveGuard | null }
    }
  | { readonly op: "metadata.set"; readonly guard: MetadataFieldGuard }
  | {
      readonly op: "creation-group.restore"
      readonly guard: {
        readonly source: NodeDataGuard
        readonly pluginRequirement: PluginRequirement
        readonly derivedNodes: readonly DerivedNodeAbsentGuard[]
        readonly derivedEdges: readonly DerivedEdgeAbsentGuard[]
      }
    }
  | {
      readonly op: "pending-generation.restore"
      readonly guard: {
        readonly lifecycle: CanvasHistoryGenerationGuardV2
        readonly derivedNode: DerivedNodeAbsentGuard
        readonly derivedEdges: readonly DerivedEdgeAbsentGuard[]
      }
    }

export type CanvasHistoryDerivedObject =
  | {
      readonly kind: "node"
      readonly handle: CanvasHistoryNodeHandle
      readonly ordinal: Uint32
      readonly ref: CanvasEntityRef & { readonly kind: "node" }
    }
  | {
      readonly kind: "edge"
      readonly handle: CanvasHistoryEdgeHandle
      readonly ordinal: Uint32
      readonly ref: CanvasEntityRef & { readonly kind: "edge" }
    }
  | {
      readonly kind: "relation"
      readonly ordinal: Uint32
      readonly relationId: string
      readonly child: CanvasHistoryNodeTarget
    }
  | {
      readonly kind: "creation-group"
      readonly handle: CanvasHistoryCreationGroupHandle
      readonly ordinal: Uint32
      readonly groupId: string
    }

export interface CanvasSemanticOperation {
  readonly format: "convax.canvas-semantic-operation"
  readonly template: CanvasHistoryTemplate
  readonly materializedGuard: CanvasMaterializedHistoryGuard
  readonly derived: readonly CanvasHistoryDerivedObject[]
  readonly guardDigest: Digest
  readonly retainedResourceProofs: readonly Extract<
    CanvasResourceProofRef,
    { readonly mode: "retained-canvas-history" }
  >[]
}

export interface SemanticHistoryRoot {
  readonly format: "convax.canvas-semantic-history-root"
  readonly rootOperationId: CanvasOperationId
  readonly sourceIntentKind: CanvasUndoableIntentKind
  readonly sourceIntentDigest: Digest
  readonly initialBindings: readonly CanvasHistoryBinding[]
  readonly inverseTemplate: readonly CanvasHistoryTemplate[]
  readonly forwardTemplate: readonly CanvasHistoryTemplate[]
  readonly retainedResources: readonly CanvasResourceRef[]
  readonly materialDigest: Digest
}

export interface SemanticHistoryTransition {
  readonly format: "convax.canvas-semantic-history-transition"
  readonly rootOperationId: CanvasOperationId
  readonly mode: "undone" | "redone"
  readonly priorHistoryDigest: Digest
  readonly transitionOperationId: CanvasOperationId
  readonly stamp: PortableStamp
  readonly materializationDigest: Digest
  readonly resultFootprintDigest: Digest
  readonly resultBindings: readonly CanvasHistoryBinding[]
}

export interface BoundedOperationReceipt {
  readonly format: "convax.canvas-operation-receipt"
  readonly operationId: CanvasOperationId
  readonly actorId: ActorId
  readonly intentKind: CanvasIntentKind
  readonly intentDigest: Digest
  readonly baseFrontierDigest: Digest
  readonly resultEntities: readonly CanvasEntityRef[]
  readonly semanticRoot: boolean
  readonly historyMaterialDigest: Digest | null
}

export interface CanvasActualWrite {
  readonly entityKind: "canvas" | "node" | "edge" | "containment" | "generation" | "history" | "operation"
  readonly entityId: string
  readonly field: string
  readonly valueDigest: Digest
}

export interface CanvasActualWriteEvidence {
  readonly format: "convax.canvas-actual-write-evidence"
  readonly changedPaths: readonly string[]
  readonly writes: readonly CanvasActualWrite[]
}

export interface CanvasIntentApplyResult {
  readonly format: "convax.canvas-intent-result"
  readonly receipt: BoundedOperationReceipt
  readonly actualWriteEvidence: CanvasActualWriteEvidence
  readonly semanticHistoryRoot: SemanticHistoryRoot | null
  readonly invalidatedEntities: readonly CanvasEntityRef[]
  readonly invalidatedMetaFields: readonly ("title" | "description" | "tags")[]
}

export type CanvasIntentContractMap = {
  readonly "canvas.agent.create": CanvasTypedIntent<
    "canvas.agent.create",
    DerivedNodeAbsentGuard,
    { readonly node: NodeCreateTemplate }
  >
  readonly "canvas.resources.add": CanvasTypedIntent<
    "canvas.resources.add",
    {
      readonly existingEndpoints: readonly ConnectableNodeGuard[]
      readonly derivedNodes: readonly DerivedNodeAbsentGuard[]
      readonly derivedEdges: readonly DerivedEdgeAbsentGuard[]
      readonly resourceProofs: readonly CreatedResourceProofBinding[]
    },
    {
      readonly placement: CausalPlacement
      readonly nodes: readonly ResourceNodeCreateSpec[]
      readonly edges: readonly EdgeCreateTemplate[]
    }
  >
  readonly "canvas.resources.pending.create": CanvasTypedIntent<
    "canvas.resources.pending.create",
    {
      readonly existingEndpoints: readonly ConnectableNodeGuard[]
      readonly derivedNodes: readonly DerivedNodeAbsentGuard[]
      readonly derivedEdges: readonly DerivedEdgeAbsentGuard[]
    },
    {
      readonly placement: CausalPlacement
      readonly nodes: readonly PendingNodeCreateSpec[]
      readonly edges: readonly EdgeCreateTemplate[]
    }
  >
  readonly "canvas.resources.pending-generation.create": CanvasTypedIntent<
    "canvas.resources.pending-generation.create",
    {
      readonly existingEndpoints: readonly ConnectableNodeGuard[]
      readonly derivedNode: DerivedNodeAbsentGuard
      readonly derivedEdges: readonly DerivedEdgeAbsentGuard[]
    },
    {
      readonly placement: CausalPlacement
      readonly node: PendingNodeCreateSpec
      readonly edges: readonly EdgeCreateTemplate[]
      readonly begin: GenerationBeginV2
    }
  >
  readonly "canvas.elements.remove": CanvasTypedIntent<
    "canvas.elements.remove",
    {
      readonly nodes: readonly NodeLiveGuard[]
      readonly edges: readonly EdgeLiveGuard[]
      readonly requireObservedIncidentEdgeClosure: true
    },
    {
      readonly nodes: readonly (CanvasEntityRef & { readonly kind: "node" })[]
      readonly edges: readonly (CanvasEntityRef & { readonly kind: "edge" })[]
    }
  >
  readonly "canvas.nodes.set-geometry": CanvasTypedIntent<
    "canvas.nodes.set-geometry",
    { readonly nodes: readonly GeometryGuard[] },
    { readonly updates: readonly GeometryUpdate[] }
  >
  readonly "canvas.nodes.duplicate": CanvasTypedIntent<
    "canvas.nodes.duplicate",
    {
      readonly sources: readonly NodeDataGuard[]
      readonly existingEndpoints: readonly ConnectableNodeGuard[]
      readonly existingParents: readonly NodeLiveGuard[]
      readonly derivedNodes: readonly DerivedNodeAbsentGuard[]
      readonly derivedEdges: readonly DerivedEdgeAbsentGuard[]
    },
    {
      readonly offset: CanvasPoint
      readonly nodes: readonly NodeCreateTemplate[]
      readonly edges: readonly EdgeCreateTemplate[]
      readonly containments: readonly DuplicateContainmentSpec[]
    }
  >
  readonly "canvas.nodes.update-data": CanvasTypedIntent<
    "canvas.nodes.update-data",
    { readonly node: NodeDataGuard; readonly resourceProof: CanvasResourceProofRef | null },
    { readonly node: CanvasEntityRef & { readonly kind: "node" }; readonly data: NodeDataEnvelope }
  >
  readonly "canvas.generation.runs.update": CanvasTypedIntent<
    "canvas.generation.runs.update",
    {
      readonly updates: readonly {
        readonly node: NodeDataGuard
        readonly resourceProof: CanvasResourceProofRef | null
      }[]
    },
    {
      readonly updates: readonly {
        readonly node: CanvasEntityRef & { readonly kind: "node" }
        readonly data: NodeDataEnvelope
      }[]
    }
  >
  readonly "canvas.nodes.set-plugin-state": CanvasTypedIntent<
    "canvas.nodes.set-plugin-state",
    { readonly node: PluginGuard },
    { readonly node: CanvasEntityRef & { readonly kind: "node" }; readonly plugin: PluginStateEnvelope | null }
  >
  readonly "canvas.nodes.set-structural-parent": CanvasTypedIntent<
    "canvas.nodes.set-structural-parent",
    { readonly child: ContainmentGuard & { readonly expectedGeometryDigest?: Digest }; readonly parent: NodeLiveGuard | null },
    {
      readonly child: CanvasEntityRef & { readonly kind: "node" }
      readonly parent: (CanvasEntityRef & { readonly kind: "node" }) | null
      readonly position?: CanvasPoint
      readonly relationId: string
    }
  >
  readonly "canvas.nodes.group": CanvasTypedIntent<
    "canvas.nodes.group",
    {
      readonly group: DerivedNodeAbsentGuard
      readonly children: readonly ContainmentGuard[]
      readonly expectedGeometryPlanDigest: Digest
    },
    {
      readonly group: NodeCreateTemplate
      readonly children: readonly (CanvasEntityRef & { readonly kind: "node" })[]
      readonly relationIds: readonly string[]
    }
  >
  readonly "canvas.nodes.ungroup": CanvasTypedIntent<
    "canvas.nodes.ungroup",
    {
      readonly group: NodeLiveGuard
      readonly children: readonly ContainmentGuard[]
      readonly expectedEffectiveChildSetDigest: Digest
    },
    {
      readonly group: CanvasEntityRef & { readonly kind: "node" }
      readonly children: readonly (CanvasEntityRef & { readonly kind: "node" })[]
      readonly nullRelationIds: readonly string[]
    }
  >
  readonly "canvas.edges.connect": CanvasTypedIntent<
    "canvas.edges.connect",
    {
      readonly edge: DerivedEdgeAbsentGuard
      readonly source: ConnectableNodeGuard
      readonly target: ConnectableNodeGuard
    },
    { readonly edge: EdgeCreateTemplate }
  >
  readonly "canvas.metadata.update": CanvasTypedIntent<
    "canvas.metadata.update",
    { readonly fields: readonly MetadataFieldGuard[] },
    { readonly fields: readonly MetadataFieldUpdate[] }
  >
  readonly "canvas.generation.begin": CanvasTypedIntent<
    "canvas.generation.begin",
    GenerationBeginGuardV2,
    { readonly begin: GenerationBeginV2 }
  >
  readonly "canvas.generation.complete": CanvasTypedIntent<
    "canvas.generation.complete",
    GenerationObservedGuardV2 & {
      readonly resourceProof: Extract<CanvasResourceProofRef, { readonly mode: "current-owner-state" }>
    },
    { readonly terminal: Extract<OwnerGenerationTerminalV2, { readonly phase: "succeeded" }> }
  >
  readonly "canvas.generation.fail": CanvasTypedIntent<
    "canvas.generation.fail",
    GenerationObservedGuardV2,
    { readonly terminal: Extract<OwnerGenerationTerminalV2, { readonly phase: "failed" }> }
  >
  readonly "canvas.generations.fail-owned": CanvasTypedIntent<
    "canvas.generations.fail-owned",
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
  readonly "canvas.generation.dismiss": CanvasTypedIntent<
    "canvas.generation.dismiss",
    GenerationObservedGuardV2,
    { readonly dismissal: GenerationDismissalV2 }
  >
  readonly "canvas.generation.fail-recovery": CanvasTypedIntent<
    "canvas.generation.fail-recovery",
    GenerationObservedGuardV2,
    { readonly recoveryFailure: GenerationRecoveryFailureV2 }
  >
  readonly "canvas.plugin.creation-group.create": CanvasTypedIntent<
    "canvas.plugin.creation-group.create",
    {
      readonly source: NodeDataGuard
      readonly pluginRequirement: PluginRequirement
      readonly derivedNodes: readonly DerivedNodeAbsentGuard[]
      readonly derivedEdges: readonly DerivedEdgeAbsentGuard[]
      readonly resourceProofs: readonly CreatedResourceProofBinding[]
    },
    {
      readonly groupOrdinal: Uint32
      readonly source: CanvasEntityRef & { readonly kind: "node" }
      readonly nodes: readonly NodeCreateTemplate[]
      readonly edges: readonly EdgeCreateTemplate[]
    }
  >
  /**
   * Creates exactly one independent top-level Plugin surface node. There is no
   * source, edge, parent, or creation group; the single derived-node guard and
   * the causal placement are the whole contract.
   */
  readonly "canvas.plugin.surface.create": CanvasTypedIntent<
    "canvas.plugin.surface.create",
    { readonly derivedNode: DerivedNodeAbsentGuard },
    { readonly placement: CausalPlacement; readonly node: PluginSurfaceCreateSpec }
  >
  readonly "canvas.undo.semantic-inverse": CanvasTypedIntent<
    "canvas.undo.semantic-inverse",
    SemanticHistoryGuard & { readonly expectedMode: "applied" },
    { readonly operations: readonly CanvasSemanticOperation[] }
  >
  readonly "canvas.redo.semantic-forward": CanvasTypedIntent<
    "canvas.redo.semantic-forward",
    SemanticHistoryGuard & { readonly expectedMode: "undone" },
    { readonly operations: readonly CanvasSemanticOperation[] }
  >
}

export type CanvasTypedIntentUnion = CanvasIntentContractMap[keyof CanvasIntentContractMap]

export interface CanvasNodeSnapshot extends CanvasCanonicalNodeRecord {
  readonly key: string
}

export interface CanvasEdgeSnapshot extends CanvasCanonicalEdgeRecord {
  readonly key: string
}

export interface CanvasSnapshot {
  readonly identity: CanvasIdentity
  readonly meta: CanvasCanonicalMeta
  readonly nodes: ReadonlyMap<string, CanvasNodeSnapshot>
  readonly edges: ReadonlyMap<string, CanvasEdgeSnapshot>
  readonly containments: ReadonlyMap<string, ContainmentChoice>
  readonly generationBegins: ReadonlyMap<string, GenerationBeginV2>
  readonly generationTerminals: ReadonlyMap<string, OwnerGenerationTerminalV2>
  readonly generationDismissals: ReadonlyMap<string, GenerationDismissalV2>
  readonly generationRecoveryFailures: ReadonlyMap<string, GenerationRecoveryFailureV2>
  readonly semanticHistory: ReadonlyMap<string, CanvasCanonicalSemanticHistoryValue>
  readonly operations: ReadonlyMap<string, BoundedOperationReceipt>
}

export interface CanvasProjectedNode {
  readonly ref: CanvasEntityRef & { readonly kind: "node" }
  readonly role: "file" | "agent"
  readonly position: CanvasPoint
  readonly size: CanvasSize
  readonly data: NodeDataEnvelope
  readonly plugin: PluginStateEnvelope | null
  readonly parent: (CanvasEntityRef & { readonly kind: "node" }) | null
  readonly generationLifecycle: "none" | "active" | "succeeded" | "failed" | "dismissed" | "recovery-failed"
}

export interface CanvasProjectedEdge {
  readonly ref: CanvasEntityRef & { readonly kind: "edge" }
  readonly source: CanvasEntityRef & { readonly kind: "node" }
  readonly target: CanvasEntityRef & { readonly kind: "node" }
  readonly data: CanvasEdgeData
}

export interface CanvasProjection {
  readonly identity: CanvasIdentity
  readonly title: string | null
  readonly description: string | null
  readonly tags: readonly string[]
  readonly nodes: readonly CanvasProjectedNode[]
  readonly edges: readonly CanvasProjectedEdge[]
}

export type CanvasFactResult = "valid" | "pending" | "invalid"

export interface CanvasExternalFactContext {
  validateCurrentResource(proof: CanvasResourceProofRef): CanvasFactResult
  validatePluginArtifact(requirement: PluginRequirement): CanvasFactResult
  validatePluginState(envelope: PluginStateEnvelope): CanvasFactResult
  validateGenerationBegin(begin: GenerationBeginV2): CanvasFactResult
  validateGenerationRecovery(proofDigest: Digest): CanvasFactResult
}
