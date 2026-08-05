import { comparePortableStampsV2, compareUtf8V2, encodeRestrictedJcsV2, ordinarySha256V2 } from "@convax/collaboration"
import { canonicalize as canonicalizeUri } from "@convax/uri"
import type { CanvasDocument, CanvasNode, CanvasNodeData } from "../types"
import type {
  BoundedOperationReceiptV2,
  CanvasCanonicalNodeRecordV2,
  CanvasEdgeSnapshotV2,
  CanvasEntityRefV2,
  CanvasNodeSnapshotV2,
  CanvasProjectedEdgeV2,
  CanvasProjectedNodeV2,
  CanvasProjectionV2,
  CanvasSnapshotV2,
  ContainmentChoiceV2,
  DigestV2,
  GenerationBeginV2,
  NodeDataEnvelopeV2,
  OwnerGenerationTerminalV2,
  PluginStateEnvelopeV2,
  StampedClaimV2,
} from "./types"
import { canvasDigestV2, canvasEntityKeyV2, maxClaimV2 } from "./validation"

export interface CanvasProjectionIndexV2 {
  readonly projection: CanvasProjectionV2
  readonly nodesByKey: ReadonlyMap<string, CanvasProjectedNodeV2>
  readonly edgesByKey: ReadonlyMap<string, CanvasProjectedEdgeV2>
  readonly selectedContainments: ReadonlyMap<string, ContainmentChoiceV2 | null>
  readonly isNodeLive: (ref: CanvasEntityRefV2 & { readonly kind: "node" }) => boolean
  readonly isEdgeLive: (ref: CanvasEntityRefV2 & { readonly kind: "edge" }) => boolean
}

/**
 * Stable Canvas-owned keys used by the disposable renderer projection. They are
 * presentation metadata, not Plugin or resource authority: Main must still
 * resolve every URI and Plugin snapshot through its owning application ports.
 */
export const canvasProjectionResourceMetadataKeyV2 = "convaxResource" as const
export const canvasProjectionPluginIdentityMetadataKeyV2 = "convaxPlugin" as const
export const canvasProjectionPluginStateMetadataKeyV2 = "convaxPluginState" as const

export interface CanvasDocumentProjectionV2 {
  readonly document: CanvasDocument
  readonly nodeEntities: ReadonlyMap<string, CanvasEntityRefV2 & { readonly kind: "node" }>
}

/**
 * Converts the canonical owner projection to the React Flow-facing document.
 * The result is disposable and pathless. Entity incarnations stay beside the
 * document so renderer commands can address the exact live entity without
 * persisting React Flow state or reconstructing identity from a node id.
 */
export function projectCanvasDocumentV2(projection: CanvasProjectionV2): CanvasDocumentProjectionV2 {
  const nodeEntities = new Map<string, CanvasEntityRefV2 & { readonly kind: "node" }>()
  const nodes = projection.nodes.map((node): CanvasNode => {
    if (nodeEntities.has(node.ref.id)) {
      throw new Error(`Canvas projection contains duplicate live node id ${node.ref.id}`)
    }
    nodeEntities.set(node.ref.id, cloneNodeRefV2(node.ref))
    return {
      id: node.ref.id,
      type: node.role,
      position: { ...node.position },
      ...(node.parent === null ? {} : { parentId: node.parent.id }),
      data: projectNodeDataV2(node),
      style: { width: node.size.width, height: node.size.height },
      ...(node.data.kind === "group" ? { zIndex: -1 } : {}),
    }
  })
  const edgeIds = new Set<string>()
  const edges = projection.edges.map((edge) => {
    if (edgeIds.has(edge.ref.id)) throw new Error(`Canvas projection contains duplicate live edge id ${edge.ref.id}`)
    edgeIds.add(edge.ref.id)
    if (!nodeEntities.has(edge.source.id) || !nodeEntities.has(edge.target.id)) {
      throw new Error(`Canvas projection edge ${edge.ref.id} references a non-live node`)
    }
    return {
      id: edge.ref.id,
      source: edge.source.id,
      target: edge.target.id,
      data: edge.data.label === null ? {} : { label: edge.data.label },
    }
  })
  return Object.freeze({
    document: {
      id: projection.identity.canvasId,
      metadata: {
        title: projection.title ?? "Untitled canvas",
        ...(projection.description === null ? {} : { description: projection.description }),
        ...(projection.tags.length === 0 ? {} : { tags: [...projection.tags] }),
      },
      nodes,
      edges,
    },
    nodeEntities,
  })
}

function projectNodeDataV2(node: CanvasProjectedNodeV2): CanvasNodeData {
  const pluginMetadata =
    node.plugin === null
      ? {}
      : {
          [canvasProjectionPluginIdentityMetadataKeyV2]: {
            id: node.plugin.pluginId,
            snapshotDigest: node.plugin.snapshotDigest,
            pluginStateSchemaDigest: node.plugin.pluginStateSchemaDigest,
          },
          [canvasProjectionPluginStateMetadataKeyV2]: structuredClone(node.plugin.state),
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
        ...(node.plugin === null ? {} : { metadata: pluginMetadata }),
      }
    case "placeholder": {
      const manualPending = node.data.owner === "manual-pending"
      const failed = manualPending
        ? node.data.state.phase === "failed"
        : node.generationLifecycle === "failed" || node.generationLifecycle === "recovery-failed"
      const publicMessage =
        manualPending && node.data.state.phase === "failed"
          ? (node.data.state.publicMessage ?? node.data.state.failureCode)
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
        metadata: pluginMetadata,
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
          [canvasProjectionResourceMetadataKeyV2]: resource,
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

function cloneNodeRefV2(
  ref: CanvasEntityRefV2 & { readonly kind: "node" },
): CanvasEntityRefV2 & { readonly kind: "node" } {
  return Object.freeze({ kind: "node", id: ref.id, incarnation: ref.incarnation })
}

export function projectCanvasV2(snapshot: CanvasSnapshotV2): CanvasProjectionV2 {
  return buildCanvasProjectionIndexV2(snapshot).projection
}

export function buildCanvasProjectionIndexV2(snapshot: CanvasSnapshotV2): CanvasProjectionIndexV2 {
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
    const live = node.creationGroup === null || isNodeKeyLive(canvasEntityKeyV2(node.creationGroup.source))
    visiting.delete(key)
    nodeMemo.set(key, live)
    return live
  }

  const isEdgeKeyLive = (key: string): boolean => {
    const edge = snapshot.edges.get(key)
    if (edge === undefined || edge.tombstones.length > 0) return false
    if (!isSemanticCreationEffective(edge.identity.createdBy, edge.identity.ref)) return false
    if (
      !isNodeKeyLive(canvasEntityKeyV2(edge.identity.source)) ||
      !isNodeKeyLive(canvasEntityKeyV2(edge.identity.target))
    )
      return false
    return edge.creationGroup === null || isNodeKeyLive(canvasEntityKeyV2(edge.creationGroup.source))
  }

  const selectedContainments = selectContainments(snapshot, isNodeKeyLive)
  const nodesByKey = new Map<string, CanvasProjectedNodeV2>()
  for (const [key, node] of [...snapshot.nodes.entries()].sort((a, b) => compareUtf8V2(a[0], b[0]))) {
    if (!isNodeKeyLive(key)) continue
    const position = maxClaimV2(node.position.map((entry) => entry[1]))
    const size = maxClaimV2(node.size.map((entry) => entry[1]))
    const plugin = maxClaimV2(node.plugin.map((entry) => entry[1]))
    if (position === null || size === null || plugin === null) continue
    const effective = effectiveNodeDataV2(snapshot, node)
    const parentChoice = selectedContainments.get(key) ?? null
    const parent = parentChoice?.parent ?? null
    nodesByKey.set(
      key,
      Object.freeze({
        ref: node.identity.ref,
        role: node.identity.role,
        position: position.value,
        size: size.value,
        data: effective.data,
        plugin: plugin.value,
        parent,
        generationLifecycle: effective.lifecycle,
      }),
    )
  }

  const edgesByKey = new Map<string, CanvasProjectedEdgeV2>()
  for (const [key, edge] of [...snapshot.edges.entries()].sort((a, b) => compareUtf8V2(a[0], b[0]))) {
    if (!isEdgeKeyLive(key)) continue
    const data = maxClaimV2(edge.data.map((entry) => entry[1]))
    if (data === null) continue
    edgesByKey.set(
      key,
      Object.freeze({
        ref: edge.identity.ref,
        source: edge.identity.source,
        target: edge.identity.target,
        data: data.value,
      }),
    )
  }

  const projection = Object.freeze({
    identity: snapshot.identity,
    title: effectiveMetadata(snapshot.meta.title, null),
    description: effectiveMetadata(snapshot.meta.description, null),
    tags: effectiveMetadata(snapshot.meta.tags, [] as readonly string[]),
    nodes: Object.freeze([...nodesByKey.values()]),
    edges: Object.freeze([...edgesByKey.values()]),
  })
  return Object.freeze({
    projection,
    nodesByKey,
    edgesByKey,
    selectedContainments,
    isNodeLive: (ref: CanvasEntityRefV2 & { readonly kind: "node" }) => isNodeKeyLive(canvasEntityKeyV2(ref)),
    isEdgeLive: (ref: CanvasEntityRefV2 & { readonly kind: "edge" }) => isEdgeKeyLive(canvasEntityKeyV2(ref)),
  })
}

function semanticCreationLiveness(snapshot: CanvasSnapshotV2): (createdBy: string, ref: CanvasEntityRefV2) => boolean {
  const receiptByOperation = new Map<string, BoundedOperationReceiptV2[]>()
  for (const receipt of snapshot.operations.values()) {
    const values = receiptByOperation.get(receipt.operationId) ?? []
    values.push(receipt)
    receiptByOperation.set(receipt.operationId, values)
  }
  const transitions = [...snapshot.semanticHistory.entries()].filter(
    (entry): entry is [string, import("./types").SemanticHistoryTransitionV2] =>
      entry[1].format === "convax.canvas-semantic-history-transition/2",
  )
  const effectiveByRoot = new Map<string, (typeof transitions)[number]>()
  for (const entry of transitions) {
    const current = effectiveByRoot.get(entry[1].rootOperationId)
    if (current === undefined) {
      effectiveByRoot.set(entry[1].rootOperationId, entry)
      continue
    }
    const stampOrder = comparePortableStampsV2(current[1].stamp, entry[1].stamp)
    if (stampOrder < 0 || (stampOrder === 0 && compareUtf8V2(current[0], entry[0]) < 0))
      effectiveByRoot.set(entry[1].rootOperationId, entry)
  }

  return (createdBy, ref) => {
    const receipts = receiptByOperation.get(createdBy)
    const semanticReceipts =
      receipts?.filter(
        (receipt) =>
          receipt.intentKind === "canvas.undo.semantic-inverse/2" ||
          receipt.intentKind === "canvas.redo.semantic-forward/2",
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
      (binding) => binding.ref !== null && canvasEntityKeyV2(binding.ref) === canvasEntityKeyV2(ref),
    )
  }
}

export function effectiveNodeDataV2(
  snapshot: CanvasSnapshotV2,
  node: CanvasNodeSnapshotV2,
): {
  readonly data: NodeDataEnvelopeV2
  readonly stamp: import("@convax/collaboration").PortableStampV2
  readonly lifecycle: CanvasProjectedNodeV2["generationLifecycle"]
} {
  const claims: { claim: StampedClaimV2<NodeDataEnvelopeV2>; begin?: GenerationBeginV2 }[] = node.data.map((entry) => ({
    claim: entry[1],
  }))
  let selectedLifecycle: { begin: GenerationBeginV2; lifecycle: CanvasProjectedNodeV2["generationLifecycle"] } | null =
    null
  for (const begin of snapshot.generationBegins.values()) {
    if (canvasEntityKeyV2(begin.node) !== node.key) continue
    const dismissal = snapshot.generationDismissals.get(begin.generationId)
    const terminal = snapshot.generationTerminals.get(`${begin.generationId}/owner/${begin.beginActorId}`)
    const recovery = snapshot.generationRecoveryFailures.get(begin.generationId)
    const lifecycle: CanvasProjectedNodeV2["generationLifecycle"] =
      dismissal !== undefined
        ? "dismissed"
        : terminal?.phase === "succeeded"
          ? "succeeded"
          : terminal?.phase === "failed"
            ? "failed"
            : recovery !== undefined
              ? "recovery-failed"
              : "active"
    if (selectedLifecycle === null || comparePortableStampsV2(selectedLifecycle.begin.beginStamp, begin.beginStamp) < 0)
      selectedLifecycle = { begin, lifecycle }
    if (dismissal === undefined && terminal?.phase === "succeeded") {
      claims.push({
        claim: { format: "convax.canvas-stamped-claim/2", stamp: begin.outputClaimStamp, value: terminal.outputData },
        begin,
      })
    }
  }
  const winner = claims.reduce((current, next) =>
    comparePortableStampsV2(current.claim.stamp, next.claim.stamp) < 0 ? next : current,
  )
  return { data: winner.claim.value, stamp: winner.claim.stamp, lifecycle: selectedLifecycle?.lifecycle ?? "none" }
}

export function nodeIdentityDigestV2(node: CanvasCanonicalNodeRecordV2): DigestV2 {
  return canvasDigestV2("convax.canvas-node-identity/2", node.identity)
}

export function edgeIdentityDigestV2(edge: CanvasEdgeSnapshotV2): DigestV2 {
  return canvasDigestV2("convax.canvas-edge-identity/2", edge.identity)
}

export function effectiveDataDigestV2(snapshot: CanvasSnapshotV2, node: CanvasNodeSnapshotV2): DigestV2 {
  return canvasDigestV2("convax.canvas-effective-data/2", {
    format: "convax.canvas-effective-data/2",
    data: effectiveNodeDataV2(snapshot, node).data,
  })
}

export function dataRegisterDigestV2(node: CanvasNodeSnapshotV2): DigestV2 {
  return canvasDigestV2("convax.canvas-data-register/2", {
    format: "convax.canvas-data-register/2",
    node: node.identity.ref,
    actorSlots: node.data,
  })
}

export function effectivePluginV2(node: CanvasNodeSnapshotV2): PluginStateEnvelopeV2 | null {
  return maxClaimV2(node.plugin.map((entry) => entry[1]))?.value ?? null
}

export function effectivePluginDigestV2(node: CanvasNodeSnapshotV2): DigestV2 | null {
  const plugin = effectivePluginV2(node)
  return plugin === null
    ? null
    : canvasDigestV2("convax.canvas-effective-plugin/2", { format: "convax.canvas-effective-plugin/2", plugin })
}

export function geometryDigestV2(node: CanvasNodeSnapshotV2): DigestV2 {
  const position = maxClaimV2(node.position.map((entry) => entry[1]))
  const size = maxClaimV2(node.size.map((entry) => entry[1]))
  if (position === null || size === null) throw new Error("Validated node has no effective geometry")
  return canvasDigestV2("convax.canvas-geometry/2", {
    format: "convax.canvas-geometry/2",
    node: node.identity.ref,
    position: position.value,
    size: size.value,
  })
}

export function generationLifecycleCoreV2(
  snapshot: CanvasSnapshotV2,
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

export function generationLifecycleDigestV2(snapshot: CanvasSnapshotV2, generationId: string): DigestV2 {
  return canvasDigestV2("convax.canvas-generation-lifecycle/2", generationLifecycleCoreV2(snapshot, generationId))
}

export function projectedGenerationDigestV2(
  snapshot: CanvasSnapshotV2,
  node: CanvasEntityRefV2 & { readonly kind: "node" },
): DigestV2 {
  const lifecycles = [...snapshot.generationBegins.values()]
    .filter((begin) => canvasEntityKeyV2(begin.node) === canvasEntityKeyV2(node))
    .sort((a, b) => compareUtf8V2(a.generationId, b.generationId))
    .map((begin) => generationLifecycleCoreV2(snapshot, begin.generationId))
  return canvasDigestV2("convax.canvas-projected-generation/2", {
    format: "convax.canvas-projected-generation/2",
    node,
    lifecycles,
  })
}

export function obstacleProjectionDigestV2(snapshot: CanvasSnapshotV2): DigestV2 {
  const index = buildCanvasProjectionIndexV2(snapshot)
  const obstacles = index.projection.nodes
    .filter((node) => node.parent === null)
    .map((node) => ({ node: node.ref, position: node.position, size: node.size }))
    .sort((a, b) => compareUtf8V2(canvasEntityKeyV2(a.node), canvasEntityKeyV2(b.node)))
  return canvasDigestV2("convax.canvas-obstacle-projection/2", {
    format: "convax.canvas-obstacle-projection/2",
    obstacles,
  })
}

export function projectionDigestV2(snapshot: CanvasSnapshotV2): DigestV2 {
  return ordinarySha256V2(canonicalProjectionBytesV2(snapshot))
}

export function canonicalProjectionBytesV2(snapshot: CanvasSnapshotV2): Uint8Array {
  return encodeRestrictedJcsV2(projectCanvasV2(snapshot))
}

function selectContainments(
  snapshot: CanvasSnapshotV2,
  isNodeKeyLive: (key: string) => boolean,
): ReadonlyMap<string, ContainmentChoiceV2 | null> {
  const byChild = new Map<string, ContainmentChoiceV2[]>()
  for (const choice of snapshot.containments.values()) {
    const childKey = canvasEntityKeyV2(choice.child)
    if (!isNodeKeyLive(childKey)) continue
    const values = byChild.get(childKey) ?? []
    values.push(choice)
    byChild.set(childKey, values)
  }
  const selected = new Map<string, ContainmentChoiceV2 | null>()
  for (const [child, choices] of byChild) {
    const maximum = choices.reduce((winner, next) =>
      comparePortableStampsV2(winner.stamp, next.stamp) < 0 ? next : winner,
    )
    if (maximum.parent === null) selected.set(child, maximum)
    else {
      const parent = snapshot.nodes.get(canvasEntityKeyV2(maximum.parent))
      selected.set(
        child,
        parent !== undefined && isNodeKeyLive(parent.key) && effectiveNodeDataV2(snapshot, parent).data.kind === "group"
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
      const order = comparePortableStampsV2(left.stamp, right.stamp)
      if (order < 0 || (order === 0 && compareUtf8V2(left.relationId, right.relationId) < 0)) loser = candidate
    }
    selected.set(loser, null)
  }
  return selected
}

function findContainmentCycle(selected: ReadonlyMap<string, ContainmentChoiceV2 | null>): string[] | null {
  const done = new Set<string>()
  for (const start of [...selected.keys()].sort(compareUtf8V2)) {
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
      current = choice?.parent === undefined || choice.parent === null ? undefined : canvasEntityKeyV2(choice.parent)
    }
    for (const key of path) done.add(key)
  }
  return null
}

function effectiveMetadata<T>(entries: readonly (readonly [string, StampedClaimV2<T>])[], fallback: T): T {
  const winner = maxClaimV2(entries.map((entry) => entry[1]))
  return winner?.value ?? fallback
}
