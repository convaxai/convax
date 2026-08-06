import {
  parseActorId,
  parseDocumentScope,
  type DecodedCausalEditFrame,
} from "@convax/collaboration"
import type { IncomingReplicaAuthoritySource } from "./collaboration-authority-ports"
import type { NodeDurableTeamAuthorityStore } from "./durable-team-authority-store"

/**
 * Uses the exact durable team graph when it contains the frame actor. Remote
 * actors remain pending until their signed artifact closure is admitted; peer
 * presence alone never upgrades them.
 */
export function createLocalTeamIncomingReplicaAuthoritySource(
  store: Pick<NodeDurableTeamAuthorityStore, "open">,
): IncomingReplicaAuthoritySource {
  return Object.freeze({
    async verify({ frame }: { readonly frame: DecodedCausalEditFrame }) {
      const scope = parseDocumentScope(frame.header.core.scope)
      const record = await store.open(scope.projectId)
      if (record === "missing") return "pending"
      if (record === "rejected") return "rejected"
      const actor = record.replicaActorCredential
      const edit = record.replicaEditAuthorization
      if (frame.header.core.signerAuthorityKind !== "team-replica") return "rejected"
      if (!actor || !edit ||
        actor.core.actorId !== parseActorId(frame.header.core.actorId) ||
        actor.core.actorId !== frame.context.signerAuthority.actorId ||
        frame.context.signerAuthority.kind !== "team-replica" ||
        actor.coreDigest !== frame.context.signerAuthority.replicaActorCredentialCoreDigest ||
        edit.coreDigest !== frame.context.signerAuthority.replicaEditAuthorizationCoreDigest ||
        record.membershipSnapshot.coreDigest !== frame.context.signerAuthority.membershipSnapshotDigest) {
        return "pending"
      }
      if (record.projectId !== scope.projectId || record.membershipSnapshot.core.projectEpoch !== scope.projectEpoch) return "rejected"
      return Object.freeze({
        scope,
        frameDigest: frame.frameDigest,
        actorId: actor.core.actorId,
        signerAuthority: frame.context.signerAuthority,
        replicaPublicKey: actor.core.replicaSigningPublicKey,
      })
    },
  })
}
