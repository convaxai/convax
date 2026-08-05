import type { DigestV2, PublicKeyV2 } from "./codecs"
import { parsePublicKeyV2 } from "./codecs"
import type { DocumentScopeV2 } from "./contracts"
import type { Ed25519VerifierPortV2 } from "./crypto"
import { verifyExactEd25519V2 } from "./crypto"
import { failCodec } from "./errors"
import { assertSameScopeV2, parseDocumentScopeV2 } from "./parse"
import {
  causalSignerAuthorityDigestV3,
  parseCausalSignerAuthorityV3,
  verifyLocalOwnerAuthorityV3,
  type CausalSignerAuthorityV3,
  type LocalOwnerEditAuthorizationV3,
  type LocalOwnerSharingStatePortV3,
  type LocalProjectOwnerBindingV3,
  type LocalProjectOwnerSignerAuthorityV3,
  type TeamReplicaSignerAuthorityV3,
} from "./successor-authority"
import {
  causalEditSignatureDigestV3,
  decodeCausalEditFrameV3,
  type SuccessorProtocolAuthorityV3,
  type DecodedCausalEditFrameV3,
} from "./successor-frame"

export type SuccessorAuthorityProofResolutionV3<T> =
  | Readonly<{ status: "resolved"; proof: T }>
  | Readonly<{ status: "pending" | "rejected" }>

export interface LocalOwnerIncomingProofV3 {
  readonly binding: LocalProjectOwnerBindingV3
  readonly authorization: LocalOwnerEditAuthorizationV3
  readonly ownerSchemaDigest: DigestV2
  readonly sharingState: LocalOwnerSharingStatePortV3
}

/**
 * Team proof verification remains owned by the membership/control-plane adapter.
 * Its resolved result must repeat the exact signer authority and document scope;
 * admission rejects wildcard, stale, or cross-document results before signature use.
 */
export interface VerifiedTeamReplicaIncomingProofV3 {
  readonly authority: TeamReplicaSignerAuthorityV3
  readonly scope: DocumentScopeV2
  readonly replicaPublicKey: PublicKeyV2
}

export interface SuccessorIncomingAuthorityProofResolverPortV3 {
  resolveLocalOwner(input: Readonly<{
    frame: DecodedCausalEditFrameV3
    authority: LocalProjectOwnerSignerAuthorityV3
  }>): Promise<SuccessorAuthorityProofResolutionV3<LocalOwnerIncomingProofV3>>
  resolveTeamReplica(input: Readonly<{
    frame: DecodedCausalEditFrameV3
    authority: TeamReplicaSignerAuthorityV3
  }>): Promise<SuccessorAuthorityProofResolutionV3<VerifiedTeamReplicaIncomingProofV3>>
}

export type CandidateIncomingFrameAdmissionResultV3 =
  | Readonly<{
      status: "accepted"
      authority: CausalSignerAuthorityV3
      replicaPublicKey: PublicKeyV2
      frame: DecodedCausalEditFrameV3
    }>
  | Readonly<{ status: "pending" | "rejected" }>

export interface CandidateIncomingFrameAdmissionStrategyV3 {
  verifyExactFrame(bytes: Uint8Array): Promise<CandidateIncomingFrameAdmissionResultV3>
}

/**
 * Candidate-only successor strategy. Possession of this object does not select V3
 * in production; decodeSelectedCausalEditFrame intentionally keeps CVXCOLL3 fixed
 * reject until a sealed successor release and selector exist.
 */
export function createCandidateIncomingFrameAdmissionStrategyV3(input: Readonly<{
  candidate: SuccessorProtocolAuthorityV3
  resolver: SuccessorIncomingAuthorityProofResolverPortV3
  verifier: Ed25519VerifierPortV2
}>): CandidateIncomingFrameAdmissionStrategyV3 {
  if (!input.resolver || typeof input.resolver.resolveLocalOwner !== "function" ||
    typeof input.resolver.resolveTeamReplica !== "function" ||
    !input.verifier || typeof input.verifier.verify !== "function") {
    failCodec("Successor incoming authority proof resolver and verifier are required")
  }
  return Object.freeze({
    async verifyExactFrame(bytes: Uint8Array): Promise<CandidateIncomingFrameAdmissionResultV3> {
      const frame = decodeCausalEditFrameV3(input.candidate, bytes)
      const authority = parseCausalSignerAuthorityV3(frame.context.signerAuthority)
      let publicKey: PublicKeyV2
      if (authority.kind === "local-project-owner") {
        const resolution = await input.resolver.resolveLocalOwner({ frame, authority })
        if (resolution.status !== "resolved") return Object.freeze({ status: resolution.status })
        const verified = await verifyLocalOwnerAuthorityV3({
          authority,
          binding: resolution.proof.binding,
          authorization: resolution.proof.authorization,
          projectId: frame.header.core.scope.projectId,
          projectEpoch: frame.header.core.scope.projectEpoch,
          scope: frame.header.core.scope,
          ownerSchemaDigest: resolution.proof.ownerSchemaDigest,
          protocolDigest: frame.header.core.protocolDigest,
          sharingState: resolution.proof.sharingState,
          verifier: input.verifier,
        })
        if (verified === "rejected") return Object.freeze({ status: "rejected" })
        publicKey = verified.ownerPublicKey
      } else {
        const resolution = await input.resolver.resolveTeamReplica({ frame, authority })
        if (resolution.status !== "resolved") return Object.freeze({ status: resolution.status })
        const proofAuthority = parseCausalSignerAuthorityV3(resolution.proof.authority)
        if (proofAuthority.kind !== "team-replica" ||
          causalSignerAuthorityDigestV3(proofAuthority) !== causalSignerAuthorityDigestV3(authority)) {
          return Object.freeze({ status: "rejected" })
        }
        try {
          assertSameScopeV2(
            frame.header.core.scope,
            parseDocumentScopeV2(resolution.proof.scope),
            "Successor Team authority proof",
          )
          publicKey = parsePublicKeyV2(resolution.proof.replicaPublicKey)
        } catch {
          return Object.freeze({ status: "rejected" })
        }
      }
      try {
        const valid = await verifyExactEd25519V2(
          input.verifier,
          publicKey,
          frame.header.replicaSignature,
          causalEditSignatureDigestV3(frame.header.coreDigest),
        )
        if (!valid) return Object.freeze({ status: "rejected" })
      } catch {
        return Object.freeze({ status: "rejected" })
      }
      return Object.freeze({ status: "accepted", authority, replicaPublicKey: publicKey, frame })
    },
  })
}
