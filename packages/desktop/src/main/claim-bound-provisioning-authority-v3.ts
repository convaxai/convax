import {
  parseCausalAuthorityDependenciesV3,
  parseDigestV2,
  parseDocumentScopeV2,
  verifyLocalOwnerAuthorityV3,
  type DigestV2,
  type Ed25519VerifierPortV2,
  type LocalOwnerSharingStatePortV3,
  type LocalProjectOwnerBindingV3,
  type LocalProjectOwnerSignerAuthorityV3,
} from "@convax/collaboration"
import type { NodeSuccessorProjectIndexBridgeJournalSourceV3 } from "@convax/project/node"

import type { CurrentLocalOwnerAuthoritySourceV3 } from "./local-owner-authority-source-v3"
import type { SuccessorGenesisSignerSourceV3 } from "./successor-new-project-genesis-port-v3"
import type { LocalOwnerPromotionBridgeSourceV3 } from "./successor-collaboration-production-runtime"

export interface ClaimBoundProvisioningAuthoritySourcesV3 {
  readonly localAuthority: CurrentLocalOwnerAuthoritySourceV3
  readonly promotionBridge: LocalOwnerPromotionBridgeSourceV3
  bindProjectIndex(input: Readonly<{ claimDigest: DigestV2; binding: LocalProjectOwnerBindingV3 }>): Promise<void>
  dispose(): void
}

/**
 * Provisioner-private authority. It can resolve only the exact ProjectIndex
 * closure already durably journaled for one claim. It never consults successor
 * owner-file presence as activation and cannot authorize a Canvas or Team writer.
 */
export function createClaimBoundProvisioningAuthoritySourcesV3(input: Readonly<{
  protocolDigest: DigestV2
  journal: Pick<NodeSuccessorProjectIndexBridgeJournalSourceV3, "resolveExact">
  signers: SuccessorGenesisSignerSourceV3
  sharingState: LocalOwnerSharingStatePortV3
  verifier: Ed25519VerifierPortV2
}>): ClaimBoundProvisioningAuthoritySourcesV3 {
  const protocolDigest = parseDigestV2(input.protocolDigest)
  let bound: Readonly<{ claimDigest: DigestV2; binding: LocalProjectOwnerBindingV3 }> | undefined
  let disposed = false

  const localAuthority: CurrentLocalOwnerAuthoritySourceV3 = Object.freeze({
    async resolveCurrent(request: Parameters<CurrentLocalOwnerAuthoritySourceV3["resolveCurrent"]>[0]) {
      if (disposed || !bound) return "pending"
      const scope = parseDocumentScopeV2(request.scope)
      if (scope.docKind !== "project-index" || request.protocolDigest !== protocolDigest ||
        scope.projectId !== bound.binding.core.projectId || scope.projectEpoch !== bound.binding.core.projectEpoch) return "rejected"
      const journal = await input.journal.resolveExact(bound.claimDigest)
      if (typeof journal === "string") return journal === "missing" ? "pending" : "rejected"
      if (journal.ownerBindingCoreDigest !== bound.binding.coreDigest ||
        journal.authorization.core.ownerBindingCoreDigest !== bound.binding.coreDigest ||
        journal.authorization.core.scope.docKind !== "project-index" ||
        journal.authorization.core.ownerSchemaDigest !== request.ownerSchemaDigest ||
        journal.authorization.core.protocolDigest !== protocolDigest ||
        journal.bridge.core.scope.docKind !== "project-index" ||
        journal.bridge.core.successorProtocolDigest !== protocolDigest) return "rejected"
      const authority: LocalProjectOwnerSignerAuthorityV3 = Object.freeze({
        kind: "local-project-owner",
        ownerKeyId: bound.binding.core.ownerKeyId,
        replicaId: bound.binding.core.initialReplicaId,
        actorId: bound.binding.core.initialActorId,
        ownerBindingCoreDigest: bound.binding.coreDigest,
        ownerEditAuthorizationCoreDigest: journal.authorization.coreDigest,
      })
      const verified = await verifyLocalOwnerAuthorityV3({
        authority,
        binding: bound.binding,
        authorization: journal.authorization,
        projectId: scope.projectId,
        projectEpoch: scope.projectEpoch,
        scope,
        ownerSchemaDigest: request.ownerSchemaDigest,
        protocolDigest,
        sharingState: input.sharingState,
        verifier: input.verifier,
      })
      if (verified === "rejected") return "rejected"
      const signer = await input.signers.open({ binding: bound.binding })
      if (typeof signer === "string") return signer === "missing" ? "pending" : "rejected"
      return Object.freeze({
        authority,
        binding: bound.binding,
        authorization: journal.authorization,
        dependencies: parseCausalAuthorityDependenciesV3([
          { kind: "local-owner-binding", digest: bound.binding.coreDigest },
          { kind: "local-owner-edit-authorization", digest: journal.authorization.coreDigest },
        ], authority),
        signer,
      })
    },
  })
  const promotionBridge: LocalOwnerPromotionBridgeSourceV3 = Object.freeze({
    async resolveExact({ scope: scopeInput, protocolDigest: requestedProtocol }: Parameters<LocalOwnerPromotionBridgeSourceV3["resolveExact"]>[0]) {
      if (disposed || !bound) return "missing"
      const scope = parseDocumentScopeV2(scopeInput)
      if (scope.docKind !== "project-index" || requestedProtocol !== protocolDigest ||
        scope.projectId !== bound.binding.core.projectId || scope.projectEpoch !== bound.binding.core.projectEpoch) return "rejected"
      const journal = await input.journal.resolveExact(bound.claimDigest)
      if (typeof journal === "string") return journal
      if (journal.ownerBindingCoreDigest !== bound.binding.coreDigest ||
        journal.bridge.core.successorProtocolDigest !== protocolDigest ||
        journal.bridge.core.scope.docKind !== "project-index") return "rejected"
      return journal.bridge.coreDigest
    },
  })
  return Object.freeze({
    localAuthority,
    promotionBridge,
    async bindProjectIndex(next: Parameters<ClaimBoundProvisioningAuthoritySourcesV3["bindProjectIndex"]>[0]) {
      if (disposed) throw new Error("Provisioning authority is disposed")
      const normalized = Object.freeze({ claimDigest: parseDigestV2(next.claimDigest), binding: next.binding })
      const journal = await input.journal.resolveExact(normalized.claimDigest)
      if (typeof journal === "string" || journal.ownerBindingCoreDigest !== normalized.binding.coreDigest) {
        throw new Error("Provisioning claim has no exact durable ProjectIndex bridge journal")
      }
      if (bound && (bound.claimDigest !== normalized.claimDigest || bound.binding.coreDigest !== normalized.binding.coreDigest)) {
        throw new Error("Provisioning authority claim equivocation")
      }
      bound = normalized
    },
    dispose() { disposed = true; bound = undefined },
  })
}
