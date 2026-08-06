import type {
  OwnerExternalFactPort,
  OwnerIntentConstructionContext,
  OwnerIntentDependencies,
} from "@convax/collaboration"
import { parseUint32 } from "@convax/collaboration"
import type { CanvasRendererCommand } from "./session"
import {
  dataRegisterDigest,
  effectiveDataDigest,
  geometryDigest,
  effectivePlugin,
  effectivePluginDigest,
  edgeIdentityDigest,
  nodeIdentityDigest,
  obstacleProjectionDigest,
} from "./projection"
import { materializeCanvasSemanticHistoryIntent } from "./reducer"
import { createCanvasExternalFactContext, discoverCanvasValueDependencies } from "./external-facts"
import type {
  CanvasEntityRef,
  CanvasResourceProofRef,
  CanvasSnapshot,
  CanvasTypedIntentUnion,
  EdgeCreateTemplate,
  NodeCreateTemplate,
  PluginRequirement,
  PluginStateEnvelope,
} from "./types"
import { assertCanvasTypedIntent } from "./intent-validation"
import {
  canvasDigest,
  canvasEntityKey,
  deriveCanvasId,
  derivedEdgeRef,
  derivedNodeRef,
  sameCanonicalValue,
} from "./validation"
import { buildCanvasProjectionIndex } from "./projection"

export type CanvasAuthoritativeCommand =
  | Readonly<{ readonly kind: "renderer"; readonly command: CanvasRendererCommand }>
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
        readonly proof: Extract<CanvasResourceProofRef, { readonly mode: "current-owner-state" }>
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
      readonly source: CanvasEntityRef & { readonly kind: "node" }
      readonly target: CanvasEntityRef & { readonly kind: "node" }
      readonly label: string | null
    }>
  | Readonly<{
      /** Canvas-owned exact removal set, including the observed incident-edge closure. */
      readonly kind: "elements-remove"
      readonly nodes: readonly (CanvasEntityRef & { readonly kind: "node" })[]
      readonly edges: readonly (CanvasEntityRef & { readonly kind: "edge" })[]
    }>
  | Readonly<{
      readonly kind: "geometry-set"
      readonly updates: readonly Readonly<{
        readonly node: CanvasEntityRef & { readonly kind: "node" }
        readonly position: Readonly<{ x: number; y: number }>
        readonly size: Readonly<{ width: number; height: number }> | null
      }>[]
    }>
  | Readonly<{
      readonly kind: "nodes-group"
      readonly children: readonly (CanvasEntityRef & { readonly kind: "node" })[]
      readonly title: string
    }>
  | Readonly<{
      readonly kind: "nodes-ungroup"
      readonly group: CanvasEntityRef & { readonly kind: "node" }
    }>
  | Readonly<{
      readonly kind: "structural-parent-set"
      readonly child: CanvasEntityRef & { readonly kind: "node" }
      readonly parent: (CanvasEntityRef & { readonly kind: "node" }) | null
    }>
  | Readonly<{
      readonly kind: "resource-relink"
      readonly node: CanvasEntityRef & { readonly kind: "node" }
      readonly title: string
      readonly proof: Extract<CanvasResourceProofRef, { readonly mode: "current-owner-state" }>
    }>
  | Readonly<{
      /** Host-owned validated envelope; never accepted from a Plugin renderer. */
      readonly kind: "plugin-state-set"
      readonly node: CanvasEntityRef & { readonly kind: "node" }
      /** Exact leased Plugin owner. Install/upgrade/removal require a different command. */
      readonly owner: PluginRequirement
      readonly plugin: PluginStateEnvelope
    }>
  | Readonly<{
      /**
       * One independent top-level Plugin surface. The Host supplies only the
       * leased envelope, the derived title, and the manifest size; Canvas owns
       * the node identity and the deterministic placement.
       */
      readonly kind: "plugin-surface-create"
      readonly title: string
      readonly size: Readonly<{ width: number; height: number }>
      readonly plugin: PluginStateEnvelope
    }>
  | CanvasPluginCreationGroupCommand

export interface CanvasPluginCreationGroupCommand {
  readonly kind: "plugin-creation-group"
  readonly source: CanvasEntityRef & { readonly kind: "node" }
  readonly plugin: PluginRequirement
  readonly nodes: readonly Readonly<{
    readonly role: "file" | "agent"
    readonly position: Readonly<{ x: number; y: number }>
    readonly size: Readonly<{ width: number; height: number }>
    readonly data: NodeCreateTemplate["data"]
    readonly plugin: PluginStateEnvelope
    readonly resourceProof?: Extract<CanvasResourceProofRef, { readonly mode: "current-owner-state" }>
  }>[]
  readonly edges: readonly Readonly<{
    readonly source:
      | { readonly mode: "existing"; readonly ref: CanvasEntityRef & { readonly kind: "node" } }
      | { readonly mode: "created"; readonly nodeIndex: number }
    readonly target:
      | { readonly mode: "existing"; readonly ref: CanvasEntityRef & { readonly kind: "node" } }
      | { readonly mode: "created"; readonly nodeIndex: number }
    readonly label: string | null
  }>[]
}

/**
 * A root Plugin surface has no source node to anchor against, so Canvas uses
 * the document origin and lets causal placement slide past live obstacles.
 */
const CANVAS_PLUGIN_SURFACE_ANCHOR = Object.freeze({ x: 0, y: 0 })

export interface CanvasClosedIntentConstruction {
  readonly intent: CanvasTypedIntentUnion
  readonly dependencies: OwnerIntentDependencies<"canvas">
}

/**
 * Canvas-owned guard construction against the latest validated replica state.
 * Desktop supplies caller intent and identity context, never digests or raw
 * typed-intent guards.
 */
export function constructCanvasAuthoritativeIntent(input: {
  readonly snapshot: CanvasSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly command: CanvasAuthoritativeCommand
}): CanvasClosedIntentConstruction | "rejected" {
  try {
    const intent = constructIntent(input.snapshot, input.context, input.command)
    assertCanvasTypedIntent(intent)
    const dependencies = discoverCanvasValueDependencies(input.context, intent)
    return dependencies === "rejected" ? "rejected" : Object.freeze({ intent, dependencies })
  } catch {
    return "rejected"
  }
}

export function discoverCanvasHistoryIntentDependencies(input: {
  readonly snapshot: CanvasSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly direction: "undo" | "redo"
  readonly rootOperationId: import("./types").Id128
}): OwnerIntentDependencies<"canvas"> | "rejected" {
  const intent = materializeCanvasSemanticHistoryIntent(
    input.snapshot,
    input.context,
    input.direction,
    input.rootOperationId,
  )
  if (intent === "rejected") return "rejected"
  return discoverCanvasValueDependencies(input.context, intent)
}

/**
 * Materializes history only after the collaboration kernel has resolved the
 * exact dependency set discovered above. Desktop never constructs semantic
 * inverse/forward guards.
 */
export function constructCanvasHistoryIntent(input: {
  readonly snapshot: CanvasSnapshot
  readonly context: OwnerIntentConstructionContext
  readonly direction: "undo" | "redo"
  readonly rootOperationId: import("./types").Id128
  readonly externalFacts: OwnerExternalFactPort<"canvas">
}): CanvasClosedIntentConstruction | "pending" | "rejected" {
  const intent = materializeCanvasSemanticHistoryIntent(
    input.snapshot,
    input.context,
    input.direction,
    input.rootOperationId,
  )
  if (intent === "rejected") return "rejected"
  const dependencies = discoverCanvasValueDependencies(input.context, intent)
  if (dependencies === "rejected") return "rejected"
  const facts = createCanvasExternalFactContext(input.context, intent, input.externalFacts)
  if (facts === "pending" || facts === "rejected") return facts
  // Requiring the exact consumed ledger prevents a caller from supplying a
  // broader or stale fact port to the history commit.
  if (!sameCanonicalValue(input.externalFacts.consumedDependencies(), dependencies)) return "rejected"
  return Object.freeze({ intent, dependencies })
}

function constructIntent(
  snapshot: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  command: CanvasAuthoritativeCommand,
): CanvasTypedIntentUnion {
  if (command.kind === "renderer") return rendererIntent(snapshot, command.command)
  if (command.kind === "agent-node-create") {
    const ordinal = parseUint32("0")
    const node = derivedNodeRef(context, ordinal)
    return Object.freeze({
      format: "convax.typed-intent",
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
            format: "convax.canvas-node-data",
            kind: "agent",
            title: command.title,
            instructions: command.instructions,
          }),
          plugin: null,
        }),
      }),
    })
  }
  if (command.kind === "plugin-surface-create") {
    const ordinal = parseUint32("0")
    const node = derivedNodeRef(context, ordinal)
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "canvas.plugin.surface.create",
      guard: Object.freeze({ derivedNode: Object.freeze({ ordinal, node, expectedAbsent: true }) }),
      body: Object.freeze({
        placement: Object.freeze({
          anchor: Object.freeze({ ...CANVAS_PLUGIN_SURFACE_ANCHOR }),
          gap: 24 as const,
          obstacleProjectionDigest: obstacleProjectionDigest(snapshot),
        }),
        node: Object.freeze({
          ordinal,
          nodeId: node.id,
          incarnation: node.incarnation,
          size: Object.freeze({ ...command.size }),
          title: command.title,
          plugin: command.plugin,
        }),
      }),
    })
  }
  if (command.kind === "resources-create") {
    if (command.items.length < 1 || command.items.length > 85) throw new RangeError("Manual resource count is invalid")
    const nodes = command.items.map((item, index) => {
      const ordinal = parseUint32(String(index))
      const node = derivedNodeRef(context, ordinal)
      return Object.freeze({ ordinal, node, item })
    })
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "canvas.resources.add",
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
          obstacleProjectionDigest: obstacleProjectionDigest(snapshot),
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
      const node = derivedNodeRef(context, ordinal)
      return Object.freeze({ ordinal, node, item })
    })
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "canvas.resources.pending.create",
      guard: Object.freeze({
        existingEndpoints: Object.freeze([]),
        derivedNodes: Object.freeze(nodes.map(({ ordinal, node }) => Object.freeze({ ordinal, node, expectedAbsent: true }))),
        derivedEdges: Object.freeze([]),
      }),
      body: Object.freeze({
        placement: Object.freeze({
          anchor: Object.freeze({ ...command.anchor }),
          gap: 24 as const,
          obstacleProjectionDigest: obstacleProjectionDigest(snapshot),
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
    const edge = derivedEdgeRef(context, ordinal)
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "canvas.edges.connect",
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
          data: Object.freeze({ format: "convax.canvas-edge-data", kind: "business", label: command.label }),
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
      if (buildCanvasProjectionIndex(snapshot).nodesByKey.get(canvasEntityKey(parent.identity.ref))?.data.kind !== "group") {
        throw new TypeError("Canvas structural parent is not a group")
      }
    }
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "canvas.nodes.set-structural-parent",
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
      format: "convax.typed-intent",
      kind: "canvas.nodes.update-data",
      guard: Object.freeze({
        node: nodeDataGuard(snapshot, node),
        resourceProof: structuredClone(command.proof),
      }),
      body: Object.freeze({
        node: Object.freeze({ ...command.node }),
        data: Object.freeze({
          format: "convax.canvas-node-data",
          kind: "resource",
          title: command.title,
          resource: structuredClone(command.proof.resource),
        }),
      }),
    })
  }
  if (command.kind === "plugin-state-set") {
    const node = requireLiveNode(snapshot, command.node)
    const current = effectivePlugin(node)
    if (
      current === null ||
      !samePluginRequirement(current, command.owner) ||
      !samePluginRequirement(command.plugin, command.owner)
    ) {
      throw new TypeError("Plugin state update does not match the canonical node owner")
    }
    const requirement = structuredClone(command.owner)
    return Object.freeze({
      format: "convax.typed-intent",
      kind: "canvas.nodes.set-plugin-state",
      guard: Object.freeze({
        node: Object.freeze({
          node: Object.freeze({ ...command.node }),
          expectedLive: true,
          expectedIdentityDigest: nodeIdentityDigest(node),
          expectedPluginDigest: effectivePluginDigest(node),
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
  snapshot: CanvasSnapshot,
  command: Extract<CanvasAuthoritativeCommand, { readonly kind: "elements-remove" }>,
): CanvasTypedIntentUnion {
  if (command.nodes.length + command.edges.length < 1 || command.nodes.length + command.edges.length > 510) {
    throw new RangeError("Canvas removal set is empty or exceeds its bound")
  }
  const nodeKeys = new Set<string>()
  const nodes = command.nodes.map((ref) => {
    const key = canvasEntityKey(ref)
    if (nodeKeys.has(key)) throw new TypeError("Canvas removal contains a duplicate node")
    nodeKeys.add(key)
    const node = requireLiveNode(snapshot, ref)
    return Object.freeze({ ...node.identity.ref })
  })
  const index = buildCanvasProjectionIndex(snapshot)
  const edgeKeys = new Set<string>()
  const edges = command.edges.map((ref) => {
    const key = canvasEntityKey(ref)
    if (edgeKeys.has(key)) throw new TypeError("Canvas removal contains a duplicate edge")
    edgeKeys.add(key)
    const edge = snapshot.edges.get(key)
    if (!edge || !index.isEdgeLive(ref)) throw new TypeError("Canvas edge guard is stale")
    return Object.freeze({ ...edge.identity.ref })
  })
  for (const edge of index.projection.edges) {
    const incident = nodeKeys.has(canvasEntityKey(edge.source)) || nodeKeys.has(canvasEntityKey(edge.target))
    if (incident && !edgeKeys.has(canvasEntityKey(edge.ref))) {
      throw new TypeError("Canvas removal is missing its observed incident-edge closure")
    }
  }
  return Object.freeze({
    format: "convax.typed-intent",
    kind: "canvas.elements.remove",
    guard: Object.freeze({
      nodes: Object.freeze(nodes.map((ref) => nodeLiveGuard(snapshot, ref))),
      edges: Object.freeze(edges.map((ref) => edgeLiveGuard(snapshot, ref))),
      requireObservedIncidentEdgeClosure: true,
    }),
    body: Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) }),
  })
}

function geometryIntent(
  snapshot: CanvasSnapshot,
  updates: Extract<CanvasAuthoritativeCommand, { readonly kind: "geometry-set" }>["updates"],
): CanvasTypedIntentUnion {
  if (updates.length < 1 || updates.length > 256) throw new RangeError("Canvas geometry update count is invalid")
  const seen = new Set<string>()
  const guards = updates.map((update) => {
    const key = canvasEntityKey(update.node)
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
      expectedGeometryDigest: geometryDigest(node),
    })
  })
  return Object.freeze({
    format: "convax.typed-intent",
    kind: "canvas.nodes.set-geometry",
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
  snapshot: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  command: Extract<CanvasAuthoritativeCommand, { readonly kind: "nodes-group" }>,
): CanvasTypedIntentUnion {
  if (command.children.length < 2 || command.children.length > 256) {
    throw new RangeError("Canvas group requires between two and 256 children")
  }
  const index = buildCanvasProjectionIndex(snapshot)
  const children = uniqueNodeRefs(command.children).map((ref) => {
    const projected = index.nodesByKey.get(canvasEntityKey(ref))
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
  const group = derivedNodeRef(context, ordinal)
  const childRefs = children.map((node) => Object.freeze({ ...node.ref }))
  const sortedGeometry = children
    .map((node) => ({ node: node.ref, position: node.position, size: node.size }))
    .sort((left, right) => canvasEntityKey(left.node).localeCompare(canvasEntityKey(right.node)))
  return Object.freeze({
    format: "convax.typed-intent",
    kind: "canvas.nodes.group",
    guard: Object.freeze({
      group: Object.freeze({ ordinal, node: group, expectedAbsent: true }),
      children: Object.freeze(childRefs.map((ref) => containmentGuard(snapshot, context, ref))),
      expectedGeometryPlanDigest: canvasDigest("convax.canvas-group-geometry-plan", {
        format: "convax.canvas-group-geometry-plan",
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
        data: Object.freeze({ format: "convax.canvas-node-data" as const, kind: "group" as const, title: command.title }),
        plugin: null,
      }),
      children: Object.freeze(childRefs),
      relationIds: Object.freeze(childRefs.map((_, index) => derivedRelationId(context, index + 1))),
    }),
  })
}

function ungroupNodesIntent(
  snapshot: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  groupRef: CanvasEntityRef & { readonly kind: "node" },
): CanvasTypedIntentUnion {
  const index = buildCanvasProjectionIndex(snapshot)
  const group = requireLiveNode(snapshot, groupRef)
  if (index.nodesByKey.get(canvasEntityKey(groupRef))?.data.kind !== "group") {
    throw new TypeError("Canvas ungroup target is not a structural group")
  }
  const children = [...index.selectedContainments.entries()]
    .filter(([, choice]) => choice?.parent !== null && choice !== null && canvasEntityKey(choice.parent) === canvasEntityKey(groupRef))
    .map(([key]) => snapshot.nodes.get(key)!.identity.ref)
    .sort((left, right) => canvasEntityKey(left).localeCompare(canvasEntityKey(right)))
  if (children.length < 1 || children.length > 256) throw new RangeError("Canvas group has no bounded child set")
  return Object.freeze({
    format: "convax.typed-intent",
    kind: "canvas.nodes.ungroup",
    guard: Object.freeze({
      group: nodeLiveGuard(snapshot, group.identity.ref),
      children: Object.freeze(children.map((ref) => containmentGuard(snapshot, context, ref))),
      expectedEffectiveChildSetDigest: canvasDigest("convax.canvas-effective-child-set", {
        format: "convax.canvas-effective-child-set",
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

function rendererIntent(snapshot: CanvasSnapshot, command: CanvasRendererCommand): CanvasTypedIntentUnion {
  if (command.format !== "convax.canvas-renderer-command" || command.kind !== "canvas.nodes.set-geometry") {
    throw new TypeError("Unsupported Canvas renderer command")
  }
  const seen = new Set<string>()
  const guards = command.body.updates.map((update) => {
    const key = canvasEntityKey(update.node)
    if (seen.has(key)) throw new TypeError("Duplicate Canvas geometry entity")
    seen.add(key)
    const node = requireLiveNode(snapshot, update.node)
    return Object.freeze({
      node: Object.freeze({ ...update.node }),
      expectedLive: true as const,
      expectedIdentityDigest: nodeIdentityDigest(node),
      expectedGeometryDigest: geometryDigest(node),
    })
  })
  return Object.freeze({
    format: "convax.typed-intent",
    kind: "canvas.nodes.set-geometry",
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
  snapshot: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  command: CanvasPluginCreationGroupCommand,
): CanvasTypedIntentUnion {
  if (command.nodes.length < 1 || command.nodes.length > 85 || command.edges.length > 168) {
    throw new RangeError("Plugin creation group exceeds Canvas bounds")
  }
  const groupOrdinal = parseUint32("0")
  const nodes = command.nodes.map((node, index): NodeCreateTemplate => {
    if (!samePluginRequirement(node.plugin, command.plugin)) throw new TypeError("Plugin node requirement mismatch")
    const ordinal = parseUint32(String(index + 1))
    const ref = derivedNodeRef(context, ordinal)
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
  const edges = command.edges.map((edge, index): EdgeCreateTemplate => {
    const ordinal = parseUint32(String(command.nodes.length + index + 1))
    const ref = derivedEdgeRef(context, ordinal)
    return Object.freeze({
      ordinal,
      edgeId: ref.id,
      incarnation: ref.incarnation,
      source: creationEndpoint(edge.source, command.nodes.length),
      target: creationEndpoint(edge.target, command.nodes.length),
      data: Object.freeze({ format: "convax.canvas-edge-data", kind: "business", label: edge.label }),
    })
  })
  const source = requireLiveNode(snapshot, command.source)
  return Object.freeze({
    format: "convax.typed-intent",
    kind: "canvas.plugin.creation-group.create",
    guard: Object.freeze({
      source: nodeDataGuard(snapshot, source),
      pluginRequirement: structuredClone(command.plugin),
      derivedNodes: Object.freeze(
        nodes.map((node) => {
          const ref = derivedNodeRef(context, node.ordinal)
          return Object.freeze({ ordinal: node.ordinal, node: ref, expectedAbsent: true as const })
        }),
      ),
      derivedEdges: Object.freeze(
        edges.map((edge) => {
          const ref = derivedEdgeRef(context, edge.ordinal)
          return Object.freeze({ ordinal: edge.ordinal, edge: ref, expectedAbsent: true as const })
        }),
      ),
      resourceProofs: Object.freeze(
        command.nodes.flatMap((node, index) => {
          if (node.data.kind === "resource") {
            if (!node.resourceProof || !sameCanonicalValue(node.resourceProof.resource, node.data.resource)) {
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
  endpoint: CanvasPluginCreationGroupCommand["edges"][number]["source"],
  nodeCount: number,
): CanvasEntityRef | { readonly createdNodeOrdinal: import("./types").Uint32 } {
  if (endpoint.mode === "existing") return Object.freeze({ ...endpoint.ref })
  if (!Number.isSafeInteger(endpoint.nodeIndex) || endpoint.nodeIndex < 0 || endpoint.nodeIndex >= nodeCount) {
    throw new RangeError("Plugin creation edge references an unknown created node")
  }
  return Object.freeze({ createdNodeOrdinal: parseUint32(String(endpoint.nodeIndex + 1)) })
}

function connectableGuard(snapshot: CanvasSnapshot, ref: CanvasEntityRef & { readonly kind: "node" }) {
  const node = requireLiveNode(snapshot, ref)
  if (buildCanvasProjectionIndex(snapshot).projection.nodes.find((candidate) =>
    sameCanonicalValue(candidate.ref, ref),
  )?.data.kind === "group") {
    throw new TypeError("Structural group is not connectable")
  }
  return Object.freeze({
    node: Object.freeze({ ...ref }),
    expectedLive: true as const,
    expectedIdentityDigest: nodeIdentityDigest(node),
    expectedConnectable: true as const,
  })
}

function nodeDataGuard(snapshot: CanvasSnapshot, node: CanvasSnapshot["nodes"] extends ReadonlyMap<string, infer N> ? N : never) {
  return Object.freeze({
    node: Object.freeze({ ...node.identity.ref }),
    expectedLive: true as const,
    expectedIdentityDigest: nodeIdentityDigest(node),
    expectedEffectiveDataDigest: effectiveDataDigest(snapshot, node),
    expectedDataRegisterDigest: dataRegisterDigest(node),
  })
}

function nodeLiveGuard(snapshot: CanvasSnapshot, ref: CanvasEntityRef & { readonly kind: "node" }) {
  const node = requireLiveNode(snapshot, ref)
  return Object.freeze({
    node: Object.freeze({ ...node.identity.ref }),
    expectedLive: true as const,
    expectedIdentityDigest: nodeIdentityDigest(node),
  })
}

function edgeLiveGuard(snapshot: CanvasSnapshot, ref: CanvasEntityRef & { readonly kind: "edge" }) {
  const index = buildCanvasProjectionIndex(snapshot)
  const edge = snapshot.edges.get(canvasEntityKey(ref))
  if (!edge || !index.isEdgeLive(ref)) throw new TypeError("Canvas edge guard is stale")
  return Object.freeze({
    edge: Object.freeze({ ...edge.identity.ref }),
    expectedLive: true as const,
    expectedIdentityDigest: edgeIdentityDigest(edge),
  })
}

function containmentGuard(
  snapshot: CanvasSnapshot,
  context: OwnerIntentConstructionContext,
  ref: CanvasEntityRef & { readonly kind: "node" },
) {
  const live = nodeLiveGuard(snapshot, ref)
  const choice = snapshot.containments.get(`${canvasEntityKey(ref)}/actor/${context.actorId}`)
  return Object.freeze({
    ...live,
    expectedOwnSlotDigest: choice === undefined
      ? null
      : canvasDigest("convax.canvas-containment-slot", {
          format: "convax.canvas-containment-slot",
          choice,
        }),
  })
}

function derivedRelationId(context: OwnerIntentConstructionContext, ordinal: number): string {
  return deriveCanvasId("relation", context, parseUint32(String(ordinal)))
}

function uniqueNodeRefs(
  refs: readonly (CanvasEntityRef & { readonly kind: "node" })[],
): readonly (CanvasEntityRef & { readonly kind: "node" })[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = canvasEntityKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function requireLiveNode(snapshot: CanvasSnapshot, ref: CanvasEntityRef & { readonly kind: "node" }) {
  const node = snapshot.nodes.get(canvasEntityKey(ref))
  if (!node || !buildCanvasProjectionIndex(snapshot).isNodeLive(ref)) throw new TypeError("Canvas node guard is stale")
  return node
}

function samePluginRequirement(plugin: PluginStateEnvelope, requirement: PluginRequirement): boolean {
  return (
    plugin.pluginId === requirement.pluginId &&
    plugin.snapshotDigest === requirement.snapshotDigest &&
    plugin.pluginStateSchemaDigest === requirement.pluginStateSchemaDigest &&
    sameCanonicalValue(plugin.validationArtifact, requirement.validationArtifact)
  )
}
