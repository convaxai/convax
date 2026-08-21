import { canonicalJson, sha256Hex } from "@convax/marketplace"

import { randomUUID } from "node:crypto"
import {
  capabilityTransitionParticipantDigest,
  type FileMarketplaceStateStore,
  type InstallRecord,
} from "./marketplace-state"

export interface MarketplaceInstallationProof {
  authorizationContractDigest?: string
  record: InstallRecord
}

export interface ActivePluginAuthorizationIdentity {
  authorizationContractDigest: string | null
  id: string
  sourceIdentity: string
  version: string
}

export interface MarketplaceLegacyMigrationOptions {
  proveInstallations(): Promise<readonly MarketplaceInstallationProof[]>
  state: FileMarketplaceStateStore
}

function identityKey(value: { id: string; kind: string }) {
  return `${value.kind}\0${value.id}`
}

/**
 * Proves only already source-bound Plugin records against the exact active
 * immutable snapshot. This repairs old missing grants without inventing
 * Marketplace provenance or accepting a stale Plugin generation.
 */
export function proveCurrentPluginExecutionAuthorizations(
  state: { installations: readonly InstallRecord[] },
  active: readonly ActivePluginAuthorizationIdentity[],
): MarketplaceInstallationProof[] {
  const byId = new Map(active.map((plugin) => [plugin.id, plugin]))
  return state.installations.flatMap((record) => {
    if (record.kind !== "plugin") return []
    const plugin = byId.get(record.id)
    if (
      !plugin?.authorizationContractDigest ||
      plugin.version !== record.version ||
      plugin.sourceIdentity !== record.sourceKey
    ) {
      return []
    }
    return [{ authorizationContractDigest: plugin.authorizationContractDigest, record }]
  })
}

/**
 * One bounded Main-owned admission from legacy stores into Marketplace state.
 * The caller supplies only exact-tree/provenance matches; everything else stays
 * legacy-unbound and therefore cannot acquire an executable runtime grant.
 */
export class MarketplaceLegacyMigration {
  readonly #options: MarketplaceLegacyMigrationOptions

  constructor(options: MarketplaceLegacyMigrationOptions) {
    this.#options = options
  }

  async run() {
    const proven = await this.#options.proveInstallations()
    for (const proof of proven) await this.#claim(proof)
  }

  async #claim(proof: MarketplaceInstallationProof) {
    const before = await this.#options.state.read()
    const existing = before.installations.find((record) => identityKey(record) === identityKey(proof.record))
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(proof.record)) {
        // Marketplace state is newer authority than the one-shot legacy
        // inspection. A same-identity mismatch must remain on its current
        // source-bound record; legacy evidence cannot replace it or repair a
        // grant for a different artifact, source, version, or revision.
        return
      }
      if (proof.authorizationContractDigest) {
        await this.#options.state.update((draft) => {
          const current = draft.executionGrants.find(
            (grant) =>
              identityKey(grant.identity) === identityKey(proof.record) && grant.sourceKey === proof.record.sourceKey,
          )
          if (current) {
            if (current.authorizationContractDigest !== proof.authorizationContractDigest) {
              throw new Error("Legacy Marketplace authorization proof conflicts with current grant")
            }
            return
          }
          draft.executionGrants.push({
            authorizationContractDigest: proof.authorizationContractDigest!,
            identity: { id: proof.record.id, kind: proof.record.kind },
            revision: 1,
            sourceKey: proof.record.sourceKey,
          })
        })
      }
      return
    }
    const transitionId = randomUUID()
    await this.#options.state.update((draft) => {
      if (
        draft.installations.some((record) => identityKey(record) === identityKey(proof.record)) ||
        draft.transitions.some((transition) => identityKey(transition.identity) === identityKey(proof.record))
      ) {
        throw new Error("Legacy Marketplace claim changed concurrently")
      }
      draft.transitions.push({
        decision: "pending",
        id: transitionId,
        identity: { id: proof.record.id, kind: proof.record.kind },
        mutation: "install",
        next: proof.record,
        owner: proof.record.kind === "plugin" ? "plugin-package" : "managed-skill",
        participants: [
          {
            digest: capabilityTransitionParticipantDigest({
              next: proof.record,
              participant: "install-record",
              previous: null,
            }),
            next: proof.record,
            participant: "install-record",
            previous: null,
            state: "pending",
          },
        ],
        phase: "prepare",
        previous: null,
        revision: 1,
      })
    })
    await this.#options.state.update((draft) => {
      const transition = draft.transitions.find((entry) => entry.id === transitionId)
      if (!transition || transition.decision !== "pending") {
        throw new Error("Legacy Marketplace claim transition is unavailable")
      }
      draft.installations.push(proof.record)
      if (proof.authorizationContractDigest) {
        draft.executionGrants.push({
          authorizationContractDigest: proof.authorizationContractDigest,
          identity: { id: proof.record.id, kind: proof.record.kind },
          revision: 1,
          sourceKey: proof.record.sourceKey,
        })
      }
      transition.decision = "next"
      transition.phase = "decide"
      transition.participants[0]!.state = "published"
      transition.revision += 1
    })
    await this.#options.state.update((draft) => {
      draft.transitions = draft.transitions.filter((entry) => entry.id !== transitionId)
    })
  }
}

export function legacyInstallRecordDigest(value: unknown) {
  return sha256Hex(canonicalJson(value))
}
