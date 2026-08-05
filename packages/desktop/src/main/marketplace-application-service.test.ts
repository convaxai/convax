import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, expect, test } from "bun:test"
import {
  builtinSourceKey,
  canonicalJson,
  sha256Hex,
  type SourceKey,
  type SourceQualifiedItem,
} from "@convax/marketplace"

import {
  MarketplaceApplicationService,
  MarketplacePostCommitRefreshError,
  type MarketplaceCapabilityInstallerPort,
} from "./marketplace-application-service"
import { CapabilityPublicationRecoveryRequiredError } from "./capability-publication-error"
import {
  CapabilityMutationCoordinator,
  capabilityTransitionParticipantDigest,
  FileMarketplaceStateStore,
  type CapabilityTransition,
} from "./marketplace-state"

const roots: string[] = []
const sourceA = "a".repeat(64) as SourceKey
const sourceB = "b".repeat(64) as SourceKey

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

async function stateStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-marketplace-application-"))
  roots.push(root)
  return new FileMarketplaceStateStore(path.join(root, "state.json"))
}

function skill(overrides: Partial<SourceQualifiedItem> = {}): SourceQualifiedItem {
  const bytes = new TextEncoder().encode("builtin-skill")
  return {
    catalogRevision: "c".repeat(64),
    catalogSequence: 1,
    compatibility: { convax: "*" },
    delivery: {
      bundleReleaseId: "d".repeat(64),
      kind: "builtin-artifact",
      path: "members/storyboard.zip",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
    },
    id: "canvas-storyboard",
    kind: "skill",
    marketplaceId: "convax-builtin",
    official: false,
    presentation: { name: "Canvas Storyboard" },
    runtimeSurface: "none",
    sourceKey: builtinSourceKey(),
    sourceKind: "builtin",
    sourceOrder: 0,
    version: "1.0.0",
    ...overrides,
  }
}

function runtimeItem(overrides: Partial<SourceQualifiedItem> = {}): SourceQualifiedItem {
  return {
    ...skill(),
    delivery: {
      kind: "mcp-http",
      runtime: { endpoint: "https://mcp.example.test/api", transport: "streamable-http" },
      serverJson: {},
      serverJsonSha256: "e".repeat(64),
    },
    id: "io.example/server",
    kind: "mcp-server",
    marketplaceId: "acme",
    runtimeSurface: "agent",
    sourceKey: sourceA,
    sourceKind: "network",
    ...overrides,
  }
}

function harness(options: {
  activePluginBindings?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["activePluginBindings"]
  assertCapabilityMutationAllowed?: ConstructorParameters<
    typeof MarketplaceApplicationService
  >[0]["assertCapabilityMutationAllowed"]
  assertLocalImportAllowed?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["assertLocalImportAllowed"]
  candidates: SourceQualifiedItem[]
  fixedSources?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["fixedSources"]
  installer?: Partial<MarketplaceCapabilityInstallerPort>
  local?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["local"]
  networkCandidates?: SourceQualifiedItem[]
  networkFetch?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["networkFetch"]
  networkRefresh?: (id: string) => Promise<void>
  preinstalledPolicy?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["preinstalledPolicy"]
  prepareFixedArtifact?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["prepareFixedArtifact"]
  pluginRuntimeState?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["pluginRuntimeState"]
  pluginUpdateRecoveryIds?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["pluginUpdateRecoveryIds"]
  refreshFixedSource?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["refreshFixedSource"]
  reservedBuiltinIdentities?: ConstructorParameters<
    typeof MarketplaceApplicationService
  >[0]["reservedBuiltinIdentities"]
  state: FileMarketplaceStateStore
}) {
  let candidates = options.candidates
  let preparedOutsideMutation = false
  const installer: MarketplaceCapabilityInstallerPort = {
    activate: async () => undefined,
    commitMcpCandidate: async () => undefined,
    disable: async () => undefined,
    discardMcpCandidate: async () => undefined,
    enable: async () => undefined,
    hardRefresh: async () => undefined,
    installArtifact: async () => ({}),
    installBuiltin: async () => {
      expect(preparedOutsideMutation).toBe(true)
    },
    installLocal: async () => ({}),
    installMcpMetadata: async () => ({}),
    prepareArtifact: async (_item, bytes) => ({
      artifactBytes: bytes,
      companionBytes: {},
    }),
    prepareSetup: async (_record, pick) => ({ addTarget: await pick() }),
    resolveTransition: async () => "unknown",
    setup: async () => null,
    uninstall: async () => undefined,
    verifyAuthorization: async () => true,
    ...options.installer,
  }
  const mutations = new CapabilityMutationCoordinator()
  const service = new MarketplaceApplicationService({
    ...(options.activePluginBindings ? { activePluginBindings: options.activePluginBindings } : {}),
    arch: "arm64",
    ...(options.assertCapabilityMutationAllowed
      ? { assertCapabilityMutationAllowed: options.assertCapabilityMutationAllowed }
      : {}),
    ...(options.assertLocalImportAllowed ? { assertLocalImportAllowed: options.assertLocalImportAllowed } : {}),
    fixedCatalog: async () => candidates,
    fixedSources: options.fixedSources ?? (async () => []),
    installer,
    local:
      options.local ??
      ({
        importDirectory: async () => {
          throw new Error("not used")
        },
        list: async () => ({ packages: [], revision: 0, schema: "convax.local-marketplace-index/1" }),
        projectCatalogItem: async () => {
          throw new Error("not used")
        },
        resolveSnapshotDirectory: () => "/unused",
      } as never),
    localSourceKey: sourceB,
    mutations,
    network: {
      add: async () => undefined,
      listCatalog: async () => options.networkCandidates ?? [],
      listSources: async () => [],
      preview: async () => {
        throw new Error("not used")
      },
      refresh: options.networkRefresh ?? (async () => undefined),
      remove: async () => undefined,
      subscribe: () => () => undefined,
    } as never,
    networkFetch:
      options.networkFetch ??
      ({
        fetch: async () => {
          throw new Error("not used")
        },
      } as never),
    platform: "darwin",
    ...(options.pluginRuntimeState ? { pluginRuntimeState: options.pluginRuntimeState } : {}),
    ...(options.pluginUpdateRecoveryIds ? { pluginUpdateRecoveryIds: options.pluginUpdateRecoveryIds } : {}),
    ...(options.preinstalledPolicy ? { preinstalledPolicy: options.preinstalledPolicy } : {}),
    ...(options.prepareFixedArtifact ? { prepareFixedArtifact: options.prepareFixedArtifact } : {}),
    ...(options.refreshFixedSource ? { refreshFixedSource: options.refreshFixedSource } : {}),
    readFixedArtifact: async (item) => {
      preparedOutsideMutation = true
      return new TextEncoder().encode(item.sourceKind === "builtin" ? "builtin-skill" : "unexpected")
    },
    repositoryAuthority: async () => ({ owner: "acme", repository: "marketplace" }),
    ...(options.reservedBuiltinIdentities ? { reservedBuiltinIdentities: options.reservedBuiltinIdentities } : {}),
    state: options.state,
  })
  return {
    service,
    setCandidates(next: SourceQualifiedItem[]) {
      candidates = next
    },
  }
}

async function install(service: MarketplaceApplicationService, item: SourceQualifiedItem) {
  const [choice] = await service.beginInstall({ id: item.id, kind: item.kind }, "sender")
  const confirmed = await service.confirmInstall(choice!.confirmationToken, "sender")
  return service.install(confirmed.selectionToken, "sender")
}

test("installs an offline Builtin Skill through all checkpoints with preparation outside the identity lock", async () => {
  const state = await stateStore()
  const item = skill()
  const { service } = harness({ candidates: [item], state })
  await expect(install(service, item)).resolves.toMatchObject({
    id: item.id,
    state: "ready",
    version: item.version,
  })
  expect(await state.read()).toMatchObject({
    installations: [{ id: item.id, sourceKey: item.sourceKey }],
    transitions: [],
  })
})

test("treats a confirmed Plugin install as execution consent without a second setup mutation", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-v1")
  const artifact = { sha256: sha256Hex(bytes), size: bytes.byteLength }
  const item: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      ...artifact,
      kind: "artifact",
      url: "https://github.com/acme/marketplace/releases/download/plugin-example-v1/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
  }
  const authorizationContractDigest = "f".repeat(64)
  let activeBindings: Array<{
    active: boolean
    artifact: { sha256: string; size: number }
    id: string
    snapshotDigest: string
    sourceKey: SourceKey
    version: string
  }> = []
  let setupCalls = 0
  const { service } = harness({
    activePluginBindings: async () => activeBindings,
    candidates: [item],
    installer: {
      installArtifact: async (_item, _prepared, options) => {
        expect(options.authorizeExecution).toBe(true)
        activeBindings = [
          {
            active: true,
            artifact,
            id: item.id,
            snapshotDigest: "a".repeat(64),
            sourceKey: item.sourceKey,
            version: item.version,
          },
        ]
        return { authorizationContractDigest }
      },
      setup: async () => {
        setupCalls += 1
        return null
      },
      verifyAuthorization: async (_record, expected) => expected === authorizationContractDigest,
    },
    prepareFixedArtifact: async () => ({
      artifactBytes: bytes,
      companionBytes: {},
    }),
    state,
  })

  await expect(install(service, item)).resolves.toMatchObject({
    id: item.id,
    state: "ready",
  })
  expect(setupCalls).toBe(0)
  expect(await state.read()).toMatchObject({
    executionGrants: [
      {
        authorizationContractDigest,
        identity: { id: item.id, kind: item.kind },
        sourceKey: item.sourceKey,
      },
    ],
    transitions: [],
  })
})

test("rejects a legacy explicit Plugin setup before preparing another authorization", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-v1")
  const item: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/acme/marketplace/releases/download/plugin-example-v1/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
  }
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: sha256Hex(canonicalJson(item.delivery)),
      id: item.id,
      kind: item.kind,
      revision: 1,
      runtimeSurface: item.runtimeSurface,
      sourceKey: item.sourceKey,
      version: item.version,
    })
  })
  let prepared = 0
  const { service } = harness({
    candidates: [item],
    installer: {
      prepareSetup: async () => {
        prepared += 1
        return {}
      },
      setup: async () => {
        prepared += 1
        return null
      },
    },
    state,
  })

  await expect(service.setup({ id: item.id, kind: item.kind }, async () => null)).rejects.toThrow(
    "only by install or update",
  )
  expect(prepared).toBe(0)
  expect((await state.read()).transitions).toEqual([])
})

test("startup provisioning installs every missing Builtin member and the exact Official preinstall policy", async () => {
  const state = await stateStore()
  const builtin = skill()
  const secondBuiltin = skill({
    id: "offline-helper",
    presentation: { name: "Offline Helper" },
  })
  const bytes = new TextEncoder().encode("ffmpeg-plugin")
  const ffmpeg: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/plugin.zip",
    },
    id: "ffmpeg-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    presentation: { name: "FFmpeg Tools" },
    sourceKey: sourceA,
    version: "1.0.0",
  }
  const installed: string[] = []
  const setupModes: string[] = []
  const { service } = harness({
    candidates: [builtin, secondBuiltin, ffmpeg],
    installer: {
      installArtifact: async (item) => {
        installed.push(`${item.kind}/${item.id}`)
        return {}
      },
      installBuiltin: async (item) => {
        installed.push(`${item.kind}/${item.id}`)
      },
      setup: async (_record, _prepared, options) => {
        setupModes.push(options.mode)
        return { authorizationContractDigest: "f".repeat(64) }
      },
    },
    preinstalledPolicy: (item) =>
      item.id === ffmpeg.id &&
      item.kind === ffmpeg.kind &&
      item.sourceKey === ffmpeg.sourceKey &&
      item.version === ffmpeg.version
        ? {
            marketplaceId: ffmpeg.marketplaceId,
            observedPolicyRevision: 1,
            policyEntryDigest: sha256Hex(canonicalJson(item)),
            setup: "automatic",
          }
        : undefined,
    prepareFixedArtifact: async () => ({ artifactBytes: bytes, companionBytes: {} }),
    state,
  })

  await service.provisionDefaults()
  await service.provisionDefaults()

  expect(installed).toEqual(["skill/canvas-storyboard", "skill/offline-helper", "plugin/ffmpeg-tools"])
  expect(setupModes).toEqual(["automatic-product-lock"])
  expect((await state.read()).installations.map(({ id }) => id).sort()).toEqual([
    "canvas-storyboard",
    "ffmpeg-tools",
    "offline-helper",
  ])
  expect(await state.read()).toMatchObject({
    executionGrants: [{ identity: { id: "ffmpeg-tools", kind: "plugin" }, sourceKey: ffmpeg.sourceKey }],
    transitions: [],
  })
})

test("refreshes the fixed Official source without routing its reserved identity through Network", async () => {
  const state = await stateStore()
  const refreshed: string[] = []
  const networkRefreshes: string[] = []
  const { service } = harness({
    candidates: [],
    fixedSources: async () => [
      {
        health: "available",
        id: "convax-official",
        label: "Convax Official",
        packageCount: 28,
        publisher: "Microvoid",
        removable: false,
        repository: "convaxai/convax-plugins",
      },
    ],
    networkRefresh: async (id) => {
      networkRefreshes.push(id)
    },
    refreshFixedSource: async (id) => {
      refreshed.push(id)
      return id === "convax-official"
    },
    state,
  })

  await service.refreshMarketplace("convax-official")
  await service.refreshMarketplace("third-party")

  expect(refreshed).toEqual(["convax-official", "third-party"])
  expect(networkRefreshes).toEqual(["third-party"])
})

test("keeps a missing packaged Builtin identity reserved and hides an impostor Network source", async () => {
  const state = await stateStore()
  const impostor = skill({
    marketplaceId: "third-party",
    sourceKey: sourceA,
    sourceKind: "network",
  })
  const { service } = harness({
    candidates: [],
    networkCandidates: [impostor],
    reservedBuiltinIdentities: [{ id: "canvas-storyboard", kind: "skill" }],
    state,
  })
  await expect(service.listCatalog()).resolves.toMatchObject({
    cards: [
      {
        id: "canvas-storyboard",
        kind: "skill",
        otherSourceCount: 0,
      },
    ],
  })
  await expect(service.beginInstall({ id: "canvas-storyboard", kind: "skill" }, "renderer")).resolves.toEqual([])
})

test("isolates a corrupt Local authority while keeping unrelated Network catalog available", async () => {
  const state = await stateStore()
  const network = skill({
    id: "network-skill",
    marketplaceId: "network",
    sourceKey: sourceA,
    sourceKind: "network",
  })
  const { service } = harness({
    candidates: [],
    local: {
      list: async () => {
        throw new Error("corrupt Local identity")
      },
    } as never,
    networkCandidates: [network],
    state,
  })
  await expect(service.listCatalog()).resolves.toMatchObject({
    cards: [{ id: "network-skill", kind: "skill" }],
  })
})

test("rejects a confirmation after the exact catalog candidate changes", async () => {
  const state = await stateStore()
  const item = skill()
  const harnessed = harness({ candidates: [item], state })
  const [choice] = await harnessed.service.beginInstall({ id: item.id, kind: item.kind }, "sender")
  harnessed.setCandidates([skill({ catalogSequence: 2, version: "1.1.0" })])
  await expect(harnessed.service.confirmInstall(choice!.confirmationToken, "sender")).rejects.toThrow("stale")
  expect((await state.read()).installations).toEqual([])
})

test("updates only through a sender-bound single-use token for the installed source", async () => {
  const state = await stateStore()
  const current = runtimeItem({ version: "1.0.0" })
  const update = runtimeItem({ catalogSequence: 2, version: "2.0.0" })
  const otherSource = runtimeItem({
    catalogSequence: 3,
    marketplaceId: "other",
    sourceKey: sourceB,
    version: "9.0.0",
  })
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: sha256Hex(canonicalJson(current.delivery)),
      id: current.id,
      kind: current.kind,
      revision: 1,
      runtimeSurface: current.runtimeSurface,
      sourceKey: current.sourceKey,
      version: current.version,
    })
  })
  const { service } = harness({ candidates: [update, otherSource], state })
  const choices = await service.beginUpdate({ id: current.id, kind: current.kind }, "renderer-1")
  expect(choices.map((choice) => choice.version)).toEqual(["2.0.0"])
  await expect(service.confirmUpdate(choices[0]!.confirmationToken, "renderer-2")).rejects.toThrow("sender")
  const confirmed = await service.confirmUpdate(choices[0]!.confirmationToken, "renderer-1")
  await expect(service.update(confirmed.selectionToken, "renderer-1")).resolves.toMatchObject({
    sourceLabel: update.marketplaceId,
    version: update.version,
  })
  await expect(service.update(confirmed.selectionToken, "renderer-1")).rejects.toThrow("already used")
  expect((await state.read()).installations[0]).toMatchObject({
    sourceKey: sourceA,
    version: "2.0.0",
  })
})

test("keeps the installed source visible when its exact old version is superseded in the catalog", async () => {
  const state = await stateStore()
  const installed = runtimeItem({ version: "1.0.0" })
  const update = runtimeItem({
    catalogSequence: 2,
    presentation: { name: "Acme Server" },
    version: "2.0.0",
  })
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: sha256Hex(canonicalJson(installed.delivery)),
      id: installed.id,
      kind: installed.kind,
      revision: 1,
      runtimeSurface: installed.runtimeSurface,
      sourceKey: installed.sourceKey,
      version: installed.version,
    })
  })
  const { service } = harness({ candidates: [update], state })

  await expect(service.listInstalled()).resolves.toMatchObject({
    capabilities: [
      {
        id: installed.id,
        name: "Acme Server",
        sourceLabel: update.marketplaceId,
        updateAvailable: true,
        version: "1.0.0",
      },
    ],
  })
})

test("reports an unavailable source only after the installed SourceKey disappears from the catalog", async () => {
  const state = await stateStore()
  const installed = runtimeItem({ version: "1.0.0" })
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: sha256Hex(canonicalJson(installed.delivery)),
      id: installed.id,
      kind: installed.kind,
      revision: 1,
      runtimeSurface: installed.runtimeSurface,
      sourceKey: installed.sourceKey,
      version: installed.version,
    })
  })
  const { service } = harness({ candidates: [], state })

  await expect(service.listInstalled()).resolves.toMatchObject({
    capabilities: [
      {
        id: installed.id,
        name: installed.id,
        sourceLabel: "Unavailable source",
        updateAvailable: false,
      },
    ],
  })
})

test("keeps Plugin-owned Skills out of the standalone catalog before any transition is created", async () => {
  const state = await stateStore()
  const ownedSkill = skill({
    ownerPluginId: "storyboard-studio",
    presentation: { name: "Storyboard Studio Skill" },
  })
  const { service } = harness({ candidates: [ownedSkill], state })

  await expect(service.listCatalog()).resolves.toMatchObject({ cards: [] })
  await expect(service.beginInstall({ id: ownedSkill.id, kind: ownedSkill.kind }, "renderer")).resolves.toEqual([])
  expect((await state.read()).transitions).toEqual([])
})

test("projects an installed Plugin outside the exact ActiveSet as inactive instead of ready", async () => {
  const state = await stateStore()
  const plugin: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: "f".repeat(64),
      size: 1,
      url: "https://github.com/acme/marketplace/releases/download/example-plugin-v1/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
  }
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: sha256Hex(canonicalJson(plugin.delivery)),
      id: plugin.id,
      kind: plugin.kind,
      revision: 1,
      runtimeSurface: plugin.runtimeSurface,
      sourceKey: plugin.sourceKey,
      version: plugin.version,
    })
    draft.executionGrants.push({
      authorizationContractDigest: "d".repeat(64),
      identity: { id: plugin.id, kind: plugin.kind },
      revision: 1,
      sourceKey: plugin.sourceKey,
    })
  })
  const { service } = harness({
    activePluginBindings: async () => [],
    candidates: [plugin],
    state,
  })

  await expect(service.listInstalled()).resolves.toMatchObject({
    capabilities: [
      {
        attention: "plugin-runtime-inactive",
        id: plugin.id,
        state: "attention",
      },
    ],
  })
  await expect(service.listCatalog()).resolves.toMatchObject({
    cards: [{ id: plugin.id, installed: { state: "attention" } }],
  })
})

test("marks only Plugins unavailable when the Plugin runtime is quarantined for the session", async () => {
  const state = await stateStore()
  const server = runtimeItem()
  const plugin: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: "f".repeat(64),
      size: 1,
      url: "https://github.com/acme/marketplace/releases/download/example-plugin-v1/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
  }
  await state.update((draft) => {
    for (const item of [plugin, server]) {
      draft.installations.push({
        artifactDigest: sha256Hex(canonicalJson(item.delivery)),
        id: item.id,
        kind: item.kind,
        revision: 1,
        runtimeSurface: item.runtimeSurface,
        sourceKey: item.sourceKey,
        version: item.version,
      })
      draft.executionGrants.push({
        authorizationContractDigest: "d".repeat(64),
        identity: { id: item.id, kind: item.kind },
        revision: 1,
        sourceKey: item.sourceKey,
      })
    }
  })
  const { service } = harness({
    candidates: [plugin, server],
    pluginRuntimeState: "unavailable-for-session",
    state,
  })

  await expect(service.listInstalled()).resolves.toMatchObject({
    capabilities: [
      {
        attention: "plugin-runtime-unavailable-for-session",
        id: plugin.id,
        state: "attention",
      },
      {
        id: server.id,
        state: "ready",
      },
    ],
    pluginRuntimeState: "unavailable-for-session",
  })
  const catalog = await service.listCatalog()
  expect(catalog.cards.find((card) => card.id === plugin.id)).toMatchObject({
    installed: { state: "attention" },
  })
  expect(catalog.cards.find((card) => card.id === server.id)).toMatchObject({
    installed: { state: "ready" },
  })
})

test("recovers an exact retired-Host-API Plugin from fixed offline bytes without fetching", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-v2")
  const plugin: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/acme/marketplace/releases/download/example-plugin-v2/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
    version: "2.0.0",
  }
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: "e".repeat(64),
      id: plugin.id,
      kind: plugin.kind,
      revision: 1,
      runtimeSurface: plugin.runtimeSurface,
      sourceKey: plugin.sourceKey,
      version: "1.0.0",
    })
  })
  const seenMutations: Array<string | undefined> = []
  let previousVersion: string | undefined
  let fetches = 0
  const { service } = harness({
    activePluginBindings: async () => [
      {
        active: true,
        artifact: { sha256: "a".repeat(64), size: 1 },
        id: plugin.id,
        snapshotDigest: "b".repeat(64),
        sourceKey: plugin.sourceKey,
        version: "1.0.0",
      },
    ],
    assertCapabilityMutationAllowed(identity, mutation) {
      seenMutations.push(mutation)
      if (identity.kind === "plugin" && mutation !== "update") throw new Error("Plugin runtime quarantined")
    },
    candidates: [plugin],
    installer: {
      installArtifact: async (_item, _prepared, options) => {
        previousVersion = options.previousVersion
        return {}
      },
    },
    networkFetch: {
      fetch: async () => {
        fetches += 1
        throw new Error("offline recovery must not fetch")
      },
    } as never,
    pluginRuntimeState: "unavailable-for-session",
    pluginUpdateRecoveryIds: new Set([plugin.id]),
    prepareFixedArtifact: async () => ({ artifactBytes: bytes, companionBytes: {} }),
    state,
  })

  await expect(service.listInstalled()).resolves.toMatchObject({
    capabilities: [
      {
        id: plugin.id,
        updateAvailable: true,
        updateRecoveryAvailable: true,
      },
    ],
  })
  const [choice] = await service.beginUpdate({ id: plugin.id, kind: plugin.kind }, "renderer")
  const confirmed = await service.confirmUpdate(choice!.confirmationToken, "renderer")
  await expect(service.update(confirmed.selectionToken, "renderer")).resolves.toMatchObject({
    id: plugin.id,
    version: "2.0.0",
  })
  expect(seenMutations).toEqual(["update"])
  expect(previousVersion).toBe("1.0.0")
  expect(fetches).toBe(0)
})

test("keeps retired-Host-API Plugin quarantine when no exact offline recovery artifact exists", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-v2")
  const plugin: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/acme/marketplace/releases/download/example-plugin-v2/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
    version: "2.0.0",
  }
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: "e".repeat(64),
      id: plugin.id,
      kind: plugin.kind,
      revision: 1,
      runtimeSurface: plugin.runtimeSurface,
      sourceKey: plugin.sourceKey,
      version: "1.0.0",
    })
  })
  let fetches = 0
  const { service } = harness({
    activePluginBindings: async () => [
      {
        active: true,
        artifact: { sha256: "a".repeat(64), size: 1 },
        id: plugin.id,
        snapshotDigest: "b".repeat(64),
        sourceKey: plugin.sourceKey,
        version: "1.0.0",
      },
    ],
    assertCapabilityMutationAllowed(_identity, mutation) {
      if (mutation !== "update") throw new Error("Plugin runtime quarantined")
    },
    candidates: [plugin],
    networkFetch: {
      fetch: async () => {
        fetches += 1
        throw new Error("network offline")
      },
    } as never,
    pluginRuntimeState: "unavailable-for-session",
    pluginUpdateRecoveryIds: new Set([plugin.id]),
    prepareFixedArtifact: async () => null,
    state,
  })

  const [choice] = await service.beginUpdate({ id: plugin.id, kind: plugin.kind }, "renderer")
  const confirmed = await service.confirmUpdate(choice!.confirmationToken, "renderer")
  await expect(service.update(confirmed.selectionToken, "renderer")).rejects.toThrow("network offline")
  expect(fetches).toBe(1)
  expect(await service.listInstalled()).toMatchObject({
    pluginRuntimeState: "unavailable-for-session",
    capabilities: [{ id: plugin.id, state: "attention" }],
  })
  expect((await state.read()).installations).toMatchObject([{ id: plugin.id, version: "1.0.0" }])
})

test("rejects every Plugin mutation before preparing bytes or changing Marketplace state", async () => {
  const state = await stateStore()
  const plugin: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: "f".repeat(64),
      size: 1,
      url: "https://github.com/acme/marketplace/releases/download/example-plugin-v1/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
  }
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: sha256Hex(canonicalJson(plugin.delivery)),
      id: plugin.id,
      kind: plugin.kind,
      revision: 1,
      runtimeSurface: plugin.runtimeSurface,
      sourceKey: plugin.sourceKey,
      version: plugin.version,
    })
    draft.executionGrants.push({
      authorizationContractDigest: "d".repeat(64),
      identity: { id: plugin.id, kind: plugin.kind },
      revision: 1,
      sourceKey: plugin.sourceKey,
    })
  })
  const before = await state.read()
  let prepared = 0
  const { service } = harness({
    assertCapabilityMutationAllowed(identity) {
      if (identity.kind === "plugin") throw new Error("Plugin runtime quarantined")
    },
    candidates: [plugin],
    installer: {
      installArtifact: async () => {
        prepared += 1
        return {}
      },
      prepareArtifact: async () => {
        prepared += 1
        return { artifactBytes: new Uint8Array(), companionBytes: {} }
      },
      prepareSetup: async () => {
        prepared += 1
        return {}
      },
      uninstall: async () => {
        prepared += 1
      },
    },
    state,
  })
  const [choice] = await service.beginInstall({ id: plugin.id, kind: plugin.kind }, "renderer")
  const confirmed = await service.confirmInstall(choice!.confirmationToken, "renderer")

  await expect(service.install(confirmed.selectionToken, "renderer")).rejects.toThrow("Plugin runtime quarantined")
  await expect(service.setup({ id: plugin.id, kind: plugin.kind }, async () => "/tool")).rejects.toThrow(
    "Plugin runtime quarantined",
  )
  await expect(service.disable({ id: plugin.id, kind: plugin.kind })).rejects.toThrow("Plugin runtime quarantined")
  await expect(service.enable({ id: plugin.id, kind: plugin.kind })).rejects.toThrow("Plugin runtime quarantined")
  await expect(service.uninstall({ id: plugin.id, kind: plugin.kind })).rejects.toThrow("Plugin runtime quarantined")

  expect(prepared).toBe(0)
  expect(await state.read()).toEqual(before)
})

test("rejects local import before the Local Marketplace writes a snapshot", async () => {
  const state = await stateStore()
  let imported = 0
  const { service } = harness({
    assertLocalImportAllowed() {
      throw new Error("Plugin runtime quarantined")
    },
    candidates: [],
    local: {
      importDirectory: async () => {
        imported += 1
        throw new Error("must not import")
      },
    } as never,
    state,
  })

  await expect(service.importDirectory("/chosen/local-package")).rejects.toThrow("Plugin runtime quarantined")
  expect(imported).toBe(0)
})

test("keeps the old record and grant when an authorization-changing candidate publication fails", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-v2")
  const candidate: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/acme/marketplace/releases/download/plugin-example-v2/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
    version: "2.0.0",
  }
  const oldGrant = "d".repeat(64)
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: "e".repeat(64),
      id: candidate.id,
      kind: candidate.kind,
      revision: 1,
      runtimeSurface: candidate.runtimeSurface,
      sourceKey: candidate.sourceKey,
      version: "1.0.0",
    })
    draft.executionGrants.push({
      authorizationContractDigest: oldGrant,
      identity: { id: candidate.id, kind: candidate.kind },
      revision: 1,
      sourceKey: candidate.sourceKey,
    })
  })
  const { service } = harness({
    activePluginBindings: async () => [
      {
        active: true,
        artifact: { sha256: "a".repeat(64), size: 1 },
        id: candidate.id,
        snapshotDigest: "b".repeat(64),
        sourceKey: candidate.sourceKey,
        version: "1.0.0",
      },
    ],
    candidates: [candidate],
    installer: {
      installArtifact: async (_item, _prepared, options) => {
        expect(options.authorizeExecution).toBe(true)
        throw new Error("candidate authorization canceled")
      },
    },
    prepareFixedArtifact: async () => ({
      artifactBytes: bytes,
      companionBytes: {},
    }),
    state,
  })
  const [choice] = await service.beginUpdate({ id: candidate.id, kind: candidate.kind }, "renderer")
  const confirmed = await service.confirmUpdate(choice!.confirmationToken, "renderer")
  await expect(service.update(confirmed.selectionToken, "renderer")).rejects.toThrow("authorization canceled")
  expect(await state.read()).toMatchObject({
    executionGrants: [{ authorizationContractDigest: oldGrant }],
    installations: [{ version: "1.0.0" }],
  })
})

test("treats a confirmed Plugin update as fresh execution consent even when the old grant is missing", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-v2")
  const candidateArtifact = { sha256: sha256Hex(bytes), size: bytes.byteLength }
  const candidate: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      ...candidateArtifact,
      kind: "artifact",
      url: "https://github.com/acme/marketplace/releases/download/plugin-example-v2/plugin.zip",
    },
    id: "example-plugin",
    kind: "plugin",
    version: "2.0.0",
  }
  const authorizationContractDigest = "c".repeat(64)
  const previousArtifact = { sha256: "a".repeat(64), size: 1 }
  let activeBindings = [
    {
      active: true,
      artifact: previousArtifact,
      id: candidate.id,
      snapshotDigest: "b".repeat(64),
      sourceKey: candidate.sourceKey,
      version: "1.0.0",
    },
  ]
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: "e".repeat(64),
      id: candidate.id,
      kind: candidate.kind,
      revision: 1,
      runtimeSurface: candidate.runtimeSurface,
      sourceKey: candidate.sourceKey,
      version: "1.0.0",
    })
  })
  const { service } = harness({
    activePluginBindings: async () => activeBindings,
    candidates: [candidate],
    installer: {
      installArtifact: async (_item, _prepared, options) => {
        expect(options.authorizeExecution).toBe(true)
        activeBindings = [
          {
            active: true,
            artifact: candidateArtifact,
            id: candidate.id,
            snapshotDigest: "d".repeat(64),
            sourceKey: candidate.sourceKey,
            version: candidate.version,
          },
        ]
        return { authorizationContractDigest }
      },
      verifyAuthorization: async (_record, expected) => expected === authorizationContractDigest,
    },
    prepareFixedArtifact: async () => ({
      artifactBytes: bytes,
      companionBytes: {},
    }),
    state,
  })
  const [choice] = await service.beginUpdate({ id: candidate.id, kind: candidate.kind }, "renderer")
  const confirmed = await service.confirmUpdate(choice!.confirmationToken, "renderer")

  await expect(service.update(confirmed.selectionToken, "renderer")).resolves.toMatchObject({
    id: candidate.id,
    state: "ready",
    version: candidate.version,
  })
  expect(await state.read()).toMatchObject({
    executionGrants: [{ authorizationContractDigest }],
    installations: [{ version: candidate.version }],
    transitions: [],
  })
})

test("keeps the old Local Plugin record and grant when candidate authorization is canceled", async () => {
  const state = await stateStore()
  const digest = "f".repeat(64)
  const candidate: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: digest,
      size: 1,
      url: "https://local.invalid/immutable-snapshot",
    },
    id: "local-plugin",
    kind: "plugin",
    marketplaceId: "convax-local",
    sourceKey: sourceB,
    sourceKind: "local",
    version: "2.0.0",
  }
  const localPackage = {
    digest,
    id: candidate.id,
    kind: candidate.kind,
    revision: 2,
    snapshotKey: "snapshot-v2",
    version: candidate.version,
  } as const
  const oldGrant = "a".repeat(64)
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: "b".repeat(64),
      id: candidate.id,
      kind: candidate.kind,
      revision: 1,
      runtimeSurface: candidate.runtimeSurface,
      sourceKey: candidate.sourceKey,
      version: "1.0.0",
    })
    draft.executionGrants.push({
      authorizationContractDigest: oldGrant,
      identity: { id: candidate.id, kind: candidate.kind },
      revision: 1,
      sourceKey: candidate.sourceKey,
    })
  })
  const { service } = harness({
    activePluginBindings: async () => [
      {
        active: true,
        artifact: { sha256: "a".repeat(64), size: 1 },
        id: candidate.id,
        snapshotDigest: "b".repeat(64),
        sourceKey: candidate.sourceKey,
        version: "1.0.0",
      },
    ],
    candidates: [],
    installer: {
      installLocal: async (_item, _directory, options) => {
        expect(options.authorizeExecution).toBe(true)
        throw new Error("local candidate authorization canceled")
      },
    },
    local: {
      importDirectory: async () => localPackage,
      list: async () => ({
        packages: [localPackage],
        revision: 2,
        schema: "convax.local-marketplace-index/1",
      }),
      projectCatalogItem: async () => candidate,
      resolveSnapshotDirectory: () => "/immutable/local/snapshot-v2",
    } as never,
    state,
  })
  await expect(service.importDirectory("/chosen/local-plugin")).rejects.toThrow("authorization canceled")
  expect(await state.read()).toMatchObject({
    executionGrants: [{ authorizationContractDigest: oldGrant }],
    installations: [{ version: "1.0.0" }],
  })
})

test("keeps setup cancellation non-destructive and leaves a runtime capability setup-required", async () => {
  const state = await stateStore()
  const item = runtimeItem()
  const { service } = harness({
    candidates: [item],
    installer: { setup: async () => null },
    state,
  })
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: sha256Hex(canonicalJson(item.delivery)),
      id: item.id,
      kind: item.kind,
      revision: 1,
      runtimeSurface: "agent",
      sourceKey: item.sourceKey,
      version: item.version,
    })
  })
  await expect(service.setup({ id: item.id, kind: item.kind }, async () => null)).resolves.toMatchObject({
    state: "setup-required",
  })
  expect((await state.read()).executionGrants).toEqual([])
  expect((await state.read()).transitions).toEqual([])
})

test("immediately rolls back a deterministically failed MCP setup transition so retry and update stay available", async () => {
  const state = await stateStore()
  const item = runtimeItem()
  const previousGrant = "d".repeat(64)
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: sha256Hex(canonicalJson(item.delivery)),
      id: item.id,
      kind: item.kind,
      revision: 1,
      runtimeSurface: item.runtimeSurface,
      sourceKey: item.sourceKey,
      version: item.version,
    })
    draft.executionGrants.push({
      authorizationContractDigest: previousGrant,
      identity: { id: item.id, kind: item.kind },
      revision: 1,
      sourceKey: item.sourceKey,
    })
  })
  const { service } = harness({
    candidates: [item],
    installer: {
      resolveTransition: async () => "previous",
      setup: async () => {
        throw new Error("installed Plugin snapshot is unavailable")
      },
    },
    state,
  })

  await expect(service.setup({ id: item.id, kind: item.kind }, async () => null)).rejects.toThrow(
    "snapshot is unavailable",
  )
  expect(await state.read()).toMatchObject({
    executionGrants: [{ authorizationContractDigest: previousGrant }],
    installations: [{ id: item.id, version: item.version }],
    transitions: [],
  })
})

test("fails closed on cross-source replacement before publishing bytes", async () => {
  const state = await stateStore()
  const item = skill({ sourceKey: sourceB })
  await state.update((draft) => {
    draft.installations.push({
      artifactDigest: "f".repeat(64),
      id: item.id,
      kind: item.kind,
      revision: 1,
      runtimeSurface: "none",
      sourceKey: sourceA,
      version: "0.9.0",
    })
  })
  const { service } = harness({ candidates: [item], state })
  await expect(service.beginInstall({ id: item.id, kind: item.kind }, "sender")).resolves.toEqual([])
  expect((await state.read()).installations[0]?.sourceKey).toBe(sourceA)
})

test("recovers a canonical next decision and converges the durable transition", async () => {
  const state = await stateStore()
  const item = skill()
  const next = {
    artifactDigest: sha256Hex(canonicalJson(item.delivery)),
    id: item.id,
    kind: item.kind,
    revision: 1,
    runtimeSurface: "none" as const,
    sourceKey: item.sourceKey,
    version: item.version,
  }
  const transition: CapabilityTransition = {
    decision: "pending",
    id: "recover-next",
    identity: { id: item.id, kind: item.kind },
    mutation: "install",
    next,
    owner: "managed-skill",
    participants: [
      {
        digest: capabilityTransitionParticipantDigest({
          next,
          participant: "install-record",
          previous: null,
        }),
        next,
        participant: "install-record",
        previous: null,
        state: "pending",
      },
    ],
    phase: "recovery-required",
    previous: null,
    revision: 1,
  }
  await state.update((draft) => {
    draft.transitions.push(transition)
  })
  const { service } = harness({
    candidates: [item],
    installer: { resolveTransition: async () => "next" },
    state,
  })
  await service.recoverTransitions()
  expect(await state.read()).toMatchObject({
    installations: [{ id: item.id, version: item.version }],
    transitions: [],
  })
})

test("recovers same-version Plugin transitions by exact artifact instead of version", async () => {
  for (const activeSide of ["previous", "next"] as const) {
    const state = await stateStore()
    const previousArtifact = { sha256: "a".repeat(64), size: 10 }
    const nextBytes = new TextEncoder().encode("same-version-new-plugin")
    const item: SourceQualifiedItem = {
      ...runtimeItem(),
      delivery: {
        kind: "artifact",
        sha256: sha256Hex(nextBytes),
        size: nextBytes.byteLength,
        url: "https://github.com/acme/marketplace/releases/download/example-plugin-v1/plugin.zip",
      },
      id: "same-version-plugin",
      kind: "plugin",
      version: "1.0.0",
    }
    const previous = {
      artifact: previousArtifact,
      artifactDigest: "c".repeat(64),
      id: item.id,
      kind: item.kind,
      revision: 1,
      runtimeSurface: item.runtimeSurface,
      sourceKey: item.sourceKey,
      version: item.version,
    }
    const nextArtifact = { sha256: sha256Hex(nextBytes), size: nextBytes.byteLength }
    const next = {
      artifact: nextArtifact,
      artifactDigest: sha256Hex(canonicalJson(item.delivery)),
      id: item.id,
      kind: item.kind,
      revision: 2,
      runtimeSurface: item.runtimeSurface,
      sourceKey: item.sourceKey,
      version: item.version,
    }
    const participant = {
      next,
      participant: "install-record" as const,
      previous,
      state: "pending" as const,
    }
    await state.update((draft) => {
      draft.installations.push(previous)
      draft.transitions.push({
        decision: "pending",
        id: `same-version-${activeSide}`,
        identity: { id: item.id, kind: item.kind },
        mutation: "update",
        next,
        owner: "plugin-package",
        participants: [
          {
            ...participant,
            digest: capabilityTransitionParticipantDigest(participant),
          },
        ],
        phase: "recovery-required",
        previous,
        revision: 1,
      })
    })
    const activeArtifact = activeSide === "next" ? next.artifact : previousArtifact
    const { service } = harness({
      activePluginBindings: async () => [
        {
          active: true,
          artifact: activeArtifact,
          id: item.id,
          snapshotDigest: (activeSide === "next" ? "d" : "e").repeat(64),
          sourceKey: item.sourceKey,
          version: item.version,
        },
      ],
      candidates: [item],
      installer: {
        resolveTransition: async () => {
          throw new Error("Plugin recovery must not use a version-only adapter")
        },
      },
      state,
    })

    await service.recoverTransitions()

    expect((await state.read()).installations[0]).toMatchObject({
      artifact: activeArtifact,
      revision: activeSide === "next" ? 2 : 1,
    })
    expect((await state.read()).transitions).toEqual([])
  }
})

test("keeps every Plugin uninstall participant when ActiveSet authority cannot be read", async () => {
  const state = await stateStore()
  const artifact = { sha256: "a".repeat(64), size: 10 }
  const item: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      ...artifact,
      url: "https://github.com/acme/marketplace/releases/download/example-plugin-v1/plugin.zip",
    },
    id: "uninstall-recovery-plugin",
    kind: "plugin",
  }
  const previous = {
    artifact,
    artifactDigest: sha256Hex(canonicalJson(item.delivery)),
    id: item.id,
    kind: item.kind,
    revision: 1,
    runtimeSurface: item.runtimeSurface,
    sourceKey: item.sourceKey,
    version: item.version,
  }
  const grant = {
    authorizationContractDigest: "b".repeat(64),
    identity: { id: item.id, kind: item.kind },
    revision: 1,
    sourceKey: item.sourceKey,
  }
  const preference = {
    desired: "disabled" as const,
    identity: { id: item.id, kind: item.kind },
    revision: 1,
    sourceKey: item.sourceKey,
  }
  const participants: CapabilityTransition["participants"] = [
    {
      digest: capabilityTransitionParticipantDigest({
        next: null,
        participant: "install-record",
        previous,
      }),
      next: null,
      participant: "install-record",
      previous,
      state: "pending",
    },
    {
      digest: capabilityTransitionParticipantDigest({
        next: null,
        participant: "execution-grant",
        previous: grant,
      }),
      next: null,
      participant: "execution-grant",
      previous: grant,
      state: "pending",
    },
    {
      digest: capabilityTransitionParticipantDigest({
        next: null,
        participant: "runtime-preference",
        previous: preference,
      }),
      next: null,
      participant: "runtime-preference",
      previous: preference,
      state: "pending",
    },
  ]
  await state.update((draft) => {
    draft.installations.push(previous)
    draft.executionGrants.push(grant)
    draft.runtimePreferences.push(preference)
    draft.transitions.push({
      decision: "pending",
      id: "plugin-uninstall-authority-unavailable",
      identity: { id: item.id, kind: item.kind },
      mutation: "uninstall",
      next: null,
      owner: "plugin-package",
      participants,
      phase: "recovery-required",
      previous,
      revision: 1,
    })
  })
  const { service } = harness({
    activePluginBindings: async () => {
      throw new Error("ActiveSet authority unreadable")
    },
    candidates: [item],
    state,
  })

  await service.recoverTransitions()

  expect(await state.read()).toMatchObject({
    executionGrants: [grant],
    installations: [previous],
    runtimePreferences: [preference],
    transitions: [
      {
        decision: "pending",
        id: "plugin-uninstall-authority-unavailable",
        phase: "recovery-required",
      },
    ],
  })
})

test("removes a first-install Skill transition when transactional publication rolls back", async () => {
  const state = await stateStore()
  const item = skill()
  const { service } = harness({
    candidates: [item],
    installer: {
      installBuiltin: async () => {
        throw new Error("same-name Skill already exists")
      },
    },
    state,
  })

  await expect(install(service, item)).rejects.toThrow("same-name Skill already exists")
  expect(await state.read()).toMatchObject({
    installations: [],
    transitions: [],
  })
})

test("retains Skill recovery state when the owner cannot prove publication rollback", async () => {
  const state = await stateStore()
  const current = skill({ version: "1.0.0" })
  const update = skill({ catalogSequence: 2, version: "2.0.0" })
  const previous = {
    artifactDigest: "f".repeat(64),
    id: current.id,
    kind: current.kind,
    revision: 1,
    runtimeSurface: "none" as const,
    sourceKey: current.sourceKey,
    version: current.version,
  }
  await state.update((draft) => {
    draft.installations.push(previous)
  })
  const { service } = harness({
    candidates: [update],
    installer: {
      installBuiltin: async () => {
        throw new CapabilityPublicationRecoveryRequiredError(
          [new Error("refresh failed"), new Error("rollback failed")],
          "Skill publication rollback is ambiguous",
        )
      },
    },
    state,
  })
  const [choice] = await service.beginUpdate({ id: update.id, kind: update.kind }, "renderer")
  const confirmed = await service.confirmUpdate(choice!.confirmationToken, "renderer")

  await expect(service.update(confirmed.selectionToken, "renderer")).rejects.toBeInstanceOf(
    CapabilityPublicationRecoveryRequiredError,
  )
  expect(await state.read()).toMatchObject({
    installations: [previous],
    transitions: [
      {
        decision: "pending",
        identity: { id: update.id, kind: update.kind },
        mutation: "update",
        phase: "recovery-required",
        previous,
      },
    ],
  })
})

test("explicitly retries the same verified standalone Skill update after an interrupted publication", async () => {
  const state = await stateStore()
  const current = skill({ version: "1.0.0" })
  const update = skill({ catalogSequence: 2, version: "2.0.0" })
  const previous = {
    artifactDigest: "f".repeat(64),
    id: current.id,
    kind: current.kind,
    revision: 1,
    runtimeSurface: "none" as const,
    sourceKey: current.sourceKey,
    version: current.version,
  }
  const next = {
    artifactDigest: sha256Hex(canonicalJson(update.delivery)),
    id: update.id,
    kind: update.kind,
    revision: 2,
    runtimeSurface: "none" as const,
    sourceKey: update.sourceKey,
    version: update.version,
  }
  const participant = {
    next,
    participant: "install-record" as const,
    previous,
    state: "pending" as const,
  }
  await state.update((draft) => {
    draft.installations.push(previous)
    draft.transitions.push({
      decision: "pending",
      id: "interrupted-skill-update",
      identity: { id: update.id, kind: update.kind },
      mutation: "update",
      next,
      owner: "managed-skill",
      participants: [{ ...participant, digest: capabilityTransitionParticipantDigest(participant) }],
      phase: "recovery-required",
      previous,
      revision: 3,
    })
  })
  let publications = 0
  const { service } = harness({
    candidates: [update],
    installer: {
      installBuiltin: async () => {
        publications += 1
      },
    },
    state,
  })

  const [choice] = await service.beginUpdate({ id: update.id, kind: update.kind }, "renderer")
  const confirmed = await service.confirmUpdate(choice!.confirmationToken, "renderer")
  await expect(service.update(confirmed.selectionToken, "renderer")).resolves.toMatchObject({
    id: update.id,
    version: update.version,
  })
  expect(publications).toBe(1)
  expect(await state.read()).toMatchObject({
    installations: [{ id: update.id, revision: 2, version: update.version }],
    transitions: [],
  })
})

test("projects and abandons an orphaned managed Skill publication without deleting ambiguous bytes", async () => {
  const state = await stateStore()
  const item = skill({ id: "orphaned-skill", version: "2.0.0" })
  const next = {
    artifactDigest: sha256Hex(canonicalJson(item.delivery)),
    id: item.id,
    kind: item.kind,
    revision: 1,
    runtimeSurface: "none" as const,
    sourceKey: item.sourceKey,
    version: item.version,
  }
  const participant = {
    next,
    participant: "install-record" as const,
    previous: null,
    state: "pending" as const,
  }
  await state.update((draft) => {
    draft.transitions.push({
      decision: "pending",
      id: "orphaned-managed-skill",
      identity: { id: item.id, kind: item.kind },
      mutation: "install",
      next,
      owner: "managed-skill",
      participants: [{ ...participant, digest: capabilityTransitionParticipantDigest(participant) }],
      phase: "recovery-required",
      previous: null,
      revision: 1,
    })
  })
  let uninstalled = false
  const { service } = harness({
    candidates: [],
    installer: {
      uninstall: async (identity) => {
        expect(identity).toEqual({ id: item.id, kind: item.kind })
        uninstalled = true
      },
    },
    state,
  })

  await expect(service.listInstalled()).resolves.toMatchObject({
    capabilities: [
      {
        attention: "managed-skill-recovery",
        id: item.id,
        state: "attention",
        updateAvailable: false,
      },
    ],
  })
  await service.uninstall({ id: item.id, kind: item.kind })

  expect(uninstalled).toBe(false)
  expect((await state.read()).transitions).toEqual([])
})

test("explicit uninstall supersedes a rejected Plugin-owned Skill publication without guessing its bytes", async () => {
  const state = await stateStore()
  const ownedUpdate = skill({
    catalogSequence: 2,
    ownerPluginId: "ffmpeg-tools",
    presentation: { name: "FFmpeg Canvas" },
    version: "2.0.0",
  })
  const previous = {
    artifactDigest: "f".repeat(64),
    id: ownedUpdate.id,
    kind: ownedUpdate.kind,
    revision: 1,
    runtimeSurface: "none" as const,
    sourceKey: ownedUpdate.sourceKey,
    version: "1.0.0",
  }
  const next = {
    artifactDigest: sha256Hex(canonicalJson(ownedUpdate.delivery)),
    id: ownedUpdate.id,
    kind: ownedUpdate.kind,
    revision: 2,
    runtimeSurface: "none" as const,
    sourceKey: ownedUpdate.sourceKey,
    version: ownedUpdate.version,
  }
  const participant = {
    next,
    participant: "install-record" as const,
    previous,
    state: "pending" as const,
  }
  await state.update((draft) => {
    draft.installations.push(previous)
    draft.transitions.push({
      decision: "pending",
      id: "rejected-owned-skill-update",
      identity: { id: ownedUpdate.id, kind: ownedUpdate.kind },
      mutation: "update",
      next,
      owner: "managed-skill",
      participants: [{ ...participant, digest: capabilityTransitionParticipantDigest(participant) }],
      phase: "recovery-required",
      previous,
      revision: 3,
    })
  })
  let uninstallations = 0
  const { service } = harness({
    candidates: [ownedUpdate],
    installer: {
      uninstall: async () => {
        uninstallations += 1
      },
    },
    state,
  })

  await expect(service.listInstalled()).resolves.toMatchObject({
    capabilities: [
      {
        attention: "plugin-owned-skill-legacy",
        id: ownedUpdate.id,
        state: "attention",
        updateAvailable: false,
      },
    ],
  })
  await service.uninstall({ id: ownedUpdate.id, kind: ownedUpdate.kind })
  expect(uninstallations).toBe(1)
  expect(await state.read()).toMatchObject({ installations: [], transitions: [] })
})

test("reports hard-refresh failure as partial success after publishing committed state and change event", async () => {
  const state = await stateStore()
  const item = skill()
  const { service } = harness({
    candidates: [item],
    installer: {
      hardRefresh: async () => {
        throw new Error("refresh unavailable")
      },
    },
    state,
  })
  let changes = 0
  service.subscribe(() => {
    changes += 1
  })
  const [choice] = await service.beginInstall({ id: item.id, kind: item.kind }, "sender")
  const confirmed = await service.confirmInstall(choice!.confirmationToken, "sender")
  await expect(service.install(confirmed.selectionToken, "sender")).rejects.toBeInstanceOf(
    MarketplacePostCommitRefreshError,
  )
  expect((await state.read()).installations).toHaveLength(1)
  expect(changes).toBeGreaterThan(0)
})

test("preinstalls only the exact source-bound policy entry and preserves removal across restart", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-zip")
  const item: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/plugin.zip",
    },
    id: "ffmpeg-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    presentation: { name: "FFmpeg Tools" },
    sourceKey: sourceA,
    version: "1.0.0",
  }
  const policyEntryDigest = sha256Hex(canonicalJson({ id: item.id, sourceKey: item.sourceKey, version: item.version }))
  const policy = (identity: { id: string; kind: string; sourceKey: SourceKey; version: string }) =>
    identity.id === item.id &&
    identity.kind === item.kind &&
    identity.sourceKey === item.sourceKey &&
    identity.version === item.version
      ? {
          marketplaceId: item.marketplaceId,
          observedPolicyRevision: 1,
          policyEntryDigest,
          setup: "automatic" as const,
        }
      : undefined
  const first = harness({
    candidates: [item],
    installer: {
      setup: async () => ({ authorizationContractDigest: "f".repeat(64) }),
    },
    preinstalledPolicy: policy,
    prepareFixedArtifact: async () => ({ artifactBytes: bytes, companionBytes: {} }),
    state,
  })
  await first.service.provisionPreinstalled()
  expect(await state.read()).toMatchObject({
    executionGrants: [{ identity: { id: item.id, kind: item.kind }, sourceKey: item.sourceKey }],
    installations: [{ id: item.id, sourceKey: item.sourceKey }],
  })
  await first.service.uninstall({ id: item.id, kind: item.kind })
  expect((await state.read()).provisioningDecisions).toMatchObject([
    {
      marketplaceId: item.marketplaceId,
      policyEntryDigest,
      sourceKey: item.sourceKey,
    },
  ])
  const restarted = harness({
    candidates: [item],
    preinstalledPolicy: policy,
    prepareFixedArtifact: async () => ({ artifactBytes: bytes, companionBytes: {} }),
    state,
  })
  await restarted.service.provisionPreinstalled()
  expect((await state.read()).installations).toEqual([])
})

test("explicit reinstall clears the matching removal decision and completes automatic Plugin setup", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-zip")
  const item: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/plugin.zip",
    },
    id: "ffmpeg-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    presentation: { name: "FFmpeg Tools" },
    sourceKey: sourceA,
    version: "1.0.0",
  }
  const policyEntryDigest = sha256Hex(canonicalJson({ id: item.id, sourceKey: item.sourceKey, version: item.version }))
  const policy = () => ({
    marketplaceId: item.marketplaceId,
    observedPolicyRevision: 1,
    policyEntryDigest,
    setup: "automatic" as const,
  })
  const setupModes: string[] = []
  const { service } = harness({
    candidates: [item],
    installer: {
      setup: async (_record, _prepared, options) => {
        setupModes.push(options.mode)
        return { authorizationContractDigest: "f".repeat(64) }
      },
    },
    preinstalledPolicy: policy,
    prepareFixedArtifact: async () => ({ artifactBytes: bytes, companionBytes: {} }),
    state,
  })

  await service.provisionPreinstalled()
  await service.uninstall({ id: item.id, kind: item.kind })
  expect((await state.read()).provisioningDecisions).toHaveLength(1)

  await install(service, item)

  expect(setupModes).toEqual(["automatic-product-lock", "automatic-product-lock"])
  expect(await state.read()).toMatchObject({
    executionGrants: [{ identity: { id: item.id, kind: item.kind }, sourceKey: item.sourceKey }],
    installations: [{ id: item.id, sourceKey: item.sourceKey }],
    provisioningDecisions: [],
    transitions: [],
  })
})

test("uninstall recovery preserves the accepted removal decision across a product-lock version change", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-zip")
  const item: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/plugin.zip",
    },
    id: "ffmpeg-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    presentation: { name: "FFmpeg Tools" },
    sourceKey: sourceA,
    version: "1.0.0",
  }
  const nextBytes = new TextEncoder().encode("plugin-zip-v2")
  const nextItem: SourceQualifiedItem = {
    ...item,
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(nextBytes),
      size: nextBytes.byteLength,
      url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-ffmpeg-tools-v2.0.0/plugin.zip",
    },
    version: "2.0.0",
  }
  const policyEntryDigest = "d".repeat(64)
  const nextPolicyEntryDigest = "e".repeat(64)
  const policy = (identity: { version: string }) =>
    identity.version === item.version
      ? {
          marketplaceId: item.marketplaceId,
          observedPolicyRevision: 1,
          policyEntryDigest,
          setup: "automatic" as const,
        }
      : identity.version === nextItem.version
        ? {
            marketplaceId: nextItem.marketplaceId,
            observedPolicyRevision: 2,
            policyEntryDigest: nextPolicyEntryDigest,
            setup: "automatic" as const,
          }
        : undefined
  const first = harness({
    candidates: [item],
    installer: {
      setup: async () => ({ authorizationContractDigest: "f".repeat(64) }),
      uninstall: async () => {
        throw new Error("crashed after removing Plugin bytes")
      },
    },
    preinstalledPolicy: policy,
    prepareFixedArtifact: async () => ({ artifactBytes: bytes, companionBytes: {} }),
    state,
  })
  await first.service.provisionPreinstalled()
  await expect(first.service.uninstall({ id: item.id, kind: item.kind })).rejects.toThrow(
    "crashed after removing Plugin bytes",
  )

  const restarted = harness({
    activePluginBindings: async () => [],
    candidates: [nextItem],
    installer: { resolveTransition: async () => "next" },
    preinstalledPolicy: policy,
    prepareFixedArtifact: async () => ({ artifactBytes: nextBytes, companionBytes: {} }),
    state,
  })
  await restarted.service.recoverTransitions()
  await restarted.service.provisionPreinstalled()

  expect(await state.read()).toMatchObject({
    installations: [],
    provisioningDecisions: [
      {
        decision: "removed-by-user",
        identity: { id: item.id, kind: item.kind },
        marketplaceId: item.marketplaceId,
        policyEntryDigest,
        sourceKey: item.sourceKey,
      },
    ],
    transitions: [],
  })
})

test("retries automatic product-lock setup after recovering a failed setup transition", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-zip")
  const item: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/convaxai/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/plugin.zip",
    },
    id: "ffmpeg-tools",
    kind: "plugin",
    marketplaceId: "convax-official",
    presentation: { name: "FFmpeg Tools" },
    sourceKey: sourceA,
    version: "1.0.0",
  }
  const policy = () => ({
    marketplaceId: item.marketplaceId,
    observedPolicyRevision: 1,
    policyEntryDigest: "e".repeat(64),
    setup: "automatic" as const,
  })
  const first = harness({
    candidates: [item],
    installer: {
      setup: async () => {
        throw new Error("managed companion changed")
      },
    },
    preinstalledPolicy: policy,
    prepareFixedArtifact: async () => ({ artifactBytes: bytes, companionBytes: {} }),
    state,
  })

  await expect(first.service.provisionPreinstalled()).rejects.toThrow("preinstall provisioning")
  expect(await state.read()).toMatchObject({
    executionGrants: [],
    installations: [{ id: item.id }],
    transitions: [{ identity: { id: item.id }, mutation: "setup", phase: "recovery-required" }],
  })

  const restarted = harness({
    candidates: [item],
    installer: {
      resolveTransition: async () => "next",
      setup: async () => ({ authorizationContractDigest: "f".repeat(64) }),
    },
    preinstalledPolicy: policy,
    prepareFixedArtifact: async () => ({ artifactBytes: bytes, companionBytes: {} }),
    state,
  })
  await restarted.service.recoverTransitions()
  await restarted.service.provisionPreinstalled()
  expect(await state.read()).toMatchObject({
    executionGrants: [{ identity: { id: item.id }, sourceKey: item.sourceKey }],
    installations: [{ id: item.id }],
    transitions: [],
  })
})
