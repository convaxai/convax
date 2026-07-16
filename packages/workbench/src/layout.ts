export const WorkbenchLayoutParts = {
  PrimarySidebar: "primary-sidebar",
  SecondarySidebar: "secondary-sidebar",
} as const

export type WorkbenchStandardLayoutPartId = typeof WorkbenchLayoutParts[keyof typeof WorkbenchLayoutParts]

export interface WorkbenchLayoutPartConfiguration {
  /** Raw requested size at or below this value collapses the part. */
  collapseThreshold?: number
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
  parts: WorkbenchLayoutPartsConfiguration
}

export interface WorkbenchLayoutPartSnapshot {
  /** The expanded size. It remains available while the part is hidden. */
  size: number
  visible: boolean
}

export interface WorkbenchLayoutResizeSnapshot {
  partId: string
}

export interface WorkbenchLayoutSnapshot {
  parts: Readonly<Record<string, Readonly<WorkbenchLayoutPartSnapshot>>>
  resize: Readonly<WorkbenchLayoutResizeSnapshot> | null
}

interface ResizeTransaction {
  initialPart: Readonly<WorkbenchLayoutPartSnapshot>
  partId: string
}

/** DOM-free state and transaction controller for Workbench layout parts. */
export class WorkbenchLayoutController {
  private readonly configurations = new Map<string, Readonly<WorkbenchLayoutPartConfiguration>>()
  private readonly listeners = new Set<() => void>()
  private resizeTransaction: ResizeTransaction | null = null
  private snapshot: WorkbenchLayoutSnapshot

  constructor(options: WorkbenchLayoutControllerOptions) {
    requireStandardParts(options.parts)
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
    this.replacePart(partId, { ...part, visible })
    return true
  }

  togglePartVisibility(partId: string) {
    const part = this.requirePart(partId)
    return this.setPartVisible(partId, !part.visible)
  }

  beginResize(partId: string) {
    const part = this.requirePart(partId)
    if (this.resizeTransaction) throw new Error("A Workbench resize is already active.")
    if (!part.visible) return false
    this.resizeTransaction = { initialPart: part, partId }
    this.replaceSnapshot(this.snapshot.parts, { partId })
    return true
  }

  /** Updates from the beginResize baseline; a positive delta grows the part. */
  updateResize(delta: number) {
    const transaction = this.requireResize()
    requireFiniteNumber(delta, "Workbench resize delta")
    const requestedSize = transaction.initialPart.size + delta
    if (!Number.isFinite(requestedSize)) throw new Error("Workbench requested size must be finite.")
    const configuration = this.configurations.get(transaction.partId)!
    const next = configuration.collapseThreshold !== undefined
      && requestedSize <= configuration.collapseThreshold
      ? { size: transaction.initialPart.size, visible: false }
      : {
          size: clamp(requestedSize, configuration.minSize, configuration.maxSize),
          visible: true,
        }
    const current = this.snapshot.parts[transaction.partId]!
    if (current.size === next.size && current.visible === next.visible) return false
    this.replacePart(transaction.partId, next)
    return true
  }

  endResize() {
    if (!this.resizeTransaction) return false
    this.resizeTransaction = null
    this.replaceSnapshot(this.snapshot.parts, null)
    return true
  }

  cancelResize() {
    const transaction = this.resizeTransaction
    if (!transaction) return false
    this.resizeTransaction = null
    const parts = replacePart(this.snapshot.parts, transaction.partId, transaction.initialPart)
    this.replaceSnapshot(parts, null)
    return true
  }

  dispose() {
    this.resizeTransaction = null
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
  return Object.freeze({ parts: Object.freeze(parts), resize: resize ? Object.freeze({ ...resize }) : null })
}

function requireFiniteNumber(value: number, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite.`)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}
