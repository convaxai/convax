import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron"

import {
  marketplaceIpcChannels,
  type MarketplaceAddPreview,
  type MarketplaceCatalogSnapshot,
  type MarketplaceCatalogSourceChoice,
  type MarketplaceCapabilityDetails,
  type MarketplaceCapabilityKind,
  type MarketplaceInstalledCapability,
  type MarketplaceInventory,
  type MarketplaceSettingsSource,
} from "../marketplace-contracts"

export interface MarketplaceApplicationPort {
  addMarketplace(previewToken: string, senderId: string): Promise<void>
  beginInstall(
    identity: { id: string; kind: MarketplaceCapabilityKind },
    senderId: string,
  ): Promise<MarketplaceCatalogSourceChoice[]>
  beginUpdate(
    identity: { id: string; kind: MarketplaceCapabilityKind },
    senderId: string,
  ): Promise<MarketplaceCatalogSourceChoice[]>
  confirmInstall(confirmationToken: string, senderId: string): Promise<{ selectionToken: string }>
  confirmUpdate(confirmationToken: string, senderId: string): Promise<{ selectionToken: string }>
  disable(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  enable(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  getCapabilityDetails(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<MarketplaceCapabilityDetails>
  getCapabilitySourceRepositoryUrl(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<string>
  importDirectory(directory: string): Promise<MarketplaceInstalledCapability>
  install(selectionToken: string, senderId: string): Promise<MarketplaceInstalledCapability>
  listCatalog(): Promise<MarketplaceCatalogSnapshot>
  listInstalled(): Promise<MarketplaceInventory>
  listMarketplaces(): Promise<MarketplaceSettingsSource[]>
  previewMarketplace(url: string, senderId: string): Promise<MarketplaceAddPreview>
  refreshMarketplace(id: string): Promise<void>
  removeMarketplace(id: string): Promise<void>
  setup(
    identity: { id: string; kind: MarketplaceCapabilityKind },
    pickExecutable: () => Promise<string | null>,
  ): Promise<MarketplaceInstalledCapability>
  subscribe(listener: () => void): () => void
  uninstall(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  update(selectionToken: string, senderId: string): Promise<MarketplaceInstalledCapability>
}

const kinds = new Set<MarketplaceCapabilityKind>(["mcp-server", "plugin", "skill"])
const marketplaceIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const opaqueTokenPattern = /^[A-Za-z0-9_-]{16,1983}\.[A-Za-z0-9_-]{16,512}$/u

function identity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Marketplace identity is invalid")
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).sort().join("\0") !== ["id", "kind"].sort().join("\0") ||
    typeof input.id !== "string" ||
    input.id.length < 1 ||
    input.id.length > 256 ||
    !kinds.has(input.kind as MarketplaceCapabilityKind)
  ) {
    throw new Error("Marketplace identity is invalid")
  }
  return { id: input.id, kind: input.kind as MarketplaceCapabilityKind }
}

function exactTextInput(value: unknown, key: string, label: string, pattern?: RegExp) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).length !== 1 ||
    !(key in input) ||
    typeof input[key] !== "string" ||
    input[key].length < 1 ||
    input[key].length > 2_048 ||
    input[key] !== input[key].trim() ||
    (pattern && !pattern.test(input[key]))
  ) {
    throw new Error(`${label} is invalid`)
  }
  return input[key]
}

function descriptorUrl(value: unknown) {
  const text = exactTextInput(value, "url", "Marketplace URL")
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error("Marketplace URL is invalid")
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "") {
    throw new Error("Marketplace URL must be a fixed HTTPS URL")
  }
  return text
}

function showDirectoryDialog(event: IpcMainInvokeEvent) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const options: OpenDialogOptions = {
    buttonLabel: "Import",
    properties: ["openDirectory"],
    title: "Choose an extension folder",
  }
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

function pickExecutable(event: IpcMainInvokeEvent) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const options: OpenDialogOptions = {
    buttonLabel: "Choose",
    properties: ["openFile"],
    title: "Choose the local component",
  }
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

export function registerMarketplaceIpc(
  service: MarketplaceApplicationPort,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
) {
  const register = <Result>(
    channel: string,
    handler: (event: IpcMainInvokeEvent, input: unknown) => Result | Promise<Result>,
  ) => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      try {
        if (!isTrustedSender(event)) throw new Error("Marketplace IPC request came from an untrusted renderer")
        return await handler(event, input)
      } catch (error) {
        console.error(`Marketplace operation failed: ${channel}`, error)
        throw new Error("Marketplace operation could not be completed")
      }
    })
    return () => ipcMain.removeHandler(channel)
  }
  const publishChange = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(marketplaceIpcChannels.changed)
      }
    }
  }
  const changed = async <Result>(operation: () => Promise<Result>) => {
    const result = await operation()
    publishChange()
    return result
  }
  const unsubscribe = service.subscribe(publishChange)
  const disposers = [
    register(marketplaceIpcChannels.listCatalog, () => service.listCatalog()),
    register(marketplaceIpcChannels.listInstalled, () => service.listInstalled()),
    register(marketplaceIpcChannels.listMarketplaces, () => service.listMarketplaces()),
    register(marketplaceIpcChannels.getCapabilityDetails, (_event, input) =>
      service.getCapabilityDetails(identity(input)),
    ),
    register(marketplaceIpcChannels.openCapabilitySource, async (_event, input) => {
      await shell.openExternal(await service.getCapabilitySourceRepositoryUrl(identity(input)), { activate: true })
    }),
    register(marketplaceIpcChannels.previewMarketplace, (event, input) =>
      service.previewMarketplace(descriptorUrl(input), String(event.sender.id)),
    ),
    register(marketplaceIpcChannels.addMarketplace, (event, input) =>
      changed(() =>
        service.addMarketplace(
          exactTextInput(input, "previewToken", "Marketplace preview token", opaqueTokenPattern),
          String(event.sender.id),
        ),
      ),
    ),
    register(marketplaceIpcChannels.refreshMarketplace, (_event, input) =>
      changed(() => service.refreshMarketplace(exactTextInput(input, "id", "Marketplace id", marketplaceIdPattern))),
    ),
    register(marketplaceIpcChannels.removeMarketplace, (_event, input) =>
      changed(() => service.removeMarketplace(exactTextInput(input, "id", "Marketplace id", marketplaceIdPattern))),
    ),
    register(marketplaceIpcChannels.beginInstall, (event, input) =>
      service.beginInstall(identity(input), String(event.sender.id)),
    ),
    register(marketplaceIpcChannels.beginUpdate, (event, input) =>
      service.beginUpdate(identity(input), String(event.sender.id)),
    ),
    register(marketplaceIpcChannels.confirmInstall, (event, input) =>
      service.confirmInstall(
        exactTextInput(input, "confirmationToken", "Marketplace confirmation token", opaqueTokenPattern),
        String(event.sender.id),
      ),
    ),
    register(marketplaceIpcChannels.confirmUpdate, (event, input) =>
      service.confirmUpdate(
        exactTextInput(input, "confirmationToken", "Marketplace update confirmation token", opaqueTokenPattern),
        String(event.sender.id),
      ),
    ),
    register(marketplaceIpcChannels.install, (event, input) =>
      changed(() =>
        service.install(
          exactTextInput(input, "selectionToken", "Marketplace selection token", opaqueTokenPattern),
          String(event.sender.id),
        ),
      ),
    ),
    register(marketplaceIpcChannels.importCapability, async (event) => {
      const selected = await showDirectoryDialog(event)
      const directory = selected.canceled ? undefined : selected.filePaths[0]
      return directory ? changed(() => service.importDirectory(directory)) : null
    }),
    register(marketplaceIpcChannels.setup, (event, input) =>
      changed(() =>
        service.setup(identity(input), async () => {
          const selected = await pickExecutable(event)
          return selected.canceled ? null : (selected.filePaths[0] ?? null)
        }),
      ),
    ),
    register(marketplaceIpcChannels.update, (event, input) =>
      changed(() =>
        service.update(
          exactTextInput(input, "selectionToken", "Marketplace update selection token", opaqueTokenPattern),
          String(event.sender.id),
        ),
      ),
    ),
    register(marketplaceIpcChannels.uninstall, (_event, input) => changed(() => service.uninstall(identity(input)))),
    register(marketplaceIpcChannels.disable, (_event, input) => changed(() => service.disable(identity(input)))),
    register(marketplaceIpcChannels.enable, (_event, input) => changed(() => service.enable(identity(input)))),
  ]
  return () => {
    unsubscribe()
    for (const dispose of disposers.reverse()) dispose()
  }
}
