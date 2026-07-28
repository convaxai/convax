/**
 * Tracks pointer sessions that began in the trusted host document.
 *
 * Embedded frames live in a separate browsing context, so the host must make
 * them non-interactive for the complete lifetime of a host-owned gesture.
 */
export class HostPointerReleaseGate {
  private pointerIds = new Set<number>()
  private waiting = false

  get pending() {
    return this.waiting
  }

  begin(pointerId: number) {
    const size = this.pointerIds.size
    this.waiting = true
    this.pointerIds.add(pointerId)
    return this.pointerIds.size !== size
  }

  release(pointerId: number) {
    if (!this.pointerIds.delete(pointerId)) return false
    return this.pointerIds.size === 0
  }

  releaseAll() {
    if (!this.waiting) return false
    this.pointerIds.clear()
    return true
  }

  complete() {
    if (!this.waiting || this.pointerIds.size > 0) return false
    this.waiting = false
    return true
  }
}
