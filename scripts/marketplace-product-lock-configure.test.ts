import { describe, expect, test } from "bun:test"

import { configureMarketplaceProductPolicy } from "./marketplace-product-lock-configure"

describe("Marketplace product policy configuration", () => {
  test("creates only the approved v1 source and preinstall policy", () => {
    expect(configureMarketplaceProductPolicy(7)).toEqual({
      builtin: { marketplaceId: "convax-builtin", repository: "microvoid/convax-plugins" },
      official: {
        descriptorUrl: "https://microvoid.github.io/convax-plugins/marketplace.json",
        marketplaceId: "convax-official",
        repository: "microvoid/convax-plugins",
      },
      preinstalledPackages: [
        {
          id: "ffmpeg-tools",
          kind: "plugin",
          marketplaceId: "convax-official",
          setup: "automatic",
          targets: ["darwin-arm64"],
        },
      ],
      revision: 7,
    })
  })

  test("rejects non-positive or non-integral revisions", () => {
    expect(() => configureMarketplaceProductPolicy(0)).toThrow("revision")
    expect(() => configureMarketplaceProductPolicy(1.5)).toThrow("revision")
  })
})
