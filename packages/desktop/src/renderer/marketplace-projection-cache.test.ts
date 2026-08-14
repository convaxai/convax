import { expect, test } from "bun:test"

import type { MarketplaceViewProjection } from "./marketplace-projection-cache"
import {
  marketplaceProjectionStorageKey,
  readMarketplaceProjection,
  writeMarketplaceProjection,
} from "./marketplace-projection-cache"

function storage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(marketplaceProjectionStorageKey, initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

function projection(): MarketplaceViewProjection {
  return {
    catalog: [
      {
        categories: ["service", "image", "skill"],
        description: "A safe renderer projection",
        id: "example",
        kind: "plugin",
        name: "Example",
        otherSourceCount: 0,
      },
    ],
    installed: [
      {
        id: "example",
        kind: "plugin",
        name: "Example",
        sourceLabel: "Local",
        state: "ready",
        updateAvailable: false,
        version: "1.0.0",
      },
    ],
    pluginRuntimeState: "available",
    sources: [
      {
        health: "available",
        id: "convax-local",
        label: "Local",
        packageCount: 1,
        publisher: "Convax",
        removable: false,
        repository: "Local imports",
      },
    ],
  }
}

test("round-trips only the bounded renderer-safe Marketplace projection", () => {
  const target = storage()
  expect(writeMarketplaceProjection(target, projection())).toBe(true)
  expect(readMarketplaceProjection(target)).toEqual(projection())
})

test("invalidates the pre-category display cache instead of exposing empty filters", () => {
  expect(
    readMarketplaceProjection(
      storage(
        JSON.stringify({
          projection: {
            ...projection(),
            catalog: projection().catalog.map(({ categories: _categories, ...card }) => card),
          },
          schema: "convax.marketplace-display-cache/1",
        }),
      ),
    ),
  ).toBeNull()
})

test("ignores malformed, oversized, and authority-shaped Marketplace cache entries", () => {
  expect(readMarketplaceProjection(storage("{"))).toBeNull()
  expect(readMarketplaceProjection(storage("x".repeat(2 * 1024 * 1024 + 1)))).toBeNull()
  expect(
    readMarketplaceProjection(
      storage(
        JSON.stringify({
          projection: {
            ...projection(),
            sources: [{ ...projection().sources[0], sourceKey: "renderer-must-not-cache" }],
          },
          schema: "convax.marketplace-display-cache/2",
        }),
      ),
    ),
  ).toBeNull()
  expect(
    readMarketplaceProjection(
      storage(
        JSON.stringify({
          projection: {
            ...projection(),
            catalog: [{ ...projection().catalog[0], categories: ["image", "image"] }],
          },
          schema: "convax.marketplace-display-cache/2",
        }),
      ),
    ),
  ).toBeNull()
  expect(
    readMarketplaceProjection(
      storage(
        JSON.stringify({
          projection: {
            ...projection(),
            catalog: [{ ...projection().catalog[0], categories: ["unknown"] }],
          },
          schema: "convax.marketplace-display-cache/2",
        }),
      ),
    ),
  ).toBeNull()
})
