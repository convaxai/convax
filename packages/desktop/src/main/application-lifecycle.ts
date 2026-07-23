export interface ApplicationWillQuitLifecycle {
  once(event: "will-quit", listener: () => void): unknown
}

export interface MainWindowReference {
  isDestroyed(): boolean
}

export interface ApplicationActivateLifecycle {
  on(event: "activate", listener: () => void): unknown
}

export interface DemandDrivenAsyncLifecycleOptions {
  onError?(error: unknown): void
  start(): Promise<unknown> | unknown
  stop(): void
}

export interface DemandDrivenAsyncLifecycle {
  acquire(): () => void
  dispose(): Promise<void>
}

export function createDetachedAsyncCallback<Arguments extends unknown[]>(
  operation: (...args: Arguments) => Promise<unknown> | unknown,
  onError: (error: unknown) => void = () => undefined,
) {
  const report = (error: unknown) => {
    try {
      onError(error)
    } catch {}
  }
  return (...args: Arguments): void => {
    try {
      void Promise.resolve(operation(...args)).catch(report)
    } catch (error) {
      report(error)
    }
  }
}

export function createDemandDrivenAsyncLifecycle(
  options: DemandDrivenAsyncLifecycleOptions,
): DemandDrivenAsyncLifecycle {
  let desired = false
  let disposed = false
  let disposePromise: Promise<void> | undefined
  let epoch = 0
  let leases = 0
  let tail = Promise.resolve()

  const report = (error: unknown) => {
    try {
      options.onError?.(error)
    } catch {}
  }
  const stop = () => {
    try {
      options.stop()
    } catch (error) {
      report(error)
    }
  }
  const scheduleStart = () => {
    const request = ++epoch
    tail = tail.then(async () => {
      if (disposed || !desired || request !== epoch) return
      let failed = false
      try {
        await options.start()
      } catch (error) {
        failed = true
        report(error)
      }
      if (failed || disposed || !desired || request !== epoch) stop()
    })
  }

  return {
    acquire() {
      if (disposed) throw new Error("Demand-driven lifecycle is disposed")
      leases += 1
      if (leases === 1) {
        desired = true
        scheduleStart()
      }
      let released = false
      return () => {
        if (released) return
        released = true
        leases = Math.max(0, leases - 1)
        if (leases !== 0) return
        desired = false
        epoch += 1
        stop()
      }
    },
    dispose() {
      if (disposePromise) return disposePromise
      disposed = true
      desired = false
      leases = 0
      epoch += 1
      stop()
      disposePromise = tail.then(() => undefined)
      return disposePromise
    },
  }
}

export function createIdempotentAsyncCleanup(cleanups: readonly (() => Promise<unknown> | unknown)[]) {
  let cleanupPromise: Promise<void> | undefined
  return () => {
    cleanupPromise ??= (async () => {
      for (const cleanup of cleanups) await cleanup()
    })()
    return cleanupPromise
  }
}

export function registerMainWindowActivation(
  application: ApplicationActivateLifecycle,
  getMainWindow: () => MainWindowReference | null,
  createMainWindow: () => void,
) {
  application.on("activate", () => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) return
    createMainWindow()
  })
}

export function registerWillQuitCleanup(
  application: ApplicationWillQuitLifecycle,
  cleanups: readonly (() => void)[],
  onError: (error: unknown, index: number) => void,
) {
  application.once("will-quit", () => {
    cleanups.forEach((cleanup, index) => {
      try {
        cleanup()
      } catch (error) {
        onError(error, index)
      }
    })
  })
}
