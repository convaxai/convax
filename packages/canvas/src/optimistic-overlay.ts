/**
 * Renderer-only presentation records. These types intentionally do not reuse
 * CanvasDocument, CanvasNode, CanvasEdge, canonical ids, or owner incarnations.
 */
export type CanvasOptimisticOperationToken = symbol

export interface CanvasPresentationPoint {
  readonly x: number
  readonly y: number
}

export interface CanvasPresentationSize {
  readonly height: number
  readonly width: number
}

export interface CanvasPresentationEndpoint {
  readonly key: string
  readonly side?: "input" | "output"
}

export interface CanvasPresentationEntityGuard {
  readonly entityId: string
  readonly incarnation: string
  readonly kind: "edge" | "node"
}

/**
 * Complete renderer presentation for one node. It deliberately omits canonical
 * identity and authority metadata, and can only be consumed by the last-mile
 * React Flow adapter.
 */
export interface CanvasNodePresentationSnapshot {
  readonly data: Readonly<Record<string, unknown>>
  readonly nodeType: "agent" | "file"
  readonly parentPresentationKey?: string
  readonly position: CanvasPresentationPoint
  readonly size: CanvasPresentationSize
  readonly zIndex?: number
}

export interface CanvasGhostNode {
  readonly kind: "ghost-node"
  /** Presentation-only focus affordance; never enters Canvas selection. */
  readonly focusVisible?: true
  readonly presentationKey: string
  readonly parentPresentationKey?: string
  readonly position: CanvasPresentationPoint
  readonly presentation: Readonly<{
    readonly emptyCard?: true
    readonly mediaKind?: "audio" | "file" | "image" | "video"
    readonly mimeType?: string
    readonly nodeType: "file" | "text"
    /** Renderer-only local/thumbnail URL; never crosses the Canvas command boundary. */
    readonly previewUrl?: string
    readonly title: string
  }>
  readonly size: CanvasPresentationSize
  readonly snapshot?: CanvasNodePresentationSnapshot
}

export interface CanvasGhostEdge {
  readonly kind: "ghost-edge"
  readonly presentationKey: string
  readonly source: CanvasPresentationEndpoint
  readonly target: CanvasPresentationEndpoint
  readonly label?: string
}

export interface CanvasHideEntity {
  readonly kind: "hide-entity"
  readonly entity: CanvasPresentationEntityGuard
}

export interface CanvasReplacePresentation {
  readonly kind: "replace-presentation"
  readonly entity: CanvasPresentationEntityGuard
  readonly position?: CanvasPresentationPoint
  readonly size?: CanvasPresentationSize
  readonly snapshot?: CanvasNodePresentationSnapshot
  readonly title?: string
}

export type CanvasOptimisticOverlayItem =
  | CanvasGhostNode
  | CanvasGhostEdge
  | CanvasHideEntity
  | CanvasReplacePresentation

export interface CanvasOptimisticOverlayOperation {
  readonly token: CanvasOptimisticOperationToken
  readonly scopeKey: string
  readonly items: readonly CanvasOptimisticOverlayItem[]
}

export interface CanvasOptimisticOverlaySnapshot {
  readonly ghostEntityCount: number
  readonly operations: readonly CanvasOptimisticOverlayOperation[]
  readonly pendingOperationCount: number
  readonly savingWithoutPrediction: number
}

export interface CanvasOptimisticOverlayLimits {
  readonly maximumGhostEntities: number
  readonly maximumPendingOperations: number
}

const defaultLimits: CanvasOptimisticOverlayLimits = Object.freeze({
  maximumGhostEntities: 512,
  maximumPendingOperations: 32,
})

const emptySnapshot: CanvasOptimisticOverlaySnapshot = Object.freeze({
  ghostEntityCount: 0,
  operations: Object.freeze([]),
  pendingOperationCount: 0,
  savingWithoutPrediction: 0,
})

export function createCanvasOptimisticOperationToken(): CanvasOptimisticOperationToken {
  return Symbol("canvas-optimistic-operation")
}

/** Bounded session-local overlay owner. It has no document or command API. */
export class CanvasOptimisticOverlayCoordinator {
  readonly #limits: CanvasOptimisticOverlayLimits
  readonly #operations = new Map<CanvasOptimisticOperationToken, CanvasOptimisticOverlayOperation>()
  readonly #bounded = new Set<CanvasOptimisticOperationToken>()
  readonly #listeners = new Set<() => void>()
  #snapshot = emptySnapshot

  constructor(limits: Partial<CanvasOptimisticOverlayLimits> = {}) {
    this.#limits = Object.freeze({
      maximumGhostEntities: limits.maximumGhostEntities ?? defaultLimits.maximumGhostEntities,
      maximumPendingOperations: limits.maximumPendingOperations ?? defaultLimits.maximumPendingOperations,
    })
    if (
      !Number.isSafeInteger(this.#limits.maximumGhostEntities) ||
      !Number.isSafeInteger(this.#limits.maximumPendingOperations) ||
      this.#limits.maximumGhostEntities < 1 ||
      this.#limits.maximumPendingOperations < 1
    ) {
      throw new TypeError("Canvas optimistic overlay limits are invalid")
    }
  }

  begin(scopeKey: string, items: readonly CanvasOptimisticOverlayItem[]) {
    const token = createCanvasOptimisticOperationToken()
    const normalized = Object.freeze(items.map(requireOverlayItem))
    const ghostCount = normalized.filter((item) => item.kind === "ghost-node" || item.kind === "ghost-edge").length
    if (
      this.#operations.size + this.#bounded.size >= this.#limits.maximumPendingOperations ||
      this.#snapshot.ghostEntityCount + ghostCount > this.#limits.maximumGhostEntities
    ) {
      this.#bounded.add(token)
      this.#publish()
      return Object.freeze({ status: "bounded" as const, token })
    }
    this.#operations.set(token, Object.freeze({ token, scopeKey: requireScopeKey(scopeKey), items: normalized }))
    this.#publish()
    return Object.freeze({ status: "shown" as const, token })
  }

  settle(token: CanvasOptimisticOperationToken): void {
    if (!this.#operations.delete(token) && !this.#bounded.delete(token)) return
    this.#publish()
  }

  replace(token: CanvasOptimisticOperationToken, items: readonly CanvasOptimisticOverlayItem[]): boolean {
    const operation = this.#operations.get(token)
    if (!operation) return false
    const normalized = Object.freeze(items.map(requireOverlayItem))
    const existingGhostCount = operation.items.filter(
      (item) => item.kind === "ghost-node" || item.kind === "ghost-edge",
    ).length
    const nextGhostCount = normalized.filter((item) => item.kind === "ghost-node" || item.kind === "ghost-edge").length
    if (this.#snapshot.ghostEntityCount - existingGhostCount + nextGhostCount > this.#limits.maximumGhostEntities) {
      this.#operations.delete(token)
      this.#bounded.add(token)
      this.#publish()
      return false
    }
    this.#operations.set(token, Object.freeze({ ...operation, items: normalized }))
    this.#publish()
    return true
  }

  clear(): void {
    if (this.#operations.size === 0 && this.#bounded.size === 0) return
    this.#operations.clear()
    this.#bounded.clear()
    this.#publish()
  }

  clearScope(scopeKey: string): void {
    let changed = false
    for (const [token, operation] of this.#operations) {
      if (operation.scopeKey !== scopeKey) continue
      this.#operations.delete(token)
      changed = true
    }
    if (changed) this.#publish()
  }

  getSnapshot(): CanvasOptimisticOverlaySnapshot {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #publish(): void {
    const operations = Object.freeze([...this.#operations.values()])
    this.#snapshot = Object.freeze({
      ghostEntityCount: operations.reduce(
        (count, operation) =>
          count + operation.items.filter((item) => item.kind === "ghost-node" || item.kind === "ghost-edge").length,
        0,
      ),
      operations,
      pendingOperationCount: operations.length + this.#bounded.size,
      savingWithoutPrediction: this.#bounded.size,
    })
    for (const listener of [...this.#listeners]) listener()
  }
}

export interface CanvasCombinedPresentationSnapshot<Authoritative> {
  readonly authoritative: Authoritative
  readonly overlay: CanvasOptimisticOverlaySnapshot
}

export class CanvasMergedOptimisticOverlayStore {
  readonly #sources: readonly Readonly<{
    getSnapshot(): CanvasOptimisticOverlaySnapshot
    subscribe(listener: () => void): () => void
  }>[]
  readonly #listeners = new Set<() => void>()
  readonly #unsubscribes: readonly (() => void)[]
  #snapshot: CanvasOptimisticOverlaySnapshot

  constructor(
    sources: readonly Readonly<{
      getSnapshot(): CanvasOptimisticOverlaySnapshot
      subscribe(listener: () => void): () => void
    }>[],
  ) {
    this.#sources = [...sources]
    this.#snapshot = mergeOverlaySnapshots(this.#sources.map((source) => source.getSnapshot()))
    this.#unsubscribes = this.#sources.map((source) =>
      source.subscribe(() => {
        this.#snapshot = mergeOverlaySnapshots(this.#sources.map((current) => current.getSnapshot()))
        for (const listener of [...this.#listeners]) listener()
      }),
    )
  }

  getSnapshot(): CanvasOptimisticOverlaySnapshot {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribes) unsubscribe()
    this.#listeners.clear()
  }
}

/**
 * Coalesces authority and overlay changes into one microtask. A mutation caller
 * can install the authoritative projection and settle its overlay synchronously;
 * observers then see only the reconciled pair.
 */
export class CanvasCombinedPresentationStore<Authoritative> {
  readonly #listeners = new Set<() => void>()
  readonly #authoritative: { getSnapshot(): Authoritative; subscribe(listener: () => void): () => void }
  readonly #overlay: Pick<CanvasOptimisticOverlayCoordinator, "getSnapshot" | "subscribe">
  readonly #schedule: (task: () => void) => void
  #scheduled = false
  #snapshot: CanvasCombinedPresentationSnapshot<Authoritative>
  #unsubscribeAuthoritative: (() => void) | null = null
  #unsubscribeOverlay: (() => void) | null = null

  constructor(input: {
    authoritative: { getSnapshot(): Authoritative; subscribe(listener: () => void): () => void }
    overlay: Pick<CanvasOptimisticOverlayCoordinator, "getSnapshot" | "subscribe">
    schedule?: (task: () => void) => void
  }) {
    this.#authoritative = input.authoritative
    this.#overlay = input.overlay
    if (input.schedule) {
      const schedule = input.schedule
      this.#schedule = (task) => schedule(task)
    } else {
      // Browser queueMicrotask is receiver-sensitive. Keep the global member
      // call so this store cannot become its accidental receiver.
      this.#schedule = (task) => globalThis.queueMicrotask(task)
    }
    this.#snapshot = Object.freeze({
      authoritative: input.authoritative.getSnapshot(),
      overlay: input.overlay.getSnapshot(),
    })
  }

  getSnapshot(): CanvasCombinedPresentationSnapshot<Authoritative> {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    if (this.#listeners.size === 1) {
      const invalidate = () => this.#invalidate(this.#authoritative, this.#overlay)
      this.#unsubscribeAuthoritative = this.#authoritative.subscribe(invalidate)
      this.#unsubscribeOverlay = this.#overlay.subscribe(invalidate)
      const authoritative = this.#authoritative.getSnapshot()
      const overlay = this.#overlay.getSnapshot()
      if (authoritative !== this.#snapshot.authoritative || overlay !== this.#snapshot.overlay) {
        this.#snapshot = Object.freeze({ authoritative, overlay })
      }
    }
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) this.#stop()
    }
  }

  dispose(): void {
    this.#stop()
    this.#listeners.clear()
  }

  #stop(): void {
    this.#unsubscribeAuthoritative?.()
    this.#unsubscribeOverlay?.()
    this.#unsubscribeAuthoritative = null
    this.#unsubscribeOverlay = null
  }

  #invalidate(
    authoritative: { getSnapshot(): Authoritative },
    overlay: Pick<CanvasOptimisticOverlayCoordinator, "getSnapshot">,
  ): void {
    if (this.#scheduled) return
    this.#scheduled = true
    try {
      this.#schedule(() => {
        this.#scheduled = false
        this.#snapshot = Object.freeze({
          authoritative: authoritative.getSnapshot(),
          overlay: overlay.getSnapshot(),
        })
        for (const listener of [...this.#listeners]) listener()
      })
    } catch (error) {
      this.#scheduled = false
      throw error
    }
  }
}

function requireScopeKey(scopeKey: string): string {
  if (!scopeKey || scopeKey.includes("\0") || new TextEncoder().encode(scopeKey).byteLength > 1_024) {
    throw new TypeError("Canvas optimistic overlay scope is invalid")
  }
  return scopeKey
}

function mergeOverlaySnapshots(snapshots: readonly CanvasOptimisticOverlaySnapshot[]): CanvasOptimisticOverlaySnapshot {
  return Object.freeze({
    ghostEntityCount: snapshots.reduce((sum, snapshot) => sum + snapshot.ghostEntityCount, 0),
    operations: Object.freeze(snapshots.flatMap((snapshot) => snapshot.operations)),
    pendingOperationCount: snapshots.reduce((sum, snapshot) => sum + snapshot.pendingOperationCount, 0),
    savingWithoutPrediction: snapshots.reduce((sum, snapshot) => sum + snapshot.savingWithoutPrediction, 0),
  })
}

function requireOverlayItem(item: CanvasOptimisticOverlayItem): CanvasOptimisticOverlayItem {
  if (!item || typeof item !== "object") throw new TypeError("Canvas optimistic overlay item is invalid")
  if (item.kind === "ghost-node") {
    requirePresentationKey(item.presentationKey)
    requirePoint(item.position)
    requireSize(item.size)
    return Object.freeze({
      ...item,
      position: Object.freeze({ ...item.position }),
      size: Object.freeze({ ...item.size }),
      presentation: Object.freeze({ ...item.presentation }),
      ...(item.snapshot ? { snapshot: requireNodePresentationSnapshot(item.snapshot) } : {}),
    })
  }
  if (item.kind === "ghost-edge") {
    requirePresentationKey(item.presentationKey)
    requirePresentationKey(item.source.key)
    requirePresentationKey(item.target.key)
    return Object.freeze({
      ...item,
      source: Object.freeze({ ...item.source }),
      target: Object.freeze({ ...item.target }),
    })
  }
  if (item.kind === "hide-entity") return Object.freeze({ ...item, entity: requireEntityGuard(item.entity) })
  if (item.kind === "replace-presentation") {
    if (item.position) requirePoint(item.position)
    if (item.size) requireSize(item.size)
    return Object.freeze({
      ...item,
      entity: requireEntityGuard(item.entity),
      ...(item.position ? { position: Object.freeze({ ...item.position }) } : {}),
      ...(item.size ? { size: Object.freeze({ ...item.size }) } : {}),
      ...(item.snapshot ? { snapshot: requireNodePresentationSnapshot(item.snapshot) } : {}),
    })
  }
  throw new TypeError("Canvas optimistic overlay kind is invalid")
}

function requireNodePresentationSnapshot(value: CanvasNodePresentationSnapshot): CanvasNodePresentationSnapshot {
  if (!value || typeof value !== "object" || (value.nodeType !== "agent" && value.nodeType !== "file")) {
    throw new TypeError("Canvas node presentation snapshot is invalid")
  }
  requirePoint(value.position)
  requireSize(value.size)
  if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
    throw new TypeError("Canvas node presentation data is invalid")
  }
  if (value.parentPresentationKey !== undefined) requirePresentationKey(value.parentPresentationKey)
  if (value.zIndex !== undefined && !Number.isFinite(value.zIndex)) {
    throw new TypeError("Canvas node presentation z-index is invalid")
  }
  return Object.freeze({
    data: Object.freeze(structuredClone(value.data)),
    nodeType: value.nodeType,
    ...(value.parentPresentationKey ? { parentPresentationKey: value.parentPresentationKey } : {}),
    position: Object.freeze({ ...value.position }),
    size: Object.freeze({ ...value.size }),
    ...(value.zIndex === undefined ? {} : { zIndex: value.zIndex }),
  })
}

function requireEntityGuard(value: CanvasPresentationEntityGuard): CanvasPresentationEntityGuard {
  if (!value.entityId || !value.incarnation || (value.kind !== "node" && value.kind !== "edge")) {
    throw new TypeError("Canvas optimistic entity guard is invalid")
  }
  return Object.freeze({ ...value })
}

function requirePresentationKey(value: string): void {
  if (!value || value.includes("\0") || new TextEncoder().encode(value).byteLength > 512) {
    throw new TypeError("Canvas optimistic presentation key is invalid")
  }
}

function requirePoint(value: CanvasPresentationPoint): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError("Canvas optimistic point is invalid")
}

function requireSize(value: CanvasPresentationSize): void {
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height) || value.width <= 0 || value.height <= 0) {
    throw new TypeError("Canvas optimistic size is invalid")
  }
}
