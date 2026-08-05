import { describe, expect, test } from "bun:test"
import {
  causalSignerAuthorityDigestV3,
  encodeBase64urlV2,
  localOwnerEditAuthorizationCoreDigestV3,
  localProjectOwnerBindingCoreDigestV3,
  localProjectOwnerKeyIdV3,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  protocolPromotionBridgeCoreDigestV3,
  type DigestV2,
} from "@convax/collaboration"
import { createClaimBoundProvisioningAuthoritySourcesV3 } from "./claim-bound-provisioning-authority-v3"

describe("claim-bound provisioning authority", () => {
  test("admits only the exact journaled ProjectIndex claim and rejects Canvas scope", async () => {
    const projectId = parseProjectIdV2("project_claim_bound")
    const projectEpoch = id(1)
    const scope = Object.freeze({ projectId, projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: id(2) })
    const protocolDigest = digest("v11")
    const publicKey = parsePublicKeyV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 3)))
    const bindingCore = Object.freeze({
      format: "convax.local-project-owner-binding-core/3" as const,
      projectId, projectEpoch, ownerKeyId: localProjectOwnerKeyIdV3(publicKey), ownerPublicKey: publicKey,
      initialReplicaId: parseReplicaIdV2("replica_00000001"), initialActorId: parseActorIdV2(publicKey),
      protocolDigest,
      genesisAuthorizationPolicy: Object.freeze({ format: "convax.local-owner-genesis-authorization-policy/3" as const, projectIndexScope: scope, canvasAuthorization: "accepted-project-index-route-genesis-only" as const }),
      sharingGeneration: "0" as const, creationNonce: id(3),
    })
    const binding = Object.freeze({ format: "convax.local-project-owner-binding/3" as const, core: bindingCore, coreDigest: localProjectOwnerBindingCoreDigestV3(bindingCore), ownerSignature: signature() })
    const authorizationCore = Object.freeze({
      format: "convax.local-owner-edit-authorization-core/3" as const,
      ownerBindingCoreDigest: binding.coreDigest, projectId, projectEpoch, scope,
      replicaId: bindingCore.initialReplicaId, actorId: bindingCore.initialActorId,
      ownerSchemaDigest: digest("project-index-schema"),
      actorSequenceAllocationPolicy: Object.freeze({ format: "convax.local-owner-actor-sequence-allocation-policy/3" as const, kind: "strict-durable-head-successor" as const, initialSequence: "1" as const }),
      protocolDigest, sharingGeneration: "0" as const, expiryPolicy: "none" as const,
    })
    const authorization = Object.freeze({ format: "convax.local-owner-edit-authorization/3" as const, core: authorizationCore, coreDigest: localOwnerEditAuthorizationCoreDigestV3(authorizationCore), ownerSignature: signature() })
    const bridgeCore = Object.freeze({
      format: "convax.protocol-promotion-bridge-core/3" as const, projectId, projectEpoch, scope,
      source: Object.freeze({ kind: "v10-r5" as const, r5AuthorityManifestSha256: digest("r5"), sourceHeadDigest: digest("head"), sourceFrontierDigest: digest("frontier") }),
      successorProtocolDigest: protocolDigest,
      signerAuthority: Object.freeze({ kind: "local-project-owner" as const, ownerKeyId: bindingCore.ownerKeyId, replicaId: bindingCore.initialReplicaId, actorId: bindingCore.initialActorId, ownerBindingCoreDigest: binding.coreDigest, ownerEditAuthorizationCoreDigest: authorization.coreDigest }),
      signerAuthorityDigest: causalSignerAuthorityDigestV3(Object.freeze({ kind: "local-project-owner" as const, ownerKeyId: bindingCore.ownerKeyId, replicaId: bindingCore.initialReplicaId, actorId: bindingCore.initialActorId, ownerBindingCoreDigest: binding.coreDigest, ownerEditAuthorizationCoreDigest: authorization.coreDigest })), bridgeId: id(4),
    })
    const bridge = Object.freeze({ format: "convax.protocol-promotion-bridge/3" as const, core: bridgeCore, coreDigest: protocolPromotionBridgeCoreDigestV3(bridgeCore), signerPublicKey: publicKey, signerSignature: signature() })
    const claimDigest = digest("claim")
    const source = createClaimBoundProvisioningAuthoritySourcesV3({
      protocolDigest,
      journal: { async resolveExact(candidate) { return candidate === claimDigest ? Object.freeze({ claimDigest, ownerBindingCoreDigest: binding.coreDigest, authorization, genesis: { authorizationProofDigest: digest("proof"), durableCheckpointDigest: digest("checkpoint"), acceptedHeadDigest: digest("head"), acceptedFrontierDigest: digest("frontier") }, bridge }) : "missing" } },
      signers: { async open() { return Object.freeze({ async sign() { return signature() } }) } },
      sharingState: { async resolve() { return "unshared" as const } },
      verifier: { async verify() { return true } },
    })
    expect(await source.localAuthority.resolveCurrent({ projectId, projectEpoch, scope, ownerSchemaDigest: authorizationCore.ownerSchemaDigest, protocolDigest })).toBe("pending")
    await source.bindProjectIndex({ claimDigest, binding })
    const resolved = await source.localAuthority.resolveCurrent({ projectId, projectEpoch, scope, ownerSchemaDigest: authorizationCore.ownerSchemaDigest, protocolDigest })
    expect(typeof resolved).not.toBe("string")
    const canvasScope = Object.freeze({ ...scope, docKind: "canvas" as const, docId: `cv_${"a".repeat(64)}` as never })
    expect(await source.localAuthority.resolveCurrent({ projectId, projectEpoch, scope: canvasScope, ownerSchemaDigest: digest("canvas-schema"), protocolDigest })).toBe("rejected")
    expect(await source.promotionBridge.resolveExact({ scope, protocolDigest })).toBe(bridge.coreDigest)
  })
})

function digest(value: string): DigestV2 { return parseDigestV2(Bun.CryptoHasher.hash("sha256", value, "hex")) }
function id(value: number) { return parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => value))) }
function signature() { return parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0))) }
