import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import type { MarketplaceClient } from "../marketplace-contracts"
import { MarketplaceSurface } from "./marketplace-view"

let root: Root | null = null
let container: HTMLDivElement | null = null
let windowInstance: Window
let originalGlobalDescriptors = new Map<string, PropertyDescriptor | undefined>()

beforeEach(() => {
  windowInstance = new Window()
  const globals = {
    Element: windowInstance.Element,
    Event: windowInstance.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
    HTMLElement: windowInstance.HTMLElement,
    MouseEvent: windowInstance.MouseEvent,
    Node: windowInstance.Node,
    document: windowInstance.document,
    window: windowInstance,
  }
  originalGlobalDescriptors = new Map()
  for (const [name, value] of Object.entries(globals)) {
    originalGlobalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  container = document.createElement("div")
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  await windowInstance.happyDOM.close()
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

function client(overrides: Partial<MarketplaceClient> = {}): MarketplaceClient {
  return {
    addMarketplace: mock(async () => undefined),
    beginInstall: mock(async () => [
      {
        description: "Official version",
        marketplaceLabel: "Convax Official",
        name: "Example",
        permissionSummary: [],
        confirmationToken: "o".repeat(24),
        setup: "none" as const,
        version: "1.0.0",
      },
      {
        description: "Third-party version",
        marketplaceLabel: "Example Marketplace",
        name: "Example",
        permissionSummary: ["Connect this MCP Server to the Agent"],
        confirmationToken: "t".repeat(24),
        setup: "remote-connection" as const,
        version: "2.0.0",
      },
    ]),
    beginUpdate: mock(async () => [
      {
        description: "Exact installed source",
        marketplaceLabel: "Convax Official",
        name: "Example",
        permissionSummary: ["Run this Plugin's authorized local capabilities"],
        confirmationToken: "u".repeat(24),
        setup: "local-execution" as const,
        version: "2.0.0",
      },
    ]),
    confirmInstall: mock(async ({ confirmationToken }) => ({ selectionToken: confirmationToken })),
    confirmUpdate: mock(async ({ confirmationToken }) => ({ selectionToken: confirmationToken })),
    disable: mock(async () => undefined),
    enable: mock(async () => undefined),
    importCapability: mock(async () => null),
    install: mock(async () => ({
      id: "example",
      kind: "plugin" as const,
      name: "Example",
      sourceLabel: "Convax Official",
      state: "ready" as const,
      updateAvailable: false,
      version: "1.0.0",
    })),
    listCatalog: mock(async () => ({
      cards: [
        {
          description: "One capability from two sources",
          id: "example",
          kind: "plugin" as const,
          name: "Example",
          otherSourceCount: 1,
        },
      ],
      revision: 1,
    })),
    listInstalled: mock(async () => ({ capabilities: [], revision: 1 })),
    listMarketplaces: mock(async () => [
      {
        health: "available" as const,
        id: "convax-official",
        label: "Convax Official",
        packageCount: 3,
        publisher: "Convax",
        removable: false,
        repository: "microvoid/convax-plugins",
      },
    ]),
    onDidChange: mock(() => () => undefined),
    previewMarketplace: mock(async () => ({
      label: "Example Marketplace",
      packageCount: 2,
      previewToken: "p".repeat(24),
      publisher: "Example",
      repository: "example/marketplace",
    })),
    refreshMarketplace: mock(async () => undefined),
    removeMarketplace: mock(async () => undefined),
    setup: mock(async () => ({
      id: "example",
      kind: "mcp-server" as const,
      name: "Example",
      sourceLabel: "Example",
      state: "ready" as const,
      updateAvailable: false,
      version: "1.0.0",
    })),
    uninstall: mock(async () => undefined),
    update: mock(async () => ({
      id: "example",
      kind: "plugin" as const,
      name: "Example",
      sourceLabel: "Example",
      state: "ready" as const,
      updateAvailable: false,
      version: "2.0.0",
    })),
    ...overrides,
  }
}

async function render(marketplace: MarketplaceClient) {
  root = createRoot(container!)
  await act(async () => root?.render(<MarketplaceSurface client={marketplace} locale="en" />))
}

function button(label: string) {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  )
  if (!match) throw new Error(`Button not found: ${label}`)
  return match
}

test("renders one aggregated card and requires an explicit source choice", async () => {
  const marketplace = client()
  await render(marketplace)
  expect(document.body.textContent).toContain("Example")
  expect(document.body.textContent).toContain("1 other source")
  await act(async () => button("Install Example").click())
  expect(document.body.textContent).toContain("Choose a source")
  expect(marketplace.install).not.toHaveBeenCalled()
  await act(async () => button("Convax Official · 1.0.0Official version").click())
  expect(marketplace.install).not.toHaveBeenCalled()
  await act(async () => button("Confirm and install").click())
  expect(marketplace.install).toHaveBeenCalledWith({ selectionToken: "o".repeat(24) })
})

test("requires exact-source confirmation even when the aggregated identity has one source", async () => {
  const marketplace = client({
    beginInstall: mock(async () => [
      {
        description: "Only version",
        marketplaceLabel: "Convax Official",
        name: "Example",
        permissionSummary: [],
        confirmationToken: "s".repeat(24),
        setup: "none" as const,
        version: "1.0.0",
      },
    ]),
  })
  await render(marketplace)
  await act(async () => button("Install Example").click())
  expect(marketplace.install).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => button("Confirm and install").click())
  expect(marketplace.install).toHaveBeenCalledWith({ selectionToken: "s".repeat(24) })
})

test("discards one-time source tokens after a failed install and begins a fresh retry", async () => {
  let attempt = 0
  const marketplace = client({
    beginInstall: mock(async () => {
      attempt += 1
      return [
        {
          description: "Only version",
          marketplaceLabel: "Convax Official",
          name: "Example",
          permissionSummary: [],
          confirmationToken: String(attempt).repeat(24),
          setup: "none" as const,
          version: "1.0.0",
        },
      ]
    }),
    install: mock(async () => {
      throw new Error("download failed")
    }),
  })
  await render(marketplace)
  await act(async () => button("Install Example").click())
  await act(async () => button("Confirm and install").click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.textContent).toContain("The operation could not be completed")

  await act(async () => button("Install Example").click())
  await act(async () => button("Confirm and install").click())
  expect(marketplace.beginInstall).toHaveBeenCalledTimes(2)
  expect(marketplace.confirmInstall).toHaveBeenLastCalledWith({ confirmationToken: "2".repeat(24) })
})

test("lets the user cancel an unresolved multi-source choice", async () => {
  const marketplace = client()
  await render(marketplace)
  await act(async () => button("Install Example").click())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => button("Cancel").click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(marketplace.install).not.toHaveBeenCalled()
})

test("uses one Import action without asking the renderer to choose a kind or Local source", async () => {
  const marketplace = client()
  await render(marketplace)
  await act(async () => button("Import…").click())
  expect(marketplace.importCapability).toHaveBeenCalledWith()
})

test("uses localized product states and exposes an available update", async () => {
  const marketplace = client({
    listInstalled: mock(async () => ({
      capabilities: [
        {
          id: "example",
          kind: "mcp-server" as const,
          name: "Example",
          sourceLabel: "Convax Official",
          state: "attention" as const,
          updateAvailable: true,
          version: "1.0.0",
        },
      ],
      revision: 1,
    })),
  })
  await render(marketplace)
  await act(async () => button("Installed").click())
  expect(document.body.textContent).toContain("Needs attention")
  expect(document.body.textContent).not.toContain("· attention")
  await act(async () => button("Update").click())
  expect(marketplace.beginUpdate).toHaveBeenCalledWith({ id: "example", kind: "mcp-server" })
  await act(async () => button("Confirm and update").click())
  expect(marketplace.update).toHaveBeenCalledWith({ selectionToken: "u".repeat(24) })
})

test("previews a Marketplace URL before confirming add", async () => {
  const marketplace = client()
  await render(marketplace)
  await act(async () => button("Marketplaces").click())
  const input = document.querySelector<HTMLInputElement>("#marketplace-url")!
  await act(async () => {
    input.value = "https://example.github.io/marketplace.json"
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await act(async () => button("Preview").click())
  expect(document.body.textContent).toContain("example/marketplace")
  expect(marketplace.addMarketplace).not.toHaveBeenCalled()
  await act(async () => button("Add Marketplace").click())
  expect(marketplace.addMarketplace).toHaveBeenCalledWith({ previewToken: "p".repeat(24) })
})

test("never renders native paths, SourceKeys, URLs, or transport diagnostics from rejected operations", async () => {
  const diagnostic =
    "failed /Users/private/tool sourceKey=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa https://secret.example/?token=x transport=stdio"
  await render(
    client({
      listCatalog: mock(async () => {
        throw new Error(diagnostic)
      }),
    }),
  )
  expect(document.body.textContent).toContain("The operation could not be completed")
  expect(document.body.textContent).not.toContain("/Users/")
  expect(document.body.textContent).not.toContain("sourceKey")
  expect(document.body.textContent).not.toContain("https://")
  expect(document.body.textContent).not.toContain("stdio")
})
