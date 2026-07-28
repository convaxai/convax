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
import path from "node:path"
import type { DesktopBuiltinPluginBundle } from "./builtin-plugin-catalog"
import type { DesktopBuiltinSkillBundle } from "./builtin-skill-catalog"
import {
  WebPluginPublicationDeferredError,
  type WebPluginManager,
  type WebPluginPublicationCandidate,
  type WebPluginMutationContext,
  type WebPluginPublicationTransaction,
} from "./plugin-manager"
import type { ManagedPluginCompanionStore } from "./managed-plugin-companions"
import type { PluginHookAuthorizationStore } from "./plugin-hook-authorizations"
import type { ToolPluginAuthorizationStore } from "./tool-plugin-authorizations"
import {
  type RemoteCapabilityPackage,
  type RemoteCapabilityRegistryClient,
  type RemotePluginPackage,
  type RemoteSkillPackage,
} from "./remote-capability-registry"
import type { DesktopSkillManager } from "./skill-manager"
import { createSkillFilePreviews } from "./skill-details"
import { composePluginPublicationTransactions, type PluginSkillLifecycle } from "./plugin-skill-lifecycle"

export interface RemoteCapabilityRegistryPort {
  downloadBundle: RemoteCapabilityRegistryClient["downloadBundle"]
  downloadCompanionArtifact: RemoteCapabilityRegistryClient["downloadCompanionArtifact"]
  downloadSkillShowcase: RemoteCapabilityRegistryClient["downloadSkillShowcase"]
  fetchRegistry: RemoteCapabilityRegistryClient["fetchRegistry"]
  subscribe?(listener: () => void): () => void
}

export interface RemotePluginCatalogPort {
  getPluginReleaseUrl(id: string): Promise<string>
  installPlugin(
    id: string,
    options?: { allowCurrent?: boolean; allowHooks?: boolean },
  ): Promise<InstalledWebPluginSummary>
  listPluginCatalog(installedIds: ReadonlySet<string>): Promise<WebPluginCatalogItem[]>
  /** Shared remote Registry invalidation for the Plugin catalog UI. */
  subscribe?(listener: () => void): () => void
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
  beforePluginPublish?(pluginId: string): Promise<void> | void
  builtinPlugins: readonly DesktopBuiltinPluginBundle[]
  builtinSkills: readonly DesktopBuiltinSkillBundle[]
  companionStore: Pick<ManagedPluginCompanionStore, "install" | "reconcilePlugin">
  hookAuthorizationStore: Pick<PluginHookAuthorizationStore, "prepareInstall">
  platform?: NodeJS.Platform
  pluginManager: Pick<
    WebPluginManager,
    "installBundle" | "isBundleInstalled" | "list" | "resolveAsset" | "withPluginMutation"
  >
  pluginSkillLifecycle: Pick<PluginSkillLifecycle, "prepareInstall" | "reconcileInstalled">
  preparePluginPublication?(pluginId: string): Promise<WebPluginPublicationTransaction>
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
  readonly #beforePluginPublish?: RemoteCapabilityInstallerOptions["beforePluginPublish"]
  readonly #companionStore: RemoteCapabilityInstallerOptions["companionStore"]
  readonly #hookAuthorizationStore: RemoteCapabilityInstallerOptions["hookAuthorizationStore"]
  readonly #platform: NodeJS.Platform
  readonly #pluginManager: RemoteCapabilityInstallerOptions["pluginManager"]
  readonly #pluginSkillLifecycle: RemoteCapabilityInstallerOptions["pluginSkillLifecycle"]
  readonly #prepareHostPublication?: RemoteCapabilityInstallerOptions["preparePluginPublication"]
  readonly #registry: RemoteCapabilityRegistryPort
  readonly #skillManager: RemoteCapabilityInstallerOptions["skillManager"]

  constructor(options: RemoteCapabilityInstallerOptions) {
    this.#registry = options.registry
    this.#authorizationStore = options.authorizationStore
    this.#beforePluginPublish = options.beforePluginPublish
    this.#pluginManager = options.pluginManager
    this.#pluginSkillLifecycle = options.pluginSkillLifecycle
    this.#prepareHostPublication = options.preparePluginPublication
    this.#companionStore = options.companionStore
    this.#hookAuthorizationStore = options.hookAuthorizationStore
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

  #pluginDownload(item: RemotePluginPackage): WebPluginCatalogItem["download"] | undefined {
    let companionBytes = 0
    for (const companion of item.companions ?? []) {
      const target = companion.targets.find(
        (candidate) => candidate.platform === this.#platform && candidate.arch === this.#arch,
      )
      // Do not understate a download for a Plugin that cannot run on this host.
      if (!target) return undefined
      companionBytes += target.artifact.size
    }
    const totalBytes = item.artifact.size + companionBytes
    if (!Number.isSafeInteger(totalBytes)) throw new Error(`Remote Plugin download size is invalid: ${item.id}`)
    return { companionBytes, packageBytes: item.artifact.size, totalBytes }
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
    return this.#plugins(await this.#packages("cache-first")).map((item) => {
      const download = this.#pluginDownload(item)
      return {
        ...item.manifest,
        ...(download ? { download } : {}),
        installed: installedIds.has(item.id),
        releaseAvailable: true,
      }
    })
  }

  async #pluginPackage(id: string) {
    const item = this.#plugins(await this.#packages()).find((candidate) => candidate.id === id)
    if (!item) throw new Error(`Remote Plugin catalog item was not found: ${id}`)
    return item
  }

  async getPluginReleaseUrl(id: string) {
    const item = await this.#pluginPackage(id)
    return `https://github.com/microvoid/convax-plugins/releases/tag/plugin-${item.id}-v${item.version}`
  }

  async #downloadPlugin(item: RemotePluginPackage) {
    const companionTargets = (item.companions ?? []).map((companion) => {
      const target = companion.targets.find(
        (candidate) => candidate.platform === this.#platform && candidate.arch === this.#arch,
      )
      if (!target) {
        throw new Error(`Remote Plugin companion has no target for this host: ${this.#platform}/${this.#arch}`)
      }
      return { companion, target }
    })
    const bundle = await this.#registry.downloadBundle(item)
    decodePluginManifest(item, bundle.files)
    const companionArtifacts = await Promise.all(
      companionTargets.map(async ({ companion, target }) => ({
        bytes: await this.#registry.downloadCompanionArtifact(item, companion, target),
        companion,
        target,
      })),
    )
    return { bundle, companionArtifacts }
  }

  async installPlugin(id: string, options: { allowCurrent?: boolean; allowHooks?: boolean } = {}) {
    const item = await this.#pluginPackage(id)
    if (item.manifest.hooks && options.allowHooks !== true) {
      throw new Error(`Plugin Hook installation requires an explicit user action: ${item.id}`)
    }
    const { bundle, companionArtifacts } = await this.#downloadPlugin(item)

    return this.#pluginManager.withPluginMutation(item.id, async (mutation) => {
      const current = (await this.#pluginManager.list()).find((plugin) => plugin.id === item.id)
      const comparison = current ? compareWebPluginVersions(item.version, current.version) : 1
      if (current && comparison < 0) {
        throw new Error(`Installed Plugin is newer than the remote Registry package: ${item.id}`)
      }
      if (current && comparison === 0 && !options.allowCurrent) {
        throw new Error(`Remote Plugin update must have a newer version: ${item.id}`)
      }
      if (current && comparison === 0 && !(await this.#pluginManager.isBundleInstalled(bundle, mutation))) {
        throw new Error(`Installed Plugin does not match the verified Registry package: ${item.id}`)
      }
      return this.#publishPlugin(item, bundle, companionArtifacts, current, mutation)
    })
  }

  async updatePlugin(id: string, options: { allowHooks?: boolean } = {}) {
    const item = await this.#pluginPackage(id)
    return this.#pluginManager.withPluginMutation(item.id, async (mutation) => {
      const current = (await this.#pluginManager.list()).find((plugin) => plugin.id === item.id)
      if (!current) throw new Error(`Remote Plugin update requires an installed Plugin: ${item.id}`)
      const comparison = compareWebPluginVersions(item.version, current.version)
      if (comparison < 0) {
        throw new Error(`Installed Plugin is newer than the remote Registry package: ${item.id}`)
      }
      if (comparison === 0) return current
      if (item.manifest.hooks && options.allowHooks !== true) {
        throw new Error(`Plugin Hook update requires an explicit user action: ${item.id}`)
      }
      const { bundle, companionArtifacts } = await this.#downloadPlugin(item)
      return this.#publishPlugin(item, bundle, companionArtifacts, current, mutation)
    })
  }

  async #publishPlugin(
    item: RemotePluginPackage,
    bundle: { files: Readonly<Record<string, Uint8Array>> },
    companionArtifacts: readonly {
      bytes: Uint8Array
      companion: NonNullable<RemotePluginPackage["companions"]>[number]
      target: NonNullable<RemotePluginPackage["companions"]>[number]["targets"][number]
    }[],
    current: InstalledWebPluginSummary | undefined,
    mutation: WebPluginMutationContext,
  ) {
    const companionTransactions: Awaited<ReturnType<ManagedPluginCompanionStore["install"]>>[] = []
    const managedBindings = new Map<string, Awaited<ReturnType<ManagedPluginCompanionStore["install"]>>["binding"]>()
    try {
      for (const { bytes, companion, target } of companionArtifacts) {
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
      const preparePublication = (plugin: InstalledWebPluginSummary, candidate: WebPluginPublicationCandidate) =>
        this.#preparePluginPublication(plugin, candidate, managedBindings)
      let installed: InstalledWebPluginSummary
      if (current && current.version === item.version) {
        const manifestFile = await this.#pluginManager.resolveAsset(current.id, "manifest.json")
        const publication = await this.#preparePluginPublication(
          current,
          { root: path.dirname(manifestFile) },
          managedBindings,
          async () => {
            if (!(await this.#pluginManager.isBundleInstalled(bundle, mutation))) {
              throw new Error(`Installed Plugin changed during verified Registry repair: ${item.id}`)
            }
          },
        )
        await this.#runCurrentPublication(publication, current.id)
        installed = current
      } else {
        installed = await this.#pluginManager.installBundle(bundle, {
          beforePublish: preparePublication,
          mutation,
          ...(current ? { replaceExisting: true } : {}),
        })
      }
      // The package/current-package repair is the point of no return. Cleanup
      // only removes obsolete companion versions and is retried at startup.
      for (const transaction of companionTransactions) await transaction.commit().catch(() => undefined)
      await this.#companionStore.reconcilePlugin(item.id, installed).catch(() => undefined)
      return installed
    } catch (error) {
      if (error instanceof WebPluginPublicationDeferredError) throw error
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

  async #preparePluginPublication(
    plugin: InstalledWebPluginSummary,
    candidate: WebPluginPublicationCandidate,
    managedBindings: ReadonlyMap<string, Awaited<ReturnType<ManagedPluginCompanionStore["install"]>>["binding"]>,
    revalidateCurrent?: () => Promise<void>,
  ): Promise<WebPluginPublicationTransaction> {
    const managed = plugin.runtime ? managedBindings.get(plugin.runtime.command) : undefined
    const authorization = await this.#authorizationStore.prepareInstall(
      plugin,
      managed ? { binding: managed, kind: "managed" } : undefined,
    )
    let hookAuthorization
    let ownedSkills
    try {
      hookAuthorization = await this.#hookAuthorizationStore.prepareInstall(plugin, candidate)
      ownedSkills = await this.#pluginSkillLifecycle.prepareInstall(plugin, candidate)
    } catch (error) {
      await hookAuthorization?.rollback().catch(() => undefined)
      await authorization.rollback().catch(() => undefined)
      throw error
    }
    let hostPublication
    try {
      hostPublication = await this.#prepareHostPublication?.(plugin.id)
    } catch (error) {
      await ownedSkills?.rollback().catch(() => undefined)
      await authorization.rollback().catch(() => undefined)
      throw error
    }
    const beforePluginPublish = this.#beforePluginPublish
    const capabilityPublication: WebPluginPublicationTransaction = {
      async activate() {
        await ownedSkills?.activate?.()
      },
      async commit() {
        await ownedSkills?.commit()
        await hookAuthorization?.commit()
        await authorization.commit()
      },
      async publish() {
        await beforePluginPublish?.(plugin.id)
        await revalidateCurrent?.()
        await authorization.publish()
        try {
          await hookAuthorization?.publish()
          await ownedSkills?.publish()
        } catch (error) {
          await hookAuthorization?.rollback().catch(() => undefined)
          await authorization.rollback().catch(() => undefined)
          throw error
        }
      },
      async rollback() {
        const failures: unknown[] = []
        try {
          await ownedSkills?.rollback()
        } catch (error) {
          failures.push(error)
        }
        try {
          await hookAuthorization?.rollback()
        } catch (error) {
          failures.push(error)
        }
        try {
          await authorization.rollback()
        } catch (error) {
          failures.push(error)
        }
        if (failures.length) throw new AggregateError(failures, "Plugin publication rollback failed")
      },
      async deferToRecovery() {
        await hookAuthorization?.deferToRecovery?.()
        await ownedSkills?.deferToRecovery?.()
      },
    }
    return hostPublication
      ? composePluginPublicationTransactions([hostPublication, capabilityPublication])
      : capabilityPublication
  }

  async #runCurrentPublication(publication: WebPluginPublicationTransaction, pluginId: string) {
    try {
      await publication.publish()
      await publication.activate?.()
      await publication.commit()
    } catch (error) {
      try {
        await publication.rollback()
      } catch (rollbackError) {
        const failures: unknown[] = [error, rollbackError]
        try {
          await publication.deferToRecovery?.()
        } catch (deferError) {
          failures.push(deferError)
        }
        throw new WebPluginPublicationDeferredError(
          failures,
          `Current remote Plugin repair requires startup recovery: ${pluginId}`,
          { cause: error },
        )
      }
      throw error
    }
  }

  async listSkillCatalog(installedNames: ReadonlySet<string>): Promise<DesktopSkillCatalogItem[]> {
    const packages = await this.#packages("cache-first")
    const plugins = new Map(this.#plugins(packages).map((plugin) => [plugin.id, plugin]))
    return this.#skills(packages).map((item) => ({
      description: item.description,
      id: item.id,
      installed: installedNames.has(item.id),
      name: item.name,
      ...(item.ownerPluginId
        ? {
            ownerPluginId: item.ownerPluginId,
            ownerPluginName: plugins.get(item.ownerPluginId)?.name ?? item.ownerPluginId,
          }
        : {}),
    }))
  }

  async getSkillDetails(id: string): Promise<DesktopSkillDetails> {
    const item = this.#skills(await this.#packages("cache-first")).find((candidate) => candidate.id === id)
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
    if (item.ownerPluginId) {
      throw new Error(`Skill is provided by Plugin ${item.ownerPluginId} and cannot be installed independently`)
    }
    const bundle = await this.#registry.downloadBundle(item)
    return this.#skillManager.installFromFiles(bundle.files, undefined, item.id)
  }
}
