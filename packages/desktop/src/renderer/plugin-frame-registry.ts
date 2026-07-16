import type { DesktopPluginHostCommand } from "../plugin-host-protocol"

export interface DesktopPluginFrameRef {
  canvasId: string
  nodeId: string
  pluginId: string
  projectId: string
}

export interface DesktopPluginFrameRegistration extends DesktopPluginFrameRef {
  send(command: DesktopPluginHostCommand): void
}

function frameKey(ref: DesktopPluginFrameRef) {
  return JSON.stringify([ref.projectId, ref.canvasId, ref.nodeId, ref.pluginId])
}

export class DesktopPluginFrameRegistry {
  private readonly frames = new Map<string, DesktopPluginFrameRegistration>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  getVersion = () => this.version

  has(ref: DesktopPluginFrameRef) {
    return this.frames.has(frameKey(ref))
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

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.version += 1
    this.listeners.forEach((listener) => listener())
  }
}
