import type { DesktopPluginHostCommand } from "../plugin-host-protocol"

export interface DesktopPluginFrameRef {
  activeRevision: number
  activeSetDigest: string
  canvasId: string
  nodeId: string
  pluginId: string
  pluginVersion: string
  projectId: string
  snapshotDigest: string
}

export interface DesktopPluginFrameRegistration extends DesktopPluginFrameRef {
  send(command: DesktopPluginHostCommand): void
}

const desktopPluginFrameLeaseBrand: unique symbol = Symbol("DesktopPluginFrameLease")

/**
 * Opaque renderer-local authority for one exact iframe registration generation.
 * A node-scoped reference alone is insufficient because a remounted or upgraded
 * Plugin can reuse the same Project, Canvas, node and Plugin ids.
 */
export interface DesktopPluginFrameLease extends DesktopPluginFrameRef {
  readonly [desktopPluginFrameLeaseBrand]: true
}

interface DesktopPluginFrameLeaseState {
  readonly frame: DesktopPluginFrameRegistration
  readonly registry: DesktopPluginFrameRegistry
}

const frameLeaseStates = new WeakMap<DesktopPluginFrameLease, DesktopPluginFrameLeaseState>()

function frameKey(ref: DesktopPluginFrameRef) {
  return JSON.stringify([
    ref.projectId,
    ref.canvasId,
    ref.nodeId,
    ref.pluginId,
    ref.pluginVersion,
    ref.activeRevision,
    ref.activeSetDigest,
    ref.snapshotDigest,
  ])
}

export class DesktopPluginFrameRegistry {
  private readonly frames = new Map<string, DesktopPluginFrameRegistration>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  getVersion = () => this.version

  has(ref: DesktopPluginFrameRef) {
    return this.frames.has(frameKey(ref))
  }

  capture(ref: DesktopPluginFrameRef): DesktopPluginFrameLease | undefined {
    const frame = this.frames.get(frameKey(ref))
    if (!frame) return undefined
    const lease = Object.freeze({
      activeRevision: frame.activeRevision,
      activeSetDigest: frame.activeSetDigest,
      [desktopPluginFrameLeaseBrand]: true as const,
      canvasId: frame.canvasId,
      nodeId: frame.nodeId,
      pluginId: frame.pluginId,
      pluginVersion: frame.pluginVersion,
      projectId: frame.projectId,
      snapshotDigest: frame.snapshotDigest,
    })
    frameLeaseStates.set(lease, { frame, registry: this })
    return lease
  }

  register(frame: DesktopPluginFrameRegistration) {
    const key = frameKey(frame)
    const existing = this.frames.get(key)
    if (existing && existing !== frame) throw new Error("Plugin frame is already registered for this Canvas node")
    this.frames.set(key, frame)
    this.emit()
    return () => {
      if (this.frames.get(key) !== frame) return
      this.frames.delete(key)
      this.emit()
    }
  }

  send(ref: DesktopPluginFrameRef, command: DesktopPluginHostCommand) {
    const frame = this.frames.get(frameKey(ref))
    if (!frame) return false
    frame.send(command)
    return true
  }

  sendExact(lease: DesktopPluginFrameLease, command: DesktopPluginHostCommand) {
    const state = frameLeaseStates.get(lease)
    if (!state || state.registry !== this) return false
    if (this.frames.get(frameKey(lease)) !== state.frame) return false
    state.frame.send(command)
    return true
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }
}
