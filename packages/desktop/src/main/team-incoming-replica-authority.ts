import {
  parseActorId,
  parseDigest,
  parseDocumentScope,
  type DecodedCausalEditFrame,
} from "@convax/collaboration"
import type { IncomingReplicaAuthoritySourceV2 } from "./collaboration-authority-ports"
import type { NodeDurableTeamAuthorityStoreV1 } from "./durable-team-authority-store"

/**
 * Uses the exact durable team graph when it contains the frame actor. Remote
 * actors remain pending until their signed artifact closure is admitted; peer
 * presence alone never upgrades them.
 */
export function createLocalTeamIncomingReplicaAuthoritySourceV2(
  store: Pick<NodeDurableTeamAuthorityStoreV1, "open">,
): IncomingReplicaAuthoritySourceV2 {
  return Object.freeze({
    async verify({ frame }: { readonly frame: DecodedCausalEditFrame }) {
      const scope = parseDocumentScope(frame.header.core.scope)
      const record = await store.open(scope.projectId)
      if (record === "missing") return "pending"
      if (record === "rejected") return "rejected"
      const actor = record.replicaActorCredential
      const edit = record.replicaEditAuthorization
      if (!actor || !edit ||
        actor.core.actorId !== parseActorId(frame.header.core.actorId) ||
        actor.coreDigest !== parseDigest(frame.header.core.replicaActorCredentialCoreDigest) ||
        edit.coreDigest !== parseDigest(frame.header.core.replicaEditAuthorizationCoreDigest) ||
        record.membershipSnapshot.coreDigest !== parseDigest(frame.header.core.membershipSnapshotDigest)) {
        return "pending"
      }
      if (record.projectId !== scope.projectId || record.membershipSnapshot.core.projectEpoch !== scope.projectEpoch) return "rejected"
      return Object.freeze({
        scope,
        frameDigest: frame.frameDigest,
        actorId: actor.core.actorId,
        membershipSnapshotDigest: record.membershipSnapshot.coreDigest,
        replicaActorCredentialCoreDigest: actor.coreDigest,
        replicaEditAuthorizationCoreDigest: edit.coreDigest,
        replicaPublicKey: actor.core.replicaSigningPublicKey,
      })
    },
  })
}
