import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  canonicalJson,
  computeSourceKey,
  sha256Hex,
  type MarketplaceDescriptor,
  type RegistryV2,
  type SourceQualifiedItem,
} from "@convax/marketplace"

import {
  MarketplaceApplicationService,
  type MarketplaceCapabilityInstallerPort,
} from "../src/main/marketplace-application-service"
import {
  FileLocalMarketplaceImportTransition,
  LocalMarketplaceStore,
  type LocalMarketplacePackage,
} from "../src/main/local-marketplace-store"
import { NetworkMarketplaceManager } from "../src/main/network-marketplace-manager"
import type { MarketplaceFetchPurpose, PinnedHttpsFetchOptions } from "../src/main/pinned-https-fetch"
import { PinnedHttpsFetcher } from "../src/main/pinned-https-fetch"
import {
  CapabilityMutationCoordinator,
  FileMarketplaceStateStore,
  type InstallRecord,
} from "../src/main/marketplace-state"

const descriptorUrl = "https://convax-smoke.github.io/marketplace/marketplace.json"
const registryUrl = "https://convax-smoke.github.io/marketplace/registry-v2.json"
const releaseUrl =
  "https://github.com/convax-smoke/marketplace/releases/download/network-smoke-skill-v1.1.0/network-smoke-skill.zip"
const senderId = "marketplace-network-local-smoke"
const networkArtifact = Uint8Array.from(
  Buffer.from(
    "UEsDBBQAAAAIAFxb/FzaigmOowAAAOUAAAAIAAAAU0tJTEwubWRVjjsSwjAMRHufQhdwDkBNQwEFMxxASRSi8UceSybJ7QlhKGi22X276713GROdIJMtUoPXJIG8Bo7RjaRD5WIs+QSXlJphHwlu3yhcsQayEnEgODDAajzhYJ3ze7F7KIHNrDDxaq0SSI4bmECp8vpYaLsQnEmDSfEJOf+1FrQZRllyFBzVYR6htD6yzqQHSeu+Bnd6slrdfC9tj/xeQL8ZaefeUEsBAh4DFAAAAAgAXFv8XNqKCY6jAAAA5QAAAAgAAAAAAAAAAQAAAKSBAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAMkAAAAAAA==",
    "base64",
  ),
)

const descriptor: MarketplaceDescriptor = {
  compatibility: { convax: ">=0.1.0" },
  delivery: { kind: "github-pages-releases" },
  id: "convax-smoke",
  name: "Convax Smoke Marketplace",
  publisher: { name: "Convax Smoke" },
  registry: { v2: { url: registryUrl } },
  repository: { name: "marketplace", owner: "convax-smoke" },
  schema: "convax.marketplace/1",
  showcase: { v2: { url: "https://convax-smoke.github.io/marketplace/showcase-v2.json" } },
}

function registry(sequence: number, version: string): RegistryV2 {
  const packages: RegistryV2["packages"] = [
    {
      compatibility: { convax: ">=0.1.0" },
      delivery: {
        kind: "artifact",
        sha256: sha256Hex(networkArtifact),
        size: networkArtifact.byteLength,
        url: releaseUrl,
      },
      id: "network-smoke-skill",
      kind: "skill",
      presentation: {
        description: "A real immutable artifact used by the Desktop-main Marketplace smoke.",
        name: "Network Smoke Skill",
      },
      version,
    },
  ]
  return {
    marketplaceId: descriptor.id,
    packages,
    revision: sha256Hex(canonicalJson(packages)),
    schema: "convax.registry/2",
    sequence,
  }
}

class SmokeTransport extends PinnedHttpsFetcher {
  readonly requests: Array<{ purpose: MarketplaceFetchPurpose; url: string }> = []
  activeRegistry = registry(1, "1.0.0")

  async fetch(url: string, purpose: MarketplaceFetchPurpose, options: PinnedHttpsFetchOptions = {}) {
    if (options.signal?.aborted) throw options.signal.reason
    this.requests.push({ purpose, url })
    let bytes: Uint8Array
    if (url === descriptorUrl && purpose === "descriptor") {
      bytes = new TextEncoder().encode(`${canonicalJson(descriptor)}\n`)
    } else if (url === registryUrl && purpose === "registry") {
      assert.equal(options.declaredUrl, registryUrl)
      assert.deepEqual(options.repository, { owner: "convax-smoke", repository: "marketplace" })
      bytes = new TextEncoder().encode(`${canonicalJson(this.activeRegistry)}\n`)
    } else if (url === releaseUrl && purpose === "release") {
      assert.deepEqual(options.repository, { owner: "convax-smoke", repository: "marketplace" })
      bytes = networkArtifact
    } else {
      throw new Error(`Smoke transport received an unexpected ${purpose} URL: ${url}`)
    }
    assert.ok(bytes.byteLength <= (options.maxBytes ?? Number.MAX_SAFE_INTEGER))
    return Uint8Array.from(bytes)
  }
}

class RecordingInstaller implements MarketplaceCapabilityInstallerPort {
  readonly hardRefreshes: string[] = []
  readonly localPublications: Array<{
    item: LocalMarketplacePackage
    snapshotDirectory: string
  }> = []
  readonly mcpPublications: SourceQualifiedItem[] = []
  readonly networkArtifactFile: string

  constructor(private readonly root: string) {
    this.networkArtifactFile = path.join(root, "published", "network-smoke-skill.zip")
  }

  async activate(_record: InstallRecord, _authorizationContractDigest: string) {
    throw new Error("The smoke fixture must not publish an execution grant")
  }

  async disable() {
    throw new Error("disable is outside this smoke")
  }

  async enable() {
    throw new Error("enable is outside this smoke")
  }

  async installArtifact(
    item: SourceQualifiedItem,
    prepared: { artifactBytes: Uint8Array; companionBytes: Readonly<Record<string, Uint8Array>> },
  ) {
    assert.equal(item.kind, "skill")
    assert.equal(item.id, "network-smoke-skill")
    assert.deepEqual(prepared.companionBytes, {})
    assert.equal(sha256Hex(prepared.artifactBytes), item.delivery.kind === "artifact" && item.delivery.sha256)
    await writeExclusive(this.networkArtifactFile, prepared.artifactBytes)
    return {}
  }

  async installBuiltin() {
    throw new Error("Builtin installation is outside this smoke")
  }

  async installLocal(item: LocalMarketplacePackage, snapshotDirectory: string) {
    const metadata = await fs.lstat(snapshotDirectory)
    assert.ok(metadata.isDirectory())
    this.localPublications.push({ item: structuredClone(item), snapshotDirectory })
    await writeExclusive(
      path.join(this.root, "published", `local-${item.kind}-${sha256Hex(`${item.id}\0${item.revision}`)}.json`),
      new TextEncoder().encode(`${canonicalJson(item)}\n`),
    )
    return {}
  }

  async installMcpMetadata(item: SourceQualifiedItem) {
    assert.equal(item.kind, "mcp-server")
    this.mcpPublications.push(structuredClone(item))
    await writeExclusive(
      path.join(this.root, "published", `mcp-${sha256Hex(`${item.id}\0${item.version}`)}.json`),
      new TextEncoder().encode(`${canonicalJson(item)}\n`),
    )
    return {}
  }

  async commitMcpCandidate() {}

  async discardMcpCandidate() {}

  async hardRefresh(identity: { id: string; kind: string }) {
    this.hardRefreshes.push(`${identity.kind}:${identity.id}`)
  }

  async prepareSetup(): Promise<{ addTarget?: string | null }> {
    throw new Error("setup is outside this smoke")
  }

  async resolveTransition() {
    return "unknown" as const
  }

  async prepareArtifact(_item: SourceQualifiedItem, bytes: Uint8Array) {
    return { artifactBytes: Uint8Array.from(bytes), companionBytes: {} }
  }

  async setup(): Promise<{ authorizationContractDigest: string } | null> {
    throw new Error("setup is outside this smoke")
  }

  async uninstall() {
    throw new Error("uninstall is outside this smoke")
  }

  async verifyAuthorization() {
    return false
  }
}

async function writeExclusive(file: string, bytes: Uint8Array) {
  await fs.mkdir(path.dirname(file), { mode: 0o700, recursive: true })
  const handle = await fs.open(file, "wx", 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeFixture(directory: string, marker: string, contents: string) {
  await fs.mkdir(directory, { mode: 0o700, recursive: true })
  await writeExclusive(path.join(directory, marker), new TextEncoder().encode(contents))
}

async function installNetworkSkill(service: MarketplaceApplicationService) {
  const choices = await service.beginInstall({ id: "network-smoke-skill", kind: "skill" }, senderId)
  assert.equal(choices.length, 1)
  assert.equal(choices[0].marketplaceLabel, descriptor.id)
  assert.equal(choices[0].version, "1.1.0")
  const confirmation = await service.confirmInstall(choices[0].confirmationToken, senderId)
  return service.install(confirmation.selectionToken, senderId)
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-marketplace-network-local-smoke-"))
  const keep = process.env.CONVAX_KEEP_MARKETPLACE_SMOKE === "1"
  try {
    const networkRoot = path.join(root, "marketplaces", "network")
    const localRoot = path.join(root, "marketplaces", "local", "primary")
    const transport = new SmokeTransport()
    const network = new NetworkMarketplaceManager({ fetcher: transport, root: networkRoot })

    const initialPreview = await network.preview(descriptorUrl, senderId)
    assert.equal(initialPreview.packageCount, 1)
    await network.add(initialPreview.previewToken, senderId)
    assert.deepEqual(
      (await network.listSources()).map((source) => ({
        id: source.descriptor.id,
        sourceKey: source.sourceKey,
        sourceOrder: source.sourceOrder,
      })),
      [{ id: descriptor.id, sourceKey: initialPreview.sourceKey, sourceOrder: 0 }],
    )

    transport.activeRegistry = registry(2, "1.1.0")
    await network.refresh(descriptor.id)
    assert.deepEqual(
      (await network.listCatalog()).map((item) => ({
        catalogSequence: item.catalogSequence,
        id: item.id,
        version: item.version,
      })),
      [{ catalogSequence: 2, id: "network-smoke-skill", version: "1.1.0" }],
    )
    assert.deepEqual(
      (await network.listSourceStatuses()).map((source) => ({
        health: source.health,
        packageCount: source.packageCount,
      })),
      [{ health: "available", packageCount: 1 }],
    )

    const local = new LocalMarketplaceStore({
      marketplaceId: "convax-local",
      root: localRoot,
      transition: new FileLocalMarketplaceImportTransition(
        path.join(root, "marketplaces", "local", "primary-import-transition-v1.json"),
      ),
    })
    const localIdentity = await local.initialize()
    const localSourceKey = computeSourceKey({
      kind: "local",
      marketplaceId: localIdentity.marketplaceId,
      policyVersion: localIdentity.policyVersion,
      sourceInstanceId: localIdentity.sourceInstanceId,
    })
    const state = new FileMarketplaceStateStore(path.join(root, "marketplaces", "state-v1.json"))
    const installer = new RecordingInstaller(root)
    const service = new MarketplaceApplicationService({
      fixedCatalog: async () => [],
      fixedSources: async () => [],
      installer,
      local,
      localSourceKey,
      mutations: new CapabilityMutationCoordinator(),
      network,
      networkFetch: transport,
      readFixedArtifact: async () => {
        throw new Error("Fixed artifacts are outside this smoke")
      },
      repositoryAuthority: (item) => network.repositoryAuthority(item.sourceKey),
      state,
    })

    assert.deepEqual(
      (await service.listMarketplaces()).map((source) => ({
        health: source.health,
        id: source.id,
        packageCount: source.packageCount,
        removable: source.removable,
        repository: source.repository,
      })),
      [
        {
          health: "available",
          id: descriptor.id,
          packageCount: 1,
          removable: true,
          repository: "convax-smoke/marketplace",
        },
      ],
    )

    const installedNetwork = await installNetworkSkill(service)
    assert.deepEqual(installedNetwork, {
      id: "network-smoke-skill",
      kind: "skill",
      name: "Network Smoke Skill",
      sourceLabel: descriptor.id,
      state: "ready",
      updateAvailable: false,
      version: "1.1.0",
    })
    assert.deepEqual(new Uint8Array(await fs.readFile(installer.networkArtifactFile)), networkArtifact)

    const pluginSource = path.join(root, "imports", "plugin")
    const skillSource = path.join(root, "imports", "skill")
    const mcpSource = path.join(root, "imports", "mcp-server")
    const pluginManifest =
      '{"schema":"convax.plugin/8","id":"local-smoke-plugin","name":"Local Smoke Plugin","description":"Local immutable Plugin snapshot","version":"1.0.0","hostApi":{"major":2,"required":["projects.list"],"optional":[]},"capabilities":["projects.read"],"contributes":{}}\n'
    const skillMarkdown =
      "---\nname: local-smoke-skill\ndescription: Local immutable Skill snapshot.\n---\n\nUse the installed snapshot.\n"
    const serverJson =
      '{"$schema":"https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json","name":"io.example/local-smoke","description":"Local immutable MCP metadata snapshot","version":"1.0.0","remotes":[{"type":"streamable-http","url":"https://mcp.example.com/mcp"}]}\n'
    await writeFixture(pluginSource, "manifest.json", pluginManifest)
    await writeFixture(skillSource, "SKILL.md", skillMarkdown)
    await writeFixture(mcpSource, "server.json", serverJson)

    const imported = [
      await service.importDirectory(pluginSource),
      await service.importDirectory(skillSource),
      await service.importDirectory(mcpSource),
    ]
    assert.deepEqual(
      imported.map(({ id, kind, sourceLabel, state, version }) => ({ id, kind, sourceLabel, state, version })),
      [
        {
          id: "local-smoke-plugin",
          kind: "plugin",
          sourceLabel: "convax-local",
          state: "ready",
          version: "1.0.0",
        },
        {
          id: "local-smoke-skill",
          kind: "skill",
          sourceLabel: "convax-local",
          state: "ready",
          version: "local",
        },
        {
          id: "io.example/local-smoke",
          kind: "mcp-server",
          sourceLabel: "convax-local",
          state: "setup-required",
          version: "1.0.0",
        },
      ],
    )

    const localIndex = await local.list()
    assert.equal(localIndex.packages.length, 3)
    assert.equal(new Set(localIndex.packages.map((item) => item.snapshotKey)).size, 3)
    const originalByKind = new Map([
      ["plugin", { marker: "manifest.json", text: pluginManifest }],
      ["skill", { marker: "SKILL.md", text: skillMarkdown }],
      ["mcp-server", { marker: "server.json", text: serverJson }],
    ])
    await fs.writeFile(path.join(pluginSource, "manifest.json"), "source mutated after import\n")
    await fs.writeFile(path.join(skillSource, "SKILL.md"), "source mutated after import\n")
    await fs.writeFile(path.join(mcpSource, "server.json"), "source mutated after import\n")
    for (const item of localIndex.packages) {
      const original = originalByKind.get(item.kind)!
      assert.equal(
        await fs.readFile(path.join(local.resolveSnapshotDirectory(item), original.marker), "utf8"),
        original.text,
      )
      const projected = await local.projectCatalogItem(item, localSourceKey)
      assert.equal(projected.sourceKey, localSourceKey)
      assert.equal(projected.sourceKind, "local")
      assert.equal(projected.id, item.id)
    }

    const inventory = await service.listInstalled()
    assert.deepEqual(
      inventory.capabilities.map(({ id, kind, sourceLabel, state, version }) => ({
        id,
        kind,
        sourceLabel,
        state,
        version,
      })),
      [
        {
          id: "network-smoke-skill",
          kind: "skill",
          sourceLabel: descriptor.id,
          state: "ready",
          version: "1.1.0",
        },
        {
          id: "local-smoke-plugin",
          kind: "plugin",
          sourceLabel: "convax-local",
          state: "ready",
          version: "1.0.0",
        },
        {
          id: "local-smoke-skill",
          kind: "skill",
          sourceLabel: "convax-local",
          state: "ready",
          version: "local",
        },
        {
          id: "io.example/local-smoke",
          kind: "mcp-server",
          sourceLabel: "convax-local",
          state: "setup-required",
          version: "1.0.0",
        },
      ],
    )

    const persistedState = await state.read()
    assert.equal(persistedState.installations.length, 4)
    assert.equal(persistedState.transitions.length, 0)
    assert.equal(installer.localPublications.length, 2)
    assert.equal(installer.mcpPublications.length, 1)
    assert.deepEqual(installer.hardRefreshes, [
      "skill:network-smoke-skill",
      "plugin:local-smoke-plugin",
      "skill:local-smoke-skill",
      "mcp-server:io.example/local-smoke",
    ])

    const securityFiles = await fs.readdir(path.join(networkRoot, "marketplace-source-security"))
    assert.equal(securityFiles.length, 1)
    const security: unknown = JSON.parse(
      await fs.readFile(path.join(networkRoot, "marketplace-source-security", securityFiles[0]), "utf8"),
    )
    assert.ok(security && typeof security === "object" && !Array.isArray(security))
    const highestSequence = Reflect.get(security, "highestSequence")
    const versionContracts = Reflect.get(security, "versionContracts")
    assert.equal(highestSequence, 2)
    assert.ok(versionContracts && typeof versionContracts === "object" && !Array.isArray(versionContracts))
    assert.equal(Object.keys(versionContracts).length, 2)

    console.log(
      "MARKETPLACE_NETWORK_LOCAL_SMOKE_OK",
      JSON.stringify({
        local: {
          installed: imported.map(({ id, kind, state }) => ({ id, kind, state })),
          snapshotCount: localIndex.packages.length,
          sourceInstanceId: localIdentity.sourceInstanceId,
          sourceKey: localSourceKey,
        },
        network: {
          artifactSha256: sha256Hex(await fs.readFile(installer.networkArtifactFile)),
          catalogSequence: highestSequence,
          installed: installedNetwork,
          requestPurposes: transport.requests.map(({ purpose }) => purpose),
          sourceKey: initialPreview.sourceKey,
        },
        persistence: {
          installRecordCount: persistedState.installations.length,
          stateRevision: persistedState.revision,
          transitionCount: persistedState.transitions.length,
        },
      }),
    )
  } finally {
    if (keep) console.log(`MARKETPLACE_NETWORK_LOCAL_SMOKE_ROOT=${root}`)
    else await fs.rm(root, { force: true, recursive: true })
  }
}

await main()
