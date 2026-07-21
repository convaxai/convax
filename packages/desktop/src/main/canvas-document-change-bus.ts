import type {
  PluginCanvasChangeEvent,
  PluginCanvasEventSubscription,
  PluginCanvasRef,
} from "../plugin-capability-contracts"
import type { PluginCanvasChangeBus } from "./plugin-canvas-capability-service"

interface Listener {
  filter: PluginCanvasRef | { projectId: string }
  listener(event: PluginCanvasChangeEvent): void
}

const maximumTrackedCanvases = 10_000

/**
 * Process-local invalidation bus. It carries identities and revisions only;
 * document bodies and resource bytes are always re-read through capability
 * services with fresh authorization checks.
 */
export class CanvasDocumentChangeBus implements PluginCanvasChangeBus {
  private readonly latestRevisionByCanvas = new Map<string, number>()
  private readonly listeners = new Set<Listener>()

  publish(event: PluginCanvasChangeEvent) {
    const safeEvent = structuredClone(event)
    const key = JSON.stringify([safeEvent.ref.projectId, safeEvent.ref.canvasId])
    const latest = this.latestRevisionByCanvas.get(key)
    if (latest !== undefined && latest >= safeEvent.revision) return
    this.latestRevisionByCanvas.set(key, safeEvent.revision)
    if (this.latestRevisionByCanvas.size > maximumTrackedCanvases) {
      this.latestRevisionByCanvas.delete(this.latestRevisionByCanvas.keys().next().value ?? "")
    }
    for (const item of [...this.listeners]) {
      if (item.filter.projectId !== safeEvent.ref.projectId) continue
      if ("canvasId" in item.filter && item.filter.canvasId !== safeEvent.ref.canvasId) continue
      item.listener(structuredClone(safeEvent))
    }
  }

  subscribe(
    filter: PluginCanvasRef | { projectId: string },
    listener: (event: PluginCanvasChangeEvent) => void,
  ): PluginCanvasEventSubscription {
    const item = { filter: structuredClone(filter), listener }
    this.listeners.add(item)
    return { close: () => this.listeners.delete(item) }
  }
}
