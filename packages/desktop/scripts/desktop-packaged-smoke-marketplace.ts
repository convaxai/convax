import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const sha256Pattern = /^[a-f0-9]{64}$/

export function assertAutomaticPreinstalledCapability(capability: unknown, identity: { id: string; version: string }) {
  if (
    !isRecord(capability) ||
    capability.id !== identity.id ||
    capability.kind !== "plugin" ||
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

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export async function assertAutomaticPreinstalledAuthorization(
  userDataRoot: string,
  identity: { id: string; version: string },
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
      candidate.version === identity.version,
  )
  if (!isRecord(installation) || typeof installation.sourceKey !== "string") {
    throw new Error("Packaged automatic preinstall installation is missing")
  }

  const authorizationDirectory = path.join(userDataRoot, "plugin-authorizations", identity.id)
  const entries = await fs.readdir(authorizationDirectory, { withFileTypes: true })
  if (
    entries.length !== 1 ||
    !entries[0]?.isFile() ||
    entries[0].isSymbolicLink() ||
    !entries[0].name.endsWith(".json")
  ) {
    throw new Error(`Packaged automatic preinstall Tool authorization is invalid: ${JSON.stringify(entries)}`)
  }
  const receipt = JSON.parse(
    await fs.readFile(path.join(authorizationDirectory, entries[0].name), "utf8"),
  ) as unknown
  if (
    !isRecord(receipt) ||
    receipt.schema !== "convax.tool-plugin-authorization/1" ||
    receipt.bindingKind !== "managed" ||
    receipt.pluginId !== identity.id ||
    receipt.pluginVersion !== identity.version ||
    typeof receipt.key !== "string" ||
    !sha256Pattern.test(receipt.key)
  ) {
    throw new Error("Packaged automatic preinstall Tool authorization receipt is invalid")
  }
  const expectedContractDigest = sha256(JSON.stringify({ hook: null, tool: receipt.key }))
  const grant = executionGrants.find(
    (candidate) =>
      isRecord(candidate) &&
      isRecord(candidate.identity) &&
      candidate.identity.id === identity.id &&
      candidate.identity.kind === "plugin" &&
      candidate.sourceKey === installation.sourceKey,
  )
  if (
    !isRecord(grant) ||
    grant.authorizationContractDigest !== expectedContractDigest ||
    !Number.isSafeInteger(grant.revision)
  ) {
    throw new Error("Packaged automatic preinstall ExecutionGrant is missing or does not match its managed receipt")
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

export function assertMarketplaceSmokeSnapshot(snapshot: unknown) {
  if (!isRecord(snapshot)) throw new Error("Packaged Marketplace smoke snapshot is invalid")
  if (snapshot.marketplaceSurfaceVisible !== true) {
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
  if (!isRecord(snapshot.ffmpegInstalled) || snapshot.ffmpegInstalled.sourceLabel !== "convax-official") {
    throw new Error("Packaged Marketplace did not retain the Official ffmpeg-tools source")
  }
  assertAutomaticPreinstalledCapability(snapshot.ffmpegInstalled, {
    id: "ffmpeg-tools",
    version: String(snapshot.ffmpegInstalled.version),
  })
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
