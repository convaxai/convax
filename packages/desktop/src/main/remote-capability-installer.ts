import {
  compareWebPluginVersions,
  type InstalledWebPluginSummary,
  type WebPluginCatalogItem,
  parseWebPluginManifest,
} from "../plugin-contracts"
import type {
  DesktopSkillCatalogItem,
  DesktopSkillDetails,
  DesktopSkillShowcase,
  DesktopSkillShowcaseMedia,
  DesktopSkillSummary,
} from "../skill-management-contracts"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type { DesktopBuiltinSkillBundle } from "./builtin-skill-catalog"
import type { WebPluginManager } from "./plugin-manager"
import type { ManagedPluginCompanionStore } from "./managed-plugin-companions"
import type { ToolPluginAuthorizationStore } from "./tool-plugin-authorizations"
import {
  type RemoteCapabilityPackage,
  type RemoteCapabilityRegistryClient,
  type RemotePluginPackage,
  type RemoteSkillPackage,
} from "./remote-capability-registry"
import type { DesktopSkillManager } from "./skill-manager"
import { createSkillFilePreviews } from "./skill-details"

export interface RemoteCapabilityRegistryPort {
  downloadBundle: RemoteCapabilityRegistryClient["downloadBundle"]
  downloadCompanionArtifact: RemoteCapabilityRegistryClient["downloadCompanionArtifact"]
  downloadSkillShowcase: RemoteCapabilityRegistryClient["downloadSkillShowcase"]
  fetchRegistry: RemoteCapabilityRegistryClient["fetchRegistry"]
  subscribe?(listener: () => void): () => void
}

export interface RemotePluginCatalogPort {
  installPlugin(id: string): Promise<InstalledWebPluginSummary>
  listPluginCatalog(installedIds: ReadonlySet<string>): Promise<WebPluginCatalogItem[]>
}

export interface RemoteSkillCatalogPort {
  getSkillDetails(id: string): Promise<DesktopSkillDetails>
  getSkillShowcase(id: string, media: DesktopSkillShowcaseMedia): Promise<DesktopSkillShowcase | null>
  installSkill(id: string): Promise<DesktopSkillSummary>
  listSkillCatalog(installedNames: ReadonlySet<string>): Promise<DesktopSkillCatalogItem[]>
  /** Shared remote Registry invalidation for the combined Skill & Plugin catalog UI. */
  subscribe?(listener: () => void): () => void
}

export interface RemoteCapabilityInstallerOptions {
  arch?: NodeJS.Architecture
  authorizationStore: Pick<ToolPluginAuthorizationStore, "prepareInstall">
  builtinPlugins: readonly DesktopBuiltinPluginBundle[]
  builtinSkills: readonly DesktopBuiltinSkillBundle[]
  companionStore: Pick<ManagedPluginCompanionStore, "install" | "reconcile">
  platform?: NodeJS.Platform
  pluginManager: Pick<WebPluginManager, "installBundle" | "list">
  registry: RemoteCapabilityRegistryPort
  skillManager: Pick<DesktopSkillManager, "installFromFiles">
}

function normalizedIdentity(value: string) {
  return value.toLocaleLowerCase("en-US")
}

function reservedIdentities(items: ReadonlyArray<{ id: string; name: string }>) {
  return new Set(items.flatMap((item) => [normalizedIdentity(item.id), normalizedIdentity(item.name)]))
}

function selectAvailable<T extends RemoteCapabilityPackage>(items: readonly T[], kind: T["kind"]) {
  const selected: T[] = []
  const ids = new Set<string>()
  for (const item of items) {
    if (item.yanked) continue
    if (ids.has(item.id)) throw new Error(`Remote ${kind} catalog has a duplicate id: ${item.id}`)
    ids.add(item.id)
    selected.push(item)
  }
  return selected
}

function assertNoIdentityCollisions<T extends { id: string; name: string }>(
  items: readonly T[],
  reserved: ReadonlySet<string>,
  kind: "Plugin" | "Skill",
) {
  const seen = new Map<string, string>()
  for (const item of items) {
    for (const value of [item.id, item.name]) {
      const identity = normalizedIdentity(value)
      if (reserved.has(identity)) {
        throw new Error(`Remote ${kind} collides with a built-in id or name: ${value}`)
      }
      const prior = seen.get(identity)
      if (prior && prior !== item.id) {
        throw new Error(`Remote ${kind} catalog has a duplicate id or name: ${value}`)
      }
      seen.set(identity, item.id)
    }
  }
  return items
}

function decodePluginManifest(item: RemotePluginPackage, files: Readonly<Record<string, Uint8Array>>) {
  const document = files["manifest.json"]
  if (!document) throw new Error("Remote Plugin bundle is missing manifest.json")
  let manifest
  try {
    manifest = parseWebPluginManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(document)))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Remote Plugin bundle manifest is invalid", {
      cause: error,
    })
  }
  if (JSON.stringify(manifest) !== JSON.stringify(item.manifest)) {
    throw new Error("Remote Plugin bundle manifest does not match the registry")
  }
  return manifest
}

/**
 * Main-owned coordinator that turns verified Registry entries into the existing
 * Plugin and Skill installation lifecycles. It never accepts a renderer URL.
 */
export class RemoteCapabilityInstaller implements RemotePluginCatalogPort, RemoteSkillCatalogPort {
  readonly #builtinPluginIdentities: ReadonlySet<string>
  readonly #builtinSkillIdentities: ReadonlySet<string>
  readonly #arch: NodeJS.Architecture
  readonly #authorizationStore: RemoteCapabilityInstallerOptions["authorizationStore"]
  readonly #companionStore: RemoteCapabilityInstallerOptions["companionStore"]
  readonly #platform: NodeJS.Platform
  readonly #pluginManager: RemoteCapabilityInstallerOptions["pluginManager"]
  readonly #registry: RemoteCapabilityRegistryPort
  readonly #skillManager: RemoteCapabilityInstallerOptions["skillManager"]

  constructor(options: RemoteCapabilityInstallerOptions) {
    this.#registry = options.registry
    this.#authorizationStore = options.authorizationStore
    this.#pluginManager = options.pluginManager
    this.#companionStore = options.companionStore
    this.#platform = options.platform ?? process.platform
    this.#arch = options.arch ?? process.arch
    this.#skillManager = options.skillManager
    this.#builtinPluginIdentities = reservedIdentities(options.builtinPlugins.map((item) => item.manifest))
    this.#builtinSkillIdentities = reservedIdentities(options.builtinSkills)
  }

  subscribe(listener: () => void) {
    return this.#registry.subscribe?.(listener) ?? (() => undefined)
  }

  async #packages(cachePolicy: "cache-first" | "network-first" = "network-first") {
    return (await this.#registry.fetchRegistry({ cachePolicy })).registry.packages
  }

  #plugins(packages: readonly RemoteCapabilityPackage[]) {
    return assertNoIdentityCollisions(
      selectAvailable(
        packages.filter((item): item is RemotePluginPackage => item.kind === "plugin"),
        "plugin",
      ),
      this.#builtinPluginIdentities,
      "Plugin",
    )
  }

  #skills(packages: readonly RemoteCapabilityPackage[]) {
    return assertNoIdentityCollisions(
      selectAvailable(
        packages.filter((item): item is RemoteSkillPackage => item.kind === "skill"),
        "skill",
      ),
      this.#builtinSkillIdentities,
      "Skill",
    )
  }

  async listPluginCatalog(installedIds: ReadonlySet<string>): Promise<WebPluginCatalogItem[]> {
    return this.#plugins(await this.#packages("cache-first")).map((item) => ({
      ...item.manifest,
      installed: installedIds.has(item.id),
    }))
  }

  async installPlugin(id: string) {
    const item = this.#plugins(await this.#packages()).find((candidate) => candidate.id === id)
    if (!item) throw new Error(`Remote Plugin catalog item was not found: ${id}`)
    const companionTargets = (item.companions ?? []).map((companion) => {
      const target = companion.targets.find(
        (candidate) => candidate.platform === this.#platform && candidate.arch === this.#arch,
      )
      if (!target) {
        throw new Error(`Remote Plugin companion has no target for this host: ${this.#platform}/${this.#arch}`)
      }
      return { companion, target }
    })
    const current = (await this.#pluginManager.list()).find((plugin) => plugin.id === item.id)
    if (current && compareWebPluginVersions(item.version, current.version) <= 0) {
      throw new Error(`Remote Plugin update must have a newer version: ${item.id}`)
    }
    const bundle = await this.#registry.downloadBundle(item)
    decodePluginManifest(item, bundle.files)
    const companionTransactions: Awaited<ReturnType<ManagedPluginCompanionStore["install"]>>[] = []
    const managedBindings = new Map<string, Awaited<ReturnType<ManagedPluginCompanionStore["install"]>>["binding"]>()
    try {
      for (const { companion, target } of companionTargets) {
        const bytes = await this.#registry.downloadCompanionArtifact(item, companion, target)
        const transaction = await this.#companionStore.install({
          arch: target.arch,
          bytes,
          command: companion.command,
          platform: target.platform,
          pluginId: item.id,
          pluginVersion: item.version,
          sha256: target.artifact.sha256,
          size: target.artifact.size,
          version: companion.version,
        })
        companionTransactions.push(transaction)
        managedBindings.set(companion.command, transaction.binding)
      }
      const prepareAuthorization = async (plugin: InstalledWebPluginSummary) => {
        const managed = plugin.runtime ? managedBindings.get(plugin.runtime.command) : undefined
        return this.#authorizationStore.prepareInstall(
          plugin,
          managed ? { binding: managed, kind: "managed" } : undefined,
        )
      }
      const installed = current
        ? await this.#pluginManager.installBundle(bundle, {
            beforePublish: prepareAuthorization,
            replaceExisting: true,
          })
        : await this.#pluginManager.installBundle(bundle, {
            beforePublish: prepareAuthorization,
          })
      // Plugin publication is the point of no return. Companion commit only
      // removes obsolete host-owned versions and must never turn that success
      // into a rollback attempt against the now-current Plugin.
      for (const transaction of companionTransactions) await transaction.commit().catch(() => undefined)
      try {
        await this.#companionStore.reconcile(await this.#pluginManager.list())
      } catch {
        // Publication already succeeded. Startup and lifecycle reconciliation
        // will retry cleanup without invalidating the installed Plugin.
      }
      return installed
    } catch (error) {
      const rollbackFailures: unknown[] = []
      for (const transaction of [...companionTransactions].reverse()) {
        try {
          await transaction.rollback()
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError)
        }
      }
      if (rollbackFailures.length) {
        throw new AggregateError([error, ...rollbackFailures], `Remote Plugin companion rollback failed: ${item.id}`, {
          cause: error,
        })
      }
      throw error
    }
  }

  async listSkillCatalog(installedNames: ReadonlySet<string>): Promise<DesktopSkillCatalogItem[]> {
    return this.#skills(await this.#packages("cache-first")).map((item) => ({
      description: item.description,
      id: item.id,
      installed: installedNames.has(item.id),
      name: item.name,
    }))
  }

  async getSkillDetails(id: string): Promise<DesktopSkillDetails> {
    const item = this.#skills(await this.#packages()).find((candidate) => candidate.id === id)
    if (!item) throw new Error(`Remote Skill catalog item was not found: ${id}`)
    const bundle = await this.#registry.downloadBundle(item, {
      zipLimits: {
        maxEntries: 1_000,
        maxFileBytes: 8 * 1024 * 1024,
        maxTotalBytes: 32 * 1024 * 1024,
      },
    })
    return {
      description: item.description,
      files: createSkillFilePreviews(bundle.files),
      id: item.id,
      name: item.name,
      version: item.version,
    }
  }

  async getSkillShowcase(id: string, media: DesktopSkillShowcaseMedia): Promise<DesktopSkillShowcase | null> {
    try {
      const { registry } = await this.#registry.fetchRegistry({ cachePolicy: "cache-first" })
      const item = this.#skills(registry.packages).find((candidate) => candidate.id === id)
      if (!item) return null
      return await this.#registry.downloadSkillShowcase(registry, item, { media })
    } catch {
      return null
    }
  }

  async installSkill(id: string) {
    const item = this.#skills(await this.#packages()).find((candidate) => candidate.id === id)
    if (!item) throw new Error(`Remote Skill catalog item was not found: ${id}`)
    const bundle = await this.#registry.downloadBundle(item)
    return this.#skillManager.installFromFiles(bundle.files, undefined, item.id)
  }
}
