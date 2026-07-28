import { randomBytes, randomUUID } from "node:crypto"

import {
  aggregateCatalog,
  assertSelectionCurrent,
  canonicalJson,
  issueSelectionToken,
  resolveInstallConflict,
  sha256Hex,
  verifySelectionToken,
  type SelectionToken,
  type SourceKey,
  type SourceQualifiedItem,
} from "@convax/marketplace"

import type {
  MarketplaceCatalogSnapshot,
  MarketplaceCatalogSourceChoice,
  MarketplaceCapabilityKind,
  MarketplaceInstalledCapability,
  MarketplaceInventory,
  MarketplaceSettingsSource,
} from "../marketplace-contracts"
import type { MarketplaceApplicationPort } from "./marketplace-ipc"
import type { LocalMarketplacePackage, LocalMarketplaceStore } from "./local-marketplace-store"
import type { MarketplacePluginSetupMode } from "./marketplace-plugin-setup-authorization"
import type { NetworkMarketplaceManager } from "./network-marketplace-manager"
import type { PinnedHttpsFetcher } from "./pinned-https-fetch"
import {
  type FileMarketplaceStateStore,
  type CapabilityMutationCoordinator,
  type CapabilityTransition,
  type InstallRecord,
  capabilityTransitionParticipantDigest,
  projectInstalledCapability,
} from "./marketplace-state"

export interface MarketplaceCapabilityInstallerPort {
  activate(record: InstallRecord, authorizationContractDigest: string): Promise<void>
  disable(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  enable(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  installArtifact(
    item: SourceQualifiedItem,
    prepared: { artifactBytes: Uint8Array; companionBytes: Readonly<Record<string, Uint8Array>> },
    options: { authorizeExecution: boolean },
  ): Promise<{ authorizationContractDigest?: string }>
  installBuiltin(item: SourceQualifiedItem, bytes: Uint8Array): Promise<void>
  installLocal(
    item: LocalMarketplacePackage,
    snapshotDirectory: string,
    options: { authorizeExecution: boolean },
  ): Promise<{ authorizationContractDigest?: string }>
  installMcpMetadata(
    item: SourceQualifiedItem,
    companion?: { bytes: Uint8Array; sha256: string; size: number },
    options?: { asCandidate: boolean },
  ): Promise<{ authorizationContractDigest?: string }>
  commitMcpCandidate(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  discardMcpCandidate(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  hardRefresh(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  prepareSetup(
    record: InstallRecord,
    pickExecutable: () => Promise<string | null>,
  ): Promise<{ addTarget?: string | null }>
  resolveTransition(transition: CapabilityTransition): Promise<"next" | "previous" | "unknown">
  prepareArtifact(
    item: SourceQualifiedItem,
    bytes: Uint8Array,
  ): Promise<{ artifactBytes: Uint8Array; companionBytes: Readonly<Record<string, Uint8Array>> }>
  setup(
    record: InstallRecord,
    prepared: { addTarget?: string | null },
    options: { mode: MarketplacePluginSetupMode },
  ): Promise<{ authorizationContractDigest: string } | null>
  uninstall(identity: { id: string; kind: MarketplaceCapabilityKind }): Promise<void>
  verifyAuthorization(record: InstallRecord, authorizationContractDigest: string): Promise<boolean>
}

export interface MarketplaceApplicationServiceOptions {
  arch?: NodeJS.Architecture
  fixedCatalog(): Promise<readonly SourceQualifiedItem[]>
  fixedSources(): Promise<readonly MarketplaceSettingsSource[]>
  installer: MarketplaceCapabilityInstallerPort
  local?: LocalMarketplaceStore
  localSourceKey?: SourceKey
  network: NetworkMarketplaceManager
  networkFetch: PinnedHttpsFetcher
  platform?: NodeJS.Platform
  preinstalledPolicy?(identity: {
    id: string
    kind: MarketplaceCapabilityKind
    sourceKey: SourceKey
    version: string
  }):
    | {
        marketplaceId: string
        observedPolicyRevision: number
        policyEntryDigest: string
        setup: "automatic" | "explicit"
      }
    | undefined
  prepareFixedArtifact?(
    item: SourceQualifiedItem,
  ): Promise<{ artifactBytes: Uint8Array; companionBytes: Readonly<Record<string, Uint8Array>> } | null>
  refreshFixedSource?(id: string): Promise<boolean>
  readFixedArtifact(item: SourceQualifiedItem): Promise<Uint8Array>
  reservedBuiltinIdentities?: readonly {
    id: string
    kind: "plugin" | "skill"
  }[]
  repositoryAuthority(item: SourceQualifiedItem): Promise<{ owner: string; repository: string }>
  state: FileMarketplaceStateStore
  mutations: CapabilityMutationCoordinator
}

function identityKey(value: { id: string; kind: string }) {
  return `${value.kind}\0${value.id}`
}

function runtimeSurface(item: SourceQualifiedItem): InstallRecord["runtimeSurface"] {
  return item.runtimeSurface
}

function installRecordFor(item: SourceQualifiedItem, previous?: InstallRecord): InstallRecord {
  return {
    artifactDigest: sha256Hex(canonicalJson(item.delivery)),
    id: item.id,
    kind: item.kind,
    revision: (previous?.revision ?? 0) + 1,
    runtimeSurface: runtimeSurface(item),
    sourceKey: item.sourceKey,
    version: item.version,
  }
}

function transitionOwner(item: Pick<SourceQualifiedItem, "kind">): CapabilityTransition["owner"] {
  return item.kind === "plugin" ? "plugin-package" : item.kind === "skill" ? "managed-skill" : "mcp-metadata"
}

export class MarketplaceApplicationService implements MarketplaceApplicationPort {
  readonly #options: MarketplaceApplicationServiceOptions
  readonly #confirmationSecret = randomBytes(32)
  readonly #installSecret = randomBytes(32)
  readonly #updateConfirmationSecret = randomBytes(32)
  readonly #updateSecret = randomBytes(32)
  readonly #consumedTokens = new Set<string>()
  readonly #listeners = new Set<() => void>()
  #revision = 0

  constructor(options: MarketplaceApplicationServiceOptions) {
    this.#options = options
    options.network.subscribe(() => this.#emit())
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async #catalog() {
    const [fixed, network] = await Promise.all([this.#options.fixedCatalog(), this.#options.network.listCatalog()])
    let localItems: SourceQualifiedItem[] = []
    const localStore = this.#options.local
    const localSourceKey = this.#options.localSourceKey
    if (localStore && localSourceKey) {
      try {
        const local = await localStore.list()
        const latestLocal = new Map<string, LocalMarketplacePackage>()
        for (const item of local.packages) {
          const key = identityKey(item)
          const current = latestLocal.get(key)
          if (!current || item.revision > current.revision) latestLocal.set(key, item)
        }
        localItems = await Promise.all(
          [...latestLocal.values()].map((item) => localStore.projectCatalogItem(item, localSourceKey)),
        )
      } catch {
        localItems = []
      }
    }
    const fixedIdentities = new Set(fixed.map(identityKey))
    const unavailableReservations = new Set(
      (this.#options.reservedBuiltinIdentities ?? [])
        .filter((entry) => !fixedIdentities.has(identityKey(entry)))
        .map(identityKey),
    )
    return [
      ...fixed,
      ...network.filter((entry) => !unavailableReservations.has(identityKey(entry))),
      ...localItems.filter((entry) => !unavailableReservations.has(identityKey(entry))),
    ]
  }

  async listCatalog(): Promise<MarketplaceCatalogSnapshot> {
    const state = await this.#options.state.read()
    const groups = aggregateCatalog(
      await this.#catalog(),
      state.installations.map(({ id, kind, sourceKey, version }) => ({ id, kind, sourceKey, version })),
    )
    const cards = await Promise.all(
      groups.map(async (group) => {
        const installed = state.installations.find(
          (record) => record.id === group.identity.id && record.kind === group.identity.kind,
        )
        const grant = installed
          ? state.executionGrants.find(
              (record) =>
                identityKey(record.identity) === identityKey(installed) && record.sourceKey === installed.sourceKey,
            )
          : undefined
        const preference = installed
          ? state.runtimePreferences.find(
              (record) =>
                identityKey(record.identity) === identityKey(installed) && record.sourceKey === installed.sourceKey,
            )
          : undefined
        const grantValid =
          installed && grant
            ? await this.#options.installer
                .verifyAuthorization(installed, grant.authorizationContractDigest)
                .catch(() => false)
            : false
        return {
          description: group.representative.presentation.description ?? "",
          id: group.identity.id,
          ...(installed
            ? {
                installed: {
                  sourceLabel:
                    group.sources.find((source) => source.sourceKey === installed.sourceKey)?.marketplaceId ??
                    "Unavailable source",
                  state: projectInstalledCapability({
                    executionGrant: grant,
                    grantValid,
                    installRecord: installed,
                    runtimePreference: preference,
                  }).state,
                  version: installed.version,
                },
              }
            : {}),
          kind: group.identity.kind,
          name: group.representative.presentation.name,
          otherSourceCount: group.sources.length - 1,
          ...(group.representative.kind === "skill"
            ? {}
            : { runtimeScope: runtimeSurface(group.representative) as "agent" | "agent-and-convax" }),
        }
      }),
    )
    return {
      cards: [
        ...cards,
        ...(this.#options.reservedBuiltinIdentities ?? [])
          .filter((reservation) => !groups.some((group) => identityKey(group.identity) === identityKey(reservation)))
          .map((reservation) => ({
            description: "Built-in extension is temporarily unavailable.",
            id: reservation.id,
            kind: reservation.kind,
            name: reservation.id,
            otherSourceCount: 0,
          })),
      ],
      revision: this.#revision,
    }
  }

  async listInstalled(): Promise<MarketplaceInventory> {
    const state = await this.#options.state.read()
    const catalog = await this.#catalog()
    return {
      capabilities: await Promise.all(
        state.installations.map(async (record) => {
          const sourceItem = catalog.find(
            (candidate) =>
              candidate.kind === record.kind &&
              candidate.id === record.id &&
              candidate.sourceKey === record.sourceKey,
          )
          const grant = state.executionGrants.find(
            (candidate) =>
              identityKey(candidate.identity) === identityKey(record) && candidate.sourceKey === record.sourceKey,
          )
          const preference = state.runtimePreferences.find(
            (candidate) =>
              identityKey(candidate.identity) === identityKey(record) && candidate.sourceKey === record.sourceKey,
          )
          const projected = projectInstalledCapability({
            executionGrant: grant,
            grantValid:
              grant !== undefined &&
              (await this.#options.installer
                .verifyAuthorization(record, grant.authorizationContractDigest)
                .catch(() => false)),
            installRecord: record,
            runtimePreference: preference,
          })
          return {
            ...(projected.attention ? { attention: projected.attention } : {}),
            id: record.id,
            kind: record.kind,
            name: sourceItem?.presentation.name ?? record.id,
            ...(record.runtimeSurface === "none" ? {} : { runtimeScope: record.runtimeSurface }),
            sourceLabel: sourceItem?.marketplaceId ?? "Unavailable source",
            state: projected.state,
            updateAvailable: catalog.some(
              (candidate) =>
                candidate.kind === record.kind &&
                candidate.id === record.id &&
                candidate.sourceKey === record.sourceKey &&
                (candidate.version !== record.version ||
                  sha256Hex(canonicalJson(candidate.delivery)) !== record.artifactDigest),
            ),
            version: record.version,
          } satisfies MarketplaceInstalledCapability
        }),
      ),
      revision: state.revision,
    }
  }

  async beginInstall(
    identity: {
      id: string
      kind: MarketplaceCapabilityKind
    },
    senderId: string,
  ): Promise<MarketplaceCatalogSourceChoice[]> {
    const installed = (await this.#options.state.read()).installations.find(
      (record) => identityKey(record) === identityKey(identity),
    )
    const candidates = (await this.#catalog()).filter(
      (candidate) =>
        candidate.kind === identity.kind &&
        candidate.id === identity.id &&
        (!installed || candidate.sourceKey === installed.sourceKey),
    )
    return this.#sourceChoices(candidates, senderId, this.#confirmationSecret)
  }

  async beginUpdate(
    identity: {
      id: string
      kind: MarketplaceCapabilityKind
    },
    senderId: string,
  ): Promise<MarketplaceCatalogSourceChoice[]> {
    const installed = (await this.#options.state.read()).installations.find(
      (record) => identityKey(record) === identityKey(identity),
    )
    if (!installed) throw new Error("Installed capability was not found")
    const candidates = (await this.#catalog()).filter(
      (candidate) =>
        candidate.kind === installed.kind &&
        candidate.id === installed.id &&
        candidate.sourceKey === installed.sourceKey &&
        (candidate.version !== installed.version ||
          sha256Hex(canonicalJson(candidate.delivery)) !== installed.artifactDigest),
    )
    return this.#sourceChoices(candidates, senderId, this.#updateConfirmationSecret)
  }

  #sourceChoices(
    candidates: readonly SourceQualifiedItem[],
    senderId: string,
    secret: Uint8Array,
  ): MarketplaceCatalogSourceChoice[] {
    return candidates.map((candidate) => {
      const metadataDigest = sha256Hex(canonicalJson(candidate))
      const artifact =
        candidate.delivery.kind === "artifact"
          ? {
              sha256: candidate.delivery.sha256,
              size: candidate.delivery.size,
              url: candidate.delivery.url,
            }
          : null
      const companion =
        candidate.delivery.kind === "mcp-managed-stdio"
          ? (() => {
              const target = `${process.platform}-${process.arch}`
              const selected = candidate.delivery.companions.find((entry) => entry.target === target)
              return selected ? { sha256: selected.sha256, size: selected.size, target, url: selected.url } : null
            })()
          : null
      const confirmationToken = issueSelectionToken(
        {
          artifact,
          catalogRevision: candidate.catalogRevision,
          catalogSequence: candidate.catalogSequence,
          companion,
          expiresAt: Date.now() + 5 * 60_000,
          metadataDigest,
          ref: { id: candidate.id, kind: candidate.kind, marketplaceId: candidate.marketplaceId },
          senderId,
          sourceKey: candidate.sourceKey,
          version: candidate.version,
        },
        secret,
      )
      return {
        description: candidate.presentation.description ?? "",
        marketplaceLabel: candidate.marketplaceId,
        name: candidate.presentation.name,
        permissionSummary:
          candidate.kind === "skill"
            ? []
            : candidate.delivery.kind === "mcp-http"
              ? ["Connect this MCP Server to the Agent"]
              : candidate.delivery.kind === "mcp-managed-stdio"
                ? [
                    "Run this MCP Server's local component",
                    "Use its declared tools in the Agent",
                    ...(candidate.runtimeSurface === "agent-and-convax" ? ["Use its declared actions in Convax"] : []),
                  ]
                : [
                    "Run this Plugin's authorized local capabilities",
                    ...(candidate.runtimeSurface === "agent-and-convax"
                      ? ["Use its declared actions in Convax"]
                      : ["Use its declared capabilities in the Agent"]),
                  ],
        confirmationToken,
        setup:
          candidate.kind === "skill"
            ? "none"
            : candidate.delivery.kind === "mcp-http"
              ? "remote-connection"
              : "local-execution",
        version: candidate.version,
      }
    })
  }

  async confirmInstall(token: string, senderId: string) {
    const selection = verifySelectionToken(
      token as SelectionToken,
      { now: Date.now(), senderId },
      this.#confirmationSecret,
    )
    this.#consumeToken(token)
    await this.#assertCurrentSelection(selection)
    return {
      selectionToken: issueSelectionToken({ ...selection, expiresAt: Date.now() + 5 * 60_000 }, this.#installSecret),
    }
  }

  async confirmUpdate(token: string, senderId: string) {
    const selection = verifySelectionToken(
      token as SelectionToken,
      { now: Date.now(), senderId },
      this.#updateConfirmationSecret,
    )
    this.#consumeToken(token)
    const candidate = await this.#assertCurrentSelection(selection)
    const installed = (await this.#options.state.read()).installations.find(
      (record) => identityKey(record) === identityKey(candidate),
    )
    if (!installed || installed.sourceKey !== candidate.sourceKey) {
      throw new Error("Marketplace update source is stale")
    }
    if (
      installed.version === candidate.version &&
      installed.artifactDigest === sha256Hex(canonicalJson(candidate.delivery))
    ) {
      throw new Error("Marketplace update is stale")
    }
    return {
      selectionToken: issueSelectionToken({ ...selection, expiresAt: Date.now() + 5 * 60_000 }, this.#updateSecret),
    }
  }

  async install(token: string, senderId: string) {
    const selection = verifySelectionToken(token as SelectionToken, { now: Date.now(), senderId }, this.#installSecret)
    this.#consumeToken(token)
    const candidate = await this.#assertCurrentSelection(selection)
    const installed = (await this.#options.state.read()).installations.some(
      (record) => identityKey(record) === identityKey(candidate),
    )
    await this.#installCandidate(candidate, installed ? "update" : "install")
    this.#emit()
    return this.#installed(candidate.kind, candidate.id)
  }

  async #assertCurrentSelection(selection: ReturnType<typeof verifySelectionToken>) {
    const candidate = (await this.#catalog()).find(
      (item) =>
        item.marketplaceId === selection.ref.marketplaceId &&
        item.kind === selection.ref.kind &&
        item.id === selection.ref.id &&
        item.sourceKey === selection.sourceKey &&
        item.version === selection.version,
    )
    if (!candidate) throw new Error("Marketplace selection is stale")
    const metadataDigest = sha256Hex(canonicalJson(candidate))
    const artifact =
      candidate.delivery.kind === "artifact"
        ? { sha256: candidate.delivery.sha256, size: candidate.delivery.size, url: candidate.delivery.url }
        : null
    const companion =
      candidate.delivery.kind === "mcp-managed-stdio"
        ? (() => {
            const target = `${process.platform}-${process.arch}`
            const selected = candidate.delivery.companions.find((entry) => entry.target === target)
            return selected ? { sha256: selected.sha256, size: selected.size, target, url: selected.url } : null
          })()
        : null
    assertSelectionCurrent(selection, {
      artifact,
      catalogRevision: candidate.catalogRevision,
      catalogSequence: candidate.catalogSequence,
      companion,
      metadataDigest,
      sourceKey: candidate.sourceKey,
      version: candidate.version,
    })
    return candidate
  }

  async #installCandidate(candidate: SourceQualifiedItem, mutation: "install" | "update") {
    await this.#assertSourcePreflight(candidate)
    const prepared = await this.#prepareCandidate(candidate)
    const result = await this.#options.mutations.withMutation({ identity: candidate, mutation }, async () => {
      await this.#assertCandidateCurrent(candidate)
      await this.#assertSourcePreflight(candidate)
      const transitionId = randomUUID()
      const before = await this.#options.state.read()
      if (before.transitions.some((entry) => identityKey(entry.identity) === identityKey(candidate))) {
        throw new Error("Capability recovery is required")
      }
      const previous = before.installations.find((entry) => identityKey(entry) === identityKey(candidate)) ?? null
      const next = installRecordFor(candidate, previous ?? undefined)
      await this.#options.state.update((draft) => {
        if (draft.transitions.some((entry) => identityKey(entry.identity) === identityKey(candidate))) {
          throw new Error("Capability recovery is required")
        }
        draft.transitions.push({
          decision: "pending",
          id: transitionId,
          identity: { id: candidate.id, kind: candidate.kind },
          mutation,
          next,
          owner: transitionOwner(candidate),
          participants: [
            {
              digest: capabilityTransitionParticipantDigest({
                next,
                participant: "install-record",
                previous,
              }),
              next,
              participant: "install-record",
              previous,
              state: "pending",
            },
          ],
          phase: "prepare",
          previous,
          revision: 1,
        })
      })
      try {
        await this.#advanceTransition(transitionId, "publish")
        let publishedAuthorizationContractDigest: string | undefined
        const authorizedUpdate =
          mutation === "update" &&
          before.executionGrants.some(
            (grant) =>
              identityKey(grant.identity) === identityKey(candidate) && grant.sourceKey === candidate.sourceKey,
          )
        let preparedMcpCandidate = false
        if (prepared.kind === "local") {
          const publication = await this.#options.installer.installLocal(prepared.item, prepared.snapshotDirectory, {
            authorizeExecution: authorizedUpdate,
          })
          publishedAuthorizationContractDigest = publication.authorizationContractDigest
        } else if (prepared.kind === "artifact") {
          const publication = await this.#options.installer.installArtifact(candidate, prepared.prepared, {
            authorizeExecution: authorizedUpdate,
          })
          publishedAuthorizationContractDigest = publication.authorizationContractDigest
        } else if (prepared.kind === "builtin") {
          await this.#options.installer.installBuiltin(candidate, prepared.bytes)
        } else {
          const publication = await this.#options.installer.installMcpMetadata(candidate, prepared.companion, {
            asCandidate: authorizedUpdate,
          })
          publishedAuthorizationContractDigest = publication.authorizationContractDigest
          preparedMcpCandidate = authorizedUpdate
        }
        if (preparedMcpCandidate) {
          await this.#options.installer.commitMcpCandidate(candidate)
        }
        await this.#options.state.update((draft) => {
          const transition = draft.transitions.find((entry) => entry.id === transitionId)
          if (!transition) throw new Error("Capability transition disappeared before decision")
          const current = draft.installations.find((entry) => identityKey(entry) === identityKey(candidate))
          if (current && current.sourceKey !== candidate.sourceKey) throw new Error("Installed source cannot change")
          draft.installations = draft.installations.filter((entry) => identityKey(entry) !== identityKey(candidate))
          draft.installations.push(next)
          const previousGrant = draft.executionGrants.find(
            (entry) => identityKey(entry.identity) === identityKey(candidate),
          )
          draft.executionGrants = draft.executionGrants.filter(
            (entry) => identityKey(entry.identity) !== identityKey(candidate),
          )
          if (publishedAuthorizationContractDigest) {
            const nextGrant = {
              authorizationContractDigest: publishedAuthorizationContractDigest,
              identity: { id: candidate.id, kind: candidate.kind },
              revision: (previousGrant?.revision ?? 0) + 1,
              sourceKey: candidate.sourceKey,
            } as const
            draft.executionGrants.push(nextGrant)
            transition.participants.push({
              digest: capabilityTransitionParticipantDigest({
                next: nextGrant,
                participant: "execution-grant",
                previous: previousGrant ?? null,
              }),
              next: nextGrant,
              participant: "execution-grant",
              previous: previousGrant ?? null,
              state: "published",
            })
          }
          transition.decision = "next"
          transition.phase = "decide"
          transition.participants[0]!.state = "published"
          transition.revision += 1
        })
        await this.#convergeTransition(transitionId)
        return {
          authorizationContractDigest: publishedAuthorizationContractDigest,
          record: next,
        }
      } catch (error) {
        if (candidate.kind === "mcp-server") {
          await this.#options.installer.discardMcpCandidate(candidate).catch(() => undefined)
        }
        await this.#options.state
          .update((draft) => {
            const transition = draft.transitions.find((entry) => entry.id === transitionId)
            if (transition) {
              if (error && typeof error === "object" && "committedRecord" in error) {
                draft.installations = draft.installations.filter(
                  (entry) => identityKey(entry) !== identityKey(candidate),
                )
                draft.installations.push(next)
                draft.executionGrants = draft.executionGrants.filter(
                  (entry) => identityKey(entry.identity) !== identityKey(candidate),
                )
                transition.decision = "next"
                transition.participants[0]!.state = "published"
              }
              transition.phase = "recovery-required"
              transition.revision += 1
            }
          })
          .catch(() => undefined)
        throw error
      }
    })
    this.#emit()
    if (result.authorizationContractDigest) {
      await this.#options.installer.activate(result.record, result.authorizationContractDigest)
    }
    try {
      await this.#options.installer.hardRefresh(candidate)
    } catch (error) {
      throw new MarketplacePostCommitRefreshError(candidate, error)
    }
    return result
  }

  async importDirectory(directory: string) {
    const local = this.#options.local
    if (!local) throw new Error("Local Marketplace is unavailable")
    const imported = await local.importDirectory(directory)
    const item = (await this.#catalog()).find(
      (candidate) =>
        candidate.sourceKind === "local" &&
        candidate.kind === imported.kind &&
        candidate.id === imported.id &&
        candidate.version === imported.version,
    )!
    const installed = (await this.#options.state.read()).installations.some(
      (record) => identityKey(record) === identityKey(item),
    )
    await this.#installCandidate(item, installed ? "update" : "install")
    this.#emit()
    return this.#installed(imported.kind, imported.id)
  }

  async #prepareCandidate(candidate: SourceQualifiedItem): Promise<
    | {
        kind: "artifact"
        prepared: { artifactBytes: Uint8Array; companionBytes: Readonly<Record<string, Uint8Array>> }
      }
    | { kind: "builtin"; bytes: Uint8Array }
    | { kind: "local"; item: LocalMarketplacePackage; snapshotDirectory: string }
    | { kind: "mcp"; companion?: { bytes: Uint8Array; sha256: string; size: number } }
  > {
    if (candidate.sourceKind === "local") {
      const store = this.#options.local
      if (!store) throw new Error("Local Marketplace is unavailable")
      const local = (await store.list()).packages.find(
        (item) =>
          item.kind === candidate.kind &&
          item.id === candidate.id &&
          item.version === candidate.version &&
          (candidate.delivery.kind !== "artifact" || item.digest === candidate.delivery.sha256),
      )
      if (!local) throw new Error("Local Marketplace snapshot is unavailable")
      if (candidate.kind === "mcp-server") return { kind: "mcp" }
      return {
        item: local,
        kind: "local",
        snapshotDirectory: store.resolveSnapshotDirectory(local),
      }
    }
    if (candidate.delivery.kind === "builtin-artifact") {
      const bytes = await this.#options.readFixedArtifact(candidate)
      if (bytes.byteLength !== candidate.delivery.size || sha256Hex(bytes) !== candidate.delivery.sha256) {
        throw new Error("Builtin Marketplace artifact did not match its immutable identity")
      }
      return { bytes, kind: "builtin" }
    }
    if (candidate.delivery.kind === "artifact") {
      const fixed = await this.#options.prepareFixedArtifact?.(candidate)
      if (fixed) return { kind: "artifact", prepared: fixed }
      const repository = await this.#options.repositoryAuthority(candidate)
      const bytes = await this.#options.networkFetch.fetch(candidate.delivery.url, "release", {
        maxBytes: candidate.delivery.size,
        repository,
      })
      if (bytes.byteLength !== candidate.delivery.size || sha256Hex(bytes) !== candidate.delivery.sha256) {
        throw new Error("Marketplace artifact did not match its immutable identity")
      }
      return {
        kind: "artifact",
        prepared: await this.#options.installer.prepareArtifact(candidate, bytes),
      }
    }
    if (candidate.delivery.kind === "mcp-managed-stdio") {
      const target = `${process.platform}-${process.arch}`
      const selected = candidate.delivery.companions.find((entry) => entry.target === target)
      if (!selected) throw new Error("Managed MCP Server has no companion for this platform")
      const repository = await this.#options.repositoryAuthority(candidate)
      const bytes = await this.#options.networkFetch.fetch(selected.url, "release", {
        maxBytes: selected.size,
        repository,
      })
      if (bytes.byteLength !== selected.size || sha256Hex(bytes) !== selected.sha256) {
        throw new Error("Managed MCP companion did not match its immutable identity")
      }
      return {
        companion: { bytes, sha256: selected.sha256, size: selected.size },
        kind: "mcp",
      }
    }
    return { kind: "mcp" }
  }

  async #assertCandidateCurrent(candidate: SourceQualifiedItem) {
    const current = (await this.#catalog()).find(
      (entry) =>
        entry.kind === candidate.kind &&
        entry.id === candidate.id &&
        entry.sourceKey === candidate.sourceKey &&
        entry.version === candidate.version,
    )
    if (!current || canonicalJson(current) !== canonicalJson(candidate)) {
      throw new Error("Marketplace candidate changed while its bytes were being prepared")
    }
  }

  async #advanceTransition(id: string, phase: "publish") {
    await this.#options.state.update((draft) => {
      const transition = draft.transitions.find((entry) => entry.id === id)
      if (!transition || transition.decision !== "pending" || transition.phase !== "prepare") {
        throw new Error("Capability transition cannot advance to publish")
      }
      transition.phase = phase
      transition.revision += 1
    })
  }

  async #convergeTransition(id: string) {
    await this.#options.state.update((draft) => {
      const transition = draft.transitions.find((entry) => entry.id === id)
      if (!transition || transition.decision === "pending") {
        throw new Error("Capability transition cannot converge before its owner decision")
      }
      transition.phase = "converge"
      for (const participant of transition.participants) participant.state = "converged"
      transition.revision += 1
    })
    await this.#options.state.update((draft) => {
      draft.transitions = draft.transitions.filter((entry) => entry.id !== id)
    })
  }

  async setup(identity: { id: string; kind: MarketplaceCapabilityKind }, pickExecutable: () => Promise<string | null>) {
    return this.#setup(identity, pickExecutable, "explicit")
  }

  async #setup(
    identity: { id: string; kind: MarketplaceCapabilityKind },
    pickExecutable: () => Promise<string | null>,
    mode: MarketplacePluginSetupMode,
  ) {
    const before = await this.#options.state.read()
    const beforeRecord = before.installations.find((candidate) => identityKey(candidate) === identityKey(identity))
    if (!beforeRecord) throw new Error("Installed capability was not found")
    const prepared = await this.#options.installer.prepareSetup(beforeRecord, pickExecutable)
    const committedGrant: {
      value?: { authorizationContractDigest: string; record: InstallRecord }
    } = {}
    await this.#options.mutations.withMutation({ identity, mutation: "setup" }, async () => {
      const state = await this.#options.state.read()
      const record = state.installations.find((candidate) => identityKey(candidate) === identityKey(identity))
      if (!record) throw new Error("Installed capability was not found")
      if (canonicalJson(record) !== canonicalJson(beforeRecord))
        throw new Error("Installed capability changed during setup")
      const transitionId = randomUUID()
      await this.#options.state.update((draft) => {
        if (draft.transitions.some((entry) => identityKey(entry.identity) === identityKey(identity))) {
          throw new Error("Capability recovery is required")
        }
        draft.transitions.push({
          decision: "pending",
          id: transitionId,
          identity,
          mutation: "setup",
          next: record,
          owner: "execution-grant",
          participants: [
            {
              digest: capabilityTransitionParticipantDigest({
                next: null,
                participant: "execution-grant",
                previous:
                  state.executionGrants.find(
                    (candidate) => identityKey(candidate.identity) === identityKey(identity),
                  ) ?? null,
              }),
              next: null,
              participant: "execution-grant",
              previous:
                state.executionGrants.find((candidate) => identityKey(candidate.identity) === identityKey(identity)) ??
                null,
              state: "pending",
            },
          ],
          phase: "prepare",
          previous: record,
          revision: 1,
        })
      })
      try {
        await this.#advanceTransition(transitionId, "publish")
        const grant = await this.#options.installer.setup(record, prepared, { mode })
        await this.#options.state.update((draft) => {
          const transition = draft.transitions.find((entry) => entry.id === transitionId)
          if (!transition) throw new Error("Capability setup transition disappeared")
          if (grant) {
            const previousGrant = draft.executionGrants.find(
              (candidate) => identityKey(candidate.identity) === identityKey(identity),
            )
            draft.executionGrants = draft.executionGrants.filter(
              (candidate) => identityKey(candidate.identity) !== identityKey(identity),
            )
            draft.executionGrants.push({
              authorizationContractDigest: grant.authorizationContractDigest,
              identity,
              revision: (previousGrant?.revision ?? 0) + 1,
              sourceKey: record.sourceKey,
            })
            const nextGrant = draft.executionGrants.find(
              (candidate) => identityKey(candidate.identity) === identityKey(identity),
            )!
            const participant = transition.participants[0]
            if (participant?.participant === "execution-grant") {
              participant.next = nextGrant
              participant.digest = capabilityTransitionParticipantDigest(participant)
            }
            transition.decision = "next"
            committedGrant.value = {
              authorizationContractDigest: grant.authorizationContractDigest,
              record,
            }
          } else {
            transition.decision = "previous"
          }
          transition.phase = "decide"
          transition.participants[0]!.state = grant ? "published" : "converged"
          transition.revision += 1
        })
        await this.#convergeTransition(transitionId)
      } catch (error) {
        await this.#markRecoveryRequired(transitionId)
        throw error
      }
    })
    this.#emit()
    if (committedGrant.value) {
      await this.#options.installer.activate(
        committedGrant.value.record,
        committedGrant.value.authorizationContractDigest,
      )
    }
    try {
      await this.#options.installer.hardRefresh(identity)
    } catch (error) {
      throw new MarketplacePostCommitRefreshError(identity, error)
    }
    this.#emit()
    return this.#installed(identity.kind, identity.id)
  }

  async update(token: string, senderId: string): Promise<MarketplaceInstalledCapability> {
    const selection = verifySelectionToken(token as SelectionToken, { now: Date.now(), senderId }, this.#updateSecret)
    this.#consumeToken(token)
    const candidate = await this.#assertCurrentSelection(selection)
    const installed = (await this.#options.state.read()).installations.find(
      (record) => identityKey(record) === identityKey(candidate),
    )
    if (!installed || installed.sourceKey !== candidate.sourceKey) {
      throw new Error("Marketplace update source is stale")
    }
    if (
      installed.version === candidate.version &&
      installed.artifactDigest === sha256Hex(canonicalJson(candidate.delivery))
    ) {
      throw new Error("Marketplace update is stale")
    }
    await this.#installCandidate(candidate, "update")
    this.#emit()
    return this.#installed(candidate.kind, candidate.id)
  }

  #consumeToken(token: string) {
    if (this.#consumedTokens.has(token)) throw new Error("Marketplace selection token was already used")
    this.#consumedTokens.add(token)
    if (this.#consumedTokens.size > 1_024) {
      const oldest = this.#consumedTokens.values().next().value
      if (oldest) this.#consumedTokens.delete(oldest)
    }
  }

  async uninstall(identity: { id: string; kind: MarketplaceCapabilityKind }) {
    await this.#options.mutations.withMutation({ identity, mutation: "uninstall" }, async () => {
      const state = await this.#options.state.read()
      const record = state.installations.find((entry) => identityKey(entry) === identityKey(identity))
      if (!record) return
      const transitionId = randomUUID()
      await this.#options.state.update((draft) => {
        if (draft.transitions.some((entry) => identityKey(entry.identity) === identityKey(identity))) {
          throw new Error("Capability recovery is required")
        }
        draft.transitions.push({
          decision: "pending",
          id: transitionId,
          identity,
          mutation: "uninstall",
          next: null,
          owner: transitionOwner(record),
          participants: [
            {
              digest: capabilityTransitionParticipantDigest({
                next: null,
                participant: "install-record",
                previous: record,
              }),
              next: null,
              participant: "install-record",
              previous: record,
              state: "pending",
            },
          ],
          phase: "prepare",
          previous: record,
          revision: 1,
        })
      })
      try {
        await this.#advanceTransition(transitionId, "publish")
        await this.#options.installer.uninstall(identity)
        await this.#options.state.update((draft) => {
          const transition = draft.transitions.find((entry) => entry.id === transitionId)
          if (!transition) throw new Error("Capability uninstall transition disappeared")
          draft.installations = draft.installations.filter((entry) => identityKey(entry) !== identityKey(identity))
          draft.executionGrants = draft.executionGrants.filter(
            (entry) => identityKey(entry.identity) !== identityKey(identity),
          )
          draft.runtimePreferences = draft.runtimePreferences.filter(
            (entry) => identityKey(entry.identity) !== identityKey(identity),
          )
          const policy = this.#options.preinstalledPolicy?.(record)
          if (policy) {
            const previousDecision = draft.provisioningDecisions.find(
              (entry) =>
                identityKey(entry.identity) === identityKey(identity) && entry.marketplaceId === policy.marketplaceId,
            )
            draft.provisioningDecisions = draft.provisioningDecisions.filter(
              (entry) =>
                !(
                  identityKey(entry.identity) === identityKey(identity) && entry.marketplaceId === policy.marketplaceId
                ),
            )
            draft.provisioningDecisions.push({
              decision: "removed-by-user",
              identity,
              marketplaceId: policy.marketplaceId,
              observedPolicyRevision: policy.observedPolicyRevision,
              policyEntryDigest: policy.policyEntryDigest,
              revision: (previousDecision?.revision ?? 0) + 1,
              sourceKey: record.sourceKey,
            })
          }
          transition.decision = "next"
          transition.phase = "decide"
          transition.participants[0]!.state = "published"
          transition.revision += 1
        })
        await this.#convergeTransition(transitionId)
      } catch (error) {
        await this.#markRecoveryRequired(transitionId)
        throw error
      }
    })
    this.#emit()
    try {
      await this.#options.installer.hardRefresh(identity)
    } catch (error) {
      throw new MarketplacePostCommitRefreshError(identity, error)
    }
    this.#emit()
  }

  async disable(identity: { id: string; kind: MarketplaceCapabilityKind }) {
    await this.#mutatePreference(identity, "disabled")
  }

  async enable(identity: { id: string; kind: MarketplaceCapabilityKind }) {
    await this.#mutatePreference(identity, "enabled")
  }

  async previewMarketplace(url: string, senderId: string) {
    const preview = await this.#options.network.preview(url, senderId)
    return {
      label: preview.descriptor.name,
      packageCount: preview.packageCount,
      previewToken: preview.previewToken,
      publisher: preview.descriptor.publisher.name,
      repository: `${preview.descriptor.repository.owner}/${preview.descriptor.repository.name}`,
    }
  }

  addMarketplace(previewToken: string, senderId: string) {
    return this.#options.network.add(previewToken, senderId)
  }

  async refreshMarketplace(id: string) {
    if (await this.#options.refreshFixedSource?.(id)) {
      this.#emit()
      return
    }
    await this.#options.network.refresh(id)
  }

  removeMarketplace(id: string) {
    return this.#options.network.remove(id)
  }

  async listMarketplaces() {
    const [fixed, network] = await Promise.all([
      this.#options.fixedSources(),
      this.#options.network.listSourceStatuses(),
    ])
    return [
      ...fixed.filter((source) => source.id === "convax-official"),
      ...network.map(
        (source): MarketplaceSettingsSource => ({
          health: source.health,
          id: source.descriptor.id,
          label: source.descriptor.name,
          packageCount: source.packageCount,
          publisher: source.descriptor.publisher.name,
          removable: true,
          repository: `${source.descriptor.repository.owner}/${source.descriptor.repository.name}`,
        }),
      ),
    ]
  }

  async #assertSourcePreflight(item: SourceQualifiedItem) {
    const state = await this.#options.state.read()
    const installed = state.installations.find((record) => identityKey(record) === identityKey(item))
    const outcome = resolveInstallConflict(
      installed && {
        id: installed.id,
        kind: installed.kind,
        sourceKey: installed.sourceKey,
        version: installed.version,
      },
      item,
    )
    if (outcome === "source-conflict") throw new Error("Installed source cannot change")
  }

  async #mutatePreference(identity: { id: string; kind: MarketplaceCapabilityKind }, desired: "disabled" | "enabled") {
    await this.#options.mutations.withMutation(
      { identity, mutation: desired === "enabled" ? "enable" : "disable" },
      async () => {
        const state = await this.#options.state.read()
        const installed = state.installations.find((record) => identityKey(record) === identityKey(identity))
        if (!installed || installed.runtimeSurface === "none") throw new Error("Capability has no runtime preference")
        if (
          desired === "enabled" &&
          !state.executionGrants.some(
            (grant) => identityKey(grant.identity) === identityKey(identity) && grant.sourceKey === installed.sourceKey,
          )
        )
          throw new Error("Capability setup is not valid")
        const grant = state.executionGrants.find(
          (candidate) =>
            identityKey(candidate.identity) === identityKey(identity) && candidate.sourceKey === installed.sourceKey,
        )
        if (
          desired === "enabled" &&
          (!grant ||
            !(await this.#options.installer
              .verifyAuthorization(installed, grant.authorizationContractDigest)
              .catch(() => false)))
        )
          throw new Error("Capability authorization is no longer valid")
        const transitionId = randomUUID()
        const previousPreference =
          state.runtimePreferences.find((record) => identityKey(record.identity) === identityKey(identity)) ?? null
        const nextPreference = {
          desired,
          identity,
          revision: (previousPreference?.revision ?? 0) + 1,
          sourceKey: installed.sourceKey,
        } as const
        await this.#options.state.update((draft) => {
          if (draft.transitions.some((entry) => identityKey(entry.identity) === identityKey(identity))) {
            throw new Error("Capability recovery is required")
          }
          draft.transitions.push({
            decision: "pending",
            id: transitionId,
            identity,
            mutation: desired === "enabled" ? "enable" : "disable",
            next: installed,
            owner: "runtime-preference",
            participants: [
              {
                digest: capabilityTransitionParticipantDigest({
                  next: nextPreference,
                  participant: "runtime-preference",
                  previous: previousPreference,
                }),
                next: nextPreference,
                participant: "runtime-preference",
                previous: previousPreference,
                state: "pending",
              },
            ],
            phase: "prepare",
            previous: installed,
            revision: 1,
          })
        })
        try {
          await this.#advanceTransition(transitionId, "publish")
          if (desired === "enabled") await this.#options.installer.enable(identity)
          else await this.#options.installer.disable(identity)
          await this.#options.state.update((draft) => {
            const transition = draft.transitions.find((entry) => entry.id === transitionId)
            if (!transition) throw new Error("Runtime preference transition disappeared")
            draft.runtimePreferences = draft.runtimePreferences.filter(
              (record) => identityKey(record.identity) !== identityKey(identity),
            )
            draft.runtimePreferences.push(nextPreference)
            transition.decision = "next"
            transition.phase = "decide"
            transition.participants[0]!.state = "published"
            transition.revision += 1
          })
          await this.#convergeTransition(transitionId)
        } catch (error) {
          await this.#markRecoveryRequired(transitionId)
          throw error
        }
      },
    )
    this.#emit()
    if (desired === "enabled") {
      const state = await this.#options.state.read()
      const installed = state.installations.find((record) => identityKey(record) === identityKey(identity))
      const grant = state.executionGrants.find(
        (candidate) =>
          identityKey(candidate.identity) === identityKey(identity) && candidate.sourceKey === installed?.sourceKey,
      )
      if (!installed || !grant) throw new Error("Capability activation state is unavailable")
      await this.#options.installer.activate(installed, grant.authorizationContractDigest)
    }
    try {
      await this.#options.installer.hardRefresh(identity)
    } catch (error) {
      throw new MarketplacePostCommitRefreshError(identity, error)
    }
  }

  async #markRecoveryRequired(id: string) {
    await this.#options.state
      .update((draft) => {
        const transition = draft.transitions.find((entry) => entry.id === id)
        if (transition) {
          transition.phase = "recovery-required"
          transition.revision += 1
        }
      })
      .catch(() => undefined)
  }

  async recoverTransitions() {
    const transitions = (await this.#options.state.read()).transitions
    for (const pending of transitions) {
      await this.#options.mutations.withMutation(
        { identity: pending.identity, mutation: pending.mutation },
        async () => {
          const current = (await this.#options.state.read()).transitions.find((entry) => entry.id === pending.id)
          if (!current) return
          const decision =
            current.decision === "pending" ? await this.#options.installer.resolveTransition(current) : current.decision
          if (decision === "unknown") {
            await this.#markRecoveryRequired(current.id)
            return
          }
          await this.#options.state.update((draft) => {
            const transition = draft.transitions.find((entry) => entry.id === current.id)
            if (!transition) return
            transition.decision = decision
            transition.phase = "decide"
            transition.revision += 1
            const selected = decision === "next" ? transition.next : transition.previous
            draft.installations = draft.installations.filter(
              (record) => identityKey(record) !== identityKey(transition.identity),
            )
            if (selected) draft.installations.push(selected)
            for (const participant of transition.participants) {
              if (participant.participant === "execution-grant") {
                const participantRecord = decision === "next" ? participant.next : participant.previous
                draft.executionGrants = draft.executionGrants.filter(
                  (record) => identityKey(record.identity) !== identityKey(transition.identity),
                )
                if (participantRecord) draft.executionGrants.push(participantRecord)
              } else if (participant.participant === "runtime-preference") {
                const participantRecord = decision === "next" ? participant.next : participant.previous
                draft.runtimePreferences = draft.runtimePreferences.filter(
                  (record) => identityKey(record.identity) !== identityKey(transition.identity),
                )
                if (participantRecord) draft.runtimePreferences.push(participantRecord)
              }
            }
            if (!selected || selected.runtimeSurface === "none") {
              draft.executionGrants = draft.executionGrants.filter(
                (record) => identityKey(record.identity) !== identityKey(transition.identity),
              )
              draft.runtimePreferences = draft.runtimePreferences.filter(
                (record) => identityKey(record.identity) !== identityKey(transition.identity),
              )
            }
          })
          await this.#convergeTransition(current.id)
        },
      )
    }
  }

  async provisionDefaults() {
    const failures: unknown[] = []
    for (const provision of [() => this.provisionBuiltins(), () => this.provisionPreinstalled()]) {
      try {
        await provision()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Marketplace default provisioning failed")
    }
  }

  async provisionBuiltins() {
    const failures: unknown[] = []
    const builtins = (await this.#options.fixedCatalog()).filter((item) => item.sourceKind === "builtin")
    for (const item of builtins) {
      try {
        const state = await this.#options.state.read()
        if (state.installations.some((entry) => identityKey(entry) === identityKey(item))) continue
        await this.#installCandidate(item, "install")
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Builtin Marketplace provisioning failed")
    }
  }

  async provisionPreinstalled() {
    if (
      (this.#options.platform ?? process.platform) !== "darwin" ||
      (this.#options.arch ?? process.arch) !== "arm64" ||
      !this.#options.preinstalledPolicy
    )
      return
    const failures: unknown[] = []
    for (const item of await this.#catalog()) {
      try {
        const policy = this.#options.preinstalledPolicy(item)
        if (!policy || item.marketplaceId !== policy.marketplaceId) continue
        const state = await this.#options.state.read()
        if (
          state.provisioningDecisions.some(
            (entry) =>
              identityKey(entry.identity) === identityKey(item) &&
              entry.marketplaceId === policy.marketplaceId &&
              entry.sourceKey === item.sourceKey,
          )
        )
          continue
        const installed = state.installations.find((entry) => identityKey(entry) === identityKey(item))
        if (!installed) {
          await this.#installCandidate(item, "install")
        } else if (installed.sourceKey !== item.sourceKey || installed.version !== item.version) {
          continue
        }
        if (policy.setup === "automatic") await this.#ensureAutomaticProductLockSetup(item)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Official Marketplace preinstall provisioning failed")
    }
  }

  async #ensureAutomaticProductLockSetup(item: SourceQualifiedItem) {
    const state = await this.#options.state.read()
    const record = state.installations.find(
      (entry) =>
        identityKey(entry) === identityKey(item) &&
        entry.sourceKey === item.sourceKey &&
        entry.version === item.version,
    )
    if (!record) throw new Error("Automatic product-lock setup requires the exact installed capability")
    const grant = state.executionGrants.find(
      (entry) => identityKey(entry.identity) === identityKey(item) && entry.sourceKey === item.sourceKey,
    )
    if (grant && (await this.#options.installer.verifyAuthorization(record, grant.authorizationContractDigest))) return
    await this.#setup({ id: item.id, kind: item.kind }, async () => null, "automatic-product-lock")
  }

  async #installed(kind: MarketplaceCapabilityKind, id: string) {
    const item = (await this.listInstalled()).capabilities.find(
      (candidate) => candidate.kind === kind && candidate.id === id,
    )
    if (!item) throw new Error("Installed capability projection is unavailable")
    return item
  }

  #emit() {
    this.#revision += 1
    for (const listener of this.#listeners) listener()
  }
}

export class MarketplacePostCommitRefreshError extends Error {
  readonly committedIdentity: { id: string; kind: MarketplaceCapabilityKind }
  override readonly name = "MarketplacePostCommitRefreshError"

  constructor(identity: { id: string; kind: MarketplaceCapabilityKind }, cause: unknown) {
    super("Capability change committed, but the Agent refresh requires recovery", { cause })
    this.committedIdentity = { id: identity.id, kind: identity.kind }
  }
}
