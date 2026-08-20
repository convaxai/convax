import type { CanvasApplicationCommandRequest } from "../application/service"
import type { CanvasApplicationCommand } from "../application/commands"
import { createCanvasGenerationTargetGuard } from "../application/commands"
import { alignCanvasNodes, distributeCanvasNodes, layoutCanvasNodes } from "../commands"
import { getCanvasNodeSize } from "../document"
import {
  canvasNodeGenerationRunSchema,
  finishCanvasNodeGenerationRun,
  getCanvasNodeGenerationRun,
  interruptInactiveCanvasNodeGenerationRuns,
  markCanvasNodeGenerationRunRunning,
  startCanvasNodeGenerationRun,
  succeedCanvasNodeGenerationRun,
  type CanvasNodeGenerationRun,
} from "../generation-run"
import { getCanvasResourcePresentationSize } from "../media-sizing"
import { applyCanvasAutoLayoutPlan, planCanvasLayout } from "../application/layout"
import type { CanvasIntentCaller } from "./session"
import type {
  CanvasEntityRef,
  CanvasSnapshot,
  NodeDataEnvelope,
} from "./types"
import type { OwnerIntentConstructionContext } from "@convax/collaboration"
import { buildCanvasProjectionIndex, projectCanvasDocument } from "./projection"
import type { CanvasAuthoritativeCommand, CanvasCreatedResourceRelation } from "./command-construction"
import { assertPluginState, assertResourceProof, canvasEntityKey, sameCanonicalValue } from "./validation"

export const canvasResourceProofMetadataKey = "convaxCanvasResourceProof"

export interface CanvasApplicationCommandAdaptation {
  readonly caller: CanvasIntentCaller
  readonly command: CanvasAuthoritativeCommand
}

/**
 * Closed owner mapping for the application commands admitted by collaboration v2.
 * Every legacy command discriminator is handled explicitly. Commands whose old
 * payload cannot carry the required v2 proof/authorization material reject; they
 * never fall through to the JSON reducer or become a no-op frame.
 */
export function adaptCanvasApplicationCommand(input: {
  readonly request: CanvasApplicationCommandRequest
  readonly snapshot: CanvasSnapshot
  readonly context: OwnerIntentConstructionContext
}): CanvasApplicationCommandAdaptation | "rejected" {
  try {
    const caller = callerFromActorKind(input.request.envelope.actor.kind)
    if (caller === "rejected") return "rejected"
    const command = input.request.envelope.command
    // The common Project resource-publication path has no Canvas relation and
    // needs no existing entity lookup. Quick-connect carries only a bounded
    // anchor set, resolved through the snapshot-bound node-id index; neither
    // path materializes the live projection arrays.
    if (command.type === "resources.add") {
      const nodesById = hasNoCreatedResourceRelation(command.relation)
        ? new Map<string, never>()
        : buildCanvasProjectionIndex(input.snapshot).nodesById
      return adaptResourcesAdd(caller, command, nodesById)
    }
    if (command.type === "resources.pending.create") {
      const nodesById = hasNoCreatedResourceRelation(command.relation)
        ? new Map<string, never>()
        : buildCanvasProjectionIndex(input.snapshot).nodesById
      return adaptPendingResourceCreate(caller, command, nodesById)
    }
    const index = buildCanvasProjectionIndex(input.snapshot)
    const nodeById = index.nodesById
    const edgeById = index.edgesById

    switch (command.type) {
      case "elements.remove": {
        const requestedNodes = new Set(command.nodeIds ?? [])
        const selectedNodes = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
        let changed = true
        while (changed) {
          changed = false
          for (const node of index.projection.nodes) {
            const selected =
              requestedNodes.has(node.ref.id) ||
              (node.parent !== null && selectedNodes.has(canvasEntityKey(node.parent)))
            if (!selected || selectedNodes.has(canvasEntityKey(node.ref))) continue
            selectedNodes.set(canvasEntityKey(node.ref), node.ref)
            changed = true
          }
        }
        const selectedEdges = new Map<string, CanvasEntityRef & { readonly kind: "edge" }>()
        for (const edgeId of command.edgeIds ?? []) {
          const edge = edgeById.get(edgeId)
          if (edge) selectedEdges.set(canvasEntityKey(edge.ref), edge.ref)
        }
        for (const edge of index.projection.edges) {
          if (selectedNodes.has(canvasEntityKey(edge.source)) || selectedNodes.has(canvasEntityKey(edge.target))) {
            selectedEdges.set(canvasEntityKey(edge.ref), edge.ref)
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
        if (
          !hasOnlyKeys(command.connection, ["source", "target", "data"]) ||
          (command.connection.data !== undefined && !hasOnlyKeys(command.connection.data, ["label"]))
        )
          return "rejected"
        const source = nodeById.get(command.connection.source)
        const target = nodeById.get(command.connection.target)
        if (!source || !target || sameCanonicalValue(source.ref, target.ref)) return "rejected"
        if (
          index.projection.edges.some(
            (edge) => sameCanonicalValue(edge.source, source.ref) && sameCanonicalValue(edge.target, target.ref),
          )
        )
          return "rejected"
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
        if (
          !finitePoint(command.delta) ||
          (command.delta.x === 0 && command.delta.y === 0) ||
          command.nodeIds.length === 0
        ) {
          return "rejected"
        }
        const requested = new Set(command.nodeIds)
        if ([...requested].some((id) => !nodeById.has(id))) return "rejected"
        const selected = index.projection.nodes.filter((node) => {
          if (!requested.has(node.ref.id)) return false
          let parent = node.parent
          const visited = new Set<string>()
          while (parent !== null) {
            const key = canvasEntityKey(parent)
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
            updates: Object.freeze(
              selected.map((node) =>
                Object.freeze({
                  node: node.ref,
                  position: Object.freeze({
                    x: node.position.x + command.delta.x,
                    y: node.position.y + command.delta.y,
                  }),
                  size: null,
                }),
              ),
            ),
          }),
        })
      }
      case "nodes.duplicate": {
        if (command.nodeIds.length < 1 || command.nodeIds.length > 85) return "rejected"
        const requested = new Set(command.nodeIds)
        if (requested.size !== command.nodeIds.length) return "rejected"
        const included = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
        for (const id of command.nodeIds) {
          const source = nodeById.get(id)
          if (!source) return "rejected"
          included.set(canvasEntityKey(source.ref), source.ref)
        }
        let changed = true
        while (changed) {
          changed = false
          for (const node of index.projection.nodes) {
            if (
              node.parent === null ||
              !included.has(canvasEntityKey(node.parent)) ||
              included.has(canvasEntityKey(node.ref))
            )
              continue
            included.set(canvasEntityKey(node.ref), node.ref)
            changed = true
          }
        }
        const sources = [...included.values()]
        if (sources.length > 85) return "rejected"
        const offset = command.offset ?? { x: 32, y: 32 }
        if (!finitePoint(offset) || (offset.x === 0 && offset.y === 0)) return "rejected"
        if (command.edgeScope !== undefined && command.edgeScope !== "connected" && command.edgeScope !== "internal") {
          return "rejected"
        }
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "nodes-duplicate",
            sources: Object.freeze(sources),
            offset: Object.freeze({ ...offset }),
            edgeScope: command.edgeScope ?? "connected",
          }),
        })
      }
      case "nodes.reparent": {
        if (command.nodeIds.length !== 1) return "rejected"
        if (command.delta !== undefined && !finitePoint(command.delta)) return "rejected"
        const child = nodeById.get(command.nodeIds[0]!)
        if (!child) return "rejected"
        const parent = command.parentId === undefined ? null : nodeById.get(command.parentId)
        if (command.parentId !== undefined && (!parent || parent.data.kind !== "group")) return "rejected"
        if (parent && sameCanonicalValue(child.ref, parent.ref)) return "rejected"
        const childWorld = projectedWorldPosition(child, nodeById)
        const parentWorld = parent ? projectedWorldPosition(parent, nodeById) : { x: 0, y: 0 }
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "structural-parent-set",
            child: child.ref,
            parent: parent?.ref ?? null,
            position: Object.freeze({
              x: childWorld.x + (command.delta?.x ?? 0) - parentWorld.x,
              y: childWorld.y + (command.delta?.y ?? 0) - parentWorld.y,
            }),
          }),
        })
      }
      case "nodes.setGeometry": {
        if (command.updates.length === 0 || command.updates.length > 256) return "rejected"
        const seen = new Set<string>()
        const updates = command.updates.flatMap((update) => {
          const node = nodeById.get(update.nodeId)
          if (
            !node ||
            seen.has(node.ref.id) ||
            !finitePoint(update.position) ||
            (update.size !== undefined && !finiteSize(update.size))
          )
            throw new TypeError("Invalid Canvas geometry update")
          seen.add(node.ref.id)
          const samePosition = node.position.x === update.position.x && node.position.y === update.position.y
          const sameSize =
            update.size === undefined ||
            (node.size.width === update.size.width && node.size.height === update.size.height)
          if (samePosition && sameSize) return []
          return [
            Object.freeze({
              node: node.ref,
              position: Object.freeze({ ...update.position }),
              size: update.size === undefined ? null : Object.freeze({ ...update.size }),
            }),
          ]
        })
        if (updates.length === 0) return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({ kind: "geometry-set", updates: Object.freeze(updates) }),
        })
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
          command: Object.freeze({
            kind: "nodes-group",
            children: Object.freeze(children),
            title: command.label ?? "Group",
            folded: command.folded === true,
          }),
        })
      }
      case "nodes.setFolded": {
        const node = nodeById.get(command.nodeId)
        if (!node || node.data.kind !== "group") return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "node-data-set",
            node: node.ref,
            data: Object.freeze({
              format: "convax.canvas-node-data",
              kind: "group",
              title: node.data.title,
              ...(command.folded ? { folded: true as const } : {}),
              ...(node.data.appearance === undefined ? {} : { appearance: { ...node.data.appearance } }),
            }),
          }),
        })
      }
      case "nodes.setGenerationToolId": {
        const node = nodeById.get(command.nodeId)
        if (!node || (node.data.kind !== "resource" && node.data.kind !== "placeholder")) return "rejected"
        if (
          command.toolId !== undefined &&
          (command.toolId.length === 0 ||
            command.toolId.length > 512 ||
            command.toolId !== command.toolId.trim() ||
            /[\u0000-\u001f\u007f]/.test(command.toolId))
        )
          return "rejected"
        const { generationToolId: _generationToolId, ...data } = node.data
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "node-data-set",
            node: node.ref,
            data: Object.freeze({
              ...data,
              ...(command.toolId === undefined ? {} : { generationToolId: command.toolId }),
            }),
          }),
        })
      }
      case "nodes.setGroupAppearance": {
        const node = nodeById.get(command.nodeId)
        if (!node || node.data.kind !== "group") return "rejected"
        const { appearance: _appearance, ...data } = node.data
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "node-data-set",
            node: node.ref,
            data: Object.freeze({
              ...data,
              ...(command.appearance.color === "default" && command.appearance.emoji === "folder"
                ? {}
                : { appearance: Object.freeze({ ...command.appearance }) }),
            }),
          }),
        })
      }
      case "nodes.setTitle": {
        const node = nodeById.get(command.nodeId)
        const title = command.title.trim().slice(0, 200)
        if (!node || title.length === 0 || node.data.title === title) return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "node-data-set",
            node: node.ref,
            data: Object.freeze({ ...node.data, title }),
          }),
        })
      }
      case "nodes.ungroup": {
        const group = nodeById.get(command.nodeId)
        if (!group || group.data.kind !== "group") return "rejected"
        return Object.freeze({ caller, command: Object.freeze({ kind: "nodes-ungroup", group: group.ref }) })
      }
      case "canvas.auto-layout": {
        const document = projectCanvasDocument(index.projection).document
        const next = applyCanvasAutoLayoutPlan(
          document,
          planCanvasLayout(document, {
            ...(command.nodeIds === undefined ? {} : { nodeIds: command.nodeIds }),
            ...(command.options === undefined ? {} : { options: command.options }),
          }),
        )
        return geometryAdaptation(caller, index, document, next)
      }
      case "nodes.align": {
        const document = projectCanvasDocument(index.projection).document
        return geometryAdaptation(
          caller,
          index,
          document,
          alignCanvasNodes(document, command.nodeIds, command.direction),
        )
      }
      case "nodes.distribute": {
        const document = projectCanvasDocument(index.projection).document
        return geometryAdaptation(
          caller,
          index,
          document,
          distributeCanvasNodes(document, command.nodeIds, command.axis),
        )
      }
      case "nodes.layout": {
        const document = projectCanvasDocument(index.projection).document
        return geometryAdaptation(
          caller,
          index,
          document,
          layoutCanvasNodes(document, {
            nodeIds: command.nodeIds,
            ...(command.layout === undefined ? {} : { layout: command.layout }),
            ...(command.gap === undefined ? {} : { gap: command.gap }),
          }),
        )
      }
      case "resources.pending-generation.create": {
        if (command.placement.parentId !== undefined) return "rejected"
        if (command.size !== undefined && !finiteSize(command.size)) return "rejected"
        const relation = adaptCreatedResourceRelation(command.relation, nodeById)
        if (relation === "rejected" || !boundedCreatedResourceSet(1, relation)) return "rejected"
        const generationRun: CanvasNodeGenerationRun = {
          operationId: command.generation.operationId,
          prompt: command.generation.prompt,
          schema: canvasNodeGenerationRunSchema,
          status: "submitting",
          toolId: command.generation.toolId,
        }
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "manual-resource-placeholders-create",
            anchor: Object.freeze({ ...command.placement.anchor }),
            items: Object.freeze([Object.freeze({
              title: command.label,
              expectedClass: command.kind,
              size: Object.freeze(command.size === undefined ? getCanvasResourcePresentationSize(command.kind) : { ...command.size }),
              generationRun,
            })]),
            relation,
          }),
        })
      }
      case "generation.run.start":
      case "generation.run.mark-running":
      case "generation.run.finish":
      case "generation.runs.interrupt-inactive": {
        return adaptGenerationRunUpdate(caller, command, index)
      }
      case "resources.replace-generated": {
        const node = nodeById.get(command.targetNodeId)
        if (!node || node.role !== "file") return "rejected"
        const document = projectCanvasDocument(index.projection).document
        const projected = document.nodes.find((candidate) => candidate.id === command.targetNodeId)
        if (
          !projected ||
          !sameCanonicalValue(createCanvasGenerationTargetGuard(projected), command.expectedTarget)
        ) return "rejected"
        const metadata = command.item.metadata
        if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return "rejected"
        const proof = (metadata as Record<string, unknown>)[canvasResourceProofMetadataKey]
        assertResourceProof(proof, false)
        if (
          proof.mode !== "current-owner-state" ||
          command.item.kind === "folder" ||
          proof.resource.mediaClass !== command.item.kind
        ) return "rejected"
        const completed = succeedCanvasNodeGenerationRun(document, projected.id, command.operationId)
        const completedNode = completed.nodes.find((candidate) => candidate.id === projected.id)!
        const generationRun = getCanvasNodeGenerationRun(completedNode)
        if (!generationRun) return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "generation-runs-update",
            updates: Object.freeze([Object.freeze({
              node: node.ref,
              data: Object.freeze({
                format: "convax.canvas-node-data",
                kind: "resource",
                title: command.item.name ?? node.data.title,
                resource: structuredClone(proof.resource),
                ...(node.data.kind === "resource" || node.data.kind === "placeholder"
                  ? node.data.generationToolId === undefined
                    ? {}
                    : { generationToolId: node.data.generationToolId }
                  : {}),
                generationRun,
              }),
              resourceProof: proof,
            })]),
          }),
        })
      }
      case "resources.relink": {
        const node = nodeById.get(command.nodeId)
        if (!node || node.role !== "file") return "rejected"
        const metadata = command.item.metadata
        if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return "rejected"
        const proof = (metadata as Record<string, unknown>)[canvasResourceProofMetadataKey]
        assertResourceProof(proof, false)
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
        const generationToolId =
          node.data.kind === "resource" || node.data.kind === "placeholder" ? node.data.generationToolId : undefined
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "resource-relink",
            node: node.ref,
            title: command.item.name ?? node.data.title,
            proof,
            ...(generationToolId === undefined ? {} : { generationToolId }),
          }),
        })
      }
      case "plugin.surface.create": {
        // The Host must have derived a complete leased envelope. Canvas accepts
        // no node id, position, or partial Plugin identity from the caller.
        const plugin = Object.freeze({
          format: "convax.canvas-plugin-state",
          pluginId: command.plugin.id,
          snapshotDigest: command.plugin.snapshotDigest,
          pluginStateSchemaDigest: command.plugin.pluginStateSchemaDigest,
          validationArtifact: Object.freeze({ ...command.plugin.validationArtifact }),
          state: structuredClone(command.plugin.state),
        })
        assertPluginState(plugin)
        if (!finiteSize(command.size) || typeof command.label !== "string") return "rejected"
        return Object.freeze({
          caller,
          command: Object.freeze({
            kind: "plugin-surface-create",
            title: command.label,
            size: Object.freeze({ ...command.size }),
            plugin,
          }),
        })
      }
      case "resources.pending.fail":
      case "resources.replace":
      case "nodes.materialize-connected":
        return "rejected"
      default:
        return assertNeverCommand(command)
    }
  } catch {
    return "rejected"
  }
}

function adaptGenerationRunUpdate(
  caller: CanvasIntentCaller,
  command: Extract<
    CanvasApplicationCommand,
    {
      readonly type:
        | "generation.run.start"
        | "generation.run.mark-running"
        | "generation.run.finish"
        | "generation.runs.interrupt-inactive"
    }
  >,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
): CanvasApplicationCommandAdaptation | "rejected" {
  const document = projectCanvasDocument(index.projection).document
  const next = command.type === "generation.run.start"
    ? startCanvasNodeGenerationRun(document, command.nodeId, command)
    : command.type === "generation.run.mark-running"
      ? markCanvasNodeGenerationRunRunning(document, command.nodeId, command.operationId, command.taskId)
      : command.type === "generation.run.finish"
        ? finishCanvasNodeGenerationRun(document, command.nodeId, command.operationId, command.failureMessage)
        : interruptInactiveCanvasNodeGenerationRuns(document, command.liveRuns)
  const requestedIds = command.type === "generation.runs.interrupt-inactive"
    ? document.nodes.flatMap((node) => {
        const before = getCanvasNodeGenerationRun(node)
        const after = getCanvasNodeGenerationRun(next.nodes.find((candidate) => candidate.id === node.id)!)
        return sameCanonicalValue(before ?? null, after ?? null) ? [] : [node.id]
      })
    : [command.nodeId]
  if (requestedIds.length === 0) return "rejected"
  const updates = requestedIds.map((nodeId) => {
    const projected = index.projection.nodes.find((node) => node.ref.id === nodeId)
    const nextNode = next.nodes.find((node) => node.id === nodeId)
    const generationRun = nextNode ? getCanvasNodeGenerationRun(nextNode) : undefined
    if (
      !projected ||
      projected.role !== "file" ||
      (projected.data.kind !== "resource" && projected.data.kind !== "placeholder") ||
      !generationRun
    ) throw new TypeError("Canvas generation run update target is invalid")
    const baseData = projected.data.kind === "placeholder" && projected.data.owner === "manual-pending"
      ? {
          format: "convax.canvas-node-data" as const,
          kind: "placeholder" as const,
          owner: "generation" as const,
          title: projected.data.title,
          expectedClass: projected.data.expectedClass,
          ...(projected.data.generationToolId === undefined
            ? {}
            : { generationToolId: projected.data.generationToolId }),
        }
      : structuredClone(projected.data)
    const data = Object.freeze({
      ...baseData,
      generationRun,
    }) as NodeDataEnvelope & {
      readonly kind: "resource" | "placeholder"
      readonly generationRun: CanvasNodeGenerationRun
    }
    return Object.freeze({ node: projected.ref, data, resourceProof: null })
  })
  return Object.freeze({
    caller,
    command: Object.freeze({ kind: "generation-runs-update", updates: Object.freeze(updates) }),
  })
}

function hasNoCreatedResourceRelation(
  relation: Extract<CanvasApplicationCommand, { type: "resources.add" }>["relation"],
): boolean {
  return relation === undefined || relation.mode === "none"
}

function adaptResourcesAdd(
  caller: CanvasIntentCaller,
  command: Extract<CanvasApplicationCommand, { readonly type: "resources.add" }>,
  nodeById: ReadonlyMap<string, { readonly ref: CanvasEntityRef & { readonly kind: "node" } }>,
): CanvasApplicationCommandAdaptation | "rejected" {
  if (command.items.length < 1 || command.items.length > 85 || command.placement.parentId !== undefined) {
    return "rejected"
  }
  const relation = adaptCreatedResourceRelation(command.relation, nodeById)
  if (relation === "rejected" || !boundedCreatedResourceSet(command.items.length, relation)) return "rejected"
  const items = command.items.map(({ item }) => {
    const metadata = item.metadata
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      throw new TypeError("Canvas resource proof metadata is missing")
    }
    const proof = (metadata as Record<string, unknown>)[canvasResourceProofMetadataKey]
    assertResourceProof(proof, false)
    if (proof.mode !== "current-owner-state") throw new TypeError("Canvas resource proof is not current")
    return Object.freeze({
      title: item.name ?? (item.kind === "text" ? "Text" : item.kind === "folder" ? "Folder" : "Resource"),
      proof,
      size: Object.freeze(
        getCanvasResourcePresentationSize(item.kind, {
          height: "height" in item ? item.height : undefined,
          width: "width" in item ? item.width : undefined,
        }),
      ),
    })
  })
  return Object.freeze({
    caller,
    command: Object.freeze({
      kind: "resources-create",
      anchor: Object.freeze({ ...command.placement.anchor }),
      items: Object.freeze(items),
      relation,
    }),
  })
}

function adaptPendingResourceCreate(
  caller: CanvasIntentCaller,
  command: Extract<CanvasApplicationCommand, { readonly type: "resources.pending.create" }>,
  nodeById: ReadonlyMap<string, { readonly ref: CanvasEntityRef & { readonly kind: "node" } }>,
): CanvasApplicationCommandAdaptation | "rejected" {
  if (command.placement.parentId !== undefined) return "rejected"
  const relation = adaptCreatedResourceRelation(command.relation, nodeById)
  if (relation === "rejected" || !boundedCreatedResourceSet(1, relation)) return "rejected"
  return Object.freeze({
    caller,
    command: Object.freeze({
      kind: "manual-resource-placeholders-create",
      anchor: Object.freeze({ ...command.placement.anchor }),
      items: Object.freeze([
        Object.freeze({
          title: command.label,
          expectedClass: command.kind,
          size: Object.freeze(getCanvasResourcePresentationSize(command.kind)),
        }),
      ]),
      relation,
    }),
  })
}

function adaptCreatedResourceRelation(
  relation: Extract<CanvasApplicationCommand, { type: "resources.add" }>["relation"],
  nodeById: ReadonlyMap<string, { readonly ref: CanvasEntityRef & { readonly kind: "node" } }>,
): CanvasCreatedResourceRelation | null | "rejected" {
  if (relation === undefined || relation.mode === "none") return null
  if (
    relation.mode !== "connect" ||
    (relation.direction !== undefined && relation.direction !== "from-anchor" && relation.direction !== "to-anchor") ||
    relation.anchorNodeIds.length < 1
  ) {
    return "rejected"
  }
  const seen = new Set<string>()
  const anchors = relation.anchorNodeIds.map((nodeId) => {
    if (seen.has(nodeId)) throw new TypeError("Connected resource anchor is duplicated")
    seen.add(nodeId)
    const node = nodeById.get(nodeId)
    if (!node) throw new TypeError("Connected resource anchor is not live")
    return Object.freeze({ ...node.ref })
  })
  return Object.freeze({
    anchors: Object.freeze(anchors),
    direction: relation.direction ?? "from-anchor",
  })
}

function boundedCreatedResourceSet(nodeCount: number, relation: CanvasCreatedResourceRelation | null): boolean {
  const edgeCount = nodeCount * (relation?.anchors.length ?? 0)
  return edgeCount <= 168 && 6 * nodeCount + 3 * edgeCount + 2 <= 512
}

function geometryAdaptation(
  caller: CanvasIntentCaller,
  index: ReturnType<typeof buildCanvasProjectionIndex>,
  before: ReturnType<typeof projectCanvasDocument>["document"],
  after: ReturnType<typeof projectCanvasDocument>["document"],
): CanvasApplicationCommandAdaptation | "rejected" {
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
      ? [
          Object.freeze({
            node: projected.ref,
            position: Object.freeze({ ...node.position }),
            size: sizeChanged ? Object.freeze({ ...nextSize }) : null,
          }),
        ]
      : []
  })
  if (
    updates.length === 0 ||
    updates.length > 256 ||
    updates.length + updates.filter((entry) => entry.size !== null).length + 2 > 512
  ) {
    return "rejected"
  }
  return Object.freeze({
    caller,
    command: Object.freeze({ kind: "geometry-set", updates: Object.freeze(updates) }),
  })
}

function callerFromActorKind(kind: string): CanvasIntentCaller | "rejected" {
  if (kind === "agent") return "agent"
  if (kind === "plugin") return "plugin"
  if (kind === "ui" || kind === "renderer") return "ui"
  return "rejected"
}

function sortedRefs<T extends CanvasEntityRef>(refs: Iterable<T>): readonly T[] {
  return Object.freeze([...refs].sort((left, right) => canvasEntityKey(left).localeCompare(canvasEntityKey(right))))
}

function finitePoint(value: { readonly x: number; readonly y: number }): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
}

function finiteSize(value: { readonly width: number; readonly height: number }): boolean {
  return Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.height) && value.height > 0
}

function projectedWorldPosition(
  node: {
    readonly ref: CanvasEntityRef & { readonly kind: "node" }
    readonly position: { readonly x: number; readonly y: number }
    readonly parent: (CanvasEntityRef & { readonly kind: "node" }) | null
  },
  nodes: ReadonlyMap<
    string,
    {
      readonly ref: CanvasEntityRef & { readonly kind: "node" }
      readonly position: { readonly x: number; readonly y: number }
      readonly parent: (CanvasEntityRef & { readonly kind: "node" }) | null
    }
  >,
): { x: number; y: number } {
  let x = node.position.x
  let y = node.position.y
  let parent = node.parent
  const visited = new Set<string>([canvasEntityKey(node.ref)])
  while (parent !== null) {
    const key = canvasEntityKey(parent)
    if (visited.has(key)) throw new TypeError("Canvas structural parent cycle")
    visited.add(key)
    const value = nodes.get(parent.id)
    if (!value) throw new TypeError("Canvas structural parent is stale")
    x += value.position.x
    y += value.position.y
    parent = value.parent
  }
  return { x, y }
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
type _CanvasApplicationCommandExhaustiveness = CanvasApplicationCommand
