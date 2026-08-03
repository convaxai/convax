export interface CapturedPointerDragClock {
  cancelFrame(frameId: number): void
  requestFrame(callback: () => void): number
}

export interface CapturedPointerTarget extends EventTarget {
  hasPointerCapture(pointerId: number): boolean
  releasePointerCapture(pointerId: number): void
  setPointerCapture(pointerId: number): void
}

export interface CapturedPointerDragSession {
  cancel(): void
}

export interface CapturedPointerDragOptions {
  cancel(): void
  captureTarget?: CapturedPointerTarget
  clock?: CapturedPointerDragClock
  commit(): void
  eventSource?: EventTarget
  onSettled?(): void
  pointerId: number
  suppressClickAfterCommit?: boolean
  /** Return `commit` when the current update reaches a terminal drag state. */
  update(clientX: number): "commit" | undefined
}

/** Keeps the originating separator alive until its resize transaction settles. */
export function shouldMountResizeHandle(partVisible: boolean, resizing: boolean) {
  return partVisible || resizing
}

function browserClock(): CapturedPointerDragClock {
  return {
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
  }
}

/**
 * Owns one horizontal drag, optionally with pointer capture. Raw moves are
 * reduced to the last coordinate in each animation frame. A terminal update
 * commits immediately; otherwise the exact pointer-up coordinate is flushed.
 */
export function startCapturedPointerDrag(options: CapturedPointerDragOptions): CapturedPointerDragSession | null {
  const source = options.eventSource ?? window
  const clock = options.clock ?? browserClock()
  let frameId: number | null = null
  let pendingClientX: number | null = null
  let clickSuppressionFrameId: number | null = null
  let settled = false

  const clearCommittedClickSuppression = () => {
    if (clickSuppressionFrameId !== null) {
      clock.cancelFrame(clickSuppressionFrameId)
      clickSuppressionFrameId = null
    }
    source.removeEventListener("click", suppressCommittedClick, true)
    source.removeEventListener("pointerup", finishCommittedClickSuppression, true)
    source.removeEventListener("pointercancel", clearCommittedClickSuppression, true)
    source.removeEventListener("blur", clearCommittedClickSuppression, true)
  }
  const suppressCommittedClick = (event: Event) => {
    const eventPointerId =
      "pointerId" in event && typeof event.pointerId === "number"
        ? event.pointerId
        : null
    if (eventPointerId !== null && eventPointerId !== options.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    clearCommittedClickSuppression()
  }
  const finishCommittedClickSuppression = (event: Event) => {
    const pointer = pointerEvent(event)
    if (!pointer || pointer.pointerId !== options.pointerId) return
    source.removeEventListener("pointerup", finishCommittedClickSuppression, true)
    source.removeEventListener("pointercancel", clearCommittedClickSuppression, true)
    source.removeEventListener("blur", clearCommittedClickSuppression, true)
    clickSuppressionFrameId = clock.requestFrame(() => {
      clickSuppressionFrameId = null
      source.removeEventListener("click", suppressCommittedClick, true)
    })
  }
  const armCommittedClickSuppression = (pointerReleased: boolean) => {
    if (!options.suppressClickAfterCommit) return
    source.addEventListener("click", suppressCommittedClick, true)
    if (pointerReleased) {
      clickSuppressionFrameId = clock.requestFrame(() => {
        clickSuppressionFrameId = null
        source.removeEventListener("click", suppressCommittedClick, true)
      })
      return
    }
    source.addEventListener("pointerup", finishCommittedClickSuppression, true)
    source.addEventListener("pointercancel", clearCommittedClickSuppression, true)
    source.addEventListener("blur", clearCommittedClickSuppression, true)
  }
  const flushPending = () => {
    frameId = null
    const clientX = pendingClientX
    pendingClientX = null
    if (clientX === null) return
    try {
      applyUpdate(clientX, false)
    } catch (error) {
      cancel()
      throw error
    }
  }
  const cancelPending = () => {
    if (frameId !== null) clock.cancelFrame(frameId)
    frameId = null
    pendingClientX = null
  }
  const schedule = (clientX: number) => {
    pendingClientX = clientX
    if (frameId === null) frameId = clock.requestFrame(flushPending)
  }
  const pointerEvent = (event: Event) => {
    if (
      !("pointerId" in event) ||
      typeof event.pointerId !== "number" ||
      !("clientX" in event) ||
      typeof event.clientX !== "number"
    ) {
      return null
    }
    return { clientX: event.clientX, pointerId: event.pointerId }
  }
  const move = (event: Event) => {
    const pointer = pointerEvent(event)
    if (!pointer || pointer.pointerId !== options.pointerId) return
    schedule(pointer.clientX)
  }
  const commit = (pointerReleased: boolean) => {
    if (settled) return false
    settled = true
    cancelPending()
    detach()
    releaseCapture()
    armCommittedClickSuppression(pointerReleased)
    try {
      options.commit()
    } catch (error) {
      options.cancel()
      throw error
    } finally {
      options.onSettled?.()
    }
    return true
  }
  const applyUpdate = (clientX: number, pointerReleased: boolean) => {
    if (options.update(clientX) !== "commit") return false
    commit(pointerReleased)
    return true
  }
  const finish = (event: Event) => {
    const pointer = pointerEvent(event)
    if (!pointer || pointer.pointerId !== options.pointerId || settled) return
    cancelPending()
    try {
      if (!applyUpdate(pointer.clientX, true)) commit(true)
    } catch (error) {
      cancel()
      throw error
    }
  }
  const cancel = (event?: Event) => {
    if (settled) return
    if (event?.type === "pointercancel" || event?.type === "lostpointercapture") {
      const pointer = pointerEvent(event)
      if (!pointer || pointer.pointerId !== options.pointerId) return
    }
    settled = true
    cancelPending()
    detach()
    releaseCapture()
    try {
      options.cancel()
    } finally {
      options.onSettled?.()
    }
  }
  const detach = () => {
    source.removeEventListener("pointermove", move, true)
    source.removeEventListener("pointerup", finish, true)
    source.removeEventListener("pointercancel", cancel, true)
    source.removeEventListener("blur", cancel, true)
    options.captureTarget?.removeEventListener("lostpointercapture", cancel)
  }
  const releaseCapture = () => {
    if (options.captureTarget?.hasPointerCapture(options.pointerId)) {
      options.captureTarget.releasePointerCapture(options.pointerId)
    }
  }

  source.addEventListener("pointermove", move, true)
  source.addEventListener("pointerup", finish, true)
  source.addEventListener("pointercancel", cancel, true)
  source.addEventListener("blur", cancel, true)
  if (options.captureTarget) {
    options.captureTarget.addEventListener("lostpointercapture", cancel)
    try {
      options.captureTarget.setPointerCapture(options.pointerId)
    } catch {
      cancel()
      return null
    }
  }

  return { cancel }
}
