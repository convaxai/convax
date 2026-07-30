import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import type { MarketplaceProductPolicy } from "./marketplace-product-lock"

export function configureMarketplaceProductPolicy(revision: number): MarketplaceProductPolicy {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Marketplace product policy revision must be a positive safe integer")
  }
  return {
    builtin: {
      marketplaceId: "convax-builtin",
      repository: "microvoid/convax-plugins",
    },
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
