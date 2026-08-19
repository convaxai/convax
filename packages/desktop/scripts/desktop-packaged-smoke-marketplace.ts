import fs from "node:fs/promises"
import path from "node:path"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function packagedStartupStageReached(diagnostics: string, stage: string) {
  const lines = diagnostics.split("\n")
  return lines.some((line) => line.includes(` ${stage}`))
}

export async function assertNoLegacyDefaultCapabilityReceipt(userDataRoot: string) {
  try {
    await fs.lstat(path.join(userDataRoot, "default-capabilities.json"))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return
    throw error
  }
  throw new Error("Packaged Marketplace recreated the legacy default capability receipt")
}

export function assertMarketplaceSmokeSnapshot(
  snapshot: unknown,
  options: { marketplaceSurfaceRequired?: boolean } = {},
) {
  if (!isRecord(snapshot)) throw new Error("Packaged Marketplace smoke snapshot is invalid")
  if ((options.marketplaceSurfaceRequired ?? true) && snapshot.marketplaceSurfaceVisible !== true) {
    throw new Error("Packaged Desktop did not expose the Marketplace Settings surface")
  }
  if (!Array.isArray(snapshot.settingsSources) || snapshot.settingsSources.length !== 0) {
    throw new Error("Fresh packaged Desktop exposed a product-selected Marketplace source")
  }
  if (snapshot.catalogCount !== 0 || snapshot.installedCount !== 0) {
    throw new Error("Fresh packaged Desktop provisioned product-selected Marketplace capabilities")
  }
}

export async function assertLocalMarketplaceIdentity(userDataRoot: string) {
  const file = path.join(userDataRoot, "marketplaces", "local", "primary", "marketplace.json")
  const metadata = await fs.lstat(file)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error("Packaged Local Marketplace identity is invalid")
  }
  let identity: unknown
  try {
    identity = JSON.parse(await fs.readFile(file, "utf8"))
  } catch (error) {
    throw new Error("Packaged Local Marketplace identity is invalid", { cause: error })
  }
  if (
    !isRecord(identity) ||
    Object.keys(identity).sort().join("\0") !==
      ["marketplaceId", "policyVersion", "sourceInstanceId"].sort().join("\0") ||
    identity.marketplaceId !== "convax-local" ||
    identity.policyVersion !== 1 ||
    typeof identity.sourceInstanceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identity.sourceInstanceId)
  ) {
    throw new Error("Packaged Local Marketplace identity is invalid")
  }
  return identity
}
