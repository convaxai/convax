import fs from "node:fs/promises"
import path from "node:path"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const sha256Pattern = /^[a-f0-9]{64}$/

export function packagedStartupStageReached(diagnostics: string, stage: string) {
  const lines = diagnostics.split("\n")
  if (lines.some((line) => line.includes(" marketplace-provision-failed"))) {
    throw new Error(`Packaged Marketplace provisioning failed: ${diagnostics.trim()}`)
  }
  return lines.some((line) => line.includes(` ${stage}`))
}

export function assertAutomaticPreinstalledCapability(capability: unknown, identity: { id: string; version: string }) {
  if (
    !isRecord(capability) ||
    capability.id !== identity.id ||
    capability.kind !== "plugin" ||
    capability.sourceLabel !== "convax-official" ||
    capability.version !== identity.version ||
    capability.state !== "ready"
  ) {
    throw new Error(
      `Packaged automatic preinstall must be ready: ${JSON.stringify({
        capability,
        identity,
      })}`,
    )
  }
}

export async function assertAutomaticPreinstalledAuthorization(
  userDataRoot: string,
  identity: {
    artifactDigest: string
    authorizationContractDigest: string
    id: string
    sourceKey: string
    version: string
  },
) {
  const state = JSON.parse(
    await fs.readFile(path.join(userDataRoot, "marketplaces", "state-v1.json"), "utf8"),
  ) as unknown
  if (!isRecord(state) || state.schema !== "convax.marketplace-state/1") {
    throw new Error("Packaged automatic preinstall Marketplace state is invalid")
  }
  const installations = state.installations
  const executionGrants = state.executionGrants
  if (!Array.isArray(installations) || !Array.isArray(executionGrants)) {
    throw new Error("Packaged automatic preinstall Marketplace authority is invalid")
  }
  const installation = installations.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.id === identity.id &&
      candidate.kind === "plugin" &&
      candidate.artifactDigest === identity.artifactDigest &&
      candidate.sourceKey === identity.sourceKey &&
      candidate.version === identity.version,
  )
  if (!isRecord(installation)) {
    throw new Error("Packaged automatic preinstall installation is missing")
  }

  if (!sha256Pattern.test(identity.authorizationContractDigest)) {
    throw new Error("Packaged automatic preinstall authorization digest is invalid")
  }
  const grant = executionGrants.find(
    (candidate) =>
      isRecord(candidate) &&
      isRecord(candidate.identity) &&
      candidate.identity.id === identity.id &&
      candidate.identity.kind === "plugin" &&
      candidate.sourceKey === identity.sourceKey,
  )
  if (
    !isRecord(grant) ||
    grant.authorizationContractDigest !== identity.authorizationContractDigest ||
    !Number.isSafeInteger(grant.revision)
  ) {
    throw new Error("Packaged automatic preinstall ExecutionGrant does not match its immutable Plugin authorization")
  }
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
  automaticPreinstall?: { id: string; version: string },
  options: { marketplaceSurfaceRequired?: boolean } = {},
) {
  if (!isRecord(snapshot)) throw new Error("Packaged Marketplace smoke snapshot is invalid")
  if ((options.marketplaceSurfaceRequired ?? true) && snapshot.marketplaceSurfaceVisible !== true) {
    throw new Error("Packaged Desktop did not expose the Marketplace Settings surface")
  }
  const settingsSources = snapshot.settingsSources
  if (
    !Array.isArray(settingsSources) ||
    !settingsSources.some((source) => isRecord(source) && source.id === "convax-official" && source.removable === false)
  ) {
    throw new Error("Packaged Marketplace did not expose the fixed Official source")
  }
  if (
    settingsSources.some(
      (source) => isRecord(source) && (source.id === "convax-builtin" || source.id === "convax-local"),
    )
  ) {
    throw new Error("Packaged Marketplace Settings exposed an internal source")
  }
  if (
    !isRecord(snapshot.catalogCard) ||
    snapshot.catalogCard.id !== "canvas-storyboard" ||
    snapshot.catalogCard.kind !== "skill"
  ) {
    throw new Error("Packaged Marketplace did not catalog the Builtin canvas-storyboard Skill")
  }
  if (
    !isRecord(snapshot.storyboardChoice) ||
    snapshot.storyboardChoice.marketplaceLabel !== "convax-builtin" ||
    snapshot.storyboardChoice.setup !== "none" ||
    typeof snapshot.storyboardChoice.version !== "string"
  ) {
    throw new Error("Packaged Marketplace did not select the Builtin canvas-storyboard source")
  }
  if (
    !Array.isArray(snapshot.storyboardSources) ||
    !snapshot.storyboardSources.includes("convax-builtin") ||
    snapshot.storyboardSources.includes("convax-official")
  ) {
    throw new Error(
      `Packaged Marketplace did not keep the installed Builtin storyboard source-locked: ${JSON.stringify(
        snapshot.storyboardSources,
      )}`,
    )
  }
  if (
    !isRecord(snapshot.storyboardInstalled) ||
    snapshot.storyboardInstalled.id !== "canvas-storyboard" ||
    snapshot.storyboardInstalled.kind !== "skill" ||
    snapshot.storyboardInstalled.sourceLabel !== "convax-builtin" ||
    snapshot.storyboardInstalled.state !== "ready" ||
    snapshot.storyboardInstalled.version !== snapshot.storyboardChoice.version
  ) {
    throw new Error("Packaged Marketplace did not install the Builtin canvas-storyboard Skill")
  }
  if (automaticPreinstall === undefined) {
    if (snapshot.ffmpegInstalled !== undefined) {
      throw new Error("Packaged Marketplace installed a target-specific Plugin on an unsupported target")
    }
    return
  }
  if (
    !isRecord(snapshot.ffmpegInstalled) ||
    snapshot.ffmpegInstalled.id !== automaticPreinstall.id ||
    snapshot.ffmpegInstalled.sourceLabel !== "convax-official"
  ) {
    throw new Error("Packaged Marketplace did not retain the declared Official automatic preinstall")
  }
  assertAutomaticPreinstalledCapability(snapshot.ffmpegInstalled, automaticPreinstall)
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
