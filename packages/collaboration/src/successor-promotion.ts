import type { DigestV2, Id128V2, ProjectIdV2, PublicKeyV2, SignatureV2 } from "./codecs"
import {
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseSignatureV2,
} from "./codecs"
import type { DocumentScopeV2 } from "./contracts"
import type { Ed25519VerifierPortV2 } from "./crypto"
import { verifyExactEd25519V2 } from "./crypto"
import { ordinarySha256V2 } from "./digest"
import { failCodec } from "./errors"
import { assertExactKeysV2, encodeRestrictedJcsV2 } from "./jcs"
import { assertSameScopeV2, parseDocumentScopeV2 } from "./parse"
import {
  causalSignerAuthorityDigestV3,
  parseCausalSignerAuthorityV3,
  type CausalSignerAuthorityV3,
} from "./successor-authority"

export const SUCCESSOR_PROMOTION_DOMAINS_V3 = Object.freeze({
  bridgeCore: "convax.protocol-promotion-bridge-core/3",
  bridgeSignature: "convax.protocol-promotion-bridge-signature/3",
} as const)

export type ProtocolPromotionSourceV3 =
  | Readonly<{
      kind: "new-project"
      creationClaimDigest: DigestV2
      genesisHeadDigest: DigestV2
      genesisFrontierDigest: DigestV2
    }>
  | Readonly<{
      kind: "v10-r5"
      r5AuthorityManifestSha256: DigestV2
      sourceHeadDigest: DigestV2
      sourceFrontierDigest: DigestV2
    }>

export interface ProtocolPromotionBridgeCoreV3 {
  readonly format: "convax.protocol-promotion-bridge-core/3"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly scope: DocumentScopeV2
  readonly source: ProtocolPromotionSourceV3
  readonly successorProtocolDigest: DigestV2
  readonly signerAuthority: CausalSignerAuthorityV3
  readonly signerAuthorityDigest: DigestV2
  readonly bridgeId: Id128V2
}

export interface ProtocolPromotionBridgeV3 {
  readonly format: "convax.protocol-promotion-bridge/3"
  readonly core: ProtocolPromotionBridgeCoreV3
  readonly coreDigest: DigestV2
  readonly signerPublicKey: PublicKeyV2
  readonly signerSignature: SignatureV2
}

export function parseProtocolPromotionSourceV3(value: unknown): ProtocolPromotionSourceV3 {
  if (!value || typeof value !== "object" || Array.isArray(value)) failCodec("Protocol promotion source must be an object")
  const source = value as Record<string, unknown>
  if (source.kind === "new-project") {
    assertExactKeysV2(source, ["kind", "creationClaimDigest", "genesisHeadDigest", "genesisFrontierDigest"], "NewProjectPromotionSourceV3")
    return Object.freeze({
      kind: source.kind,
      creationClaimDigest: parseDigestV2(source.creationClaimDigest),
      genesisHeadDigest: parseDigestV2(source.genesisHeadDigest),
      genesisFrontierDigest: parseDigestV2(source.genesisFrontierDigest),
    })
  }
  if (source.kind === "v10-r5") {
    assertExactKeysV2(source, ["kind", "r5AuthorityManifestSha256", "sourceHeadDigest", "sourceFrontierDigest"], "V10R5PromotionSourceV3")
    return Object.freeze({
      kind: source.kind,
      r5AuthorityManifestSha256: parseDigestV2(source.r5AuthorityManifestSha256),
      sourceHeadDigest: parseDigestV2(source.sourceHeadDigest),
      sourceFrontierDigest: parseDigestV2(source.sourceFrontierDigest),
    })
  }
  failCodec("Protocol promotion source kind is invalid")
}

export function parseProtocolPromotionBridgeCoreV3(value: unknown): ProtocolPromotionBridgeCoreV3 {
  assertExactKeysV2(value, [
    "format", "projectId", "projectEpoch", "scope", "source",
    "successorProtocolDigest", "signerAuthority", "signerAuthorityDigest", "bridgeId",
  ], "ProtocolPromotionBridgeCoreV3")
  if (value.format !== "convax.protocol-promotion-bridge-core/3") failCodec("Protocol promotion bridge core format is invalid")
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const scope = parseDocumentScopeV2(value.scope)
  if (scope.projectId !== projectId || scope.projectEpoch !== projectEpoch) failCodec("Protocol promotion bridge crossed its Project or epoch")
  const signerAuthority = parseCausalSignerAuthorityV3(value.signerAuthority)
  const signerAuthorityDigest = parseDigestV2(value.signerAuthorityDigest)
  if (signerAuthorityDigest !== causalSignerAuthorityDigestV3(signerAuthority)) failCodec("Protocol promotion signer authority digest mismatches")
  return Object.freeze({
    format: value.format,
    projectId,
    projectEpoch,
    scope,
    source: parseProtocolPromotionSourceV3(value.source),
    successorProtocolDigest: parseDigestV2(value.successorProtocolDigest),
    signerAuthority,
    signerAuthorityDigest,
    bridgeId: parseId128V2(value.bridgeId),
  })
}

export function protocolPromotionBridgeCoreDigestV3(value: ProtocolPromotionBridgeCoreV3): DigestV2 {
  const core = parseProtocolPromotionBridgeCoreV3(value)
  const domain = new TextEncoder().encode(SUCCESSOR_PROMOTION_DOMAINS_V3.bridgeCore)
  const bytes = encodeRestrictedJcsV2(core)
  const input = new Uint8Array(domain.byteLength + 1 + bytes.byteLength)
  input.set(domain)
  input[domain.byteLength] = 0
  input.set(bytes, domain.byteLength + 1)
  return ordinarySha256V2(input)
}

export function protocolPromotionBridgeSignatureDigestV3(coreDigest: DigestV2): Uint8Array {
  const domain = new TextEncoder().encode(SUCCESSOR_PROMOTION_DOMAINS_V3.bridgeSignature)
  const digest = new TextEncoder().encode(parseDigestV2(coreDigest))
  const input = new Uint8Array(domain.byteLength + 1 + digest.byteLength)
  input.set(domain)
  input[domain.byteLength] = 0
  input.set(digest, domain.byteLength + 1)
  const hex = ordinarySha256V2(input)
  return Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16))
}

export function parseProtocolPromotionBridgeV3(value: unknown): ProtocolPromotionBridgeV3 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "signerPublicKey", "signerSignature"], "ProtocolPromotionBridgeV3")
  if (value.format !== "convax.protocol-promotion-bridge/3") failCodec("Protocol promotion bridge format is invalid")
  const core = parseProtocolPromotionBridgeCoreV3(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== protocolPromotionBridgeCoreDigestV3(core)) failCodec("Protocol promotion bridge core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    signerPublicKey: parsePublicKeyV2(value.signerPublicKey),
    signerSignature: parseSignatureV2(value.signerSignature),
  })
}

export async function verifyProtocolPromotionBridgeV3(input: {
  readonly bridge: ProtocolPromotionBridgeV3
  readonly expectedScope: DocumentScopeV2
  readonly expectedProtocolDigest: DigestV2
  readonly expectedSignerPublicKey: PublicKeyV2
  readonly verifier: Ed25519VerifierPortV2
}): Promise<ProtocolPromotionBridgeV3 | "rejected"> {
  try {
    const bridge = parseProtocolPromotionBridgeV3(input.bridge)
    assertSameScopeV2(bridge.core.scope, parseDocumentScopeV2(input.expectedScope), "Protocol promotion bridge")
    if (
      bridge.core.successorProtocolDigest !== parseDigestV2(input.expectedProtocolDigest) ||
      bridge.signerPublicKey !== parsePublicKeyV2(input.expectedSignerPublicKey)
    ) return "rejected"
    return await verifyExactEd25519V2(
      input.verifier,
      bridge.signerPublicKey,
      bridge.signerSignature,
      protocolPromotionBridgeSignatureDigestV3(bridge.coreDigest),
    ) ? bridge : "rejected"
  } catch {
    return "rejected"
  }
}
