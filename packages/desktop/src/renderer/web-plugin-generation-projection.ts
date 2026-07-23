import type { PluginNodeInvocationRef } from "../plugin-host-types"

function projectionKey(ref: PluginNodeInvocationRef) {
  return JSON.stringify([ref.projectId, ref.canvasId])
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error("Plugin call was canceled")
}

async function waitForPendingProjection(pending: Promise<void>, signal: AbortSignal) {
  throwIfAborted(signal)
  let removeAbortListener: () => void = () => undefined
  try {
    await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(signal.reason ?? new Error("Plugin call was canceled"))
        signal.addEventListener("abort", onAbort, { once: true })
        removeAbortListener = () => signal.removeEventListener("abort", onAbort)
      }),
    ])
  } finally {
    removeAbortListener()
  }
}

interface PendingProjection {
  failed: boolean
  kind: "initial" | "recovery"
  pending: Promise<void>
  reloadAuthoritative: () => Promise<void>
}

/**
 * Keeps renderer reconciliation outside the Main-owned generation lifecycle,
 * while letting a following Plugin state write wait until that projection has
 * settled.
 */
export class WebPluginGenerationProjectionCoordinator {
  readonly #pending = new Map<string, PendingProjection>()

  async execute<Result>(
    ref: PluginNodeInvocationRef,
    execute: () => Promise<Result>,
    reloadAuthoritative: () => Promise<void>,
  ): Promise<Result> {
    try {
      return await execute()
    } finally {
      this.#schedule(ref, reloadAuthoritative)
    }
  }

  async wait(ref: PluginNodeInvocationRef, signal: AbortSignal): Promise<void> {
    const key = projectionKey(ref)
    let canRecover = false
    let observedEntry: PendingProjection | undefined
    while (true) {
      throwIfAborted(signal)
      const entry = this.#pending.get(key)
      if (!entry) return
      if (entry !== observedEntry) {
        observedEntry = entry
        canRecover = entry.failed || entry.kind === "initial"
      }
      if (!entry.failed && entry.kind === "recovery") canRecover = false
      if (entry.failed && canRecover) {
        canRecover = false
        this.#start(key, entry, "recovery")
      }
      const pending = entry.pending
      try {
        await waitForPendingProjection(pending, signal)
      } catch (error) {
        throwIfAborted(signal)
        if (this.#pending.get(key) !== entry || entry.pending !== pending) continue
        if (canRecover && entry.kind === "initial") {
          canRecover = false
          this.#start(key, entry, "recovery")
          continue
        }
        throw error
      }
      throwIfAborted(signal)
      if (this.#pending.get(key) === entry && entry.pending === pending) this.#pending.delete(key)
    }
  }

  #schedule(ref: PluginNodeInvocationRef, reloadAuthoritative: () => Promise<void>) {
    const key = projectionKey(ref)
    const entry: PendingProjection = {
      failed: false,
      kind: "initial",
      pending: Promise.resolve(),
      reloadAuthoritative,
    }
    this.#pending.set(key, entry)
    this.#start(key, entry, "initial")
  }

  #start(key: string, entry: PendingProjection, kind: PendingProjection["kind"]) {
    entry.failed = false
    entry.kind = kind
    const pending = Promise.resolve().then(entry.reloadAuthoritative)
    entry.pending = pending
    void pending.then(
      () => {
        if (this.#pending.get(key) === entry && entry.pending === pending) this.#pending.delete(key)
      },
      () => {
        if (this.#pending.get(key) === entry && entry.pending === pending) entry.failed = true
      },
    )
  }
}
