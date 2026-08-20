import { getCanvasNodePresentationSize } from "./document"
import type { CanvasDocument, CanvasPoint, CanvasSize } from "./types"

export interface CanvasPlacementObstacle extends CanvasPoint, CanvasSize {}

export interface CanvasIndexedPlacementObstacle extends CanvasPlacementObstacle {
  readonly key: string
}

interface CanvasPlacementIntervalNode {
  readonly maxBottom: number
  readonly height: number
  readonly left: CanvasPlacementIntervalNode | null
  readonly maxRight: number
  readonly minLeft: number
  readonly minTop: number
  readonly obstacle: CanvasIndexedPlacementObstacle
  readonly right: CanvasPlacementIntervalNode | null
}

interface CanvasPlacementRowBucket {
  readonly head: CanvasPlacementRowEntry | null
  readonly maxRight: number
  readonly size: number
}

interface CanvasPlacementRowEntry {
  readonly obstacle: CanvasIndexedPlacementObstacle
  readonly previous: CanvasPlacementRowEntry | null
}

interface CanvasPlacementRowNode {
  readonly bucket: CanvasPlacementRowBucket
  readonly height: number
  readonly key: number
  readonly left: CanvasPlacementRowNode | null
  readonly right: CanvasPlacementRowNode | null
}

declare const canvasPlacementIndexBrand: unique symbol

/** Immutable, appendable view index. Its values never authorize a Canvas mutation. */
export interface CanvasPlacementIndex {
  readonly [canvasPlacementIndexBrand]: true
  readonly root: CanvasPlacementIntervalNode | null
  readonly rows: CanvasPlacementRowNode | null
  readonly size: number
}

const canvasDocumentPlacementIndexes = new WeakMap<CanvasDocument, Map<string, CanvasPlacementIndex>>()
const issuedCanvasPlacementIndexes = new WeakSet<object>()
let fullObstacleTraversals = 0
let optimisticFullNodeVisits = 0
let obstacleSortComparisons = 0
let spatialQueryVisits = 0
let viewportQueryVisits = 0
const CANVAS_PLACEMENT_ROW_HEIGHT = 256
const CANVAS_PLACEMENT_MAX_QUERY_ROWS = 64
const CANVAS_PLACEMENT_ROW_CANDIDATE_LIMIT = 512

/** Structural evidence only; counters never enter reducer output or protocol bytes. */
export function canvasPlacementWorkCounts() {
  return Object.freeze({
    fullObstacleTraversals,
    obstacleSortComparisons,
    optimisticFullNodeVisits,
    spatialQueryVisits,
    viewportQueryVisits,
  })
}

export function createCanvasPlacementIndex(
  obstacles: readonly CanvasIndexedPlacementObstacle[],
  source: "owner" | "optimistic" = "owner",
): CanvasPlacementIndex {
  fullObstacleTraversals += obstacles.length
  if (source === "optimistic") optimisticFullNodeVisits += obstacles.length
  let root: CanvasPlacementIntervalNode | null = null
  let rows: CanvasPlacementRowNode | null = null
  for (const obstacle of obstacles) {
    if (!obstacle.key || !finiteRect(obstacle)) throw new TypeError("Canvas placement obstacle is invalid")
    const owned = Object.freeze({ ...obstacle })
    root = insertPlacementInterval(root, owned)
    rows = appendPlacementRows(rows, owned)
  }
  return issueCanvasPlacementIndex(root, rows, obstacles.length)
}

export function appendCanvasPlacementIndex(
  index: CanvasPlacementIndex,
  obstacles: readonly CanvasIndexedPlacementObstacle[],
): CanvasPlacementIndex {
  requireIssuedCanvasPlacementIndex(index)
  let root = index.root
  let rows = index.rows
  for (const obstacle of obstacles) {
    if (!obstacle.key || !finiteRect(obstacle)) throw new TypeError("Canvas placement obstacle is invalid")
    const owned = Object.freeze({ ...obstacle })
    root = insertPlacementInterval(root, owned)
    rows = appendPlacementRows(rows, owned)
  }
  return issueCanvasPlacementIndex(root, rows, index.size + obstacles.length)
}

function issueCanvasPlacementIndex(
  root: CanvasPlacementIntervalNode | null,
  rows: CanvasPlacementRowNode | null,
  size: number,
): CanvasPlacementIndex {
  const index = Object.freeze({ root, rows, size }) as CanvasPlacementIndex
  issuedCanvasPlacementIndexes.add(index)
  return index
}

function requireIssuedCanvasPlacementIndex(index: CanvasPlacementIndex): void {
  if (!issuedCanvasPlacementIndexes.has(index)) throw new TypeError("Canvas placement index is not owner-issued")
}

/**
 * Returns the exact immutable-document view index. A cold projection is built
 * once; ordinary accepted appends install the next snapshot by path-copying.
 */
export function canvasDocumentPlacementIndex(
  document: CanvasDocument,
  parentId?: string,
): CanvasPlacementIndex {
  const scopeKey = parentId ?? ""
  const cached = canvasDocumentPlacementIndexes.get(document)?.get(scopeKey)
  if (cached) return cached
  const obstacles: CanvasIndexedPlacementObstacle[] = []
  for (const node of document.nodes) {
    optimisticFullNodeVisits += 1
    if (node.parentId !== parentId) continue
    obstacles.push({ key: node.id, ...node.position, ...getCanvasNodePresentationSize(node) })
  }
  // Node visits are already counted above; do not count the filtered set twice.
  const before = fullObstacleTraversals
  const index = createCanvasPlacementIndex(obstacles, "owner")
  fullObstacleTraversals = before + document.nodes.length
  const byScope = canvasDocumentPlacementIndexes.get(document) ?? new Map<string, CanvasPlacementIndex>()
  byScope.set(scopeKey, index)
  canvasDocumentPlacementIndexes.set(document, byScope)
  return index
}

/**
 * Builds every parent scope during the explicit cold projection pass. A later
 * optimistic create in a focused Group must never discover a missing scope by
 * scanning the complete Canvas from an input event.
 */
export function primeCanvasDocumentPlacementIndexes(document: CanvasDocument): ReadonlyMap<string, CanvasPlacementIndex> {
  const current = canvasDocumentPlacementIndexes.get(document)
  if (current) return current
  const obstaclesByScope = new Map<string, CanvasIndexedPlacementObstacle[]>()
  obstaclesByScope.set("", [])
  for (const node of document.nodes) {
    optimisticFullNodeVisits += 1
    const scopeKey = node.parentId ?? ""
    const obstacles = obstaclesByScope.get(scopeKey) ?? []
    obstacles.push({ key: node.id, ...node.position, ...getCanvasNodePresentationSize(node) })
    obstaclesByScope.set(scopeKey, obstacles)
  }
  const indexes = new Map<string, CanvasPlacementIndex>()
  for (const [scopeKey, obstacles] of obstaclesByScope) {
    indexes.set(scopeKey, createCanvasPlacementIndex(obstacles, "owner"))
  }
  canvasDocumentPlacementIndexes.set(document, indexes)
  return indexes
}

export interface CanvasPlacementViewportRect {
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

/**
 * Bounded renderer-only range query over one parent scope. The augmented AVL
 * prunes by the complete subtree rectangle and returns at most `limit` keys.
 */
export function queryCanvasPlacementViewport(
  index: CanvasPlacementIndex,
  rect: CanvasPlacementViewportRect,
  limit: number,
): readonly string[] {
  requireIssuedCanvasPlacementIndex(index)
  if (!finiteRect(rect) || !Number.isSafeInteger(limit) || limit < 1 || limit > 512) {
    throw new TypeError("Canvas placement viewport query is invalid")
  }
  const rowCandidates = queryPlacementRows(index.rows, rect.y, rect.y + rect.height, "viewport")
  if (rowCandidates) {
    const result: string[] = []
    for (const obstacle of rowCandidates) {
      if (result.length >= limit) break
      if (intersectsViewport(rect, obstacle)) result.push(obstacle.key)
    }
    return Object.freeze(result)
  }
  const result: string[] = []
  queryPlacementViewport(index.root, rect, limit, result)
  return Object.freeze(result)
}

/** Package-private owner projection hook; the issued index is structural and cannot be caller-forged. */
export function bindCanvasDocumentPlacementIndex(
  document: CanvasDocument,
  index: CanvasPlacementIndex,
  parentId?: string,
): void {
  requireIssuedCanvasPlacementIndex(index)
  const scopeKey = parentId ?? ""
  const byScope = canvasDocumentPlacementIndexes.get(document) ?? new Map<string, CanvasPlacementIndex>()
  byScope.set(scopeKey, index)
  canvasDocumentPlacementIndexes.set(document, byScope)
}

/**
 * Package-private hot presentation hook. The caller must already hold exact
 * certified append entities; this cache never authorizes owner placement.
 */
export function appendCanvasDocumentPlacementObstacles(
  document: CanvasDocument,
  obstacles: readonly CanvasIndexedPlacementObstacle[],
  parentId?: string,
): boolean {
  const scopeKey = parentId ?? ""
  const current = canvasDocumentPlacementIndexes.get(document)?.get(scopeKey)
  if (!current) return false
  const next = appendCanvasPlacementIndex(current, obstacles)
  const byScope = canvasDocumentPlacementIndexes.get(document) ?? new Map<string, CanvasPlacementIndex>()
  byScope.set(scopeKey, next)
  canvasDocumentPlacementIndexes.set(document, byScope)
  return true
}

/** Package-private transfer used after an explicit full presentation reconcile. */
export function transferCanvasDocumentPlacementIndex(
  source: CanvasDocument,
  target: CanvasDocument,
  parentId?: string,
): boolean {
  if (source.id !== target.id) return false
  const scopeKey = parentId ?? ""
  const current = canvasDocumentPlacementIndexes.get(source)?.get(scopeKey)
  if (!current) return false
  bindCanvasDocumentPlacementIndex(target, current, parentId)
  return true
}

/**
 * Installs only a provable append-shaped authoritative replacement. A mismatch
 * simply leaves the next snapshot cold; cache state never changes placement
 * authority or reducer behavior.
 */
export function installCanvasDocumentPlacementAppend(input: {
  base: CanvasDocument
  next: CanvasDocument
  obstacles: readonly CanvasIndexedPlacementObstacle[]
  parentId?: string
}): boolean {
  if (input.base.id !== input.next.id || input.next.nodes.length !== input.base.nodes.length + input.obstacles.length) {
    return false
  }
  const scopeKey = input.parentId ?? ""
  const baseIndex = canvasDocumentPlacementIndexes.get(input.base)?.get(scopeKey)
  if (!baseIndex) return false
  const nextIndex = appendCanvasPlacementIndex(baseIndex, input.obstacles)
  const byScope = canvasDocumentPlacementIndexes.get(input.next) ?? new Map<string, CanvasPlacementIndex>()
  byScope.set(scopeKey, nextIndex)
  canvasDocumentPlacementIndexes.set(input.next, byScope)
  return true
}

/**
 * Resolves the deterministic top-level resource placement shared by the
 * authoritative reducer and presentation-only ghosts.
 *
 * Every item starts at the same anchor and moves only along the positive X axis
 * until it clears the current Canvas obstacles and the items placed before it.
 */
export function resolveCanvasResourcePlacements(input: {
  anchor: CanvasPoint
  gap?: number
  obstacles: readonly CanvasPlacementObstacle[]
  sizes: readonly CanvasSize[]
}): readonly CanvasPoint[] | null {
  const gap = input.gap ?? 24
  if (
    !finitePoint(input.anchor) ||
    !Number.isFinite(gap) ||
    gap < 0 ||
    input.obstacles.some((obstacle) => !finiteRect(obstacle)) ||
    input.sizes.some((size) => !finiteSize(size))
  ) {
    return null
  }

  fullObstacleTraversals += input.obstacles.length
  const obstacles = input.obstacles.map((obstacle) => ({ ...obstacle }))
  const positions: CanvasPoint[] = []
  for (const size of input.sizes) {
    const laneRight = placementLaneMaxRightFromObstacles(obstacles, input.anchor.y, size.height, gap)
    const position = {
      x: Math.max(input.anchor.x, laneRight === undefined ? input.anchor.x : laneRight + gap),
      y: input.anchor.y,
    }
    if (!Number.isFinite(position.x) || position.x > 10_000_000) return null
    obstacles.push({ ...position, ...size })
    positions.push(position)
  }
  return Object.freeze(positions.map((position) => Object.freeze(position)))
}

/** Indexed equivalent used by exact-base owner placement and renderer ghosts. */
export function resolveIndexedCanvasResourcePlacements(input: {
  anchor: CanvasPoint
  gap?: number
  index: CanvasPlacementIndex
  sizes: readonly CanvasSize[]
}): readonly CanvasPoint[] | null {
  requireIssuedCanvasPlacementIndex(input.index)
  const gap = input.gap ?? 24
  if (!finitePoint(input.anchor) || !Number.isFinite(gap) || gap < 0 || input.sizes.some((size) => !finiteSize(size))) {
    return null
  }
  const localObstacles: CanvasPlacementObstacle[] = []
  const positions: CanvasPoint[] = []
  for (const size of input.sizes) {
    const indexedRight = placementLaneMaxRight(input.index, input.anchor.y, size.height, gap)
    const localRight = placementLaneMaxRightFromObstacles(localObstacles, input.anchor.y, size.height, gap)
    const laneRight = Math.max(indexedRight ?? -Infinity, localRight ?? -Infinity)
    const position = {
      x: Math.max(input.anchor.x, laneRight === -Infinity ? input.anchor.x : laneRight + gap),
      y: input.anchor.y,
    }
    if (!Number.isFinite(position.x) || position.x > 10_000_000) return null
    localObstacles.push({ ...position, ...size })
    positions.push(Object.freeze(position))
  }
  return Object.freeze(positions)
}

/**
 * Current-genesis placement is one conservative positive-X high-watermark
 * lane. A create reads only the constant number of Y rows it covers and jumps
 * once beyond their furthest obstacle; it never walks a collision chain.
 */
function placementLaneMaxRight(
  index: CanvasPlacementIndex,
  y: number,
  height: number,
  gap: number,
): number | undefined {
  const firstRow = Math.floor((y - gap) / CANVAS_PLACEMENT_ROW_HEIGHT)
  const lastRow = Math.ceil((y + height + gap) / CANVAS_PLACEMENT_ROW_HEIGHT) - 1
  if (lastRow < firstRow) return undefined
  if (lastRow - firstRow + 1 > CANVAS_PLACEMENT_MAX_QUERY_ROWS) {
    spatialQueryVisits += index.root ? 1 : 0
    return index.root?.maxRight
  }
  let maxRight: number | undefined
  for (let row = firstRow; row <= lastRow; row += 1) {
    const bucket = findPlacementRow(index.rows, row, "spatial")
    if (bucket) maxRight = Math.max(maxRight ?? -Infinity, bucket.maxRight)
  }
  return maxRight
}

function placementLaneMaxRightFromObstacles(
  obstacles: readonly CanvasPlacementObstacle[],
  y: number,
  height: number,
  gap: number,
): number | undefined {
  const firstRow = Math.floor((y - gap) / CANVAS_PLACEMENT_ROW_HEIGHT)
  const lastRow = Math.ceil((y + height + gap) / CANVAS_PLACEMENT_ROW_HEIGHT) - 1
  let maxRight: number | undefined
  for (const obstacle of obstacles) {
    const obstacleFirstRow = Math.floor(obstacle.y / CANVAS_PLACEMENT_ROW_HEIGHT)
    const obstacleLastRow = Math.ceil((obstacle.y + obstacle.height) / CANVAS_PLACEMENT_ROW_HEIGHT) - 1
    if (obstacleLastRow < firstRow || obstacleFirstRow > lastRow) continue
    maxRight = Math.max(maxRight ?? -Infinity, obstacle.x + obstacle.width)
  }
  return maxRight
}

function appendPlacementRows(
  root: CanvasPlacementRowNode | null,
  obstacle: CanvasIndexedPlacementObstacle,
): CanvasPlacementRowNode | null {
  const firstRow = Math.floor(obstacle.y / CANVAS_PLACEMENT_ROW_HEIGHT)
  const lastRow = Math.ceil((obstacle.y + obstacle.height) / CANVAS_PLACEMENT_ROW_HEIGHT) - 1
  let next = root
  for (let row = firstRow; row <= lastRow; row += 1) {
    const current = findPlacementRow(next, row)
    const bucket = Object.freeze({
      head: Object.freeze({ obstacle, previous: current?.head ?? null }),
      maxRight: Math.max(current?.maxRight ?? -Infinity, obstacle.x + obstacle.width),
      size: (current?.size ?? 0) + 1,
    })
    next = setPlacementRow(next, row, bucket)
  }
  return next
}

function placementRowHeight(node: CanvasPlacementRowNode | null) {
  return node?.height ?? 0
}

function createPlacementRowNode(
  key: number,
  bucket: CanvasPlacementRowBucket,
  left: CanvasPlacementRowNode | null,
  right: CanvasPlacementRowNode | null,
): CanvasPlacementRowNode {
  return Object.freeze({ key, bucket, left, right, height: 1 + Math.max(placementRowHeight(left), placementRowHeight(right)) })
}

function findPlacementRow(
  root: CanvasPlacementRowNode | null,
  key: number,
  counter?: "spatial" | "viewport",
): CanvasPlacementRowBucket | undefined {
  let current = root
  while (current) {
    if (counter === "spatial") spatialQueryVisits += 1
    else if (counter === "viewport") viewportQueryVisits += 1
    if (key === current.key) return current.bucket
    current = key < current.key ? current.left : current.right
  }
  return undefined
}

function setPlacementRow(
  root: CanvasPlacementRowNode | null,
  key: number,
  bucket: CanvasPlacementRowBucket,
): CanvasPlacementRowNode {
  if (!root) return createPlacementRowNode(key, bucket, null, null)
  if (key === root.key) return createPlacementRowNode(key, bucket, root.left, root.right)
  const inserted = key < root.key
    ? createPlacementRowNode(root.key, root.bucket, setPlacementRow(root.left, key, bucket), root.right)
    : createPlacementRowNode(root.key, root.bucket, root.left, setPlacementRow(root.right, key, bucket))
  return balancePlacementRow(inserted)
}

function balancePlacementRow(root: CanvasPlacementRowNode): CanvasPlacementRowNode {
  const skew = placementRowHeight(root.left) - placementRowHeight(root.right)
  if (skew > 1) {
    const left = root.left!
    if (placementRowHeight(left.left) < placementRowHeight(left.right)) {
      return rotatePlacementRowRight(
        createPlacementRowNode(root.key, root.bucket, rotatePlacementRowLeft(left), root.right),
      )
    }
    return rotatePlacementRowRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (placementRowHeight(right.right) < placementRowHeight(right.left)) {
      return rotatePlacementRowLeft(
        createPlacementRowNode(root.key, root.bucket, root.left, rotatePlacementRowRight(right)),
      )
    }
    return rotatePlacementRowLeft(root)
  }
  return root
}

function rotatePlacementRowLeft(root: CanvasPlacementRowNode): CanvasPlacementRowNode {
  const pivot = root.right!
  return createPlacementRowNode(
    pivot.key,
    pivot.bucket,
    createPlacementRowNode(root.key, root.bucket, root.left, pivot.left),
    pivot.right,
  )
}

function rotatePlacementRowRight(root: CanvasPlacementRowNode): CanvasPlacementRowNode {
  const pivot = root.left!
  return createPlacementRowNode(
    pivot.key,
    pivot.bucket,
    pivot.left,
    createPlacementRowNode(root.key, root.bucket, pivot.right, root.right),
  )
}

function placementIntervalHeight(node: CanvasPlacementIntervalNode | null) {
  return node?.height ?? 0
}

function createPlacementIntervalNode(
  obstacle: CanvasIndexedPlacementObstacle,
  left: CanvasPlacementIntervalNode | null,
  right: CanvasPlacementIntervalNode | null,
): CanvasPlacementIntervalNode {
  return Object.freeze({
    obstacle,
    left,
    right,
    height: 1 + Math.max(placementIntervalHeight(left), placementIntervalHeight(right)),
    minLeft: Math.min(obstacle.x, left?.minLeft ?? Infinity, right?.minLeft ?? Infinity),
    maxRight: Math.max(obstacle.x + obstacle.width, left?.maxRight ?? -Infinity, right?.maxRight ?? -Infinity),
    minTop: Math.min(obstacle.y, left?.minTop ?? Infinity, right?.minTop ?? Infinity),
    maxBottom: Math.max(
      obstacle.y + obstacle.height,
      left?.maxBottom ?? -Infinity,
      right?.maxBottom ?? -Infinity,
    ),
  })
}

function comparePlacementObstacle(left: CanvasIndexedPlacementObstacle, right: CanvasIndexedPlacementObstacle) {
  return left.x - right.x || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
}

function insertPlacementInterval(
  root: CanvasPlacementIntervalNode | null,
  obstacle: CanvasIndexedPlacementObstacle,
): CanvasPlacementIntervalNode {
  if (!root) return createPlacementIntervalNode(obstacle, null, null)
  const order = comparePlacementObstacle(obstacle, root.obstacle)
  if (order === 0) throw new TypeError(`Canvas placement obstacle key is duplicated: ${obstacle.key}`)
  const inserted =
    order < 0
      ? createPlacementIntervalNode(root.obstacle, insertPlacementInterval(root.left, obstacle), root.right)
      : createPlacementIntervalNode(root.obstacle, root.left, insertPlacementInterval(root.right, obstacle))
  return balancePlacementInterval(inserted)
}

function balancePlacementInterval(root: CanvasPlacementIntervalNode): CanvasPlacementIntervalNode {
  const skew = placementIntervalHeight(root.left) - placementIntervalHeight(root.right)
  if (skew > 1) {
    const left = root.left!
    if (placementIntervalHeight(left.left) < placementIntervalHeight(left.right)) {
      return rotatePlacementRight(
        createPlacementIntervalNode(root.obstacle, rotatePlacementLeft(left), root.right),
      )
    }
    return rotatePlacementRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (placementIntervalHeight(right.right) < placementIntervalHeight(right.left)) {
      return rotatePlacementLeft(
        createPlacementIntervalNode(root.obstacle, root.left, rotatePlacementRight(right)),
      )
    }
    return rotatePlacementLeft(root)
  }
  return root
}

function rotatePlacementLeft(root: CanvasPlacementIntervalNode): CanvasPlacementIntervalNode {
  const pivot = root.right!
  return createPlacementIntervalNode(
    pivot.obstacle,
    createPlacementIntervalNode(root.obstacle, root.left, pivot.left),
    pivot.right,
  )
}

function rotatePlacementRight(root: CanvasPlacementIntervalNode): CanvasPlacementIntervalNode {
  const pivot = root.left!
  return createPlacementIntervalNode(
    pivot.obstacle,
    pivot.left,
    createPlacementIntervalNode(root.obstacle, pivot.right, root.right),
  )
}

function queryPlacementIntervals(
  root: CanvasPlacementIntervalNode | null,
  position: CanvasPoint,
  size: CanvasSize,
  gap: number,
  result: CanvasPlacementObstacle[],
): void {
  if (
    !root ||
    root.maxRight + gap <= position.x ||
    root.minLeft >= position.x + size.width + gap ||
    root.maxBottom + gap <= position.y ||
    root.minTop >= position.y + size.height + gap
  ) return
  spatialQueryVisits += 1
  if (root.left && root.left.maxRight + gap > position.x) {
    queryPlacementIntervals(root.left, position, size, gap, result)
  }
  if (root.obstacle.x < position.x + size.width + gap && intersectsWithGap(position, size, root.obstacle, gap)) {
    result.push(root.obstacle)
  }
  if (root.obstacle.x < position.x + size.width + gap) {
    queryPlacementIntervals(root.right, position, size, gap, result)
  }
}

function queryPlacementIndex(
  index: CanvasPlacementIndex,
  position: CanvasPoint,
  size: CanvasSize,
  gap: number,
  result: CanvasPlacementObstacle[],
) {
  const rowCandidates = queryPlacementRows(
    index.rows,
    position.y - gap,
    position.y + size.height + gap,
    "spatial",
  )
  if (rowCandidates) {
    for (const obstacle of rowCandidates) {
      if (intersectsWithGap(position, size, obstacle, gap)) result.push(obstacle)
    }
    return
  }
  queryPlacementIntervals(index.root, position, size, gap, result)
}

function queryPlacementRows(
  rows: CanvasPlacementRowNode | null,
  minY: number,
  maxY: number,
  counter: "spatial" | "viewport",
): readonly CanvasIndexedPlacementObstacle[] | null {
  const firstRow = Math.floor(minY / CANVAS_PLACEMENT_ROW_HEIGHT)
  const lastRow = Math.ceil(maxY / CANVAS_PLACEMENT_ROW_HEIGHT) - 1
  if (lastRow < firstRow || lastRow - firstRow + 1 > CANVAS_PLACEMENT_MAX_QUERY_ROWS) return null
  const buckets: CanvasPlacementRowBucket[] = []
  let candidateCount = 0
  for (let row = firstRow; row <= lastRow; row += 1) {
    const bucket = findPlacementRow(rows, row, counter)
    if (!bucket) continue
    candidateCount += bucket.size
    if (candidateCount > CANVAS_PLACEMENT_ROW_CANDIDATE_LIMIT) return null
    buckets.push(bucket)
  }
  const result: CanvasIndexedPlacementObstacle[] = []
  const seen = new Set<string>()
  for (const bucket of buckets) {
    let entry = bucket.head
    while (entry) {
      if (counter === "spatial") spatialQueryVisits += 1
      else viewportQueryVisits += 1
      if (!seen.has(entry.obstacle.key)) {
        seen.add(entry.obstacle.key)
        result.push(entry.obstacle)
      }
      entry = entry.previous
    }
  }
  return result
}

function queryPlacementViewport(
  root: CanvasPlacementIntervalNode | null,
  rect: CanvasPlacementViewportRect,
  limit: number,
  result: string[],
): void {
  if (
    !root ||
    result.length >= limit ||
    root.maxRight <= rect.x ||
    root.minLeft >= rect.x + rect.width ||
    root.maxBottom <= rect.y ||
    root.minTop >= rect.y + rect.height
  ) return
  viewportQueryVisits += 1
  queryPlacementViewport(root.left, rect, limit, result)
  if (result.length >= limit) return
  if (intersectsViewport(rect, root.obstacle)) result.push(root.obstacle.key)
  queryPlacementViewport(root.right, rect, limit, result)
}

function intersectsViewport(rect: CanvasPlacementViewportRect, obstacle: CanvasPlacementObstacle) {
  return (
    obstacle.x < rect.x + rect.width &&
    obstacle.x + obstacle.width > rect.x &&
    obstacle.y < rect.y + rect.height &&
    obstacle.y + obstacle.height > rect.y
  )
}

function intersectsWithGap(position: CanvasPoint, size: CanvasSize, obstacle: CanvasPlacementObstacle, gap: number) {
  return (
    position.x < obstacle.x + obstacle.width + gap &&
    position.x + size.width + gap > obstacle.x &&
    position.y < obstacle.y + obstacle.height + gap &&
    position.y + size.height + gap > obstacle.y
  )
}

function finitePoint(value: CanvasPoint) {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
}

function finiteSize(value: CanvasSize) {
  return Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.height) && value.height > 0
}

function finiteRect(value: CanvasPlacementObstacle) {
  return finitePoint(value) && finiteSize(value)
}
