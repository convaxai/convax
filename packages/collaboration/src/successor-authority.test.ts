import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  assertLocalOwnerAuthorityClosureV3,
  encodeRestrictedJcsV2,
  localOwnerEditAuthorizationCoreDigestV3,
  localProjectOwnerBindingCoreDigestV3,
  ordinarySha256V2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseReplicaIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseSignatureV2,
  verifyLocalOwnerAuthorityV3,
} from "./index"
import {
  causalSignerAuthorityDigestV3,
  parseCausalAuthorityDependenciesV3,
  parseCausalSignerAuthorityV3,
} from "./successor-authority"

const digest = (value: string) => ordinarySha256V2(new TextEncoder().encode(value))
const actor = parseActorIdV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 7)))
const member = parseMemberIdV2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => 8)))
const epoch = parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => 9)))
const replica = parseReplicaIdV2("replica_00000007")
const local = Object.freeze({
  kind: "local-project-owner" as const,
  ownerKeyId: digest("key"),
  replicaId: replica,
  actorId: actor,
  ownerBindingCoreDigest: digest("binding"),
  ownerEditAuthorizationCoreDigest: digest("authorization"),
})
const team = Object.freeze({
  kind: "team-replica" as const,
  memberId: member,
  replicaId: replica,
  actorId: actor,
  memberAuthorizationEpoch: epoch,
  replicaAuthorizationEpoch: epoch,
  membershipSnapshotDigest: digest("membership"),
  replicaActorCredentialCoreDigest: digest("credential"),
  replicaEditAuthorizationCoreDigest: digest("edit"),
})

describe("successor signer authority", () => {
  test("parses a closed tagged union and binds the tag into its digest", () => {
    expect(parseCausalSignerAuthorityV3(local)).toEqual(local)
    expect(parseCausalSignerAuthorityV3(team)).toEqual(team)
    expect(causalSignerAuthorityDigestV3(local)).not.toBe(causalSignerAuthorityDigestV3(team))
    expect(() => parseCausalSignerAuthorityV3({ ...local, memberId: member })).toThrow("unknown or missing fields")
    expect(() => parseCausalSignerAuthorityV3({ ...local, kind: "future" })).toThrow("kind is invalid")
    expect(() => parseCausalSignerAuthorityV3({ ...team, ownerKeyId: digest("cross-kind") })).toThrow("unknown or missing fields")
  })

  test("requires exact kind-specific proof closure", () => {
    const localDependencies = [
      { kind: "local-owner-binding" as const, digest: local.ownerBindingCoreDigest },
      { kind: "local-owner-edit-authorization" as const, digest: local.ownerEditAuthorizationCoreDigest },
    ]
    expect(parseCausalAuthorityDependenciesV3(localDependencies, local)).toEqual(localDependencies)
    expect(() => parseCausalAuthorityDependenciesV3(localDependencies.slice(0, 1), local)).toThrow("not exact")
    expect(() => parseCausalAuthorityDependenciesV3([...localDependencies, { kind: "membership-snapshot", digest: team.membershipSnapshotDigest }], local)).toThrow("not exact")

    const teamDependencies = [
      { kind: "membership-snapshot" as const, digest: team.membershipSnapshotDigest },
      { kind: "replica-actor-credential" as const, digest: team.replicaActorCredentialCoreDigest },
      { kind: "replica-edit-authorization" as const, digest: team.replicaEditAuthorizationCoreDigest },
    ]
    expect(parseCausalAuthorityDependenciesV3(teamDependencies, team)).toEqual(teamDependencies)
    expect(() => parseCausalAuthorityDependenciesV3([...teamDependencies].reverse(), team)).toThrow("strictly sorted")
    expect(() => parseCausalAuthorityDependenciesV3([{ ...teamDependencies[0]!, digest: digest("tamper") }, ...teamDependencies.slice(1)], team)).toThrow("not exact")
  })

  test("rejects wildcard-like and cross-Canvas local owner authorization", async () => {
    const projectId = parseProjectIdV2("project-local-authority-scope-test")
    const projectEpoch = epoch
    const projectIndexScope = Object.freeze({ projectId, projectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: epoch })
    const canvasScope = Object.freeze({ projectId, projectEpoch, docKind: "canvas" as const, docId: parseCanvasIdV2(`cv_${"a".repeat(64)}`), shardEpoch: epoch })
    const otherCanvasScope = Object.freeze({ ...canvasScope, docId: parseCanvasIdV2(`cv_${"b".repeat(64)}`) })
    const ownerPublicKey = parsePublicKeyV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 4)))
    const ownerKeyId = structuredDigest("convax.local-project-owner-public-key/3", ownerPublicKey)
    const protocolDigest = digest("protocol-v3")
    const ownerSchemaDigest = digest("canvas-schema-v3")
    const bindingCore = Object.freeze({
      format: "convax.local-project-owner-binding-core/3" as const,
      projectId, projectEpoch, ownerKeyId, ownerPublicKey,
      initialReplicaId: replica, initialActorId: actor, ownerSchemaDigest, protocolDigest,
      genesisAuthorizationPolicy: Object.freeze({
        format: "convax.local-owner-genesis-authorization-policy/3" as const,
        projectIndexScope,
        canvasAuthorization: "accepted-project-index-route-genesis-only" as const,
      }),
      sharingGeneration: "0" as const, creationNonce: epoch,
    })
    const signature = parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0)))
    const binding = Object.freeze({ format: "convax.local-project-owner-binding/3" as const, core: bindingCore, coreDigest: localProjectOwnerBindingCoreDigestV3(bindingCore), ownerSignature: signature })
    const authorizationCore = Object.freeze({
      format: "convax.local-owner-edit-authorization-core/3" as const,
      ownerBindingCoreDigest: binding.coreDigest, projectId, projectEpoch, scope: canvasScope,
      replicaId: replica, actorId: actor,
      actorSequenceAllocationPolicy: Object.freeze({ format: "convax.local-owner-actor-sequence-allocation-policy/3" as const, kind: "strict-durable-head-successor" as const, initialSequence: "1" as const }),
      protocolDigest, sharingGeneration: "0" as const, expiryPolicy: "none" as const,
    })
    const authorization = Object.freeze({ format: "convax.local-owner-edit-authorization/3" as const, core: authorizationCore, coreDigest: localOwnerEditAuthorizationCoreDigestV3(authorizationCore), ownerSignature: signature })
    const authority = Object.freeze({ ...local, ownerKeyId, ownerBindingCoreDigest: binding.coreDigest, ownerEditAuthorizationCoreDigest: authorization.coreDigest })
    const common = { authority, binding, authorization, projectId, projectEpoch, ownerSchemaDigest, protocolDigest, sharingState: { async resolve() { return "unshared" as const } }, verifier: { async verify() { return true } } }
    expect(() => assertLocalOwnerAuthorityClosureV3({ ...common, scope: canvasScope })).not.toThrow()
    await expect(verifyLocalOwnerAuthorityV3({ ...common, scope: canvasScope })).resolves.not.toBe("rejected")
    await expect(verifyLocalOwnerAuthorityV3({ ...common, scope: otherCanvasScope })).resolves.toBe("rejected")
    await expect(verifyLocalOwnerAuthorityV3({ ...common, scope: { ...canvasScope, docId: "*" } as never })).resolves.toBe("rejected")
    await expect(verifyLocalOwnerAuthorityV3({ ...common, scope: canvasScope, ownerSchemaDigest: digest("other-schema") })).resolves.toBe("rejected")
    expect(() => localOwnerEditAuthorizationCoreDigestV3({
      ...authorizationCore,
      actorSequenceAllocationPolicy: { ...authorizationCore.actorSequenceAllocationPolicy, kind: "wildcard" },
    } as never)).toThrow("allocation policy is invalid")
  })
})

function structuredDigest(domain: `${string}/3`, value: unknown) {
  const domainBytes = new TextEncoder().encode(domain)
  const bytes = encodeRestrictedJcsV2(value)
  const preimage = new Uint8Array(domainBytes.byteLength + 1 + bytes.byteLength)
  preimage.set(domainBytes)
  preimage.set(bytes, domainBytes.byteLength + 1)
  return parseDigestV2(ordinarySha256V2(preimage))
}
