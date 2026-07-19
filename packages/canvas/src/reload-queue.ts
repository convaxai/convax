/**
 * Coalesces concurrent reload requests without dropping a request that arrives
 * while an earlier reload is still reading the document.
 */
export class CanvasReloadQueue {
  private completedRequest = 0
  private latestReload: (() => Promise<void>) | undefined
  private requested = 0
  private running: Promise<void> | undefined

  request(reload: () => Promise<void>): Promise<void> {
    this.latestReload = reload
    const requested = ++this.requested
    return this.waitFor(requested)
  }

  private async drain(): Promise<void> {
    while (this.completedRequest < this.requested) {
      const requested = this.requested
      const reload = this.latestReload
      if (!reload) return
      await reload()
      this.completedRequest = requested
    }
  }

  private async waitFor(requested: number): Promise<void> {
    while (this.completedRequest < requested) {
      if (!this.running) this.running = this.drain()
      const running = this.running
      try {
        await running
      } finally {
        if (this.running === running) this.running = undefined
      }
    }
  }
}
