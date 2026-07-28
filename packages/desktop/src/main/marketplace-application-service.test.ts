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
  candidates: SourceQualifiedItem[]
  fixedSources?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["fixedSources"]
  installer?: Partial<MarketplaceCapabilityInstallerPort>
  local?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["local"]
  networkCandidates?: SourceQualifiedItem[]
  networkRefresh?: (id: string) => Promise<void>
  preinstalledPolicy?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["preinstalledPolicy"]
  prepareFixedArtifact?: ConstructorParameters<typeof MarketplaceApplicationService>[0]["prepareFixedArtifact"]
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
    arch: "arm64",
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
    networkFetch: {
      fetch: async () => {
        throw new Error("not used")
      },
    } as never,
    platform: "darwin",
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
      url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/plugin.zip",
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
        repository: "microvoid/convax-plugins",
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
      url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/plugin.zip",
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

test("retries automatic product-lock setup after recovering a failed setup transition", async () => {
  const state = await stateStore()
  const bytes = new TextEncoder().encode("plugin-zip")
  const item: SourceQualifiedItem = {
    ...runtimeItem(),
    delivery: {
      kind: "artifact",
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      url: "https://github.com/microvoid/convax-plugins/releases/download/plugin-ffmpeg-tools-v1.0.0/plugin.zip",
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
