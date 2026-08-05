import {
  parseCausalAuthorityDependenciesV3,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  verifyLocalOwnerAuthorityV3,
  type CausalAuthorityDependencyRefV3,
  type DigestV2,
  type DocumentScopeV2,
  type Ed25519VerifierPortV2,
  type Id128V2,
  type LocalOwnerEditAuthorizationV3,
  type LocalOwnerSharingStatePortV3,
  type LocalProjectOwnerBindingV3,
  type LocalProjectOwnerSignerAuthorityV3,
  type ProjectIdV2,
  type PublicKeyV2,
  type ReplicaSignerPortV2,
} from "@convax/collaboration"

export interface LocalOwnerAuthorityRecordSourceV3 {
  resolveExact(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly scope: DocumentScopeV2
    readonly ownerSchemaDigest: DigestV2
    readonly protocolDigest: DigestV2
  }): Promise<Readonly<{
    readonly authority: LocalProjectOwnerSignerAuthorityV3
    readonly binding: LocalProjectOwnerBindingV3
    readonly authorization: LocalOwnerEditAuthorizationV3
  }> | "missing" | "rejected">
}

export interface LocalOwnerReplicaSignerSourceV3 {
  openSigner(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly replicaId: LocalProjectOwnerSignerAuthorityV3["replicaId"]
    readonly expectedPublicKey: PublicKeyV2
  }): Promise<ReplicaSignerPortV2 | "missing" | "unavailable" | "rejected">
}

export interface CurrentLocalOwnerAuthorityEvidenceV3 {
  readonly authority: LocalProjectOwnerSignerAuthorityV3
  readonly binding: LocalProjectOwnerBindingV3
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly dependencies: readonly CausalAuthorityDependencyRefV3[]
  readonly signer: ReplicaSignerPortV2
}

/** Successor-only seam. It is not adapted to or selected by the v2 kernel. */
export interface CurrentLocalOwnerAuthoritySourceV3 {
  resolveCurrent(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly scope: DocumentScopeV2
    readonly ownerSchemaDigest: DigestV2
    readonly protocolDigest: DigestV2
  }): Promise<CurrentLocalOwnerAuthorityEvidenceV3 | "pending" | "rejected">
}

export function createCurrentLocalOwnerAuthoritySourceV3(input: {
  readonly records: LocalOwnerAuthorityRecordSourceV3
  readonly sharingState: LocalOwnerSharingStatePortV3
  readonly verifier: Ed25519VerifierPortV2
  readonly signers: LocalOwnerReplicaSignerSourceV3
}): CurrentLocalOwnerAuthoritySourceV3 {
  return Object.freeze({
    async resolveCurrent(
      requestInput: Parameters<CurrentLocalOwnerAuthoritySourceV3["resolveCurrent"]>[0],
    ) {
      const request = Object.freeze({
        projectId: parseProjectIdV2(requestInput.projectId),
        projectEpoch: parseId128V2(requestInput.projectEpoch),
        scope: parseDocumentScopeV2(requestInput.scope),
        ownerSchemaDigest: parseDigestV2(requestInput.ownerSchemaDigest),
        protocolDigest: parseDigestV2(requestInput.protocolDigest),
      })
      const record = await input.records.resolveExact(request)
      if (record === "missing") return "pending"
      if (record === "rejected") return "rejected"
      const verified = await verifyLocalOwnerAuthorityV3({
        ...record,
        ...request,
        sharingState: input.sharingState,
        verifier: input.verifier,
      })
      if (verified === "rejected") return "rejected"
      const signer = await input.signers.openSigner({
        projectId: request.projectId,
        projectEpoch: request.projectEpoch,
        replicaId: parseReplicaIdV2(verified.authority.replicaId),
        expectedPublicKey: parsePublicKeyV2(verified.ownerPublicKey),
      })
      if (signer === "missing" || signer === "unavailable") return "pending"
      if (signer === "rejected") return "rejected"
      const dependencies = parseCausalAuthorityDependenciesV3([
        { kind: "local-owner-binding", digest: record.binding.coreDigest },
        { kind: "local-owner-edit-authorization", digest: record.authorization.coreDigest },
      ], verified.authority)
      return Object.freeze({ ...record, authority: verified.authority, dependencies, signer })
    },
  })
}
