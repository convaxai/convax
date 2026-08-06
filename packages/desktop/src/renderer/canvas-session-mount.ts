import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { DesktopCanvasRendererSession } from "./canvas-collaboration-client"

export const canvasGenerationReconcileObservationTimeoutMs = 10_000

export type CanvasSessionReconcileDiagnostic = Readonly<{
  code: "generation-reconcile-failed" | "generation-reconcile-timed-out"
  ref: CanvasDocumentRef
}>

type ScheduleTimeout = (callback: () => void, timeoutMs: number) => () => void

export interface CanvasSessionMountOptions {
  readonly onDiagnostic: (diagnostic: CanvasSessionReconcileDiagnostic) => void
  readonly onMountFailure: (error: unknown) => void
  readonly onMounted: (session: DesktopCanvasRendererSession) => void
  readonly openSession: (signal: AbortSignal) => Promise<DesktopCanvasRendererSession>
  readonly reconcileCanvas: (ref: CanvasDocumentRef) => Promise<unknown>
  readonly reconcileObservationTimeoutMs?: number
  readonly ref: CanvasDocumentRef
  readonly scheduleTimeout?: ScheduleTimeout
}

/**
 * Owns one renderer Canvas scope. The owner session becomes mountable after its
 * authoritative refresh; generation reconciliation is only observed in the
 * background and can never turn a mounted session into a mount failure.
 */
export function mountCanvasSessionWithBackgroundReconcile(options: CanvasSessionMountOptions): () => void {
  const controller = new AbortController()
  const ref = Object.freeze({ ...options.ref })
  let disposed = false
  let session: DesktopCanvasRendererSession | null = null
  let stopReconcileObservation: () => void = () => undefined

  const disposeSession = () => {
    const current = session
    session = null
    current?.dispose()
  }

  void (async () => {
    try {
      const opened = await options.openSession(controller.signal)
      session = opened
      throwIfDisposed(disposed, controller.signal)
      await opened.refresh(controller.signal)
      throwIfDisposed(disposed, controller.signal)
      options.onMounted(opened)
      stopReconcileObservation = observeBackgroundReconcile({
        onDiagnostic: options.onDiagnostic,
        reconcileCanvas: options.reconcileCanvas,
        ref,
        refreshSession: (signal) => opened.refresh(signal),
        scheduleTimeout: options.scheduleTimeout ?? scheduleTimeout,
        signal: controller.signal,
        timeoutMs: options.reconcileObservationTimeoutMs ?? canvasGenerationReconcileObservationTimeoutMs,
      })
    } catch (error) {
      disposeSession()
      if (!disposed && !controller.signal.aborted) options.onMountFailure(error)
    }
  })()

  return () => {
    if (disposed) return
    disposed = true
    controller.abort(new DOMException("Canvas renderer scope changed", "AbortError"))
    stopReconcileObservation()
    disposeSession()
  }
}

function observeBackgroundReconcile(input: {
  readonly onDiagnostic: (diagnostic: CanvasSessionReconcileDiagnostic) => void
  readonly reconcileCanvas: (ref: CanvasDocumentRef) => Promise<unknown>
  readonly ref: CanvasDocumentRef
  readonly refreshSession: (signal: AbortSignal) => Promise<void>
  readonly scheduleTimeout: ScheduleTimeout
  readonly signal: AbortSignal
  readonly timeoutMs: number
}): () => void {
  let finished = false
  const cancelTimeout = input.scheduleTimeout(() => {
    if (finished || input.signal.aborted) return
    finished = true
    input.onDiagnostic({ code: "generation-reconcile-timed-out", ref: input.ref })
  }, input.timeoutMs)

  void Promise.resolve()
    .then(async () => {
      if (input.signal.aborted) return
      await input.reconcileCanvas(input.ref)
      if (!input.signal.aborted) await input.refreshSession(input.signal)
    })
    .then(
      () => {
        if (finished) return
        finished = true
        cancelTimeout()
      },
      () => {
        if (finished || input.signal.aborted) return
        finished = true
        cancelTimeout()
        input.onDiagnostic({ code: "generation-reconcile-failed", ref: input.ref })
      },
    )

  return () => {
    if (finished) return
    finished = true
    cancelTimeout()
  }
}

function scheduleTimeout(callback: () => void, timeoutMs: number): () => void {
  const handle = globalThis.setTimeout(callback, timeoutMs)
  return () => globalThis.clearTimeout(handle)
}

function throwIfDisposed(disposed: boolean, signal: AbortSignal): void {
  if (!disposed && !signal.aborted) return
  throw signal.reason ?? new DOMException("Canvas renderer scope changed", "AbortError")
}
