export const WorkbenchLayoutParts = {
  PrimarySidebar: "primary-sidebar",
  SecondarySidebar: "secondary-sidebar",
} as const

export type WorkbenchStandardLayoutPartId = typeof WorkbenchLayoutParts[keyof typeof WorkbenchLayoutParts]

export interface WorkbenchLayoutPartConfiguration {
  /** Collapses at this raw size; reopening in the same drag must also reach minSize. */
  collapseThreshold?: number
  /** Blocks reopening for this duration after a drag collapse commits. */
  collapseReopenDelayMs?: number
  initialSize: number
  initialVisible: boolean
  maxSize: number
  minSize: number
}

export interface WorkbenchCollapsibleLayoutPartConfiguration extends WorkbenchLayoutPartConfiguration {
  collapseThreshold: number
}

/**
 * Hosts own all product-specific dimensions. Additional part ids may be supplied
 * without changing the Workbench package.
 */
export type WorkbenchLayoutPartsConfiguration = Record<string, WorkbenchLayoutPartConfiguration> & {
  [WorkbenchLayoutParts.PrimarySidebar]: WorkbenchLayoutPartConfiguration
  [WorkbenchLayoutParts.SecondarySidebar]: WorkbenchCollapsibleLayoutPartConfiguration
}

export interface WorkbenchLayoutControllerOptions {
  now?(): number
  parts: WorkbenchLayoutPartsConfiguration
}

export interface WorkbenchLayoutPartSnapshot {
  /** The committed expanded size. It remains available while the part is hidden. */
  size: number
  visible: boolean
}

export interface WorkbenchLayoutResizeSnapshot {
  partId: string
  /** Transient geometry for rendering the active drag without persisting it. */
  preview: Readonly<WorkbenchLayoutPartSnapshot>
}

export interface WorkbenchLayoutSnapshot {
  parts: Readonly<Record<string, Readonly<WorkbenchLayoutPartSnapshot>>>
  resize: Readonly<WorkbenchLayoutResizeSnapshot> | null
}

export function getWorkbenchLayoutPartSnapshot(snapshot: WorkbenchLayoutSnapshot, partId: string) {
  return snapshot.resize?.partId === partId
    ? snapshot.resize.preview
    : snapshot.parts[partId]
}

interface ResizeTransaction {
  collapseLatched?: boolean
  initialPart: Readonly<WorkbenchLayoutPartSnapshot>
  partId: string
}

/** DOM-free state and transaction controller for Workbench layout parts. */
export class WorkbenchLayoutController {
  private readonly configurations = new Map<string, Readonly<WorkbenchLayoutPartConfiguration>>()
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number
  private readonly reopenBlockedUntil = new Map<string, number>()
  private resizeTransaction: ResizeTransaction | null = null
  private snapshot: WorkbenchLayoutSnapshot

  constructor(options: WorkbenchLayoutControllerOptions) {
    requireStandardParts(options.parts)
    this.now = options.now ?? Date.now
    const parts: Record<string, Readonly<WorkbenchLayoutPartSnapshot>> = {}
    for (const [partId, input] of Object.entries(options.parts)) {
      const configuration = validateConfiguration(partId, input)
      this.configurations.set(partId, configuration)
      parts[partId] = Object.freeze({ size: configuration.initialSize, visible: configuration.initialVisible })
    }
    this.snapshot = createSnapshot(parts, null)
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setPartVisible(partId: string, visible: boolean) {
    const part = this.requirePart(partId)
    if (this.resizeTransaction) throw new Error("Workbench part visibility cannot change during a resize.")
    if (part.visible === visible) return false
    if (visible) {
      const blockedUntil = this.reopenBlockedUntil.get(partId)
      if (blockedUntil !== undefined) {
        if (this.now() < blockedUntil) return false
        this.reopenBlockedUntil.delete(partId)
      }
    }
    this.replacePart(partId, { ...part, visible })
    return true
  }

  togglePartVisibility(partId: string) {
    const part = this.requirePart(partId)
    return this.setPartVisible(partId, !part.visible)
  }

  /** Applies a host layout constraint without changing part visibility. */
  setPartSize(partId: string, size: number) {
    const part = this.requirePart(partId)
    if (this.resizeTransaction) throw new Error("Workbench part size cannot change during a resize.")
    requireFiniteNumber(size, "Workbench part size")
    const configuration = this.configurations.get(partId)!
    const nextSize = clamp(size, configuration.minSize, configuration.maxSize)
    if (part.size === nextSize) return false
    this.replacePart(partId, { ...part, size: nextSize })
    return true
  }

  beginResize(partId: string) {
    const part = this.requirePart(partId)
    if (this.resizeTransaction) throw new Error("A Workbench resize is already active.")
    if (!part.visible) return false
    this.resizeTransaction = { initialPart: part, partId }
    this.replaceSnapshot(this.snapshot.parts, { partId, preview: part })
    return true
  }

  /** Updates from the beginResize baseline; a positive delta grows the part. */
  updateResize(delta: number) {
    const transaction = this.requireResize()
    requireFiniteNumber(delta, "Workbench resize delta")
    const requestedSize = transaction.initialPart.size + delta
    if (!Number.isFinite(requestedSize)) throw new Error("Workbench requested size must be finite.")
    const configuration = this.configurations.get(transaction.partId)!
    const current = this.snapshot.resize!.preview
    const crossedCollapseThreshold = configuration.collapseThreshold !== undefined
      && requestedSize <= configuration.collapseThreshold
    const reopenDelay = configuration.collapseReopenDelayMs ?? 0
    if (crossedCollapseThreshold && reopenDelay > 0 && !transaction.collapseLatched) {
      transaction.collapseLatched = true
    }
    const collapsed = configuration.collapseThreshold !== undefined
      && (
        crossedCollapseThreshold
        || transaction.collapseLatched
        || (!current.visible && requestedSize < configuration.minSize)
      )
    const next = collapsed
      ? { size: transaction.initialPart.size, visible: false }
      : {
          size: clamp(requestedSize, configuration.collapseThreshold ?? configuration.minSize, configuration.maxSize),
          visible: true,
        }
    if (current.size === next.size && current.visible === next.visible) return false
    this.replaceSnapshot(this.snapshot.parts, { partId: transaction.partId, preview: next })
    return true
  }

  endResize() {
    const transaction = this.resizeTransaction
    if (!transaction) return false
    const current = this.snapshot.resize!.preview
    const configuration = this.configurations.get(transaction.partId)!
    const committed = current.visible
      ? {
          ...current,
          size: clamp(current.size, configuration.minSize, configuration.maxSize),
        }
      : current
    const reopenDelay = configuration.collapseReopenDelayMs ?? 0
    if (!committed.visible && transaction.collapseLatched && reopenDelay > 0) {
      this.reopenBlockedUntil.set(transaction.partId, this.now() + reopenDelay)
    }
    const parts = replacePart(this.snapshot.parts, transaction.partId, committed)
    this.resizeTransaction = null
    this.replaceSnapshot(parts, null)
    return true
  }

  cancelResize() {
    if (!this.resizeTransaction) return false
    this.resizeTransaction = null
    this.replaceSnapshot(this.snapshot.parts, null)
    return true
  }

  dispose() {
    this.resizeTransaction = null
    this.reopenBlockedUntil.clear()
    this.listeners.clear()
  }

  private requirePart(partId: string) {
    const part = this.snapshot.parts[partId]
    if (!this.configurations.has(partId) || !part) throw new Error(`Unknown Workbench layout part: ${partId}`)
    return part
  }

  private requireResize() {
    if (!this.resizeTransaction) throw new Error("No Workbench resize is active.")
    return this.resizeTransaction
  }

  private replacePart(partId: string, part: WorkbenchLayoutPartSnapshot) {
    this.replaceSnapshot(replacePart(this.snapshot.parts, partId, part), this.snapshot.resize)
  }

  private replaceSnapshot(
    parts: WorkbenchLayoutSnapshot["parts"],
    resize: WorkbenchLayoutResizeSnapshot | null,
  ) {
    this.snapshot = createSnapshot(parts, resize)
    for (const listener of this.listeners) listener()
  }
}

function requireStandardParts(parts: Record<string, WorkbenchLayoutPartConfiguration> | undefined) {
  if (!parts || typeof parts !== "object") throw new Error("Workbench layout parts are required.")
  for (const partId of Object.values(WorkbenchLayoutParts)) {
    if (!Object.prototype.hasOwnProperty.call(parts, partId)) {
      throw new Error(`Workbench layout requires part: ${partId}`)
    }
  }
  if (parts[WorkbenchLayoutParts.SecondarySidebar]?.collapseThreshold === undefined) {
    throw new Error("Workbench secondary sidebar requires a collapse threshold.")
  }
}

function validateConfiguration(partId: string, input: WorkbenchLayoutPartConfiguration) {
  if (!partId) throw new Error("Workbench layout part id is required.")
  if (!input || typeof input !== "object") throw new Error(`Workbench layout configuration is invalid: ${partId}`)
  requireFiniteNumber(input.initialSize, `${partId} initial size`)
  requireFiniteNumber(input.minSize, `${partId} minimum size`)
  requireFiniteNumber(input.maxSize, `${partId} maximum size`)
  if (input.minSize < 0 || input.maxSize < input.minSize) {
    throw new Error(`Workbench layout size constraints are invalid: ${partId}`)
  }
  if (input.initialSize < input.minSize || input.initialSize > input.maxSize) {
    throw new Error(`Workbench initial size is outside its constraints: ${partId}`)
  }
  if (typeof input.initialVisible !== "boolean") {
    throw new Error(`Workbench initial visibility is invalid: ${partId}`)
  }
  if (input.collapseThreshold !== undefined) {
    requireFiniteNumber(input.collapseThreshold, `${partId} collapse threshold`)
    if (input.collapseThreshold < 0 || input.collapseThreshold >= input.initialSize) {
      throw new Error(`Workbench collapse threshold is outside its constraints: ${partId}`)
    }
  }
  if (input.collapseReopenDelayMs !== undefined) {
    requireFiniteNumber(input.collapseReopenDelayMs, `${partId} collapse reopen delay`)
    if (input.collapseThreshold === undefined || input.collapseReopenDelayMs < 0) {
      throw new Error(`Workbench collapse reopen delay is invalid: ${partId}`)
    }
  }
  return Object.freeze({ ...input })
}

function replacePart(
  parts: WorkbenchLayoutSnapshot["parts"],
  partId: string,
  part: WorkbenchLayoutPartSnapshot,
) {
  return Object.freeze({ ...parts, [partId]: Object.freeze({ ...part }) })
}

function createSnapshot(
  parts: WorkbenchLayoutSnapshot["parts"],
  resize: WorkbenchLayoutResizeSnapshot | null,
): WorkbenchLayoutSnapshot {
  return Object.freeze({
    parts: Object.freeze(parts),
    resize: resize
      ? Object.freeze({ ...resize, preview: Object.freeze({ ...resize.preview }) })
      : null,
  })
}

function requireFiniteNumber(value: number, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite.`)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}
