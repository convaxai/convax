import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { readMarketplaceProductLock } from "../../../scripts/marketplace-product-lock"
import { materializeMarketplaceProductLock } from "./materialize-marketplace-product-lock"
import { stageMarketplaceProductLock } from "./stage-marketplace-product-lock"

type DevelopmentMarketplacePreparation = () => Promise<void>

export type DevelopmentMarketplacePreparationResult = { status: "ready" } | { reason: string; status: "unavailable" }

function errorReason(error: unknown) {
  return error instanceof Error ? error.message : "unknown Marketplace preparation error"
}

async function removeStagedProduct(outputDirectory: string) {
  const parent = path.dirname(outputDirectory)
  const disabled = path.join(parent, `.${path.basename(outputDirectory)}.disabled.${randomUUID()}`)
  try {
    await fs.rename(outputDirectory, disabled)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return
    throw error
  }
  await fs.rm(disabled, { force: true, recursive: true })
}

export async function prepareDevelopmentMarketplaceProduct(options: {
  outputDirectory: string
  prepare: DevelopmentMarketplacePreparation
}): Promise<DevelopmentMarketplacePreparationResult> {
  try {
    await options.prepare()
    return { status: "ready" }
  } catch (error) {
    // A previously staged product belongs to a different lock and must not
    // become an implicit fallback when the current strict preparation fails.
    await removeStagedProduct(options.outputDirectory)
    return { reason: errorReason(error), status: "unavailable" }
  }
}

if (import.meta.main) {
  const lockPath = path.resolve(process.argv[2] ?? "../../marketplaces.lock.json")
  const cacheRoot = path.resolve(process.argv[3] ?? ".packaging/marketplace-cache")
  const outputDirectory = path.resolve(".packaging/marketplace-product")
  const result = await prepareDevelopmentMarketplaceProduct({
    outputDirectory,
    prepare: async () => {
      await readMarketplaceProductLock(lockPath)
      const materialized = await materializeMarketplaceProductLock({ cacheRoot, lockPath })
      await stageMarketplaceProductLock({
        lockPath,
        outputDirectory,
        releaseRoot: materialized.artifactRoot,
      })
    },
  })
  if (result.status === "unavailable") {
    console.warn(`Development Marketplace product is unavailable; fixed sources remain reserved (${result.reason})`)
  }
}
