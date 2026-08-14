import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import type { MarketplaceClient, MarketplacePluginCategory } from "../marketplace-contracts"
import { preloadMarketplaceProjection } from "./marketplace-projection-cache"
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
    getCapabilityDetails: mock(async ({ id, kind }) => ({
      description: "One capability from two sources",
      ...(kind === "skill" ? { files: [] } : {}),
      id,
      kind,
      name: "Example",
      ...(kind === "skill" ? {} : { runtimeScope: "agent" as const }),
      sourceLabel: "Convax Official",
      version: "1.0.0",
    })),
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
    listInstalled: mock(async () => ({ capabilities: [], pluginRuntimeState: "available" as const, revision: 1 })),
    listMarketplaces: mock(async () => [
      {
        health: "available" as const,
        id: "convax-official",
        label: "Convax Official",
        packageCount: 3,
        publisher: "Convax",
        removable: false,
        repository: "convaxai/convax-plugins",
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

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

test("shows an explicit loading state before the first Marketplace projection arrives", async () => {
  const firstCatalog = deferred<Awaited<ReturnType<MarketplaceClient["listCatalog"]>>>()
  const marketplace = client({ listCatalog: mock(() => firstCatalog.promise) })

  await render(marketplace)
  expect(document.querySelector('[data-marketplace-loading="true"]')).not.toBeNull()
  expect(document.body.textContent).toContain("Loading extensions…")

  await act(async () => {
    firstCatalog.resolve({
      cards: [
        {
          description: "Loaded capability",
          id: "loaded",
          kind: "plugin",
          name: "Loaded",
          otherSourceCount: 0,
        },
      ],
      revision: 1,
    })
    await firstCatalog.promise
  })
  expect(document.querySelector('[data-marketplace-loading="true"]')).toBeNull()
  expect(document.body.textContent).toContain("Loaded")
})

test("reuses the window-startup projection warmup when Settings opens", async () => {
  const firstCatalog = deferred<Awaited<ReturnType<MarketplaceClient["listCatalog"]>>>()
  const listCatalog = mock(() => firstCatalog.promise)
  const marketplace = client({ listCatalog })
  const warmup = preloadMarketplaceProjection(marketplace, window.localStorage)

  await render(marketplace)
  expect(listCatalog).toHaveBeenCalledTimes(1)

  await act(async () => {
    firstCatalog.resolve({
      cards: [
        {
          description: "Warmed before Settings",
          id: "warmed",
          kind: "plugin",
          name: "Warmed",
          otherSourceCount: 0,
        },
      ],
      revision: 1,
    })
    await warmup
  })
  expect(document.body.textContent).toContain("Warmed")
})

test("renders the last complete projection immediately across remounts while revalidating it", async () => {
  type Catalog = Awaited<ReturnType<MarketplaceClient["listCatalog"]>>
  const revalidation = deferred<Catalog>()
  let request = 0
  const marketplace = client({
    listCatalog: mock(() => {
      request += 1
      if (request === 1) {
        return Promise.resolve({
          cards: [
            {
              description: "Cached capability",
              id: "cached",
              kind: "plugin" as const,
              name: "Cached",
              otherSourceCount: 0,
            },
          ],
          revision: 1,
        })
      }
      return revalidation.promise
    }),
  })

  await render(marketplace)
  expect(document.body.textContent).toContain("Cached")
  await act(async () => root?.unmount())
  root = null
  container?.replaceChildren()

  await render(marketplace)
  expect(request).toBe(2)
  expect(document.querySelector('[data-marketplace-loading="true"]')).toBeNull()
  expect(document.body.textContent).toContain("Cached")

  await act(async () => {
    revalidation.resolve({
      cards: [
        {
          description: "Fresh capability",
          id: "fresh",
          kind: "plugin",
          name: "Fresh",
          otherSourceCount: 0,
        },
      ],
      revision: 2,
    })
    await revalidation.promise
  })
  expect(document.body.textContent).toContain("Fresh")
  expect(document.body.textContent).not.toContain("Cached")
})

test("renders the durable display projection immediately for a cold renderer client", async () => {
  const firstClient = client({
    listCatalog: mock(async () => ({
      cards: [
        {
          description: "Persisted local capability",
          id: "persisted",
          kind: "plugin" as const,
          name: "Persisted",
          otherSourceCount: 0,
        },
      ],
      revision: 1,
    })),
  })
  await render(firstClient)
  expect(document.body.textContent).toContain("Persisted")
  await act(async () => root?.unmount())
  root = null
  container?.replaceChildren()

  type Catalog = Awaited<ReturnType<MarketplaceClient["listCatalog"]>>
  const revalidation = deferred<Catalog>()
  const listCatalog = mock(() => revalidation.promise)
  const coldClient = client({ listCatalog })
  await render(coldClient)

  expect(listCatalog).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[data-marketplace-loading="true"]')).toBeNull()
  expect(document.body.textContent).toContain("Persisted")

  await act(async () => {
    revalidation.resolve({
      cards: [
        {
          description: "Revalidated local capability",
          id: "revalidated",
          kind: "plugin",
          name: "Revalidated",
          otherSourceCount: 0,
        },
      ],
      revision: 2,
    })
    await revalidation.promise
  })
  expect(document.body.textContent).toContain("Revalidated")
  expect(document.body.textContent).not.toContain("Persisted")
})

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

test("keeps category tags out of list items and filters Skill as a first-class catalog kind", async () => {
  const listCatalog = mock(async () => ({
    cards: [
      {
        categories: ["video", "image"] as MarketplacePluginCategory[],
        description: "Creates media",
        id: "media-plugin",
        kind: "plugin" as const,
        name: "Media Plugin",
        otherSourceCount: 0,
      },
      {
        categories: ["service"] as MarketplacePluginCategory[],
        description: "Connects an account",
        id: "service-plugin",
        kind: "plugin" as const,
        name: "Service Plugin",
        otherSourceCount: 0,
      },
      {
        categories: ["skill"] as MarketplacePluginCategory[],
        description: "Owns a workflow",
        id: "skill-plugin",
        kind: "plugin" as const,
        name: "Skill Plugin",
        otherSourceCount: 0,
      },
      {
        description: "A standalone Skill",
        id: "standalone-skill",
        kind: "skill" as const,
        name: "Standalone Skill",
        otherSourceCount: 0,
      },
    ],
    revision: 1,
  }))
  await render(client({ listCatalog }))

  expect(document.querySelector("[data-plugin-category]")).toBeNull()
  expect(document.body.textContent).toContain("Standalone Skill")

  await act(async () => button("Image").click())
  expect(document.body.textContent).toContain("Media Plugin")
  expect(document.body.textContent).not.toContain("Service Plugin")
  expect(document.body.textContent).not.toContain("Standalone Skill")

  await act(async () => button("Skill").click())
  expect(document.body.textContent).toContain("Standalone Skill")
  expect(document.body.textContent).not.toContain("Skill Plugin")
  expect(document.body.textContent).not.toContain("Media Plugin")

  await act(async () => button("All").click())
  expect(document.body.textContent).toContain("Standalone Skill")
  expect(listCatalog).toHaveBeenCalledTimes(1)
})

test("opens details from the card while keeping capability actions independent", async () => {
  const getCapabilityDetails = mock(client().getCapabilityDetails)
  const beginInstall = mock(client().beginInstall)
  await render(client({ beginInstall, getCapabilityDetails }))

  const card = document.querySelector<HTMLElement>("article")!
  expect(card.className).toContain("cursor-pointer")
  expect(
    [...card.querySelectorAll("button")].some((candidate) => candidate.textContent?.trim() === "View details"),
  ).toBe(false)

  await act(async () => card.querySelector<HTMLButtonElement>('[data-marketplace-card-details-target="true"]')!.click())
  expect(getCapabilityDetails).toHaveBeenCalledTimes(1)
  await act(async () => button("Close details").click())

  await act(async () => button("Install Example").click())
  expect(beginInstall).toHaveBeenCalledTimes(1)
  expect(getCapabilityDetails).toHaveBeenCalledTimes(1)
})

test("opens Plugin Showcase details and restores the Skill file tree", async () => {
  const getCapabilityDetails = mock(async ({ id }: { id: string; kind: "mcp-server" | "plugin" | "skill" }) =>
    id === "detail-plugin"
      ? {
          categories: ["image" as const],
          description: "Plugin detail description",
          id,
          kind: "plugin" as const,
          name: "Detail Plugin",
          runtimeScope: "agent-and-convax" as const,
          showcase: {
            altText: "Plugin preview",
            bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
            mimeType: "image/png" as const,
            size: 4,
          },
          sourceLabel: "Convax Official",
          version: "2.0.0",
        }
      : {
          description: "Skill detail description",
          files: [
            { content: "# Detail Skill", kind: "text" as const, path: "SKILL.md", size: 14 },
            { content: "# Guide", kind: "text" as const, path: "references/guide.md", size: 7 },
          ],
          id,
          kind: "skill" as const,
          name: "Detail Skill",
          sourceLabel: "Convax Official",
          version: "1.0.0",
        },
  )
  await render(
    client({
      getCapabilityDetails,
      listCatalog: mock(async () => ({
        cards: [
          {
            categories: ["image" as const],
            description: "Plugin card",
            id: "detail-plugin",
            kind: "plugin" as const,
            name: "Detail Plugin",
            otherSourceCount: 0,
          },
          {
            description: "Skill card",
            id: "detail-skill",
            kind: "skill" as const,
            name: "Detail Skill",
            otherSourceCount: 0,
          },
        ],
        revision: 1,
      })),
    }),
  )
  const card = (name: string) =>
    [...document.querySelectorAll<HTMLElement>("article")].find((article) => article.textContent?.includes(name))!

  await act(async () =>
    card("Detail Plugin").querySelector<HTMLButtonElement>('[data-marketplace-card-details-target="true"]')!.click(),
  )
  expect(getCapabilityDetails).toHaveBeenCalledWith({ id: "detail-plugin", kind: "plugin" })
  expect(document.body.textContent).toContain("Plugin detail description")
  expect(document.body.textContent).toContain("Convax Official")
  expect(document.body.textContent).toContain("Agent + Convax")
  await act(async () => button("Close details").click())

  await act(async () =>
    card("Detail Skill").querySelector<HTMLButtonElement>('[data-marketplace-card-details-target="true"]')!.click(),
  )
  expect(getCapabilityDetails).toHaveBeenCalledWith({ id: "detail-skill", kind: "skill" })
  expect(document.body.textContent).toContain("SKILL.md")
  expect(document.body.textContent).toContain("references")
  expect(document.body.textContent).toContain("# Detail Skill")
})

test("ignores a stale detail response after another capability is opened", async () => {
  const first = deferred<Awaited<ReturnType<MarketplaceClient["getCapabilityDetails"]>>>()
  const getCapabilityDetails = mock(({ id }: { id: string; kind: "mcp-server" | "plugin" | "skill" }) =>
    id === "first"
      ? first.promise
      : Promise.resolve({
          description: "Second details",
          id,
          kind: "plugin" as const,
          name: "Second",
          runtimeScope: "agent" as const,
          sourceLabel: "Second source",
          version: "2.0.0",
        }),
  )
  await render(
    client({
      getCapabilityDetails,
      listCatalog: mock(async () => ({
        cards: [
          { description: "First card", id: "first", kind: "plugin" as const, name: "First", otherSourceCount: 0 },
          { description: "Second card", id: "second", kind: "plugin" as const, name: "Second", otherSourceCount: 0 },
        ],
        revision: 1,
      })),
    }),
  )
  const open = async (name: string) => {
    const article = [...document.querySelectorAll<HTMLElement>("article")].find((entry) =>
      entry.textContent?.includes(name),
    )!
    await act(async () =>
      article.querySelector<HTMLButtonElement>('[data-marketplace-card-details-target="true"]')!.click(),
    )
  }

  await open("First")
  await act(async () => button("Close details").click())
  await open("Second")
  expect(document.body.textContent).toContain("Second details")
  await act(async () => {
    first.resolve({
      description: "Stale first details",
      id: "first",
      kind: "plugin",
      name: "First",
      runtimeScope: "agent",
      sourceLabel: "First source",
      version: "1.0.0",
    })
    await first.promise
  })
  expect(document.body.textContent).toContain("Second details")
  expect(document.body.textContent).not.toContain("Stale first details")
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

test("shows loading only on the capability being installed and leaves other installs enabled", async () => {
  let finishInstall: (() => void) | undefined
  const installPending = new Promise<void>((resolve) => {
    finishInstall = resolve
  })
  const marketplace = client({
    beginInstall: mock(async ({ id }) => [
      {
        description: `${id} version`,
        marketplaceLabel: "Convax Official",
        name: id,
        permissionSummary: [],
        confirmationToken: id.repeat(24).slice(0, 24),
        setup: "none" as const,
        version: "1.0.0",
      },
    ]),
    install: mock(async () => {
      await installPending
      return {
        id: "alpha",
        kind: "plugin" as const,
        name: "Alpha",
        sourceLabel: "Convax Official",
        state: "ready" as const,
        updateAvailable: false,
        version: "1.0.0",
      }
    }),
    listCatalog: mock(async () => ({
      cards: [
        {
          description: "Alpha capability",
          id: "alpha",
          kind: "plugin" as const,
          name: "Alpha",
          otherSourceCount: 0,
        },
        {
          description: "Beta capability",
          id: "beta",
          kind: "plugin" as const,
          name: "Beta",
          otherSourceCount: 0,
        },
      ],
      revision: 1,
    })),
  })
  await render(marketplace)
  await act(async () => button("Install Alpha").click())
  await act(async () => button("Confirm and install").click())

  const alphaInstall = button("Install Alpha")
  const betaInstall = button("Install Beta")
  expect(alphaInstall.disabled).toBe(true)
  expect(alphaInstall.getAttribute("aria-busy")).toBe("true")
  expect(alphaInstall.querySelector('[data-ui-loading-spinner=""]')).not.toBeNull()
  expect(betaInstall.disabled).toBe(false)
  expect(betaInstall.getAttribute("aria-busy")).toBe("false")

  await act(async () => betaInstall.click())
  expect(marketplace.beginInstall).toHaveBeenLastCalledWith({ id: "beta", kind: "plugin" })
  expect(button("Install Alpha").getAttribute("aria-busy")).toBe("true")

  await act(async () => {
    finishInstall?.()
    await installPending
  })
})

test("ignores an older catalog refresh after a newer refresh has completed", async () => {
  type CatalogResult = Awaited<ReturnType<MarketplaceClient["listCatalog"]>>
  let notify = () => undefined
  let catalogRequest = 0
  let resolveOlder: ((result: CatalogResult) => void) | undefined
  let resolveNewer: ((result: CatalogResult) => void) | undefined
  const older = new Promise<CatalogResult>((resolve) => {
    resolveOlder = resolve
  })
  const newer = new Promise<CatalogResult>((resolve) => {
    resolveNewer = resolve
  })
  const marketplace = client({
    listCatalog: mock(async () => {
      catalogRequest += 1
      if (catalogRequest === 2) return older
      if (catalogRequest === 3) return newer
      return {
        cards: [
          {
            description: "Initial capability",
            id: "initial",
            kind: "plugin" as const,
            name: "Initial",
            otherSourceCount: 0,
          },
        ],
        revision: 1,
      }
    }),
    onDidChange: mock((listener) => {
      notify = listener
      return () => undefined
    }),
  })
  await render(marketplace)

  await act(async () => {
    notify()
    notify()
    await Promise.resolve()
  })
  await act(async () => {
    resolveNewer?.({
      cards: [
        {
          description: "Newest capability",
          id: "newest",
          kind: "plugin",
          name: "Newest",
          otherSourceCount: 0,
        },
      ],
      revision: 3,
    })
    await newer
  })
  expect(document.body.textContent).toContain("Newest")

  await act(async () => {
    resolveOlder?.({
      cards: [
        {
          description: "Stale capability",
          id: "stale",
          kind: "plugin",
          name: "Stale",
          otherSourceCount: 0,
        },
      ],
      revision: 2,
    })
    await older
  })
  expect(document.body.textContent).toContain("Newest")
  expect(document.body.textContent).not.toContain("Stale")
})

test("keeps a capability busy until the newest superseding refresh commits", async () => {
  type Inventory = Awaited<ReturnType<MarketplaceClient["listInstalled"]>>
  const second = deferred<Inventory>()
  const third = deferred<Inventory>()
  let inventoryRequest = 0
  let notify = () => undefined
  const installed = (version: string, updateAvailable: boolean): Inventory => ({
    capabilities: [
      {
        id: "example",
        kind: "plugin",
        name: "Example",
        sourceLabel: "Convax Official",
        state: "ready",
        updateAvailable,
        version,
      },
    ],
    pluginRuntimeState: "available",
    revision: Number(version.split(".")[0]),
  })
  const marketplace = client({
    listInstalled: mock(() => {
      inventoryRequest += 1
      if (inventoryRequest === 2) return second.promise
      if (inventoryRequest === 3) return third.promise
      return Promise.resolve(installed("1.0.0", true))
    }),
    onDidChange: mock((listener) => {
      notify = listener
      return () => undefined
    }),
  })
  await render(marketplace)
  await act(async () => button("Installed").click())
  await act(async () => button("Update Example").click())
  await act(async () => button("Confirm and update").click())
  await act(async () => {
    notify()
    await Promise.resolve()
  })

  await act(async () => {
    second.resolve(installed("2.0.0", false))
    await second.promise
  })
  expect(button("Update Example").disabled).toBe(true)
  expect(document.querySelector('[data-capability-progress="plugin:example"]')).not.toBeNull()

  await act(async () => {
    third.resolve(installed("2.0.0", false))
    await third.promise
    await Promise.resolve()
  })
  expect(document.body.textContent).toContain("2.0.0")
  expect(document.querySelector('[data-capability-progress="plugin:example"]')).toBeNull()
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
      pluginRuntimeState: "available" as const,
      revision: 1,
    })),
  })
  await render(marketplace)
  await act(async () => button("Installed").click())
  expect(document.body.textContent).toContain("Needs attention")
  expect(document.body.textContent).not.toContain("· attention")
  await act(async () => button("Update Example").click())
  expect(marketplace.beginUpdate).toHaveBeenCalledWith({ id: "example", kind: "mcp-server" })
  await act(async () => button("Confirm and update").click())
  expect(marketplace.update).toHaveBeenCalledWith({ selectionToken: "u".repeat(24) })
})

test("routes Plugin integrity failures to reinstall instead of offering setup as a false repair", async () => {
  const marketplace = client({
    listInstalled: mock(async () => ({
      capabilities: [
        {
          attention: "integrity-or-authorization",
          id: "example",
          kind: "plugin" as const,
          name: "Example",
          runtimeScope: "agent-and-convax" as const,
          sourceLabel: "Convax Official",
          state: "attention" as const,
          updateAvailable: true,
          version: "1.0.0",
        },
      ],
      pluginRuntimeState: "available" as const,
      revision: 1,
    })),
  })
  await render(marketplace)
  await act(async () => button("Installed").click())

  expect(document.body.textContent).toContain("Reinstall required")
  expect(document.body.textContent).not.toContain("Complete setup")
  expect(button("Update Example")).toBeDefined()
  expect(marketplace.setup).not.toHaveBeenCalled()
})

test("keeps setup available only for a capability that actually lacks setup", async () => {
  const marketplace = client({
    listInstalled: mock(async () => ({
      capabilities: [
        {
          id: "example",
          kind: "mcp-server" as const,
          name: "Example",
          runtimeScope: "agent" as const,
          sourceLabel: "Example",
          state: "setup-required" as const,
          updateAvailable: false,
          version: "1.0.0",
        },
      ],
      pluginRuntimeState: "available" as const,
      revision: 1,
    })),
  })
  await render(marketplace)
  await act(async () => button("Installed").click())
  await act(async () => button("Complete setup Example").click())

  expect(marketplace.setup).toHaveBeenCalledWith({ id: "example", kind: "mcp-server" })
})

test("never offers Complete setup for a Plugin even when an older main projects setup-required", async () => {
  const marketplace = client({
    listInstalled: mock(async () => ({
      capabilities: [
        {
          id: "example",
          kind: "plugin" as const,
          name: "Example",
          runtimeScope: "agent-and-convax" as const,
          sourceLabel: "Example",
          state: "setup-required" as const,
          updateAvailable: true,
          version: "1.0.0",
        },
      ],
      pluginRuntimeState: "available" as const,
      revision: 1,
    })),
  })
  await render(marketplace)
  await act(async () => button("Installed").click())

  expect(document.body.textContent).not.toContain("Complete setup")
  expect(marketplace.setup).not.toHaveBeenCalled()
})

test("shows card-local progress while preparing an update and rejects duplicate clicks", async () => {
  type Choices = Awaited<ReturnType<MarketplaceClient["beginUpdate"]>>
  const pendingChoices = deferred<Choices>()
  const beginUpdate = mock(() => pendingChoices.promise)
  const marketplace = client({
    beginUpdate,
    listInstalled: mock(async () => ({
      capabilities: [
        {
          id: "example",
          kind: "mcp-server" as const,
          name: "Example",
          sourceLabel: "Convax Official",
          state: "ready" as const,
          updateAvailable: true,
          version: "1.0.0",
        },
      ],
      pluginRuntimeState: "available" as const,
      revision: 1,
    })),
  })
  await render(marketplace)
  await act(async () => button("Installed").click())

  const update = button("Update Example")
  await act(async () => {
    update.click()
    update.click()
    await Promise.resolve()
  })

  expect(beginUpdate).toHaveBeenCalledTimes(1)
  expect(button("Update Example").disabled).toBe(true)
  expect(button("Update Example").getAttribute("aria-busy")).toBe("true")
  expect(button("Update Example").querySelector('[data-ui-loading-spinner=""]')).not.toBeNull()
  expect(document.querySelector('[data-capability-progress="mcp-server:example"]')?.textContent).toBe(
    "Preparing update…",
  )

  await act(async () => {
    pendingChoices.resolve([
      {
        description: "Exact installed source",
        marketplaceLabel: "Convax Official",
        name: "Example",
        permissionSummary: [],
        confirmationToken: "u".repeat(24),
        setup: "none",
        version: "2.0.0",
      },
    ])
    await pendingChoices.promise
  })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})

test("keeps the installed card busy during update execution and rejects duplicate confirmation", async () => {
  type UpdateResult = Awaited<ReturnType<MarketplaceClient["update"]>>
  const pendingUpdate = deferred<UpdateResult>()
  const update = mock(() => pendingUpdate.promise)
  const marketplace = client({
    listInstalled: mock(async () => ({
      capabilities: [
        {
          id: "example",
          kind: "mcp-server" as const,
          name: "Example",
          sourceLabel: "Convax Official",
          state: "ready" as const,
          updateAvailable: true,
          version: "1.0.0",
        },
      ],
      pluginRuntimeState: "available" as const,
      revision: 1,
    })),
    update,
  })
  await render(marketplace)
  await act(async () => button("Installed").click())
  await act(async () => button("Update Example").click())

  const confirm = button("Confirm and update")
  await act(async () => {
    confirm.click()
    confirm.click()
    await Promise.resolve()
  })

  expect(marketplace.confirmUpdate).toHaveBeenCalledTimes(1)
  expect(update).toHaveBeenCalledTimes(1)
  expect(button("Update Example").disabled).toBe(true)
  expect(button("Update Example").getAttribute("aria-busy")).toBe("true")
  expect(button("Update Example").querySelector('[data-ui-loading-spinner=""]')).not.toBeNull()
  expect(document.querySelector('[data-capability-progress="mcp-server:example"]')?.textContent).toBe("Updating…")

  await act(async () => {
    pendingUpdate.resolve({
      id: "example",
      kind: "mcp-server",
      name: "Example",
      sourceLabel: "Convax Official",
      state: "ready",
      updateAvailable: false,
      version: "2.0.0",
    })
    await pendingUpdate.promise
  })
})

test("reveals a safe inline update error on its card and starts retries from a fresh source token", async () => {
  const scrollIntoView = mock(() => undefined)
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  })
  let attempt = 0
  const marketplace = client({
    beginUpdate: mock(async () => {
      attempt += 1
      return [
        {
          description: "Exact installed source",
          marketplaceLabel: "Convax Official",
          name: "Example",
          permissionSummary: [],
          confirmationToken: String(attempt).repeat(24),
          setup: "none" as const,
          version: "2.0.0",
        },
      ]
    }),
    listInstalled: mock(async () => ({
      capabilities: [
        {
          id: "example",
          kind: "mcp-server" as const,
          name: "Example",
          sourceLabel: "Convax Official",
          state: "ready" as const,
          updateAvailable: true,
          version: "1.0.0",
        },
      ],
      pluginRuntimeState: "available" as const,
      revision: 1,
    })),
    update: mock(async () => {
      throw new Error("failed /Users/private/tool https://secret.example/?token=x")
    }),
  })
  await render(marketplace)
  await act(async () => button("Installed").click())
  await act(async () => button("Update Example").click())
  await act(async () => button("Confirm and update").click())

  const inlineError = document.querySelector<HTMLElement>('[data-capability-error="mcp-server:example"]')
  expect(inlineError).not.toBeNull()
  expect(inlineError?.closest("article")?.textContent).toContain("Example")
  expect(inlineError?.textContent).toContain("The operation could not be completed")
  expect(inlineError?.textContent).not.toContain("/Users/")
  expect(inlineError?.textContent).not.toContain("https://")
  expect(document.activeElement).toBe(inlineError)
  expect(scrollIntoView).toHaveBeenCalledTimes(1)

  await act(async () => button("Update Example").click())
  expect(marketplace.beginUpdate).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[data-capability-error="mcp-server:example"]')).toBeNull()
  await act(async () => button("Cancel").click())
})

test("shows a session-wide Plugin outage and does not offer unusable Plugin setup", async () => {
  const marketplace = client({
    listInstalled: mock(async () => ({
      capabilities: [
        {
          attention: "plugin-runtime-unavailable-for-session",
          id: "example",
          kind: "plugin" as const,
          name: "Example",
          runtimeScope: "agent" as const,
          sourceLabel: "Convax Official",
          state: "attention" as const,
          updateAvailable: true,
          version: "1.0.0",
        },
      ],
      pluginRuntimeState: "unavailable-for-session" as const,
      revision: 1,
    })),
  })
  await render(marketplace)

  expect(document.body.textContent).toContain("The Plugin subsystem is unavailable for this session")
  expect(button("Import…").disabled).toBe(true)
  expect(button("Install Example").disabled).toBe(true)
  await act(async () => button("Installed").click())
  expect(document.body.textContent).toContain("Unavailable for this session")
  expect(document.body.textContent).not.toContain("Complete setup")
  expect(button("Update Example").disabled).toBe(true)
  expect(button("Disable Example").disabled).toBe(true)
  expect(button("Uninstall Example").disabled).toBe(true)
  expect(marketplace.setup).not.toHaveBeenCalled()
})

test("keeps Update available only for a byte-verified retired Host API recovery", async () => {
  const marketplace = client({
    listInstalled: mock(async () => ({
      capabilities: [
        {
          attention: "plugin-runtime-unavailable-for-session",
          id: "example",
          kind: "plugin" as const,
          name: "Example",
          runtimeScope: "agent" as const,
          sourceLabel: "Convax Official",
          state: "attention" as const,
          updateAvailable: true,
          updateRecoveryAvailable: true as const,
          version: "1.0.0",
        },
      ],
      pluginRuntimeState: "unavailable-for-session" as const,
      revision: 1,
    })),
  })
  await render(marketplace)

  expect(document.body.textContent).toContain("retired Host API")
  await act(async () => button("Installed").click())
  expect(document.body.textContent).toContain("Protocol update available")
  expect(button("Update Example").disabled).toBe(false)
  expect(button("Disable Example").disabled).toBe(true)
  await act(async () => button("Update Example").click())
  expect(marketplace.beginUpdate).toHaveBeenCalledWith({ id: "example", kind: "plugin" })
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
