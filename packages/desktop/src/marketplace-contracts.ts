export type MarketplaceCapabilityKind = "mcp-server" | "plugin" | "skill"
export type MarketplaceCapabilityState = "attention" | "disabled" | "ready" | "setup-required"

export interface MarketplaceCatalogSourceChoice {
  confirmationToken: string
  description: string
  marketplaceLabel: string
  name: string
  permissionSummary: string[]
  setup: "local-execution" | "none" | "remote-connection"
  version: string
}

export interface MarketplaceCatalogCard {
  description: string
  id: string
  installed?: {
    sourceLabel: string
    state: MarketplaceCapabilityState
    version: string
  }
  kind: MarketplaceCapabilityKind
  name: string
  otherSourceCount: number
  runtimeScope?: "agent" | "agent-and-convax"
}

export interface MarketplaceCatalogSnapshot {
  cards: MarketplaceCatalogCard[]
  revision: number
}

export interface MarketplaceSettingsSource {
  health: "attention" | "available" | "offline" | "refreshing"
  id: string
  label: string
  packageCount: number
  publisher: string
  repository: string
  removable: boolean
}

export interface MarketplaceAddPreview {
  label: string
  packageCount: number
  previewToken: string
  publisher: string
  repository: string
}

export interface MarketplaceInstalledCapability {
  attention?: string
  id: string
  kind: MarketplaceCapabilityKind
  name: string
  runtimeScope?: "agent" | "agent-and-convax"
  sourceLabel: string
  state: MarketplaceCapabilityState
  updateAvailable: boolean
  version: string
}

export interface MarketplaceInventory {
  capabilities: MarketplaceInstalledCapability[]
  revision: number
}

export interface MarketplaceClient {
  addMarketplace(input: { previewToken: string }): Promise<void>
  beginInstall(input: { id: string; kind: MarketplaceCapabilityKind }): Promise<MarketplaceCatalogSourceChoice[]>
  beginUpdate(input: { id: string; kind: MarketplaceCapabilityKind }): Promise<MarketplaceCatalogSourceChoice[]>
  confirmInstall(input: { confirmationToken: string }): Promise<{ selectionToken: string }>
  confirmUpdate(input: { confirmationToken: string }): Promise<{ selectionToken: string }>
  disable(input: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  enable(input: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  importCapability(): Promise<MarketplaceInstalledCapability | null>
  install(input: { selectionToken: string }): Promise<MarketplaceInstalledCapability>
  listCatalog(): Promise<MarketplaceCatalogSnapshot>
  listInstalled(): Promise<MarketplaceInventory>
  listMarketplaces(): Promise<MarketplaceSettingsSource[]>
  onDidChange(listener: () => void): () => void
  previewMarketplace(input: { url: string }): Promise<MarketplaceAddPreview>
  refreshMarketplace(input: { id: string }): Promise<void>
  removeMarketplace(input: { id: string }): Promise<void>
  setup(input: { id: string; kind: MarketplaceCapabilityKind }): Promise<MarketplaceInstalledCapability>
  uninstall(input: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  update(input: { selectionToken: string }): Promise<MarketplaceInstalledCapability>
}

export const marketplaceIpcChannels = {
  addMarketplace: "marketplace:add",
  beginInstall: "marketplace:install-begin",
  beginUpdate: "marketplace:update-begin",
  confirmInstall: "marketplace:install-confirm",
  confirmUpdate: "marketplace:update-confirm",
  changed: "marketplace:changed",
  disable: "marketplace:disable",
  enable: "marketplace:enable",
  importCapability: "marketplace:import",
  install: "marketplace:install",
  listCatalog: "marketplace:catalog",
  listInstalled: "marketplace:installed",
  listMarketplaces: "marketplace:list",
  previewMarketplace: "marketplace:preview",
  refreshMarketplace: "marketplace:refresh",
  removeMarketplace: "marketplace:remove",
  setup: "marketplace:setup",
  uninstall: "marketplace:uninstall",
  update: "marketplace:update",
} as const
