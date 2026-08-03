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

const maximumTrackedOperations = 10_000

/**
 * Process-local invalidation bus. It carries identities and bounded operation receipts only;
 * document bodies and resource bytes are always re-read through capability
 * services with fresh authorization checks.
 */
export class CanvasDocumentChangeBus implements PluginCanvasChangeBus {
  private readonly allListeners = new Set<(event: PluginCanvasChangeEvent) => void>()
  private readonly seenOperations = new Set<string>()
  private readonly listeners = new Set<Listener>()

  publish(event: PluginCanvasChangeEvent) {
    const safeEvent = structuredClone(event)
    const key = JSON.stringify([
      safeEvent.ref.projectId,
      safeEvent.ref.canvasId,
      safeEvent.operationReceipt.actorId,
      safeEvent.operationReceipt.operationId,
    ])
    if (this.seenOperations.has(key)) return
    this.seenOperations.add(key)
    if (this.seenOperations.size > maximumTrackedOperations) {
      this.seenOperations.delete(this.seenOperations.values().next().value ?? "")
    }
    for (const item of [...this.listeners]) {
      if (item.filter.projectId !== safeEvent.ref.projectId) continue
      if ("canvasId" in item.filter && item.filter.canvasId !== safeEvent.ref.canvasId) continue
      item.listener(structuredClone(safeEvent))
    }
    for (const listener of [...this.allListeners]) listener(structuredClone(safeEvent))
  }

  subscribe(
    filter: PluginCanvasRef | { projectId: string },
    listener: (event: PluginCanvasChangeEvent) => void,
  ): PluginCanvasEventSubscription {
    const item = { filter: structuredClone(filter), listener }
    this.listeners.add(item)
    return { close: () => this.listeners.delete(item) }
  }

  subscribeAll(listener: (event: PluginCanvasChangeEvent) => void): PluginCanvasEventSubscription {
    // All-listeners are stored separately from scoped Plugin subscribers so a
    // renderer projection can observe every Main commit without widening a
    // Plugin's Project scope.
    this.allListeners.add(listener)
    return { close: () => this.allListeners.delete(listener) }
  }
}
