import { randomBytes, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  canonicalJson,
  computeSourceKey,
  parseMarketplaceDescriptor,
  parseRegistryV2,
  sha256Hex,
  type MarketplaceDescriptor,
  type RegistryV2,
  type SourceKey,
  type SourceQualifiedItem,
} from "@convax/marketplace"

import { readBoundedAuthorityFile } from "./bounded-authority-file"
import { FileMarketplaceSourceStore, type AcceptedMarketplaceCatalog } from "./marketplace-source-store"
import { marketplaceRepositoryFromDescriptorUrl, PinnedHttpsFetcher } from "./pinned-https-fetch"
import { projectRegistryPackageRuntimeSurface } from "./marketplace-runtime-surface"

interface PersistedNetworkSource {
  descriptor: MarketplaceDescriptor
  descriptorUrl: string
  sourceKey: SourceKey
  sourceOrder: number
}

interface SourceGraph {
  nextSourceOrder: number
  revision: number
  schema: "convax.network-marketplace-sources/1"
  sources: PersistedNetworkSource[]
}

interface Preview {
  descriptor: MarketplaceDescriptor
  descriptorUrl: string
  expiresAt: number
  registry: RegistryV2
  sourceKey: SourceKey
  senderId: string
}

const maxGraphBytes = 2 * 1024 * 1024
const maxSources = 32
const previewTtlMs = 5 * 60_000
const maxPreviews = 64

function emptyGraph(): SourceGraph {
  return { nextSourceOrder: 0, revision: 0, schema: "convax.network-marketplace-sources/1", sources: [] }
}

function parseJson(bytes: Uint8Array, label: string) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch (error) {
    throw new Error(`${label} is invalid`, { cause: error })
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function parseGraph(value: unknown): SourceGraph {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Network Marketplace graph is invalid")
  }
  const input = value as Record<string, unknown>
  if (
    !exactKeys(input, ["nextSourceOrder", "revision", "schema", "sources"]) ||
    input.schema !== "convax.network-marketplace-sources/1" ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0 ||
    !Number.isSafeInteger(input.nextSourceOrder) ||
    Number(input.nextSourceOrder) < 0 ||
    !Array.isArray(input.sources) ||
    input.sources.length > maxSources
  ) {
    throw new Error("Network Marketplace graph is invalid")
  }
  const marketplaceIds = new Set<string>()
  const sourceKeys = new Set<string>()
  const sourceOrders = new Set<number>()
  const sources = input.sources.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Network Marketplace graph is invalid")
    }
    const source = value as Record<string, unknown>
    if (
      !exactKeys(source, ["descriptor", "descriptorUrl", "sourceKey", "sourceOrder"]) ||
      typeof source.descriptorUrl !== "string" ||
      typeof source.sourceKey !== "string" ||
      !/^[a-f0-9]{64}$/u.test(source.sourceKey) ||
      !Number.isSafeInteger(source.sourceOrder) ||
      Number(source.sourceOrder) < 0
    ) {
      throw new Error("Network Marketplace graph is invalid")
    }
    const descriptor = parseMarketplaceDescriptor(source.descriptor)
    const repository = marketplaceRepositoryFromDescriptorUrl(source.descriptorUrl)
    if (
      descriptor.repository.owner.toLowerCase() !== repository.owner ||
      descriptor.repository.name !== repository.repository
    ) {
      throw new Error("Network Marketplace graph is invalid")
    }
    const sourceKey = computeSourceKey({
      deliveryPolicy: "github-pages-releases",
      descriptorUrl: source.descriptorUrl,
      kind: "network",
      marketplaceId: descriptor.id,
      repository: { name: descriptor.repository.name, owner: descriptor.repository.owner },
    })
    const sourceOrder = Number(source.sourceOrder)
    if (
      sourceKey !== source.sourceKey ||
      marketplaceIds.has(descriptor.id) ||
      sourceKeys.has(sourceKey) ||
      sourceOrders.has(sourceOrder) ||
      sourceOrder >= Number(input.nextSourceOrder)
    ) {
      throw new Error("Network Marketplace graph is invalid")
    }
    marketplaceIds.add(descriptor.id)
    sourceKeys.add(sourceKey)
    sourceOrders.add(sourceOrder)
    return {
      descriptor,
      descriptorUrl: source.descriptorUrl,
      sourceKey,
      sourceOrder,
    }
  })
  return {
    nextSourceOrder: Number(input.nextSourceOrder),
    revision: Number(input.revision),
    schema: "convax.network-marketplace-sources/1",
    sources,
  }
}

function catalog(registry: RegistryV2): AcceptedMarketplaceCatalog {
  return {
    items: registry.packages.map((item) => ({
      contractDigest: sha256Hex(canonicalJson(item)),
      id: item.id,
      kind: item.kind,
      version: item.version,
    })),
    registry,
    revision: registry.revision,
    sequence: registry.sequence,
  }
}

async function atomicGraph(file: string, value: SourceGraph) {
  const bytes = `${canonicalJson(value)}\n`
  if (Buffer.byteLength(bytes) > maxGraphBytes) throw new Error("Network Marketplace graph exceeds its byte limit")
  const directory = path.dirname(file)
  await fs.mkdir(directory, { mode: 0o700, recursive: true })
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
  let published = false
  try {
    const handle = await fs.open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(temporary, file)
    published = true
    const parent = await fs.open(directory, "r")
    try {
      await parent.sync()
    } finally {
      await parent.close()
    }
  } finally {
    if (!published) await fs.rm(temporary, { force: true })
  }
}

export class NetworkMarketplaceManager {
  readonly #fetcher: PinnedHttpsFetcher
  readonly #file: string
  readonly #root: string
  readonly #previews = new Map<string, Preview>()
  readonly #listeners = new Set<() => void>()
  readonly #reservedMarketplaceIds: ReadonlySet<string>
  #tail = Promise.resolve()

  constructor(options: { fetcher: PinnedHttpsFetcher; reservedMarketplaceIds?: ReadonlySet<string>; root: string }) {
    this.#fetcher = options.fetcher
    this.#root = path.resolve(options.root)
    this.#file = path.join(this.#root, "sources-v1.json")
    this.#reservedMarketplaceIds =
      options.reservedMarketplaceIds ?? new Set(["convax-builtin", "convax-local", "convax-official"])
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async preview(descriptorUrl: string, senderId: string, signal?: AbortSignal) {
    if (!senderId || senderId.length > 256) throw new Error("Marketplace preview sender is invalid")
    const now = Date.now()
    for (const [token, preview] of this.#previews) {
      if (preview.expiresAt <= now) this.#previews.delete(token)
    }
    if (this.#previews.size >= maxPreviews) throw new Error("Marketplace preview limit was reached")
    const expectedRepository = marketplaceRepositoryFromDescriptorUrl(descriptorUrl)
    const descriptor = parseMarketplaceDescriptor(
      parseJson(
        await this.#fetcher.fetch(descriptorUrl, "descriptor", { maxBytes: 1024 * 1024, signal }),
        "Marketplace descriptor",
      ),
    )
    if (this.#reservedMarketplaceIds.has(descriptor.id)) {
      throw new Error("Marketplace identity is reserved by the product")
    }
    if (
      descriptor.repository.owner.toLowerCase() !== expectedRepository.owner ||
      descriptor.repository.name !== expectedRepository.repository
    ) {
      throw new Error("Marketplace descriptor repository does not match its URL")
    }
    const repository = { owner: descriptor.repository.owner, repository: descriptor.repository.name }
    const registry = parseRegistryV2(
      parseJson(
        await this.#fetcher.fetch(descriptor.registry.v2.url, "registry", {
          declaredUrl: descriptor.registry.v2.url,
          maxBytes: 8 * 1024 * 1024,
          repository,
          signal,
        }),
        "Marketplace Registry",
      ),
    )
    if (registry.marketplaceId !== descriptor.id) throw new Error("Marketplace Registry identity does not match")
    const sourceKey = computeSourceKey({
      deliveryPolicy: "github-pages-releases",
      descriptorUrl,
      kind: "network",
      marketplaceId: descriptor.id,
      repository: { name: descriptor.repository.name, owner: descriptor.repository.owner },
    })
    const previewToken = randomBytes(32).toString("base64url")
    this.#previews.set(previewToken, {
      descriptor,
      descriptorUrl,
      expiresAt: Date.now() + previewTtlMs,
      registry,
      senderId,
      sourceKey,
    })
    return {
      descriptor: structuredClone(descriptor),
      packageCount: registry.packages.length,
      previewToken,
      sourceKey,
    }
  }

  add(previewToken: string, senderId: string): Promise<void> {
    return this.#serialize(async () => {
      const preview = this.#previews.get(previewToken)
      this.#previews.delete(previewToken)
      if (!preview || preview.expiresAt < Date.now() || preview.senderId !== senderId) {
        throw new Error("Marketplace preview expired")
      }
      const graph = await this.#readGraph()
      const existing = graph.sources.find(({ descriptor }) => descriptor.id === preview.descriptor.id)
      if (existing) {
        if (existing.sourceKey === preview.sourceKey) return
        throw new Error("Marketplace identity is already bound to another source")
      }
      if (graph.sources.length >= maxSources) throw new Error("Network Marketplace source limit was reached")
      await this.#sourceStore(preview.sourceKey).accept(catalog(preview.registry))
      graph.sources.push({
        descriptor: preview.descriptor,
        descriptorUrl: preview.descriptorUrl,
        sourceKey: preview.sourceKey,
        sourceOrder: graph.nextSourceOrder,
      })
      graph.nextSourceOrder += 1
      graph.revision += 1
      await atomicGraph(this.#file, graph)
      this.#emit()
    })
  }

  refresh(marketplaceId: string, signal?: AbortSignal): Promise<void> {
    return this.#serialize(async () => {
      const graph = await this.#readGraph()
      const source = graph.sources.find(({ descriptor }) => descriptor.id === marketplaceId)
      if (!source) throw new Error("Marketplace source was not found")
      const preview = await this.preview(source.descriptorUrl, `refresh:${marketplaceId}`, signal)
      if (preview.sourceKey !== source.sourceKey) throw new Error("Marketplace source identity changed")
      const retained = this.#previews.get(preview.previewToken)
      if (!retained) throw new Error("Marketplace refresh preview was lost")
      this.#previews.delete(preview.previewToken)
      if (signal?.aborted) throw signal.reason
      await this.#sourceStore(source.sourceKey).accept(catalog(retained.registry))
      source.descriptor = retained.descriptor
      graph.revision += 1
      await atomicGraph(this.#file, graph)
      this.#emit()
    })
  }

  remove(marketplaceId: string): Promise<void> {
    return this.#serialize(async () => {
      const graph = await this.#readGraph()
      const retained = graph.sources.filter(({ descriptor }) => descriptor.id !== marketplaceId)
      if (retained.length === graph.sources.length) return
      await atomicGraph(this.#file, { ...graph, revision: graph.revision + 1, sources: retained })
      this.#emit()
    })
  }

  async listSources() {
    return (await this.#readGraph()).sources.map((source) => structuredClone(source))
  }

  async listSourceStatuses() {
    const sources = await this.listSources()
    return Promise.all(
      sources.map(async (source) => {
        try {
          const accepted = await this.#sourceStore(source.sourceKey).readAccepted()
          return {
            ...source,
            health: accepted?.catalog.registry ? ("available" as const) : ("offline" as const),
            packageCount: accepted?.catalog.registry?.packages.filter((entry) => !entry.yanked).length ?? 0,
          }
        } catch {
          return { ...source, health: "attention" as const, packageCount: 0 }
        }
      }),
    )
  }

  async listCatalog(): Promise<SourceQualifiedItem[]> {
    const graph = await this.#readGraph()
    const output: SourceQualifiedItem[] = []
    for (const source of graph.sources) {
      let accepted
      try {
        accepted = await this.#sourceStore(source.sourceKey).readAccepted()
      } catch {
        continue
      }
      if (!accepted?.catalog.registry) continue
      for (const item of accepted.catalog.registry.packages) {
        if (item.yanked) continue
        output.push({
          catalogRevision: accepted.catalog.revision,
          catalogSequence: accepted.catalog.sequence,
          compatibility: item.compatibility,
          delivery: item.delivery,
          id: item.id,
          kind: item.kind,
          marketplaceId: source.descriptor.id,
          official: false,
          ...(item.ownerPluginId === undefined ? {} : { ownerPluginId: item.ownerPluginId }),
          presentation: item.presentation,
          runtimeSurface: projectRegistryPackageRuntimeSurface(item),
          sourceKey: source.sourceKey,
          sourceKind: "network",
          sourceOrder: source.sourceOrder,
          version: item.version,
        })
      }
    }
    return output
  }

  async resolvePackage(item: Pick<SourceQualifiedItem, "id" | "kind" | "sourceKey" | "version">) {
    const accepted = await this.#sourceStore(item.sourceKey).readAccepted()
    const resolved = accepted?.catalog.registry?.packages.find(
      (entry) => entry.id === item.id && entry.kind === item.kind && entry.version === item.version,
    )
    if (!resolved) throw new Error("Marketplace package metadata is unavailable")
    return structuredClone(resolved)
  }

  async repositoryAuthority(sourceKey: SourceKey) {
    const source = (await this.#readGraph()).sources.find((entry) => entry.sourceKey === sourceKey)
    if (!source) throw new Error("Marketplace repository authority is unavailable")
    return {
      owner: source.descriptor.repository.owner,
      repository: source.descriptor.repository.name,
    }
  }

  #sourceStore(sourceKey: SourceKey) {
    return new FileMarketplaceSourceStore({ root: this.#root, sourceKey })
  }

  async #readGraph(): Promise<SourceGraph> {
    try {
      const value = parseJson(
        await readBoundedAuthorityFile(this.#file, maxGraphBytes, "Network Marketplace graph"),
        "Network Marketplace graph",
      )
      return parseGraph(value)
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return emptyGraph()
      throw error
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#tail.catch(() => undefined).then(operation)
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  #emit() {
    for (const listener of this.#listeners) listener()
  }
}
