import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  canonicalJson,
  decideSourceMutation,
  type SourceKey,
  type SourceSecurityState as MarketplaceProtocolSourceSecurityState,
  parseRegistryV2,
  type RegistryV2,
} from "@convax/marketplace"
import type { MarketplaceItemKind } from "./marketplace-state"
import { readBoundedAuthorityFile } from "./bounded-authority-file"

export interface AcceptedMarketplaceCatalogItem {
  contractDigest: string
  id: string
  kind: MarketplaceItemKind
  version: string
}

export interface AcceptedMarketplaceCatalog {
  items: AcceptedMarketplaceCatalogItem[]
  registry?: RegistryV2
  revision: string
  sequence: number
}

export interface SourceSecurityState {
  acceptedCatalogDigest: string
  acceptedRevision: string
  highestSequence: number
  revision: number
  schema: "convax.marketplace-source-security/1"
  snapshotFile: string
  sourceKey: SourceKey
  versionContracts: Record<string, string>
}

export interface AcceptedMarketplaceSource {
  catalog: AcceptedMarketplaceCatalog
  security: SourceSecurityState
}

export interface MarketplaceSourceSecurityLimits {
  maxCanonicalBytes: number
  maxVersionContracts: number
}

export interface FileMarketplaceSourceStoreOptions {
  /** Test seam at the crash boundary after immutable snapshot publication. */
  beforeDecision?: () => Promise<void>
  limits?: Partial<MarketplaceSourceSecurityLimits>
  root: string
  sourceKey: SourceKey
}

export class MarketplaceSourceSecurityError extends Error {
  override readonly name = "MarketplaceSourceSecurityError"
}

const defaultLimits: MarketplaceSourceSecurityLimits = {
  maxCanonicalBytes: 8 * 1024 * 1024,
  maxVersionContracts: 16_384,
}
const digestPattern = /^[a-f0-9]{64}$/u
const itemKinds = new Set<MarketplaceItemKind>(["mcp-server", "plugin", "skill"])
const maxDecisionBytes = 8 * 1024 * 1024
const maxCatalogBytes = 8 * 1024 * 1024

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function itemKey(item: Pick<AcceptedMarketplaceCatalogItem, "id" | "kind" | "version">) {
  return `${item.kind}\0${item.id}\0${item.version}`
}

function identityKey(item: Pick<AcceptedMarketplaceCatalogItem, "id" | "kind">) {
  return `${item.kind}\0${item.id}`
}

function parseCatalog(value: unknown): AcceptedMarketplaceCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketplaceSourceSecurityError("Marketplace Catalog is invalid")
  }
  const input = value as Record<string, unknown>
  const expectedKeys = [...(input.registry === undefined ? [] : ["registry"]), "items", "revision", "sequence"]
  if (
    Object.keys(input).sort().join("\0") !== expectedKeys.sort().join("\0") ||
    !Number.isSafeInteger(input.sequence) ||
    Number(input.sequence) < 0 ||
    typeof input.revision !== "string" ||
    input.revision.length < 1 ||
    input.revision.length > 256 ||
    !Array.isArray(input.items) ||
    input.items.length > 16_384
  ) {
    throw new MarketplaceSourceSecurityError("Marketplace Catalog is invalid")
  }
  const identities = new Set<string>()
  for (const value of input.items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new MarketplaceSourceSecurityError("Marketplace Catalog item is invalid")
    }
    const item = value as Record<string, unknown>
    if (
      Object.keys(item).sort().join("\0") !== ["contractDigest", "id", "kind", "version"].sort().join("\0") ||
      typeof item.contractDigest !== "string" ||
      !digestPattern.test(item.contractDigest) ||
      typeof item.id !== "string" ||
      item.id.length < 1 ||
      item.id.length > 256 ||
      !itemKinds.has(item.kind as MarketplaceItemKind) ||
      typeof item.version !== "string" ||
      item.version.length < 1 ||
      item.version.length > 256
    ) {
      throw new MarketplaceSourceSecurityError("Marketplace Catalog item is invalid")
    }
    const key = identityKey(item as unknown as AcceptedMarketplaceCatalogItem)
    if (identities.has(key)) {
      throw new MarketplaceSourceSecurityError("Marketplace Catalog repeats a current capability identity")
    }
    identities.add(key)
  }
  if (input.registry !== undefined) {
    const registry = parseRegistryV2(input.registry)
    if (
      registry.sequence !== input.sequence ||
      registry.revision !== input.revision ||
      registry.packages.length !== input.items.length
    ) {
      throw new MarketplaceSourceSecurityError("Marketplace Catalog Registry does not match its accepted summary")
    }
    const summaries = new Map(
      (input.items as AcceptedMarketplaceCatalogItem[]).map((item) => [identityKey(item), item]),
    )
    for (const item of registry.packages) {
      const summary = summaries.get(identityKey(item))
      if (
        !summary ||
        summary.version !== item.version ||
        summary.contractDigest !== sha256(canonicalJson(item))
      ) {
        throw new MarketplaceSourceSecurityError("Marketplace Catalog Registry does not match its accepted summary")
      }
    }
  }
  return structuredClone(input) as unknown as AcceptedMarketplaceCatalog
}

function parseSecurity(value: unknown, sourceKey: SourceKey): SourceSecurityState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketplaceSourceSecurityError("Marketplace SourceSecurityState is invalid")
  }
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).sort().join("\0") !==
      [
        "acceptedCatalogDigest",
        "acceptedRevision",
        "highestSequence",
        "revision",
        "schema",
        "snapshotFile",
        "sourceKey",
        "versionContracts",
      ]
        .sort()
        .join("\0") ||
    input.schema !== "convax.marketplace-source-security/1" ||
    input.sourceKey !== sourceKey ||
    typeof input.acceptedCatalogDigest !== "string" ||
    !digestPattern.test(input.acceptedCatalogDigest) ||
    typeof input.acceptedRevision !== "string" ||
    !Number.isSafeInteger(input.highestSequence) ||
    Number(input.highestSequence) < 0 ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 1 ||
    typeof input.snapshotFile !== "string" ||
    input.snapshotFile !== `${input.acceptedCatalogDigest}.json` ||
    !input.versionContracts ||
    typeof input.versionContracts !== "object" ||
    Array.isArray(input.versionContracts)
  ) {
    throw new MarketplaceSourceSecurityError("Marketplace SourceSecurityState is invalid")
  }
  for (const [key, digest] of Object.entries(input.versionContracts as Record<string, unknown>)) {
    if (key.split("\0").length !== 3 || typeof digest !== "string" || !digestPattern.test(digest)) {
      throw new MarketplaceSourceSecurityError("Marketplace SourceSecurityState is invalid")
    }
  }
  return structuredClone(input) as unknown as SourceSecurityState
}

async function atomicWrite(file: string, bytes: string) {
  const directory = path.dirname(file)
  await fs.mkdir(directory, { mode: 0o700, recursive: true })
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
  let published = false
  try {
    const handle = await fs.open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(bytes, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporary, file)
    published = true
    const directoryHandle = await fs.open(directory, "r")
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } finally {
    if (!published) await fs.rm(temporary, { force: true })
  }
}

export class FileMarketplaceSourceStore {
  readonly #beforeDecision?: () => Promise<void>
  readonly #cacheDirectory: string
  readonly #decisionFile: string
  readonly #limits: MarketplaceSourceSecurityLimits
  readonly #sourceKey: SourceKey
  #tail = Promise.resolve()

  constructor(options: FileMarketplaceSourceStoreOptions) {
    if (!digestPattern.test(options.sourceKey)) {
      throw new Error("Marketplace SourceKey is invalid")
    }
    const key = sha256(options.sourceKey)
    this.#beforeDecision = options.beforeDecision
    this.#cacheDirectory = path.join(path.resolve(options.root), "marketplace-cache", key)
    this.#decisionFile = path.join(path.resolve(options.root), "marketplace-source-security", `${key}.json`)
    this.#limits = { ...defaultLimits, ...options.limits }
    this.#sourceKey = options.sourceKey
  }

  async readAccepted(): Promise<AcceptedMarketplaceSource | null> {
    const security = await this.#readSecurity()
    if (!security) return null
    return { catalog: await this.#readCatalog(security), security }
  }

  async #readSecurity(): Promise<SourceSecurityState | null> {
    try {
      const bytes = await readBoundedAuthorityFile(
        this.#decisionFile,
        Math.min(this.#limits.maxCanonicalBytes, maxDecisionBytes),
        "Marketplace SourceSecurityState",
      )
      return parseSecurity(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        this.#sourceKey,
      )
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null
      if (error instanceof SyntaxError) {
        throw new MarketplaceSourceSecurityError("Marketplace SourceSecurityState is invalid")
      }
      throw error
    }
  }

  async #readCatalog(security: SourceSecurityState): Promise<AcceptedMarketplaceCatalog> {
    const snapshot = await readBoundedAuthorityFile(
      path.join(this.#cacheDirectory, security.snapshotFile),
      Math.min(this.#limits.maxCanonicalBytes, maxCatalogBytes),
      "Accepted Marketplace Catalog snapshot",
    )
    if (sha256(snapshot) !== security.acceptedCatalogDigest) {
      throw new MarketplaceSourceSecurityError("Accepted Marketplace Catalog snapshot is missing or corrupt")
    }
    let catalog: AcceptedMarketplaceCatalog
    try {
      catalog = parseCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot)))
    } catch (error) {
      throw new MarketplaceSourceSecurityError("Accepted Marketplace Catalog snapshot is missing or corrupt", {
        cause: error,
      })
    }
    if (catalog.sequence !== security.highestSequence || catalog.revision !== security.acceptedRevision) {
      throw new MarketplaceSourceSecurityError("Accepted Marketplace Catalog does not match SourceSecurityState")
    }
    return catalog
  }

  accept(catalog: AcceptedMarketplaceCatalog): Promise<AcceptedMarketplaceSource> {
    const run = this.#tail.then(() => this.#accept(parseCatalog(catalog)))
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async #accept(catalog: AcceptedMarketplaceCatalog): Promise<AcceptedMarketplaceSource> {
    const previousSecurity = await this.#readSecurity()
    const catalogBytes = `${canonicalJson(catalog)}\n`
    if (Buffer.byteLength(catalogBytes) > this.#limits.maxCanonicalBytes) {
      throw new MarketplaceSourceSecurityError("Marketplace Catalog exceeded its canonical byte limit")
    }
    const catalogDigest = sha256(catalogBytes)
    if (previousSecurity) {
      if (catalog.sequence < previousSecurity.highestSequence) {
        throw new MarketplaceSourceSecurityError("Marketplace Catalog sequence rollback was rejected")
      }
      if (catalog.sequence === previousSecurity.highestSequence) {
        if (
          catalog.revision !== previousSecurity.acceptedRevision ||
          catalogDigest !== previousSecurity.acceptedCatalogDigest
        ) {
          throw new MarketplaceSourceSecurityError("Marketplace Catalog changed at an accepted sequence")
        }
        await this.#publishSnapshot(catalogBytes, catalogDigest, true)
        return { catalog: structuredClone(catalog), security: structuredClone(previousSecurity) }
      }
    }
    const versionContracts: Record<string, string> = {}
    for (const item of catalog.items) {
      const key = itemKey(item)
      versionContracts[key] = item.contractDigest
    }
    let accepted: MarketplaceProtocolSourceSecurityState
    try {
      accepted = decideSourceMutation(
        previousSecurity
          ? {
              catalogDigest: previousSecurity.acceptedCatalogDigest,
              revision: previousSecurity.acceptedRevision,
              sequence: previousSecurity.highestSequence,
              versionContracts: previousSecurity.versionContracts,
            }
          : undefined,
        {
          catalogDigest,
          revision: catalog.revision,
          sequence: catalog.sequence,
          versionContracts,
        },
      )
    } catch (error) {
      throw new MarketplaceSourceSecurityError(
        error instanceof Error ? `Marketplace ${error.message}` : "Marketplace SourceSecurityState mutation failed",
        { cause: error },
      )
    }
    if (Object.keys(accepted.versionContracts).length > this.#limits.maxVersionContracts) {
      throw new MarketplaceSourceSecurityError("Marketplace SourceSecurityState exceeded its version-contract limit")
    }
    const security: SourceSecurityState = {
      acceptedCatalogDigest: accepted.catalogDigest,
      acceptedRevision: accepted.revision,
      highestSequence: accepted.sequence,
      revision: (previousSecurity?.revision ?? 0) + 1,
      schema: "convax.marketplace-source-security/1",
      snapshotFile: `${catalogDigest}.json`,
      sourceKey: this.#sourceKey,
      versionContracts: { ...accepted.versionContracts },
    }
    const decisionBytes = `${canonicalJson(security)}\n`
    if (Buffer.byteLength(decisionBytes) > this.#limits.maxCanonicalBytes) {
      throw new MarketplaceSourceSecurityError("Marketplace SourceSecurityState exceeded its canonical byte limit")
    }
    await this.#publishSnapshot(catalogBytes, catalogDigest, false)
    if (this.#beforeDecision) await this.#beforeDecision()
    await atomicWrite(this.#decisionFile, decisionBytes)
    return { catalog: structuredClone(catalog), security: structuredClone(security) }
  }

  async #publishSnapshot(catalogBytes: string, catalogDigest: string, replaceCorrupt: boolean) {
    await fs.mkdir(this.#cacheDirectory, { mode: 0o700, recursive: true })
    const snapshot = path.join(this.#cacheDirectory, `${catalogDigest}.json`)
    try {
      const handle = await fs.open(snapshot, "wx", 0o600)
      try {
        await handle.writeFile(catalogBytes, "utf8")
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error
      let existingDigest: string | undefined
      try {
        existingDigest = sha256(
          await readBoundedAuthorityFile(snapshot, maxCatalogBytes, "Prepared Marketplace Catalog snapshot"),
        )
      } catch {
        existingDigest = undefined
      }
      if (existingDigest !== catalogDigest && !replaceCorrupt) {
        throw new MarketplaceSourceSecurityError("Prepared Marketplace Catalog snapshot is corrupt")
      }
      if (existingDigest !== catalogDigest) {
        const replacement = `${snapshot}.${randomUUID()}.repair`
        const handle = await fs.open(replacement, "wx", 0o600)
        try {
          await handle.writeFile(catalogBytes, "utf8")
          await handle.sync()
        } finally {
          await handle.close()
        }
        await fs.rename(replacement, snapshot)
      }
    }
  }
}
