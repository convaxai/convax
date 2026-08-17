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

  test("creates the approved v12 source, preinstall policy, and exact retired-major recovery set", () => {
    expect(CURRENT_MARKETPLACE_PRODUCT_POLICY_REVISION).toBe(12)
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
      recoveryArtifacts: [
        {
          id: "cutout-studio",
          kind: "plugin",
          marketplaceId: "convax-official",
          retired: {
            artifact: {
              sha256: "1167cc5541a05e755135c354ab8f6bee04c343d3d5c7b8300ae3ff3562a088a0",
              size: 3_238,
            },
            hostApiMajor: 1,
            snapshotDigest: "cffcb23ddf8a40c20f338268fc20df1fc2b6c2d8a712b2808f60ce02fecefb4a",
            sourceKey: "c214bdc5f0af1e19a2bf8d98bd73b816e51ceaae2c4872bb07c76bde57e1e9bb",
            version: "0.2.1",
          },
          targets: ["darwin-arm64"],
          version: "0.3.2",
        },
        {
          id: "nexus-service",
          kind: "plugin",
          marketplaceId: "convax-official",
          retired: {
            artifact: {
              sha256: "32899a84630de5d41fbc5011d1271b9d1309a21056b17c8d7afe70107fc01f65",
              size: 2_630,
            },
            hostApiMajor: 1,
            snapshotDigest: "64e62ac8d76cb85c548e64ec7c20dd8d581826917139a255e0f62afb56dcdcd6",
            sourceKey: "c214bdc5f0af1e19a2bf8d98bd73b816e51ceaae2c4872bb07c76bde57e1e9bb",
            version: "0.3.14",
          },
          targets: ["darwin-arm64"],
          version: "1.0.6",
        },
        {
          id: "storyai-3d-director-desk",
          kind: "plugin",
          marketplaceId: "convax-official",
          retired: {
            artifact: {
              sha256: "a910abb3091ea973afaab8885ff77a1d69ac3fb2605f6bbf86079f33ce1af8f9",
              size: 1_523_814,
            },
            hostApiMajor: 1,
            snapshotDigest: "21eb0591de2e0ea3920e147b29252297f4324eb2f7ff1d896312e6db698a65f3",
            sourceKey: "c214bdc5f0af1e19a2bf8d98bd73b816e51ceaae2c4872bb07c76bde57e1e9bb",
            version: "0.1.3",
          },
          targets: [],
          version: "0.3.3",
        },
        {
          id: "storyboard-studio",
          kind: "plugin",
          marketplaceId: "convax-official",
          retired: {
            artifact: {
              sha256: "b1b07d89093c7fb4d68431581266321c74e4e6717c012561edc56dd5bcf6634b",
              size: 714_872,
            },
            hostApiMajor: 1,
            snapshotDigest: "d132196ee22f5145e9f85bc25260f1fa40296c15a96bc1d22cc3ca301ac02d3c",
            sourceKey: "c214bdc5f0af1e19a2bf8d98bd73b816e51ceaae2c4872bb07c76bde57e1e9bb",
            version: "0.1.1",
          },
          targets: [],
          version: "0.2.3",
        },
        {
          id: "video-timeline",
          kind: "plugin",
          marketplaceId: "convax-official",
          retired: {
            artifact: {
              sha256: "71c64f025a29a9c55ed156aa33172b9a016a4ac24df54d8274bd4422d7fc7a9f",
              size: 188_398,
            },
            hostApiMajor: 1,
            snapshotDigest: "4da431a9734faf9db17039d21856d6e8cc9baf8774afc1ebb6fad452a8472b76",
            sourceKey: "c214bdc5f0af1e19a2bf8d98bd73b816e51ceaae2c4872bb07c76bde57e1e9bb",
            version: "0.1.5",
          },
          targets: [],
          version: "0.2.2",
        },
      ],
      revision: 12,
    })
  })

  test("rejects non-positive or non-integral revisions", () => {
    expect(() => configureMarketplaceProductPolicy(0)).toThrow("revision")
    expect(() => configureMarketplaceProductPolicy(1.5)).toThrow("revision")
  })
})
