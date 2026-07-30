import {
  addCanvasNodes,
  alignCanvasNodes,
  connectCanvasNodes,
  distributeCanvasNodes,
  groupCanvasNodes,
  layoutCanvasNodes,
  moveCanvasNodes,
  removeCanvasElements,
  setCanvasNodeGeometry,
  ungroupCanvasNode,
  type CanvasAlign,
  type CanvasDistribute,
  type CanvasLayout,
  type CanvasNodeGeometryUpdate,
} from "../commands"
import {
  createCanvasId,
  createFolderNode,
  createMediaNode,
  createTextNode,
  getCanvasNodeSize,
  parseCanvasDocument,
} from "../document"
import { isCanvasConnectableNode } from "../connections"
import { sameCanvasJson } from "../json-equality"
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasMetadata,
  CanvasNode,
  CanvasPendingResourceKind,
  CanvasPoint,
  CanvasSize,
  CanvasUploadItem,
} from "../types"
import { canvasNodeGenerationPreferenceKey } from "../generation-preference"
import {
  CanvasNodeGenerationRunValidationError,
  canvasNodeGenerationRunKey,
  finishCanvasNodeGenerationRun,
  interruptInactiveCanvasNodeGenerationRuns,
  markCanvasNodeGenerationRunRunning,
  omitCanvasNodeGenerationRunFromData,
  startCanvasNodeGenerationRun,
  succeedCanvasNodeGenerationRun,
} from "../generation-run"
import {
  applyCanvasAutoLayoutPlan,
  CanvasLayoutValidationError,
  planCanvasLayout,
  type CanvasAutoLayoutOptions,
} from "./layout"

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

export interface CanvasRelinkResourceCommand {
  type: "resources.relink"
  item: CanvasUploadItem
  metadataKeysToRemove?: readonly string[]
  nodeId: string
}

/**
 * Content-only guard for a long-running replacement. Position, size, parentage,
 * selection and edges intentionally stay outside this snapshot so unrelated
 * layout edits can be preserved when the command is replayed.
 */
export interface CanvasNodeContentGuard {
  data: CanvasNode["data"]
  type: CanvasNode["type"]
}

export interface CanvasReplaceResourceCommand {
  type: "resources.replace"
  expectedTarget: CanvasNodeContentGuard
  item: CanvasUploadItem
  targetNodeId: string
}

/**
 * Generation-specific target guard. The Canvas-owned current-run and next-run
 * preference namespaces are omitted; resource content and every other metadata
 * value remain protected against concurrent replacement.
 */
export interface CanvasGenerationTargetGuard {
  data: CanvasNode["data"]
  type: CanvasNode["type"]
}

export interface CanvasReplaceGeneratedResourceCommand {
  type: "resources.replace-generated"
  expectedTarget: CanvasGenerationTargetGuard
  item: CanvasUploadItem
  operationId: string
  targetNodeId: string
}

export type CanvasNodeGenerationRunCommand =
  | {
      type: "generation.run.start"
      nodeId: string
      operationId: string
      prompt: string
      toolId: string
    }
  | {
      type: "generation.run.mark-running"
      nodeId: string
      operationId: string
      taskId?: string
    }
  | {
      type: "generation.run.finish"
      nodeId: string
      operationId: string
      retrySafety: "safe" | "unknown"
      status: "failed" | "cancelled" | "interrupted"
    }
  | {
      type: "generation.runs.interrupt-inactive"
      liveRuns: readonly { nodeId: string; operationId: string }[]
    }

export interface CanvasAutoLayoutCommand {
  type: "canvas.auto-layout"
  nodeIds?: readonly string[]
  options?: CanvasAutoLayoutOptions
}

export interface CanvasCreatePendingResourceCommand {
  type: "resources.pending.create"
  kind: CanvasPendingResourceKind
  label: string
  nodeId: string
  placement: CanvasAddResourcesCommand["placement"]
  relation?: CanvasAddResourcesCommand["relation"]
}

export interface CanvasCreatePendingGenerationResourceCommand {
  type: "resources.pending-generation.create"
  generation: {
    operationId: string
    prompt: string
    toolId: string
  }
  kind: CanvasPendingResourceKind
  label: string
  nodeId: string
  placement: CanvasAddResourcesCommand["placement"]
  relation?: CanvasAddResourcesCommand["relation"]
}

export interface CanvasFailPendingResourceCommand {
  type: "resources.pending.fail"
  expectedTarget: CanvasNodeContentGuard
  message: string
  targetNodeId: string
}

/**
 * Generic host-owned materialization primitive for declarative integrations.
 * The host supplies an already-authorized file node; Canvas owns placement,
 * source validation, the direct edge, revision handling, and the atomic save.
 */
export interface CanvasMaterializeConnectedNodeCommand {
  type: "nodes.materialize-connected"
  node: CanvasNode
  sourceKind: string
  sourceNodeId: string
}

/**
 * Revision-bound renderer delta. The renderer may optimistically project a
 * complete document locally, but only this element-level command crosses the
 * host boundary. Main applies and persists it through the same application
 * service as every other Canvas mutation.
 */
export interface CanvasDocumentPatchCommand {
  type: "document.patch"
  addedEdges: readonly CanvasEdge[]
  addedNodes: readonly CanvasNode[]
  metadata?: CanvasMetadata
  removedEdgeIds: readonly string[]
  removedNodeIds: readonly string[]
  updatedEdges: readonly CanvasEdge[]
  updatedNodes: readonly CanvasNode[]
}

/**
 * Product-level operations that preserve the same behavior across UI and Agent
 * callers. Business commands may compose several primitive mutations.
 */
export type CanvasBusinessCommand =
  | CanvasAddResourcesCommand
  | CanvasCreatePendingGenerationResourceCommand
  | CanvasCreatePendingResourceCommand
  | CanvasFailPendingResourceCommand
  | CanvasReplaceGeneratedResourceCommand
  | CanvasNodeGenerationRunCommand
  | CanvasAutoLayoutCommand
  | CanvasRelinkResourceCommand
  | CanvasReplaceResourceCommand
  | CanvasMaterializeConnectedNodeCommand

/** Low-level document mutations available to advanced callers. */
export type CanvasPrimitiveCommand =
  | CanvasDocumentPatchCommand
  | { type: "elements.remove"; edgeIds?: readonly string[]; nodeIds?: readonly string[] }
  | { type: "nodes.align"; direction: CanvasAlign; nodeIds: readonly string[] }
  | { type: "nodes.connect"; connection: Pick<CanvasEdge, "source" | "target"> & Partial<CanvasEdge> }
  | { type: "nodes.distribute"; axis: CanvasDistribute; nodeIds: readonly string[] }
  | { type: "nodes.group"; label?: string; nodeIds: readonly string[] }
  | { type: "nodes.layout"; gap?: number; layout?: CanvasLayout; nodeIds: readonly string[] }
  | { type: "nodes.move"; delta: CanvasPoint; nodeIds: readonly string[] }
  | { type: "nodes.setGeometry"; updates: readonly CanvasNodeGeometryUpdate[] }
  | { type: "nodes.ungroup"; nodeId: string }

export type CanvasApplicationCommand = CanvasBusinessCommand | CanvasPrimitiveCommand

export interface CanvasCommandEnvelope {
  actor: CanvasCommandActor
  command: CanvasApplicationCommand
  commandId: string
  expectedRevision: number
}

export interface CanvasTransactionEnvelope {
  actor: CanvasCommandActor
  commands: readonly CanvasApplicationCommand[]
  expectedRevision: number
  transactionId: string
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

export function createCanvasPendingResourceCommand(input: {
  anchor: CanvasPoint
  kind: CanvasPendingResourceKind
  label: string
  relation?: CanvasAddResourcesCommand["relation"]
}): CanvasCreatePendingResourceCommand {
  return {
    type: "resources.pending.create",
    kind: input.kind,
    label: input.label,
    nodeId: createCanvasId("node"),
    placement: { anchor: input.anchor, strategy: "avoid-overlap-cascade" },
    relation: input.relation,
  }
}

export function createCanvasPendingGenerationResourceCommand(input: {
  anchor: CanvasPoint
  generation: {
    operationId: string
    prompt: string
    toolId: string
  }
  kind: CanvasPendingResourceKind
  label: string
  relation?: CanvasAddResourcesCommand["relation"]
}): CanvasCreatePendingGenerationResourceCommand {
  return {
    type: "resources.pending-generation.create",
    generation: structuredClone(input.generation),
    kind: input.kind,
    label: input.label,
    nodeId: createCanvasId("node"),
    placement: { anchor: input.anchor, strategy: "avoid-overlap-cascade" },
    relation: input.relation,
  }
}

export function createCanvasNodeContentGuard(node: CanvasNode): CanvasNodeContentGuard {
  return structuredClone(durableCanvasNodeContent(node))
}

/** Matches the portable content semantics used by Canvas persistence. */
export function matchesCanvasNodeContentGuard(node: CanvasNode, expected: CanvasNodeContentGuard) {
  return sameCanvasJson(durableCanvasNodeContent(node), expected)
}

function durableCanvasNodeContent(node: CanvasNode): CanvasNodeContentGuard {
  const { resourceState: _resourceState, ...data } = node.data
  return { data, type: node.type }
}

export function createCanvasDocumentPatchCommand(
  base: CanvasDocument,
  next: CanvasDocument,
): CanvasDocumentPatchCommand {
  if (base.id !== next.id) throw new CanvasCommandValidationError("Canvas patch cannot change the document id")
  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]))
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]))
  const baseEdges = new Map(base.edges.map((edge) => [edge.id, edge]))
  const nextEdges = new Map(next.edges.map((edge) => [edge.id, edge]))
  return {
    type: "document.patch",
    addedEdges: next.edges.filter((edge) => !baseEdges.has(edge.id)).map((edge) => structuredClone(edge)),
    addedNodes: next.nodes.filter((node) => !baseNodes.has(node.id)).map((node) => structuredClone(node)),
    ...(sameCanvasJson(base.metadata, next.metadata) ? {} : { metadata: structuredClone(next.metadata) }),
    removedEdgeIds: base.edges.filter((edge) => !nextEdges.has(edge.id)).map((edge) => edge.id),
    removedNodeIds: base.nodes.filter((node) => !nextNodes.has(node.id)).map((node) => node.id),
    updatedEdges: next.edges
      .filter((edge) => {
        const current = baseEdges.get(edge.id)
        return current !== undefined && !sameCanvasJson(current, edge)
      })
      .map((edge) => structuredClone(edge)),
    updatedNodes: next.nodes
      .filter((node) => {
        const current = baseNodes.get(node.id)
        return current !== undefined && !sameCanvasJson(current, node)
      })
      .map((node) => structuredClone(node)),
  }
}

export function createRelinkCanvasResourceCommand(input: {
  item: CanvasUploadItem
  metadataKeysToRemove?: readonly string[]
  nodeId: string
}): CanvasRelinkResourceCommand {
  return {
    item: input.item,
    ...(input.metadataKeysToRemove === undefined ? {} : { metadataKeysToRemove: [...input.metadataKeysToRemove] }),
    nodeId: input.nodeId,
    type: "resources.relink",
  }
}

export function createCanvasGenerationTargetGuard(node: CanvasNode): CanvasGenerationTargetGuard {
  return structuredClone({ data: omitCanvasOwnedGenerationMetadataFromData(node.data), type: node.type })
}

export function findOpenCanvasPoint(
  document: CanvasDocument,
  preferred: CanvasPoint,
  size: CanvasSize = { height: 200, width: 320 },
  bounds?: { bottom: number; left: number; right: number; top: number },
): CanvasPoint {
  requireFinitePoint(preferred, "Placement anchor")
  const gap = 24
  const occupied = document.nodes
    .filter((node) => !node.parentId)
    .sort(
      (left, right) =>
        Math.hypot(left.position.x - preferred.x, left.position.y - preferred.y) -
        Math.hypot(right.position.x - preferred.x, right.position.y - preferred.y),
    )
  const boundedCandidates = bounds ? createBoundedCanvasPlacementCandidates(bounds, preferred, size, gap) : []
  const candidates = [
    preferred,
    ...occupied.flatMap((node) => {
      const nodeSize = getCanvasNodeSize(node)
      return [
        { x: node.position.x + nodeSize.width + gap, y: preferred.y },
        { x: preferred.x, y: node.position.y + nodeSize.height + gap },
        { x: node.position.x - size.width - gap, y: preferred.y },
        { x: preferred.x, y: node.position.y - size.height - gap },
      ]
    }),
    ...boundedCandidates,
  ]
    .filter((candidate) => Number.isFinite(candidate.x) && Number.isFinite(candidate.y))
    .filter((candidate) => !bounds || canvasPlacementFitsBounds(candidate, size, bounds))
    .filter(
      (candidate, index, all) => all.findIndex((other) => other.x === candidate.x && other.y === candidate.y) === index,
    )
  const open = candidates.find(
    (candidate) =>
      !occupied.some((node) => {
        if (node.parentId) return false
        const nodeSize = getCanvasNodeSize(node)
        return (
          candidate.x < node.position.x + nodeSize.width + gap &&
          candidate.x + size.width + gap > node.position.x &&
          candidate.y < node.position.y + nodeSize.height + gap &&
          candidate.y + size.height + gap > node.position.y
        )
      }),
  )
  if (open) return open
  return bounds ? findOpenCanvasPoint(document, preferred, size) : preferred
}

function createBoundedCanvasPlacementCandidates(
  bounds: { bottom: number; left: number; right: number; top: number },
  preferred: CanvasPoint,
  size: CanvasSize,
  gap: number,
) {
  if (
    ![bounds.bottom, bounds.left, bounds.right, bounds.top, size.height, size.width].every(Number.isFinite) ||
    size.width <= 0 ||
    size.height <= 0 ||
    bounds.right - bounds.left < size.width ||
    bounds.bottom - bounds.top < size.height
  ) {
    return []
  }
  const maxX = bounds.right - size.width
  const maxY = bounds.bottom - size.height
  const xs = canvasPlacementAxisCandidates(bounds.left, maxX, size.width + gap)
  const ys = canvasPlacementAxisCandidates(bounds.top, maxY, size.height + gap)
  return xs
    .flatMap((x) => ys.map((y) => ({ x, y })))
    .sort(
      (left, right) =>
        Math.hypot(left.x - preferred.x, left.y - preferred.y) -
          Math.hypot(right.x - preferred.x, right.y - preferred.y) ||
        left.y - right.y ||
        left.x - right.x,
    )
}

function canvasPlacementAxisCandidates(start: number, end: number, step: number) {
  const values: number[] = []
  for (let value = start; value <= end; value += step) values.push(value)
  if (values.at(-1) !== end) values.push(end)
  return values
}

function canvasPlacementFitsBounds(
  point: CanvasPoint,
  size: CanvasSize,
  bounds: { bottom: number; left: number; right: number; top: number },
) {
  return (
    point.x >= bounds.left &&
    point.y >= bounds.top &&
    point.x + size.width <= bounds.right &&
    point.y + size.height <= bounds.bottom
  )
}

export function applyCanvasApplicationCommand(
  document: CanvasDocument,
  command: CanvasApplicationCommand,
): CanvasBusinessCommandResult {
  if (command.type === "document.patch") return applyDocumentPatch(document, command)
  if (command.type === "resources.add") return addResources(document, command)
  if (command.type === "resources.replace") return replaceResource(document, command)
  if (command.type === "resources.replace-generated") return replaceGeneratedResource(document, command)
  if (command.type === "generation.run.start") {
    return applyGenerationRunMutation(document, command.nodeId, () =>
      startCanvasNodeGenerationRun(document, command.nodeId, {
        operationId: command.operationId,
        prompt: command.prompt,
        toolId: command.toolId,
      }),
    )
  }
  if (command.type === "generation.run.mark-running") {
    return applyGenerationRunMutation(document, command.nodeId, () =>
      markCanvasNodeGenerationRunRunning(document, command.nodeId, command.operationId, command.taskId),
    )
  }
  if (command.type === "generation.run.finish") {
    return applyGenerationRunMutation(document, command.nodeId, () =>
      finishCanvasNodeGenerationRun(document, command.nodeId, command.operationId, command.status, command.retrySafety),
    )
  }
  if (command.type === "generation.runs.interrupt-inactive") {
    if (command.liveRuns.length > 1_000) {
      throw new CanvasCommandValidationError("Canvas generation reconciliation contains too many live runs")
    }
    const keys = command.liveRuns.map((run) => `${run.nodeId}\0${run.operationId}`)
    if (new Set(keys).size !== keys.length) {
      throw new CanvasCommandValidationError("Canvas generation reconciliation contains duplicate live runs")
    }
    try {
      const next = interruptInactiveCanvasNodeGenerationRuns(document, command.liveRuns)
      const affectedNodeIds = next.nodes.filter((node, index) => node !== document.nodes[index]).map((node) => node.id)
      return result(document, next, affectedNodeIds)
    } catch (error) {
      throwGenerationRunValidation(error)
    }
  }
  if (command.type === "canvas.auto-layout") {
    if (command.nodeIds) requireNodeIds(document, command.nodeIds)
    if (command.nodeIds?.length === 0) return result(document, document)
    try {
      const plan = planCanvasLayout(document, { nodeIds: command.nodeIds, options: command.options })
      const next = applyCanvasAutoLayoutPlan(document, plan)
      const affectedNodeIds = new Set(plan.positions.map((entry) => entry.nodeId))
      next.nodes.forEach((node, index) => {
        if (node !== document.nodes[index]) affectedNodeIds.add(node.id)
      })
      return result(document, next, [...affectedNodeIds])
    } catch (error) {
      if (error instanceof CanvasLayoutValidationError) throw new CanvasCommandValidationError(error.message)
      throw error
    }
  }
  if (command.type === "resources.pending.create" || command.type === "resources.pending-generation.create") {
    return createPendingResource(document, command)
  }
  if (command.type === "resources.pending.fail") return failPendingResource(document, command)
  if (command.type === "resources.relink") return relinkResource(document, command)
  if (command.type === "nodes.materialize-connected") return materializeConnectedNode(document, command)

  if (command.type === "elements.remove") {
    const affectedNodeIds = existingNodeIds(document, command.nodeIds ?? [])
    const existingEdgeIds = new Set(document.edges.map((edge) => edge.id))
    const edgeIds = (command.edgeIds ?? []).filter((edgeId) => existingEdgeIds.has(edgeId))
    if (affectedNodeIds.length === 0 && edgeIds.length === 0) return result(document, document)
    const next = removeCanvasElements(document, { edgeIds, nodeIds: affectedNodeIds })
    return result(document, next, affectedNodeIds)
  }
  if (command.type === "nodes.connect") {
    requireConnectableNodeIds(document, [command.connection.source, command.connection.target])
    const next = connectCanvasNodes(document, command.connection)
    return result(document, next, [command.connection.source, command.connection.target])
  }
  if (command.type === "nodes.move") {
    requireFinitePoint(command.delta, "Move delta")
    requireNodeIds(document, command.nodeIds)
    return result(document, moveCanvasNodes(document, command.nodeIds, command.delta), [...command.nodeIds])
  }
  if (command.type === "nodes.setGeometry") {
    const seen = new Set<string>()
    for (const update of command.updates) {
      if (seen.has(update.nodeId)) {
        throw new CanvasCommandValidationError(`Canvas geometry contains a duplicate node: ${update.nodeId}`)
      }
      seen.add(update.nodeId)
      requireFinitePoint(update.position, "Canvas geometry position")
      if (
        update.size &&
        (!Number.isFinite(update.size.width) ||
          update.size.width <= 0 ||
          !Number.isFinite(update.size.height) ||
          update.size.height <= 0)
      ) {
        throw new CanvasCommandValidationError("Canvas geometry size must contain finite positive dimensions")
      }
    }
    requireNodeIds(
      document,
      command.updates.map((update) => update.nodeId),
    )
    return result(
      document,
      setCanvasNodeGeometry(document, command.updates),
      command.updates.map((update) => update.nodeId),
    )
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
    if (!command.nodeIds) {
      throw new CanvasCommandValidationError("Primitive node layout requires explicit node ids")
    }
    requireNodeIds(document, command.nodeIds)
    if (command.nodeIds.length === 0) return result(document, document)
    const next = layoutCanvasNodes(document, {
      gap: command.gap,
      layout: command.layout,
      nodeIds: command.nodeIds,
    })
    return result(document, next, [...command.nodeIds])
  }
  if (command.type === "nodes.align") {
    requireNodeIds(document, command.nodeIds)
    return result(document, alignCanvasNodes(document, command.nodeIds, command.direction), [...command.nodeIds])
  }
  requireNodeIds(document, command.nodeIds)
  return result(document, distributeCanvasNodes(document, command.nodeIds, command.axis), [...command.nodeIds])
}

const relinkableCanvasResourceKinds = new Set(["audio", "file", "folder", "image", "text", "video"])

function relinkResource(document: CanvasDocument, command: CanvasRelinkResourceCommand): CanvasBusinessCommandResult {
  const index = document.nodes.findIndex((node) => node.id === command.nodeId)
  if (index < 0) throw new CanvasCommandValidationError(`Canvas node was not found: ${command.nodeId}`)
  const node = document.nodes[index]
  if (!relinkableCanvasResourceKinds.has(node.data.kind) || node.data.kind !== command.item.kind) {
    throw new CanvasCommandValidationError(
      `Canvas ${node.data.kind} node cannot be relinked to a ${command.item.kind} resource`,
    )
  }
  if (!isRecord(node.data.metadata) || !isRecord(command.item.metadata) || !isRecord(command.item.state)) {
    throw new CanvasCommandValidationError("Relinked Canvas resource is invalid")
  }
  const metadataKeysToRemove = requireRelinkMetadataKeys(command.metadataKeysToRemove)
  const metadata = { ...node.data.metadata }
  for (const key of metadataKeysToRemove) delete metadata[key]

  let nextData: CanvasNode["data"] = {
    ...node.data,
    metadata: { ...metadata, ...command.item.metadata },
    mimeType: command.item.kind === "folder" ? undefined : command.item.mimeType,
    name: command.item.name,
    resourceState: { ...command.item.state },
  }
  if (command.item.kind !== "folder" && command.item.kind !== "text") {
    const { durationMs: _durationMs, height: _height, width: _width, ...dataWithoutMediaIntrinsicValues } = nextData
    nextData = {
      ...dataWithoutMediaIntrinsicValues,
      ...(command.item.durationMs === undefined ? {} : { durationMs: command.item.durationMs }),
      ...(command.item.height === undefined ? {} : { height: command.item.height }),
      ...(command.item.width === undefined ? {} : { width: command.item.width }),
    }
  }
  const nextNode: CanvasNode = {
    ...node,
    data: nextData,
  }
  const nodes = [...document.nodes]
  nodes[index] = nextNode
  return result(document, { ...document, nodes }, [node.id])
}

function requireRelinkMetadataKeys(value: readonly string[] | undefined) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new CanvasCommandValidationError("Relink metadata keys must be an array")
  const keys = new Set<string>()
  for (const key of value) {
    if (typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(key) || keys.has(key)) {
      throw new CanvasCommandValidationError("Relink metadata key is invalid or duplicated")
    }
    keys.add(key)
  }
  return keys
}

export function executeCanvasApplicationCommand(
  document: CanvasDocument,
  envelope: CanvasCommandEnvelope,
): CanvasBusinessCommandResult {
  if (!envelope.commandId.trim() || !validActor(envelope.actor)) {
    throw new CanvasCommandValidationError("Canvas command and actor ids are required")
  }
  if (document.revision !== envelope.expectedRevision) {
    throw new CanvasRevisionConflictError(envelope.expectedRevision, document.revision)
  }
  const applied = applyCanvasApplicationCommand(document, envelope.command)
  if (!applied.changed) return applied
  return { ...applied, document: { ...applied.document, revision: document.revision + 1 } }
}

/** Applies all commands in order and publishes at most one logical revision. */
export function executeCanvasApplicationTransaction(
  document: CanvasDocument,
  envelope: CanvasTransactionEnvelope,
): CanvasBusinessCommandResult {
  if (!envelope.transactionId.trim() || !validActor(envelope.actor)) {
    throw new CanvasCommandValidationError("Canvas transaction and actor ids are required")
  }
  if (document.revision !== envelope.expectedRevision) {
    throw new CanvasRevisionConflictError(envelope.expectedRevision, document.revision)
  }
  let current = document
  const affectedNodeIds = new Set<string>()
  const createdNodeIds = new Set<string>()
  const warnings: string[] = []
  for (const command of envelope.commands) {
    const applied = applyCanvasApplicationCommand(current, command)
    current = applied.document
    applied.affectedNodeIds.forEach((nodeId) => affectedNodeIds.add(nodeId))
    applied.createdNodeIds.forEach((nodeId) => createdNodeIds.add(nodeId))
    warnings.push(...applied.warnings)
  }
  if (current === document) return result(document, document)
  return {
    affectedNodeIds: [...affectedNodeIds],
    changed: true,
    createdNodeIds: [...createdNodeIds],
    document: { ...current, revision: document.revision + 1 },
    warnings,
  }
}

/**
 * Compatibility API retained for existing callers. It accepts both command
 * layers; new code should prefer the application-named entry points.
 */
export const applyCanvasBusinessCommand = applyCanvasApplicationCommand
export const executeCanvasBusinessCommand = executeCanvasApplicationCommand

function applyDocumentPatch(
  document: CanvasDocument,
  command: CanvasDocumentPatchCommand,
): CanvasBusinessCommandResult {
  const removedNodeIds = requireUniqueIds(command.removedNodeIds, "Canvas patch removed node ids")
  const removedEdgeIds = requireUniqueIds(command.removedEdgeIds, "Canvas patch removed edge ids")
  const addedNodeIds = requireUniqueElementIds(command.addedNodes, "Canvas patch added nodes")
  const updatedNodeIds = requireUniqueElementIds(command.updatedNodes, "Canvas patch updated nodes")
  const addedEdgeIds = requireUniqueElementIds(command.addedEdges, "Canvas patch added edges")
  const updatedEdgeIds = requireUniqueElementIds(command.updatedEdges, "Canvas patch updated edges")
  const existingNodes = new Map(document.nodes.map((node) => [node.id, node]))
  const existingEdges = new Map(document.edges.map((edge) => [edge.id, edge]))

  requireExistingPatchIds(existingNodes, removedNodeIds, "Canvas node")
  requireExistingPatchIds(existingNodes, updatedNodeIds, "Canvas node")
  requireExistingPatchIds(existingEdges, removedEdgeIds, "Canvas edge")
  requireExistingPatchIds(existingEdges, updatedEdgeIds, "Canvas edge")
  requireNewPatchIds(existingNodes, addedNodeIds, "Canvas node")
  requireNewPatchIds(existingEdges, addedEdgeIds, "Canvas edge")
  requireDisjointPatchIds(removedNodeIds, updatedNodeIds, "Canvas node")
  requireDisjointPatchIds(removedEdgeIds, updatedEdgeIds, "Canvas edge")

  const removedNodes = new Set(removedNodeIds)
  const removedEdges = new Set(removedEdgeIds)
  const updatedNodes = new Map(command.updatedNodes.map((node) => [node.id, structuredClone(node)]))
  const updatedEdges = new Map(command.updatedEdges.map((edge) => [edge.id, structuredClone(edge)]))
  const candidate: CanvasDocument = {
    id: document.id,
    revision: document.revision,
    metadata: structuredClone(command.metadata ?? document.metadata),
    nodes: [
      ...document.nodes
        .filter((node) => !removedNodes.has(node.id))
        .map((node) => updatedNodes.get(node.id) ?? structuredClone(node)),
      ...command.addedNodes.map((node) => structuredClone(node)),
    ],
    edges: [
      ...document.edges
        .filter((edge) => !removedEdges.has(edge.id))
        .map((edge) => updatedEdges.get(edge.id) ?? structuredClone(edge)),
      ...command.addedEdges.map((edge) => structuredClone(edge)),
    ],
  }
  const parsed = parseCanvasDocument(candidate, document.id)
  if (!parsed) throw new CanvasCommandValidationError("Canvas patch produced an invalid document")
  for (const edge of [...command.addedEdges, ...command.updatedEdges]) {
    requireConnectableNodeIds(parsed, [edge.source, edge.target])
  }
  if (sameCanvasJson(document, parsed)) return result(document, document)

  const affectedNodeIds = new Set([...removedNodeIds, ...addedNodeIds, ...updatedNodeIds])
  for (const edgeId of [...removedEdgeIds, ...updatedEdgeIds]) {
    const edge = existingEdges.get(edgeId)
    if (edge) {
      affectedNodeIds.add(edge.source)
      affectedNodeIds.add(edge.target)
    }
  }
  for (const edge of command.addedEdges) {
    affectedNodeIds.add(edge.source)
    affectedNodeIds.add(edge.target)
  }
  return result(document, parsed, [...affectedNodeIds], addedNodeIds)
}

function addResources(document: CanvasDocument, command: CanvasAddResourcesCommand): CanvasBusinessCommandResult {
  requireFinitePoint(command.placement.anchor, "Placement anchor")
  const nodeIds = command.items.map((entry) => entry.nodeId)
  if (new Set(nodeIds).size !== nodeIds.length)
    throw new CanvasCommandValidationError("Resource node ids must be unique")
  const existingIds = new Set(document.nodes.map((node) => node.id))
  const duplicateId = nodeIds.find((nodeId) => existingIds.has(nodeId))
  if (duplicateId) throw new CanvasCommandValidationError(`Canvas node already exists: ${duplicateId}`)

  const relation = command.relation
  const anchorNodeIds = relation?.mode === "connect" ? [...relation.anchorNodeIds] : []
  requireConnectableNodeIds(document, anchorNodeIds)
  if (command.items.length === 0) return result(document, document)

  const nodes = command.items.map(({ item, nodeId }) => createNodeFromResource(item, nodeId, command.placement.anchor))
  const openPoint = findOpenCanvasPoint(document, command.placement.anchor, getCanvasNodeSize(nodes[0]))
  let next = addCanvasNodes(
    document,
    nodes.map((node, index) => ({
      ...node,
      position: { x: openPoint.x + index * 36, y: openPoint.y + index * 36 },
    })),
  ).document
  if (relation?.mode === "connect") {
    const direction = relation.direction ?? "from-anchor"
    for (const anchorNodeId of anchorNodeIds) {
      for (const nodeId of nodeIds) {
        next = connectCanvasNodes(
          next,
          direction === "from-anchor"
            ? { source: anchorNodeId, target: nodeId }
            : { source: nodeId, target: anchorNodeId },
        )
      }
    }
  }
  return result(document, next, [...new Set([...anchorNodeIds, ...nodeIds])], nodeIds)
}

function materializeConnectedNode(
  document: CanvasDocument,
  command: CanvasMaterializeConnectedNodeCommand,
): CanvasBusinessCommandResult {
  requireNonEmptyBoundedString(command.sourceNodeId, "Materialization source node id", 256)
  requireNonEmptyBoundedString(command.sourceKind, "Materialization source kind", 80)
  const source = document.nodes.find((node) => node.id === command.sourceNodeId)
  if (!source) throw new CanvasCommandValidationError(`Canvas node was not found: ${command.sourceNodeId}`)
  if (source.type !== "file" || source.data.kind !== command.sourceKind) {
    throw new CanvasCommandValidationError(
      `Canvas materialization requires a ${command.sourceKind} file node: ${command.sourceNodeId}`,
    )
  }
  const node = structuredClone(command.node)
  requireNonEmptyBoundedString(node.id, "Materialized node id", 256)
  if (document.nodes.some((candidate) => candidate.id === node.id)) {
    throw new CanvasCommandValidationError(`Canvas node already exists: ${node.id}`)
  }
  if (node.type !== "file" || node.parentId !== undefined || node.id === source.id) {
    throw new CanvasCommandValidationError("Materialized node must be an independent top-level file node")
  }
  const sourceSize = getCanvasNodeSize(source)
  const preferred = { x: source.position.x + sourceSize.width + 24, y: source.position.y }
  const position = findOpenCanvasPoint(document, preferred, getCanvasNodeSize(node))
  let next = addCanvasNodes(document, [{ ...node, position }]).document
  next = connectCanvasNodes(next, { source: source.id, target: node.id })
  return result(document, next, [source.id, node.id], [node.id])
}

function replaceResource(document: CanvasDocument, command: CanvasReplaceResourceCommand): CanvasBusinessCommandResult {
  const target = document.nodes.find((node) => node.id === command.targetNodeId)
  if (!target) throw new CanvasCommandValidationError(`Canvas node was not found: ${command.targetNodeId}`)
  if (target.type !== "file" || target.data.kind === "group") {
    throw new CanvasCommandValidationError(`Canvas resource replacement requires a file node: ${target.id}`)
  }
  if (!matchesCanvasNodeContentGuard(target, command.expectedTarget)) {
    throw new CanvasCommandValidationError(`Canvas node content changed before resource replacement: ${target.id}`)
  }

  const replacement = createNodeFromResource(command.item, target.id, target.position)
  const replacesResourceLifecycle = target.data.status === "pending" || target.data.status === "error"
  const next = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === target.id
        ? {
            ...node,
            data: replacement.data,
            ...(replacesResourceLifecycle
              ? {
                  height: undefined,
                  initialHeight: undefined,
                  initialWidth: undefined,
                  measured: undefined,
                  style: replacement.style,
                  width: undefined,
                }
              : {}),
            type: replacement.type,
          }
        : node,
    ),
  }
  return result(document, next, [target.id])
}

function createPendingResource(
  document: CanvasDocument,
  command: CanvasCreatePendingGenerationResourceCommand | CanvasCreatePendingResourceCommand,
): CanvasBusinessCommandResult {
  requireFinitePoint(command.placement.anchor, "Placement anchor")
  requirePendingResourceKind(command.kind)
  requireNonEmptyBoundedString(command.nodeId, "Pending resource node id", 256)
  requireNonEmptyBoundedString(command.label, "Pending resource label", 200)
  if (document.nodes.some((node) => node.id === command.nodeId)) {
    throw new CanvasCommandValidationError(`Canvas node already exists: ${command.nodeId}`)
  }

  const relation = command.relation
  const anchorNodeIds = relation?.mode === "connect" ? [...relation.anchorNodeIds] : []
  requireConnectableNodeIds(document, anchorNodeIds)

  const node = createPendingResourceNode(command)
  const openPoint = findOpenCanvasPoint(document, command.placement.anchor, getCanvasNodeSize(node))
  let next = addCanvasNodes(document, [{ ...node, position: openPoint }]).document
  if (relation?.mode === "connect") {
    const direction = relation.direction ?? "from-anchor"
    for (const anchorNodeId of anchorNodeIds) {
      next = connectCanvasNodes(
        next,
        direction === "from-anchor"
          ? { source: anchorNodeId, target: command.nodeId }
          : { source: command.nodeId, target: anchorNodeId },
      )
    }
  }
  if (command.type === "resources.pending-generation.create") {
    try {
      next = startCanvasNodeGenerationRun(next, command.nodeId, command.generation)
    } catch (error) {
      return throwGenerationRunValidation(error)
    }
  }
  return result(document, next, [...new Set([...anchorNodeIds, command.nodeId])], [command.nodeId])
}

function failPendingResource(
  document: CanvasDocument,
  command: CanvasFailPendingResourceCommand,
): CanvasBusinessCommandResult {
  requireSafePendingResourceErrorMessage(command.message)
  const target = document.nodes.find((node) => node.id === command.targetNodeId)
  if (!target) throw new CanvasCommandValidationError(`Canvas node was not found: ${command.targetNodeId}`)
  if (target.type !== "file" || !isPendingResourceNode(target)) {
    throw new CanvasCommandValidationError(`Canvas pending resource failure requires a pending file node: ${target.id}`)
  }
  if (!matchesCanvasNodeContentGuard(target, command.expectedTarget)) {
    throw new CanvasCommandValidationError(`Canvas node content changed before pending resource failure: ${target.id}`)
  }

  const next = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === target.id
        ? {
            ...node,
            data: { ...node.data, error: command.message, status: "error" as const },
          }
        : node,
    ),
  }
  return result(document, next, [target.id])
}

function createPendingResourceNode(
  command: CanvasCreatePendingGenerationResourceCommand | CanvasCreatePendingResourceCommand,
): CanvasNode {
  if (command.kind === "text") {
    const node = createTextNode({
      id: command.nodeId,
      label: command.label,
      metadata: {},
      position: command.placement.anchor,
      resourceState: { status: "ready", text: "" },
    })
    return { ...node, data: { ...node.data, status: "pending" } }
  }
  const node = createMediaNode({
    id: command.nodeId,
    label: command.label,
    position: command.placement.anchor,
    resource: {
      id: command.nodeId,
      kind: command.kind,
      metadata: {},
      state: { status: "ready", url: "" },
    },
  })
  return { ...node, data: { ...node.data, status: "pending" } }
}

function isPendingResourceNode(node: CanvasNode) {
  return (
    node.data.status === "pending" &&
    (node.data.kind === "text" ||
      node.data.kind === "image" ||
      node.data.kind === "video" ||
      node.data.kind === "audio")
  )
}

function replaceGeneratedResource(
  document: CanvasDocument,
  command: CanvasReplaceGeneratedResourceCommand,
): CanvasBusinessCommandResult {
  const target = document.nodes.find((node) => node.id === command.targetNodeId)
  if (!target) throw new CanvasCommandValidationError(`Canvas node was not found: ${command.targetNodeId}`)
  if (target.type !== "file" || target.data.kind === "group") {
    throw new CanvasCommandValidationError(`Canvas generated resource replacement requires a file node: ${target.id}`)
  }
  if (!sameGenerationTargetContent(target, command.expectedTarget)) {
    throw new CanvasCommandValidationError(`Canvas generation target changed before resource replacement: ${target.id}`)
  }

  const replacement = createNodeFromResource(command.item, target.id, target.position)
  const targetMetadata = isRecord(target.data.metadata) ? target.data.metadata : {}
  const replacementMetadata = isRecord(replacement.data.metadata) ? structuredClone(replacement.data.metadata) : {}
  delete replacementMetadata[canvasNodeGenerationPreferenceKey]
  delete replacementMetadata[canvasNodeGenerationRunKey]
  if (Object.prototype.hasOwnProperty.call(targetMetadata, canvasNodeGenerationPreferenceKey)) {
    replacementMetadata[canvasNodeGenerationPreferenceKey] = structuredClone(
      targetMetadata[canvasNodeGenerationPreferenceKey],
    )
  }
  if (Object.prototype.hasOwnProperty.call(targetMetadata, canvasNodeGenerationRunKey)) {
    replacementMetadata[canvasNodeGenerationRunKey] = structuredClone(targetMetadata[canvasNodeGenerationRunKey])
  }
  const data = {
    ...replacement.data,
    ...(Object.keys(replacementMetadata).length ? { metadata: replacementMetadata } : {}),
  }
  const replaced = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === target.id
        ? {
            ...node,
            data,
            type: replacement.type,
          }
        : node,
    ),
  }
  try {
    const next = succeedCanvasNodeGenerationRun(replaced, target.id, command.operationId)
    return result(document, next, [target.id])
  } catch (error) {
    return throwGenerationRunValidation(error)
  }
}

function createNodeFromResource(item: CanvasUploadItem, nodeId: string, position: CanvasPoint): CanvasNode {
  if (item.kind === "text") {
    return createTextNode({
      id: nodeId,
      label: item.name ?? "Text",
      metadata: item.metadata,
      mimeType: item.mimeType,
      name: item.name,
      position,
      resourceState: item.state,
    })
  }
  if (item.kind === "folder") return createFolderNode({ id: nodeId, position, resource: item })
  return createMediaNode({ id: nodeId, position, resource: item })
}

function requireUniqueIds(ids: readonly string[], label: string) {
  const unique = new Set<string>()
  for (const id of ids) {
    requireNonEmptyBoundedString(id, label, 256)
    if (unique.has(id)) throw new CanvasCommandValidationError(`${label} must be unique`)
    unique.add(id)
  }
  return [...unique]
}

function requireUniqueElementIds(elements: readonly { id: string }[], label: string) {
  return requireUniqueIds(
    elements.map((element) => element.id),
    label,
  )
}

function requireExistingPatchIds<T>(existing: ReadonlyMap<string, T>, ids: readonly string[], label: string) {
  const missing = ids.find((id) => !existing.has(id))
  if (missing) throw new CanvasCommandValidationError(`${label} was not found: ${missing}`)
}

function requireNewPatchIds<T>(existing: ReadonlyMap<string, T>, ids: readonly string[], label: string) {
  const duplicate = ids.find((id) => existing.has(id))
  if (duplicate) throw new CanvasCommandValidationError(`${label} already exists: ${duplicate}`)
}

function requireDisjointPatchIds(removedIds: readonly string[], updatedIds: readonly string[], label: string) {
  const removed = new Set(removedIds)
  const overlap = updatedIds.find((id) => removed.has(id))
  if (overlap) throw new CanvasCommandValidationError(`${label} cannot be removed and updated: ${overlap}`)
}

function sameGenerationTargetContent(node: CanvasNode, expected: CanvasGenerationTargetGuard) {
  return sameCanvasJson({ data: omitCanvasOwnedGenerationMetadataFromData(node.data), type: node.type }, expected)
}

function omitCanvasOwnedGenerationMetadataFromData(data: CanvasNode["data"]): CanvasNode["data"] {
  const durableData = normalizePendingGenerationData(structuredClone(data))
  const withoutRun = omitCanvasNodeGenerationRunFromData(durableData as CanvasNode["data"])
  const metadata = withoutRun.metadata
  if (!isRecord(metadata)) return withoutRun
  const nextMetadata = { ...structuredClone(metadata) }
  delete nextMetadata[canvasNodeGenerationPreferenceKey]
  if (Object.keys(nextMetadata).length === 0) {
    const { metadata: _metadata, ...withoutMetadata } = withoutRun
    return withoutMetadata as CanvasNode["data"]
  }
  return { ...withoutRun, metadata: nextMetadata }
}

function normalizePendingGenerationData(data: CanvasNode["data"]): CanvasNode["data"] {
  if (data.status !== "pending") return data
  const normalized = { ...data } as CanvasNode["data"] & Record<string, unknown>
  if (isEmptyPendingResourceState(normalized.resourceState)) delete normalized.resourceState
  for (const key of ["durationMs", "height", "mimeType", "name", "width"] as const) {
    if (normalized[key] === null) delete normalized[key]
  }
  return normalized
}

function isEmptyPendingResourceState(value: unknown) {
  if (!isRecord(value) || value.status !== "ready") return false
  if (Object.keys(value).some((key) => key !== "status" && key !== "text" && key !== "url")) return false
  if ("text" in value && value.text !== "") return false
  if ("url" in value && value.url !== "") return false
  return true
}

function applyGenerationRunMutation(
  document: CanvasDocument,
  nodeId: string,
  mutate: () => CanvasDocument,
): CanvasBusinessCommandResult {
  try {
    const next = mutate()
    return result(document, next, next === document ? [] : [nodeId])
  } catch (error) {
    return throwGenerationRunValidation(error)
  }
}

function throwGenerationRunValidation(error: unknown): never {
  if (error instanceof CanvasNodeGenerationRunValidationError) {
    throw new CanvasCommandValidationError(error.message)
  }
  throw error
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

function requireConnectableNodeIds(document: CanvasDocument, nodeIds: readonly string[]) {
  requireNodeIds(document, nodeIds)
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const structural = nodeIds.find((nodeId) => !isCanvasConnectableNode(nodes.get(nodeId)!))
  if (structural) throw new CanvasCommandValidationError(`Canvas structural group is not connectable: ${structural}`)
}

function requireFinitePoint(point: CanvasPoint, label: string) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new CanvasCommandValidationError(`${label} must contain finite coordinates`)
  }
}

function validActor(actor: CanvasCommandActor) {
  return Boolean(actor.id.trim() && actor.kind.trim())
}

function requirePendingResourceKind(kind: unknown): asserts kind is CanvasPendingResourceKind {
  if (kind !== "text" && kind !== "image" && kind !== "video" && kind !== "audio") {
    throw new CanvasCommandValidationError(`Unsupported pending resource kind: ${String(kind)}`)
  }
}

function requireNonEmptyBoundedString(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new CanvasCommandValidationError(`${label} is required`)
  if (value.length > maxLength) throw new CanvasCommandValidationError(`${label} exceeds ${maxLength} characters`)
}

function requireSafePendingResourceErrorMessage(message: unknown): asserts message is string {
  requireNonEmptyBoundedString(message, "Pending resource error message", 500)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)) {
    throw new CanvasCommandValidationError("Pending resource error message contains unsupported control characters")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
