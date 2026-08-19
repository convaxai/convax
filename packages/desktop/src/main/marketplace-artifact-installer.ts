import { createHash } from "node:crypto"

import type { RegistryPackage } from "@convax/marketplace"

import { parseWebPluginManifest, type WebPluginManifest } from "../plugin-contracts"
import type { PluginSnapshotInstaller } from "./plugin-snapshot-installer"
import { unpackSafeZip } from "./safe-zip"
import type { DesktopSkillManager } from "./skill-manager"

type MarketplacePluginCompanion = NonNullable<RegistryPackage["companions"]>[number]
type MarketplacePluginCompanionTarget = MarketplacePluginCompanion["targets"][number]

export interface VerifiedMarketplaceCandidate {
  artifactBytes: Uint8Array
  companionBytes?: Readonly<Record<string, Uint8Array>>
  item: RegistryPackage
  sourceIdentity?: string
}

export interface MarketplaceArtifactInstallerOptions {
  arch?: NodeJS.Architecture
  beforePluginPublish?(input: { pluginId: string; sourceIdentity: string }): Promise<void> | void
  deferExecutionAuthorization?: boolean
  platform?: NodeJS.Platform
  skillManager: Pick<DesktopSkillManager, "installFromFiles" | "installFromFilesAtStartup">
  snapshotInstaller: Pick<PluginSnapshotInstaller, "install">
}

function decodePluginManifest(manifest: WebPluginManifest, files: Readonly<Record<string, Uint8Array>>) {
  const document = files["manifest.json"]
  if (!document) throw new Error("Marketplace Plugin bundle is missing manifest.json")
  let bundled
  try {
    bundled = parseWebPluginManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(document)))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Marketplace Plugin bundle manifest is invalid", {
      cause: error,
    })
  }
  if (JSON.stringify(bundled) !== JSON.stringify(manifest)) {
    throw new Error("Marketplace Plugin bundle manifest does not match the verified Registry package")
  }
}

/**
 * Publishes one source-qualified Marketplace v2 candidate through the immutable
 * Plugin/Skill owners. Discovery, fetching, selection, and source trust remain
 * Marketplace responsibilities; this class has no Registry client.
 */
export class MarketplaceArtifactInstaller {
  readonly #arch: NodeJS.Architecture
  readonly #beforePluginPublish?: MarketplaceArtifactInstallerOptions["beforePluginPublish"]
  readonly #deferExecutionAuthorization: boolean
  readonly #platform: NodeJS.Platform
  readonly #skillManager: MarketplaceArtifactInstallerOptions["skillManager"]
  readonly #snapshotInstaller: MarketplaceArtifactInstallerOptions["snapshotInstaller"]

  constructor(options: MarketplaceArtifactInstallerOptions) {
    this.#arch = options.arch ?? process.arch
    this.#beforePluginPublish = options.beforePluginPublish
    this.#deferExecutionAuthorization = options.deferExecutionAuthorization ?? false
    this.#platform = options.platform ?? process.platform
    this.#skillManager = options.skillManager
    this.#snapshotInstaller = options.snapshotInstaller
  }

  async installVerifiedMarketplaceCandidate(
    candidate: VerifiedMarketplaceCandidate,
    options: {
      deferExecutionAuthorization?: boolean
      expectedInstalledVersion?: string
      startup?: boolean
      recoverExistingSkillOnly?: boolean
      replaceExistingSkill?: boolean
    } = {},
  ) {
    const { item } = candidate
    if (item.yanked) throw new Error("Yanked Marketplace package cannot be installed")
    if (
      item.delivery.kind !== "artifact" ||
      candidate.artifactBytes.byteLength !== item.delivery.size ||
      createHash("sha256").update(candidate.artifactBytes).digest("hex") !== item.delivery.sha256
    ) {
      throw new Error("Verified Marketplace candidate artifact identity is invalid")
    }
    const files = unpackSafeZip(candidate.artifactBytes)
    if (item.kind === "skill") {
      if (item.ownerPluginId) throw new Error(`Skill is provided by Plugin ${item.ownerPluginId}`)
      if (options.startup) {
        if (options.replaceExistingSkill || options.recoverExistingSkillOnly) {
          throw new Error("Cold-start Skill provisioning cannot replace an existing installation")
        }
        return this.#skillManager.installFromFilesAtStartup(files, item.id)
      }
      return this.#skillManager.installFromFiles(
        files,
        undefined,
        item.id,
        options.replaceExistingSkill === true,
        options.recoverExistingSkillOnly === true,
      )
    }
    if (item.kind !== "plugin" || !item.manifest) {
      throw new Error("MCP metadata does not use the Plugin or Skill publication owner")
    }
    const manifest = parseWebPluginManifest(item.manifest)
    if (manifest.id !== item.id || manifest.version !== item.version) {
      throw new Error("Verified Marketplace Plugin metadata does not match its manifest")
    }
    decodePluginManifest(manifest, files)
    const deferExecutionAuthorization = options.deferExecutionAuthorization ?? this.#deferExecutionAuthorization
    const companionArtifacts = (item.companions ?? []).map((companion) => {
      const target = companion.targets.find(
        (candidate) => candidate.platform === this.#platform && candidate.arch === this.#arch,
      )
      if (!target) throw new Error("Verified Marketplace Plugin companion target is unavailable")
      const bytes = candidate.companionBytes?.[companion.command]
      if (
        !bytes ||
        bytes.byteLength !== target.artifact.size ||
        createHash("sha256").update(bytes).digest("hex") !== target.artifact.sha256
      ) {
        throw new Error("Verified Marketplace Plugin companion identity is invalid")
      }
      return { bytes, companion, target }
    })
    if (!candidate.sourceIdentity) throw new Error("Marketplace Plugin snapshot SourceKey is unavailable")
    return this.#publishSnapshotPlugin(
      item,
      manifest,
      files,
      companionArtifacts,
      candidate.sourceIdentity,
      deferExecutionAuthorization,
      options.expectedInstalledVersion,
    )
  }

  async #publishSnapshotPlugin(
    item: RegistryPackage,
    manifest: WebPluginManifest,
    files: Readonly<Record<string, string | Uint8Array>>,
    companionArtifacts: readonly {
      bytes: Uint8Array
      companion: MarketplacePluginCompanion
      target: MarketplacePluginCompanionTarget
    }[],
    sourceIdentity: string,
    deferExecutionAuthorization = this.#deferExecutionAuthorization,
    expectedInstalledVersion?: string,
  ) {
    if (item.kind !== "plugin" || item.delivery.kind !== "artifact") {
      throw new Error("Marketplace Plugin publication requires artifact delivery")
    }
    const command = manifest.runtime?.command
    const selected = command ? companionArtifacts.filter(({ companion }) => companion.command === command) : []
    if (command && selected.length !== 1) {
      throw new Error(`Executable Plugin requires exactly one verified runtime companion: ${item.id}`)
    }
    if (!command && companionArtifacts.length > 0) {
      throw new Error(`Plugin without a local runtime cannot publish companion artifacts: ${item.id}`)
    }
    const runtimeCompanion = selected[0]
    await this.#beforePluginPublish?.({ pluginId: item.id, sourceIdentity })
    return this.#snapshotInstaller.install(
      {
        artifact: { sha256: item.delivery.sha256, size: item.delivery.size },
        authorizeExecution: !(deferExecutionAuthorization ?? this.#deferExecutionAuthorization),
        ...(runtimeCompanion
          ? {
              companion: {
                bytes: runtimeCompanion.bytes,
                command: runtimeCompanion.companion.command,
                target: `${runtimeCompanion.target.platform}-${runtimeCompanion.target.arch}`,
              },
            }
          : {}),
        files,
        sourceIdentity,
      },
      {
        allowCurrent: true,
        ...(expectedInstalledVersion ? { expectedInstalledVersion } : {}),
      },
    )
  }
}
