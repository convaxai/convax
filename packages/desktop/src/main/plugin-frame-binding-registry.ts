export interface PluginFrameBindingFrame {
  readonly detached: boolean
  readonly frameToken: string
  readonly frameTreeNodeId: number
  readonly processId: number
  readonly routingId: number
  isDestroyed(): boolean
}

export interface PluginFrameBindingIdentity<Owner extends object> {
  readonly frameToken: string
  readonly frameTreeNodeId: number
  readonly owner: Owner
  readonly processId: number
  readonly routingId: number
}

interface PluginFrameBindingEntry<Owner extends object, Frame extends PluginFrameBindingFrame> {
  readonly binding: string
  readonly frame: Frame
  readonly identity: PluginFrameBindingIdentity<Owner>
}

/**
 * Window-local navigation authority for sandboxed Plugin frames.
 *
 * Electron exposes destruction on WebContents, but WebFrameMain only exposes
 * isDestroyed/detached state. The composition root therefore retires the whole
 * registry on WebContents destruction and asks this registry to sweep individual
 * subframes on frame creation, navigation, and a bounded maintenance interval.
 */
export class PluginFrameBindingRegistry<Owner extends object, Frame extends PluginFrameBindingFrame> {
  private readonly entries = new Map<number, PluginFrameBindingEntry<Owner, Frame>>()
  private disposed = false

  constructor(private readonly owner: Owner) {}

  bind(owner: Owner, frame: Frame, binding: string): PluginFrameBindingIdentity<Owner> {
    this.requireOwner(owner)
    if (this.disposed) throw new Error("Plugin frame binding registry is disposed")
    if (!binding) throw new TypeError("Plugin frame binding must not be empty")
    const identity = captureFrameIdentity(owner, frame)
    this.entries.set(identity.frameTreeNodeId, { binding, frame, identity })
    return identity
  }

  bindingFor(owner: Owner, frame: Frame): string | undefined {
    this.requireOwner(owner)
    if (this.disposed) return undefined
    const identity = tryCaptureFrameIdentity(owner, frame)
    if (!identity) {
      this.retireObservedFrame(frame)
      return undefined
    }
    const entry = this.entries.get(identity.frameTreeNodeId)
    if (!entry) return undefined
    if (!sameFrameIdentity(entry.identity, identity)) {
      if (isUnavailableEntry(entry)) this.entries.delete(identity.frameTreeNodeId)
      return undefined
    }
    return entry.binding
  }

  retire(identity: PluginFrameBindingIdentity<Owner>) {
    this.requireOwner(identity.owner)
    if (this.disposed) return false
    const entry = this.entries.get(identity.frameTreeNodeId)
    if (!entry || !sameFrameIdentity(entry.identity, identity)) return false
    this.entries.delete(identity.frameTreeNodeId)
    return true
  }

  retireUnavailable(owner: Owner) {
    this.requireOwner(owner)
    if (this.disposed) return 0
    let retired = 0
    for (const [frameTreeNodeId, entry] of this.entries) {
      if (!isUnavailableEntry(entry)) continue
      this.entries.delete(frameTreeNodeId)
      retired += 1
    }
    return retired
  }

  clear(owner: Owner) {
    this.requireOwner(owner)
    const retired = this.entries.size
    this.entries.clear()
    return retired
  }

  dispose(owner: Owner) {
    this.requireOwner(owner)
    if (this.disposed) return
    this.disposed = true
    this.entries.clear()
  }

  get activeBindingCount() {
    return this.entries.size
  }

  private retireObservedFrame(frame: Frame) {
    for (const [frameTreeNodeId, entry] of this.entries) {
      if (entry.frame !== frame) continue
      this.entries.delete(frameTreeNodeId)
      return
    }
  }

  private requireOwner(owner: Owner) {
    if (owner !== this.owner) throw new Error("Plugin frame binding belongs to another WebContents")
  }
}

function captureFrameIdentity<Owner extends object>(
  owner: Owner,
  frame: PluginFrameBindingFrame,
): PluginFrameBindingIdentity<Owner> {
  const identity = tryCaptureFrameIdentity(owner, frame)
  if (!identity) throw new Error("Plugin frame is unavailable")
  return identity
}

function tryCaptureFrameIdentity<Owner extends object>(
  owner: Owner,
  frame: PluginFrameBindingFrame,
): PluginFrameBindingIdentity<Owner> | undefined {
  try {
    if (frame.isDestroyed() || frame.detached) return undefined
    const identity = {
      frameToken: frame.frameToken,
      frameTreeNodeId: frame.frameTreeNodeId,
      owner,
      processId: frame.processId,
      routingId: frame.routingId,
    }
    if (
      !identity.frameToken ||
      !Number.isSafeInteger(identity.frameTreeNodeId) ||
      identity.frameTreeNodeId < 0 ||
      !Number.isSafeInteger(identity.processId) ||
      identity.processId < 0 ||
      !Number.isSafeInteger(identity.routingId) ||
      identity.routingId < 0
    ) {
      return undefined
    }
    return identity
  } catch {
    return undefined
  }
}

function isUnavailableEntry<Owner extends object, Frame extends PluginFrameBindingFrame>(
  entry: PluginFrameBindingEntry<Owner, Frame>,
) {
  const current = tryCaptureFrameIdentity(entry.identity.owner, entry.frame)
  return !current || !sameFrameIdentity(entry.identity, current)
}

function sameFrameIdentity<Owner extends object>(
  left: PluginFrameBindingIdentity<Owner>,
  right: PluginFrameBindingIdentity<Owner>,
) {
  return (
    left.owner === right.owner &&
    left.frameTreeNodeId === right.frameTreeNodeId &&
    left.frameToken === right.frameToken &&
    left.processId === right.processId &&
    left.routingId === right.routingId
  )
}
