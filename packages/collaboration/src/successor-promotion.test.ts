import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseId128V2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
} from "./codecs"
import { ordinarySha256V2 } from "./digest"
import {
  parseProtocolPromotionBridgeCoreV3,
  parseProtocolPromotionBridgeV3,
  protocolPromotionBridgeCoreDigestV3,
  verifyProtocolPromotionBridgeV3,
  type ProtocolPromotionBridgeCoreV3,
  type ProtocolPromotionBridgeV3,
} from "./successor-promotion"
import { causalSignerAuthorityDigestV3 } from "./successor-authority"

const bytes = (length: number, value: number) => encodeBase64urlV2(Uint8Array.from({ length }, () => value))
const ID = parseId128V2(bytes(16, 1))
const PROJECT = parseProjectIdV2("project")
const PUBLIC_KEY = parsePublicKeyV2(bytes(32, 2))
const ACTOR = parseActorIdV2(PUBLIC_KEY)
const SIGNATURE = parseSignatureV2(bytes(64, 3))
const digest = (label: string) => ordinarySha256V2(new TextEncoder().encode(label))
const SCOPE = Object.freeze({
  projectId: PROJECT,
  projectEpoch: ID,
  docKind: "canvas" as const,
  docId: parseCanvasIdV2(`cv_${"4".repeat(64)}`),
  shardEpoch: ID,
})

function core(source: ProtocolPromotionBridgeCoreV3["source"] = {
  kind: "new-project",
  creationClaimDigest: digest("claim"),
  genesisHeadDigest: digest("genesis"),
  genesisFrontierDigest: digest("frontier"),
}): ProtocolPromotionBridgeCoreV3 {
  const signerAuthority = Object.freeze({
    kind: "local-project-owner" as const,
    ownerKeyId: digest("owner-key"),
    replicaId: parseReplicaIdV2("replica_00000001"),
    actorId: ACTOR,
    ownerBindingCoreDigest: digest("binding"),
    ownerEditAuthorizationCoreDigest: digest("authorization"),
  })
  return Object.freeze({
    format: "convax.protocol-promotion-bridge-core/3",
    projectId: PROJECT,
    projectEpoch: ID,
    scope: SCOPE,
    source,
    successorProtocolDigest: digest("v3"),
    signerAuthority,
    signerAuthorityDigest: causalSignerAuthorityDigestV3(signerAuthority),
    bridgeId: ID,
  })
}

function bridge(value = core()): ProtocolPromotionBridgeV3 {
  return Object.freeze({
    format: "convax.protocol-promotion-bridge/3",
    core: value,
    coreDigest: protocolPromotionBridgeCoreDigestV3(value),
    signerPublicKey: PUBLIC_KEY,
    signerSignature: SIGNATURE,
  })
}

describe("successor protocol promotion bridge", () => {
  test("closes new-project and exact R5 predecessor sources", () => {
    expect(parseProtocolPromotionBridgeV3(bridge()).core.source.kind).toBe("new-project")
    const r5 = core({
      kind: "v10-r5",
      r5AuthorityManifestSha256: digest("r5-manifest"),
      sourceHeadDigest: digest("v2-head"),
      sourceFrontierDigest: digest("v2-frontier"),
    })
    expect(parseProtocolPromotionBridgeCoreV3(r5).source.kind).toBe("v10-r5")
    expect(() => parseProtocolPromotionBridgeCoreV3({ ...r5, source: { ...r5.source, extra: true } })).toThrow()
  })

  test("binds scope, authority digest, protocol and signer key", async () => {
    const value = bridge()
    const accepted = await verifyProtocolPromotionBridgeV3({
      bridge: value,
      expectedScope: SCOPE,
      expectedProtocolDigest: value.core.successorProtocolDigest,
      expectedSignerPublicKey: PUBLIC_KEY,
      verifier: { verify: async () => true },
    })
    expect(accepted).not.toBe("rejected")
    expect(await verifyProtocolPromotionBridgeV3({
      bridge: value,
      expectedScope: SCOPE,
      expectedProtocolDigest: digest("other"),
      expectedSignerPublicKey: PUBLIC_KEY,
      verifier: { verify: async () => true },
    })).toBe("rejected")
    expect(() => parseProtocolPromotionBridgeV3({ ...value, core: { ...value.core, projectEpoch: bytes(16, 9) } })).toThrow()
  })
})
