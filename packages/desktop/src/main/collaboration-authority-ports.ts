import {
  causalFrontierDigestV2,
  incrementUint64V2,
  parseActorIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parsePublicKeyV2,
  parseUint64V2,
  parseValidationArtifactSetV2,
  type ActorIdV2,
  type CausalDependencyRefV2,
  type CausalSignerAuthorityV2,
  type DecodedCausalEditFrameV2,
  type DigestV2,
  type DocumentScopeV2,
  type Id128V2,
  type IncomingAuthorityVerificationPortV2,
  type LocalAuthorityPortV2,
  type PublicKeyV2,
  type ReplicaSignerPortV2,
  type ValidationArtifactSetV2,
} from "@convax/collaboration"

export interface CurrentLocalReplicaAuthorityEvidenceV2 {
  /** Exact request binding produced after current control-plane verification. */
  readonly scope: DocumentScopeV2
  readonly operationId: Id128V2
  readonly baseFrontierDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
  readonly signerAuthority: CausalSignerAuthorityV2
  readonly dependencies: readonly CausalDependencyRefV2[]
  readonly validationArtifacts: ValidationArtifactSetV2
  /** OS-vault-backed long-lived replica signer; never a PeerJS session key. */
  readonly signer: ReplicaSignerPortV2
}

/**
 * Control-plane edge. It must verify the exact current membership snapshot,
 * reservation receipt, actor credential, active-editor authorization, cutoff and
 * installed floor before returning evidence. Peer id/session order is not input.
 */
export interface CurrentLocalReplicaAuthoritySourceV2 {
  resolveCurrent(input: {
    readonly scope: DocumentScopeV2
    readonly actorId: ActorIdV2
    readonly operationId: Id128V2
    readonly baseFrontierDigest: DigestV2
    readonly ownerSchemaDigest: DigestV2
  }): Promise<CurrentLocalReplicaAuthorityEvidenceV2 | "pending" | "rejected">
}

export interface VerifiedIncomingReplicaAuthorityEvidenceV2 {
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
  readonly actorId: ActorIdV2
  readonly membershipSnapshotDigest: DigestV2
  readonly replicaActorCredentialCoreDigest: DigestV2
  readonly replicaEditAuthorizationCoreDigest: DigestV2
  readonly replicaPublicKey: PublicKeyV2
}

/**
 * Control-plane edge for historical/current incoming authorization verification.
 * Implementations resolve exact digest-addressed dependencies and cutoff state;
 * PeerJS connection identity alone can never produce this evidence.
 */
export interface IncomingReplicaAuthoritySourceV2 {
  verify(input: {
    readonly frame: DecodedCausalEditFrameV2
  }): Promise<VerifiedIncomingReplicaAuthorityEvidenceV2 | "pending" | "rejected">
}

export function createCurrentLocalReplicaAuthorityPortV2(input: {
  readonly actorId: ActorIdV2
  readonly source: CurrentLocalReplicaAuthoritySourceV2
}): LocalAuthorityPortV2 {
  const actorId = parseActorIdV2(input.actorId)
  if (!input.source || typeof input.source.resolveCurrent !== "function") {
    throw new TypeError("Current local replica authority source is required")
  }
  const port: LocalAuthorityPortV2 = {
    actorId,
    async prepareFinalFrameAuthority(request) {
      const scope = parseDocumentScopeV2(request.scope)
      const operationId = parseId128V2(request.operationId)
      const baseFrontierDigest = causalFrontierDigestV2(request.baseFrontier)
      const ownerSchemaDigest = parseDigestV2(request.ownerSchemaDigest)
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
        parseId128V2(resolved.operationId) !== operationId ||
        parseDigestV2(resolved.baseFrontierDigest) !== baseFrontierDigest ||
        parseDigestV2(resolved.ownerSchemaDigest) !== ownerSchemaDigest ||
        parseActorIdV2(resolved.signerAuthority.actorId) !== actorId
      ) {
        throw new Error("Current local replica authority evidence is bound to another request")
      }
      if (!resolved.signer || typeof resolved.signer.sign !== "function") {
        throw new Error("Current local replica authority omitted the OS-vault signer")
      }
      return Object.freeze({
        actorId,
        actorSequence: prior === null ? parseUint64V2("1") : incrementUint64V2(prior.actorSequence),
        predecessorFrameDigest: prior === null ? null : parseDigestV2(prior.frameDigest),
        signerAuthority: resolved.signerAuthority,
        dependencies: Object.freeze([...resolved.dependencies]),
        validationArtifacts: parseValidationArtifactSetV2(resolved.validationArtifacts),
        signer: resolved.signer,
      })
    },
  }
  return Object.freeze(port)
}

export function createIncomingReplicaAuthorityVerificationPortV2(
  source: IncomingReplicaAuthoritySourceV2,
): IncomingAuthorityVerificationPortV2 {
  if (!source || typeof source.verify !== "function") {
    throw new TypeError("Incoming replica authority source is required")
  }
  const port: IncomingAuthorityVerificationPortV2 = {
    async verifyFrameAuthority(frame) {
      const verified = await source.verify({ frame })
      if (verified === "pending" || verified === "rejected") return verified
      const core = frame.header.core
      assertSameScope(verified.scope, core.scope)
      if (
        parseDigestV2(verified.frameDigest) !== frame.frameDigest ||
        parseActorIdV2(verified.actorId) !== core.actorId ||
        parseDigestV2(verified.membershipSnapshotDigest) !== core.membershipSnapshotDigest ||
        parseDigestV2(verified.replicaActorCredentialCoreDigest) !== core.replicaActorCredentialCoreDigest ||
        parseDigestV2(verified.replicaEditAuthorizationCoreDigest) !== core.replicaEditAuthorizationCoreDigest
      ) {
        throw new Error("Incoming replica authority evidence is bound to another frame")
      }
      return Object.freeze({ replicaPublicKey: parsePublicKeyV2(verified.replicaPublicKey) })
    },
  }
  return Object.freeze(port)
}

function assertSameScope(leftValue: DocumentScopeV2, rightValue: DocumentScopeV2): void {
  const left = parseDocumentScopeV2(leftValue)
  const right = parseDocumentScopeV2(rightValue)
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
