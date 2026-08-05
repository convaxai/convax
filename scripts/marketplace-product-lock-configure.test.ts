import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  CURRENT_MARKETPLACE_PRODUCT_POLICY_REVISION,
  configureMarketplaceProductPolicy,
} from "./marketplace-product-lock-configure"

describe("Marketplace product policy configuration", () => {
  test("requires an explicit policy revision at the CLI boundary", () => {
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "marketplace-product-lock-configure.ts")], {
      stderr: "pipe",
      stdout: "pipe",
    })

    expect(result.exitCode).not.toBe(0)
    expect(new TextDecoder().decode(result.stderr)).toContain("--revision=<positive integer>")
  })

  test("creates only the approved v3 source, preinstall policy, and empty recovery set", () => {
    expect(CURRENT_MARKETPLACE_PRODUCT_POLICY_REVISION).toBe(3)
    expect(configureMarketplaceProductPolicy(CURRENT_MARKETPLACE_PRODUCT_POLICY_REVISION)).toEqual({
      builtin: { marketplaceId: "convax-builtin", repository: "convaxai/convax-plugins" },
      official: {
        descriptorUrl: "https://convaxai.github.io/convax-plugins/marketplace.json",
        marketplaceId: "convax-official",
        repository: "convaxai/convax-plugins",
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
      recoveryArtifacts: [],
      revision: 3,
    })
  })

  test("rejects non-positive or non-integral revisions", () => {
    expect(() => configureMarketplaceProductPolicy(0)).toThrow("revision")
    expect(() => configureMarketplaceProductPolicy(1.5)).toThrow("revision")
  })
})
