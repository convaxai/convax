export type CanvasExternalMutationOutcome = "committed" | "aborted"

export interface CanvasExternalMutationLeaseCallbacks {
  enter: () => void
  flush: () => Promise<void>
  reloadCommitted: () => Promise<void>
  release: () => void
}

type CanvasExternalMutationLeaseState = "idle" | "beginning" | "active" | "ending"

/** Coordinates exactly one host mutation while the mounted editor is quiescent. */
export class CanvasExternalMutationLeaseController {
  #state: CanvasExternalMutationLeaseState = "idle"

  constructor(private readonly callbacks: CanvasExternalMutationLeaseCallbacks) {}

  get locked() {
    return this.#state !== "idle"
  }

  async begin(signal?: AbortSignal): Promise<void> {
    if (this.#state !== "idle") throw new Error("A Canvas external mutation is already active")
    throwIfAborted(signal)
    this.#state = "beginning"
    try {
      this.callbacks.enter()
      throwIfAborted(signal)
      await waitForSignal(this.callbacks.flush(), signal)
      throwIfAborted(signal)
      this.#state = "active"
    } catch (error) {
      this.#state = "idle"
      this.callbacks.release()
      throw error
    }
  }

  async end(outcome: CanvasExternalMutationOutcome): Promise<void> {
    if (this.#state !== "active") throw new Error("No active Canvas external mutation can be ended")
    if (outcome !== "committed" && outcome !== "aborted") {
      throw new Error(`Unsupported Canvas external mutation outcome: ${String(outcome)}`)
    }
    this.#state = "ending"
    try {
      if (outcome === "committed") await this.callbacks.reloadCommitted()
    } finally {
      this.#state = "idle"
      this.callbacks.release()
    }
  }
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException("Canvas external mutation preparation was canceled", "AbortError")
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal)
}

function waitForSignal(promise: Promise<void>, signal?: AbortSignal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortError(signal))
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    void promise.then(
      () => {
        cleanup()
        resolve()
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}
