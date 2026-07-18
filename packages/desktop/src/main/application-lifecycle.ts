export interface ApplicationWillQuitLifecycle {
  once(event: "will-quit", listener: () => void): unknown
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
