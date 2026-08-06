import {
  causalFrontierDigest,
  incrementUint64,
  parseActorId,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parsePublicKey,
  parseUint64,
  parseValidationArtifactSet,
  type ActorId,
  type CausalDependencyRef,
  type CausalSignerAuthority,
  type DecodedCausalEditFrame,
  type Digest,
  type DocumentScope,
  type Id128,
  type IncomingAuthorityVerificationPort,
  type LocalAuthorityPort,
  type PublicKey,
  type ReplicaSignerPort,
  type ValidationArtifactSet,
} from "@convax/collaboration"

export interface CurrentLocalReplicaAuthorityEvidenceV2 {
  /** Exact request binding produced after current control-plane verification. */
  readonly scope: DocumentScope
  readonly operationId: Id128
  readonly baseFrontierDigest: Digest
  readonly ownerSchemaDigest: Digest
  readonly signerAuthority: CausalSignerAuthority
  readonly dependencies: readonly CausalDependencyRef[]
  readonly validationArtifacts: ValidationArtifactSet
  /** OS-vault-backed long-lived replica signer; never a PeerJS session key. */
  readonly signer: ReplicaSignerPort
}

/**
 * Control-plane edge. It must verify the exact current membership snapshot,
 * reservation receipt, actor credential, active-editor authorization, cutoff and
 * installed floor before returning evidence. Peer id/session order is not input.
 */
export interface CurrentLocalReplicaAuthoritySourceV2 {
  resolveCurrent(input: {
    readonly scope: DocumentScope
    readonly actorId: ActorId
    readonly operationId: Id128
    readonly baseFrontierDigest: Digest
    readonly ownerSchemaDigest: Digest
  }): Promise<CurrentLocalReplicaAuthorityEvidenceV2 | "pending" | "rejected">
}

export interface VerifiedIncomingReplicaAuthorityEvidenceV2 {
  readonly scope: DocumentScope
  readonly frameDigest: Digest
  readonly actorId: ActorId
  readonly membershipSnapshotDigest: Digest
  readonly replicaActorCredentialCoreDigest: Digest
  readonly replicaEditAuthorizationCoreDigest: Digest
  readonly replicaPublicKey: PublicKey
}

/**
 * Control-plane edge for historical/current incoming authorization verification.
 * Implementations resolve exact digest-addressed dependencies and cutoff state;
 * PeerJS connection identity alone can never produce this evidence.
 */
export interface IncomingReplicaAuthoritySourceV2 {
  verify(input: {
    readonly frame: DecodedCausalEditFrame
  }): Promise<VerifiedIncomingReplicaAuthorityEvidenceV2 | "pending" | "rejected">
}

export function createCurrentLocalReplicaAuthorityPortV2(input: {
  readonly actorId: ActorId
  readonly source: CurrentLocalReplicaAuthoritySourceV2
}): LocalAuthorityPort {
  const actorId = parseActorId(input.actorId)
  if (!input.source || typeof input.source.resolveCurrent !== "function") {
    throw new TypeError("Current local replica authority source is required")
  }
  const port: LocalAuthorityPort = {
    actorId,
    async prepareFinalFrameAuthority(request) {
      const scope = parseDocumentScope(request.scope)
      const operationId = parseId128(request.operationId)
      const baseFrontierDigest = causalFrontierDigest(request.baseFrontier)
      const ownerSchemaDigest = parseDigest(request.ownerSchemaDigest)
      const prior = request.previousActorHead
      if (prior !== null && prior.actorId !== actorId) {
        throw new Error("Local actor predecessor belongs to another actor")
      }
      const resolved = await input.source.resolveCurrent({
        scope,
        actorId,
        operationId,
        baseFrontierDigest,
        ownerSchemaDigest,
      })
      if (resolved === "pending" || resolved === "rejected") return resolved
      assertSameScope(resolved.scope, scope)
      if (
        parseId128(resolved.operationId) !== operationId ||
        parseDigest(resolved.baseFrontierDigest) !== baseFrontierDigest ||
        parseDigest(resolved.ownerSchemaDigest) !== ownerSchemaDigest ||
        parseActorId(resolved.signerAuthority.actorId) !== actorId
      ) {
        throw new Error("Current local replica authority evidence is bound to another request")
      }
      if (!resolved.signer || typeof resolved.signer.sign !== "function") {
        throw new Error("Current local replica authority omitted the OS-vault signer")
      }
      return Object.freeze({
        actorId,
        actorSequence: prior === null ? parseUint64("1") : incrementUint64(prior.actorSequence),
        predecessorFrameDigest: prior === null ? null : parseDigest(prior.frameDigest),
        signerAuthority: resolved.signerAuthority,
        dependencies: Object.freeze([...resolved.dependencies]),
        validationArtifacts: parseValidationArtifactSet(resolved.validationArtifacts),
        signer: resolved.signer,
      })
    },
  }
  return Object.freeze(port)
}

export function createIncomingReplicaAuthorityVerificationPortV2(
  source: IncomingReplicaAuthoritySourceV2,
): IncomingAuthorityVerificationPort {
  if (!source || typeof source.verify !== "function") {
    throw new TypeError("Incoming replica authority source is required")
  }
  const port: IncomingAuthorityVerificationPort = {
    async verifyFrameAuthority(frame) {
      const verified = await source.verify({ frame })
      if (verified === "pending" || verified === "rejected") return verified
      const core = frame.header.core
      assertSameScope(verified.scope, core.scope)
      if (
        parseDigest(verified.frameDigest) !== frame.frameDigest ||
        parseActorId(verified.actorId) !== core.actorId ||
        parseDigest(verified.membershipSnapshotDigest) !== core.membershipSnapshotDigest ||
        parseDigest(verified.replicaActorCredentialCoreDigest) !== core.replicaActorCredentialCoreDigest ||
        parseDigest(verified.replicaEditAuthorizationCoreDigest) !== core.replicaEditAuthorizationCoreDigest
      ) {
        throw new Error("Incoming replica authority evidence is bound to another frame")
      }
      return Object.freeze({ replicaPublicKey: parsePublicKey(verified.replicaPublicKey) })
    },
  }
  return Object.freeze(port)
}

function assertSameScope(leftValue: DocumentScope, rightValue: DocumentScope): void {
  const left = parseDocumentScope(leftValue)
  const right = parseDocumentScope(rightValue)
  if (
    left.projectId !== right.projectId ||
    left.projectEpoch !== right.projectEpoch ||
    left.docKind !== right.docKind ||
    left.docId !== right.docId ||
    left.shardEpoch !== right.shardEpoch
  ) {
    throw new Error("Replica authority evidence crossed document scope")
  }
}
