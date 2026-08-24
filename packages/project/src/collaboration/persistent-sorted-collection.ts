import { compareUtf8 } from "@convax/collaboration"

interface PersistentSortedNode<V> {
  readonly key: string
  readonly value: V
  readonly height: number
  readonly size: number
  readonly left: PersistentSortedNode<V> | null
  readonly right: PersistentSortedNode<V> | null
}
export interface ProjectPersistentSortedCollection<V> {
  readonly root: PersistentSortedNode<V> | null
  readonly size: number
}

let fullBuilds = 0
let fullBuildEntryVisits = 0
let fullBuildComparisons = 0
let incrementalInsertions = 0
let insertionComparisons = 0
let persistentNodeCopies = 0
let historicalEntryVisits = 0
let historicalEntryCopies = 0
let flattenEntryVisits = 0
let evidenceEntryVisits = 0

/**
 * Builds the rebuildable baseline index. This is deliberately the only full
 * collection traversal/sort path; incremental owner commits use path-copying AVL
 * insertion below.
 */
export function createProjectPersistentSortedCollection<V>(
  entries: Iterable<readonly [string, V]>,
): ProjectPersistentSortedCollection<V> {
  fullBuilds += 1
  const sorted: Array<readonly [string, V]> = []
  for (const entry of entries) {
    fullBuildEntryVisits += 1
    sorted.push(Object.freeze([entry[0], entry[1]] as const))
  }
  sorted.sort((left, right) => {
    fullBuildComparisons += 1
    return compareUtf8(left[0], right[0])
  })
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]![0] === sorted[index]![0]) {
      throw new TypeError(`Duplicate ProjectIndex canonical pair: ${sorted[index]![0]}`)
    }
  }
  return Object.freeze({ root: buildBalanced(sorted, 0, sorted.length), size: sorted.length })
}

/**
 * Inserts a fixed-size owner delta by copying only the AVL search/rotation path.
 * Existing entries are neither enumerated nor copied.
 */
export function insertProjectPersistentSortedCollection<V>(
  base: ProjectPersistentSortedCollection<V>,
  additions: Iterable<readonly [string, V]>,
): ProjectPersistentSortedCollection<V> {
  let root = base.root
  let size = base.size
  for (const [key, value] of additions) {
    root = insert(root, key, value)
    size += 1
    incrementalInsertions += 1
  }
  return Object.freeze({ root, size })
}

export function projectPersistentSortedCollectionEntries<V>(
  collection: ProjectPersistentSortedCollection<V>,
  purpose: "flatten" | "evidence" | "unmeasured",
): IterableIterator<readonly [string, V]> {
  return iterate(collection.root, purpose)
}

/** Package-private structural evidence. It never enters protocol state. */
export function projectPersistentSortedCollectionCounts(): Readonly<{
  readonly fullBuilds: number
  readonly fullBuildEntryVisits: number
  readonly fullBuildComparisons: number
  readonly incrementalInsertions: number
  readonly insertionComparisons: number
  readonly persistentNodeCopies: number
  readonly historicalEntryVisits: number
  readonly historicalEntryCopies: number
  readonly flattenEntryVisits: number
  readonly evidenceEntryVisits: number
}> {
  return Object.freeze({
    fullBuilds,
    fullBuildEntryVisits,
    fullBuildComparisons,
    incrementalInsertions,
    insertionComparisons,
    persistentNodeCopies,
    historicalEntryVisits,
    historicalEntryCopies,
    flattenEntryVisits,
    evidenceEntryVisits,
  })
}

function buildBalanced<V>(
  entries: readonly (readonly [string, V])[],
  start: number,
  end: number,
): PersistentSortedNode<V> | null {
  if (start >= end) return null
  const middle = (start + end) >>> 1
  const [key, value] = entries[middle]!
  const left = buildBalanced(entries, start, middle)
  const right = buildBalanced(entries, middle + 1, end)
  return makeNode(key, value, left, right, false)
}

function insert<V>(root: PersistentSortedNode<V> | null, key: string, value: V): PersistentSortedNode<V> {
  if (root === null) return makeNode(key, value, null, null, true)
  insertionComparisons += 1
  const order = compareUtf8(key, root.key)
  if (order === 0) throw new TypeError(`Duplicate ProjectIndex canonical pair: ${key}`)
  const next = order < 0
    ? makeNode(root.key, root.value, insert(root.left, key, value), root.right, true)
    : makeNode(root.key, root.value, root.left, insert(root.right, key, value), true)
  return balance(next)
}

function balance<V>(root: PersistentSortedNode<V>): PersistentSortedNode<V> {
  const skew = height(root.left) - height(root.right)
  if (skew > 1) {
    const left = root.left!
    if (height(left.left) < height(left.right)) {
      return rotateRight(makeNode(root.key, root.value, rotateLeft(left), root.right, true))
    }
    return rotateRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (height(right.right) < height(right.left)) {
      return rotateLeft(makeNode(root.key, root.value, root.left, rotateRight(right), true))
    }
    return rotateLeft(root)
  }
  return root
}

function rotateLeft<V>(root: PersistentSortedNode<V>): PersistentSortedNode<V> {
  const pivot = root.right!
  return makeNode(
    pivot.key,
    pivot.value,
    makeNode(root.key, root.value, root.left, pivot.left, true),
    pivot.right,
    true,
  )
}

function rotateRight<V>(root: PersistentSortedNode<V>): PersistentSortedNode<V> {
  const pivot = root.left!
  return makeNode(
    pivot.key,
    pivot.value,
    pivot.left,
    makeNode(root.key, root.value, pivot.right, root.right, true),
    true,
  )
}

function makeNode<V>(
  key: string,
  value: V,
  left: PersistentSortedNode<V> | null,
  right: PersistentSortedNode<V> | null,
  copied: boolean,
): PersistentSortedNode<V> {
  if (copied) persistentNodeCopies += 1
  return Object.freeze({
    key,
    value,
    left,
    right,
    height: 1 + Math.max(height(left), height(right)),
    size: 1 + size(left) + size(right),
  })
}

function height<V>(node: PersistentSortedNode<V> | null): number {
  return node?.height ?? 0
}

function size<V>(node: PersistentSortedNode<V> | null): number {
  return node?.size ?? 0
}

function* iterate<V>(
  root: PersistentSortedNode<V> | null,
  purpose: "flatten" | "evidence" | "unmeasured",
): Generator<readonly [string, V]> {
  const stack: PersistentSortedNode<V>[] = []
  let current = root
  while (current !== null || stack.length > 0) {
    while (current !== null) {
      stack.push(current)
      current = current.left
    }
    const next = stack.pop()!
    if (purpose === "flatten") flattenEntryVisits += 1
    else if (purpose === "evidence") evidenceEntryVisits += 1
    yield Object.freeze([next.key, next.value] as const)
    current = next.right
  }
}
