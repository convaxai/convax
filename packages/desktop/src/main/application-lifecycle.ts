export interface ApplicationWillQuitLifecycle {
  once(event: "will-quit", listener: () => void): unknown
}

export interface MainWindowReference {
  isDestroyed(): boolean
}

export interface ApplicationActivateLifecycle {
  on(event: "activate", listener: () => void): unknown
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
