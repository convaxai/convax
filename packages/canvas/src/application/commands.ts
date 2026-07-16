import {
  addCanvasNodes,
  alignCanvasNodes,
  connectCanvasNodes,
  distributeCanvasNodes,
  groupCanvasNodes,
  layoutCanvasNodes,
  moveCanvasNodes,
  removeCanvasElements,
  ungroupCanvasNode,
  type CanvasAlign,
  type CanvasDistribute,
  type CanvasLayout,
} from "../commands"
import { createCanvasId, createFolderNode, createMediaNode, createTextNode, getCanvasNodeSize } from "../document"
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasPoint,
  CanvasSize,
  CanvasUploadItem,
} from "../types"

/** Host-defined actor identity. Canvas does not prescribe application roles. */
export interface CanvasCommandActor {
  id: string
  kind: string
}

export interface CanvasAddResourceItem {
  item: CanvasUploadItem
  nodeId: string
}

export interface CanvasAddResourcesCommand {
  type: "resources.add"
  items: readonly CanvasAddResourceItem[]
  placement: {
    anchor: CanvasPoint
    strategy?: "avoid-overlap-cascade"
  }
  relation?: {
    anchorNodeIds: readonly string[]
    direction?: "from-anchor" | "to-anchor"
    mode: "connect" | "none"
  }
}

/**
 * Product-level operations that preserve the same behavior across UI and Agent
 * callers. Business commands may compose several primitive mutations.
 */
export type CanvasBusinessCommand = CanvasAddResourcesCommand

/** Low-level document mutations available to advanced callers. */
export type CanvasPrimitiveCommand =
  | { type: "elements.remove"; edgeIds?: readonly string[]; nodeIds?: readonly string[] }
  | { type: "nodes.align"; direction: CanvasAlign; nodeIds: readonly string[] }
  | { type: "nodes.connect"; connection: Pick<CanvasEdge, "source" | "target"> & Partial<CanvasEdge> }
  | { type: "nodes.distribute"; axis: CanvasDistribute; nodeIds: readonly string[] }
  | { type: "nodes.group"; label?: string; nodeIds: readonly string[] }
  | { type: "nodes.layout"; gap?: number; layout?: CanvasLayout; nodeIds?: readonly string[] }
  | { type: "nodes.move"; delta: CanvasPoint; nodeIds: readonly string[] }
  | { type: "nodes.ungroup"; nodeId: string }

export type CanvasApplicationCommand = CanvasBusinessCommand | CanvasPrimitiveCommand

export interface CanvasCommandEnvelope {
  actor: CanvasCommandActor
  command: CanvasApplicationCommand
  commandId: string
  expectedRevision: number
}

export interface CanvasBusinessCommandResult {
  affectedNodeIds: string[]
  changed: boolean
  createdNodeIds: string[]
  document: CanvasDocument
  warnings: string[]
}

export class CanvasRevisionConflictError extends Error {
  readonly actualRevision: number
  readonly expectedRevision: number

  constructor(expectedRevision: number, actualRevision: number) {
    super(`Canvas revision conflict: expected ${expectedRevision}, received ${actualRevision}`)
    this.name = "CanvasRevisionConflictError"
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export class CanvasCommandValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CanvasCommandValidationError"
  }
}

export function createAddCanvasResourcesCommand(input: {
  anchor: CanvasPoint
  items: readonly CanvasUploadItem[]
  relation?: CanvasAddResourcesCommand["relation"]
}): CanvasAddResourcesCommand {
  return {
    type: "resources.add",
    items: input.items.map((item) => ({ item, nodeId: createCanvasId("node") })),
    placement: { anchor: input.anchor, strategy: "avoid-overlap-cascade" },
    relation: input.relation,
  }
}

export function findOpenCanvasPoint(
  document: CanvasDocument,
  preferred: CanvasPoint,
  size: CanvasSize = { height: 200, width: 320 },
) {
  requireFinitePoint(preferred, "Placement anchor")
  const candidates = [
    { x: 0, y: 0 },
    { x: 340, y: 0 },
    { x: -340, y: 0 },
    { x: 0, y: 240 },
    { x: 340, y: 240 },
    { x: -340, y: 240 },
    { x: 0, y: -240 },
    { x: 340, y: -240 },
    { x: -340, y: -240 },
  ].map((offset) => ({ x: preferred.x + offset.x, y: preferred.y + offset.y }))
  return candidates.find((candidate) => !document.nodes.some((node) => {
    if (node.parentId) return false
    const nodeSize = getCanvasNodeSize(node)
    return candidate.x < node.position.x + nodeSize.width + 24
      && candidate.x + size.width + 24 > node.position.x
      && candidate.y < node.position.y + nodeSize.height + 24
      && candidate.y + size.height + 24 > node.position.y
  })) ?? candidates[0]
}

export function applyCanvasApplicationCommand(
  document: CanvasDocument,
  command: CanvasApplicationCommand,
): CanvasBusinessCommandResult {
  if (command.type === "resources.add") return addResources(document, command)

  if (command.type === "elements.remove") {
    const affectedNodeIds = existingNodeIds(document, command.nodeIds ?? [])
    const existingEdgeIds = new Set(document.edges.map((edge) => edge.id))
    const edgeIds = (command.edgeIds ?? []).filter((edgeId) => existingEdgeIds.has(edgeId))
    if (affectedNodeIds.length === 0 && edgeIds.length === 0) return result(document, document)
    const next = removeCanvasElements(document, { edgeIds, nodeIds: affectedNodeIds })
    return result(document, next, affectedNodeIds)
  }
  if (command.type === "nodes.connect") {
    requireNodeIds(document, [command.connection.source, command.connection.target])
    const next = connectCanvasNodes(document, command.connection)
    return result(document, next, [command.connection.source, command.connection.target])
  }
  if (command.type === "nodes.move") {
    requireFinitePoint(command.delta, "Move delta")
    requireNodeIds(document, command.nodeIds)
    return result(document, moveCanvasNodes(document, command.nodeIds, command.delta), [...command.nodeIds])
  }
  if (command.type === "nodes.group") {
    requireNodeIds(document, command.nodeIds)
    const grouped = groupCanvasNodes(document, command.nodeIds, command.label)
    const previousIds = new Set(document.nodes.map((node) => node.id))
    const createdNodeIds = grouped.document.nodes.filter((node) => !previousIds.has(node.id)).map((node) => node.id)
    return result(document, grouped.document, grouped.selectedNodeIds, createdNodeIds)
  }
  if (command.type === "nodes.ungroup") {
    requireNodeIds(document, [command.nodeId])
    const ungrouped = ungroupCanvasNode(document, command.nodeId)
    return result(document, ungrouped.document, ungrouped.selectedNodeIds)
  }
  if (command.type === "nodes.layout") {
    if (command.nodeIds) requireNodeIds(document, command.nodeIds)
    if (command.nodeIds?.length === 0) return result(document, document)
    const next = layoutCanvasNodes(document, {
      gap: command.gap,
      layout: command.layout,
      nodeIds: command.nodeIds,
    })
    return result(document, next, command.nodeIds ? [...command.nodeIds] : document.nodes.map((node) => node.id))
  }
  if (command.type === "nodes.align") {
    requireNodeIds(document, command.nodeIds)
    return result(document, alignCanvasNodes(document, command.nodeIds, command.direction), [...command.nodeIds])
  }
  requireNodeIds(document, command.nodeIds)
  return result(document, distributeCanvasNodes(document, command.nodeIds, command.axis), [...command.nodeIds])
}

export function executeCanvasApplicationCommand(
  document: CanvasDocument,
  envelope: CanvasCommandEnvelope,
): CanvasBusinessCommandResult {
  if (!envelope.commandId.trim() || !envelope.actor.id.trim() || !envelope.actor.kind.trim()) {
    throw new CanvasCommandValidationError("Canvas command and actor ids are required")
  }
  if (document.revision !== envelope.expectedRevision) {
    throw new CanvasRevisionConflictError(envelope.expectedRevision, document.revision)
  }
  const applied = applyCanvasApplicationCommand(document, envelope.command)
  if (!applied.changed) return applied
  return { ...applied, document: { ...applied.document, revision: document.revision + 1 } }
}

/**
 * Compatibility API retained for existing callers. It accepts both command
 * layers; new code should prefer the application-named entry points.
 */
export const applyCanvasBusinessCommand = applyCanvasApplicationCommand
export const executeCanvasBusinessCommand = executeCanvasApplicationCommand

function addResources(document: CanvasDocument, command: CanvasAddResourcesCommand): CanvasBusinessCommandResult {
  requireFinitePoint(command.placement.anchor, "Placement anchor")
  const nodeIds = command.items.map((entry) => entry.nodeId)
  if (new Set(nodeIds).size !== nodeIds.length) throw new CanvasCommandValidationError("Resource node ids must be unique")
  const existingIds = new Set(document.nodes.map((node) => node.id))
  const duplicateId = nodeIds.find((nodeId) => existingIds.has(nodeId))
  if (duplicateId) throw new CanvasCommandValidationError(`Canvas node already exists: ${duplicateId}`)

  const relation = command.relation
  const anchorNodeIds = relation?.mode === "connect" ? [...relation.anchorNodeIds] : []
  requireNodeIds(document, anchorNodeIds)
  if (command.items.length === 0) return result(document, document)

  const nodes = command.items.map(({ item, nodeId }) => item.kind === "text"
    ? createTextNode({
        format: item.format,
        id: nodeId,
        label: item.name ?? "Text",
        metadata: item.metadata,
        position: command.placement.anchor,
        text: item.text,
      })
    : item.kind === "folder"
      ? createFolderNode({ id: nodeId, position: command.placement.anchor, resource: item })
      : createMediaNode({ id: nodeId, position: command.placement.anchor, resource: item }))
  const openPoint = findOpenCanvasPoint(document, command.placement.anchor, getCanvasNodeSize(nodes[0]!))
  let next = addCanvasNodes(document, nodes.map((node, index) => ({
    ...node,
    position: { x: openPoint.x + index * 36, y: openPoint.y + index * 36 },
  }))).document
  if (relation?.mode === "connect") {
    const direction = relation.direction ?? "from-anchor"
    for (const anchorNodeId of anchorNodeIds) {
      for (const nodeId of nodeIds) {
        next = connectCanvasNodes(next, direction === "from-anchor"
          ? { source: anchorNodeId, target: nodeId }
          : { source: nodeId, target: anchorNodeId })
      }
    }
  }
  return result(document, next, [...new Set([...anchorNodeIds, ...nodeIds])], nodeIds)
}

function result(
  previous: CanvasDocument,
  document: CanvasDocument,
  affectedNodeIds: readonly string[] = [],
  createdNodeIds: readonly string[] = [],
): CanvasBusinessCommandResult {
  return {
    affectedNodeIds: [...affectedNodeIds],
    changed: document !== previous,
    createdNodeIds: [...createdNodeIds],
    document,
    warnings: [],
  }
}

function existingNodeIds(document: CanvasDocument, nodeIds: readonly string[]) {
  const existing = new Set(document.nodes.map((node) => node.id))
  return nodeIds.filter((nodeId) => existing.has(nodeId))
}

function requireNodeIds(document: CanvasDocument, nodeIds: readonly string[]) {
  const existing = new Set(document.nodes.map((node) => node.id))
  const missing = nodeIds.find((nodeId) => !existing.has(nodeId))
  if (missing) throw new CanvasCommandValidationError(`Canvas node was not found: ${missing}`)
}

function requireFinitePoint(point: CanvasPoint, label: string) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new CanvasCommandValidationError(`${label} must contain finite coordinates`)
  }
}
