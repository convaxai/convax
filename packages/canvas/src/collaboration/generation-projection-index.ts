import { comparePortableStamps, compareUtf8 } from "@convax/collaboration"
import type {
  CanvasProjectedNode,
  CanvasSnapshot,
  GenerationBeginV2,
  NodeDataEnvelope,
  StampedClaim,
} from "./types"
import { canvasEntityKey } from "./validation"

type GenerationLifecycle = CanvasProjectedNode["generationLifecycle"]

interface IndexedGeneration {
  readonly begin: GenerationBeginV2
  readonly lifecycle: Exclude<GenerationLifecycle, "none">
  readonly outputClaim: StampedClaim<NodeDataEnvelope> | null
}

interface GenerationNode {
  readonly key: string
  readonly value: IndexedGeneration
  readonly left: GenerationNode | null
  readonly right: GenerationNode | null
  readonly height: number
  readonly latestLifecycle: IndexedGeneration
  readonly winningOutput: IndexedGeneration | null
}

interface NodeGenerationNode {
  readonly key: string
  readonly generations: GenerationNode
  readonly left: NodeGenerationNode | null
  readonly right: NodeGenerationNode | null
  readonly height: number
}

interface CanvasGenerationProjectionIndex {
  readonly nodes: NodeGenerationNode | null
}

const indexesBySnapshot = new WeakMap<CanvasSnapshot, CanvasGenerationProjectionIndex>()
let fullBuilds = 0
let historicalGenerationVisits = 0
let keyedNodeReads = 0
let incrementalGenerationUpdates = 0
let pathCopies = 0
let nodeLocalGenerationVisits = 0

/**
 * Cold-builds the generation projection once for one fully validated immutable
 * snapshot. Accepted successors are installed by path-copying only the changed
 * generation and its owning node.
 */
export function buildCanvasGenerationProjectionIndex(snapshot: CanvasSnapshot): void {
  if (indexesBySnapshot.has(snapshot)) return
  fullBuilds += 1
  let nodes: NodeGenerationNode | null = null
  for (const begin of snapshot.generationBegins.values()) {
    historicalGenerationVisits += 1
    nodes = setNodeGeneration(nodes, canvasEntityKey(begin.node), generationState(snapshot, begin))
  }
  indexesBySnapshot.set(snapshot, Object.freeze({ nodes }))
}

/**
 * Binds an accepted successor to the base snapshot's persistent index. Empty
 * `generationIds` is an O(1) identity share (the Add Text path); generation
 * lifecycle writes path-copy O(k log G) without enumerating historical runs.
 */
export function installCanvasGenerationProjectionIndex(
  base: CanvasSnapshot,
  snapshot: CanvasSnapshot,
  generationIds: readonly string[],
): void {
  if (indexesBySnapshot.has(snapshot)) return
  buildCanvasGenerationProjectionIndex(base)
  let nodes = indexesBySnapshot.get(base)!.nodes
  const uniqueIds = [...new Set(generationIds)].sort(compareUtf8)
  for (const generationId of uniqueIds) {
    const begin = snapshot.generationBegins.get(generationId)
    if (!begin) throw new TypeError(`Canvas generation index is missing begin ${generationId}`)
    nodes = setNodeGeneration(nodes, canvasEntityKey(begin.node), generationState(snapshot, begin))
    incrementalGenerationUpdates += 1
  }
  indexesBySnapshot.set(snapshot, Object.freeze({ nodes }))
}

export function canvasEffectiveGenerationForNode(
  snapshot: CanvasSnapshot,
  nodeKey: string,
): Readonly<{
  lifecycle: GenerationLifecycle
  winningOutput: Readonly<{ claim: StampedClaim<NodeDataEnvelope>; begin: GenerationBeginV2 }> | null
}> {
  buildCanvasGenerationProjectionIndex(snapshot)
  keyedNodeReads += 1
  const node = findNode(indexesBySnapshot.get(snapshot)!.nodes, nodeKey)
  if (!node) return EMPTY_EFFECTIVE_GENERATION
  const output = node.generations.winningOutput
  return Object.freeze({
    lifecycle: node.generations.latestLifecycle.lifecycle,
    winningOutput: output?.outputClaim
      ? Object.freeze({ claim: output.outputClaim, begin: output.begin })
      : null,
  })
}

export function canvasGenerationIdsForNode(snapshot: CanvasSnapshot, nodeKey: string): readonly string[] {
  buildCanvasGenerationProjectionIndex(snapshot)
  keyedNodeReads += 1
  const node = findNode(indexesBySnapshot.get(snapshot)!.nodes, nodeKey)
  if (!node) return Object.freeze([])
  const ids: string[] = []
  collectGenerationIds(node.generations, ids)
  return Object.freeze(ids)
}

/** Package-private structural evidence; never enters owner state or protocol bytes. */
export function canvasGenerationProjectionWorkCounts(): Readonly<{
  fullBuilds: number
  historicalGenerationVisits: number
  keyedNodeReads: number
  incrementalGenerationUpdates: number
  pathCopies: number
  nodeLocalGenerationVisits: number
}> {
  return Object.freeze({
    fullBuilds,
    historicalGenerationVisits,
    keyedNodeReads,
    incrementalGenerationUpdates,
    pathCopies,
    nodeLocalGenerationVisits,
  })
}

const EMPTY_EFFECTIVE_GENERATION = Object.freeze({
  lifecycle: "none" as const,
  winningOutput: null,
})

function generationState(snapshot: CanvasSnapshot, begin: GenerationBeginV2): IndexedGeneration {
  const dismissal = snapshot.generationDismissals.get(begin.generationId)
  const terminal = snapshot.generationTerminals.get(`${begin.generationId}/owner/${begin.beginActorId}`)
  const recovery = snapshot.generationRecoveryFailures.get(begin.generationId)
  const lifecycle: IndexedGeneration["lifecycle"] =
    dismissal !== undefined
      ? "dismissed"
      : terminal?.phase === "succeeded"
        ? "succeeded"
        : terminal?.phase === "failed"
          ? "failed"
          : recovery !== undefined
            ? "recovery-failed"
            : "active"
  const outputClaim = dismissal === undefined && terminal?.phase === "succeeded"
    ? Object.freeze({
        format: "convax.canvas-stamped-claim" as const,
        stamp: begin.outputClaimStamp,
        value: terminal.outputData,
      })
    : null
  return Object.freeze({ begin, lifecycle, outputClaim })
}

function generationHeight(node: GenerationNode | null): number {
  return node?.height ?? 0
}

function createGenerationNode(
  key: string,
  value: IndexedGeneration,
  left: GenerationNode | null,
  right: GenerationNode | null,
): GenerationNode {
  pathCopies += 1
  const candidates = [left?.latestLifecycle, value, right?.latestLifecycle].filter(
    (candidate): candidate is IndexedGeneration => candidate !== undefined,
  )
  const latestLifecycle = candidates.reduce(laterLifecycle)
  const outputs = [left?.winningOutput, value.outputClaim ? value : null, right?.winningOutput].filter(
    (candidate): candidate is IndexedGeneration => candidate !== null && candidate !== undefined,
  )
  const winningOutput = outputs.length === 0 ? null : outputs.reduce(laterOutput)
  return Object.freeze({
    key,
    value,
    left,
    right,
    height: 1 + Math.max(generationHeight(left), generationHeight(right)),
    latestLifecycle,
    winningOutput,
  })
}

function laterLifecycle(left: IndexedGeneration, right: IndexedGeneration): IndexedGeneration {
  const order = comparePortableStamps(left.begin.beginStamp, right.begin.beginStamp)
  if (order !== 0) return order < 0 ? right : left
  return compareUtf8(left.begin.generationId, right.begin.generationId) < 0 ? left : right
}

function laterOutput(left: IndexedGeneration, right: IndexedGeneration): IndexedGeneration {
  const order = comparePortableStamps(left.outputClaim!.stamp, right.outputClaim!.stamp)
  if (order !== 0) return order < 0 ? right : left
  return compareUtf8(left.begin.generationId, right.begin.generationId) < 0 ? left : right
}

function setGeneration(root: GenerationNode | null, value: IndexedGeneration): GenerationNode {
  if (!root) return createGenerationNode(value.begin.generationId, value, null, null)
  const order = compareUtf8(value.begin.generationId, root.key)
  if (order === 0) return createGenerationNode(root.key, value, root.left, root.right)
  const updated = order < 0
    ? createGenerationNode(root.key, root.value, setGeneration(root.left, value), root.right)
    : createGenerationNode(root.key, root.value, root.left, setGeneration(root.right, value))
  return balanceGeneration(updated)
}

function balanceGeneration(root: GenerationNode): GenerationNode {
  const skew = generationHeight(root.left) - generationHeight(root.right)
  if (skew > 1) {
    const left = root.left!
    if (generationHeight(left.left) < generationHeight(left.right))
      return rotateGenerationRight(createGenerationNode(root.key, root.value, rotateGenerationLeft(left), root.right))
    return rotateGenerationRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (generationHeight(right.right) < generationHeight(right.left))
      return rotateGenerationLeft(createGenerationNode(root.key, root.value, root.left, rotateGenerationRight(right)))
    return rotateGenerationLeft(root)
  }
  return root
}

function rotateGenerationLeft(root: GenerationNode): GenerationNode {
  const pivot = root.right!
  return createGenerationNode(
    pivot.key,
    pivot.value,
    createGenerationNode(root.key, root.value, root.left, pivot.left),
    pivot.right,
  )
}

function rotateGenerationRight(root: GenerationNode): GenerationNode {
  const pivot = root.left!
  return createGenerationNode(
    pivot.key,
    pivot.value,
    pivot.left,
    createGenerationNode(root.key, root.value, pivot.right, root.right),
  )
}

function nodeHeight(node: NodeGenerationNode | null): number {
  return node?.height ?? 0
}

function createNodeGenerationNode(
  key: string,
  generations: GenerationNode,
  left: NodeGenerationNode | null,
  right: NodeGenerationNode | null,
): NodeGenerationNode {
  pathCopies += 1
  return Object.freeze({ key, generations, left, right, height: 1 + Math.max(nodeHeight(left), nodeHeight(right)) })
}

function setNodeGeneration(
  root: NodeGenerationNode | null,
  nodeKey: string,
  generation: IndexedGeneration,
): NodeGenerationNode {
  if (!root) return createNodeGenerationNode(nodeKey, setGeneration(null, generation), null, null)
  const order = compareUtf8(nodeKey, root.key)
  if (order === 0)
    return createNodeGenerationNode(root.key, setGeneration(root.generations, generation), root.left, root.right)
  const updated = order < 0
    ? createNodeGenerationNode(root.key, root.generations, setNodeGeneration(root.left, nodeKey, generation), root.right)
    : createNodeGenerationNode(root.key, root.generations, root.left, setNodeGeneration(root.right, nodeKey, generation))
  return balanceNode(updated)
}

function balanceNode(root: NodeGenerationNode): NodeGenerationNode {
  const skew = nodeHeight(root.left) - nodeHeight(root.right)
  if (skew > 1) {
    const left = root.left!
    if (nodeHeight(left.left) < nodeHeight(left.right))
      return rotateNodeRight(createNodeGenerationNode(root.key, root.generations, rotateNodeLeft(left), root.right))
    return rotateNodeRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (nodeHeight(right.right) < nodeHeight(right.left))
      return rotateNodeLeft(createNodeGenerationNode(root.key, root.generations, root.left, rotateNodeRight(right)))
    return rotateNodeLeft(root)
  }
  return root
}

function rotateNodeLeft(root: NodeGenerationNode): NodeGenerationNode {
  const pivot = root.right!
  return createNodeGenerationNode(
    pivot.key,
    pivot.generations,
    createNodeGenerationNode(root.key, root.generations, root.left, pivot.left),
    pivot.right,
  )
}

function rotateNodeRight(root: NodeGenerationNode): NodeGenerationNode {
  const pivot = root.left!
  return createNodeGenerationNode(
    pivot.key,
    pivot.generations,
    pivot.left,
    createNodeGenerationNode(root.key, root.generations, pivot.right, root.right),
  )
}

function findNode(root: NodeGenerationNode | null, key: string): NodeGenerationNode | null {
  let current = root
  while (current) {
    const order = compareUtf8(key, current.key)
    if (order === 0) return current
    current = order < 0 ? current.left : current.right
  }
  return null
}

function collectGenerationIds(root: GenerationNode | null, ids: string[]): void {
  if (!root) return
  collectGenerationIds(root.left, ids)
  nodeLocalGenerationVisits += 1
  ids.push(root.key)
  collectGenerationIds(root.right, ids)
}
