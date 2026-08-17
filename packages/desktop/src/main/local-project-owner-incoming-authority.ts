import {
  localOwnerEditAuthorizationCoreDigest,
  parseActorId,
  parseDigest,
  parseDocumentScope,
  parsePublicKey,
  parseReplicaId,
  type DocumentScope,
} from "@convax/collaboration"
import type {
  IncomingReplicaAuthoritySource,
  VerifiedIncomingReplicaAuthorityEvidence,
} from "./collaboration-authority-ports"
import type { ResolvedLocalProjectOwnerBinding } from "./local-project-owner-authority"

/** Verifies retained local-owner frames from their exact Project binding. */
export function createLocalProjectOwnerIncomingReplicaAuthoritySource(input: {
  readonly protocolDigest: import("@convax/collaboration").Digest
  resolveOwner(input: {
    readonly scope: DocumentScope
    readonly ownerBindingDigest: import("@convax/collaboration").Digest
  }): Promise<ResolvedLocalProjectOwnerBinding | "missing" | "rejected">
}): IncomingReplicaAuthoritySource {
  const protocolDigest = parseDigest(input.protocolDigest)
  return Object.freeze({
    async verify({
      frame,
    }: Parameters<IncomingReplicaAuthoritySource["verify"]>[0]): Promise<
      VerifiedIncomingReplicaAuthorityEvidence | "pending" | "rejected"
    > {
      const scope = parseDocumentScope(frame.header.core.scope)
      if (frame.header.core.signerAuthorityKind !== "local-project-owner") return "rejected"
      const signerAuthority = frame.context.signerAuthority
      if (signerAuthority.kind !== "local-project-owner") return "rejected"
      const owner = await input.resolveOwner({
        scope,
        ownerBindingDigest: signerAuthority.ownerBindingDigest,
      })
      if (owner === "missing") return "pending"
      if (owner === "rejected") return "rejected"
      const binding = owner.binding
      if (
        binding.projectId !== scope.projectId ||
        binding.projectEpoch !== scope.projectEpoch ||
        parseDigest(binding.protocolDigest) !== protocolDigest ||
        parseReplicaId(binding.replicaId) !== signerAuthority.replicaId ||
        parseActorId(binding.actorId) !== signerAuthority.actorId ||
        parseDigest(binding.bindingDigest) !== signerAuthority.ownerBindingDigest
      )
        return "rejected"
      const authorizationDigest = localOwnerEditAuthorizationCoreDigest(
        Object.freeze({
          format: "convax.local-owner-edit-authorization-core",
          scope,
          replicaId: signerAuthority.replicaId,
          actorId: signerAuthority.actorId,
          ownerBindingDigest: signerAuthority.ownerBindingDigest,
          protocolDigest,
          ownerSchemaDigest: frame.header.core.ownerSchemaDigest,
          expiryPolicy: "none",
        }),
      )
      if (authorizationDigest !== signerAuthority.ownerEditAuthorizationCoreDigest) return "rejected"
      return Object.freeze({
        scope,
        frameDigest: frame.frameDigest,
        actorId: signerAuthority.actorId,
        signerAuthority,
        replicaPublicKey: parsePublicKey(binding.publicKey),
      })
    },
  })
}

export function createCurrentIncomingReplicaAuthoritySource(input: {
  readonly localOwner: IncomingReplicaAuthoritySource
  readonly team: IncomingReplicaAuthoritySource
}): IncomingReplicaAuthoritySource {
  return Object.freeze({
    verify({ frame }: Parameters<IncomingReplicaAuthoritySource["verify"]>[0]) {
      return frame.header.core.signerAuthorityKind === "local-project-owner"
        ? input.localOwner.verify({ frame })
        : input.team.verify({ frame })
    },
  })
}
