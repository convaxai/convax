import type { CanvasApplicationCommandRequest } from "../application/service"
import type { CanvasApplicationCommand } from "../application/commands"
import { alignCanvasNodes, distributeCanvasNodes, layoutCanvasNodes } from "../commands"
import { getCanvasNodeSize } from "../document"
import { applyCanvasAutoLayoutPlan, planCanvasLayout } from "../application/layout"
import type { CanvasIntentCallerV2 } from "./session"
import type {
  CanvasEntityRefV2,
  CanvasSnapshotV2,
} from "./types"
import type { OwnerIntentConstructionContext } from "@convax/collaboration"
import { buildCanvasProjectionIndexV2, projectCanvasDocumentV2 } from "./projection"
import type { CanvasAuthoritativeCommandV2 } from "./command-construction"
import { assertResourceProofV2, canvasEntityKeyV2, sameCanonicalValueV2 } from "./validation"

export const canvasResourceProofMetadataKeyV2 = "convaxCanvasResourceProofV2"

export interface CanvasApplicationCommandAdaptationV2 {
  readonly caller: CanvasIntentCallerV2
  readonly command: CanvasAuthoritativeCommandV2
}

/**
 * Closed owner mapping for the application commands admitted by collaboration v2.
 * Every legacy command discriminator is handled explicitly. Commands whose old
 * payload cannot carry the required v2 proof/authorization material reject; they
 * never fall through to the JSON reducer or become a no-op frame.
 */
export function adaptCanvasApplicationCommandV2(input: {
  readonly request: CanvasApplicationCommandRequest
  readonly snapshot: CanvasSnapshotV2
  readonly context: OwnerIntentConstructionContext
}): CanvasApplicationCommandAdaptationV2 | "rejected" {
  try {
    const caller = callerFromActorKind(input.request.envelope.actor.kind)
    if (caller === "rejected") return "rejected"
    const command = input.request.envelope.command
    const index = buildCanvasProjectionIndexV2(input.snapshot)
    const nodeById = new Map(index.projection.nodes.map((node) => [node.ref.id, node] as const))
    const edgeById = new Map(index.projection.edges.map((edge) => [edge.ref.id, edge] as const))

    switch (command.type) {
      case "elements.remove": {
        const requestedNodes = new Set(command.nodeIds ?? [])
        const selectedNodes = new Map<string, CanvasEntityRefV2 & { readonly kind: "node" }>()
        let changed = true
        while (changed) {
          changed = false
          for (const node of index.projection.nodes) {
            const selected = requestedNodes.has(node.ref.id) ||
              (node.parent !== null && selectedNodes.has(canvasEntityKeyV2(node.parent)))
            if (!selected || selectedNodes.has(canvasEntityKeyV2(node.ref))) continue
            selectedNodes.set(canvasEntityKeyV2(node.ref), node.ref)
            changed = true
          }
        }
        const selectedEdges = new Map<string, CanvasEntityRefV2 & { readonly kind: "edge" }>()
        for (const edgeId of command.edgeIds ?? []) {
          const edge = edgeById.get(edgeId)
          if (edge) selectedEdges.set(canvasEntityKeyV2(edge.ref), edge.ref)
        }
        for (const edge of index.projection.edges) {
          if (
            selectedNodes.has(canvasEntityKeyV2(edge.source)) ||
            selectedNodes.has(canvasEntityKeyV2(edge.target))
          ) {
            selectedEdges.set(canvasEntityKeyV2(edge.ref), edge.ref)
          }
        }
        if (selectedNodes.size + selectedEdges.size === 0) return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "elements-remove",
            nodes: sortedRefs(selectedNodes.values()),
            edges: sortedRefs(selectedEdges.values()),
          }),
        })
      }
      case "nodes.connect": {
        if (!hasOnlyKeys(command.connection, ["source", "target", "data"]) ||
          (command.connection.data !== undefined && !hasOnlyKeys(command.connection.data, ["label"]))) return "rejected"
        const source = nodeById.get(command.connection.source)
        const target = nodeById.get(command.connection.target)
        if (!source || !target || sameCanonicalValueV2(source.ref, target.ref)) return "rejected"
        if (index.projection.edges.some((edge) =>
          sameCanonicalValueV2(edge.source, source.ref) && sameCanonicalValueV2(edge.target, target.ref)
        )) return "rejected"
        const label = command.connection.data?.label
        if (label !== undefined && typeof label !== "string") return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "edge-connect",
            source: source.ref,
            target: target.ref,
            label: label ?? null,
          }),
        })
      }
      case "nodes.move": {
        if (!finitePoint(command.delta) || (command.delta.x === 0 && command.delta.y === 0) || command.nodeIds.length === 0) {
          return "rejected"
        }
        const requested = new Set(command.nodeIds)
        if ([...requested].some((id) => !nodeById.has(id))) return "rejected"
        const selected = index.projection.nodes.filter((node) => {
          if (!requested.has(node.ref.id)) return false
          let parent = node.parent
          const visited = new Set<string>()
          while (parent !== null) {
            const key = canvasEntityKeyV2(parent)
            if (visited.has(key)) return false
            visited.add(key)
            if (requested.has(parent.id)) return false
            parent = index.nodesByKey.get(key)?.parent ?? null
          }
          return true
        })
        if (selected.length === 0) return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "geometry-set",
            updates: Object.freeze(selected.map((node) => Object.freeze({
              node: node.ref,
              position: Object.freeze({ x: node.position.x + command.delta.x, y: node.position.y + command.delta.y }),
              size: null,
            }))),
          }),
        })
      }
      case "nodes.reparent": {
        if (command.nodeIds.length !== 1) return "rejected"
        const child = nodeById.get(command.nodeIds[0]!)
        if (!child) return "rejected"
        const parent = command.parentId === undefined ? null : nodeById.get(command.parentId)
        if (command.parentId !== undefined && (!parent || parent.data.kind !== "group")) return "rejected"
        if (parent && sameCanonicalValueV2(child.ref, parent.ref)) return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "structural-parent-set",
            child: child.ref,
            parent: parent?.ref ?? null,
          }),
        })
      }
      case "nodes.setGeometry": {
        if (command.updates.length === 0 || command.updates.length > 256) return "rejected"
        const seen = new Set<string>()
        const updates = command.updates.flatMap((update) => {
          const node = nodeById.get(update.nodeId)
          if (!node || seen.has(node.ref.id) || !finitePoint(update.position) ||
            (update.size !== undefined && !finiteSize(update.size))) throw new TypeError("Invalid Canvas geometry update")
          seen.add(node.ref.id)
          const samePosition = node.position.x === update.position.x && node.position.y === update.position.y
          const sameSize = update.size === undefined ||
            (node.size.width === update.size.width && node.size.height === update.size.height)
          if (samePosition && sameSize) return []
          return [Object.freeze({
            node: node.ref,
            position: Object.freeze({ ...update.position }),
            size: update.size === undefined ? null : Object.freeze({ ...update.size }),
          })]
        })
        if (updates.length === 0) return "rejected"
        return Object.freeze({ caller, command: Object.freeze({ kind: "geometry-set", updates: Object.freeze(updates) }) })
      }
      case "nodes.group": {
        if (command.nodeIds.length < 2 || command.nodeIds.length > 256) return "rejected"
        const seen = new Set<string>()
        const children = command.nodeIds.map((id) => {
          const node = nodeById.get(id)
          if (!node || seen.has(id)) throw new TypeError("Invalid Canvas group child")
          seen.add(id)
          return node.ref
        })
        return Object.freeze({
          caller,
          command: Object.freeze({ kind: "nodes-group", children: Object.freeze(children), title: command.label ?? "Group" }),
        })
      }
      case "nodes.ungroup": {
        const group = nodeById.get(command.nodeId)
        if (!group || group.data.kind !== "group") return "rejected"
        return Object.freeze({ caller, command: Object.freeze({ kind: "nodes-ungroup", group: group.ref }) })
      }
      case "canvas.auto-layout": {
        const document = projectCanvasDocumentV2(index.projection).document
        const next = applyCanvasAutoLayoutPlan(document, planCanvasLayout(document, {
          ...(command.nodeIds === undefined ? {} : { nodeIds: command.nodeIds }),
          ...(command.options === undefined ? {} : { options: command.options }),
        }))
        return geometryAdaptation(caller, index, document, next)
      }
      case "nodes.align": {
        const document = projectCanvasDocumentV2(index.projection).document
        return geometryAdaptation(caller, index, document, alignCanvasNodes(document, command.nodeIds, command.direction))
      }
      case "nodes.distribute": {
        const document = projectCanvasDocumentV2(index.projection).document
        return geometryAdaptation(caller, index, document, distributeCanvasNodes(document, command.nodeIds, command.axis))
      }
      case "nodes.layout": {
        const document = projectCanvasDocumentV2(index.projection).document
        return geometryAdaptation(caller, index, document, layoutCanvasNodes(document, {
          nodeIds: command.nodeIds,
          ...(command.layout === undefined ? {} : { layout: command.layout }),
          ...(command.gap === undefined ? {} : { gap: command.gap }),
        }))
      }
      case "resources.add": {
        if (command.items.length < 1 || command.items.length > 85 || command.placement.parentId !== undefined || command.relation?.mode === "connect") {
          return "rejected"
        }
        const items = command.items.map(({ item }) => {
          const metadata = item.metadata
          if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
            throw new TypeError("Canvas resource proof metadata is missing")
          }
          const proof = (metadata as Record<string, unknown>)[canvasResourceProofMetadataKeyV2]
          assertResourceProofV2(proof, false)
          if (proof.mode !== "current-owner-state") throw new TypeError("Canvas resource proof is not current")
          return Object.freeze({
            title: item.name ?? (item.kind === "text" ? "Text" : item.kind === "folder" ? "Folder" : "Resource"),
            proof,
            size: Object.freeze(item.kind === "text" ? { width: 320, height: 180 } : { width: 240, height: 180 }),
          })
        })
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "resources-create",
            anchor: Object.freeze({ ...command.placement.anchor }),
            items: Object.freeze(items),
          }),
        })
      }
      case "resources.pending.create": {
        if (command.placement.parentId !== undefined || command.relation?.mode === "connect") return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "manual-resource-placeholders-create",
            anchor: Object.freeze({ ...command.placement.anchor }),
            items: Object.freeze([Object.freeze({
              title: command.label,
              expectedClass: command.kind,
              size: Object.freeze({ width: 240, height: 180 }),
            })]),
          }),
        })
      }
      case "resources.relink": {
        const node = nodeById.get(command.nodeId)
        if (!node || node.role !== "file") return "rejected"
        const metadata = command.item.metadata
        if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return "rejected"
        const proof = (metadata as Record<string, unknown>)[canvasResourceProofMetadataKeyV2]
        assertResourceProofV2(proof, false)
        if (proof.mode !== "current-owner-state") return "rejected"

        const itemMediaClass = command.item.kind === "folder" ? null : command.item.kind
        const expectedMediaClass =
          node.data.kind === "placeholder"
            ? node.data.expectedClass
            : node.data.kind === "resource"
              ? node.data.resource.mediaClass
              : null
        if (
          itemMediaClass === null ||
          proof.resource.mediaClass !== itemMediaClass ||
          expectedMediaClass !== itemMediaClass
        ) {
          return "rejected"
        }
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "resource-relink",
            node: node.ref,
            title: command.item.name ?? node.data.title,
            proof,
          }),
        })
      }
      case "resources.pending.fail":
      case "resources.replace":
      case "resources.replace-generated":
      case "nodes.materialize-connected":
      case "resources.pending-generation.create":
      case "generation.run.start":
      case "generation.run.mark-running":
      case "generation.run.finish":
      case "generation.runs.interrupt-inactive":
        return "rejected"
      default:
        return assertNeverCommand(command)
    }
  } catch {
    return "rejected"
  }
}

function geometryAdaptation(
  caller: CanvasIntentCallerV2,
  index: ReturnType<typeof buildCanvasProjectionIndexV2>,
  before: ReturnType<typeof projectCanvasDocumentV2>["document"],
  after: ReturnType<typeof projectCanvasDocumentV2>["document"],
): CanvasApplicationCommandAdaptationV2 | "rejected" {
  const beforeById = new Map(before.nodes.map((node) => [node.id, node] as const))
  const updates = after.nodes.flatMap((node) => {
    const prior = beforeById.get(node.id)
    const projected = index.projection.nodes.find((candidate) => candidate.ref.id === node.id)
    if (!prior || !projected) throw new TypeError("Canvas geometry planner returned an unknown node")
    const priorSize = getCanvasNodeSize(prior)
    const nextSize = getCanvasNodeSize(node)
    const positionChanged = prior.position.x !== node.position.x || prior.position.y !== node.position.y
    const sizeChanged = priorSize.width !== nextSize.width || priorSize.height !== nextSize.height
    return positionChanged || sizeChanged
      ? [Object.freeze({
          node: projected.ref,
          position: Object.freeze({ ...node.position }),
          size: sizeChanged ? Object.freeze({ ...nextSize }) : null,
        })]
      : []
  })
  if (updates.length === 0 || updates.length > 256 || updates.length + updates.filter((entry) => entry.size !== null).length + 2 > 512) {
    return "rejected"
  }
  return Object.freeze({
    caller,
    command: Object.freeze({ kind: "geometry-set", updates: Object.freeze(updates) }),
  })
}

function callerFromActorKind(kind: string): CanvasIntentCallerV2 | "rejected" {
  if (kind === "agent") return "agent"
  if (kind === "plugin") return "plugin"
  if (kind === "ui" || kind === "renderer") return "ui"
  return "rejected"
}

function sortedRefs<T extends CanvasEntityRefV2>(refs: Iterable<T>): readonly T[] {
  return Object.freeze([...refs].sort((left, right) => canvasEntityKeyV2(left).localeCompare(canvasEntityKeyV2(right))))
}

function finitePoint(value: { readonly x: number; readonly y: number }): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
}

function finiteSize(value: { readonly width: number; readonly height: number }): boolean {
  return Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.height) && value.height > 0
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function assertNeverCommand(value: never): "rejected" {
  void value
  return "rejected"
}

// Keeps the switch coupled to the public union even if TypeScript changes its
// narrowing behavior around the application command discriminator.
type _CanvasApplicationCommandExhaustivenessV2 = CanvasApplicationCommand
