import type {
  OwnerExternalFactPort,
  OwnerIntentConstructionContext,
  OwnerIntentDependencies,
} from "@convax/collaboration"
import { parseUint32 } from "@convax/collaboration"
import type { CanvasRendererCommandV2 } from "./session"
import {
  dataRegisterDigestV2,
  effectiveDataDigestV2,
  geometryDigestV2,
  effectivePluginV2,
  effectivePluginDigestV2,
  edgeIdentityDigestV2,
  nodeIdentityDigestV2,
  obstacleProjectionDigestV2,
} from "./projection"
import { materializeCanvasSemanticHistoryIntentV2 } from "./reducer"
import { createCanvasExternalFactContextV2, discoverCanvasValueDependenciesV2 } from "./external-facts"
import type {
  CanvasEntityRefV2,
  CanvasResourceProofRefV2,
  CanvasSnapshotV2,
  CanvasTypedIntentUnionV2,
  EdgeCreateTemplateV2,
  NodeCreateTemplateV2,
  PluginRequirementV2,
  PluginStateEnvelopeV2,
} from "./types"
import { assertCanvasTypedIntentV2 } from "./intent-validation"
import {
  canvasDigestV2,
  canvasEntityKeyV2,
  deriveCanvasIdV2,
  derivedEdgeRefV2,
  derivedNodeRefV2,
  sameCanonicalValueV2,
} from "./validation"
import { buildCanvasProjectionIndexV2 } from "./projection"

export type CanvasAuthoritativeCommandV2 =
  | Readonly<{ readonly kind: "renderer"; readonly command: CanvasRendererCommandV2 }>
  | Readonly<{
      readonly kind: "agent-node-create"
      readonly title: string
      readonly instructions: string | null
      readonly position: Readonly<{ x: number; y: number }>
      readonly size: Readonly<{ width: number; height: number }>
    }>
  | Readonly<{
      readonly kind: "resources-create"
      readonly anchor: Readonly<{ x: number; y: number }>
      readonly items: readonly Readonly<{
        readonly title: string
        readonly proof: Extract<CanvasResourceProofRefV2, { readonly mode: "current-owner-state" }>
        readonly size: Readonly<{ width: number; height: number }>
      }>[]
    }>
  | Readonly<{
      readonly kind: "manual-resource-placeholders-create"
      readonly anchor: Readonly<{ x: number; y: number }>
      readonly items: readonly Readonly<{
        readonly title: string
        readonly expectedClass: "text" | "image" | "video" | "audio" | "file"
        readonly size: Readonly<{ width: number; height: number }>
      }>[]
    }>
  | Readonly<{
      readonly kind: "edge-connect"
      readonly source: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly target: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly label: string | null
    }>
  | Readonly<{
      /** Canvas-owned exact removal set, including the observed incident-edge closure. */
      readonly kind: "elements-remove"
      readonly nodes: readonly (CanvasEntityRefV2 & { readonly kind: "node" })[]
      readonly edges: readonly (CanvasEntityRefV2 & { readonly kind: "edge" })[]
    }>
  | Readonly<{
      readonly kind: "geometry-set"
      readonly updates: readonly Readonly<{
        readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
        readonly position: Readonly<{ x: number; y: number }>
        readonly size: Readonly<{ width: number; height: number }> | null
      }>[]
    }>
  | Readonly<{
      readonly kind: "nodes-group"
      readonly children: readonly (CanvasEntityRefV2 & { readonly kind: "node" })[]
      readonly title: string
    }>
  | Readonly<{
      readonly kind: "nodes-ungroup"
      readonly group: CanvasEntityRefV2 & { readonly kind: "node" }
    }>
  | Readonly<{
      readonly kind: "structural-parent-set"
      readonly child: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly parent: (CanvasEntityRefV2 & { readonly kind: "node" }) | null
    }>
  | Readonly<{
      readonly kind: "resource-relink"
      readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
      readonly title: string
      readonly proof: Extract<CanvasResourceProofRefV2, { readonly mode: "current-owner-state" }>
    }>
  | Readonly<{
      /** Host-owned validated envelope; never accepted from a Plugin renderer. */
      readonly kind: "plugin-state-set"
      readonly node: CanvasEntityRefV2 & { readonly kind: "node" }
      /** Exact leased Plugin owner. Install/upgrade/removal require a different command. */
      readonly owner: PluginRequirementV2
      readonly plugin: PluginStateEnvelopeV2
    }>
  | CanvasPluginCreationGroupCommandV2

export interface CanvasPluginCreationGroupCommandV2 {
  readonly kind: "plugin-creation-group"
  readonly source: CanvasEntityRefV2 & { readonly kind: "node" }
  readonly plugin: PluginRequirementV2
  readonly nodes: readonly Readonly<{
    readonly role: "file" | "agent"
    readonly position: Readonly<{ x: number; y: number }>
    readonly size: Readonly<{ width: number; height: number }>
    readonly data: NodeCreateTemplateV2["data"]
    readonly plugin: PluginStateEnvelopeV2
    readonly resourceProof?: Extract<CanvasResourceProofRefV2, { readonly mode: "current-owner-state" }>
  }>[]
  readonly edges: readonly Readonly<{
    readonly source:
      | { readonly mode: "existing"; readonly ref: CanvasEntityRefV2 & { readonly kind: "node" } }
      | { readonly mode: "created"; readonly nodeIndex: number }
    readonly target:
      | { readonly mode: "existing"; readonly ref: CanvasEntityRefV2 & { readonly kind: "node" } }
      | { readonly mode: "created"; readonly nodeIndex: number }
    readonly label: string | null
  }>[]
}

export interface CanvasClosedIntentConstructionV2 {
  readonly intent: CanvasTypedIntentUnionV2
  readonly dependencies: OwnerIntentDependencies<"canvas">
}

/**
 * Canvas-owned guard construction against the latest validated replica state.
 * Desktop supplies caller intent and identity context, never digests or raw
 * typed-intent guards.
 */
export function constructCanvasAuthoritativeIntentV2(input: {
  readonly snapshot: CanvasSnapshotV2
  readonly context: OwnerIntentConstructionContext
  readonly command: CanvasAuthoritativeCommandV2
}): CanvasClosedIntentConstructionV2 | "rejected" {
  try {
    const intent = constructIntent(input.snapshot, input.context, input.command)
    assertCanvasTypedIntentV2(intent)
    const dependencies = discoverCanvasValueDependenciesV2(input.context, intent)
    return dependencies === "rejected" ? "rejected" : Object.freeze({ intent, dependencies })
  } catch {
    return "rejected"
  }
}

export function discoverCanvasHistoryIntentDependenciesV2(input: {
  readonly snapshot: CanvasSnapshotV2
  readonly context: OwnerIntentConstructionContext
  readonly direction: "undo" | "redo"
  readonly rootOperationId: import("./types").Id128
}): OwnerIntentDependencies<"canvas"> | "rejected" {
  const intent = materializeCanvasSemanticHistoryIntentV2(
    input.snapshot,
    input.context,
    input.direction,
    input.rootOperationId,
  )
  if (intent === "rejected") return "rejected"
  return discoverCanvasValueDependenciesV2(input.context, intent)
}

/**
 * Materializes history only after the collaboration kernel has resolved the
 * exact dependency set discovered above. Desktop never constructs semantic
 * inverse/forward guards.
 */
export function constructCanvasHistoryIntentV2(input: {
  readonly snapshot: CanvasSnapshotV2
  readonly context: OwnerIntentConstructionContext
  readonly direction: "undo" | "redo"
  readonly rootOperationId: import("./types").Id128
  readonly externalFacts: OwnerExternalFactPort<"canvas">
}): CanvasClosedIntentConstructionV2 | "pending" | "rejected" {
  const intent = materializeCanvasSemanticHistoryIntentV2(
    input.snapshot,
    input.context,
    input.direction,
    input.rootOperationId,
  )
  if (intent === "rejected") return "rejected"
  const dependencies = discoverCanvasValueDependenciesV2(input.context, intent)
  if (dependencies === "rejected") return "rejected"
  const facts = createCanvasExternalFactContextV2(input.context, intent, input.externalFacts)
  if (facts === "pending" || facts === "rejected") return facts
  // Requiring the exact consumed ledger prevents a caller from supplying a
  // broader or stale fact port to the history commit.
  if (!sameCanonicalValueV2(input.externalFacts.consumedDependencies(), dependencies)) return "rejected"
  return Object.freeze({ intent, dependencies })
}

function constructIntent(
  snapshot: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  command: CanvasAuthoritativeCommandV2,
): CanvasTypedIntentUnionV2 {
  if (command.kind === "renderer") return rendererIntent(snapshot, command.command)
  if (command.kind === "agent-node-create") {
    const ordinal = parseUint32("0")
    const node = derivedNodeRefV2(context, ordinal)
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "canvas.agent.create",
      guard: Object.freeze({ ordinal, node, expectedAbsent: true }),
      body: Object.freeze({
        node: Object.freeze({
          ordinal,
          nodeId: node.id,
          incarnation: node.incarnation,
          role: "agent",
          position: Object.freeze({ ...command.position }),
          size: Object.freeze({ ...command.size }),
          data: Object.freeze({
            format: "convax.canvas-node-data/2",
            kind: "agent",
            title: command.title,
            instructions: command.instructions,
          }),
          plugin: null,
        }),
      }),
    })
  }
  if (command.kind === "resources-create") {
    if (command.items.length < 1 || command.items.length > 85) throw new RangeError("Manual resource count is invalid")
    const nodes = command.items.map((item, index) => {
      const ordinal = parseUint32(String(index))
      const node = derivedNodeRefV2(context, ordinal)
      return Object.freeze({ ordinal, node, item })
    })
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "canvas.resources.add/2",
      guard: Object.freeze({
        existingEndpoints: Object.freeze([]),
        derivedNodes: Object.freeze(nodes.map(({ ordinal, node }) => Object.freeze({ ordinal, node, expectedAbsent: true }))),
        derivedEdges: Object.freeze([]),
        resourceProofs: Object.freeze(nodes.map(({ ordinal, item }) => Object.freeze({
          createdNodeOrdinal: ordinal,
          proof: item.proof,
        }))),
      }),
      body: Object.freeze({
        placement: Object.freeze({
          anchor: Object.freeze({ ...command.anchor }),
          gap: 24 as const,
          obstacleProjectionDigest: obstacleProjectionDigestV2(snapshot),
        }),
        nodes: Object.freeze(nodes.map(({ ordinal, node, item }) => Object.freeze({
          ordinal,
          nodeId: node.id,
          incarnation: node.incarnation,
          size: Object.freeze({ ...item.size }),
          title: item.title,
          resource: item.proof.resource,
        }))),
        edges: Object.freeze([]),
      }),
    })
  }
  if (command.kind === "manual-resource-placeholders-create") {
    if (command.items.length < 1 || command.items.length > 85) throw new RangeError("Manual resource count is invalid")
    const nodes = command.items.map((item, index) => {
      const ordinal = parseUint32(String(index))
      const node = derivedNodeRefV2(context, ordinal)
      return Object.freeze({ ordinal, node, item })
    })
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "canvas.resources.pending.create/2",
      guard: Object.freeze({
        existingEndpoints: Object.freeze([]),
        derivedNodes: Object.freeze(nodes.map(({ ordinal, node }) => Object.freeze({ ordinal, node, expectedAbsent: true }))),
        derivedEdges: Object.freeze([]),
      }),
      body: Object.freeze({
        placement: Object.freeze({
          anchor: Object.freeze({ ...command.anchor }),
          gap: 24 as const,
          obstacleProjectionDigest: obstacleProjectionDigestV2(snapshot),
        }),
        nodes: Object.freeze(nodes.map(({ ordinal, node, item }) => Object.freeze({
          ordinal,
          nodeId: node.id,
          incarnation: node.incarnation,
          size: Object.freeze({ ...item.size }),
          title: item.title,
          expectedClass: item.expectedClass,
        }))),
        edges: Object.freeze([]),
      }),
    })
  }
  if (command.kind === "edge-connect") {
    const ordinal = parseUint32("0")
    const edge = derivedEdgeRefV2(context, ordinal)
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "canvas.edges.connect/2",
      guard: Object.freeze({
        edge: Object.freeze({ ordinal, edge, expectedAbsent: true }),
        source: connectableGuard(snapshot, command.source),
        target: connectableGuard(snapshot, command.target),
      }),
      body: Object.freeze({
        edge: Object.freeze({
          ordinal,
          edgeId: edge.id,
          incarnation: edge.incarnation,
          source: Object.freeze({ ...command.source }),
          target: Object.freeze({ ...command.target }),
          data: Object.freeze({ format: "convax.canvas-edge-data/2", kind: "business", label: command.label }),
        }),
      }),
    })
  }
  if (command.kind === "elements-remove") return removeElementsIntent(snapshot, command)
  if (command.kind === "geometry-set") return geometryIntent(snapshot, command.updates)
  if (command.kind === "nodes-group") return groupNodesIntent(snapshot, context, command)
  if (command.kind === "nodes-ungroup") return ungroupNodesIntent(snapshot, context, command.group)
  if (command.kind === "structural-parent-set") {
    if (command.parent !== null) {
      const parent = requireLiveNode(snapshot, command.parent)
      if (buildCanvasProjectionIndexV2(snapshot).nodesByKey.get(canvasEntityKeyV2(parent.identity.ref))?.data.kind !== "group") {
        throw new TypeError("Canvas structural parent is not a group")
      }
    }
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "canvas.nodes.set-structural-parent/2",
      guard: Object.freeze({
        child: containmentGuard(snapshot, context, command.child),
        parent: command.parent === null ? null : nodeLiveGuard(snapshot, command.parent),
      }),
      body: Object.freeze({
        child: Object.freeze({ ...command.child }),
        parent: command.parent === null ? null : Object.freeze({ ...command.parent }),
        relationId: derivedRelationId(context, 0),
      }),
    })
  }
  if (command.kind === "resource-relink") {
    const node = requireLiveNode(snapshot, command.node)
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "canvas.nodes.update-data/2",
      guard: Object.freeze({
        node: nodeDataGuard(snapshot, node),
        resourceProof: structuredClone(command.proof),
      }),
      body: Object.freeze({
        node: Object.freeze({ ...command.node }),
        data: Object.freeze({
          format: "convax.canvas-node-data/2",
          kind: "resource",
          title: command.title,
          resource: structuredClone(command.proof.resource),
        }),
      }),
    })
  }
  if (command.kind === "plugin-state-set") {
    const node = requireLiveNode(snapshot, command.node)
    const current = effectivePluginV2(node)
    if (
      current === null ||
      !samePluginRequirement(current, command.owner) ||
      !samePluginRequirement(command.plugin, command.owner)
    ) {
      throw new TypeError("Plugin state update does not match the canonical node owner")
    }
    const requirement = structuredClone(command.owner)
    return Object.freeze({
      format: "convax.typed-intent/2",
      kind: "canvas.nodes.set-plugin-state/2",
      guard: Object.freeze({
        node: Object.freeze({
          node: Object.freeze({ ...command.node }),
          expectedLive: true,
          expectedIdentityDigest: nodeIdentityDigestV2(node),
          expectedPluginDigest: effectivePluginDigestV2(node),
          requirement,
        }),
      }),
      body: Object.freeze({
        node: Object.freeze({ ...command.node }),
        plugin: structuredClone(command.plugin),
      }),
    })
  }
  return pluginCreationGroupIntent(snapshot, context, command)
}

function removeElementsIntent(
  snapshot: CanvasSnapshotV2,
  command: Extract<CanvasAuthoritativeCommandV2, { readonly kind: "elements-remove" }>,
): CanvasTypedIntentUnionV2 {
  if (command.nodes.length + command.edges.length < 1 || command.nodes.length + command.edges.length > 510) {
    throw new RangeError("Canvas removal set is empty or exceeds its bound")
  }
  const nodeKeys = new Set<string>()
  const nodes = command.nodes.map((ref) => {
    const key = canvasEntityKeyV2(ref)
    if (nodeKeys.has(key)) throw new TypeError("Canvas removal contains a duplicate node")
    nodeKeys.add(key)
    const node = requireLiveNode(snapshot, ref)
    return Object.freeze({ ...node.identity.ref })
  })
  const index = buildCanvasProjectionIndexV2(snapshot)
  const edgeKeys = new Set<string>()
  const edges = command.edges.map((ref) => {
    const key = canvasEntityKeyV2(ref)
    if (edgeKeys.has(key)) throw new TypeError("Canvas removal contains a duplicate edge")
    edgeKeys.add(key)
    const edge = snapshot.edges.get(key)
    if (!edge || !index.isEdgeLive(ref)) throw new TypeError("Canvas edge guard is stale")
    return Object.freeze({ ...edge.identity.ref })
  })
  for (const edge of index.projection.edges) {
    const incident = nodeKeys.has(canvasEntityKeyV2(edge.source)) || nodeKeys.has(canvasEntityKeyV2(edge.target))
    if (incident && !edgeKeys.has(canvasEntityKeyV2(edge.ref))) {
      throw new TypeError("Canvas removal is missing its observed incident-edge closure")
    }
  }
  return Object.freeze({
    format: "convax.typed-intent/2",
    kind: "canvas.elements.remove/2",
    guard: Object.freeze({
      nodes: Object.freeze(nodes.map((ref) => nodeLiveGuard(snapshot, ref))),
      edges: Object.freeze(edges.map((ref) => edgeLiveGuard(snapshot, ref))),
      requireObservedIncidentEdgeClosure: true,
    }),
    body: Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) }),
  })
}

function geometryIntent(
  snapshot: CanvasSnapshotV2,
  updates: Extract<CanvasAuthoritativeCommandV2, { readonly kind: "geometry-set" }>["updates"],
): CanvasTypedIntentUnionV2 {
  if (updates.length < 1 || updates.length > 256) throw new RangeError("Canvas geometry update count is invalid")
  const seen = new Set<string>()
  const guards = updates.map((update) => {
    const key = canvasEntityKeyV2(update.node)
    if (seen.has(key)) throw new TypeError("Canvas geometry contains a duplicate node")
    seen.add(key)
    if (!Number.isFinite(update.position.x) || !Number.isFinite(update.position.y)) {
      throw new TypeError("Canvas geometry position is invalid")
    }
    if (
      update.size !== null &&
      (!Number.isFinite(update.size.width) || update.size.width <= 0 || !Number.isFinite(update.size.height) || update.size.height <= 0)
    ) {
      throw new TypeError("Canvas geometry size is invalid")
    }
    const node = requireLiveNode(snapshot, update.node)
    return Object.freeze({
      ...nodeLiveGuard(snapshot, update.node),
      expectedGeometryDigest: geometryDigestV2(node),
    })
  })
  return Object.freeze({
    format: "convax.typed-intent/2",
    kind: "canvas.nodes.set-geometry/2",
    guard: Object.freeze({ nodes: Object.freeze(guards) }),
    body: Object.freeze({
      updates: Object.freeze(updates.map((update) => Object.freeze({
        node: Object.freeze({ ...update.node }),
        position: Object.freeze({ ...update.position }),
        size: update.size === null ? null : Object.freeze({ ...update.size }),
      }))),
    }),
  })
}

function groupNodesIntent(
  snapshot: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  command: Extract<CanvasAuthoritativeCommandV2, { readonly kind: "nodes-group" }>,
): CanvasTypedIntentUnionV2 {
  if (command.children.length < 2 || command.children.length > 256) {
    throw new RangeError("Canvas group requires between two and 256 children")
  }
  const index = buildCanvasProjectionIndexV2(snapshot)
  const children = uniqueNodeRefs(command.children).map((ref) => {
    const projected = index.nodesByKey.get(canvasEntityKeyV2(ref))
    if (!projected || projected.parent !== null) throw new TypeError("Canvas group children must be live top-level nodes")
    return projected
  })
  if (children.length !== command.children.length) throw new TypeError("Canvas group contains a duplicate child")
  const padding = 40
  const minX = Math.min(...children.map((node) => node.position.x))
  const minY = Math.min(...children.map((node) => node.position.y))
  const maxX = Math.max(...children.map((node) => node.position.x + node.size.width))
  const maxY = Math.max(...children.map((node) => node.position.y + node.size.height))
  const groupPosition = Object.freeze({ x: minX - padding, y: minY - padding })
  const groupSize = Object.freeze({ width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 })
  const ordinal = parseUint32("0")
  const group = derivedNodeRefV2(context, ordinal)
  const childRefs = children.map((node) => Object.freeze({ ...node.ref }))
  const sortedGeometry = children
    .map((node) => ({ node: node.ref, position: node.position, size: node.size }))
    .sort((left, right) => canvasEntityKeyV2(left.node).localeCompare(canvasEntityKeyV2(right.node)))
  return Object.freeze({
    format: "convax.typed-intent/2",
    kind: "canvas.nodes.group/2",
    guard: Object.freeze({
      group: Object.freeze({ ordinal, node: group, expectedAbsent: true }),
      children: Object.freeze(childRefs.map((ref) => containmentGuard(snapshot, context, ref))),
      expectedGeometryPlanDigest: canvasDigestV2("convax.canvas-group-geometry-plan/2", {
        format: "convax.canvas-group-geometry-plan/2",
        children: sortedGeometry,
        groupPosition,
        groupSize,
      }),
    }),
    body: Object.freeze({
      group: Object.freeze({
        ordinal,
        nodeId: group.id,
        incarnation: group.incarnation,
        role: "file" as const,
        position: groupPosition,
        size: groupSize,
        data: Object.freeze({ format: "convax.canvas-node-data/2" as const, kind: "group" as const, title: command.title }),
        plugin: null,
      }),
      children: Object.freeze(childRefs),
      relationIds: Object.freeze(childRefs.map((_, index) => derivedRelationId(context, index + 1))),
    }),
  })
}

function ungroupNodesIntent(
  snapshot: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  groupRef: CanvasEntityRefV2 & { readonly kind: "node" },
): CanvasTypedIntentUnionV2 {
  const index = buildCanvasProjectionIndexV2(snapshot)
  const group = requireLiveNode(snapshot, groupRef)
  if (index.nodesByKey.get(canvasEntityKeyV2(groupRef))?.data.kind !== "group") {
    throw new TypeError("Canvas ungroup target is not a structural group")
  }
  const children = [...index.selectedContainments.entries()]
    .filter(([, choice]) => choice?.parent !== null && choice !== null && canvasEntityKeyV2(choice.parent) === canvasEntityKeyV2(groupRef))
    .map(([key]) => snapshot.nodes.get(key)!.identity.ref)
    .sort((left, right) => canvasEntityKeyV2(left).localeCompare(canvasEntityKeyV2(right)))
  if (children.length < 1 || children.length > 256) throw new RangeError("Canvas group has no bounded child set")
  return Object.freeze({
    format: "convax.typed-intent/2",
    kind: "canvas.nodes.ungroup/2",
    guard: Object.freeze({
      group: nodeLiveGuard(snapshot, group.identity.ref),
      children: Object.freeze(children.map((ref) => containmentGuard(snapshot, context, ref))),
      expectedEffectiveChildSetDigest: canvasDigestV2("convax.canvas-effective-child-set/2", {
        format: "convax.canvas-effective-child-set/2",
        group: group.identity.ref,
        children,
      }),
    }),
    body: Object.freeze({
      group: Object.freeze({ ...group.identity.ref }),
      children: Object.freeze(children.map((ref) => Object.freeze({ ...ref }))),
      nullRelationIds: Object.freeze(children.map((_, index) => derivedRelationId(context, index))),
    }),
  })
}

function rendererIntent(snapshot: CanvasSnapshotV2, command: CanvasRendererCommandV2): CanvasTypedIntentUnionV2 {
  if (command.format !== "convax.canvas-renderer-command/2" || command.kind !== "canvas.nodes.set-geometry/2") {
    throw new TypeError("Unsupported Canvas renderer command")
  }
  const seen = new Set<string>()
  const guards = command.body.updates.map((update) => {
    const key = canvasEntityKeyV2(update.node)
    if (seen.has(key)) throw new TypeError("Duplicate Canvas geometry entity")
    seen.add(key)
    const node = requireLiveNode(snapshot, update.node)
    return Object.freeze({
      node: Object.freeze({ ...update.node }),
      expectedLive: true as const,
      expectedIdentityDigest: nodeIdentityDigestV2(node),
      expectedGeometryDigest: geometryDigestV2(node),
    })
  })
  return Object.freeze({
    format: "convax.typed-intent/2",
    kind: "canvas.nodes.set-geometry/2",
    guard: Object.freeze({ nodes: Object.freeze(guards) }),
    body: Object.freeze({
      updates: Object.freeze(
        command.body.updates.map((update) =>
          Object.freeze({
            node: Object.freeze({ ...update.node }),
            position: Object.freeze({ ...update.position }),
            size: update.size === undefined || update.size === null ? null : Object.freeze({ ...update.size }),
          }),
        ),
      ),
    }),
  })
}

function pluginCreationGroupIntent(
  snapshot: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  command: CanvasPluginCreationGroupCommandV2,
): CanvasTypedIntentUnionV2 {
  if (command.nodes.length < 1 || command.nodes.length > 85 || command.edges.length > 168) {
    throw new RangeError("Plugin creation group exceeds Canvas bounds")
  }
  const groupOrdinal = parseUint32("0")
  const nodes = command.nodes.map((node, index): NodeCreateTemplateV2 => {
    if (!samePluginRequirement(node.plugin, command.plugin)) throw new TypeError("Plugin node requirement mismatch")
    const ordinal = parseUint32(String(index + 1))
    const ref = derivedNodeRefV2(context, ordinal)
    return Object.freeze({
      ordinal,
      nodeId: ref.id,
      incarnation: ref.incarnation,
      role: node.role,
      position: Object.freeze({ ...node.position }),
      size: Object.freeze({ ...node.size }),
      data: structuredClone(node.data),
      plugin: structuredClone(node.plugin),
    })
  })
  const edges = command.edges.map((edge, index): EdgeCreateTemplateV2 => {
    const ordinal = parseUint32(String(command.nodes.length + index + 1))
    const ref = derivedEdgeRefV2(context, ordinal)
    return Object.freeze({
      ordinal,
      edgeId: ref.id,
      incarnation: ref.incarnation,
      source: creationEndpoint(edge.source, command.nodes.length),
      target: creationEndpoint(edge.target, command.nodes.length),
      data: Object.freeze({ format: "convax.canvas-edge-data/2", kind: "business", label: edge.label }),
    })
  })
  const source = requireLiveNode(snapshot, command.source)
  return Object.freeze({
    format: "convax.typed-intent/2",
    kind: "canvas.plugin.creation-group.create/2",
    guard: Object.freeze({
      source: nodeDataGuard(snapshot, source),
      pluginRequirement: structuredClone(command.plugin),
      derivedNodes: Object.freeze(
        nodes.map((node) => {
          const ref = derivedNodeRefV2(context, node.ordinal)
          return Object.freeze({ ordinal: node.ordinal, node: ref, expectedAbsent: true as const })
        }),
      ),
      derivedEdges: Object.freeze(
        edges.map((edge) => {
          const ref = derivedEdgeRefV2(context, edge.ordinal)
          return Object.freeze({ ordinal: edge.ordinal, edge: ref, expectedAbsent: true as const })
        }),
      ),
      resourceProofs: Object.freeze(
        command.nodes.flatMap((node, index) => {
          if (node.data.kind === "resource") {
            if (!node.resourceProof || !sameCanonicalValueV2(node.resourceProof.resource, node.data.resource)) {
              throw new TypeError("Plugin resource node requires its exact current proof")
            }
            return [
              Object.freeze({ createdNodeOrdinal: parseUint32(String(index + 1)), proof: structuredClone(node.resourceProof) }),
            ]
          }
          if (node.resourceProof !== undefined) throw new TypeError("Non-resource Plugin node cannot carry a resource proof")
          return []
        }),
      ),
    }),
    body: Object.freeze({
      groupOrdinal,
      source: Object.freeze({ ...command.source }),
      nodes: Object.freeze(nodes),
      edges: Object.freeze(edges),
    }),
  })
}

function creationEndpoint(
  endpoint: CanvasPluginCreationGroupCommandV2["edges"][number]["source"],
  nodeCount: number,
): CanvasEntityRefV2 | { readonly createdNodeOrdinal: import("./types").Uint32 } {
  if (endpoint.mode === "existing") return Object.freeze({ ...endpoint.ref })
  if (!Number.isSafeInteger(endpoint.nodeIndex) || endpoint.nodeIndex < 0 || endpoint.nodeIndex >= nodeCount) {
    throw new RangeError("Plugin creation edge references an unknown created node")
  }
  return Object.freeze({ createdNodeOrdinal: parseUint32(String(endpoint.nodeIndex + 1)) })
}

function connectableGuard(snapshot: CanvasSnapshotV2, ref: CanvasEntityRefV2 & { readonly kind: "node" }) {
  const node = requireLiveNode(snapshot, ref)
  if (buildCanvasProjectionIndexV2(snapshot).projection.nodes.find((candidate) =>
    sameCanonicalValueV2(candidate.ref, ref),
  )?.data.kind === "group") {
    throw new TypeError("Structural group is not connectable")
  }
  return Object.freeze({
    node: Object.freeze({ ...ref }),
    expectedLive: true as const,
    expectedIdentityDigest: nodeIdentityDigestV2(node),
    expectedConnectable: true as const,
  })
}

function nodeDataGuard(snapshot: CanvasSnapshotV2, node: CanvasSnapshotV2["nodes"] extends ReadonlyMap<string, infer N> ? N : never) {
  return Object.freeze({
    node: Object.freeze({ ...node.identity.ref }),
    expectedLive: true as const,
    expectedIdentityDigest: nodeIdentityDigestV2(node),
    expectedEffectiveDataDigest: effectiveDataDigestV2(snapshot, node),
    expectedDataRegisterDigest: dataRegisterDigestV2(node),
  })
}

function nodeLiveGuard(snapshot: CanvasSnapshotV2, ref: CanvasEntityRefV2 & { readonly kind: "node" }) {
  const node = requireLiveNode(snapshot, ref)
  return Object.freeze({
    node: Object.freeze({ ...node.identity.ref }),
    expectedLive: true as const,
    expectedIdentityDigest: nodeIdentityDigestV2(node),
  })
}

function edgeLiveGuard(snapshot: CanvasSnapshotV2, ref: CanvasEntityRefV2 & { readonly kind: "edge" }) {
  const index = buildCanvasProjectionIndexV2(snapshot)
  const edge = snapshot.edges.get(canvasEntityKeyV2(ref))
  if (!edge || !index.isEdgeLive(ref)) throw new TypeError("Canvas edge guard is stale")
  return Object.freeze({
    edge: Object.freeze({ ...edge.identity.ref }),
    expectedLive: true as const,
    expectedIdentityDigest: edgeIdentityDigestV2(edge),
  })
}

function containmentGuard(
  snapshot: CanvasSnapshotV2,
  context: OwnerIntentConstructionContext,
  ref: CanvasEntityRefV2 & { readonly kind: "node" },
) {
  const live = nodeLiveGuard(snapshot, ref)
  const choice = snapshot.containments.get(`${canvasEntityKeyV2(ref)}/actor/${context.actorId}`)
  return Object.freeze({
    ...live,
    expectedOwnSlotDigest: choice === undefined
      ? null
      : canvasDigestV2("convax.canvas-containment-slot/2", {
          format: "convax.canvas-containment-slot/2",
          choice,
        }),
  })
}

function derivedRelationId(context: OwnerIntentConstructionContext, ordinal: number): string {
  return deriveCanvasIdV2("relation", context, parseUint32(String(ordinal)))
}

function uniqueNodeRefs(
  refs: readonly (CanvasEntityRefV2 & { readonly kind: "node" })[],
): readonly (CanvasEntityRefV2 & { readonly kind: "node" })[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = canvasEntityKeyV2(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function requireLiveNode(snapshot: CanvasSnapshotV2, ref: CanvasEntityRefV2 & { readonly kind: "node" }) {
  const node = snapshot.nodes.get(canvasEntityKeyV2(ref))
  if (!node || !buildCanvasProjectionIndexV2(snapshot).isNodeLive(ref)) throw new TypeError("Canvas node guard is stale")
  return node
}

function samePluginRequirement(plugin: PluginStateEnvelopeV2, requirement: PluginRequirementV2): boolean {
  return (
    plugin.pluginId === requirement.pluginId &&
    plugin.snapshotDigest === requirement.snapshotDigest &&
    plugin.pluginStateSchemaDigest === requirement.pluginStateSchemaDigest &&
    sameCanonicalValueV2(plugin.validationArtifact, requirement.validationArtifact)
  )
}
