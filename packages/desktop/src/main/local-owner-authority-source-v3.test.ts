import { describe, expect, mock, test } from "bun:test"
import {
  encodeRestrictedJcsV2,
  localOwnerEditAuthorizationCoreDigestV3,
  localProjectOwnerBindingCoreDigestV3,
  ordinarySha256V2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  type LocalOwnerEditAuthorizationV3,
  type LocalProjectOwnerBindingV3,
  type LocalProjectOwnerSignerAuthorityV3,
} from "@convax/collaboration"

import { createCurrentLocalOwnerAuthoritySourceV3 } from "./local-owner-authority-source-v3"

const projectId = parseProjectIdV2("project-local-owner-v3-composition")
const id = (value: number) => parseId128V2(Buffer.alloc(16, value).toString("base64url"))
const projectEpoch = id(1)
const protocolDigest = parseDigestV2("a".repeat(64))
const publicKey = parsePublicKeyV2(Buffer.alloc(32, 2).toString("base64url"))
const signature = parseSignatureV2(Buffer.alloc(64, 3).toString("base64url"))
const replicaId = parseReplicaIdV2("replica_00000003")
const actorId = parseActorIdV2(publicKey)
const ownerKeyId = structuredDigest("convax.local-project-owner-public-key/3", publicKey)
const ownerSchemaDigest = parseDigestV2("b".repeat(64))
const scope = Object.freeze({ projectId, projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: id(3) })

const bindingCore = Object.freeze({
  format: "convax.local-project-owner-binding-core/3" as const,
  projectId,
  projectEpoch,
  ownerKeyId,
  ownerPublicKey: publicKey,
  initialReplicaId: replicaId,
  initialActorId: actorId,
  ownerSchemaDigest,
  protocolDigest,
  genesisAuthorizationPolicy: Object.freeze({
    format: "convax.local-owner-genesis-authorization-policy/3" as const,
    projectIndexScope: scope,
    canvasAuthorization: "accepted-project-index-route-genesis-only" as const,
  }),
  sharingGeneration: "0" as const,
  creationNonce: id(2),
})
const binding: LocalProjectOwnerBindingV3 = Object.freeze({
  format: "convax.local-project-owner-binding/3",
  core: bindingCore,
  coreDigest: localProjectOwnerBindingCoreDigestV3(bindingCore),
  ownerSignature: signature,
})
const authorizationCore = Object.freeze({
  format: "convax.local-owner-edit-authorization-core/3" as const,
  ownerBindingCoreDigest: binding.coreDigest,
  projectId,
  projectEpoch,
  scope,
  replicaId,
  actorId,
  actorSequenceAllocationPolicy: Object.freeze({
    format: "convax.local-owner-actor-sequence-allocation-policy/3" as const,
    kind: "strict-durable-head-successor" as const,
    initialSequence: "1" as const,
  }),
  protocolDigest,
  sharingGeneration: "0" as const,
  expiryPolicy: "none" as const,
})
const authorization: LocalOwnerEditAuthorizationV3 = Object.freeze({
  format: "convax.local-owner-edit-authorization/3",
  core: authorizationCore,
  coreDigest: localOwnerEditAuthorizationCoreDigestV3(authorizationCore),
  ownerSignature: signature,
})
const authority: LocalProjectOwnerSignerAuthorityV3 = Object.freeze({
  kind: "local-project-owner",
  ownerKeyId,
  replicaId,
  actorId,
  ownerBindingCoreDigest: binding.coreDigest,
  ownerEditAuthorizationCoreDigest: authorization.coreDigest,
})

describe("successor local-owner authority Desktop composition", () => {
  test("verifies exact unshared authority before opening its signer", async () => {
    const openSigner = mock(async () => ({ async sign() { return signature } }))
    const source = createCurrentLocalOwnerAuthoritySourceV3({
      records: { async resolveExact() { return { authority, binding, authorization } } },
      sharingState: { async resolve() { return "unshared" } },
      verifier: { async verify() { return true } },
      signers: { openSigner },
    })
    const result = await source.resolveCurrent({ projectId, projectEpoch, scope, ownerSchemaDigest, protocolDigest })
    expect(result).not.toBe("pending")
    expect(result).not.toBe("rejected")
    if (typeof result === "string") throw new Error("unexpected")
    expect(result.authority.kind).toBe("local-project-owner")
    expect(result.dependencies.map((entry) => entry.kind)).toEqual([
      "local-owner-binding", "local-owner-edit-authorization",
    ])
    expect(openSigner).toHaveBeenCalledWith({ projectId, projectEpoch, replicaId, expectedPublicKey: publicKey })
  })

  test("a shared tombstone rejects the restored local owner before vault access", async () => {
    const openSigner = mock(async () => ({ async sign() { return signature } }))
    const source = createCurrentLocalOwnerAuthoritySourceV3({
      records: { async resolveExact() { return { authority, binding, authorization } } },
      sharingState: { async resolve() { return "shared" } },
      verifier: { async verify() { return true } },
      signers: { openSigner },
    })
    await expect(source.resolveCurrent({ projectId, projectEpoch, scope, ownerSchemaDigest, protocolDigest })).resolves.toBe("rejected")
    expect(openSigner).not.toHaveBeenCalled()
  })
})

function structuredDigest(domain: `${string}/3`, value: unknown) {
  const domainBytes = new TextEncoder().encode(domain)
  const bytes = encodeRestrictedJcsV2(value)
  const preimage = new Uint8Array(domainBytes.byteLength + 1 + bytes.byteLength)
  preimage.set(domainBytes)
  preimage[domainBytes.byteLength] = 0
  preimage.set(bytes, domainBytes.byteLength + 1)
  return ordinarySha256V2(preimage)
}
