interface CanvasRuntimeMapNode<Value> {
  readonly height: number
  readonly key: string
  readonly left: CanvasRuntimeMapNode<Value> | null
  readonly right: CanvasRuntimeMapNode<Value> | null
  readonly value: Value | undefined
}

let historicalEntryVisits = 0
let keyedReads = 0
let pathCopies = 0
let rangeBoundaryVisits = 0
let rangeEntryVisits = 0

/** Package-private structural evidence for the Renderer runtime overlay. */
export function canvasPersistentRuntimeMapWorkCounts() {
  return Object.freeze({ historicalEntryVisits, keyedReads, pathCopies, rangeBoundaryVisits, rangeEntryVisits })
}

/**
 * Immutable keyed presentation state. A single hydration/prepared-runtime
 * update path-copies one AVL path and never clones prior Canvas entries.
 */
export class CanvasPersistentRuntimeMap<Value> implements ReadonlyMap<string, Value> {
  readonly #root: CanvasRuntimeMapNode<Value> | null
  readonly size: number

  private constructor(root: CanvasRuntimeMapNode<Value> | null, size: number) {
    this.#root = root
    this.size = size
    Object.freeze(this)
  }

  static empty<Value>() {
    return new CanvasPersistentRuntimeMap<Value>(null, 0)
  }

  get [Symbol.toStringTag]() {
    return "Map"
  }

  get(key: string): Value | undefined {
    keyedReads += 1
    let current = this.#root
    while (current) {
      const order = compareKey(key, current.key)
      if (order === 0) return current.value
      current = order < 0 ? current.left : current.right
    }
    return undefined
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  set(key: string, value: Value): CanvasPersistentRuntimeMap<Value> {
    if (!key) throw new TypeError("Canvas runtime key is invalid")
    const result = setNode(this.#root, key, value)
    if (!result.changed) return this
    return new CanvasPersistentRuntimeMap(result.root, this.size + (result.added ? 1 : 0))
  }

  delete(key: string): CanvasPersistentRuntimeMap<Value> {
    const result = deleteNode(this.#root, key)
    if (!result.changed) return this
    return new CanvasPersistentRuntimeMap(result.root, this.size - 1)
  }

  forEach(callbackfn: (value: Value, key: string, map: ReadonlyMap<string, Value>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) callbackfn.call(thisArg, value, key, this)
  }

  *entries(): MapIterator<[string, Value]> {
    yield* entries(this.#root)
  }

  /**
   * Ordered half-open range query. Traversal follows only the two boundary
   * paths plus returned entries, so a prefix lookup never enumerates unrelated
   * retained values.
   */
  *entriesInRange(minInclusive: string, maxExclusive: string): Generator<[string, Value]> {
    if (minInclusive >= maxExclusive) return
    yield* entriesInRange(this.#root, minInclusive, maxExclusive)
  }

  *keys(): MapIterator<string> {
    for (const [key] of this) yield key
  }

  *values(): MapIterator<Value> {
    for (const [, value] of this) yield value
  }

  [Symbol.iterator](): MapIterator<[string, Value]> {
    return this.entries()
  }
}

function compareKey(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function height<Value>(node: CanvasRuntimeMapNode<Value> | null) {
  return node?.height ?? 0
}

function createNode<Value>(
  key: string,
  value: Value | undefined,
  left: CanvasRuntimeMapNode<Value> | null,
  right: CanvasRuntimeMapNode<Value> | null,
) {
  pathCopies += 1
  return Object.freeze({ key, value, left, right, height: 1 + Math.max(height(left), height(right)) })
}

function setNode<Value>(
  root: CanvasRuntimeMapNode<Value> | null,
  key: string,
  value: Value,
): { added: boolean; changed: boolean; root: CanvasRuntimeMapNode<Value> } {
  if (!root) return { added: true, changed: true, root: createNode(key, value, null, null) }
  const order = compareKey(key, root.key)
  if (order === 0) {
    if (root.value === value) return { added: false, changed: false, root }
    return { added: root.value === undefined, changed: true, root: createNode(key, value, root.left, root.right) }
  }
  if (order < 0) {
    const result = setNode(root.left, key, value)
    if (!result.changed) return { ...result, root }
    return {
      added: result.added,
      changed: true,
      root: balance(createNode(root.key, root.value, result.root, root.right)),
    }
  }
  const result = setNode(root.right, key, value)
  if (!result.changed) return { ...result, root }
  return {
    added: result.added,
    changed: true,
    root: balance(createNode(root.key, root.value, root.left, result.root)),
  }
}

function deleteNode<Value>(
  root: CanvasRuntimeMapNode<Value> | null,
  key: string,
): { changed: boolean; root: CanvasRuntimeMapNode<Value> | null } {
  if (!root) return { changed: false, root }
  const order = compareKey(key, root.key)
  if (order === 0) {
    return root.value === undefined
      ? { changed: false, root }
      : { changed: true, root: createNode(root.key, undefined, root.left, root.right) }
  }
  if (order < 0) {
    const result = deleteNode(root.left, key)
    return result.changed
      ? { changed: true, root: balance(createNode(root.key, root.value, result.root, root.right)) }
      : { changed: false, root }
  }
  const result = deleteNode(root.right, key)
  return result.changed
    ? { changed: true, root: balance(createNode(root.key, root.value, root.left, result.root)) }
    : { changed: false, root }
}

function balance<Value>(root: CanvasRuntimeMapNode<Value>): CanvasRuntimeMapNode<Value> {
  const skew = height(root.left) - height(root.right)
  if (skew > 1) {
    const left = root.left!
    if (height(left.left) < height(left.right)) {
      return rotateRight(createNode(root.key, root.value, rotateLeft(left), root.right))
    }
    return rotateRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (height(right.right) < height(right.left)) {
      return rotateLeft(createNode(root.key, root.value, root.left, rotateRight(right)))
    }
    return rotateLeft(root)
  }
  return root
}

function rotateLeft<Value>(root: CanvasRuntimeMapNode<Value>): CanvasRuntimeMapNode<Value> {
  const pivot = root.right!
  return createNode(
    pivot.key,
    pivot.value,
    createNode(root.key, root.value, root.left, pivot.left),
    pivot.right,
  )
}

function rotateRight<Value>(root: CanvasRuntimeMapNode<Value>): CanvasRuntimeMapNode<Value> {
  const pivot = root.left!
  return createNode(
    pivot.key,
    pivot.value,
    pivot.left,
    createNode(root.key, root.value, pivot.right, root.right),
  )
}

function* entries<Value>(root: CanvasRuntimeMapNode<Value> | null): Generator<[string, Value]> {
  if (!root) return
  yield* entries(root.left)
  if (root.value !== undefined) {
    historicalEntryVisits += 1
    yield [root.key, root.value]
  }
  yield* entries(root.right)
}

function* entriesInRange<Value>(
  root: CanvasRuntimeMapNode<Value> | null,
  minInclusive: string,
  maxExclusive: string,
): Generator<[string, Value]> {
  if (!root) return
  if (root.key < minInclusive) {
    rangeBoundaryVisits += 1
    yield* entriesInRange(root.right, minInclusive, maxExclusive)
    return
  }
  if (root.key >= maxExclusive) {
    rangeBoundaryVisits += 1
    yield* entriesInRange(root.left, minInclusive, maxExclusive)
    return
  }
  yield* entriesInRange(root.left, minInclusive, maxExclusive)
  if (root.value !== undefined) {
    rangeEntryVisits += 1
    yield [root.key, root.value]
  }
  yield* entriesInRange(root.right, minInclusive, maxExclusive)
}
