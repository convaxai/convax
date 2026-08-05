import type { VerifiedProtocolAuthorityV2 } from "./authority"
import { PINNED_AUTHORITY_IDENTITIES_V2 } from "./constants"
import { parseDigestV2 } from "./codecs"
import {
  actualWriteEvidenceDigestV2,
  causalContextDigestV2,
  causalEditSignatureDigestV2,
  decodeCausalEditFrameV2,
  encodeCausalEditFrameV2,
  signCausalEditCoreV2,
  typedIntentDigestV2,
} from "./frame"
import { parseActualWriteEvidenceV2, parseCausalContextV2 } from "./parse"
import type { DigestV2 } from "./codecs"
import type { ReplicaSignerPortV2 } from "./crypto"
import type {
  ActualWriteEvidenceV2,
  CausalContextV2,
  CausalEditCoreV2,
  CausalEditFrameHeaderV2,
  DecodedCausalEditFrameV2,
} from "./contracts"

/** Internal only: implementations are selected by a live protocol authority. */
export interface CausalProtocolCodecStrategy<
  TContext,
  TCore,
  THeader,
  TDecodedFrame,
  TEvidence,
> {
  readonly protocolDigest: DigestV2
  parseCausalContext(value: unknown): TContext
  parseActualWriteEvidence(value: unknown): TEvidence
  causalContextDigest(value: TContext): DigestV2
  actualWriteEvidenceDigest(value: TEvidence): DigestV2
  typedIntentDigest(bytes: Uint8Array): DigestV2
  causalEditSignatureDigest(coreDigest: DigestV2 | string): Uint8Array
  signCore(core: TCore, signer: ReplicaSignerPortV2): Promise<THeader>
  encodeFrame(input: { readonly header: THeader; readonly sections: Parameters<typeof encodeCausalEditFrameV2>[1]["sections"] }): Uint8Array
  decodeFrame(bytes: Uint8Array): TDecodedFrame
}

/**
 * Internal protocol-dependent operations used by the durability kernel.
 * Keeping this object closed prevents a caller from supplying an unverified
 * codec while making every V2 byte-producing dependency explicit.
 */
export function selectedCausalProtocolCodecV2(authority: VerifiedProtocolAuthorityV2): SelectedCausalProtocolCodecV2 {
  return Object.freeze({
    authority,
    protocolDigest: parseDigestV2(PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest),
    actualWriteEvidenceDigest: actualWriteEvidenceDigestV2,
    causalContextDigest: causalContextDigestV2,
    causalEditSignatureDigest: causalEditSignatureDigestV2,
    decodeFrame: (bytes: Uint8Array) => decodeCausalEditFrameV2(authority, bytes),
    encodeFrame: (input: Parameters<typeof encodeCausalEditFrameV2>[1]) => encodeCausalEditFrameV2(authority, input),
    parseActualWriteEvidence: parseActualWriteEvidenceV2,
    parseCausalContext: parseCausalContextV2,
    signCore: (core: Parameters<typeof signCausalEditCoreV2>[1], signer: Parameters<typeof signCausalEditCoreV2>[2]) => signCausalEditCoreV2(authority, core, signer),
    typedIntentDigest: typedIntentDigestV2,
  })
}

export type SelectedCausalProtocolCodecV2 = CausalProtocolCodecStrategy<
  CausalContextV2,
  CausalEditCoreV2,
  CausalEditFrameHeaderV2,
  DecodedCausalEditFrameV2,
  ActualWriteEvidenceV2
> & Readonly<{ authority: VerifiedProtocolAuthorityV2 }>
