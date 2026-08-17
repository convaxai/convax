import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import type { MarketplaceProductPolicy } from "./marketplace-product-lock"

export const CURRENT_MARKETPLACE_PRODUCT_POLICY_REVISION = 13

const DEFAULT_STANDALONE_SKILLS = [
  "ad-idea",
  "audiobook",
  "convax-plugin-authoring",
  "ecommerce-image",
  "film-shot",
  "image-remix",
  "short-drama-screenwriter",
  "skill-creator",
  "skill-reviewer",
  "video-prompting",
] as const

export function configureMarketplaceProductPolicy(revision: number): MarketplaceProductPolicy {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Marketplace product policy revision must be a positive safe integer")
  }
  return {
    builtin: {
      marketplaceId: "convax-builtin",
      repository: "convaxai/convax-plugins",
    },
    official: {
      descriptorUrl: "https://convaxai.github.io/convax-plugins/marketplace.json",
      marketplaceId: "convax-official",
      repository: "convaxai/convax-plugins",
    },
    packages: [
      {
        id: "ffmpeg-tools",
        kind: "plugin",
        marketplaceId: "convax-official",
        purposes: ["default-install"],
        targets: ["darwin-arm64"],
      },
      {
        id: "jianying-editor",
        kind: "plugin",
        marketplaceId: "convax-official",
        purposes: ["default-install"],
        targets: ["darwin-arm64"],
      },
      {
        id: "cutout-studio",
        kind: "plugin",
        marketplaceId: "convax-official",
        purposes: ["retired-recovery"],
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
        purposes: ["default-install", "retired-recovery"],
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
      ...DEFAULT_STANDALONE_SKILLS.map((id): MarketplaceProductPolicy["packages"][number] => ({
        id,
        kind: "skill",
        marketplaceId: "convax-official",
        purposes: ["default-install"],
        targets: [],
      })),
      {
        id: "storyai-3d-director-desk",
        kind: "plugin",
        marketplaceId: "convax-official",
        purposes: ["retired-recovery"],
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
        purposes: ["retired-recovery"],
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
        purposes: ["retired-recovery"],
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
    revision,
  }
}

if (import.meta.main) {
  const pathArgument = process.argv.find((argument) => argument.startsWith("--lock="))
  const revisionArgument = process.argv.find((argument) => argument.startsWith("--revision="))
  const write = process.argv.includes("--write")
  if (!revisionArgument) {
    throw new Error("usage: marketplace-product-lock-configure --revision=<positive integer> [--lock=path] [--write]")
  }
  const revision = Number(revisionArgument.slice("--revision=".length))
  const policy = configureMarketplaceProductPolicy(revision)
  const lockPath = resolve(pathArgument?.slice("--lock=".length) || "marketplaces.lock.json")
  let output: unknown = policy
  try {
    const current = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>
    output = { ...current, policy }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const body = `${JSON.stringify(output, null, 2)}\n`
  if (write) {
    await writeFile(lockPath, body, { encoding: "utf8", mode: 0o600 })
    console.log(`Marketplace policy configured; run marketplace:lock before packaging: ${lockPath}`)
  } else {
    process.stdout.write(body)
  }
}
