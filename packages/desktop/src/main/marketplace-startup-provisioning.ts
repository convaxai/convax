export interface MarketplaceStartupProvisioningOptions {
  provision(): Promise<void>
  report(diagnostic: { errorType: string }): void
}

export type MarketplaceStartupProvisioningResult =
  | { readonly ok: true }
  | { readonly errorType: string; readonly ok: false }

export interface MarketplaceStartupProvisioning {
  /** Returns the one process-lifetime task, starting it on the first call. */
  start(): Promise<MarketplaceStartupProvisioningResult>
  /** Prevents a later start and drains only a task that was already admitted. */
  closeAndDrainStarted(): Promise<MarketplaceStartupProvisioningResult | null>
}

/**
 * Returns one process-lifetime startup task. Window lifecycle callers may start it
 * repeatedly, but provisioning is admitted once and failures stay contained in the
 * background task.
 */
export function createMarketplaceStartupProvisioning(
  options: MarketplaceStartupProvisioningOptions,
): MarketplaceStartupProvisioning {
  let closed = false
  const closedResult = Promise.resolve({ errorType: "MarketplaceStartupProvisioningClosed", ok: false } as const)
  let task: Promise<MarketplaceStartupProvisioningResult> | undefined
  const start = () => {
    if (closed && !task) return closedResult
    task ??= (async (): Promise<MarketplaceStartupProvisioningResult> => {
      try {
        await options.provision()
        return { ok: true }
      } catch (error) {
        const failure = {
          errorType: error instanceof Error ? error.name : "UnknownError",
          ok: false,
        } as const
        try {
          options.report({ errorType: failure.errorType })
        } catch {
          // Diagnostic delivery must not turn a contained background failure
          // into a rejected task that can block Desktop shutdown.
        }
        return failure
      }
    })()
    return task
  }
  return Object.freeze({
    closeAndDrainStarted: () => {
      closed = true
      return task ?? Promise.resolve(null)
    },
    start,
  })
}
