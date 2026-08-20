import { comparePortableStamps, compareUtf8, encodeRestrictedJcs, ordinarySha256 } from "@convax/collaboration"
import { canonicalize as canonicalizeUri } from "@convax/uri"
import { canvasNodeGenerationRunKey } from "../generation-run"
import {
  appendCanvasPlacementIndex,
  bindCanvasDocumentPlacementIndex,
  createCanvasPlacementIndex,
  type CanvasIndexedPlacementObstacle,
  type CanvasPlacementIndex,
} from "../resource-placement"
import type { CanvasDocument, CanvasNode, CanvasNodeData } from "../types"
import type {
  BoundedOperationReceipt,
  CanvasCanonicalNodeRecord,
  CanvasEdgeSnapshot,
  CanvasEntityRef,
  CanvasNodeSnapshot,
  CanvasProjectedEdge,
  CanvasProjectedNode,
  CanvasProjection,
  CanvasSnapshot,
  ContainmentChoice,
  Digest,
  GenerationBeginV2,
  NodeDataEnvelope,
  OwnerGenerationTerminalV2,
  PluginStateEnvelope,
  StampedClaim,
} from "./types"
import { canvasDigest, canvasEntityKey, maxClaim } from "./validation"
import { appendCanvasSnapshotEntries, createCanvasSnapshotMap } from "./persistent-append-map"
import {
  buildCanvasGenerationProjectionIndex,
  canvasEffectiveGenerationForNode,
  canvasGenerationIdsForNode,
  canvasGenerationProjectionWorkCounts,
  installCanvasGenerationProjectionIndex,
} from "./generation-projection-index"

export interface CanvasProjectionIndex {
  readonly projection: CanvasProjection
  readonly nodesByKey: ReadonlyMap<string, CanvasProjectedNode>
  readonly nodesById: ReadonlyMap<string, CanvasProjectedNode>
  readonly edgesByKey: ReadonlyMap<string, CanvasProjectedEdge>
  readonly edgesById: ReadonlyMap<string, CanvasProjectedEdge>
  readonly selectedContainments: ReadonlyMap<string, ContainmentChoice | null>
  readonly isNodeLive: (ref: CanvasEntityRef & { readonly kind: "node" }) => boolean
  readonly isEdgeLive: (ref: CanvasEntityRef & { readonly kind: "edge" }) => boolean
}

// CanvasSnapshot is an immutable, fully validated owner value. Keep derived
// indexes bound to that exact identity so command construction, guard
// validation, reduction, and delivery do not each traverse the whole Canvas.
// A new accepted snapshot gets a new identity and therefore cannot observe a
// stale projection through this cache.
const projectionIndexesBySnapshot = new WeakMap<CanvasSnapshot, CanvasProjectionIndex>()
const placementIndexesByProjection = new WeakMap<CanvasProjection, CanvasPlacementIndex>()
const canonicalProjectionByPublicProjection = new WeakMap<CanvasProjection, CanvasProjection>()
interface CanvasTopLevelObstacle {
  readonly node: CanvasEntityRef & { readonly kind: "node" }
  readonly position: CanvasProjectedNode["position"]
  readonly size: CanvasProjectedNode["size"]
}
const topLevelObstaclesBySnapshot = new WeakMap<CanvasSnapshot, ReadonlyMap<string, CanvasTopLevelObstacle>>()
interface CanvasObstacleIntervalNode {
  readonly key: string
  readonly obstacle: CanvasTopLevelObstacle
  readonly left: CanvasObstacleIntervalNode | null
  readonly right: CanvasObstacleIntervalNode | null
  readonly height: number
  readonly maxRight: number
}
const obstacleIntervalsBySnapshot = new WeakMap<CanvasSnapshot, CanvasObstacleIntervalNode | null>()
let fullProjectionBuilds = 0
let fullProjectionNodeTraversals = 0
let resourceAppendProjectionBuilds = 0
let obstacleQueryVisits = 0
let obstacleIndexBuildVisits = 0
let projectionArrayEntryVisits = 0

/**
 * Stable Canvas-owned keys used by the disposable renderer projection. They are
 * presentation metadata, not Plugin or resource authority: Main must still
 * resolve every URI and Plugin snapshot through its owning application ports.
 */
export const canvasProjectionResourceMetadataKey = "convaxResource" as const
export const canvasProjectionPluginIdentityMetadataKey = "convaxPlugin" as const
export const canvasProjectionPluginStateMetadataKey = "convaxPluginState" as const

export interface CanvasDocumentProjection {
  readonly document: CanvasDocument
  readonly edgeEntities: ReadonlyMap<string, CanvasEntityRef & { readonly kind: "edge" }>
  readonly nodeEntities: ReadonlyMap<string, CanvasEntityRef & { readonly kind: "node" }>
}

/** Package-private keyed adapter used by certified projection patches. */
export function projectCanvasNodeForDocument(node: CanvasProjectedNode): CanvasNode {
  return {
    id: node.ref.id,
    type: node.role,
    position: { ...node.position },
    ...(node.parent === null ? {} : { parentId: node.parent.id }),
    data: projectNodeData(node),
    style: { width: node.size.width, height: node.size.height },
    ...(node.data.kind === "group" ? { zIndex: -1 } : {}),
  }
}

/** Package-private keyed adapter used by certified projection patches. */
export function projectCanvasEdgeForDocument(edge: CanvasProjectedEdge): CanvasDocument["edges"][number] {
  return {
    id: edge.ref.id,
    source: edge.source.id,
    target: edge.target.id,
    data: edge.data.label === null ? {} : { label: edge.data.label },
  }
}

/**
 * Converts the canonical owner projection to the React Flow-facing document.
 * The result is disposable and pathless. Entity incarnations stay beside the
 * document so renderer commands can address the exact live entity without
 * persisting React Flow state or reconstructing identity from a node id.
 */
export function projectCanvasDocument(projection: CanvasProjection): CanvasDocumentProjection {
  const nodeEntities = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
  const edgeEntities = new Map<string, CanvasEntityRef & { readonly kind: "edge" }>()
  const topLevelPlacementObstacles: CanvasIndexedPlacementObstacle[] = []
  const nodes = projection.nodes.map((node): CanvasNode => {
    if (nodeEntities.has(node.ref.id)) {
      throw new Error(`Canvas projection contains duplicate live node id ${node.ref.id}`)
    }
    nodeEntities.set(node.ref.id, cloneNodeRef(node.ref))
    if (node.parent === null) {
      topLevelPlacementObstacles.push({ key: node.ref.id, ...node.position, ...node.size })
    }
    return projectCanvasNodeForDocument(node)
  })
  const edges = projection.edges.map((edge) => {
    if (edgeEntities.has(edge.ref.id))
      throw new Error(`Canvas projection contains duplicate live edge id ${edge.ref.id}`)
    edgeEntities.set(edge.ref.id, cloneEdgeRef(edge.ref))
    if (!nodeEntities.has(edge.source.id) || !nodeEntities.has(edge.target.id)) {
      throw new Error(`Canvas projection edge ${edge.ref.id} references a non-live node`)
    }
    return projectCanvasEdgeForDocument(edge)
  })
  const document: CanvasDocument = {
      id: projection.identity.canvasId,
      metadata: {
        title: projection.title ?? "Untitled canvas",
        ...(projection.description === null ? {} : { description: projection.description }),
        ...(projection.tags.length === 0 ? {} : { tags: [...projection.tags] }),
      },
      nodes,
      edges,
  }
  const placementIndex =
    placementIndexesByProjection.get(projection) ?? createCanvasPlacementIndex(topLevelPlacementObstacles)
  placementIndexesByProjection.set(projection, placementIndex)
  const canonicalProjection = canonicalProjectionByPublicProjection.get(projection)
  if (canonicalProjection) placementIndexesByProjection.set(canonicalProjection, placementIndex)
  bindCanvasDocumentPlacementIndex(document, placementIndex)
  return Object.freeze({
    document,
    edgeEntities,
    nodeEntities,
  })
}

function cloneEdgeRef(ref: CanvasEntityRef & { readonly kind: "edge" }): CanvasEntityRef & { readonly kind: "edge" } {
  return Object.freeze({ kind: "edge", id: ref.id, incarnation: ref.incarnation })
}

function projectNodeData(node: CanvasProjectedNode): CanvasNodeData {
  const pluginMetadata =
    node.plugin === null
      ? {}
      : {
          [canvasProjectionPluginIdentityMetadataKey]: {
            id: node.plugin.pluginId,
            snapshotDigest: node.plugin.snapshotDigest,
            pluginStateSchemaDigest: node.plugin.pluginStateSchemaDigest,
          },
          [canvasProjectionPluginStateMetadataKey]: structuredClone(node.plugin.state),
        }
  const kind = node.plugin === null ? node.data.kind : `plugin.${node.plugin.pluginId}`
  switch (node.data.kind) {
    case "agent":
      return {
        kind,
        label: node.data.title,
        ...(node.data.instructions === null ? {} : { description: node.data.instructions }),
        ...(node.plugin === null ? {} : { metadata: pluginMetadata }),
      }
    case "group":
      return {
        kind,
        label: node.data.title,
        ...(node.data.folded === true || node.data.appearance !== undefined || node.plugin !== null
          ? {
              metadata: {
                ...pluginMetadata,
                ...(node.data.folded === true
                  ? { convaxGroupFold: { folded: true, schema: "convax.group-fold/1" } }
                  : {}),
                ...(node.data.appearance === undefined
                  ? {}
                  : {
                      convaxGroupAppearance: {
                        ...node.data.appearance,
                        schema: "convax.group-appearance/1",
                      },
                    }),
              },
            }
          : {}),
      }
    case "plugin-surface":
      // Without a live Plugin envelope the projected kind stays the bare
      // `plugin-surface` discriminator, which no renderer claims, so the node
      // degrades to the unknown-file fallback with its portable state intact.
      return {
        kind,
        label: node.data.title,
        ...(node.plugin === null ? {} : { metadata: pluginMetadata }),
      }
    case "placeholder": {
      const manualPending = node.data.owner === "manual-pending"
      const portableRunFailed = node.data.generationRun?.status === "failed"
      const failed = manualPending
        ? node.data.state.phase === "failed"
        : portableRunFailed || node.generationLifecycle === "failed" || node.generationLifecycle === "recovery-failed"
      const publicMessage =
        manualPending && node.data.state.phase === "failed"
          ? (node.data.state.publicMessage ?? node.data.state.failureCode)
          : portableRunFailed
            ? (node.data.generationRun?.failureMessage ?? "Generation failed")
            : failed
              ? "Generation failed"
              : undefined
      return {
        kind: node.plugin === null ? node.data.expectedClass : kind,
        label: node.data.title,
        // A manual placeholder is an empty card awaiting an explicit Upload or
        // Generate choice. It is not an active generation job. Preserve the
        // pending status only for generation-owned placeholders so Renderer
        // activity overlays cannot invent work that never started.
        status: failed ? "error" : manualPending ? "idle" : "pending",
        ...(publicMessage === undefined ? {} : { error: publicMessage }),
        metadata: {
          ...pluginMetadata,
          ...(node.data.generationRun === undefined
            ? {}
            : { [canvasNodeGenerationRunKey]: structuredClone(node.data.generationRun) }),
          ...(node.data.generationToolId === undefined
            ? {}
            : {
                convaxGenerationPreference: {
                  schema: "convax.node-generation-preference/1",
                  toolId: node.data.generationToolId,
                },
              }),
        },
      }
    }
    case "resource": {
      if (canonicalizeUri(node.data.resource.uri) !== node.data.resource.uri) {
        throw new Error(`Canvas node ${node.ref.id} contains a non-canonical resource URI`)
      }
      const resource = structuredClone(node.data.resource)
      return {
        kind: node.plugin === null ? resource.mediaClass : kind,
        label: node.data.title,
        name: node.data.title,
        mimeType: resource.mime,
        metadata: {
          ...pluginMetadata,
          [canvasProjectionResourceMetadataKey]: resource,
          ...(node.data.generationRun === undefined
            ? {}
            : { [canvasNodeGenerationRunKey]: structuredClone(node.data.generationRun) }),
          ...(node.data.generationToolId === undefined
            ? {}
            : {
                convaxGenerationPreference: {
                  schema: "convax.node-generation-preference/1",
                  toolId: node.data.generationToolId,
                },
              }),
        },
        resourceState: {
          mediaType: resource.mime,
          name: node.data.title,
          status: "stale",
        },
      }
    }
  }
}

function cloneNodeRef(ref: CanvasEntityRef & { readonly kind: "node" }): CanvasEntityRef & { readonly kind: "node" } {
  return Object.freeze({ kind: "node", id: ref.id, incarnation: ref.incarnation })
}

export function projectCanvas(snapshot: CanvasSnapshot): CanvasProjection {
  const projection = buildCanvasProjectionIndex(snapshot).projection
  const result = Object.freeze({
    identity: projection.identity,
    title: projection.title,
    description: projection.description,
    tags: projection.tags,
    nodes: projection.nodes,
    edges: projection.edges,
  })
  canonicalProjectionByPublicProjection.set(result, projection)
  const placementIndex = placementIndexesByProjection.get(projection)
  if (placementIndex) placementIndexesByProjection.set(result, placementIndex)
  return result
}

export function buildCanvasProjectionIndex(snapshot: CanvasSnapshot): CanvasProjectionIndex {
  const cached = projectionIndexesBySnapshot.get(snapshot)
  if (cached !== undefined) return cached
  buildCanvasGenerationProjectionIndex(snapshot)
  fullProjectionBuilds += 1
  fullProjectionNodeTraversals += snapshot.nodes.size
  const isSemanticCreationEffective = semanticCreationLiveness(snapshot)
  const nodeMemo = new Map<string, boolean>()
  const visiting = new Set<string>()
  const isNodeKeyLive = (key: string): boolean => {
    const memo = nodeMemo.get(key)
    if (memo !== undefined) return memo
    const node = snapshot.nodes.get(key)
    if (node === undefined || node.tombstones.length > 0) return false
    if (!isSemanticCreationEffective(node.identity.createdBy, node.identity.ref)) return false
    if (visiting.has(key)) return false
    visiting.add(key)
    const live = node.creationGroup === null || isNodeKeyLive(canvasEntityKey(node.creationGroup.source))
    visiting.delete(key)
    nodeMemo.set(key, live)
    return live
  }

  const isEdgeKeyLive = (key: string): boolean => {
    const edge = snapshot.edges.get(key)
    if (edge === undefined || edge.tombstones.length > 0) return false
    if (!isSemanticCreationEffective(edge.identity.createdBy, edge.identity.ref)) return false
    if (!isNodeKeyLive(canvasEntityKey(edge.identity.source)) || !isNodeKeyLive(canvasEntityKey(edge.identity.target)))
      return false
    return edge.creationGroup === null || isNodeKeyLive(canvasEntityKey(edge.creationGroup.source))
  }

  const selectedContainments = selectContainments(snapshot, isNodeKeyLive)
  const nodesByKey = new Map<string, CanvasProjectedNode>()
  for (const [key, node] of [...snapshot.nodes.entries()].sort((a, b) => compareUtf8(a[0], b[0]))) {
    if (!isNodeKeyLive(key)) continue
    const projected = projectSnapshotNode(snapshot, node, selectedContainments.get(key) ?? null)
    if (projected) nodesByKey.set(key, projected)
  }

  const edgesByKey = new Map<string, CanvasProjectedEdge>()
  for (const [key, edge] of [...snapshot.edges.entries()].sort((a, b) => compareUtf8(a[0], b[0]))) {
    if (!isEdgeKeyLive(key)) continue
    const projected = projectSnapshotEdge(edge)
    if (projected) edgesByKey.set(key, projected)
  }

  const readonlyNodes = createCanvasSnapshotMap(nodesByKey)
  const readonlyEdges = createCanvasSnapshotMap(edgesByKey)
  const nodesById = new Map<string, CanvasProjectedNode>()
  for (const node of readonlyNodes.values()) {
    if (nodesById.has(node.ref.id)) throw new TypeError(`Canvas projection contains duplicate live node id ${node.ref.id}`)
    nodesById.set(node.ref.id, node)
  }
  const edgesById = new Map<string, CanvasProjectedEdge>()
  for (const edge of readonlyEdges.values()) {
    if (edgesById.has(edge.ref.id)) throw new TypeError(`Canvas projection contains duplicate live edge id ${edge.ref.id}`)
    edgesById.set(edge.ref.id, edge)
  }
  const readonlyNodesById = createCanvasSnapshotMap(nodesById)
  const readonlyEdgesById = createCanvasSnapshotMap(edgesById)
  const readonlyContainments = createCanvasSnapshotMap(selectedContainments)

  const projection = Object.freeze({
    identity: snapshot.identity,
    title: effectiveMetadata(snapshot.meta.title, null),
    description: effectiveMetadata(snapshot.meta.description, null),
    tags: effectiveMetadata(snapshot.meta.tags, [] as readonly string[]),
    nodes: Object.freeze([...readonlyNodes.values()]),
    edges: Object.freeze([...readonlyEdges.values()]),
  })
  const index = Object.freeze({
    projection,
    nodesByKey: readonlyNodes,
    nodesById: readonlyNodesById,
    edgesByKey: readonlyEdges,
    edgesById: readonlyEdgesById,
    selectedContainments: readonlyContainments,
    isNodeLive: (ref: CanvasEntityRef & { readonly kind: "node" }) => isNodeKeyLive(canvasEntityKey(ref)),
    isEdgeLive: (ref: CanvasEntityRef & { readonly kind: "edge" }) => isEdgeKeyLive(canvasEntityKey(ref)),
  })
  projectionIndexesBySnapshot.set(snapshot, index)
  const placementIndex = createCanvasPlacementIndex(
    [...readonlyNodes]
      .filter(([, node]) => node.parent === null)
      .map(([key, node]) => ({ key, ...node.position, ...node.size })),
  )
  placementIndexesByProjection.set(projection, placementIndex)
  // A reopened Canvas pays all historical index construction during its one
  // explicit cold projection. The first accepted append must only path-copy k.
  canvasTopLevelObstacles(snapshot)
  return index
}

/** Package-private cache read. Certified hot paths fail closed instead of rebuilding it. */
export function readCanvasProjectionIndex(snapshot: CanvasSnapshot): CanvasProjectionIndex | null {
  return projectionIndexesBySnapshot.get(snapshot) ?? null
}

/** Package-private exact-base placement index; it is derived during cold projection. */
export function canvasTopLevelPlacementIndex(snapshot: CanvasSnapshot): CanvasPlacementIndex {
  const projection = buildCanvasProjectionIndex(snapshot).projection
  const index = placementIndexesByProjection.get(projection)
  if (!index) throw new TypeError("Canvas top-level placement index is unavailable")
  return index
}

/** Owner-only append installation for independent resource creations. */
export function installCanvasResourceAppendProjectionIndex(
  base: CanvasSnapshot,
  snapshot: CanvasSnapshot,
  nodeKeys: readonly string[],
  edgeKeys: readonly string[],
): void {
  resourceAppendProjectionBuilds += 1
  // Resource creation does not mutate generation state. Bind the successor to
  // the base exact index before projecting its new nodes, so effective data for
  // one Add Text never enumerates historical generation runs.
  installCanvasGenerationProjectionIndex(base, snapshot, [])
  const baseIndex = buildCanvasProjectionIndex(base)
  const nodes: [string, CanvasProjectedNode][] = []
  for (const key of nodeKeys) {
    const record = snapshot.nodes.get(key)
    if (!record) throw new TypeError(`Canvas appended projection node is missing: ${key}`)
    const projected = projectSnapshotNode(snapshot, record, null)
    if (!projected) throw new TypeError(`Canvas appended projection node is not live: ${key}`)
    nodes.push([key, projected])
  }
  const edges: [string, CanvasProjectedEdge][] = []
  for (const key of edgeKeys) {
    const record = snapshot.edges.get(key)
    if (!record) throw new TypeError(`Canvas appended projection edge is missing: ${key}`)
    const projected = projectSnapshotEdge(record)
    if (!projected) throw new TypeError(`Canvas appended projection edge is not live: ${key}`)
    edges.push([key, projected])
  }
  const nodesByKey = appendCanvasSnapshotEntries(baseIndex.nodesByKey, nodes, "derived-projection")
  const edgesByKey = appendCanvasSnapshotEntries(baseIndex.edgesByKey, edges, "derived-projection")
  const nodesById = appendCanvasSnapshotEntries(
    baseIndex.nodesById,
    nodes.map(([, node]) => [node.ref.id, node] as const),
    "derived-projection",
  )
  const edgesById = appendCanvasSnapshotEntries(
    baseIndex.edgesById,
    edges.map(([, edge]) => [edge.ref.id, edge] as const),
    "derived-projection",
  )
  let materializedNodes: readonly CanvasProjectedNode[] | undefined
  let materializedEdges: readonly CanvasProjectedEdge[] | undefined
  const projection = Object.freeze({
    identity: snapshot.identity,
    title: baseIndex.projection.title,
    description: baseIndex.projection.description,
    tags: baseIndex.projection.tags,
    get nodes() {
      if (materializedNodes === undefined) {
        projectionArrayEntryVisits += nodesByKey.size
        materializedNodes = Object.freeze(
          [...nodesByKey.entries()].sort((left, right) => compareUtf8(left[0], right[0])).map(([, node]) => node),
        )
      }
      return materializedNodes
    },
    get edges() {
      if (materializedEdges === undefined) {
        projectionArrayEntryVisits += edgesByKey.size
        materializedEdges = Object.freeze(
          [...edgesByKey.entries()].sort((left, right) => compareUtf8(left[0], right[0])).map(([, edge]) => edge),
        )
      }
      return materializedEdges
    },
  })
  const basePlacementIndex = placementIndexesByProjection.get(baseIndex.projection)
  if (basePlacementIndex) {
    placementIndexesByProjection.set(
      projection,
      appendCanvasPlacementIndex(
        basePlacementIndex,
        nodes
          .filter(([, node]) => node.parent === null)
          .map(([key, node]) => ({ key, ...node.position, ...node.size })),
      ),
    )
  }
  const nodeKeySet = new Set(nodeKeys)
  const edgeKeySet = new Set(edgeKeys)
  projectionIndexesBySnapshot.set(snapshot, Object.freeze({
    projection,
    nodesByKey,
    nodesById,
    edgesByKey,
    edgesById,
    selectedContainments: baseIndex.selectedContainments,
    isNodeLive: (ref: CanvasEntityRef & { readonly kind: "node" }) =>
      nodeKeySet.has(canvasEntityKey(ref)) || baseIndex.isNodeLive(ref),
    isEdgeLive: (ref: CanvasEntityRef & { readonly kind: "edge" }) =>
      edgeKeySet.has(canvasEntityKey(ref)) || baseIndex.isEdgeLive(ref),
  }))

  const baseObstacles = canvasTopLevelObstacles(base)
  let intervalRoot = obstacleIntervalsBySnapshot.get(base)
  if (intervalRoot === undefined) {
    canvasTopLevelObstacles(base)
    intervalRoot = obstacleIntervalsBySnapshot.get(base) ?? null
  }
  const appendedObstacles = nodes.map(([key, node]) =>
    [key, Object.freeze({ node: node.ref, position: node.position, size: node.size })] as const)
  for (const [key, obstacle] of appendedObstacles) intervalRoot = insertObstacleInterval(intervalRoot, key, obstacle)
  topLevelObstaclesBySnapshot.set(
    snapshot,
    appendCanvasSnapshotEntries(baseObstacles, appendedObstacles, "derived-projection"),
  )
  obstacleIntervalsBySnapshot.set(snapshot, intervalRoot)
}

/** Package-private structural benchmark evidence; never enters protocol state. */
export function canvasProjectionBuildCounts(): Readonly<{
  fullBuilds: number
  fullNodeTraversals: number
  resourceAppendBuilds: number
  obstacleIndexBuildVisits: number
  obstacleQueryVisits: number
  projectionArrayEntryVisits: number
  historicalGenerationVisits: number
  generationIndexPathCopies: number
  generationIncrementalUpdates: number
}> {
  const generation = canvasGenerationProjectionWorkCounts()
  return Object.freeze({
    fullBuilds: fullProjectionBuilds,
    fullNodeTraversals: fullProjectionNodeTraversals,
    resourceAppendBuilds: resourceAppendProjectionBuilds,
    obstacleIndexBuildVisits,
    obstacleQueryVisits,
    projectionArrayEntryVisits,
    historicalGenerationVisits: generation.historicalGenerationVisits,
    generationIndexPathCopies: generation.pathCopies,
    generationIncrementalUpdates: generation.incrementalGenerationUpdates,
  })
}

function projectSnapshotNode(
  snapshot: CanvasSnapshot,
  node: CanvasNodeSnapshot,
  parentChoice: ContainmentChoice | null,
): CanvasProjectedNode | null {
  const position = maxClaim(node.position.map((entry) => entry[1]))
  const size = maxClaim(node.size.map((entry) => entry[1]))
  const plugin = maxClaim(node.plugin.map((entry) => entry[1]))
  if (position === null || size === null || plugin === null) return null
  const effective = effectiveNodeData(snapshot, node)
  return Object.freeze({
    ref: node.identity.ref,
    role: node.identity.role,
    position: position.value,
    size: size.value,
    data: effective.data,
    plugin: plugin.value,
    parent: parentChoice?.parent ?? null,
    generationLifecycle: effective.lifecycle,
  })
}

function projectSnapshotEdge(edge: CanvasEdgeSnapshot): CanvasProjectedEdge | null {
  const data = maxClaim(edge.data.map((entry) => entry[1]))
  return data === null ? null : Object.freeze({
    ref: edge.identity.ref,
    source: edge.identity.source,
    target: edge.identity.target,
    data: data.value,
  })
}

function semanticCreationLiveness(snapshot: CanvasSnapshot): (createdBy: string, ref: CanvasEntityRef) => boolean {
  const receiptByOperation = new Map<string, BoundedOperationReceipt[]>()
  for (const receipt of snapshot.operations.values()) {
    const values = receiptByOperation.get(receipt.operationId) ?? []
    values.push(receipt)
    receiptByOperation.set(receipt.operationId, values)
  }
  const transitions = [...snapshot.semanticHistory.entries()].filter(
    (entry): entry is [string, import("./types").SemanticHistoryTransition] =>
      entry[1].format === "convax.canvas-semantic-history-transition",
  )
  const effectiveByRoot = new Map<string, (typeof transitions)[number]>()
  for (const entry of transitions) {
    const current = effectiveByRoot.get(entry[1].rootOperationId)
    if (current === undefined) {
      effectiveByRoot.set(entry[1].rootOperationId, entry)
      continue
    }
    const stampOrder = comparePortableStamps(current[1].stamp, entry[1].stamp)
    if (stampOrder < 0 || (stampOrder === 0 && compareUtf8(current[0], entry[0]) < 0))
      effectiveByRoot.set(entry[1].rootOperationId, entry)
  }

  return (createdBy, ref) => {
    const receipts = receiptByOperation.get(createdBy)
    const semanticReceipts =
      receipts?.filter(
        (receipt) =>
          receipt.intentKind === "canvas.undo.semantic-inverse" ||
          receipt.intentKind === "canvas.redo.semantic-forward",
      ) ?? []
    if (semanticReceipts.length === 0) return true
    if (semanticReceipts.length !== 1) return false
    const receipt = semanticReceipts[0]!
    const matches = transitions.filter(
      ([, transition]) =>
        transition.transitionOperationId === createdBy && transition.stamp.actorId === receipt.actorId,
    )
    if (matches.length !== 1) return false
    const transition = matches[0]!
    if (effectiveByRoot.get(transition[1].rootOperationId)?.[0] !== transition[0]) return false
    return transition[1].resultBindings.some(
      (binding) => binding.ref !== null && canvasEntityKey(binding.ref) === canvasEntityKey(ref),
    )
  }
}

export function effectiveNodeData(
  snapshot: CanvasSnapshot,
  node: CanvasNodeSnapshot,
): {
  readonly data: NodeDataEnvelope
  readonly stamp: import("@convax/collaboration").PortableStamp
  readonly lifecycle: CanvasProjectedNode["generationLifecycle"]
} {
  const ownWinner = maxClaim(node.data.map((entry) => entry[1]))
  if (!ownWinner) throw new Error("Validated node has no effective data")
  const generation = canvasEffectiveGenerationForNode(snapshot, node.key)
  const output = generation.winningOutput
  const winner = output && comparePortableStamps(ownWinner.stamp, output.claim.stamp) < 0
    ? output.claim
    : ownWinner
  return { data: winner.value, stamp: winner.stamp, lifecycle: generation.lifecycle }
}

export function nodeIdentityDigest(node: CanvasCanonicalNodeRecord): Digest {
  return canvasDigest("convax.canvas-node-identity", node.identity)
}

export function edgeIdentityDigest(edge: CanvasEdgeSnapshot): Digest {
  return canvasDigest("convax.canvas-edge-identity", edge.identity)
}

export function effectiveDataDigest(snapshot: CanvasSnapshot, node: CanvasNodeSnapshot): Digest {
  return canvasDigest("convax.canvas-effective-data", {
    format: "convax.canvas-effective-data",
    data: effectiveNodeData(snapshot, node).data,
  })
}

export function dataRegisterDigest(node: CanvasNodeSnapshot): Digest {
  return canvasDigest("convax.canvas-data-register", {
    format: "convax.canvas-data-register",
    node: node.identity.ref,
    actorSlots: node.data,
  })
}

export function effectivePlugin(node: CanvasNodeSnapshot): PluginStateEnvelope | null {
  return maxClaim(node.plugin.map((entry) => entry[1]))?.value ?? null
}

export function effectivePluginDigest(node: CanvasNodeSnapshot): Digest | null {
  const plugin = effectivePlugin(node)
  return plugin === null
    ? null
    : canvasDigest("convax.canvas-effective-plugin", { format: "convax.canvas-effective-plugin", plugin })
}

export function geometryDigest(node: CanvasNodeSnapshot): Digest {
  const position = maxClaim(node.position.map((entry) => entry[1]))
  const size = maxClaim(node.size.map((entry) => entry[1]))
  if (position === null || size === null) throw new Error("Validated node has no effective geometry")
  return canvasDigest("convax.canvas-geometry", {
    format: "convax.canvas-geometry",
    node: node.identity.ref,
    position: position.value,
    size: size.value,
  })
}

export function generationLifecycleCore(
  snapshot: CanvasSnapshot,
  generationId: string,
): {
  readonly format: "convax.canvas-generation-lifecycle/2"
  readonly begin: GenerationBeginV2
  readonly terminal: OwnerGenerationTerminalV2 | null
  readonly dismissal: import("./types").GenerationDismissalV2 | null
  readonly recoveryFailure: import("./types").GenerationRecoveryFailureV2 | null
} {
  const begin = snapshot.generationBegins.get(generationId)
  if (begin === undefined) throw new Error(`Unknown generation ${generationId}`)
  return {
    format: "convax.canvas-generation-lifecycle/2",
    begin,
    terminal: snapshot.generationTerminals.get(`${generationId}/owner/${begin.beginActorId}`) ?? null,
    dismissal: snapshot.generationDismissals.get(generationId) ?? null,
    recoveryFailure: snapshot.generationRecoveryFailures.get(generationId) ?? null,
  }
}

export function generationLifecycleDigest(snapshot: CanvasSnapshot, generationId: string): Digest {
  return canvasDigest("convax.canvas-generation-lifecycle/2", generationLifecycleCore(snapshot, generationId))
}

export function projectedGenerationDigestV2(
  snapshot: CanvasSnapshot,
  node: CanvasEntityRef & { readonly kind: "node" },
): Digest {
  const lifecycles = canvasGenerationIdsForNode(snapshot, canvasEntityKey(node))
    .map((generationId) => generationLifecycleCore(snapshot, generationId))
  return canvasDigest("convax.canvas-projected-generation/2", {
    format: "convax.canvas-projected-generation/2",
    node,
    lifecycles,
  })
}

export function canvasTopLevelObstacles(snapshot: CanvasSnapshot): ReadonlyMap<string, CanvasTopLevelObstacle> {
  const cached = topLevelObstaclesBySnapshot.get(snapshot)
  if (cached) return cached
  const values = [...buildCanvasProjectionIndex(snapshot).nodesByKey]
    .filter(([, node]) => node.parent === null)
    .map(([key, node]) => [key, Object.freeze({ node: node.ref, position: node.position, size: node.size })] as const)
  obstacleIndexBuildVisits += values.length
  const obstacles = createCanvasSnapshotMap(values)
  topLevelObstaclesBySnapshot.set(snapshot, obstacles)
  let intervalRoot: CanvasObstacleIntervalNode | null = null
  for (const [key, obstacle] of values) intervalRoot = insertObstacleInterval(intervalRoot, key, obstacle)
  obstacleIntervalsBySnapshot.set(snapshot, intervalRoot)
  return obstacles
}

export function queryCanvasTopLevelObstacleCollisions(
  snapshot: CanvasSnapshot,
  position: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  gap: number,
): readonly CanvasTopLevelObstacle[] {
  if (!obstacleIntervalsBySnapshot.has(snapshot)) canvasTopLevelObstacles(snapshot)
  const result: CanvasTopLevelObstacle[] = []
  queryObstacleIntervals(
    obstacleIntervalsBySnapshot.get(snapshot) ?? null,
    position,
    size,
    gap,
    result,
  )
  return result
}

function obstacleIntervalHeight(node: CanvasObstacleIntervalNode | null): number {
  return node?.height ?? 0
}

function obstacleRight(obstacle: CanvasTopLevelObstacle): number {
  return obstacle.position.x + obstacle.size.width + 24
}

function obstacleIntervalNode(
  key: string,
  obstacle: CanvasTopLevelObstacle,
  left: CanvasObstacleIntervalNode | null,
  right: CanvasObstacleIntervalNode | null,
): CanvasObstacleIntervalNode {
  return Object.freeze({
    key,
    obstacle,
    left,
    right,
    height: 1 + Math.max(obstacleIntervalHeight(left), obstacleIntervalHeight(right)),
    maxRight: Math.max(obstacleRight(obstacle), left?.maxRight ?? -Infinity, right?.maxRight ?? -Infinity),
  })
}

function compareObstacleInterval(
  key: string,
  obstacle: CanvasTopLevelObstacle,
  current: CanvasObstacleIntervalNode,
): number {
  return obstacle.position.x - current.obstacle.position.x || compareUtf8(key, current.key)
}

function insertObstacleInterval(
  root: CanvasObstacleIntervalNode | null,
  key: string,
  obstacle: CanvasTopLevelObstacle,
): CanvasObstacleIntervalNode {
  if (!root) return obstacleIntervalNode(key, obstacle, null, null)
  const order = compareObstacleInterval(key, obstacle, root)
  if (order === 0) throw new TypeError(`Canvas obstacle interval overwrote ${key}`)
  const inserted = order < 0
    ? obstacleIntervalNode(root.key, root.obstacle, insertObstacleInterval(root.left, key, obstacle), root.right)
    : obstacleIntervalNode(root.key, root.obstacle, root.left, insertObstacleInterval(root.right, key, obstacle))
  return balanceObstacleInterval(inserted)
}

function balanceObstacleInterval(root: CanvasObstacleIntervalNode): CanvasObstacleIntervalNode {
  const skew = obstacleIntervalHeight(root.left) - obstacleIntervalHeight(root.right)
  if (skew > 1) {
    const left = root.left!
    if (obstacleIntervalHeight(left.left) < obstacleIntervalHeight(left.right)) {
      return rotateObstacleRight(obstacleIntervalNode(root.key, root.obstacle, rotateObstacleLeft(left), root.right))
    }
    return rotateObstacleRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (obstacleIntervalHeight(right.right) < obstacleIntervalHeight(right.left)) {
      return rotateObstacleLeft(obstacleIntervalNode(root.key, root.obstacle, root.left, rotateObstacleRight(right)))
    }
    return rotateObstacleLeft(root)
  }
  return root
}

function rotateObstacleLeft(root: CanvasObstacleIntervalNode): CanvasObstacleIntervalNode {
  const pivot = root.right!
  return obstacleIntervalNode(
    pivot.key,
    pivot.obstacle,
    obstacleIntervalNode(root.key, root.obstacle, root.left, pivot.left),
    pivot.right,
  )
}

function rotateObstacleRight(root: CanvasObstacleIntervalNode): CanvasObstacleIntervalNode {
  const pivot = root.left!
  return obstacleIntervalNode(
    pivot.key,
    pivot.obstacle,
    pivot.left,
    obstacleIntervalNode(root.key, root.obstacle, pivot.right, root.right),
  )
}

function queryObstacleIntervals(
  root: CanvasObstacleIntervalNode | null,
  position: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  gap: number,
  result: CanvasTopLevelObstacle[],
): void {
  if (!root || root.maxRight <= position.x) return
  obstacleQueryVisits += 1
  if (root.left?.maxRight !== undefined && root.left.maxRight > position.x) {
    queryObstacleIntervals(root.left, position, size, gap, result)
  }
  const obstacle = root.obstacle
  const horizontalLimit = position.x + size.width + gap
  if (
    obstacle.position.x < horizontalLimit &&
    position.x < obstacle.position.x + obstacle.size.width + gap &&
    position.y < obstacle.position.y + obstacle.size.height + gap &&
    position.y + size.height + gap > obstacle.position.y
  ) result.push(obstacle)
  if (root.obstacle.position.x < horizontalLimit) {
    queryObstacleIntervals(root.right, position, size, gap, result)
  }
}

export function projectionDigest(snapshot: CanvasSnapshot): Digest {
  return ordinarySha256(canonicalProjectionBytes(snapshot))
}

export function canonicalProjectionBytes(snapshot: CanvasSnapshot): Uint8Array {
  return encodeRestrictedJcs(projectCanvas(snapshot))
}

function selectContainments(
  snapshot: CanvasSnapshot,
  isNodeKeyLive: (key: string) => boolean,
): ReadonlyMap<string, ContainmentChoice | null> {
  const byChild = new Map<string, ContainmentChoice[]>()
  for (const choice of snapshot.containments.values()) {
    const childKey = canvasEntityKey(choice.child)
    if (!isNodeKeyLive(childKey)) continue
    const values = byChild.get(childKey) ?? []
    values.push(choice)
    byChild.set(childKey, values)
  }
  const selected = new Map<string, ContainmentChoice | null>()
  for (const [child, choices] of byChild) {
    const maximum = choices.reduce((winner, next) =>
      comparePortableStamps(winner.stamp, next.stamp) < 0 ? next : winner,
    )
    if (maximum.parent === null) selected.set(child, maximum)
    else {
      const parent = snapshot.nodes.get(canvasEntityKey(maximum.parent))
      selected.set(
        child,
        parent !== undefined && isNodeKeyLive(parent.key) && effectiveNodeData(snapshot, parent).data.kind === "group"
          ? maximum
          : null,
      )
    }
  }
  while (true) {
    const cycle = findContainmentCycle(selected)
    if (cycle === null) break
    let loser = cycle[0]!
    for (const candidate of cycle.slice(1)) {
      const left = selected.get(loser)
      const right = selected.get(candidate)
      if (left === null || left === undefined || right === null || right === undefined) continue
      const order = comparePortableStamps(left.stamp, right.stamp)
      if (order < 0 || (order === 0 && compareUtf8(left.relationId, right.relationId) < 0)) loser = candidate
    }
    selected.set(loser, null)
  }
  return selected
}

function findContainmentCycle(selected: ReadonlyMap<string, ContainmentChoice | null>): string[] | null {
  const done = new Set<string>()
  for (const start of [...selected.keys()].sort(compareUtf8)) {
    if (done.has(start)) continue
    const path: string[] = []
    const positions = new Map<string, number>()
    let current: string | undefined = start
    while (current !== undefined && !done.has(current)) {
      const position = positions.get(current)
      if (position !== undefined) return path.slice(position)
      positions.set(current, path.length)
      path.push(current)
      const choice = selected.get(current)
      current = choice?.parent === undefined || choice.parent === null ? undefined : canvasEntityKey(choice.parent)
    }
    for (const key of path) done.add(key)
  }
  return null
}

function effectiveMetadata<T>(entries: readonly (readonly [string, StampedClaim<T>])[], fallback: T): T {
  const winner = maxClaim(entries.map((entry) => entry[1]))
  return winner?.value ?? fallback
}
