import fs from "node:fs/promises"
import { sha256Hex, type RegistryPackage, type SourceQualifiedItem } from "@convax/marketplace"

import type { MarketplaceCapabilityInstallerPort } from "./marketplace-application-service"
import type { LocalMarketplacePackage } from "./local-marketplace-store"
import type { MarketplaceMcpMetadataStore } from "./marketplace-mcp-metadata"
import type { CapabilityTransition, InstallRecord } from "./marketplace-state"
import type { MarketplacePluginSetupMode } from "./marketplace-plugin-setup-authorization"
import type { MarketplaceArtifactInstaller } from "./marketplace-artifact-installer"

export interface DesktopMarketplaceCapabilityInstallerOptions {
  installLocalPlugin(
    directory: string,
    options: { authorizeExecution: boolean },
    item: LocalMarketplacePackage,
  ): Promise<void>
  installLocalSkill(directory: string): Promise<void>
  resolveInstalledTransition(transition: CapabilityTransition): Promise<"next" | "previous" | "unknown">
  mcp: MarketplaceMcpMetadataStore
  authorizePlugin(id: string, mode: MarketplacePluginSetupMode): Promise<string | null>
  currentPluginAuthorization(id: string): Promise<string | null>
  verifyPluginAuthorization(id: string, authorizationContractDigest: string): Promise<boolean>
  disablePlugin(id: string): Promise<void>
  enablePlugin(id: string): Promise<void>
  hardRefreshPlugin(id: string): Promise<void>
  refreshPetProvider(id: string): Promise<void>
  remote: Pick<MarketplaceArtifactInstaller, "installVerifiedMarketplaceCandidate">
  resolvePackage(item: SourceQualifiedItem): Promise<RegistryPackage>
  uninstallPlugin(id: string): Promise<void>
  uninstallSkill(id: string): Promise<void>
  fetchArtifact(item: SourceQualifiedItem, artifact: { sha256: string; size: number; url: string }): Promise<Uint8Array>
}

export class DesktopMarketplaceCapabilityInstaller implements MarketplaceCapabilityInstallerPort {
  readonly #options: DesktopMarketplaceCapabilityInstallerOptions

  constructor(options: DesktopMarketplaceCapabilityInstallerOptions) {
    this.#options = options
  }

  async prepareArtifact(item: SourceQualifiedItem, bytes: Uint8Array) {
    const registryItem = await this.#options.resolvePackage(item)
    const companionBytes: Record<string, Uint8Array> = {}
    for (const companion of registryItem.companions ?? []) {
      const target = companion.targets.find(
        (entry) => entry.platform === process.platform && entry.arch === process.arch,
      )
      if (!target) throw new Error("Marketplace Plugin has no companion for this platform")
      companionBytes[companion.command] = await this.#options.fetchArtifact(item, target.artifact)
    }
    return { artifactBytes: Uint8Array.from(bytes), companionBytes }
  }

  async installArtifact(
    item: SourceQualifiedItem,
    prepared: { artifactBytes: Uint8Array; companionBytes: Readonly<Record<string, Uint8Array>> },
    options: { authorizeExecution: boolean },
  ) {
    const registryItem = await this.#options.resolvePackage(item)
    await this.#options.remote.installVerifiedMarketplaceCandidate(
      {
        artifactBytes: prepared.artifactBytes,
        ...(Object.keys(prepared.companionBytes).length ? { companionBytes: prepared.companionBytes } : {}),
        item: registryItem,
        sourceIdentity: item.sourceKey,
      },
      {
        deferExecutionAuthorization: !options.authorizeExecution,
      },
    )
    const authorizationContractDigest = options.authorizeExecution
      ? await this.#options.currentPluginAuthorization(item.id)
      : null
    return authorizationContractDigest ? { authorizationContractDigest } : {}
  }

  async installBuiltin(item: SourceQualifiedItem, bytes: Uint8Array) {
    if (item.kind !== "skill" || item.delivery.kind !== "builtin-artifact") {
      throw new Error("The first Builtin Marketplace bundle admits standalone Skills only")
    }
    await this.#options.remote.installVerifiedMarketplaceCandidate({
      artifactBytes: bytes,
      sourceIdentity: item.sourceKey,
      item: {
        compatibility: item.compatibility,
        delivery: {
          kind: "artifact",
          sha256: sha256Hex(bytes),
          size: bytes.byteLength,
          url: "https://github.com/microvoid/convax-plugins/releases/download/builtin/internal",
        },
        id: item.id,
        kind: "skill",
        presentation: item.presentation,
        version: item.version,
      },
    })
  }

  async installLocal(
    item: LocalMarketplacePackage,
    snapshotDirectory: string,
    options: { authorizeExecution: boolean },
  ) {
    const realSnapshot = await fs.realpath(snapshotDirectory)
    if (item.kind === "plugin") {
      await this.#options.installLocalPlugin(realSnapshot, options, item)
      const authorizationContractDigest = options.authorizeExecution
        ? await this.#options.currentPluginAuthorization(item.id)
        : null
      return authorizationContractDigest ? { authorizationContractDigest } : {}
    }
    if (item.kind === "skill") {
      await this.#options.installLocalSkill(realSnapshot)
      return {}
    }
    throw new Error("Local MCP metadata uses its dedicated canonical owner")
  }

  async installMcpMetadata(
    item: SourceQualifiedItem,
    companion?: { bytes: Uint8Array; sha256: string; size: number },
    options: { asCandidate: boolean } = { asCandidate: false },
  ) {
    if (!options.asCandidate) {
      await this.#options.mcp.install(item, companion)
      return {}
    }
    const candidate = await this.#options.mcp.prepareCandidate(item, companion)
    const grant = await this.#options.mcp.setup(candidate)
    if (!grant) throw new Error("MCP update candidate requires explicit setup")
    return grant
  }

  async commitMcpCandidate(identity: { id: string; kind: "mcp-server" | "plugin" | "skill" }) {
    if (identity.kind === "mcp-server") await this.#options.mcp.commitCandidate(identity.id)
  }

  async discardMcpCandidate(identity: { id: string; kind: "mcp-server" | "plugin" | "skill" }) {
    if (identity.kind === "mcp-server") await this.#options.mcp.discardCandidate(identity.id)
  }

  async prepareSetup(record: InstallRecord, pickAddTarget: () => Promise<string | null>) {
    if (record.kind !== "mcp-server") return {}
    const metadata = (await this.#options.mcp.read()).records.find(
      (entry) => entry.id === record.id && entry.sourceKey === record.sourceKey && entry.version === record.version,
    )
    return metadata?.metadata.mode === "managed-stdio" && metadata.metadata.executable === null
      ? { addTarget: await pickAddTarget() }
      : {}
  }

  async setup(
    record: InstallRecord,
    prepared: { addTarget?: string | null },
    options: { mode: MarketplacePluginSetupMode },
  ) {
    if (record.kind === "plugin") {
      const authorizationContractDigest = await this.#options.authorizePlugin(record.id, options.mode)
      return authorizationContractDigest ? { authorizationContractDigest } : null
    }
    if (record.kind === "skill") return null
    const metadata = (await this.#options.mcp.read()).records.find(
      (entry) => entry.id === record.id && entry.sourceKey === record.sourceKey && entry.version === record.version,
    )
    if (!metadata) throw new Error("Installed MCP metadata is unavailable")
    return this.#options.mcp.setup(
      metadata,
      prepared.addTarget === undefined ? undefined : async () => prepared.addTarget ?? null,
    )
  }

  async activate(record: InstallRecord, authorizationContractDigest: string) {
    if (record.kind !== "mcp-server") return
    const metadata = (await this.#options.mcp.read()).records.find(
      (entry) => entry.id === record.id && entry.sourceKey === record.sourceKey && entry.version === record.version,
    )
    if (!metadata) throw new Error("Installed MCP metadata is unavailable")
    await this.#options.mcp.activate(metadata, authorizationContractDigest)
  }

  async uninstall(identity: { id: string; kind: "mcp-server" | "plugin" | "skill" }) {
    if (identity.kind === "plugin") return this.#options.uninstallPlugin(identity.id)
    if (identity.kind === "skill") return this.#options.uninstallSkill(identity.id)
    return this.#options.mcp.uninstall(identity.id)
  }

  async disable(identity: { id: string; kind: "mcp-server" | "plugin" | "skill" }) {
    if (identity.kind === "plugin") return this.#options.disablePlugin(identity.id)
    if (identity.kind === "mcp-server") await this.#options.mcp.disableRuntime(identity.id)
  }

  async enable(identity: { id: string; kind: "mcp-server" | "plugin" | "skill" }) {
    if (identity.kind === "plugin") return this.#options.enablePlugin(identity.id)
  }

  async resolveTransition(transition: CapabilityTransition) {
    if (transition.identity.kind === "mcp-server") {
      const record = (await this.#options.mcp.read()).records.find((entry) => entry.id === transition.identity.id)
      if (!record) return transition.next === null ? ("next" as const) : ("previous" as const)
      if (
        transition.next &&
        record.sourceKey === transition.next.sourceKey &&
        record.version === transition.next.version
      )
        return "next" as const
      if (
        transition.previous &&
        record.sourceKey === transition.previous.sourceKey &&
        record.version === transition.previous.version
      ) {
        await this.#options.mcp.discardCandidate(transition.identity.id)
        return "previous" as const
      }
      return "unknown" as const
    }
    return this.#options.resolveInstalledTransition(transition)
  }

  async hardRefresh(identity: { id: string; kind: "mcp-server" | "plugin" | "skill" }) {
    if (identity.kind === "mcp-server") await this.#options.mcp.hardRefresh()
    if (identity.kind === "plugin") {
      await this.#options.hardRefreshPlugin(identity.id)
      await this.#options.refreshPetProvider(identity.id)
    }
  }

  verifyAuthorization(record: InstallRecord, authorizationContractDigest: string) {
    if (record.kind === "plugin") {
      return this.#options.verifyPluginAuthorization(record.id, authorizationContractDigest)
    }
    if (record.kind === "mcp-server") {
      return this.#options.mcp.read().then((state) => {
        const metadata = state.records.find(
          (entry) => entry.id === record.id && entry.sourceKey === record.sourceKey && entry.version === record.version,
        )
        return metadata ? this.#options.mcp.verifyAuthorization(metadata, authorizationContractDigest) : false
      })
    }
    return Promise.resolve(true)
  }
}
