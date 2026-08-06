import { comparePortableStamps, compareUtf8, encodeRestrictedJcs, ordinarySha256 } from "@convax/collaboration"
import { canonicalize as canonicalizeUri } from "@convax/uri"
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

export interface CanvasProjectionIndex {
  readonly projection: CanvasProjection
  readonly nodesByKey: ReadonlyMap<string, CanvasProjectedNode>
  readonly edgesByKey: ReadonlyMap<string, CanvasProjectedEdge>
  readonly selectedContainments: ReadonlyMap<string, ContainmentChoice | null>
  readonly isNodeLive: (ref: CanvasEntityRef & { readonly kind: "node" }) => boolean
  readonly isEdgeLive: (ref: CanvasEntityRef & { readonly kind: "edge" }) => boolean
}

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
  readonly nodeEntities: ReadonlyMap<string, CanvasEntityRef & { readonly kind: "node" }>
}

/**
 * Converts the canonical owner projection to the React Flow-facing document.
 * The result is disposable and pathless. Entity incarnations stay beside the
 * document so renderer commands can address the exact live entity without
 * persisting React Flow state or reconstructing identity from a node id.
 */
export function projectCanvasDocument(projection: CanvasProjection): CanvasDocumentProjection {
  const nodeEntities = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
  const nodes = projection.nodes.map((node): CanvasNode => {
    if (nodeEntities.has(node.ref.id)) {
      throw new Error(`Canvas projection contains duplicate live node id ${node.ref.id}`)
    }
    nodeEntities.set(node.ref.id, cloneNodeRef(node.ref))
    return {
      id: node.ref.id,
      type: node.role,
      position: { ...node.position },
      ...(node.parent === null ? {} : { parentId: node.parent.id }),
      data: projectNodeData(node),
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
        metadata: {
          ...pluginMetadata,
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

function cloneNodeRef(
  ref: CanvasEntityRef & { readonly kind: "node" },
): CanvasEntityRef & { readonly kind: "node" } {
  return Object.freeze({ kind: "node", id: ref.id, incarnation: ref.incarnation })
}

export function projectCanvas(snapshot: CanvasSnapshot): CanvasProjection {
  return buildCanvasProjectionIndex(snapshot).projection
}

export function buildCanvasProjectionIndex(snapshot: CanvasSnapshot): CanvasProjectionIndex {
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
    if (
      !isNodeKeyLive(canvasEntityKey(edge.identity.source)) ||
      !isNodeKeyLive(canvasEntityKey(edge.identity.target))
    )
      return false
    return edge.creationGroup === null || isNodeKeyLive(canvasEntityKey(edge.creationGroup.source))
  }

  const selectedContainments = selectContainments(snapshot, isNodeKeyLive)
  const nodesByKey = new Map<string, CanvasProjectedNode>()
  for (const [key, node] of [...snapshot.nodes.entries()].sort((a, b) => compareUtf8(a[0], b[0]))) {
    if (!isNodeKeyLive(key)) continue
    const position = maxClaim(node.position.map((entry) => entry[1]))
    const size = maxClaim(node.size.map((entry) => entry[1]))
    const plugin = maxClaim(node.plugin.map((entry) => entry[1]))
    if (position === null || size === null || plugin === null) continue
    const effective = effectiveNodeData(snapshot, node)
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

  const edgesByKey = new Map<string, CanvasProjectedEdge>()
  for (const [key, edge] of [...snapshot.edges.entries()].sort((a, b) => compareUtf8(a[0], b[0]))) {
    if (!isEdgeKeyLive(key)) continue
    const data = maxClaim(edge.data.map((entry) => entry[1]))
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
    isNodeLive: (ref: CanvasEntityRef & { readonly kind: "node" }) => isNodeKeyLive(canvasEntityKey(ref)),
    isEdgeLive: (ref: CanvasEntityRef & { readonly kind: "edge" }) => isEdgeKeyLive(canvasEntityKey(ref)),
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
  const claims: { claim: StampedClaim<NodeDataEnvelope>; begin?: GenerationBeginV2 }[] = node.data.map((entry) => ({
    claim: entry[1],
  }))
  let selectedLifecycle: { begin: GenerationBeginV2; lifecycle: CanvasProjectedNode["generationLifecycle"] } | null =
    null
  for (const begin of snapshot.generationBegins.values()) {
    if (canvasEntityKey(begin.node) !== node.key) continue
    const dismissal = snapshot.generationDismissals.get(begin.generationId)
    const terminal = snapshot.generationTerminals.get(`${begin.generationId}/owner/${begin.beginActorId}`)
    const recovery = snapshot.generationRecoveryFailures.get(begin.generationId)
    const lifecycle: CanvasProjectedNode["generationLifecycle"] =
      dismissal !== undefined
        ? "dismissed"
        : terminal?.phase === "succeeded"
          ? "succeeded"
          : terminal?.phase === "failed"
            ? "failed"
            : recovery !== undefined
              ? "recovery-failed"
              : "active"
    if (selectedLifecycle === null || comparePortableStamps(selectedLifecycle.begin.beginStamp, begin.beginStamp) < 0)
      selectedLifecycle = { begin, lifecycle }
    if (dismissal === undefined && terminal?.phase === "succeeded") {
      claims.push({
        claim: { format: "convax.canvas-stamped-claim", stamp: begin.outputClaimStamp, value: terminal.outputData },
        begin,
      })
    }
  }
  const winner = claims.reduce((current, next) =>
    comparePortableStamps(current.claim.stamp, next.claim.stamp) < 0 ? next : current,
  )
  return { data: winner.claim.value, stamp: winner.claim.stamp, lifecycle: selectedLifecycle?.lifecycle ?? "none" }
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
  const lifecycles = [...snapshot.generationBegins.values()]
    .filter((begin) => canvasEntityKey(begin.node) === canvasEntityKey(node))
    .sort((a, b) => compareUtf8(a.generationId, b.generationId))
    .map((begin) => generationLifecycleCore(snapshot, begin.generationId))
  return canvasDigest("convax.canvas-projected-generation/2", {
    format: "convax.canvas-projected-generation/2",
    node,
    lifecycles,
  })
}

export function obstacleProjectionDigest(snapshot: CanvasSnapshot): Digest {
  const index = buildCanvasProjectionIndex(snapshot)
  const obstacles = index.projection.nodes
    .filter((node) => node.parent === null)
    .map((node) => ({ node: node.ref, position: node.position, size: node.size }))
    .sort((a, b) => compareUtf8(canvasEntityKey(a.node), canvasEntityKey(b.node)))
  return canvasDigest("convax.canvas-obstacle-projection", {
    format: "convax.canvas-obstacle-projection",
    obstacles,
  })
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
