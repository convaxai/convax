import { afterEach, beforeEach, expect, mock, test } from "bun:test"

import { marketplaceIpcChannels } from "../marketplace-contracts"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"
import type { MarketplaceApplicationPort } from "./marketplace-ipc"

const { registerMarketplaceIpc } = await import("./marketplace-ipc")

type Event = { sender: { id: number } }
type Handler = (event: Event, input?: unknown) => unknown

const handlers = new Map<string, Handler>()
let dialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
const openedExternalUrls: string[] = []
const sent = mock(() => undefined)

beforeEach(() => {
  configureElectronMock({
    BrowserWindow: {
      fromWebContents: () => undefined,
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: sent } }],
    },
    dialog: {
      showOpenDialog: async () => dialogResult,
    },
    ipcMain: {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    shell: {
      openExternal: async (url: string) => {
        openedExternalUrls.push(url)
      },
    },
  })
})

afterEach(() => {
  handlers.clear()
  dialogResult = { canceled: true, filePaths: [] }
  openedExternalUrls.splice(0)
  sent.mockClear()
  resetElectronMock()
})

function service() {
  return {
    addMarketplace: mock(async () => undefined),
    beginInstall: mock(async () => []),
    beginUpdate: mock(async () => []),
    confirmInstall: mock(async () => ({ selectionToken: "s".repeat(24) })),
    confirmUpdate: mock(async () => ({ selectionToken: "u".repeat(24) })),
    disable: mock(async () => undefined),
    enable: mock(async () => undefined),
    getCapabilityDetails: mock(async () => ({
      description: "Details",
      id: "example",
      kind: "plugin" as const,
      name: "Example",
      runtimeScope: "agent" as const,
      sourceLabel: "Official",
      version: "1.0.0",
    })),
    getCapabilitySourceRepositoryUrl: mock(async () => "https://github.com/example/repository"),
    importDirectory: mock(async () => ({
      id: "imported",
      kind: "skill" as const,
      name: "Imported",
      sourceLabel: "Imported",
      state: "ready" as const,
      updateAvailable: false,
      version: "1.0.0",
    })),
    install: mock(async () => ({
      id: "installed",
      kind: "skill" as const,
      name: "Installed",
      sourceLabel: "Official",
      state: "ready" as const,
      updateAvailable: false,
      version: "1.0.0",
    })),
    listCatalog: mock(async () => ({ cards: [], revision: 1 })),
    listInstalled: mock(async () => ({
      capabilities: [],
      pluginRuntimeState: "available" as const,
      revision: 1,
    })),
    listMarketplaces: mock(async () => []),
    previewMarketplace: mock(async () => ({
      label: "Example",
      packageCount: 1,
      previewToken: "p".repeat(24),
      publisher: "Example",
      repository: "example/repo",
    })),
    refreshMarketplace: mock(async () => undefined),
    removeMarketplace: mock(async () => undefined),
    setup: mock(async () => ({
      id: "server",
      kind: "mcp-server" as const,
      name: "Server",
      sourceLabel: "Official",
      state: "ready" as const,
      updateAvailable: false,
      version: "1.0.0",
    })),
    subscribe: mock(() => () => undefined),
    uninstall: mock(async () => undefined),
    update: mock(async () => ({
      id: "updated",
      kind: "plugin" as const,
      name: "Updated",
      sourceLabel: "Official",
      state: "ready" as const,
      updateAvailable: false,
      version: "2.0.0",
    })),
  } satisfies MarketplaceApplicationPort
}

const event = { sender: { id: 1 } }

test("Marketplace IPC exposes the dedicated descriptor URL exception and opaque confirmation token", async () => {
  const application = service()
  const dispose = registerMarketplaceIpc(application, () => true)
  const previewToken = `${"p".repeat(64)}.${"s".repeat(43)}`
  const productLockedConfirmationToken = `${"a".repeat(1_024)}.${"s".repeat(43)}`
  await expect(
    handlers.get(marketplaceIpcChannels.previewMarketplace)!(event, {
      url: "https://example.github.io/marketplace.json",
    }),
  ).resolves.toMatchObject({ label: "Example" })
  expect(application.previewMarketplace).toHaveBeenCalledWith("https://example.github.io/marketplace.json", "1")
  await expect(handlers.get(marketplaceIpcChannels.addMarketplace)!(event, { previewToken })).resolves.toBeUndefined()
  expect(application.addMarketplace).toHaveBeenCalledWith(previewToken, "1")
  await expect(
    handlers.get(marketplaceIpcChannels.confirmInstall)!(event, {
      confirmationToken: productLockedConfirmationToken,
    }),
  ).resolves.toMatchObject({ selectionToken: "s".repeat(24) })
  expect(application.confirmInstall).toHaveBeenCalledWith(productLockedConfirmationToken, "1")
  dispose()
})

test("Marketplace details accept only a capability identity and never renderer-selected source authority", async () => {
  const application = service()
  registerMarketplaceIpc(application, () => true)
  await expect(
    handlers.get(marketplaceIpcChannels.getCapabilityDetails)!(event, { id: "example", kind: "plugin" }),
  ).resolves.toMatchObject({ id: "example", kind: "plugin" })
  expect(application.getCapabilityDetails).toHaveBeenCalledWith({ id: "example", kind: "plugin" })
  expect(() =>
    handlers.get(marketplaceIpcChannels.getCapabilityDetails)!(event, {
      id: "example",
      kind: "plugin",
      sourceKey: "renderer-must-not-choose",
    }),
  ).toThrow("Marketplace operation could not be completed")

  await expect(
    handlers.get(marketplaceIpcChannels.openCapabilitySource)!(event, { id: "example", kind: "plugin" }),
  ).resolves.toBeUndefined()
  expect(application.getCapabilitySourceRepositoryUrl).toHaveBeenCalledWith({ id: "example", kind: "plugin" })
  expect(openedExternalUrls).toEqual(["https://github.com/example/repository"])
  expect(() =>
    handlers.get(marketplaceIpcChannels.openCapabilitySource)!(event, {
      id: "example",
      kind: "plugin",
      url: "https://attacker.example",
    }),
  ).toThrow("Marketplace operation could not be completed")
})

test("Marketplace IPC rejects renderer-supplied source and native authority", async () => {
  const application = service()
  registerMarketplaceIpc(application, () => true)
  expect(() =>
    handlers.get(marketplaceIpcChannels.beginInstall)!(event, {
      id: "example",
      kind: "plugin",
      sourceKey: "renderer-must-not-choose",
    }),
  ).toThrow("Marketplace operation could not be completed")
  expect(() =>
    handlers.get(marketplaceIpcChannels.previewMarketplace)!(event, {
      headers: { Authorization: "secret" },
      url: "https://example.github.io/marketplace.json",
    }),
  ).toThrow("Marketplace operation could not be completed")
})

test("one Import action opens a Main-owned directory picker and passes only the chosen native root internally", async () => {
  const application = service()
  registerMarketplaceIpc(application, () => true)
  dialogResult = { canceled: false, filePaths: ["/native/extension"] }
  await expect(handlers.get(marketplaceIpcChannels.importCapability)!(event)).resolves.toMatchObject({
    id: "imported",
    kind: "skill",
  })
  expect(application.importDirectory).toHaveBeenCalledWith("/native/extension")
})

test("untrusted renderers cannot invoke any Marketplace operation", () => {
  const application = service()
  registerMarketplaceIpc(application, () => false)
  expect(() => handlers.get(marketplaceIpcChannels.listCatalog)!(event)).toThrow(
    "Marketplace operation could not be completed",
  )
  expect(application.listCatalog).not.toHaveBeenCalled()
})
