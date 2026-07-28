export interface MarketplaceStartupProvisioningOptions {
  provision(): Promise<void>
  report(diagnostic: { errorType: string }): void
}

export async function provisionMarketplaceForStartup(options: MarketplaceStartupProvisioningOptions): Promise<void> {
  try {
    await options.provision()
  } catch (error) {
    options.report({
      errorType: error instanceof Error ? error.name : "UnknownError",
    })
  }
}
