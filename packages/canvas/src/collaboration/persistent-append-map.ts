import { compareUtf8 } from "@convax/collaboration"

interface AppendNode<V> {
  readonly key: string
  readonly value: V
  readonly height: number
  readonly left: AppendNode<V> | null
  readonly right: AppendNode<V> | null
}

interface AppendSequenceNode<V> {
  readonly index: number
  readonly values: readonly (readonly [string, V])[]
  readonly height: number
  readonly left: AppendSequenceNode<V> | null
  readonly right: AppendSequenceNode<V> | null
}

let appendedEntries = 0
let ownerSnapshotAppendedEntries = 0
let derivedProjectionAppendedEntries = 0
let historicalEntryCopies = 0
let initialSnapshotMaps = 0
const sealedSnapshotMaps = new WeakSet<object>()

/**
 * Module-private append-only persistent map used by owner-validated snapshots.
 *
 * The first layer retains the already validated base map by reference. Later
 * appends structurally share an immutable AVL delta instead of copying either
 * the base or prior additions. No mutator is exposed through ReadonlyMap.
 */
class PersistentAppendReadonlyMap<V> implements ReadonlyMap<string, V> {
  readonly #anchor: ReadonlyMap<string, V>
  readonly #delta: AppendNode<V> | null
  readonly #deltaSize: number
  readonly #sequence: AppendSequenceNode<V> | null
  readonly #sequenceSize: number

  constructor(
    anchor: ReadonlyMap<string, V>,
    delta: AppendNode<V> | null = null,
    deltaSize = 0,
    sequence: AppendSequenceNode<V> | null = null,
    sequenceSize = 0,
  ) {
    this.#anchor = anchor
    this.#delta = delta
    this.#deltaSize = deltaSize
    this.#sequence = sequence
    this.#sequenceSize = sequenceSize
    sealedSnapshotMaps.add(this)
    Object.freeze(this)
  }

  get size(): number {
    return this.#anchor.size + this.#deltaSize
  }

  get [Symbol.toStringTag](): string {
    return "Map"
  }

  get(key: string): V | undefined {
    const appended = findNode(this.#delta, key)
    return appended === undefined ? this.#anchor.get(key) : appended
  }

  has(key: string): boolean {
    return findNode(this.#delta, key) !== undefined || this.#anchor.has(key)
  }

  forEach(callbackfn: (value: V, key: string, map: ReadonlyMap<string, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) callbackfn.call(thisArg, value, key, this)
  }

  *entries(): MapIterator<[string, V]> {
    yield* this.#anchor.entries()
    yield* sequenceEntries(this.#sequence)
  }

  *keys(): MapIterator<string> {
    for (const [key] of this) yield key
  }

  *values(): MapIterator<V> {
    for (const [, value] of this) yield value
  }

  [Symbol.iterator](): MapIterator<[string, V]> {
    return this.entries()
  }

  append(
    additions: readonly (readonly [string, V])[],
    domain: "owner-snapshot" | "derived-projection",
  ): PersistentAppendReadonlyMap<V> {
    let root = this.#delta
    let size = this.#deltaSize
    const ownedAdditions: (readonly [string, V])[] = []
    for (const [key, value] of additions) {
      if (this.#anchor.has(key) || findNode(root, key) !== undefined) {
        throw new TypeError(`Canvas incremental snapshot overwrote ${key}`)
      }
      root = insertNode(root, key, value)
      size += 1
      appendedEntries += 1
      if (domain === "owner-snapshot") ownerSnapshotAppendedEntries += 1
      else derivedProjectionAppendedEntries += 1
      ownedAdditions.push(Object.freeze([key, value] as const))
    }
    if (ownedAdditions.length === 0) return this
    const sequence = insertSequenceNode(
      this.#sequence,
      this.#sequenceSize,
      Object.freeze(ownedAdditions),
    )
    return new PersistentAppendReadonlyMap(this.#anchor, root, size, sequence, this.#sequenceSize + 1)
  }
}

/** Seals a newly validated native map behind a facade with no mutator surface. */
export function createCanvasSnapshotMap<V>(entries: Iterable<readonly [string, V]>): ReadonlyMap<string, V> {
  const anchor = new Map<string, V>()
  for (const [key, value] of entries) anchor.set(key, value)
  initialSnapshotMaps += 1
  return new PersistentAppendReadonlyMap(anchor)
}

export function isSealedCanvasSnapshotMap(value: unknown): value is ReadonlyMap<string, unknown> {
  return typeof value === "object" && value !== null && sealedSnapshotMaps.has(value)
}

export function appendCanvasSnapshotEntries<V>(
  base: ReadonlyMap<string, V>,
  additions: readonly (readonly [string, V])[],
  domain: "owner-snapshot" | "derived-projection" = "owner-snapshot",
): ReadonlyMap<string, V> {
  if (!(base instanceof PersistentAppendReadonlyMap)) {
    throw new TypeError("Canvas incremental snapshot requires a sealed validated base map")
  }
  return base.append(additions, domain)
}

/** Package-private structural benchmark evidence; never enters owner protocol state. */
export function canvasPersistentAppendMapCounts(): Readonly<{
  appendedEntries: number
  ownerSnapshotAppendedEntries: number
  derivedProjectionAppendedEntries: number
  historicalEntryCopies: number
  initialSnapshotMaps: number
}> {
  return Object.freeze({
    appendedEntries,
    ownerSnapshotAppendedEntries,
    derivedProjectionAppendedEntries,
    historicalEntryCopies,
    initialSnapshotMaps,
  })
}

function height<V>(node: AppendNode<V> | null): number {
  return node?.height ?? 0
}

function node<V>(key: string, value: V, left: AppendNode<V> | null, right: AppendNode<V> | null): AppendNode<V> {
  return Object.freeze({ key, value, left, right, height: 1 + Math.max(height(left), height(right)) })
}

function findNode<V>(root: AppendNode<V> | null, key: string): V | undefined {
  let current = root
  while (current) {
    const order = compareUtf8(key, current.key)
    if (order === 0) return current.value
    current = order < 0 ? current.left : current.right
  }
  return undefined
}

function insertNode<V>(root: AppendNode<V> | null, key: string, value: V): AppendNode<V> {
  if (!root) return node(key, value, null, null)
  const order = compareUtf8(key, root.key)
  if (order === 0) throw new TypeError(`Canvas incremental snapshot overwrote ${key}`)
  const inserted = order < 0
    ? node(root.key, root.value, insertNode(root.left, key, value), root.right)
    : node(root.key, root.value, root.left, insertNode(root.right, key, value))
  return balance(inserted)
}

function balance<V>(root: AppendNode<V>): AppendNode<V> {
  const skew = height(root.left) - height(root.right)
  if (skew > 1) {
    const left = root.left!
    if (height(left.left) < height(left.right)) {
      return rotateRight(node(root.key, root.value, rotateLeft(left), root.right))
    }
    return rotateRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (height(right.right) < height(right.left)) {
      return rotateLeft(node(root.key, root.value, root.left, rotateRight(right)))
    }
    return rotateLeft(root)
  }
  return root
}

function rotateLeft<V>(root: AppendNode<V>): AppendNode<V> {
  const pivot = root.right!
  return node(pivot.key, pivot.value, node(root.key, root.value, root.left, pivot.left), pivot.right)
}

function rotateRight<V>(root: AppendNode<V>): AppendNode<V> {
  const pivot = root.left!
  return node(pivot.key, pivot.value, pivot.left, node(root.key, root.value, pivot.right, root.right))
}

function sequenceHeight<V>(node: AppendSequenceNode<V> | null): number {
  return node?.height ?? 0
}

function sequenceNode<V>(
  index: number,
  values: readonly (readonly [string, V])[],
  left: AppendSequenceNode<V> | null,
  right: AppendSequenceNode<V> | null,
): AppendSequenceNode<V> {
  return Object.freeze({ index, values, left, right, height: 1 + Math.max(sequenceHeight(left), sequenceHeight(right)) })
}

function insertSequenceNode<V>(
  root: AppendSequenceNode<V> | null,
  index: number,
  values: readonly (readonly [string, V])[],
): AppendSequenceNode<V> {
  if (!root) return sequenceNode(index, values, null, null)
  if (index === root.index) throw new TypeError(`Canvas incremental snapshot sequence overwrote ${index}`)
  const inserted = index < root.index
    ? sequenceNode(root.index, root.values, insertSequenceNode(root.left, index, values), root.right)
    : sequenceNode(root.index, root.values, root.left, insertSequenceNode(root.right, index, values))
  return balanceSequence(inserted)
}

function balanceSequence<V>(root: AppendSequenceNode<V>): AppendSequenceNode<V> {
  const skew = sequenceHeight(root.left) - sequenceHeight(root.right)
  if (skew > 1) {
    const left = root.left!
    if (sequenceHeight(left.left) < sequenceHeight(left.right)) {
      return rotateSequenceRight(sequenceNode(root.index, root.values, rotateSequenceLeft(left), root.right))
    }
    return rotateSequenceRight(root)
  }
  if (skew < -1) {
    const right = root.right!
    if (sequenceHeight(right.right) < sequenceHeight(right.left)) {
      return rotateSequenceLeft(sequenceNode(root.index, root.values, root.left, rotateSequenceRight(right)))
    }
    return rotateSequenceLeft(root)
  }
  return root
}

function rotateSequenceLeft<V>(root: AppendSequenceNode<V>): AppendSequenceNode<V> {
  const pivot = root.right!
  return sequenceNode(
    pivot.index,
    pivot.values,
    sequenceNode(root.index, root.values, root.left, pivot.left),
    pivot.right,
  )
}

function rotateSequenceRight<V>(root: AppendSequenceNode<V>): AppendSequenceNode<V> {
  const pivot = root.left!
  return sequenceNode(
    pivot.index,
    pivot.values,
    pivot.left,
    sequenceNode(root.index, root.values, pivot.right, root.right),
  )
}

function* sequenceEntries<V>(root: AppendSequenceNode<V> | null): Generator<[string, V]> {
  if (!root) return
  yield* sequenceEntries(root.left)
  for (const [key, value] of root.values) yield [key, value]
  yield* sequenceEntries(root.right)
}
